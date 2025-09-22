/**
 * Main server file - Refactored following ExpressJS best practices
 * Following the rules for proper Express.js application structure
 */

// =========================================
/* 1. IMPORTS AND CONFIGURATION */
// =========================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Import configuration
const { SHOPIFY_API_VERSION } = require('./config/shopify');

// Import middleware
const {
  configureHelmet,
  createGlobalRateLimit,
  addSecurityHeaders
} = require('./middleware/security');

// Import controllers
const { registerAllRoutes, setupHealthCheck, ALLOWED_ORIGINS } = require('./controllers/apiController');

// Import webhook registration
const { registerDefaultWebhooks } = require('./actions/webhooks/registerWebhook');

// =========================================
/* 2. GLOBAL ERROR HANDLERS */
// =========================================
process.on('uncaughtException', (err) => {
  console.error('❌ UncaughtException:', err?.stack || err);
  // Don't exit in production - let the process manager handle restarts
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UnhandledRejection at:', promise, 'reason:', reason);
  // Don't exit in production - let the process manager handle restarts
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// =========================================
/* 3. UTILITY FUNCTIONS */
// =========================================

/**
 * Mask sensitive values for logging
 * @param {string} value - Value to mask
 * @returns {string} Masked value
 */
function maskSensitive(value) {
  if (!value) return value;
  if (value.length <= 8) return '********';
  return value.slice(0, 4) + '…' + value.slice(-4);
}

/**
 * Validate required environment variables
 * @returns {Object} Validation result
 */
function validateEnvironment() {
  const required = [
    'SHOPIFY_API_URL',
    'SHOPIFY_API_KEY',
    'API_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    return {
      valid: false,
      missing: missing,
      message: `Missing required environment variables: ${missing.join(', ')}`
    };
  }

  return {
    valid: true,
    message: 'All required environment variables are present'
  };
}

/**
 * Log startup information
 */
function logStartupInfo() {
  console.log('🚀 Shopify Draft Server Starting...');
  console.log('📋 Configuration:');
  console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
  console.log('   PORT:', process.env.PORT || 3000);
  console.log('   SHOPIFY_API_URL:', process.env.SHOPIFY_API_URL || '(not set)');
  console.log('   SHOPIFY_API_VERSION:', SHOPIFY_API_VERSION);
  console.log('   API_SECRET:', maskSensitive(process.env.API_SECRET));
  console.log('   PUBLIC_WEBHOOK_URL:', process.env.PUBLIC_WEBHOOK_URL || '(auto-detect)');
  
  if (process.env.IKYUM_SMTP_USER) {
    console.log('   IKYUM_SMTP_USER:', maskSensitive(process.env.IKYUM_SMTP_USER));
    console.log('   IKYUM_ADMIN_RECIPIENTS:', process.env.IKYUM_ADMIN_RECIPIENTS ? 'configured' : '(not set)');
  }
}

// =========================================
/* 4. APPLICATION INITIALIZATION */
// =========================================

/**
 * Create and configure Express application
 * @returns {Object} Configured Express app
 */
function createApp() {
  const app = express();

  // Trust proxy for proper IP detection
  app.set('trust proxy', 1);

  // Disable X-Powered-By header
  app.disable('x-powered-by');

  // =========================================
  /* 4.1. SECURITY MIDDLEWARE */
  // =========================================
  
  // Helmet security headers
  app.use(configureHelmet());
  
  // Additional security headers
  app.use(addSecurityHeaders);

  // =========================================
  /* 4.2. CORS CONFIGURATION */
  // =========================================
  
  app.use(cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);
      
      const isAllowed = ALLOWED_ORIGINS.some(allowed => {
        if (typeof allowed === 'string') {
          return allowed === origin;
        }
        if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      });
      
      if (isAllowed) {
        return callback(null, true);
      }
      
      console.warn('⛔ CORS blocked origin:', origin);
      callback(new Error('CORS policy violation'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'X-API-KEY', 
      'Idempotency-Key',
      'X-Shopify-Topic',
      'X-Shopify-Shop-Domain',
      'X-Shopify-Hmac-Sha256'
    ],
    credentials: true,
    optionsSuccessStatus: 200
  }));

  // =========================================
  /* 4.3. BODY PARSING */
  // =========================================
  
  // JSON body parser with size limit
  app.use(express.json({ 
    limit: '1mb',
    strict: true
  }));
  
  // URL-encoded body parser
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '1mb' 
  }));

  // =========================================
  /* 4.4. RATE LIMITING */
  // =========================================
  
  // Global rate limiting
  app.use(createGlobalRateLimit());

  // =========================================
  /* 4.5. HEALTH CHECK */
  // =========================================
  
  // Basic health check (before other routes)
  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      shopify_api_version: SHOPIFY_API_VERSION
    });
  });

  // =========================================
  /* 4.6. API ROUTES */
  // =========================================
  
  // Register all API routes using the new structure
  registerAllRoutes(app);
  
  // Setup additional endpoints
  setupHealthCheck(app);

  // =========================================
  /* 4.7. ERROR HANDLING */
  // =========================================
  
  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      message: 'Endpoint not found',
      path: req.originalUrl,
      method: req.method,
      available_endpoints: [
        'GET /health',
        'GET /api/info',
        'GET /list-customers',
        'POST /create-customer',
        'POST /create-draft-order',
        'POST /complete-draft-order',
        'POST /send-order-confirmation',
        'POST /send-order-email',
        'POST /ikyum/regpro/submit',
        'POST /sync-customer-data'
      ]
    });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('❌ Global error handler:', err.stack || err);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(err.status || 500).json({
      message: err.message || 'Internal server error',
      ...(isDevelopment && {
        stack: err.stack,
        details: err
      }),
      timestamp: new Date().toISOString()
    });
  });

  return app;
}

