const http = require('http');
const WebSocket = require('ws');
const { Groq } = require('groq-sdk');

const server = http.createServer();
const wss = new WebSocket.Server({ server });
const groq = new Groq();

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/'
};

// 直接打 Yahoo Finance v8 chart API（不用 library，繞過 crumb 問題）
async function fetchStockFromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, {
    headers: YF_HEADERS,
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
  
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result?.meta?.regularMarketPrice) throw new Error(`No price data for ${symbol}`);
  
  const meta   = result.meta;
  const ts     = result.timestamp || [];
  const q      = result.indicators?.quote?.[0] || {};
  const closes = q.close  || [];
  const opens  = q.open   || [];
  const vols   = q.volume || [];

  const history = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().split('T')[0],
      close:  closes[i] ?? null,
      open:   opens[i]  ?? closes[i] ?? null,
      volume: vols[i]   ?? 0
    }))
    .filter(h => h.close != null);

  return {
    symbol:        meta.symbol,
    name:          meta.longName || meta.shortName || meta.symbol,
    price:         meta.regularMarketPrice,
    changePercent: meta.regularMarketChangePercent || 0,
    history
  };
}

// 抓補充財務指標（PE、EPS、市值）
async function fetchQuoteDetail(symbol) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: YF_HEADERS,
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return {};
  const json = await res.json();
  const q = json?.quoteResponse?.result?.[0];
  if (!q) return {};
  return {
    marketCap: q.marketCap      ? `${(q.marketCap / 1e12).toFixed(2)} 兆`   : '---',
    peRatio:   q.trailingPE     ? `${q.trailingPE.toFixed(1)}x`              : '---',
    eps:       q.epsTrailingTwelveMonths ? `${q.epsTrailingTwelveMonths.toFixed(2)} 元` : '---',
    volume:    q.regularMarketVolume ? `${(q.regularMarketVolume / 1e4).toFixed(1)} 萬張` : '---',
    high52w:   q.fiftyTwoWeekHigh ? `NT$${q.fiftyTwoWeekHigh}` : '---',
    low52w:    q.fiftyTwoWeekLow  ? `NT$${q.fiftyTwoWeekLow}`  : '---'
  };
}

// 台股純數字 → 先試 .TWO 再試 .TW；美股直打
async function resolveSymbol(input) {
  const clean = input.trim().toUpperCase();
  if (/^\d+$/.test(clean)) {
    try { return await fetchStockFromYahoo(`${clean}.TWO`); } catch(e) {}
    try { return await fetchStockFromYahoo(`${clean}.TW`);  } catch(e) {}
    throw new Error(`查無台股代號 ${clean}`);
  }
  // 已有後綴（2330.TW）或美股直接查
  return await fetchStockFromYahoo(clean);
}

// Mock history 備用
function mockHistory(price) {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i));
    const c = +(price * (1 + (Math.random() - 0.49) * 0.02)).toFixed(2);
    return { date: d.toISOString().split('T')[0], close: c, open: c, volume: Math.floor(Math.random() * 500 + 100) };
  });
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
        const base   = await resolveSymbol(input);
        const detail = await fetchQuoteDetail(base.symbol).catch(() => ({}));
        stockData = { ...base, ...detail };
        if (!stockData.history?.length) stockData.history = mockHistory(stockData.price);
        if (!stockData.marketCap) stockData.marketCap = '---';
        if (!stockData.high52w)   stockData.high52w   = `NT$${(stockData.price * 1.2).toFixed(1)}`;
        if (!stockData.low52w)    stockData.low52w    = `NT$${(stockData.price * 0.8).toFixed(1)}`;
      } catch (fetchErr) {
        console.error('Fetch failed:', fetchErr.message);
        const mockPrice = 100 + Math.floor(Math.random() * 100);
        stockData = {
          symbol: input.includes('.') ? input : `${input}.TW`,
          name: `台股 ${input}`, price: mockPrice,
          changePercent: +((Math.random() - 0.5) * 3).toFixed(2),
          marketCap: '---', peRatio: '---', eps: '---', volume: '---',
          high52w: `NT$${(mockPrice * 1.2).toFixed(1)}`,
          low52w:  `NT$${(mockPrice * 0.8).toFixed(1)}`,
          history: mockHistory(mockPrice)
        };
      }

      ws.send(JSON.stringify({ type: 'stockData', data: stockData }));

      // Groq AI 串流
      try {
        const stream = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: '你是精通台股與美股的華爾街資深分析師，請全程用繁體中文回答。' },
            { role: 'user', content: `分析：${stockData.name} (${stockData.symbol})，現價 ${stockData.price} 元，今日 ${stockData.changePercent}%。請給出簡短犀利的操盤建議（150字內）。` }
          ],
          model: 'llama-3.1-8b-instant',
          stream: true
        });
        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) ws.send(JSON.stringify({ type: 'aiChunk', text }));
        }
      } catch (aiErr) {
        ws.send(JSON.stringify({ type: 'aiChunk', text: '【系統提示】AI 模組暫時忙碌，請稍後重新查詢。' }));
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
