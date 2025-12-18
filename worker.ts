
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1. Diagnostic Endpoints
    if (url.pathname === '/api/debug-env') {
      const key = env.API_KEY || "";
      return new Response(JSON.stringify({
        status: "Worker Active",
        env_keys: Object.keys(env).filter(k => k !== 'ASSETS'),
        key_detected: !!key,
        key_length: key.length,
        key_preview: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "none"
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // 2. Fetch the actual asset
    const response = await env.ASSETS.fetch(request);
    
    // 3. Determine if we should inject (HTML files or SPA routes)
    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html') || 
                   url.pathname.endsWith('/') || 
                   url.pathname.endsWith('.html') ||
                   (!url.pathname.includes('.') && !url.pathname.startsWith('/api/'));

    if (isHtml && response.ok) {
      try {
        let html = await response.text();
        const token = /%%API_KEY_INJECTION%%/g;
        const actualKey = env.API_KEY || "MISSING_IN_WORKER";
        
        // Replace all instances of the token with the actual key
        const updatedHtml = html.replace(token, actualKey);
        
        // Return the modified HTML with strict no-cache headers
        return new Response(updatedHtml, {
          headers: {
            ...Object.fromEntries(response.headers),
            'Content-Type': 'text/html;charset=UTF-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      } catch (err) {
        console.error("Injection failed:", err);
      }
    }

    return response;
  },
};
