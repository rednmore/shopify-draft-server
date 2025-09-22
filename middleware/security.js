/**
 * Security middleware for the application
 * Following ExpressJS best practices as defined in the rules
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Configure Helmet security middleware
 * Sets secure HTTP headers and security policies
 * 
 * @returns {Function} Configured Helmet middleware
 */
function configureHelmet() {
  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.shopify.com", "https://*.myshopify.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    
    // Cross-Origin Embedder Policy
    crossOriginEmbedderPolicy: false, // Disable for Shopify compatibility
    
    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: { policy: "same-origin" },
    
    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { policy: "cross-origin" },
    
    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },
    
    // Frameguard (X-Frame-Options)
    frameguard: { action: 'deny' },
    
    // Hide Powered-By header
    hidePoweredBy: true,
    
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    
    // IE No Open
    ieNoOpen: true,
    
    // No Sniff (X-Content-Type-Options)
    noSniff: true,
    
    // Origin Agent Cluster
    originAgentCluster: true,
    
    // Permitted Cross-Domain Policies
    permittedCrossDomainPolicies: false,
    
    // Referrer Policy
    referrerPolicy: { policy: "no-referrer" },
    
    // X-XSS-Protection
    xssFilter: true
  });
}

/**
 * Global rate limiter configuration
 * Applies to all requests unless overridden
 * 
 * @returns {Function} Configured rate limiter middleware
 */
function createGlobalRateLimit() {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes per IP
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    skip: (req) => {
      // Skip rate limiting for authenticated requests if they have skipRateLimit flag
      return req.skipRateLimit === true;
    }
  });
}

/**
 * API rate limiter for general API endpoints
 * More restrictive than global rate limiter
 * 
 * @returns {Function} Configured API rate limiter middleware
 */
function createApiRateLimit() {
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 50, // 50 requests per 10 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many API requests, please try again later.',
      retryAfter: '10 minutes'
    },
    skip: (req) => req.skipRateLimit === true
  });
}

/**
 * Order-specific rate limiter
 * Very restrictive for order creation/completion endpoints
 * 
 * @returns {Function} Configured order rate limiter middleware
 */
function createOrderRateLimit() {
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 10, // 10 order operations per 10 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many order operations, please wait before trying again.',
      retryAfter: '10 minutes'
    },
    skip: (req) => req.skipRateLimit === true
  });
}

/**
 * Customer creation rate limiter
 * Moderate restriction for customer creation
 * 
 * @returns {Function} Configured customer creation rate limiter middleware
 */
function createCustomerRateLimit() {
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 20, // 20 customer creations per 10 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many customer creation requests, please try again later.',
      retryAfter: '10 minutes'
    },
    skip: (req) => req.skipRateLimit === true
  });
}

/**
 * Form submission rate limiter
 * For public form submissions like registration
 * 
 * @returns {Function} Configured form rate limiter middleware
 */
function createFormRateLimit() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 form submissions per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: 'Too many form submissions, please try again later.',
      retryAfter: '1 minute'
    }
  });
}

/**
 * Security headers middleware
 * Adds additional security headers not covered by Helmet
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function addSecurityHeaders(req, res, next) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy (experimental)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
}

/**
 * Request logging middleware for security monitoring
 * Logs suspicious requests for security analysis
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function securityLogger(req, res, next) {
  const suspicious = [
    // Common attack patterns
    /\.\.\//, // Path traversal
    /<script/i, // XSS attempts
    /union.*select/i, // SQL injection
    /javascript:/i, // JS injection
    /vbscript:/i, // VBScript injection
    /onload=/i, // Event handler injection
    /onerror=/i, // Error handler injection
  ];

  const userAgent = req.get('User-Agent') || '';
  const referer = req.get('Referer') || '';
  const requestUrl = req.originalUrl || req.url;
  const requestBody = JSON.stringify(req.body || {});

  // Check for suspicious patterns
  const isSuspicious = suspicious.some(pattern => 
    pattern.test(requestUrl) || 
    pattern.test(requestBody) || 
    pattern.test(userAgent) || 
    pattern.test(referer)
  );

  if (isSuspicious) {
    console.warn('⚠️ Suspicious request detected:', {
      ip: req.ip,
      method: req.method,
      url: requestUrl,
      userAgent: userAgent,
      referer: referer,
      timestamp: new Date().toISOString()
    });
  }

  next();
}

/**
 * Honeypot field validator
 * Validates honeypot fields to catch bots
 * 
 * @param {string} fieldName - Name of the honeypot field (default: 'hp')
 * @returns {Function} Express middleware
 */
function validateHoneypot(fieldName = 'hp') {
  return (req, res, next) => {
    const honeypotValue = req.body?.[fieldName];
    
    // If honeypot field has any value, it's likely a bot
    if (honeypotValue && String(honeypotValue).trim() !== '') {
      console.warn('🍯 Honeypot triggered:', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        honeypotValue: honeypotValue,
        timestamp: new Date().toISOString()
      });
      
      // Return success response to not reveal the honeypot
      return res.json({ 
        ok: true, 
        skipped: 'honeypot'
      });
    }
    
    next();
  };
}

module.exports = {
  configureHelmet,
  createGlobalRateLimit,
  createApiRateLimit,
  createOrderRateLimit,
  createCustomerRateLimit,
  createFormRateLimit,
  addSecurityHeaders,
  securityLogger,
  validateHoneypot
};
