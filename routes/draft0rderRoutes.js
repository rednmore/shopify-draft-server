// routes/draftOrderRoutes.js

const express   = require('express');
const cors      = require('cors');
const fetch     = require('node-fetch');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const router = express.Router();

// ==== CONSTANTES (mêmes que dans server.js) ====
const ALLOWED_ORIGINS = [
  'https://www.xn--zy-gka.com',
  'https://www.zyö.com',
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];
// plus de template literal ici
const shopifyBaseUrl  = 'https://' + process.env.SHOPIFY_API_URL + '/admin/api/2023-10';
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// ==== LIMITEUR pour la complétion de draft orders ====
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Trop de créations de commande. Veuillez patienter.' }
});

// --- helpers CORS identiques à server.js ---
const corsOptions = {
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(function(o) {
      return typeof o === 'string'
        ? o === origin
        : o instanceof RegExp
          ? o.test(origin)
          : false;
    });
    if (ok) return callback(null, true);
    callback(new Error('CORS non autorisé'));
  },
  allowedHeaders: ['Content-Type','X-API-KEY'],
  optionsSuccessStatus: 200
};

// ===========================
// POST /complete-draft-order
// ===========================
router.options(
  '/complete-draft-order',
  cors(Object.assign({}, corsOptions, { methods: ['POST','OPTIONS'] }))
);
router.post(
  '/complete-draft-order',
  orderLimiter,
  cors(),
  async function(req, res) {
    const key = req.headers['x-api-key'] || req.query.key;
    if (!key || key !== process.env.API_SECRET) {
      return res.status(403).json({ message: 'Clé API invalide' });
    }
    const invoice_url = req.body.invoice_url;
    if (!invoice_url) {
      return res.status(400).json({ message: 'Missing invoice_url' });
    }
    try {
      const draftId = invoice_url.split('/').pop();
      const url     = shopifyBaseUrl + '/draft_orders/' + draftId + '/complete.json';
      const resp    = await fetch(url, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY }
      });
      if (!resp.ok) {
        const detail = await resp.text().catch(()=>'');
        return res.status(500).json({
          message: 'Failed to complete draft',
          status:  resp.status,
          detail:  detail
        });
      }
      const data  = await resp.json();
      const order = data.draft_order && data.draft_order.order;
      if (!order || !order.id) {
        return res.status(500).json({ message: 'No order ID returned', raw: data });
      }
      return res.json({ success: true, order_id: order.id });
    } catch (err) {
      console.error('/complete-draft-order error:', err);
      return res.status(500).json({ message: err.message });
    }
  }
);

// =========================================
// POST /send-order-confirmation
// =========================================
router.options(
  '/send-order-confirmation',
  cors(Object.assign({}, corsOptions, { methods: ['POST','OPTIONS'] }))
);
router.post(
  '/send-order-confirmation',
  cors(),
  async function(req, res) {
    const key = req.headers['x-api-key'] || req.query.key;
    if (!key || key !== process.env.API_SECRET) {
      return res.status(403).json({ message: 'Clé API invalide' });
    }
    const customer_id = req.body.customer_id;
    const order_id    = req.body.order_id;
    const cc          = req.body.cc;
    if (!customer_id || !order_id) {
      return res.status(400).json({ message: 'Missing customer_id or order_id' });
    }
    try {
      const custRes = await fetch(
        shopifyBaseUrl + '/customers/' + customer_id + '.json',
        { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY } }
      );
      const custData     = await custRes.json();
      const customerEmail = custData.customer && custData.customer.email;
      const toList = [];
      if (customerEmail) toList.push(customerEmail);
      if (Array.isArray(cc)) toList.push.apply(toList, cc);
      await fetch(
        shopifyBaseUrl + '/orders/' + order_id + '/send_receipt.json',
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: {
              to:             toList.join(','),
              subject:        'Votre confirmation de commande',
              custom_message: 'Merci pour votre commande !'
            }
          })
        }
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('/send-order-confirmation error:', err);
      return res.status(500).json({ message: err.message });
    }
  }
);

// ===========================
// POST /send-order-email
// ===========================
router.post(
  '/send-order-email',
  cors(),
  async function(req, res) {
    const customer_id = req.body.customer_id;
    const invoice_url = req.body.invoice_url;
    const cc          = req.body.cc;
    if (!customer_id || !invoice_url) {
      return res.status(400).json({ message: 'Missing customer_id or invoice_url' });
    }
    try {
      const custRes = await fetch(
        shopifyBaseUrl + '/customers/' + customer_id + '.json',
        { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY } }
      );
      const custData     = await custRes.json();
      const customerEmail = custData.customer && custData.customer.email;
      const toList = [ COPY_TO_ADDRESS ];
      if (customerEmail) toList.unshift(customerEmail);
      if (Array.isArray(cc)) toList.push.apply(toList, cc);
      const draftId = invoice_url.split('/').pop();
      const compRes = await fetch(
        shopifyBaseUrl + '/draft_orders/' + draftId + '/complete.json',
        {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY }
        }
      );
      const compData = await compRes.json();
      const orderId  = compData.order && compData.order.id;
      if (!orderId) {
        return res.status(500).json({ message: 'Failed to complete draft', raw: compData });
      }
      await fetch(
        shopifyBaseUrl + '/orders/' + orderId + '/send_receipt.json',
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
            'Content-Type':          'application/json'
          },
          body: JSON.stringify({
            email: {
              to:             toList.join(','),
              subject:        'Votre confirmation de commande',
              custom_message: 'Merci pour votre commande !'
            }
          })
        }
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('/send-order-email error:', err);
      return res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
