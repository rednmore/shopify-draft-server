/**
 * Register webhook action
 * curl -X POST "https://your-shop.myshopify.com/admin/api/2025-07/webhooks.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "webhook": {
 *       "topic": "customers/create",
 *       "address": "https://your-server.com/webhook-endpoint",
 *       "format": "json",
 *       "api_version": "2025-07"
 *     }
 *   }'
 */

const { shopifyGet, shopifyPost, shopifyPut, shopifyDelete, handleShopifyError } = require('../../config/shopify');
const { ShopifyWebhook } = require('../../models');

/**
 * Get all existing webhooks
 * @returns {Promise<Array>} Array of existing webhooks
 */
async function listWebhooks() {
  try {
    const response = await shopifyGet('/webhooks.json');
    return response.webhooks || [];
  } catch (error) {
    throw handleShopifyError(error, 'List webhooks');
  }
}

/**
 * Find webhook by topic and address
 * @param {string} topic - Webhook topic
 * @param {string} address - Webhook address
 * @returns {Promise<Object|null>} Found webhook or null
 */
async function findWebhookByTopicAndAddress(topic, address) {
  try {
    const webhooks = await listWebhooks();
    return webhooks.find(webhook => 
      webhook.topic === topic && webhook.address === address
    ) || null;
  } catch (error) {
    console.warn('⚠️ Failed to find webhook:', error.message);
    return null;
  }
}

/**
 * Create a new webhook
 * @param {Object} webhookData - Webhook configuration
 * @param {string} webhookData.topic - Webhook topic (e.g., 'customers/create')
 * @param {string} webhookData.address - Webhook endpoint URL
 * @param {string} webhookData.format - Format ('json' or 'xml', default: 'json')
 * @param {Array} webhookData.fields - Specific fields to include
 * @param {Array} webhookData.metafield_namespaces - Metafield namespaces to include
 * @param {string} webhookData.api_version - API version (default: '2025-07')
 * @returns {Promise<Object>} Created webhook
 */
async function createWebhook(webhookData) {
  try {
    const {
      topic,
      address,
      format = 'json',
      fields,
      metafield_namespaces,
      private_metafield_namespaces,
      api_version = '2025-07'
    } = webhookData;

    // Validate required fields
    if (!topic) {
      throw new Error('Webhook topic is required');
    }

    if (!address) {
      throw new Error('Webhook address is required');
    }

    // Prepare webhook payload
    const webhookPayload = {
      webhook: {
        topic,
        address,
        format,
        api_version
      }
    };

    // Add optional fields
    if (fields && Array.isArray(fields) && fields.length > 0) {
      webhookPayload.webhook.fields = fields;
    }

    if (metafield_namespaces && Array.isArray(metafield_namespaces) && metafield_namespaces.length > 0) {
      webhookPayload.webhook.metafield_namespaces = metafield_namespaces;
    }

    if (private_metafield_namespaces && Array.isArray(private_metafield_namespaces) && private_metafield_namespaces.length > 0) {
      webhookPayload.webhook.private_metafield_namespaces = private_metafield_namespaces;
    }

    // Create webhook
    const response = await shopifyPost('/webhooks.json', webhookPayload);

    if (!response?.webhook?.id) {
      throw new Error('Failed to create webhook - no ID returned');
    }

    console.log(`✅ Created webhook: ${topic} -> ${address}`);

    return response.webhook;
  } catch (error) {
    throw handleShopifyError(error, 'Create webhook');
  }
}

/**
 * Update an existing webhook
 * @param {number} webhookId - Webhook ID to update
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Updated webhook
 */
async function updateWebhook(webhookId, updateData) {
  try {
    const response = await shopifyPut(`/webhooks/${webhookId}.json`, {
      webhook: {
        id: webhookId,
        ...updateData
      }
    });

    console.log(`✅ Updated webhook ${webhookId}`);

    return response.webhook;
  } catch (error) {
    throw handleShopifyError(error, 'Update webhook');
  }
}

/**
 * Delete a webhook
 * @param {number} webhookId - Webhook ID to delete
 * @returns {Promise<Object>} Deletion result
 */
async function deleteWebhook(webhookId) {
  try {
    await shopifyDelete(`/webhooks/${webhookId}.json`);

    console.log(`✅ Deleted webhook ${webhookId}`);

    return { success: true, webhook_id: webhookId };
  } catch (error) {
    throw handleShopifyError(error, 'Delete webhook');
  }
}

/**
 * Register webhook with idempotency (create if not exists, update if different)
 * @param {Object} webhookData - Webhook configuration
 * @returns {Promise<Object>} Registration result
 */
