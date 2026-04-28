// api/proxy.js
//
// Vercel serverless proxy that forwards browser requests to api.ollama.com
// (or any custom Ollama server) with proper CORS headers added.
//
// Routing:
//   GET  /api/proxy/api/tags                   → GET  https://api.ollama.com/api/tags
//   POST /api/proxy/api/chat                   → POST https://api.ollama.com/api/chat (streaming)
//   POST /api/proxy/api/generate               → POST https://api.ollama.com/api/generate (streaming)
//
// For self-hosted Ollama, append ?base=https://your-server.com to override the target.
//
// Returns CORS headers on every response (including OPTIONS preflight) so
// browser apps can call this proxy from any origin.

export const config = {
  // Use Edge runtime so streaming responses work — Node serverless on Vercel
  // buffers the response and breaks NDJSON streaming from Ollama.
  runtime: 'edge',
};

// Default target: Ollama Cloud's public API
const DEFAULT_BASE = 'https://api.ollama.com';

// CORS headers attached to every response.
// Origin '*' is fine for a public proxy; if you want to lock it to your
// DesignMind domain only, replace '*' with 'https://designmind-studio.vercel.app'
// or the specific origin you control.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
  'Access-Control-Max-Age': '86400', // cache preflight for 24h
};

export default async function handler(req) {
  // ─── 1. CORS preflight ─────────────────────────────────────────────────
  // Browser sends OPTIONS before any cross-origin POST or any GET with custom
  // headers (Authorization, etc.). We must respond 200 with CORS headers,
  // not 404 — that was the bug killing every connection attempt.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // ─── 2. Parse the incoming URL ─────────────────────────────────────────
  // Vercel passes the full URL on req.url. We split off the proxy prefix
  // to extract the Ollama path (e.g. "/api/chat" or "/api/tags").
  const url = new URL(req.url);
  const fullPath = url.pathname; // e.g. "/api/proxy/api/chat"
  const ollamaPath = fullPath.replace(/^\/api\/proxy/, '') || '/';

  // Optional ?base= override for self-hosted Ollama servers
  const customBase = url.searchParams.get('base');
  const baseUrl = customBase ? customBase.replace(/\/$/, '') : DEFAULT_BASE;

  const targetUrl = baseUrl + ollamaPath;

  // ─── 3. Build the forwarded request ────────────────────────────────────
  // Forward Authorization header (Ollama API key) and Content-Type.
  // Drop Origin / Host / Referer so the upstream sees us as a clean client.
  const forwardHeaders = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);
  const ct = req.headers.get('content-type');
  if (ct) forwardHeaders.set('content-type', ct);
  const accept = req.headers.get('accept');
  if (accept) forwardHeaders.set('accept', accept);

  const forwardInit = {
    method: req.method,
    headers: forwardHeaders,
  };
  // Body only for non-GET/HEAD methods
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    forwardInit.body = req.body;
    // @ts-ignore — Edge runtime requires this for streaming bodies
    forwardInit.duplex = 'half';
  }

  // ─── 4. Fetch from Ollama ──────────────────────────────────────────────
  let upstream;
  try {
    upstream = await fetch(targetUrl, forwardInit);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'proxy_fetch_failed', detail: String(err && err.message || err), target: targetUrl }),
      { status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
    );
  }

  // ─── 5. Stream the response back with CORS headers ─────────────────────
  // We pass through the upstream body as-is so streaming (NDJSON for /api/chat)
  // works. Status code and content-type are preserved.
  const responseHeaders = new Headers(CORS_HEADERS);
  // Preserve content-type so streaming NDJSON / JSON parses correctly
  const upstreamCt = upstream.headers.get('content-type');
  if (upstreamCt) responseHeaders.set('content-type', upstreamCt);
  // Preserve cache hints if present
  const upstreamCache = upstream.headers.get('cache-control');
  if (upstreamCache) responseHeaders.set('cache-control', upstreamCache);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
