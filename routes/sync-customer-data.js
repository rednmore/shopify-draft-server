// ========================================================
// 1) IMPORTS & CONFIG
// ========================================================
const express = require('express');
const axios = require('axios');
const router = express.Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

// [CHANGED] Base Admin API (v2023-10) — évite d'appeler le domaine nu
const SHOPIFY_BASE = `https://${SHOPIFY_API_URL}/admin/api/2023-10`;

// ========================================================
// 2) HANDLER WEBHOOK: POST / (customers.create / update)
// ========================================================
router.post('/', async (req, res) => {
  // 2.1) Ping simple si payload vide
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK (ping)' });
  }

  // 2.2) Récup ID client
  const customerId = req.body.id;
  if (!customerId) {
    return res.status(400).json({ error: 'Missing customer ID' });
  }

  try {
    // ----------------------------------------------------
    // 2.3) Lecture du client complet
    // ----------------------------------------------------
    const { data: { customer } } = await axios.get(
      // [CHANGED] URL corrigée
      `${SHOPIFY_BASE}/customers/${customerId}.json`,
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

    // ----------------------------------------------------
    // 2.4) Parsing de la note JSON (source des champs)
    // ----------------------------------------------------
    let noteData = {};
    try {
      if (customer.note) {
        noteData = JSON.parse(customer.note);
      }
    } catch (e) {
      console.warn('⚠️ Note non parsable :', customer.note);
    }

    const clean = (v) => typeof v === 'string' ? v.trim() : undefined;

    // [CHANGED] Fallback sur company_name si company est absent
    const company  = clean(noteData.company) || clean(noteData.company_name);
    const address1 = clean(noteData.address1);
    const zip      = clean(noteData.zip);
    const city     = clean(noteData.city);
    const vat      = clean(noteData.vat_number);

    // 2.5) Rien à faire si aucun champ pertinent
    if (!company && !address1 && !vat) {
      console.log('ℹ️ Aucun champ utile trouvé dans la note. Fin du traitement.');
      return res.status(200).json({ message: 'Nothing to update' });
    }

    // ----------------------------------------------------
    // 2.6) Création / Mise à jour de l'adresse (inclut company)
    // ----------------------------------------------------
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
        // [CHANGED] URL corrigée
        `${SHOPIFY_BASE}/customers/${customerId}/addresses.json`,
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
        // [CHANGED] URL corrigée
        `${SHOPIFY_BASE}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
        { address: addressPayload },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // ----------------------------------------------------
    // 2.7) Métachamp TVA + Tag TVA
    // ----------------------------------------------------
    if (vat) {
      console.log('➕ Ajout TVA en metafield');
      await axios.post(
        // [CHANGED] URL corrigée
        `${SHOPIFY_BASE}/customers/${customerId}/metafields.json`,
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

      await axios.put(
        // [CHANGED] URL corrigée
        `${SHOPIFY_BASE}/customers/${customerId}.json`,
        {
          customer: { id: customerId, tags: newTags.join(', ') }
        },
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    // ----------------------------------------------------
    // 2.8) [ADD] Métachamp custom.customer_name (miroir du company)
    // ----------------------------------------------------
    // But : disposer dans l'Admin (section Métadonnées client) d’un champ "Customer name"
    //       alimenté automatiquement depuis la note (company/company_name)
    const customerNameMeta = company || undefined;
    if (customerNameMeta) {
      try {
        // Chercher s'il existe déjà
        const mfGet = await axios.get(
          `${SHOPIFY_BASE}/customers/${customerId}/metafields.json?namespace=custom&key=customer_name`,
          {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        const existing = (mfGet.data.metafields || [])[0];

        if (existing && existing.id) {
          // Update
          await axios.put(
            `${SHOPIFY_BASE}/metafields/${existing.id}.json`,
            {
              metafield: {
                id: existing.id,
                type: 'single_line_text_field',
                value: customerNameMeta
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
          // Create
          await axios.post(
            `${SHOPIFY_BASE}/customers/${customerId}/metafields.json`,
            {
              metafield: {
                namespace: 'custom',
                key: 'customer_name',
                type: 'single_line_text_field',
                value: customerNameMeta
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
      } catch (e) {
        console.warn('⚠️ customer_name metafield upsert failed:', e?.response?.data || e.message);
      }
    }

    // ----------------------------------------------------
    // 2.9) Réponse OK
    // ----------------------------------------------------
    res.status(200).json({ success: true });
  } catch (err) {
    // ----------------------------------------------------
    // 2.10) Gestion d’erreur
    // ----------------------------------------------------
    console.error('❌ Erreur sync-customer-data :', err.response?.data || err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========================================================
// 3) EXPORT ROUTER
// ========================================================
module.exports = router;
