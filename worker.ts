
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
      
      // Ensure the key exists in the worker environment
      const apiKey = env.API_KEY || "";
      
      // Diagnostic log for Cloudflare dashboard (Real-time logs)
      if (!apiKey) {
        console.error("WORKER ALERT: API_KEY is missing from environment variables!");
      } else {
        console.log(`WORKER LOG: API_KEY detected (Length: ${apiKey.length})`);
      }
      
      // Inject the script into the top of the <head> using a robust regex
      const injection = `
        <script>
          (function() {
            window.process = window.process || {};
            window.process.env = window.process.env || {};
            window.process.env.API_KEY = ${JSON.stringify(apiKey)};
            
            // Diagnostics to help the user verify deployment status in browser console
            if (!window.process.env.API_KEY || window.process.env.API_KEY.trim() === "") {
              console.warn("Forensic AI Engine: API_KEY variable detected as EMPTY in browser. Check Cloudflare Dashboard Variables.");
            } else {
              console.info("Forensic AI Engine: API_KEY successfully synchronized from Cloudflare.");
            }
          })();
        </script>
      `;
      
      // Replace case-insensitively and handle potential attributes on the head tag
      if (html.toLowerCase().includes("<head>")) {
        html = html.replace(/<head>/i, (match) => match + injection);
      } else {
        // Fallback: prepending to the html if head is missing
        html = injection + html;
      }
      
      return new Response(html, {
        headers: response.headers
      });
    }

    return response;
  },
};
