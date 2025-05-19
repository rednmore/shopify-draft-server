const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_API_URL; // ex: your-shop.myshopify.com
const API_VERSION = '2023-10';
const baseUrl = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${API_VERSION}`;

router.post('/', async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK' });
  }

  const customerId = req.body.id;

  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    const { data: { customer } } = await axios.get(
      `${baseUrl}/customers/${customerId}.json`,
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

    let noteData = {};
    try {
      if (customer.note) {
        noteData = JSON.parse(customer.note);
      }
    } catch (e) {
      console.warn('⚠️ Note non parsable :', customer.note);
    }

    const company = noteData.company?.trim();
    const address1 = noteData.address1?.trim();
    const zip = noteData.zip?.trim();
    const city = noteData.city?.trim();
    const vat = noteData.vat_number?.trim();

    console.log(`🔁 Traitement client : ${customer.email} (${customerId})`);
    console.log(`→ Société : ${company}, Adresse : ${address1}, ${zip} ${city}, TVA : ${vat}`);

    if (!company) {
      console.warn(`⚠️ Le client ${customer.email} n’a pas de société renseignée.`);
      return res.status(400).json({ error: 'Company is required' });
    }

    const addressPayload = {
      company,
      address1: address1 || 'Adresse à compléter',
      zip: zip || '0000',
      city: city || 'Ville à compléter',
      default: true
    };

    if (!customer.default_address) {
      console.log('➕ Aucune adresse existante → création');
      await axios.post(
        `${baseUrl}/customers/${customerId}/addresses.json`,
        { address: addressPayload },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    } else {
      console.log('✏️ Adresse existante → mise à jour');
      await axios.put(
        `${baseUrl}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
        { address: addressPayload },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    if (vat) {
      console.log('➕ Enregistrement TVA en tant que metafield');
      await axios.post(
        `${baseUrl}/customers/${customerId}/metafields.json`,
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
