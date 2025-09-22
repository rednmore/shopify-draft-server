/**
 * Route-to-action mapping configuration
 * Following ExpressJS best practices as defined in the rules
 * Maps HTTP routes to their corresponding action functions
 */

// Import action functions
const { listCustomers } = require('../actions/customers/listCustomers');
const { createCustomer, getCustomerById, updateCustomerCompany } = require('../actions/customers/createCustomer');
const { createDraftOrder, getDraftOrder, listDraftOrders } = require('../actions/orders/createDraftOrder');
const { completeDraftOrder, completeDraftOrderWithDetails } = require('../actions/orders/completeDraftOrder');
const { sendOrderConfirmation, sendOrderEmailAfterCompletion } = require('../actions/email/sendOrderConfirmation');
const { sendRegistrationEmails } = require('../actions/email/sendRegistrationEmail');
const { syncCustomerDataWebhook } = require('../actions/webhooks/syncCustomerData');
const { registerDefaultWebhooks } = require('../actions/webhooks/registerWebhook');

// Import validation schemas
const { z } = require('zod');
const {
  CreateCustomerSchema,
  ListCustomersQuerySchema,
  CreateDraftOrderSchema,
  CompleteDraftOrderSchema,
  SendOrderConfirmationSchema,
  SendOrderEmailSchema,
  IkyumRegistrationSubmitSchema,
  CustomerWebhookSchema,
  WebhookHeadersSchema,
  HealthCheckResponseSchema
} = require('../schemas/validation');

/**
 * Route configuration object
 * Maps route patterns to their handlers, middleware, and validation
 */
const ROUTE_CONFIG = {
  // Health and system routes
  health: {
    method: 'GET',
    path: '/health',
    action: async () => ({
      ok: true,
      time: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    }),
    middleware: [],
    validation: {
      response: HealthCheckResponseSchema
    },
    auth: false,
    rateLimit: 'global'
  },

  // Customer management routes
  listCustomers: {
    method: 'GET',
    path: '/list-customers',
    action: async (req) => {
      const { limit, since_id, created_at_min, created_at_max, order, fields } = req.query;
      return await listCustomers({ limit, since_id, created_at_min, created_at_max, order, fields });
    },
    middleware: ['authenticateApiKey', 'validateOrigin'],
    validation: {
      query: ListCustomersQuerySchema
    },
    auth: true,
    rateLimit: 'api'
  },

  createCustomer: {
    method: 'POST',
    path: '/create-customer',
    action: async (req) => {
      return await createCustomer(req.body);
    },
    middleware: ['authenticateApiKey', 'validateOrigin', 'validateIdempotencyKey'],
    validation: {
      body: CreateCustomerSchema
    },
    auth: true,
    rateLimit: 'customer'
  },

  getCustomer: {
    method: 'GET',
    path: '/customers/:customerId',
    action: async (req) => {
      const { customerId } = req.params;
      return await getCustomerById(parseInt(customerId));
    },
    middleware: ['authenticateApiKey'],
    validation: {
      params: z.object({
        customerId: z.coerce.number().int().positive()
      })
    },
    auth: true,
    rateLimit: 'api'
  },

  // Draft order routes
  createDraftOrder: {
    method: 'POST',
    path: '/create-draft-order',
    action: async (req) => {
      return await createDraftOrder(req.body);
    },
    middleware: ['authenticateApiKey', 'validateOrigin'],
    validation: {
      body: CreateDraftOrderSchema
    },
    auth: true,
    rateLimit: 'order'
  },

  completeDraftOrder: {
    method: 'POST',
    path: '/complete-draft-order',
    action: async (req) => {
      return await completeDraftOrderWithDetails(req.body.draft_id, {
        invoice_url: req.body.invoice_url,
        payment_pending: req.body.payment_pending
      });
    },
    middleware: ['authenticateApiKey', 'validateOrigin'],
    validation: {
      body: CompleteDraftOrderSchema
    },
    auth: true,
    rateLimit: 'order'
  },

  getDraftOrder: {
    method: 'GET',
    path: '/draft-orders/:draftId',
    action: async (req) => {
      const { draftId } = req.params;
      return await getDraftOrder(parseInt(draftId));
    },
    middleware: ['authenticateApiKey'],
    validation: {
      params: z.object({
        draftId: z.coerce.number().int().positive()
      })
    },
    auth: true,
    rateLimit: 'api'
  },

  listDraftOrders: {
    method: 'GET',
    path: '/draft-orders',
    action: async (req) => {
      const { limit, since_id, status, created_at_min, created_at_max } = req.query;
      return await listDraftOrders({ limit, since_id, status, created_at_min, created_at_max });
    },
    middleware: ['authenticateApiKey'],
    validation: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(250).default(50),
        since_id: z.coerce.number().int().positive().optional(),
        status: z.enum(['open', 'invoice_sent', 'completed']).optional(),
        created_at_min: z.string().datetime().optional(),
        created_at_max: z.string().datetime().optional()
      })
    },
    auth: true,
    rateLimit: 'api'
  },

  // Email routes
  sendOrderConfirmation: {
    method: 'POST',
    path: '/send-order-confirmation',
    action: async (req) => {
      return await sendOrderConfirmation(req.body);
    },
    middleware: ['authenticateApiKey', 'validateOrigin'],
    validation: {
      body: SendOrderConfirmationSchema
    },
    auth: true,
    rateLimit: 'api'
  },

  sendOrderEmail: {
    method: 'POST',
    path: '/send-order-email',
    action: async (req) => {
      return await sendOrderEmailAfterCompletion(req.body);
    },
    middleware: ['authenticateApiKey', 'validateOrigin'],
    validation: {
      body: SendOrderEmailSchema
    },
    auth: true,
    rateLimit: 'order'
  },

  // Registration form routes
  ikyumRegistrationSubmit: {
    method: 'POST',
    path: '/ikyum/regpro/submit',
    action: async (req) => {
      const { data, hp } = req.body;

      // Handle honeypot
      if (hp && String(hp).trim() !== '') {
        return { ok: true, skipped: 'honeypot' };
      }

      if (!data || typeof data !== 'object') {
        throw new Error('Invalid payload');
      }

      // Send registration emails
      const emailResults = await sendRegistrationEmails(data);

      // Update customer company in Shopify if possible
      if (process.env.SHOPIFY_API_URL && process.env.SHOPIFY_API_KEY) {
        try {
          const syncResult = await updateCustomerCompany(data.customer_id || null, data.company_name);
          if (!syncResult.ok) {
            console.warn('⚠️ Customer company sync failed:', syncResult.reason);
          }
        } catch (error) {
          console.warn('⚠️ Customer company sync error:', error.message);
        }
      }

      return { 
        ok: true,
        emails_sent: emailResults.success,
        admin_notification: !!emailResults.admin_notification?.success,
        user_confirmation: !!emailResults.user_confirmation?.success
      };
    },
    middleware: ['validateHoneypot', 'validateOrigin'],
    validation: {
      body: IkyumRegistrationSubmitSchema
    },
    auth: false,
    rateLimit: 'form'
  },

  // Webhook routes
  syncCustomerData: {
    method: 'POST',
    path: '/sync-customer-data',
    action: async (req) => {
      const headers = {
        'x-shopify-topic': req.get('X-Shopify-Topic'),
        'x-shopify-shop-domain': req.get('X-Shopify-Shop-Domain'),
        'x-shopify-hmac-sha256': req.get('X-Shopify-Hmac-Sha256'),
        'x-shopify-webhook-id': req.get('X-Shopify-Webhook-Id'),
        'x-shopify-api-version': req.get('X-Shopify-Api-Version')
      };

      return await syncCustomerDataWebhook(req.body, headers);
    },
    middleware: ['verifyShopifyWebhook'],
    validation: {
      body: CustomerWebhookSchema.optional(), // Webhook body can be empty for ping
      headers: WebhookHeadersSchema.partial() // Headers validation is optional for compatibility
    },
    auth: false, // Webhooks use HMAC verification instead
    rateLimit: 'api'
  },

  // Debug routes for webhooks
  syncCustomerDataPing: {
    method: 'GET',
    path: '/sync-customer-data/_ping',
    action: async () => ({
      ok: true,
      timestamp: new Date().toISOString(),
      service: 'sync-customer-data'
    }),
    middleware: [],
    validation: {},
    auth: false,
    rateLimit: 'global'
  },

  syncCustomerDataStatus: {
    method: 'GET',
    path: '/sync-customer-data/_last',
    action: async () => {
      const { getRecentWebhookHits } = require('../actions/webhooks/syncCustomerData');
      const hits = getRecentWebhookHits();
      return {
        count: hits.length,
        items: hits
      };
    },
    middleware: ['optionalApiKey'],
    validation: {},
    auth: false,
    rateLimit: 'api'
  }
};

