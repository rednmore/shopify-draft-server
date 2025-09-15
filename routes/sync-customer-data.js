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

const recentWebhookHits = []; // petit buffer en mémoire (dernier 20)
const MAX_RECENT = 20;

// ========================================================
// 2) HANDLER WEBHOOK: POST / (customers.create / update)
// ========================================================
router.post('/', async (req, res) => {
  try {
    recentWebhookHits.unshift({
      ts: new Date().toISOString(),
      topic: req.get('X-Shopify-Topic') || '(none)',
      shop: req.get('X-Shopify-Shop-Domain') || '(none)',
      hmac: req.get('X-Shopify-Hmac-Sha256') ? 'present' : 'missing',
      body: req.body
    });
    if (recentWebhookHits.length > MAX_RECENT) recentWebhookHits.pop();
  } catch (_) {}
  
  // 2.1) Ping simple si payload vide
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({ message: 'Webhook OK (ping)' });
  }
});
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
    // 2.6) Synchronisation bidirectionnelle Société (adresse <-> métachamps)
    //       1) Déterminer la valeur canonique (priorité: note -> adresse -> mf company_name -> mf customer_name -> mf custome_name)
    //       2) Aligner address.company + custom.company_name + custom.customer_name + custom.custome_name si nécessaire
    // ----------------------------------------------------
    const norm = (s) => (typeof s === 'string' ? s.trim() : '');
    const firstNonEmpty = (...vals) => {
      for (const v of vals) { if (norm(v)) return norm(v); }
      return '';
    };

    // 2.6.1) Lire l’état courant côté adresse
    const addrCompanyCurrent =
      (customer && customer.default_address && customer.default_address.company) || '';

    // 2.6.2) Lire les métachamps existants en une fois (namespace=custom)
    let mfCompanyNameCurrent = '';
    let mfCustomerNameCurrent = '';
    let mfCustomeNameCurrent = ''; // [ADD] prend en compte la variante fautive si elle existe déjà
    try {
      const mfList = await axios.get(
        `${SHOPIFY_BASE}/customers/${customerId}/metafields.json?namespace=custom`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const mfs = Array.isArray(mfList.data.metafields) ? mfList.data.metafields : [];
      const mfCompany  = mfs.find(m => m.key === 'company_name');
      const mfCustomer = mfs.find(m => m.key === 'customer_name');
      const mfCustome  = mfs.find(m => m.key === 'custome_name'); // [ADD]
      mfCompanyNameCurrent   = norm(mfCompany && mfCompany.value);
      mfCustomerNameCurrent  = norm(mfCustomer && mfCustomer.value);
      mfCustomeNameCurrent   = norm(mfCustome && mfCustome.value); // [ADD]
    } catch (e) {
      console.warn('⚠️ lecture metafields custom.* échouée :', e?.response?.data || e.message);
    }

    // 2.6.3) Déterminer la valeur canonique
    const companyFromNote = norm(company); // 'company' vient déjà de noteData.company || noteData.company_name
    const canonicalCompany = firstNonEmpty(
      companyFromNote,
      addrCompanyCurrent,
      mfCompanyNameCurrent,
      mfCustomerNameCurrent,
      mfCustomeNameCurrent // [ADD]
    );

    // Si aucune valeur exploitable, on ne touche rien
    if (!canonicalCompany) {
      console.log('ℹ️ Aucune valeur "Société" exploitable — skip sync address/mf.');
    } else {
      // 2.6.4) Aligner l’ADRESSE par défaut (création ou mise à jour ciblée du champ company)
      if (!customer.default_address) {
        // Créer une adresse minimale avec "company" et la définir par défaut
        console.log('➕ Création d’une adresse client (default) avec company');
        await axios.post(
          `${SHOPIFY_BASE}/customers/${customerId}/addresses.json`,
          {
            address: {
              company: canonicalCompany,
              address1: address1 || 'To complete',
              zip: zip || '0000',
              city: city || 'To complete',
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
      } else if (norm(customer.default_address.company) !== canonicalCompany) {
        console.log('✏️ Mise à jour du company sur l’adresse par défaut');
        await axios.put(
          `${SHOPIFY_BASE}/customers/${customerId}/addresses/${customer.default_address.id}.json`,
          { address: { company: canonicalCompany } }, // mise à jour ciblée
          {
            headers: {
              'X-Shopify-Access-Token': SHOPIFY_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
      }
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
    // 2.8) Upsert custom.customer_name (miroir de canonicalCompany)
    // ----------------------------------------------------
    try {
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
        if (norm(existing.value) !== canonicalCompany) {
          await axios.put(
            `${SHOPIFY_BASE}/metafields/${existing.id}.json`,
            {
              metafield: {
                id: existing.id,
                type: 'single_line_text_field',
                value: canonicalCompany
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
      } else {
        await axios.post(
          `${SHOPIFY_BASE}/customers/${customerId}/metafields.json`,
          {
            metafield: {
              namespace: 'custom',
              key: 'customer_name',
              type: 'single_line_text_field',
              value: canonicalCompany
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

    // ----------------------------------------------------
    // 2.8 bis) Upsert custom.company_name (miroir de canonicalCompany)
    // ----------------------------------------------------
    try {
      const mfGet2 = await axios.get(
        `${SHOPIFY_BASE}/customers/${customerId}/metafields.json?namespace=custom&key=company_name`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const existing2 = (mfGet2.data.metafields || [])[0];
      if (existing2 && existing2.id) {
        if (norm(existing2.value) !== canonicalCompany) {
          await axios.put(
            `${SHOPIFY_BASE}/metafields/${existing2.id}.json`,
            {
              metafield: {
                id: existing2.id,
                type: 'single_line_text_field',
                value: canonicalCompany
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
      } else {
        await axios.post(
          `${SHOPIFY_BASE}/customers/${customerId}/metafields.json`,
          {
            metafield: {
              namespace: 'custom',
              key: 'company_name',
              type: 'single_line_text_field',
              value: canonicalCompany
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
      console.warn('⚠️ company_name metafield upsert failed:', e?.response?.data || e.message);
    }

    // ----------------------------------------------------
    // 2.8 ter) [ADD] Upsert custom.customer_name (miroir de canonicalCompany)
    // ----------------------------------------------------
    try {
      const mfGet3 = await axios.get(
        `${SHOPIFY_BASE}/customers/${customerId}/metafields.json?namespace=custom&key=customer_name`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      const existing3 = (mfGet3.data.metafields || [])[0];
      if (existing3 && existing3.id) {
        if (norm(existing3.value) !== canonicalCompany) {
          await axios.put(
            `${SHOPIFY_BASE}/metafields/${existing3.id}.json`,
            {
              metafield: {
                id: existing3.id,
                type: 'single_line_text_field',
                value: canonicalCompany
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
      } else {
        await axios.post(
          `${SHOPIFY_BASE}/customers/${customerId}/metafields.json`,
          {
            metafield: {
              namespace: 'custom',
              key: 'custome_name',               // ← (fautif volontaire)
              type: 'single_line_text_field',
              value: canonicalCompany
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
      console.warn('⚠️ custome_name metafield upsert failed:', e?.response?.data || e.message);
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
