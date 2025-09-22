/**
 * Main API Controller
 * Following ExpressJS best practices as defined in the rules
 * Uses route configuration to handle requests with proper middleware and validation
 */

const { getRouteConfig } = require('../config/routes');
const { handleShopifyError } = require('../config/shopify');

// Import middleware
const { 
  authenticateApiKey, 
  optionalApiKey, 
  verifyShopifyWebhook 
} = require('../middleware/auth');

const {
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validateOrigin,
  validateIdempotencyKey,
  sanitizeInput
} = require('../middleware/validation');

const {
  validateHoneypot,
  addSecurityHeaders,
  securityLogger
} = require('../middleware/security');

// CORS configuration
const ALLOWED_ORIGINS = [
  // IKYUM domains
  'https://ikyum.com',
  'https://www.ikyum.com',
  
  // ZYÖ domains (Unicode + punycode)
  'https://www.zyö.com',
  'https://www.xn--zy-gka.com',
  
  // Shopify domains
  'https://admin.shopify.com',
  'https://ikyum.myshopify.com',
  
  // Local development
  'http://localhost:3000',
  
  // Shopify patterns
  /\.myshopify\.com$/,
  /\.cdn\.shopify\.com$/,
  /\.shopifycloud\.com$/,
];

/**
 * Middleware mapping
 * Maps middleware names to actual middleware functions
 */
const MIDDLEWARE_MAP = {
  authenticateApiKey,
  optionalApiKey,
  verifyShopifyWebhook,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validateOrigin: validateOrigin(ALLOWED_ORIGINS),
  validateIdempotencyKey,
  validateHoneypot: validateHoneypot('hp'),
  sanitizeInput,
  addSecurityHeaders,
  securityLogger
};

/**
 * Create middleware chain for a route
 * @param {Array} middlewareNames - Array of middleware names
 * @param {Object} validation - Validation schemas
 * @returns {Array} Array of middleware functions
 */
function createMiddlewareChain(middlewareNames = [], validation = {}) {
  const middlewares = [];

  // Always add security middleware first
  middlewares.push(securityLogger);
  middlewares.push(sanitizeInput);

  // Add route-specific middleware
  middlewareNames.forEach(middlewareName => {
    const middleware = MIDDLEWARE_MAP[middlewareName];
    if (middleware) {
      middlewares.push(middleware);
    } else {
      console.warn(`⚠️ Unknown middleware: ${middlewareName}`);
    }
  });

  // Add validation middleware
  if (validation.body) {
    middlewares.push(validateBody(validation.body));
  }
  if (validation.query) {
    middlewares.push(validateQuery(validation.query));
  }
  if (validation.params) {
    middlewares.push(validateParams(validation.params));
  }
  if (validation.headers) {
    middlewares.push(validateHeaders(validation.headers));
  }

  return middlewares;
}

/**
 * Create route handler from configuration
 * @param {string} routeName - Name of the route
 * @returns {Function} Express route handler
 */
function createRouteHandler(routeName) {
  const config = getRouteConfig(routeName);
  
  if (!config) {
    throw new Error(`Route configuration not found: ${routeName}`);
  }

  const middlewares = createMiddlewareChain(config.middleware, config.validation);

  // Return the complete handler with middleware chain
  return [
    ...middlewares,
    async (req, res) => {
      const startTime = Date.now();
      
      try {
        // Handle idempotency
        if (req.idempotencyKey) {
          const { getIdem } = require('../middleware/idempotency');
          const cached = getIdem(req.idempotencyKey);
          if (cached) {
            return res.status(200).json(cached);
          }
        }

        // Execute the action
        const result = await config.action(req, res);

        // Store result for idempotency if key provided
        if (req.idempotencyKey) {
          const { setIdem } = require('../middleware/idempotency');
          setIdem(req.idempotencyKey, result);
        }

        // Add processing time to response
        const processingTime = Date.now() - startTime;
        const response = {
          ...result,
          processing_time_ms: processingTime
        };

        // Validate response if schema provided
        if (config.validation?.response) {
          try {
            config.validation.response.parse(response);
          } catch (validationError) {
            console.warn('⚠️ Response validation failed:', validationError.message);
            // Don't fail the request for response validation errors
          }
        }

        res.json(response);
      } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ Route ${routeName} error after ${processingTime}ms:`, error);

        // Handle different types of errors
        let statusCode = 500;
        let errorResponse = {
          message: 'Internal server error',
          processing_time_ms: processingTime
        };

        if (error.message && error.message.includes('Shopify API error')) {
          const shopifyError = handleShopifyError(error, `Route ${routeName}`);
          statusCode = shopifyError.status;
          errorResponse = shopifyError;
        } else if (error.name === 'ValidationError') {
          statusCode = 400;
          errorResponse = {
            message: 'Validation failed',
            error: error.message,
            processing_time_ms: processingTime
          };
        } else if (error.status) {
          statusCode = error.status;
          errorResponse = {
            message: error.message,
            processing_time_ms: processingTime
          };
        } else {
          errorResponse = {
            message: error.message || 'Internal server error',
            processing_time_ms: processingTime
          };
        }

        res.status(statusCode).json(errorResponse);
      }
    }
  ];
}

/**
 * Register a route with Express app
 * @param {Object} app - Express app instance
 * @param {string} routeName - Name of the route
 */
function registerRoute(app, routeName) {
  const config = getRouteConfig(routeName);
  
  if (!config) {
    console.error(`❌ Cannot register route: ${routeName} - configuration not found`);
    return;
  }

  const handler = createRouteHandler(routeName);
  const method = config.method.toLowerCase();

  // Register the route
  app[method](config.path, ...handler);
  
  console.log(`✅ Registered ${config.method} ${config.path} -> ${routeName}`);
}

/**
 * Register all routes from configuration
 * @param {Object} app - Express app instance
 */
function registerAllRoutes(app) {
  const { getAllRouteConfigs } = require('../config/routes');
  const routeConfigs = getAllRouteConfigs();
  
  console.log('🔄 Registering API routes...');
  
  Object.keys(routeConfigs).forEach(routeName => {
    try {
      registerRoute(app, routeName);
    } catch (error) {
      console.error(`❌ Failed to register route ${routeName}:`, error.message);
    }
  });
  
  console.log(`✅ Registered ${Object.keys(routeConfigs).length} API routes`);
}

/**
 * Get API route information
 * @returns {Object} API route information
 */
function getApiInfo() {
  const { getRouteStats } = require('../config/routes');
  return {
    name: 'Shopify Draft Server API',
    version: '1.0.0',
    description: 'Express.js API for managing Shopify draft orders and customer data',
    routes: getRouteStats(),
    api_version: '2025-07',
    shopify_api_version: '2025-07'
  };
}

/**
 * Create health check endpoint
 * @param {Object} app - Express app instance
 */
function setupHealthCheck(app) {
  app.get('/api/info', (req, res) => {
    res.json(getApiInfo());
  });
}

module.exports = {
  createRouteHandler,
  registerRoute,
  registerAllRoutes,
  setupHealthCheck,
  getApiInfo,
  MIDDLEWARE_MAP,
  ALLOWED_ORIGINS
};
