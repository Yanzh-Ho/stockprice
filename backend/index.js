const http = require('http');
const WebSocket = require('ws');
const { Groq } = require('groq-sdk');

const server = http.createServer();
const wss = new WebSocket.Server({ server });
const groq = new Groq();

// 模擬瀏覽器 Headers，繞過 Render 雲端 IP 封鎖
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,zh-TW;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

// v8 chart API — 即時報價 + 1年歷史
async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`v8 HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result?.meta?.regularMarketPrice) throw new Error('No price data');

  const meta = result.meta;
  const ts   = result.timestamp || [];
  const q    = result.indicators?.quote?.[0] || {};
  const prev = meta.regularMarketPreviousClose || meta.chartPreviousClose || meta.regularMarketPrice;

  let changePercent = meta.regularMarketChangePercent || 0;
  let change        = meta.regularMarketChange || 0;
  if (changePercent === 0 && prev && prev !== meta.regularMarketPrice) {
    change        = +(meta.regularMarketPrice - prev).toFixed(2);
    changePercent = +((change / prev) * 100).toFixed(2);
  }

  const history = ts.map((t, i) => ({
    date:  new Date(t * 1000).toISOString().split('T')[0],
    open:  (q.open  || [])[i] ?? null,
    high:  (q.high  || [])[i] ?? null,
    low:   (q.low   || [])[i] ?? null,
    close: (q.close || [])[i] ?? null,
  })).filter(h => h.close != null && h.open != null);

  return {
    symbol:        meta.symbol,
    name:          meta.longName || meta.shortName || meta.symbol,
    price:         meta.regularMarketPrice,
    change,
    changePercent,
    volume:        meta.regularMarketVolume ? `${(meta.regularMarketVolume / 1e4).toFixed(1)} 萬張` : '---',
    high52w:       meta.fiftyTwoWeekHigh,
    low52w:        meta.fiftyTwoWeekLow,
    history,
  };
}

// v7 quote API — 市值、PE、EPS、Beta、殖利率
async function fetchQuote(symbol) {
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
      const res = await fetch(url, { headers: YF_HEADERS, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      const q = json?.quoteResponse?.result?.[0];
      if (!q) continue;
      return {
        marketCap:     q.marketCap               ? `${(q.marketCap / 1e12).toFixed(2)} 兆`        : '---',
        peRatio:       q.trailingPE              ? `${q.trailingPE.toFixed(1)}x`                   : '---',
        eps:           q.epsTrailingTwelveMonths ? `${q.epsTrailingTwelveMonths.toFixed(2)} 元`     : '---',
        beta:          q.beta                    ? q.beta.toFixed(2)                               : '---',
        dividendYield: q.dividendYield           ? `${(q.dividendYield * 100).toFixed(2)}%`        : '---',
        avgVolume:     q.averageDailyVolume3Month ? `${(q.averageDailyVolume3Month / 1e4).toFixed(1)} 萬張` : '---',
        _high52w:      q.fiftyTwoWeekHigh,
        _low52w:       q.fiftyTwoWeekLow,
      };
    } catch(e) {}
  }
  return {};
}


// 台股純數字 → 先試 .TWO 再試 .TW；美股直打
async function resolveSymbol(input) {
  const clean = input.trim().toUpperCase();
  if (/^\d+$/.test(clean)) {
    try { return await fetchChart(`${clean}.TWO`); } catch(e) {}
    try { return await fetchChart(`${clean}.TW`);  } catch(e) {}
    throw new Error(`查無台股代號 ${clean}`);
  }
  return await fetchChart(clean);
}

wss.on('connection', (ws) => {
  console.log('Client connected.');

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(Buffer.isBuffer(message) ? message.toString() : message);
      if (payload.action !== 'requestAnalysis') return;

      const input = payload.symbol || '2330';
      console.log(`Fetching: ${input}`);

      let stockData;
      try {
        // 兩支 API 並行抓取（移除已失效的 v11 target price）
        const base = await resolveSymbol(input);
        const quote = await fetchQuote(base.symbol).catch(() => ({}));

        const { _high52w, _low52w, ...cleanQuote } = quote;
        const isTW = /\.(TW|TWO)$/i.test(base.symbol);
        const sym  = isTW ? 'NT$' : '$';

        const hi52 = base.high52w ?? _high52w;
        const lo52 = base.low52w  ?? _low52w;

        stockData = {
          ...base,
          ...cleanQuote,
          high52w: hi52 ? `${sym}${hi52}` : '---',
          low52w:  lo52 ? `${sym}${lo52}` : '---',
          isTW,
          sym,
        };
      } catch (fetchErr) {
        console.error('Fetch failed:', fetchErr.message);
        ws.send(JSON.stringify({ type: 'stockData', data: null, error: `查無此代號或 Yahoo 暫時限流，請稍後再試。(${fetchErr.message})` }));
        ws.send(JSON.stringify({ type: 'done' }));
        return;
      }

      ws.send(JSON.stringify({ type: 'stockData', data: stockData }));

      // Groq AI 串流 — AI 估算目標價 + 純文字三段格式
      try {
        const sym = stockData.sym || (stockData.isTW ? 'NT$' : '$');
        const price = stockData.price;

        const userPrompt =
`分析標的: ${stockData.name} (${stockData.symbol})
現價: ${price}  今日漲跌: ${stockData.changePercent >= 0 ? '+' : ''}${stockData.changePercent}%
市值: ${stockData.marketCap}  本益比: ${stockData.peRatio}  EPS: ${stockData.eps}
Beta: ${stockData.beta}  殖利率: ${stockData.dividendYield}
52週高/低: ${stockData.high52w} / ${stockData.low52w}

【排版規則】只能用純文字，禁止任何 Markdown 符號（### ** * _ 等）。
請嚴格依以下格式輸出，共 220 字以內：

第一行必須是（格式固定，不可更改）：
AI估算目標價：${sym}XXX

然後輸出以下三段：

【核心評語】
一句話結論。

【基本面與目標價】
說明基本面品質；對比現價 ${price} 與你剛才估算的目標價的潛在漲跌空間。

【技術與籌碼面】
說明近期趨勢；給出建議進場或停損價位。`;

        const stream = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: '你是台股與美股的頂級分析師，全程使用繁體中文，嚴格遵守純文字格式。' },
            { role: 'user',   content: userPrompt }
          ],
          model: 'llama-3.1-8b-instant',
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) ws.send(JSON.stringify({ type: 'aiChunk', text }));
        }
      } catch (aiErr) {
        ws.send(JSON.stringify({ type: 'aiChunk', text: '【系統提示】\nAI 伺服器忙碌中，但右側真實市場數據已更新。' }));
      }

      ws.send(JSON.stringify({ type: 'done' }));
    } catch (err) {
      console.error('WS error:', err.message);
    }
  });
});

process.on('uncaughtException',  err => console.error('Uncaught:', err.message));
process.on('unhandledRejection', r   => console.error('Rejected:', r));

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Live on ${PORT}`));
