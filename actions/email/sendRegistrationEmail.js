/**
 * Send registration email action
 * Handles sending emails for form submissions (IKYUM registration, etc.)
 */

const nodemailer = require('nodemailer');
const { EmailConfig, EmailMessage, RegistrationData } = require('../../models');

/**
 * Create email transporter for IKYUM
 * @returns {Object} Nodemailer transporter
 */
function createIkyumTransporter() {
  const config = new EmailConfig({
    host: process.env.IKYUM_SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.IKYUM_SMTP_PORT || '587'),
    secure: false, // STARTTLS (587)
    user: process.env.IKYUM_SMTP_USER,
    pass: process.env.IKYUM_SMTP_PASS
  });

  if (!config.isValid()) {
    throw new Error('IKYUM SMTP configuration is incomplete');
  }

  return nodemailer.createTransporter({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} HTML-escaped text
 */
function escapeHTML(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send registration notification to admin
 * @param {Object} registrationData - Registration form data
 * @returns {Promise<Object>} Send result
 */
async function sendRegistrationNotificationToAdmin(registrationData) {
  try {
    const data = new RegistrationData(registrationData);
    
    if (!data.isValid()) {
      throw new Error('Invalid registration data');
    }

    const transporter = createIkyumTransporter();
    const brand = process.env.IKYUM_BRAND || 'IKYUM';
    const adminRecipients = process.env.IKYUM_ADMIN_RECIPIENTS || process.env.COPY_TO_ADDRESS;
    
    if (!adminRecipients) {
      throw new Error('No admin recipients configured');
    }

    // Create CSV attachment
    const csvContent = data.toCSV();
    
    // Prepare email message
    const emailMessage = new EmailMessage({
      from: process.env.IKYUM_SMTP_FROM || process.env.IKYUM_SMTP_USER,
      to: adminRecipients.split(',').map(email => email.trim()),
      replyTo: data.getContactEmail(),
      subject: `New registration — ${brand}: ${data.company_name || 'n/a'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">
            ${escapeHTML(brand)} — New Registration
          </h2>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0066cc;">Company Information</h3>
            <p><strong>Company:</strong> ${escapeHTML(data.company_name)}</p>
            <p><strong>Contact Person:</strong> ${escapeHTML(data.contact_person)}</p>
            <p><strong>Email:</strong> ${escapeHTML(data.getContactEmail())}</p>
            <p><strong>Phone:</strong> ${escapeHTML(data.phone)}</p>
          </div>

          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0066cc;">Address Information</h3>
            <p><strong>Address:</strong> ${escapeHTML(data.address1)}</p>
            ${data.address2 ? `<p><strong>Address 2:</strong> ${escapeHTML(data.address2)}</p>` : ''}
            <p><strong>City:</strong> ${escapeHTML(data.city)}</p>
            <p><strong>Postal Code:</strong> ${escapeHTML(data.zip)}</p>
            <p><strong>Country:</strong> ${escapeHTML(data.country)} (${escapeHTML(data.country_code)})</p>
          </div>

          ${data.vat_number ? `
          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0066cc;">Business Information</h3>
            <p><strong>VAT Number:</strong> ${escapeHTML(data.vat_number)}</p>
          </div>
          ` : ''}

          ${data.notes ? `
          <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0066cc;">Additional Notes</h3>
            <p>${escapeHTML(data.notes)}</p>
          </div>
          ` : ''}

          <div style="background: #f0f0f0; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #666;">Marketing Preferences</h3>
            <p><strong>Marketing Consent:</strong> ${data.marketing_consent ? 'Yes' : 'No'}</p>
            <p><strong>Terms Accepted:</strong> ${data.terms_accepted ? 'Yes' : 'No'}</p>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 14px;">
              <strong>Full data is attached as CSV.</strong><br>
              Registration received at: ${new Date().toISOString()}
            </p>
          </div>

          <div style="background: #e9ecef; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #495057;">Raw JSON Data</h3>
            <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; color: #495057;">${escapeHTML(JSON.stringify(registrationData, null, 2))}</pre>
          </div>
        </div>
      `,
      attachments: [{
        filename: 'registration.csv',
        content: Buffer.from(csvContent, 'utf8'),
        contentType: 'text/csv; charset=utf-8'
      }]
    });

    if (!emailMessage.isValid()) {
      throw new Error('Invalid email message configuration');
    }

    // Send email
    const result = await transporter.sendMail({
      from: emailMessage.from,
      to: emailMessage.to.join(','),
      replyTo: emailMessage.replyTo,
      subject: emailMessage.subject,
      html: emailMessage.html,
      attachments: emailMessage.attachments
    });

    return {
      success: true,
      messageId: result.messageId,
      recipients: emailMessage.to,
      subject: emailMessage.subject,
      sent_at: new Date().toISOString(),
      company: data.company_name,
      contact_email: data.getContactEmail()
    };
  } catch (error) {
    console.error('❌ Failed to send registration notification to admin:', error);
    throw new Error(`Failed to send admin notification: ${error.message}`);
  }
}

/**
 * Send registration confirmation to user
 * @param {Object} registrationData - Registration form data
 * @returns {Promise<Object>} Send result
 */
async function sendRegistrationConfirmationToUser(registrationData) {
  try {
    const data = new RegistrationData(registrationData);
    const userEmail = data.getContactEmail();
    
    if (!userEmail) {
      throw new Error('No user email address found');
    }

    const transporter = createIkyumTransporter();
    const brand = process.env.IKYUM_BRAND || 'IKYUM';

    // Prepare confirmation email
    const emailMessage = new EmailMessage({
      from: process.env.IKYUM_SMTP_FROM || process.env.IKYUM_SMTP_USER,
      to: [userEmail],
      subject: `Thank you — ${brand}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0066cc; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">
            Thank you for your registration
          </h2>
          
          <div style="background: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0;">
            <p style="margin-top: 0;">Dear ${escapeHTML(data.contact_person)},</p>
            <p>Thank you for your interest in ${escapeHTML(brand)}.</p>
            <p>We have received your registration for:</p>
            <p style="background: white; padding: 15px; border-left: 4px solid #0066cc; margin: 15px 0;">
              <strong>${escapeHTML(data.company_name)}</strong>
            </p>
            <p>Our team will review your application and get back to you shortly.</p>
          </div>

          <div style="background: #e7f3ff; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #0066cc;">What happens next?</h3>
            <ul style="margin-bottom: 0;">
              <li>Our team will review your registration</li>
              <li>We'll verify your business information</li>
              <li>You'll receive account setup instructions within 1-2 business days</li>
              <li>Our support team will contact you if we need additional information</li>
            </ul>
          </div>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 14px;">
              If you have any questions, please don't hesitate to contact us.<br>
              <strong>Email:</strong> ${process.env.IKYUM_ADMIN_RECIPIENTS?.split(',')[0] || 'info@ikyum.com'}
            </p>
          </div>

          <div style="margin-top: 20px; text-align: center; color: #999; font-size: 12px;">
            <p>This is an automated message from ${escapeHTML(brand)}.</p>
          </div>
        </div>
      `
    });

    if (!emailMessage.isValid()) {
      throw new Error('Invalid confirmation email configuration');
    }

    // Send email
    const result = await transporter.sendMail({
      from: emailMessage.from,
      to: emailMessage.to.join(','),
      subject: emailMessage.subject,
      html: emailMessage.html
    });

    return {
      success: true,
      messageId: result.messageId,
      recipient: userEmail,
      subject: emailMessage.subject,
      sent_at: new Date().toISOString(),
      company: data.company_name,
      contact_person: data.contact_person
    };
  } catch (error) {
    console.error('❌ Failed to send registration confirmation to user:', error);
    throw new Error(`Failed to send user confirmation: ${error.message}`);
  }
}

/**
 * Send both admin notification and user confirmation
 * @param {Object} registrationData - Registration form data
 * @returns {Promise<Object>} Combined send result
 */
async function sendRegistrationEmails(registrationData) {
  try {
    const results = {
      admin_notification: null,
      user_confirmation: null,
      success: false,
      errors: []
    };

    // Send admin notification
    try {
      results.admin_notification = await sendRegistrationNotificationToAdmin(registrationData);
    } catch (error) {
      console.error('❌ Admin notification failed:', error);
      results.errors.push(`Admin notification failed: ${error.message}`);
    }

    // Send user confirmation (optional - don't fail if user email is missing)
    try {
      results.user_confirmation = await sendRegistrationConfirmationToUser(registrationData);
    } catch (error) {
      console.warn('⚠️ User confirmation failed:', error);
      results.errors.push(`User confirmation failed: ${error.message}`);
    }

    // Consider success if at least admin notification was sent
    results.success = !!results.admin_notification?.success;

    return results;
  } catch (error) {
    throw new Error(`Failed to send registration emails: ${error.message}`);
  }
}

/**
 * Test email configuration
 * @returns {Promise<Object>} Test result
 */
async function testEmailConfiguration() {
  try {
    const transporter = createIkyumTransporter();
    
    // Verify transporter configuration
    await transporter.verify();
    
    return {
      success: true,
      message: 'Email configuration is valid',
      smtp_host: process.env.IKYUM_SMTP_HOST || 'mail.infomaniak.com',
      smtp_port: process.env.IKYUM_SMTP_PORT || '587',
      smtp_user: process.env.IKYUM_SMTP_USER ? 'configured' : 'missing'
    };
  } catch (error) {
    return {
      success: false,
      message: 'Email configuration test failed',
      error: error.message
    };
  }
}

module.exports = {
  sendRegistrationNotificationToAdmin,
  sendRegistrationConfirmationToUser,
  sendRegistrationEmails,
  testEmailConfiguration,
  createIkyumTransporter,
  escapeHTML
};
