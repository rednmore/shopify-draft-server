const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// 🔐 Autorise uniquement votre domaine Shopify
const ALLOWED_ORIGIN = "https://www.xn--zy-gka.com";

app.use(cors({
  origin: ALLOWED_ORIGIN
}));

app.use(bodyParser.json());

// 🔹 GET /list-customers
app.get('/list-customers', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  const serverKey = process.env.API_SECRET;

  console.log("🔐 Clé reçue (list-customers):", clientKey);
  console.log("🔒 Clé attendue :", serverKey);

  if (!clientKey || clientKey !== serverKey) {
    console.warn("⛔ Accès refusé à /list-customers");
    return res.status(403).json({ message: "Accès interdit (clé API invalide)" });
  }

  try {
    const r = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const data = await r.json();
    console.log("👁️ Extrait brut du client 0 :", data.customers?.[0]);

    if (!data.customers) {
      return res.status(500).json({ message: "Données introuvables", raw: data });
    }

    const basicCustomers = data.customers;

    const clients = await Promise.all(
      basicCustomers.map(async (c) => {
        try {
          const detailRes = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/customers/${c.id}.json`, {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
              "Content-Type": "application/json"
            }
          });

          const detail = await detailRes.json();
          const full = detail.customer;

          return {
            id: full.id,
            label:
              (full.first_name || full.last_name)
                ? `${full.first_name || ''} ${full.last_name || ''}`.trim()
                : full.default_address?.company || full.addresses?.[0]?.company ||
                  full.email || `Client ${full.id}`
          };
        } catch (err) {
          console.warn(`Erreur pour le client ${c.id} :`, err.message);
          return {
            id: c.id,
            label: `Client ${c.id}`
          };
        }
      })
    );

    res.json(clients);
    console.log("👁️ Clients transmis au frontend :", clients);
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur : " + err.message });
  }
});

// 🔹 POST /create-draft-order
app.post('/create-draft-order', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  const serverKey = process.env.API_SECRET;

  console.log("🔐 Clé reçue (create-draft-order):", clientKey);
  console.log("🔒 Clé attendue :", serverKey);

  if (!clientKey || clientKey !== serverKey) {
    console.warn("⛔ Accès refusé à /create-draft-order");
    return res.status(403).json({ message: "Accès interdit (clé API invalide)" });
  }

  const { customer_id, items } = req.body;
  if (!customer_id || !items) {
    return res.status(400).json({ message: "Données manquantes" });
  }

  try {
    const draftRes = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/draft_orders.json`, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
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
    console.error("❌ Réponse Shopify lors du draft :", JSON.stringify(draft, null, 2));

    if (!draft.draft_order || !draft.draft_order.id) {
      return res.status(500).json({ message: "Erreur lors de la création du draft order", raw: draft });
    }

    const id = draft.draft_order.id;

    // 🔹 Envoi automatique de la facture
    await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/draft_orders/${id}/send_invoice.json`, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft_order_invoice: {
          to: null,
          from: null,
          subject: null,
          custom_message: null
        }
      })
    });

    res.json({ invoice_url: draft.draft_order.invoice_url });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur : " + err.message });
  }
});

// 🚀 Démarrage du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});
