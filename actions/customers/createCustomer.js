/**
 * Create customer action
 * curl -X POST "https://your-shop.myshopify.com/admin/api/2025-07/customers.json" \
 *   -H "X-Shopify-Access-Token: YOUR_ACCESS_TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "customer": {
 *       "email": "customer@example.com",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "addresses": [{
 *         "address1": "123 Main St",
 *         "city": "Anytown", 
 *         "zip": "12345",
 *         "country": "United States",
 *         "country_code": "US"
 *       }]
 *     }
 *   }'
 */

const { shopifyGet, shopifyPost, shopifyPut, handleShopifyError } = require('../../config/shopify');
const { Customer } = require('../../models');

/**
 * Check if customer exists by email
 * @param {string} email - Customer email to search for
 * @returns {Promise<Object|null>} Existing customer or null
 */
async function findCustomerByEmail(email) {
  try {
    const query = encodeURIComponent(`email:${email}`);
    const response = await shopifyGet(`/customers/search.json?query=${query}`);
    
    const customers = response?.customers || [];
    return customers.length > 0 ? customers[0] : null;
  } catch (error) {
    console.warn('⚠️ Error searching for customer by email:', error.message);
    return null;
  }
}

/**
 * Create metafields for customer
 * @param {number} customerId - Customer ID
 * @param {Array} metafields - Array of metafield objects
 * @returns {Promise<void>}
 */
async function createCustomerMetafields(customerId, metafields = []) {
  if (!Array.isArray(metafields) || metafields.length === 0) {
    return;
  }

  for (const metafield of metafields) {
    try {
      await shopifyPost(`/customers/${customerId}/metafields.json`, {
        metafield: {
          namespace: metafield.namespace || 'custom',
          key: metafield.key,
          type: metafield.type || 'single_line_text_field',
          value: metafield.value
        }
      });
    } catch (error) {
      console.warn(`⚠️ Failed to create metafield ${metafield.key}:`, error.message);
    }
  }
}

/**
 * Set default address for customer
 * @param {number} customerId - Customer ID
 * @param {number} addressId - Address ID to set as default
 * @returns {Promise<void>}
 */
async function setDefaultAddress(customerId, addressId) {
  try {
    await shopifyPut(`/customers/${customerId}/addresses/${addressId}/default.json`);
  } catch (error) {
    console.warn('⚠️ Failed to set default address:', error.message);
  }
}

/**
 * Create a new customer with address and metafields
 * @param {Object} customerData - Customer data from request
 * @returns {Promise<Object>} Created customer data
 */
async function createCustomer(customerData) {
  try {
    const {
      email,
      first_name,
      last_name,
      phone,
      note,
      tags = [],
      default_address,
      metafields = [],
      vat_number,
      verified_email = true
    } = customerData;

    // Check if customer already exists
    const existingCustomer = await findCustomerByEmail(email);
    if (existingCustomer) {
      return {
        exists: true,
        message: 'Customer already exists',
        id: existingCustomer.id,
        customer: existingCustomer
      };
    }

    // Prepare customer payload
    const createPayload = {
      customer: {
        email,
        first_name,
        last_name,
        phone: phone || null,
        note: note || null,
        tags: Array.isArray(tags) ? tags.join(',') : String(tags || ''),
        addresses: default_address ? [default_address] : [],
        verified_email
      }
    };

    // Create customer
    const response = await shopifyPost('/customers.json', createPayload);
    
    if (!response?.customer?.id) {
      throw new Error('Failed to create customer - no ID returned');
    }

    const customer = response.customer;

    // Create metafields
    const allMetafields = [...metafields];
    
    // Add company metafield if company is provided in default_address
    if (default_address?.company) {
      allMetafields.push({
        namespace: 'custom',
        key: 'company_name',
        type: 'single_line_text_field',
        value: default_address.company
      });
    }

    // Add VAT number metafield if provided
    if (vat_number) {
      allMetafields.push({
        namespace: 'custom',
        key: 'vat_number',
        type: 'single_line_text_field',
        value: vat_number
      });
    }

    await createCustomerMetafields(customer.id, allMetafields);

    // Ensure default address is properly set
    if (customer.addresses && customer.addresses.length > 0) {
      const firstAddress = customer.addresses[0];
      if (firstAddress.id && !firstAddress.default) {
        await setDefaultAddress(customer.id, firstAddress.id);
      }
    }

    return {
      id: customer.id,
      customer: customer,
      created: true
    };
  } catch (error) {
    throw handleShopifyError(error, 'Create customer');
  }
}

/**
 * Get customer details by ID
 * @param {number} customerId - Customer ID
 * @returns {Promise<Object>} Customer details
 */
async function getCustomerById(customerId) {
  try {
    const response = await shopifyGet(`/customers/${customerId}.json`);
    return response.customer;
  } catch (error) {
    throw handleShopifyError(error, 'Get customer');
  }
}

/**
 * Update customer company information
 * Updates the default address company field and related metafields
 * @param {number} customerId - Customer ID
 * @param {string} companyName - Company name to set
 * @returns {Promise<Object>} Update result
 */
async function updateCustomerCompany(customerId, companyName) {
  try {
    if (!companyName || !customerId) {
      return { ok: false, reason: 'missing-data' };
    }

    // Get customer details
    const customer = await getCustomerById(customerId);
    if (!customer) {
      return { ok: false, reason: 'customer-not-found' };
    }

    // Update default address company
    if (customer.default_address?.id) {
      try {
        await shopifyPut(`/customers/${customerId}/addresses/${customer.default_address.id}.json`, {
          address: {
            ...customer.default_address,
            company: companyName
          }
        });
      } catch (error) {
        console.warn('⚠️ Failed to update default address company:', error.message);
      }
    } else if (customer.addresses && customer.addresses.length > 0) {
      // Update first address if no default address
      const firstAddress = customer.addresses[0];
      try {
        await shopifyPut(`/customers/${customerId}/addresses/${firstAddress.id}.json`, {
          address: {
            ...firstAddress,
            company: companyName
          }
        });
      } catch (error) {
        console.warn('⚠️ Failed to update first address company:', error.message);
      }
    } else {
      // Create a minimal address with company
      try {
        await shopifyPost(`/customers/${customerId}/addresses.json`, {
          address: {
            company: companyName,
            first_name: customer.first_name || '',
            last_name: customer.last_name || '',
            address1: 'To be completed',
            city: 'To be completed',
            country: 'Switzerland',
            default: true
          }
        });
      } catch (error) {
        console.warn('⚠️ Failed to create address with company:', error.message);
      }
    }

    // Update/create company metafield
    await createCustomerMetafields(customerId, [{
      namespace: 'custom',
      key: 'company_name',
      type: 'single_line_text_field',
      value: companyName
    }]);

    return { ok: true };
  } catch (error) {
    console.warn('⚠️ Error updating customer company:', error.message);
    return { ok: false, reason: 'update-failed' };
  }
}

module.exports = {
  createCustomer,
  getCustomerById,
  findCustomerByEmail,
  updateCustomerCompany,
  createCustomerMetafields,
  setDefaultAddress
};
