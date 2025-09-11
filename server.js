// =========================================
// server.js
// Structuré en chapitres pour faciliter les modifications
// =========================================

// =========================================
/* 1. IMPORTS ET CONFIGURATION */
// =========================================
const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const axios         = require('axios');
const rateLimit     = require('express-rate-limit');
require('dotenv').config();

console.log('→ Loaded ENV:',
  'API_SECRET=',        process.env.API_SECRET,
  'SHOPIFY_API_URL=',   process.env.SHOPIFY_API_URL,
  'SHOPIFY_API_KEY=',   process.env.SHOPIFY_API_KEY
);

// Adresse interne pour copie des emails (non utilisée ici mais gardée pour compat)
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// Routes et enregistrement des webhooks
const syncCustomerData = require('./routes/sync-customer-data');
const draftOrderRoutes = require('./routes/draftOrderRoutes');
require('./scripts/register-webhook');

// =========================================
/* 2. INITIALISATION DE L'APPLICATION */
// =========================================
const app = express();
app.set('trust proxy', 1); // Faire confiance au proxy pour X-Forwarded-*

// =========================================
/* 3. CONSTANTES GLOBALES */
// =========================================
const ALLOWED_ORIGINS = [
  // IKYUM (ajouté)
  'https://www.ikyum.com',
  'https://ikyum.com',
  // ZYO (déjà présent)
  'https://www.xn--zy-gka.com',
  'https://www.zyö.com',
  // Dev / Shopify
  'http://localhost:3000',
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];

// évite template literal
const shopifyBaseUrl = 'https://' + process.env.SHOPIFY_API_URL + '/admin/api/2023-10';

// =========================================
/* 4. MIDDLEWARES GLOBAUX */
// =========================================
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(function(o) {
      return typeof o === 'string'
        ? o === origin
        : o instanceof RegExp
          ? o.test(origin)
          : false;
    });
    if (ok) return callback(null, true);
    console.warn('⛔ Origine refusée :', origin);
    callback(new Error('CORS non autorisé'));
  },
  methods: ['GET','POST','PUT','OPTIONS'],
  allowedHeaders: ['Content-Type','X-API-KEY'],
  optionsSuccessStatus: 200
}));

app.use(bodyParser.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de requêtes. Veuillez réessayer plus tard.' }
});
app.use(globalLimiter);

// Petit endpoint de santé
app.get('/health', function (_req, res) {
  res.json({ ok: true, time: new Date().toISOString() });
});

// =========================================
/* 5. ROUTE WEBHOOK : /sync-customer-data */
// =========================================
app.use('/sync-customer-data', syncCustomerData);

// =========================================
/* 6. LIMITEUR POUR DRAFT ORDERS (réutilisable) */
// =========================================
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Trop de créations de commande. Veuillez patienter.' }
});
// (À appliquer dans les routes si besoin)

// =========================================
/* 7. ROUTE GET : /list-customers (staff) */
// =========================================
app.get('/list-customers', async function(req, res) {
  const clientKey = req.headers['x-api-key'] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: 'Clé API invalide' });
  }

  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.some(function(o) {
    return typeof o === 'string'
      ? o === origin
      : o instanceof RegExp
        ? o.test(origin)
        : false;
  })) {
    return res.status(403).json({ message: 'Origine non autorisée' });
  }

  try {
    // Liste simple
    const shopRes = await axios.get(
      shopifyBaseUrl + '/customers.json?limit=100',
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    if (shopRes.status < 200 || shopRes.status >= 300) {
      return res.status(502).json({
        message: 'Shopify non OK',
        status: shopRes.status,
        body: shopRes.data
      });
    }

    const data = shopRes.data;
    if (!data || !data.customers) {
      return res.status(500).json({ message: 'Aucun client trouvé', raw: data });
    }

    // Enrichissement label par client
    const clients = await Promise.all(
      data.customers.map(async function(c) {
        try {
          const detailRes = await axios.get(
            shopifyBaseUrl + '/customers/' + c.id + '.json',
            {
              headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
                'Content-Type': 'application/json'
              },
              timeout: 15000
            }
          );
          const full = detailRes.data && detailRes.data.customer ? detailRes.data.customer : c;

          let label;
          if (full.first_name || full.last_name) {
            label = ((full.first_name || '') + ' ' + (full.last_name || '')).trim();
          } else if (full.default_address && full.default_address.company) {
            label = full.default_address.company;
          } else if (full.addresses && full.addresses[0] && full.addresses[0].company) {
            label = full.addresses[0].company;
          } else if (full.email) {
            label = full.email;
          } else {
            label = 'Client ' + full.id;
          }
          return { id: full.id, label: label };
        } catch (_) {
          return { id: c.id, label: 'Client ' + c.id };
        }
      })
    );

    res.json(clients);
  } catch (err) {
    console.error("❌ Erreur /list-customers :", err.stack || err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message, stack: err.stack });
  }
});

// =========================================
/* 8.1. MONTAGE DES ROUTES DRAFT ORDERS
      (complete-draft-order & send-order-confirmation & send-order-email) */
// =========================================
app.use('/', draftOrderRoutes);

// =========================================
/* 9. (routes déplacées dans draftOrderRoutes.js)
      - POST /complete-draft-order
      - POST /send-order-confirmation
      - POST /send-order-email */
// =========================================

// =========================================
/* 10. LANCEMENT DU SERVEUR */
// =========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('✅ Serveur actif sur le port ' + PORT);
});
