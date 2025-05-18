// scripts/register-webhook.js

require('dotenv').config();
const axios = require('axios');

const SHOP = process.env.SHOPIFY_API_URL;       // ex: "mon-shop.myshopify.com"
const API_KEY = process.env.SHOPIFY_API_KEY;    // ton access token
const WEBHOOK_ADDRESS = process.env.PUBLIC_WEBHOOK_URL
  || 'https://shopify-test-server-05d9.onrender.com/sync-customer-data';
const API_VERSION = '2023-10';

if (!SHOP || !API_KEY) {
  console.error('❌ Erreur de config : SHOPIFY_API_URL ou SHOPIFY_API_KEY manquant.');
  process.exit(1);
}

const baseUrl = `https://${SHOP}/admin/api/${API_VERSION}`;

console.log('🛠️ register-webhook : SHOP=', SHOP);
console.log('🛠️ register-webhook : Base URL=', baseUrl);
console.log('🛠️ register-webhook : Address=', WEBHOOK_ADDRESS);

async function registerCustomerCreateWebhook() {
  try {
    // 1) Récupérer la liste des webhooks existants
    const listRes = await axios.get(`${baseUrl}/webhooks.json`, {
      headers: {
        'X-Shopify-Access-Token': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const hooks = listRes.data.webhooks || [];
    const exists = hooks.find(w =>
      w.topic === 'customers/create' && w.address === WEBHOOK_ADDRESS
    );

    if (exists) {
      console.log(`⚠️ Webhook déjà présent (id=${exists.id}). On ne crée rien.`);
      return;
    }

    // 2) Créer le webhook s’il n’existe pas
    const createRes = await axios.post(
      `${baseUrl}/webhooks.json`,
      {
        webhook: {
          topic:   'customers/create',
          address: WEBHOOK_ADDRESS,
          format:  'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Webhook créé avec succès (id=', createRes.data.webhook.id, ')');
  } catch (err) {
    // On ignore les erreurs de DNS ou celles indiquant déjà existant
    if (err.code === 'ENOTFOUND') {
      console.warn('⚠️ DNS lookup failed for', SHOP, '- webhook non installé.');
    } else if (err.response && err.response.status === 422) {
      console.warn('⚠️ Webhook déjà existant (422 Unprocessable Entity).');
    } else {
      console.error('❌ Erreur inattendue lors de l’enregistrement du webhook :', err.message);
      if (err.response) {
        console.error('   Status:', err.response.status);
        console.error('   Data:', JSON.stringify(err.response.data, null, 2));
      }
    }
  }
}

registerCustomerCreateWebhook();
