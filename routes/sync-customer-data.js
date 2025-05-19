const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

// ✅ Route POST pour webhook customers/create
router.post('/', async (req, res) => {
  // Shopify ping test (body vide)
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK' });
  }

  const customerId = req.body.id;

  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    const { data: { customer } } = await axios.get(
      `${SHOPIFY_API_URL}/customers/${customerId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // ✅ Récupération directe du champ "company" transmis à l'inscription
    const company = req.body.company;

    // ✅ Création automatique d'une adresse par défaut avec le company (si non existante)
    if (!customer.default_address && company) {
      await axios.post(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses.json`,
        {
          address: {
            address1: 'To be completed',
            company: company,
            city: 'To be completed',
            country: 'CH',
            default: true
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    } 
    // ✅ Si l'adresse par défaut existe, simplement la mettre à jour avec "company"
    else if (customer.default_address && company) {
      await axios.put(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
        {
          address: {
            company: company
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ sync-customer-data error:", err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
