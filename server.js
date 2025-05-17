// =========================================
// server.js
// Structuré en chapitres pour faciliter les modifications
// =========================================

// =========================================
// 1. IMPORTS ET CONFIGURATION
// =========================================
const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const fetch      = require('node-fetch');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

// Adresse interne pour copie des emails
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// Routes et enregistrement des webhooks
const syncCustomerData = require('./routes/sync-customer-data');
require('./scripts/register-webhook');

// =========================================
// 2. INITIALISATION DE L'APPLICATION
// =========================================
const app = express();
app.set('trust proxy', 1); // Faire confiance au proxy pour X-Forwarded-

// =========================================
// 3. CONSTANTES GLOBALES
// =========================================
const ALLOWED_ORIGINS = [
  "https://www.xn--zy-gka.com",
  "https://www.zyö.com",
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];

const shopifyBaseUrl = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

// =========================================
// 4. MIDDLEWARES GLOBAUX
// =========================================

// CORS personnalisé
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === "string" ? o === origin
      : o instanceof RegExp  ? o.test(origin)
      : false
    );
    if (ok) return callback(null, true);
    console.warn("⛔ Origine refusée :", origin);
    callback(new Error("CORS non autorisé"));
  },
  methods: ["GET","POST","PUT","OPTIONS"],        // ← autoriser PUT et OPTIONS
  allowedHeaders: ["Content-Type","X-API-KEY"],   // ← header X-API-KEY si utilisé
  optionsSuccessStatus: 200                       // ← pour que les prérequetes retournent OK
}));

// Parseur JSON
app.use(bodyParser.json());

// Limiteur global de requêtes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de requêtes. Veuillez réessayer plus tard." }
});
app.use(globalLimiter);

// =========================================
// 5. ROUTE WEBHOOK : /sync-customer-data
// =========================================
app.use('/sync-customer-data', syncCustomerData);

// =========================================
// 6. LIMITEUR POUR DRAFT ORDERS
// =========================================
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: "Trop de créations de commande. Veuillez patienter." }
});

// =========================================
// 7. ROUTE GET : /list-customers
//    Récupère la liste des clients pour le staff
// =========================================
app.get('/list-customers', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o instanceof RegExp && o.test(origin))) {
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
          const full = (await detailRes.json()).customer;
          return {
            id: full.id,
            label: (full.first_name || full.last_name)
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

// =========================================
// 8. ROUTE POST : /create-draft-order
//    Création de commandes provisoires
// =========================================
app.post('/create-draft-order', orderLimiter, async (req, res) => {
    console.log('→ hit /complete-draft-order with body:', req.body);
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.some(o => typeof o === 'string' ? o === origin : o instanceof RegExp && o.test(origin))) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }

  const { customer_id, items } = req.body;
  if (!customer_id || !items) {
    return res.status(400).json({ message: "Données manquantes" });
  }

  try {
    const draftRes = await fetch(`${shopifyBaseUrl}/draft_orders.json`, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft_order: {
          line_items: items,
          customer: { id: customer_id },
          use_customer_default_address: true,
          tags: "INTERNAL",
          note: "Commande créée depuis le Storefront interne"
        }
      })
    });
    const draft = await draftRes.json();
    if (!draft.draft_order?.id) {
      return res.status(500).json({ message: "Création échouée", raw: draft });
    }

    res.json({ invoice_url: draft.draft_order.invoice_url });
  } catch (err) {
    console.error("❌ Erreur /create-draft-order :", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

// =========================================
// 8.1. ROUTE POST : /complete-draft-order
//    Passe un draft_order en order confirmé
// =========================================

// Préflight CORS pour complete-draft-order
app.options('/complete-draft-order', cors({
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
  methods: ["POST","OPTIONS"],
  allowedHeaders: ["Content-Type","X-API-KEY"],
  optionsSuccessStatus: 200
}));

app.post('/complete-draft-order', cors(), async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }

  const { invoice_url } = req.body;
  if (!invoice_url) {
    return res.status(400).json({ message: "Missing invoice_url" });
  }

  try {
    const draftId = invoice_url.split('/').pop();

    // 1) Appel PUT vers Shopify pour compléter le draft
    const completeRes = await fetch(
      `${shopifyBaseUrl}/draft_orders/${draftId}/complete.json`,
      {
        method: 'PUT',  // PUT est l'HTTP verb attendu par Shopify
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Accept": "application/json"
        }
      }
    );

    // 2) Vérification du statut
    if (completeRes.status < 200 || completeRes.status >= 300) {
      const detail = await completeRes.text().catch(() => '');
      console.error('❌ Draft completion failed:', completeRes.status, detail);
      return res.status(500).json({
        message: 'Failed to complete draft',
        status: completeRes.status,
        detail
      });
    }

    // 3) Succès
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ /complete-draft-order error:', err);
    return res.status(500).json({ message: err.message });
  }
});

