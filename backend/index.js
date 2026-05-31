'use strict';
require('dotenv').config();

const http  = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');

const PORT       = process.env.PORT || 8080;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// ── Mock stock data (Phase 0: no yfinance yet) ────────────────────────────────
// Future: replace each entry with a live yfinance fetch inside requestAnalysis

const MOCK_STOCKS = {
  '2330': { symbol:'2330', name:'台積電',   market:'TW', sym:'NT$', price:875,    change:18.00,  pct:2.10,  verdict:'BUY',  conf:84, pe:'27.4倍', cap:'22.7 兆元',  div:'2.10%' },
  '2454': { symbol:'2454', name:'聯發科',   market:'TW', sym:'NT$', price:1180,   change:32.00,  pct:2.79,  verdict:'BUY',  conf:76, pe:'19.8倍', cap:'1.89 兆元',  div:'3.50%' },
  '2317': { symbol:'2317', name:'鴻海',     market:'TW', sym:'NT$', price:182,    change:-2.50,  pct:-1.35, verdict:'HOLD', conf:63, pe:'11.2倍', cap:'2.53 兆元',  div:'4.30%' },
  '2412': { symbol:'2412', name:'中華電',   market:'TW', sym:'NT$', price:121,    change:0.50,   pct:0.41,  verdict:'HOLD', conf:60, pe:'25.3倍', cap:'9,420 億元', div:'4.85%' },
  '2882': { symbol:'2882', name:'國泰金',   market:'TW', sym:'NT$', price:62,     change:0.80,   pct:1.31,  verdict:'HOLD', conf:58, pe:'14.5倍', cap:'1.02 兆元',  div:'4.20%' },
  'TSM':  { symbol:'TSM',  name:'台積電ADR',market:'US', sym:'$',   price:185.40, change:4.18,   pct:2.31,  verdict:'BUY',  conf:78, pe:'24.8倍', cap:'9,583億美元',div:'1.85%' },
  'TSLA': { symbol:'TSLA', name:'特斯拉',   market:'US', sym:'$',   price:248.70, change:-3.05,  pct:-1.21, verdict:'HOLD', conf:62, pe:'62.4倍', cap:'7,934億美元',div:'—'     },
  'NVDA': { symbol:'NVDA', name:'輝達',     market:'US', sym:'$',   price:920.50, change:33.88,  pct:3.82,  verdict:'BUY',  conf:85, pe:'68.2倍', cap:'2.27兆美元', div:'0.04%' },
  'AAPL': { symbol:'AAPL', name:'蘋果',     market:'US', sym:'$',   price:195.30, change:0.97,   pct:0.50,  verdict:'HOLD', conf:71, pe:'32.1倍', cap:'3.01兆美元', div:'0.52%' },
  'MSFT': { symbol:'MSFT', name:'微軟',     market:'US', sym:'$',   price:412.80, change:6.21,   pct:1.53,  verdict:'BUY',  conf:80, pe:'35.8倍', cap:'3.07兆美元', div:'0.74%' },
};

// ── Mock AI fallback (used when GROQ_API_KEY is absent) ───────────────────────

