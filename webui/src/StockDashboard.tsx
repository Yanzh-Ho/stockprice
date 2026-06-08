// StockDashboard.tsx — Stock AI Analysis Platform
// Single-file component. Paste into src/ of any Vite + React + TypeScript project.
// Add to index.html <head>:
//   <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>

import { useState, useEffect, useRef, useCallback } from 'react';

// ── WebSocket / API URL ───────────────────────────────────────────────────────
const WS_URL  = 'wss://stockprice-2ukw.onrender.com';
const API_URL = WS_URL.replace('wss://', 'https://').replace('ws://', 'http://');

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

interface PortfolioHolding { ticker: string; buyPrice: number; lots: number }
interface AiPrediction    { ticker: string; targetPrice: number; date: string; priceAtTime: number }
interface PeerData        { symbol: string; name: string; price: number | null; changePercent: number | null; pe: number | null; eps: number | null; marketCap: number | null }

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

const WL_KEY     = 'fp_wl';
const WL_DEFAULT = ['2330', '2454', '2317', '2412', 'AAPL', 'NVDA'];
const loadWL = (): string[] => { try { const s = localStorage.getItem(WL_KEY); return s ? JSON.parse(s) : WL_DEFAULT; } catch { return WL_DEFAULT; } };
const saveWL = (d: string[]) => localStorage.setItem(WL_KEY, JSON.stringify(d));

const PF_KEY = 'fp_pf', ACC_KEY = 'fp_acc';
const PF_DEFAULT: PortfolioHolding[] = [
  { ticker: 'NVDA', buyPrice: 648.50, lots: 15  },
  { ticker: 'TSM',  buyPrice: 144.80, lots: 50  },
  { ticker: '2330', buyPrice: 695,    lots: 3   },
  { ticker: '2454', buyPrice: 950,    lots: 0.5 },
];
const loadPF  = (): PortfolioHolding[] => { try { const s = localStorage.getItem(PF_KEY);  return s ? JSON.parse(s) : PF_DEFAULT; } catch { return PF_DEFAULT; } };
const savePF  = (d: PortfolioHolding[]) => localStorage.setItem(PF_KEY, JSON.stringify(d));
const loadAcc = (): AiPrediction[]      => { try { return JSON.parse(localStorage.getItem(ACC_KEY) ?? '[]'); } catch { return []; } };
const saveAcc = (d: AiPrediction[])     => localStorage.setItem(ACC_KEY, JSON.stringify(d));


