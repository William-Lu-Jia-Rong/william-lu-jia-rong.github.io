/** Cloudflare Worker entry point for the statically generated portfolio. */
export default {
  async fetch(request, env) {
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Static asset binding is unavailable.", {
        status: 500,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
