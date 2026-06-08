import { useState, useEffect, useRef } from 'react';
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  CandlestickSeries, LineSeries, HistogramSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';

const WS_URL = 'wss://stockprice-2ukw.onrender.com';

const taiwanStockNames: Record<string, string> = {
  '2330.TW': '台積電', '2454.TW': '聯發科', '2317.TW': '鴻海', '2412.TW': '中華電', '2449.TW': '京元電子'
};

interface StockData {
  symbol: string; name: string; price: number; changePercent: number;
  marketCap: string; peRatio: string; eps: string; beta: string;
  volume: string; avgVolume: string; high52w: string; low52w: string;
  dividendYield: string; targetPrice: string;
  analystTargetPrice?: string | null;
  analystBuy?: number; analystHold?: number; analystSell?: number; analystTotal?: number;
  earningsDate?: string | null;
  exDivDate?: string | null;
  history: Array<{ date: string; open: number; high: number; low: number; close: number; volume?: number; }>;
}

// ── Price Alerts ──
interface PriceAlert {
  id: string;
  symbol: string;
  name: string;
  targetPrice: number;
  direction: 'above' | 'below';
  triggeredAt?: string;
}

const ALERTS_KEY = 'finpulse_price_alerts';
const loadAlerts = (): PriceAlert[] => {
  try { return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]'); } catch { return []; }
};
const saveAlerts = (a: PriceAlert[]) => localStorage.setItem(ALERTS_KEY, JSON.stringify(a));

// ── Indicator calculations ──
type Bar = StockData['history'][number];