/**
 * Get route configuration by name
 * @param {string} routeName - Name of the route
 * @returns {Object|null} Route configuration
 */
function getRouteConfig(routeName) {
  return ROUTE_CONFIG[routeName] || null;
}

/**
 * Get all route configurations
 * @returns {Object} All route configurations
 */
function getAllRouteConfigs() {
  return ROUTE_CONFIG;
}

/**
 * Get routes by method
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @returns {Object} Routes filtered by method
 */
function getRoutesByMethod(method) {
  const filteredRoutes = {};
  
  Object.entries(ROUTE_CONFIG).forEach(([name, config]) => {
    if (config.method === method.toUpperCase()) {
      filteredRoutes[name] = config;
    }
  });
  
  return filteredRoutes;
}

/**
 * Get routes that require authentication
 * @returns {Object} Routes that require authentication
 */
function getAuthenticatedRoutes() {
  const filteredRoutes = {};
  
  Object.entries(ROUTE_CONFIG).forEach(([name, config]) => {
    if (config.auth === true) {
      filteredRoutes[name] = config;
    }
  });
  
  return filteredRoutes;
}

/**
 * Get route statistics
 * @returns {Object} Route statistics
 */
function getRouteStats() {
  const routes = Object.values(ROUTE_CONFIG);
  
  return {
    total_routes: routes.length,
    by_method: routes.reduce((acc, route) => {
      acc[route.method] = (acc[route.method] || 0) + 1;
      return acc;
    }, {}),
    by_auth: routes.reduce((acc, route) => {
      const authType = route.auth ? 'authenticated' : 'public';
      acc[authType] = (acc[authType] || 0) + 1;
      return acc;
    }, {}),
    by_rate_limit: routes.reduce((acc, route) => {
      acc[route.rateLimit] = (acc[route.rateLimit] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = {
  ROUTE_CONFIG,
  getRouteConfig,
  getAllRouteConfigs,
  getRoutesByMethod,
  getAuthenticatedRoutes,
  getRouteStats
};
