/**
 * Capture Helen (username Fafa), truncate all app data except `services`,
 * recreate Fafa as superadmin, send staff credential SMS.
 *
 * Usage: node scripts/prodResetKeepServicesAndSeedHelen.js
 *
 * WARNING: Destructive. Deletes all rows except services.
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { User, Customer, Service, SmsOutbox, sequelize } = require('../models');
const { createSuperadmin } = require('../services/userService');
const { assertValidGhanaPhone, normalizeValidGhanaPhone } = require('../utils/phone');

const USERNAME_CANDIDATES = ['Fafa', 'fafa'];

const TABLES_TO_TRUNCATE = [
  'ussd_sessions',
  'welcome_login_tokens',
  'sms_outbox',
  'order_status_history',
  'refresh_tokens',
  'payments',
  'order_items',
  'order_services',
  'orders',
  'customers',
  'users',
];

async function findFafaUser() {
  for (const username of USERNAME_CANDIDATES) {
    const user = await User.findOne({
      where: { username },
      include: [{ model: Customer, as: 'customer_profile' }],
    });
    if (user) return user;
  }

  const byName = await User.findOne({
    where: {
      [Op.or]: [
        { first_name: { [Op.like]: '%Helen%' } },
        { last_name: { [Op.like]: '%Helen%' } },
      ],
    },
    include: [{ model: Customer, as: 'customer_profile' }],
  });
  return byName;
}

async function truncateAllExceptServices() {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES_TO_TRUNCATE) {
    await sequelize.query(`TRUNCATE TABLE \`${table}\``);
  }
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
}

async function main() {
  await sequelize.authenticate();

  const servicesBefore = await Service.count();
  const existing = await findFafaUser();
  if (!existing) {
    throw new Error('Could not find user Fafa / Helen before wipe — aborting (no wipe performed).');
  }

  const profile = existing.customer_profile;
  const rawPhone = profile?.phone_number || existing.phone_number;
  if (!rawPhone) {
    throw new Error(
      `User ${existing.username} (id ${existing.id}) has no phone_number on user or customer — aborting.`
    );
  }

  assertValidGhanaPhone(rawPhone, 'phone_number');
  const phone = normalizeValidGhanaPhone(rawPhone, 'phone_number');
  const username = 'Fafa';
  const first_name = existing.first_name || 'Helen';
  const last_name = existing.last_name || '';

  console.log(
    JSON.stringify({
      event: 'prod_reset_capture',
      source_user_id: existing.id,
      source_username: existing.username,
      first_name,
      last_name,
      phone,
      services_before: servicesBefore,
    })
  );

  await truncateAllExceptServices();

  const servicesAfter = await Service.count();
  if (servicesAfter !== servicesBefore) {
    throw new Error(
      `Services count changed during wipe (${servicesBefore} -> ${servicesAfter}) — unexpected.`
    );
  }

  const user = await createSuperadmin({
    username,
    first_name,
    last_name,
    phone_number: phone,
  });

  // Allow async SMS enqueue to settle
  await new Promise((r) => setTimeout(r, 2500));

  const smsRows = await SmsOutbox.findAll({
    where: { purpose: 'staff_credentials' },
    order: [['id', 'DESC']],
    limit: 3,
    attributes: ['id', 'recipient', 'status', 'purpose', 'related_id', 'attempts', 'last_error'],
  });

  console.log(
    JSON.stringify(
      {
        event: 'prod_reset_done',
        username: user.username,
        password_formula: 'Trenor@{username}',
        phone,
        role: user.role,
        user_id: user.id,
        services_count: servicesAfter,
        sms_outbox: smsRows.map((r) => r.toJSON()),
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
