/**
 * Complete data models for the Shopify Draft Server application
 * Following ExpressJS best practices as defined in the rules
 */

// =========================================
/* SHOPIFY CUSTOMER MODELS */
// =========================================

/**
 * Shopify Customer Address Model
 */
class CustomerAddress {
  constructor(data = {}) {
    this.id = data.id || null;
    this.customer_id = data.customer_id || null;
    this.first_name = data.first_name || '';
    this.last_name = data.last_name || '';
    this.company = data.company || '';
    this.address1 = data.address1 || '';
    this.address2 = data.address2 || '';
    this.city = data.city || '';
    this.province = data.province || '';
    this.country = data.country || '';
    this.country_code = data.country_code || '';
    this.zip = data.zip || '';
    this.phone = data.phone || '';
    this.name = data.name || '';
    this.province_code = data.province_code || '';
    this.default = data.default || false;
  }

  isValid() {
    return !!(this.address1 && this.city && this.country_code);
  }

  getFullName() {
    return `${this.first_name} ${this.last_name}`.trim();
  }
}

/**
 * Shopify Customer Metafield Model
 */
class CustomerMetafield {
  constructor(data = {}) {
    this.id = data.id || null;
    this.namespace = data.namespace || 'custom';
    this.key = data.key || '';
    this.value = data.value || '';
    this.type = data.type || 'single_line_text_field';
    this.description = data.description || '';
    this.owner_id = data.owner_id || null;
    this.owner_resource = data.owner_resource || 'customer';
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
  }

  isValid() {
    return !!(this.namespace && this.key && this.value);
  }
}

/**
 * Shopify Customer Model
 */
class Customer {
  constructor(data = {}) {
    this.id = data.id || null;
    this.email = data.email || '';
    this.accepts_marketing = data.accepts_marketing || false;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.first_name = data.first_name || '';
    this.last_name = data.last_name || '';
    this.orders_count = data.orders_count || 0;
    this.state = data.state || 'disabled';
    this.total_spent = data.total_spent || '0.00';
    this.last_order_id = data.last_order_id || null;
    this.note = data.note || '';
    this.verified_email = data.verified_email || false;
    this.multipass_identifier = data.multipass_identifier || null;
    this.tax_exempt = data.tax_exempt || false;
    this.phone = data.phone || '';
    this.tags = data.tags || '';
    this.last_order_name = data.last_order_name || '';
    this.currency = data.currency || 'USD';
    this.addresses = (data.addresses || []).map(addr => new CustomerAddress(addr));
    this.default_address = data.default_address ? new CustomerAddress(data.default_address) : null;
    this.metafields = (data.metafields || []).map(mf => new CustomerMetafield(mf));
  }

  isValid() {
    return !!(this.email && this.first_name && this.last_name);
  }

  getFullName() {
    return `${this.first_name} ${this.last_name}`.trim();
  }

  getDisplayLabel() {
    const company = this.default_address?.company || 
                   this.addresses?.find(a => a.company)?.company;
    if (company) return company;
    if (this.getFullName()) return this.getFullName();
    if (this.email) return this.email;
    return `Client ${this.id}`;
  }

  parseNote() {
    try {
      return this.note ? JSON.parse(this.note) : {};
    } catch (e) {
      return {};
    }
  }

  getMetafield(namespace, key) {
    return this.metafields.find(mf => mf.namespace === namespace && mf.key === key);
  }

  getCompanyName() {
    // Priority: default_address.company > first address.company > metafields
    const fromDefaultAddress = this.default_address?.company;
    const fromFirstAddress = this.addresses?.find(a => a.company)?.company;
    const fromMetafield = this.getMetafield('custom', 'company_name')?.value;
    
    return fromDefaultAddress || fromFirstAddress || fromMetafield || '';
  }

  getVatNumber() {
    const fromNote = this.parseNote().vat_number;
    const fromMetafield = this.getMetafield('custom', 'vat_number')?.value;
    
    return fromNote || fromMetafield || '';
  }
}

// =========================================
/* SHOPIFY ORDER MODELS */
// =========================================

/**
 * Order Line Item Model
 */
