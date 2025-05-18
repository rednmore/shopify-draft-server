// =========================================
// server.js
// Structuré en chapitres pour faciliter les modifications
// =========================================

// =========================================
// 1. IMPORTS ET CONFIGURATION
// =========================================
const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors');
const fetch         = require('node-fetch');
const rateLimit     = require('express-rate-limit');
require('dotenv').config();

// Adresse interne pour copie des emails
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// Routes et enregistrement des webhooks
const syncCustomerData = require('./routes/sync-customer-data');
const draftOrderRoutes = require('./routes/draftOrderRoutes');
require('./scripts/register-webhook');

// =========================================
// 2. INITIALISATION DE L'APPLICATION
// =========================================
const app = express();
app.set('trust proxy', 1); // Faire confiance au proxy pour X-Forwarded-

// =========================================
// 3. CONSTANTES GLOBALES
// =========================================
const ALLOWED_ORIGINS = [
  'https://www.xn--zy-gka.com',
  'https://www.zyö.com',
  'http://localhost:3000', 
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];
// évite template literal
const shopifyBaseUrl = 'https://' + process.env.SHOPIFY_API_URL + '/admin/api/2023-10';

// =========================================
// 4. MIDDLEWARES GLOBAUX
// =========================================
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    var ok = ALLOWED_ORIGINS.some(function(o) {
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

// =========================================
// 5. ROUTE WEBHOOK : /sync-customer-data
// =========================================
app.use('/sync-customer-data', syncCustomerData);

// =========================================
// 6. LIMITEUR POUR DRAFT ORDERS
// =========================================
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Trop de créations de commande. Veuillez patienter.' }
});

// =========================================
// 7. ROUTE GET : /list-customers
//     Récupère la liste des clients pour le staff
// =========================================
app.get('/list-customers', async function(req, res) {
  var clientKey = req.headers['x-api-key'] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: 'Clé API invalide' });
  }
  var origin = req.get('origin');
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
    var shopRes = await fetch(
      shopifyBaseUrl + '/customers.json?limit=100',
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    var data = await shopRes.json();
    if (!data.customers) {
      return res.status(500).json({ message: 'Aucun client trouvé', raw: data });
    }
    var clients = await Promise.all(
      data.customers.map(async function(c) {
        try {
          var detailRes = await fetch(
            shopifyBaseUrl + '/customers/' + c.id + '.json',
            {
              headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
                'Content-Type': 'application/json'
              }
            }
          );
          var full = (await detailRes.json()).customer;
          var label;
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
    console.error('❌ Erreur /list-customers :', err);
    res.status(500).json({ message: 'Erreur serveur', detail: err.message });
  }
});

// =========================================
// 8.1. MONTAGE DES ROUTES DRAFT ORDERS
//      (complete-draft-order & send-order-confirmation & send-order-email)
// =========================================
app.use('/', draftOrderRoutes);

// =========================================
// 9. (routes déplacées dans draftOrderRoutes.js)
//      - POST /complete-draft-order
//      - POST /send-order-confirmation
//      - POST /send-order-email
// =========================================

// =========================================
// 10. LANCEMENT DU SERVEUR
// =========================================
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('✅ Serveur actif sur le port ' + PORT);
});
