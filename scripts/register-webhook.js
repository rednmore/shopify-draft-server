// scripts/register-webhook.js
require('dotenv').config();

/**
 * Enregistrement (idempotent) du webhook "customers/create"
 * Utilise fetch natif (Node >=18), donc aucune dépendance axios.
 */

const SHOP = process.env.SHOPIFY_API_URL;       // ex: "mon-shop.myshopify.com"
const API_KEY = process.env.SHOPIFY_API_KEY;    // Admin API access token
const WEBHOOK_ADDRESS =
  process.env.PUBLIC_WEBHOOK_URL ||
  'https://shopify-test-server-05d9.onrender.com/sync-customer-data';
const API_VERSION = '2023-10';

if (!SHOP || !API_KEY) {
  console.error('❌ register-webhook: SHOPIFY_API_URL ou SHOPIFY_API_KEY manquant — on ignore l’installation du webhook.');
  return; // ne pas process.exit() pour ne pas planter le serveur si ce fichier est require() au démarrage
}

const baseUrl = `https://${SHOP}/admin/api/${API_VERSION}`;
console.log('🛠️ register-webhook : SHOP=', SHOP);
console.log('🛠️ register-webhook : Base URL=', baseUrl);
console.log('🛠️ register-webhook : Address=', WEBHOOK_ADDRESS);

// --- Helpers HTTP (fetch natif) ---
async function httpGet(url) {
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': API_KEY,
      'Content-Type': 'application/json'
    }
  });
  if (!r.ok) {
    const txt = await safeText(r);
    throw new Error(`GET ${url} → ${r.status} ${r.statusText} ${txt ? '— ' + txt : ''}`);
  }
  return r.json();
}

async function httpPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const txt = await safeText(r);
    const err = new Error(`POST ${url} → ${r.status} ${r.statusText} ${txt ? '— ' + txt : ''}`);
    err.status = r.status;
    err.body = txt;
    throw err;
  }
  return r.json();
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function registerCustomerCreateWebhook() {
  try {
    // 1) Lister les webhooks existants
    const listData = await httpGet(`${baseUrl}/webhooks.json`);
    const hooks = listData.webhooks || [];

    const exists = hooks.find(
      (w) => w.topic === 'customers/create' && w.address === WEBHOOK_ADDRESS
    );

    if (exists) {
      console.log(`⚠️ Webhook déjà présent (id=${exists.id}). On ne crée rien.`);
      return;
    }

    // 2) Créer le webhook s’il n’existe pas
    const payload = {
      webhook: {
        topic: 'customers/create',
        address: WEBHOOK_ADDRESS,
        format: 'json'
      }
    };

    const createData = await httpPost(`${baseUrl}/webhooks.json`, payload);
    console.log('✅ Webhook créé avec succès (id=', createData.webhook?.id, ')');
  } catch (err) {
    // Cas fréquents : DNS / Shop injoignable / 422 "already exists"
    if (err.code === 'ENOTFOUND') {
      console.warn('⚠️ DNS lookup failed pour', SHOP, '- webhook non installé.');
      return;
    }
    if (err.status === 422) {
      console.warn('⚠️ Webhook probablement déjà existant (422 Unprocessable Entity).');
      return;
    }
    console.error('❌ Erreur inattendue lors de l’enregistrement du webhook :', err.message || err);
    if (err.status) console.error('   Status:', err.status);
    if (err.body)   console.error('   Body  :', err.body);
  }
}

registerCustomerCreateWebhook();
