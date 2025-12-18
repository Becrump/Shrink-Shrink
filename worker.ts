
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = await response.text();
      
      // We look for the marker we placed in index.html
      const pattern = /<script id="api-key-injection">[\s\S]*?<\/script>/;
      
      // If the API_KEY exists in the environment, we inject it.
      // If not, we inject a helpful error object to the console.
      const apiKeyVal = env.API_KEY || "";
      const injectionContent = `
        window.process = window.process || { env: {} };
        window.process.env = window.process.env || {};
        window.process.env.API_KEY = ${JSON.stringify(apiKeyVal)};
        globalThis.process = window.process;
        if (!${JSON.stringify(apiKeyVal)}) {
          console.warn("SHRINK-SHRINK: API_KEY is missing from the Worker Environment.");
        }
      `;
      
      const actualScript = `<script id="api-key-injection">${injectionContent}</script>`;
      html = html.replace(pattern, actualScript);
      
      return new Response(html, {
        headers: {
          ...Object.fromEntries(response.headers),
          'Content-Type': 'text/html',
        },
      });
    }

    return response;
  },
};
