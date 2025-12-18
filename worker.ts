
// Declaration for Cloudflare Workers HTMLRewriter
declare const HTMLRewriter: any;

export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 1. Fetch the original asset
    const response = await env.ASSETS.fetch(request);
    
    // 2. Check if it's an HTML file
    const url = new URL(request.url);
    const isHtml = response.headers.get("content-type")?.includes("text/html") || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

    if (response.ok && isHtml) {
      const apiKey = env.API_KEY || "";
      
      // LOGGING: This appears in your Cloudflare "Real-time Logs"
      console.log(`Forensic Engine: Injecting Key (Length: ${apiKey.length}) into ${url.pathname}`);

      // We inject both a script (for process.env emulation) and a meta tag (for backup)
      const injection = `
        <meta name="ai-api-key" content="${apiKey}">
        <script>
          window.process = window.process || {};
          window.process.env = window.process.env || {};
          window.process.env.API_KEY = ${JSON.stringify(apiKey)};
          console.info("Forensic Engine: Edge injection verified.");
        </script>
      `;

      // 3. Transform the response
      const transformedResponse = new HTMLRewriter()
        .on("head", {
          element(element: any) {
            element.prepend(injection, { html: true });
          },
        })
        .transform(response);

      // 4. CLOBBER CACHE HEADERS: Force Cloudflare to run this worker every time
      const newHeaders = new Headers(transformedResponse.headers);
      newHeaders.set("X-Forensic-Engine", "active");
      newHeaders.set("X-Key-Status", apiKey ? "bound" : "unbound");
      newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
      newHeaders.set("Pragma", "no-cache");
      newHeaders.set("Expires", "0");

      return new Response(transformedResponse.body, {
        status: transformedResponse.status,
        statusText: transformedResponse.statusText,
        headers: newHeaders
      });
    }

    // For non-HTML (JS, CSS, Images), serve normally
    return response;
  },
};
