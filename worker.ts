
// Declaration for Cloudflare Workers HTMLRewriter
declare const HTMLRewriter: any;

export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Diagnostic Endpoint: Allow the app to check if the worker is alive
    if (url.pathname === "/api/v1/health") {
      const status = {
        worker: "active",
        key_detected: !!env.API_KEY,
        key_length: env.API_KEY?.length || 0,
        timestamp: new Date().toISOString()
      };
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        }
      });
    }

    // 2. Fetch the original asset
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    // 3. If it's HTML, we inject and STRIP CACHE
    if (response.ok && (contentType.includes("text/html") || url.pathname.endsWith('/') || url.pathname.endsWith('.html'))) {
      const apiKey = env.API_KEY || "";
      
      const injectionScript = `
        <meta name="ai-worker-status" content="active">
        <meta name="ai-key-bound" content="${!!apiKey}">
        <script>
          (function() {
            window.process = window.process || {};
            window.process.env = window.process.env || {};
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            console.log("Forensic Engine [Edge]: Injected successfully.");
          })();
        </script>
      `;

      const transformedResponse = new HTMLRewriter()
        .on("head", {
          element(element: any) {
            element.prepend(injectionScript, { html: true });
          },
        })
        .transform(response);

      // Create clean headers to prevent inheritance of "HIT" headers from the asset
      const cleanHeaders = new Headers();
      // Copy non-cache headers
      transformedResponse.headers.forEach((value: string, key: string) => {
        const k = key.toLowerCase();
        if (!k.includes("cache") && !k.includes("expires") && !k.includes("etag") && !k.includes("last-modified")) {
          cleanHeaders.set(key, value);
        }
      });

      // Force NO CACHE
      cleanHeaders.set("X-Forensic-Engine", "active");
      cleanHeaders.set("X-Key-Status", apiKey ? "bound" : "unbound");
      cleanHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      cleanHeaders.set("Pragma", "no-cache");
      cleanHeaders.set("Expires", "0");

      return new Response(transformedResponse.body, {
        status: transformedResponse.status,
        headers: cleanHeaders
      });
    }

    return response;
  },
};
