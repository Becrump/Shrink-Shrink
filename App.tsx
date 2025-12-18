
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ShrinkRecord, ViewType } from './types';
import { Icons } from './constants';
import { AnalysisCharts } from './components/AnalysisCharts';
import { queryMarketAI, parseRawReportText } from './services/geminiService';
import * as XLSX from 'xlsx';

type SegmentFilter = 'ALL' | 'SODA_SNACK' | 'COLD';

interface ImportStaging {
  records: Partial<ShrinkRecord>[];
  marketNames: string[];
  period: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SUGGESTED_QUESTIONS = [
  "Which market has the most suspicious inventory overages?",
  "Analyze high-value items vs small-ticket shrink trends.",
  "What is the projected shrink for next month?",
  "Show me the top 5 cold food shrink anomalies across the portfolio."
];

const STORAGE_KEYS = {
  RECORDS: 'shrink_guard_records_v2',
  MONTHS: 'shrink_guard_months_v2',
  MARKET: 'shrink_guard_market_v2',
  SEGMENT: 'shrink_guard_segment_v2'
};

const normalizePeriod = (str: string): string => {
  if (!str) return 'Unknown';
  const normalized = str.trim().toLowerCase();
  for (const m of MONTHS) {
    if (normalized.includes(m.toLowerCase())) return m;
  }
  const abbrevs: Record<string, string> = {
    'jan': 'January', 'feb': 'February', 'mar': 'March', 'apr': 'April',
    'may': 'May', 'jun': 'June', 'jul': 'July', 'aug': 'August',
    'sep': 'September', 'oct': 'October', 'nov': 'November', 'dec': 'December'
  };
  for (const [key, val] of Object.entries(abbrevs)) {
    if (normalized.startsWith(key)) return val;
  }
  return str;
};

const App: React.FC = () => {
  const [view, setView] = useState<ViewType>('report-upload');
  
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
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (e) { return new Set(); }
  });

  const [selectedMarketFilter, setSelectedMarketFilter] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.MARKET) || 'All';
    } catch (e) { return 'All'; }
  });

  const [activeSegment, setActiveSegment] = useState<SegmentFilter>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEYS.SEGMENT) as SegmentFilter) || 'ALL';
    } catch (e) { return 'ALL'; }
  });

  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiUserPrompt, setAiUserPrompt] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [isPasting, setIsPasting] = useState(false);
  const [importStaging, setImportStaging] = useState<ImportStaging | null>(null);
  const [activeUploadMonth, setActiveUploadMonth] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [aiAnalysis]);

  const populatedMonths = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (MONTHS.includes(norm)) set.add(norm);
    });
    return set;
  }, [records]);

  const marketList = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      if (r.marketName) set.add(r.marketName);
    });
    return Array.from(set).sort();
  }, [records]);

  const isColdFood = useCallback((record: ShrinkRecord) => {
    const coldRegex = /^(KF|F|B|MG)(\s+|-|$)/i;
    return coldRegex.test(record.itemNumber) || coldRegex.test(record.itemName);
  }, []);

  const timelineStats = useMemo(() => {
    const stats: Record<string, { shrinkRate: number; overage: number; revenue: number; shrink: number; trend: number | null }> = {};
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (!MONTHS.includes(norm)) return;
      if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return;
      if (activeSegment === 'COLD' && !isColdFood(r)) return;
      if (activeSegment === 'SODA_SNACK' && isColdFood(r)) return;

      if (!stats[norm]) stats[norm] = { shrinkRate: 0, overage: 0, revenue: 0, shrink: 0, trend: null };
      stats[norm].revenue += r.totalRevenue || 0;
      stats[norm].shrink += r.shrinkLoss || 0;
      if (r.invVariance > 0) stats[norm].overage += (r.invVariance * r.unitCost);
    });

    let lastRate: number | null = null;
    MONTHS.forEach(m => {
      if (stats[m]) {
        stats[m].shrinkRate = stats[m].revenue > 0 ? (stats[m].shrink / stats[m].revenue) * 100 : 0;
        if (lastRate !== null) stats[m].trend = stats[m].shrinkRate - lastRate;
        lastRate = stats[m].shrinkRate;
      }
    });
    return stats;
  }, [records, selectedMarketFilter, activeSegment, isColdFood]);

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const normPeriod = normalizePeriod(r.period);
      if (!selectedMonths.has(normPeriod)) return false;
      if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return false;
      if (activeSegment === 'COLD' && !isColdFood(r)) return false;
      if (activeSegment === 'SODA_SNACK' && isColdFood(r)) return false;
      return true;
    });
  }, [records, selectedMonths, selectedMarketFilter, activeSegment, isColdFood]);

  const stats = useMemo(() => {
    if (filteredRecords.length === 0) return { totalShrink: 0, totalRevenue: 0, totalOverage: 0, accuracy: 100, highImpactItem: 'N/A' };
    let totalShrink = 0, totalRevenue = 0, totalOverage = 0;
    const itemLossMap: Record<string, number> = {};
    filteredRecords.forEach(rec => {
      totalShrink += rec.shrinkLoss || 0;
      totalRevenue += rec.totalRevenue || 0;
      if (rec.invVariance > 0) totalOverage += (rec.invVariance * rec.unitCost);
      const key = `${rec.itemNumber} - ${rec.itemName}`;
      itemLossMap[key] = (itemLossMap[key] || 0) + rec.shrinkLoss;
    });
    const shrinkRate = totalRevenue !== 0 ? (totalShrink / totalRevenue) : 0;
    const highImpact = Object.entries(itemLossMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    return {
      totalShrink, totalRevenue, totalOverage,
      accuracy: Number((Math.max(0, 100 - (shrinkRate * 100))).toFixed(1)),
      highImpactItem: highImpact !== 'N/A' ? (highImpact.split(' - ')[1] || highImpact) : 'N/A'
    };
  }, [filteredRecords]);

  const cleanNumeric = useCallback((val: any): number => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val || typeof val !== 'string') return 0;
    const cleaned = val.replace(/[$,()]/g, '');
    const num = parseFloat(cleaned);
    const isNegative = val.includes('(') || val.includes('-');
    return isNaN(num) ? 0 : num * (isNegative ? -1 : 1);
  }, []);

  const processRecordsBatch = useCallback((rows: any[], marketName: string, timestamp: number, period: string): ShrinkRecord[] => {
    const coldRegex = /^(KF|F|B|MG)(\s+|-|$)/i;
    const normPeriod = normalizePeriod(period);
    return rows.map((row, i) => {
      if (!row) return null;
      let id, name, invVar, rev, sold, price, loss, cost, profit;
      if (Array.isArray(row)) {
        if (row.length < 2) return null;
        [id, name, invVar, rev, sold, price, loss, cost, profit] = row;
      } else {
        id = row['Item#'] || row['Item Number'] || Object.values(row)[0];
        name = row['Item Name'] || row['Description'] || Object.values(row)[1];
        invVar = row['Inv Variance'] || row['Variance'] || row['Inv Var'];
        rev = row['Total Revenue'] || row['Revenue'];
        sold = row['Sold Qty'] || row['Quantity Sold'];
        loss = row['Shrink Loss'] || row['Loss'];
        cost = row['Unit Cost'];
      }
      const itemIDStr = String(id || '').trim();
      if (!itemIDStr || itemIDStr.toLowerCase().includes('total')) return null;
      return {
        id: `rec-${i}-${timestamp}-${Math.random().toString(36).substr(2, 5)}`,
        itemNumber: itemIDStr,
        itemName: String(name || 'Unnamed Item').trim(),
        invVariance: cleanNumeric(invVar),
        totalRevenue: cleanNumeric(rev),
        soldQty: cleanNumeric(sold),
        salePrice: cleanNumeric(price),
        shrinkLoss: Math.abs(cleanNumeric(loss)),
        unitCost: cleanNumeric(cost),
        itemProfit: cleanNumeric(profit),
        category: (coldRegex.test(itemIDStr) || coldRegex.test(String(name))) ? 'Cold Food' : 'General',
        marketName: marketName || 'Default Market',
        period: normPeriod
      };
    }).filter(r => r !== null) as ShrinkRecord[];
  }, [cleanNumeric]);

  const commitImport = () => {
    if (!importStaging) return;
    const { records: stagedRecords, period } = importStaging;
    const normPeriod = normalizePeriod(period);
    setRecords(prev => {
      const filtered = prev.filter(r => normalizePeriod(r.period) !== normPeriod);
      const newRecords = stagedRecords.map((item, i) => ({ ...item, id: `imp-${i}-${Date.now()}`, period: normPeriod } as ShrinkRecord));
      return [...filtered, ...newRecords];
    });
    setSelectedMonths(prev => { const next = new Set(prev); next.add(normPeriod); return next; });
    setImportStaging(null);
    setView('dashboard');
  };

  const handleFileUpload = (file: File, targetedMonth?: string) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        let allExtractedRecords: Partial<ShrinkRecord>[] = [];
        let detectedMarkets = new Set<string>();
        let finalPeriod = targetedMonth || '';
        workbook.SheetNames.forEach((sheetName) => {
          try {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
            if (!jsonData || jsonData.length < 1) return;
            const row2 = jsonData[2] as any[];
            const row3 = jsonData[3] as any[];
            let sheetMarketName = ((row2?.[0] || '') + ' ' + (row3?.[0] || '')).trim().replace(/^market:?\s+/gi, '').trim() || sheetName;
            detectedMarkets.add(sheetMarketName);
            const dataStartIndex = jsonData.findIndex((row: any) => Array.isArray(row) && row.length >= 2 && (String(row[0]).toLowerCase().includes('item') || !isNaN(parseFloat(row[0]))));
            if (dataStartIndex > -1) allExtractedRecords = [...allExtractedRecords, ...processRecordsBatch(jsonData.slice(dataStartIndex), sheetMarketName, Date.now(), finalPeriod || 'Current')];
          } catch(err) {}
        });
        if (!finalPeriod) finalPeriod = normalizePeriod(new Date().toLocaleString('default', { month: 'long' }));
        setImportStaging({ records: allExtractedRecords, marketNames: Array.from(detectedMarkets), period: finalPeriod });
        setIsProcessing(false);
      } catch (err) { alert("Format Error"); setIsProcessing(false); }
    };
    reader.readAsArrayBuffer(file);
  };

  const toggleMonthSelection = (month: string) => {
    setSelectedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const handleRunAI = async (customPrompt?: string) => {
    const question = customPrompt || aiUserPrompt;
    if (!question.trim() || filteredRecords.length === 0 || isAnalyzing) return;
    
    setIsAnalyzing(true);
    setAiAnalysis('');
    setAiUserPrompt('');
    setView('ai-insights');
    
    await queryMarketAI(filteredRecords, { 
      totalRevenue: stats.totalRevenue,
      totalShrink: stats.totalShrink,
      accuracy: stats.accuracy,
      overageTotal: stats.totalOverage, 
      activeContext: activeSegment === 'SODA_SNACK' ? 'Soda & Snack' : activeSegment 
    }, question, (text) => setAiAnalysis(text));
    
    setIsAnalyzing(false);
  };

  const removeMonthData = (month: string) => {
    if (confirm(`Remove all data for ${month}?`)) {
      setRecords(prev => prev.filter(r => normalizePeriod(r.period) !== month));
      setSelectedMonths(prev => { const next = new Set(prev); next.delete(month); return next; });
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      <aside className="w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex flex-col shrink-0 z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-black">S</div>
            ShrinkGuard AI
          </h1>
          <div className="mt-4 flex items-center gap-2 px-2 py-1 bg-white/5 rounded-lg">
             <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
             <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vault: {records.length} Records</span>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          <button onClick={() => setView('report-upload')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${view === 'report-upload' ? 'bg-slate-800 text-white shadow-lg' : 'hover:bg-slate-800'}`}><Icons.Upload /> Import</button>
          <button onClick={() => setView('dashboard')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${view === 'dashboard' ? 'bg-slate-800 text-white shadow-lg' : 'hover:bg-slate-800 disabled:opacity-30'}`}><Icons.Dashboard /> Analytics</button>
          <button onClick={() => setView('ai-insights')} disabled={records.length === 0} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${view === 'ai-insights' ? 'bg-slate-800 text-white shadow-lg' : 'hover:bg-slate-800 disabled:opacity-30'}`}><Icons.AI /> AI Chat</button>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <p className="text-[9px] font-black text-slate-500 uppercase text-center tracking-widest leading-relaxed">Forensic Audit Tooling<br/>Powered by Gemini Flash</p>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        {importStaging && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md">
            <div className="bg-white w-full max-w-xl rounded-[3rem] shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-300">
               <div className="p-10 border-b border-slate-100 bg-slate-50/50">
                 <h3 className="text-2xl font-black text-slate-900">Confirm Workbook Import</h3>
                 <p className="text-slate-500 text-sm font-medium">Data will be stored under <b>{importStaging.period}</b>.</p>
               </div>
               <div className="p-10 space-y-8">
                  <select value={importStaging.period} onChange={(e) => setImportStaging({...importStaging, period: e.target.value})} className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold outline-none focus:border-indigo-500 transition-all">
                    {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 max-h-40 overflow-y-auto">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Detected Markets ({importStaging.marketNames.length})</p>
                    <div className="flex flex-wrap gap-2">{importStaging.marketNames.map(name => <span key={name} className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-xl text-[10px] font-black border border-indigo-100">{name}</span>)}</div>
                  </div>
                  <div className="flex gap-4">
                     <button onClick={() => setImportStaging(null)} className="flex-1 py-5 rounded-2xl font-black text-slate-500 hover:bg-slate-100 uppercase tracking-widest text-xs">Cancel</button>
                     <button onClick={commitImport} className="flex-[2] bg-indigo-600 text-white py-5 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-indigo-700 shadow-xl transition-all">Confirm Import</button>
                  </div>
               </div>
            </div>
          </div>
        )}

        {showPasteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md">
            <div className="bg-white w-full max-w-3xl rounded-[3rem] shadow-2xl overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-300">
              <div className="p-10 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">AI Smart Paste</h3>
                <button onClick={() => setShowPasteModal(false)} className="w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-400">✕</button>
              </div>
              <div className="p-10">
                <textarea value={pasteValue} onChange={(e) => setPasteValue(e.target.value)} placeholder="Paste report text..." className="w-full h-64 bg-slate-50 border-2 border-slate-100 rounded-3xl p-6 text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all resize-none shadow-inner" />
                <div className="mt-8">
                  <button onClick={async () => {
                    setIsPasting(true);
                    const result = await parseRawReportText(pasteValue);
                    if (result.records.length > 0) setImportStaging({ records: result.records, marketNames: [result.detectedMarket || 'Imported Market'], period: normalizePeriod(result.detectedPeriod || new Date().toLocaleString('default', { month: 'long' })) });
                    setShowPasteModal(false); setPasteValue(''); setIsPasting(false);
                  }} disabled={isPasting || !pasteValue} className="w-full bg-indigo-600 text-white py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3">
                    {isPasting ? "Processing..." : "Import Text"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="p-10">
          <div className="mb-10">
            <div className="flex items-center justify-between mb-6 px-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Audit Timeline & Comparison</h3>
              <div className="flex gap-4">
                <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full uppercase tracking-widest">{selectedMonths.size} Active Periods</span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-3">
              {MONTHS.map((month) => {
                const stats = timelineStats[month];
                const isPopulated = populatedMonths.has(month);
                const isSelected = selectedMonths.has(month);
                const trend = stats?.trend;
                const trendColor = trend !== null ? (trend < 0 ? 'text-emerald-500' : trend > 0 ? 'text-red-500' : 'text-slate-400') : 'text-slate-400';

                return (
                  <div 
                    key={month} 
                    onClick={() => isPopulated ? toggleMonthSelection(month) : (setActiveUploadMonth(month), fileInputRef.current?.click())} 
                    className={`relative h-44 group flex flex-col items-center justify-start py-4 px-2 rounded-3xl transition-all cursor-pointer border-2 shadow-sm ${isPopulated ? isSelected ? 'bg-white border-emerald-500 shadow-emerald-200' : 'bg-white border-slate-100' : 'bg-white border-slate-200 border-dashed hover:border-indigo-400 hover:bg-indigo-50/30'}`}
                  >
                    <span className={`text-[10px] font-black uppercase mb-3 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`}>{month.substring(0, 3)}</span>
                    <div className="mb-4">
                      {isPopulated ? (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all ${isSelected ? 'bg-emerald-600 text-white scale-110 shadow-lg shadow-emerald-200' : 'bg-emerald-50 text-emerald-400 border border-emerald-100'}`}>{isSelected ? '✓' : '○'}</div>
                      ) : (
                        <div className="text-slate-300 group-hover:text-indigo-500 transition-colors"><Icons.Upload /></div>
                      )}
                    </div>
                    {isPopulated && (
                      <div className="w-full space-y-2 mt-auto border-t border-slate-50 pt-3">
                        <div className="text-center">
                          <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-0.5">Shrink</p>
                          <p className={`text-xs font-black ${isSelected ? 'text-slate-900' : 'text-slate-500'}`}>{stats.shrinkRate.toFixed(1)}%</p>
                        </div>
                        {trend !== null && <div className={`text-[9px] font-black text-center ${trendColor}`}>{trend > 0 ? '+' : ''}{trend.toFixed(1)}%</div>}
                        <div className="text-center">
                          <p className="text-[8px] font-black text-slate-400 uppercase leading-none mb-0.5">Over</p>
                          <p className="text-[10px] font-bold text-slate-500">${Math.round(stats.overage).toLocaleString()}</p>
                        </div>
                      </div>
                    )}
                    {isPopulated && (
                      <button onClick={(e) => { e.stopPropagation(); removeMonthData(month); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10">✕</button>
                    )}
                  </div>
                );
              })}
            </div>
            <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFileUpload(e.target.files[0], activeUploadMonth || undefined); setActiveUploadMonth(null); }} />
          </div>

          {!isProcessing && view === 'report-upload' ? (
            <div className="max-w-4xl mx-auto py-20 text-center">
              <h2 className="text-6xl font-black text-slate-900 mb-6 tracking-tighter">Inventory Audit Hub</h2>
              <p className="text-slate-500 text-xl font-medium mb-12">Select a month above or drop a Cantaloupe Seed workbook here.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div onClick={() => fileInputRef.current?.click()} className="bg-white border-2 border-slate-100 p-12 rounded-[4rem] flex flex-col items-center gap-6 shadow-sm hover:border-indigo-400 cursor-pointer transition-all hover:-translate-y-1"><Icons.FileExcel /><p className="text-2xl font-black text-slate-900">Upload Excel</p></div>
                 <div onClick={() => setShowPasteModal(true)} className="bg-white border-2 border-slate-100 p-12 rounded-[4rem] flex flex-col items-center gap-6 shadow-sm hover:border-indigo-400 cursor-pointer transition-all hover:-translate-y-1"><Icons.AI /><p className="text-2xl font-black text-slate-900">AI Paste Import</p></div>
              </div>
            </div>
          ) : !isProcessing && (
            <div className="animate-in fade-in duration-500">
              <header className="mb-10 flex flex-col lg:flex-row justify-between lg:items-end gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${activeSegment === 'COLD' ? 'bg-blue-100 text-blue-700' : activeSegment === 'SODA_SNACK' ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-700'}`}>
                      {activeSegment === 'ALL' ? 'Full Portfolio' : activeSegment === 'COLD' ? 'Cold Food Section' : 'Soda & Snack Portfolio'}
                    </span>
                  </div>
                  <h2 className="text-5xl font-black text-slate-900 tracking-tighter">{selectedMarketFilter === 'All' ? 'Consolidated' : selectedMarketFilter} Audit</h2>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="bg-slate-200/50 p-2 rounded-2xl flex gap-1">
                    {(['ALL', 'SODA_SNACK', 'COLD'] as SegmentFilter[]).map((type) => (
                      <button key={type} onClick={() => setActiveSegment(type)} className={`px-6 py-3 rounded-xl text-[10px] font-black transition-all uppercase tracking-widest ${activeSegment === type ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{type === 'SODA_SNACK' ? 'SODA & SNACK' : type}</button>
                    ))}
                  </div>
                  <select value={selectedMarketFilter} onChange={(e) => setSelectedMarketFilter(e.target.value)} className="bg-white border border-slate-200 rounded-2xl px-8 py-4 text-xs font-black shadow-sm outline-none tracking-widest uppercase">
                    <option value="All">All Markets</option>
                    {marketList.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </header>

              {filteredRecords.length > 0 && view === 'dashboard' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200">
                      <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-4">Inventory Shrink</p>
                      <p className="text-4xl font-black tracking-tighter">${stats.totalShrink.toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">Financial Liability</p>
                    </div>
                    <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-4">Audit Overage</p>
                      <p className="text-4xl font-black tracking-tighter">${stats.totalOverage.toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase">Likely Receiving Error</p>
                    </div>
                    <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200">
                      <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-4">Accuracy Score</p>
                      <p className="text-4xl font-black tracking-tighter">{stats.accuracy}%</p>
                      <div className="mt-2 bg-slate-100 h-1.5 rounded-full overflow-hidden"><div className="bg-orange-400 h-full transition-all" style={{width: `${stats.accuracy}%`}} /></div>
                    </div>
                    <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-200">
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Highest Impact</p>
                      <p className="text-lg font-black leading-tight line-clamp-2">{stats.highImpactItem}</p>
                    </div>
                  </div>
                  <AnalysisCharts data={filteredRecords} />
                </>
              )}

              {filteredRecords.length === 0 && view !== 'report-upload' && (
                <div className="flex flex-col items-center justify-center py-40 text-slate-300">
                  <Icons.Alert /><p className="text-xl font-black uppercase tracking-widest mt-6">No Data for Selection</p>
                  <p className="text-sm font-medium mt-2">Activate months in the timeline above.</p>
                </div>
              )}

              {view === 'ai-insights' && (
                <div className="max-w-5xl mx-auto pb-20 animate-in slide-in-from-bottom-5">
                  <div className="bg-white rounded-[4rem] border border-slate-200 shadow-2xl overflow-hidden min-h-[700px] flex flex-col">
                    <div className="bg-slate-900 p-8 text-white flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-indigo-500 rounded-2xl flex items-center justify-center text-white"><Icons.AI /></div>
                        <div>
                          <h3 className="text-xl font-black tracking-tight">Forensic AI Assistant</h3>
                          <p className="text-slate-400 text-[9px] font-bold uppercase tracking-widest">Interactive Audit Intelligence</p>
                        </div>
                      </div>
                      <button onClick={() => setView('dashboard')} className="px-5 py-2 hover:bg-white/10 rounded-xl font-bold text-[10px] uppercase transition-all border border-white/20">Return to Charts</button>
                    </div>
                    
                    <div className="flex-1 flex flex-col lg:flex-row">
                      {/* Side Suggestions */}
                      <div className="lg:w-80 bg-slate-50 border-r border-slate-100 p-8 space-y-4">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Quick Audits</h4>
                        {SUGGESTED_QUESTIONS.map((q, i) => (
                          <button key={i} onClick={() => handleRunAI(q)} disabled={isAnalyzing} className="w-full text-left bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:border-indigo-400 hover:shadow-md transition-all text-xs font-bold text-slate-600 leading-relaxed group">
                            <div className="flex gap-3">
                              <span className="text-indigo-400 font-black">Q.</span>
                              {q}
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Main Interaction Area */}
                      <div className="flex-1 flex flex-col">
                        <div ref={scrollRef} className="p-12 flex-1 overflow-y-auto custom-scrollbar bg-white relative">
                          {aiAnalysis ? (
                            <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed font-medium bg-slate-50/50 p-10 rounded-[3rem] border border-slate-100 animate-in fade-in duration-500">
                              {aiAnalysis}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-32 text-center opacity-50">
                              <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-6"><Icons.AI /></div>
                              <h4 className="text-lg font-black text-slate-900 mb-1">Cantaloupe Seed Intelligence Ready</h4>
                              <p className="text-slate-400 text-sm max-w-sm">Ask me about your market shrinkage, identify operational leaks, or find receiving anomalies.</p>
                            </div>
                          )}
                          {isAnalyzing && (
                            <div className="mt-8 flex gap-4 items-center bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100 animate-pulse">
                               <div className="animate-spin h-5 w-5 border-2 border-indigo-600 border-t-transparent rounded-full" />
                               <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Performing Forensic Calculation...</span>
                            </div>
                          )}
                        </div>

                        <div className="p-10 bg-slate-50/80 border-t border-slate-100">
                          <div className="relative group">
                            <input 
                              type="text" 
                              value={aiUserPrompt} 
                              onChange={(e) => setAiUserPrompt(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleRunAI()}
                              placeholder="Ask anything about your current data view..."
                              className="w-full bg-white border-2 border-slate-200 group-focus-within:border-indigo-500 rounded-[2.5rem] px-10 py-6 text-sm font-semibold outline-none transition-all pr-24 shadow-lg shadow-slate-200/50"
                            />
                            <button 
                              onClick={() => handleRunAI()} 
                              disabled={isAnalyzing || !aiUserPrompt.trim()}
                              className="absolute right-4 top-4 w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 disabled:bg-slate-300 transition-all hover:-translate-y-0.5"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                            </button>
                          </div>
                          <p className="text-[9px] text-slate-400 mt-4 text-center font-bold uppercase tracking-widest">Analyzing {filteredRecords.length} Active Audit Records</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
