// StockDashboard.tsx — Stock AI Analysis Platform
// Single-file component. Paste into src/ of any Vite + React + TypeScript project.
// Add to index.html <head>:
//   <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>

import { useState, useEffect, useRef, useCallback } from 'react';

// ── WebSocket URL ─────────────────────────────────────────────────────────────
// 優先讀取 VITE_WS_URL（GitHub Actions 建置時由 vars.VITE_WS_URL 注入）
// 未設定時指向 Render 生產環境；本機若無法連線則自動降級為 Mock 模式
const WS_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ??
  'wss://stockprice-backend.onrender.com';

// ── Types ─────────────────────────────────────────────────────────────────────

type Market    = 'TW' | 'US';
type Verdict   = 'BUY' | 'HOLD' | 'SELL';
type Sentiment = 'bullish' | 'bearish' | 'neutral';

interface Candle { o: number; h: number; l: number; c: number; v: number }

interface Stock {
  ticker: string; name: string; fullName: string;
  market: Market; currency: string; sym: string;
  price: number; change: number; pct: number;
  cap: string; pe: string; eps: string; beta: string;
  vol: string; avgVol: string; hi52: number; lo52: number; div: string;
  sector: string; verdict: Verdict; conf: number;
  target: { lo: number; mid: number; hi: number };
  risks: string[]; sentimentScore: number; sentimentLabel: string;
  analysts: { buy: number; hold: number; sell: number };
  summary: string; tags: string[];
  news: Array<{ title: string; src: string; time: string; sent: Sentiment }>;
  history: Candle[];
}

interface Msg {
  id: number; role: 'user' | 'ai';
  displayText?: string;
  isTyping?: boolean;
  isStreaming?: boolean;
  ticker?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genCandles(base: number, n = 252, trend = 0.001, vol = 0.018): Candle[] {
  let p = base;
  const raw: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = p;
    p = p * (1 + trend + (Math.random() - 0.5) * vol * 2.5);
    const sp = p * 0.004;
    raw.push({ o, h: Math.max(o, p) + Math.random() * sp, l: Math.min(o, p) - Math.random() * sp, c: p, v: Math.random() * 5e7 + 5e6 });
  }
  const sc = base / raw[raw.length - 1].c;
  return raw.map(d => ({ o: +(d.o * sc).toFixed(2), h: +(d.h * sc).toFixed(2), l: +(d.l * sc).toFixed(2), c: +(d.c * sc).toFixed(2), v: d.v }));
}

const vc  = (v: Verdict) => v === 'BUY' ? '#00d98b' : v === 'SELL' ? '#ff4060' : '#ffd666';
const vbg = (v: Verdict) => v === 'BUY' ? 'rgba(0,217,139,.12)' : v === 'SELL' ? 'rgba(255,64,96,.12)' : 'rgba(255,214,102,.12)';
const vbd = (v: Verdict) => v === 'BUY' ? 'rgba(0,217,139,.3)' : v === 'SELL' ? 'rgba(255,64,96,.3)' : 'rgba(255,214,102,.3)';

// ── Mock Data ─────────────────────────────────────────────────────────────────