class OrderLineItem {
  constructor(data = {}) {
    this.id = data.id || null;
    this.variant_id = data.variant_id || null;
    this.title = data.title || '';
    this.quantity = data.quantity || 1;
    this.sku = data.sku || '';
    this.variant_title = data.variant_title || '';
    this.vendor = data.vendor || '';
    this.fulfillment_service = data.fulfillment_service || 'manual';
    this.product_id = data.product_id || null;
    this.requires_shipping = data.requires_shipping !== false;
    this.taxable = data.taxable !== false;
    this.gift_card = data.gift_card || false;
    this.name = data.name || '';
    this.variant_inventory_management = data.variant_inventory_management || '';
    this.properties = data.properties || [];
    this.product_exists = data.product_exists !== false;
    this.fulfillable_quantity = data.fulfillable_quantity || 0;
    this.grams = data.grams || 0;
    this.price = data.price || '0.00';
    this.total_discount = data.total_discount || '0.00';
    this.fulfillment_status = data.fulfillment_status || null;
    this.price_set = data.price_set || null;
    this.total_discount_set = data.total_discount_set || null;
    this.discount_allocations = data.discount_allocations || [];
    this.duties = data.duties || [];
    this.admin_graphql_api_id = data.admin_graphql_api_id || '';
    this.tax_lines = data.tax_lines || [];
  }

  isValid() {
    return !!(this.title && this.quantity > 0 && parseFloat(this.price) >= 0);
  }

  getTotalPrice() {
    return (parseFloat(this.price) * this.quantity) - parseFloat(this.total_discount);
  }
}

/**
 * Shopify Order Model
 */
class Order {
  constructor(data = {}) {
    this.id = data.id || null;
    this.admin_graphql_api_id = data.admin_graphql_api_id || '';
    this.app_id = data.app_id || null;
    this.browser_ip = data.browser_ip || null;
    this.buyer_accepts_marketing = data.buyer_accepts_marketing || false;
    this.cancel_reason = data.cancel_reason || null;
    this.cancelled_at = data.cancelled_at || null;
    this.cart_token = data.cart_token || '';
    this.checkout_id = data.checkout_id || null;
    this.checkout_token = data.checkout_token || '';
    this.client_details = data.client_details || null;
    this.closed_at = data.closed_at || null;
    this.confirmed = data.confirmed !== false;
    this.contact_email = data.contact_email || '';
    this.created_at = data.created_at || null;
    this.currency = data.currency || 'USD';
    this.current_subtotal_price = data.current_subtotal_price || '0.00';
    this.current_subtotal_price_set = data.current_subtotal_price_set || null;
    this.current_total_discounts = data.current_total_discounts || '0.00';
    this.current_total_discounts_set = data.current_total_discounts_set || null;
    this.current_total_duties_set = data.current_total_duties_set || null;
    this.current_total_price = data.current_total_price || '0.00';
    this.current_total_price_set = data.current_total_price_set || null;
    this.current_total_tax = data.current_total_tax || '0.00';
    this.current_total_tax_set = data.current_total_tax_set || null;
    this.customer_locale = data.customer_locale || null;
    this.device_id = data.device_id || null;
    this.discount_codes = data.discount_codes || [];
    this.email = data.email || '';
    this.estimated_taxes = data.estimated_taxes || false;
    this.financial_status = data.financial_status || 'pending';
    this.fulfillment_status = data.fulfillment_status || null;
    this.gateway = data.gateway || '';
    this.landing_site = data.landing_site || '';
    this.landing_site_ref = data.landing_site_ref || null;
    this.location_id = data.location_id || null;
    this.name = data.name || '';
    this.note = data.note || '';
    this.note_attributes = data.note_attributes || [];
    this.number = data.number || null;
    this.order_number = data.order_number || null;
    this.order_status_url = data.order_status_url || '';
    this.original_total_duties_set = data.original_total_duties_set || null;
    this.payment_gateway_names = data.payment_gateway_names || [];
    this.phone = data.phone || '';
    this.presentment_currency = data.presentment_currency || 'USD';
    this.processed_at = data.processed_at || null;
    this.processing_method = data.processing_method || '';
    this.reference = data.reference || '';
    this.referring_site = data.referring_site || '';
    this.source_identifier = data.source_identifier || '';
    this.source_name = data.source_name || '';
    this.source_url = data.source_url || null;
    this.subtotal_price = data.subtotal_price || '0.00';
    this.subtotal_price_set = data.subtotal_price_set || null;
    this.tags = data.tags || '';
    this.tax_lines = data.tax_lines || [];
    this.taxes_included = data.taxes_included || false;
    this.test = data.test || false;
    this.token = data.token || '';
    this.total_discounts = data.total_discounts || '0.00';
    this.total_discounts_set = data.total_discounts_set || null;
    this.total_line_items_price = data.total_line_items_price || '0.00';
    this.total_line_items_price_set = data.total_line_items_price_set || null;
    this.total_outstanding = data.total_outstanding || '0.00';
    this.total_price = data.total_price || '0.00';
    this.total_price_set = data.total_price_set || null;
    this.total_price_usd = data.total_price_usd || '0.00';
    this.total_shipping_price_set = data.total_shipping_price_set || null;
    this.total_tax = data.total_tax || '0.00';
    this.total_tax_set = data.total_tax_set || null;
    this.total_tip_received = data.total_tip_received || '0.00';
    this.total_weight = data.total_weight || 0;
    this.updated_at = data.updated_at || null;
    this.user_id = data.user_id || null;
    this.billing_address = data.billing_address ? new CustomerAddress(data.billing_address) : null;
    this.customer = data.customer ? new Customer(data.customer) : null;
    this.discount_applications = data.discount_applications || [];
    this.fulfillments = data.fulfillments || [];
    this.line_items = (data.line_items || []).map(item => new OrderLineItem(item));
    this.payment_details = data.payment_details || null;
    this.refunds = data.refunds || [];
    this.shipping_address = data.shipping_address ? new CustomerAddress(data.shipping_address) : null;
    this.shipping_lines = data.shipping_lines || [];
  }

