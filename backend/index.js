const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const yahooFinance = require('yahoo-finance2').default;
const { Groq } = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const groq = new Groq();

try { yahooFinance.setGlobalConfig({ queue: { concurrency: 4 }, validation: { logErrors: false } }); } catch(e) {}

async function fetchRealMarketData(symbol) {
  const clean = symbol.trim().toUpperCase();
  let rawQuote = null; let fullSymbol = clean;

  if (/^\d+$/.test(clean)) {
    try { rawQuote = await yahooFinance.quote(`${clean}.TWO`); fullSymbol = `${clean}.TWO`; } catch(e) {}
    if (!rawQuote) { try { rawQuote = await yahooFinance.quote(`${clean}.TW`); fullSymbol = `${clean}.TW`; } catch(e) {} }
  } else { rawQuote = await yahooFinance.quote(clean); }

  if (!rawQuote || rawQuote.regularMarketPrice === undefined) throw new Error(`查無此代碼或 Yahoo 拒絕連線`);

  let summary = {};
  try { summary = await yahooFinance.quoteSummary(fullSymbol, { modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'] }); } catch (err) {}

  const sd = summary.summaryDetail || {}; const dks = summary.defaultKeyStatistics || {}; const fd = summary.financialData || {};
  const currency = fullSymbol.includes('.TW') || fullSymbol.includes('.TWO') ? 'NT$' : '$';

  return {
    quote: rawQuote, fullSymbol,
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
        let cleanData;

        try {
          // 🔴 絕對只抓真實數據，抓不到就直接報錯，絕不給假資料！
          const { quote, fullSymbol, deepMetrics } = await fetchRealMarketData(input);
          let historyQuotes = [];
          try {
            const chartResult = await yahooFinance.chart(fullSymbol, { period1: '2024-01-01', interval: '1d' });
            historyQuotes = (chartResult.quotes || []).filter(q => q.date && q.close).map(q => ({ date: new Date(q.date).toISOString().split('T')[0], close: q.close }));
          } catch(e) {}

          const currency = fullSymbol.includes('.TW') || fullSymbol.includes('.TWO') ? 'NT$' : '$';
          cleanData = {
            symbol: quote.symbol, name: quote.longName || quote.shortName || quote.symbol,
            price: quote.regularMarketPrice, changePercent: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume ? `${(quote.regularMarketVolume / 1e4).toFixed(1)} 萬張` : '---',
            high52w: quote.fiftyTwoWeekHigh ? `${currency}${quote.fiftyTwoWeekHigh}` : '---',
            low52w: quote.fiftyTwoWeekLow ? `${currency}${quote.fiftyTwoWeekLow}` : '---',
            history: historyQuotes, ...deepMetrics
          };

          ws.send(JSON.stringify({ type: 'stockData', data: cleanData }));

        } catch (fetchErr) {
          console.log("Yahoo Blocked or Not Found:", fetchErr.message);
          // 🔴 直接告訴前端錯誤，並終止後續 AI 動作
          ws.send(JSON.stringify({ type: 'stockData', data: null, error: 'Yahoo API 暫時阻擋了雲端主機的連線，無法取得真實數據。' }));
          ws.send(JSON.stringify({ type: 'done' }));
          return;
        }

        // 🟢 修復 AI 格式，強烈禁止使用 Markdown (###, **) 避免畫面亂碼
        const userPrompt = `分析標的: ${cleanData.name} (${cleanData.symbol})\n當前股價: ${cleanData.price}\n今日漲跌: ${cleanData.changePercent}%\n法人目標價: ${cleanData.targetPrice}\n\n【重要排版指令】：絕對禁止使用任何 Markdown 符號(如 ###, **, * 等)。請直接使用純文字，並利用換行來區隔。\n\n請依序回覆以下三個段落：\n\n【核心評語】\n(寫出一句話的重點結論)\n\n【基本面與目標價】\n(寫出基本面現況，以及股價與法人目標價的潛在空間對比)\n\n【技術與籌碼面】\n(寫出技術指標趨勢與支撐壓力位)`;

        try {
          const chatCompletion = await groq.chat.completions.create({
            messages: [
              { role: 'system', content: '你是頂級分析師。全程用繁體中文並嚴格遵守純文字排版格式。' },
              { role: 'user', content: userPrompt }
            ],
            model: 'llama-3.1-8b-instant', stream: true
          });
          for await (const chunk of chatCompletion) {
            const text = chunk.choices[0]?.delta?.content || '';
            if (text) ws.send(JSON.stringify({ type: 'aiChunk', text }));
          }
        } catch (aiErr) {
           ws.send(JSON.stringify({ type: 'aiChunk', text: '【系統提示】\nAI 伺服器目前忙碌中，但左側與右側的真實市場數據已為您更新。' }));
        }
        ws.send(JSON.stringify({ type: 'done' }));
      }
    } catch (err) {}
  });
});

process.on('uncaughtException', () => {}); process.on('unhandledRejection', () => {});
const PORT = process.env.PORT || 10000; server.listen(PORT, '0.0.0.0', () => console.log(`Real Data Strict Backend Live on ${PORT}`));
