# Shopify Draft Server

Small Node.js/Express server to create and manage Shopify draft orders, send confirmations, and sync customer data via webhook. Deployed on Render.

## Files hierarchy

```
shopify-draft-server/
  package.json
  env.template
  render.yaml
  server.js
  routes/
    draftOrderRoutes.js
    sync-customer-data.js
  scripts/
    setup-env.js          # Interactive environment setup
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
- Interactive CLI (`prompts`)
- Email sending (`nodemailer`)
- Shopify Admin REST API (version 2023-10)
- Render (deployment) via `render.yaml`

## Purpose of each file

- `package.json`: Project metadata, Node engine (>=18), scripts (start, setup), dependencies.
- `env.template`: Environment variables template with detailed documentation.
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
- `scripts/setup-env.js`:
  - Interactive CLI tool for environment configuration (run via `npm run setup`).
  - Provides guided setup with validation, secure defaults, and automatic .env generation.
  - Supports quick mode (`npm run setup:quick`) for essential Shopify settings only.
- `scripts/register-webhook.js`:
  - On startup, idempotently registers the `customers/create` webhook to `PUBLIC_WEBHOOK_URL` (or a default Render URL) using native `fetch`.
- `snippets/regpro-recaptcha-loader.liquid`:
  - ⚠️ **DEPRECATED** - Client-side Shopify theme snippet with Google reCAPTCHA v3 code (should be removed).
- `shopify/`:
  - Theme artifacts used on the storefront; not executed by this Node server.

## Webhook Architecture

This application uses **Shopify webhooks** (not Render webhooks) for real-time customer data synchronization:

### Shopify Webhooks (✅ Implemented)

- **Direction**: Shopify → Your Server
- **Purpose**: Notify server when customers are created/updated
- **Endpoint**: `/sync-customer-data`
- **Topics**: `customers/create`, `customers/update`
- **Registration**: Automatic via `scripts/register-webhook.js` on server startup
- **Handler**: `routes/sync-customer-data.js`

**How it works:**

1. Server starts → `register-webhook.js` registers webhooks with Shopify
2. Customer created/updated in Shopify → Shopify sends POST to `PUBLIC_WEBHOOK_URL/sync-customer-data`
3. Server processes customer data → Updates addresses, metafields, tags automatically

### Render Webhooks (❌ Not implemented)

- **Status**: Not currently configured
- **Purpose**: Would be for deployment notifications (Render → External service)
- **Documentation**: [Render WebHooks Docs](https://render.com/docs/webhooks) (for future reference)

> **Note**: The `PUBLIC_WEBHOOK_URL` environment variable refers to where **Shopify** should send webhooks TO your server, not where your server sends webhooks to Render.

## CAPTCHA Configuration

This application now uses **Shopify's built-in hCaptcha** instead of Google reCAPTCHA for spam protection:

### ✅ **Server-side** (Already Updated)

- Removed Google reCAPTCHA verification from server endpoints
- Forms now rely on Shopify's automatic hCaptcha protection

### ⚠️ **Client-side** (Manual Cleanup Required)

The following Shopify theme files contain legacy Google reCAPTCHA code that should be updated:

**Files to update:**

- `shopify/snippets/regpro-recaptcha-loader.liquid` - Remove or replace with simplified form handler
- `shopify/sections/main-register-advanced.liquid` - Remove reCAPTCHA loading and token generation
- `snippets/regpro-recaptcha-loader.liquid` - Remove from project

**Required changes:**

1. Remove Google reCAPTCHA script loading (`grecaptcha` code)
2. Remove reCAPTCHA token generation and validation
3. Ensure `{{ content_for_header }}` is included in theme layouts
4. Verify hCaptcha is enabled in Shopify Admin > Online Store > Preferences

**How Shopify hCaptcha works:**

- Automatically analyzes visitor behavior without user interaction
- Shows interactive challenge only when suspicious activity detected
- Works with forms that have proper `action` and `form_type` attributes
- No additional configuration needed - enabled via Shopify admin settings

Reference: [Shopify CAPTCHA Documentation](https://shopify.dev/docs/storefronts/themes/trust-security/captcha)

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
  - `COPY_TO_ADDRESS` default is a production email and may leak receipts; ensure it's configurable per environment.
- Performance / rate limits:
  - `GET /list-customers` fetches details for up to 100 customers individually (N+1 requests). This may hit Shopify rate limits; consider pagination, fields filtering, or GraphQL.
- Hardcoded defaults:
  - `scripts/register-webhook.js` falls back to a hardcoded Render URL if `PUBLIC_WEBHOOK_URL` is missing.
- Spam protection:
  - Uses Shopify's built-in hCaptcha instead of Google reCAPTCHA (legacy reCAPTCHA code should be removed from theme files).

## Quick Start

**Web links:**

- 🌐 Zyo website: [www.zyö.com](https://www.zyö.com) / [www.xn--zy-gka.com](https://www.xn--zy-gka.com)
- 🌐 Ikyum website: [www.ikyum.com](https://www.ikyum.com)
- 🌐 Render URL: [https://shopify-draft-server.onrender.com](https://shopify-draft-server.onrender.com)
- 🛍️ Shopify admin apps: [staff order creator](https://admin.shopify.com/store/21qdxp-hd/settings/apps/development)
- ⚙️ Shopify [domains](https://admin.shopify.com/store/21qdxp-hd/settings/domains)
- 📝 Render Dashboard (environment variables): [https://dashboard.render.com/web/srv-d0gt70be5dus73alpc1g/env](https://dashboard.render.com/web/srv-d0gt70be5dus73alpc1g/env)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (Interactive setup)

```bash
# Quick setup - only essential Shopify settings
npm run setup:quick

