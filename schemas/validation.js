/**
 * Zod validation schemas for all API endpoints
 * Following ExpressJS best practices as defined in the rules
 */

const { z } = require('zod');

// =========================================
/* COMMON SCHEMAS */
// =========================================

const EmailSchema = z.email('Invalid email format');
const UrlSchema = z.url('Invalid URL format');
const PhoneSchema = z.string().min(1, 'Phone number required');
const CountryCodeSchema = z.string().length(2, 'Country code must be 2 characters');
const CurrencySchema = z.string().length(3, 'Currency must be 3 characters');
const MoneyAmountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid money amount format');
const PositiveIntegerSchema = z.number().int().positive('Must be a positive integer');
const NonNegativeIntegerSchema = z.number().int().min(0, 'Must be non-negative');

// =========================================
/* CUSTOMER SCHEMAS */
// =========================================

const CustomerAddressSchema = z.object({
  id: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional(),
  first_name: z.string().min(1, 'First name required'),
  last_name: z.string().min(1, 'Last name required'),
  company: z.string().optional(),
  address1: z.string().min(1, 'Address line 1 required'),
  address2: z.string().optional(),
  city: z.string().min(1, 'City required'),
  province: z.string().optional(),
  country: z.string().min(1, 'Country required'),
  country_code: CountryCodeSchema,
  zip: z.string().min(1, 'Postal code required'),
  phone: PhoneSchema.optional(),
  name: z.string().optional(),
  province_code: z.string().optional(),
  default: z.boolean().optional()
});

const CustomerMetafieldSchema = z.object({
  id: z.number().int().positive().optional(),
  namespace: z.string().min(1, 'Namespace required').default('custom'),
  key: z.string().min(1, 'Key required'),
  value: z.string().min(1, 'Value required'),
  type: z.string().default('single_line_text_field'),
  description: z.string().optional(),
  owner_id: z.number().int().positive().optional(),
  owner_resource: z.string().default('customer'),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

const CreateCustomerSchema = z.object({
  email: EmailSchema,
  first_name: z.string().min(1, 'First name required'),
  last_name: z.string().min(1, 'Last name required'),
  phone: PhoneSchema.optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  default_address: CustomerAddressSchema,
  metafields: z.array(CustomerMetafieldSchema).optional(),
  vat_number: z.string().optional(),
  verified_email: z.boolean().default(true)
});

const UpdateCustomerSchema = z.object({
  id: PositiveIntegerSchema,
  email: EmailSchema.optional(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  phone: PhoneSchema.optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
  verified_email: z.boolean().optional()
});

const ListCustomersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(250).default(50),
  since_id: z.coerce.number().int().positive().optional(),
  created_at_min: z.string().datetime().optional(),
  created_at_max: z.string().datetime().optional(),
  updated_at_min: z.string().datetime().optional(),
  updated_at_max: z.string().datetime().optional(),
  order: z.enum(['created_at', 'updated_at']).default('created_at'),
  fields: z.string().optional() // comma-separated field names
});

// =========================================
/* ORDER SCHEMAS */
// =========================================

const OrderLineItemSchema = z.object({
  variant_id: z.number().int().positive().optional(),
  product_id: z.number().int().positive().optional(),
  title: z.string().min(1, 'Product title required'),
  quantity: PositiveIntegerSchema,
  price: MoneyAmountSchema.optional(),
  sku: z.string().optional(),
  variant_title: z.string().optional(),
  vendor: z.string().optional(),
  requires_shipping: z.boolean().default(true),
  taxable: z.boolean().default(true),
  gift_card: z.boolean().default(false),
  fulfillment_service: z.string().default('manual'),
  grams: NonNegativeIntegerSchema.optional(),
  properties: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional()
});

const CreateDraftOrderSchema = z.object({
  customer_id: PositiveIntegerSchema,
  items: z.array(OrderLineItemSchema).min(1, 'At least one item required'),
  note: z.string().optional(),
  email: EmailSchema.optional(),
  currency: CurrencySchema.default('USD'),
  taxes_included: z.boolean().default(false),
  use_customer_default_address: z.boolean().default(true),
  shipping_address: CustomerAddressSchema.optional(),
  billing_address: CustomerAddressSchema.optional(),
  tags: z.string().optional(),
  applied_discount: z.object({
    description: z.string(),
    value_type: z.enum(['fixed_amount', 'percentage']),
    value: z.string(),
    amount: MoneyAmountSchema.optional(),
    title: z.string().optional()
  }).optional()
});

const CompleteDraftOrderSchema = z.object({
  draft_id: PositiveIntegerSchema,
  invoice_url: UrlSchema.optional(),
  payment_pending: z.boolean().default(false)
});

const SendOrderConfirmationSchema = z.object({
  order_id: PositiveIntegerSchema,
  customer_id: PositiveIntegerSchema,
  cc: z.array(EmailSchema).optional(),
  subject: z.string().optional(),
  custom_message: z.string().optional()
});

const SendOrderEmailSchema = z.object({
  customer_id: PositiveIntegerSchema,
  draft_id: PositiveIntegerSchema,
  invoice_url: UrlSchema,
  cc: z.array(EmailSchema).optional(),
  subject: z.string().optional(),
  custom_message: z.string().optional()
});

// =========================================
/* WEBHOOK SCHEMAS */
// =========================================

const WebhookHeadersSchema = z.object({
  'x-shopify-topic': z.string().min(1, 'Shopify topic required'),
  'x-shopify-shop-domain': z.string().min(1, 'Shop domain required'),
  'x-shopify-hmac-sha256': z.string().min(1, 'HMAC signature required').optional(),
  'x-shopify-webhook-id': z.string().optional(),
  'x-shopify-api-version': z.string().optional()
});

const CustomerWebhookSchema = z.object({
  id: PositiveIntegerSchema,
  email: EmailSchema.optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  note: z.string().optional(),
  tags: z.string().optional(),
  default_address: z.object({
    id: z.number().int().positive().optional(),
    company: z.string().optional(),
    address1: z.string().optional(),
    city: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional()
  }).optional(),
  addresses: z.array(z.object({
    id: z.number().int().positive().optional(),
    company: z.string().optional(),
    address1: z.string().optional(),
    city: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional()
  })).optional()
});

const RegisterWebhookSchema = z.object({
  webhook: z.object({
    topic: z.string().min(1, 'Webhook topic required'),
    address: UrlSchema,
    format: z.enum(['json', 'xml']).default('json'),
    fields: z.array(z.string()).optional(),
    metafield_namespaces: z.array(z.string()).optional(),
    private_metafield_namespaces: z.array(z.string()).optional(),
    api_version: z.string().default('2025-07')
  })
});

// =========================================
/* REGISTRATION FORM SCHEMAS */
// =========================================

const RegistrationFormSchema = z.object({
  company_name: z.string().min(1, 'Company name required'),
  contact_person: z.string().min(1, 'Contact person required'),
  email: EmailSchema,
  contact_email: EmailSchema.optional(),
  delivery_email: EmailSchema.optional(),
  phone: PhoneSchema.optional(),
  address1: z.string().min(1, 'Address required'),
  address2: z.string().optional(),
  city: z.string().min(1, 'City required'),
  zip: z.string().min(1, 'Postal code required'),
  country: z.string().min(1, 'Country required'),
  country_code: CountryCodeSchema,
  vat_number: z.string().optional(),
  customer_id: z.string().optional(), // Can be string from form
  notes: z.string().optional(),
  marketing_consent: z.boolean().default(false),
  terms_accepted: z.boolean().refine(val => val === true, {
    message: 'Terms must be accepted'
  })
});

const IkyumRegistrationSubmitSchema = z.object({
  data: RegistrationFormSchema,
  hp: z.string().optional(), // honeypot field
  recaptchaToken: z.string().optional() // legacy, but might be present
});

// =========================================
/* API AUTHENTICATION SCHEMAS */
// =========================================

const ApiKeyHeaderSchema = z.object({
  'x-api-key': z.string().min(1, 'API key required')
});

const ApiKeyQuerySchema = z.object({
  key: z.string().min(1, 'API key required')
});

const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().min(1, 'Idempotency key required').optional()
});

