
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    // Only inject into HTML files (primarily index.html)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      let html = await response.text();
      
      // Get the key from the worker environment
      const apiKey = env.API_KEY || "";
      
      // If no key is set in the worker, do not inject anything.
      // This allows the hardcoded key in index.html to persist.
      if (!apiKey) {
        console.warn("WORKER LOG: API_KEY is missing from environment variables. Using hardcoded key from index.html.");
        return new Response(html, {
          headers: response.headers
        });
      }
      
      console.log(`WORKER LOG: API_KEY detected. Synchronizing with browser context.`);
      
      // Inject the script into the top of the <head>
      const injection = `
        <script>
          (function() {
            window.process = window.process || {};
            window.process.env = window.process.env || {};
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            globalThis.process = window.process;
            console.info("Forensic AI Engine: API_KEY successfully synchronized from Cloudflare.");
          })();
        </script>
      `;
      
      // Replace case-insensitively and handle potential attributes on the head tag
      if (html.toLowerCase().includes("<head>")) {
        html = html.replace(/<head>/i, (match) => match + injection);
      } else {
        html = injection + html;
      }
      
      return new Response(html, {
        headers: response.headers
      });
    }

    return response;
  },
};
