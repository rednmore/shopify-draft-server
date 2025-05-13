require('dotenv').config();
const axios = require('axios');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;

async function registerCustomerCreateWebhook() {
  try {
    const response = await axios.post(
      `${SHOPIFY_API_URL}/webhooks.json`,
      {
        webhook: {
          topic: "customers/create",
          address: "https://shopify-draft-server.onrender.com/sync-customer-data",
          format: "json"
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log("✅ Webhook créé :", response.data.webhook.id);
  } catch (error) {
    console.error("❌ Webhook error:", error.response?.data || error.message);
  }
}

registerCustomerCreateWebhook();
