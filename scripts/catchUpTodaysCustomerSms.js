/**
 * Catch-up SMS for today's customers (Africa/Accra):
 * - login/welcome (fresh magic link + Trenor@{username})
 * - order-received for each order created today
 * - payment receipt for each paid payment today
 * - then retry any still-pending sms_outbox rows from today
 *
 * Usage:
 *   node scripts/catchUpTodaysCustomerSms.js
 *   node scripts/catchUpTodaysCustomerSms.js --dry-run
 */
require('dotenv').config();

const { Op } = require('sequelize');
const {
  Customer,
  User,
  Order,
  Payment,
  SmsOutbox,
  sequelize,
} = require('../models');
const { createWelcomeLoginToken } = require('../services/welcomeLoginTokenService');
const { sendWelcomeSms } = require('../services/customerNotificationService');
const { notifyOrderCreated } = require('../services/orderNotificationService');
const { notifyPaymentReceived } = require('../services/paymentNotificationService');
const { processPendingSms } = require('../services/smsOutboxService');

const dryRun = process.argv.includes('--dry-run');

function getAccraDayBounds(now = new Date()) {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    datePart,
    start: new Date(`${datePart}T00:00:00.000Z`),
    end: new Date(`${datePart}T23:59:59.999Z`),
  };
}

async function loadTodaysCustomers(start, end) {
  const orderCustomerIds = (
    await Order.findAll({
      where: { created_at: { [Op.between]: [start, end] } },
      attributes: ['customer_id'],
      group: ['customer_id'],
      raw: true,
    })
  ).map((r) => r.customer_id);

  return Customer.findAll({
    where: {
      [Op.or]: [
        { created_at: { [Op.between]: [start, end] } },
        orderCustomerIds.length ? { id: { [Op.in]: orderCustomerIds } } : { id: -1 },
      ],
    },
    include: [
      {
        model: User,
        as: 'user',
        required: true,
        attributes: ['id', 'username', 'first_name', 'last_name', 'is_active'],
      },
    ],
    order: [['id', 'ASC']],
  });
}

async function main() {
  const { datePart, start, end } = getAccraDayBounds();
  console.log(
    JSON.stringify(
      {
        event: 'catchup_sms_start',
        date: datePart,
        window: { start: start.toISOString(), end: end.toISOString() },
        dryRun,
      },
      null,
      2
    )
  );

  const customers = await loadTodaysCustomers(start, end);
  const summary = {
    customers: customers.length,
    welcome: { sent: 0, skipped: 0, failed: 0 },
    orders: { sent: 0, skipped: 0, failed: 0 },
    payments: { sent: 0, skipped: 0, failed: 0 },
    outboxRetry: null,
    details: [],
  };

  for (const customer of customers) {
    const detail = {
      customer_id: customer.id,
      username: customer.user?.username,
      phone: customer.phone_number,
      welcome: null,
      orders: [],
      payments: [],
    };

    if (!customer.phone_number) {
      detail.welcome = 'skipped_no_phone';
      summary.welcome.skipped += 1;
      summary.details.push(detail);
      console.warn(`SKIP customer ${customer.id}: no phone`);
      continue;
    }

    // 1) Login / welcome
    try {
      if (dryRun) {
        detail.welcome = 'dry_run';
        summary.welcome.sent += 1;
      } else {
        const token = await createWelcomeLoginToken(customer.user.id);
        await sendWelcomeSms({
          phoneNumber: customer.phone_number,
          username: customer.user.username,
          welcomeToken: token,
          customerId: customer.id,
        });
        detail.welcome = 'sent';
        summary.welcome.sent += 1;
        console.log(`WELCOME customer ${customer.id} (${customer.user.username})`);
      }
    } catch (err) {
      detail.welcome = `failed:${err.message}`;
      summary.welcome.failed += 1;
      console.error(`WELCOME FAIL customer ${customer.id}: ${err.message}`);
    }

    // 2) Orders created today
    const orders = await Order.findAll({
      where: {
        customer_id: customer.id,
        created_at: { [Op.between]: [start, end] },
      },
      order: [['id', 'ASC']],
    });

    for (const order of orders) {
      try {
        if (dryRun) {
          detail.orders.push({ id: order.id, order_number: order.order_number, status: 'dry_run' });
          summary.orders.sent += 1;
        } else {
          const ok = await notifyOrderCreated(order.id, {
            ref: `catchup-order-${order.order_number}-${Date.now()}`,
          });
          if (!ok) {
            detail.orders.push({
              id: order.id,
              order_number: order.order_number,
              status: 'failed',
            });
            summary.orders.failed += 1;
            console.error(`ORDER FAIL ${order.order_number}`);
          } else {
            detail.orders.push({
              id: order.id,
              order_number: order.order_number,
              status: 'sent',
            });
            summary.orders.sent += 1;
            console.log(`ORDER sent ${order.order_number}`);
          }
        }
      } catch (err) {
        detail.orders.push({
          id: order.id,
          order_number: order.order_number,
          status: `failed:${err.message}`,
        });
        summary.orders.failed += 1;
        console.error(`ORDER FAIL ${order.order_number}: ${err.message}`);
      }
    }

    // 3) Paid payments today (on any of this customer's orders)
    const payments = await Payment.findAll({
      where: {
        status: 'paid',
        [Op.or]: [
          { paid_at: { [Op.between]: [start, end] } },
          {
            paid_at: null,
            created_at: { [Op.between]: [start, end] },
          },
        ],
      },
      include: [
        {
          model: Order,
          as: 'order',
          required: true,
          where: { customer_id: customer.id },
          attributes: ['id', 'order_number', 'customer_id'],
        },
      ],
      order: [['id', 'ASC']],
    });

    for (const payment of payments) {
      try {
        if (dryRun) {
          detail.payments.push({
            id: payment.id,
            order_number: payment.order.order_number,
            amount: payment.amount,
            status: 'dry_run',
          });
          summary.payments.sent += 1;
        } else {
          const result = await notifyPaymentReceived(payment.order_id, payment.id);
          detail.payments.push({
            id: payment.id,
            order_number: payment.order.order_number,
            amount: payment.amount,
            status: result.customer ? 'sent' : 'failed_or_skipped',
            staff: result.staff,
          });
          if (result.customer) {
            summary.payments.sent += 1;
            console.log(
              `PAYMENT sent ${payment.order.order_number} #${payment.id} GHS ${payment.amount}`
            );
          } else {
            summary.payments.failed += 1;
            console.error(`PAYMENT FAIL ${payment.order.order_number} #${payment.id}`);
          }
        }
      } catch (err) {
        detail.payments.push({
          id: payment.id,
          order_number: payment.order?.order_number,
          status: `failed:${err.message}`,
        });
        summary.payments.failed += 1;
        console.error(`PAYMENT FAIL #${payment.id}: ${err.message}`);
      }
    }

    summary.details.push(detail);
  }

  // 4) Retry today's pending outbox (including any just enqueued that hit transient errors)
  if (!dryRun) {
    const pendingToday = await SmsOutbox.count({
      where: {
        status: 'pending',
        created_at: { [Op.between]: [start, end] },
      },
    });
    console.log(`Retrying pending outbox rows for today (count≈${pendingToday})…`);
    summary.outboxRetry = await processPendingSms({ limit: 500 });
  }

  console.log(JSON.stringify({ event: 'catchup_sms_done', ...summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
