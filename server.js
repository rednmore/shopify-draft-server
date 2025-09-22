// =========================================
// server.js
// Structuré en chapitres pour faciliter les modifications
// =========================================

// =========================================
/* 1. IMPORTS ET CONFIGURATION */
// =========================================
const express       = require('express');
const bodyParser    = require('body-parser');
const cors          = require('cors'); // laissé importé, mais non utilisé plus bas
const fetch         = globalThis.fetch;
const rateLimit     = require('express-rate-limit');
const nodemailer    = require('nodemailer'); // <-- AJOUT
require('dotenv').config();

// === Handlers globaux pour LOGUER les erreurs fatales ===
process.on('uncaughtException', (err) => {
  console.error('❌ UncaughtException:', err?.stack || err);
  // Ne pas process.exit ici -> laissez Render redémarrer si nécessaire
});
process.on('unhandledRejection', (reason, p) => {
  console.error('❌ UnhandledRejection at:', p, 'reason:', reason);
});

function mask(v) {
  if (!v) return v;
  if (v.length <= 8) return '********';
  return v.slice(0,4) + '…' + v.slice(-4);
}

// console.log('→ Loaded ENV:',
// <<<<<<< HEAD
//   'API_SECRET=', mask(process.env.API_SECRET || ''),
//   'SHOPIFY_API_URL=', process.env.SHOPIFY_API_URL || '',
//   'SHOPIFY_API_KEY=', mask(process.env.SHOPIFY_API_KEY || '')
// =======
//   'API_SECRET=',        process.env.API_SECRET,
//   'SHOPIFY_API_URL=',   process.env.SHOPIFY_API_URL,
//   'SHOPIFY_API_KEY=',   process.env.SHOPIFY_API_KEY
// >>>>>>> origin/lhu
// );

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
  // Domaines IKYUM (avec et sans www)
  'https://ikyum.com',
  'https://www.ikyum.com',

  // Domaine ZYÖ (Unicode) + punycode
  'https://www.zyö.com',
  'https://www.xn--zy-gka.com',

  // Admin Shopify (sans www)
  'https://admin.shopify.com',

  // Dev Shopify (myshopify subdomain)
  'https://ikyum.myshopify.com',

  // Local
  'http://localhost:3000',

  // Patterns Shopify
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/,
];

// évite template literal
const shopifyBaseUrl = 'https://' + process.env.SHOPIFY_API_URL + '/admin/api/2023-10';

// Headers Shopify (helper simple)
function shopifyHeaders() {
  return {
    'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY,
    'Content-Type': 'application/json'
  };
}

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
/* 6. LIMITEUR POUR DRAFT ORDERS */
// =========================================
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { message: 'Trop de créations de commande. Veuillez patienter.' }
});
// =========================================
/* 6.b. LIMITEUR POUR CREATE CUSTOMER */
// =========================================
const createCustomerLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  max: 20,                   // 20 créations max / 10 min / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de créations de client. Veuillez patienter.' }
});

// =========================================
/* 6.c. IDEMPOTENCE EN MÉMOIRE (10 min) */
// =========================================
const idemCache = new Map(); // key -> { ts, response }
const IDEM_TTL_MS = 10 * 60 * 1000;
function getIdem(key) {
  if (!key) return null;
  const val = idemCache.get(key);
  if (!val) return null;
  if (Date.now() - val.ts > IDEM_TTL_MS) {
    idemCache.delete(key);
    return null;
  }
  return val.response;
}
function setIdem(key, response) {
  if (!key) return;
  idemCache.set(key, { ts: Date.now(), response });
}
// (petit garbage collector)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idemCache.entries()) {
    if (now - v.ts > IDEM_TTL_MS) idemCache.delete(k);
  }
}, 5 * 60 * 1000);

