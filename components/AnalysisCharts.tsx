
import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Legend, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, Cell, ReferenceLine
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
  // 1. Overage vs Shortage Impact ($)
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

  // 2. Itemized Leaderboards (Shrink & Overage)
  const itemLeaderboards = React.useMemo(() => {
    const shrinkMap: Record<string, number> = {};
    const overageMap: Record<string, number> = {};

    data.forEach(r => {
      const shrinkVal = r.shrinkLoss || 0;
      const overageVal = r.invVariance > 0 ? (r.invVariance * (r.unitCost || 0)) : 0;

      if (shrinkVal > 0) shrinkMap[r.itemName] = (shrinkMap[r.itemName] || 0) + shrinkVal;
      if (overageVal > 0) overageMap[r.itemName] = (overageMap[r.itemName] || 0) + overageVal;
    });

    const topShrink = Object.entries(shrinkMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    const topOverage = Object.entries(overageMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    return { topShrink, topOverage };
  }, [data]);

  // 3. Procedural Integrity Probability
  const auditIntegrity = React.useMemo(() => {
    const markets: Record<string, { 
      name: string; 
      receivingErrorProb: number; 
      reportingSloppiness: number;
      theftLikelihood: number;
    }> = {};

    data.forEach(r => {
      if (!markets[r.marketName]) markets[r.marketName] = { name: r.marketName, receivingErrorProb: 0, reportingSloppiness: 0, theftLikelihood: 0 };
      
      const financialImpact = Math.abs(r.invVariance * (r.unitCost || 0));
      if (r.invVariance > 0) {
        markets[r.marketName].receivingErrorProb += financialImpact;
      } else {
        if (r.unitCost > 5) {
          markets[r.marketName].theftLikelihood += financialImpact;
        } else {
          markets[r.marketName].reportingSloppiness += financialImpact;
        }
      }
    });

    return Object.values(markets).map(m => {
      const total = m.receivingErrorProb + m.reportingSloppiness + m.theftLikelihood || 1;
      return {
        name: m.name,
        'Receiving Error': Math.round((m.receivingErrorProb / total) * 100),
        'Reporting Slack': Math.round((m.reportingSloppiness / total) * 100),
        'Theft Risk': Math.round((m.theftLikelihood / total) * 100),
      };
    }).sort((a, b) => b['Theft Risk'] - a['Theft Risk']).slice(0, 5);
  }, [data]);

  const marketMetrics = React.useMemo(() => {
    const markets: Record<string, { name: string; revenue: number; shrink: number; overage: number; rate: number; }> = {};
    data.forEach(r => {
      if (!markets[r.marketName]) markets[r.marketName] = { name: r.marketName, revenue: 0, shrink: 0, overage: 0, rate: 0 };
      markets[r.marketName].revenue += r.totalRevenue || 0;
      markets[r.marketName].shrink += r.shrinkLoss || 0;
      if (r.invVariance > 0) markets[r.marketName].overage += (r.invVariance * r.unitCost) || 0;
    });
    return Object.values(markets).map(m => ({
      ...m,
      rate: m.revenue > 0 ? Number(((m.shrink / m.revenue) * 100).toFixed(2)) : 0
    }));
  }, [data]);

  const avgRev = marketMetrics.reduce((acc, m) => acc + m.revenue, 0) / (marketMetrics.length || 1);
  const avgRate = marketMetrics.reduce((acc, m) => acc + m.rate, 0) / (marketMetrics.length || 1);

  return (
    <div className="space-y-8 pb-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
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

        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
          <header className="mb-8">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Audit Integrity Profile</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Probability of Root Cause per Location (%)</p>
          </header>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={auditIntegrity}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="name" tick={{fill: '#64748b', fontSize: 10, fontWeight: 800}} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} axisLine={false} tick={false} />
                <Radar name="Receiving Error" dataKey="Receiving Error" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                <Radar name="Reporting Slack" dataKey="Reporting Slack" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.4} />
                <Radar name="Theft Risk" dataKey="Theft Risk" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px', fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em'}} />
                <Tooltip contentStyle={{borderRadius: '1rem'}} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
          <header className="mb-8">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Shrink Items</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Highest Dollar Loss per Unit</p>
          </header>
          <div className="space-y-4">
            {itemLeaderboards.topShrink.map((item, idx) => (
              <div key={idx} className="group">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-xs font-black text-slate-700 truncate max-w-[70%] uppercase tracking-tight">{item.name}</span>
                  <span className="text-xs font-black text-red-500">${item.value.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-red-400 transition-all duration-1000 group-hover:bg-red-500" 
                    style={{ width: `${(item.value / (itemLeaderboards.topShrink[0]?.value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {itemLeaderboards.topShrink.length === 0 && (
              <p className="text-center py-12 text-slate-300 font-bold uppercase text-[10px] tracking-widest">No Shrink Recorded</p>
            )}
          </div>
        </div>

        <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
          <header className="mb-8">
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Overage Items</h3>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Highest Operational Gain (Receiving Errors)</p>
          </header>
          <div className="space-y-4">
            {itemLeaderboards.topOverage.map((item, idx) => (
              <div key={idx} className="group">
                <div className="flex justify-between items-end mb-1">
                  <span className="text-xs font-black text-slate-700 truncate max-w-[70%] uppercase tracking-tight">{item.name}</span>
                  <span className="text-xs font-black text-emerald-500">${item.value.toLocaleString()}</span>
                </div>
                <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-emerald-400 transition-all duration-1000 group-hover:bg-emerald-500" 
                    style={{ width: `${(item.value / (itemLeaderboards.topOverage[0]?.value || 1)) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {itemLeaderboards.topOverage.length === 0 && (
              <p className="text-center py-12 text-slate-300 font-bold uppercase text-[10px] tracking-widest">No Overage Recorded</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[3rem] border border-slate-200 shadow-sm">
        <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-8">Risk/Revenue Scatter Quadrant</h3>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" vertical={true} stroke="#f1f5f9" />
              <XAxis type="number" dataKey="revenue" name="Revenue" unit="$" fontSize={11} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="rate" name="Shrink Rate" unit="%" fontSize={11} axisLine={false} tickLine={false} />
              <ZAxis type="number" dataKey="shrink" range={[100, 1000]} name="Loss" />
              <Tooltip 
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100 min-w-[200px]">
                        <p className="text-xs font-black text-slate-900 uppercase mb-2 border-b border-slate-50 pb-2">{data.name}</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between gap-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase">Revenue</span>
                            <span className="text-[10px] font-bold text-slate-700">${Math.round(data.revenue).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase">Shrink Rate</span>
                            <span className={`text-[10px] font-bold ${data.rate > avgRate ? 'text-red-500' : 'text-emerald-500'}`}>{data.rate}%</span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span className="text-[10px] font-black text-slate-400 uppercase">Total Loss</span>
                            <span className="text-[10px] font-bold text-slate-700">${Math.round(data.shrink).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <ReferenceLine x={avgRev} stroke="#e2e8f0" strokeDasharray="5 5" label={{ position: 'top', value: 'Avg Revenue', fill: '#94a3b8', fontSize: 10, fontWeight: 800 }} />
              <ReferenceLine y={avgRate} stroke="#e2e8f0" strokeDasharray="5 5" label={{ position: 'right', value: 'Avg Shrink', fill: '#94a3b8', fontSize: 10, fontWeight: 800 }} />
              <Scatter data={marketMetrics}>
                {marketMetrics.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.rate > avgRate ? (entry.revenue > avgRev ? '#ef4444' : '#f97316') : '#10b981'} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-6 flex flex-wrap gap-4 justify-center">
           <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#ef4444] rounded-sm" /><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">High Risk/High Rev</span></div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#f97316] rounded-sm" /><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">High Risk/Low Rev</span></div>
           <div className="flex items-center gap-2"><div className="w-3 h-3 bg-[#10b981] rounded-sm" /><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Efficient Performance</span></div>
        </div>
      </div>
    </div>
  );
};
