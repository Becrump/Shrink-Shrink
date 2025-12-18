
import { GoogleGenAI, Type } from "@google/genai";
import { ShrinkRecord } from "../types";

export const queryMarketAI = async (
  records: ShrinkRecord[], 
  summaryStats: any,
  userQuestion: string,
  onChunk: (text: string) => void
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Aggregate Monthly Trends for Extrapolation
  const monthlyAgg = records.reduce((acc: any, r) => {
    if (!acc[r.period]) acc[r.period] = { loss: 0, rev: 0 };
    acc[r.period].loss += r.shrinkLoss;
    acc[r.period].rev += r.totalRevenue;
    return acc;
  }, {});

  // Category Breakdown
  const categoryStats = records.reduce((acc: any, r) => {
    const cat = r.category || 'Unknown';
    if (!acc[cat]) acc[cat] = 0;
    acc[cat] += r.shrinkLoss;
    return acc;
  }, {});

  const outliers = records
    .sort((a, b) => b.shrinkLoss - a.shrinkLoss)
    .slice(0, 30)
    .map(r => ({
      item: r.itemName,
      market: r.marketName,
      loss: r.shrinkLoss,
      variance: r.invVariance,
      rev: r.totalRevenue
    }));

  const activeSegment = summaryStats.activeContext || 'ALL';

  const prompt = `
    ROLE: "The Shrink Shrink" - A highly skilled Micro-Market Inventory Analyst and Operational Strategist.
    
    SYSTEM CONTEXT: 
    - Platform: Cantaloupe Seed Markets.
    - Stats: Rev $${summaryStats.totalRevenue}, Shrink $${summaryStats.totalShrink}, Accuracy ${summaryStats.accuracy}%.
    - Top Issue Items: ${JSON.stringify(outliers)}
    - Active Segment: ${activeSegment}
    - Monthly Trends: ${JSON.stringify(monthlyAgg)}
    - Category Breakdown: ${JSON.stringify(categoryStats)}
    
    USER QUESTION: "${userQuestion}"
    
    KNOWLEDGE BASE (CANTALOUPE SEED OPERATIONAL NUANCE):
    1. Operational vs Theft: You understand that not all variance is theft. Overage (positive variance) often means receiving errors (drivers skipping handheld scans). Shortage is the main concern for profitability (theft, spoilage, missed scans).
    2. Focus: Help the operator tighten procedures to maximize profit.
    3. Constructive Extrapolation: When projecting trends, focus on the "Opportunity Cost" of not fixing the issue.
    
    GUIDELINES:
    - Persona: Analytical, helpful, constructive, and precise. You are a partner in the user's business success, not a critic.
    - Metaphor: You can use "health" and "diagnosis" metaphors (e.g., "symptoms", "vital signs"), but keep it optimistic—focused on healing the market and stopping the leaks.
    - DIG DEEP: Look for patterns. Is it a specific driver route? A specific category like "Beverages"? 
    - EXTRAPOLATE: Project trends forward to show the *value* of fixing the issue now. (e.g., "Fixing this could save $X over 3 months").
    - Be Solution-Oriented: Prescribe actionable fixes (e.g., "Audit the Tuesday delivery," "Review spoilage logs", "Spot check the kiosk camera").
    - Use Markdown for your analysis.
  `;

  try {
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      const chunkText = chunk.text;
      if (chunkText) {
        fullText += chunkText;
        onChunk(fullText);
      }
    }
  } catch (error) {
    onChunk("### Operational Alert\n\nI am unable to complete the analysis at this time due to a connection issue. Please check the data feeds.");
  }
};

export const parseRawReportText = async (rawText: string): Promise<{ records: Partial<ShrinkRecord>[], detectedPeriod: string, detectedMarket: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `
    ACT AS: Forensic Data Entry Clerk for Cantaloupe Seed Reports.
    INPUT: Messy copy-pasted text from a Cantaloupe Seed / Micro-Market report.
    TASK: Extract all item rows, the Report Date (Period), and the Market Name.
    
    RULES:
    1. Items usually start with numbers (Item#). Look for Names, Rev, and Shrink.
    2. DETECT THE DATE: Find strings like "March 2024", "03/01/24", etc.
    3. DETECT MARKET: Look for "Market:", "Location:", or header text.
    4. Return exactly valid JSON.
    
    TEXT:
    """
    ${rawText.slice(0, 20000)}
    """
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedPeriod: { type: Type.STRING },
            detectedMarket: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  itemNumber: { type: Type.STRING },
                  itemName: { type: Type.STRING },
                  invVariance: { type: Type.NUMBER },
                  totalRevenue: { type: Type.NUMBER },
                  shrinkLoss: { type: Type.NUMBER },
                  unitCost: { type: Type.NUMBER }
                },
                required: ["itemNumber", "itemName", "shrinkLoss"]
              }
            }
          }
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");
    const records = (parsed.items || []).map((item: any) => ({
      ...item,
      period: parsed.detectedPeriod || new Date().toLocaleString('default', { month: 'long' }),
      marketName: parsed.detectedMarket || 'Imported Market'
    }));

    return { 
      records, 
      detectedPeriod: parsed.detectedPeriod || 'Current',
      detectedMarket: parsed.detectedMarket || 'Unidentified'
    };
  } catch (error) {
    return { records: [], detectedPeriod: '', detectedMarket: '' };
  }
};
