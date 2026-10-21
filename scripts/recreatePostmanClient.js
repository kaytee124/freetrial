/**
 * Delete Postman / 0502412618 clients and recreate postman_client with
 * Trenor@postman_client + welcome magic-link SMS.
 *
 * Usage: node scripts/recreatePostmanClient.js
 */
require('dotenv').config();

const { Op } = require('sequelize');
const {
  User,
  Customer,
  Order,
  RefreshToken,
  WelcomeLoginToken,
  sequelize,
} = require('../models');
const { hashPassword } = require('../services/authService');
const { buildDefaultPassword } = require('../utils/passwords');
const { normalizeMsisdn, getMsisdnLookupVariants } = require('../utils/phone');
const { sendWelcomeSms } = require('../services/customerNotificationService');
const { createWelcomeLoginToken } = require('../services/welcomeLoginTokenService');
const { ensurePostmanCustomer, POSTMAN_PHONE, POSTMAN_USERNAME } = require('../lib/seedPostmanCustomer');

const EXTRA_USERNAMES = ['client_0502412618'];

async function findCustomersByPhone(phone) {
  const variants = getMsisdnLookupVariants(phone);
  return Customer.findAll({
    where: {
      [Op.or]: [
        { phone_number: { [Op.in]: variants } },
        { whatsapp_number: { [Op.in]: variants } },
      ],
    },
  });
}

async function purgeUser(userId, transaction) {
  await WelcomeLoginToken.destroy({ where: { user_id: userId }, transaction });
  await RefreshToken.destroy({ where: { user_id: userId }, transaction });
  await Customer.destroy({ where: { user_id: userId }, transaction });
  await User.destroy({ where: { id: userId }, transaction });
}

async function main() {
  const phone = normalizeMsisdn(POSTMAN_PHONE);
  const password = buildDefaultPassword(POSTMAN_USERNAME);
  const now = new Date();

  const phoneCustomers = await findCustomersByPhone(phone);
  const usersToRemove = new Map();

  for (const customer of phoneCustomers) {
    usersToRemove.set(customer.user_id, true);
  }

  for (const username of [POSTMAN_USERNAME, ...EXTRA_USERNAMES]) {
    const user = await User.findOne({ where: { username } });
    if (user) usersToRemove.set(user.id, true);
  }

  const oldUserIds = [...usersToRemove.keys()];
  const oldCustomerIds = (
    await Customer.findAll({
      where: { user_id: { [Op.in]: oldUserIds.length ? oldUserIds : [0] } },
      attributes: ['id'],
    })
  ).map((c) => c.id);

  const orderIds =
    oldCustomerIds.length > 0
      ? (
          await Order.findAll({
            where: { customer_id: { [Op.in]: oldCustomerIds } },
            attributes: ['id'],
          })
        ).map((o) => o.id)
      : [];

  console.log(
    JSON.stringify({
      event: 'recreate_postman_client_cleanup',
      phone,
      oldUserIds,
      oldCustomerIds,
      orderIds,
    })
  );

  let newUser;
  let newCustomer;

  await sequelize.transaction(async (t) => {
    // Free unique phone/username so we can create the new account, then purge olds.
    for (const customer of phoneCustomers) {
      const freed = `09${String(customer.id).padStart(8, '0')}`.slice(0, 10);
      await customer.update(
        { phone_number: freed, whatsapp_number: freed, updated_at: now },
        { transaction: t }
      );
    }

    for (const userId of oldUserIds) {
      const user = await User.findByPk(userId, { transaction: t });
      if (!user) continue;
      await user.update(
        { username: `deleted_${user.id}_${Date.now()}`, updated_at: now },
        { transaction: t }
      );
    }

    const password_hash = await hashPassword(password);
    newUser = await User.create(
      {
        username: POSTMAN_USERNAME,
        password_hash,
        first_name: 'Postman',
        last_name: 'Client',
        role: 'client',
        is_active: true,
        is_staff: false,
        is_superuser: false,
        date_joined: now,
        updated_at: now,
      },
      { transaction: t }
    );

    newCustomer = await Customer.create(
      {
        user_id: newUser.id,
        phone_number: phone,
        whatsapp_number: phone,
        phone_needs_correction: false,
        address: 'Postman test address',
        preferred_contact_method: 'phone',
        notes: 'Recreated with Trenor@ default password + welcome SMS',
        created_at: now,
        updated_at: now,
      },
      { transaction: t }
    );

    if (orderIds.length) {
      await Order.update(
        { customer_id: newCustomer.id, updated_at: now },
        { where: { id: { [Op.in]: orderIds } }, transaction: t }
      );
    }

    for (const userId of oldUserIds) {
      await purgeUser(userId, t);
    }
  });

  const welcomeToken = await createWelcomeLoginToken(newUser.id);
  await sendWelcomeSms({
    phoneNumber: phone,
    username: POSTMAN_USERNAME,
    welcomeToken,
    customerId: newCustomer.id,
  });

  await ensurePostmanCustomer();

  console.log(
    JSON.stringify(
      {
        event: 'recreate_postman_client_done',
        username: POSTMAN_USERNAME,
        password,
        phone,
        customer_id: newCustomer.id,
        user_id: newUser.id,
        welcome_sms: 'enqueued',
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
    await new Promise((r) => setTimeout(r, 2500));
    await sequelize.close();
  });
