// routes/draftOrderRoutes.js

const express       = require('express');
const cors          = require('cors');
const fetch         = require('node-fetch');
const rateLimit     = require('express-rate-limit');
require('dotenv').config();

const router = express.Router();

// ==== CONSTANTES (mêmes que dans server.js) ====
const ALLOWED_ORIGINS = [
  "https://www.xn--zy-gka.com",
  "https://www.zyö.com",
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];
const shopifyBaseUrl  = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// ==== LIMITEUR pour la complétion de draft orders ====
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: "Trop de créations de commande. Veuillez patienter." }
});

// --- helpers CORS identiques à server.js ---
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === "string" ? o === origin
      : o instanceof RegExp  ? o.test(origin)
      : false
    );
    if (ok) return callback(null, true);
    callback(new Error("CORS non autorisé"));
  },
  allowedHeaders: ["Content-Type","X-API-KEY"],
  optionsSuccessStatus: 200
};

// ===========================
// POST /complete-draft-order
// ===========================
router.options(
  '/complete-draft-order',
   cors({ ...corsOptions, methods: ["POST","OPTIONS"] })
);
router.post(
  '/complete-draft-order',
  orderLimiter,
  cors(),  // hérite de la config globale cors() déjà appliquée en server.js
  async (req, res) => {
    const clientKey = req.headers["x-api-key"] || req.query.key;
    if (!clientKey || clientKey !== process.env.API_SECRET) {
      return res.status(403).json({ message: "Clé API invalide" });
    }

    const { invoice_url } = req.body;
    if (!invoice_url) {
      return res.status(400).json({ message: "Missing invoice_url" });
    }

    try {
      const draftId  = invoice_url.split('/').pop();
      const draftUrl = `${shopifyBaseUrl}/draft_orders/${draftId}/complete.json`;

      const completeRes = await fetch(draftUrl, {
        method: 'POST',
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Accept": "application/json"
        }
      });

      if (!completeRes.ok) {
        const detail = await completeRes.text().catch(() => '');
        return res.status(500).json({
          message: 'Failed to complete draft',
          status:  completeRes.status,
          detail
        });
      }

      const { draft_order } = await completeRes.json();
      const order = draft_order?.order;
      if (!order?.id) {
        return res.status(500).json({ message: 'No order ID returned', raw: draft_order });
      }

      res.json({ success: true, order_id: order.id });
    } catch (err) {
      console.error('/complete-draft-order error:', err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ===================================
// POST /send-order-confirmation
// ===================================
router.options(
  '/send-order-confirmation',
  cors({ ...corsOptions, methods: ["POST","OPTIONS"] })
);
router.post(
  '/send-order-confirmation',
  cors(),
  async (req, res) => {
    const clientKey = req.headers["x-api-key"] || req.query.key;
    if (!clientKey || clientKey !== process.env.API_SECRET) {
      return res.status(403).json({ message: "Clé API invalide" });
    }

    const { customer_id, order_id, cc } = req.body;
    if (!customer_id || !order_id) {
      return res.status(400).json({ message: "Missing customer_id or order_id" });
    }

    try {
      // récupérer email client
      const respCust = await fetch(
        `${shopifyBaseUrl}/customers/${customer_id}.json`,
        { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY } }
      );
      const custData      = await respCust.json();
      const customerEmail = custData.customer?.email;

      const toList = [];
      if (customerEmail) toList.push(customerEmail);
      if (Array.isArray(cc)) toList.push(...cc);

      await fetch(
        `${shopifyBaseUrl}/orders/${order_id}/send_receipt.json`,
        {
          method: 'POST',
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: {
              to:              toList.join(','),
              subject:         "Votre confirmation de commande",
              custom_message:  "Merci pour votre commande !"
            }
          })
        }
      );

      res.json({ success: true });
    } catch (err) {
      console.error('/send-order-confirmation error:', err);
      res.status(500).json({ message: err.message });
    }
  }
);

// ===========================
// POST /send-order-email
// ===========================
router.post(
  '/send-order-email',
  cors(),
  async (req, res) => {
    const { customer_id, invoice_url, cc } = req.body;
    if (!customer_id || !invoice_url) {
      return res.status(400).json({ message: 'Missing customer_id or invoice_url' });
    }

    try {
      // récupérer email client
      const respCust = await fetch(
        `${shopifyBaseUrl}/customers/${customer_id}.json`,
        { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY } }
      );
      const custData      = await respCust.json();
      const customerEmail = custData.customer?.email;

      const toList = [ COPY_TO_ADDRESS ];
      if (customerEmail) toList.unshift(customerEmail);
      if (Array.isArray(cc)) toList.push(...cc);

      // compléter le draft
      const draftId     = invoice_url.split('/').pop();
      const completeRes = await fetch(
        `${shopifyBaseUrl}/draft_orders/${draftId}/complete.json`,
        {
          method: 'POST',
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
            "Content-Type": "application/json"
          }
        }
      );
      const completeData = await completeRes.json();
      const orderId      = completeData.order?.id;
      if (!orderId) {
        return res.status(500).json({ message: 'Failed to complete draft', raw: completeData });
      }

      // envoyer le reçu
      await fetch(
        `${shopifyBaseUrl}/orders/${orderId}/send_receipt.json`,
        {
          method: 'POST',
          headers: {
            "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: {
              to:              toList.join(','),
              subject:         "Votre confirmation de commande",
              custom_message:  "Merci pour votre commande !"
            }
          })
        }
      );

      res.json({ success: true });
    } catch (err) {
      console.error('/send-order-email error:', err);
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
