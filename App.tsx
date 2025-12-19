import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ShrinkRecord, ViewType, DeepDiveStatus } from './types';
import { Icons } from './constants';
import { AnalysisCharts } from './components/AnalysisCharts';
import { queryMarketAIQuick, queryMarketAIDeep } from './services/geminiService';
import * as XLSX from 'xlsx';

declare global {
  interface Window {
    process: {
      env: {
        API_KEY?: string;
      }
    }
  }
}

type SegmentFilter = 'ALL' | 'SODA_SNACK' | 'COLD';

interface Notification {
  type: 'success' | 'error';
  message: string;
}

interface CalcExplanation {
  title: string;
  formula: string;
  description: string;
}

interface ItemDrilldown {
  name: string;
  type: 'shrink' | 'overage';
  total: number;
  breakdown: { market: string; qty: number; value: number }[];
}

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// 50 Powerful Forensic Prompts
const MASTER_PROMPTS = [
  "Find naming confusion errors (e.g. Cheeseburger vs Classic Cheeseburger).",
  "Are Cold Food (KF/F/B) overages due to missing tablet 'Adds'?",
  "Analyze items with inverted variances in the same market.",
  "Contrast Scanned Food (KF) accuracy vs Manual Snack counting.",
  "Which market has the highest risk of tablet receiving errors?",
  "Identify the top 3 items with high shrink but zero overage.",
  "Which market consistently has the highest Cold Food overages?",
  "Analyze the top 5 highest value shrink items across all markets.",
  "List items where the Variance is positive. Is this a receiving error?",
  "Show me the 'Integrity Score' trend for the worst performing market.",
  "Which items account for 80% of the total shrink value?",
  "Compare shrinkage in 'Snacks' vs 'Beverages' categories.",
  "Is there a correlation between high revenue and high shrink %?",
  "Calculate the potential annual loss if current shrink trends continue.",
  "Find items with a Unit Cost > $5 and negative variance.",
  "Which market has the best inventory accuracy?",
  "Are we losing more money on high-volume or high-cost items?",
  "Show me items with >$50 net loss in the last period.",
  "Check for 'Ghost Inventory' (Sold Qty > 0, but Variance is negative).",
  "Analyze the impact of 'Substitution' errors in the Deli.",
  "What is the total 'Lost Retail Value' vs 'Lost Cost'?",
  "Identify items that have never shown an overage (Pure Loss).",
  "Which item has the highest frequency of errors across all markets?",
  "Is the 'Dairy' category performing worse than 'Produce'?",
  "Find the market with the highest 'Unexplained Variance'.",
  "Show me the ratio of Overage to Shrink for 'Chips'.",
  "Did 'Water' sales cover the loss in 'Soda'?",
  "Identify items with > 20% shrinkage rate relative to revenue.",
  "Compare 'Energy Drink' performance across all sites.",
  "Is there a pattern of recurring shortages for specific items?",
  "Calculate the 'Net Variance' for all 'Sandwiches'.",
  "Which items should we consider removing due to high shrink?",
  "Analyze 'Turkey Sandwich' vs 'Turkey Club' for cross-ringing.",
  "Show me the variance distribution for 'Healthy' items.",
  "Are 'New Items' shrinking faster than established ones?",
  "Find items with positive variance in Market A but negative in Market B.",
  "What is the financial impact of 'Unit of Measure' errors?",
  "Identify items with small but frequent losses (Death by a thousand cuts).",
  "Is 'Employee Theft' suspected in high-value chargers/electronics?",
  "Compare the 'Unit Cost' of the top 10 shrink items.",
  "Show me the trend of 'Unknown' or 'Misc' items.",
  "Generate a 'Top 10 Watchlist' for the next audit.",
  "Did the price point affect shrink rates for 'Candy'?",
  "Find the item with the most volatile variance month-over-month.",
  "Show me the total profit lost to 'Chocolate Milk' shrink.",
  "Is 'Ice Cream' shrinking due to theft or spoilage?",
  "Which items have a variance of exactly -1 consistently?",
  "Rank markets by their 'Net Variance' performance.",
  "Identify potential theft rings in high-value proteins.",
  "What is the recovery rate (Overage) for previous Shrink items?"
];

const STORAGE_KEYS = {
  RECORDS: 'shrink_records_v6',
  MONTHS: 'shrink_months_v6',
  MARKET: 'shrink_market_v6',
  SEGMENT: 'shrink_segment_v6'
};

const humanizeMarketName = (name: string): string => {
  if (!name) return '';
  let cleaned = name.replace(/^(Market|Location|Name|Site|Loc|Mkt|Point of Sale|POS|Site Name):\s*/i, '');
  const segments = cleaned.split(/\s*[-|:/]\s+/);
  const meaningfulSegments = segments.filter(seg => {
    const s = seg.trim();
    if (!s) return false;
    if (segments.length === 1) return true;
    if (/^\d+$/.test(s)) return false;
    if (/^[A-Z0-9]{2,4}$/.test(s)) return false;
    return true;
  });
  if (meaningfulSegments.length > 0) return meaningfulSegments.join(' - ').trim();
  return cleaned.trim() || name;
};

const normalizePeriod = (str: string): string => {
  if (!str) return 'Unknown';
  const normalized = str.trim().toLowerCase();
  for (const m of MONTH_ORDER) if (normalized.includes(m.toLowerCase())) return m;
  return str;
};

