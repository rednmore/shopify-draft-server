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
const fetch         = globalThis.fetch;
const rateLimit     = require('express-rate-limit');
const nodemailer    = require('nodemailer'); // <-- AJOUT
require('dotenv').config();

console.log('→ Loaded ENV:',
  'API_SECRET=',       process.env.API_SECRET,
  'SHOPIFY_API_URL=',  process.env.SHOPIFY_API_URL,
  'SHOPIFY_API_KEY=',  process.env.SHOPIFY_API_KEY
);

// Adresse interne pour copie des emails
const COPY_TO_ADDRESS = process.env.COPY_TO_ADDRESS || 'info@rednmore.com';

// Routes et enregistrement des webhooks
const syncCustomerData = require('./routes/sync-customer-data');
const draftOrderRoutes = require('./routes/draftOrderRoutes');
require('./scripts/register-webhook');

// =========================================
/* 2. INITIALISATION DE L'APPLICATION */
// =========================================
const app = express();
app.set('trust proxy', 1); // Faire confiance au proxy pour X-Forwarded-

// =========================================
/* 3. CONSTANTES GLOBALES */
// =========================================
const ALLOWED_ORIGINS = [
  'https://www.ikyum.com',            // <-- AJOUT : IKYUM
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
/* 4. MIDDLEWARES GLOBAUX */
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
/* 5. ROUTE WEBHOOK : /sync-customer-data */
// =========================================
app.use('/sync-customer-data', syncCustomerData);

// =========================================
/* 6. LIMITEUR POUR DRAFT ORDERS */
// =========================================
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Trop de créations de commande. Veuillez patienter.' }
});

// =========================================
/* 7. ROUTE GET : /list-customers
      Récupère la liste des clients pour le staff */
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
/* 8.2. LIMITEUR IKYUM (formulaire RegPro) — AJOUT */
// =========================================
const ikyumLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 20,             // 20 req/min/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de requêtes. Veuillez réessayer plus tard.' }
});

// =========================================
/* 9.a. HELPERS IKYUM — AJOUT */
// =========================================
function csvFromObject(obj) {
  const keys = Object.keys(obj || {});
  const esc = s => `"${String(s ?? '').replace(/[\r\n]/g, ' ').replace(/"/g, '""')}"`;
  const header = keys.map(esc).join(';');
  const row    = keys.map(k => esc(obj[k])).join(';');
  return header + '\r\n' + row + '\r\n';
}
function escapeHTML(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
async function verifyRecaptchaV3(token, expectedAction) {
  const secret = process.env.IKYUM_RECAPTCHA_SECRET; // v3 (domaine ikyum.com)
  if (!secret) return { ok:false, reason:'missing-secret' };
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token || '');
  const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const json = await r.json().catch(()=>({}));
  if (!json.success) return { ok:false, reason:'recaptcha-failed', details:json };
  const min = Number(process.env.IKYUM_RECAPTCHA_MIN_SCORE || '0.5');
  if (typeof json.score === 'number' && json.score < min) return { ok:false, reason:'low-score', details:json };
  if (expectedAction && json.action && json.action !== expectedAction) return { ok:false, reason:'wrong-action', details:json };
  return { ok:true, details:json };
}
function makeIkyumTransport() {
  // SMTP Infomaniak dédié IKYUM
  return nodemailer.createTransport({
    host: process.env.IKYUM_SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.IKYUM_SMTP_PORT || '587'),
    secure: false, // STARTTLS (587)
    auth: {
      user: process.env.IKYUM_SMTP_USER, // ex: no-reply@ikyum.com
      pass: process.env.IKYUM_SMTP_PASS
    }
  });
}

// =========================================
/* 9.b. ENDPOINT IKYUM — RegPro (submit) — AJOUT
   N'IMPACTE PAS ZYO */
// =========================================
app.post('/ikyum/regpro/submit', ikyumLimiter, async function(req, res) {
  try {
    const { data, token, token_user, hp } = req.body || {};

    // Honeypot: on simule le succès (aucun envoi)
    if (hp && String(hp).trim() !== '') {
      return res.json({ ok:true, skipped:'honeypot' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok:false, error:'invalid-payload' });
    }
    if (!token) {
      return res.status(400).json({ ok:false, error:'missing-recaptcha-token' });
    }

    // reCAPTCHA v3 (action admin)
    const adminVR = await verifyRecaptchaV3(token, 'regpro_admin');
    if (!adminVR.ok) {
      return res.status(403).json({ ok:false, error:adminVR.reason, details:adminVR.details });
    }

    // Prépare envois
    const transporter = makeIkyumTransport();
    const adminTo = (process.env.IKYUM_ADMIN_RECIPIENTS || COPY_TO_ADDRESS || '').trim(); // ex: "info@ikyum.com,lmurith@ikyum.com"
    if (!adminTo) return res.status(500).json({ ok:false, error:'missing-admin-recipients' });

    const csv = csvFromObject(data);
    const userEmail = (data.email || data.contact_email || data.delivery_email || '').trim();
    const brand = process.env.IKYUM_BRAND || 'IKYUM';

    // --- Email ADMIN
    await transporter.sendMail({
      from: process.env.IKYUM_SMTP_FROM || process.env.IKYUM_SMTP_USER, // ex: "IKYUM <no-reply@ikyum.com>"
      to: adminTo,
      replyTo: userEmail || adminTo,
      subject: `New registration — ${brand}: ${data.company_name || 'n/a'}`,
      html: `
        <p><strong>${brand}</strong> — New registration</p>
        <p><strong>Company:</strong> ${escapeHTML(data.company_name || '')}</p>
        <p><strong>Contact:</strong> ${escapeHTML(data.contact_person || '')}</p>
        <p><strong>Email:</strong> ${escapeHTML(userEmail || '')}</p>
        <p>Full JSON payload below / CSV attached.</p>
        <pre style="background:#f7f7f7;padding:10px;border-radius:6px;white-space:pre-wrap;">${escapeHTML(JSON.stringify(data, null, 2))}</pre>
      `,
      attachments: [{
        filename: 'registration.csv',
        content: Buffer.from(csv, 'utf8'),
        contentType: 'text/csv; charset=utf-8'
      }]
    });

    // --- Email USER (optionnel, uniquement si token_user valide)
    if (userEmail && token_user) {
      const userVR = await verifyRecaptchaV3(token_user, 'regpro_user');
      if (userVR.ok) {
        await transporter.sendMail({
          from: process.env.IKYUM_SMTP_FROM || process.env.IKYUM_SMTP_USER,
          to: userEmail,
          subject: `Thank you — ${brand}`,
          html: `
            <p>Thank you for your request.</p>
            <p>We received the company name: <strong>${escapeHTML(data.company_name || '')}</strong>.</p>
            <p>We will get back to you shortly.</p>
          `
        });
      } else {
        console.warn('[IKYUM user mail] recaptcha failed', userVR);
      }
    }

    return res.json({ ok:true });
  } catch (err) {
    console.error('❌ /ikyum/regpro/submit error:', err);
    return res.status(500).json({ ok:false, error:'server-error' });
  }
});

// =========================================
/* 9. (routes déplacées dans draftOrderRoutes.js)
      - POST /complete-draft-order
      - POST /send-order-confirmation
      - POST /send-order-email */
// =========================================

// =========================================
/* 10. LANCEMENT DU SERVEUR */
// =========================================
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('✅ Serveur actif sur le port ' + PORT);
});
