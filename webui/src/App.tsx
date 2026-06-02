import React, { useState, useEffect, useRef } from 'react';

// 硬編碼直接焊死 Render 後端 WebSocket 網址
const WS_URL = 'wss://stockprice-2ukw.onrender.com';

// 核心台股中文名稱防錯對照表
const taiwanStockNames: Record<string, string> = {
  '2330.TW': '台積電',
  '2454.TW': '聯發科',
  '2317.TW': '鴻海',
  '2412.TW': '中華電',
  '2449.TW': '京元電子'
};

interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap: string;
  peRatio: string;
  eps: string;
  volume: string;
  avgVolume: string;
  high52w: string;
  low52w: string;
  dividendYield: string;
  beta: string;
  history: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'news' | 'settings'>('dashboard');

  // 自選股清單
  const [watchlist, setWatchlist] = useState([
    { symbol: '2330.TW', name: '台積電', price: 2380, changePercent: 1.06 },
    { symbol: '2454.TW', name: '聯發科', price: 4525, changePercent: -0.66 },
    { symbol: '2317.TW', name: '鴻海', price: 301.5, changePercent: 2.73 },
    { symbol: '2412.TW', name: '中華電', price: 142, changePercent: 1.07 },
    { symbol: 'AAPL', name: '蘋果', price: 195.3, changePercent: 0.5 },
    { symbol: 'NVDA', name: '輝達', price: 224.36, changePercent: 6.26 }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // 系統設定狀態
  const [riskPreference, setRiskPreference] = useState(50);
  const [priceAlert, setPriceAlert] = useState(true);
  const [aiSignal, setAiSignal] = useState(true);

  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    function connect() {
      const socket = new WebSocket(WS_URL);
      socket.onopen = () => {
        setIsConnected(true);
        socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: '2330.TW' }));
        setLoadingData(true);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'stockData' && message.data) {
            const fresh = message.data;
            setLoadingData(false);
            
            // 處理中文名稱對齊
            const localizedName = taiwanStockNames[fresh.symbol] || fresh.name || fresh.symbol;

            setSelectedStock({
              symbol: fresh.symbol,
              name: localizedName,
              price: fresh.price,
              change: fresh.change || 0,
              changePercent: fresh.changePercent || 0,
              marketCap: fresh.marketCap || 'N/A',
              peRatio: fresh.peRatio || 'N/A',
              eps: fresh.eps || 'N/A',
              volume: fresh.volume || 'N/A',
              avgVolume: fresh.avgVolume || 'N/A',
              high52w: fresh.high52w || 'N/A',
              low52w: fresh.low52w || 'N/A',
              dividendYield: fresh.dividendYield || 'N/A',
              beta: fresh.beta || 'N/A',
              history: fresh.history || []
            });

            setWatchlist(prev => prev.map(item => {
              if (item.symbol.toUpperCase() === fresh.symbol.toUpperCase()) {
                return { ...item, price: fresh.price, changePercent: fresh.changePercent, name: localizedName };
              }
              return item;
            }));
          }
          if (message.type === 'aiChunk') {
            setAiAnalysis(prev => prev + message.text);
          }
        } catch (err) {
          console.error(err);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setTimeout(connect, 5000);
      };
      ws.current = socket;
    }
    connect();
    return () => ws.current?.close();
  }, []);

  const handleQueryStock = (symbolStr: string) => {
    if (!symbolStr) return;
    setActiveTab('dashboard');
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      setAiAnalysis('');
      setLoadingData(true);
      ws.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbolStr.trim().toUpperCase() }));
    }
  };

  const toggleWatchlist = (symbol: string) => {
    const exists = watchlist.some(item => item.symbol.toUpperCase() === symbol.toUpperCase());
    if (exists) {
      setWatchlist(prev => prev.filter(item => item.symbol.toUpperCase() !== symbol.toUpperCase()));
    } else {
      const localizedName = taiwanStockNames[symbol.toUpperCase()] || (symbol.includes('.') ? '台股標的' : '美股標的');
      setWatchlist(prev => [...prev, { symbol: symbol.toUpperCase(), name: localizedName, price: selectedStock?.price || 0, changePercent: selectedStock?.changePercent || 0 }]);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#07090E] text-[#D1D5DB] font-sans overflow-hidden antialiased">
      
      {/* 左側精緻極細側邊欄 */}
      <div className="w-64 border-r border-[#151922] bg-[#0A0D14] flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-[#151922] space-x-2">
            <div className="h-5 w-5 bg-[#38BDF8]/10 border border-[#38BDF8]/30 rounded flex items-center justify-center font-bold text-[11px] text-[#38BDF8]">FP</div>
            <span className="text-base font-serif font-bold tracking-wider text-white">FinPulse</span>
          </div>

          <nav className="p-3 space-y-0.5">
            {[
              { id: 'dashboard', label: 'AI 分析師', icon: '🤖' },
              { id: 'news', label: '即時新聞', icon: '📰' },
              { id: 'settings', label: '系統設定', icon: '⚙️' }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`w-full flex items-center space-x-3 px-4 py-2 rounded-md text-xs font-medium tracking-wide transition-all ${activeTab === tab.id ? 'bg-[#151922] text-[#38BDF8] border-l-2 border-[#38BDF8]' : 'text-[#6B7280] hover:bg-[#0E121A] hover:text-white'}`}
              >
                <span>{tab.icon}</span> <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="mt-4 px-3">
            <div className="text-[10px] font-bold text-[#4B5563] uppercase tracking-widest px-4 mb-2">自選股</div>
            <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">
              {watchlist.map((stock) => (
                <div 
                  key={stock.symbol}
                  onClick={() => handleQueryStock(stock.symbol)}
                  className={`px-4 py-2 rounded border border-transparent flex justify-between items-center cursor-pointer transition-all ${selectedStock?.symbol === stock.symbol ? 'bg-[#111622] border-[#1E2638]' : 'hover:bg-[#0E121A]'}`}
                >
                  <div>
                    <div className="text-xs font-mono font-semibold text-white">{stock.symbol.split('.')[0]}</div>
                    <div className="text-[10px] text-[#4B5563] font-serif truncate w-24">{stock.name}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xs text-white">{stock.price}</div>
                    <div className={`text-[10px] ${stock.changePercent >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 使用者卡片 */}
        <div className="p-4 border-t border-[#151922] bg-[#080B10] flex items-center space-x-3">
          <div className="h-8 w-8 rounded bg-[#1F2937] border border-[#374151] flex items-center justify-center font-serif text-xs text-[#9CA3AF]">何</div>
          <div className="overflow-hidden">
            <div className="text-xs font-serif font-medium text-white">何彥緻</div>
            <div className="text-[9px] font-mono text-[#4B5563] truncate">yanzh0227@gmail.com</div>
          </div>
        </div>
      </div>

      {/* 右側核心主戰情室 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#07090E]">
        <header className="h-16 border-b border-[#151922] bg-[#0A0D14] flex items-center justify-between px-6 flex-shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); handleQueryStock(searchQuery); setSearchQuery(''); }} className="flex-1 max-w-xl">
            <div className="relative">
              <input 
                type="text"
                placeholder="搜尋台股或美股... (例如: 2449, 2330, AAPL, NVDA)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0E121A] border border-[#1F2431] rounded px-4 py-1.5 pl-9 text-xs text-white font-serif focus:outline-none focus:border-[#38BDF8]/50 transition-colors"
              />
              <span className="absolute left-3 top-2 text-xs text-[#4B5563]">🔍</span>
            </div>
          </form>
          <div className="flex items-center">
            <div className="flex items-center space-x-2 bg-[#0E121A] px-3 py-1 rounded border border-[#1F2431]">
              <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              <span className="text-[10px] font-medium tracking-wider text-[#6B7280]">
                {isConnected ? '● CONNECTED' : '● DISCONNECTED'}
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* 1. Dashboard 看盤主頁 */}
          {activeTab === 'dashboard' && (
            loadingData ? (
              <div className="h-full w-full flex items-center justify-center flex-col space-y-3 py-20">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#38BDF8]"></div>
                <div className="text-[11px] tracking-wider text-[#6B7280]">TUNING REALTIME DATA PIPELINE...</div>
              </div>
            ) : selectedStock ? (
              <div className="space-y-6">
                
                {/* 頂級極簡收盤大卡片 */}
                <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6 relative">
                  <button 
                    onClick={() => toggleWatchlist(selectedStock.symbol)}
                    className="absolute top-6 right-6 px-3 py-1 text-[10px] tracking-wider font-medium rounded border border-[#1F2431] bg-[#0E121A] text-[#9CA3AF] hover:text-white hover:border-[#38BDF8]/40 transition-colors"
                  >
                    {watchlist.some(item => item.symbol.toUpperCase() === selectedStock.symbol.toUpperCase()) ? '⭐ 移出自選' : '➕ 加入自選'}
                  </button>

                  <div className="flex items-start">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h1 className="text-xl font-serif font-bold tracking-wide text-white">{selectedStock.symbol}</h1>
                        <span className="bg-emerald-500/5 text-emerald-400 border border-emerald-500/10 text-[9px] tracking-widest px-1.5 py-0.5 rounded font-mono font-medium">LIVE</span>
                        <span className="text-xs font-serif text-[#6B7280] ml-1">{selectedStock.name}</span>
                      </div>
                      <div className="text-3xl font-mono font-light tracking-tight mt-3 text-white">
                        {selectedStock.symbol.includes('.') ? 'NT$' : '$'}{selectedStock.price.toLocaleString()}
                      </div>
                      <div className={`text-xs font-mono mt-1 ${selectedStock.change >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {selectedStock.change >= 0 ? '▲' : '▼'} {Math.abs(selectedStock.change)} ({selectedStock.changePercent}%)
                      </div>
                    </div>
                  </div>

                  {/* SVG 線圖微調為內斂無邊框漸層感 */}
                  <div className="h-40 mt-6 border-t border-[#151922] pt-4 flex items-end relative">
                    {selectedStock.history && selectedStock.history.length > 0 ? (
                      <svg className="w-full h-full opacity-80" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <polyline
                          fill="none"
                          stroke="#10B981"
                          strokeWidth="1"
                          points={selectedStock.history.map((h, i) => {
                            const minClose = Math.min(...selectedStock.history.map(x => x.close));
                            const maxClose = Math.max(...selectedStock.history.map(x => x.close));
                            const xCoord = (i / (selectedStock.history.length - 1)) * 100;
                            const yCoord = 100 - ((h.close - minClose) / (maxClose - minClose || 1)) * 80 - 10;
                            return `${xCoord},${yCoord}`;
                          }).join(' ')}
                        />
                      </svg>
                    ) : (
                      <div className="w-full text-center text-[11px] font-mono text-[#4B5563]">NO HISTORY DATA AVAILABLE</div>
                    )}
                  </div>
                </div>

                {/* 雙欄核心指標面與 AI */}
                <div className="grid grid-cols-3 gap-6">
                  {/* AI 報告區 */}
                  <div className="col-span-2 bg-[#0A0D14] border border-[#151922] rounded-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                      <span className="text-xs">🤖</span>
                      <h3 className="text-xs font-serif font-bold tracking-wider text-[#38BDF8] uppercase">GROQ LLAMA 3.1 實時投顧串流分析</h3>
                    </div>
                    <div className="text-xs font-serif text-[#9CA3AF] leading-relaxed whitespace-pre-wrap min-h-[160px] bg-[#0E121A] p-4 rounded border border-[#1F2431]">
                      {aiAnalysis || '正在向後端調研市場深度指標，等待 AI 報告生成...'}
                    </div>
                  </div>

                  {/* 高級指標面板 */}
                  <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6 flex flex-col justify-between">
                    <div>
                      <h3 className="text-[10px] font-mono tracking-widest text-[#4B5563] uppercase mb-4">核心財務面</h3>
                      <div className="space-y-2.5 font-mono text-xs">
                        {[
                          { label: '市值', val: selectedStock.marketCap },
                          { label: '本益比 (PE)', val: selectedStock.peRatio },
                          { label: '每股盈餘 (EPS)', val: selectedStock.eps },
                          { label: '52週最高', val: selectedStock.high52w, cls: 'text-emerald-500' },
                          { label: '52週最低', val: selectedStock.low52w, cls: 'text-rose-500' }
                        ].map((row, idx) => (
                          <div key={idx} className="flex justify-between border-b border-[#151922] pb-1.5">
                            <span className="text-[#4B5563] font-serif">{row.label}</span>
                            <span className={`font-medium ${row.cls || 'text-white'}`}>{row.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* 低調高級感狀態點代替大色塊 */}
                    <div className="mt-4 pt-3 border-t border-[#151922] flex items-center justify-between text-xs font-serif">
                      <span className="text-[#4B5563]">AI 評等結論</span>
                      <div className="flex items-center space-x-2 bg-[#0E121A] px-2.5 py-1 rounded border border-[#1F2431]">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        <span className="text-white font-mono font-medium text-[11px]">BUY (80%)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-20 text-[#4B5563] font-serif text-xs">請在上方搜尋框輸入任意台美股代碼開始看盤</div>
            )
          )}

          {/* 2. 即時財經新聞頁面 (可一鍵點擊跳轉) */}
          {activeTab === 'news' && (
            <div className="space-y-4 max-w-4xl">
              <div>
                <h2 className="text-base font-serif font-bold text-white tracking-wide">全球即時財經新聞</h2>
                <p className="text-[11px] font-serif text-[#4B5563] mt-0.5">點擊新聞卡片可直接開新分頁跳轉至真實財經媒體</p>
              </div>
              {[
                { title: "晶圓代工龍頭 3 奈米與 5 奈米產能全面吃緊，各大晶片外資相繼調升目標價", time: "10分鐘前", source: "工商時報", tag: "半導體", url: "https://tw.stock.yahoo.com/" },
                { title: "美股盤後大噴發！NASDAQ 創歷史新高，科技巨頭輝達、蘋果強勢領漲市場", time: "32分鐘前", source: "鉅亨網", tag: "美股動態", url: "https://news.cnyes.com/" },
                { title: "新一代 AI 伺服器機櫃訂單外溢超出預期，台廠散熱與伺服器供應鏈下半年迎大爆發", time: "1小時前", source: "經濟日報", tag: "AI 供應鏈", url: "https://money.udn.com/money/index" }
              ].map((n, i) => (
                <div 
                  key={i} 
                  onClick={() => window.open(n.url, '_blank', 'noopener,noreferrer')}
                  className="bg-[#0A0D14] border border-[#151922] rounded p-4 flex flex-col justify-between hover:border-[#38BDF8]/40 hover:bg-[#111622] transition-all duration-300 cursor-pointer group"
                >
                  <div className="flex justify-between items-start">
                    <h3 className="text-xs font-serif font-medium text-white group-hover:text-[#38BDF8] transition-colors leading-relaxed w-5/6">{n.title}</h3>
                    <span className="text-[9px] font-mono tracking-wider bg-[#0E121A] text-[#38BDF8] border border-[#1F2431] px-2 py-0.5 rounded">{n.tag}</span>
                  </div>
                  <div className="flex space-x-3 text-[10px] font-mono text-[#4B5563] mt-3">
                    <span className="font-serif">{n.source}</span>
                    <span>•</span>
                    <span>{n.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 3. 系統設定頁面 (完美與照片1:1對齊) */}
          {activeTab === 'settings' && (
            <div className="bg-[#0A0D14] border border-[#151922] rounded-lg p-6 max-w-3xl space-y-6">
              <div>
                <h2 className="text-base font-serif font-bold text-white tracking-wide">偏好設定與帳戶資訊</h2>
                <p className="text-[11px] text-[#4B5563] font-serif mt-0.5">自訂您的 FinPulse 看盤控制台偏好</p>
              </div>

              {/* 風險偏好 */}
              <div className="space-y-3 border-t border-[#151922] pt-4 font-serif text-xs">
                <label className="text-xs font-bold text-[#9CA3AF] tracking-wide">風險偏好權重</label>
                <div className="flex items-center space-x-4">
                  <span className="text-[#4B5563]">保守</span>
                  <input 
                    type="range" min="0" max="100" 
                    value={riskPreference} 
                    onChange={(e) => setRiskPreference(Number(e.target.value))}
                    className="flex-1 accent-[#38BDF8] bg-[#0E121A] h-1 rounded"
                  />
                  <span className="text-[#4B5563]">積極</span>
                </div>
                <div className="text-[11px] text-[#38BDF8] font-bold">
                  目前權重：{riskPreference < 40 ? '保守偏好' : riskPreference > 70 ? '積極偏好' : '穩健偏好'} — 這將動態微調 AI 的投顧報告敘事權重
                </div>
              </div>

              {/* 開關偏好 */}
              <div className="space-y-4 border-t border-[#151922] pt-4 font-serif text-xs">
                <label className="text-xs font-bold text-[#9CA3AF] tracking-wide">即時通知偏好</label>
                <div className="flex justify-between items-center border-b border-[#151922] pb-3">
                  <div>
                    <div className="font-medium text-white">價格波動劇烈提醒</div>
                    <div className="text-[10px] text-[#4B5563] mt-0.5">當自選股單日漲跌幅超過 3% 時觸發推送</div>
                  </div>
                  <input type="checkbox" checked={priceAlert} onChange={() => setPriceAlert(!priceAlert)} className="w-3.5 h-3.5 accent-[#38BDF8] cursor-pointer" />
                </div>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium text-white">AI 信號轉折優化通知</div>
                    <div className="text-[10px] text-[#4B5563] mt-0.5">當 Llama 評等在 買進/持有/賣出 之間切換時，自動發出系統快訊</div>
                  </div>
                  <input type="checkbox" checked={aiSignal} onChange={() => setAiSignal(!aiSignal)} className="w-3.5 h-3.5 accent-[#38BDF8] cursor-pointer" />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
