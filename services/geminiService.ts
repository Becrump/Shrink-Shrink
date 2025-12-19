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
  OPERATIONAL WORKFLOW CONTEXT (CANTALOUPE / SEED EXPERT MODE):
  
  1. COLD FOOD (Fresh) - TABLET RECEIVING ERRORS: 
    - IDENTIFIERS: Item Number or Name starts with "KF", "F ", or "B ".
    - INVENTORY METHOD: UPC Scanning (Highly Precise). 
    - RECEIVING ("Adds") METHOD: Manual Tablet Entry.
    - FORENSIC DIAGNOSIS: Positive Variance (Overage) here usually means the driver forgot to "Add" the item on the tablet. Negative Variance (Shrink) implies they added it but it wasn't there (or was stolen).

  2. FROZEN ITEMS & THE "DEPOT FREEZER" PARADOX (CRITICAL LOGIC):
    - SCENARIO: Frozen items are delivered but placed in the **Depot Freezer** (not packed out) to avoid melting.
    - SEED SOFTWARE LOGIC (Pre-Picking & Pars):
      - **IF DRIVER CLEARS THE ADD**: The tablet tells Seed "This item is not in the market."
        - RESULT: Market Inventory drops below Par Level.
        - CONSEQUENCE: **System Auto-Reorders**. The warehouse picks MORE of the item for the next delivery, flooding the depot.
      - **IF DRIVER KEEPS THE ADD (But leaves item in Depot)**: The tablet tells Seed "This item is in the machine."
        - RESULT: Next physical scan finds 0 items.
        - CALCULATION: (Previous Stock + Add) - 0 Scan = Sales.
        - CONSEQUENCE: **Phantom Shrink**. The system thinks the items were sold/stolen.
    - THE FIX: The driver is in a Catch-22. To fix this, they must either **physically stock the machine** immediately OR count the items in the Depot Freezer as part of their "End of Day" inventory. Simply clearing the add solves shrink but breaks the warehouse replenishment loop.

  3. FORENSIC LOGIC: NAMING CONFUSION DETECTOR:
    - Staff often mis-select items on the tablet during receiving. 
    - LOOK FOR: An Overage (Gain) in one item and a Shrink (Loss) in a similarly named item (e.g., "Classic Cheeseburger" overage vs "Cheeseburger" shrink).
    - If names are >80% similar and variances are inverted, FLAG this as "Naming Confusion".
    
  4. SNACKS & DRINKS (Ambient): 
    - Variances here are typically Counting Errors or Physical Theft. Overages usually imply sloppy counting in previous periods.
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
      ROLE: Senior Forensic Inventory Auditor & Cantaloupe Seed Software Expert.
      ${OPERATIONAL_CONTEXT}
      
      DATA CONTEXT:
      - Stats: Rev $${summaryStats.totalRevenue.toLocaleString()}, Shrink $${summaryStats.totalShrink.toLocaleString()}, Overage $${summaryStats.totalOverage.toLocaleString()}.
      - Markets: ${marketNames.join(", ")}
      - Top Variances: ${JSON.stringify(outliers.slice(0, 20))}
      
      USER QUESTION: "${userQuestion}"
      
      STRICT RESPONSE GUIDELINES:
      1. If the user asks about Cold Food/Fresh items, blame the "Tablet Adds" process first.
      2. If Frozen items are mentioned, explain the "Depot Freezer Paradox" (Clearing adds = Reorders; Keeping adds = Shrink).
      3. EXPLICITLY look for naming confusion (similar names, opposite variances).
      4. Use clinical, bulleted Markdown.
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
      ROLE: You are "The Shrink Shrink", a helpful inventory coach who is an expert in the **Seed / MyCantaloupe** software logic.
      ${OPERATIONAL_CONTEXT}
      
      VITALS: 
      - Revenue: $${summaryStats.totalRevenue.toLocaleString()}
      - Shrink: $${summaryStats.totalShrink.toLocaleString()}
      - Integrity: ${summaryStats.accuracy}%
      
      PLEASE PROVIDE A DIAGNOSTIC SUMMARY (Use clear, simple language):
      
      1. **The Big Picture**: A brief, coherent summary of what the numbers are saying.
      
      2. **Process Breakdowns (The "Why")**:
         - **Frozen Item Check**: Explain the **Seed Software Logic**. If there is shrink in Frozen, ask if they are keeping the tablet "Adds" but leaving food in the Depot Freezer. 
         - **The Frozen Catch-22**: Explain that if they *clear* the add to fix the shrink, Seed will see the market is under PAR and **Auto-Reorder** more stock, flooding the depot. The only fix is to physically stock the machine or count the depot inventory.
         - **Cold Food**: Explain tablet entry errors vs scanning.
         - **Naming Confusion**: Check for similar names trading variances.
      
      3. **Key Observations**: Highlight specific items from the data.
      
      4. **Helpful Recommendations**: Suggest practical wins. "If you don't pack out the freezer, you must count that stock, otherwise the system thinks you need more!"
      
      Tone: Helpful, Explanatory, Coherent. Show off your knowledge of how the Seed system thinks (Pars vs On Hand).
      
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