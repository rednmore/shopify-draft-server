require('dotenv').config();
const axios = require('axios');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL; // ex: https://votre-boutique.myshopify.com/admin/api/2024-01
const WEBHOOK_ADDRESS = 'https://webhook.site/048ba331-ea6a-445b-8b3b-66991429a423'; // remplacez par votre URL réelle

async function registerCustomerCreateWebhook() {
  try {
    // 🔍 Étape 1 : récupérer les webhooks existants
    const existing = await axios.get(`${SHOPIFY_API_URL}/webhooks.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const alreadyExists = existing.data.webhooks.some(
      (wh) => wh.topic === 'customers/create' && wh.address === WEBHOOK_ADDRESS
    );

    if (alreadyExists) {
      console.log('⚠️ Le webhook "customers/create" existe déjà. Aucun changement effectué.');
      return;
    }

    // ✅ Étape 2 : créer le webhook
    const response = await axios.post(
      `${SHOPIFY_API_URL}/webhooks.json`,
      {
        webhook: {
          topic: 'customers/create',
          address: WEBHOOK_ADDRESS,
          format: 'json',
        },
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Webhook créé avec succès :', response.data.webhook.id);
  } catch (error) {
    console.error('❌ Erreur lors de la création du webhook :', error.response?.data || error.message);
  }
}

registerCustomerCreateWebhook();
