const express = require('express');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Liste des clients
app.get('/list-customers', async (req, res) => {
  try {
    const r = await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      }
    });
const data = await r.json();
console.log("Réponse Shopify :", data); // ➕ DEBUG
if (!data.customers) {
  return res.status(500).json({ message: "Données introuvables", raw: data });
}
const clients = data.customers.map(c => ({
  id: c.id,
  email: c.email || "(aucun email)",
  name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || `Client ${c.id}`
}));
    res.json(clients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Création d'une draft order
app.post('/create-draft-order', async (req, res) => {
  const { customer_id, items } = req.body;
  if (!customer_id || !items) return res.status(400).json({ message: "Données manquantes" });

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
          note: "Commande interne via Storefront"
        }
      })
    });

    const draft = await draftRes.json();
    const id = draft.draft_order.id;

    await fetch(`https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/draft_orders/${id}/send_invoice.json`, {
      method: 'POST',
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        draft_order_invoice: { to: null, from: null, subject: null, custom_message: null }
      })
    });

    res.json({ invoice_url: draft.draft_order.invoice_url });
  } catch (err) {
    res.status(500).json({ message: "Erreur serveur : " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Serveur actif sur le port ${PORT}`));
