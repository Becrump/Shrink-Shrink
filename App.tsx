
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ShrinkRecord, ViewType, DeepDiveStatus } from './types';
import { Icons } from './constants';
import { AnalysisCharts } from './components/AnalysisCharts';
import { queryMarketAIQuick, queryMarketAIDeep } from './services/geminiService';
import * as XLSX from 'xlsx';

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
  interface Window {
    aistudio?: AIStudio;
    process: {
      env: {
        API_KEY?: string;
      }
    }
  }
}

type SegmentFilter = 'ALL' | 'SODA_SNACK' | 'COLD';

interface ImportStaging {
  records: Partial<ShrinkRecord>[];
  marketNames: string[];
  period: string;
  detectedColumns: string[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SUGGESTED_QUESTIONS = [
  "Find naming confusion errors (e.g. Cheeseburger vs Classic Cheeseburger).",
  "Are Cold Food (KF/F/B) overages due to missing tablet 'Adds'?",
  "Analyze items with inverted variances in the same market.",
  "Contrast Scanned Food (KF) accuracy vs Manual Snack counting.",
  "Which market has the highest risk of tablet receiving errors?"
];

const STORAGE_KEYS = {
  RECORDS: 'shrink_guard_records_v22',
  MONTHS: 'shrink_guard_months_v22',
  MARKET: 'shrink_guard_market_v22',
  SEGMENT: 'shrink_guard_segment_v22'
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
  for (const m of MONTHS) if (normalized.includes(m.toLowerCase())) return m;
  return str;
};

const App: React.FC = () => {
  const [view, setView] = useState<ViewType>('report-upload');
  
  const checkGlobalKey = useCallback(() => {
    try {
      // 1. Check window.process (Injected by Worker script)
      const windowKey = (window as any).process?.env?.API_KEY;
      if (windowKey && windowKey.trim().length > 0) return true;
      
      // 2. Check Meta Tag (Backup injected by Worker)
      const metaKey = document.querySelector('meta[name="ai-api-key"]')?.getAttribute('content');
      if (metaKey && metaKey.trim().length > 0) return true;

      // 3. Check build-time process
      const processKey = typeof process !== 'undefined' ? (process.env?.API_KEY || (process.env as any)?.VITE_API_KEY) : null;
      if (processKey && processKey.trim().length > 0) return true;

      return false;
    } catch {
      return false;
    }
  }, []);

  const [hasApiKey, setHasApiKey] = useState<boolean>(checkGlobalKey());
  
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

  const [quickAiText, setQuickAiText] = useState<string>('');
  const [aiUserPrompt, setAiUserPrompt] = useState<string>('');
  const [isQuickAnalyzing, setIsQuickAnalyzing] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [deepDiveStatus, setDeepDiveStatus] = useState<DeepDiveStatus>('idle');
  const [deepDiveResult, setDeepDiveResult] = useState<string>('');

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [importStaging, setImportStaging] = useState<ImportStaging | null>(null);
  const [activeUploadMonth, setActiveUploadMonth] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
      localStorage.setItem(STORAGE_KEYS.MONTHS, JSON.stringify(Array.from(selectedMonths)));
      localStorage.setItem(STORAGE_KEYS.MARKET, selectedMarketFilter);
      localStorage.setItem(STORAGE_KEYS.SEGMENT, activeSegment);
    } catch (e) {
      console.warn("Storage quota limit reached.");
    }
  }, [records, selectedMonths, selectedMarketFilter, activeSegment]);

  useEffect(() => {
    const checkKey = async () => {
      let isPresent = checkGlobalKey();
      if (window.aistudio) {
        const studioPresent = await window.aistudio.hasSelectedApiKey();
        isPresent = isPresent || studioPresent;
      }
      if (isPresent !== hasApiKey) setHasApiKey(isPresent);
    };

    const interval = setInterval(checkKey, 1500);
    checkKey();
    return () => clearInterval(interval);
  }, [checkGlobalKey, hasApiKey]);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

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
      if (MONTHS.includes(norm)) set.add(norm);
    });
    return set;
  }, [records]);

  const marketOptions = useMemo(() => {
    const names = Array.from(new Set(records.map(r => r.marketName))).filter(Boolean).sort();
    return ['All', ...names];
  }, [records]);

  const isColdFood = useCallback((record: ShrinkRecord) => {
    const coldPrefixRegex = /^(KF|F\s|B\s)/i;
    return coldPrefixRegex.test(record.itemNumber) || coldPrefixRegex.test(record.itemName);
  }, []);

  const timelineStats = useMemo(() => {
    const stats: Record<string, { shrink: number; overage: number }> = {};
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (!MONTHS.includes(norm)) return;
      if (!stats[norm]) stats[norm] = { shrink: 0, overage: 0 };
      const impact = r.invVariance * (r.unitCost || 0);
      if (impact < 0) stats[norm].shrink += Math.abs(impact);
      else if (impact > 0) stats[norm].overage += impact;
    });
    return stats;
  }, [records]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const normPeriod = normalizePeriod(r.period);
      if (selectedMonths.size > 0 && !selectedMonths.has(normPeriod)) return false;
      if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return false;
      if (activeSegment === 'COLD' && !isColdFood(r)) return false;
      if (activeSegment === 'SODA_SNACK' && isColdFood(r)) return false;
      return true;
    });
  }, [records, selectedMonths, selectedMarketFilter, activeSegment, isColdFood]);

  const stats = useMemo(() => {
    if (filteredRecords.length === 0) return { totalShrink: 0, totalRevenue: 0, totalOverage: 0, netVariance: 0, accuracy: 100, shrinkPct: 0, overagePct: 0, netPct: 0, count: 0 };
    
    let totalShrink = 0, totalRevenue = 0, totalOverage = 0;
    
    filteredRecords.forEach(rec => {
      totalRevenue += rec.totalRevenue || 0;
      const impact = rec.invVariance * (rec.unitCost || 0);
      if (impact < 0) {
        totalShrink += Math.abs(impact);
      } else if (impact > 0) {
        totalOverage += impact;
      }
    });

    const netVariance = totalOverage - totalShrink;
    const accuracy = totalRevenue > 0 ? (1 - (totalShrink / totalRevenue)) * 100 : 100;
    const shrinkPct = totalRevenue > 0 ? (totalShrink / totalRevenue) * 100 : 0;
    const overagePct = totalRevenue > 0 ? (totalOverage / totalRevenue) * 100 : 0;
    const netPct = totalRevenue > 0 ? (netVariance / totalRevenue) * 100 : 0;

    return {
      totalShrink, 
      totalRevenue, 
      totalOverage, 
      netVariance,
      accuracy: Number(Math.max(0, accuracy).toFixed(2)),
      shrinkPct: Number(shrinkPct.toFixed(2)),
      overagePct: Number(overagePct.toFixed(2)),
      netPct: Number(netPct.toFixed(2)),
      count: filteredRecords.length
    };
  }, [filteredRecords]);

  const handleRunQuickAI = async (customPrompt?: string) => {
    if (!hasApiKey) return;
    const question = customPrompt || aiUserPrompt;
    if (!question.trim() || filteredRecords.length === 0 || isQuickAnalyzing) return;
    
    setIsQuickAnalyzing(true);
    setActiveChip(customPrompt || 'custom');
    setQuickAiText('');
    setAiUserPrompt('');
    setView('ai-insights');
    
    try {
      await queryMarketAIQuick(filteredRecords, stats, question, (text) => {
        if (text === "RESELECT_KEY") {
          setHasApiKey(false);
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
    if (!hasApiKey) return;
    if (deepDiveStatus === 'ready') {
      setQuickAiText(deepDiveResult);
      setDeepDiveStatus('idle');
      setView('ai-insights');
      return;
    }
    if (deepDiveStatus === 'analyzing' || filteredRecords.length === 0) return;
    setDeepDiveStatus('analyzing');
    queryMarketAIDeep(filteredRecords, stats).then(result => {
      if (result === "RESELECT_KEY") {
        setHasApiKey(false);
        setDeepDiveStatus('idle');
        return;
      }
      setDeepDiveResult(result);
      setDeepDiveStatus('ready');
    }).catch(() => setDeepDiveStatus('idle'));
  };

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
        let detectedColumnNames: string[] = [];
        
        workbook.SheetNames.forEach((sheetName, sIdx) => {
          try {
            setProcessingStatus(`Auditing POS ${sIdx + 1}/${workbook.SheetNames.length}...`);
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            if (!jsonData || jsonData.length < 5) return;

            const locationVal = (jsonData[2] as any[])?.[0] || '';
            const marketVal = (jsonData[3] as any[])?.[0] || '';
            const hLocation = humanizeMarketName(String(locationVal));
            const hMarket = humanizeMarketName(String(marketVal));
            let cleanName = (hLocation && hMarket && hLocation !== hMarket) ? `${hLocation} - ${hMarket}` : (hMarket || hLocation || humanizeMarketName(sheetName));
            if (!humanMarketNames.includes(cleanName)) humanMarketNames.push(cleanName);

            let colMap = { itemNum: 0, itemName: 1, variance: 2, revenue: 3, soldQty: 4, salePrice: 5, itemCost: 7 };
            let headerRowIndex = -1;
            
            for (let i = 0; i < Math.min(jsonData.length, 50); i++) {
              const row = jsonData[i] as any[];
              if (!row || !Array.isArray(row)) continue;
              const rowStr = row.join('|').toLowerCase();
              if (rowStr.includes('variance') || rowStr.includes('revenue') || rowStr.includes('cost')) {
                headerRowIndex = i;
                row.forEach((cell, idx) => {
                  const s = String(cell || '').toLowerCase().trim();
                  if (!s) return;
                  if (s === 'item code' || s === 'item number' || s === 'item no') colMap.itemNum = idx;
                  else if (s === 'item' || s === 'item name' || s === 'description') colMap.itemName = idx;
                  else if (s === 'inv variance' || s === 'inventory variance') colMap.variance = idx;
                  else if (s === 'total revenue' || s === 'revenue' || s === 'sales') colMap.revenue = idx;
                  else if (s === 'sold qty' || s === 'qty sold' || s === 'units sold') colMap.soldQty = idx;
                  else if (s === 'sale price' || s === 'price') colMap.salePrice = idx;
                  else if (s === 'item cost' || s === 'unit cost' || s === 'cost') colMap.itemCost = idx;
                  else if (s.includes('variance') && !colMap.variance) colMap.variance = idx;
                });
                detectedColumnNames = row.map(c => String(c || ''));
                break;
              }
            }
            if (headerRowIndex === -1) return;

            const dataRows = jsonData.filter((r: any, idx) => 
              idx > headerRowIndex && Array.isArray(r) && r.length > 3 && (parseFloat(String(r[colMap.itemNum])) || parseFloat(String(r[colMap.variance])))
            );
            
            dataRows.forEach((row: any) => {
              const itemLabel = String(row[colMap.itemName] || '').toLowerCase();
              if (itemLabel.includes('total') || itemLabel.includes('summary')) return;

              const invVar = parseFloat(row[colMap.variance]) || 0;
              if (Math.abs(invVar) < 0.001) return;

              const cost = parseFloat(row[colMap.itemCost]) || 0;
              const soldQty = parseFloat(row[colMap.soldQty]) || 0;
              const salePrice = parseFloat(row[colMap.salePrice]) || 0;
              
              let revenue = parseFloat(row[colMap.revenue]) || 0;
              if (revenue === 0 && soldQty > 0 && salePrice > 0) {
                revenue = soldQty * salePrice;
              }
              
              const impact = invVar * cost;
              
              allExtractedRecords.push({
                itemNumber: String(row[colMap.itemNum] || ''),
                itemName: String(row[colMap.itemName] || ''),
                invVariance: invVar,
                totalRevenue: revenue,
                soldQty: soldQty,
                salePrice: salePrice,
                shrinkLoss: invVar < 0 ? Math.abs(impact) : 0,
                unitCost: cost,
                marketName: cleanName,
                period: targetedMonth || 'Current'
              });
            });
          } catch (sheetErr) { console.warn(`POS forensic error:`, sheetErr); }
        });
        
        if (allExtractedRecords.length === 0) {
          alert("Baseline matches perfectly. No forensic variances detected.");
          setIsProcessing(false);
          return;
        }

        setImportStaging({ records: allExtractedRecords, marketNames: humanMarketNames, period: targetedMonth || 'Current', detectedColumns: detectedColumnNames });
        setIsProcessing(false);
      } catch (err) { setIsProcessing(false); }
    };
    reader.readAsArrayBuffer(file);
  };

  const commitImport = () => {
    if (!importStaging) return;
    const newRecords = importStaging.records.map((r, i) => ({ ...r, id: `imp-${i}-${Date.now()}` } as ShrinkRecord));
    setRecords(prev => [...prev.filter(r => normalizePeriod(r.period) !== importStaging.period), ...newRecords]);
    setSelectedMonths(prev => new Set(prev).add(normalizePeriod(importStaging.period)));
    setImportStaging(null);
    setView('dashboard');
  };

  const toggleMonth = (m: string) => {
    setSelectedMonths(prev => {
      const n = new Set(prev);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {/* Diagnostic Alert Overlay */}
      {!hasApiKey && (
        <div className="fixed inset-0 z-[1000] bg-slate-900/90 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-500">
          <div className="bg-white max-w-2xl w-full rounded-[4rem] shadow-2xl p-16 border border-slate-200">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-3xl flex items-center justify-center mb-10"><Icons.Alert /></div>
            <h2 className="text-4xl font-black text-slate-900 tracking-tighter mb-6">Forensic Engine: Offline</h2>
            <p className="text-slate-600 font-medium leading-relaxed mb-10 text-lg">
              The AI Diagnostic Engine cannot find its API_KEY. This usually means the <strong>Edge Worker</strong> is being bypassed by the Cloudflare Cache.
            </p>
            
            <div className="space-y-6 mb-12">
               <div className="bg-slate-50 p-8 rounded-3xl border border-slate-100">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Required Actions:</h4>
                  <ul className="space-y-4">
                    <li className="flex gap-4 text-sm font-bold text-slate-700">
                       <span className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">1</span>
                       Verify 'API_KEY' is added as a 'Text' variable in Cloudflare Dashboard.
                    </li>
                    <li className="flex gap-4 text-sm font-bold text-slate-700">
                       <span className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">2</span>
                       Ensure the custom domain 'shrink.pmaseed.com' is assigned to your Worker routes.
                    </li>
                    <li className="flex gap-4 text-sm font-bold text-slate-700">
                       <span className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-[10px] shrink-0">3</span>
                       Click "Purge Cache" in Cloudflare to clear the old HTML without the key.
                    </li>
                  </ul>
               </div>
            </div>

            <div className="flex gap-4">
               {window.aistudio && (
                 <button onClick={handleSelectKey} className="flex-1 bg-indigo-600 text-white py-6 rounded-3xl font-black shadow-2xl hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs">Manual Key Connect</button>
               )}
               <button onClick={() => window.location.reload()} className="flex-1 border-4 border-slate-100 text-slate-400 py-6 rounded-3xl font-black hover:bg-slate-50 transition-all uppercase tracking-widest text-xs">Refresh & Retry</button>
            </div>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-300">
           <div className="bg-white p-12 rounded-[4rem] shadow-2xl flex flex-col items-center gap-8 border border-slate-200 max-w-sm w-full text-center">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-indigo-600 drop-shadow-sm"><Icons.AI /></div>
              </div>
              <div>
                 <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Forensic Sync</h3>
                 <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest mt-2">{processingStatus}</p>
                 <p className="text-slate-400 text-[9px] mt-4 max-w-[25ch] mx-auto uppercase leading-relaxed font-bold">Scanning: KF/F/B UPC Accuracy vs Manual Planogram counts...</p>
              </div>
           </div>
        </div>
      )}

      <aside className="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex flex-col shrink-0 z-20 shadow-2xl">
        <div className="p-8">
          <h1 className="text-xl font-bold text-white flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center text-white font-black shadow-lg">S</div>
            The Shrink Shrink
          </h1>
          <div className="mt-8 space-y-2">
            {!hasApiKey ? (
              <button onClick={() => window.location.reload()} className="w-full flex items-center gap-2 px-3 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-[9px] font-black uppercase tracking-widest animate-pulse">Syncing Engine...</button>
            ) : (
              <div className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[9px] font-black uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Diagnostic Engine Active
              </div>
            )}
            <button onClick={purgeLedger} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-red-900/40 border border-slate-700 rounded-xl text-slate-400 hover:text-red-200 text-[9px] font-black uppercase tracking-widest transition-all">Flush Ledger</button>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1.5">
          <button onClick={() => setView('report-upload')} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'report-upload' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50'}`}><Icons.Upload /> Drop Data</button>
          <button onClick={() => setView('dashboard')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'dashboard' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50 disabled:opacity-20'}`}><Icons.Dashboard /> Performance</button>
          <button onClick={() => setView('ai-insights')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl text-sm font-bold transition-all ${view === 'ai-insights' ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-900/20' : 'hover:bg-slate-800/50 disabled:opacity-20'}`}><Icons.AI /> AI Diagnosis</button>
        </nav>
        <div className="p-8 border-t border-slate-800">
           <div className="bg-slate-800/40 p-4 rounded-2xl border border-slate-700/50">
              <p className="text-[9px] font-black text-slate-500 uppercase mb-1 tracking-widest">Active Variances</p>
              <p className="text-base font-black text-white">{records.length.toLocaleString()}</p>
           </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#F8FAFC] custom-scrollbar">
        {importStaging && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-xl">
            <div className="bg-white w-full max-w-xl rounded-[4rem] shadow-2xl p-12 border border-slate-200">
               <h3 className="text-3xl font-black mb-6 tracking-tighter">Audit Required</h3>
               <div className="bg-slate-50 p-8 rounded-[2.5rem] mb-8 border border-slate-100 max-h-64 overflow-y-auto custom-scrollbar">
                  <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Market Forensic Sync:</p>
                  <div className="flex flex-col gap-2.5">
                    {importStaging.marketNames.map((name, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 px-5 py-4 rounded-2xl text-[11px] font-black text-indigo-700 shadow-sm flex items-center justify-between group hover:border-indigo-400 transition-all">
                        <span className="truncate pr-4">{name}</span>
                        <div className="w-6 h-6 bg-indigo-50 rounded-full flex items-center justify-center text-[10px] text-indigo-500">✓</div>
                      </div>
                    ))}
                  </div>
               </div>
               <p className="text-slate-500 mb-10 text-sm font-medium leading-relaxed">Identifying <span className="font-black text-indigo-600">{importStaging.records.length} forensic variances</span>. Separating UPC-Scanned (KF/F/B) from Manual counting.</p>
               <div className="flex gap-4">
                  <button onClick={() => setImportStaging(null)} className="flex-1 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px] hover:text-red-500 transition-colors">Discard</button>
                  <button onClick={commitImport} className="flex-[2] bg-indigo-600 text-white py-5 rounded-3xl font-black shadow-2xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all uppercase tracking-widest text-xs">Commit To History</button>
               </div>
            </div>
          </div>
        )}

        <div className="p-12 max-w-7xl mx-auto">
          <div className="mb-14 flex gap-5 overflow-x-auto pb-8 custom-scrollbar scroll-smooth">
            {MONTHS.map(m => {
              const isPopulated = populatedMonths.has(m);
              const isSelected = selectedMonths.has(m);
              const mStats = timelineStats[m];
              return (
                <div key={m} onClick={() => isPopulated ? toggleMonth(m) : (setActiveUploadMonth(m), fileInputRef.current?.click())} 
                     className={`flex-shrink-0 w-44 h-60 rounded-[3rem] border-2 flex flex-col items-center justify-between p-6 cursor-pointer transition-all duration-300 group ${isSelected ? 'bg-white border-indigo-500 shadow-2xl scale-105 z-10' : isPopulated ? 'bg-white border-slate-100 hover:border-indigo-200 shadow-xl' : 'bg-slate-100 border-dashed border-slate-300 opacity-60 hover:opacity-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-indigo-500 transition-colors">{m}</span>
                  {isPopulated ? (
                    <>
                      <div className={`w-12 h-12 rounded-[1.25rem] flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 text-white shadow-xl rotate-6' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-500'}`}><Icons.Markets /></div>
                      <div className="w-full space-y-2 pt-2 border-t border-slate-50">
                        <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase tracking-tighter">Loss</span>
                          <span className="text-red-500">-${Math.round(mStats?.shrink || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase tracking-tighter">Gain</span>
                          <span className="text-emerald-500">+${Math.round(mStats?.overage || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4 opacity-40 group-hover:opacity-100 transition-all">
                      <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-500 transition-all"><Icons.Upload /></div>
                      <span className="text-[8px] font-black uppercase tracking-widest">New Slot</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], activeUploadMonth || undefined)} />

          {view === 'dashboard' && records.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
              <div className="flex flex-wrap items-center justify-between gap-8 mb-12 bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
                 <div className="flex items-center gap-8">
                    <div className="flex bg-slate-50 p-2 rounded-[1.5rem] border border-slate-100 shadow-inner">
                       {(['ALL', 'SODA_SNACK', 'COLD'] as SegmentFilter[]).map(seg => (
                         <button key={seg} onClick={() => setActiveSegment(seg)} className={`px-8 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeSegment === seg ? 'bg-white text-indigo-600 shadow-xl border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}>
                           {seg === 'ALL' ? 'Everything' : seg === 'SODA_SNACK' ? 'Snacks & Drinks' : 'Fresh Food'}
                         </button>
                       ))}
                    </div>
                    <div className="h-10 w-px bg-slate-200 hidden md:block" />
                    <select value={selectedMarketFilter} onChange={(e) => setSelectedMarketFilter(e.target.value)} className="bg-slate-50 border border-slate-100 rounded-2xl px-8 py-4 text-[10px] font-black uppercase tracking-widest text-slate-600 outline-none focus:ring-4 focus:ring-indigo-500/10 min-w-[340px] shadow-sm appearance-none cursor-pointer">
                       <option value="All">All Filtered Locations</option>
                       {marketOptions.filter(m => m !== 'All').map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 group transition-all hover:shadow-2xl hover:-translate-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Gross Shrink (Cost)</p>
                    <p className="text-5xl font-black text-red-500 tracking-tighter">-${stats.totalShrink.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-slate-50 pt-3">
                       <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Loss Impact</span>
                       <span className="text-[12px] font-black text-slate-900">{stats.shrinkPct}%</span>
                    </div>
                 </div>
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 group transition-all hover:shadow-2xl hover:-translate-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Gross Overage (Cost)</p>
                    <p className="text-5xl font-black text-emerald-600 tracking-tighter">+${stats.totalOverage.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <div className="mt-5 flex items-center justify-between border-t border-slate-50 pt-3">
                       <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Gain Impact</span>
                       <span className="text-[12px] font-black text-slate-900">{stats.overagePct}%</span>
                    </div>
                 </div>
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 group transition-all hover:shadow-2xl hover:-translate-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Net Outcome</p>
                    <p className={`text-5xl font-black tracking-tighter ${stats.netVariance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                       {stats.netVariance >= 0 ? '+' : ''}${Math.round(stats.netVariance).toLocaleString()}
                    </p>
                    <div className="mt-5 flex items-center justify-between border-t border-slate-50 pt-3">
                       <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Bottom Line Shift</span>
                       <span className="text-[12px] font-black text-slate-900">{stats.netPct}%</span>
                    </div>
                 </div>
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100 group transition-all hover:shadow-2xl hover:-translate-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Forensic Integrity</p>
                    <p className="text-5xl font-black text-slate-900 tracking-tighter">{stats.accuracy}%</p>
                    <div className="mt-5 flex items-center justify-between border-t border-slate-50 pt-3">
                       <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Audit Stability</span>
                       <div className={`w-3 h-3 rounded-full ${stats.accuracy > 98 ? 'bg-emerald-500 shadow-lg shadow-emerald-200' : 'bg-orange-500 shadow-lg shadow-orange-200'}`} />
                    </div>
                 </div>
              </div>
              <AnalysisCharts data={filteredRecords} />
            </div>
          )}

          {view === 'ai-insights' && (
            <div className="max-w-6xl mx-auto animate-in zoom-in-95 duration-700">
              <div className="bg-white rounded-[5rem] shadow-2xl overflow-hidden min-h-[850px] flex flex-col border border-slate-200">
                <div className="bg-slate-900 p-16 text-white flex items-center justify-between">
                  <div className="flex items-center gap-8">
                    <div className="w-16 h-16 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-indigo-500/50"><Icons.AI /></div>
                    <div>
                      <h3 className="text-4xl font-black tracking-tighter uppercase">Forensic Vault</h3>
                      <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.2em] mt-2">Inventory Integrity Analyst v5.3</p>
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex overflow-hidden">
                  <div className="w-96 bg-slate-50 border-r border-slate-200 p-12 space-y-10 flex flex-col overflow-y-auto custom-scrollbar">
                    <div>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase mb-8 tracking-[0.15em] border-b border-slate-200 pb-2">Diagnostic Scan</h4>
                      <button onClick={startDeepDive} className={`w-full p-10 rounded-[3rem] flex flex-col items-center gap-5 transition-all relative border-2 ${deepDiveStatus === 'analyzing' ? 'bg-indigo-50 border-indigo-200 text-indigo-600 cursor-wait' : deepDiveStatus === 'ready' ? 'bg-emerald-500 border-emerald-400 text-white shadow-2xl scale-[1.02]' : 'bg-white border-slate-200 hover:border-indigo-400 hover:shadow-xl'}`}>
                        <div className={`text-5xl ${deepDiveStatus === 'analyzing' ? 'animate-pulse' : ''}`}>{deepDiveStatus === 'ready' ? '📊' : '🩺'}</div>
                        <div className="text-center"><span className="font-black uppercase tracking-tighter text-base">{deepDiveStatus === 'idle' ? 'Full Forensic Audit' : deepDiveStatus === 'analyzing' ? 'Auditing Ledger...' : 'Audit Generated'}</span></div>
                        {deepDiveStatus === 'ready' && <div className="text-[10px] font-black uppercase tracking-widest mt-1 opacity-80">Click to View Diagnosis</div>}
                      </button>
                    </div>

                    <div className="pt-10 border-t border-slate-200">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase mb-6 tracking-[0.15em]">Forensic Logic Scopes</h4>
                      <div className="flex flex-col gap-4">
                        {SUGGESTED_QUESTIONS.map((q, idx) => {
                          const isActive = activeChip === q;
                          return (
                            <button 
                              key={idx} 
                              disabled={isQuickAnalyzing}
                              onClick={() => handleRunQuickAI(q)} 
                              className={`text-left p-5 rounded-3xl border text-[11px] font-bold uppercase tracking-widest transition-all relative overflow-hidden group ${isActive ? 'bg-indigo-600 border-indigo-500 text-white shadow-xl translate-x-2' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:shadow-md'}`}
                            >
                              <div className="relative z-10 flex items-center justify-between">
                                <span className="max-w-[85%] leading-relaxed">{q}</span>
                                {isActive && (
                                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                )}
                              </div>
                              {!isActive && <div className="absolute right-4 opacity-0 group-hover:opacity-100 transition-opacity">→</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-white">
                    <div ref={scrollRef} className="flex-1 p-16 overflow-y-auto bg-white custom-scrollbar">
                       {quickAiText ? (
                         <div className="prose prose-indigo max-w-none font-medium text-slate-700 whitespace-pre-wrap leading-relaxed animate-in fade-in slide-in-from-bottom-6 duration-700 bg-slate-50/50 p-16 rounded-[4rem] border border-slate-100 shadow-inner">
                           {quickAiText}
                         </div>
                       ) : isQuickAnalyzing ? (
                         <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-8 animate-pulse">
                            <div className="w-20 h-20 bg-indigo-50 rounded-[2rem] flex items-center justify-center text-indigo-500 animate-bounce shadow-xl"><Icons.AI /></div>
                            <div className="text-center">
                               <h4 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Diagnosis Active</h4>
                               <p className="text-sm font-bold uppercase tracking-widest mt-2 text-slate-400">Querying forensic ledger for "{activeChip || 'Custom Audit'}"...</p>
                            </div>
                         </div>
                       ) : (
                         <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-40 text-center">
                           <div className="w-28 h-28 bg-slate-50 rounded-full flex items-center justify-center mb-10 border border-slate-100 shadow-sm"><Icons.AI /></div>
                           <h4 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Audit Awaiting Query</h4>
                           <p className="max-w-xs text-base mt-4 font-semibold italic leading-relaxed">"System Accuracy: {stats.accuracy}%. Forensic engine calibrated for Scanned (KF/F/B) vs. Manual Planogram discrepancies."</p>
                         </div>
                       )}
                    </div>
                    <div className="p-16 bg-slate-50/50 border-t border-slate-200">
                      <div className="relative group max-w-4xl mx-auto">
                        <input 
                          type="text" 
                          value={aiUserPrompt} 
                          onChange={(e) => setAiUserPrompt(e.target.value)} 
                          onKeyDown={(e) => e.key === 'Enter' && handleRunQuickAI()} 
                          disabled={isQuickAnalyzing}
                          placeholder="Ask about missed KF/F/B delivery 'Adds' or snack/drink counting errors..." 
                          className="w-full bg-white border-4 border-slate-200 group-focus-within:border-indigo-500 rounded-[3rem] px-14 py-8 text-base font-bold outline-none transition-all pr-32 shadow-2xl shadow-slate-200/50 placeholder:text-slate-300 disabled:opacity-50" 
                        />
                        <button 
                          onClick={() => handleRunQuickAI()} 
                          disabled={isQuickAnalyzing || !aiUserPrompt.trim()} 
                          className="absolute right-6 top-6 w-16 h-16 bg-indigo-600 text-white rounded-[1.5rem] flex items-center justify-center shadow-xl hover:bg-indigo-700 disabled:bg-slate-300 transition-all active:scale-95 shadow-indigo-200"
                        >
                          {isQuickAnalyzing ? (
                             <div className="w-6 h-6 border-4 border-white/20 border-t-white rounded-full animate-spin" />
                          ) : <Icons.AI />}
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
