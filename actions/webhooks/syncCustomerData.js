/**
 * Sync customer data webhook action
 * Handles customers/create and customers/update webhooks
 * curl -X POST "https://your-shop.myshopify.com/admin/api/2025-07/webhooks.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "webhook": {
 *       "topic": "customers/create",
 *       "address": "https://your-server.com/sync-customer-data",
 *       "format": "json"
 *     }
 *   }'
 */

const { shopifyGet, shopifyPost, shopifyPut, handleShopifyError } = require('../../config/shopify');
const { Customer, CustomerMetafield } = require('../../models');

// In-memory cache for recent webhook hits (for debugging)
const recentWebhookHits = [];
const MAX_RECENT_HITS = 20;

/**
 * Log webhook hit for debugging
 * @param {Object} webhookData - Webhook data to log
 */
function logWebhookHit(webhookData) {
  try {
    recentWebhookHits.unshift({
      timestamp: new Date().toISOString(),
      topic: webhookData.topic || '(none)',
      shop: webhookData.shop || '(none)',
      hmac: webhookData.hmac ? 'present' : 'missing',
      customerId: webhookData.payload?.id || null,
      processed: false
    });

    // Keep only recent hits
    if (recentWebhookHits.length > MAX_RECENT_HITS) {
      recentWebhookHits.pop();
    }
  } catch (error) {
    console.warn('⚠️ Failed to log webhook hit:', error.message);
  }
}

/**
 * Get recent webhook hits for debugging
 * @returns {Array} Recent webhook hits
 */
function getRecentWebhookHits() {
  return recentWebhookHits;
}

/**
 * Clean and normalize string values
 * @param {any} value - Value to clean
 * @returns {string|undefined} Cleaned string or undefined
 */
function cleanString(value) {
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * Get first non-empty value from multiple sources
 * @param {...any} values - Values to check
 * @returns {string} First non-empty value
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }
  return '';
}

/**
 * Parse customer note as JSON
 * @param {string} note - Customer note to parse
 * @returns {Object} Parsed note data or empty object
 */
function parseCustomerNote(note) {
  try {
    return note ? JSON.parse(note) : {};
  } catch (error) {
    console.warn('⚠️ Note not parseable as JSON:', note);
    return {};
  }
}

/**
 * Get customer metafields from namespace
 * @param {number} customerId - Customer ID
 * @param {string} namespace - Metafield namespace (default: 'custom')
 * @returns {Promise<Array>} Array of metafields
 */
async function getCustomerMetafields(customerId, namespace = 'custom') {
  try {
    const response = await shopifyGet(`/customers/${customerId}/metafields.json?namespace=${namespace}`);
    return response.metafields || [];
  } catch (error) {
    console.warn(`⚠️ Failed to fetch metafields for customer ${customerId}:`, error.message);
    return [];
  }
}

/**
 * Create or update customer metafield
 * @param {number} customerId - Customer ID
 * @param {Object} metafieldData - Metafield data
 * @returns {Promise<Object>} Created/updated metafield
 */
async function upsertCustomerMetafield(customerId, metafieldData) {
  try {
    const { namespace = 'custom', key, value, type = 'single_line_text_field' } = metafieldData;

    // Check if metafield already exists
    const existingMetafields = await getCustomerMetafields(customerId, namespace);
    const existingMetafield = existingMetafields.find(mf => mf.key === key);

    if (existingMetafield) {
      // Update existing metafield if value is different
      if (cleanString(existingMetafield.value) !== cleanString(value)) {
        const response = await shopifyPut(`/metafields/${existingMetafield.id}.json`, {
          metafield: {
            id: existingMetafield.id,
            type,
            value
          }
        });
        return response.metafield;
      }
      return existingMetafield;
    } else {
      // Create new metafield
      const response = await shopifyPost(`/customers/${customerId}/metafields.json`, {
        metafield: {
          namespace,
          key,
          type,
          value
        }
      });
      return response.metafield;
    }
  } catch (error) {
    console.warn(`⚠️ Failed to upsert metafield ${metafieldData.key}:`, error.message);
    return null;
  }
}

/**
 * Update customer's default address company field
 * @param {Object} customer - Customer object
 * @param {string} companyName - Company name to set
 * @returns {Promise<boolean>} Success status
 */
