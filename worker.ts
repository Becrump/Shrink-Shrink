
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);

    // Only inject into HTML files (primarily index.html)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      let html = await response.text();
      
      // Defining process on globalThis ensures maximum compatibility with 
      // various module loaders and SDKs that expect a Node-like environment.
      const injection = `
        <script>
          (function() {
            const env = { API_KEY: ${JSON.stringify(env.API_KEY || "")} };
            globalThis.process = globalThis.process || {};
            globalThis.process.env = Object.assign(globalThis.process.env || {}, env);
          })();
        </script>
      `;
      
      // Insert right after <head> to be available for the importmap and module scripts
      html = html.replace("<head>", `<head>${injection}`);
      
      return new Response(html, {
        headers: response.headers
      });
    }

    return response;
  },
};
