const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

router.post('/', async (req, res) => {
  // Webhook ping test (Shopify envoie un appel vide pour test)
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK' });
  }

  const customerId = req.body.id;

  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    // Récupérer les infos complètes du client
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

    // Extraire les données de customer.note
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
    const country = noteData.country?.trim() || 'CH';
    const vat = noteData.vat_number?.trim();

    // Vérifier que l'entreprise est bien renseignée
    if (!company) {
      console.warn(`⚠️ Le client ${customer.email} n’a pas de société renseignée`);
      return res.status(400).json({ error: 'Company is required' });
    }

    // Construire l’adresse à créer ou mettre à jour
    const addressPayload = {
      company,
      address1: address1 || 'Adresse à compléter',
      zip: zip || '0000',
      city: city || 'Ville à compléter',
      country,
      default: true
    };

    if (!customer.default_address) {
      // Créer une adresse si aucune n'existe
      await axios.post(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses.json`,
        { address: addressPayload },
        { headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }}
      );
    } else {
      // Sinon, mettre à jour l’adresse existante
      await axios.put(
        `${SHOPIFY_API_URL}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
        { address: addressPayload },
        { headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }}
      );
    }

    // Ajouter le numéro de TVA en tant que metafield (facultatif)
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