// =========================================
/* REQUEST VALIDATION SCHEMAS */
// =========================================

const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(50),
  order: z.enum(['asc', 'desc']).default('desc'),
  sort_by: z.string().optional()
});

const HealthCheckResponseSchema = z.object({
  ok: z.boolean(),
  time: z.string().datetime(),
  version: z.string().optional(),
  environment: z.string().optional()
});

// =========================================
/* EXPORT SCHEMAS */
// =========================================

module.exports = {
  // Common schemas
  EmailSchema,
  UrlSchema,
  PhoneSchema,
  CountryCodeSchema,
  CurrencySchema,
  MoneyAmountSchema,
  PositiveIntegerSchema,
  NonNegativeIntegerSchema,

  // Customer schemas
  CustomerAddressSchema,
  CustomerMetafieldSchema,
  CreateCustomerSchema,
  UpdateCustomerSchema,
  ListCustomersQuerySchema,

  // Order schemas
  OrderLineItemSchema,
  CreateDraftOrderSchema,
  CompleteDraftOrderSchema,
  SendOrderConfirmationSchema,
  SendOrderEmailSchema,

  // Webhook schemas
  WebhookHeadersSchema,
  CustomerWebhookSchema,
  RegisterWebhookSchema,

  // Registration form schemas
  RegistrationFormSchema,
  IkyumRegistrationSubmitSchema,

  // Authentication schemas
  ApiKeyHeaderSchema,
  ApiKeyQuerySchema,
  IdempotencyHeaderSchema,

  // Request validation schemas
  PaginationQuerySchema,
  HealthCheckResponseSchema
};