const STOCKS_BASE: Omit<Stock, 'history'>[] = [
  {
    ticker: '2330', name: '台積電', fullName: '台灣積體電路製造股份有限公司',
    market: 'TW', currency: 'TWD', sym: 'NT$',
    price: 875, change: 18.00, pct: 2.10,
    cap: '22.7 兆元', pe: '27.4倍', eps: 'NT$31.92', beta: '0.88',
    vol: '2.8萬張', avgVol: '2.1萬張', hi52: 945, lo52: 520, div: '2.10%',
    sector: '半導體', verdict: 'BUY', conf: 84,
    target: { lo: 900, mid: 970, hi: 1050 },
    risks: ['台灣海峽地緣政治風險', '客戶集中度風險（蘋果、輝達合計佔50%）', '美元兌台幣匯率敞口', '半導體景氣循環下行風險'],
    sentimentScore: 76, sentimentLabel: '偏多',
    analysts: { buy: 28, hold: 6, sell: 1 },
    summary: '台積電掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈的核心骨幹。輝達與蘋果的訂單能見度延伸至 2026 年，3 奈米製程持續放量推動平均售價提升，2 奈米製程預計於 2025 年底開始試產。淨利率約 43%，外資持股比例維持高檔。',
    tags: ['AI 供應鏈', '3奈米領導者', '外資最愛'],
    news: [
      { title: '台積電 2 奈米良率超出預期，法說會將揭露細節', src: '工商時報', time: '1小時前', sent: 'bullish' },
      { title: '外資連續 8 日買超台積電，累計近 5 萬張', src: '經濟日報', time: '3小時前', sent: 'bullish' },
      { title: '台積電赴日熊本廠正式量產，有助分散地緣政治風險', src: '聯合報', time: '1天前', sent: 'bullish' },
      { title: '美中科技戰升溫，台積電對中國出口管制影響有限', src: '財訊', time: '2天前', sent: 'neutral' },
    ],
  },
  {
    ticker: '2454', name: '聯發科', fullName: '聯發科技股份有限公司',
    market: 'TW', currency: 'TWD', sym: 'NT$',
    price: 1180, change: 32.00, pct: 2.79,
    cap: '1.89 兆元', pe: '19.8倍', eps: 'NT$59.60', beta: '1.35',
    vol: '8,200張', avgVol: '6,500張', hi52: 1280, lo52: 680, div: '3.50%',
    sector: 'IC 設計', verdict: 'BUY', conf: 76,
    target: { lo: 1200, mid: 1320, hi: 1500 },
    risks: ['手機晶片市場成長趨緩', '高通競爭壓力持續', '中國客戶佔比偏高（約55%）', 'AI PC/IoT 新市場滲透率仍低'],
    sentimentScore: 70, sentimentLabel: '偏多',
    analysts: { buy: 22, hold: 9, sell: 2 },
    summary: '聯發科是全球最大的行動處理器 IC 設計公司，天璣系列 SoC 在 Android 旗艦機市佔率快速提升。AI 手機晶片（天璣 9400）整合 NPU 架構，搶攻高端市場。衛星通訊、車用與物聯網為中長期成長引擎。',
    tags: ['IC 設計龍頭', 'AI 手機', '高殖利率'],
    news: [
      { title: '聯發科天璣 9400 拿下三星 Galaxy S25 系列訂單', src: '電子時報', time: '2小時前', sent: 'bullish' },
      { title: '聯發科 Q2 營收季增 18%，超越市場預期', src: '工商時報', time: '6小時前', sent: 'bullish' },
      { title: 'AI 手機需求爆發，聯發科晶片出貨量創新高', src: 'MoneyDJ', time: '1天前', sent: 'bullish' },
    ],
  },
  {
    ticker: '2317', name: '鴻海', fullName: '鴻海精密工業股份有限公司',
    market: 'TW', currency: 'TWD', sym: 'NT$',
    price: 182, change: -2.50, pct: -1.35,
    cap: '2.53 兆元', pe: '11.2倍', eps: 'NT$16.25', beta: '0.95',
    vol: '4.2萬張', avgVol: '5.1萬張', hi52: 225, lo52: 138, div: '4.30%',
    sector: '電子代工', verdict: 'HOLD', conf: 63,
    target: { lo: 175, mid: 200, hi: 230 },
    risks: ['蘋果供應鏈集中度過高（佔45%營收）', '電動車新業務虧損期仍在持續', '中美貿易戰轉單效應不確定', '毛利率長期偏低（約6%）'],
    sentimentScore: 52, sentimentLabel: '中性',
    analysts: { buy: 14, hold: 12, sell: 5 },
    summary: '鴻海為全球最大電子製造服務商，iPhone 組裝是核心業務。電動車平台（MIH）與 AI 伺服器為新成長動能，但短期仍面臨代工業務毛利壓力。殖利率超過 4% 支撐股價下檔。',
    tags: ['蘋果供應鏈', '電動車', '高殖利率'],
    news: [
      { title: '鴻海印度廠擴產，蘋果 iPhone 供應鏈去中化加速', src: '經濟日報', time: '4小時前', sent: 'bullish' },
      { title: '鴻海電動車品牌 Foxtron 在台累計訂單破千輛', src: '工商時報', time: '1天前', sent: 'bullish' },
      { title: '蘋果 AI 功能推遲，鴻海 Q3 訂單能見度偏保守', src: '財訊', time: '2天前', sent: 'bearish' },
    ],
  },
  {
    ticker: '2412', name: '中華電', fullName: '中華電信股份有限公司',
    market: 'TW', currency: 'TWD', sym: 'NT$',
    price: 121, change: 0.50, pct: 0.41,
    cap: '9,420 億元', pe: '25.3倍', eps: 'NT$4.78', beta: '0.32',
    vol: '5,100張', avgVol: '4,800張', hi52: 132, lo52: 110, div: '4.85%',
    sector: '電信', verdict: 'HOLD', conf: 60,
    target: { lo: 115, mid: 128, hi: 140 },
    risks: ['5G 投資回收期長，資本支出壓力大', '民營電信競爭侵蝕 ARPU', '國際業務成長有限', '高殖利率但成長性有限'],
    sentimentScore: 48, sentimentLabel: '中性',
    analysts: { buy: 8, hold: 16, sell: 4 },
    summary: '中華電信是台灣市佔率最高的電信業者，擁有固網與行動雙寡頭優勢。股息殖利率穩定超過 4.8%，是防禦型投資首選。5G 企業專網與雲端服務為中期成長方向，但進展緩慢。',
    tags: ['高殖利率', '防禦型', '國營概念'],
    news: [
      { title: '中華電信 5G 企業專網簽約台積電，打入半導體廠域', src: '工商時報', time: '5小時前', sent: 'bullish' },
      { title: '中華電 AI 客服平台上線，年省人力成本逾億元', src: '經濟日報', time: '1天前', sent: 'neutral' },
      { title: 'NCC 放寬電信資費管制，有利中華電獲利改善', src: '財訊', time: '3天前', sent: 'bullish' },
    ],
  },
  {
    ticker: '2882', name: '國泰金', fullName: '國泰金融控股股份有限公司',
    market: 'TW', currency: 'TWD', sym: 'NT$',
    price: 62, change: 0.80, pct: 1.31,
    cap: '1.02 兆元', pe: '14.5倍', eps: 'NT$4.28', beta: '0.78',
    vol: '3.6萬張', avgVol: '3.2萬張', hi52: 72, lo52: 48, div: '4.20%',
    sector: '金融', verdict: 'HOLD', conf: 58,
    target: { lo: 58, mid: 68, hi: 78 },
    risks: ['利率環境轉變衝擊壽險資產配置', '股市大幅修正影響基金管理費收入', '台幣升值壓縮海外投資收益', '金融業法規趨嚴，資本適足率要求提升'],
    sentimentScore: 50, sentimentLabel: '中性',
    analysts: { buy: 10, hold: 15, sell: 3 },
    summary: '國泰金為台灣最大的金融控股公司，旗下涵蓋壽險、銀行與證券業務。壽險資產規模龐大，對利率與台幣匯率敏感度高。股息殖利率約 4.2%，適合保守型投資人長期持有。',
    tags: ['金融股', '高殖利率', '壽險龍頭'],
    news: [
      { title: '國泰人壽 AI 核保系統上線，理賠速度提升 40%', src: '工商時報', time: '3小時前', sent: 'bullish' },
      { title: 'Fed 降息預期升溫，金融股殖利率吸引力浮現', src: 'MoneyDJ', time: '8小時前', sent: 'bullish' },
      { title: '台幣升值壓力大，壽險業海外投資匯損擴大', src: '經濟日報', time: '1天前', sent: 'bearish' },
    ],
  },
  {
    ticker: 'TSM', name: '台積電 ADR', fullName: 'Taiwan Semiconductor Mfg. Co. (ADR)',
    market: 'US', currency: 'USD', sym: '$',
    price: 185.40, change: 4.18, pct: 2.31,
    cap: '9,583億美元', pe: '24.8倍', eps: '$7.47', beta: '0.92',
    vol: '1,240萬', avgVol: '980萬', hi52: 193.50, lo52: 102.40, div: '1.85%',
    sector: '半導體', verdict: 'BUY', conf: 78,
    target: { lo: 195, mid: 205, hi: 215 },
    risks: ['台灣海峽地緣政治風險', '客戶集中度風險（蘋果、輝達合計佔50%）', '美元兌台幣匯率敞口', '半導體景氣循環下行風險'],
    sentimentScore: 73, sentimentLabel: '偏多',
    analysts: { buy: 24, hold: 8, sell: 2 },
    summary: '台積電 ADR 掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈的核心骨幹。輝達與蘋果的訂單能見度延伸至 2026 年。3 奈米製程放量推動平均售價上升，2 奈米製程預計 2025 年底試產。淨利率約 43%。',
    tags: ['AI 供應鏈', '3奈米領導者', '配息'],
    news: [
      { title: '台積電 2 奈米良率超出預期，消息人士透露', src: '路透社', time: '2小時前', sent: 'bullish' },
      { title: '蘋果確定採用台積電 N3E 製程生產 iPhone 17 系列晶片', src: '彭博社', time: '5小時前', sent: 'bullish' },
      { title: '台灣海峽緊張局勢緩和，雙方外交接觸增加', src: '華爾街日報', time: '8小時前', sent: 'neutral' },
      { title: '台積電月營收年增 40%，AI 需求強勁帶動', src: '電子時報', time: '1天前', sent: 'bullish' },
    ],
  },
  {
    ticker: 'TSLA', name: '特斯拉', fullName: 'Tesla, Inc.',
    market: 'US', currency: 'USD', sym: '$',
    price: 248.70, change: -3.05, pct: -1.21,
    cap: '7,934億美元', pe: '62.4倍', eps: '$3.98', beta: '2.31',
    vol: '7,820萬', avgVol: '9,210萬', hi52: 299.29, lo52: 138.80, div: '—',
    sector: '非必需消費品', verdict: 'HOLD', conf: 62,
    target: { lo: 220, mid: 255, hi: 310 },
    risks: ['比亞迪電動車競爭持續加劇', '與傳統車廠相比估值溢價過高', 'CEO 爭議導致品牌形象受損', '持續降價壓縮毛利'],
    sentimentScore: 48, sentimentLabel: '中性',
    analysts: { buy: 18, hold: 14, sell: 9 },
    summary: '特斯拉仍是電動車品牌領導者，擁有真實的軟體護城河（FSD 全自動駕駛、超充網路）。近期基本面承壓——比亞迪競爭加劇、毛利縮減，且以 62 倍本益比來看，股價已反映大量 Robotaxi 與 Optimus 機器人的未來潛力。',
    tags: ['電動車', '高貝塔', 'AI 機器人'],
    news: [
      { title: '特斯拉第二季交付量不如預期，比亞迪競爭持續加劇', src: 'CNBC', time: '3小時前', sent: 'bearish' },
      { title: 'FSD 第 13 版城市場景駕駛表現大幅提升', src: 'Electrek', time: '8小時前', sent: 'bullish' },
      { title: '比亞迪連續兩個月在歐洲銷量超越特斯拉', src: '路透社', time: '1天前', sent: 'bearish' },
    ],
  },
  {
    ticker: 'NVDA', name: '輝達', fullName: 'NVIDIA Corporation',
    market: 'US', currency: 'USD', sym: '$',
    price: 920.50, change: 33.88, pct: 3.82,
    cap: '2.27兆美元', pe: '68.2倍', eps: '$13.49', beta: '1.67',
    vol: '4,160萬', avgVol: '3,890萬', hi52: 974.00, lo52: 418.00, div: '0.04%',
    sector: '半導體', verdict: 'BUY', conf: 85,
    target: { lo: 950, mid: 1050, hi: 1200 },
    risks: ['估值偏高（68 倍本益比）', '中國出口管制衝擊', 'AMD MI300X 市佔持續增加', 'AI 資本支出週期正常化風險'],
    sentimentScore: 81, sentimentLabel: '偏多',
    analysts: { buy: 35, hold: 7, sell: 1 },
    summary: '輝達是本時代最關鍵的 AI 基礎設施投資標的。H100/H200 持續供不應求；Blackwell（B200）量產已啟動。資料中心營收年增逾 400%。CUDA 軟體生態系形成強大的轉換成本壁壘，AMD 與 Intel 至今未能突破。毛利率持續擴張至約 78%。',
    tags: ['AI 基礎設施', '資料中心', '超大型股'],
    news: [
      { title: '輝達 Blackwell 晶片出貨進度超前，合作夥伴確認', src: '彭博社', time: '1小時前', sent: 'bullish' },
      { title: '微軟為 Azure AI 擴充訂購 40 萬顆 H200 GPU', src: '金融時報', time: '5小時前', sent: 'bullish' },
      { title: 'AMD MI300X 在雲端超大規模業者中逐漸獲得採用', src: 'The Register', time: '12小時前', sent: 'neutral' },
    ],
  },
  {
    ticker: 'AAPL', name: '蘋果', fullName: 'Apple Inc.',
    market: 'US', currency: 'USD', sym: '$',
    price: 195.30, change: 0.97, pct: 0.50,
    cap: '3.01兆美元', pe: '32.1倍', eps: '$6.08', beta: '1.24',
    vol: '5,210萬', avgVol: '5,830萬', hi52: 237.23, lo52: 164.08, div: '0.52%',
    sector: '科技', verdict: 'HOLD', conf: 71,
    target: { lo: 195, mid: 220, hi: 250 },
    risks: ['中國市場營收敞口（約佔總營收 18%）', 'iPhone 換機週期持續拉長', 'Apple Intelligence 變現前景不確定', 'App Store 反壟斷監管壓力'],
    sentimentScore: 55, sentimentLabel: '中性',
    analysts: { buy: 28, hold: 16, sell: 4 },
    summary: '蘋果擁有超過 20 億台裝置的龐大生態系，加上年化規模約 1,000 億美元的服務業務，提供穩定可預測的獲利基礎。近期成長溫和但高度確定。Apple Intelligence 有望在 2025 年下半年推動下一波 iPhone 換機潮。',
    tags: ['服務業', '配息', '消費科技'],
    news: [
      { title: 'Apple Intelligence 在歐盟獲監管批准後正式推出', src: '路透社', time: '2小時前', sent: 'bullish' },
      { title: 'iPhone 17 Pro 預購創下 iPhone 15 以來最強表現', src: '彭博社', time: '6小時前', sent: 'bullish' },
      { title: '美國司法部 App Store 反壟斷案進入取證階段', src: '華爾街日報', time: '1天前', sent: 'bearish' },
    ],
  },
  {
    ticker: 'MSFT', name: '微軟', fullName: 'Microsoft Corporation',
    market: 'US', currency: 'USD', sym: '$',
    price: 412.80, change: 6.21, pct: 1.53,
    cap: '3.07兆美元', pe: '35.8倍', eps: '$11.52', beta: '0.91',
    vol: '2,210萬', avgVol: '2,530萬', hi52: 468.35, lo52: 309.36, div: '0.74%',
    sector: '科技', verdict: 'BUY', conf: 80,
    target: { lo: 430, mid: 480, hi: 540 },
    risks: ['Azure 成長動能放緩風險', '對 OpenAI 的高度依賴', '企業 IT 支出週期波動', '反壟斷監管審查持續'],
    sentimentScore: 76, sentimentLabel: '偏多',
    analysts: { buy: 40, hold: 6, sell: 1 },
    summary: '微軟在企業 AI 與雲端的交叉點上具有獨特優勢。Azure 再加速成長至 29%。面向超過 4 億 Office 用戶的 Copilot 訂閱（每月 30 美元/用戶）是早期階段的龐大營收機會，企業分發護城河（Office、Azure、Teams）無可匹敵。',
    tags: ['雲端', '人工智慧', '配息'],
    news: [
      { title: 'Azure 受 AI 需求帶動，成長加速至 29%', src: '彭博社', time: '3小時前', sent: 'bullish' },
      { title: 'Microsoft 365 Copilot 企業席次突破 100 萬', src: 'CNBC', time: '7小時前', sent: 'bullish' },
      { title: 'OpenAI 尋求微軟合作以外的額外運算資源', src: '金融時報', time: '1天前', sent: 'neutral' },
    ],
  },
];

