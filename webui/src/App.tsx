import React, { useState, useEffect, useRef } from 'react';

// 硬編碼直接焊死 Render 後端 WebSocket 網址
const WS_URL = 'wss://stockprice-2ukw.onrender.com';

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
  // 初始自選股清單（先給預設名字，點擊後會由後端即時刷新數據）
  const [watchlist, setWatchlist] = useState([
    { symbol: '2330.TW', name: '台積電', price: 875, changePercent: 2.1 },
    { symbol: '2454.TW', name: '聯發科', price: 1180, changePercent: 2.79 },
    { symbol: '2317.TW', name: '鴻海', price: 182, changePercent: -1.35 },
    { symbol: '2412.TW', name: '中華電', price: 121, changePercent: 0.41 },
    { symbol: 'AAPL', name: '蘋果', price: 195.3, changePercent: 0.5 },
    { symbol: 'NVDA', name: '輝達', price: 920.5, changePercent: 3.82 }
  ]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStock, setSelectedStock] = useState<StockData | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isConnecting, setIsConnecting] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const ws = useRef<WebSocket | null>(null);

  // 初始化 WebSocket 連線
  useEffect(() => {
    function connect() {
      setIsConnecting(true);
      console.log('Connecting to Backend:', WS_URL);
      const socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        console.log('WebSocket Connected! 🎉');
        // 預設第一次上線，自動幫忙撈第一檔 2330 的真資料
        socket.send(JSON.stringify({ action: 'requestAnalysis', symbol: '2330.TW' }));
        setLoadingData(true);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // 1. 抓到真 Yahoo 股價與歷史 K 線數據
          if (message.type === 'stockData' && message.data) {
            const fresh = message.data;
            setLoadingData(false);
            
            // 強制更新當前畫面選中的股票 (包含 52週高低點、PE等所有真欄位)
            setSelectedStock({
              symbol: fresh.symbol,
              name: fresh.name || fresh.symbol,
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

            // 同步更新左側 Watchlist 裡的即時價格與漲跌
            setWatchlist(prev => prev.map(item => {
              if (item.symbol.toUpperCase() === fresh.symbol.toUpperCase() || 
                  item.symbol.split('.')[0] === fresh.symbol.split('.')[0]) {
                return { ...item, price: fresh.price, changePercent: fresh.changePercent };
              }
              return item;
            }));
          }

          // 2. 抓到 Groq 噴回來的動態 AI 串流
          if (message.type === 'aiChunk') {
            setAiAnalysis(prev => prev + message.text);
          }

          // 3. 串流結束
          if (message.type === 'done') {
            console.log('AI Analysis Done.');
          }
        } catch (err) {
          console.error('Error parsing ws message:', err);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        console.log('WebSocket Disconnected. Reconnecting in 5s...');
        setTimeout(connect, 5000);
      };

      ws.current = socket;
    }

    connect();
    return () => ws.current?.close();
  }, []);

  // 核心功能：向後端請求任意股票代碼（支援搜尋與自選股點擊）
  const handleQueryStock = (symbolStr: string) => {
    if (!symbolStr) return;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      setAiAnalysis(''); // 清空舊分析
      setLoadingData(true);
      // 直接把代碼送去後端 (後端會透過 toYahooSymbol 自動處理 2330 -> 2330.TW)
      ws.current.send(JSON.stringify({ action: 'requestAnalysis', symbol: symbolStr.trim() }));
    } else {
      alert('後端尚未連線，請稍後再試！');
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleQueryStock(searchQuery);
    setSearchQuery('');
  };

  return (
    <div className="flex h-screen w-screen bg-[#0B0E14] text-[#E2E8F0] font-sans overflow-hidden">
      {/* 左側自選股清單 */}
      <div className="w-80 border-r border-[#1E293B] bg-[#0F131A] flex flex-col">
        <div className="p-4 border-b border-[#1E293B]">
          <h2 className="text-sm font-semibold tracking-wider text-[#94A3B8] uppercase">Watchlist 自選股</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {watchlist.map((stock) => (
            <div 
              key={stock.symbol}
              onClick={() => handleQueryStock(stock.symbol)}
              className={`p-4 flex justify-between items-center border-b border-[#1E293B] cursor-pointer hover:bg-[#1E2530] transition-colors ${selectedStock?.symbol === stock.symbol ? 'bg-[#161F2E]' : ''}`}
            >
              <div>
                <div className="font-bold text-white">{stock.symbol.split('.')[0]}</div>
                <div className="text-xs text-[#64748B]">{stock.name}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-white">NT${stock.price}</div>
                <div className={`text-xs font-medium ${stock.changePercent >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右側主要戰情室 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 頂部導航與搜尋框 */}
        <header className="h-16 border-b border-[#1E293B] bg-[#0F131A] flex items-center justify-between px-6 flex-shrink-0">
          <form onSubmit={handleSearchSubmit} className="flex-1 max-w-xl">
            <div className="relative">
              <input 
                type="text"
                placeholder="搜尋任意台股或美股代碼... (例如: 2330, 2412, AAPL, NVDA)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-4 py-2 pl-10 text-sm text-white focus:outline-none focus:border-[#58A6FF] transition-colors"
              />
              <div className="absolute left-3 top-2.5 text-[#64748B]">🔍</div>
            </div>
          </form>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-[#161B22] px-3 py-1.5 rounded-full border border-[#30363D]">
              <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[#10B981] animate-pulse' : 'bg-[#EF4444]'}`}></span>
              <span className="text-xs font-medium text-[#94A3B8]">
                {isConnected ? '● 已連線後端' : isConnecting ? '連線中...' : '● 斷線重連中'}
              </span>
            </div>
          </div>
        </header>

        {/* 核心主面板 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loadingData ? (
            <div className="h-full w-full flex items-center justify-center flex-col space-y-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#58A6FF]"></div>
              <div className="text-sm text-[#94A3B8]">正在向 Yahoo Finance 調閱真實即時數據...</div>
            </div>
          ) : selectedStock ? (
            <div className="grid grid-cols-3 gap-6">
              {/* 左與中：股價與 K 線圖 */}
              <div className="col-span-2 space-y-6">
                <div className="bg-[#0F131A] border border-[#1E293B] rounded-xl p-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center space-x-3">
                        <h1 className="text-3xl font-extrabold text-white tracking-tight">{selectedStock.symbol}</h1>
                        <span className="bg-[#1E293B] text-[#94A3B8] text-xs font-semibold px-2.5 py-1 rounded-md">{selectedStock.name}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-black text-white tracking-tight">
                        {selectedStock.symbol.includes('.') ? 'NT$' : '$'}{selectedStock.price}
                      </div>
                      <div className={`text-sm font-bold ${selectedStock.change >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
                        {selectedStock.change >= 0 ? '▲' : '▼'} {Math.abs(selectedStock.change)} ({selectedStock.changePercent}%)
                      </div>
                    </div>
                  </div>

                  {/* 簡易 SVG 趨勢線渲染（全動態歷史 K 線數據） */}
                  <div className="h-64 mt-6 border-t border-[#1E293B] pt-4 flex items-end justify-between relative">
                    {selectedStock.history && selectedStock.history.length > 0 ? (
                      <>
                        <div className="absolute top-2 left-2 text-[10px] text-[#475569]">Yahoo Finance 歷史年線走勢</div>
                        {/* 這裡動態映射後端抓回來的一整年收盤價 */}
                        <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                          <polyline
                            fill="none"
                            stroke="#10B981"
                            strokeWidth="1.5"
                            points={selectedStock.history.map((h, i) => {
                              const minClose = Math.min(...selectedStock.history.map(x => x.close));
                              const maxClose = Math.max(...selectedStock.history.map(x => x.close));
                              const xCoord = (i / (selectedStock.history.length - 1)) * 100;
                              const yCoord = 100 - ((h.close - minClose) / (maxClose - minClose || 1)) * 80 - 10;
                              return `${xCoord},${yCoord}`;
                            }).join(' ')}
                          />
                        </svg>
                      </>
                    ) : (
                      <div className="w-full text-center text-xs text-[#64748B]">暫無歷史 K 線圖數據</div>
                    )}
                  </div>
                </div>

                {/* AI 分析報告面板 */}
                <div className="bg-[#0F131A] border border-[#1E293B] rounded-xl p-6">
                  <h3 className="text-sm font-bold text-[#58A6FF] uppercase tracking-wider mb-4">🤖 Groq Llama3 實時 AI 投資分析</h3>
                  <div className="text-sm text-[#E2E8F0] leading-relaxed whitespace-pre-wrap min-h-[150px] bg-[#161B22] p-4 rounded-lg border border-[#30363D]">
                    {aiAnalysis || '正在等待 AI 梳理市場核心數據並噴發報告...'}
                  </div>
                </div>
              </div>

              {/* 右側：真實關鍵財務指標面板 */}
              <div className="bg-[#0F131A] border border-[#1E293B] rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#94A3B8] uppercase tracking-wider mb-4">關鍵核心指標</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">市值</span>
                      <span className="font-semibold text-white">{selectedStock.marketCap}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">本益比 (PE)</span>
                      <span className="font-semibold text-white">{selectedStock.peRatio}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">每股盈餘 (EPS)</span>
                      <span className="font-semibold text-white">{selectedStock.eps}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">成交量</span>
                      <span className="font-semibold text-white">{selectedStock.volume}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">52週最高</span>
                      <span className="font-semibold text-[#10B981]">{selectedStock.high52w}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">52週最低</span>
                      <span className="font-semibold text-[#EF4444]">{selectedStock.low52w}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">殖利率</span>
                      <span className="font-semibold text-white">{selectedStock.dividendYield}</span>
                    </div>
                    <div className="flex justify-between border-b border-[#1E293B] pb-2 text-sm">
                      <span className="text-[#64748B]">Beta 值</span>
                      <span className="font-semibold text-white">{selectedStock.beta}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full w-full flex items-center justify-center flex-col text-[#64748B] space-y-2">
              <span className="text-4xl">📈</span>
              <p>請在上方搜尋框輸入任意代碼，或從左側自選股中挑選一檔股票開始看盤</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
