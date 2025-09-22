/**
 * Authentication middleware for API endpoints
 * Following ExpressJS best practices as defined in the rules
 */

const { ApiKeyHeaderSchema, ApiKeyQuerySchema } = require('../schemas/validation');

/**
 * API Key authentication middleware
 * Validates the API key from either header (X-API-KEY) or query parameter (key)
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function authenticateApiKey(req, res, next) {
  try {
    // Try header first, then query parameter
    const headerKey = req.headers['x-api-key'];
    const queryKey = req.query.key;
    const providedKey = headerKey || queryKey;

    if (!providedKey) {
      return res.status(401).json({ 
        message: 'API key required',
        error: 'Missing X-API-KEY header or key query parameter' 
      });
    }

    const expectedKey = process.env.API_SECRET;
    if (!expectedKey) {
      console.error('❌ API_SECRET environment variable not configured');
      return res.status(500).json({ 
        message: 'Server configuration error',
        error: 'API authentication not properly configured' 
      });
    }

    if (providedKey !== expectedKey) {
      return res.status(403).json({ 
        message: 'Invalid API key',
        error: 'The provided API key is not valid' 
      });
    }

    // API key is valid, proceed to next middleware
    next();
  } catch (error) {
    console.error('❌ Authentication error:', error);
    return res.status(500).json({ 
      message: 'Authentication error',
      error: error.message 
    });
  }
}

/**
 * Optional API Key authentication middleware
 * Similar to authenticateApiKey but allows requests without API key
 * Sets req.isAuthenticated = true if valid key is provided
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function optionalApiKey(req, res, next) {
  try {
    const headerKey = req.headers['x-api-key'];
    const queryKey = req.query.key;
    const providedKey = headerKey || queryKey;

    req.isAuthenticated = false;

    if (providedKey) {
      const expectedKey = process.env.API_SECRET;
      if (expectedKey && providedKey === expectedKey) {
        req.isAuthenticated = true;
      }
    }

    next();
  } catch (error) {
    console.error('❌ Optional authentication error:', error);
    next(); // Continue even if there's an error
  }
}

/**
 * Shopify webhook HMAC verification middleware
 * Verifies the authenticity of Shopify webhooks using HMAC-SHA256
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function verifyShopifyWebhook(req, res, next) {
  try {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!secret) {
      console.warn('⚠️ SHOPIFY_WEBHOOK_SECRET not configured - skipping HMAC verification');
      return next(); // Allow webhook but log warning
    }

    if (!hmac) {
      return res.status(401).json({ 
        message: 'Missing webhook signature',
        error: 'X-Shopify-Hmac-Sha256 header required' 
      });
    }

    const crypto = require('crypto');
    const bodyString = typeof body === 'string' ? body : JSON.stringify(body);
    const calculated = crypto
      .createHmac('sha256', secret)
      .update(bodyString, 'utf8')
      .digest('base64');

    if (calculated !== hmac) {
      console.warn('⚠️ Invalid webhook signature from:', req.get('X-Shopify-Shop-Domain'));
      return res.status(403).json({ 
        message: 'Invalid webhook signature',
        error: 'HMAC verification failed' 
      });
    }

    // Webhook is authentic
    next();
  } catch (error) {
    console.error('❌ Webhook verification error:', error);
    return res.status(500).json({ 
      message: 'Webhook verification error',
      error: error.message 
    });
  }
}

/**
 * Rate limit exemption middleware for authenticated requests
 * Skips rate limiting if request is authenticated with valid API key
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function exemptAuthenticatedFromRateLimit(req, res, next) {
  const headerKey = req.headers['x-api-key'];
  const queryKey = req.query.key;
  const providedKey = headerKey || queryKey;
  const expectedKey = process.env.API_SECRET;

  // If authenticated, skip rate limiting
  if (providedKey && expectedKey && providedKey === expectedKey) {
    req.skipRateLimit = true;
  }

  next();
}

module.exports = {
  authenticateApiKey,
  optionalApiKey,
  verifyShopifyWebhook,
  exemptAuthenticatedFromRateLimit
};
