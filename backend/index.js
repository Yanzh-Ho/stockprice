'use strict';
require('dotenv').config();

const http = require('http');
const { WebSocketServer } = require('ws');

// ── yahoo-finance2 v3 requires explicit instantiation ─────────────────────────
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  validation: { logErrors: false, logOptionsErrors: false },
});

// ── groq-sdk ──────────────────────────────────────────────────────────────────
const Groq = require('groq-sdk');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT        || 8080;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL  || 'llama-3.1-8b-instant';

if (!GROQ_KEY) {
  console.warn('[warn] GROQ_API_KEY is not set — AI analysis will run in MOCK mode.');
  console.warn('[warn] Set GROQ_API_KEY in Render > Environment to enable real AI.');
}

const groq = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. SYMBOL HELPER
// ─────────────────────────────────────────────────────────────────────────────

/** "2330" → "2330.TW"  |  "AAPL" → "AAPL"  |  "2330.TW" → "2330.TW" */
function toYahooSymbol(raw) {
  const s = raw.trim().toUpperCase();
  if (/^\d{4,6}$/.test(s))           return `${s}.TW`;  // pure number → TW
  if (/^\d{4,6}\.(TW|TWO)$/i.test(s)) return s;          // already has suffix
  return s;                                               // US stock (AAPL etc.)
}

const isTW = (sym) => /\.(TW|TWO)$/i.test(sym);

// ─────────────────────────────────────────────────────────────────────────────
// 2. NUMBER FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtMarketCap(n, tw) {
  if (!n || n <= 0) return '—';
  if (tw) {
    if (n >= 1e12) return `${(n / 1e12).toFixed(1)} 兆元`;
    if (n >= 1e8)  return `${Math.round(n / 1e8).toLocaleString()} 億元`;
    return `${Math.round(n / 1e6).toLocaleString()} 百萬元`;
  }
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

