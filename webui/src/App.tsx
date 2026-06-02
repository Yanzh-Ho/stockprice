import { useState, useEffect, useRef } from 'react';

const WS_URL = 'wss://stockprice-2ukw.onrender.com';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle { o: number; h: number; l: number; c: number; v: number }

interface LiveStock {
  ticker: string; name: string; fullName: string; market: 'TW' | 'US';
  sym: string; price: number; change: number; pct: number;
  cap: string; pe: string; eps: string; beta: string; vol: string; avgVol: string;
  hi52: number; lo52: number; div: string; sector: string;
  history: Candle[]; verdict: string; conf: number;
  target?: { lo: number; mid: number; hi: number };
}

interface WatchItem {
  symbol: string; name: string; price: number; pct: number; sym: string; isLive?: boolean;
}

type Tab = 'dashboard' | 'news' | 'settings';

// ── Static data ───────────────────────────────────────────────────────────────
const DEFAULT_WATCHLIST: WatchItem[] = [
  { symbol: '2330', name: '台積電', price: 875,   pct:  2.10, sym: 'NT$' },
  { symbol: '2454', name: '聯發科', price: 1180,  pct:  2.79, sym: 'NT$' },
  { symbol: '2317', name: '鴻海',   price: 182,   pct: -1.35, sym: 'NT$' },
  { symbol: '2412', name: '中華電', price: 121,   pct:  0.41, sym: 'NT$' },
  { symbol: 'AAPL', name: '蘋果',   price: 195.3, pct:  0.50, sym: '$'   },
  { symbol: 'NVDA', name: '輝達',   price: 920.5, pct:  3.82, sym: '$'   },
];

const MOCK_NEWS = [
  { id: 1, time: '10:32', title: 'Fed 維持利率不變，市場反應平淡，等待下次會議指引',              source: 'Reuters',        category: 'macro', impact: 'neutral',  url: 'https://www.reuters.com/markets/us/fed-holds-rates-steady/' },
  { id: 2, time: '09:45', title: '台積電 Q2 法說會：CoWoS 產能滿載，下半年營收持續看好',          source: 'Economic Daily', category: 'TW',    impact: 'positive', url: 'https://money.udn.com/money/cate/5607' },
  { id: 3, time: '09:12', title: 'NVIDIA 下一代 Blackwell 晶片需求超預期，台系供應鏈全面受惠',    source: 'DigiTimes',      category: 'tech',  impact: 'positive', url: 'https://www.digitimes.com.tw/tech/dt/n/shwnws.asp?cnlid=13' },
  { id: 4, time: '08:55', title: '美股三大指數開盤走跌，科技股估值承壓',                          source: 'Bloomberg',      category: 'US',    impact: 'negative', url: 'https://www.bloomberg.com/markets' },
  { id: 5, time: '08:30', title: '中國出口數據不如預期，製造業 PMI 連三月下滑',                    source: 'NBS',            category: 'macro', impact: 'negative', url: 'https://tw.stock.yahoo.com/international-markets' },
  { id: 6, time: '07:50', title: '聯發科推出天璣 9400+，AI 手機新周期正式啟動',                   source: 'TechNews',       category: 'TW',    impact: 'positive', url: 'https://technews.tw/category/chip/' },
  { id: 7, time: '07:15', title: '鴻海與 NVIDIA 深化 AI 伺服器合作，黑熊超算正式落地',            source: 'CTimes',         category: 'TW',    impact: 'positive', url: 'https://www.ctimes.com.tw/DispNews/2024/AI' },
  { id: 8, time: '06:30', title: 'Apple WWDC 2025：Apple Intelligence 全面整合，iPhone 需求復甦', source: 'MacRumors',      category: 'tech',  impact: 'positive', url: 'https://www.macrumors.com/' },
];

const taiwanStockNames: Record<string, string> = {
  '2330.TW': '台積電',  '2454.TW': '聯發科',  '2317.TW': '鴻海',
  '2412.TW': '中華電',  '2449.TW': '京元電子', '2308.TW': '台達電',
  '2382.TW': '廣達',    '2357.TW': '華碩',     '2303.TW': '聯電',
  '2881.TW': '富邦金',  '2882.TW': '國泰金',   '2891.TW': '中信金',
  '6505.TW': '台塑化',  '1301.TW': '台塑',     '1303.TW': '南亞',
  '2002.TW': '中鋼',    '3008.TW': '大立光',   '2395.TW': '研華',
  '2379.TW': '瑞昱',    '2408.TW': '南亞科',   '3711.TW': '日月光投控',
};

