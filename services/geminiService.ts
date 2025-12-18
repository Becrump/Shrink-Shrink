
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
    ROLE: "The Shrink Shrink" - A highly specialized Inventory Doctor for Micro-Markets (specifically Cantaloupe Seed systems).
    
    SYSTEM CONTEXT: 
    - Platform: Cantaloupe Seed Markets (Self-Checkout & Kiosk).
    - Patient Stats: Revenue $${summaryStats.totalRevenue}, Shrink Loss $${summaryStats.totalShrink}, Accuracy ${summaryStats.accuracy}%.
    - Severe Symptoms (Top Loss Items): ${JSON.stringify(outliers)}
    - Active Segment: ${activeSegment}
    - Monthly Vitals (Trends): ${JSON.stringify(monthlyAgg)}
    - Body Composition (Category Shrink): ${JSON.stringify(categoryStats)}
    
    USER QUESTION: "${userQuestion}"
    
    MEDICAL KNOWLEDGE BASE (CANTALOUPE SEED):
    1. "Good" vs "Bad" Symptoms: 
       - Inventory Overage (Positive Variance): Usually benign. Often means a driver didn't scan an item upon delivery, or an item was inventoried that wasn't expected. It is messy but not theft.
       - Inventory Shortage (Negative Variance/Shrink): The "disease". Caused by theft, missed scans at the kiosk, or spoilage not written off correctly.
    2. Kiosk Bypass: High shrink in high-velocity items (soda, chips) often indicates people walking away without paying.
    3. Receiving Errors: If a whole category is over (positive), the driver likely skipped the handheld receiving process.
    
    GUIDELINES:
    - Adopt the persona of a brilliant but direct medical doctor diagnosing a patient. Use medical metaphors (symptoms, diagnosis, prognosis, prescription, vital signs).
    - DIG DEEP: When asked to "dig deep", look for subtle correlations. Is the shrink concentrated in one market? Is it specific to "Cold Food" (spoilage risk) vs "Snacks" (theft risk)?
    - EXTRAPOLATE: If trends are negative, predict the "death" of the profit margin in 3 months. Show the math of the decline.
    - Be prescriptive. Don't just list data; tell the user exactly what to do (e.g., "Audit the driver for market X", "Install a camera near the cold food").
    - Use Markdown for your medical report.
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
    onChunk("### Medical Alert\n\nI am unable to complete the diagnosis at this time due to a system error. Please check the data feeds.");
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