// =========================================
/* 7. ROUTE GET : /list-customers
      Récupère la liste des clients pour le staff */
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
          const full = (await detailRes.json()).customer;

          // --- Priorité à la société (changement minimal) ---
          const companyFromDefault = full && full.default_address && full.default_address.company;
          const companyFromFirst   = full && full.addresses && full.addresses[0] && full.addresses[0].company;
          const company            = companyFromDefault || companyFromFirst;

          let label;
          if (company) {
            label = company; // société en premier
          } else if (full.first_name || full.last_name) {
            label = ((full.first_name || '') + ' ' + (full.last_name || '')).trim();
          } else if (full.email) {
            label = full.email;
          } else {
            label = 'Client ' + full.id;
          }
          // --- fin changement ---

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
/* 7.b. ROUTE POST : /create-customer
      Crée un client + adresse par défaut + métachamps (company mirror)
      + Unicité email + Idempotency-Key (10 min) */
// =========================================
app.post('/create-customer', createCustomerLimiter, async (req, res) => {
  try {
    // Auth par clé partagée (même logique que /list-customers)
    const clientKey = req.headers['x-api-key'] || req.query.key;
    if (!clientKey || clientKey !== process.env.API_SECRET) {
      return res.status(403).json({ message: 'Clé API invalide' });
    }

    // Origine autorisée (même logique que /list-customers)
    const origin = req.get('origin');
    const isAllowedOrigin = !!origin && ALLOWED_ORIGINS.some(o => (
      typeof o === 'string' ? o === origin : (o instanceof RegExp ? o.test(origin) : false)
    ));
    if (origin && !isAllowedOrigin) {
      return res.status(403).json({ message: 'Origine non autorisée' });
    }

    // Idempotency-Key
    const idemKey = req.headers['idempotency-key'];
    const cached = getIdem(idemKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const {
      email, first_name, last_name, phone, note, tags = [],
      default_address = {},
      metafields = []
    } = req.body || {};

    // Validation minimale (champs obligatoires)
    if (!email || !first_name || !last_name) {
      return res.status(400).json({ message: 'Champs obligatoires manquants (email, first_name, last_name)' });
    }
    if (!default_address || !default_address.address1 || !default_address.zip || !default_address.city || !default_address.country_code || !default_address.company) {
      return res.status(400).json({ message: 'Adresse par défaut incomplète (address1, zip, city, country_code, company requis)' });
    }

    // 0) Unicité email : search avant création
    const q = encodeURIComponent(`email:${email}`);
    let rSearch = await fetch(`${shopifyBaseUrl}/customers/search.json?query=${q}`, { headers: shopifyHeaders() });
    let jSearch = await rSearch.json().catch(()=>({}));
    const existing = Array.isArray(jSearch?.customers) ? jSearch.customers[0] : null;
    if (existing?.id) {
      const resp = { message: 'Customer already exists', id: existing.id, customer: existing, exists: true };
      setIdem(idemKey, resp);
      return res.status(409).json(resp);
    }

    // 1) Création du client (Admin REST)
    const createPayload = {
      customer: {
        email,
        first_name,
        last_name,
        phone: phone || null,
        note: note || null,
        tags: Array.isArray(tags) ? tags.join(',') : String(tags || ''),
        addresses: [ default_address ],
        verified_email: true
      }
    };

    let r = await fetch(`${shopifyBaseUrl}/customers.json`, {
      method: 'POST',
      headers: shopifyHeaders(),
      body: JSON.stringify(createPayload)
    });
    let j = await r.json().catch(()=>({}));
    if (!r.ok || !j?.customer?.id) {
      return res.status(r.status || 500).json({ message: 'Échec création client', errors: j?.errors || j });
    }
    const customer = j.customer;

    // 2) Écrire les métachamps (miroir company + TVA éventuelle)
    if (Array.isArray(metafields) && metafields.length) {
      for (const mf of metafields) {
        try {
          const body = { metafield: mf };
          const mRes = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/metafields.json`, {
            method: 'POST',
            headers: shopifyHeaders(),
            body: JSON.stringify(body)
          });
          if (!mRes.ok) {
            const mt = await mRes.text().catch(()=> '');
            console.warn('⚠️ Metafield creation failed:', mRes.status, mt);
          }
        } catch (e) {
          console.warn('⚠️ Metafield exception:', e?.message || e);
        }
      }
    } else {
      // a minima, garder un miroir company_name
      const companyName = default_address.company || '';
      if (companyName) {
        try {
          const body = { metafield: {
            namespace: 'custom',
            key: 'company_name',
            type: 'single_line_text_field',
            value: companyName
          }};
          await fetch(`${shopifyBaseUrl}/customers/${customer.id}/metafields.json`, {
            method: 'POST',
            headers: shopifyHeaders(),
            body: JSON.stringify(body)
          });
        } catch(e) {
          console.warn('⚠️ Metafield company_name failed:', e?.message || e);
        }
      }
      // TVA optionnelle (si vous envoyez "vat_number" en front)
      const mfVat = metafields.find(m => m.key === 'vat_number');
      if (!mfVat && (req.body?.vat_number || '').trim()) {
        try {
          const body = { metafield: {
            namespace: 'custom',
            key: 'vat_number',
            type: 'single_line_text_field',
            value: String(req.body.vat_number).trim()
          }};
          await fetch(`${shopifyBaseUrl}/customers/${customer.id}/metafields.json`, {
            method: 'POST',
            headers: shopifyHeaders(),
            body: JSON.stringify(body)
          });
        } catch(e) {
          console.warn('⚠️ Metafield vat_number failed:', e?.message || e);
        }
      }
    }

    // 3) S’assurer que l’adresse par défaut est bien déclarée par Shopify
    try {
      const addrRes = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/addresses.json`, {
        headers: shopifyHeaders()
      });
      const addrJson = await addrRes.json().catch(()=>({}));
      const firstAddr = Array.isArray(addrJson?.addresses) ? addrJson.addresses[0] : null;
      if (firstAddr?.id && !firstAddr?.default) {
        const defRes = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/addresses/${firstAddr.id}/default.json`, {
          method: 'PUT',
          headers: shopifyHeaders()
        });
        if (!defRes.ok) {
          const dt = await defRes.text().catch(()=> '');
          console.warn('⚠️ set default address failed:', defRes.status, dt);
        }
      }
    } catch(e) {
      console.warn('⚠️ ensure default address failed:', e?.message || e);
    }

    const resp = { id: customer.id, customer };
    setIdem(idemKey, resp);
    return res.json(resp);
  } catch (err) {
    console.error('❌ /create-customer error:', err?.response?.data || err.message || err);
    return res.status(err?.response?.status || 500).json({
      message: err?.response?.data?.errors || err.message || 'Server error'
    });
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

/* ================================
   9.a bis — HELPERS SHOPIFY COMPANY
   (MAJ address.company côté Admin)
   ================================ */

// Trouve l'ID client par email (customers/search)
async function findCustomerIdByEmail(email) {
  if (!email) return null;
  const q = encodeURIComponent(`email:${email}`);
  const r = await fetch(`${shopifyBaseUrl}/customers/search.json?query=${q}`, {
    headers: shopifyHeaders()
  });
  const j = await r.json().catch(()=>({}));
  const c = Array.isArray(j.customers) ? j.customers[0] : null;
  return c?.id || null;
}

// Récupère le détail complet d'un client
async function fetchCustomerDetail(customerId) {
  const r = await fetch(`${shopifyBaseUrl}/customers/${customerId}.json`, {
    headers: shopifyHeaders()
  });
  const j = await r.json().catch(()=>({}));
  return j.customer || null;
}

// Met à jour l'adresse par défaut (endpoint addresses)
async function updateCustomerDefaultAddressCompany(customer, company) {
  if (!customer || !company) return false;

  // 1) cas idéal : default_address connu
  if (customer.default_address?.id) {
    const addrId = customer.default_address.id;
    const body = {
      address: {
        ...customer.default_address,
        company: company
      }
    };
    const r = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/addresses/${addrId}.json`, {
      method: 'PUT',
      headers: shopifyHeaders(),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      console.warn('⚠️ update default_address.company failed:', r.status, t);
      return false;
    }
    return true;
  }

  // 2) fallback : première adresse si présente
  if (Array.isArray(customer.addresses) && customer.addresses[0]?.id) {
    const addr = customer.addresses[0];
    const body = {
      address: {
        ...addr,
        company: company
      }
    };
    const r = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/addresses/${addr.id}.json`, {
      method: 'PUT',
      headers: shopifyHeaders(),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      console.warn('⚠️ update first_address.company failed:', r.status, t);
      return false;
    }
    return true;
  }

  // 3) dernier recours : créer une adresse minimale avec company et la définir par défaut
  const createBody = {
    address: {
      company: company,
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      address1: customer.default_address?.address1 || customer.addresses?.[0]?.address1 || '',
      city: customer.default_address?.city || customer.addresses?.[0]?.city || '',
      country: customer.default_address?.country || customer.addresses?.[0]?.country || 'Switzerland',
      default: true
    }
  };
  const r = await fetch(`${shopifyBaseUrl}/customers/${customer.id}/addresses.json`, {
    method: 'POST',
    headers: shopifyHeaders(),
    body: JSON.stringify(createBody)
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> '');
    console.warn('⚠️ create default address with company failed:', r.status, t);
    return false;
  }
  return true;
}

// Orchestrateur : à partir de data RegPro, tente d'updater address.company
async function ensureCustomerCompany(data) {
  try {
    const rawCompany = (data.company_name || data.company || '').trim();
    if (!rawCompany) return { ok:false, reason:'no-company' };

    // On privilégie un customer_id explicite si fourni
    let customerId = data.customer_id && String(data.customer_id).match(/^\d+$/) ? String(data.customer_id) : null;

    // Sinon, on tente par email
    const userEmail = (data.email || data.contact_email || data.delivery_email || '').trim();
    if (!customerId && userEmail) {
      customerId = await findCustomerIdByEmail(userEmail);
    }
    if (!customerId) return { ok:false, reason:'no-customer' };

    const customer = await fetchCustomerDetail(customerId);
    if (!customer) return { ok:false, reason:'not-found' };

    const ok = await updateCustomerDefaultAddressCompany(customer, rawCompany);
    return ok ? { ok:true } : { ok:false, reason:'update-failed' };
  } catch (e) {
    console.warn('⚠️ ensureCustomerCompany error:', e?.message || e);
    return { ok:false, reason:'exception' };
  }
}

// =========================================
/* 9.b. ENDPOINT IKYUM — RegPro (submit) — AJOUT
   N'IMPACTE PAS ZYO */
// =========================================
app.post('/ikyum/regpro/submit', ikyumLimiter, async function(req, res) {
  try {
    const { data, hp } = req.body || {};

    // Honeypot: on simule le succès (aucun envoi)
    if (hp && String(hp).trim() !== '') {
      return res.json({ ok:true, skipped:'honeypot' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok:false, error:'invalid-payload' });
    }
    // Note: Shopify's built-in hCaptcha handles spam protection automatically
    // No additional CAPTCHA verification needed on server-side

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

    // --- Email USER (optionnel)
    if (userEmail) {
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
    }

    // === NOUVEAU : tentative de MAJ Admin -> address.company ===
    if (process.env.SHOPIFY_API_URL && process.env.SHOPIFY_API_KEY) {
      const syncRes = await ensureCustomerCompany(data);
      if (!syncRes.ok) {
        console.warn('⚠️ address.company not updated:', syncRes.reason);
      }
    } else {
      console.warn('⚠️ Missing SHOPIFY_API_URL / SHOPIFY_API_KEY — skip address.company update');
    }
    // === /NOUVEAU ===

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('✅ Serveur actif sur le port ' + PORT);
});
