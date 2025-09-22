I'll search through the codebase to identify all external APIs being accessed.

[6 tools called]

Based on my analysis of the codebase, here are all the external APIs accessed by this Shopify Draft Server application:

## **Shopify Admin REST API**

- **Base URL**: `https://{SHOPIFY_API_URL}/admin/api/2023-10`
- **Endpoints used**:
  - `/customers.json` - List customers (GET)
  - `/customers/{id}.json` - Get customer details (GET)
  - `/customers/search.json` - Search customers by email (GET)
  - `/customers.json` - Create new customer (POST)
  - `/customers/{id}/addresses.json` - Get/create customer addresses (GET/POST)
  - `/customers/{id}/addresses/{id}.json` - Update customer address (PUT)
  - `/customers/{id}/addresses/{id}/default.json` - Set default address (PUT)
  - `/customers/{id}/metafields.json` - Get/create customer metafields (GET/POST)
  - `/metafields/{id}.json` - Update metafields (PUT)
  - `/draft_orders.json` - Create draft orders (POST)
  - `/draft_orders/{id}/complete.json` - Complete draft orders (PUT)
  - `/orders/{id}/send_receipt.json` - Send order receipts (POST)
  - `/webhooks.json` - Manage webhooks (GET/POST)
- **Authentication**: X-Shopify-Access-Token header

## **Google reCAPTCHA v3**

- **Verification URL**: `https://www.google.com/recaptcha/api/siteverify`
- **Client API**: `https://www.google.com/recaptcha/api.js?render={SITE_KEY}`
- **Purpose**: Form submission protection for registration forms
- **Site Keys**:
  - `6LcZNLkrAAAAAOW2H08jogeIXhjw0S59U1cwKoUw` (for both domains)

## **Geoapify Geocoding API**

- **URL**: `https://api.geoapify.com/v1/geocode/autocomplete`
- **Purpose**: Address autocomplete functionality in registration forms
- **Parameters**: text, filter, limit, format, apiKey

## **SMTP Email Service (Infomaniak)**

- **Host**: `mail.infomaniak.com` (default)
- **Port**: 587 (STARTTLS)
- **Purpose**: Sending registration confirmation emails via nodemailer
- **Authentication**: SMTP username/password

## **Shopify Cart API (Client-side)**

- **Endpoints**:
  - `/cart.js` - Get cart contents (GET)
  - `/cart/add.js` - Add items to cart (POST)
  - `/cart/clear.js` - Clear cart (POST)
- **Purpose**: Cart management in Shopify theme assets

## **Webhook Endpoints**

- **Registration Target**:
  - Default: `https://shopify-test-server-05d9.onrender.com/sync-customer-data`
  - Configurable via `PUBLIC_WEBHOOK_URL` environment variable
- **Topics**: `customers/create`, `customers/update`

## **Internal API Endpoints**

The application also exposes its own API endpoints that are called by the Shopify theme:

- **Base URL**: `https://shopify-test-server-05d9.onrender.com` (or custom Render URL)
- **Endpoints**:
  - `/create-draft-order`
  - `/complete-draft-order`
  - `/send-order-confirmation`
  - `/send-order-email`
  - `/list-customers`
  - `/create-customer`
  - `/ikyum/regpro/submit`

## **Authentication Methods**

- **Shopify API**: X-Shopify-Access-Token header
- **Internal APIs**: X-API-KEY header or query parameter
- **reCAPTCHA**: Site key validation
- **SMTP**: Username/password authentication
- **Geoapify**: API key parameter

The application primarily integrates with Shopify's ecosystem while using Google reCAPTCHA for security, Geoapify for address autocomplete, and Infomaniak for email services.
