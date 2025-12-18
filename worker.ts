
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);
    
    // Only intercept the HTML entry point
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = await response.text();
      
      if (env.API_KEY) {
        // Find the placeholder script and replace it with the real key
        const pattern = /<script id="api-key-injection">[\s\S]*?<\/script>/;
        const actualScript = `<script>window.process={env:{API_KEY:${JSON.stringify(env.API_KEY)}}};globalThis.process=window.process;</script>`;
        html = html.replace(pattern, actualScript);
      }
      
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
