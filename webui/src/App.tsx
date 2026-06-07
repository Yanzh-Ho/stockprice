import { useState, useEffect, useRef } from 'react';

const WS_URL = 'wss://stockprice-2ukw.onrender.com';

const taiwanStockNames: Record<string, string> = {
  '2330.TW': '台積電', '2454.TW': '聯發科', '2317.TW': '鴻海', '2412.TW': '中華電', '2449.TW': '京元電子'
};

interface StockData {
  symbol: string; name: string; price: number; changePercent: number;
  marketCap: string; peRatio: string; eps: string; beta: string;
  volume: string; avgVolume: string; high52w: string; low52w: string;
  dividendYield: string; targetPrice: string;
  history: Array<{ date: string; open: number; high: number; low: number; close: number; }>;
}

// ── Candlestick chart — defined at module level to avoid React remount issues ──
function CandlestickChart({ history, isTW }: { history: StockData['history']; isTW: boolean }) {
  const data = history.slice(-80);
  if (!data.length) return (
    <div className="text-[10px] text-[#1E2530] text-center py-10 font-mono tracking-widest">NO DATA</div>
  );

  // 台股：漲紅跌綠；美股：漲綠跌紅
  const UP_COL   = isTW ? '#F87171' : '#10B981';
  const DOWN_COL = isTW ? '#10B981' : '#F87171';

  const W = 600, H = 150;
  const min = Math.min(...data.map(d => d.low))  * 0.998;
  const max = Math.max(...data.map(d => d.high)) * 1.002;
  const rng = max - min || 1;
  const cw  = (W / data.length) * 0.55;
  const xOf = (i: number) => (i + 0.5) * (W / data.length);
  const yOf = (v: number) => H - ((v - min) / rng) * H;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
      preserveAspectRatio="none" style={{ display: 'block' }}>
      {data.map((d, i) => {
        const up   = d.close >= d.open;
        const col  = up ? UP_COL : DOWN_COL;
        const bTop = yOf(Math.max(d.open, d.close));
        const bBot = yOf(Math.min(d.open, d.close));
        const bH   = Math.max(bBot - bTop, 1);
        const x    = xOf(i);
        return (
          <g key={i}>
            <line x1={x} y1={yOf(d.high)} x2={x} y2={yOf(d.low)}
              stroke={col} strokeWidth="0.8" opacity="0.6" />
            <rect x={x - cw / 2} y={bTop} width={cw} height={bH}
              fill={col} opacity="0.85" />
          </g>
        );
      })}
    </svg>
  );
}

