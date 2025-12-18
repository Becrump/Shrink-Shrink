
// Declaration for Cloudflare Workers HTMLRewriter
declare const HTMLRewriter: any;

export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    // If it's HTML, we inject our environment variables
    if (response.ok && contentType.includes("text/html")) {
      const apiKey = env.API_KEY || "";
      
      // Diagnostic logging for the Cloudflare log stream
      console.log(`Forensic Worker: Processing HTML. API_KEY state: ${apiKey ? 'PRESENT' : 'MISSING'}`);

      const injectionScript = `
        (function() {
          try {
            window.process = window.process || {};
            window.process.env = window.process.env || {};
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            
            // Immediate verification
            if (window.process.env.API_KEY) {
              console.info("Forensic AI: Diagnostic Engine successfully linked via Edge Worker.");
            } else {
              console.error("Forensic AI: Edge Worker active, but API_KEY variable is empty in Cloudflare settings.");
            }
          } catch (e) {
            console.error("Forensic AI: Injection failure", e);
          }
        })();
      `;

      // Create a new response so we can modify headers
      const newResponse = new HTMLRewriter()
        .on("head", {
          element(element: any) {
            element.prepend(`<script>${injectionScript}</script>`, { html: true });
          },
        })
        .transform(response);

      // Add a diagnostic header so the user can verify the worker is actually running
      const headers = new Headers(newResponse.headers);
      headers.set("X-Forensic-Engine", "active");
      headers.set("X-Key-Status", apiKey ? "bound" : "unbound");

      return new Response(newResponse.body, {
        ...newResponse,
        headers
      });
    }

    return response;
  },
};
