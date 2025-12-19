
export interface ShrinkRecord {
  id: string;
  itemNumber: string;
  itemName: string;
  invVariance: number;
  totalRevenue: number;
  soldQty: number;
  salePrice: number;
  shrinkLoss: number;
  overageGain: number;      // Value of positive variance
  netVarianceValue: number; // Signed value (Overage - Shrink)
  unitCost: number;
  itemProfit: number;
  category: string;
  marketName: string;
  period: string; // e.g., "2024-01" or "January"
}

export type DeepDiveStatus = 'idle' | 'analyzing' | 'ready';

export type ViewType = 'dashboard' | 'report-upload' | 'ai-insights';