const STOCKS: Record<string, Stock> = Object.fromEntries(
  STOCKS_BASE.map(s => {
    const trend = s.verdict === 'BUY' ? 0.002 : s.pct > 0 ? 0.0008 : -0.0003;
    return [s.ticker, { ...s, history: genCandles(s.price, 252, trend, 0.02) }];
  })
);

const WATCHLIST = ['2330', '2454', '2317', '2412', 'TSM', 'NVDA', 'AAPL', 'TSLA'];

const PORTFOLIO = [
  { ticker: 'NVDA',  shares: 15,   avgCost: 648.50 },
  { ticker: 'TSM',   shares: 50,   avgCost: 144.80 },
  { ticker: '2330',  shares: 3000, avgCost: 695 },
  { ticker: '2454',  shares: 500,  avgCost: 950 },
];

const AI_RESPONSES: Record<string, string> = {
  '2330': '**台積電（2330.TW）— 買進 · 信心指數 84%**\n\n台積電掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈的核心骨幹。外資持續買超，法人看好 3 奈米製程放量帶動 EPS 上修。2 奈米製程 2025 年底試產，有望推動下一波估值擴張。\n\n**目標價：** NT$970（較現價上漲 10.9%）\n**主要風險：** 台灣海峽地緣政治局勢\n\n建議作為台股核心持股，長期持有。',
  '2454': '**聯發科（2454.TW）— 買進 · 信心指數 76%**\n\n聯發科天璣 9400 成功打入三星旗艦機，AI 手機晶片市佔率快速提升。衛星通訊、車用與 IoT 為中期新成長動能。現金殖利率達 3.5%，估值相對輝達等美股 AI 股票合理。\n\n**目標價：** NT$1,320（較現價上漲 11.9%）\n**主要風險：** 中國客戶佔比偏高（約 55%），中美貿易戰風險',
  '2317': '**鴻海（2317.TW）— 持有 · 信心指數 63%**\n\n鴻海是全球最大電子代工廠，蘋果供應鏈是核心收入來源。殖利率超過 4% 支撐下檔，但電動車新業務仍在燒錢階段，短期難以顯著貢獻獲利。\n\n**目標價：** NT$200（較現價上漲 9.9%）\n**建議：** 等待電動車業務明確轉虧為盈訊號，或股價回測 NT$165 以下再加碼。',
  '2412': '**中華電（2412.TW）— 持有 · 信心指數 60%**\n\n中華電信股息穩定，殖利率近 5%，是台股「存股」首選之一。但 5G 投資回收期漫長，成長性有限。\n\n**目標價：** NT$128（較現價上漲 5.8%）\n**適合：** 低風險、重視現金流的長期投資人',
  '2882': '**國泰金（2882.TW）— 持有 · 信心指數 58%**\n\n國泰金為台灣最大金控，壽險資產規模龐大，對利率與匯率高度敏感。Fed 降息周期若確立，壽險資產評價有望改善，股價存在補漲空間。殖利率約 4.2%。\n\n**目標價：** NT$68（較現價上漲 9.7%）\n**主要風險：** 台幣升值壓縮海外投資收益',
  'TSM':  '**台積電 ADR（TSM）— 買進 · 信心指數 78%**\n\n台積電掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈的核心骨幹。輝達與蘋果的訂單能見度延伸至 2026 年。3 奈米製程放量推動平均售價上升。\n\n**目標價：** $205（較現價上漲 10.6%）\n**主要風險：** 台灣海峽地緣政治局勢',
  'TSLA': '**特斯拉（TSLA）— 持有 · 信心指數 62%**\n\n特斯拉維持電動車品牌領導地位，擁有真實的軟體護城河（FSD、超充網路）。但近期基本面承壓——比亞迪競爭加劇、毛利縮減，且以 62 倍本益比來看，股價已反映大量 Robotaxi/Optimus 的潛力溢價。\n\n**目標價：** $255（較現價上漲 2.5%）\n**建議：** 等待 $200–$220 的更佳進場點。',
  'NVDA': '**輝達（NVDA）— 強力買進 · 信心指數 85%**\n\n輝達是本時代最核心的 AI 基礎設施投資標的。H100/H200 持續供不應求；Blackwell（B200）量產已啟動。資料中心營收年增逾 400%。CUDA 生態系形成極高轉換成本，AMD 與 Intel 至今未能突破。毛利率擴張至約 78%。\n\n**目標價：** $1,050（較現價上漲 14%）\n**注意：** 68 倍本益比下容錯空間有限——請依風險承受度控制倉位。',
  'AAPL': '**蘋果（AAPL）— 持有 · 信心指數 71%**\n\n蘋果擁有超過 20 億台裝置的生態系，加上約 1,000 億美元年化規模的服務業務，獲利基礎穩定且高度可預測。Apple Intelligence 有望在 2025 年下半年催化下一波 iPhone 換機潮。\n\n**目標價：** $220（較現價上漲 12.6%）\n**主要風險：** 中國市場營收敞口（約佔總營收 18%）',
  'MSFT': '**微軟（MSFT）— 買進 · 信心指數 80%**\n\n微軟在企業 AI 與雲端的交叉點具有獨特優勢。Azure 再加速成長至 29%。面向超過 4 億 Office 用戶的 Copilot（每月 30 美元/用戶）是早期階段的巨大營收機會。企業分發護城河無可匹敵。\n\n**目標價：** $480（較現價上漲 16%）\n**催化劑：** Azure OpenAI 持續滲透與 Copilot 席次擴張',
};

const SUGGESTIONS = [
  { label: '分析台積電（台股）', query: '分析2330台積電', ticker: '2330' },
  { label: '分析聯發科',         query: '分析聯發科2454', ticker: '2454' },
  { label: '輝達前景如何？',     query: '輝達的投資前景如何？', ticker: 'NVDA' },
  { label: '鴻海值得買嗎？',     query: '鴻海2317現在值得買嗎？', ticker: '2317' },
  { label: 'TSM vs 2330',        query: 'TSM美股和2330台股有什麼差異？', ticker: 'TSM' },
];