// =========================================
/* 5. SERVER STARTUP */
// =========================================

/**
 * Register webhooks on startup
 */
async function setupWebhooks() {
  try {
    console.log('🔄 Setting up Shopify webhooks...');
    
    const baseUrl = process.env.PUBLIC_WEBHOOK_URL || 
                   'https://shopify-draft-server.onrender.com';
    
    const results = await registerDefaultWebhooks(baseUrl);
    
    results.forEach(result => {
      if (result.success) {
        console.log(`✅ Webhook ${result.action}: ${result.webhook?.topic || result.topic}`);
      } else {
        console.error(`❌ Webhook failed: ${result.topic} - ${result.error}`);
      }
    });
    
    console.log(`✅ Webhook setup completed (${results.length} webhooks processed)`);
  } catch (error) {
    console.error('❌ Webhook setup failed:', error.message);
    // Don't fail startup if webhooks fail - they can be registered manually
  }
}

/**
 * Start the server
 */
async function startServer() {
  try {
    // Log startup info
    logStartupInfo();
    
    // Validate environment
    const envValidation = validateEnvironment();
    if (!envValidation.valid) {
      console.error('❌ Environment validation failed:', envValidation.message);
      process.exit(1);
    }
    console.log('✅ Environment validation passed');

    // Create Express app
    const app = createApp();
    
    // Get port
    const PORT = process.env.PORT || 3000;
    
    // Start listening
    const server = app.listen(PORT, () => {
      console.log(`✅ Server is running on port ${PORT}`);
      console.log(`🌐 Health check: http://localhost:${PORT}/health`);
      console.log(`📚 API info: http://localhost:${PORT}/api/info`);
      
      // Setup webhooks after server is running
      if (process.env.SHOPIFY_API_URL && process.env.SHOPIFY_API_KEY) {
        setupWebhooks();
      } else {
        console.warn('⚠️ Shopify credentials not configured - skipping webhook setup');
      }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('🛑 SIGINT received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// =========================================
/* 6. EXPORT AND START */
// =========================================

// Export for testing
module.exports = {
  createApp,
  startServer,
  validateEnvironment,
  maskSensitive
};

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}