async function updateCustomerAddressCompany(customer, companyName) {
  try {
    if (!customer || !companyName) {
      return false;
    }

    // Try to update default address first
    if (customer.default_address?.id) {
      await shopifyPut(`/customers/${customer.id}/addresses/${customer.default_address.id}.json`, {
        address: {
          ...customer.default_address,
          company: companyName
        }
      });
      return true;
    }

    // Try to update first address if no default
    if (customer.addresses && customer.addresses.length > 0) {
      const firstAddress = customer.addresses[0];
      await shopifyPut(`/customers/${customer.id}/addresses/${firstAddress.id}.json`, {
        address: {
          ...firstAddress,
          company: companyName
        }
      });
      return true;
    }

    // Create a minimal address with company if no addresses exist
    await shopifyPost(`/customers/${customer.id}/addresses.json`, {
      address: {
        company: companyName,
        first_name: customer.first_name || '',
        last_name: customer.last_name || '',
        address1: 'To complete',
        city: 'To complete',
        zip: '0000',
        country: 'Switzerland',
        default: true
      }
    });
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to update address company for customer ${customer.id}:`, error.message);
    return false;
  }
}

/**
 * Add VAT tag to customer
 * @param {Object} customer - Customer object
 * @param {string} vatNumber - VAT number
 * @returns {Promise<boolean>} Success status
 */
async function addCustomerVatTag(customer, vatNumber) {
  try {
    const existingTags = customer.tags ? customer.tags.split(',').map(tag => tag.trim()) : [];
    const vatTag = `TVA:${vatNumber}`;
    
    // Check if VAT tag already exists
    const hasVatTag = existingTags.some(tag => tag.startsWith('TVA:'));
    if (hasVatTag) {
      return true; // Already has VAT tag
    }

    const newTags = [...existingTags, vatTag];
    
    await shopifyPut(`/customers/${customer.id}.json`, {
      customer: {
        id: customer.id,
        tags: newTags.join(', ')
      }
    });
    
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to add VAT tag to customer ${customer.id}:`, error.message);
    return false;
  }
}

/**
 * Sync customer company information across address and metafields
 * @param {Object} customer - Customer object
 * @param {Object} noteData - Parsed note data
 * @returns {Promise<Object>} Sync result
 */
async function syncCustomerCompany(customer, noteData) {
  try {
    // Extract company information from various sources
    const companyFromNote = cleanString(noteData.company) || cleanString(noteData.company_name);
    const companyFromAddress = customer.default_address?.company || 
                              customer.addresses?.find(addr => addr.company)?.company;

    // Get existing metafields
    const metafields = await getCustomerMetafields(customer.id, 'custom');
    const companyMetafield = metafields.find(mf => mf.key === 'company_name');
    const customerNameMetafield = metafields.find(mf => mf.key === 'customer_name');
    const customeNameMetafield = metafields.find(mf => mf.key === 'custome_name'); // Legacy typo

    const companyFromMetafield = cleanString(companyMetafield?.value) ||
                               cleanString(customerNameMetafield?.value) ||
                               cleanString(customeNameMetafield?.value);

    // Determine canonical company name (priority: note > address > metafield)
    const canonicalCompany = firstNonEmpty(
      companyFromNote,
      companyFromAddress,
      companyFromMetafield
    );

    if (!canonicalCompany) {
      return { updated: false, reason: 'no-company-data' };
    }

    console.log(`ℹ️ Syncing company "${canonicalCompany}" for customer ${customer.id}`);

    // Update address company if different
    const currentAddressCompany = cleanString(companyFromAddress);
    if (currentAddressCompany !== canonicalCompany) {
      await updateCustomerAddressCompany(customer, canonicalCompany);
    }

    // Update/create metafields
    await Promise.all([
      upsertCustomerMetafield(customer.id, {
        namespace: 'custom',
        key: 'company_name',
        value: canonicalCompany,
        type: 'single_line_text_field'
      }),
      upsertCustomerMetafield(customer.id, {
        namespace: 'custom',
        key: 'customer_name',
        value: canonicalCompany,
        type: 'single_line_text_field'
      })
    ]);

    return { 
      updated: true, 
      company: canonicalCompany,
      sources: {
        note: !!companyFromNote,
        address: !!companyFromAddress,
        metafield: !!companyFromMetafield
      }
    };
  } catch (error) {
    console.error(`❌ Failed to sync company for customer ${customer.id}:`, error.message);
    return { updated: false, reason: 'sync-error', error: error.message };
  }
}

