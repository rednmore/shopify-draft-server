/**
 * List customers action
 * curl -X GET "https://your-shop.myshopify.com/admin/api/2025-07/customers.json?limit=100" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json"
 */

const { shopifyGet, handleShopifyError } = require('../../config/shopify');
const { Customer } = require('../../models');

/**
 * List customers with enriched labels
 * Fetches customers and enriches them with display labels based on company/name/email
 * 
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of customers to return
 * @param {number} options.since_id - Return customers after this ID
 * @param {string} options.created_at_min - Return customers created after this date
 * @param {string} options.created_at_max - Return customers created before this date
 * @param {string} options.updated_at_min - Return customers updated after this date
 * @param {string} options.updated_at_max - Return customers updated before this date
 * @param {string} options.order - Order of results (created_at, updated_at)
 * @param {string} options.fields - Comma-separated list of fields to return
 * @returns {Promise<Array>} Array of customer objects with labels
 */
async function listCustomers(options = {}) {
  try {
    const {
      limit = 100,
      since_id,
      created_at_min,
      created_at_max,
      updated_at_min,
      updated_at_max,
      order = 'created_at',
      fields
    } = options;

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.append('limit', limit.toString());
    
    if (since_id) queryParams.append('since_id', since_id.toString());
    if (created_at_min) queryParams.append('created_at_min', created_at_min);
    if (created_at_max) queryParams.append('created_at_max', created_at_max);
    if (updated_at_min) queryParams.append('updated_at_min', updated_at_min);
    if (updated_at_max) queryParams.append('updated_at_max', updated_at_max);
    if (order) queryParams.append('order', order);
    if (fields) queryParams.append('fields', fields);

    // Fetch customers list
    const response = await shopifyGet(`/customers.json?${queryParams.toString()}`);
    
    if (!response || !response.customers) {
      throw new Error('No customers found in response');
    }

    // Enrich customers with detailed information for labels
    const enrichedCustomers = await Promise.all(
      response.customers.map(async (customerData) => {
        try {
          // Fetch detailed customer information
          const detailResponse = await shopifyGet(`/customers/${customerData.id}.json`);
          const fullCustomer = detailResponse.customer;
          
          if (!fullCustomer) {
            return {
              id: customerData.id,
              label: `Client ${customerData.id}`
            };
          }

          // Create Customer model instance for helper methods
          const customer = new Customer(fullCustomer);
          
          return {
            id: customer.id,
            label: customer.getDisplayLabel(),
            email: customer.email,
            name: customer.getFullName(),
            company: customer.getCompanyName(),
            created_at: customer.created_at,
            updated_at: customer.updated_at,
            orders_count: customer.orders_count,
            total_spent: customer.total_spent
          };
        } catch (error) {
          console.warn(`⚠️ Failed to enrich customer ${customerData.id}:`, error.message);
          return {
            id: customerData.id,
            label: `Client ${customerData.id}`
          };
        }
      })
    );

    return enrichedCustomers;
  } catch (error) {
    throw handleShopifyError(error, 'List customers');
  }
}

module.exports = { listCustomers };
