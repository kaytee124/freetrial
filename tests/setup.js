/**
 * Prerequisite: CREATE DATABASE IF NOT EXISTS laundry_management_system_test;
 * Then run: npm run db:migrate:test
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.MOOLRE_API_USER = process.env.MOOLRE_API_USER || 'test-moolre-user';
process.env.MOOLRE_API_PUBKEY = process.env.MOOLRE_API_PUBKEY || 'test-moolre-pubkey';
process.env.MOOLRE_ACCOUNT_NUMBER = process.env.MOOLRE_ACCOUNT_NUMBER || '0000000000';
process.env.MOOLRE_WEBHOOK_URL =
  process.env.MOOLRE_WEBHOOK_URL || 'http://localhost:3000/api/payments/moolre/webhook/';
delete process.env.MOOLRE_REDIRECT_URL;
process.env.MOOLRE_WEBHOOK_SECRET = process.env.MOOLRE_WEBHOOK_SECRET || 'test-webhook-secret';
process.env.MOOLRE_SMS_VAS_KEY = process.env.MOOLRE_SMS_VAS_KEY || 'test-sms-vas-key';
process.env.MOOLRE_SMS_SENDER_ID = process.env.MOOLRE_SMS_SENDER_ID || 'TESTSENDER';
process.env.MOOLRE_SMS_SENDER_ID_2 = process.env.MOOLRE_SMS_SENDER_ID_2 || 'KolendoPay';
process.env.MOOLRE_API_BASE = process.env.MOOLRE_API_BASE || 'https://api.moolre.com';
process.env.MOOLRE_MERCHANT_EMAIL = process.env.MOOLRE_MERCHANT_EMAIL || 'test@example.com';
process.env.MOOLRE_PATH_EMBED_LINK = process.env.MOOLRE_PATH_EMBED_LINK || '/embed/link';
process.env.MOOLRE_PATH_TRANSACT_STATUS =
  process.env.MOOLRE_PATH_TRANSACT_STATUS || '/open/transact/status';
process.env.MOOLRE_PATH_TRANSACT_PAYMENT =
  process.env.MOOLRE_PATH_TRANSACT_PAYMENT || '/open/transact/payment';
process.env.MOOLRE_PATH_SMS_SEND = process.env.MOOLRE_PATH_SMS_SEND || '/open/sms/send';
process.env.CUSTOMER_APP_URL =
  process.env.CUSTOMER_APP_URL || 'https://laundry.bafrow-health.org';
process.env.WELCOME_LOGIN_RATE_LIMIT_MAX = process.env.WELCOME_LOGIN_RATE_LIMIT_MAX || '20';
process.env.WELCOME_LOGIN_RATE_LIMIT_WINDOW_MS =
  process.env.WELCOME_LOGIN_RATE_LIMIT_WINDOW_MS || '900000';


const { sequelize } = require('../models');
const { truncateAll, closeDb } = require('./helpers/db');
const { seedBaseline } = require('./helpers/seed');
const { seedAddonCatalogDefaults } = require('../lib/seedAddonCatalog');
const { printSecurityNotes } = require('./reportSummary');

beforeAll(async () => {
  await sequelize.authenticate();
  await truncateAll();
  global.testContext = await seedBaseline();
  await seedAddonCatalogDefaults();
});

afterAll(async () => {
  printSecurityNotes();
  await closeDb();
});
