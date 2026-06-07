const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const yahooFinance = require('yahoo-finance2').default;
const { Groq } = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const groq = new Groq();

try {
  yahooFinance.setGlobalConfig({
    queue: { concurrency: 8 },
    validation: { logErrors: false }
  });
} catch(e) {}

async function fetchRealMarketData(symbol) {
  const clean = symbol.trim().toUpperCase();
  let rawQuote = null;
  let fullSymbol = clean;

  if (/^\d+$/.test(clean)) {
    try {
      rawQuote = await yahooFinance.quote(`${clean}.TWO`, { lang: 'zh-TW' });
      fullSymbol = `${clean}.TWO`;
    } catch(e) {}
    if (!rawQuote) {
      try {
        rawQuote = await yahooFinance.quote(`${clean}.TW`, { lang: 'zh-TW' });
        fullSymbol = `${clean}.TW`;
      } catch(e) {}
    }
  } else {
    rawQuote = await yahooFinance.quote(clean, { lang: 'zh-TW' });
  }

  if (!rawQuote || rawQuote.regularMarketPrice === undefined) {
    throw new Error(`查無此代碼: ${clean}`);
  }

  // 🔥 核心追加：呼叫 quoteSummary 抓取深層財務指標與法人目標價
  let summary = {};
  try {
    summary = await yahooFinance.quoteSummary(fullSymbol, {
      modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData']
    });
  } catch (err) {
    console.log(`深層數據抓取失敗: ${fullSymbol} (可能是興櫃或無資料)`);
  }

  const sd = summary.summaryDetail || {};
  const dks = summary.defaultKeyStatistics || {};
  const fd = summary.financialData || {};

  const currency = fullSymbol.includes('.TW') || fullSymbol.includes('.TWO') ? 'NT$' : '$';

  return {
    quote: rawQuote,
    fullSymbol,
    deepMetrics: {
      marketCap: sd.marketCap ? `${(sd.marketCap / 1e12).toFixed(2)} 兆` : (rawQuote.marketCap ? `${(rawQuote.marketCap / 1e12).toFixed(2)} 兆` : '---'),
      peRatio: sd.trailingPE ? `${sd.trailingPE.toFixed(1)}x` : (rawQuote.trailingPE ? `${rawQuote.trailingPE.toFixed(1)}x` : '---'),
      eps: dks.trailingEps ? `${dks.trailingEps.toFixed(2)} 元` : (rawQuote.trailingEps ? `${rawQuote.trailingEps.toFixed(2)} 元` : '---'),
      beta: sd.beta ? sd.beta.toFixed(2) : '---',
      dividendYield: sd.dividendYield ? `${(sd.dividendYield * 100).toFixed(2)}%` : '---',
      avgVolume: sd.averageVolume ? `${(sd.averageVolume / 1e4).toFixed(1)} 萬張` : '---',
      targetPrice: fd.targetMeanPrice ? `${currency}${fd.targetMeanPrice.toFixed(1)}` : '---'
    }
  };
}

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      let msgString = typeof message === 'string' ? message : message.toString('utf8');
      const payload = JSON.parse(msgString);

      if (payload.action === 'requestAnalysis') {
        const input = payload.symbol || '2330';
        try {
          const { quote, fullSymbol, deepMetrics } = await fetchRealMarketData(input);

          let historyQuotes = [];
          try {
            const chartResult = await yahooFinance.chart(fullSymbol, { period1: '2024-01-01', interval: '1d' });
            historyQuotes = (chartResult.quotes || []).filter(q => q.date && q.close).map(q => ({
              date: new Date(q.date).toISOString().split('T')[0], close: q.close
            }));
          } catch(chartErr) {}

          const currency = fullSymbol.includes('.TW') || fullSymbol.includes('.TWO') ? 'NT$' : '$';

          const cleanData = {
            symbol: quote.symbol,
            name: quote.longName || quote.shortName || quote.symbol,
            price: quote.regularMarketPrice,
            changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume ? `${(quote.regularMarketVolume / 1e4).toFixed(1)} 萬張` : '---',
            high52w: quote.fiftyTwoWeekHigh ? `${currency}${quote.fiftyTwoWeekHigh}` : '---',
            low52w: quote.fiftyTwoWeekLow ? `${currency}${quote.fiftyTwoWeekLow}` : '---',
            history: historyQuotes,
            ...deepMetrics // 將深層數據混入
          };

          ws.send(JSON.stringify({ type: 'stockData', data: cleanData }));

          // 🔥 核心追加：強制 AI 使用 Markdown 條列式排版
          const userPrompt = `請分析真實市場數據：
股票: ${cleanData.name} (${cleanData.symbol})
當前股價: ${cleanData.price}
今日漲跌幅: ${cleanData.changePercent}%
法人目標價: ${cleanData.targetPrice}

請「嚴格」依照以下 Markdown 格式與標題進行回覆（不要輸出任何其他廢話）：

【🔥 核心評語】
(用一句話總結目前的投資建議與情緒)

【📊 基本面與目標價】
- (列點說明基本面現況)
- (對比目前股價與法人目標價 ${cleanData.targetPrice} 的潛在空間)

【📉 技術與籌碼面】
- (列點說明量能與技術指標趨勢)
- (給出關鍵支撐或壓力位建議)`;

          try {
            const chatCompletion = await groq.chat.completions.create({
              messages: [
                { role: 'system', content: '你是一位精通全球股市的華爾街頂級分析師。請全程使用繁體中文，並嚴格遵守要求的排版格式。' },
                { role: 'user', content: userPrompt }
              ],
              model: 'llama-3.1-8b-instant',
              stream: true
            });

            for await (const chunk of chatCompletion) {
              const text = chunk.choices[0]?.delta?.content || '';
              if (text) ws.send(JSON.stringify({ type: 'aiChunk', text }));
            }
          } catch (aiErr) {
             ws.send(JSON.stringify({ type: 'aiChunk', text: '【系統提示】AI 伺服器忙碌中，但真實財報與法人目標價已更新於右側面板。' }));
          }

        } catch (fetchErr) {
          ws.send(JSON.stringify({ type: 'stockData', data: null, error: '查無此股票代碼' }));
        }
        ws.send(JSON.stringify({ type: 'done' }));
      }
    } catch (err) {}
  });
});

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Backend Live on ${PORT}`));
