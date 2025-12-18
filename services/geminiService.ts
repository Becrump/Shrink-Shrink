
import { GoogleGenAI, Type } from "@google/genai";
import { ShrinkRecord } from "../types";

export const queryMarketAI = async (
  records: ShrinkRecord[], 
  summaryStats: any,
  userQuestion: string,
  onChunk: (text: string) => void
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const monthlyAgg = records.reduce((acc: any, r) => {
    if (!acc[r.period]) acc[r.period] = { loss: 0, rev: 0 };
    acc[r.period].loss += r.shrinkLoss;
    acc[r.period].rev += r.totalRevenue;
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
    ROLE: Senior Micro-Market Forensic Analyst (Cantaloupe Seed Specialist).
    
    SYSTEM CONTEXT: 
    - Platform: Cantaloupe Seed Markets (Self-Checkout).
    - Data Summary: Portfolio Rev $${summaryStats.totalRevenue}, Shrink $${summaryStats.totalShrink}, Accuracy ${summaryStats.accuracy}%.
    - Top Losses: ${JSON.stringify(outliers)}
    - Active Segment: ${activeSegment}
    
    USER QUESTION: "${userQuestion}"
    
    GUIDELINES:
    - Focus strictly on micro-market logic (theft, receiving errors, kiosk bypass).
    - Be concise, data-driven, and forensic.
    - If asked for predictions, use the monthly velocity trends: ${JSON.stringify(monthlyAgg)}.
    - Use professional, analytical formatting (Markdown).
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
    onChunk("### Audit Error\n\nThe forensic engine encountered an error analyzing the dataset.");
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
