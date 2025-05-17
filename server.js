// server.js

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const fetch      = require('node-fetch');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

// Adresse interne en copie
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// routes and webhooks
const syncCustomerData = require('./routes/sync-customer-data');
require('./scripts/register-webhook');

const app = express();

// ─── Faire confiance au proxy de Render pour X-Forwarded-* ───
app.set('trust proxy', 1);

// Middlewares
const ALLOWED_ORIGINS = [
  "https://www.xn--zy-gka.com",
  "https://www.zyö.com",
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];

// Shopify base URL
const shopifyBaseUrl = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === "string"  ? o === origin
    : o instanceof RegExp      ? o.test(origin)
                               : false
    );
    if (ok) return callback(null, true);
    console.warn("⛔ Origine refusée :", origin);
    callback(new Error("CORS non autorisé"));
  }
}));

app.use(bodyParser.json());

// Limiteur global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de requêtes. Veuillez réessayer plus tard." }
});
app.use(globalLimiter);

// Route de sync (webhook)
app.use('/sync-customer-data', syncCustomerData);

// Limiteur spécifique pour la création de draft orders
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: "Trop de créations de commande. Veuillez patienter." }
});


// 🔹 GET /list-customers
app.get('/list-customers', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }

  try {
    const shopRes = await fetch(`${shopifyBaseUrl}/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
        "Content-Type": "application/json"
      }
    });
    const data = await shopRes.json();
    if (!data.customers) {
      return res.status(500).json({ message: "Aucun client trouvé", raw: data });
    }

    const clients = await Promise.all(
      data.customers.map(async c => {
        try {
          const detailRes = await fetch(`${shopifyBaseUrl}/customers/${c.id}.json`, {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
              "Content-Type": "application/json"
            }
          });
          const detail = await detailRes.json();
          const full   = detail.customer;
          return {
            id: full.id,
            label:
              (full.first_name || full.last_name)
                ? `${full.first_name || ''} ${full.last_name || ''}`.trim()
                : full.default_address?.company
                  || full.addresses?.[0]?.company
                  || full.email
                  || `Client ${full.id}`
          };
        } catch {
          return { id: c.id, label: `Client ${c.id}` };
        }
      })
    );

    res.json(clients);
  } catch (err) {
    console.error("❌ Erreur /list-customers :", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});


// 🔹 POST /create-draft-order
app.post('/create-draft-order', orderLimiter, async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }

  const { customer_id, items } = req.body;
  if (!customer_id || !items) {
    return res.status(400).json({ message: "Données manquantes" });
  }

  try {
    // 1) Création du draft
    const draftRes = await fetch(`${shopifyBaseUrl}/draft_orders.json`, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft_order: {
          line_items:                    items,
          customer: { id: customer_id },
          use_customer_default_address: true,
          tags:                          "INTERNAL",
          note:                          "Commande créée depuis le Storefront interne"
        }
      })
    });
    const draft = await draftRes.json();
    if (!draft.draft_order?.id) {
      return res.status(500).json({ message: "Création échouée", raw: draft });
    }

    // 2) Retourne simplement l’URL de la facture
    res.json({ invoice_url: draft.draft_order.invoice_url });
  } catch (err) {
    console.error("❌ Erreur /create-draft-order :", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});


// 🔹 POST /send-order-email
app.post('/send-order-email', async (req, res) => {
  console.log('📬 [send-order-email] req.body =', req.body);
  const { customer_id, invoice_url, cc } = req.body;
  if (!customer_id || !invoice_url) {
    return res.status(400).json({ message: 'Missing customer_id or invoice_url' });
  }

  try {
    // 1) Récupérer l’email du client
    const respCust = await fetch(
      `${shopifyBaseUrl}/customers/${customer_id}.json`,
      {
        headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY }
      }
    );
    const custData = await respCust.json();
    console.log('🔍 Shopify customer response:', JSON.stringify(custData, null, 2));
    const customerEmail = custData.customer?.email;

    // 2) Construire la liste des destinataires
    const toList = [];
    if (customerEmail) {
      toList.push(customerEmail);
    } else {
      console.warn('⚠️ Pas d’email client, j’envoie quand même à l’interne');
    }
    toList.push(COPY_TO_ADDRESS);

    // 3) Extraire l’ID du draft de l’URL
    const draftId = invoice_url.split('/').pop();

    // 4) Renvoyer la facture via l’API Shopify
    await fetch(
      `${shopifyBaseUrl}/draft_orders/${draftId}/send_invoice.json`,
      {
        method: 'POST',
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draft_invoice: {
            to:              toList.join(','),
            subject:         "Votre facture de commande",
            custom_message:  "Merci pour votre commande !"
          }
        })
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('❌ /send-order-email error:', err);
    res.status(500).json({ message: err.message });
  }
});


// 🚀 Lancement du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});
