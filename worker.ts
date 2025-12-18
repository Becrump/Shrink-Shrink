export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, ''); // Remove trailing slashes for consistent matching

    // 1. Config Endpoint - Using endsWith to be resilient to base path variations
    if (path.endsWith('/api/config')) {
      const payload = JSON.stringify({ API_KEY: env.API_KEY || "" });
      return new Response(payload, { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json;charset=UTF-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Length': payload.length.toString(),
          'X-Content-Type-Options': 'nosniff'
        } 
      });
    }

    // 2. Diagnostic Endpoint
    if (path.endsWith('/api/debug-env')) {
      const key = env.API_KEY || "";
      const payload = JSON.stringify({
        status: "Worker Active",
        env_keys: Object.keys(env).filter(k => k !== 'ASSETS'),
        key_detected: !!key,
        key_length: key.length,
        key_preview: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "none",
        request_path: url.pathname
      });
      return new Response(payload, { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json;charset=UTF-8',
          'Content-Length': payload.length.toString()
        } 
      });
    }

    // 3. Asset Pass-through
    // If it's an API call that wasn't caught, don't return an asset, return a clean 404
    if (path.includes('/api/')) {
      return new Response(JSON.stringify({ error: "API Route Not Found", path: url.pathname }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return await env.ASSETS.fetch(request);
  },
};