const NAV_ITEMS = [
  { id: 'chat',      icon: '◈', label: 'AI 分析師' },
  { id: 'portfolio', icon: '▦', label: '投資組合' },
  { id: 'watchlist', icon: '◉', label: '自選股' },
  { id: 'news',      icon: '◧', label: '新聞' },
  { id: 'settings',  icon: '⊙', label: '設定' },
] as const;

type NavId = typeof NAV_ITEMS[number]['id'];

const PERIODS = [
  { key: 'w1', label: '1W', days: 5 },
  { key: 'm1', label: '1M', days: 21 },
  { key: 'm3', label: '3M', days: 63 },
  { key: 'm6', label: '6M', days: 126 },
  { key: 'y1', label: '1Y', days: 252 },
] as const;

// ── ChartSVG ──────────────────────────────────────────────────────────────────

interface ChartProps {
  history: Candle[];
  W?: number; H?: number;
  accent?: string; gradId?: string;
  isUp?: boolean;
  showControls?: boolean;
  initMode?: 'candle' | 'line';
  initPeriod?: string;
}

function ChartSVG({ history, W = 600, H = 160, accent = '#4f8ef7', gradId = 'g0', isUp = true, showControls = true, initMode = 'candle', initPeriod = 'm3' }: ChartProps) {
  const [mode, setMode]     = useState<'candle' | 'line'>(initMode);
  const [period, setPeriod] = useState(initPeriod);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pd   = PERIODS.find(p => p.key === period) ?? PERIODS[2];
  const data = (history ?? []).slice(-pd.days);
  if (!data.length) return null;

  const allH = data.map(d => d.h), allL = data.map(d => d.l);
  const minP = Math.min(...allL) * 0.998, maxP = Math.max(...allH) * 1.002, rng = maxP - minP || 1;
  const xOf  = (i: number) => (i / (data.length - 1)) * W;
  const yOf  = (v: number) => 4 + (1 - (v - minP) / rng) * (H - 8);
  const bw   = Math.max((W / data.length) * 0.55, 1.5);
  const GRN  = '#00d98b', RED = '#ff4060';
  const lineColor = isUp ? GRN : RED;
  const hov  = hoverIdx !== null ? data[hoverIdx] : null;
  const pts  = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(d.c).toFixed(1)}`).join(' ');
  const area = `${pts} L${W} ${H} L0 ${H}Z`;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setHoverIdx(Math.max(0, Math.min(data.length - 1, Math.round((x / W) * (data.length - 1)))));
  }

  return (
    <div>
      {showControls && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{ padding: '3px 9px', border: 'none', background: period === p.key ? 'rgba(79,142,247,.15)' : 'none', color: period === p.key ? '#4f8ef7' : '#4a6890', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, borderRadius: 4, cursor: 'pointer' }}>{p.label}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['candle', 'line'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{ padding: '3px 9px', border: `1px solid ${mode === m ? 'rgba(79,142,247,.4)' : 'rgba(79,142,247,.15)'}`, background: mode === m ? 'rgba(79,142,247,.12)' : 'none', color: mode === m ? '#4f8ef7' : '#4a6890', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, borderRadius: 4, cursor: 'pointer' }}>{m === 'candle' ? '╫ K線' : '∿ 走勢'}</button>
            ))}
            {hov && <span style={{ marginLeft: 8, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#ccd8f5', fontWeight: 600 }}>{hov.c.toFixed(2)}</span>}
          </div>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: showControls ? 'crosshair' : 'default' }}
        onMouseMove={showControls ? onMove : undefined}
        onMouseLeave={showControls ? () => setHoverIdx(null) : undefined}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity=".28" />
            <stop offset="100%" stopColor={lineColor} stopOpacity=".02" />
          </linearGradient>
        </defs>
        {mode === 'candle'
          ? data.map((d, i) => {
              const up = d.c >= d.o, col = up ? GRN : RED;
              const bTop = Math.min(yOf(d.o), yOf(d.c)), bH = Math.max(Math.abs(yOf(d.o) - yOf(d.c)), 1);
              return (
                <g key={i}>
                  <line x1={xOf(i)} y1={yOf(d.h)} x2={xOf(i)} y2={yOf(d.l)} stroke={col} strokeWidth="1" opacity=".55" />
                  <rect x={xOf(i) - bw / 2} y={bTop} width={bw} height={bH} fill={col} opacity=".85" />
                </g>
              );
            })
          : <>
              <path d={area} fill={`url(#${gradId})`} />
              <path d={pts} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
        }
        {hov !== null && hoverIdx !== null && (
          <>
            <line x1={xOf(hoverIdx)} y1="0" x2={xOf(hoverIdx)} y2={H} stroke={accent} strokeWidth="1" strokeDasharray="3 3" opacity=".5" />
            <circle cx={xOf(hoverIdx)} cy={yOf(hov.c)} r="4" fill={accent} stroke="#070b14" strokeWidth="2" />
          </>
        )}
      </svg>
    </div>
  );
}

// ── AIText ────────────────────────────────────────────────────────────────────

function AIText({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 12 }}>
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <div key={i} style={{ lineHeight: 1.65, margin: '1px 0' }}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j} style={{ color: '#4f8ef7' }}>{p.slice(2, -2)}</strong>
                : p
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── TypingDots ────────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '5px 2px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{ display: 'block', width: 6, height: 6, borderRadius: '50%', background: '#4a6890', animation: `bounce 1.2s ${i * 0.15}s infinite` }} />
      ))}
    </div>
  );
}

// ── MiniStockCard ─────────────────────────────────────────────────────────────

function MiniStockCard({ stock, onSelect }: { stock: Stock; onSelect: (t: string) => void }) {
  const isUp = stock.pct >= 0;
  return (
    <div onClick={() => onSelect(stock.ticker)}
      style={{ background: '#070b14', border: '1px solid rgba(79,142,247,.18)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', transition: 'border-color .2s' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(79,142,247,.5)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(79,142,247,.18)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px 4px' }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13 }}>{stock.ticker}</div>
          <div style={{ fontSize: 10, color: '#4a6890', marginTop: 1 }}>{stock.name}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 14 }}>{stock.sym}{stock.price.toLocaleString()}</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isUp ? '#00d98b' : '#ff4060' }}>{isUp ? '+' : ''}{stock.pct.toFixed(2)}%</div>
        </div>
      </div>
      <div style={{ height: 54, padding: '0 8px' }}>
        <ChartSVG history={stock.history} W={340} H={54} accent="#4f8ef7" gradId={`mc-${stock.ticker}`} isUp={isUp} showControls={false} initMode="line" initPeriod="m3" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', borderTop: '1px solid rgba(79,142,247,.1)', background: 'rgba(255,255,255,.02)' }}>
        <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: vc(stock.verdict), background: vbg(stock.verdict), border: `1px solid ${vbd(stock.verdict)}`, padding: '2px 8px', borderRadius: 3, letterSpacing: '.06em' }}>● {stock.verdict}</span>
        <span style={{ fontSize: 11, color: '#4a6890' }}>信心：{stock.conf}% · <span style={{ color: '#4f8ef7', cursor: 'pointer' }}>查看完整分析 →</span></span>
      </div>
    </div>
  );
}

// ── AnalysisPanel ─────────────────────────────────────────────────────────────

