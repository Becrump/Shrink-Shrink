
// Declaration for Cloudflare Workers HTMLRewriter
declare const HTMLRewriter: any;

export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: any; // Changed to any for debugging purposes
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    // Only modify successful HTML responses
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/html")) {
      // Diagnostic log for Cloudflare dashboard
      const rawKey = env.API_KEY;
      const keyType = typeof rawKey;
      let apiKey = "";

      if (keyType === "string") {
        apiKey = rawKey;
        console.log(`Worker: API_KEY detected as STRING (Length: ${apiKey.length})`);
      } else if (rawKey && keyType === "object") {
        // If the user accidentally chose JSON, try to extract value
        apiKey = rawKey.API_KEY || JSON.stringify(rawKey);
        console.warn(`Worker: API_KEY detected as OBJECT. Type: ${keyType}. Content: ${JSON.stringify(rawKey)}`);
      } else {
        console.error(`Worker: API_KEY is MISSING or invalid type (${keyType})`);
      }

      const injectionScript = `
        (function() {
          try {
            window.process = window.process || { env: {} };
            window.process.env = window.process.env || {};
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            
            console.log("Forensic AI [Worker]: Key Type Check: ${keyType}");
            
            if (!window.process.env.API_KEY || window.process.env.API_KEY === "") {
              console.error("Forensic AI [Worker]: API_KEY IS EMPTY. Action Required: Ensure variable is 'Text' or 'Secret' in Cloudflare, NOT 'JSON'.");
            } else {
              console.info("Forensic AI [Worker]: API_KEY successfully injected.");
            }
          } catch (e) {
            console.error("Forensic AI [Worker]: Failed to inject environment variables", e);
          }
        })();
      `;

      return new HTMLRewriter()
        .on("head", {
          element(element: any) {
            element.prepend(`<script>${injectionScript}</script>`, { html: true });
          },
        })
        .transform(response);
    }

    return response;
  },
};
