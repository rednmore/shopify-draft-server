const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

router.post('/', async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK (ping)' });
  }

  const customerId = req.body.id;

  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    // 🔍 Récupérer les infos complètes du client
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

    // 📦 Lire le champ note (contenant un JSON)
    let noteData = {};
    try {
      if (customer.note) {
        noteData = JSON.parse(customer.note);
      }
    } catch (e) {
      console.warn('⚠️ Note non parsable :', customer.note);
    }

    const clean = (v) => typeof v === 'string' ? v.trim() : undefined;

    const company  = clean(noteData.company);
    const address1 = clean(noteData.address1);
    const zip      = clean(noteData.zip);
    const city     = clean(noteData.city);
    const vat      = clean(noteData.vat_number);

    // 🛑 Rien à faire si aucun champ pertinent
    if (!company && !address1 && !vat) {
      console.log('ℹ️ Aucun champ utile trouvé dans la note. Fin du traitement.');
      return res.status(200).json({ message: 'Nothing to update' });
    }

    // 🏢 Création ou mise à jour de l'adresse client
    const addressPayload = {
      company,
      address1: address1 || 'To complete',
      zip: zip || '0000',
      city: city || 'To complete',
      default: true
    };

    if (!customer.default_address) {
      console.log('➕ Création d’une adresse client');
      await axios.post(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses.json`,
        { address: addressPayload },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    } else {
      console.log('✏️ Mise à jour de l’adresse existante');
      await axios.put(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
        { address: addressPayload },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // 🔐 Ajout du champ TVA en tant que metafield
    if (vat) {
      console.log('➕ Ajout TVA en metafield');
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

      // 🏷️ Ajout du tag TVA visible dans le back-office
      const existingTags = customer.tags?.split(',').map(t => t.trim()) || [];
      const newTags = [...new Set([...existingTags, `TVA:${vat}`])];

      await axios.put(`${SHOPIFY_API_URL}/customers/${customerId}.json`, {
        customer: { id: customerId, tags: newTags.join(', ') }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Erreur sync-customer-data :', err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
