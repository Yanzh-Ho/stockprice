const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const yahooFinance = require('yahoo-finance2').default;
const { Groq } = require('groq-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// 初始化 Groq (會自動讀取環境變數 GROQ_API_KEY)
const groq = new Groq();

// 全球語系防錯設定
yahooFinance.setGlobalConfig({
  queue: { concurrency: 4 },
  validation: { logErrors: false }
});

// 核心：智能台股代碼轉換器 (防禦上市 .TW / 上櫃興櫃 .TWO)
async function fetchStockWithFallback(symbol) {
  let cleanSymbol = symbol.trim().toUpperCase();
  
  // 如果使用者輸入純數字 (如 2330 或 4939)
  if (/^\d+$/.test(cleanSymbol)) {
    // 策略一：先嘗試當作上市股票 (.TW) 查詢
    try {
      const data = await yahooFinance.quote(`${cleanSymbol}.TW`, { lang: 'zh-TW' });
      if (data && data.regularMarketPrice) return data;
    } catch (e) {
      // 上市查不到，自動觸發策略二
    }

    // 策略二：嘗試當作上櫃或興櫃股票 (.TWO) 查詢
    try {
      const data = await yahooFinance.quote(`${cleanSymbol}.TWO`, { lang: 'zh-TW' });
      if (data && data.regularMarketPrice) return data;
    } catch (e) {
      // 兩邊都查不到
    }
    
    throw new Error(`找不到股票代號 ${cleanSymbol} 的任何上市櫃或興櫃報價`);
  }

  // 如果是美股代碼 (如 AAPL, NVDA)，直接查詢
  return await yahooFinance.quote(cleanSymbol);
}

// 獲取歷史 K 線數據
async function fetchHistory(symbol) {
  const today = new Date();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  try {
    return await yahooFinance.chart(symbol, {
      period1: oneYearAgo,
      period2: today,
      interval: '1d'
    });
  } catch (e) {
    // 如果對應的後綴查歷史失敗，嘗試用另一種後綴
    const base = symbol.split('.')[0];
    const fallbackSuffix = symbol.endsWith('.TW') ? '.TWO' : '.TW';
    try {
      return await yahooFinance.chart(`${base}${fallbackSuffix}`, {
        period1: oneYearAgo,
        period2: today,
        interval: '1d'
      });
    } catch (err) {
      return { quotes: [] };
    }
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message);
      
      if (payload.action === 'requestAnalysis') {
        const inputSymbol = payload.symbol;
        const promptType = payload.promptType || 'general';
        console.log(`Processing Symbol: ${inputSymbol}, Mode: ${promptType}`);

        // 1. 調用智能轉換器撈取即時數據
        let rawData;
        try {
          rawData = await fetchStockWithFallback(inputSymbol);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'stockData', data: null, error: err.message }));
          return;
        }

        // 2. 獲取對應的歷史數據
        const historyData = await fetchHistory(rawData.symbol);
        const processedHistory = (historyData.quotes || [])
          .filter(q => q.date && q.close)
          .map(q => ({
            date: new Date(q.date).toISOString().split('T')[0],
            open: q.open || q.close,
            high: q.high || q.close,
            low: q.low || q.close,
            close: q.close,
            volume: q.volume || 0
          }));

        // 3. 興櫃/上櫃零碎欄位防禦性清洗 (確保 null 欄位變回親切的 --- 避免前端當機)
        const cleanData = {
          symbol: rawData.symbol,
          name: rawData.longName || rawData.shortName || rawData.symbol,
          price: rawData.regularMarketPrice,
          change: rawData.regularMarketChange || 0,
          changePercent: rawData.regularMarketChangePercent || 0,
          marketCap: rawData.marketCap ? `${(rawData.marketCap / 1e12).toFixed(2)} 兆元` : '---',
          peRatio: rawData.trailingPE ? `${rawData.trailingPE.toFixed(1)} 倍` : '---',
          eps: rawData.trailingEps ? `${rawData.trailingEps.toFixed(2)} 元` : '---',
          volume: rawData.regularMarketVolume ? `${(rawData.regularMarketVolume / 1e4).toFixed(1)} 萬張` : '---',
          high52w: rawData.fiftyTwoWeekHigh ? `NT$${rawData.fiftyTwoWeekHigh}` : '---',
          low52w: rawData.fiftyTwoWeekLow ? `NT$${rawData.fiftyTwoWeekLow}` : '---',
          history: processedHistory
        };

        // 將真數據先甩回前端進行圖表渲染
        ws.send(JSON.stringify({ type: 'stockData', data: cleanData }));

        // 4. 根據前端按鈕動態客製化 Groq Llama 3.1 專業 Prompt
        let systemPrompt = `你是一位精通台灣股市與美股的頂級華爾街投資分析師。請全程使用【繁體中文】回答。`;
        let userPrompt = `請根據以下這檔股票的真實市場數據進行全面評估：
股票代號: ${cleanData.symbol}
公司名稱: ${cleanData.name}
最新收盤價: ${cleanData.price}
當日漲跌幅: ${cleanData.changePercent}%
本益比: ${cleanData.peRatio}
每股盈餘 EPS: ${cleanData.eps}
請針對使用者的特定需求給出分析結論。`;

        if (promptType === 'fundamental') {
          userPrompt += `\n【核心任務】：請側重於該公司的【基本面與財務結構】，評估其獲利能力、市值合理性，並給出明確的【核心評語】。`;
        } else if (promptType === 'technical') {
          userPrompt += `\n【核心任務】：請側重於該公司的【技術面防守位與量能結構】，分析近期股價波動趨勢，並給出明確的【支撐位與壓力位建議】。`;
        } else if (promptType === 'outlook') {
          userPrompt += `\n【核心任務】：請側重於該公司的【下季度展望與產業護城河】，結合目前的總體經濟局勢，給出未來的成長潛力評估。`;
        } else {
          userPrompt += `\n【核心任務】：請提供綜合的基本面與市場情緒分析，並給出 Verdict。`;
        }

        // 調用最新且健康的 llama-3.1-8b-instant 模型進行流暢串流
        const chatCompletion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          model: 'llama-3.1-8b-instant',
          stream: true
        });

        // 逐字噴射大腦思維
        for await (const chunk of chatCompletion) {
          const text = chunk.choices[0]?.delta?.content || '';
          if (text) {
            ws.send(JSON.stringify({ type: 'aiChunk', text }));
          }
        }
        ws.send(JSON.stringify({ type: 'done' }));
      }
    } catch (err) {
      console.error('WS Error:', err);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ultimate Backend 3.0 Live on port ${PORT}`);
});
