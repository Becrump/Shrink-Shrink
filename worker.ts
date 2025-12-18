export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);
    
    // Check if the request is for the main HTML entry point
    const isHtml = url.pathname === '/' || url.pathname === '/index.html' || !url.pathname.includes('.');
    
    if (isHtml) {
      let html = await response.text();
      
      // We look for our literal replacement token
      const token = "%%API_KEY_INJECTION%%";
      const actualKey = env.API_KEY || "";
      
      // Perform a clean string replacement
      html = html.replace(token, actualKey);
      
      return new Response(html, {
        headers: {
          ...Object.fromEntries(response.headers),
          'Content-Type': 'text/html;charset=UTF-8',
        },
      });
    }

    return response;
  },
};