require('dotenv').config();
const axios = require('axios');

const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL; // Ex: https://your-store.myshopify.com/admin/api/2023-10
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const WEBHOOK_ADDRESS = 'https://shopify-draft-server.onrender.com/sync-customer-data'; // ← à remplacer si besoin

async function registerCustomerCreateWebhook() {
  try {
    console.log('📡 Tentative de création du webhook...');
    console.log('🌐 URL envoyée à Shopify :', WEBHOOK_ADDRESS);

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
