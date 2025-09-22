/**
 * Send order confirmation email action
 * curl -X POST "https://your-shop.myshopify.com/admin/api/2025-07/orders/{order_id}/send_receipt.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "email": {
 *       "to": "customer@example.com,admin@shop.com",
 *       "subject": "Your order confirmation",
 *       "custom_message": "Thank you for your order!"
 *     }
 *   }'
 */

const { shopifyGet, shopifyPost, handleShopifyError } = require('../../config/shopify');
const { EmailMessage } = require('../../models');

/**
 * Send order receipt email using Shopify's built-in receipt system
 * @param {Object} emailData - Email configuration
 * @param {number} emailData.order_id - Order ID to send receipt for
 * @param {number} emailData.customer_id - Customer ID (for validation)
 * @param {Array} emailData.cc - Additional CC email addresses
 * @param {string} emailData.subject - Custom email subject
 * @param {string} emailData.custom_message - Custom message to include
 * @returns {Promise<Object>} Send result
 */
async function sendOrderConfirmation(emailData) {
  try {
    const {
      order_id,
      customer_id,
      cc = [],
      subject = 'Your order confirmation',
      custom_message = 'Thank you for your order!'
    } = emailData;

    // Validate required fields
    if (!order_id) {
      throw new Error('Order ID is required');
    }

    if (!customer_id) {
      throw new Error('Customer ID is required');
    }

    // Get customer details to get primary email
    const customerResponse = await shopifyGet(`/customers/${customer_id}.json`);
    const customer = customerResponse.customer;

    if (!customer) {
      throw new Error('Customer not found');
    }

    const customerEmail = customer.email;
    if (!customerEmail) {
      throw new Error('Customer has no email address');
    }

    // Prepare recipient list
    const recipients = [customerEmail];
    
    // Add CC addresses if provided
    if (Array.isArray(cc) && cc.length > 0) {
      recipients.push(...cc.filter(email => email && email !== customerEmail));
    }

    // Validate that we have valid recipients
    if (recipients.length === 0) {
      throw new Error('No valid email recipients');
    }

    // Prepare email payload for Shopify
    const emailPayload = {
      email: {
        to: recipients.join(','),
        subject: subject,
        custom_message: custom_message
      }
    };

    // Send receipt using Shopify's API
    const response = await shopifyPost(
      `/orders/${order_id}/send_receipt.json`,
      emailPayload
    );

    return {
      success: true,
      order_id: order_id,
      recipients: recipients,
      subject: subject,
      sent_at: new Date().toISOString(),
      shopify_response: response
    };
  } catch (error) {
    throw handleShopifyError(error, 'Send order confirmation');
  }
}

/**
 * Send order confirmation with complete order and customer details
 * @param {Object} emailData - Email configuration
 * @returns {Promise<Object>} Send result with order details
 */
async function sendOrderConfirmationWithDetails(emailData) {
  try {
    const { order_id, customer_id } = emailData;

    // Get order details
    let orderDetails = null;
    try {
      const orderResponse = await shopifyGet(`/orders/${order_id}.json`);
      orderDetails = orderResponse.order;
    } catch (error) {
      console.warn('⚠️ Failed to fetch order details:', error.message);
    }

    // Get customer details
    let customerDetails = null;
    try {
      const customerResponse = await shopifyGet(`/customers/${customer_id}.json`);
      customerDetails = customerResponse.customer;
    } catch (error) {
      console.warn('⚠️ Failed to fetch customer details:', error.message);
    }

    // Send confirmation
    const result = await sendOrderConfirmation(emailData);

    // Add additional details to response
    return {
      ...result,
      order: orderDetails,
      customer: customerDetails
    };
  } catch (error) {
    throw handleShopifyError(error, 'Send order confirmation with details');
  }
}

/**
 * Send order email after completing a draft order
 * Combines draft completion and email sending in one operation
 * @param {Object} emailData - Email and completion data
 * @param {number} emailData.customer_id - Customer ID
 * @param {number} emailData.draft_id - Draft order ID to complete
 * @param {string} emailData.invoice_url - Invoice URL
 * @param {Array} emailData.cc - CC email addresses
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.custom_message - Custom message
 * @returns {Promise<Object>} Combined operation result
 */
async function sendOrderEmailAfterCompletion(emailData) {
  try {
    const {
      customer_id,
      draft_id,
      invoice_url,
      cc = [],
      subject = 'Your order confirmation',
      custom_message = 'Thank you for your order!'
    } = emailData;

    // Import completion function
    const { completeDraftOrder } = require('../orders/completeDraftOrder');

    // Complete the draft order first
    const completionResult = await completeDraftOrder({
      draft_id,
      invoice_url
    });

    if (!completionResult.success || !completionResult.order_id) {
      throw new Error('Failed to complete draft order');
    }

    // Add default copy address if configured
    const copyToAddress = process.env.COPY_TO_ADDRESS;
    const allCC = [...cc];
    if (copyToAddress) {
      allCC.unshift(copyToAddress);
    }

    // Send order confirmation
    const emailResult = await sendOrderConfirmation({
      order_id: completionResult.order_id,
      customer_id,
      cc: allCC,
      subject,
      custom_message
    });

    return {
      success: true,
      order_completed: true,
      email_sent: true,
      order_id: completionResult.order_id,
      draft_id: draft_id,
      completed_at: completionResult.completed_at,
      email_recipients: emailResult.recipients,
      order: completionResult.order,
      draft_order: completionResult.draft_order
    };
  } catch (error) {
    throw handleShopifyError(error, 'Send order email after completion');
  }
}

/**
 * Validate email data before sending
 * @param {Object} emailData - Email data to validate
 * @returns {Object} Validation result
 */
function validateEmailData(emailData) {
  const errors = [];

  if (!emailData.order_id) {
    errors.push('Order ID is required');
  }

  if (!emailData.customer_id) {
    errors.push('Customer ID is required');
  }

  if (emailData.cc && !Array.isArray(emailData.cc)) {
    errors.push('CC must be an array of email addresses');
  }

  if (emailData.cc) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emailData.cc.filter(email => !emailRegex.test(email));
    if (invalidEmails.length > 0) {
      errors.push(`Invalid CC email addresses: ${invalidEmails.join(', ')}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Get order email status and history
 * @param {number} orderId - Order ID
 * @returns {Promise<Object>} Email status information
 */
async function getOrderEmailStatus(orderId) {
  try {
    // Get order details which may include email history
    const orderResponse = await shopifyGet(`/orders/${orderId}.json`);
    const order = orderResponse.order;

    if (!order) {
      throw new Error('Order not found');
    }

    // Extract email-related information from order
    return {
      order_id: orderId,
      order_name: order.name,
      order_number: order.order_number,
      customer_email: order.email || order.contact_email,
      confirmed: order.confirmed,
      created_at: order.created_at,
      processed_at: order.processed_at,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      // Note: Shopify doesn't expose detailed email send history via REST API
      // This would require additional tracking on our side
      has_email_address: !!(order.email || order.contact_email)
    };
  } catch (error) {
    throw handleShopifyError(error, 'Get order email status');
  }
}

module.exports = {
  sendOrderConfirmation,
  sendOrderConfirmationWithDetails,
  sendOrderEmailAfterCompletion,
  validateEmailData,
  getOrderEmailStatus
};
