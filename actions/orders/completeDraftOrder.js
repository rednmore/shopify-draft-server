/**
 * Complete draft order action
 * curl -X PUT "https://your-shop.myshopify.com/admin/api/2025-07/draft_orders/{draft_id}/complete.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "payment_pending": false
 *   }'
 */

const { shopifyPut, shopifyGet, handleShopifyError } = require('../../config/shopify');
const { DraftOrder, Order } = require('../../models');

/**
 * Complete a draft order, converting it to a regular order
 * @param {Object} orderData - Completion data
 * @param {number} orderData.draft_id - Draft order ID to complete
 * @param {string} orderData.invoice_url - Optional invoice URL for validation
 * @param {boolean} orderData.payment_pending - Whether payment is pending (default: false)
 * @returns {Promise<Object>} Completed order data
 */
async function completeDraftOrder(orderData) {
  try {
    const {
      draft_id,
      invoice_url,
      payment_pending = false
    } = orderData;

    // Validate required fields
    if (!draft_id) {
      throw new Error('Draft order ID is required');
    }

    // Get draft order details first to validate it exists and can be completed
    const draftOrderResponse = await shopifyGet(`/draft_orders/${draft_id}.json`);
    const draftOrder = draftOrderResponse.draft_order;

    if (!draftOrder) {
      throw new Error(`Draft order ${draft_id} not found`);
    }

    // Validate draft order status
    if (draftOrder.status === 'completed') {
      // Already completed, return the existing order
      if (draftOrder.order_id) {
        const orderResponse = await shopifyGet(`/orders/${draftOrder.order_id}.json`);
        return {
          success: true,
          already_completed: true,
          order_id: draftOrder.order_id,
          draft_id: draft_id,
          order: orderResponse.order
        };
      }
      throw new Error('Draft order is marked as completed but has no order_id');
    }

    if (draftOrder.status !== 'open' && draftOrder.status !== 'invoice_sent') {
      throw new Error(`Cannot complete draft order with status: ${draftOrder.status}`);
    }

    // Validate invoice URL if provided
    if (invoice_url && draftOrder.invoice_url !== invoice_url) {
      console.warn('⚠️ Provided invoice URL does not match draft order invoice URL');
    }

    // Prepare completion payload
    const completionPayload = {};
    if (payment_pending !== undefined) {
      completionPayload.payment_pending = payment_pending;
    }

    // Complete the draft order
    const completionResponse = await shopifyPut(
      `/draft_orders/${draft_id}/complete.json`,
      Object.keys(completionPayload).length > 0 ? completionPayload : undefined
    );

    const completedDraftOrder = completionResponse.draft_order;

    if (!completedDraftOrder) {
      throw new Error('Failed to complete draft order - no response data');
    }

    // Extract order ID from response
    const orderId = completedDraftOrder.order_id || completedDraftOrder.order?.id;

    if (!orderId) {
      throw new Error('No order ID returned after completing draft order');
    }

    // Fetch the created order details
    let orderDetails = null;
    try {
      const orderResponse = await shopifyGet(`/orders/${orderId}.json`);
      orderDetails = orderResponse.order;
    } catch (error) {
      console.warn('⚠️ Failed to fetch completed order details:', error.message);
    }

    return {
      success: true,
      order_id: orderId,
      draft_id: draft_id,
      completed_at: completedDraftOrder.completed_at || new Date().toISOString(),
      invoice_url: completedDraftOrder.invoice_url,
      name: completedDraftOrder.name,
      total_price: completedDraftOrder.total_price,
      currency: completedDraftOrder.currency,
      order: orderDetails,
      draft_order: completedDraftOrder
    };
  } catch (error) {
    throw handleShopifyError(error, 'Complete draft order');
  }
}

/**
 * Complete draft order and get order details
 * @param {number} draftId - Draft order ID
 * @param {Object} options - Completion options
 * @returns {Promise<Object>} Completed order with full details
 */
async function completeDraftOrderWithDetails(draftId, options = {}) {
  try {
    const result = await completeDraftOrder({
      draft_id: draftId,
      ...options
    });

    // If we don't have order details, fetch them
    if (!result.order && result.order_id) {
      try {
        const orderResponse = await shopifyGet(`/orders/${result.order_id}.json`);
        result.order = orderResponse.order;
      } catch (error) {
        console.warn('⚠️ Failed to fetch order details after completion:', error.message);
      }
    }

    return result;
  } catch (error) {
    throw handleShopifyError(error, 'Complete draft order with details');
  }
}

/**
 * Check if draft order can be completed
 * @param {number} draftId - Draft order ID
 * @returns {Promise<Object>} Validation result
 */
async function canCompleteDraftOrder(draftId) {
  try {
    const draftOrderResponse = await shopifyGet(`/draft_orders/${draft_id}.json`);
    const draftOrder = draftOrderResponse.draft_order;

    if (!draftOrder) {
      return {
        canComplete: false,
        reason: 'Draft order not found'
      };
    }

    if (draftOrder.status === 'completed') {
      return {
        canComplete: false,
        reason: 'Draft order already completed',
        orderId: draftOrder.order_id
      };
    }

    if (draftOrder.status !== 'open' && draftOrder.status !== 'invoice_sent') {
      return {
        canComplete: false,
        reason: `Invalid status: ${draftOrder.status}`
      };
    }

    if (!draftOrder.line_items || draftOrder.line_items.length === 0) {
      return {
        canComplete: false,
        reason: 'No line items in draft order'
      };
    }

    return {
      canComplete: true,
      draftOrder: draftOrder
    };
  } catch (error) {
    return {
      canComplete: false,
      reason: `Error checking draft order: ${error.message}`
    };
  }
}

/**
 * Get completion status of draft order
 * @param {number} draftId - Draft order ID
 * @returns {Promise<Object>} Status information
 */
async function getDraftOrderCompletionStatus(draftId) {
  try {
    const draftOrderResponse = await shopifyGet(`/draft_orders/${draft_id}.json`);
    const draftOrder = draftOrderResponse.draft_order;

    if (!draftOrder) {
      throw new Error('Draft order not found');
    }

    const status = {
      draft_id: draftId,
      status: draftOrder.status,
      completed: draftOrder.status === 'completed',
      completed_at: draftOrder.completed_at,
      order_id: draftOrder.order_id,
      invoice_url: draftOrder.invoice_url,
      total_price: draftOrder.total_price,
      currency: draftOrder.currency
    };

    // If completed and has order_id, fetch order details
    if (status.completed && status.order_id) {
      try {
        const orderResponse = await shopifyGet(`/orders/${status.order_id}.json`);
        status.order = orderResponse.order;
      } catch (error) {
        console.warn('⚠️ Failed to fetch order details:', error.message);
      }
    }

    return status;
  } catch (error) {
    throw handleShopifyError(error, 'Get draft order completion status');
  }
}

module.exports = {
  completeDraftOrder,
  completeDraftOrderWithDetails,
  canCompleteDraftOrder,
  getDraftOrderCompletionStatus
};
