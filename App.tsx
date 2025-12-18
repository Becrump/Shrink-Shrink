
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
  RECORDS: 'shrink_records_v5',
  MONTHS: 'shrink_months_v5',
  MARKET: 'shrink_market_v5',
  SEGMENT: 'shrink_segment_v5'
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
  const [isKeyActive, setIsKeyActive] = useState<boolean>(false);
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{browserKey: string, workerData: any} | null>(null);
  
  const checkKey = useCallback(() => {
    const key = window.process?.env?.API_KEY;
    const isValid = !!(key && key.length > 10 && key !== '%%API_KEY_INJECTION%%' && key !== 'undefined' && key !== 'MISSING_IN_WORKER');
    setIsKeyActive(isValid);
    return isValid;
  }, []);

  const openIntegrityCheck = async () => {
    try {
      const res = await fetch('/api/debug-env');
      const workerData = await res.json();
      const browserKey = window.process?.env?.API_KEY || "undefined";
      setSystemInfo({ browserKey, workerData });
      setShowSystemDetails(true);
    } catch (e) {
      setSystemInfo({ browserKey: window.process?.env?.API_KEY || "undefined", workerData: { error: "Failed to reach Worker diagnostic endpoint" } });
      setShowSystemDetails(true);
    }
  };

  useEffect(() => {
    const interval = setInterval(checkKey, 2000);
    checkKey();
    return () => clearInterval(interval);
  }, [checkKey]);

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
      if (MONTHS.includes(norm)) set.add(norm);
    });
    return set;
  }, [records]);

  const timelineStats = useMemo(() => {
    const ts: Record<string, { shrink: number; revenue: number }> = {};
    records.forEach(r => {
      const norm = normalizePeriod(r.period);
      if (!ts[norm]) ts[norm] = { shrink: 0, revenue: 0 };
      const impact = (r.invVariance * (r.unitCost || 0));
      if (impact < 0) ts[norm].shrink += Math.abs(impact);
      ts[norm].revenue += r.totalRevenue || 0;
    });
    return ts;
  }, [records]);

  const stats = useMemo(() => {
    const filtered = records.filter(r => {
      const normPeriod = normalizePeriod(r.period);
      if (selectedMonths.size > 0 && !selectedMonths.has(normPeriod)) return false;
      if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return false;
      return true;
    });

    if (filtered.length === 0) return { totalShrink: 0, totalRevenue: 0, totalOverage: 0, netVariance: 0, accuracy: 100, count: 0 };
    
    let totalShrink = 0, totalRevenue = 0, totalOverage = 0;
    filtered.forEach(rec => {
      totalRevenue += rec.totalRevenue || 0;
      const impact = rec.invVariance * (rec.unitCost || 0);
      if (impact < 0) totalShrink += Math.abs(impact);
      else if (impact > 0) totalOverage += impact;
    });
    const netVariance = totalOverage - totalShrink;
    const accuracy = totalRevenue > 0 ? (1 - (totalShrink / totalRevenue)) * 100 : 100;
    return {
      totalShrink, totalRevenue, totalOverage, netVariance,
      accuracy: Number(Math.max(0, accuracy).toFixed(2)),
      count: filtered.length
    };
  }, [records, selectedMonths, selectedMarketFilter]);

  const handleRunQuickAI = async (customPrompt?: string) => {
    const question = customPrompt || aiUserPrompt;
    if (!question.trim() || records.length === 0 || isQuickAnalyzing) return;
    setIsQuickAnalyzing(true);
    setActiveChip(customPrompt || 'custom');
    setQuickAiText('');
    setAiUserPrompt('');
    setView('ai-insights');
    try {
      await queryMarketAIQuick(records, stats, question, (text) => {
        if (text === "AUTH_REQUIRED") {
          setIsKeyActive(false);
          setQuickAiText("DIAGNOSTIC ENGINE OFFLINE. Injected key mismatch.");
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
    if (deepDiveStatus === 'analyzing' || records.length === 0) return;
    setDeepDiveStatus('analyzing');
    queryMarketAIDeep(records, stats).then(result => {
      if (result === "AUTH_REQUIRED") {
        setIsKeyActive(false);
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
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          if (!jsonData || jsonData.length < 5) return;
          const locationVal = (jsonData[2] as any[])?.[0] || '';
          const marketVal = (jsonData[3] as any[])?.[0] || '';
          const cleanName = humanizeMarketName(String(marketVal || locationVal || sheetName));
          if (!humanMarketNames.includes(cleanName)) humanMarketNames.push(cleanName);
          let colMap = { itemNum: 0, itemName: 1, variance: 2, revenue: 3, soldQty: 4, salePrice: 5, itemCost: 7 };
          let headerRowIndex = -1;
          for (let i = 0; i < Math.min(jsonData.length, 50); i++) {
            const row = jsonData[i] as any[];
            if (!row) continue;
            const rowStr = row.join('|').toLowerCase();
            if (rowStr.includes('variance') || rowStr.includes('revenue')) {
              headerRowIndex = i;
              row.forEach((cell, idx) => {
                const s = String(cell || '').toLowerCase().trim();
                if (s.includes('number') || s.includes('code')) colMap.itemNum = idx;
                else if (s === 'item' || s === 'description') colMap.itemName = idx;
                else if (s.includes('variance')) colMap.variance = idx;
                else if (s.includes('revenue')) colMap.revenue = idx;
                else if (s.includes('cost')) colMap.itemCost = idx;
              });
              break;
            }
          }
          if (headerRowIndex === -1) return;
          jsonData.slice(headerRowIndex + 1).forEach((row: any) => {
            const invVar = parseFloat(row[colMap.variance]) || 0;
            if (Math.abs(invVar) < 0.001) return;
            const cost = parseFloat(row[colMap.itemCost]) || 0;
            allExtractedRecords.push({
              itemNumber: String(row[colMap.itemNum] || ''),
              itemName: String(row[colMap.itemName] || ''),
              invVariance: invVar,
              totalRevenue: parseFloat(row[colMap.revenue]) || 0,
              shrinkLoss: invVar < 0 ? Math.abs(invVar * cost) : 0,
              unitCost: cost,
              marketName: cleanName,
              period: targetedMonth || 'Current'
            });
          });
        });
        setImportStaging({ records: allExtractedRecords, marketNames: humanMarketNames, period: targetedMonth || 'Current', detectedColumns: [] });
      } finally { setIsProcessing(false); }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-slate-900/70 backdrop-blur-xl flex items-center justify-center animate-in fade-in duration-300">
           <div className="bg-white p-12 rounded-[4rem] shadow-2xl flex flex-col items-center gap-8 border border-slate-200">
              <div className="w-24 h-24 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">{processingStatus}</p>
           </div>
        </div>
      )}

      {showSystemDetails && systemInfo && (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-300">
           <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-[3rem] p-12 text-slate-300 shadow-2xl overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-8">
                 <h2 className="text-2xl font-black text-white tracking-tighter uppercase">System Integrity Hub</h2>
                 <button onClick={() => setShowSystemDetails(false)} className="text-slate-500 hover:text-white text-2xl">✕</button>
              </div>
              <div className="space-y-8 flex-1 overflow-y-auto custom-scrollbar pr-4">
                 <div className="bg-black/40 p-8 rounded-3xl border border-slate-800">
                    <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest mb-4">Client Environment (Browser)</h3>
                    <div className="font-mono text-xs break-all space-y-2">
                       <p><span className="text-slate-500">process.env.API_KEY:</span> <span className={systemInfo.browserKey.length > 20 ? 'text-emerald-400' : 'text-red-400'}>{systemInfo.browserKey.length > 10 ? `${systemInfo.browserKey.substring(0, 6)}...${systemInfo.browserKey.substring(systemInfo.browserKey.length - 4)}` : systemInfo.browserKey}</span></p>
                       <p><span className="text-slate-500">Length:</span> {systemInfo.browserKey.length}</p>
                    </div>
                 </div>
                 <div className="bg-black/40 p-8 rounded-3xl border border-slate-800">
                    <h3 className="text-indigo-400 font-black text-[10px] uppercase tracking-widest mb-4">Worker Environment (Cloudflare)</h3>
                    <div className="font-mono text-xs break-all">
                       <pre>{JSON.stringify(systemInfo.workerData, null, 2)}</pre>
                    </div>
                 </div>
              </div>
              <div className="mt-8 pt-8 border-t border-slate-800 flex justify-between items-center">
                 <p className="text-[10px] text-slate-500 font-bold max-w-xs uppercase leading-relaxed">If the Browser Key shows '%%API_KEY_INJECTION%%', the Worker injection is being bypassed by a cache.</p>
                 <button onClick={() => window.location.reload()} className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase shadow-xl hover:bg-indigo-700 transition-all">Force Refresh</button>
              </div>
           </div>
        </div>
      )}

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
                <div className="text-[7px] leading-tight opacity-70">Check Integrity Details</div>
              </button>
            ) : (
              <button onClick={openIntegrityCheck} className="w-full flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[9px] font-black uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Diagnostic Engine Active
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
        {importStaging && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-xl">
            <div className="bg-white w-full max-w-xl rounded-[4rem] shadow-2xl p-12 border border-slate-200">
               <h3 className="text-3xl font-black mb-6 tracking-tighter">Audit Required</h3>
               <p className="text-slate-500 mb-10 text-sm font-medium leading-relaxed">Found <span className="font-black text-indigo-600">{importStaging.records.length} forensic variances</span> across {importStaging.marketNames.length} markets.</p>
               <div className="flex gap-4">
                  <button onClick={() => setImportStaging(null)} className="flex-1 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px]">Discard</button>
                  <button onClick={() => {
                    const newRecords = importStaging.records.map((r, i) => ({ ...r, id: `imp-${i}-${Date.now()}` } as ShrinkRecord));
                    setRecords(prev => [...prev.filter(r => normalizePeriod(r.period) !== importStaging.period), ...newRecords]);
                    setSelectedMonths(prev => new Set(prev).add(normalizePeriod(importStaging.period)));
                    setImportStaging(null);
                    setView('dashboard');
                  }} className="flex-[2] bg-indigo-600 text-white py-5 rounded-3xl font-black shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all uppercase tracking-widest text-xs">Commit To History</button>
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
                <div key={m} onClick={() => isPopulated ? setSelectedMonths(prev => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n; }) : (setActiveUploadMonth(m), fileInputRef.current?.click())} 
                     className={`flex-shrink-0 w-44 h-60 rounded-[3rem] border-2 flex flex-col items-center justify-between p-6 cursor-pointer transition-all duration-300 group ${isSelected ? 'bg-white border-indigo-500 shadow-2xl scale-105 z-10' : isPopulated ? 'bg-white border-slate-100 hover:border-indigo-200 shadow-xl' : 'bg-slate-100 border-dashed border-slate-300 opacity-60 hover:opacity-100'}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{m}</span>
                  {isPopulated ? (
                    <div className="w-full space-y-2 pt-2 border-t border-slate-50">
                        <div className="flex justify-between items-center text-[9px] font-black">
                          <span className="text-slate-400 uppercase">Loss</span>
                          <span className="text-red-500">-${Math.round(mStats?.shrink || 0).toLocaleString()}</span>
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

          {view === 'dashboard' && records.length > 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-5 duration-700">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Gross Shrink</p>
                    <p className="text-5xl font-black text-red-500 tracking-tighter">-${stats.totalShrink.toLocaleString()}</p>
                 </div>
                 <div className="bg-white p-12 rounded-[4rem] shadow-sm border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-4 tracking-widest">Integrity</p>
                    <p className="text-5xl font-black text-slate-900 tracking-tighter">{stats.accuracy}%</p>
                 </div>
              </div>
              <AnalysisCharts data={records.filter(r => {
                const normPeriod = normalizePeriod(r.period);
                if (selectedMonths.size > 0 && !selectedMonths.has(normPeriod)) return false;
                if (selectedMarketFilter !== 'All' && r.marketName !== selectedMarketFilter) return false;
                return true;
              })} />
            </div>
          )}

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
                    <button onClick={startDeepDive} className={`w-full p-10 rounded-[3rem] border-2 transition-all ${deepDiveStatus === 'analyzing' ? 'bg-indigo-50 border-indigo-200 cursor-wait' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                      <div className="text-5xl mb-4">🩺</div>
                      <span className="font-black uppercase tracking-tighter text-base">Full Forensic Audit</span>
                    </button>
                    <div className="flex flex-col gap-4">
                        {SUGGESTED_QUESTIONS.map((q, idx) => (
                          <button key={idx} onClick={() => handleRunQuickAI(q)} className="text-left p-5 rounded-3xl border text-[11px] font-bold uppercase tracking-widest bg-white hover:border-indigo-400 transition-all">
                            {q}
                          </button>
                        ))}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col bg-white">
                    <div ref={scrollRef} className="flex-1 p-16 overflow-y-auto bg-white custom-scrollbar">
                       {quickAiText ? (
                         <div className="prose prose-indigo max-w-none font-medium text-slate-700 whitespace-pre-wrap leading-relaxed animate-in fade-in slide-in-from-bottom-6">
                           {quickAiText}
                         </div>
                       ) : <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-40 uppercase font-black text-center px-12 leading-relaxed">Select a forensic logic scope or start a full audit.</div>}
                    </div>
                    <div className="p-16 bg-slate-50/50 border-t border-slate-200">
                      <div className="relative group max-w-4xl mx-auto">
                        <input type="text" value={aiUserPrompt} onChange={(e) => setAiUserPrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRunQuickAI()} placeholder="Ask about variances..." className="w-full bg-white border-4 border-slate-200 rounded-[3rem] px-14 py-8 text-base font-bold outline-none pr-32 shadow-2xl" />
                        <button onClick={() => handleRunQuickAI()} disabled={!aiUserPrompt.trim()} className="absolute right-6 top-6 w-16 h-16 bg-indigo-600 text-white rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-indigo-200">
                          <Icons.AI />
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
