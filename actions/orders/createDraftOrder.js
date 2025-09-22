/**
 * Create draft order action
 * curl -X POST "https://your-shop.myshopify.com/admin/api/2025-07/draft_orders.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "draft_order": {
 *       "line_items": [
 *         {
 *           "title": "Product Title",
 *           "price": "19.99",
 *           "quantity": 2
 *         }
 *       ],
 *       "customer": {
 *         "id": 123456789
 *       },
 *       "use_customer_default_address": true
 *     }
 *   }'
 */

const { shopifyPost, handleShopifyError } = require('../../config/shopify');
const { DraftOrder } = require('../../models');

/**
 * Create a new draft order
 * @param {Object} orderData - Draft order data
 * @param {number} orderData.customer_id - Customer ID
 * @param {Array} orderData.items - Array of line items
 * @param {string} orderData.note - Optional order note
 * @param {string} orderData.email - Optional email (overrides customer email)
 * @param {string} orderData.currency - Currency code (default: USD)
 * @param {boolean} orderData.taxes_included - Whether taxes are included in prices
 * @param {boolean} orderData.use_customer_default_address - Use customer's default address
 * @param {Object} orderData.shipping_address - Custom shipping address
 * @param {Object} orderData.billing_address - Custom billing address
 * @param {string} orderData.tags - Order tags
 * @param {Object} orderData.applied_discount - Discount to apply
 * @returns {Promise<Object>} Created draft order data
 */
async function createDraftOrder(orderData) {
  try {
    const {
      customer_id,
      items,
      note,
      email,
      currency = 'USD',
      taxes_included = false,
      use_customer_default_address = true,
      shipping_address,
      billing_address,
      tags,
      applied_discount
    } = orderData;

    // Validate required fields
    if (!customer_id) {
      throw new Error('Customer ID is required');
    }

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('At least one line item is required');
    }

    // Prepare line items
    const lineItems = items.map(item => {
      const lineItem = {
        title: item.title,
        quantity: item.quantity,
        price: item.price
      };

      // Add optional fields if provided
      if (item.variant_id) lineItem.variant_id = item.variant_id;
      if (item.product_id) lineItem.product_id = item.product_id;
      if (item.sku) lineItem.sku = item.sku;
      if (item.variant_title) lineItem.variant_title = item.variant_title;
      if (item.vendor) lineItem.vendor = item.vendor;
      if (item.requires_shipping !== undefined) lineItem.requires_shipping = item.requires_shipping;
      if (item.taxable !== undefined) lineItem.taxable = item.taxable;
      if (item.gift_card !== undefined) lineItem.gift_card = item.gift_card;
      if (item.fulfillment_service) lineItem.fulfillment_service = item.fulfillment_service;
      if (item.grams !== undefined) lineItem.grams = item.grams;
      if (item.properties) lineItem.properties = item.properties;

      return lineItem;
    });

    // Prepare draft order payload
    const draftOrderPayload = {
      draft_order: {
        line_items: lineItems,
        customer: { id: customer_id },
        use_customer_default_address,
        currency,
        taxes_included
      }
    };

    // Add optional fields
    if (note) draftOrderPayload.draft_order.note = note;
    if (email) draftOrderPayload.draft_order.email = email;
    if (shipping_address) draftOrderPayload.draft_order.shipping_address = shipping_address;
    if (billing_address) draftOrderPayload.draft_order.billing_address = billing_address;
    if (tags) draftOrderPayload.draft_order.tags = tags;
    if (applied_discount) draftOrderPayload.draft_order.applied_discount = applied_discount;

    // Create draft order
    const response = await shopifyPost('/draft_orders.json', draftOrderPayload);

    if (!response?.draft_order?.id) {
      throw new Error('Failed to create draft order - no ID returned');
    }

    const draftOrder = response.draft_order;

    return {
      draft_id: draftOrder.id,
      invoice_url: draftOrder.invoice_url,
      name: draftOrder.name,
      status: draftOrder.status,
      total_price: draftOrder.total_price,
      subtotal_price: draftOrder.subtotal_price,
      total_tax: draftOrder.total_tax,
      currency: draftOrder.currency,
      created_at: draftOrder.created_at,
      updated_at: draftOrder.updated_at,
      line_items_count: draftOrder.line_items?.length || 0,
      draft_order: draftOrder
    };
  } catch (error) {
    throw handleShopifyError(error, 'Create draft order');
  }
}

/**
 * Get draft order by ID
 * @param {number} draftId - Draft order ID
 * @returns {Promise<Object>} Draft order details
 */
async function getDraftOrder(draftId) {
  try {
    const { shopifyGet } = require('../../config/shopify');
    const response = await shopifyGet(`/draft_orders/${draftId}.json`);
    return response.draft_order;
  } catch (error) {
    throw handleShopifyError(error, 'Get draft order');
  }
}

/**
 * Update draft order
 * @param {number} draftId - Draft order ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Updated draft order
 */
async function updateDraftOrder(draftId, updateData) {
  try {
    const { shopifyPut } = require('../../config/shopify');
    const response = await shopifyPut(`/draft_orders/${draftId}.json`, {
      draft_order: updateData
    });
    return response.draft_order;
  } catch (error) {
    throw handleShopifyError(error, 'Update draft order');
  }
}

/**
 * Delete draft order
 * @param {number} draftId - Draft order ID
 * @returns {Promise<Object>} Deletion result
 */
async function deleteDraftOrder(draftId) {
  try {
    const { shopifyDelete } = require('../../config/shopify');
    await shopifyDelete(`/draft_orders/${draftId}.json`);
    return { success: true, draft_id: draftId };
  } catch (error) {
    throw handleShopifyError(error, 'Delete draft order');
  }
}

/**
 * List draft orders
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of draft orders to return
 * @param {number} options.since_id - Return draft orders after this ID
 * @param {string} options.status - Filter by status (open, invoice_sent, completed)
 * @param {string} options.created_at_min - Return draft orders created after this date
 * @param {string} options.created_at_max - Return draft orders created before this date
 * @param {string} options.updated_at_min - Return draft orders updated after this date
 * @param {string} options.updated_at_max - Return draft orders updated before this date
 * @returns {Promise<Array>} Array of draft orders
 */
async function listDraftOrders(options = {}) {
  try {
    const { shopifyGet } = require('../../config/shopify');
    
    const {
      limit = 50,
      since_id,
      status,
      created_at_min,
      created_at_max,
      updated_at_min,
      updated_at_max
    } = options;

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit.toString());
    
    if (since_id) queryParams.append('since_id', since_id.toString());
    if (status) queryParams.append('status', status);
    if (created_at_min) queryParams.append('created_at_min', created_at_min);
    if (created_at_max) queryParams.append('created_at_max', created_at_max);
    if (updated_at_min) queryParams.append('updated_at_min', updated_at_min);
    if (updated_at_max) queryParams.append('updated_at_max', updated_at_max);

    const response = await shopifyGet(`/draft_orders.json?${queryParams.toString()}`);
    return response.draft_orders || [];
  } catch (error) {
    throw handleShopifyError(error, 'List draft orders');
  }
}

module.exports = {
  createDraftOrder,
  getDraftOrder,
  updateDraftOrder,
  deleteDraftOrder,
  listDraftOrders
};
