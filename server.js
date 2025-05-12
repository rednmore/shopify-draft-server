const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();

// ✅ Remplacez ici par votre domaine réel encodé si besoin (ex. pour zyö.com)
const ALLOWED_ORIGIN = "https://www.xn--zy-gka.com"; // ← changez ici si votre domaine change

app.use(cors({
  origin: ALLOWED_ORIGIN
}));

app.use(bodyParser.json());

// ⚠️ Sécurité temporairement désactivée pour tests
app.use((req, res, next) => {
  console.log("⚠️ Sécurité désactivée temporairement pour test.");
  next();
});

// 🔹 GET /list-customers
app.get('/list-customers', async (req, res) => {
  try {
    const r = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      }
    });

    const data = await r.json();

    if (!data.customers) {
      return res.status(500).json({ message: "Données introuvables", raw: data });
    }

  const clients = data.customers.map(c => ({
  id: c.id,
  first_name: c.first_name || "",
  last_name: c.last_name || "",
  company: c.company || "",
  email: c.email || ""
}));

    res.json(clients);
    console.log("👁️ Clients transmis au frontend :", clients);
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur : " + err.message });
  }
});

// 🔹 POST /create-draft-order
app.post('/create-draft-order', async (req, res) => {
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
          tags: ["INTERNAL"],
          note: "Commande créée depuis le Storefront interne"
        }
      })
    });

    const draft = await draftRes.json();
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