# Full setup - all configuration options
npm run setup
```

The interactive setup will:

- Guide you through all required environment variables
- Generate secure API secrets automatically
- Create a `.env` file with your configuration
- Provide helpful hints and validation

### 3. Run the server

```bash
npm start
```

## Setup Script Examples

### Quick Setup (Essential Shopify settings only)

```bash
npm run setup:quick
```

This will prompt for:

- Shopify store domain
- Shopify Admin API access token
- API secret (auto-generated or custom)

### Full Setup (All configuration options)

```bash
npm run setup
```

This will guide you through all environment variables including:

- Core Shopify settings
- Email/SMTP configuration
- Optional branding and server settings

The script provides:

- ✅ Input validation and helpful error messages
- ✅ Secure auto-generation of API secrets
- ✅ Helpful hints and examples for each setting
- ✅ Compact, well-commented `.env` file generation

## Environment Variables

### Required (Core Shopify Integration)

- `SHOPIFY_API_URL` - Your Shopify store domain (e.g., `your-shop.myshopify.com`)
- `SHOPIFY_API_KEY` - Shopify Admin API access token (starts with `shpat_`)
- `API_SECRET` - Shared secret for API authentication between theme and server

### Required for Email Features

- `IKYUM_SMTP_USER` - SMTP email username
- `IKYUM_SMTP_PASS` - SMTP email password
- `IKYUM_ADMIN_RECIPIENTS` - Admin email addresses (comma-separated)

### Optional (with defaults)

- `PORT` - Server port (default: 3000, auto-set by hosting platforms)
- `PUBLIC_WEBHOOK_URL` - Webhook endpoint URL for Shopify
- `IKYUM_SMTP_HOST` - SMTP server (default: `mail.infomaniak.com`)
- `IKYUM_SMTP_PORT` - SMTP port (default: 587)
- `IKYUM_SMTP_FROM` - Email "From" address
- `COPY_TO_ADDRESS` - Fallback email for copies
- `IKYUM_BRAND` - Brand name used in emails

> **Tip**: Use the interactive setup script (`npm run setup`) instead of configuring manually. It provides validation, secure defaults, and helpful guidance.