export default function App() {
  const [watchlist, setWatchlist] = useState([
    { symbol: '2330.TW', name: '台積電', price: 0, changePercent: 0 },
    { symbol: '2454.TW', name: '聯發科', price: 0, changePercent: 0 },
    { symbol: '2317.TW', name: '鴻海', price: 0, changePercent: 0 },
    { symbol: '2412.TW', name: '中華電', price: 0, changePercent: 0 },
    { symbol: 'AAPL', name: '蘋果', price: 0, changePercent: 0 },
    { symbol: 'NVDA', name: '輝達', price: 0, changePercent: 0 }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [aiMetrics, setAiMetrics] = useState<Record<string, string>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const ws          = useRef<WebSocket | null>(null);
  const autoQueue   = useRef<string[]>([]);   // 背景待抓的自選股列表
  const isBgFetch   = useRef(false);           // 目前是否在做背景靜默抓取

  // 送出背景 priceOnly 請求（不更新主面板、不顯示 loading）
  function sendBgFetch(socket: WebSocket, sym: string) {
    socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: sym, priceOnly: true }));
  }

  useEffect(() => {
    function connect() {
      const socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        setIsConnected(true);
        // 第一支股票：完整分析 + 主面板展示
        isBgFetch.current = false;
        socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: '2330.TW' }));
        setLoadingData(true);
        // 其餘自選股排隊背景抓價（等第一支 done 後依序送出）
        autoQueue.current = ['2454.TW', '2317.TW', '2412.TW', 'AAPL', 'NVDA'];
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'stockData') {
            if (message.data) {
              const fresh = message.data;
              const localizedName = taiwanStockNames[fresh.symbol] || fresh.name || fresh.symbol;

              // 更新 watchlist 報價（任何情況都做）
              setWatchlist(prev => prev.map(item =>
                item.symbol.split('.')[0].toUpperCase() === fresh.symbol.split('.')[0].toUpperCase()
                  ? { ...item, price: fresh.price, changePercent: fresh.changePercent, name: localizedName }
                  : item
              ));

              // 只有非背景抓取才更新主面板
              if (!isBgFetch.current) {
                setLoadingData(false);
                setSelectedStock({ ...fresh, name: localizedName });
              }
            } else if (!isBgFetch.current) {
              setLoadingData(false);
              alert(message.error || '無法取得資料');
            }
          }

          if (message.type === 'aiChunk' && !isBgFetch.current) {
            setAiAnalysis(prev => {
              const next = prev + message.text;
              const metricsLine = next.match(/^METRICS\|([^\n]+)/m);
              if (metricsLine) {
                const parsed: Record<string, string> = {};
                metricsLine[1].split('|').forEach(pair => {
                  const [k, v] = pair.split(':');
                  if (k && v) parsed[k.trim()] = v.trim();
                });
                setAiMetrics(parsed);
              }
              return next;
            });
          }

          // 每次 done 都觸發下一支自選股的背景抓取
          if (message.type === 'done') {
            const next = autoQueue.current.shift();
            if (next && socket.readyState === WebSocket.OPEN) {
              isBgFetch.current = true;
              sendBgFetch(socket, next);
            } else if (!next) {
              isBgFetch.current = false; // 全部抓完
            }
          }
        } catch (err) {}
      };

      socket.onclose = () => { setIsConnected(false); setTimeout(connect, 5000); };
      ws.current = socket;
    }
    connect();
    return () => ws.current?.close();
  }, []);

  const handleQueryStock = (symbolStr: string) => {
    if (!symbolStr || !ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    // 使用者手動查詢：清空背景佇列，切換為完整分析模式
    autoQueue.current = [];
    isBgFetch.current = false;
    setAiAnalysis('');
    setAiMetrics({});
    setLoadingData(true);
    ws.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbolStr.trim().toUpperCase() }));
  };

  return (
    <div className="flex h-screen w-screen bg-[#07090E] text-[#D1D5DB] font-sans overflow-hidden antialiased">
      <div className="w-64 border-r border-[#151922] bg-[#0A0D14] flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-[#151922] space-x-2">
            <div className="h-5 w-5 bg-[#38BDF8]/10 border border-[#38BDF8]/30 rounded flex items-center justify-center font-bold text-[11px] text-[#38BDF8]">FP</div>
            <span className="text-base font-serif font-bold tracking-wider text-white">FinPulse</span>
          </div>
          <div className="mt-4 px-3">
            <div className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-4 mb-2">自選股</div>
            <div className="space-y-0.5">
              {watchlist.map((stock) => (
                <div key={stock.symbol} onClick={() => handleQueryStock(stock.symbol)} className={`px-4 py-2 rounded border border-transparent flex justify-between items-center cursor-pointer transition-all ${selectedStock?.symbol === stock.symbol ? 'bg-[#111622] border-[#1E2638]' : 'hover:bg-[#0E121A]'}`}>
                  <div>
                    <div className="text-xs font-mono font-semibold text-white">{stock.symbol.split('.')[0]}</div>
                    <div className="text-[10px] text-[#4B5563] font-serif truncate w-24">{stock.name}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs text-white">{stock.price > 0 ? stock.price : '---'}</div>
                    <div className={`text-[10px] ${stock.changePercent > 0 ? 'text-emerald-500' : stock.changePercent < 0 ? 'text-rose-500' : 'text-[#4B5563]'}`}>
                      {stock.changePercent > 0 ? '+' : ''}{stock.changePercent !== 0 ? `${stock.changePercent}%` : '0%'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-[#07090E]">
        <header className="h-16 border-b border-[#151922] bg-[#0A0D14] flex items-center justify-between px-6 flex-shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); handleQueryStock(searchQuery); setSearchQuery(''); }} className="flex-1 max-w-xl">
            <input type="text" placeholder="搜尋台股或美股 (例如: 2330, AAPL, NVDA)..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-[#0E121A] border border-[#1F2431] rounded px-4 py-1.5 text-xs text-white focus:outline-none focus:border-[#38BDF8]/50" />
          </form>
          <div className="flex items-center space-x-2 bg-[#0E121A] px-3 py-1 rounded border border-[#1F2431]">
            <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
            <span className="text-[10px] font-medium tracking-wider text-[#6B7280]">{isConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loadingData ? (
             <div className="h-full flex items-center justify-center text-[11px] tracking-wider text-[#6B7280]"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#38BDF8] mr-3"></div>FETCHING MARKET DATA...</div>
          ) : selectedStock ? (
            <div className="flex gap-6 h-full">
              <div className="flex-1 flex flex-col space-y-6">
                <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6 relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-xl font-serif font-bold text-white">{selectedStock.symbol} <span className="text-xs text-[#6B7280] font-normal">{selectedStock.name}</span></h1>
                      <div className="text-3xl font-mono text-white mt-2">{selectedStock.price}</div>
                      <div className={`text-xs font-mono mt-1 ${selectedStock.changePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{selectedStock.changePercent >= 0 ? '▲' : '▼'} {Math.abs(selectedStock.changePercent)}%</div>
                    </div>
                    {aiMetrics['操作'] && (() => {
                      const v = aiMetrics['操作'];
                      const isBuy  = v === '買進';
                      const isSell = v === '賣出';
                      const col = isBuy ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10'
                                : isSell ? 'text-rose-400 border-rose-400/30 bg-rose-400/10'
                                : 'text-amber-400 border-amber-400/30 bg-amber-400/10';
                      const dot = isBuy ? 'bg-emerald-400' : isSell ? 'bg-rose-400' : 'bg-amber-400';
                      return (
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-sm font-semibold tracking-wider ${col}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          {v}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="h-48 mt-6 border-t border-[#151922] pt-4 overflow-hidden">
                    <CandlestickChart
                      history={selectedStock.history}
                      isTW={/\.(TW|TWO)$/i.test(selectedStock.symbol)}
                    />
                  </div>
                </div>

                <div className="flex-1 bg-[#0A0D14] border border-[#151922] rounded-lg p-6">
                  <h3 className="text-xs font-serif font-bold text-[#38BDF8] mb-4">AI ANALYSIS • LLAMA-3.1-8B</h3>
                  <div className="text-xs font-serif text-[#9CA3AF] leading-relaxed whitespace-pre-wrap">
                    {aiAnalysis
                      ? aiAnalysis.replace(/^METRICS\|[^\n]*\n?/m, '').trimStart()
                      : '正在深入挖掘基本面與目標價，生成報告中...'}
                  </div>
                </div>
              </div>

              <div className="w-72 bg-[#0A0D14] border border-[#151922] rounded-lg p-6 flex flex-col">
                <h3 className="text-[10px] font-mono tracking-widest text-[#4B5563] mb-4">KEY METRICS</h3>
                <div className="space-y-3 font-mono text-xs">
                  {([
                    { label: '市值',   real: selectedStock.marketCap,    ai: aiMetrics['市值'] },
                    { label: '本益比', real: selectedStock.peRatio,       ai: aiMetrics['PE'] },
                    { label: 'EPS',    real: selectedStock.eps,           ai: aiMetrics['EPS'] },
                    { label: 'Beta',   real: selectedStock.beta,          ai: aiMetrics['Beta'] },
                    { label: '殖利率', real: selectedStock.dividendYield, ai: aiMetrics['殖利率'] },
                    { label: '成交量', real: selectedStock.volume,        ai: undefined },
                    { label: '均量',   real: selectedStock.avgVolume,     ai: aiMetrics['均量'] },
                    { label: '52W 高', real: selectedStock.high52w,       ai: undefined },
                    { label: '52W 低', real: selectedStock.low52w,        ai: undefined },
                  ] as { label: string; real: string; ai: string | undefined }[]).map((row, idx) => {
                    const isAi = row.real === '---' && !!row.ai;
                    const val  = isAi ? row.ai! : (row.real || '---');
                    return (
                      <div key={idx} className="flex justify-between border-b border-[#151922] pb-2 items-baseline">
                        <span className="text-[#4B5563] font-serif flex items-center gap-1">
                          {row.label}
                          {isAi && <span className="text-[8px] text-[#38BDF8]/40 border border-[#38BDF8]/15 px-0.5 rounded">AI</span>}
                        </span>
                        <span className={isAi ? 'text-[#9CA3AF]' : 'text-white'}>{val}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between pb-2 pt-3 bg-[#111622] px-2 -mx-2 rounded">
                    <span className="text-[#38BDF8] font-serif font-bold flex items-center gap-1.5">
                      AI 估算目標價
                      <span className="text-[9px] font-mono text-[#38BDF8]/50 border border-[#38BDF8]/20 px-1 rounded">AI</span>
                    </span>
                    <span className="text-[#38BDF8] font-bold font-mono">
                      {aiMetrics['目標價'] || (aiAnalysis ? '解析中...' : '分析中...')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
