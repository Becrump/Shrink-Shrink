import { GoogleGenAI, Type } from "@google/genai";
import { ShrinkRecord } from "../types";

// Ensure TypeScript recognizes the global process object attached to window
declare global {
  interface Window {
    process: {
      env: {
        API_KEY?: string;
      }
    }
  }
}

const getAI = () => {
  // Robustly retrieve the key from the global window object where App.tsx injects it.
  // We check window.process explicitly to avoid bundler/transpiler scope isolation issues.
  const apiKey = window.process?.env?.API_KEY;

  if (!apiKey) {
    console.error("AUTH ERROR: API_KEY missing from window.process.env");
    throw new Error("AUTH_REQUIRED");
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
  
  1. COLD FOOD (Fresh) - HIGH RISK FOR RECEIVING ERRORS: 
    - IDENTIFIERS: Item Number or Name starts with "KF", "F ", or "B ".
    - INVENTORY METHOD: UPC Scanning (Highly Precise). 
    - RECEIVING ("Adds") METHOD: Manual Tablet Entry.
    - FORENSIC DIAGNOSIS: 
      - If there is an OVERAGE (Positive Variance) in Cold Food, it is almost always a RECEIVING ERROR (Driver forgot to "Add" the item on the tablet).
      - If there is SHRINK (Negative Variance), check if they double-added it the week before, or if it's true theft.

  2. FROZEN ITEMS (Ice Cream, Meals) - THE "DEPOT FREEZER" TRAP:
    - CONTEXT: Frozen items are often delivered same-day but placed in the **Depot Freezer** (not the market machine) to stay cold during the shift.
    - THE PROCESS ERROR: The driver "Adds" the item on the market tablet (digitally receiving it) but physically leaves the item in the Depot Freezer.
    - RESULT: The Inventory Scan finds 0 items in the market. The Book Inventory expects the items (due to the "Add").
    - SYMPTOM: High "Shrink" (Phantom Loss) on Frozen items.
    - CONSEQUENCE: The system calculates the item is below par and **Auto-Reorders**, bombarding the depot with extra inventory.
    - CORRECTION: Drivers must CLEAR the pre-picked "Adds" on the tablet if they do not physically stock the machine immediately.

  3. FORENSIC LOGIC: NAMING CONFUSION DETECTOR:
    - Staff often mis-select items on the tablet during receiving. 
    - LOOK FOR: An Overage (Gain) in one item and a Shrink (Loss) in a similarly named item (e.g., "Classic Cheeseburger" overage vs "Cheeseburger" shrink).
    - If names are >80% similar and variances are inverted, FLAG this as "Naming Confusion" rather than physical theft.
    
  4. SNACKS & DRINKS (Ambient) - INVENTORY PROCESS RISK: 
    - INVENTORY METHOD: Manual Count vs. Fixed Planogram (Sloppier).
    - FORENSIC MARKER: Variances here are typically Counting Errors or Physical Theft. Overages usually imply sloppy counting in previous periods.
`;

export const queryMarketAIQuick = async (
  records: ShrinkRecord[], 
  summaryStats: any,
  userQuestion: string,
  onChunk: (text: string) => void
) => {
  try {
    const ai = getAI();
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
      1. If the user asks about Cold Food/Fresh items, blame the "Tablet Adds" process first.
      2. If Frozen items are mentioned, check for the "Depot Freezer" trap (added but not stocked).
      3. EXPLICITLY look for naming confusion (similar names, opposite variances).
      4. Example: Flag if "Pepperoni Pizza" has a gain while "Pep Pizza" has a loss.
      5. Use clinical, bulleted Markdown.
    `;

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-3-flash-preview",
      contents: prompt
    });

    let fullText = "";
    for await (const chunk of responseStream) {
      if (chunk.text) {
        fullText += chunk.text;
        onChunk(fullText);
      }
    }
  } catch (error: any) {
    const msg = error.message || "";
    if (msg.includes("AUTH_REQUIRED") || msg.includes("403") || msg.includes("401") || msg.includes("API key")) {
      onChunk("AUTH_REQUIRED");
    } else {
      onChunk("Diagnosis failed. Error: " + msg);
    }
  }
};

export const queryMarketAIDeep = async (
  records: ShrinkRecord[], 
  summaryStats: any
): Promise<string> => {
  try {
    const ai = getAI();
    const { outliers } = getAggregates(records);

    const prompt = `
      ROLE: You are "The Shrink Shrink", a helpful, encouraging, and observant inventory coach. Your goal is to make sense of the data for the team in a way that is digestible, coherent, and non-accusatory.
      ${OPERATIONAL_CONTEXT}
      
      VITALS: 
      - Revenue: $${summaryStats.totalRevenue.toLocaleString()}
      - Shrink: $${summaryStats.totalShrink.toLocaleString()}
      - Integrity: ${summaryStats.accuracy}%
      
      PLEASE PROVIDE A DIAGNOSTIC SUMMARY (Use clear, simple language):
      
      1. **The Big Picture**: A brief, coherent summary of what the numbers are saying. Are they losing money (theft) or just dealing with paperwork/process ghosts?
      
      2. **Process Breakdowns (The "Why")**:
         - Explain patterns in **Cold Food** (Fresh) items. If there are overages, explain gently that this usually points to the "Tablet Add" process during delivery not matching the precise UPC scanning at checkout.
         - **Frozen Item Check**: If there is shrink in Frozen items (Ice Cream, etc.), ask if these items are sitting in the Depot Freezer but were "Added" to the market tablet. Explain that this causes **false shrink** and triggers **unwanted reorders**.
         - Discuss **Naming Confusion**. Point out if similar items (like "Cheeseburger" vs "Classic Cheeseburger") are trading variances, suggesting a selection error rather than loss.
      
      3. **Key Observations**: Highlight specific items from the data that illustrate these breakdowns.
      
      4. **Helpful Recommendations**: Suggest practical, easy wins to improve the process (e.g., "Clear tablet adds if storing in the depot freezer"). Focus on "how to help the system help you" rather than compliance demands.
      
      Tone: Helpful, Explanatory, Coherent. Avoid corporate jargon or "Audit" terminology.
      
      DATA: ${JSON.stringify(outliers)}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 4000 },
        maxOutputTokens: 8000
      }
    });
    return response.text || "Diagnostic report generation failed.";
  } catch (error: any) {
    const msg = error.message || "";
    if (msg.includes("AUTH_REQUIRED") || msg.includes("403") || msg.includes("401") || msg.includes("API key")) {
      return "AUTH_REQUIRED";
    }
    return "Forensic connection failed: " + msg;
  }
};

export const parseRawReportText = async (rawText: string): Promise<{ records: Partial<ShrinkRecord>[], detectedPeriod: string, detectedMarket: string }> => {
  try {
    const ai = getAI();
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