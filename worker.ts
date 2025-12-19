export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();

    // CORS Headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Use a more permissive check that works regardless of base paths or trailing slashes
    if (pathname.includes('/api/config')) {
      const payload = JSON.stringify({ API_KEY: env.API_KEY || "" });
      return new Response(payload, { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json;charset=UTF-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
          ...corsHeaders
        } 
      });
    }

    if (pathname.includes('/api/debug-env')) {
      const key = env.API_KEY || "";
      const payload = JSON.stringify({
        status: "Worker Active",
        env_keys: Object.keys(env).filter(k => k !== 'ASSETS'),
        key_detected: !!key,
        key_length: key.length,
        key_preview: key ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : "none",
        request_url: request.url,
        request_pathname: url.pathname
      });
      return new Response(payload, { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json;charset=UTF-8',
          ...corsHeaders
        } 
      });
    }

    // Default to assets
    return await env.ASSETS.fetch(request);
  },
};