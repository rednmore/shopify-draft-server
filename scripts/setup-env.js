#!/usr/bin/env node

/**
 * Interactive Environment Setup Script for Shopify Draft Server
 * Creates a .env file with user-provided values and sane defaults
 * 
 * Usage:
 *   npm run setup        # Full setup (all variables)
 *   npm run setup:quick  # Quick setup (only essential Shopify variables)
 */

const prompts = require('prompts');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Check if quick mode is enabled
const isQuickMode = process.argv.includes('--quick');

// Generate a secure random API secret
function generateApiSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Check if .env already exists
const envPath = path.join(__dirname, '..', '.env');
const envExists = fs.existsSync(envPath);

console.log('🚀 Shopify Draft Server Environment Setup');
console.log('==========================================');

if (isQuickMode) {
  console.log('⚡ Quick Mode: Only essential Shopify settings');
} else {
  console.log('🔧 Full Mode: All configuration options');
}

if (envExists) {
  console.log('⚠️  .env file already exists - it will be overwritten');
}

console.log('');

// Define all environment variables with their configurations
const envConfig = {
  // CORE SHOPIFY (Required)
  SHOPIFY_API_URL: {
    type: 'text',
    message: 'Shopify store domain (without https://)',
    hint: 'e.g., mystore.myshopify.com',
    required: true,
    validate: value => {
      if (!value) return 'Shopify store domain is required';
      if (value.includes('http')) return 'Do not include https:// - just the domain';
      return true;
    }
  },
  
  SHOPIFY_API_KEY: {
    type: 'text',
    message: 'Shopify Admin API Access Token',
    hint: 'Starts with "shpat_" - get from Shopify Admin > Apps > Develop apps',
    required: true,
    validate: value => {
      if (!value) return 'Shopify API key is required';
      if (!value.startsWith('shpat_')) return 'API key should start with "shpat_"';
      return true;
    }
  },
  
  API_SECRET: {
    type: 'text',
    message: 'API Secret (shared between theme and server)',
    hint: 'Press Enter to generate a secure random secret',
    initial: () => generateApiSecret(),
    required: true,
    validate: value => {
      if (!value) return 'API secret is required';
      if (value.length < 16) return 'API secret should be at least 16 characters';
      return true;
    }
  },

  // WEBHOOK (Optional but recommended)
  PUBLIC_WEBHOOK_URL: {
    type: 'text',
    message: 'Webhook URL (your deployed server + /sync-customer-data)',
    hint: 'e.g., https://your-app.onrender.com/sync-customer-data',
    quickMode: false,
    initial: ''
  },

  // EMAIL/SMTP (Required for email features)
  IKYUM_SMTP_USER: {
    type: 'text',
    message: 'SMTP Email Username',
    hint: 'e.g., no-reply@yourdomain.com',
    quickMode: false,
    required: true
  },
  
  IKYUM_SMTP_PASS: {
    type: 'password',
    message: 'SMTP Email Password',
    hint: 'Your email provider password or app-specific password',
    quickMode: false,
    required: true
  },
  
  IKYUM_ADMIN_RECIPIENTS: {
    type: 'text',
    message: 'Admin email addresses (comma-separated)',
    hint: 'e.g., admin@yourdomain.com,manager@yourdomain.com',
    quickMode: false,
    required: true
  },

  // RECAPTCHA (Required for forms)
  IKYUM_RECAPTCHA_SECRET: {
    type: 'text',
    message: 'Google reCAPTCHA v3 Secret Key',
    hint: 'Get from Google reCAPTCHA Admin Console',
    quickMode: false,
    required: true
  },

  // OPTIONAL WITH DEFAULTS
  IKYUM_SMTP_HOST: {
    type: 'text',
    message: 'SMTP Host',
    initial: 'mail.infomaniak.com',
    quickMode: false
  },
  
  IKYUM_SMTP_PORT: {
    type: 'number',
    message: 'SMTP Port',
    initial: 587,
    quickMode: false
  },
  
  IKYUM_SMTP_FROM: {
    type: 'text',
    message: 'Email "From" address',
    hint: 'e.g., Your Brand <no-reply@yourdomain.com>',
    quickMode: false
  },
  
  COPY_TO_ADDRESS: {
    type: 'text',
    message: 'Fallback email for copies',
    hint: 'Used as backup if admin recipients not set',
    quickMode: false
  },
  
  IKYUM_BRAND: {
    type: 'text',
    message: 'Brand name (used in emails)',
    initial: 'Your Brand',
    quickMode: false
  },
  
  IKYUM_RECAPTCHA_MIN_SCORE: {
    type: 'number',
    message: 'reCAPTCHA minimum score (0.0-1.0)',
    initial: 0.5,
    min: 0,
    max: 1,
    quickMode: false
  },
  
  PORT: {
    type: 'number',
    message: 'Server port (auto-set by Render)',
    initial: 3000,
    quickMode: false
  }
};

