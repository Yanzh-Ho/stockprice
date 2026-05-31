import { useState, useEffect, useRef } from 'react';

const WS_URL = 'wss://stockprice-2ukw.onrender.com';

// ── Types matching backend buildStockPayload exactly ─────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number }

interface LiveStock {
  ticker: string;       // "2330" or "NVDA"
  name: string;
  fullName: string;
  market: 'TW' | 'US';
  sym: string;          // "NT$" or "$"
  price: number;
  change: number;
  pct: number;          // change percent (not changePercent)
  cap: string;          // marketCap formatted string
  pe: string;
  eps: string;
  beta: string;
  vol: string;
  avgVol: string;
  hi52: number;         // not high52w
  lo52: number;         // not low52w
  div: string;          // dividendYield
  sector: string;
  history: Candle[];    // {o,h,l,c,v} not {open,high,low,close,volume}
  verdict: string;
  conf: number;
}

interface WatchItem { symbol: string; name: string; price: number; pct: number; sym: string }

const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: '2330', name: '台積電', price: 875,    pct:  2.10,  sym: 'NT$' },
  { symbol: '2454', name: '聯發科', price: 1180,   pct:  2.79,  sym: 'NT$' },
  { symbol: '2317', name: '鴻海',   price: 182,    pct: -1.35,  sym: 'NT$' },
  { symbol: '2412', name: '中華電', price: 121,    pct:  0.41,  sym: 'NT$' },
  { symbol: 'AAPL', name: '蘋果',   price: 195.3,  pct:  0.50,  sym: '$'   },
  { symbol: 'NVDA', name: '輝達',   price: 920.5,  pct:  3.82,  sym: '$'   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function verdictColor(v: string) {
  if (v === 'BUY')  return 'text-emerald-400';
  if (v === 'SELL') return 'text-red-400';
  return 'text-yellow-400';
}

function verdictBg(v: string) {
  if (v === 'BUY')  return 'bg-emerald-400/10 border-emerald-400/30';
  if (v === 'SELL') return 'bg-red-400/10 border-red-400/30';
  return 'bg-yellow-400/10 border-yellow-400/30';
}

// Format **bold** markdown
function BoldText({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="text-sky-400 font-semibold">{part.slice(2, -2)}</strong>
          : part
      )}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [watchlist, setWatchlist] = useState<WatchItem[]>(DEFAULT_WATCHLIST);
  const [searchQuery, setSearchQuery]     = useState('');
  const [selectedStock, setSelectedStock] = useState<LiveStock | null>(null);
  const [aiText, setAiText]               = useState('');
  const [isConnected, setIsConnected]     = useState(false);
  const [isLoading, setIsLoading]         = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket connection ────────────────────────────────────────────────────
  useEffect(() => {
    let closed = false;

    function connect() {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        // Auto-load first stock on connect
        socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: '2330' }));
        setIsLoading(true);
        setAiText('');
      };

      socket.onmessage = ({ data }) => {
        try {
          const msg = JSON.parse(data) as {
            type: string;
            data?: LiveStock;
            text?: string;
            verdict?: string;
            conf?: number;
          };

          if (msg.type === 'stockData' && msg.data) {
            const s = msg.data;
            setIsLoading(false);
            setSelectedStock(s);

            // Update watchlist price & pct for this ticker
            setWatchlist(prev => prev.map(item =>
              item.symbol.toUpperCase() === s.ticker.toUpperCase()
                ? { ...item, price: s.price, pct: s.pct, sym: s.sym }
                : item
            ));
          }

          if (msg.type === 'aiChunk' && msg.text) {
            setAiText(prev => prev + msg.text);
          }

          if (msg.type === 'done') {
            setIsLoading(false);
          }

          if (msg.type === 'error') {
            setIsLoading(false);
            setAiText(prev => prev + `\n\n⚠️ ${(msg as any).message ?? '發生錯誤'}`);
          }
        } catch { /* ignore parse errors */ }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (!closed) setTimeout(connect, 5000);
      };
      socket.onerror = () => { setIsConnected(false); };
    }

    connect();
    return () => { closed = true; wsRef.current?.close(); };
  }, []);

  // ── Query stock ─────────────────────────────────────────────────────────────
  function queryStock(symbol: string) {
    if (!symbol.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setAiText('');
    setIsLoading(true);
    wsRef.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbol.trim() }));
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    queryStock(searchQuery);
    setSearchQuery('');
  }

  // ── SVG trend line from Candle[] ────────────────────────────────────────────
  function TrendLine({ candles }: { candles: Candle[] }) {
    if (!candles.length) return <div className="text-xs text-slate-600 text-center py-10">暫無 K 線數據</div>;
    const closes = candles.map(c => c.c);
    const min = Math.min(...closes), max = Math.max(...closes);
    const range = max - min || 1;
    const pts = candles.map((c, i) =>
      `${(i / (candles.length - 1)) * 100},${100 - ((c.c - min) / range) * 85 - 7.5}`
    ).join(' ');
    const isUp = closes[closes.length - 1] >= closes[0];
    const color = isUp ? '#10b981' : '#ef4444';
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={`M${pts.split(' ').join('L')} L100,100 L0,100 Z`} fill="url(#tg)" />
        <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={pts} />
      </svg>
    );
  }

  const s = selectedStock;

  return (
    <div className="flex h-screen w-screen bg-[#0B0E14] text-slate-200 overflow-hidden font-sans">

      {/* ── Sidebar Watchlist ─────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 bg-[#0F131A] border-r border-slate-800 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-800">
          <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">Watchlist</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {watchlist.map(item => (
            <button key={item.symbol} onClick={() => queryStock(item.symbol)}
              className={`w-full px-4 py-3 flex justify-between items-center border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors text-left ${s?.ticker === item.symbol ? 'bg-sky-900/20 border-l-2 border-l-sky-500' : ''}`}>
              <div>
                <div className="font-bold text-sm text-white">{item.symbol}</div>
                <div className="text-xs text-slate-500 mt-0.5">{item.name}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-white">{item.sym}{item.price.toLocaleString()}</div>
                <div className={`text-xs font-medium ${item.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {item.pct >= 0 ? '+' : ''}{item.pct.toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="h-14 flex-shrink-0 bg-[#0F131A] border-b border-slate-800 flex items-center px-5 gap-4">
          <form onSubmit={onSearchSubmit} className="flex-1 max-w-lg">
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 text-sm">⌕</span>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="輸入股票代號… 2330、AAPL、NVDA"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors" />
            </div>
          </form>
          <div className="flex items-center gap-2 text-xs text-slate-400 ml-auto">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {isConnected ? '已連線後端' : '重連中…'}
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && !s ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
              <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">正在向 Yahoo Finance 調閱即時數據…</span>
            </div>
          ) : !s ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-600">
              <span className="text-4xl">📈</span>
              <p className="text-sm">從左側選擇一檔股票，或在上方搜尋代號</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-5">

              {/* ── Left+Center: chart & AI ─────────────────────────── */}
              <div className="col-span-2 space-y-5">

                {/* Price header */}
                <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-black text-white tracking-tight">{s.ticker}</h1>
                        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-medium">{s.name}</span>
                        <span className={`text-xs border px-2 py-0.5 rounded font-bold ${s.market === 'TW' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' : 'text-sky-400 border-sky-400/30 bg-sky-400/10'}`}>
                          {s.market === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{s.fullName} · {s.sector}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-black text-white">{s.sym}{s.price.toLocaleString()}</div>
                      <div className={`text-sm font-semibold mt-0.5 ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {s.change >= 0 ? '▲' : '▼'} {s.sym}{Math.abs(s.change).toFixed(2)} ({s.pct >= 0 ? '+' : ''}{s.pct.toFixed(2)}%)
                      </div>
                      {s.verdict && (
                        <span className={`inline-block mt-2 text-xs font-bold border px-2.5 py-1 rounded ${verdictBg(s.verdict)} ${verdictColor(s.verdict)}`}>
                          ● {s.verdict}  {s.conf}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Trend chart */}
                  <div className="h-52 mt-5 border-t border-slate-800 pt-4">
                    {isLoading
                      ? <div className="h-full flex items-center justify-center"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
                      : <TrendLine candles={s.history} />
                    }
                  </div>
                  <div className="flex justify-between text-xs text-slate-600 mt-1">
                    <span>1 年前</span>
                    <span className="text-slate-500">Yahoo Finance 日線 · {s.history.length} 根</span>
                    <span>今日</span>
                  </div>
                </div>

                {/* AI Analysis */}
                <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                  <h3 className="text-xs font-bold text-sky-400 uppercase tracking-widest mb-3">
                    🤖 Groq {'{'}llama3-8b-8192{'}'} 即時 AI 分析
                  </h3>
                  <div className="bg-slate-900/60 rounded-lg border border-slate-700 p-4 text-sm leading-relaxed min-h-[140px] whitespace-pre-wrap text-slate-300">
                    {aiText
                      ? aiText.split('\n').map((line, i) => (
                          <div key={i} className={line ? '' : 'h-3'}>
                            {line && <BoldText text={line} />}
                          </div>
                        ))
                      : <span className="text-slate-600 italic">等待 AI 分析結果串流…</span>
                    }
                    {isLoading && aiText && (
                      <span className="inline-block w-0.5 h-4 bg-sky-400 align-middle animate-pulse ml-0.5" />
                    )}
                  </div>
                </div>
              </div>

              {/* ── Right: fundamentals ─────────────────────────────── */}
              <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">關鍵指標</h3>
                <div className="space-y-3">
                  {[
                    ['市值',         s.cap],
                    ['本益比 (PE)',   s.pe],
                    ['每股盈餘',      s.eps],
                    ['Beta 值',       s.beta],
                    ['成交量',        s.vol],
                    ['均量',          s.avgVol],
                    ['52週高點',      `${s.sym}${s.hi52.toLocaleString()}`],
                    ['52週低點',      `${s.sym}${s.lo52.toLocaleString()}`],
                    ['現金殖利率',    s.div],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center border-b border-slate-800 pb-2 text-sm">
                      <span className="text-slate-500">{label}</span>
                      <span className="font-semibold text-white">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Target prices */}
                {s.verdict && (
                  <div className="mt-5 pt-4 border-t border-slate-800">
                    <div className="text-xs text-slate-500 uppercase tracking-widest mb-3">AI 目標價（12M）</div>
                    <div className={`text-center text-xl font-black ${verdictColor(s.verdict)} mb-1`}>
                      {s.verdict}
                    </div>
                    <div className="text-center text-xs text-slate-500">
                      信心指數 <span className={`font-bold ${verdictColor(s.verdict)}`}>{s.conf}%</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
