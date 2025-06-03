const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

router.post('/', async (req, res) => {
  if (!req.body || !req.body.id) {
    console.log('[HOOK] Ping reçu sans ID client – aucune action.');
    return res.status(200).json({ message: 'Ping OK' });
  }

  const customerId = req.body.id;
  console.log(`[HOOK] Traitement du client ID : ${customerId}`);

  try {
    const { data: { customer } } = await axios.get(`${SHOPIFY_API_URL}/customers/${customerId}.json`, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
    });

    console.log(`[INFO] Client récupéré : ${customer.first_name} ${customer.last_name} (${customer.email})`);
    console.log(`[INFO] Champ "note" brut : ${customer.note}`);

    let noteData = {};
    try {
      noteData = JSON.parse(customer.note || '{}');
      console.log('[INFO] JSON analysé depuis le champ note :', noteData);
    } catch (e) {
      console.warn('[⚠️ WARNING] Champ note invalide ou non JSON :', customer.note);
    }

    const company     = noteData.company?.trim();
    const address1    = noteData.address1?.trim();
    const zip         = noteData.zip?.trim();
    const city        = noteData.city?.trim();
    const vat_number  = noteData.vat_number?.trim();

    if (!company && !address1 && !zip && !city && !vat_number) {
      console.log('[ℹ️ INFO] Aucun champ pertinent détecté. Fin du traitement.');
      return res.status(200).json({ message: 'No relevant data in note' });
    }

    const addressPayload = {
      company,
      address1: address1 || 'To complete',
      zip: zip || '0000',
      city: city || 'To complete',
      default: true
    };

    if (!customer.default_address) {
      console.log('[➕] Aucune adresse par défaut. Création d’une nouvelle adresse...');
      await axios.post(`${SHOPIFY_API_URL}/customers/${customerId}/addresses.json`, {
        address: addressPayload
      }, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
      });
      console.log('[✅] Adresse créée avec succès.');
    } else {
      console.log(`[✏️] Mise à jour de l’adresse existante ID : ${customer.default_address.id}`);
      await axios.put(`${SHOPIFY_API_URL}/customers/${customerId}/addresses/${customer.default_address.id}.json`, {
        address: addressPayload
      }, {
        headers: { 'X-Shopify-Access-Token': SHOPIFY_API_KEY }
      });
      console.log('[✅] Adresse mise à jour avec succès.');
    }

    if (vat_number) {
      console.log('[➕] Ajout du champ TVA dans les metafields...');
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
      console.log('[✅] Metafield TVA ajouté avec succès.');
    }

    console.log('[✅] Traitement terminé avec succès.');
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[❌ ERREUR] sync-customer-data :', err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
