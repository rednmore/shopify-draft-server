```javascript
// =========================================
// server.js
// Structuré en chapitres pour faciliter les modifications
// =========================================

// =========================================
// 1. IMPORTS ET CONFIGURATION
// =========================================
const express           = require('express');
const bodyParser        = require('body-parser');
const cors              = require('cors');
const fetch             = require('node-fetch');
const rateLimit         = require('express-rate-limit');
require('dotenv').config();

// Adresse interne pour copie des emails
const COPY_TO_ADDRESS   = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// Routes et enregistrement des webhooks
const syncCustomerData  = require('./routes/sync-customer-data');
const draftOrderRoutes  = require('./routes/draftOrderRoutes');
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
  "https://www.xn--zy-gka.com",
  "https://www.zyö.com",
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/
];
const shopifyBaseUrl = `https://${process.env.SHOPIFY_API_URL}/admin/api/2023-10`;

// =========================================
// 4. MIDDLEWARES GLOBAUX
// =========================================
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === "string"  ? o === origin
      : o instanceof RegExp  ? o.test(origin)
      : false
    );
    if (ok) return callback(null, true);
    console.warn("⛔ Origine refusée :", origin);
    callback(new Error("CORS non autorisé"));
  },
  methods: ["GET","POST","PUT","OPTIONS"],
  allowedHeaders: ["Content-Type","X-API-KEY"],
  optionsSuccessStatus: 200
}));
app.use(bodyParser.json());
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Trop de requêtes. Veuillez réessayer plus tard." }
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
  message: { message: "Trop de créations de commande. Veuillez patienter." }
});

// =========================================
// 7. ROUTE GET : /list-customers
//     Récupère la liste des clients pour le staff
// =========================================
app.get('/list-customers', async (req, res) => {
  const clientKey = req.headers["x-api-key"] || req.query.key;
  if (!clientKey || clientKey !== process.env.API_SECRET) {
    return res.status(403).json({ message: "Clé API invalide" });
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin
      : o instanceof RegExp  ? o.test(origin)
      : false
    )) {
    return res.status(403).json({ message: "Origine non autorisée" });
  }
  try {
    const shopRes = await fetch(`${shopifyBaseUrl}/customers.json?limit=100`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
        "Content-Type": "application/json"
      }
    });
    const data = await shopRes.json();
    if (!data.customers) {
      return res.status(500).json({ message: "Aucun client trouvé", raw: data });
    }
    const clients = await Promise.all(
      data.customers.map(async c => {
        try {
          const detailRes = await fetch(`${shopifyBaseUrl}/customers/${c.id}.json`, {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_API_KEY,
              "Content-Type": "application/json"
            }
          });
          const full = (await detailRes.json()).customer;
          return {
            id:    full.id,
            label: (full.first_name || full.last_name)
              ? `${full.first_name || ''} ${full.last_name || ''}`.trim()
              : full.default_address?.company
                || full.addresses?.[0]?.company
                || full.email
                || `Client ${full.id}`
          };
        } catch {
          return { id: c.id, label: `Client ${c.id}` };
        }
      })
    );
    res.json(clients);
  } catch (err) {
    console.error("❌ Erreur /list-customers :", err);
    res.status(500).json({ message: "Erreur serveur", detail: err.message });
  }
});

// =========================================
// 8.1. MONTAGE DES ROUTES DRAFT ORDERS
//      (complete-draft-order & send-order-confirmation)
// =========================================
app.use('/', draftOrderRoutes);

// =========================================
// 8.2. Définitions déplacées dans draftOrderRoutes.js
//      - POST /complete-draft-order
//      - POST /send-order-confirmation
// =========================================

// =========================================
// 9. ROUTE POST : /send-order-email
//     (également déplacée dans draftOrderRoutes.js)
// =========================================

// =========================================
// 10. LANCEMENT DU SERVEUR
// =========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});