// ── Design tokens (verdict) ───────────────────────────────────────────────────
function verdictDot(v: string) {
  if (v === 'BUY')  return 'bg-emerald-400';
  if (v === 'SELL') return 'bg-red-400';
  return 'bg-amber-400';
}
function verdictText(v: string) {
  if (v === 'BUY')  return 'text-emerald-400';
  if (v === 'SELL') return 'text-red-400';
  return 'text-amber-400';
}
function verdictBar(v: string) {
  if (v === 'BUY')  return 'bg-emerald-400/50';
  if (v === 'SELL') return 'bg-red-400/50';
  return 'bg-amber-400/50';
}

// ── Sub-components ────────────────────────────────────────────────────────────
function BoldText({ text }: { text: string }) {
  return (
    <span>
      {text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="text-[#7DD3FC] font-medium">{part.slice(2, -2)}</strong>
          : part
      )}
    </span>
  );
}

function TrendLine({ candles }: { candles: Candle[] }) {
  if (!candles.length) return (
    <div className="text-[11px] text-[#1E2530] text-center py-10 tracking-[0.2em] font-mono">NO CHART DATA</div>
  );
  const closes = candles.map(c => c.c);
  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min || 1;
  const pts = candles.map((c, i) =>
    `${(i / (candles.length - 1)) * 100},${100 - ((c.c - min) / range) * 85 - 7.5}`
  ).join(' ');
  const isUp  = closes[closes.length - 1] >= closes[0];
  const color = isUp ? '#34D399' : '#F87171';
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.10" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={`M${pts.split(' ').join('L')} L100,100 L0,100 Z`} fill="url(#tg)" />
      <polyline fill="none" stroke={color} strokeWidth="1.1"
        strokeLinejoin="round" strokeLinecap="round" points={pts} />
    </svg>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className={`relative w-10 h-5 rounded-full border transition-all duration-300 flex-shrink-0
        ${value ? 'bg-[#0EA5E9]/20 border-[#38BDF8]/30' : 'bg-[#0D1117] border-[#1E222B]'}`}>
      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300
        ${value ? 'translate-x-[22px] bg-[#38BDF8]' : 'translate-x-0.5 bg-[#2D3748]'}`} />
    </button>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab]         = useState<Tab>('dashboard');
  const [watchlist, setWatchlist]         = useState<WatchItem[]>(DEFAULT_WATCHLIST);
  const [searchQuery, setSearchQuery]     = useState('');
  const [selectedStock, setSelectedStock] = useState<LiveStock | null>(null);
  const [aiText, setAiText]               = useState('');
  const [isConnected, setIsConnected]     = useState(false);
  const [isLoading, setIsLoading]         = useState(false);
  const [liveVerdict, setLiveVerdict]     = useState('');
  const [liveConf, setLiveConf]           = useState(0);

  const [riskLevel, setRiskLevel]   = useState(50);
  const [priceAlerts, setPriceAlerts] = useState(true);
  const [aiSignalOpt, setAiSignalOpt] = useState(true);
  const [darkMode, setDarkMode]       = useState(true);

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
            type: string; data?: LiveStock;
            text?: string; verdict?: string; conf?: number; message?: string;
          };

          if (msg.type === 'stockData' && msg.data) {
            const raw = msg.data;
            const yahooKey = raw.market === 'TW' ? `${raw.ticker}.TW` : raw.ticker;
            const zhName = taiwanStockNames[yahooKey];
            const s = zhName ? { ...raw, name: zhName, fullName: zhName } : raw;
            setIsLoading(false);
            setSelectedStock(s);
            setLiveVerdict('');
            setLiveConf(0);
            setWatchlist(prev => prev.map(item =>
              item.symbol.toUpperCase() === s.ticker.toUpperCase()
                ? { ...item, price: s.price, pct: s.pct, sym: s.sym, isLive: true, name: zhName || item.name }
                : item
            ));
          }

          if (msg.type === 'aiChunk' && msg.text)  setAiText(prev => prev + msg.text);

          if (msg.type === 'done') {
            setIsLoading(false);
            if (msg.verdict) setLiveVerdict(msg.verdict);
            if (msg.conf != null) setLiveConf(msg.conf);
          }

          if (msg.type === 'error') {
            setIsLoading(false);
            setAiText(prev => prev + `\n\n⚠ ${msg.message ?? '發生錯誤'}`);
          }
        } catch { /* ignore */ }
      };

      socket.onclose = () => { setIsConnected(false); if (!closed) setTimeout(connect, 5000); };
      socket.onerror = () => { setIsConnected(false); };
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

  const s              = selectedStock;
  const isInWatchlist  = s ? watchlist.some(w => w.symbol.toUpperCase() === s.ticker.toUpperCase()) : false;
  const displayVerdict = liveVerdict || s?.verdict || '';
  const displayConf    = liveConf    || s?.conf    || 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen bg-[#0A0D10] text-[#C9D1D9] overflow-hidden font-sans antialiased">

      {/* ══ Sidebar ═══════════════════════════════════════════════════════════ */}
      <aside className="w-60 flex-shrink-0 bg-[#0D1117] border-r border-[#1A1F2A] flex flex-col">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#1A1F2A]">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border border-[#38BDF8]/30 rounded flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-[10px] font-semibold text-[#38BDF8]/80">FP</span>
            </div>
            <div>
              <div className="font-serif text-sm text-[#E2E8F0] tracking-wider">FinPulse</div>
              <div className="text-[9px] text-[#2D3748] tracking-[0.18em] uppercase mt-0.5 font-mono">Market Intelligence</div>
            </div>
          </div>
        </div>

        {/* Watchlist header */}
        <div className="px-5 py-3 border-b border-[#1A1F2A] flex items-center justify-between">
          <span className="text-[9px] font-mono font-semibold tracking-[0.22em] text-[#2D3748] uppercase">Watchlist</span>
          <span className="text-[9px] font-mono text-[#1E2530]">{watchlist.length}</span>
        </div>

        {/* Watchlist items */}
        <div className="flex-1 overflow-y-auto">
          {watchlist.map(item => (
            <button key={item.symbol} onClick={() => queryStock(item.symbol)}
              className={`w-full px-5 py-3.5 flex justify-between items-center border-b border-[#111620]
                hover:bg-[#0F1419] transition-all duration-200 text-left
                ${s?.ticker === item.symbol ? 'bg-[#0F1520] border-l-2 border-l-[#38BDF8]/60 pl-[18px]' : ''}`}>
              <div>
                <div className="font-mono text-sm text-[#D1D9E0] flex items-center gap-1.5">
                  {item.symbol}
                  {item.isLive && <span className="w-1 h-1 bg-emerald-400/70 rounded-full" />}
                </div>
                <div className="text-[11px] text-[#3A4050] mt-0.5 font-sans">{item.name}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm text-[#C9D1D9]">
                  {item.sym}{item.price.toLocaleString()}
                </div>
                <div className={`font-mono text-[11px] mt-0.5 ${item.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {item.pct >= 0 ? '+' : ''}{item.pct.toFixed(2)}%
                </div>
              </div>
            </button>
          ))}
          {watchlist.length === 0 && (
            <div className="px-5 py-10 text-center">
              <div className="text-[11px] text-[#1E2530] font-mono leading-loose tracking-wide">
                EMPTY<br /><span className="text-[#141820]">Add via ☆ WATCH</span>
              </div>
            </div>
          )}
        </div>

        {/* Connection dot */}
        <div className="px-5 py-4 border-t border-[#1A1F2A]">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? 'bg-emerald-400/70' : 'bg-red-400/70'}`} />
            <span className={`text-[9px] font-mono tracking-[0.18em] ${isConnected ? 'text-[#2D3748]' : 'text-red-400/50'}`}>
              {isConnected ? 'LIVE' : 'RECONNECTING…'}
            </span>
          </div>
        </div>
      </aside>

      {/* ══ Main ══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="h-14 flex-shrink-0 bg-[#0D1117] border-b border-[#1A1F2A] flex items-center px-6 gap-5">
          <form onSubmit={onSearchSubmit} className="flex-1 max-w-md">
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-[#2D3748] text-xs font-mono">›</span>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search symbol — 2330  AAPL  NVDA"
                className="w-full bg-[#080B0F] border border-[#1E222B] rounded px-3 py-2 pl-7
                  text-xs font-mono text-[#C9D1D9] placeholder-[#252B38]
                  focus:outline-none focus:border-[#38BDF8]/30 transition-all duration-300" />
            </div>
          </form>

          {/* Tab nav */}
          <nav className="flex gap-0.5 ml-auto">
            {(['dashboard', 'news', 'settings'] as Tab[]).map(tab => {
              const labels: Record<Tab, string> = {
                dashboard: 'Analysis',
                news:      'News Feed',
                settings:  'Settings',
              };
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3.5 py-1.5 text-[11px] font-mono tracking-wider rounded transition-all duration-200
                    ${activeTab === tab
                      ? 'text-[#38BDF8] bg-[#0F1F30] border border-[#38BDF8]/20'
                      : 'text-[#2D3748] hover:text-[#6B7280]'}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </nav>
        </header>

        {/* ── Dashboard ─────────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto p-6">
            {isLoading && !s ? (
              <div className="h-96 flex flex-col items-center justify-center gap-4 text-[#1E2530]">
                <div className="w-5 h-5 border border-[#38BDF8]/30 border-t-[#38BDF8]/70 rounded-full animate-spin" />
                <span className="text-[10px] font-mono tracking-[0.25em]">FETCHING MARKET DATA…</span>
              </div>
            ) : !s ? (
              <div className="h-96 flex flex-col items-center justify-center gap-3">
                <div className="text-3xl text-[#1A1F2A]">▲</div>
                <p className="text-[11px] font-mono tracking-[0.2em] text-[#252B38] mt-2">SELECT A SYMBOL TO BEGIN</p>
                <p className="text-[10px] font-mono text-[#1A1F2A] mt-1">TW: 2330  2454  2317  ·  US: AAPL  NVDA</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-6">

                {/* Left + Center columns */}
                <div className="col-span-2 space-y-6">

                  {/* ── Price card ──────────────────────────────────────── */}
                  <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                    transition-all duration-300 hover:border-[#252B38]">

                    <div className="flex items-start justify-between gap-6">
                      {/* Left: identity */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          {/* Ticker in mono */}
                          <h1 className="font-mono text-2xl font-semibold text-white tracking-widest">
                            {s.ticker}
                          </h1>
                          {/* Company name in serif */}
                          <span className="font-serif text-base text-[#8892A4] tracking-wide">
                            {s.name}
                          </span>
                          {/* Market badge */}
                          <span className={`text-[9px] font-mono tracking-widest border px-1.5 py-0.5 rounded-sm
                            ${s.market === 'TW'
                              ? 'text-[#B8A040] border-[#B8A040]/20 bg-[#B8A040]/5'
                              : 'text-[#4E9BE8] border-[#4E9BE8]/20 bg-[#4E9BE8]/5'}`}>
                            {s.market === 'TW' ? 'TWSE' : 'NASDAQ'}
                          </span>
                          {/* Watchlist toggle */}
                          <button onClick={() => toggleWatchlist(s.ticker)}
                            className={`text-[9px] font-mono tracking-wider border px-2 py-0.5 rounded-sm
                              transition-all duration-200
                              ${isInWatchlist
                                ? 'text-[#6B7280] border-[#252B38] bg-[#131820] hover:border-red-400/20 hover:text-red-400/70'
                                : 'text-[#2D3748] border-[#1E222B] hover:border-[#38BDF8]/30 hover:text-[#7DD3FC]/70'}`}>
                            {isInWatchlist ? '★ WATCHING' : '☆ WATCH'}
                          </button>
                        </div>
                        <div className="text-[11px] text-[#2D3748] mt-2 font-mono truncate">
                          {s.fullName} · {s.sector}
                        </div>
                      </div>

                      {/* Right: price block */}
                      <div className="text-right flex-shrink-0">
                        <div className="font-mono text-4xl font-light text-white tracking-tight">
                          {s.sym}{s.price.toLocaleString()}
                        </div>
                        <div className={`font-mono text-sm mt-1.5 ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.change >= 0 ? '+' : ''}{s.sym}{Math.abs(s.change).toFixed(2)}
                          <span className="text-[#4A5568] mx-1">/</span>
                          {s.pct >= 0 ? '+' : ''}{s.pct.toFixed(2)}%
                        </div>
                        {/* Verdict pill */}
                        {displayVerdict && (
                          <div className="inline-flex items-center gap-1.5 mt-3 px-2.5 py-1
                            bg-[#0A0D10] border border-[#1E222B] rounded">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${verdictDot(displayVerdict)}`} />
                            <span className={`font-mono text-xs font-medium ${verdictText(displayVerdict)}`}>
                              {displayVerdict}
                            </span>
                            <span className="font-mono text-xs text-[#3A4050]">{displayConf}%</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 52-week range bar */}
                    <div className="mt-6 pt-5 border-t border-[#131820]">
                      <div className="flex justify-between text-[9px] text-[#252B38] mb-2 font-mono tracking-wider">
                        <span>52W LO  {s.sym}{s.lo52.toLocaleString()}</span>
                        <span className="text-[#1A1F2A]">52-WEEK RANGE</span>
                        <span>52W HI  {s.sym}{s.hi52.toLocaleString()}</span>
                      </div>
                      <div className="relative h-0.5 bg-[#111620] rounded-full overflow-visible">
                        <div className="absolute inset-0 bg-gradient-to-r from-[#F87171]/25 via-[#FBBF24]/15 to-[#34D399]/25 rounded-full" />
                        {s.hi52 > s.lo52 && (
                          <div className="absolute top-1/2 w-2.5 h-2.5 bg-[#D1D9E0] rounded-full border border-[#0A0D10] shadow"
                            style={{
                              left: `${Math.max(0, Math.min(100, ((s.price - s.lo52) / (s.hi52 - s.lo52)) * 100))}%`,
                              transform: 'translate(-50%, -50%)',
                            }} />
                        )}
                      </div>
                    </div>

                    {/* SVG trend chart */}
                    <div className="h-48 mt-6 border-t border-[#131820] pt-5">
                      {isLoading
                        ? <div className="h-full flex items-center justify-center">
                            <div className="w-4 h-4 border border-[#38BDF8]/30 border-t-[#38BDF8]/60 rounded-full animate-spin" />
                          </div>
                        : <TrendLine candles={s.history} />}
                    </div>
                    <div className="flex justify-between text-[9px] text-[#1E2530] mt-2 font-mono tracking-wider">
                      <span>1Y AGO</span>
                      <span className="text-[#252B38]">YAHOO FINANCE · {s.history.length} SESSIONS</span>
                      <span>TODAY</span>
                    </div>
                  </div>

                  {/* ── AI Analysis card ────────────────────────────────── */}
                  <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                    transition-all duration-300 hover:border-[#252B38]">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-0.5 h-3.5 bg-[#38BDF8]/40 rounded-full" />
                      <h3 className="text-[9px] text-[#2D3748] uppercase tracking-[0.22em] font-mono">
                        AI Analysis · llama-3.1-8b-instant
                      </h3>
                    </div>
                    <div className="bg-[#080B0F] rounded border border-[#131820] p-5
                      text-[13px] leading-7 min-h-[160px] whitespace-pre-wrap text-[#6B7280] font-mono">
                      {aiText
                        ? aiText.split('\n').map((line, i) => (
                            <div key={i} className={line ? '' : 'h-4'}>
                              {line && <BoldText text={line} />}
                            </div>
                          ))
                        : <span className="text-[#1A1F2A] italic">Awaiting analysis stream…</span>}
                      {isLoading && aiText && (
                        <span className="inline-block w-0.5 h-3.5 bg-[#38BDF8]/60 align-middle animate-pulse ml-0.5" />
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Right: Fundamentals + Signal ────────────────────── */}
                <div className="space-y-6">
                  <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                    transition-all duration-300 hover:border-[#252B38]">
                    <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-5">
                      Key Metrics
                    </div>
                    <div className="space-y-3.5">
                      {([
                        ['市值',    s.cap],
                        ['本益比',  s.pe],
                        ['EPS',     s.eps],
                        ['Beta',    s.beta],
                        ['成交量',  s.vol],
                        ['均量',    s.avgVol],
                        ['52W 高',  `${s.sym}${s.hi52.toLocaleString()}`],
                        ['52W 低',  `${s.sym}${s.lo52.toLocaleString()}`],
                        ['殖利率',  s.div],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label}
                          className="flex justify-between items-baseline border-b border-[#0F1419] pb-3">
                          <span className="text-[11px] text-[#2D3748] font-mono">{label}</span>
                          <span className="font-mono text-sm text-[#C9D1D9]">{value}</span>
                        </div>
                      ))}
                    </div>

                    {/* AI Signal block */}
                    {displayVerdict && (
                      <div className="mt-6 pt-5 border-t border-[#131820]">
                        <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-4">
                          AI Signal
                        </div>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${verdictDot(displayVerdict)}`} />
                            <span className={`font-mono text-base font-semibold ${verdictText(displayVerdict)}`}>
                              {displayVerdict}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-[#3A4050]">{displayConf}%</span>
                        </div>
                        {/* Confidence bar */}
                        <div className="h-px bg-[#111620] rounded-full mb-4 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${verdictBar(displayVerdict)}`}
                            style={{ width: `${displayConf}%` }} />
                        </div>
                        {/* Target prices */}
                        {s.target && (
                          <div className="space-y-2.5">
                            {([
                              ['Low',  s.target.lo, 'text-[#F87171]/60'],
                              ['Base', s.target.mid, 'text-[#FBBF24]/60'],
                              ['High', s.target.hi, 'text-[#34D399]/60'],
                            ] as [string, number, string][]).map(([label, val, cls]) => (
                              <div key={label} className="flex justify-between items-center">
                                <span className="font-mono text-[10px] text-[#252B38]">{label}</span>
                                <span className={`font-mono text-xs ${cls}`}>
                                  {s.sym}{val.toLocaleString()}
                                </span>
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

        {/* ── News ──────────────────────────────────────────────────────────── */}
        {activeTab === 'news' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-0.5 h-5 bg-[#38BDF8]/40 rounded-full" />
                <h2 className="font-serif text-lg text-[#D1D9E0] tracking-wide">Financial News</h2>
                <span className="text-[9px] font-mono tracking-[0.2em] text-emerald-400/60
                  border border-emerald-400/15 bg-emerald-400/5 px-2 py-0.5 rounded-sm">LIVE</span>
                <span className="text-[10px] text-[#1E2530] font-mono ml-auto">
                  {new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="space-y-2">
                {MOCK_NEWS.map(news => (
                  <div key={news.id}
                    onClick={() => window.open(news.url, '_blank', 'noopener,noreferrer')}
                    className="bg-[#0D1117] border border-[#1A1F2A] rounded-lg p-4
                      hover:border-[#38BDF8]/50 hover:bg-[#0F1520]
                      transition-all duration-300 cursor-pointer group">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className={`text-[9px] font-mono tracking-wider border px-1.5 py-0.5 rounded-sm flex-shrink-0
                            ${news.impact === 'positive'
                              ? 'text-emerald-400/70 border-emerald-400/15 bg-emerald-400/5'
                              : news.impact === 'negative'
                              ? 'text-red-400/70 border-red-400/15 bg-red-400/5'
                              : 'text-[#3A4050] border-[#1E222B] bg-[#0A0D10]'}`}>
                            {news.impact === 'positive' ? '▲ BULL' : news.impact === 'negative' ? '▼ BEAR' : '── NEUTRAL'}
                          </span>
                          <span className="text-[10px] text-[#2D3748] font-mono">{news.source}</span>
                          <span className="text-[9px] text-[#1E2530] font-mono border border-[#131820]
                            bg-[#0A0D10] px-1.5 py-0.5 rounded-sm">{news.category.toUpperCase()}</span>
                        </div>
                        <p className="text-[13px] text-[#6B7280] leading-snug font-sans
                          group-hover:text-[#B0BAC6] transition-colors duration-200">{news.title}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <span className="text-[10px] text-[#1E2530] font-mono">{news.time}</span>
                        <span className="text-[9px] text-[#131820] font-mono tracking-wider
                          group-hover:text-[#38BDF8]/50 transition-colors duration-200">↗ OPEN</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-center text-[9px] text-[#131820] font-mono tracking-[0.2em]">
                DEMO DATA · NEWSAPI INTEGRATION PENDING
              </div>
            </div>
          </div>
        )}

        {/* ── Settings ──────────────────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-xl space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-0.5 h-5 bg-[#38BDF8]/40 rounded-full" />
                <h2 className="font-serif text-lg text-[#D1D9E0] tracking-wide">Settings</h2>
              </div>

              {/* Account card */}
              <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                transition-all duration-300 hover:border-[#252B38]">
                <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-5">Account</div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 border border-[#1E222B] rounded-lg flex items-center justify-center flex-shrink-0">
                    <span className="text-[#2D3748] text-sm">◈</span>
                  </div>
                  <div>
                    <div className="font-serif text-sm text-[#C9D1D9] tracking-wide">FinPulse 用戶</div>
                    <div className="font-mono text-[11px] text-[#2D3748] mt-1">s113213081@gmail.com</div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[9px] font-mono tracking-wider
                        text-[#38BDF8]/60 border border-[#38BDF8]/15 bg-[#38BDF8]/5 px-2 py-0.5 rounded-sm">PRO</span>
                      <span className="text-[10px] text-[#1E2530] font-mono">Active</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Risk preference */}
              <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                transition-all duration-300 hover:border-[#252B38]">
                <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-5">
                  Risk Preference
                </div>
                <div className="flex justify-between items-center mb-3">
                  <label className="font-mono text-xs text-[#4A5568]">Tolerance</label>
                  <span className={`font-mono text-[10px] px-2 py-0.5 rounded border
                    ${riskLevel < 33
                      ? 'text-emerald-400/70 border-emerald-400/15 bg-emerald-400/5'
                      : riskLevel < 67
                      ? 'text-amber-400/70 border-amber-400/15 bg-amber-400/5'
                      : 'text-red-400/70 border-red-400/15 bg-red-400/5'}`}>
                    {riskLevel < 33 ? 'CONSERVATIVE' : riskLevel < 67 ? 'BALANCED' : 'AGGRESSIVE'} {riskLevel}
                  </span>
                </div>
                <input type="range" min="0" max="100" value={riskLevel}
                  onChange={e => setRiskLevel(Number(e.target.value))}
                  className="w-full accent-[#38BDF8] cursor-pointer" />
                <div className="flex justify-between text-[9px] text-[#1E2530] font-mono tracking-wider mt-2">
                  <span>CONSERVATIVE</span><span>BALANCED</span><span>AGGRESSIVE</span>
                </div>
              </div>

              {/* Preference toggles */}
              <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                transition-all duration-300 hover:border-[#252B38]">
                <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-5">
                  Preferences
                </div>
                <div className="space-y-5">
                  {([
                    { label: '價格提醒',   sub: 'Price alerts when target reached',    val: priceAlerts, fn: () => setPriceAlerts(v => !v) },
                    { label: 'AI 信號優化', sub: 'Dynamic AI parameter adjustment',     val: aiSignalOpt, fn: () => setAiSignalOpt(v => !v) },
                    { label: '暗黑模式',   sub: 'Bloomberg dark terminal interface',    val: darkMode,    fn: () => setDarkMode(v => !v)    },
                  ]).map(({ label, sub, val, fn }) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-serif text-sm text-[#8892A4]">{label}</div>
                        <div className="font-mono text-[10px] text-[#1E2530] mt-0.5">{sub}</div>
                      </div>
                      <Toggle value={val} onChange={fn} />
                    </div>
                  ))}
                </div>
              </div>

              {/* System info */}
              <div className="bg-[#0D1117] border border-[#1E222B] rounded-xl p-6
                transition-all duration-300 hover:border-[#252B38]">
                <div className="text-[9px] text-[#2D3748] uppercase tracking-[0.25em] font-mono mb-5">System</div>
                <div className="space-y-3">
                  {([
                    ['AI Model',  'llama-3.1-8b-instant'],
                    ['Data Feed', 'Yahoo Finance Real-time'],
                    ['Backend',   'stockprice-2ukw.onrender.com'],
                    ['Stack',     'React · Vite · TypeScript'],
                    ['Release',   'v2.1.0 — FinPulse'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}
                      className="flex justify-between text-xs border-b border-[#0F1419] pb-3 last:border-0 last:pb-0">
                      <span className="font-mono text-[#1E2530]">{k}</span>
                      <span className="font-mono text-[#3A4050]">{v}</span>
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