async function main() {
  try {
    // Filter config based on mode
    const configToUse = Object.entries(envConfig).filter(([key, config]) => {
      if (isQuickMode) {
        // In quick mode, only show core Shopify settings
        return config.quickMode !== false && config.required;
      }
      return true; // Full mode shows everything
    });

    // Create prompts
    const questions = configToUse.map(([key, config]) => ({
      type: config.type,
      name: key,
      message: config.message,
      hint: config.hint,
      initial: config.initial,
      validate: config.validate,
      min: config.min,
      max: config.max
    }));

    console.log(`📝 Setting up ${questions.length} environment variables...\n`);

    // Run prompts
    const answers = await prompts(questions, {
      onCancel: () => {
        console.log('\n❌ Setup cancelled');
        process.exit(0);
      }
    });

    // Generate .env content
    const envContent = generateEnvContent(answers);
    
    // Write .env file
    fs.writeFileSync(envPath, envContent);
    
    console.log('\n✅ .env file created successfully!');
    console.log(`📁 Location: ${envPath}`);
    
    if (isQuickMode) {
      console.log('\n⚠️  Quick mode complete. For full configuration run: npm run setup');
    }
    
    console.log('\n🚀 Next steps:');
    console.log('   1. Review and update .env file if needed');
    console.log('   2. Update client-side configurations (see env.template for details)');
    console.log('   3. Deploy your server to get the webhook URL');
    console.log('   4. Run: npm start');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

function generateEnvContent(answers) {
  const lines = [];
  
  lines.push('# Shopify Draft Server Environment Configuration');
  lines.push('# Generated by setup script on ' + new Date().toISOString());
  lines.push('# DO NOT COMMIT THIS FILE TO VERSION CONTROL');
  lines.push('');
  
  // Core Shopify settings
  lines.push('# ===== CORE SHOPIFY INTEGRATION =====');
  if (answers.SHOPIFY_API_URL) {
    lines.push('# Your Shopify store domain');
    lines.push(`SHOPIFY_API_URL=${answers.SHOPIFY_API_URL}`);
  }
  if (answers.SHOPIFY_API_KEY) {
    lines.push('# Shopify Admin API Access Token');
    lines.push(`SHOPIFY_API_KEY=${answers.SHOPIFY_API_KEY}`);
  }
  if (answers.API_SECRET) {
    lines.push('# Shared secret for API authentication');
    lines.push(`API_SECRET=${answers.API_SECRET}`);
  }
  lines.push('');
  
  // Webhook settings
  if (answers.PUBLIC_WEBHOOK_URL) {
    lines.push('# ===== WEBHOOK CONFIGURATION =====');
    lines.push('# URL where Shopify sends webhook notifications');
    lines.push(`PUBLIC_WEBHOOK_URL=${answers.PUBLIC_WEBHOOK_URL}`);
    lines.push('');
  }
  
  // Email settings
  const hasEmailSettings = answers.IKYUM_SMTP_USER || answers.IKYUM_SMTP_PASS || answers.IKYUM_ADMIN_RECIPIENTS;
  if (hasEmailSettings) {
    lines.push('# ===== EMAIL/SMTP CONFIGURATION =====');
    if (answers.IKYUM_SMTP_HOST) {
      lines.push('# SMTP server settings');
      lines.push(`IKYUM_SMTP_HOST=${answers.IKYUM_SMTP_HOST}`);
    }
    if (answers.IKYUM_SMTP_PORT) {
      lines.push(`IKYUM_SMTP_PORT=${answers.IKYUM_SMTP_PORT}`);
    }
    if (answers.IKYUM_SMTP_USER) {
      lines.push('# SMTP authentication');
      lines.push(`IKYUM_SMTP_USER=${answers.IKYUM_SMTP_USER}`);
    }
    if (answers.IKYUM_SMTP_PASS) {
      lines.push(`IKYUM_SMTP_PASS=${answers.IKYUM_SMTP_PASS}`);
    }
    if (answers.IKYUM_SMTP_FROM) {
      lines.push('# Email "From" address');
      lines.push(`IKYUM_SMTP_FROM=${answers.IKYUM_SMTP_FROM}`);
    }
    if (answers.IKYUM_ADMIN_RECIPIENTS) {
      lines.push('# Admin email addresses (comma-separated)');
      lines.push(`IKYUM_ADMIN_RECIPIENTS=${answers.IKYUM_ADMIN_RECIPIENTS}`);
    }
    if (answers.COPY_TO_ADDRESS) {
      lines.push('# Fallback email for copies');
      lines.push(`COPY_TO_ADDRESS=${answers.COPY_TO_ADDRESS}`);
    }
    lines.push('');
  }
  
  // reCAPTCHA settings
  if (answers.IKYUM_RECAPTCHA_SECRET) {
    lines.push('# ===== GOOGLE reCAPTCHA v3 =====');
    lines.push('# reCAPTCHA secret key for form protection');
    lines.push(`IKYUM_RECAPTCHA_SECRET=${answers.IKYUM_RECAPTCHA_SECRET}`);
    if (answers.IKYUM_RECAPTCHA_MIN_SCORE) {
      lines.push('# Minimum score threshold (0.0-1.0)');
      lines.push(`IKYUM_RECAPTCHA_MIN_SCORE=${answers.IKYUM_RECAPTCHA_MIN_SCORE}`);
    }
    lines.push('');
  }
  
  // Optional settings
  const hasOptionalSettings = answers.IKYUM_BRAND || answers.PORT;
  if (hasOptionalSettings) {
    lines.push('# ===== OPTIONAL CONFIGURATION =====');
    if (answers.IKYUM_BRAND) {
      lines.push('# Brand name used in emails');
      lines.push(`IKYUM_BRAND=${answers.IKYUM_BRAND}`);
    }
    if (answers.PORT) {
      lines.push('# Server port (auto-set by hosting platform)');
      lines.push(`PORT=${answers.PORT}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

// Run the setup
main();