  isValid() {
    return !!(this.email && this.line_items.length > 0);
  }

  getTotalPrice() {
    return parseFloat(this.total_price);
  }

  getLineItemsTotal() {
    return this.line_items.reduce((total, item) => total + item.getTotalPrice(), 0);
  }
}

// =========================================
/* SHOPIFY DRAFT ORDER MODELS */
// =========================================

/**
 * Shopify Draft Order Model
 */
class DraftOrder {
  constructor(data = {}) {
    this.id = data.id || null;
    this.note = data.note || '';
    this.email = data.email || '';
    this.taxes_included = data.taxes_included || false;
    this.currency = data.currency || 'USD';
    this.invoice_sent_at = data.invoice_sent_at || null;
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.tax_exempt = data.tax_exempt || false;
    this.completed_at = data.completed_at || null;
    this.name = data.name || '';
    this.status = data.status || 'open';
    this.line_items = (data.line_items || []).map(item => new OrderLineItem(item));
    this.shipping_address = data.shipping_address ? new CustomerAddress(data.shipping_address) : null;
    this.billing_address = data.billing_address ? new CustomerAddress(data.billing_address) : null;
    this.invoice_url = data.invoice_url || '';
    this.applied_discount = data.applied_discount || null;
    this.order_id = data.order_id || null;
    this.shipping_line = data.shipping_line || null;
    this.tax_lines = data.tax_lines || [];
    this.tags = data.tags || '';
    this.note_attributes = data.note_attributes || [];
    this.total_price = data.total_price || '0.00';
    this.subtotal_price = data.subtotal_price || '0.00';
    this.total_tax = data.total_tax || '0.00';
    this.customer = data.customer ? new Customer(data.customer) : null;
    this.use_customer_default_address = data.use_customer_default_address || false;
  }

  isValid() {
    return !!(this.line_items.length > 0 && (this.customer || this.email));
  }

  isCompleted() {
    return this.status === 'completed' && !!this.completed_at;
  }

  canBeCompleted() {
    return this.status === 'open' && this.isValid();
  }

  getTotalPrice() {
    return parseFloat(this.total_price);
  }
}

// =========================================
/* EMAIL MODELS */
// =========================================

/**
 * Email Configuration Model
 */
