const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

router.post('/', async (req, res) => {
  if (!req.body || !req.body.id) return res.status(200).json({ message: 'Ping OK' });

  const customerId = req.body.id;

  try {
    const { data: { customer } } = await axios.get(`${SHOPIFY_API_URL}/customers/${customerId}.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_API_KEY
      }
    });

    let noteData = {};
    try {
      noteData = JSON.parse(customer.note || '{}');
    } catch (e) {
      console.warn('⚠️ Note non JSON :', customer.note);
    }

    const { company, address1, zip, city, vat_number } = noteData;

    if (!company && !address1 && !vat_number) {
      return res.status(200).json({ message: 'Nothing to update' });
    }

    const addressPayload = {
      company,
      address1: address1 || 'To complete',
      zip: zip || '0000',
      city: city || 'To complete',
      default: true
    };

    if (!customer.default_address) {
      await axios.post(`${SHOPIFY_API_URL}/customers/${customerId}/addresses.json`, { address: addressPayload }, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
      });
    } else {
      await axios.put(`${SHOPIFY_API_URL}/customers/${customerId}/addresses/${customer.default_address.id}.json`, { address: addressPayload }, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
      });
    }

    if (vat_number) {
      await axios.post(`${SHOPIFY_API_URL}/customers/${customerId}/metafields.json`, {
        metafield: {
          namespace: 'custom',
          key: 'vat_number',
          value: vat_number,
          type: 'single_line_text_field'
        }
      }, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ sync-customer-data error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
