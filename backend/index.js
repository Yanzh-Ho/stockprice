'use strict';
require('dotenv').config();

const http = require('http');
const { WebSocketServer } = require('ws');

// yahoo-finance2 v3: requires instantiation
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  validation: { logErrors: false, logOptionsErrors: false },
});

// groq-sdk
const Groq = require('groq-sdk');

const PORT       = process.env.PORT        || 8080;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL  || 'llama-3.3-70b-versatile';

// Init Groq client (null when no key → mock mode)
const groq = GROQ_KEY ? new Groq({ apiKey: GROQ_KEY }) : null;

// ── Symbol helpers ────────────────────────────────────────────────────────────

// "2330" → "2330.TW"  |  "AAPL" → "AAPL"  |  "2330.TW" → "2330.TW"
function toYahooSymbol(raw) {
  const s = raw.trim().toUpperCase();
  if (/^\d{4}$/.test(s))         return `${s}.TW`;
  if (/^\d{4,6}\.(TW|TWO)$/.test(s)) return s;
  return s;
}

function isTW(sym) { return /\.(TW|TWO)$/i.test(sym); }

// ── Number formatters ─────────────────────────────────────────────────────────

function fmtCap(n, tw) {
  if (!n) return '—';
  if (tw) {
    if (n >= 1e12) return `${(n / 1e12).toFixed(1)} 兆元`;
    if (n >= 1e8)  return `${Math.round(n / 1e8).toLocaleString()} 億元`;
    return `${Math.round(n / 1e6).toLocaleString()} 百萬元`;
  }
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

function fmtVol(n, tw) {
  if (!n) return '—';
  if (tw) {
    const lots = n / 1000;
    return lots >= 10000
      ? `${(lots / 10000).toFixed(1)}萬張`
      : `${Math.round(lots).toLocaleString()}張`;
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function r2(n) { return n != null ? +n.toFixed(2) : 0; }

// ── Yahoo Finance – quote ─────────────────────────────────────────────────────

async function fetchQuote(yahooSym) {
  const q = await yahooFinance.quote(yahooSym, {}, { validateResult: false });
  if (!q || !q.regularMarketPrice) {
    throw new Error(`找不到「${yahooSym}」的報價，請確認股票代號。`);
  }
  return q;
}

// ── Yahoo Finance – 1-year daily K-line ───────────────────────────────────────

async function fetchHistory(yahooSym) {
  try {
    const end   = new Date();
    const start = new Date(end);
    start.setFullYear(start.getFullYear() - 1);

    const rows = await yahooFinance.historical(
      yahooSym,
      { period1: start, period2: end, interval: '1d' },
      { validateResult: false }
    );

    return (rows ?? [])
      .filter(r => r.close != null)
      .map(r => ({
        o: r2(r.open  ?? r.close),
        h: r2(r.high  ?? r.close),
        l: r2(r.low   ?? r.close),
        c: r2(r.close),
        v: r.volume ?? 0,
      }));
  } catch (err) {
    console.warn(`[yahoo] history error for ${yahooSym}: ${err.message}`);
    return [];   // history is optional — continue without it
  }
}

// ── Data builder ──────────────────────────────────────────────────────────────

function buildStockData(rawSym, yahooSym, q, candles) {
  const tw  = isTW(yahooSym);
  const sym = tw ? 'NT$' : '$';

  const price  = q.regularMarketPrice ?? 0;
  const change = r2(q.regularMarketChange ?? 0);
  const pct    = r2(q.regularMarketChangePercent ?? 0);

  return {
    ticker:   rawSym.toUpperCase(),
    name:     q.shortName ?? q.longName ?? rawSym,
    fullName: q.longName  ?? q.shortName ?? rawSym,
    market:   tw ? 'TW' : 'US',
    currency: tw ? 'TWD' : 'USD',
    sym,
    price,
    change,
    pct,
    cap:    fmtCap(q.marketCap, tw),
    pe:     q.trailingPE  ? `${q.trailingPE.toFixed(1)}倍`          : '—',
    eps:    q.trailingEps ? `${sym}${q.trailingEps.toFixed(2)}`      : '—',
    beta:   q.beta        ? q.beta.toFixed(2)                        : '—',
    vol:    fmtVol(q.regularMarketVolume, tw),
    avgVol: fmtVol(q.averageDailyVolume3Month, tw),
    hi52:   r2(q.fiftyTwoWeekHigh ?? price),
    lo52:   r2(q.fiftyTwoWeekLow  ?? price),
    div:    q.trailingAnnualDividendYield
              ? `${(q.trailingAnnualDividendYield * 100).toFixed(2)}%`
              : '—',
    sector:  q.sector ?? q.industryDisp ?? '—',
    history: candles,
    // Placeholders; AI will fill in the meaningful ones via text
    verdict: 'HOLD', conf: 50,
    target: {
      lo:  r2(price * 0.88),
      mid: r2(price * 1.05),
      hi:  r2(price * 1.15),
    },
    risks: [], sentimentScore: 50, sentimentLabel: '分析中',
    analysts: { buy: 0, hold: 0, sell: 0 },
    summary: '', tags: [], news: [],
  };
}

// ── Groq prompt ───────────────────────────────────────────────────────────────

function buildPrompt(d, yahooSym) {
  const { ticker, fullName, market, sym, price, change, pct,
          pe, cap, div, beta, hi52, lo52, vol, history } = d;

  let trend = '';
  if (history.length >= 20) {
    const sl  = history.slice(-20);
    const t   = ((sl.at(-1).c - sl[0].c) / sl[0].c * 100).toFixed(1);
    trend = `近 20 日漲跌幅：${Number(t) >= 0 ? '+' : ''}${t}%`;
  }

  const ps = pct    >= 0 ? '+' : '';
  const cs = change >= 0 ? '+' : '';

  return `你是一位專業的股票分析師，精通台股（TWSE）與美股（NASDAQ/NYSE）投資分析。
請根據以下**真實即時市場數據**，用繁體中文撰寫一份結構清晰的投資分析報告。

【股票資訊】
代號：${ticker}（Yahoo Finance: ${yahooSym}）
公司：${fullName}
市場：${market === 'TW' ? '台灣股市（TWSE）' : '美國股市'}

【即時行情】
目前股價：${sym}${price.toLocaleString()}
今日漲跌：${cs}${sym}${Math.abs(change).toFixed(2)}（${ps}${pct.toFixed(2)}%）
52週高／低：${sym}${hi52.toLocaleString()} ／ ${sym}${lo52.toLocaleString()}
${trend}

【基本面指標】
本益比（TTM）：${pe}
市值：${cap}
現金殖利率：${div}
Beta：${beta}
今日成交量：${vol}

【分析報告格式】
請依序輸出以下段落，使用 **粗體** 標示重點：
1. **核心評語** — 一句話說明建議（BUY / HOLD / SELL）及最關鍵理由
2. **基本面分析** — 2~3 個投資亮點或隱憂
3. **技術面觀察** — 近期趨勢方向、關鍵支撐位與壓力位
4. **主要風險** — 條列 2~3 個風險因子
5. **目標價** — 給出 12 個月低/中/高三個價位

報告末尾必須獨立一行輸出（供程式解析，格式固定不變）：
VERDICT: BUY|HOLD|SELL  CONF: 0-100`;
}

// ── Groq streaming ────────────────────────────────────────────────────────────

async function streamGroq(prompt, ws) {
  if (!groq) return streamMock(ws);

  try {
    const stream = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 700,
      temperature: 0.65,
    });

    let full = '';
    for await (const chunk of stream) {
      if (ws.readyState !== ws.OPEN) break;
      const text = chunk.choices[0]?.delta?.content ?? '';
      if (text) {
        full += text;
        safeSend(ws, { type: 'aiChunk', text });
      }
    }

    // Parse VERDICT / CONF for the frontend to use in future enhancements
    const vm = full.match(/VERDICT:\s*(BUY|HOLD|SELL)/i);
    const cm = full.match(/CONF(?:IDENCE)?:\s*(\d+)/i);
    safeSend(ws, {
      type:    'done',
      verdict: vm?.[1]?.toUpperCase() ?? null,
      conf:    cm ? parseInt(cm[1], 10) : null,
    });
  } catch (err) {
    console.error('[groq] stream error:', err.message);
    safeSend(ws, {
      type: 'error',
      limitedData: true,
      message: `AI 分析服務暫時不可用：${err.message}`,
    });
  }
}

// ── Mock fallback (no GROQ_KEY) ───────────────────────────────────────────────

function streamMock(ws) {
  const text =
    '**AI 分析（Mock 模式）**\n\n' +
    '✅ Yahoo Finance 真實股票數據已成功取得並回傳。\n\n' +
    'AI 串流功能目前處於 Mock 模式，因為尚未設定 `GROQ_API_KEY`。\n\n' +
    '請在 Render 後台的 **Environment Variables** 中加入：\n' +
    '`GROQ_API_KEY = gsk_xxxxxxxxxxxx`\n\n' +
    '設定後重新部署即可啟用真實 AI 分析串流。\n\n' +
    'VERDICT: HOLD  CONF: 50';

  let pos = 0;
  const t = setInterval(() => {
    if (ws.readyState !== ws.OPEN) { clearInterval(t); return; }
    const end = Math.min(pos + Math.ceil(Math.random() * 5 + 1), text.length);
    safeSend(ws, { type: 'aiChunk', text: text.slice(pos, end) });
    pos = end;
    if (pos >= text.length) {
      clearInterval(t);
      safeSend(ws, { type: 'done', verdict: 'HOLD', conf: 50 });
    }
  }, 28);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// ── HTTP (health check + WS upgrade) ─────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      connections: wss.clients.size,
      groq: !!groq,
      ts: Date.now(),
    }));
  }
  res.writeHead(404);
  res.end();
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, verifyClient: () => true });

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown')
    .toString().split(',')[0].trim();
  console.log(`[+] connect   ip=${ip}  total=${wss.clients.size}`);

  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30_000);

  ws.on('pong', () => {});

  ws.on('message', async (raw) => {
    // ── Parse incoming message ──────────────────────────────────────────────
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return safeSend(ws, { type: 'error', message: '請傳送合法的 JSON。' }); }

    if (msg.action !== 'requestAnalysis') {
      return safeSend(ws, { type: 'error', message: `未知的 action: "${msg.action}"` });
    }

    const rawSym   = String(msg.symbol ?? '').trim();
    const yahooSym = toYahooSymbol(rawSym);

    if (!rawSym) return safeSend(ws, { type: 'error', message: '請提供股票代號。' });

    console.log(`[~] analyse   input=${rawSym}  yahoo=${yahooSym}  groq=${!!groq}`);

    // ── Step 1: fetch real quote + history (parallel) ───────────────────────
    let stockData;
    try {
      const [quote, candles] = await Promise.all([
        fetchQuote(yahooSym),
        fetchHistory(yahooSym),
      ]);
      stockData = buildStockData(rawSym, yahooSym, quote, candles);
    } catch (err) {
      console.error(`[yahoo] ${yahooSym}:`, err.message);
      return safeSend(ws, {
        type: 'error',
        limitedData: true,
        message: err.message,
      });
    }

    // ── Step 2: push stock snapshot ─────────────────────────────────────────
    safeSend(ws, { type: 'stockData', data: stockData });

    // ── Step 3: stream AI analysis ──────────────────────────────────────────
    const prompt = buildPrompt(stockData, yahooSym);
    await streamGroq(prompt, ws);
  });

  ws.on('close', (code) => {
    clearInterval(pingTimer);
    console.log(`[-] disconnect ip=${ip}  code=${code}  total=${wss.clients.size}`);
  });

  ws.on('error', (err) => console.error(`[!] ws error ip=${ip}`, err.message));
});

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║  StockAI Backend v2  ——  Real Data Mode              ║
║  port   : ${String(PORT).padEnd(43)}║
║  yahoo  : yahoo-finance2 (live quotes + K-line)      ║
║  groq   : ${(GROQ_KEY ? `${GROQ_MODEL}` : 'MOCK MODE — set GROQ_API_KEY to enable').padEnd(43)}║
╚══════════════════════════════════════════════════════╝`);
});
