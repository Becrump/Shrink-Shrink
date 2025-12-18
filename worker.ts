
// Declaration for Cloudflare Workers HTMLRewriter
declare const HTMLRewriter: any;

export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    // Only modify successful HTML responses
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/html")) {
      // Use the binding from Cloudflare environment
      const apiKey = env.API_KEY || "";
      
      // Log for Cloudflare Workers Real-time logs
      if (!apiKey) {
        console.warn("WORKER ERROR: API_KEY is missing in the Cloudflare Dashboard environment variables for project 'shrink-shrink'.");
      }

      const injectionScript = `
        (function() {
          try {
            window.process = window.process || { env: {} };
            window.process.env = window.process.env || {};
            // Injecting key from Worker Environment
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            
            console.log("Forensic AI [Worker]: Sync check - Key Length: " + (window.process.env.API_KEY ? window.process.env.API_KEY.length : 0));
            
            if (!window.process.env.API_KEY || window.process.env.API_KEY === "") {
              console.error("Forensic AI [Worker]: API_KEY IS EMPTY. Action Required: Go to Cloudflare Dashboard -> Workers & Pages -> shrink-shrink -> Settings -> Variables -> Add 'API_KEY' and REDEPLOY.");
            }
          } catch (e) {
            console.error("Forensic AI [Worker]: Failed to inject environment variables", e);
          }
        })();
      `;

      // Prepend to head ensuring it's the very first script to execute
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