const MOCK_AI_TEXT = {
  '2330': '**台積電（2330）— 買進 · 信心指數 84%**\n\n台積電掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈的核心骨幹。外資持續買超，3 奈米製程放量帶動 EPS 上修；2 奈米製程 2025 年底試產，有望推動下一波估值擴張。\n\n**目標價：** NT$970（較現價上漲 10.9%）\n**主要風險：** 台灣海峽地緣政治局勢\n\n建議作為台股核心持股，長期持有。',
  '2454': '**聯發科（2454）— 買進 · 信心指數 76%**\n\n天璣 9400 成功打入三星旗艦機，AI 手機晶片市佔率快速提升。現金殖利率達 3.5%，估值相對輝達等美股 AI 股票合理。\n\n**目標價：** NT$1,320（較現價上漲 11.9%）\n**主要風險：** 中國客戶佔比偏高（約 55%）',
  '2317': '**鴻海（2317）— 持有 · 信心指數 63%**\n\n殖利率超過 4% 支撐股價下檔，電動車（MIH 平台）新業務仍在燒錢階段，短期難以顯著貢獻獲利。\n\n**目標價：** NT$200（較現價上漲 9.9%）\n**建議：** 等待電動車業務明確轉虧為盈訊號，或回測 NT$165 以下再加碼。',
  '2412': '**中華電（2412）— 持有 · 信心指數 60%**\n\n股息穩定，殖利率近 5%，是台股「存股」首選之一。但 5G 投資回收期漫長，成長性有限。\n\n**目標價：** NT$128（較現價上漲 5.8%）\n**適合：** 低風險、重視現金流的長期投資人',
  '2882': '**國泰金（2882）— 持有 · 信心指數 58%**\n\n台灣最大金控，對利率與台幣匯率高度敏感。Fed 降息周期若確立，壽險資產評價有望改善。殖利率約 4.2%。\n\n**目標價：** NT$68（較現價上漲 9.7%）\n**主要風險：** 台幣升值壓縮海外投資收益',
  'TSM':  '**台積電 ADR（TSM）— 買進 · 信心指數 78%**\n\nAI 晶片供應鏈核心，輝達與蘋果訂單能見度延伸至 2026 年。3 奈米製程放量推動均售價上升。\n\n**目標價：** $205（較現價上漲 10.6%）\n**主要風險：** 台灣海峽地緣政治局勢',
  'TSLA': '**特斯拉（TSLA）— 持有 · 信心指數 62%**\n\n比亞迪競爭加劇、毛利縮減，62 倍本益比已充分反映 Robotaxi 與 Optimus 的潛力溢價。\n\n**目標價：** $255（較現價上漲 2.5%）\n**建議：** 等待 $200–$220 的更佳進場點，或等待 FSD 明確催化劑。',
  'NVDA': '**輝達（NVDA）— 強力買進 · 信心指數 85%**\n\nBlackwell（B200）量產啟動，資料中心營收年增逾 400%。CUDA 生態系形成極高轉換成本壁壘，AMD 至今無法突破。\n\n**目標價：** $1,050（較現價上漲 14%）\n**注意：** 68 倍本益比容錯空間有限，請依風險承受度控制倉位。',
  'AAPL': '**蘋果（AAPL）— 持有 · 信心指數 71%**\n\n服務業務年化規模約 1,000 億美元，獲利高度可預測。Apple Intelligence 有望在 2025 年下半年催化下一波 iPhone 換機潮。\n\n**目標價：** $220（較現價上漲 12.6%）\n**主要風險：** 中國市場營收敞口（約佔總營收 18%）',
  'MSFT': '**微軟（MSFT）— 買進 · 信心指數 80%**\n\nAzure 再加速成長至 29%，Copilot 席次滲透率持續提升。企業分發護城河（Office、Azure、Teams）無可匹敵。\n\n**目標價：** $480（較現價上漲 16%）\n**催化劑：** Azure OpenAI 滲透與 Copilot 席次擴張',
};

// ── Utility: safe send ────────────────────────────────────────────────────────

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Groq streaming (real AI, requires GROQ_API_KEY) ───────────────────────────

function streamGroqAnalysis(symbol, stock, ws) {
  const body = JSON.stringify({
    model: GROQ_MODEL,
    stream: true,
    max_tokens: 512,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: '你是一位專業的股票分析師，擅長基本面、技術面與市場情緒分析。回覆使用繁體中文，格式清晰，善用 **粗體** 標示重要資訊。回覆長度適中（200-350字），依序包含：整體評價、核心論述、目標價區間、主要風險。',
      },
      {
        role: 'user',
        content: `請分析以下股票並給出投資建議：\n股票代號：${symbol}\n公司名稱：${stock.name}\n目前股價：${stock.sym}${stock.price}\n今日漲跌：${stock.pct > 0 ? '+' : ''}${stock.pct}%（${stock.change > 0 ? '+' : ''}${stock.sym}${stock.change}）\n本益比：${stock.pe}\n市值：${stock.cap}\n殖利率：${stock.div}\nAI 信心指數：${stock.conf}%\n目前建議：${stock.verdict}`,
      },
    ],
  });

  const req = https.request(
    {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      // Non-200 means auth error / rate limit — fall back to mock
      if (res.statusCode !== 200) {
        console.warn(`[groq] HTTP ${res.statusCode} for ${symbol}, falling back to mock`);
        res.resume();
        return streamMockAnalysis(symbol, ws);
      }

      let buf = '';

      res.on('data', (chunk) => {
        buf += chunk.toString();
        // SSE lines may be split across TCP segments; buffer and process line by line
        const lines = buf.split('\n');
        buf = lines.pop(); // last element may be incomplete

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const delta = JSON.parse(trimmed.slice(6))?.choices?.[0]?.delta?.content;
            if (delta) safeSend(ws, { type: 'aiChunk', text: delta });
          } catch (_) {
            // malformed SSE chunk — skip silently
          }
        }
      });

      res.on('end', () => safeSend(ws, { type: 'done' }));
    }
  );

  req.on('error', (err) => {
    console.error('[groq request error]', err.message);
    safeSend(ws, { type: 'error', limitedData: true, message: '無法連線至 AI 服務，已切換至離線分析模式。' });
    streamMockAnalysis(symbol, ws);
  });

  req.setTimeout(15_000, () => {
    req.destroy();
    console.warn(`[groq] timeout for ${symbol}`);
    safeSend(ws, { type: 'error', limitedData: true, message: 'AI 回應逾時，已切換至離線分析模式。' });
    streamMockAnalysis(symbol, ws);
  });

  req.write(body);
  req.end();
}

