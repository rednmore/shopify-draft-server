const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

router.post('/', async (req, res) => {
   // ✅ Si Shopify envoie un appel vide (test du webhook), on répond 200
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).send('✅ Webhook endpoint is live.');
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

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const note = customer.note ? JSON.parse(customer.note) : {};
    const company = note.company || note.company_name;
    const vat = note.vat_number;

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

    if (vat) {
      await axios.post(
        `${SHOPIFY_API_URL}/customers/${customerId}/metafields.json`,
        {
          metafield: {
            namespace: 'custom',
            key: 'vat_number',
            value: vat,
            type: 'single_line_text_field'
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
