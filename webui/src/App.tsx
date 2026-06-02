import { useState, useEffect, useRef } from 'react';

const WS_URL = 'wss://stockprice-2ukw.onrender.com';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number }

interface LiveStock {
  ticker: string;
  name: string;
  fullName: string;
  market: 'TW' | 'US';
  sym: string;
  price: number;
  change: number;
  pct: number;
  cap: string;
  pe: string;
  eps: string;
  beta: string;
  vol: string;
  avgVol: string;
  hi52: number;
  lo52: number;
  div: string;
  sector: string;
  history: Candle[];
  verdict: string;
  conf: number;
  target?: { lo: number; mid: number; hi: number };
}

interface WatchItem {
  symbol: string;
  name: string;
  price: number;
  pct: number;
  sym: string;
  isLive?: boolean;
}

type Tab = 'dashboard' | 'news' | 'settings';

const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: '2330', name: '台積電', price: 875,   pct:  2.10, sym: 'NT$' },
  { symbol: '2454', name: '聯發科', price: 1180,  pct:  2.79, sym: 'NT$' },
  { symbol: '2317', name: '鴻海',   price: 182,   pct: -1.35, sym: 'NT$' },
  { symbol: '2412', name: '中華電', price: 121,   pct:  0.41, sym: 'NT$' },
  { symbol: 'AAPL', name: '蘋果',   price: 195.3, pct:  0.50, sym: '$'   },
  { symbol: 'NVDA', name: '輝達',   price: 920.5, pct:  3.82, sym: '$'   },
];