/**
 * Process VAT number from customer data
 * @param {Object} customer - Customer object
 * @param {Object} noteData - Parsed note data
 * @returns {Promise<Object>} Processing result
 */
async function processCustomerVat(customer, noteData) {
  try {
    const vatNumber = cleanString(noteData.vat_number);
    
    if (!vatNumber) {
      return { processed: false, reason: 'no-vat-number' };
    }

    console.log(`ℹ️ Processing VAT number "${vatNumber}" for customer ${customer.id}`);

    // Create VAT metafield
    await upsertCustomerMetafield(customer.id, {
      namespace: 'custom',
      key: 'vat_number',
      value: vatNumber,
      type: 'single_line_text_field'
    });

    // Add VAT tag
    await addCustomerVatTag(customer, vatNumber);

    return { 
      processed: true, 
      vat_number: vatNumber 
    };
  } catch (error) {
    console.error(`❌ Failed to process VAT for customer ${customer.id}:`, error.message);
    return { processed: false, reason: 'processing-error', error: error.message };
  }
}

/**
 * Main webhook handler for customer data synchronization
 * @param {Object} webhookPayload - Webhook payload from Shopify
 * @param {Object} headers - Webhook headers
 * @returns {Promise<Object>} Processing result
 */
async function syncCustomerDataWebhook(webhookPayload, headers = {}) {
  const startTime = Date.now();
  
  try {
    // Log webhook hit
    logWebhookHit({
      topic: headers['x-shopify-topic'],
      shop: headers['x-shopify-shop-domain'],
      hmac: headers['x-shopify-hmac-sha256'],
      payload: webhookPayload
    });

    // Handle ping/empty payload
    if (!webhookPayload || Object.keys(webhookPayload).length === 0) {
      return { 
        success: true, 
        message: 'Webhook ping received',
        processing_time_ms: Date.now() - startTime
      };
    }

    // Extract customer ID
    const customerId = webhookPayload.id;
    if (!customerId) {
      throw new Error('Missing customer ID in webhook payload');
    }

    console.log(`🔄 Processing customer data sync for customer ${customerId}`);

    // Fetch complete customer data
    const customerResponse = await shopifyGet(`/customers/${customerId}.json`);
    const customer = customerResponse.customer;

    if (!customer) {
      throw new Error(`Customer ${customerId} not found`);
    }

    // Parse customer note
    const noteData = parseCustomerNote(customer.note);

    // Check if there's any relevant data to process
    const hasCompanyData = noteData.company || noteData.company_name;
    const hasAddressData = noteData.address1;
    const hasVatData = noteData.vat_number;

    if (!hasCompanyData && !hasAddressData && !hasVatData) {
      console.log(`ℹ️ No relevant data found in customer ${customerId} note`);
      return { 
        success: true, 
        message: 'No relevant data to process',
        processing_time_ms: Date.now() - startTime
      };
    }

    const results = {
      customer_id: customerId,
      company_sync: null,
      vat_processing: null,
      processing_time_ms: 0
    };

    // Sync company information
    if (hasCompanyData) {
      results.company_sync = await syncCustomerCompany(customer, noteData);
    }

    // Process VAT information
    if (hasVatData) {
      results.vat_processing = await processCustomerVat(customer, noteData);
    }

    results.processing_time_ms = Date.now() - startTime;

    console.log(`✅ Customer data sync completed for customer ${customerId} in ${results.processing_time_ms}ms`);

    return {
      success: true,
      message: 'Customer data synchronized',
      results: results
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Customer data sync failed after ${processingTime}ms:`, error.message);
    
    return {
      success: false,
      message: 'Customer data sync failed',
      error: error.message,
      processing_time_ms: processingTime
    };
  }
}

/**
 * Health check for webhook processing
 * @returns {Object} Health status
 */
function getWebhookHealth() {
  return {
    status: 'healthy',
    recent_hits: recentWebhookHits.length,
    last_hit: recentWebhookHits[0]?.timestamp || null,
    processing_enabled: true
  };
}

module.exports = {
  syncCustomerDataWebhook,
  getRecentWebhookHits,
  getWebhookHealth,
  syncCustomerCompany,
  processCustomerVat,
  parseCustomerNote,
  cleanString,
  firstNonEmpty
};
