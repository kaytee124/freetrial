const { Op } = require('sequelize');
const { User, Customer, Order } = require('../models');
const { hashPassword } = require('../services/authService');
const { buildDefaultPassword } = require('../utils/passwords');
const { getMsisdnLookupVariants } = require('../utils/phone');
const { createWelcomeLoginToken } = require('../services/welcomeLoginTokenService');
const { notifyWelcomeSms } = require('../services/customerNotificationService');

const POSTMAN_PHONE = '0502412618';
const POSTMAN_USERNAME = 'postman_client';
const POSTMAN_ORDER_ID = 2;
const POSTMAN_ORDER_NUMBER = 'ORD-7923695F';

async function findCustomerByPhone(phone) {
  const variants = getMsisdnLookupVariants(phone);
  return Customer.findOne({
    where: {
      [Op.or]: [
        { phone_number: { [Op.in]: variants } },
        { whatsapp_number: { [Op.in]: variants } },
      ],
    },
  });
}

async function ensurePostmanCustomer() {
  let customer = await findCustomerByPhone(POSTMAN_PHONE);
  let created = false;

  if (!customer) {
    const password = buildDefaultPassword(POSTMAN_USERNAME);
    const password_hash = await hashPassword(password);
    const user = await User.create({
      username: POSTMAN_USERNAME,
      password_hash,
      first_name: 'Postman',
      last_name: 'Client',
      role: 'client',
      is_active: true,
      is_staff: false,
      is_superuser: false,
      date_joined: new Date(),
      updated_at: new Date(),
    });

    customer = await Customer.create({
      user_id: user.id,
      phone_number: POSTMAN_PHONE,
      whatsapp_number: POSTMAN_PHONE,
      phone_needs_correction: false,
      address: 'Postman test address',
      preferred_contact_method: 'phone',
      notes: 'Seeded for Postman payment flow testing',
      created_at: new Date(),
      updated_at: new Date(),
    });

    created = true;
    console.log(
      `Postman seed: created customer (phone ${POSTMAN_PHONE}, user ${POSTMAN_USERNAME}, password Trenor@${POSTMAN_USERNAME}).`
    );

    const welcomeToken = await createWelcomeLoginToken(user.id);
    notifyWelcomeSms({
      phoneNumber: POSTMAN_PHONE,
      username: POSTMAN_USERNAME,
      welcomeToken,
      customerId: customer.id,
    });
  } else {
    console.log(`Postman seed: customer already exists (phone ${POSTMAN_PHONE}, customer_id ${customer.id}).`);
  }

  let order = await Order.findByPk(POSTMAN_ORDER_ID);
  if (!order) {
    order = await Order.findOne({ where: { order_number: POSTMAN_ORDER_NUMBER } });
  }

  if (!order) {
    console.warn(
      `Postman seed: order id ${POSTMAN_ORDER_ID} / ${POSTMAN_ORDER_NUMBER} not found — create the order manually before testing payments.`
    );
    return { customer, order: null, created };
  }

  const updates = {};
  if (order.customer_id !== customer.id) {
    updates.customer_id = customer.id;
  }
  if (order.order_number !== POSTMAN_ORDER_NUMBER) {
    updates.order_number = POSTMAN_ORDER_NUMBER;
  }
  if (parseFloat(order.total_amount) < 0.5) {
    updates.total_amount = 10;
  }
  if (order.payment_status === 'paid') {
    updates.payment_status = 'pending';
    updates.amount_paid = 0;
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date();
    await order.update(updates);
    console.log(`Postman seed: updated order ${order.id} for Postman testing.`);
  } else {
    console.log(`Postman seed: order ${order.id} (${order.order_number}) ready for customer ${customer.id}.`);
  }

  return { customer, order: await order.reload(), created };
}

module.exports = {
  ensurePostmanCustomer,
  POSTMAN_PHONE,
  POSTMAN_USERNAME,
  POSTMAN_ORDER_ID,
  POSTMAN_ORDER_NUMBER,
  /** @deprecated Use buildDefaultPassword(POSTMAN_USERNAME) */
  get POSTMAN_PASSWORD() {
    return buildDefaultPassword(POSTMAN_USERNAME);
  },
};
