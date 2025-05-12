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
    (full.first_name || full.last_name) ? `${full.first_name || ''} ${full.last_name || ''}`.trim() :
    full.default_address?.company || full.addresses?.[0]?.company || 
    full.email || 
    `Client ${full.id}`
};


    } catch (err) {
      console.warn(`Erreur pour le client ${c.id} :`, err.message);
      return {
        id: c.id,
        first_name: "",
        last_name: "",
        company: "",
        email: ""
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

    const draft = await draftRes.json(); console.error("❌ Réponse Shopify lors du draft :", JSON.stringify(draft, null, 2));
 if (!draft.draft_order || !draft.draft_order.id) {
  console.error("❌ Erreur Shopify :", draft);
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
