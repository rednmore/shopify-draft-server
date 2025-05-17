// server.js

const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');
const fetch      = require('node-fetch');
const rateLimit  = require('express-rate-limit');
require('dotenv').config();

// Adresse CC par défaut
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

const syncCustomerData = require('./routes/sync-customer-data');
require('./scripts/register-webhook');

const app = express();

// ─── Faire confiance au proxy de Render pour X-Forwarded-* ───
app.set('trust proxy', 1);

const ALLOWED_ORIGINS = [
  "https://www.xn--zy-gka.com",
  "https://www.zyö.com"
];

// Shopify base URL construit dynamiquement
const shopifyBaseUrl = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

// Limiteur global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de requêtes. Veuillez réessayer plus tard." }
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn("⛔ Origine refusée :", origin);
      callback(new Error("CORS non autorisé"));
    }
  }
}));

app.use(bodyParser.json());
app.use(globalLimiter);
app.use('/sync-customer-data', syncCustomerData);

// Limiteur sur la route /create-draft-order
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: "Trop de créations de commande. Veuillez patienter." }
});

// GET /list-customers
app.get('/list-customers', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  const serverKey = process.env.API_SECRET;
  const origin    = req.get('origin');

  if (!clientKey || clientKey !== serverKey) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }

  try {
    const r = await fetch(`${shopifyBaseUrl}/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const data = await r.json();
    if (!data.customers) {
      return res.status(500).json({ message: "Aucun client trouvé", raw: data });
    }

    const clients = await Promise.all(
      data.customers.map(async (c) => {
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
        } catch (err) {
          console.warn(`⚠️ Erreur client ${c.id} :`, err.message);
          return { id: c.id, label: `Client ${c.id}` };
        }
      })
    );

    res.json(clients);
  } catch (err) {
    console.error("❌ Erreur /list-customers :", err.message);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

// POST /create-draft-order
app.post('/create-draft-order', orderLimiter, async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  const serverKey = process.env.API_SECRET;
  const origin    = req.get('origin');

  if (!clientKey || clientKey !== serverKey) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }

  const { customer_id, items } = req.body;
  if (!customer_id || !items) {
    return res.status(400).json({ message: "Données manquantes" });
  }

  try {
    // Création de la draft order
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
      console.error("❌ Erreur création draft :", draft);
      return res.status(500).json({ message: "Création échouée", raw: draft });
    }

    const draftId    = draft.draft_order.id;
    const invoiceUrl = draft.draft_order.invoice_url;

    // Récupérer l’email du client
    const custRes = await fetch(
      `${shopifyBaseUrl}/customers/${customer_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    const custData      = await custRes.json();
    const customerEmail = custData.customer?.email || '';

    // Construire la liste des destinataires
    const toList = [customerEmail, COPY_TO_ADDRESS]
      .filter(Boolean)
      .join(',');

    // Envoyer l’invoice via l’API Shopify au client + CC
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
            to:             toList,
            subject:        "Votre facture de commande",
            custom_message: "Merci pour votre commande ! Voici votre facture."
          }
        })
      }
    );

    // Répondre avec l’URL de la facture
    res.json({ invoice_url: invoiceUrl });

  } catch (err) {
    console.error("❌ Erreur /create-draft-order :", err.message);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

// Envoi facture par email…

app.post('/send-order-email', async (req, res) => {
  // 1) Log de ce que tu reçois
  console.log('📬 [send-order-email] req.body =', req.body);

  // 2) Validation
  const { customer_id, invoice_url, cc } = req.body;
  if (!customer_id || !invoice_url) {
    console.warn('⚠️ Missing customer_id or invoice_url', { customer_id, invoice_url });
    return res.status(400).json({ message: 'Missing customer_id or invoice_url' });
  }

  try {
    // 3) Récupérer l’email du client
    const custRes = await fetch(
      `${shopifyBaseUrl}/customers/${customer_id}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );
    const custData = await custRes.json();
    console.log('🔍 Shopify customer response:', JSON.stringify(custData, null, 2));
    const customerEmail = custData.customer?.email;
    if (!customerEmail) {
      console.error('❌ Email client introuvable pour customer_id=', customer_id);
      return res.status(400).json({ message: 'Customer email not found' });
    }

    // 4) Envoyer l’email/invoice (ici on réutilise l’API Shopify pour renvoyer la facture)
    await fetch(
      `${shopifyBaseUrl}/draft_orders/${invoice_url.split('/').pop()}/send_invoice.json`,
      {
        method: 'POST',
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          draft_invoice: {
            to:      [customerEmail, ...(cc||[])].join(','),
            subject: "Votre facture de commande",
            custom_message: "Merci pour votre commande !"
          }
        })
      }
    );

    // 5) Répondre OK
    res.json({ success: true });
  } catch (err) {
    console.error('❌ /send-order-email error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});
