
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, Cell, ReferenceLine, LabelList,
  LineChart, Line
} from 'recharts';
import { ShrinkRecord } from '../types';

interface ChartsProps {
  data: ShrinkRecord[];
}

const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const AnalysisCharts: React.FC<ChartsProps> = ({ data }) => {
  // 1. Trend Analysis (Month over Month)
  const trendData = React.useMemo(() => {
    const periods: Record<string, { period: string; shrink: number; revenue: number; net: number }> = {};
    data.forEach(r => {
      if (!periods[r.period]) periods[r.period] = { period: r.period, shrink: 0, revenue: 0, net: 0 };
      const impact = (r.invVariance * (r.unitCost || 0));
      periods[r.period].revenue += r.totalRevenue || 0;
      if (impact < 0) periods[r.period].shrink += Math.abs(impact);
      periods[r.period].net += impact;
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
      const impact = (r.invVariance * (r.unitCost || 0));
      if (impact < 0) {
        markets[r.marketName].shortage += Math.abs(impact);
      } else {
        markets[r.marketName].overage += impact;
      }
    });
    return Object.values(markets).sort((a, b) => (b.shortage + b.overage) - (a.shortage + a.overage)).slice(0, 10);
  }, [data]);

  // 3. Itemized Leaderboards
  const itemLeaderboards = React.useMemo(() => {
    const shrinkMap: Record<string, number> = {};
    const overageMap: Record<string, number> = {};

    data.forEach(r => {
      const shrinkVal = r.shrinkLoss || 0;
      const overageVal = r.invVariance > 0 ? (r.invVariance * (r.unitCost || 0)) : 0;
      if (shrinkVal > 0) shrinkMap[r.itemName] = (shrinkMap[r.itemName] || 0) + shrinkVal;
      if (overageVal > 0) overageMap[r.itemName] = (overageMap[r.itemName] || 0) + overageVal;
    });

    const topShrink = Object.entries(shrinkMap).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, value]) => ({ name, value }));
    const topOverage = Object.entries(overageMap).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, value]) => ({ name, value }));
    return { topShrink, topOverage };
  }, [data]);

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

      {/* Row 2: Market Breakdown & Integrity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
          <header className="flex justify-between items-start mb-8">
            <div>
              <h3 className="text-2xl font-black text-slate-900 tracking-tight">Financial Variance Balance</h3>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Shortage Loss vs. Overage Gain ($)</p>
            </div>
            <div className="flex gap-4">
               <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-400 rounded-full" /><span className="text-[10px] font-bold text-slate-500 uppercase">Shortage</span></div>
               <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-400 rounded-full" /><span className="text-[10px] font-bold text-slate-500 uppercase">Overage</span></div>
            </div>
          </header>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={varianceImpact} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} tick={{fill: '#94a3b8'}} tickFormatter={(v) => `$${v}`} />
                <Tooltip 
                  contentStyle={{borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)'}}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                />
                <Bar dataKey="shortage" fill="#f87171" radius={[6, 6, 0, 0]} barSize={12} />
                <Bar dataKey="overage" fill="#34d399" radius={[6, 6, 0, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-12 rounded-[4rem] border border-slate-200 shadow-sm">
          <header className="mb-8">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Loss Drivers</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Itemized Risk Factors</p>
          </header>
          <div className="space-y-6">
            {itemLeaderboards.topShrink.map((item, idx) => (
              <div key={idx} className="group">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-[12px] font-black text-slate-700 uppercase tracking-tight truncate max-w-[70%]">{item.name}</span>
                  <span className="text-[12px] font-black text-red-500">-${item.value.toLocaleString()}</span>
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
      </div>
    </div>
  );
};
