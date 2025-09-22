# Shopify Draft Server

Small Node.js/Express server to create and manage Shopify draft orders, send confirmations, and sync customer data via webhook. Deployed on Render.

## Files hierarchy

```
shopify-draft-server/
  package.json
  render.yaml
  server.js
  routes/
    draftOrderRoutes.js
    sync-customer-data.js
  scripts/
    register-webhook.js
  snippets/
    regpro-recaptcha-loader.liquid
  shopify/
    assets/ ...
    layout/ ...
    sections/ ...
    snippets/ ...
    templates/ ...
```

## Technologies used

- Node.js (>= 18) with native `fetch`
- Express 4 (HTTP server, routing)
- CORS (`cors`)
- Rate limiting (`express-rate-limit`)
- Environment variables (`dotenv`)
- HTTP clients: `axios` and native `fetch`
- Shopify Admin REST API (version 2023-10)
- Render (deployment) via `render.yaml`

## Purpose of each file

- `package.json`: Project metadata, Node engine (>=18), start script, dependencies.
- `render.yaml`: Render service definition (repo, region, env vars, build/start commands).
- `server.js`:
  - Initializes Express app, trust proxy, CORS, body parsing, global rate limiter, and a `/health` endpoint.
  - Mounts routes:
    - `/sync-customer-data` webhook (customers/create → enrich address, VAT metafield, tags).
    - Draft order routes at `/` (create/complete/send email).
  - Defines `GET /list-customers` (requires `X-API-KEY`) and enriches labels by fetching each customer detail.
  - Starts HTTP server on `PORT` (defaults to 3000).
- `routes/draftOrderRoutes.js`:
  - `POST /create-draft-order`: Create a draft order from `{ customer_id, items }`.
  - `POST /complete-draft-order`: Complete an existing draft order `{ draft_id }`.
  - `POST /send-order-confirmation`: Send order receipt email for `{ order_id, customer_id, cc? }`.
  - `POST /send-order-email`: Complete a draft and send receipt to customer + CC list.
  - Per-route rate limiting for order creation/completion.
- `routes/sync-customer-data.js`:
  - Webhook target (mounted at `/sync-customer-data`).
  - On `customers/create`, fetch full customer, parse `customer.note` JSON, update default address, store VAT in metafield, and add a `TVA:<number>` tag.
- `scripts/register-webhook.js`:
  - On startup, idempotently registers the `customers/create` webhook to `PUBLIC_WEBHOOK_URL` (or a default Render URL) using native `fetch`.
- `snippets/regpro-recaptcha-loader.liquid`:
  - Client-side Shopify theme snippet to load reCAPTCHA v3 and post a form payload to a backend endpoint (placeholder `ENDPOINT`).
- `shopify/`:
  - Theme artifacts used on the storefront; not executed by this Node server.

## Potential issues / risks

- Secrets in logs: `server.js` logs `API_SECRET`, `SHOPIFY_API_KEY`, etc. to console on boot. This is sensitive and should be removed.
- Missing dependency: `server.js` requires `body-parser`, but it is not listed in `package.json`. Either add `body-parser` or switch to `express.json()`.
- Inconsistent Shopify base URL handling:
  - `server.js` builds `https://<SHOPIFY_API_URL>/admin/api/2023-10`.
  - `routes/sync-customer-data.js` uses `SHOPIFY_API_URL` directly (no protocol or `/admin/api/<version>`). Ensure the env variable format is consistent or normalize in code.
- Outdated API version: Admin API `2023-10` is old; consider upgrading to a current stable version across all files.
- CORS inconsistencies:
  - `server.js` defines a specific `ALLOWED_ORIGINS` (includes IKYUM) and strict options.
  - `routes/draftOrderRoutes.js` mixes `corsOptions` (strict) with bare `cors()` (permissive) on some routes. Align to a single, strict CORS policy.
- Authentication gaps:
  - `POST /send-order-email` in `draftOrderRoutes.js` does not check `X-API-KEY` while other routes do. Add the same API key validation.
  - Webhook route does not verify Shopify HMAC signature; add HMAC verification to trust payloads.
- Email behavior:
  - `COPY_TO_ADDRESS` default is a production email and may leak receipts; ensure it’s configurable per environment.
- Performance / rate limits:
  - `GET /list-customers` fetches details for up to 100 customers individually (N+1 requests). This may hit Shopify rate limits; consider pagination, fields filtering, or GraphQL.
- Hardcoded defaults:
  - `scripts/register-webhook.js` falls back to a hardcoded Render URL if `PUBLIC_WEBHOOK_URL` is missing.
  - reCAPTCHA site keys are embedded in a public snippet; rotate keys if the repo is public.

## Environment variables

- `SHOPIFY_API_URL` (e.g. `your-shop.myshopify.com` — or full base if you choose that convention)
- `SHOPIFY_API_KEY` (Admin API access token)
- `API_SECRET` (shared secret for server endpoints)
- `PORT` (optional; defaults to 3000)
- `PUBLIC_WEBHOOK_URL` (optional; full URL for webhook registration)
- `COPY_TO_ADDRESS` (optional; default CC for receipts)

## Run locally

- Node 18+: `npm install` then `npm start`
- Ensure all required env vars are set (use a `.env` file with `dotenv`).


