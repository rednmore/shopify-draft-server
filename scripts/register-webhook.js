require('dotenv').config();
const axios = require('axios');

const BASE_URL = `https://${process.env.SHOPIFY_API_URL}`;
const API_KEY = process.env.SHOPIFY_API_KEY;
const WEBHOOK_ADDRESS = 'https://shopify-test-server-05d9.onrender.com/sync-customer-data';

if (!BASE_URL || !API_KEY) {
  console.error('❌ SHOPIFY_API_URL ou SHOPIFY_API_KEY est manquant.');
  process.exit(1);
}

async function registerCustomerCreateWebhook() {
  try {
    const existing = await axios.get(`${BASE_URL}/admin/api/2023-10/webhooks.json`, {
      headers: {
        'X-Shopify-Access-Token': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const found = existing.data.webhooks.find(
      w => w.topic === 'customers/create' && w.address === WEBHOOK_ADDRESS
    );

    if (found) {
      console.log(`⚠️ Webhook déjà existant (id: ${found.id}).`);
      return;
    }

    const response = await axios.post(
      `${BASE_URL}/admin/api/2023-10/webhooks.json`,
      {
        webhook: {
          topic: 'customers/create',
          address: WEBHOOK_ADDRESS,
          format: 'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': API_KEY,
          'Content-Type': 'application/json'
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