const MOCK_NEWS = [
  { id: 1, time: '10:32', title: 'Fed 維持利率不變，市場反應平淡，等待下次會議指引', source: 'Reuters', category: 'macro', impact: 'neutral', url: 'https://www.reuters.com/markets/us/fed-holds-rates-steady/' },
  { id: 2, time: '09:45', title: '台積電 Q2 法說會：CoWoS 產能滿載，下半年營收持續看好', source: 'Economic Daily', category: 'TW', impact: 'positive', url: 'https://money.udn.com/money/cate/5607' },
  { id: 3, time: '09:12', title: 'NVIDIA 下一代 Blackwell 晶片需求超預期，台系供應鏈全面受惠', source: 'DigiTimes', category: 'tech', impact: 'positive', url: 'https://www.digitimes.com.tw/tech/dt/n/shwnws.asp?cnlid=13' },
  { id: 4, time: '08:55', title: '美股三大指數開盤走跌，科技股估值承壓', source: 'Bloomberg', category: 'US', impact: 'negative', url: 'https://www.bloomberg.com/markets' },
  { id: 5, time: '08:30', title: '中國出口數據不如預期，製造業 PMI 連三月下滑', source: 'NBS', category: 'macro', impact: 'negative', url: 'https://tw.stock.yahoo.com/international-markets' },
  { id: 6, time: '07:50', title: '聯發科推出天璣 9400+，AI 手機新周期正式啟動', source: 'TechNews', category: 'TW', impact: 'positive', url: 'https://technews.tw/category/chip/' },
  { id: 7, time: '07:15', title: '鴻海與 NVIDIA 深化 AI 伺服器合作，黑熊超算正式落地', source: 'CTimes', category: 'TW', impact: 'positive', url: 'https://www.ctimes.com.tw/DispNews/2024/AI' },
  { id: 8, time: '06:30', title: 'Apple WWDC 2025：Apple Intelligence 全面整合，iPhone 需求復甦訊號', source: 'MacRumors', category: 'tech', impact: 'positive', url: 'https://www.macrumors.com/' },
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

function TrendLine({ candles }: { candles: Candle[] }) {
  if (!candles.length) return (
    <div className="text-xs text-slate-600 text-center py-10">暫無 K 線數據</div>
  );
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

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors ${value ? 'bg-sky-500' : 'bg-slate-700'}`}>
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab]           = useState<Tab>('dashboard');
  const [watchlist, setWatchlist]           = useState<WatchItem[]>(DEFAULT_WATCHLIST);
  const [searchQuery, setSearchQuery]       = useState('');
  const [selectedStock, setSelectedStock]   = useState<LiveStock | null>(null);
  const [aiText, setAiText]                 = useState('');
  const [isConnected, setIsConnected]       = useState(false);
  const [isLoading, setIsLoading]           = useState(false);
  const [liveVerdict, setLiveVerdict]       = useState('');
  const [liveConf, setLiveConf]             = useState(0);

  // Settings state
  const [riskLevel, setRiskLevel]           = useState(50);
  const [priceAlerts, setPriceAlerts]       = useState(true);
  const [aiSignalOpt, setAiSignalOpt]       = useState(true);
  const [darkMode, setDarkMode]             = useState(true);

  const wsRef = useRef<WebSocket | null>(null);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let closed = false;

    function connect() {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
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
            message?: string;
          };

          if (msg.type === 'stockData' && msg.data) {
            const s = msg.data;
            setIsLoading(false);
            setSelectedStock(s);
            setLiveVerdict('');
            setLiveConf(0);
            setWatchlist(prev => prev.map(item =>
              item.symbol.toUpperCase() === s.ticker.toUpperCase()
                ? { ...item, price: s.price, pct: s.pct, sym: s.sym, isLive: true }
                : item
            ));
          }

          if (msg.type === 'aiChunk' && msg.text) {
            setAiText(prev => prev + msg.text);
          }

          if (msg.type === 'done') {
            setIsLoading(false);
            if (msg.verdict) setLiveVerdict(msg.verdict);
            if (msg.conf != null) setLiveConf(msg.conf);
          }

          if (msg.type === 'error') {
            setIsLoading(false);
            setAiText(prev => prev + `\n\n⚠️ ${msg.message ?? '發生錯誤'}`);
          }
        } catch { /* ignore */ }
      };

      socket.onclose  = () => { setIsConnected(false); if (!closed) setTimeout(connect, 5000); };
      socket.onerror  = () => { setIsConnected(false); };
    }

    connect();
    return () => { closed = true; wsRef.current?.close(); };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────
  function queryStock(symbol: string) {
    if (!symbol.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setAiText('');
    setLiveVerdict('');
    setLiveConf(0);
    setIsLoading(true);
    setActiveTab('dashboard');
    wsRef.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbol.trim() }));
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) { queryStock(searchQuery.trim()); setSearchQuery(''); }
  }

  function toggleWatchlist(ticker: string) {
    const upper = ticker.toUpperCase();
    const inList = watchlist.some(w => w.symbol.toUpperCase() === upper);
    if (inList) {
      setWatchlist(prev => prev.filter(w => w.symbol.toUpperCase() !== upper));
    } else if (selectedStock && selectedStock.ticker.toUpperCase() === upper) {
      const s = selectedStock;
      setWatchlist(prev => [...prev, { symbol: s.ticker, name: s.name, price: s.price, pct: s.pct, sym: s.sym, isLive: true }]);
    }
  }

  const s = selectedStock;
  const isInWatchlist = s ? watchlist.some(w => w.symbol.toUpperCase() === s.ticker.toUpperCase()) : false;
  const displayVerdict = liveVerdict || s?.verdict || '';
  const displayConf    = liveConf    || s?.conf    || 0;

  return (
    <div className="flex h-screen w-screen bg-[#0B0E14] text-slate-200 overflow-hidden font-sans">

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 bg-[#0F131A] border-r border-slate-800 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-sky-500 rounded flex items-center justify-center">
              <span className="text-white font-black text-xs">FP</span>
            </div>
            <span className="font-bold text-sm text-white tracking-wide">FinPulse</span>
          </div>
          <div className="text-[10px] text-slate-600 mt-1 ml-9">AI 股票分析平台</div>
        </div>

        {/* Watchlist header */}
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">自選股</span>
          <span className="text-[10px] text-slate-600">{watchlist.length} 檔</span>
        </div>

        {/* Watchlist items */}
        <div className="flex-1 overflow-y-auto">
          {watchlist.map(item => (
            <button key={item.symbol} onClick={() => queryStock(item.symbol)}
              className={`w-full px-4 py-3 flex justify-between items-center border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors text-left ${s?.ticker === item.symbol ? 'bg-sky-900/20 border-l-2 border-l-sky-500' : ''}`}>
              <div>
                <div className="font-bold text-sm text-white flex items-center gap-1.5">
                  {item.symbol}
                  {item.isLive && <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />}
                </div>
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
          {watchlist.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-700">
              自選股清單為空<br />查詢股票後點擊 ⭐ 加入
            </div>
          )}
        </div>

        {/* Connection status */}
        <div className="px-4 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            {isConnected ? '即時連線中' : '重連中…'}
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="h-14 flex-shrink-0 bg-[#0F131A] border-b border-slate-800 flex items-center px-5 gap-4">
          <form onSubmit={onSearchSubmit} className="flex-1 max-w-lg">
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-slate-500 text-sm">⌕</span>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜尋股票代號… 2330、AAPL、NVDA"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors" />
            </div>
          </form>

          {/* Tab nav */}
          <nav className="flex gap-1">
            {(['dashboard', 'news', 'settings'] as Tab[]).map(tab => {
              const labels: Record<Tab, string> = {
                dashboard: '📊 AI 分析師',
                news:      '📰 即時新聞',
                settings:  '⚙️ 系統設定',
              };
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeTab === tab ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </nav>
        </header>

        {/* ── Dashboard ──────────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto p-5">
            {isLoading && !s ? (
              <div className="h-96 flex flex-col items-center justify-center gap-3 text-slate-500">
                <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">正在向 Yahoo Finance 調閱即時數據…</span>
              </div>
            ) : !s ? (
              <div className="h-96 flex flex-col items-center justify-center gap-2 text-slate-600">
                <span className="text-5xl">📈</span>
                <p className="text-sm mt-2">從左側選擇一檔股票，或在上方搜尋代號</p>
                <p className="text-xs text-slate-700 mt-1">支援全台股（2330、2454…）與美股（AAPL、NVDA…）</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-5">

                {/* Left + Center */}
                <div className="col-span-2 space-y-5">

                  {/* Price header card */}
                  <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h1 className="text-2xl font-black text-white tracking-tight">{s.ticker}</h1>
                          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-medium">{s.name}</span>
                          <span className={`text-xs border px-2 py-0.5 rounded font-bold ${s.market === 'TW' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' : 'text-sky-400 border-sky-400/30 bg-sky-400/10'}`}>
                            {s.market === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}
                          </span>
                          {/* Watchlist toggle button */}
                          <button onClick={() => toggleWatchlist(s.ticker)}
                            className={`text-xs border px-2.5 py-0.5 rounded font-bold transition-colors ${isInWatchlist ? 'text-yellow-400 border-yellow-400/40 bg-yellow-400/10 hover:bg-red-400/10 hover:text-red-400 hover:border-red-400/30' : 'text-slate-400 border-slate-700 hover:bg-yellow-400/10 hover:text-yellow-400 hover:border-yellow-400/30'}`}>
                            {isInWatchlist ? '⭐ 已加入自選' : '☆ 加入自選'}
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 mt-1 truncate">{s.fullName} · {s.sector}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-3xl font-black text-white">{s.sym}{s.price.toLocaleString()}</div>
                        <div className={`text-sm font-semibold mt-0.5 ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.change >= 0 ? '▲' : '▼'} {s.sym}{Math.abs(s.change).toFixed(2)} ({s.pct >= 0 ? '+' : ''}{s.pct.toFixed(2)}%)
                        </div>
                        {displayVerdict && (
                          <span className={`inline-block mt-2 text-xs font-bold border px-2.5 py-1 rounded ${verdictBg(displayVerdict)} ${verdictColor(displayVerdict)}`}>
                            ● {displayVerdict}  {displayConf}%
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 52-week range bar */}
                    <div className="mt-4 pt-4 border-t border-slate-800">
                      <div className="flex justify-between text-xs text-slate-500 mb-1.5">
                        <span>52週低 {s.sym}{s.lo52.toLocaleString()}</span>
                        <span className="text-slate-600">年度價格區間</span>
                        <span>52週高 {s.sym}{s.hi52.toLocaleString()}</span>
                      </div>
                      <div className="relative h-1.5 bg-slate-800 rounded-full overflow-visible">
                        <div className="absolute inset-0 bg-gradient-to-r from-red-500/40 via-yellow-500/40 to-emerald-500/40 rounded-full" />
                        {s.hi52 > s.lo52 && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-sky-400"
                            style={{ left: `${Math.max(0, Math.min(100, ((s.price - s.lo52) / (s.hi52 - s.lo52)) * 100))}%`, transform: 'translate(-50%, -50%)' }}
                          />
                        )}
                      </div>
                    </div>

                    {/* SVG K-line trend chart */}
                    <div className="h-52 mt-5 border-t border-slate-800 pt-4">
                      {isLoading
                        ? <div className="h-full flex items-center justify-center"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
                        : <TrendLine candles={s.history} />}
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
                      🤖 Groq llama-3.1-8b-instant 即時 AI 分析
                    </h3>
                    <div className="bg-slate-900/60 rounded-lg border border-slate-700 p-4 text-sm leading-relaxed min-h-[140px] whitespace-pre-wrap text-slate-300">
                      {aiText
                        ? aiText.split('\n').map((line, i) => (
                            <div key={i} className={line ? '' : 'h-3'}>
                              {line && <BoldText text={line} />}
                            </div>
                          ))
                        : <span className="text-slate-600 italic">等待 AI 分析結果串流…</span>}
                      {isLoading && aiText && (
                        <span className="inline-block w-0.5 h-4 bg-sky-400 align-middle animate-pulse ml-0.5" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Fundamentals */}
                <div className="space-y-5">
                  <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">關鍵指標</h3>
                    <div className="space-y-3">
                      {([
                        ['市值',       s.cap],
                        ['本益比 (PE)', s.pe],
                        ['每股盈餘',    s.eps],
                        ['Beta 值',     s.beta],
                        ['成交量',      s.vol],
                        ['均量',        s.avgVol],
                        ['52週高點',    `${s.sym}${s.hi52.toLocaleString()}`],
                        ['52週低點',    `${s.sym}${s.lo52.toLocaleString()}`],
                        ['現金殖利率',  s.div],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} className="flex justify-between items-center border-b border-slate-800 pb-2 text-sm">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-semibold text-white">{value}</span>
                        </div>
                      ))}
                    </div>

                    {displayVerdict && (
                      <div className="mt-5 pt-4 border-t border-slate-800">
                        <div className="text-xs text-slate-500 uppercase tracking-widest mb-3">AI 評等</div>
                        <div className={`text-center text-2xl font-black ${verdictColor(displayVerdict)} mb-1`}>
                          {displayVerdict}
                        </div>
                        <div className="text-center text-xs text-slate-500">
                          信心指數 <span className={`font-bold ${verdictColor(displayVerdict)}`}>{displayConf}%</span>
                        </div>
                        {s.target && (
                          <div className="mt-4 space-y-2">
                            {([['目標低', s.target.lo, 'text-red-400'], ['目標中', s.target.mid, 'text-yellow-400'], ['目標高', s.target.hi, 'text-emerald-400']] as [string, number, string][]).map(([label, val, cls]) => (
                              <div key={label} className="flex justify-between text-xs">
                                <span className="text-slate-500">{label}</span>
                                <span className={`font-semibold ${cls}`}>{s.sym}{val.toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* ── News ───────────────────────────────────────────────────────────── */}
        {activeTab === 'news' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-4xl">
              <div className="flex items-center gap-3 mb-5">
                <h2 className="text-lg font-bold text-white">即時財經新聞</h2>
                <span className="text-xs bg-emerald-400/10 text-emerald-400 border border-emerald-400/30 px-2 py-0.5 rounded font-medium">LIVE</span>
                <span className="text-xs text-slate-600 ml-auto">最後更新：{new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="space-y-2">
                {MOCK_NEWS.map(news => (
                  <div key={news.id}
                    onClick={() => window.open(news.url, '_blank', 'noopener,noreferrer')}
                    className="bg-[#161F2E] border border-slate-800 rounded-xl p-4 hover:border-[#38BDF8] hover:bg-[#1A2640] transition-all cursor-pointer group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-[10px] font-bold border px-1.5 py-0.5 rounded flex-shrink-0 ${news.impact === 'positive' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' : news.impact === 'negative' ? 'text-red-400 border-red-400/30 bg-red-400/10' : 'text-slate-400 border-slate-700 bg-slate-800/50'}`}>
                            {news.impact === 'positive' ? '▲ 利多' : news.impact === 'negative' ? '▼ 利空' : '── 中性'}
                          </span>
                          <span className="text-xs text-slate-500">{news.source}</span>
                          <span className="text-[10px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">{news.category.toUpperCase()}</span>
                        </div>
                        <p className="text-sm text-slate-200 font-medium leading-snug group-hover:text-white transition-colors">{news.title}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <span className="text-xs text-slate-600">{news.time}</span>
                        <span className="text-[10px] text-slate-700 group-hover:text-[#38BDF8] transition-colors">↗ 開啟</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 text-center text-xs text-slate-700">
                * 新聞為示範資料，完整即時新聞功能即將整合 NewsAPI / GNews
              </div>
            </div>
          </div>
        )}

        {/* ── Settings ───────────────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="max-w-2xl space-y-5">
              <h2 className="text-lg font-bold text-white">系統設定</h2>

              {/* Personal account card */}
              <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">個人帳戶</h3>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-sky-500/20 border border-sky-500/30 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                    👤
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-white">FinPulse 用戶</div>
                    <div className="text-xs text-slate-500 mt-0.5 truncate">s113213081@gmail.com</div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs bg-sky-400/10 text-sky-400 border border-sky-400/20 px-2 py-0.5 rounded font-medium">Pro 方案</span>
                      <span className="text-xs text-slate-600">已訂閱</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk preference */}
              <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">投資偏好</h3>
                <div>
                  <div className="flex justify-between items-center mb-2.5">
                    <label className="text-sm text-slate-300">風險偏好</label>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${riskLevel < 33 ? 'text-emerald-400 bg-emerald-400/10' : riskLevel < 67 ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10'}`}>
                      {riskLevel < 33 ? '保守型' : riskLevel < 67 ? '穩健型' : '積極型'} ({riskLevel})
                    </span>
                  </div>
                  <input type="range" min="0" max="100" value={riskLevel} onChange={e => setRiskLevel(Number(e.target.value))}
                    className="w-full accent-sky-500 cursor-pointer" />
                  <div className="flex justify-between text-xs text-slate-600 mt-1.5">
                    <span>保守型</span><span>穩健型</span><span>積極型</span>
                  </div>
                </div>
              </div>

              {/* Notification & AI switches */}
              <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">通知與 AI 設定</h3>
                <div className="space-y-5">
                  {([
                    { label: '價格提醒', desc: '自選股達到目標價位時推播通知', value: priceAlerts, toggle: () => setPriceAlerts(v => !v) },
                    { label: 'AI 信號優化', desc: '根據市場狀況動態調整 AI 分析參數', value: aiSignalOpt, toggle: () => setAiSignalOpt(v => !v) },
                    { label: '暗黑模式', desc: '使用 Bloomberg 專業暗黑風格介面', value: darkMode, toggle: () => setDarkMode(v => !v) },
                  ]).map(({ label, desc, value, toggle }) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm text-slate-300 font-medium">{label}</div>
                        <div className="text-xs text-slate-600 mt-0.5">{desc}</div>
                      </div>
                      <Toggle value={value} onChange={toggle} />
                    </div>
                  ))}
                </div>
              </div>

              {/* System info */}
              <div className="bg-[#0F131A] border border-slate-800 rounded-xl p-5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">系統資訊</h3>
                <div className="space-y-2.5">
                  {([
                    ['AI 模型',   'llama-3.1-8b-instant (Groq)'],
                    ['行情來源',  'Yahoo Finance 即時報價'],
                    ['後端端點',  'stockprice-2ukw.onrender.com'],
                    ['前端框架',  'React + Vite + TypeScript + Tailwind'],
                    ['版本',      'v2.0.0 — FinPulse'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs border-b border-slate-800 pb-2 last:border-0 last:pb-0">
                      <span className="text-slate-500">{k}</span>
                      <span className="text-slate-300 font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