async function registerWebhookIdempotent(webhookData) {
  try {
    const { topic, address } = webhookData;

    // Check if webhook already exists
    const existingWebhook = await findWebhookByTopicAndAddress(topic, address);

    if (existingWebhook) {
      // Webhook exists, check if update is needed
      const needsUpdate = 
        (webhookData.format && existingWebhook.format !== webhookData.format) ||
        (webhookData.api_version && existingWebhook.api_version !== webhookData.api_version) ||
        (webhookData.fields && JSON.stringify(existingWebhook.fields) !== JSON.stringify(webhookData.fields)) ||
        (webhookData.metafield_namespaces && JSON.stringify(existingWebhook.metafield_namespaces) !== JSON.stringify(webhookData.metafield_namespaces));

      if (needsUpdate) {
        const updatedWebhook = await updateWebhook(existingWebhook.id, {
          format: webhookData.format,
          api_version: webhookData.api_version,
          fields: webhookData.fields,
          metafield_namespaces: webhookData.metafield_namespaces,
          private_metafield_namespaces: webhookData.private_metafield_namespaces
        });

        return {
          action: 'updated',
          webhook: updatedWebhook,
          message: `Updated existing webhook for ${topic}`
        };
      }

      return {
        action: 'exists',
        webhook: existingWebhook,
        message: `Webhook already exists for ${topic}`
      };
    }

    // Create new webhook
    const newWebhook = await createWebhook(webhookData);

    return {
      action: 'created',
      webhook: newWebhook,
      message: `Created new webhook for ${topic}`
    };
  } catch (error) {
    throw handleShopifyError(error, 'Register webhook');
  }
}

/**
 * Register multiple webhooks
 * @param {Array} webhooksData - Array of webhook configurations
 * @returns {Promise<Array>} Array of registration results
 */
async function registerMultipleWebhooks(webhooksData) {
  const results = [];

  for (const webhookData of webhooksData) {
    try {
      const result = await registerWebhookIdempotent(webhookData);
      results.push({
        ...result,
        success: true
      });
    } catch (error) {
      console.error(`❌ Failed to register webhook ${webhookData.topic}:`, error.message);
      results.push({
        action: 'failed',
        topic: webhookData.topic,
        address: webhookData.address,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Register default webhooks for the application
 * @param {string} baseUrl - Base URL for webhook endpoints
 * @returns {Promise<Array>} Registration results
 */
async function registerDefaultWebhooks(baseUrl) {
  if (!baseUrl) {
    baseUrl = process.env.PUBLIC_WEBHOOK_URL || 
              'https://shopify-draft-server.onrender.com';
  }

  // Ensure base URL doesn't end with slash
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');

  const defaultWebhooks = [
    {
      topic: 'customers/create',
      address: `${cleanBaseUrl}/sync-customer-data`,
      format: 'json',
      api_version: '2025-07',
      metafield_namespaces: ['custom']
    },
    {
      topic: 'customers/update',
      address: `${cleanBaseUrl}/sync-customer-data`,
      format: 'json',
      api_version: '2025-07',
      metafield_namespaces: ['custom']
    }
  ];

  console.log(`🔄 Registering default webhooks with base URL: ${cleanBaseUrl}`);

  return await registerMultipleWebhooks(defaultWebhooks);
}

/**
 * Verify webhook endpoint is accessible
 * @param {string} webhookUrl - Webhook URL to verify
 * @returns {Promise<Object>} Verification result
 */
async function verifyWebhookEndpoint(webhookUrl) {
  try {
    // Try to make a test request to the webhook endpoint
    const response = await fetch(webhookUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Shopify-Webhook-Verifier/1.0'
      },
      timeout: 10000
    });

    return {
      accessible: true,
      status: response.status,
      url: webhookUrl,
      message: `Endpoint is accessible (HTTP ${response.status})`
    };
  } catch (error) {
    return {
      accessible: false,
      url: webhookUrl,
      error: error.message,
      message: `Endpoint is not accessible: ${error.message}`
    };
  }
}

/**
 * Get webhook statistics and health
 * @returns {Promise<Object>} Webhook statistics
 */
async function getWebhookStats() {
  try {
    const webhooks = await listWebhooks();
    
    const stats = {
      total_webhooks: webhooks.length,
      by_topic: {},
      by_api_version: {},
      active_endpoints: new Set()
    };

    webhooks.forEach(webhook => {
      // Count by topic
      stats.by_topic[webhook.topic] = (stats.by_topic[webhook.topic] || 0) + 1;
      
      // Count by API version
      stats.by_api_version[webhook.api_version] = (stats.by_api_version[webhook.api_version] || 0) + 1;
      
      // Track unique endpoints
      stats.active_endpoints.add(webhook.address);
    });

    stats.unique_endpoints = stats.active_endpoints.size;
    delete stats.active_endpoints;

    return stats;
  } catch (error) {
    throw handleShopifyError(error, 'Get webhook stats');
  }
}

module.exports = {
  listWebhooks,
  findWebhookByTopicAndAddress,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  registerWebhookIdempotent,
  registerMultipleWebhooks,
  registerDefaultWebhooks,
  verifyWebhookEndpoint,
  getWebhookStats
};
