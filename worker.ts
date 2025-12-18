
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Diagnostic Endpoint: Check if variables are visible to the Worker
    if (url.pathname === '/api/debug-env') {
      const hasKey = !!env.API_KEY;
      const keyLength = env.API_KEY ? env.API_KEY.length : 0;
      const keySnippet = env.API_KEY ? `${env.API_KEY.substring(0, 3)}...${env.API_KEY.substring(env.API_KEY.length - 3)}` : 'none';
      
      return new Response(JSON.stringify({
        status: "Worker is running",
        timestamp: new Date().toISOString(),
        env: {
          has_API_KEY: hasKey,
          key_length: keyLength,
          key_preview: keySnippet,
          all_keys: Object.keys(env).filter(k => k !== 'ASSETS')
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Asset Fetching
    const response = await env.ASSETS.fetch(request);
    
    // 3. HTML Injection Logic
    // We only want to transform actual HTML files.
    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || url.pathname === '/' || url.pathname === '/index.html';
    
    if (isHtml && response.ok) {
      let html = await response.text();
      
      // Token defined in index.html: %%API_KEY_INJECTION%%
      const token = "%%API_KEY_INJECTION%%";
      const actualKey = env.API_KEY || "MISSING_IN_WORKER_ENV";
      
      // Perform replacement
      const updatedHtml = html.replace(token, actualKey);
      
      return new Response(updatedHtml, {
        headers: {
          ...Object.fromEntries(response.headers),
          'Content-Type': 'text/html;charset=UTF-8',
          'Cache-Control': 'no-cache' // Ensure we don't serve a stale injected key
        },
      });
    }

    return response;
  },
};