// ── Mock streaming fallback ───────────────────────────────────────────────────

function streamMockAnalysis(symbol, ws) {
  const text = MOCK_AI_TEXT[symbol]
    ?? `目前尚無 **${symbol}** 的詳細分析資料，請確認股票代號後重試。\n\n支援的代號：2330、2454、2317、2412、2882、TSM、NVDA、AAPL、TSLA、MSFT`;

  let pos = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) { clearInterval(timer); return; }
    const end = Math.min(pos + Math.ceil(Math.random() * 5 + 1), text.length);
    safeSend(ws, { type: 'aiChunk', text: text.slice(pos, end) });
    pos = end;
    if (pos >= text.length) {
      clearInterval(timer);
      safeSend(ws, { type: 'done' });
    }
  }, 28);
}

// ── HTTP server (Render health check + WebSocket upgrade) ─────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', connections: wss.clients.size, ts: Date.now() }));
  }
  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server,
  verifyClient: () => true, // allow all origins (GitHub Pages + localhost)
});

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown')
    .toString().split(',')[0].trim();
  console.log(`[+] connect   ip=${ip}  total=${wss.clients.size}`);

  // Keep-alive: Render will close idle connections after 55s
  const pingTimer = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30_000);

  ws.on('pong', () => {}); // connection is alive

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return safeSend(ws, { type: 'error', message: '無法解析請求，請傳送合法的 JSON。' });
    }

    if (msg.action !== 'requestAnalysis') {
      return safeSend(ws, { type: 'error', message: `未知的 action: "${msg.action}"` });
    }

    // Normalise: Taiwan codes are numeric strings, US are alpha
    const raw_symbol = String(msg.symbol ?? '').trim();
    const symbol     = /^\d+$/.test(raw_symbol) ? raw_symbol : raw_symbol.toUpperCase();
    const stock      = MOCK_STOCKS[symbol];

    if (!stock) {
      return safeSend(ws, {
        type: 'error',
        limitedData: true,
        message: `找不到「${symbol}」，支援代號：2330、2454、2317、2412、2882、TSM、NVDA、AAPL、TSLA、MSFT`,
      });
    }

    console.log(`[~] analyse   symbol=${symbol}  mode=${GROQ_KEY ? 'groq' : 'mock'}`);

    // ① 立即推送股價快照
    safeSend(ws, { type: 'stockData', data: stock });

    // ② 串流 AI 分析（有金鑰走真實 Groq，否則用 Mock）
    if (GROQ_KEY) {
      streamGroqAnalysis(symbol, stock, ws);
    } else {
      streamMockAnalysis(symbol, ws);
    }
  });

  ws.on('close', (code, reason) => {
    clearInterval(pingTimer);
    console.log(`[-] disconnect ip=${ip}  code=${code}  total=${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[!] ws error  ip=${ip}  ${err.message}`);
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────────┐
│  StockAI Backend                        │
│  port  : ${String(PORT).padEnd(31)}│
│  groq  : ${(GROQ_KEY ? `enabled (${GROQ_MODEL})` : 'mock mode (no GROQ_API_KEY)').padEnd(31)}│
└─────────────────────────────────────────┘`);
});
