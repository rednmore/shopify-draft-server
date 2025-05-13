require('dotenv').config();
const axios = require('axios');

const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const WEBHOOK_ADDRESS = 'https://shopify-draft-server.onrender.com/sync-customer-data';

if (!SHOPIFY_API_URL || !SHOPIFY_API_KEY) {
  console.error('❌ SHOPIFY_API_URL ou SHOPIFY_API_KEY est manquant.');
  process.exit(1);
}

async function registerCustomerCreateWebhook() {
  try {
    console.log('🔎 Vérification des webhooks existants...');
    const existing = await axios.get(`${SHOPIFY_API_URL}/webhooks.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const found = existing.data.webhooks.find(
      w => w.topic === 'customers/create' && w.address === WEBHOOK_ADDRESS
    );

    if (found) {
      console.log(`⚠️ Le webhook "customers/create" existe déjà pour cette adresse (id: ${found.id}).`);
      return;
    }

    console.log('📡 Enregistrement du webhook…');
    const response = await axios.post(
      `${SHOPIFY_API_URL}/webhooks.json`,
      {
        webhook: {
          topic: 'customers/create',
          address: WEBHOOK_ADDRESS,
          format: 'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json',
          'User-Agent': 'ShopifyWebhookClient/1.0'
        }
      }
    );

    console.log('✅ Webhook créé avec succès :', response.data.webhook.id);
  } catch (error) {
    console.error('❌ Erreur lors de la création du webhook :');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

registerCustomerCreateWebhook();