const AI_RESPONSES: Record<string, string> = {
  '2330': '▌ 市場環境與近期動態\n台積電掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈核心骨幹。輝達與蘋果訂單能見度延伸至 2026 年，外資連續 8 日買超。2 奈米製程良率超出市場預期，法說會細節即將揭露，市場情緒偏多。\n\n▌ 技術面訊號\n週線站上 20 週均線，RSI 62 偏強未過熱，成交量放大配合上攻。短期壓力區 NT$920–945（52W 高點），支撐在 NT$840（月線）。MACD 黃金交叉成立，中期上行動能完整。\n\n▌ 主要風險因子\n• 台灣海峽地緣政治風險（尾端但影響最大）\n• 客戶集中度偏高（蘋果＋輝達合計佔 50% 營收）\n• 美元兌台幣匯率敞口，每升值 1% 稀釋 EPS 約 0.4%\n• 半導體景氣循環下行風險（CoWoS 擴產後供需平衡點）\n\n▌ 投資建議摘要\n**目標價：NT$970**（+10.9%）｜**停損點：NT$820**｜**倉位建議：核心持股，建議 15–20%**',
  '2454': '▌ 市場環境與近期動態\n聯發科天璣 9400 成功拿下三星 Galaxy S25 系列訂單，AI 手機晶片市佔率快速提升。衛星通訊模組及車用 SoC 為新成長引擎，Q2 營收季增 18% 超越市場預期，法人上調全年 EPS 預估。\n\n▌ 技術面訊號\n突破 NT$1,200 關鍵壓力，RSI 70 接近短線過熱，量能放大確認突破有效。短期支撐在 NT$1,150（前壓撐），壓力看 NT$1,280（52W 高）。\n\n▌ 主要風險因子\n• 中國客戶佔比偏高（約 55%），中美貿易戰升溫直接衝擊\n• 高通競爭壓力持續，旗艦機市佔爭奪激烈\n• AI PC 及 IoT 新市場滲透率仍低，變現能力待驗證\n• 手機晶片市場整體成長趨緩\n\n▌ 投資建議摘要\n**目標價：NT$1,320**（+11.9%）｜**停損點：NT$1,050**｜**倉位建議：成長配置，建議 8–12%**',
  '2317': '▌ 市場環境與近期動態\n鴻海印度廠持續擴產加速蘋果供應鏈去中化，AI 伺服器業務成長動能浮現。Foxtron 電動車在台訂單突破千輛，但蘋果 AI 功能推遲使 Q3 訂單能見度趨保守。\n\n▌ 技術面訊號\n股價在 NT$175–185 整理，低於 20/60 日均線壓制。RSI 48 中性偏弱，週線 MACD 翻轉訊號初現，量能未能明顯放大，需觀察突破確認。\n\n▌ 主要風險因子\n• 蘋果供應鏈集中度過高（佔 45% 營收）\n• 電動車新業務仍在虧損燒錢階段\n• 中美貿易戰轉單效應不確定\n• 代工業務毛利率長期偏低（約 6%）\n\n▌ 投資建議摘要\n**目標價：NT$200**（+9.9%）｜**停損點：NT$165**｜**倉位建議：等待電動車業務明確轉虧為盈訊號，或回測 NT$165 再加碼**',
  '2412': '▌ 市場環境與近期動態\n中華電信 5G 企業專網簽約台積電，打入半導體廠域。AI 客服平台上線年省逾億元成本，NCC 放寬資費管制有助獲利改善。電信業整體進入現金流穩定成熟期。\n\n▌ 技術面訊號\n股價於 NT$115–125 防禦型區間整理，Beta 值僅 0.32 波動極低。RSI 50 中性，殖利率 4.85% 提供下檔保護。缺乏明顯技術突破動力，適合存股策略。\n\n▌ 主要風險因子\n• 5G 投資回收期漫長，資本支出壓力持續\n• 民營電信競爭侵蝕用戶 ARPU\n• 國際業務成長有限，難以擴大營收規模\n• 高殖利率但成長性天花板明確\n\n▌ 投資建議摘要\n**目標價：NT$128**（+5.8%）｜**停損點：NT$110**｜**倉位建議：防禦型配息持股，建議 5–8%**',
  '2882': '▌ 市場環境與近期動態\nFed 降息預期升溫，金融股殖利率吸引力浮現，壽險資產評價有望改善。國泰人壽 AI 核保系統上線，理賠速度提升 40%，長期降低成本結構。台幣升值壓力仍為近期隱憂。\n\n▌ 技術面訊號\n股價於 NT$58–62 區間整理，靠近下方支撐。RSI 45 中性偏弱，月線乖離率轉正。若 Fed 啟動降息循環，股價存在明顯補漲空間至 NT$68–72。\n\n▌ 主要風險因子\n• 台幣升值壓縮海外投資收益（每升值 1% 影響 EPS 約 3%）\n• 利率環境轉變衝擊壽險資產配置\n• 股市大幅修正影響基金管理費收入\n• 金融業法規趨嚴，資本適足率要求提升\n\n▌ 投資建議摘要\n**目標價：NT$68**（+9.7%）｜**停損點：NT$54**｜**倉位建議：配息型持股，建議 5–8%**',
  'TSM':  '▌ 市場環境與近期動態\n台積電 ADR 掌控全球超過 60% 的先進晶圓代工產能，是 AI 晶片供應鏈核心。輝達 Blackwell 晶片出貨超前進度，蘋果 N3E 製程確認用於 iPhone 17 系列，月營收年增 40% 強勁。\n\n▌ 技術面訊號\n股價鞏固於 $185 附近，低於 52W 高點 $193.50。RSI 65 健康，站上 50/200 日均線，技術結構偏多。支撐在 $170（60DMA），壓力看 $193（52W 高）。\n\n▌ 主要風險因子\n• 台灣海峽地緣政治風險（最大尾端風險）\n• 蘋果＋輝達客戶集中度偏高（合計佔 50% 營收）\n• 美元兌台幣匯率敞口影響 ADR 折溢價\n• 半導體景氣循環下行風險\n\n▌ 投資建議摘要\n**目標價：$205**（+10.6%）｜**停損點：$158**｜**倉位建議：核心持股，建議 12–18%**',
  'TSLA': '▌ 市場環境與近期動態\n特斯拉 Q2 交付量不如預期，比亞迪在歐洲連續兩個月銷量超越特斯拉。FSD 第 13 版城市駕駛能力大幅提升，Robotaxi 商業化時程仍不確定。CEO 爭議持續影響品牌形象。\n\n▌ 技術面訊號\n股價跌破 200 日均線，RSI 42 中性偏弱，$220 為關鍵支撐（跌破轉弱），壓力在 $270（60DMA）。短期呈現高波動震盪格局，Beta 2.31 需嚴格控制倉位。\n\n▌ 主要風險因子\n• 比亞迪電動車競爭持續加劇，歐洲市場份額流失\n• 62 倍本益比已反映大量 Robotaxi/Optimus 未來潛力\n• 持續降價壓縮毛利，毛利率下行壓力明顯\n• CEO 爭議導致品牌形象受損，消費者好感度下滑\n\n▌ 投資建議摘要\n**目標價：$255**（+2.5%）｜**停損點：$190**｜**倉位建議：等待 $200–220 更佳進場點，高 Beta 控制在 5% 以內**',
  'NVDA': '▌ 市場環境與近期動態\n輝達 Blackwell 晶片出貨進度超前，微軟為 Azure AI 訂購 40 萬顆 H200 GPU。資料中心營收年增逾 400%，CUDA 生態系護城河使 AMD 與 Intel 至今難以突破。毛利率擴張至約 78%。\n\n▌ 技術面訊號\n股價逼近 ATH $974，RSI 78 偏高略過熱，短線需消化漲幅。突破前高後支撐在 $840（前壓撐），動能指標持續偏強。長線趨勢完整，短線波動風險高。\n\n▌ 主要風險因子\n• 68 倍本益比估值偏高，容錯空間有限\n• 中國出口管制限制 A800/H800 晶片銷售\n• AMD MI300X 在雲端超大規模業者中逐漸獲採用\n• AI 資本支出週期正常化後需求可能放緩\n\n▌ 投資建議摘要\n**目標價：$1,050**（+14.1%）｜**停損點：$780**｜**倉位建議：AI 基礎設施核心持股，建議 10–15%**',
  'AAPL': '▌ 市場環境與近期動態\nApple Intelligence 獲歐盟監管批准正式推出，iPhone 17 Pro 預購創下 iPhone 15 以來最強表現。服務業務年化規模約 1,000 億美元，獲利基礎穩定可預測。美司法部 App Store 反壟斷案進入取證階段。\n\n▌ 技術面訊號\n股價於 $190 附近築底，低於 52W 高點 $237.23。RSI 48 中性，200 日均線提供支撐。若 iPhone 換機潮確認，上看 $220–237 區間。缺乏短期催化劑時，股價可能持續區間整理。\n\n▌ 主要風險因子\n• 中國市場營收敞口（佔總營收 18%），中美關係惡化直接衝擊\n• iPhone 換機週期持續拉長，升級需求不如預期\n• Apple Intelligence 變現前景不確定，訂閱模式尚未成形\n• App Store 反壟斷監管審查可能影響服務業務獲利率\n\n▌ 投資建議摘要\n**目標價：$220**（+12.6%）｜**停損點：$168**｜**倉位建議：防禦型科技核心持股，建議 8–12%**',
  'MSFT': '▌ 市場環境與近期動態\nAzure 受 AI 需求帶動再加速至 29% 成長，Microsoft 365 Copilot 企業席次突破 100 萬。面向超過 4 億 Office 用戶的 AI 訂閱（$30/用戶/月）是龐大變現機會。企業分發護城河無可匹敵。\n\n▌ 技術面訊號\n中期強勢上升趨勢完整，支撐在 $400（整數關卡兼月線），RSI 65 健康。站上所有關鍵均線，動能指標偏強。短線壓力在 $468（52W 高），突破後看 $500。\n\n▌ 主要風險因子\n• Azure 成長動能放緩風險（從 29% 回落）\n• 對 OpenAI 的高度依賴，合作條款存在不確定性\n• 企業 IT 支出週期波動，宏觀不確定性影響雲端預算\n• 反壟斷監管審查持續（搜尋、辦公室軟體市場）\n\n▌ 投資建議摘要\n**目標價：$480**（+16.3%）｜**停損點：$355**｜**倉位建議：雲端 AI 核心持股，建議 12–18%**',
};

