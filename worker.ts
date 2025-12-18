
// Fix: Add declaration for HTMLRewriter which is a global class available in the Cloudflare Workers environment.
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
      const apiKey = env.API_KEY || "";
      
      // Log to Cloudflare Workers Dashboard (Real-time logs)
      if (!apiKey) {
        console.warn("Worker: API_KEY environment variable is MISSING or EMPTY.");
      } else {
        console.log("Worker: API_KEY detected and ready for injection.");
      }

      const injectionScript = `
        (function() {
          window.process = window.process || {};
          window.process.env = window.process.env || {};
          window.process.env.API_KEY = ${JSON.stringify(apiKey)};
          
          if (!window.process.env.API_KEY) {
            console.error("Forensic AI: API_KEY is undefined. Ensure it is set in Cloudflare Dashboard -> Settings -> Variables.");
          } else {
            console.info("Forensic AI: Environment variables synchronized from Cloudflare.");
          }
        })();
      `;

      // Use HTMLRewriter to inject the script at the start of the <head>
      // Fix: HTMLRewriter is now declared globally above.
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