class EmailConfig {
  constructor(data = {}) {
    this.host = data.host || 'mail.infomaniak.com';
    this.port = data.port || 587;
    this.secure = data.secure || false;
    this.user = data.user || '';
    this.pass = data.pass || '';
    this.from = data.from || '';
    this.brand = data.brand || 'IKYUM';
  }

  isValid() {
    return !!(this.host && this.port && this.user && this.pass);
  }
}

/**
 * Email Message Model
 */
class EmailMessage {
  constructor(data = {}) {
    this.from = data.from || '';
    this.to = data.to || [];
    this.cc = data.cc || [];
    this.bcc = data.bcc || [];
    this.replyTo = data.replyTo || '';
    this.subject = data.subject || '';
    this.text = data.text || '';
    this.html = data.html || '';
    this.attachments = data.attachments || [];
  }

  isValid() {
    return !!(this.from && this.to.length > 0 && this.subject && (this.text || this.html));
  }

  addRecipient(email) {
    if (email && !this.to.includes(email)) {
      this.to.push(email);
    }
  }

  addCC(email) {
    if (email && !this.cc.includes(email)) {
      this.cc.push(email);
    }
  }
}

// =========================================
/* WEBHOOK MODELS */
// =========================================

/**
 * Shopify Webhook Model
 */
class ShopifyWebhook {
  constructor(data = {}) {
    this.id = data.id || null;
    this.topic = data.topic || '';
    this.address = data.address || '';
    this.created_at = data.created_at || null;
    this.updated_at = data.updated_at || null;
    this.format = data.format || 'json';
    this.fields = data.fields || [];
    this.metafield_namespaces = data.metafield_namespaces || [];
    this.private_metafield_namespaces = data.private_metafield_namespaces || [];
    this.api_version = data.api_version || '2025-07';
  }

  isValid() {
    return !!(this.topic && this.address);
  }
}

/**
 * Webhook Event Model
 */
class WebhookEvent {
  constructor(data = {}) {
    this.topic = data.topic || '';
    this.shop = data.shop || '';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.hmac = data.hmac || '';
    this.payload = data.payload || {};
    this.processed = data.processed || false;
    this.error = data.error || null;
  }

  isValid() {
    return !!(this.topic && this.shop && this.payload);
  }
}

// =========================================
/* REGISTRATION FORM MODELS */
// =========================================

/**
 * Registration Form Data Model
 */
class RegistrationData {
  constructor(data = {}) {
    this.company_name = data.company_name || '';
    this.contact_person = data.contact_person || '';
    this.email = data.email || '';
    this.contact_email = data.contact_email || data.email || '';
    this.delivery_email = data.delivery_email || data.email || '';
    this.phone = data.phone || '';
    this.address1 = data.address1 || '';
    this.address2 = data.address2 || '';
    this.city = data.city || '';
    this.zip = data.zip || '';
    this.country = data.country || '';
    this.country_code = data.country_code || '';
    this.vat_number = data.vat_number || '';
    this.customer_id = data.customer_id || null;
    this.notes = data.notes || '';
    this.marketing_consent = data.marketing_consent || false;
    this.terms_accepted = data.terms_accepted || false;
  }

  isValid() {
    return !!(
      this.company_name && 
      this.contact_person && 
      this.email && 
      this.terms_accepted
    );
  }

  getContactEmail() {
    return this.contact_email || this.delivery_email || this.email;
  }

  toCSV() {
    const fields = Object.keys(this);
    const escape = (value) => `"${String(value || '').replace(/[\r\n]/g, ' ').replace(/"/g, '""')}"`;
    const header = fields.map(escape).join(';');
    const row = fields.map(field => escape(this[field])).join(';');
    return `${header}\r\n${row}\r\n`;
  }
}

// =========================================
/* EXPORTS */
// =========================================

module.exports = {
  // Customer models
  Customer,
  CustomerAddress,
  CustomerMetafield,
  
  // Order models
  Order,
  OrderLineItem,
  DraftOrder,
  
  // Email models
  EmailConfig,
  EmailMessage,
  
  // Webhook models
  ShopifyWebhook,
  WebhookEvent,
  
  // Registration models
  RegistrationData
};