// =========================================
//  8.2. ROUTE POST : /send-order-confirmation
//  Envoie l’email de confirmation de commande (order) au client + copie interne
// =========================================

// Autoriser le preflight CORS
app.options('/send-order-confirmation', cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === "string" ? o === origin
      : o instanceof RegExp    ? o.test(origin)
                               : false
    );
    if (ok) return callback(null, true);
    callback(new Error("CORS non autorisé"));
  }
}));

app.post('/send-order-confirmation', async (req, res) => {
   console.log('→ hit /send-order-confirmation with body:', req.body);
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }

  const { customer_id, order_id, cc } = req.body;
  if (!customer_id || !order_id) {
    return res.status(400).json({ message: "Missing customer_id or order_id" });
  }

  try {
   // 1) Récupérer l’email du client
    const respCust = await fetch(
      `${shopifyBaseUrl}/customers/${customer_id}.json`,
      { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY } }
    );
    const custData     = await respCust.json();
    const customerEmail = custData.customer?.email;

    // 2) Construire la liste des destinataires
    const toList = [];
    if (customerEmail) toList.push(customerEmail);
    else console.warn("⚠️ Pas d’email client, j’envoie quand même à l’interne");
    if (Array.isArray(cc)) toList.push(...cc);

    // 3) Appeler l’API Shopify pour envoyer le reçu (order confirmation)
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

  return res.json({ success: true });
  } catch (err) {
    console.error("❌ /send-order-confirmation error:", err);
    return res.status(500).json({ message: err.message });
  }
});

// =========================================
// 9. ROUTE POST : /send-order-email
//    Envoi du reçu de commande après completion de draft
// =========================================
app.post('/send-order-email', async (req, res) => {
  console.log('📬 [send-order-email] req.body =', req.body);
  const { customer_id, invoice_url, cc } = req.body;
  if (!customer_id || !invoice_url) {
    return res.status(400).json({ message: 'Missing customer_id or invoice_url' });
  }

  try {
    // Récupérer l’email du client
    const respCust = await fetch(
      `${shopifyBaseUrl}/customers/${customer_id}.json`,
      { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY } }
    );
    const custData = await respCust.json();
    const customerEmail = custData.customer?.email;

    // Préparer la liste des destinataires
    const toList = [];
    if (customerEmail) toList.push(customerEmail);
    else console.warn('⚠️ Pas d’email client, j’envoie quand même à l’interne');
    toList.push(COPY_TO_ADDRESS);

    // Extraire l’ID du draft
    const draftId = invoice_url.split('/').pop();

    // Compléter la draft
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
    const orderId = completeData.order?.id;
    if (!orderId) {
      console.error('❌ Draft completion failed:', completeData);
      return res.status(500).json({ message: 'Failed to complete draft', raw: completeData });
    }

    // Envoyer le reçu
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
            to: toList.join(','),
            subject: "Votre confirmation de commande",
            custom_message: "Merci pour votre commande !"
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

// =========================================
// 10. LANCEMENT DU SERVEUR
// =========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});

