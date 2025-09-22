/**
 * Validation middleware for request data
 * Following ExpressJS best practices as defined in the rules
 */

const { z } = require('zod');

/**
 * Generic validation middleware factory
 * Creates a middleware function that validates request data against a Zod schema
 * 
 * @param {Object} schema - Zod schema to validate against
 * @param {string} source - Where to get data from: 'body', 'query', 'params', 'headers'
 * @returns {Function} Express middleware function
 */
function validateSchema(schema, source = 'body') {
  return (req, res, next) => {
    try {
      let dataToValidate;
      
      switch (source) {
        case 'body':
          dataToValidate = req.body;
          break;
        case 'query':
          dataToValidate = req.query;
          break;
        case 'params':
          dataToValidate = req.params;
          break;
        case 'headers':
          dataToValidate = req.headers;
          break;
        default:
          throw new Error(`Invalid validation source: ${source}`);
      }

      const result = schema.safeParse(dataToValidate);
      
      if (!result.success) {
        const errors = result.error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          received: err.received
        }));

        return res.status(400).json({
          message: 'Validation failed',
          errors: errors,
          details: `Invalid ${source} data`
        });
      }

      // Replace the original data with the validated (and potentially transformed) data
      switch (source) {
        case 'body':
          req.body = result.data;
          break;
        case 'query':
          req.query = result.data;
          break;
        case 'params':
          req.params = result.data;
          break;
        case 'headers':
          req.headers = { ...req.headers, ...result.data };
          break;
      }

      next();
    } catch (error) {
      console.error('❌ Validation middleware error:', error);
      return res.status(500).json({
        message: 'Validation error',
        error: error.message
      });
    }
  };
}

/**
 * Validate request body
 * @param {Object} schema - Zod schema
 * @returns {Function} Express middleware
 */
function validateBody(schema) {
  return validateSchema(schema, 'body');
}

/**
 * Validate query parameters
 * @param {Object} schema - Zod schema
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return validateSchema(schema, 'query');
}

/**
 * Validate URL parameters
 * @param {Object} schema - Zod schema
 * @returns {Function} Express middleware
 */
function validateParams(schema) {
  return validateSchema(schema, 'params');
}

/**
 * Validate request headers
 * @param {Object} schema - Zod schema
 * @returns {Function} Express middleware
 */
function validateHeaders(schema) {
  return validateSchema(schema, 'headers');
}

/**
 * Sanitize input middleware
 * Removes potentially dangerous characters and normalizes data
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function sanitizeInput(req, res, next) {
  try {
    // Recursive function to sanitize all string values in an object
    function sanitizeObject(obj) {
      if (typeof obj === 'string') {
        return obj
          .trim()
          .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control characters
          .replace(/javascript:/gi, '') // Remove javascript: protocol
          .replace(/data:/gi, '') // Remove data: protocol
          .replace(/vbscript:/gi, ''); // Remove vbscript: protocol
      }
      
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }
      
      if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      
      return obj;
    }

    // Sanitize body, query, and params
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    console.error('❌ Input sanitization error:', error);
    next(); // Continue even if sanitization fails
  }
}

/**
 * Content-Type validation middleware
 * Ensures request has the correct Content-Type header
 * 
 * @param {string|Array} expectedTypes - Expected content type(s)
 * @returns {Function} Express middleware
 */
function validateContentType(expectedTypes) {
  const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
  
  return (req, res, next) => {
    const contentType = req.get('Content-Type');
    
    if (!contentType) {
      return res.status(400).json({
        message: 'Content-Type header required',
        expected: types
      });
    }

    const isValidType = types.some(type => contentType.includes(type));
    
    if (!isValidType) {
      return res.status(415).json({
        message: 'Unsupported Media Type',
        received: contentType,
        expected: types
      });
    }

    next();
  };
}

/**
 * Request size validation middleware
 * Validates that request payload is not too large
 * 
 * @param {number} maxSizeBytes - Maximum allowed size in bytes
 * @returns {Function} Express middleware
 */
function validateRequestSize(maxSizeBytes = 1024 * 1024) { // Default 1MB
  return (req, res, next) => {
    const contentLength = req.get('Content-Length');
    
    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      return res.status(413).json({
        message: 'Request too large',
        maxSize: `${maxSizeBytes} bytes`,
        received: `${contentLength} bytes`
      });
    }

    next();
  };
}

/**
 * Idempotency key validation middleware
 * Validates and processes idempotency keys for safe request retries
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function validateIdempotencyKey(req, res, next) {
  const idempotencyKey = req.get('Idempotency-Key');
  
  if (idempotencyKey) {
    // Validate format (should be a UUID or similar unique string)
    const keyPattern = /^[a-zA-Z0-9_-]{8,64}$/;
    
    if (!keyPattern.test(idempotencyKey)) {
      return res.status(400).json({
        message: 'Invalid Idempotency-Key format',
        error: 'Key must be 8-64 characters, alphanumeric with hyphens and underscores only'
      });
    }
    
    // Store the validated key for use in handlers
    req.idempotencyKey = idempotencyKey;
  }
  
  next();
}

/**
 * Origin validation middleware
 * Validates that requests come from allowed origins
 * 
 * @param {Array} allowedOrigins - Array of allowed origins
 * @returns {Function} Express middleware
 */
function validateOrigin(allowedOrigins = []) {
  return (req, res, next) => {
    const origin = req.get('Origin');
    
    // If no origin header, allow (might be same-origin or server-to-server)
    if (!origin) {
      return next();
    }

    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return allowed === origin;
      }
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });

    if (!isAllowed) {
      console.warn('⛔ Request from disallowed origin:', origin);
      return res.status(403).json({
        message: 'Origin not allowed',
        origin: origin
      });
    }

    next();
  };
}

module.exports = {
  validateSchema,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  sanitizeInput,
  validateContentType,
  validateRequestSize,
  validateIdempotencyKey,
  validateOrigin
};
