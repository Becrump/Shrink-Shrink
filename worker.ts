
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Serves the static assets (index.html, JS, CSS) from the 'dist' directory.
    // By providing this script, Cloudflare allows the worker to use secret bindings.
    return await env.ASSETS.fetch(request);
  },
};