function fmtVolume(n, tw) {
  if (!n || n <= 0) return '—';
  if (tw) {
    const lots = n / 1000;
    return lots >= 10000
      ? `${(lots / 10000).toFixed(1)} 萬張`
      : `${Math.round(lots).toLocaleString()} 張`;
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

const fix2 = (n) => (n != null ? +n.toFixed(2) : 0);
const fix0 = (n) => (n != null ? Math.round(n) : 0);

// ─────────────────────────────────────────────────────────────────────────────
// 3. YAHOO FINANCE FETCHERS
// ─────────────────────────────────────────────────────────────────────────────

async function fetchQuote(yahooSym) {
  const q = await yf.quote(yahooSym, {}, { validateResult: false });
  if (!q || !q.regularMarketPrice) {
    throw new Error(`找不到「${yahooSym}」的報價資料，請確認股票代號是否正確。`);
  }
  return q;
}

async function fetchHistory(yahooSym) {
  try {
    const period2 = new Date();
    const period1 = new Date(period2);
    period1.setFullYear(period1.getFullYear() - 1);

    const rows = await yf.historical(
      yahooSym,
      { period1, period2, interval: '1d' },
      { validateResult: false }
    );

    if (!Array.isArray(rows) || rows.length === 0) return [];

    return rows
      .filter(r => r.close != null && r.close > 0)
      .map(r => ({
        o: fix2(r.open  ?? r.close),
        h: fix2(r.high  ?? r.close),
        l: fix2(r.low   ?? r.close),
        c: fix2(r.close),
        v: r.volume ?? 0,
      }));
  } catch (err) {
    // History is optional — return empty array rather than crashing
    console.warn(`[yahoo] history fetch failed for ${yahooSym}: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. BUILD stockData PAYLOAD
// ─────────────────────────────────────────────────────────────────────────────

function buildStockPayload(rawSym, yahooSym, quote, candles) {
  const tw  = isTW(yahooSym);
  const sym = tw ? 'NT$' : '$';

  const price  = fix2(quote.regularMarketPrice ?? 0);
  const change = fix2(quote.regularMarketChange ?? 0);
  const pct    = fix2(quote.regularMarketChangePercent ?? 0);

  // Target price: rough estimate ±10–15% from current price
  const lo  = fix0(price * 0.88);
  const mid = fix0(price * 1.06);
  const hi  = fix0(price * 1.16);

  return {
    // identity
    ticker:   rawSym.toUpperCase(),
    name:     quote.shortName ?? quote.longName ?? rawSym,
    fullName: quote.longName  ?? quote.shortName ?? rawSym,
    market:   tw ? 'TW' : 'US',
    currency: tw ? 'TWD' : 'USD',
    sym,

    // price snapshot
    price, change, pct,

    // fundamentals
    cap:    fmtMarketCap(quote.marketCap, tw),
    pe:     quote.trailingPE  ? `${quote.trailingPE.toFixed(1)}倍`          : '—',
    eps:    quote.trailingEps ? `${sym}${quote.trailingEps.toFixed(2)}`      : '—',
    beta:   quote.beta        ? `${quote.beta.toFixed(2)}`                   : '—',
    vol:    fmtVolume(quote.regularMarketVolume,        tw),
    avgVol: fmtVolume(quote.averageDailyVolume3Month,   tw),
    hi52:   fix2(quote.fiftyTwoWeekHigh ?? price),
    lo52:   fix2(quote.fiftyTwoWeekLow  ?? price),
    div:    quote.trailingAnnualDividendYield
              ? `${(quote.trailingAnnualDividendYield * 100).toFixed(2)}%`
              : '—',
    sector: quote.sector ?? quote.industryDisp ?? '—',

    // K-line history
    history: candles,

    // Placeholders — AI analysis will provide real values via aiChunk/done
    verdict: 'HOLD',
    conf: 50,
    target: { lo, mid, hi },
    risks: [],
    sentimentScore: 50,
    sentimentLabel: '分析中',
    analysts: { buy: 0, hold: 0, sell: 0 },
    summary: '',
    tags: [],
    news: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. GROQ PROMPT
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompt(d, yahooSym) {
  const {
    ticker, fullName, market, sym,
    price, change, pct, pe, eps, cap, div, beta, hi52, lo52, vol,
    history,
  } = d;

  // 20-day price trend from real K-line data
  let trendLine = '';
  if (history.length >= 20) {
    const sl  = history.slice(-20);
    const t   = ((sl[sl.length - 1].c - sl[0].c) / sl[0].c * 100).toFixed(1);
    trendLine = `近 20 交易日漲跌幅：${Number(t) >= 0 ? '+' : ''}${t}%`;
  }

  const ps = pct    >= 0 ? '+' : '';
  const cs = change >= 0 ? '+' : '';

  return `你是一位資深股票分析師，熟悉台灣股市（TWSE）及美國股市（NASDAQ/NYSE），\
擅長基本面分析、技術面分析與風險評估。

請根據以下**真實即時市場數據**（來自 Yahoo Finance），用**繁體中文**撰寫一份完整的投資分析報告。

═══ 股票基本資料 ═══
代號：${ticker}  (Yahoo Finance: ${yahooSym})
公司：${fullName}
市場：${market === 'TW' ? '台灣股市（TWSE）' : '美國股市（NASDAQ/NYSE）'}

═══ 即時行情 ═══
目前股價：${sym}${price.toLocaleString()}
今日漲跌：${cs}${sym}${Math.abs(change).toFixed(2)}（${ps}${pct.toFixed(2)}%）
52 週高／低：${sym}${hi52.toLocaleString()} ／ ${sym}${lo52.toLocaleString()}
${trendLine}

═══ 基本面指標 ═══
本益比 (TTM)：${pe}
每股盈餘 (EPS)：${eps}
市值：${cap}
現金殖利率：${div}
Beta 值：${beta}
今日成交量：${vol}

═══ 報告格式（請依序輸出）═══
**【核心評語】** 一句話給出 BUY／HOLD／SELL 建議及最關鍵的理由。
**【基本面分析】** 列出 2～3 個投資亮點或隱憂。
**【技術面觀察】** 說明近期趨勢方向、關鍵支撐位與壓力位。
**【主要風險】** 條列 2～3 個具體風險因子。
**【12 個月目標價】** 給出「低 / 中 / 高」三個價位區間，並說明依據。

═══ 最後一行（固定格式，供程式解析，請勿修改）═══
VERDICT: BUY|HOLD|SELL  CONF: 0-100`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. GROQ STREAMING (with mock fallback)
// ─────────────────────────────────────────────────────────────────────────────

async function streamAnalysis(prompt, ws) {
  // ── No API key → mock streaming ────────────────────────────────────────────
  if (!groq) {
    const msg =
      '**【Mock 模式】**\n\n' +
      'Yahoo Finance 真實股票數據已成功取得並回傳至前端。\n\n' +
      'AI 分析功能目前處於 Mock 模式（尚未設定 `GROQ_API_KEY`）。\n\n' +
      '請在 Render 的 **Environment Variables** 中加入：\n' +
      '```\nGROQ_API_KEY = gsk_xxxxxxxxxxxx\n```\n\n' +
      '重新部署後即可啟用真實 AI 串流分析。\n\n' +
      'VERDICT: HOLD  CONF: 50';
    let pos = 0;
    const timer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) { clearInterval(timer); return; }
      const end = Math.min(pos + Math.ceil(Math.random() * 6 + 2), msg.length);
      safeSend(ws, { type: 'aiChunk', text: msg.slice(pos, end) });
      pos = end;
      if (pos >= msg.length) {
        clearInterval(timer);
        safeSend(ws, { type: 'done', verdict: 'HOLD', conf: 50 });
      }
    }, 25);
    return;
  }

  // ── Real Groq streaming ─────────────────────────────────────────────────────
  try {
    const stream = await groq.chat.completions.create({
      model:       GROQ_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      stream:      true,
      max_tokens:  700,
      temperature: 0.65,
    });

    let fullText = '';

    for await (const chunk of stream) {
      // Stop streaming if client disconnected
      if (ws.readyState !== ws.OPEN) break;

      const text = chunk.choices[0]?.delta?.content ?? '';
      if (text) {
        fullText += text;
        safeSend(ws, { type: 'aiChunk', text });
      }
    }

    // Parse VERDICT / CONF from the final AI response
    const verdictMatch = fullText.match(/VERDICT:\s*(BUY|HOLD|SELL)/i);
    const confMatch    = fullText.match(/CONF(?:IDENCE)?:\s*(\d+)/i);

    safeSend(ws, {
      type:    'done',
      verdict: verdictMatch?.[1]?.toUpperCase() ?? null,
      conf:    confMatch ? parseInt(confMatch[1], 10) : null,
    });

  } catch (err) {
    console.error('[groq] streaming error:', err.message);
    safeSend(ws, {
      type:        'error',
      limitedData: true,
      message:     `AI 分析服務暫時異常（${err.message.slice(0, 80)}），請稍後再試。`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP SERVER  (health check + WebSocket upgrade)
// ─────────────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status:      'ok',
      connections: wss.clients.size,
      groq:        !!groq,
      model:       GROQ_MODEL,
      ts:          Date.now(),
    }));
  }
  res.writeHead(404);
  res.end('Not found');
});

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET SERVER
// ─────────────────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server,
  verifyClient: () => true,  // allow all origins (GitHub Pages + localhost)
});

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown')
    .toString().split(',')[0].trim();
  console.log(`[+] connect   ip=${ip}  total=${wss.clients.size}`);

  // Keep-alive ping every 30s (Render closes idle WS after ~55s)
  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30_000);

  ws.on('pong', () => {}); // connection confirmed alive

  // ── Incoming message handler ──────────────────────────────────────────────
  ws.on('message', async (raw) => {
    // 1. Parse JSON
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return safeSend(ws, { type: 'error', message: '請傳送合法的 JSON 格式。' });
    }

    // 2. Validate action
    if (msg.action !== 'requestAnalysis') {
      return safeSend(ws, { type: 'error', message: `未知的 action: "${msg.action}"` });
    }

    const rawSym   = String(msg.symbol ?? '').trim();
    const yahooSym = toYahooSymbol(rawSym);

    if (!rawSym) {
      return safeSend(ws, { type: 'error', message: '請提供股票代號，例如 2330 或 AAPL。' });
    }

    console.log(`[~] analyse   input="${rawSym}"  yahoo="${yahooSym}"  groq=${!!groq}`);

    // 3. Parallel fetch: quote + history
    let quote, candles;
    try {
      [quote, candles] = await Promise.all([
        fetchQuote(yahooSym),
        fetchHistory(yahooSym),
      ]);
    } catch (err) {
      console.error(`[yahoo] ${yahooSym}: ${err.message}`);
      return safeSend(ws, {
        type:        'error',
        limitedData: true,
        message:     err.message,
      });
    }

    // 4. Build and push stock snapshot immediately
    const stockData = buildStockPayload(rawSym, yahooSym, quote, candles);
    safeSend(ws, { type: 'stockData', data: stockData });

    // 5. Build prompt from real data and stream AI analysis
    const prompt = buildPrompt(stockData, yahooSym);
    await streamAnalysis(prompt, ws);
  });

  ws.on('close', (code) => {
    clearInterval(pingTimer);
    console.log(`[-] disconnect ip=${ip}  code=${code}  total=${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[!] ws error  ip=${ip}  ${err.message}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║  StockAI Backend  ──  Real Data Mode                     ║
╠══════════════════════════════════════════════════════════╣
║  port    ${String(PORT).padEnd(49)}║
║  yahoo   yahoo-finance2 v3  (live quotes + 1-year K-line)║
║  groq    ${(groq ? `${GROQ_MODEL}` : 'MOCK — set GROQ_API_KEY to enable').padEnd(49)}║
╚══════════════════════════════════════════════════════════╝`);
});
