#!/usr/bin/env node
/**
 * Reconcile pending Moolre payments (web MoMo + USSD) via the Payment Status API.
 * Same logic as the in-process 2-minute worker — use as a manual run or hourly system cron backup.
 *
 * Usage: node scripts/reconcilePendingPayments.js
 */
require('dotenv').config();

const { Op } = require('sequelize');
const { Payment, sequelize } = require('../models');
const { reconcilePendingPayments } = require('../services/paymentService');

async function main() {
  await sequelize.authenticate();

  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const beforePending = await Payment.count({
    where: {
      status: 'pending',
      provider: 'moolre',
      created_at: { [Op.lt]: twoMinutesAgo },
    },
  });

  await reconcilePendingPayments();

  const afterPending = await Payment.count({
    where: {
      status: 'pending',
      provider: 'moolre',
      created_at: { [Op.lt]: twoMinutesAgo },
    },
  });

  console.log(
    JSON.stringify({
      event: 'reconcile_pending_payments_done',
      eligibleBefore: beforePending,
      stillPendingEligible: afterPending,
      resolvedOrExpired: beforePending - afterPending,
    })
  );

  await sequelize.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