function calcSMA(history: Bar[], period: number) {
  const result: { time: string; value: number }[] = [];
  for (let i = period - 1; i < history.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += history[j].close;
    result.push({ time: history[i].date, value: sum / period });
  }
  return result;
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) ema.push(values[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcRSI(history: Bar[], period = 14) {
  const closes = history.map(d => d.close);
  const out: { time: string; value: number }[] = [];
  if (closes.length < period + 1) return out;
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgG += d; else avgL -= d;
  }
  avgG /= period; avgL /= period;
  out.push({ time: history[period].date, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  for (let i = period + 1; i < history.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out.push({ time: history[i].date, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  }
  return out;
}

function calcMACD(history: Bar[]) {
  const none = { macdData: [] as { time: string; value: number }[], signalData: [] as { time: string; value: number }[], histData: [] as { time: string; value: number; color: string }[] };
  if (history.length < 35) return none;
  const closes = history.map(d => d.close);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const sig = calcEMA(macdLine, 9);
  const START = 33;
  const t = (i: number) => history[i].date;
  return {
    macdData:   Array.from({ length: history.length - START }, (_, j) => ({ time: t(START + j), value: macdLine[START + j] })),
    signalData: Array.from({ length: history.length - START }, (_, j) => ({ time: t(START + j), value: sig[START + j] })),
    histData:   Array.from({ length: history.length - START }, (_, j) => {
      const v = macdLine[START + j] - sig[START + j];
      return { time: t(START + j), value: v, color: v >= 0 ? '#10B981' : '#EF4444' };
    }),
  };
}

const RANGES = ['1W', '1M', '3M', '1Y', '5Y'] as const;

// ── StockChart — lightweight-charts with MA / Volume / RSI / MACD panes ──
function StockChart({ history, isTW, events = [], range, onRangeChange }: {
  history: StockData['history'];
  isTW: boolean;
  events?: Array<{ date: string; type: 'exdiv' | 'earnings' }>;
  range: string;
  onRangeChange: (r: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || history.length < 2) return;

    chartRef.current?.remove();

    const UP   = isTW ? '#F87171' : '#10B981';
    const DOWN = isTW ? '#10B981' : '#F87171';

    const chart = createChart(el, {
      autoSize: true,
      height: 460,
      layout:    { background: { type: ColorType.Solid, color: '#0A0D14' }, textColor: '#6B7280' },
      grid:      { vertLines: { color: '#151922' }, horzLines: { color: '#151922' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1F2431' },
      timeScale: { borderColor: '#1F2431', timeVisible: true },
    });
    chartRef.current = chart;

    // ── Pane 0: Candlestick + MAs ──
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candle.setData(history.map(d => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })) as any);

    const marks = events
      .filter(ev => history.some(h => h.date === ev.date))
      .map(ev => ({
        time: ev.date,
        position: 'aboveBar' as const,
        color: ev.type === 'exdiv' ? '#38BDF8' : '#F59E0B',
        shape: 'arrowDown' as const,
        text: ev.type === 'exdiv' ? '息' : '財',
      }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (marks.length) createSeriesMarkers(candle as any, marks as any);

    const addMA = (period: number, color: string) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.setData(calcSMA(history, period) as any);
    };
    addMA(5,  '#D1D5DB');
    addMA(20, '#FBBF24');
    addMA(60, '#F97316');

    // ── Pane 1: Volume ──
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' } }, 1);
    chart.priceScale('right', 1).applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vol.setData(history.map(d => ({ time: d.date, value: d.volume ?? 0, color: d.close >= d.open ? UP : DOWN })) as any);

    // ── Pane 2: RSI(14) ──
    const rsiS = chart.addSeries(LineSeries, { color: '#A78BFA', lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rsiS.setData(calcRSI(history) as any);
    rsiS.createPriceLine({ price: 70, color: '#EF4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' });
    rsiS.createPriceLine({ price: 30, color: '#22C55E', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' });

    // ── Pane 3: MACD ──
    const { macdData, signalData, histData } = calcMACD(history);
    const macdS = chart.addSeries(LineSeries, { color: '#60A5FA', lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    macdS.setData(macdData as any);
    const sigS = chart.addSeries(LineSeries, { color: '#FB923C', lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sigS.setData(signalData as any);
    const histS = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    histS.setData(histData as any);

    // Set pane heights
    const panes = chart.panes();
    panes[0]?.setHeight(220);
    panes[1]?.setHeight(60);
    panes[2]?.setHeight(80);
    panes[3]?.setHeight(80);

    chart.timeScale().fitContent();

    return () => { chartRef.current?.remove(); chartRef.current = null; };
  }, [history, isTW, events]);

  return (
    <div>
      <div className="flex items-center gap-1 mt-6 mb-2 border-t border-[#151922] pt-4">
        <div className="flex items-center gap-3 mr-auto text-[9px] font-mono text-[#6B7280] select-none">
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-px bg-[#D1D5DB]" />MA5</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-px bg-[#FBBF24]" />MA20</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-px bg-[#F97316]" />MA60</span>
        </div>
        {RANGES.map(r => (
          <button key={r} onClick={() => onRangeChange(r)}
            className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors ${
              range === r
                ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                : 'text-[#4B5563] hover:text-[#9CA3AF] border border-transparent'
            }`}>
            {r}
          </button>
        ))}
      </div>
      <div ref={containerRef} />
    </div>
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
  const [range, setRange] = useState('1Y');
  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts);
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [newAlertPrice, setNewAlertPrice] = useState('');
  const [newAlertDir, setNewAlertDir] = useState<'above' | 'below'>('above');
  const ws        = useRef<WebSocket | null>(null);
  const autoQueue = useRef<string[]>([]);
  const isBgFetch = useRef(false);

  function sendBgFetch(socket: WebSocket, sym: string) {
    socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: sym, priceOnly: true }));
  }

  useEffect(() => {
    function connect() {
      const socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        setIsConnected(true);
        isBgFetch.current = false;
        socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: '2330.TW', range: '1Y' }));
        setLoadingData(true);
        autoQueue.current = ['2454.TW', '2317.TW', '2412.TW', 'AAPL', 'NVDA'];
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'stockData') {
            if (message.data) {
              const fresh = message.data;
              const localizedName = taiwanStockNames[fresh.symbol] || fresh.name || fresh.symbol;
              setWatchlist(prev => prev.map(item =>
                item.symbol.split('.')[0].toUpperCase() === fresh.symbol.split('.')[0].toUpperCase()
                  ? { ...item, price: fresh.price, changePercent: fresh.changePercent, name: localizedName }
                  : item
              ));
              if (!isBgFetch.current) {
                setLoadingData(false);
                setSelectedStock({ ...fresh, name: localizedName });
              }
              // 價格警報：每次報價更新都檢查（含背景抓取）
              const { symbol: sym, price: px } = fresh;
              const isTWsym = /\.(TW|TWO)$/i.test(sym);
              const curr = isTWsym ? 'NT$' : '$';
              setAlerts(prev => {
                let changed = false;
                const next = prev.map(a => {
                  if (a.symbol !== sym || a.triggeredAt) return a;
                  const hit = a.direction === 'above' ? px >= a.targetPrice : px <= a.targetPrice;
                  if (!hit) return a;
                  changed = true;
                  if (Notification.permission === 'granted') {
                    try {
                      new Notification(`🔔 ${sym} 價格警報`, {
                        body: `${a.name} 已${a.direction === 'above' ? '突破' : '跌破'} ${curr}${a.targetPrice}　現價：${curr}${px}`,
                      });
                    } catch { /* Safari may throw */ }
                  }
                  return { ...a, triggeredAt: new Date().toLocaleString('zh-TW') };
                });
                if (changed) { saveAlerts(next); return next; }
                return prev;
              });
            } else if (!isBgFetch.current) {
              setLoadingData(false);
              alert(message.error || '無法取得資料');
            }
          }

          // rangeOnly 回傳的 chartData：只更新 history
          if (message.type === 'chartData') {
            if (message.data?.history) {
              setSelectedStock(prev => prev ? { ...prev, history: message.data.history } : prev);
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

          if (message.type === 'done') {
            const next = autoQueue.current.shift();
            if (next && socket.readyState === WebSocket.OPEN) {
              isBgFetch.current = true;
              sendBgFetch(socket, next);
            } else if (!next) {
              isBgFetch.current = false;
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
    autoQueue.current = [];
    isBgFetch.current = false;
    setAiAnalysis('');
    setAiMetrics({});
    setLoadingData(true);
    ws.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbolStr.trim().toUpperCase(), range }));
  };

  const handleRangeChange = (newRange: string) => {
    setRange(newRange);
    if (!selectedStock || !ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({
      action: 'requestAnalysis',
      symbol: selectedStock.symbol,
      range: newRange,
      rangeOnly: true,
    }));
  };

  const addAlert = async () => {
    const price = parseFloat(newAlertPrice);
    if (!selectedStock || isNaN(price) || price <= 0) return;
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    const a: PriceAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      symbol: selectedStock.symbol,
      name: selectedStock.name,
      targetPrice: price,
      direction: newAlertDir,
    };
    setAlerts(prev => { const next = [...prev, a]; saveAlerts(next); return next; });
    setNewAlertPrice('');
  };

  const deleteAlert = (id: string) => {
    setAlerts(prev => { const next = prev.filter(a => a.id !== id); saveAlerts(next); return next; });
  };

  const stockAlerts    = selectedStock ? alerts.filter(a => a.symbol === selectedStock.symbol) : [];
  const activeAlertCnt = stockAlerts.filter(a => !a.triggeredAt).length;

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

        <div className="flex-1 overflow-y-auto p-6 pb-0">
          {loadingData ? (
            <div className="h-full flex items-center justify-center text-[11px] tracking-wider text-[#6B7280]">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#38BDF8] mr-3"></div>
              FETCHING MARKET DATA...
            </div>
          ) : selectedStock ? (
            <div className="flex gap-6">
              <div className="flex-1 flex flex-col space-y-6 min-w-0">
                <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6 relative">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-xl font-serif font-bold text-white">{selectedStock.symbol} <span className="text-xs text-[#6B7280] font-normal">{selectedStock.name}</span></h1>
                      <div className="text-3xl font-mono text-white mt-2">{selectedStock.price}</div>
                      <div className={`text-xs font-mono mt-1 ${selectedStock.changePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{selectedStock.changePercent >= 0 ? '▲' : '▼'} {Math.abs(selectedStock.changePercent)}%</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 警報按鈕 */}
                      <button
                        onClick={() => setShowAlertPanel(v => !v)}
                        title="設定價格警報"
                        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[10px] font-mono transition-colors ${
                          showAlertPanel
                            ? 'bg-[#38BDF8]/15 border-[#38BDF8]/30 text-[#38BDF8]'
                            : 'border-[#1F2431] text-[#4B5563] hover:text-[#9CA3AF]'
                        }`}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                        </svg>
                        警報
                        {activeAlertCnt > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                            {activeAlertCnt}
                          </span>
                        )}
                      </button>
                      {/* 操作建議徽章 */}
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
                  </div>

                  {/* 價格警報抽屜 */}
                  {showAlertPanel && (
                    <div className="mt-4 border border-[#1F2431] rounded-lg overflow-hidden">
                      <div className="px-4 py-2 bg-[#0E121A] border-b border-[#151922] flex items-center justify-between">
                        <span className="text-[10px] font-mono tracking-widest text-[#4B5563]">PRICE ALERTS — {selectedStock.symbol}</span>
                        <span className="text-[10px] text-[#6B7280] font-mono">現價 {/\.(TW|TWO)$/i.test(selectedStock.symbol) ? 'NT$' : '$'}{selectedStock.price}</span>
                      </div>
                      <div className="p-4 bg-[#0A0D14] space-y-3">
                        {/* 新增警報表單 */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setNewAlertDir('above')}
                            className={`text-[10px] px-2.5 py-1 rounded border transition-colors whitespace-nowrap ${newAlertDir === 'above' ? 'border-emerald-500/50 text-emerald-400 bg-emerald-400/10' : 'border-[#1F2431] text-[#4B5563] hover:text-[#9CA3AF]'}`}>
                            ▲ 高於
                          </button>
                          <button
                            onClick={() => setNewAlertDir('below')}
                            className={`text-[10px] px-2.5 py-1 rounded border transition-colors whitespace-nowrap ${newAlertDir === 'below' ? 'border-rose-500/50 text-rose-400 bg-rose-400/10' : 'border-[#1F2431] text-[#4B5563] hover:text-[#9CA3AF]'}`}>
                            ▼ 低於
                          </button>
                          <input
                            type="number"
                            value={newAlertPrice}
                            onChange={e => setNewAlertPrice(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addAlert()}
                            placeholder={String(selectedStock.price)}
                            className="flex-1 min-w-0 bg-[#07090E] border border-[#1F2431] rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-[#38BDF8]/50 font-mono"
                          />
                          <button
                            onClick={addAlert}
                            className="text-[10px] px-3 py-1 bg-[#38BDF8]/10 border border-[#38BDF8]/20 text-[#38BDF8] rounded hover:bg-[#38BDF8]/20 transition-colors font-mono whitespace-nowrap">
                            設定
                          </button>
                        </div>
                        {/* 警報列表 */}
                        {stockAlerts.length > 0 ? (
                          <div className="space-y-1.5 border-t border-[#151922] pt-3">
                            {stockAlerts.map(a => (
                              <div key={a.id} className={`flex items-center justify-between font-mono text-[10px] ${a.triggeredAt ? 'opacity-40' : ''}`}>
                                <div className="flex items-center gap-2">
                                  <span className={a.direction === 'above' ? 'text-emerald-400' : 'text-rose-400'}>
                                    {a.direction === 'above' ? '▲' : '▼'}
                                  </span>
                                  <span className="text-white">{a.targetPrice}</span>
                                  {a.triggeredAt && (
                                    <span className="text-amber-400 text-[9px]">已觸發 {a.triggeredAt}</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => deleteAlert(a.id)}
                                  className="text-[#4B5563] hover:text-rose-400 transition-colors ml-3 text-[12px] leading-none">
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-[#4B5563] text-center py-1 font-mono">尚未設定警報</p>
                        )}
                        {Notification.permission === 'denied' && (
                          <p className="text-[9px] text-rose-400/70 text-center">⚠ 瀏覽器通知已被封鎖，請在設定中允許</p>
                        )}
                      </div>
                    </div>
                  )}

                  <StockChart
                    history={selectedStock.history}
                    isTW={/\.(TW|TWO)$/i.test(selectedStock.symbol)}
                    range={range}
                    onRangeChange={handleRangeChange}
                    events={[
                      ...(selectedStock.exDivDate    ? [{ date: selectedStock.exDivDate,    type: 'exdiv'    as const }] : []),
                      ...(selectedStock.earningsDate ? [{ date: selectedStock.earningsDate, type: 'earnings' as const }] : []),
                    ]}
                  />
                </div>

                <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6">
                  <h3 className="text-xs font-serif font-bold text-[#38BDF8] mb-4">AI ANALYSIS • LLAMA-3.1-8B</h3>
                  <div className="text-xs font-serif text-[#9CA3AF] leading-relaxed whitespace-pre-wrap">
                    {aiAnalysis
                      ? aiAnalysis.replace(/^METRICS\|[^\n]*\n?/m, '').trimStart()
                      : '正在深入挖掘基本面與目標價，生成報告中...'}
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#151922] text-[11px] text-[#7a9cc0] leading-relaxed">
                    ⚠ 以上分析及目標價<span className="font-semibold">僅供參考，不構成投資建議</span>。投資有風險，進場需謹慎。
                  </div>
                </div>
              </div>

              <div className="w-72 bg-[#0A0D14] border border-[#151922] rounded-lg p-6 flex flex-col overflow-y-auto flex-shrink-0">

                {/* 重大事件日期 */}
                {(selectedStock.earningsDate || selectedStock.exDivDate) && (
                  <div className="mb-4 space-y-1.5 border-b border-[#151922] pb-4">
                    <div className="text-[10px] font-mono tracking-widest text-[#4B5563] mb-2">UPCOMING EVENTS</div>
                    {selectedStock.earningsDate && (
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        <span className="text-[#6B7280]">財報日</span>
                        <span className="text-amber-400 ml-auto">{selectedStock.earningsDate}</span>
                      </div>
                    )}
                    {selectedStock.exDivDate && (
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] flex-shrink-0" />
                        <span className="text-[#6B7280]">除息日</span>
                        <span className="text-[#38BDF8] ml-auto">{selectedStock.exDivDate}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 分析師評級 */}
                {(selectedStock.analystTotal ?? 0) > 0 && (() => {
                  const total = selectedStock.analystTotal!;
                  const buy   = selectedStock.analystBuy  ?? 0;
                  const hold  = selectedStock.analystHold ?? 0;
                  const sell  = selectedStock.analystSell ?? 0;
                  const buyPct  = Math.round(buy  / total * 100);
                  const holdPct = Math.round(hold / total * 100);
                  const sellPct = 100 - buyPct - holdPct;
                  return (
                    <div className="mb-4 border-b border-[#151922] pb-4">
                      <div className="text-[10px] font-mono tracking-widest text-[#4B5563] mb-3">ANALYST CONSENSUS</div>
                      <div className="flex h-1.5 rounded overflow-hidden mb-2">
                        <div style={{ width: `${buyPct}%` }}  className="bg-emerald-500" />
                        <div style={{ width: `${holdPct}%` }} className="bg-amber-400" />
                        <div style={{ width: `${sellPct}%` }} className="bg-rose-500" />
                      </div>
                      <div className="flex justify-between text-[9px] font-mono mt-1.5">
                        <span className="text-emerald-400">買進 {buy}<span className="text-[#4B5563] ml-0.5">({buyPct}%)</span></span>
                        <span className="text-amber-400">持有 {hold}</span>
                        <span className="text-rose-400">賣出 {sell}<span className="text-[#4B5563] ml-0.5">({sellPct}%)</span></span>
                      </div>
                      <div className="text-[9px] text-[#4B5563] text-center mt-1 font-mono">共 {total} 位分析師</div>
                    </div>
                  );
                })()}

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

                  <div className="pt-3 space-y-2">
                    {selectedStock.analystTargetPrice && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-[#6B7280] font-serif text-[10px]">分析師均價</span>
                        <span className="text-amber-400 font-mono text-xs">{selectedStock.analystTargetPrice}</span>
                      </div>
                    )}
                    <div className="flex justify-between pb-2 bg-[#111622] px-2 -mx-2 rounded">
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
            </div>
          ) : null}
        </div>

        {/* Disclaimer footer */}
        <div className="flex-shrink-0 px-6 py-2 border-t border-[#151922] bg-[#0A0D14] text-[11px] text-[#7a9cc0] leading-relaxed">
          <span className="font-bold text-[#a0b8d8]">⚠ 免責聲明：</span>
          本平台提供之股票資訊、AI 分析報告及目標價均<span className="font-semibold text-[#a0b8d8]">僅供參考，不構成任何投資建議或要約</span>。AI 分析結果基於公開資料自動生成，不保證準確性與完整性。投資人應自行評估風險，並在必要時諮詢專業投資顧問。<span className="font-semibold text-[#a0b8d8]">投資有風險，進場需謹慎，過去表現不代表未來結果。</span>
        </div>
      </div>
    </div>
  );
}
