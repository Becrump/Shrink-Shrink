
import { GoogleGenAI, Type } from "@google/genai";
import { ShrinkRecord } from "../types";

// Fix: Strictly follow Gemini API guidelines to use process.env.API_KEY directly.
// We assume it's available via the global process object injected by our worker or build system.
const getAIClient = () => {
  const apiKey = (window as any).process?.env?.API_KEY || (process as any).env?.API_KEY;
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }
  return new GoogleGenAI({ apiKey });
};

const isColdFoodManual = (name: string, code: string) => {
  const coldPrefixRegex = /^(KF|F\s|B\s)/i;
  return coldPrefixRegex.test(code) || coldPrefixRegex.test(name);
};

const getAggregates = (records: ShrinkRecord[]) => {
  const marketNames = Array.from(new Set(records.map(r => r.marketName))).filter(Boolean);

  const outliers = records
    .sort((a, b) => b.shrinkLoss - a.shrinkLoss)
    .slice(0, 50)
    .map(r => ({
      item: r.itemName,
      itemCode: r.itemNumber,
      market: r.marketName,
      variance: r.invVariance,
      impact: r.invVariance * (r.unitCost || 0),
      isFresh: isColdFoodManual(r.itemName, r.itemNumber)
    }));

  return { marketNames, outliers };
};

const OPERATIONAL_CONTEXT = `
  OPERATIONAL WORKFLOW CONTEXT:
  - COLD FOOD (Fresh): 
    - IDENTIFIERS: Item Number or Name starts with "KF", "F ", or "B ".
    - INVENTORY METHOD: UPC Scanning (Highly Precise). 
    - REASONING: Cold Food varies weekly; scanning UPCs is faster than searching a manual list.
    - RECEIVING ("Adds"): Manual Tablet Entry (Highly Prone to Human Error).
    
  - FORENSIC LOGIC: NAMING CONFUSION DETECTOR
    - Staff often mis-select items on the tablet during receiving. 
    - LOOK FOR: An Overage (Gain) in one item and a Shrink (Loss) in a similarly named item (e.g., "Classic Cheeseburger" overage vs "Cheeseburger" shrink).
    - If names are >80% similar and variances are inverted, FLAG this as "Naming Confusion" rather than physical theft.
    
  - SNACKS & DRINKS (Ambient): 
    - INVENTORY METHOD: Manual Count vs. Fixed Planogram (Sloppier).
    - FORENSIC MARKER: Variances here are typically true shrinkage or counting errors.
`;

export const queryMarketAIQuick = async (
  records: ShrinkRecord[], 
  summaryStats: any,
  userQuestion: string,
  onChunk: (text: string) => void
) => {
  try {
    // Fix: Create a new GoogleGenAI instance right before making an API call.
    const ai = getAIClient();
    const { marketNames, outliers } = getAggregates(records);

    const prompt = `
      ROLE: Senior Forensic Inventory Auditor.
      ${OPERATIONAL_CONTEXT}
      
      DATA CONTEXT:
      - Stats: Rev $${summaryStats.totalRevenue.toLocaleString()}, Shrink $${summaryStats.totalShrink.toLocaleString()}, Overage $${summaryStats.totalOverage.toLocaleString()}.
      - Markets: ${marketNames.join(", ")}
      - Top Variances: ${JSON.stringify(outliers.slice(0, 20))}
      
      USER QUESTION: "${userQuestion}"
      
      STRICT RESPONSE GUIDELINES:
      1. EXPLICITLY look for naming confusion (similar names, opposite variances).
      2. Example: Flag if "Pepperoni Pizza" has a gain while "Pep Pizza" has a loss.
      3. Focus on "Missed Adds" for Cold Food (KF/F/B) overages.
      4. Use clinical, bulleted Markdown.
    `;

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      // Fix: Use the .text property directly (not a method) as per Gemini guidelines.
      if (chunk.text) {
        fullText += chunk.text;
        onChunk(fullText);
      }
    }
  } catch (error: any) {
    // Fix: Robust handling for API errors and missing keys to signal the UI.
    const errMsg = error?.message || "";
    if (errMsg === "MISSING_API_KEY" || errMsg.includes("entity was not found") || errMsg.includes("API Key must be set")) {
      onChunk("RESELECT_KEY");
    } else {
      onChunk("Diagnosis failed. Check forensic engine connection. Error: " + errMsg);
    }
  }
};

export const queryMarketAIDeep = async (
  records: ShrinkRecord[], 
  summaryStats: any
): Promise<string> => {
  try {
    // Fix: Create a new GoogleGenAI instance right before making an API call.
    const ai = getAIClient();
    const { outliers } = getAggregates(records);

    const prompt = `
      ROLE: "The Shrink Shrink" - Chief Forensic Inventory Partner.
      ${OPERATIONAL_CONTEXT}
      
      VITALS: 
      - Revenue: $${summaryStats.totalRevenue.toLocaleString()}
      - Shrink: $${summaryStats.totalShrink.toLocaleString()}
      - Integrity: ${summaryStats.accuracy}%
      
      AUDIT REPORT SECTIONS:
      1. OPERATIONAL HEALTH: Receiving discipline trends.
      2. NAMING FORENSICS: Identify paired item errors (e.g., "Cheeseburger" vs "Classic Cheeseburger"). List specific matches.
      3. COLD FOOD DISCREPANCIES: UPC scan data vs missed manual tablet entry.
      4. ACTIONABLE REMEDIES: 5 steps to fix naming confusion and tablet compliance.
      
      DATA: ${JSON.stringify(outliers)}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        // Fix: Use a thinking budget for more detailed forensic reasoning (max for 3 Pro is 32768).
        thinkingConfig: { thinkingBudget: 16000 }
      }
    });
    // Fix: Access .text as a property.
    return response.text || "Diagnostic report generation failed.";
  } catch (error: any) {
    const errMsg = error?.message || "";
    if (errMsg === "MISSING_API_KEY" || errMsg.includes("entity was not found") || errMsg.includes("API Key must be set")) {
      return "RESELECT_KEY";
    }
    return "Forensic connection failed. Re-verify API credentials. " + errMsg;
  }
};

export const parseRawReportText = async (rawText: string): Promise<{ records: Partial<ShrinkRecord>[], detectedPeriod: string, detectedMarket: string }> => {
  try {
    const ai = getAIClient();
    const prompt = `Extract inventory data from this text. Focus on identifying the human-readable Market Name, the Reporting Period, and the itemized variances. Return valid JSON.\n\nTEXT:\n${rawText.slice(0, 15000)}`;

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
                  unitCost: { type: Type.NUMBER }
                }
              }
            }
          }
        }
      }
    });
    // Fix: Access .text as a property.
    const parsed = JSON.parse(response.text || "{}");
    return { 
      records: parsed.items || [], 
      detectedPeriod: parsed.detectedPeriod || 'Current',
      detectedMarket: parsed.detectedMarket || 'Unidentified'
    };
  } catch (error) {
    console.error("Forensic Parser Error:", error);
    return { records: [], detectedPeriod: '', detectedMarket: '' };
  }
};
