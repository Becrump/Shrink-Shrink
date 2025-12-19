import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, LineChart, Line
} from 'recharts';
import { ShrinkRecord } from '../types';

interface ChartsProps {
  data: ShrinkRecord[];
  allRecords: ShrinkRecord[];
  onItemAnalysis: (item: string, type: 'shrink' | 'overage') => void;
}

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Helper to identify "Fresh" items subject to Receiving/Tablet errors
const isColdFood = (name: string, code: string) => {
  const coldPrefixRegex = /^(KF|F\s|B\s)/i;
  return coldPrefixRegex.test(code) || coldPrefixRegex.test(name);
};

export const AnalysisCharts: React.FC<ChartsProps> = ({ data, allRecords, onItemAnalysis }) => {
  // 1. Trend Analysis (Month over Month)
  const trendData = React.useMemo(() => {
    const periods: Record<string, { period: string; shrink: number; revenue: number; net: number }> = {};
    data.forEach(r => {
      if (!periods[r.period]) periods[r.period] = { period: r.period, shrink: 0, revenue: 0, net: 0 };
      
      periods[r.period].revenue += r.totalRevenue || 0;
      periods[r.period].shrink += r.shrinkLoss || 0;
      periods[r.period].net += (r.overageGain || 0) - (r.shrinkLoss || 0);
    });

    return Object.values(periods)
      .sort((a, b) => MONTH_ORDER.indexOf(a.period) - MONTH_ORDER.indexOf(b.period))
      .map(p => ({
        ...p,
        shrinkRate: p.revenue > 0 ? Number(((p.shrink / p.revenue) * 100).toFixed(2)) : 0
      }));
  }, [data]);

  // 2. Overage vs Shortage Impact ($)
  const varianceImpact = React.useMemo(() => {
    const markets: Record<string, { name: string; shortage: number; overage: number }> = {};
    data.forEach(r => {
      if (!markets[r.marketName]) markets[r.marketName] = { name: r.marketName, shortage: 0, overage: 0 };
      markets[r.marketName].shortage += r.shrinkLoss || 0;
      markets[r.marketName].overage += r.overageGain || 0;
    });
    return Object.values(markets).sort((a, b) => (b.shortage + b.overage) - (a.shortage + a.overage)).slice(0, 10);
  }, [data]);

  // 3. Itemized Leaderboards
  const itemLeaderboards = React.useMemo(() => {
    const shrinkMap: Record<string, number> = {};
    const overageMap: Record<string, number> = {};

    data.forEach(r => {
      const shrinkVal = r.shrinkLoss || 0;
      const overageVal = r.overageGain || 0;
      
      if (shrinkVal > 0) shrinkMap[r.itemName] = (shrinkMap[r.itemName] || 0) + shrinkVal;
      if (overageVal > 0) overageMap[r.itemName] = (overageMap[r.itemName] || 0) + overageVal;
    });

    const topShrink = Object.entries(shrinkMap).sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, value]) => ({ name, value }));
    const topOverage = Object.entries(overageMap).sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, value]) => ({ name, value }));
    return { topShrink, topOverage };
  }, [data]);

  // 4. Radar Chart Data (Forensic Web)
  const radarData = React.useMemo(() => {
    // A. Helper to compute stats for a set of records
    const computeMarketStats = (records: ShrinkRecord[]) => {
      const stats: Record<string, { 
        name: string; 
        theftScore: number;    // Pure Shrink
        processScore: number;  // Ambient Overage (Sloppy Counting)
        receivingScore: number;// Cold Food Variance (Tablet Errors)
        revImpact: number;
        volume: number;
        rev: number;
      }> = {};

      records.forEach(r => {
        if (!stats[r.marketName]) {
          stats[r.marketName] = { 
            name: r.marketName, 
            theftScore: 0, 
            processScore: 0, 
            receivingScore: 0,
            revImpact: 0,
            volume: 0,
            rev: 0
          };
        }
        
        const isFresh = isColdFood(r.itemName, r.itemNumber);
        
        // Metric 1: Theft Risk (Total Shrink)
        stats[r.marketName].theftScore += r.shrinkLoss || 0;

        // Metric 2: Receiving Risk (Fresh Food Variance)
        if (isFresh) {
          stats[r.marketName].receivingScore += Math.abs(r.invVariance * (r.unitCost || 0));
        } else {
          // Metric 3: Process/Inventory Risk (Ambient Overage)
          stats[r.marketName].processScore += r.overageGain || 0;
        }

        stats[r.marketName].rev += r.totalRevenue || 0;
        stats[r.marketName].volume += 1;
      });

      // Normalize Rev Impact
      Object.values(stats).forEach(m => {
        if (m.rev > 0) m.revImpact = ((m.theftScore + m.processScore + m.receivingScore) / m.rev) * 100;
      });

      return Object.values(stats);
    };

    // B. Compute Global Maxes from ALL records (for normalization context)
    const globalStats = computeMarketStats(allRecords);
    if (globalStats.length === 0) return { data: [], keys: [] };

    const maxTheft = Math.max(...globalStats.map(m => m.theftScore)) || 1;
    const maxProcess = Math.max(...globalStats.map(m => m.processScore)) || 1;
    const maxReceiving = Math.max(...globalStats.map(m => m.receivingScore)) || 1;
    const maxImpact = Math.max(...globalStats.map(m => m.revImpact)) || 1;
    const maxVol = Math.max(...globalStats.map(m => m.volume)) || 1;

    // C. Compute Stats for Current View (filtered data)
    const currentViewStats = computeMarketStats(data);
    
    // Pick Top 3 from the *filtered* view to display
    const marketsToShow = currentViewStats
      .sort((a, b) => (b.theftScore + b.receivingScore + b.processScore) - (a.theftScore + a.receivingScore + a.processScore))
      .slice(0, 3);

    // D. Transform for Recharts Radar Format (Normalize against GLOBAL Max)
    const axes = [
      { subject: 'Theft Risk', fullMark: 100 },      
      { subject: 'Inventory Process', fullMark: 100 }, 
      { subject: 'Receiving (Fresh)', fullMark: 100 }, 
      { subject: 'Rev Impact', fullMark: 100 },      
      { subject: 'Error Freq', fullMark: 100 },      
    ];

    const finalData = axes.map((axis, i) => {
      const point: any = { subject: axis.subject, fullMark: 100 };
      marketsToShow.forEach((m, idx) => {
        let val = 0;
        // Normalize against GLOBAL max values, so a single market doesn't look like 100% everywhere
        if (i === 0) val = (m.theftScore / maxTheft) * 100;
        else if (i === 1) val = (m.processScore / maxProcess) * 100;
        else if (i === 2) val = (m.receivingScore / maxReceiving) * 100;
        else if (i === 3) val = (m.revImpact / maxImpact) * 100;
        else if (i === 4) val = (m.volume / maxVol) * 100;
        
        point[`market${idx}`] = Math.min(100, Math.max(0, val));
      });
      return point;
    });

    return { 
      data: finalData, 
      keys: marketsToShow.map((m, i) => ({ 
        key: `market${i}`, 
        name: m.name, 
        color: i === 0 ? '#ef4444' : i === 1 ? '#10b981' : '#6366f1' 
      })) 
    };
  }, [data, allRecords]);

  return (
    <div className="space-y-8 pb-12">
      {/* Row 1: Trends */}
      <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h3 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Forensic Trend Analysis</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Extrapolating Performance Across Periods</p>
          </div>
          <div className="flex gap-6">
             <div className="flex items-center gap-2"><div className="w-3 h-3 bg-indigo-500 rounded-full" /><span className="text-[10px] font-black text-slate-500 uppercase">Shrink Rate %</span></div>
             <div className="flex items-center gap-2"><div className="w-3 h-3 bg-slate-200 rounded-full" /><span className="text-[10px] font-black text-slate-500 uppercase">Net Variance ($)</span></div>
          </div>
        </header>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="period" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontWeight: 800}} />
              <YAxis yAxisId="left" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} tickFormatter={(v) => `${v}%`} />
              <YAxis yAxisId="right" orientation="right" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} tickFormatter={(v) => `$${v}`} />
              <Tooltip 
                contentStyle={{borderRadius: '2rem', border: 'none', boxShadow: '0 25px 50px -12px rgb(0 0 0 / 0.15)', padding: '20px'}}
              />
              <Line yAxisId="left" type="monotone" dataKey="shrinkRate" stroke="#6366f1" strokeWidth={4} dot={{ r: 6, fill: '#6366f1', strokeWidth: 0 }} activeDot={{ r: 8, strokeWidth: 0 }} />
              <Line yAxisId="right" type="monotone" dataKey="net" stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Radar Chart & Market Impact */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        
        {/* Radar Chart */}
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
           <header className="mb-4">
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Forensic Web</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Operational Diagnosis</p>
           </header>
           <div className="flex-1 min-h-[400px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData.data}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 800 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  {radarData.keys.map((k) => (
                    <Radar
                      key={k.key}
                      name={k.name}
                      dataKey={k.key}
                      stroke={k.color}
                      strokeWidth={3}
                      fill={k.color}
                      fillOpacity={0.1}
                    />
                  ))}
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', paddingTop: '20px' }} />
                  <Tooltip contentStyle={{borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}} />
                </RadarChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Market Breakdown Bar Chart */}
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm flex flex-col">
          <header className="flex justify-between items-start mb-8">
            <div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Variance Balance</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Shortage vs. Overage ($)</p>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-400 rounded-full" /><span className="text-[10px] font-bold text-slate-500 uppercase">Shortage</span></div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-400 rounded-full" /><span className="text-[10px] font-bold text-slate-500 uppercase">Overage</span></div>
            </div>
          </header>
          <div className="flex-1 min-h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={varianceImpact} margin={{ left: 20 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#64748b', fontWeight: 700}} />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                />
                <Bar dataKey="shortage" fill="#f87171" radius={[0, 4, 4, 0]} barSize={12} />
                <Bar dataKey="overage" fill="#34d399" radius={[0, 4, 4, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Side-by-Side Lists (Shrink vs Overage) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Shrink */}
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
          <header className="mb-8 flex items-center gap-4">
            <div className="w-10 h-10 bg-red-50 text-red-500 rounded-xl flex items-center justify-center font-bold">📉</div>
            <div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Shrink Drivers</h3>
              <p className="text-red-400 text-xs font-bold uppercase tracking-widest mt-1">High Value Loss</p>
            </div>
          </header>
          <div className="space-y-4">
            {itemLeaderboards.topShrink.map((item, idx) => (
              <div 
                key={idx} 
                onClick={() => onItemAnalysis(item.name, 'shrink')}
                className="group cursor-pointer hover:bg-slate-50 p-3 -mx-3 rounded-2xl transition-all"
                title="Click for calculation breakdown"
              >
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight truncate max-w-[70%] group-hover:text-indigo-600 transition-colors">{item.name}</span>
                  <span className="text-[11px] font-black text-red-500">-${item.value.toLocaleString()}</span>
                </div>
                <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-red-400 transition-all duration-1000 ease-out" 
                    style={{ width: `${(item.value / (itemLeaderboards.topShrink[0]?.value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Overage */}
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
          <header className="mb-8 flex items-center gap-4">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-500 rounded-xl flex items-center justify-center font-bold">📈</div>
            <div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Overage Drivers</h3>
              <p className="text-emerald-500 text-xs font-bold uppercase tracking-widest mt-1">Unaccounted Surplus</p>
            </div>
          </header>
          <div className="space-y-4">
            {itemLeaderboards.topOverage.map((item, idx) => (
              <div 
                key={idx} 
                onClick={() => onItemAnalysis(item.name, 'overage')}
                className="group cursor-pointer hover:bg-slate-50 p-3 -mx-3 rounded-2xl transition-all"
                title="Click for calculation breakdown"
              >
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[11px] font-black text-slate-700 uppercase tracking-tight truncate max-w-[70%] group-hover:text-indigo-600 transition-colors">{item.name}</span>
                  <span className="text-[11px] font-black text-emerald-500">+${item.value.toLocaleString()}</span>
                </div>
                <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-400 transition-all duration-1000 ease-out" 
                    style={{ width: `${(item.value / (itemLeaderboards.topOverage[0]?.value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};