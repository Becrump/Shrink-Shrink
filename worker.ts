
export interface Env {
  ASSETS: { fetch: typeof fetch };
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);

    // Only inject into HTML files (primarily index.html)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      let html = await response.text();
      
      // We inject a script to define process.env globally in the browser
      // This allows the frontend code to use `process.env.API_KEY` as requested.
      const injection = `
        <script>
          window.process = window.process || {};
          window.process.env = window.process.env || {};
          window.process.env.API_KEY = ${JSON.stringify(env.API_KEY || "")};
        </script>
      `;
      
      // Insert the injection before the first script or at the end of head
      html = html.replace("</head>", `${injection}</head>`);
      
      return new Response(html, {
        headers: response.headers
      });
    }

    return response;
  },
};