function AnalysisPanel({ stock }: { stock: Stock | null }) {
  if (!stock) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a6890', textAlign: 'center', padding: 40 }}>
      <div>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: .15, lineHeight: 1 }}>◎</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#ccd8f5' }}>尚未選擇股票</div>
        <div style={{ fontSize: 13, color: '#4a6890', lineHeight: 1.65, maxWidth: 260, marginBottom: 20 }}>請向 AI 分析師詢問股票，或從自選股中選擇一檔</div>
      </div>
    </div>
  );

  const isUp   = stock.pct >= 0;
  const pctCol = isUp ? '#00d98b' : '#ff4060';
  const total  = stock.analysts.buy + stock.analysts.hold + stock.analysts.sell;
  const card   = { background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: 14, marginBottom: 12 };
  const stLabel= { fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: '#4a6890', marginBottom: 11 };
  const tgtPct = Math.min(100, Math.max(0, (stock.price - stock.target.lo) / (stock.target.hi - stock.target.lo) * 100));
  const upside = ((stock.target.mid - stock.price) / stock.price * 100).toFixed(1);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, letterSpacing: '.04em' }}>{stock.ticker}</div>
          <div style={{ fontSize: 12, color: '#4a6890', margin: '3px 0 6px' }}>{stock.fullName} · {stock.sector}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: stock.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.12)', border: stock.market === 'TW' ? '1px solid rgba(255,214,102,.3)' : '1px solid rgba(79,142,247,.25)', color: stock.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{stock.market === 'TW' ? '🇹🇼 台股' : '🇺🇸 美股'}</span>
            {stock.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, background: 'rgba(79,142,247,.1)', border: '1px solid rgba(79,142,247,.2)', color: '#4a6890' }}>{t}</span>)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700 }}>{stock.sym}{stock.price.toLocaleString()}</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: pctCol, marginTop: 3 }}>{isUp ? '+' : ''}{stock.change.toFixed(2)} ({isUp ? '+' : ''}{stock.pct.toFixed(2)}%)</div>
          <div style={{ marginTop: 9 }}>
            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: vc(stock.verdict), background: vbg(stock.verdict), border: `1px solid ${vbd(stock.verdict)}`, padding: '4px 10px', borderRadius: 4, letterSpacing: '.06em' }}>● {stock.verdict}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{ ...card, padding: '12px 12px 8px' }}>
        <ChartSVG history={stock.history} W={720} H={185} accent="#4f8ef7" gradId={`ap-${stock.ticker}`} isUp={isUp} initMode="candle" initPeriod="m3" />
      </div>

      {/* AI Analysis */}
      <div style={card}>
        <div style={stLabel}>AI 分析</div>
        <div style={{ marginBottom: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12, color: '#4a6890' }}>
            <span>AI 信心指數</span>
            <span style={{ color: vc(stock.verdict), fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{stock.conf}%</span>
          </div>
          <div style={{ height: 4, background: '#1e3050', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${stock.conf}%`, background: `linear-gradient(90deg,#4f8ef780,${vc(stock.verdict)})`, borderRadius: 2, transition: 'width .6s ease' }} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#4a6890', lineHeight: 1.72, margin: '0 0 14px' }}>{stock.summary}</p>
        <div style={{ fontSize: 11, color: '#4a6890', marginBottom: 7 }}>12 月目標價</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.sym}{stock.target.lo}</span>
          <div style={{ flex: 1, height: 3, background: '#1e3050', borderRadius: 2, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, height: '100%', width: `${tgtPct}%`, background: '#00d98b', borderRadius: 2 }} />
            <div style={{ position: 'absolute', left: `${tgtPct}%`, top: -4, width: 11, height: 11, borderRadius: '50%', background: '#00d98b', border: '2px solid #070b14', transform: 'translateX(-50%)' }} />
          </div>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.sym}{stock.target.hi}</span>
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: '#4a6890' }}>
          共識目標 <span style={{ color: '#00d98b', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{stock.sym}{stock.target.mid.toLocaleString()}</span>
          <span style={{ color: '#00d98b', marginLeft: 6 }}>{Number(upside) > 0 ? '+' : ''}{upside}% 上漲空間</span>
        </div>
      </div>

      {/* Metrics + Analysts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={stLabel}>關鍵指標</div>
          {[['市值', stock.cap], ['本益比', stock.pe], ['每股盈餘 (TTM)', stock.eps], ['Beta 值', stock.beta], ['成交量', stock.vol], ['均均成交量', stock.avgVol], ['52週高點', `${stock.sym}${stock.hi52.toLocaleString()}`], ['52週低點', `${stock.sym}${stock.lo52.toLocaleString()}`], ['殖利率', stock.div]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(79,142,247,.1)', fontSize: 12 }}>
              <span style={{ color: '#4a6890' }}>{k}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...card, marginBottom: 0 }}>
            <div style={stLabel}>分析師建議（{total} 位）</div>
            <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2, marginBottom: 10 }}>
              <div style={{ flex: stock.analysts.buy, background: '#00d98b' }} />
              <div style={{ flex: stock.analysts.hold, background: '#ffd666' }} />
              <div style={{ flex: stock.analysts.sell, background: '#ff4060' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 10 }}>
              <span style={{ color: '#00d98b' }}>● 買進 {stock.analysts.buy}</span>
              <span style={{ color: '#ffd666' }}>● 持有 {stock.analysts.hold}</span>
              <span style={{ color: '#ff4060' }}>● 賣出 {stock.analysts.sell}</span>
            </div>
            <div style={{ fontSize: 11, color: '#4a6890' }}>
              新聞情緒：<span style={{ color: stock.sentimentLabel === '偏多' ? '#00d98b' : stock.sentimentLabel === '偏空' ? '#ff4060' : '#ffd666' }}>{stock.sentimentLabel} {stock.sentimentScore}%</span>
            </div>
          </div>
          <div style={{ ...card, marginBottom: 0 }}>
            <div style={stLabel}>風險因子</div>
            {stock.risks.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#4a6890', marginBottom: 7, alignItems: 'flex-start', lineHeight: 1.5 }}>
                <span style={{ color: '#ff4060', flexShrink: 0, marginTop: 1 }}>▲</span>{r}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ChatPanel ─────────────────────────────────────────────────────────────────

function ChatPanel({ stocks, onStockSelect }: { stocks: typeof STOCKS; onStockSelect: (t: string) => void }) {
  const [messages, setMessages] = useState<Msg[]>([{
    id: 0, role: 'ai',
    displayText: "您好！我是您的 AI 投資分析師。我從基本面、技術面與市場情緒三個維度分析股票，為您提供明確的**買進 / 持有 / 賣出**建議，附帶信心指數與風險評估。\n\n試著問我：**「分析台積電」** 或 **「現在應該買輝達嗎？」**",
    isTyping: false, isStreaming: false,
  }]);
  const [input, setInput]           = useState('');
  const [thinking, setThinking]     = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const streamRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const wsReadyRef   = useRef(false);
  const activeMsgRef = useRef(0);
  const showSugg     = messages.length === 1;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => { if (streamRef.current) clearInterval(streamRef.current); }, []);

  // WebSocket 連線（Render 後端）；連不上時自動降級為 Mock 模式
  useEffect(() => {
    let closed = false;
    let ws: WebSocket;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => { wsReadyRef.current = true; setWsConnected(true); };

        ws.onclose = () => {
          wsReadyRef.current = false;
          setWsConnected(false);
          if (!closed) setTimeout(connect, 5000); // 斷線後 5 秒重連
        };

        ws.onerror = () => { wsReadyRef.current = false; setWsConnected(false); };

        ws.onmessage = ({ data }) => {
          const msg = JSON.parse(data as string) as {
            type: string; text?: string;
            data?: { symbol?: string; ticker?: string };
            message?: string;
          };
          const id = activeMsgRef.current;

          if (msg.type === 'stockData' && msg.data) {
            const sym = msg.data.symbol ?? msg.data.ticker ?? '';
            if (sym && STOCKS[sym]) onStockSelect(sym);
          }
          if (msg.type === 'aiChunk' && msg.text) {
            setMessages(prev =>
              prev.map(m => m.id === id ? { ...m, displayText: (m.displayText ?? '') + msg.text } : m)
            );
          }
          if (msg.type === 'done') {
            setMessages(prev =>
              prev.map(m => m.id === id ? { ...m, isStreaming: false } : m)
            );
            setThinking(false);
          }
          if (msg.type === 'error') {
            setMessages(prev =>
              prev.map(m => m.id === id
                ? { ...m, isStreaming: false, displayText: (m.displayText ?? '') + `\n\n⚠️ ${msg.message ?? '發生錯誤'}` }
                : m)
            );
            setThinking(false);
          }
        };
      } catch (_) { /* 非瀏覽器環境直接略過 */ }
    }

    connect();
    return () => { closed = true; ws?.close(); };
  }, [onStockSelect]);

  const resolveTicker = (text: string): string | null => {
    const u = text.toUpperCase();
    const twMatch = ['2330', '2454', '2317', '2412', '2882'].find(k => text.includes(k));
    if (twMatch) return twMatch;
    const usMatch = Object.keys(AI_RESPONSES).find(k => u.includes(k));
    if (usMatch) return usMatch;
    if (/聯發科|mediatek/i.test(text)) return '2454';
    if (/鴻海|foxconn/i.test(text)) return '2317';
    if (/中華電|chunghwa/i.test(text)) return '2412';
    if (/國泰金/i.test(text)) return '2882';
    if (/台積電.*台股/i.test(text)) return '2330';
    if (/tsmc|taiwan semi|台積電/i.test(text)) return 'TSM';
    if (/tesla|特斯拉/i.test(text)) return 'TSLA';
    if (/nvidia|輝達/i.test(text)) return 'NVDA';
    if (/apple|蘋果/i.test(text)) return 'AAPL';
    if (/microsoft|微軟/i.test(text)) return 'MSFT';
    return null;
  };

  const send = useCallback((text: string, forceTicker?: string) => {
    if (!text.trim() || thinking) return;

    const userMsg: Msg   = { id: Date.now(), role: 'user', displayText: text.trim() };
    const streamMsgId    = Date.now() + 1;
    const typingMsg: Msg = { id: streamMsgId, role: 'ai', isTyping: true };

    activeMsgRef.current = streamMsgId;
    setMessages(prev => [...prev, userMsg, typingMsg]);
    setInput('');
    setThinking(true);

    const ticker = forceTicker ?? resolveTicker(text);

    if (wsReadyRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      // ── 真實後端路徑（Render WebSocket）────────────────────────────────────
      setTimeout(() => {
        setMessages(prev =>
          prev.map(m => m.id === streamMsgId
            ? { ...m, isTyping: false, isStreaming: true, displayText: '' } : m)
        );
        wsRef.current!.send(JSON.stringify({ action: 'requestAnalysis', symbol: ticker ?? text.trim() }));
      }, 300);
    } else {
      // ── Mock 降級路徑（無後端連線時使用）──────────────────────────────────
      const fullText    = ticker && AI_RESPONSES[ticker]
        ? AI_RESPONSES[ticker]
        : '我可以為您詳細分析以下股票：台積電（2330/TSM）、輝達（NVDA）、微軟（MSFT）、蘋果（AAPL）、特斯拉（TSLA）、聯發科（2454）、鴻海（2317）。\n\n請試試：**「分析輝達」** 或 **「台積電現在能買嗎？」**';
      const finalTicker = ticker && AI_RESPONSES[ticker] ? ticker : null;

      setTimeout(() => {
        setMessages(prev =>
          prev.map(m => m.id === streamMsgId
            ? { id: streamMsgId, role: 'ai', isTyping: false, isStreaming: true, displayText: '' } : m)
        );
        let pos = 0;
        streamRef.current = setInterval(() => {
          pos = Math.min(pos + Math.ceil(Math.random() * 4 + 1), fullText.length);
          setMessages(prev =>
            prev.map(m => m.id === streamMsgId ? { ...m, displayText: fullText.slice(0, pos) } : m)
          );
          if (pos >= fullText.length) {
            clearInterval(streamRef.current!);
            setMessages(prev =>
              prev.map(m => m.id === streamMsgId ? { ...m, isStreaming: false, ticker: finalTicker } : m)
            );
            setThinking(false);
            if (finalTicker && stocks[finalTicker]) onStockSelect(finalTicker);
          }
        }, 14);
      }, 1200 + Math.random() * 600);
    }
  }, [thinking, stocks, onStockSelect]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 440, flexShrink: 0, borderRight: '1px solid rgba(79,142,247,.15)', background: '#0c1422' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(79,142,247,.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#00d98b', boxShadow: '0 0 7px #00d98b', animation: 'pulse 2s infinite' }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>AI 投資分析師</span>
        </div>
        <span style={{ fontSize: 11, color: wsConnected ? '#00d98b' : '#4a6890' }}>
          Claude Sonnet · {wsConnected ? '已連線後端' : 'Mock 模式'}
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 13, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
        {messages.map(msg => {
          if (msg.role === 'user') return (
            <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ background: 'rgba(79,142,247,.12)', border: '1px solid rgba(79,142,247,.25)', borderRadius: '12px 12px 2px 12px', padding: '10px 13px', fontSize: 12, lineHeight: 1.6, maxWidth: '82%' }}>{msg.displayText}</div>
            </div>
          );
          return (
            <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(79,142,247,.15)', border: '1px solid rgba(79,142,247,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4f8ef7', fontSize: 11, flexShrink: 0, marginTop: 1 }}>◈</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msg.isTyping
                  ? <div style={{ background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: '2px 10px 10px 10px', padding: '8px 14px' }}><TypingDots /></div>
                  : <>
                      <div style={{ background: '#101e35', border: `1px solid ${msg.isStreaming ? 'rgba(79,142,247,.3)' : 'rgba(79,142,247,.15)'}`, borderRadius: '2px 10px 10px 10px', padding: '10px 13px', fontSize: 12, position: 'relative' }}>
                        <AIText text={msg.displayText ?? ''} />
                        {msg.isStreaming && <span style={{ display: 'inline-block', width: 2, height: 13, background: '#4f8ef7', marginLeft: 2, verticalAlign: 'middle', animation: 'pulse 0.8s infinite' }} />}
                      </div>
                      {!msg.isStreaming && msg.ticker && stocks[msg.ticker] && (
                        <MiniStockCard stock={stocks[msg.ticker]} onSelect={onStockSelect} />
                      )}
                    </>
                }
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {showSugg && (
        <div style={{ padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          {SUGGESTIONS.map(s => (
            <button key={s.label} onClick={() => send(s.query, s.ticker)}
              style={{ padding: '5px 12px', border: '1px solid rgba(79,142,247,.2)', borderRadius: 20, background: 'none', color: '#4a6890', fontFamily: "'Space Grotesk',sans-serif", fontSize: 11, cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#4f8ef7'; e.currentTarget.style.color = '#4f8ef7'; e.currentTarget.style.background = 'rgba(79,142,247,.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,.2)'; e.currentTarget.style.color = '#4a6890'; e.currentTarget.style.background = 'none'; }}
            >{s.label}</button>
          ))}
        </div>
      )}

      <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(79,142,247,.15)', display: 'flex', gap: 8, flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(input)}
          placeholder="詢問：分析台積電 · 我該買輝達嗎？ · 投資組合風險分析"
          disabled={thinking}
          style={{ flex: 1, background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: '9px 13px', color: '#ccd8f5', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12, outline: 'none' }}
          onFocus={e => (e.target.style.borderColor = 'rgba(79,142,247,.45)')}
          onBlur={e => (e.target.style.borderColor = 'rgba(79,142,247,.15)')}
        />
        <button onClick={() => send(input)} disabled={!input.trim() || thinking}
          style={{ width: 38, height: 38, borderRadius: 9, border: 'none', background: input.trim() && !thinking ? '#4f8ef7' : 'rgba(79,142,247,.2)', color: input.trim() && !thinking ? '#fff' : '#4a6890', fontSize: 16, cursor: input.trim() && !thinking ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0, transition: 'background .2s' }}>→</button>
      </div>
    </div>
  );
}

// ── PortfolioView ─────────────────────────────────────────────────────────────

function PortfolioView({ stocks, onSelectStock }: { stocks: typeof STOCKS; onSelectStock: (t: string) => void }) {
  const holdings = PORTFOLIO.map(h => {
    const s = stocks[h.ticker];
    const val = (s?.price ?? 0) * h.shares;
    const cost = h.avgCost * h.shares;
    const gain = val - cost;
    const gainPct = cost ? (gain / cost) * 100 : 0;
    return { ...h, ...s, val, cost, gain, gainPct, todayPL: (s?.change ?? 0) * h.shares };
  });

  const totalVal  = holdings.reduce((a, h) => a + h.val, 0);
  const totalCost = holdings.reduce((a, h) => a + h.cost, 0);
  const totalGain = totalVal - totalCost;
  const totalGainPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const todayTotal = holdings.reduce((a, h) => a + h.todayPL, 0);

  const fmt = (n: number, d = 0) => n.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
  const card = { background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: 16 };
  const stLabel = { fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: '#4a6890', marginBottom: 12 };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>投資組合</div>
      <div style={{ fontSize: 13, color: '#4a6890', marginBottom: 22 }}>4 檔持股 · Mock 市場資料</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        {[
          { label: '總資產',   value: `$${fmt(totalVal, 2)}`,    sub: '4 檔持股' },
          { label: '總損益',   value: `+$${fmt(totalGain, 0)}`,  sub: `+${totalGainPct.toFixed(2)}%`, c: '#00d98b' },
          { label: '今日損益', value: `${todayTotal >= 0 ? '+' : ''}$${fmt(Math.abs(todayTotal), 2)}`, sub: `${todayTotal >= 0 ? '+' : ''}${fmt(Math.abs(todayTotal / totalVal * 100), 2)}%`, c: todayTotal >= 0 ? '#00d98b' : '#ff4060' },
          { label: '可用資金', value: '$12,500.00', sub: '現金餘額' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: '#4a6890', fontWeight: 500, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 600, color: (s as any).c ?? '#ccd8f5' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#4a6890', marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '11px 16px', borderBottom: '1px solid rgba(79,142,247,.12)', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: '#4a6890' }}>
          <span>股票</span><span>股價</span><span>市值</span><span>持股數</span><span>總損益</span><span>AI 信號</span>
        </div>
        {holdings.map(h => (
          <div key={h.ticker} onClick={() => onSelectStock(h.ticker)}
            style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '13px 16px', borderBottom: '1px solid rgba(79,142,247,.08)', cursor: 'pointer', transition: 'background .15s', alignItems: 'center', fontSize: 13 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.025)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{h.ticker}</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 2 }}>{h.name}</div>
            </div>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.sym}{h.price?.toLocaleString() ?? '—'}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: (h.pct ?? 0) >= 0 ? '#00d98b' : '#ff4060', marginTop: 1 }}>{(h.pct ?? 0) >= 0 ? '+' : ''}{(h.pct ?? 0).toFixed(2)}%</div>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.sym}{fmt(h.val)}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.shares}</div>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", color: h.gainPct >= 0 ? '#00d98b' : '#ff4060' }}>{h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 1 }}>{h.gain >= 0 ? '+' : ''}${fmt(Math.abs(h.gain))}</div>
            </div>
            <div>
              {h.verdict && <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: vc(h.verdict as Verdict), background: vbg(h.verdict as Verdict), border: `1px solid ${vbd(h.verdict as Verdict)}`, padding: '2px 8px', borderRadius: 3 }}>{h.verdict}</span>}
            </div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={stLabel}>3 月績效走勢</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
          {holdings.map(h => (
            <div key={h.ticker}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 12 }}>{h.ticker}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: h.gainPct >= 0 ? '#00d98b' : '#ff4060' }}>{h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(1)}%</span>
              </div>
              {h.history && (
                <div style={{ height: 50 }}>
                  <ChartSVG history={h.history} W={200} H={50} accent={h.gainPct >= 0 ? '#00d98b' : '#ff4060'} gradId={`pf-${h.ticker}`} isUp={h.gainPct >= 0} showControls={false} initMode="line" initPeriod="m3" />
                </div>
              )}
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 5 }}>
                持股 {h.shares} {h.market === 'TW' ? '張' : '股'} · 均價 {h.sym}{h.avgCost.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── WatchlistView ─────────────────────────────────────────────────────────────

function WatchlistView({ stocks, onSelectStock }: { stocks: typeof STOCKS; onSelectStock: (t: string) => void }) {
  const [mktFilter, setMktFilter] = useState<'all' | 'TW' | 'US'>('all');
  const filtered = WATCHLIST.filter(t => {
    const s = stocks[t];
    if (!s) return false;
    if (mktFilter === 'TW') return s.market === 'TW';
    if (mktFilter === 'US') return s.market === 'US';
    return true;
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>自選股</div>
      <div style={{ fontSize: 13, color: '#4a6890', marginBottom: 16 }}>{WATCHLIST.length} 檔股票 · AI 監控中</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([['all', '全部市場'], ['TW', '🇹🇼 台股'], ['US', '🇺🇸 美股']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMktFilter(k)}
            style={{ padding: '6px 16px', border: `1px solid ${mktFilter === k ? 'rgba(79,142,247,.45)' : 'rgba(79,142,247,.18)'}`, background: mktFilter === k ? 'rgba(79,142,247,.14)' : 'none', color: mktFilter === k ? '#4f8ef7' : '#4a6890', fontFamily: "'Space Grotesk',sans-serif", fontSize: 12, borderRadius: 20, cursor: 'pointer', fontWeight: mktFilter === k ? 600 : 400 }}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {filtered.map(ticker => {
          const s = stocks[ticker];
          if (!s) return null;
          const isUp = s.pct >= 0;
          return (
            <div key={ticker} onClick={() => onSelectStock(ticker)}
              style={{ background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: 14, cursor: 'pointer', transition: 'border-color .2s,transform .2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,.45)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,.15)'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 15 }}>{ticker}</div>
                    <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: s.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.12)', border: s.market === 'TW' ? '1px solid rgba(255,214,102,.3)' : '1px solid rgba(79,142,247,.25)', color: s.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{s.market === 'TW' ? '台股' : '美股'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#4a6890' }}>{s.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 15 }}>{s.sym}{s.price.toLocaleString()}</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: isUp ? '#00d98b' : '#ff4060', marginTop: 2 }}>{isUp ? '+' : ''}{s.pct.toFixed(2)}%</div>
                </div>
              </div>
              <div style={{ height: 68, marginBottom: 10 }}>
                <ChartSVG history={s.history} W={260} H={68} accent={isUp ? '#00d98b' : '#ff4060'} gradId={`wl-${ticker}`} isUp={isUp} showControls={false} initMode="line" initPeriod="m3" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: vc(s.verdict), background: vbg(s.verdict), border: `1px solid ${vbd(s.verdict)}`, padding: '2px 9px', borderRadius: 3 }}>{s.verdict}</span>
                <span style={{ fontSize: 11, color: '#4a6890' }}>AI 信心：{s.conf}% · {s.sentimentLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NewsView ──────────────────────────────────────────────────────────────────

function NewsView({ stock }: { stock: Stock | null }) {
  const items = stock
    ? stock.news
    : Object.values(STOCKS).flatMap(s => s.news.slice(0, 2));
  const sentC     = (s: Sentiment) => s === 'bullish' ? '#00d98b' : s === 'bearish' ? '#ff4060' : '#ffd666';
  const sentBg    = (s: Sentiment) => s === 'bullish' ? 'rgba(0,217,139,.12)' : s === 'bearish' ? 'rgba(255,64,96,.12)' : 'rgba(255,214,102,.12)';
  const sentLabel = (s: Sentiment) => s === 'bullish' ? '看多' : s === 'bearish' ? '看空' : '中性';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>新聞與情緒分析</div>
      <div style={{ fontSize: 13, color: '#4a6890', marginBottom: 22 }}>{stock ? `${stock.ticker} 相關新聞` : '市場新聞'} · AI 精選並標記情緒</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((n, i) => (
          <div key={i}
            style={{ background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: '14px 16px', cursor: 'pointer', transition: 'border-color .2s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(79,142,247,.4)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(79,142,247,.15)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.55, flex: 1, color: '#ccd8f5' }}>{n.title}</div>
              <span style={{ fontSize: 10, fontWeight: 600, color: sentC(n.sent), background: sentBg(n.sent), border: `1px solid ${sentC(n.sent)}50`, padding: '3px 9px', borderRadius: 4, flexShrink: 0, letterSpacing: '.03em' }}>{sentLabel(n.sent)}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8, fontSize: 11, color: '#4a6890', alignItems: 'center' }}>
              <span style={{ color: '#4f8ef7' }}>{n.src}</span>
              <span style={{ color: '#1e3050' }}>·</span>
              <span>{n.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────

function SettingsView() {
  const [risk, setRisk]     = useState(2);
  const [model, setModel]   = useState('claude');
  const [alerts, setAlerts] = useState({ price: true, ai: true, news: false });
  const card   = { background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: 16, marginBottom: 12 };
  const stLabel= { fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: '#4a6890', marginBottom: 12 };
  const riskLabels = ['非常保守', '保守', '穩健', '積極', '非常積極'];

  function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
    return (
      <div onClick={onChange} style={{ width: 36, height: 20, borderRadius: 10, background: on ? '#4f8ef7' : '#1e3050', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>設定</div>
      <div style={{ fontSize: 13, color: '#4a6890', marginBottom: 22 }}>偏好設定與帳戶資訊</div>

      <div style={card}>
        <div style={stLabel}>風險偏好</div>
        <div style={{ fontSize: 13, marginBottom: 12 }}>
          目前：<span style={{ color: '#4f8ef7', fontWeight: 600 }}>{riskLabels[risk]}</span>
          <span style={{ fontSize: 11, color: '#4a6890', marginLeft: 8 }}>— 影響 AI 建議權重</span>
        </div>
        <input type="range" min="0" max="4" value={risk} onChange={e => setRisk(+e.target.value)} style={{ width: '100%', accentColor: '#4f8ef7', marginBottom: 6 }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#4a6890' }}>
          <span>保守</span><span>穩健</span><span>積極</span>
        </div>
      </div>

      <div style={card}>
        <div style={stLabel}>AI 分析模型</div>
        {[
          { id: 'claude', label: 'Claude Sonnet 4.6', desc: '深度質性分析，擅長風險評估 — 推薦' },
          { id: 'gpt4o',  label: 'GPT-4o',            desc: '速度最快、平衡性佳' },
          { id: 'o1',     label: 'o1 推理模型',        desc: '深度推理，速度較慢' },
        ].map(m => (
          <div key={m.id} onClick={() => setModel(m.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: '1px solid rgba(79,142,247,.1)', cursor: 'pointer' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 2 }}>{m.desc}</div>
            </div>
            <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${model === m.id ? '#4f8ef7' : '#4a6890'}`, background: model === m.id ? '#4f8ef7' : 'none', flexShrink: 0, transition: 'all .15s' }} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={stLabel}>通知偏好</div>
        {[
          { key: 'price' as const, label: '價格提醒',    desc: '股價顯著波動時通知' },
          { key: 'ai' as const,    label: 'AI 信號變化',  desc: '買進/持有/賣出建議改變時通知' },
          { key: 'news' as const,  label: '即時新聞',     desc: '自選股的即時新聞推送' },
        ].map(a => (
          <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(79,142,247,.1)' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 2 }}>{a.desc}</div>
            </div>
            <Toggle on={alerts[a.key]} onChange={() => setAlerts(prev => ({ ...prev, [a.key]: !prev[a.key] }))} />
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={stLabel}>帳戶資訊</div>
        {[['姓名', 'James Wilson'], ['電子郵件', 'james@example.com'], ['方案', 'StockAI Pro · NT$899/月'], ['API 等級', '優先存取'], ['加入日期', '2024 年 1 月']].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(79,142,247,.08)', fontSize: 13 }}>
            <span style={{ color: '#4a6890' }}>{k}</span>
            <span style={{ color: '#ccd8f5' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function StockDashboard() {
  const [view, setView]         = useState<NavId>('chat');
  const [ticker, setTicker]     = useState<string | null>(null);
  const [searchQ, setSearchQ]   = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Inject fonts + global CSS
  useEffect(() => {
    if (!document.getElementById('stockai-fonts')) {
      const link = document.createElement('link');
      link.id = 'stockai-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }
    if (!document.getElementById('stockai-css')) {
      const style = document.createElement('style');
      style.id = 'stockai-css';
      style.textContent = `
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#070b14;color:#ccd8f5;font-family:'Space Grotesk',sans-serif;-webkit-font-smoothing:antialiased}
        @keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}
        @keyframes pulse{0%,100%{opacity:.6}50%{opacity:1}}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(79,142,247,.25);border-radius:2px}
        @media(max-width:1024px){.sa-sidebar{display:none!important}.sa-mob-nav{display:flex!important}.sa-chat{width:100%!important;border-right:none!important}.sa-analysis{display:none!important}}
        @media(max-width:640px){.sa-hdr-search{display:none!important}.sa-hdr-mkts{display:none!important}}
      `;
      document.head.appendChild(style);
    }
  }, []);

  const stock = ticker ? STOCKS[ticker] ?? null : null;

  function goStock(t: string) {
    setTicker(t);
    setView('chat');
    setSearchQ('');
    setSearchOpen(false);
  }

  const searchResults = searchQ.trim().length > 0
    ? Object.values(STOCKS).filter(s => {
        const q = searchQ.toLowerCase();
        return s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  const mkts = [
    { l: 'S&P 500', v: '+0.84%', up: true },
    { l: 'NASDAQ',  v: '+1.21%', up: true },
    { l: 'VIX',     v: '18.43',  up: false },
  ];

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#070b14', color: '#ccd8f5', fontFamily: "'Space Grotesk',sans-serif" }}>

      {/* ── Header ── */}
      <header style={{ height: 52, background: '#0c1422', borderBottom: '1px solid rgba(79,142,247,.15)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, letterSpacing: '-.02em', flexShrink: 0 }}>
          <div style={{ width: 26, height: 26, background: 'linear-gradient(135deg,#4f8ef7,#1e4fd8)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 12 }}>◈</div>
          StockAI
        </div>

        {/* Search */}
        <div className="sa-hdr-search" style={{ flex: '0 0 360px', position: 'relative' }}>
          <div style={{ background: '#101e35', border: `1px solid ${searchOpen ? 'rgba(79,142,247,.45)' : 'rgba(79,142,247,.15)'}`, borderRadius: 7, height: 34, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, transition: 'border-color .2s' }}>
            <span style={{ fontSize: 15, color: '#4a6890', flexShrink: 0 }}>⌕</span>
            <input
              value={searchQ}
              onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchQ(''); setSearchOpen(false); } }}
              placeholder="搜尋股票代碼或名稱…"
              style={{ background: 'none', border: 'none', outline: 'none', color: '#ccd8f5', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, width: '100%' }}
            />
            {searchQ && <span onClick={() => setSearchQ('')} style={{ color: '#4a6890', cursor: 'pointer', flexShrink: 0, fontSize: 16, lineHeight: '1' }}>×</span>}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: 38, left: 0, right: 0, background: '#0c1422', border: '1px solid rgba(79,142,247,.3)', borderRadius: 8, zIndex: 200, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
              {searchResults.map(s => {
                const isUp = s.pct >= 0;
                return (
                  <div key={s.ticker} onClick={() => goStock(s.ticker)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(79,142,247,.1)', transition: 'background .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(79,142,247,.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13 }}>{s.ticker}</span>
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: s.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.12)', color: s.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{s.market === 'TW' ? '台股' : '美股'}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#4a6890', marginTop: 1 }}>{s.name}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>{s.sym}{s.price.toLocaleString()}</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isUp ? '#00d98b' : '#ff4060' }}>{isUp ? '+' : ''}{s.pct.toFixed(2)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {searchOpen && searchQ.trim().length > 0 && searchResults.length === 0 && (
            <div style={{ position: 'absolute', top: 38, left: 0, right: 0, background: '#0c1422', border: '1px solid rgba(79,142,247,.2)', borderRadius: 8, zIndex: 200, padding: '14px 16px', fontSize: 12, color: '#4a6890', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
              找不到符合「{searchQ}」的股票
            </div>
          )}
        </div>

        {/* Market tickers */}
        <div className="sa-hdr-mkts" style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {mkts.map(m => (
            <div key={m.l} style={{ display: 'flex', gap: 6, padding: '4px 10px', background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 5, fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
              <span style={{ color: '#4a6890' }}>{m.l}</span>
              <span style={{ color: m.up ? '#00d98b' : '#ff4060' }}>{m.v}</span>
            </div>
          ))}
        </div>

        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#4f8ef7,#00d98b)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#070b14', fontWeight: 700, fontSize: 12, cursor: 'pointer', marginLeft: searchQ ? 0 : 'auto' }}>J</div>
      </header>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside className="sa-sidebar" style={{ width: 210, flexShrink: 0, background: '#0c1422', borderRight: '1px solid rgba(79,142,247,.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <nav style={{ padding: '10px 0' }}>
            {NAV_ITEMS.map(n => (
              <button key={n.id} onClick={() => setView(n.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 16px', border: 'none', background: view === n.id ? 'rgba(79,142,247,.1)' : 'none', color: view === n.id ? '#4f8ef7' : '#4a6890', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'left', transition: 'color .15s,background .15s', borderLeft: `2px solid ${view === n.id ? '#4f8ef7' : 'transparent'}` }}
                onMouseEnter={e => { if (view !== n.id) { e.currentTarget.style.color = '#ccd8f5'; e.currentTarget.style.background = 'rgba(255,255,255,.04)'; } }}
                onMouseLeave={e => { if (view !== n.id) { e.currentTarget.style.color = '#4a6890'; e.currentTarget.style.background = 'none'; } }}
              >
                <span style={{ width: 16, textAlign: 'center', fontSize: 14 }}>{n.icon}</span>
                {n.label}
              </button>
            ))}
          </nav>

          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1e3050', padding: '14px 16px 7px' }}>Watchlist</div>

          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
            {WATCHLIST.map(t => {
              const s = STOCKS[t];
              if (!s) return null;
              const isUp   = s.pct >= 0;
              const active = ticker === t;
              return (
                <div key={t} onClick={() => goStock(t)}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 14px 7px 16px', background: active ? 'rgba(79,142,247,.07)' : 'none', borderLeft: `2px solid ${active ? '#4f8ef7' : 'transparent'}`, cursor: 'pointer', transition: 'background .15s' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.025)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 12 }}>{t}</div>
                      <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: s.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.1)', color: s.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{s.market === 'TW' ? '台' : 'US'}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#4a6890', marginTop: 1 }}>{s.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{s.sym}{s.price.toLocaleString()}</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isUp ? '#00d98b' : '#ff4060' }}>{isUp ? '+' : ''}{s.pct.toFixed(2)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {view === 'chat' && (
            <>
              <div className="sa-chat" style={{ width: 440, flexShrink: 0 }}>
                <ChatPanel stocks={STOCKS} onStockSelect={goStock} />
              </div>
              <div className="sa-analysis" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                <AnalysisPanel stock={stock} />
              </div>
            </>
          )}
          {view === 'portfolio' && <PortfolioView stocks={STOCKS} onSelectStock={goStock} />}
          {view === 'watchlist' && <WatchlistView stocks={STOCKS} onSelectStock={goStock} />}
          {view === 'news'      && <NewsView stock={stock} />}
          {view === 'settings'  && <SettingsView />}
        </main>
      </div>

      {/* Mobile nav */}
      <nav className="sa-mob-nav" style={{ display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, background: '#0c1422', borderTop: '1px solid rgba(79,142,247,.15)', height: 60, justifyContent: 'space-around', alignItems: 'center', zIndex: 100 }}>
        {NAV_ITEMS.slice(0, 4).map(n => (
          <button key={n.id} onClick={() => setView(n.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: view === n.id ? '#4f8ef7' : '#4a6890', fontFamily: "'Space Grotesk',sans-serif", fontSize: 10, cursor: 'pointer', padding: '4px 10px' }}
          >
            <span style={{ fontSize: 20, lineHeight: '1' }}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
