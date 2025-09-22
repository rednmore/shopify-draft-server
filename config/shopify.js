/**
 * Shopify API configuration and utilities
 * Following ExpressJS best practices as defined in the rules
 * Updated to use Shopify Admin API version 2025-07
 */

require('dotenv').config();

// =========================================
/* SHOPIFY API CONFIGURATION */
// =========================================

const SHOPIFY_API_VERSION = '2025-07'; // Updated to latest version as per rules
const SHOPIFY_API_URL = process.env.SHOPIFY_API_URL;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;

if (!SHOPIFY_API_URL) {
  throw new Error('SHOPIFY_API_URL environment variable is required');
}

if (!SHOPIFY_API_KEY) {
  throw new Error('SHOPIFY_API_KEY environment variable is required');
}

// Construct base URL for Shopify Admin API
const SHOPIFY_BASE_URL = `https://${SHOPIFY_API_URL}/admin/api/${SHOPIFY_API_VERSION}`;

/**
 * Get standard Shopify API headers
 * @returns {Object} Headers object for Shopify API requests
 */
function getShopifyHeaders() {
  return {
    'X-Shopify-Access-Token': SHOPIFY_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Shopify-Draft-Server/1.0.0'
  };
}

/**
 * Get Shopify API URL for a specific endpoint
 * @param {string} endpoint - API endpoint (e.g., '/customers.json')
 * @returns {string} Full URL for the API call
 */
function getShopifyUrl(endpoint) {
  // Ensure endpoint starts with /
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${SHOPIFY_BASE_URL}${cleanEndpoint}`;
}

/**
 * Make a GET request to Shopify API
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Additional fetch options
 * @returns {Promise<Object>} API response data
 */
async function shopifyGet(endpoint, options = {}) {
  const url = getShopifyUrl(endpoint);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...getShopifyHeaders(),
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Make a POST request to Shopify API
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body data
 * @param {Object} options - Additional fetch options
 * @returns {Promise<Object>} API response data
 */
async function shopifyPost(endpoint, data, options = {}) {
  const url = getShopifyUrl(endpoint);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...getShopifyHeaders(),
      ...options.headers
    },
    body: JSON.stringify(data),
    ...options
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Make a PUT request to Shopify API
 * @param {string} endpoint - API endpoint
 * @param {Object} data - Request body data
 * @param {Object} options - Additional fetch options
 * @returns {Promise<Object>} API response data
 */
async function shopifyPut(endpoint, data, options = {}) {
  const url = getShopifyUrl(endpoint);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...getShopifyHeaders(),
      ...options.headers
    },
    body: JSON.stringify(data),
    ...options
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Make a DELETE request to Shopify API
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Additional fetch options
 * @returns {Promise<Object>} API response data
 */
async function shopifyDelete(endpoint, options = {}) {
  const url = getShopifyUrl(endpoint);
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...getShopifyHeaders(),
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  // DELETE requests might return empty body
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  
  return { success: true };
}

/**
 * Shopify-specific error handler
 * @param {Error} error - Error object
 * @param {string} context - Context where error occurred
 * @returns {Object} Formatted error response
 */
function handleShopifyError(error, context = 'Shopify API') {
  console.error(`❌ ${context} error:`, error.message);
  
  // Check if it's a Shopify API error with specific format
  if (error.message.includes('Shopify API error')) {
    const statusMatch = error.message.match(/\((\d+)\)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 500;
    
    return {
      status,
      message: `${context} failed`,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
  
  return {
    status: 500,
    message: `${context} error`,
    error: error.message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Validate Shopify shop domain format
 * @param {string} shopDomain - Shop domain to validate
 * @returns {boolean} True if valid
 */
function isValidShopDomain(shopDomain) {
  const shopPattern = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  return shopPattern.test(shopDomain);
}

/**
 * Get shop information
 * @returns {Promise<Object>} Shop information
 */
async function getShopInfo() {
  return shopifyGet('/shop.json');
}

module.exports = {
  // Constants
  SHOPIFY_API_VERSION,
  SHOPIFY_API_URL,
  SHOPIFY_API_KEY,
  SHOPIFY_BASE_URL,
  
  // Helper functions
  getShopifyHeaders,
  getShopifyUrl,
  
  // HTTP methods
  shopifyGet,
  shopifyPost,
  shopifyPut,
  shopifyDelete,
  
  // Utilities
  handleShopifyError,
  isValidShopDomain,
  getShopInfo
};