const INSTITUTIONAL_TARGETS: Record<string, Array<{ broker: string; rating: string; target: number; date: string }>> = {
  '2330': [
    { broker: '摩根大通', rating: '增持', target: 1000, date: '2025/06/02' },
    { broker: '高盛', rating: '買進', target: 970, date: '2025/05/28' },
    { broker: '花旗', rating: '中立', target: 920, date: '2025/05/20' },
    { broker: '瑞銀', rating: '買進', target: 990, date: '2025/06/01' },
  ],
  '2454': [
    { broker: '摩根士丹利', rating: '增持', target: 1350, date: '2025/05/30' },
    { broker: '美銀美林', rating: '買進', target: 1280, date: '2025/06/01' },
    { broker: '瑞信', rating: '中立', target: 1100, date: '2025/05/18' },
  ],
  '2317': [
    { broker: '元大投顧', rating: '買進', target: 210, date: '2025/05/30' },
    { broker: '凱基投顧', rating: '持有', target: 195, date: '2025/05/25' },
    { broker: '摩根大通', rating: '中立', target: 188, date: '2025/06/02' },
  ],
  '2412': [
    { broker: '富邦投顧', rating: '買進', target: 135, date: '2025/05/20' },
    { broker: '兆豐投顧', rating: '中立', target: 130, date: '2025/05/28' },
    { broker: '凱基投顧', rating: '持有', target: 125, date: '2025/06/01' },
  ],
  '2882': [
    { broker: '台灣工銀', rating: '買進', target: 70, date: '2025/06/01' },
    { broker: '日盛投顧', rating: '買進', target: 72, date: '2025/05/28' },
    { broker: '元富投顧', rating: '持有', target: 65, date: '2025/05/22' },
  ],
  'TSM': [
    { broker: 'J.P. Morgan', rating: 'Overweight', target: 210, date: '2025/06/02' },
    { broker: 'BofA', rating: 'Buy', target: 215, date: '2025/05/30' },
    { broker: 'Goldman Sachs', rating: 'Buy', target: 205, date: '2025/05/28' },
    { broker: 'Citi', rating: 'Buy', target: 200, date: '2025/06/01' },
  ],
  'TSLA': [
    { broker: 'Wedbush', rating: 'Outperform', target: 315, date: '2025/05/28' },
    { broker: 'Morgan Stanley', rating: 'Equal Weight', target: 250, date: '2025/05/20' },
    { broker: 'Goldman Sachs', rating: 'Neutral', target: 230, date: '2025/06/01' },
  ],
  'NVDA': [
    { broker: 'J.P. Morgan', rating: 'Overweight', target: 1150, date: '2025/06/02' },
    { broker: 'Morgan Stanley', rating: 'Overweight', target: 1100, date: '2025/06/03' },
    { broker: 'Citi', rating: 'Buy', target: 1050, date: '2025/05/30' },
    { broker: 'BofA', rating: 'Buy', target: 1000, date: '2025/06/01' },
  ],
  'AAPL': [
    { broker: 'J.P. Morgan', rating: 'Overweight', target: 230, date: '2025/06/02' },
    { broker: 'Goldman Sachs', rating: 'Buy', target: 225, date: '2025/05/28' },
    { broker: 'BofA', rating: 'Neutral', target: 200, date: '2025/06/01' },
  ],
  'MSFT': [
    { broker: 'J.P. Morgan', rating: 'Overweight', target: 510, date: '2025/06/02' },
    { broker: 'Morgan Stanley', rating: 'Overweight', target: 500, date: '2025/06/03' },
    { broker: 'Goldman Sachs', rating: 'Buy', target: 490, date: '2025/06/01' },
    { broker: 'Citi', rating: 'Buy', target: 470, date: '2025/05/28' },
  ],
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
  const renderInline = (line: string) =>
    line.split(/(\*\*.*?\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={j} style={{ color: '#4f8ef7', fontWeight: 600 }}>{p.slice(2, -2)}</strong>
        : <span key={j}>{p}</span>
    );

  return (
    <div style={{ fontSize: 12 }}>
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: 6 }} />;

        if (line.startsWith('▌ ')) {
          return (
            <div key={i} style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' as const,
              color: '#4f8ef7', borderLeft: '2px solid #4f8ef7', paddingLeft: 7,
              margin: '12px 0 5px', lineHeight: 1.4,
            }}>
              {line.slice(2)}
            </div>
          );
        }

        if (line.startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 7, marginBottom: 4, lineHeight: 1.6, alignItems: 'flex-start', color: '#8fa8c8' }}>
              <span style={{ color: '#ff6060', flexShrink: 0, fontSize: 10, marginTop: 3 }}>▲</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }

        return (
          <div key={i} style={{ lineHeight: 1.65, margin: '1px 0', color: '#8fa8c8' }}>
            {renderInline(line)}
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

// ── WlBtn ─────────────────────────────────────────────────────────────────────

function WlBtn({ ticker, watchlist, onAdd, onRemove }: {
  ticker: string; watchlist: string[];
  onAdd: (t: string) => void; onRemove: (t: string) => void;
}) {
  const inWl = watchlist.includes(ticker);
  return (
    <button
      onClick={e => { e.stopPropagation(); inWl ? onRemove(ticker) : onAdd(ticker); }}
      title={inWl ? '從自選股移除' : '加入自選股'}
      style={{
        background: inWl ? 'rgba(255,214,102,.18)' : 'rgba(79,142,247,.1)',
        border: `1px solid ${inWl ? 'rgba(255,214,102,.45)' : 'rgba(79,142,247,.25)'}`,
        borderRadius: 5, color: inWl ? '#ffd666' : '#4a6890',
        cursor: 'pointer', fontSize: 13, padding: '3px 8px',
        lineHeight: 1, transition: 'all .15s', flexShrink: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.opacity = '.75'; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
    >
      {inWl ? '★' : '☆'}
    </button>
  );
}

// ── MiniStockCard ─────────────────────────────────────────────────────────────

function MiniStockCard({ stock, watchlist, onSelect, onAdd, onRemove }: {
  stock: Stock; watchlist: string[];
  onSelect: (t: string) => void; onAdd: (t: string) => void; onRemove: (t: string) => void;
}) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <WlBtn ticker={stock.ticker} watchlist={watchlist} onAdd={onAdd} onRemove={onRemove} />
          <span style={{ fontSize: 11, color: '#4a6890' }}>信心：{stock.conf}%</span>
        </div>
      </div>
    </div>
  );
}

// ── AnalysisPanel ─────────────────────────────────────────────────────────────

function fmtMCap(v: number | null) {
  if (!v) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  return `$${(v / 1e6).toFixed(0)}M`;
}

function AnalysisPanel({ stock, watchlist, onAdd, onRemove }: {
  stock: Stock | null; watchlist: string[];
  onAdd: (t: string) => void; onRemove: (t: string) => void;
}) {
  const [peers, setPeers]               = useState<PeerData[]>([]);
  const [peersLoading, setPeersLoading] = useState(false);

  useEffect(() => {
    if (!stock?.target?.mid) return;
    const today = new Date().toISOString().split('T')[0];
    const acc = loadAcc();
    if (!acc.some(a => a.ticker === stock.ticker && a.date === today)) {
      saveAcc([...acc, { ticker: stock.ticker, targetPrice: stock.target.mid, date: today, priceAtTime: stock.price }]);
    }
  }, [stock?.ticker]);

  useEffect(() => {
    if (!stock) return;
    setPeers([]); setPeersLoading(true);
    fetch(`${API_URL}/api/peers?symbol=${encodeURIComponent(stock.ticker)}&name=${encodeURIComponent(stock.fullName)}&sector=${encodeURIComponent(stock.sector)}`)
      .then(r => r.json())
      .then(d => setPeers(d.peers ?? []))
      .catch(() => setPeers([]))
      .finally(() => setPeersLoading(false));
  }, [stock?.ticker]);

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
          <div style={{ marginTop: 9, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <WlBtn ticker={stock.ticker} watchlist={watchlist} onAdd={onAdd} onRemove={onRemove} />
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
        <div style={{ marginBottom: 14 }}>
          <AIText text={AI_RESPONSES[stock.ticker] ?? stock.summary} />
        </div>
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
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(79,142,247,.15)', fontSize: 11, color: '#7a9cc0', lineHeight: 1.6 }}>
          ⚠ 以上分析及目標價<span style={{ fontWeight: 600 }}>僅供參考，不構成投資建議</span>。投資有風險，進場需謹慎。
        </div>
      </div>

      {/* Metrics + Analysts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div style={{ ...card, marginBottom: 0 }}>
          <div style={stLabel}>關鍵指標</div>
          {[['市值', stock.cap], ['本益比', stock.pe], ['每股盈餘 (TTM)', stock.eps], ['Beta 值', stock.beta], ['成交量', stock.vol], ['均量', stock.avgVol], ['52週高點', `${stock.sym}${stock.hi52.toLocaleString()}`], ['52週低點', `${stock.sym}${stock.lo52.toLocaleString()}`], ['殖利率', stock.div]].map(([k, v]) => (
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

      {/* Institutional Targets */}
      {INSTITUTIONAL_TARGETS[stock.ticker] && (
        <div style={card}>
          <div style={stLabel}>法人目標價</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.9fr 0.8fr 0.9fr', gap: 6, padding: '0 0 8px', borderBottom: '1px solid rgba(79,142,247,.15)', marginBottom: 6, fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6890' }}>
            <span>券商</span><span>評等</span><span style={{ textAlign: 'right' }}>目標價</span><span style={{ textAlign: 'center' }}>較現價</span><span style={{ textAlign: 'right' }}>更新日期</span>
          </div>
          {INSTITUTIONAL_TARGETS[stock.ticker].map((t, i) => {
            const diff = (t.target - stock.price) / stock.price * 100;
            const isBull = t.rating === '買進' || t.rating === 'Buy' || t.rating === 'Overweight' || t.rating === 'Outperform' || t.rating === '增持';
            const isBear = t.rating === '賣出' || t.rating === 'Sell' || t.rating === 'Underweight' || t.rating === 'Underperform';
            const ratingCol = isBull ? '#00d98b' : isBear ? '#ff4060' : '#ffd666';
            const rows = INSTITUTIONAL_TARGETS[stock.ticker];
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.9fr 0.8fr 0.9fr', gap: 6, padding: '7px 0', borderBottom: i < rows.length - 1 ? '1px solid rgba(79,142,247,.08)' : 'none', fontSize: 12, alignItems: 'center' }}>
                <span style={{ color: '#ccd8f5', fontWeight: 500, fontSize: 11 }}>{t.broker}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: ratingCol, background: ratingCol + '18', border: `1px solid ${ratingCol}40`, padding: '2px 5px', borderRadius: 3, display: 'inline-block', letterSpacing: '.03em', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.rating}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, textAlign: 'right' }}>{stock.sym}{t.target.toLocaleString()}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: diff >= 0 ? '#00d98b' : '#ff4060', textAlign: 'center', fontWeight: 600 }}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)}%</span>
                <span style={{ fontSize: 10, color: '#4a6890', textAlign: 'right' }}>{t.date}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Peer Comparison — AI-powered */}
      {peersLoading && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={stLabel}>同業比較</div>
            <span style={{ fontSize: 11, color: '#4a6890', animation: 'pulse 1.2s infinite' }}>AI 識別競爭對手中…</span>
          </div>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '9px 0', borderBottom: '1px solid rgba(79,142,247,.06)' }}>
              {[60, 40, 30, 25, 25, 25, 30].map((w, j) => (
                <div key={j} style={{ height: 11, width: `${w}%`, borderRadius: 3, background: 'rgba(79,142,247,.09)', animation: `pulse 1.4s ${j * 0.1}s infinite` }} />
              ))}
            </div>
          ))}
        </div>
      )}
      {!peersLoading && peers.length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={stLabel}>同業比較 · {stock.sector}</div>
            <span style={{ fontSize: 10, color: '#4a6890' }}>AI 自動識別</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['代號', '公司名', '股價', '漲跌%', '本益比', 'EPS', '市值'].map((h, i) => (
                    <th key={h} style={{ padding: '0 6px 8px', textAlign: i <= 1 ? 'left' : 'right', fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' as const, color: '#4a6890', whiteSpace: 'nowrap' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Current stock row first */}
                <tr style={{ borderTop: '1px solid rgba(79,142,247,.08)', background: 'rgba(79,142,247,.07)' }}>
                  <td style={{ padding: '7px 6px', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 11 }}>{stock.ticker}</td>
                  <td style={{ padding: '7px 6px', fontSize: 11, color: '#ccd8f5', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{stock.name}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.sym}{stock.price.toLocaleString()}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: stock.pct >= 0 ? '#00d98b' : '#ff4060', fontWeight: 600 }}>{stock.pct >= 0 ? '+' : ''}{stock.pct.toFixed(2)}%</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.pe}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.eps}</td>
                  <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{stock.cap}</td>
                </tr>
                {/* Peer rows */}
                {peers.map(p => {
                  const isTW  = /\.(TW|TWO)$/i.test(p.symbol);
                  const sym   = isTW ? 'NT$' : '$';
                  const up    = (p.changePercent ?? 0) >= 0;
                  return (
                    <tr key={p.symbol} style={{ borderTop: '1px solid rgba(79,142,247,.06)' }}>
                      <td style={{ padding: '7px 6px', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 11 }}>{p.symbol}</td>
                      <td style={{ padding: '7px 6px', fontSize: 11, color: '#8fa8c8', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{p.name}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{p.price != null ? `${sym}${p.price.toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: up ? '#00d98b' : '#ff4060', fontWeight: 600 }}>
                        {p.changePercent != null ? `${up ? '+' : ''}${p.changePercent.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{p.pe != null ? `${p.pe.toFixed(1)}x` : '—'}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{p.eps != null ? p.eps.toFixed(2) : '—'}</td>
                      <td style={{ padding: '7px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{fmtMCap(p.marketCap)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Accuracy History */}
      {(() => {
        const history = loadAcc().filter(a => a.ticker === stock.ticker);
        if (!history.length) return null;
        const hits = history.filter(a => Math.abs((stock.price - a.targetPrice) / a.priceAtTime * 100) < 10);
        const hitRate = (hits.length / history.length * 100).toFixed(0);
        return (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={stLabel}>AI 歷史目標價準確率</div>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: Number(hitRate) >= 60 ? '#00d98b' : '#ff4060' }}>{hitRate}% 命中率</span>
            </div>
            {history.slice(-5).reverse().map((a, i) => {
              const daysSince = Math.floor((Date.now() - new Date(a.date).getTime()) / 86400000);
              const pctDiff = (stock.price - a.targetPrice) / a.priceAtTime * 100;
              const hit = Math.abs(pctDiff) < 10;
              const pending = daysSince < 30;
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 6, padding: '7px 0', borderBottom: '1px solid rgba(79,142,247,.08)', fontSize: 12, alignItems: 'center' }}>
                  <span style={{ color: '#4a6890', fontSize: 11 }}>{a.date}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>目標 {stock.sym}{a.targetPrice.toLocaleString()}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>現價 {stock.sym}{stock.price.toLocaleString()}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: pctDiff >= 0 ? '#00d98b' : '#ff4060' }}>{pctDiff >= 0 ? '+' : ''}{pctDiff.toFixed(1)}%</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3, background: pending ? 'rgba(255,214,102,.12)' : hit ? 'rgba(0,217,139,.12)' : 'rgba(255,64,96,.12)', color: pending ? '#ffd666' : hit ? '#00d98b' : '#ff4060', border: `1px solid ${pending ? 'rgba(255,214,102,.3)' : hit ? 'rgba(0,217,139,.3)' : 'rgba(255,64,96,.3)'}` }}>
                    {pending ? '追蹤中' : hit ? '命中' : '未達'}
                  </span>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: '#4a6890', marginTop: 8 }}>命中定義：30天後股價與目標價偏差 &lt; 10%</div>
          </div>
        );
      })()}
    </div>
  );
}

// ── ChatPanel ─────────────────────────────────────────────────────────────────

function ChatPanel({ stocks, watchlist, onStockSelect, onLiveData, onAddWl, onRemoveWl }: {
  stocks: typeof STOCKS; watchlist: string[];
  onStockSelect: (t: string) => void; onLiveData: (s: Stock) => void;
  onAddWl: (t: string) => void; onRemoveWl: (t: string) => void;
}) {
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
            data?: Stock;
            message?: string;
            verdict?: string; conf?: number;
          };
          const id = activeMsgRef.current;

          if (msg.type === 'stockData' && msg.data) {
            // Push live data to parent state so every component re-renders
            onLiveData(msg.data);
            // Also navigate to that ticker
            const sym = msg.data.ticker ?? '';
            if (sym) onStockSelect(sym);
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
                        <MiniStockCard stock={stocks[msg.ticker]} watchlist={watchlist} onSelect={onStockSelect} onAdd={onAddWl} onRemove={onRemoveWl} />
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
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(loadPF);
  const [addForm, setAddForm]   = useState({ show: false, ticker: '', buyPrice: '', lots: '' });
  const [editIdx, setEditIdx]   = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ buyPrice: '', lots: '' });

  function updateHoldings(next: PortfolioHolding[]) { setHoldings(next); savePF(next); }
  function addHolding() {
    const ticker = addForm.ticker.toUpperCase().trim();
    const bp = parseFloat(addForm.buyPrice), lots = parseFloat(addForm.lots);
    if (!ticker || isNaN(bp) || isNaN(lots) || lots <= 0) return;
    updateHoldings([...holdings, { ticker, buyPrice: bp, lots }]);
    setAddForm({ show: false, ticker: '', buyPrice: '', lots: '' });
  }
  function saveEdit() {
    if (editIdx === null) return;
    const bp = parseFloat(editForm.buyPrice), lots = parseFloat(editForm.lots);
    if (isNaN(bp) || isNaN(lots)) return;
    updateHoldings(holdings.map((h, i) => i === editIdx ? { ...h, buyPrice: bp, lots } : h));
    setEditIdx(null);
  }

  const calced = holdings.map(h => {
    const s = stocks[h.ticker] as Stock | undefined;
    const isTW = s?.market === 'TW';
    const sharesActual = isTW ? h.lots * 1000 : h.lots;
    const val     = (s?.price ?? 0) * sharesActual;
    const cost    = h.buyPrice * sharesActual;
    const gain    = val - cost;
    const gainPct = cost ? (gain / cost) * 100 : 0;
    const todayPL = (s?.change ?? 0) * sharesActual;
    return { ...h, s, isTW, sharesActual, val, cost, gain, gainPct, todayPL };
  });

  const totalVal     = calced.reduce((a, h) => a + h.val, 0);
  const totalCost    = calced.reduce((a, h) => a + h.cost, 0);
  const totalGain    = totalVal - totalCost;
  const totalGainPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const todayTotal   = calced.reduce((a, h) => a + h.todayPL, 0);

  const fmt      = (n: number, d = 0) => n.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
  const card     = { background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, padding: 16 };
  const stLabel  = { fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: '#4a6890', marginBottom: 12 };
  const inpStyle = { background: '#070b14', border: '1px solid rgba(79,142,247,.2)', borderRadius: 5, padding: '5px 8px', color: '#ccd8f5', fontFamily: "'JetBrains Mono',monospace", fontSize: 12, outline: 'none', width: '100%' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>投資組合</div>
          <div style={{ fontSize: 13, color: '#4a6890' }}>{holdings.length} 檔持股 · 資料存於本機</div>
        </div>
        <button onClick={() => setAddForm(f => ({ ...f, show: !f.show }))}
          style={{ padding: '7px 16px', border: '1px solid rgba(79,142,247,.35)', borderRadius: 7, background: 'rgba(79,142,247,.12)', color: '#4f8ef7', fontSize: 12, cursor: 'pointer', fontFamily: "'Space Grotesk',sans-serif", fontWeight: 600 }}>
          + 新增持股
        </button>
      </div>

      {addForm.show && (
        <div style={{ ...card, marginBottom: 16, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#4a6890', marginBottom: 4 }}>股票代碼</div>
            <input value={addForm.ticker} onChange={e => setAddForm(f => ({ ...f, ticker: e.target.value }))} placeholder="NVDA / 2330" style={inpStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#4a6890', marginBottom: 4 }}>買入價格</div>
            <input type="number" value={addForm.buyPrice} onChange={e => setAddForm(f => ({ ...f, buyPrice: e.target.value }))} placeholder="648.50" style={inpStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#4a6890', marginBottom: 4 }}>台股=張 / 美股=股</div>
            <input type="number" value={addForm.lots} onChange={e => setAddForm(f => ({ ...f, lots: e.target.value }))} placeholder="3" style={inpStyle} />
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 1 }}>
            <button onClick={addHolding} style={{ padding: '6px 14px', background: '#4f8ef7', border: 'none', borderRadius: 5, color: '#fff', fontSize: 12, cursor: 'pointer' }}>確認</button>
            <button onClick={() => setAddForm({ show: false, ticker: '', buyPrice: '', lots: '' })} style={{ padding: '6px 10px', background: 'none', border: '1px solid rgba(79,142,247,.2)', borderRadius: 5, color: '#4a6890', fontSize: 12, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        {[
          { label: '總資產',   value: `$${fmt(totalVal, 2)}`,                                         sub: `${holdings.length} 檔持股` },
          { label: '總損益',   value: `${totalGain >= 0 ? '+' : ''}$${fmt(Math.abs(totalGain), 0)}`,  sub: `${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%`, c: totalGain >= 0 ? '#00d98b' : '#ff4060' },
          { label: '今日損益', value: `${todayTotal >= 0 ? '+' : ''}$${fmt(Math.abs(todayTotal), 2)}`, sub: `${todayTotal >= 0 ? '+' : ''}${(totalVal ? todayTotal / totalVal * 100 : 0).toFixed(2)}%`, c: todayTotal >= 0 ? '#00d98b' : '#ff4060' },
          { label: '報酬率',   value: `${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%`,   sub: '總持倉報酬', c: totalGainPct >= 0 ? '#00d98b' : '#ff4060' },
        ].map(s => (
          <div key={s.label} style={card}>
            <div style={{ fontSize: 11, color: '#4a6890', fontWeight: 500, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 600, color: (s as any).c ?? '#ccd8f5' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: '#4a6890', marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#101e35', border: '1px solid rgba(79,142,247,.15)', borderRadius: 9, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', padding: '11px 16px', borderBottom: '1px solid rgba(79,142,247,.12)', fontSize: 11, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: '#4a6890' }}>
          <span>股票</span><span>股價</span><span>市值</span><span>持股</span><span>損益</span><span>AI 信號</span><span></span>
        </div>
        {calced.map((h, i) => editIdx === i ? (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', padding: '10px 16px', borderBottom: '1px solid rgba(79,142,247,.08)', gap: 8, alignItems: 'center', background: 'rgba(79,142,247,.05)' }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{h.ticker}</span>
            <span></span><span></span>
            <div><input type="number" value={editForm.buyPrice} onChange={e => setEditForm(f => ({ ...f, buyPrice: e.target.value }))} style={{ ...inpStyle, width: 80 }} placeholder="買入價" /></div>
            <div><input type="number" value={editForm.lots}     onChange={e => setEditForm(f => ({ ...f, lots: e.target.value }))}     style={{ ...inpStyle, width: 60 }} placeholder={h.isTW ? '張' : '股'} /></div>
            <span></span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={saveEdit}              style={{ padding: '3px 9px', background: '#4f8ef7', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' }}>✓</button>
              <button onClick={() => setEditIdx(null)} style={{ padding: '3px 9px', background: 'none', border: '1px solid rgba(79,142,247,.2)', borderRadius: 4, color: '#4a6890', fontSize: 11, cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        ) : (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr auto', padding: '13px 16px', borderBottom: '1px solid rgba(79,142,247,.08)', transition: 'background .15s', alignItems: 'center', fontSize: 13 }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.025)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <div onClick={() => onSelectStock(h.ticker)} style={{ cursor: 'pointer' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{h.ticker}</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 2 }}>{h.s?.name ?? '—'}</div>
            </div>
            <div onClick={() => onSelectStock(h.ticker)} style={{ cursor: 'pointer' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace" }}>{h.s?.sym}{h.s?.price?.toLocaleString() ?? '—'}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: (h.s?.pct ?? 0) >= 0 ? '#00d98b' : '#ff4060', marginTop: 1 }}>{(h.s?.pct ?? 0) >= 0 ? '+' : ''}{(h.s?.pct ?? 0).toFixed(2)}%</div>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", cursor: 'pointer' }} onClick={() => onSelectStock(h.ticker)}>
              {h.s?.sym}{fmt(h.val)}
            </div>
            <div onClick={() => onSelectStock(h.ticker)} style={{ cursor: 'pointer' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{h.isTW ? `${h.lots}張` : `${h.lots}股`}</div>
              <div style={{ fontSize: 11, color: '#4a6890' }}>均價 {h.s?.sym}{h.buyPrice.toFixed(2)}</div>
            </div>
            <div onClick={() => onSelectStock(h.ticker)} style={{ cursor: 'pointer' }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", color: h.gainPct >= 0 ? '#00d98b' : '#ff4060' }}>{h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(1)}%</div>
              <div style={{ fontSize: 11, color: '#4a6890', marginTop: 1 }}>{h.gain >= 0 ? '+' : ''}{h.s?.sym ?? '$'}{fmt(Math.abs(h.gain))}</div>
            </div>
            <div onClick={() => onSelectStock(h.ticker)} style={{ cursor: 'pointer' }}>
              {h.s?.verdict && <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: vc(h.s.verdict as Verdict), background: vbg(h.s.verdict as Verdict), border: `1px solid ${vbd(h.s.verdict as Verdict)}`, padding: '2px 8px', borderRadius: 3 }}>{h.s.verdict}</span>}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => { setEditIdx(i); setEditForm({ buyPrice: String(h.buyPrice), lots: String(h.lots) }); }}
                style={{ padding: '3px 8px', background: 'none', border: '1px solid rgba(79,142,247,.2)', borderRadius: 4, color: '#4a6890', fontSize: 11, cursor: 'pointer' }}>編輯</button>
              <button onClick={() => updateHoldings(holdings.filter((_, idx) => idx !== i))}
                style={{ padding: '3px 8px', background: 'none', border: '1px solid rgba(255,64,96,.2)', borderRadius: 4, color: '#ff4060', fontSize: 11, cursor: 'pointer' }}>刪</button>
            </div>
          </div>
        ))}
        {holdings.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: '#4a6890', fontSize: 13 }}>尚無持股，點選「新增持股」開始記錄</div>
        )}
      </div>

      {calced.some(h => h.s?.history) && (
        <div style={card}>
          <div style={stLabel}>3 月績效走勢</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
            {calced.filter(h => h.s?.history).map(h => (
              <div key={h.ticker}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 12 }}>{h.ticker}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: h.gainPct >= 0 ? '#00d98b' : '#ff4060' }}>{h.gainPct >= 0 ? '+' : ''}{h.gainPct.toFixed(1)}%</span>
                </div>
                <div style={{ height: 50 }}>
                  <ChartSVG history={h.s!.history} W={200} H={50} accent={h.gainPct >= 0 ? '#00d98b' : '#ff4060'} gradId={`pf-${h.ticker}`} isUp={h.gainPct >= 0} showControls={false} initMode="line" initPeriod="m3" />
                </div>
                <div style={{ fontSize: 11, color: '#4a6890', marginTop: 5 }}>
                  {h.isTW ? `${h.lots}張` : `${h.lots}股`} · 均價 {h.s?.sym}{h.buyPrice.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── WatchlistView ─────────────────────────────────────────────────────────────

function WatchlistView({ stocks, watchlist, onSelectStock, onAdd, onRemove }: { stocks: typeof STOCKS; watchlist: string[]; onSelectStock: (t: string) => void; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [mktFilter, setMktFilter] = useState<'all' | 'TW' | 'US'>('all');
  const filtered = watchlist.filter(t => {
    const s = stocks[t];
    if (!s) return mktFilter === 'all';
    if (mktFilter === 'TW') return s.market === 'TW';
    if (mktFilter === 'US') return s.market === 'US';
    return true;
  });

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>自選股</div>
      <div style={{ fontSize: 13, color: '#4a6890', marginBottom: 16 }}>{watchlist.length} 檔股票 · AI 監控中</div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#4a6890' }}>信心：{s.conf}%</span>
                  <WlBtn ticker={ticker} watchlist={watchlist} onAdd={onAdd} onRemove={onRemove} />
                </div>
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
  const [searchQ, setSearchQ]       = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selIdx, setSelIdx]         = useState(-1);
  // Live data received from backend WebSocket — overrides static STOCKS mock
  const [liveStocks, setLiveStocks] = useState<Record<string, Stock>>({});
  const [watchlist, setWatchlist]   = useState<string[]>(loadWL);
  const [wlInput, setWlInput]       = useState('');

  const mergedStocks = { ...STOCKS, ...liveStocks };

  function handleLiveData(s: Stock) {
    setLiveStocks(prev => ({ ...prev, [s.ticker]: s }));
  }

  function addToWatchlist(raw: string) {
    const t = raw.toUpperCase().trim();
    if (!t || watchlist.includes(t)) { setWlInput(''); return; }
    const next = [...watchlist, t];
    setWatchlist(next); saveWL(next); setWlInput('');
  }

  function removeFromWatchlist(t: string) {
    const next = watchlist.filter(x => x !== t);
    setWatchlist(next); saveWL(next);
  }

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

  const stock = ticker ? (mergedStocks[ticker] ?? null) : null;

  function goStock(t: string) {
    setTicker(t);
    setView('chat');
    setSearchQ('');
    setSearchOpen(false);
  }

  const searchResults = searchQ.trim().length > 0
    ? Object.values(mergedStocks).filter(s => {
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
        {(() => {
          function hl(text: string, q: string) {
            if (!q) return <span>{text}</span>;
            const i = text.toLowerCase().indexOf(q.toLowerCase());
            if (i === -1) return <span>{text}</span>;
            return <span>{text.slice(0, i)}<mark style={{ background: 'rgba(79,142,247,.35)', color: '#ccd8f5', borderRadius: 2, padding: '0 1px', fontWeight: 700 }}>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</span>;
          }
          function handleKey(e: React.KeyboardEvent) {
            if (e.key === 'ArrowDown')  { e.preventDefault(); setSelIdx(x => Math.min(x + 1, searchResults.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx(x => Math.max(x - 1, -1)); }
            else if (e.key === 'Enter') {
              if (selIdx >= 0 && searchResults[selIdx]) goStock(searchResults[selIdx].ticker);
              else if (searchQ.trim()) goStock(searchQ.trim().toUpperCase());
            } else if (e.key === 'Escape') { setSearchQ(''); setSearchOpen(false); setSelIdx(-1); }
          }
          const showDrop = searchOpen && searchQ.trim().length > 0;
          return (
            <div className="sa-hdr-search" style={{ flex: '0 0 360px', position: 'relative' }}>
              <div style={{ background: '#101e35', border: `1px solid ${searchOpen ? 'rgba(79,142,247,.45)' : 'rgba(79,142,247,.15)'}`, borderRadius: 7, height: 34, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, transition: 'border-color .2s' }}>
                <span style={{ fontSize: 15, color: '#4a6890', flexShrink: 0 }}>⌕</span>
                <input
                  value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSearchOpen(true); setSelIdx(-1); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => { setSearchOpen(false); setSelIdx(-1); }, 160)}
                  onKeyDown={handleKey}
                  placeholder="輸入代碼或名稱，例如 2330・NVDA"
                  style={{ background: 'none', border: 'none', outline: 'none', color: '#ccd8f5', fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, width: '100%' }}
                />
                {searchQ && <span onClick={() => { setSearchQ(''); setSelIdx(-1); }} style={{ color: '#4a6890', cursor: 'pointer', flexShrink: 0, fontSize: 16, lineHeight: '1' }}>×</span>}
              </div>
              {showDrop && searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: 38, left: 0, right: 0, background: '#0c1422', border: '1px solid rgba(79,142,247,.3)', borderRadius: 8, zIndex: 200, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
                  {searchResults.map((s, i) => {
                    const isUp = s.pct >= 0;
                    const active = i === selIdx;
                    return (
                      <div key={s.ticker}
                        onClick={() => goStock(s.ticker)}
                        onMouseEnter={() => setSelIdx(i)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(79,142,247,.08)', background: active ? 'rgba(79,142,247,.12)' : 'none', transition: 'background .1s' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 13 }}>{hl(s.ticker, searchQ)}</span>
                              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: s.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.12)', color: s.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{s.market === 'TW' ? '台股' : '美股'}</span>
                            </div>
                            <div style={{ fontSize: 11, color: '#4a6890', marginTop: 1 }}>{hl(s.name, searchQ)}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>{s.sym}{s.price.toLocaleString()}</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isUp ? '#00d98b' : '#ff4060' }}>{isUp ? '+' : ''}{s.pct.toFixed(2)}%</div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ padding: '6px 14px', fontSize: 10, color: '#2a3a52' }}>↑↓ 導航 · Enter 確認</div>
                </div>
              )}
              {showDrop && searchResults.length === 0 && (
                <div style={{ position: 'absolute', top: 38, left: 0, right: 0, background: '#0c1422', border: '1px solid rgba(79,142,247,.2)', borderRadius: 8, zIndex: 200, padding: '12px 16px', fontSize: 12, color: '#4a6890', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
                  找不到「{searchQ}」· 按 Enter 直接查詢
                </div>
              )}
            </div>
          );
        })()}

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

          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: '#1e3050', padding: '14px 16px 6px' }}>Watchlist</div>

          {/* Add stock */}
          <div style={{ display: 'flex', gap: 5, padding: '0 10px 8px' }}>
            <input
              value={wlInput}
              onChange={e => setWlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addToWatchlist(wlInput)}
              placeholder="代碼..."
              style={{ flex: 1, background: '#0c1422', border: '1px solid rgba(79,142,247,.2)', borderRadius: 5, padding: '4px 7px', color: '#ccd8f5', fontSize: 11, outline: 'none', fontFamily: "'JetBrains Mono',monospace", minWidth: 0 }}
              onFocus={e => (e.target.style.borderColor = 'rgba(79,142,247,.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(79,142,247,.2)')}
            />
            <button onClick={() => addToWatchlist(wlInput)}
              style={{ padding: '4px 9px', background: 'rgba(79,142,247,.15)', border: '1px solid rgba(79,142,247,.3)', borderRadius: 5, color: '#4f8ef7', fontSize: 14, cursor: 'pointer', flexShrink: 0, fontWeight: 700, lineHeight: 1 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(79,142,247,.28)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(79,142,247,.15)')}
            >+</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(79,142,247,.2) transparent' }}>
            {watchlist.map(t => {
              const s = mergedStocks[t];
              const isUp   = (s?.pct ?? 0) >= 0;
              const active = ticker === t;
              return (
                <div key={t}
                  style={{ display: 'flex', alignItems: 'center', padding: '6px 6px 6px 16px', background: active ? 'rgba(79,142,247,.07)' : 'none', borderLeft: `2px solid ${active ? '#4f8ef7' : 'transparent'}`, transition: 'background .15s' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.025)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none'; }}
                >
                  <div onClick={() => goStock(t)} style={{ flex: 1, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 12 }}>{t}</div>
                        {s && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: s.market === 'TW' ? 'rgba(255,214,102,.15)' : 'rgba(79,142,247,.1)', color: s.market === 'TW' ? '#ffd666' : '#4f8ef7', fontWeight: 600 }}>{s.market === 'TW' ? '台' : 'US'}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: '#4a6890', marginTop: 1 }}>{s?.name ?? '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right', marginRight: 4, flexShrink: 0 }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{s ? `${s.sym}${s.price.toLocaleString()}` : '—'}</div>
                      {s && <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: isUp ? '#00d98b' : '#ff4060' }}>{isUp ? '+' : ''}{s.pct.toFixed(2)}%</div>}
                    </div>
                  </div>
                  <button onClick={() => removeFromWatchlist(t)}
                    style={{ background: 'none', border: 'none', color: '#2a3a52', cursor: 'pointer', fontSize: 15, padding: '0 4px', flexShrink: 0, lineHeight: 1, transition: 'color .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ff4060')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#2a3a52')}
                  >×</button>
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
                <ChatPanel stocks={mergedStocks} watchlist={watchlist} onStockSelect={goStock} onLiveData={handleLiveData} onAddWl={addToWatchlist} onRemoveWl={removeFromWatchlist} />
              </div>
              <div className="sa-analysis" style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                <AnalysisPanel stock={stock} watchlist={watchlist} onAdd={addToWatchlist} onRemove={removeFromWatchlist} />
              </div>
            </>
          )}
          {view === 'portfolio' && <PortfolioView stocks={mergedStocks} onSelectStock={goStock} />}
          {view === 'watchlist' && <WatchlistView stocks={mergedStocks} watchlist={watchlist} onSelectStock={goStock} onAdd={addToWatchlist} onRemove={removeFromWatchlist} />}
          {view === 'news'      && <NewsView stock={stock} />}
          {view === 'settings'  && <SettingsView />}
        </main>
      </div>

      {/* Disclaimer */}
      <div style={{ padding: '8px 20px', borderTop: '1px solid rgba(79,142,247,.25)', background: '#0d1528', fontSize: 11, color: '#7a9cc0', lineHeight: 1.6, flexShrink: 0 }}>
        <span style={{ color: '#a0b8d8', fontWeight: 700 }}>⚠ 免責聲明：</span>
        本平台提供之股票資訊、AI 分析報告及目標價均<span style={{ fontWeight: 600, color: '#a0b8d8' }}>僅供參考，不構成任何投資建議或要約</span>。AI 分析結果基於公開資料自動生成，不保證準確性與完整性。投資人應自行評估風險，並在必要時諮詢專業投資顧問。<span style={{ fontWeight: 600, color: '#a0b8d8' }}>投資有風險，進場需謹慎，過去表現不代表未來結果。</span>
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
