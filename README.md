# DesignMind Ollama CORS Proxy

Vercel Edge serverless proxy that forwards browser requests to `api.ollama.com`
(or any custom Ollama server) with proper CORS headers.

## Why this exists

Ollama's API doesn't send `Access-Control-Allow-Origin` headers, which means
browsers block all direct cross-origin requests from web apps. This proxy
sits between your browser and Ollama, adds the missing CORS headers, and
streams responses straight through.

## What it routes

| Browser request | Forwards to |
|---|---|
| `GET  /api/proxy/api/tags` | `GET  https://api.ollama.com/api/tags` |
| `POST /api/proxy/api/chat` | `POST https://api.ollama.com/api/chat` (streaming NDJSON) |
| `POST /api/proxy/api/generate` | `POST https://api.ollama.com/api/generate` (streaming NDJSON) |
| `OPTIONS /api/proxy/*` | Returns `204` with CORS headers (preflight) |

For self-hosted Ollama, append `?base=https://your-server.com` to override
the default target.

## Deploy

```bash
npm install -g vercel
vercel --prod
```

This deploys to a unique URL like `https://designmind-ollama-proxy.vercel.app`.

## Use in DesignMind

1. Open Settings → Connect LLM → **Ollama Web**
2. Paste the proxy base URL (e.g. `https://designmind-ollama-proxy.vercel.app`)
   into the Step 2 field. DesignMind handles `/api/proxy` suffix automatically.
3. Paste your Ollama API key from <https://ollama.com/settings/keys>
4. Click Connect

## Architecture notes

- **Edge runtime is required.** Vercel's Node serverless runtime buffers
  responses — that breaks Ollama's NDJSON streaming. Edge runtime streams
  the body through unchanged.
- **CORS headers on every response.** Including OPTIONS preflight (returns
  204 with full CORS headers, not 404). This is what was missing in the
  original version of this proxy.
- **Forwards only essential headers.** Authorization, Content-Type, Accept.
  Strips Origin / Host / Referer so upstream sees a clean client.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `404 preflight` in Network tab | OPTIONS handler missing | Redeploy with the corrected `proxy.js` |
| `CORS error` on actual fetch | `Access-Control-Allow-Origin` missing | Same — corrected proxy adds these |
| `500` on /api/chat | Streaming buffered by Node runtime | Add `export const config = { runtime: 'edge' }` |
| `502 proxy_fetch_failed` | Upstream Ollama unreachable | Check Ollama API status, check `?base=` override |
| `401 Unauthorized` from upstream | API key missing or invalid | Check the key field in Connect screen |
