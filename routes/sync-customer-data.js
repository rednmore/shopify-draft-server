const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

// ✅ Route POST pour webhook customers/create
router.post('/', async (req, res) => {
  // Ping test (body vide)
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK' });
  }

  const customerId = req.body.id;
  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    // 1. Récupérer le client complet
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

    // 2. Extraire et parser la note (qui contient notre JSON)
    let noteData = {};
    try {
      if (customer.note) {
        noteData = JSON.parse(customer.note);
      }
    } catch (e) {
      console.warn('⚠️ Note non parsable :', customer.note);
    }

    const company = noteData.company;
    const vat = noteData.vat_number;

    // 3. Ajouter ou mettre à jour l'adresse par défaut avec le champ "company"
    if (company) {
      if (!customer.default_address) {
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
      } else {
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
    }

    // 4. Ajouter le VAT number en tant que metafield si présent
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
    console.error('❌ sync-customer-data error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