const App: React.FC = () => {
  const [view, setView] = useState<ViewType>('report-upload');
  const [isKeyActive, setIsKeyActive] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{browserKey: string, workerData: any} | null>(null);
  const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
  
  // Explanation Modal State
  const [explanation, setExplanation] = useState<CalcExplanation | null>(null);
  
  // Item Drilldown State
  const [drilldown, setDrilldown] = useState<ItemDrilldown | null>(null);

  // Notification State
  const [notification, setNotification] = useState<Notification | null>(null);

  // Rotating Prompts State
  const [rotatedPrompts, setRotatedPrompts] = useState<string[]>([]);

  // Shuffle Prompts Function
  const shufflePrompts = useCallback(() => {
    const shuffled = [...MASTER_PROMPTS].sort(() => 0.5 - Math.random());
    setRotatedPrompts(shuffled.slice(0, 5));
  }, []);

  // Initial Shuffle on Mount
  useEffect(() => {
    shufflePrompts();
  }, [shufflePrompts]);
  
  // 1. BOOTLOADER: Fetch key from Worker on mount (Robust Version)
  useEffect(() => {
    const initConfig = async () => {
      const paths = ['/api/config', 'api/config'];
      try {
        const currentBase = window.location.href;
        // Use try-catch for URL construction to prevent "Invalid URL" crash
        const absoluteUrl = new URL('api/config', currentBase).href;
        paths.unshift(absoluteUrl);
      } catch (e) {
        // Ignore URL construction errors
      }
      
      let lastError = null;

      for (const path of paths) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;

          const rawText = await res.text();
          const trimmed = rawText.trim();

          if (trimmed.startsWith('{')) {
            const data = JSON.parse(trimmed);
            if (data.API_KEY) {
              window.process.env.API_KEY = data.API_KEY;
              setIsKeyActive(true);
              return; 
            }
          }
        } catch (e: any) {
          lastError = e;
        }
      }
      
      if (lastError) {
        console.warn("Forensic config not found in standard paths.");
      }
    };

    initConfig().finally(() => {
      setIsInitializing(false);
    });
  }, []);

  const openIntegrityCheck = async () => {
    setConnectionTestResult(null); // Reset test result on open
    const paths = ['/api/debug-env', 'api/debug-env'];
    try {
      const currentBase = window.location.href;
      const absoluteUrl = new URL('api/debug-env', currentBase).href;
      paths.unshift(absoluteUrl);
    } catch (e) {}

    for (const path of paths) {
      try {
        const res = await fetch(path);
        if (res.ok) {
          const workerData = await res.json();
          const browserKey = (window.process?.env?.API_KEY as string) || "undefined";
          
          // Self-heal: If we have a key in memory, ensure UI state reflects "Engine Active"
          if (browserKey && browserKey !== "undefined" && browserKey.length > 10) {
            setIsKeyActive(true);
          }

          setSystemInfo({ browserKey, workerData });
          setShowSystemDetails(true);
          return;
        }
      } catch (e) {}
    }
    setSystemInfo({ 
      browserKey: (window.process?.env?.API_KEY as string) || "undefined", 
      workerData: { error: "Failed to reach Worker diagnostic endpoint." } 
    });
    setShowSystemDetails(true);
  };

  const runConnectionTest = async () => {
    setConnectionTestResult("Pinging Endpoint...");
    try {
      const start = Date.now();
      const res = await fetch('/api/config');
      const ms = Date.now() - start;
      if (res.ok) {
        setConnectionTestResult(`SUCCESS: ${res.status} ${res.statusText} (${ms}ms)`);
      } else {
        setConnectionTestResult(`FAILED: ${res.status} ${res.statusText}`);
      }
    } catch (e: any) {
      setConnectionTestResult(`NETWORK ERROR: ${e.message}`);
    }
  };

  const [records, setRecords] = useState<ShrinkRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.RECORDS);
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.MONTHS);
      const parsed = saved ? JSON.parse(saved) : [];
      return new Set(parsed);
    } catch (e) { return new Set(); }
  });

  const [selectedMarketFilter, setSelectedMarketFilter] = useState(() => localStorage.getItem(STORAGE_KEYS.MARKET) || 'All');
  const [activeSegment, setActiveSegment] = useState<SegmentFilter>(() => (localStorage.getItem(STORAGE_KEYS.SEGMENT) as SegmentFilter) || 'ALL');

  const uniqueMarkets = useMemo(() => {
    const m = new Set<string>();
    records.forEach(r => { if(r.marketName) m.add(r.marketName); });
    const sorted = Array.from(m).sort();
    return ['All', ...sorted];
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const normPeriod = normalizePeriod(r.period);
      if (selectedMonths.size > 0 && !selectedMonths.has(normPeriod)) return false;
      if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return false;
      
      const isCold = /^(KF|F\s|B\s)/i.test(r.itemNumber) || /^(KF|F\s|B\s)/i.test(r.itemName);
      if (activeSegment === 'COLD') return isCold;
      if (activeSegment === 'SODA_SNACK') return !isCold;

      return true;
    });
  }, [records, selectedMonths, selectedMarketFilter, activeSegment]);

  const [quickAiText, setQuickAiText] = useState<string>('');
  const [aiUserPrompt, setAiUserPrompt] = useState<string>('');
  const [isQuickAnalyzing, setIsQuickAnalyzing] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [deepDiveStatus, setDeepDiveStatus] = useState<DeepDiveStatus>('idle');
  const [deepDiveResult, setDeepDiveResult] = useState<string>('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [activeUploadMonth, setActiveUploadMonth] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persistence
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
      localStorage.setItem(STORAGE_KEYS.MONTHS, JSON.stringify(Array.from(selectedMonths)));
      localStorage.setItem(STORAGE_KEYS.MARKET, selectedMarketFilter);
      localStorage.setItem(STORAGE_KEYS.SEGMENT, activeSegment);
    } catch (e) { console.warn("Storage quota limit reached."); }
  }, [records, selectedMonths, selectedMarketFilter, activeSegment]);

  const purgeLedger = () => {
    if (window.confirm("Purge historical forensic data?")) {
      setRecords([]);
      setSelectedMonths(new Set());
      localStorage.clear();
      setView('report-upload');
    }
  };

  const populatedMonths = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (MONTH_ORDER.includes(norm)) set.add(norm);
    });
    return set;
  }, [records]);

  const timelineStats = useMemo(() => {
    const ts: Record<string, { shrink: number; overage: number; revenue: number }> = {};
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (!ts[norm]) ts[norm] = { shrink: 0, overage: 0, revenue: 0 };
      
      const shrink = r.shrinkLoss || 0;
      const overage = r.overageGain || 0;
      
      ts[norm].shrink += shrink;
      ts[norm].overage += overage;
      ts[norm].revenue += r.totalRevenue || 0;
    });
    return ts;
  }, [records]);

  const stats = useMemo(() => {
    const filtered = filteredRecords;
    if (filtered.length === 0) return { 
      totalShrink: 0, totalRevenue: 0, totalOverage: 0, netVariance: 0, accuracy: 100, count: 0,
      shrinkPct: 0, overagePct: 0, netPct: 0 
    };
    
    let totalShrink = 0, totalRevenue = 0, totalOverage = 0;
    filtered.forEach(rec => {
      totalRevenue += rec.totalRevenue || 0;
      totalShrink += rec.shrinkLoss || 0;
      totalOverage += rec.overageGain || 0;
    });
    
    const netVariance = totalOverage - totalShrink;
    const grossAbsoluteError = totalShrink + totalOverage; // Penalize both confusion and loss

    const accuracy = totalRevenue > 0 ? (1 - (grossAbsoluteError / totalRevenue)) * 100 : 100;
    
    return {
      totalShrink, 
      totalRevenue, 
      totalOverage, 
      netVariance,
      shrinkPct: totalRevenue > 0 ? (totalShrink / totalRevenue) * 100 : 0,
      overagePct: totalRevenue > 0 ? (totalOverage / totalRevenue) * 100 : 0,
      netPct: totalRevenue > 0 ? (Math.abs(netVariance) / totalRevenue) * 100 : 0,
      accuracy: Number(Math.max(0, accuracy).toFixed(2)),
      count: filtered.length
    };
  }, [filteredRecords]);

  // Handle Item Drilldown
  const handleItemDrilldown = useCallback((name: string, type: 'shrink' | 'overage') => {
    // 1. Find all instances of this item in the currently filtered view
    const relevantRecords = filteredRecords.filter(r => r.itemName === name);
    
    const marketMap = new Map<string, { qty: number; value: number }>();
    
    relevantRecords.forEach(r => {
      // Determine if this specific record contributes to the type we are investigating
      // Shrink comes from negative variance (stored as positive shrinkLoss)
      // Overage comes from positive variance (stored as positive overageGain)
      const val = type === 'shrink' ? r.shrinkLoss : r.overageGain;
      const rawVariance = r.invVariance;

      if (val && val > 0) {
        const existing = marketMap.get(r.marketName) || { qty: 0, value: 0 };
        marketMap.set(r.marketName, {
          qty: existing.qty + rawVariance, // For shrink this will be negative, for overage positive
          value: existing.value + val // This is the absolute dollar value impact
        });
      }
    });

    const breakdown = Array.from(marketMap.entries()).map(([market, data]) => ({
      market,
      qty: data.qty,
      value: data.value
    })).sort((a, b) => b.value - a.value);

    const total = breakdown.reduce((acc, curr) => acc + curr.value, 0);

    setDrilldown({
      name,
      type,
      total,
      breakdown
    });
  }, [filteredRecords]);

  // AI Logic
  const handleRunQuickAI = async (customPrompt?: string) => {
    const question = customPrompt || aiUserPrompt;
    if (!question.trim() || records.length === 0 || isQuickAnalyzing) return;
    setIsQuickAnalyzing(true);
    setActiveChip(customPrompt || 'custom');
    setQuickAiText('');
    setAiUserPrompt('');
    setView('ai-insights');
    try {
      await queryMarketAIQuick(filteredRecords, stats, question, (text) => {
        if (text === "AUTH_REQUIRED") {
          setIsKeyActive(false);
          setQuickAiText("DIAGNOSTIC ENGINE OFFLINE. Check System Integrity.");
        } else {
          setQuickAiText(text);
        }
      });
    } finally {
      setIsQuickAnalyzing(false);
      setActiveChip(null);
    }
  };

  const startDeepDive = async () => {
    if (deepDiveStatus === 'ready') {
      setQuickAiText(deepDiveResult);
      setDeepDiveStatus('idle');
      setView('ai-insights');
      return;
    }
    if (deepDiveStatus === 'analyzing' || filteredRecords.length === 0) return;
    setDeepDiveStatus('analyzing');
    queryMarketAIDeep(filteredRecords, stats).then(result => {
      if (result === "AUTH_REQUIRED") {
        setIsKeyActive(false);
        setDeepDiveStatus('idle');
        return;
      }
      setDeepDiveResult(result);
      setDeepDiveStatus('ready');
    }).catch(() => setDeepDiveStatus('idle'));
  };

  // Upload Logic
  const handleFileUpload = (file: File, targetedMonth?: string) => {
    setIsProcessing(true);
    setProcessingStatus('Forensic Sync Initiated...');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        let allExtractedRecords: any[] = [];
        let humanMarketNames: string[] = [];
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          if (!jsonData || jsonData.length < 5) return;
          
          // Metadata extraction attempts (Location/Market Name)
          const locationVal = (jsonData[2] as any[])?.[0] || '';
          const marketVal = (jsonData[3] as any[])?.[0] || '';
          const cleanName = humanizeMarketName(String(marketVal || locationVal || sheetName));
          if (!humanMarketNames.includes(cleanName)) humanMarketNames.push(cleanName);
          
          // --- HEADER DETECTION LOGIC ---
          let colMap = { itemNum: 0, itemName: 1, variance: 2, revenue: 3, soldQty: 4, salePrice: 5, itemCost: 7 };
          let headerRowIndex = -1;
          
          for (let i = 0; i < Math.min(jsonData.length, 50); i++) {
            const row = jsonData[i] as any[];
            if (!row) continue;
            const rowStr = row.join('|').toLowerCase();

            // Strict Header Detection: Must contain identifying column name AND a value column name
            const hasItemKey = rowStr.includes('item') || rowStr.includes('description') || rowStr.includes('number') || rowStr.includes('code');
            const hasValueKey = rowStr.includes('variance') || rowStr.includes('revenue') || rowStr.includes('qty') || rowStr.includes('diff');
            
            if (hasItemKey && hasValueKey) {
              headerRowIndex = i;
              row.forEach((cell, idx) => {
                const s = String(cell || '').toLowerCase().trim();
                if (s.includes('number') || s.includes('code')) colMap.itemNum = idx;
                else if (s === 'item' || s === 'description') colMap.itemName = idx;
                else if (s.includes('variance') || s.includes('diff')) {
                   if (s.includes('qty') || s.includes('count')) colMap.variance = idx;
                   else if (!s.includes('cost') && !s.includes('$')) colMap.variance = idx;
                }
                else if (s.includes('revenue')) colMap.revenue = idx;
                else if (s.includes('cost')) colMap.itemCost = idx;
                else if (['sold', 'qty', 'quantity', 'sales'].some(k => s.includes(k))) colMap.soldQty = idx;
                else if (['price', 'retail', 'srp', 'sale'].some(k => s.includes(k))) colMap.salePrice = idx;
              });
              break;
            }
          }
          if (headerRowIndex === -1) return;
          
          jsonData.slice(headerRowIndex + 1).forEach((row: any) => {
            if (!row[colMap.itemNum] && !row[colMap.itemName]) return;
            if (String(row[colMap.itemName]).toLowerCase().includes('total')) return;

            const invVar = parseFloat(row[colMap.variance]) || 0;
            const cost = parseFloat(row[colMap.itemCost]) || 0;
            const price = parseFloat(row[colMap.salePrice]) || 0;
            const qty = parseFloat(row[colMap.soldQty]) || 0;
            
            let totalRevenue = parseFloat(row[colMap.revenue]) || 0;
            if (totalRevenue === 0 && price > 0 && qty > 0) {
              totalRevenue = price * qty;
            }

            const profit = price > 0 ? (price - cost) * qty : 0;
            
            const shrinkLoss = invVar < 0 ? Math.abs(invVar * cost) : 0;
            const overageGain = invVar > 0 ? (invVar * cost) : 0;
            const netVarianceValue = overageGain - shrinkLoss;

            allExtractedRecords.push({
              itemNumber: String(row[colMap.itemNum] || ''),
              itemName: String(row[colMap.itemName] || ''),
              invVariance: invVar,
              totalRevenue: totalRevenue,
              shrinkLoss: shrinkLoss,
              overageGain: overageGain,
              netVarianceValue: netVarianceValue,
              unitCost: cost,
              soldQty: qty,
              salePrice: price,
              itemProfit: profit,
              marketName: cleanName,
              period: targetedMonth || 'Current'
            });
          });
        });
        
        if (allExtractedRecords.length === 0) {
          setNotification({ type: 'error', message: 'No valid forensic data detected in file.' });
          return;
        }

        const period = targetedMonth || 'Current';
        const newRecords = allExtractedRecords.map((r, i) => ({ ...r, id: `imp-${i}-${Date.now()}` } as ShrinkRecord));
        
        setRecords(prev => [...prev.filter(r => normalizePeriod(r.period) !== normalizePeriod(period)), ...newRecords]);
        setSelectedMonths(prev => new Set(prev).add(normalizePeriod(period)));
        
        if (view === 'report-upload') {
            setView('dashboard');
        }

        setNotification({ 
            type: 'success', 
            message: `Successfully synced ${allExtractedRecords.length} records across ${humanMarketNames.length} markets.` 
        });

      } catch (error) {
        setNotification({ type: 'error', message: 'Forensic extraction failed. File might be corrupted.' });
      } finally { 
        setIsProcessing(false); 
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Initialization Spinner */}
      {isInitializing && (
        <div className="fixed inset-0 z-[500] bg-slate-900 flex flex-col items-center justify-center text-white p-12">
           <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-8" />
           <p className="font-black uppercase tracking-widest text-[10px] text-slate-400">Syncing Forensic Hub...</p>
        </div>
      )}

      {/* Processing Spinner */}
      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-300">
           <div className="bg-white p-12 rounded-[4rem] shadow-2xl flex flex-col items-center gap-8 border border-slate-200">
              <div className="w-24 h-24 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">{processingStatus}</p>
           </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div 
            onClick={() => setNotification(null)}
            className={`fixed top-8 left-1/2 -translate-x-1/2 z-[600] cursor-pointer animate-in fade-in slide-in-from-top-4 duration-300 px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 ${notification.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}
        >
            <div className="font-bold text-sm">{notification.message}</div>
            <div className="text-white/60 text-xs uppercase tracking-widest font-black">Dismiss</div>
        </div>
      )}

      {/* Explanation Modal */}
      {explanation && (
        <div className="fixed inset-0 z-[400] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setExplanation(null)}>
          <div className="bg-white max-w-lg w-full rounded-[2.5rem] p-10 shadow-2xl border border-slate-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-2xl font-black text-slate-900 mb-2">{explanation.title}</h3>
            <p className="font-mono text-indigo-600 bg-indigo-50 p-3 rounded-xl text-xs mb-6 border border-indigo-100">{explanation.formula}</p>
            <p className="text-slate-600 font-medium leading-relaxed">{explanation.description}</p>
            <button onClick={() => setExplanation(null)} className="mt-8 w-full bg-slate-900 text-white py-4 rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-slate-800 transition-all">Close</button>
          </div>
        </div>
      )}

      {/* Item Drilldown Modal */}
      {drilldown && (
        <div className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setDrilldown(null)}>
          <div className="bg-white w-full max-w-2xl rounded-[3rem] p-12 shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-8">
              <div>
                <div className={`text-xs font-black uppercase tracking-widest mb-2 ${drilldown.type === 'shrink' ? 'text-red-500' : 'text-emerald-500'}`}>
                  {drilldown.type === 'shrink' ? 'Shrink Diagnostic' : 'Overage Diagnostic'}
                </div>
                <h3 className="text-3xl font-black text-slate-900 tracking-tight leading-none">{drilldown.name}</h3>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-slate-400 hover:text-slate-600 text-2xl">✕</button>
            </div>
            
            <div className="bg-slate-50 rounded-2xl p-6 mb-8 border border-slate-100">
               <div className="flex justify-between items-center mb-2">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calculated Total</span>
                 <span className={`text-2xl font-black ${drilldown.type === 'shrink' ? 'text-red-500' : 'text-emerald-500'}`}>
                   {drilldown.type === 'shrink' ? '-' : '+'}${drilldown.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                 </span>
               </div>
               <div className="text-[10px] text-slate-400 font-mono">
                 Formula: <span className="text-slate-600">Sum({drilldown.type === 'shrink' ? 'Abs(Negative Variance)' : 'Positive Variance'} × Unit Cost)</span>
               </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar -mx-4 px-4">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Market Source</th>
                    <th className="py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Var Qty</th>
                    <th className="py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Value Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.breakdown.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="py-4 text-xs font-bold text-slate-700">{row.market}</td>
                      <td className={`py-4 text-xs font-mono font-bold text-right ${row.qty < 0 ? 'text-red-500' : 'text-emerald-500'}`}>{row.qty}</td>
                      <td className="py-4 text-xs font-mono font-bold text-right text-slate-900">${row.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {drilldown.breakdown.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-400 text-xs italic">No variance records found for this view filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100 flex justify-end">
               <button onClick={() => setDrilldown(null)} className="bg-slate-900 text-white px-8 py-4 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl">Close Diagnostic</button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showSystemDetails && systemInfo && (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-300">
           <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-[3rem] p-12 text-slate-300 shadow-2xl overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-8">
                 <h2 className="text-2xl font-black text-white tracking-tighter uppercase">Integrity Report</h2>
                 <button onClick={() => setShowSystemDetails(false)} className="text-slate-500 hover:text-white text-2xl">✕</button>
              </div>
              <div className="space-y-8 flex-1 overflow-y-auto custom-scrollbar pr-4">
                 <div className="bg-black/40 p-8 rounded-3xl border border-slate-800">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest">Memory State</h3>
                      <button 
                        onClick={runConnectionTest} 
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all"
                      >
                        Test Connection
                      </button>
                    </div>
                    {connectionTestResult && (
                      <div className={`mb-4 p-3 rounded-xl text-xs font-mono font-bold ${connectionTestResult.includes("SUCCESS") ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                        {connectionTestResult}
                      </div>
                    )}
                    <div className="font-mono text-xs break-all space-y-2">
                       <p><span className="text-slate-500">process.env.API_KEY:</span> <span className={systemInfo.browserKey.length > 20 ? 'text-emerald-400' : 'text-red-400'}>{systemInfo.browserKey.length > 10 ? `${systemInfo.browserKey.substring(0, 6)}...${systemInfo.browserKey.substring(systemInfo.browserKey.length - 4)}` : "NOT_IN_MEMORY"}</span></p>
                    </div>
                 </div>
                 <div className="bg-black/40 p-8 rounded-3xl border border-slate-800">
                    <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest mb-4">Worker State</h3>
                    <div className="font-mono text-xs break-all">
                       <pre>{JSON.stringify(systemInfo.workerData, null, 2)}</pre>
                    </div>
                 </div>
              </div>
              <div className="mt-8 pt-8 border-t border-slate-800 flex justify-end">
                 <button onClick={() => window.location.reload()} className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-indigo-700 transition-all">Re-Sync Engine</button>
              </div>
           </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl">
        <div className="p-8">
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white font-black shadow-lg">S</div>
            Shrink Shrink
          </h1>
          <div className="mt-8 space-y-2">
            {!isKeyActive ? (
              <button onClick={openIntegrityCheck} className="w-full px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-[9px] font-black uppercase tracking-widest text-left">
                <div className="flex items-center gap-2 mb-1"><Icons.Alert /> ENGINE OFFLINE</div>
                <div className="text-[7px] leading-tight opacity-70">Diagnostic Report</div>
              </button>
            ) : (
              <button onClick={openIntegrityCheck} className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[9px] font-black uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Engine Active
              </button>
            )}
            <button onClick={purgeLedger} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-red-900/40 border border-slate-700 rounded-xl text-slate-400 hover:text-red-200 text-[9px] font-black uppercase tracking-widest transition-all">Flush Ledger</button>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1.5">
          <button onClick={() => setView('report-upload')} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'report-upload' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50'}`}><Icons.Upload /> Drop Data</button>
          <button onClick={() => setView('dashboard')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'dashboard' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50 disabled:opacity-20'}`}><Icons.Dashboard /> Performance</button>
          <button onClick={() => setView('ai-insights')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'ai-insights' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50 disabled:opacity-20'}`}><Icons.AI /> AI Diagnosis</button>
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#F8FAFC] custom-scrollbar">
        {/* Remove Audit Modal - Replaced by Notification */}
        
        <div className="p-12 max-w-7xl mx-auto">
          {/* Month Grid Selector */}
          <div className="mb-14 flex gap-5 overflow-x-auto pb-8 custom-scrollbar scroll-smooth">
            {MONTH_ORDER.map(m => {
              const isPopulated = populatedMonths.has(m);
              const isSelected = selectedMonths.has(m);
              const mStats = timelineStats[m];
              const sPct = mStats && mStats.revenue ? (mStats.shrink / mStats.revenue) * 100 : 0;
              const oPct = mStats && mStats.revenue ? (mStats.overage / mStats.revenue) * 100 : 0;
              const nPct = mStats && mStats.revenue ? ((mStats.overage - mStats.shrink) / mStats.revenue) * 100 : 0;
              
              return (
                <div key={m} onClick={() => isPopulated ? setSelectedMonths(prev => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n; }) : (setActiveUploadMonth(m), fileInputRef.current?.click())} 
                     className={`flex-shrink-0 w-44 h-60 rounded-[3rem] border-2 flex flex-col items-center justify-between p-6 cursor-pointer transition-all duration-300 group ${isSelected ? 'bg-white border-indigo-500 shadow-2xl scale-105 z-10' : isPopulated ? 'bg-white border-slate-100 hover:border-indigo-200 shadow-xl' : 'bg-slate-100 border-dashed border-slate-300 opacity-60 hover:opacity-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{m}</span>
                  {isPopulated ? (
                    <div className="w-full space-y-2 pt-2 border-t border-slate-50 flex flex-col gap-1">
                        <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase">Shrink</span>
                          <span className="text-red-500">{sPct.toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase">Overage</span>
                          <span className="text-emerald-500">{oPct.toFixed(2)}%</span>
                        </div>
                         <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase">Net</span>
                          <span className="text-indigo-500">{nPct.toFixed(2)}%</span>
                        </div>
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center"><Icons.Upload /></div>
                  )}
                </div>
              );
            })}
          </div>
          <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], activeUploadMonth || undefined)} />

          {/* Fallback for no data */}
          {records.length === 0 && view !== 'report-upload' && (
             <div className="text-center py-20 opacity-50 font-black text-slate-300 uppercase tracking-widest">Select a month above to load forensic data</div>
          )}

          {/* SHARED FILTERS (Dashboard & AI) */}
          {records.length > 0 && (view === 'dashboard' || view === 'ai-insights') && (
              <div className="flex flex-wrap items-center justify-between gap-6 mb-8 animate-in fade-in slide-in-from-bottom-5 duration-700 px-1">
                 <div className="bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm flex items-center">
                    {(['ALL', 'SODA_SNACK', 'COLD'] as SegmentFilter[]).map(seg => (
                       <button 
                         key={seg}
                         onClick={() => setActiveSegment(seg)}
                         className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeSegment === seg ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                       >
                         {seg === 'ALL' ? 'All Inventory' : seg === 'SODA_SNACK' ? 'Snacks & Drinks' : 'Cold Food'}
                       </button>
                    ))}
                 </div>
                 
                 <div className="relative group">
                    <select 
                      value={selectedMarketFilter} 
                      onChange={(e) => setSelectedMarketFilter(e.target.value)}
                      className="appearance-none bg-white border border-slate-200 text-slate-700 text-xs font-bold py-4 pl-6 pr-12 rounded-2xl shadow-sm outline-none focus:border-indigo-500 hover:border-indigo-300 transition-all cursor-pointer uppercase tracking-wider"
                    >
                       {uniqueMarkets.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><Icons.Markets /></div>
                 </div>
              </div>
          )}

          {/* DASHBOARD VIEW */}
          {view === 'dashboard' && records.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
                 <div 
                    onClick={() => setExplanation({title: 'Gross Shrink', formula: 'SUM(|Negative Variance * Cost|)', description: 'Total financial value of items missing from inventory. This metric represents pure loss before any overages are netted out.'})}
                    className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 relative overflow-hidden group cursor-help hover:border-red-200 transition-colors"
                 >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-red-50 rounded-full -mr-10 -mt-10 z-0 group-hover:scale-150 transition-all duration-700" />
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Gross Shrink</p>
                        <p className="text-4xl lg:text-5xl font-black text-red-500 tracking-tighter">-${stats.totalShrink.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        <p className="text-xs font-bold text-red-400 mt-2 bg-red-50 inline-block px-2 py-1 rounded-lg border border-red-100">{stats.shrinkPct.toFixed(2)}% of Rev</p>
                    </div>
                 </div>
                 
                 <div 
                    onClick={() => setExplanation({title: 'Gross Overage', formula: 'SUM(Positive Variance * Cost)', description: 'Total financial value of unexpected surplus inventory. High overage typically indicates receiving errors (drivers forgetting to add items to the invoice) or previous counting errors.'})}
                    className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 relative overflow-hidden group cursor-help hover:border-emerald-200 transition-colors"
                 >
                     <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-10 -mt-10 z-0 group-hover:scale-150 transition-all duration-700" />
                     <div className="relative z-10">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Gross Overage</p>
                        <p className="text-4xl lg:text-5xl font-black text-emerald-500 tracking-tighter">+${stats.totalOverage.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        <p className="text-xs font-bold text-emerald-500 mt-2 bg-emerald-50 inline-block px-2 py-1 rounded-lg border border-emerald-100">{stats.overagePct.toFixed(2)}% of Rev</p>
                     </div>
                 </div>

                 <div 
                    onClick={() => setExplanation({title: 'Net Variance', formula: 'Gross Overage - Gross Shrink', description: 'The financial balance of all inventory errors. A positive number means you have more inventory value than expected (surplus), while a negative number indicates an overall financial loss.'})}
                    className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 relative overflow-hidden group cursor-help hover:border-indigo-200 transition-colors"
                 >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-10 -mt-10 z-0 group-hover:scale-150 transition-all duration-700" />
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Net Variance</p>
                        <p className={`text-4xl lg:text-5xl font-black tracking-tighter ${stats.netVariance >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                           {stats.netVariance >= 0 ? '+' : '-'}${Math.abs(stats.netVariance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </p>
                        <p className="text-xs font-bold text-indigo-400 mt-2 bg-indigo-50 inline-block px-2 py-1 rounded-lg border border-indigo-100">{stats.netPct.toFixed(2)}% of Rev</p>
                    </div>
                 </div>

                 <div 
                    onClick={() => setExplanation({title: 'Inventory Integrity', formula: '100% - (Abs(Shrink) + Abs(Overage)) / Revenue', description: 'A measure of operational precision. It penalizes BOTH shrink and overage equally, as both represent errors in the supply chain or counting process.'})}
                    className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 relative overflow-hidden group cursor-help hover:border-slate-300 transition-colors"
                 >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-slate-100 rounded-full -mr-10 -mt-10 z-0 group-hover:scale-150 transition-all duration-700" />
                    <div className="relative z-10">
                        <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Integrity</p>
                        <p className="text-4xl lg:text-5xl font-black text-slate-900 tracking-tighter">{stats.accuracy}%</p>
                        <p className="text-xs font-bold text-slate-400 mt-2 bg-slate-100 inline-block px-2 py-1 rounded-lg border border-slate-200">Accuracy Score</p>
                    </div>
                 </div>
              </div>
              <AnalysisCharts data={filteredRecords} allRecords={records} onItemAnalysis={handleItemDrilldown} />
            </div>
          )}

          {/* UPLOAD / LANDING VIEW */}
          {view === 'report-upload' && (
             <div className="flex flex-col items-center justify-center py-20 animate-in zoom-in-95 duration-500">
                <div className="bg-white p-20 rounded-[5rem] shadow-2xl border border-slate-200 text-center max-w-2xl">
                   <div className="w-24 h-24 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-indigo-600 mx-auto mb-8 text-3xl"><Icons.Dashboard /></div>
                   <h2 className="text-4xl font-black mb-4 tracking-tighter text-slate-900">Initialization</h2>
                   <div className="text-slate-500 mb-8 font-medium text-lg space-y-2">
                      <p>Use the <span className="text-indigo-600 font-bold uppercase text-xs tracking-widest bg-indigo-50 px-2 py-1 rounded-lg">Month Grid</span> above to upload reports.</p>
                      <p className="text-sm opacity-70">Click any empty month slot to import Excel data for that specific period.</p>
                   </div>
                </div>
             </div>
          )}

          {/* AI FORENSIC HUB VIEW */}
          {view === 'ai-insights' && (
            <div className="max-w-6xl mx-auto animate-in zoom-in-95 duration-700">
              <div className="bg-white rounded-[5rem] shadow-2xl overflow-hidden min-h-[850px] flex flex-col border border-slate-200">
                <div className="bg-slate-900 p-16 text-white flex items-center justify-between">
                  <div className="flex items-center gap-8">
                    <div className="w-16 h-16 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-white"><Icons.AI /></div>
                    <h3 className="text-4xl font-black tracking-tighter uppercase">Forensic Vault</h3>
                  </div>
                </div>
                <div className="flex-1 flex overflow-hidden">
                  <div className="w-96 bg-slate-50 border-r border-slate-200 p-12 space-y-10 flex flex-col overflow-y-auto">
                    
                    {/* Deep Dive Button */}
                    <button 
                        onClick={startDeepDive} 
                        disabled={deepDiveStatus === 'analyzing'}
                        className={`relative w-full p-10 rounded-[3rem] border-2 transition-all duration-500 overflow-hidden group text-left ${
                            deepDiveStatus === 'analyzing' ? 'bg-indigo-50 border-indigo-200 cursor-wait' : 
                            deepDiveStatus === 'ready' ? 'bg-emerald-50 border-emerald-500 shadow-2xl shadow-emerald-100 scale-105' : 
                            'bg-white border-slate-200 hover:border-indigo-400 hover:shadow-xl'
                        }`}
                    >
                        {/* Thinking Cloud Animation */}
                        <div className={`absolute top-6 right-8 text-4xl transition-all duration-500 ${deepDiveStatus === 'analyzing' ? 'opacity-100 translate-y-0 animate-bounce' : 'opacity-0 translate-y-4'}`}>
                            💭
                        </div>

                        <div className={`text-5xl mb-4 transition-transform duration-700 ${deepDiveStatus === 'analyzing' ? 'animate-pulse scale-110' : 'group-hover:scale-110'}`}>
                            🧠
                        </div>
                        
                        <div className="flex flex-col items-start">
                            <span className={`font-black uppercase tracking-tighter text-base ${deepDiveStatus === 'ready' ? 'text-emerald-700' : 'text-slate-900'}`}>
                                {deepDiveStatus === 'ready' ? 'Results Ready' : 'Deep Dive'}
                            </span>
                             {deepDiveStatus === 'ready' && (
                                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest mt-1 animate-pulse">Click to View</span>
                            )}
                        </div>
                    </button>

                    <div className="flex flex-col gap-4">
                        {rotatedPrompts.map((q, idx) => (
                          <button 
                            key={idx} 
                            onClick={() => handleRunQuickAI(q)} 
                            disabled={isQuickAnalyzing}
                            className={`text-left p-5 rounded-3xl border text-[11px] font-bold uppercase tracking-widest transition-all relative overflow-hidden ${
                                activeChip === q 
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-[1.02]' 
                                    : 'bg-white hover:border-indigo-400 text-slate-700 hover:shadow-md'
                            }`}
                          >
                            <div className="relative z-10 flex items-start gap-3">
                                {activeChip === q && isQuickAnalyzing ? (
                                    <div className="w-4 h-4 mt-0.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                                ) : (
                                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${activeChip === q ? 'bg-white' : 'bg-indigo-200'}`} />
                                )}
                                <span>{q}</span>
                            </div>
                          </button>
                        ))}
                    </div>
                    <button 
                      onClick={shufflePrompts} 
                      className="w-full py-4 bg-indigo-50 text-indigo-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-100 transition-colors flex items-center justify-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                      Shuffle / New Ideas
                    </button>
                  </div>
                  <div className="flex-1 flex flex-col bg-white">
                    <div ref={scrollRef} className="flex-1 p-16 overflow-y-auto bg-white custom-scrollbar">
                       {quickAiText ? (
                         <div className="prose prose-indigo max-w-none font-medium text-slate-700 whitespace-pre-wrap leading-relaxed animate-in fade-in slide-in-from-bottom-6">
                           {quickAiText}
                         </div>
                       ) : <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-40 uppercase font-black text-center px-12 leading-relaxed">Scope the Forensic Logic.</div>}
                    </div>
                    <div className="p-16 bg-slate-50/50 border-t border-slate-200">
                      <div className="relative group max-w-4xl mx-auto">
                        <input type="text" value={aiUserPrompt} onChange={(e) => setAiUserPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRunQuickAI()} placeholder="Ask about variances..." className="w-full bg-white border-4 border-slate-200 rounded-[3rem] px-14 py-8 text-base font-bold outline-none pr-32 shadow-2xl" />
                        <button onClick={() => handleRunQuickAI()} disabled={!aiUserPrompt.trim() && !isQuickAnalyzing} className="absolute right-6 top-6 w-16 h-16 bg-indigo-600 text-white rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-indigo-200 transition-all">
                          {isQuickAnalyzing && activeChip === 'custom' ? (
                            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            <Icons.AI />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;