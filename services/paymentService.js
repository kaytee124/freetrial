const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Customer, Order, Payment, sequelize } = require('../models');
const { AppError } = require('../utils/errors');
const moolreService = require('./moolreService');
const moolreConfig = require('../config/moolre');
const orderService = require('./orderService');
const orderNotificationService = require('./orderNotificationService');
const paymentNotificationService = require('./paymentNotificationService');
const { mapUssdNetworkToChannel } = require('../utils/moolreNetwork');
const { formatMoolrePaymentPayer } = require('../utils/phone');

const POLLING_STATUS_MAP = {
  pending: 'PENDING',
  paid: 'PAID',
  failed: 'FAILED',
};

function generateExternalRef(orderId) {
  return `PAY-${orderId}-${uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function timingSafeEqual(a, b) {
  const strA = String(a);
  const strB = String(b);
  if (strA.length !== strB.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(strA), Buffer.from(strB));
}

function normalizeTxStatus(txstatus) {
  const status = Number(txstatus);
  if (status === 1) return 'paid';
  if (status === 2) return 'failed';
  return 'pending';
}

async function applyMoolreStatus(payment, data, source) {
  const previousStatus = payment.status;
  const txstatus = Number(data.txstatus);
  const now = new Date();

  if (payment.status === 'paid') {
    return { changed: false, previousStatus, newStatus: payment.status };
  }

  if (payment.status === 'failed' && txstatus !== 1) {
    return { changed: false, previousStatus, newStatus: payment.status };
  }

  const newStatus = normalizeTxStatus(txstatus);

  if (newStatus === 'pending') {
    payment.last_checked_at = now;
    payment.metadata = {
      ...payment.metadata,
      last_status_check: { source, data, checked_at: now.toISOString() },
    };
    await payment.save();
    return { changed: false, previousStatus, newStatus: payment.status };
  }

  let orderStatusTransition = null;
  let paymentBecamePaid = false;

  await sequelize.transaction(async (t) => {
    if (data.transactionid) payment.transaction_id = String(data.transactionid);
    if (data.thirdpartyref) payment.thirdparty_ref = String(data.thirdpartyref);
    if (data.payer) payment.payer = String(data.payer);
    if (data.value != null) payment.value = parseFloat(data.value);
    payment.last_checked_at = now;
    payment.metadata = {
      ...payment.metadata,
      [`${source}_payload`]: data,
    };

    if (newStatus === 'paid') {
      payment.status = 'paid';
      payment.paid_at = data.ts ? new Date(data.ts) : now;
      await payment.save({ transaction: t });
      const syncResult = await orderService.syncOrderPaymentStatus(payment.order_id, t);
      paymentBecamePaid = previousStatus !== 'paid';
      orderStatusTransition = {
        orderId: payment.order_id,
        previousStatus: syncResult.previousOrderStatus,
        newStatus: syncResult.order.order_status,
      };
    } else if (newStatus === 'failed') {
      payment.status = 'failed';
      await payment.save({ transaction: t });
    }
  });

  if (paymentBecamePaid) {
    try {
      await paymentNotificationService.notifyPaymentReceived(payment.order_id, payment.id);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'payment_notification_error',
          orderId: payment.order_id,
          paymentId: payment.id,
          error: err.message,
        })
      );
    }
  }

  if (orderStatusTransition && orderStatusTransition.previousStatus !== orderStatusTransition.newStatus) {
    orderNotificationService
      .notifyOrderStatusChange(
        orderStatusTransition.orderId,
        orderStatusTransition.previousStatus,
        orderStatusTransition.newStatus
      )
      .catch((err) => {
        console.error(
          JSON.stringify({
            event: 'order_notification_error',
            orderId: orderStatusTransition.orderId,
            error: err.message,
          })
        );
      });
  }

  await payment.reload();
  return {
    changed: previousStatus !== payment.status,
    previousStatus,
    newStatus: payment.status,
  };
}

async function validateOrderForPayment(order, paymentAmount) {
  if (order.payment_status === 'paid') {
    throw new AppError('ORDER_ALREADY_PAID', 'This order has already been fully paid', 400);
  }

  const remaining = parseFloat(order.total_amount) - parseFloat(order.amount_paid);
  if (remaining <= 0) {
    throw new AppError('NO_AMOUNT_DUE', 'No amount due for this order', 400);
  }

  if (paymentAmount > remaining) {
    throw new AppError(
      'AMOUNT_EXCEEDS_BALANCE',
      `Payment amount (GHS ${paymentAmount.toFixed(2)}) cannot exceed remaining balance (GHS ${remaining.toFixed(2)})`,
      400
    );
  }
}

function parsePaidAt(paidAt) {
  if (paidAt == null || paidAt === '') {
    throw new AppError('MISSING_FIELDS', 'paid_at is required', 400);
  }
  const date = paidAt instanceof Date ? paidAt : new Date(paidAt);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'paid_at must be a valid ISO date or datetime', 400);
  }
  return date;
}

/**
 * Staff records a cash payment against an order.
 */
async function recordCashPayment(staffUser, { order_id, amount, paid_at }) {
  if (!['admin', 'superadmin', 'employee'].includes(staffUser.role)) {
    throw new AppError('INSUFFICIENT_PERMISSIONS', 'Only staff can record cash payments', 403);
  }

  if (!order_id) {
    throw new AppError('MISSING_FIELDS', 'order_id is required', 400);
  }

  const paymentAmount = parseFloat(amount);
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new AppError('VALIDATION_ERROR', 'amount must be a positive number', 400);
  }

  const paidAtDate = parsePaidAt(paid_at);

  const order = await Order.findByPk(order_id);
  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 'Order not found', 404);
  }

  await validateOrderForPayment(order, paymentAmount);

  const externalref = generateExternalRef(order.id);
  const now = new Date();
  let orderStatusTransition = null;
  let payment;

  await sequelize.transaction(async (t) => {
    payment = await Payment.create(
      {
        order_id: order.id,
        externalref,
        amount: paymentAmount,
        status: 'paid',
        payment_method: 'cash',
        provider: null,
        currency: 'GHS',
        value: paymentAmount,
        paid_at: paidAtDate,
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          recorded_by: staffUser.id,
          source: 'staff_cash',
        },
        created_by: staffUser.id,
        updated_by: staffUser.id,
        created_at: now,
        updated_at: now,
      },
      { transaction: t }
    );

    const syncResult = await orderService.syncOrderPaymentStatus(order.id, t);
    orderStatusTransition = {
      orderId: order.id,
      previousStatus: syncResult.previousOrderStatus,
      newStatus: syncResult.order.order_status,
    };
  });

  if (orderStatusTransition && orderStatusTransition.previousStatus !== orderStatusTransition.newStatus) {
    orderNotificationService
      .notifyOrderStatusChange(
        orderStatusTransition.orderId,
        orderStatusTransition.previousStatus,
        orderStatusTransition.newStatus
      )
      .catch((err) => {
        console.error(
          JSON.stringify({
            event: 'order_notification_error',
            orderId: orderStatusTransition.orderId,
            error: err.message,
          })
        );
      });
  }

  try {
    await paymentNotificationService.notifyPaymentReceived(order.id, payment.id);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'payment_notification_error',
        orderId: order.id,
        paymentId: payment.id,
        error: err.message,
      })
    );
  }

  await payment.reload();
  const updatedOrder = await Order.findByPk(order.id);
  const total = parseFloat(updatedOrder.total_amount);
  const amountPaid = parseFloat(updatedOrder.amount_paid);

  return {
    payment: {
      id: payment.id,
      order_id: payment.order_id,
      externalref: payment.externalref,
      amount: String(payment.amount),
      status: payment.status,
      payment_method: payment.payment_method,
      paid_at: payment.paid_at,
      created_by: payment.created_by,
      currency: payment.currency,
    },
    order: {
      id: updatedOrder.id,
      order_number: updatedOrder.order_number,
      total_amount: String(updatedOrder.total_amount),
      amount_paid: String(updatedOrder.amount_paid),
      balance: Math.max(0, total - amountPaid).toFixed(2),
      payment_status: updatedOrder.payment_status,
      order_status: updatedOrder.order_status,
    },
  };
}

async function createMoolreWebPayment({
  order,
  customer,
  paymentAmount,
  payerPhone,
  createdBy,
}) {
  const externalref = generateExternalRef(order.id);

  const payment = await sequelize.transaction(async (t) => {
    return Payment.create(
      {
        order_id: order.id,
        externalref,
        amount: paymentAmount,
        status: 'pending',
        payment_method: 'moolre',
        provider: 'moolre',
        currency: 'GHS',
        payer_phone: payerPhone || null,
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          customer_id: customer.id,
        },
        created_by: createdBy,
      },
      { transaction: t }
    );
  });

  try {
    const response = await moolreService.generatePaymentLink({
      email: moolreConfig.merchantEmail,
      amount: paymentAmount.toFixed(2),
      externalref,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        customer_id: customer.id,
        payment_id: payment.id,
      },
    });

    const paymentData = response.data || {};
    if (!paymentData.authorization_url) {
      payment.status = 'failed';
      payment.metadata = {
        ...payment.metadata,
        moolre_error: response,
        error_message: response.message || 'Failed to initialize payment',
      };
      await payment.save();
      throw new AppError('MOOLRE_ERROR', response.message || 'Failed to initialize payment', 500);
    }

    payment.moolre_reference = paymentData.reference ? String(paymentData.reference) : null;
    payment.metadata = {
      ...payment.metadata,
      moolre_link_response: response,
      authorization_url: paymentData.authorization_url,
    };
    await payment.save();

    return {
      authorization_url: paymentData.authorization_url,
      externalref,
      payment_id: payment.id,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    payment.status = 'failed';
    await payment.save();
    throw new AppError('MOOLRE_ERROR', 'Failed to initialize payment', 500);
  }
}

async function createMoolreUssdPushPayment({
  order,
  customer,
  paymentAmount,
  payerPhone,
  payerMsisdn,
  moolreSessionId,
  network,
  createdBy,
}) {
  const channel = mapUssdNetworkToChannel(network);
  const payer = formatMoolrePaymentPayer(payerMsisdn || payerPhone);
  const externalref = generateExternalRef(order.id);

  const payment = await sequelize.transaction(async (t) => {
    return Payment.create(
      {
        order_id: order.id,
        externalref,
        amount: paymentAmount,
        status: 'pending',
        payment_method: 'ussd',
        provider: 'moolre',
        currency: 'GHS',
        payer_phone: payerPhone || null,
        metadata: {
          order_id: order.id,
          order_number: order.order_number,
          customer_id: customer.id,
          ussd_network: network,
          moolre_channel: channel,
        },
        created_by: createdBy,
      },
      { transaction: t }
    );
  });

  try {
    const response = await moolreService.initiatePayment({
      channel,
      payer,
      amount: paymentAmount.toFixed(2),
      externalref,
      sessionid: moolreSessionId || '',
      reference: order.order_number,
    });

    payment.metadata = {
      ...payment.metadata,
      moolre_initiate_response: response,
    };
    await payment.save();

    return {
      externalref,
      payment_id: payment.id,
      moolre_code: response.code || null,
      moolre_message: response.message || 'Payment request sent',
    };
  } catch (err) {
    payment.status = 'failed';
    payment.metadata = {
      ...payment.metadata,
      moolre_error: err.response || { message: err.message, code: err.code },
      error_message: err.message,
    };
    await payment.save();
    if (err instanceof AppError) throw err;
    throw new AppError('MOOLRE_ERROR', err.message || 'Failed to initialize payment', 500);
  }
}

async function initializePayment(user, orderId, amount) {
  if (user.role !== 'client') {
    throw new AppError('PERMISSION_DENIED', 'Only clients can make payments', 403);
  }

  const customer = await Customer.findOne({ where: { user_id: user.id } });
  if (!customer) throw new AppError('CUSTOMER_NOT_FOUND', 'Customer profile not found', 404);

  const order = await Order.findOne({
    where: { id: orderId, customer_id: customer.id },
  });

  if (!order) {
    throw new AppError(
      'ORDER_NOT_FOUND',
      'Order not found or you do not have permission to pay for this order',
      404
    );
  }

  const paymentAmount = parseFloat(amount);
  await validateOrderForPayment(order, paymentAmount);

  return createMoolreWebPayment({
    order,
    customer,
    paymentAmount,
    createdBy: user.id,
  });
}

async function initializePaymentForUssd(
  phoneNumber,
  orderId,
  amount,
  { moolreSessionId, network, payerMsisdn } = {}
) {
  if (network == null || network === '') {
    throw new AppError('VALIDATION_ERROR', 'network is required for USSD payments', 400);
  }

  const { findCustomerByMsisdn } = require('./ussdService');
  const found = await findCustomerByMsisdn(phoneNumber);
  if (!found) {
    throw new AppError('CUSTOMER_NOT_FOUND', 'Customer not found for this phone number', 404);
  }

  const { customer } = found;
  const order = await Order.findOne({
    where: { id: orderId, customer_id: customer.id },
  });

  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 'Order not found for this customer', 404);
  }

  const paymentAmount = parseFloat(amount);
  await validateOrderForPayment(order, paymentAmount);

  return createMoolreUssdPushPayment({
    order,
    customer,
    paymentAmount,
    payerPhone: found.phoneNumber,
    payerMsisdn: payerMsisdn || phoneNumber,
    moolreSessionId,
    network,
    createdBy: null,
  });
}

async function validateStatusAmount(payment, statusData) {
  if (statusData.amount == null) return;

  const expectedAmount = parseFloat(payment.amount);
  const receivedAmount = parseFloat(statusData.amount);
  if (Math.abs(receivedAmount - expectedAmount) > 0.01) {
    payment.status = 'failed';
    payment.metadata = {
      ...payment.metadata,
      verification_error: 'Amount mismatch',
      expected_amount: String(expectedAmount),
      received_amount: String(receivedAmount),
    };
    await payment.save();
    throw new AppError('VALIDATION_ERROR', 'Payment amount mismatch', 400);
  }
}

async function fetchAndApplyPaymentStatus(payment, source, { idtype = '1', id = null } = {}) {
  const lookupId = id || payment.externalref;
  let response;

  try {
    response = await moolreService.checkTransactionStatus({
      idtype: String(idtype),
      id: lookupId,
    });
  } catch (err) {
    throw new AppError('MOOLRE_ERROR', 'Failed to verify payment status with Moolre', 500);
  }

  const statusData = response?.data || response || {};

  if (Number(statusData.txstatus) === 1) {
    await validateStatusAmount(payment, statusData);
  }

  const result = await applyMoolreStatus(payment, statusData, source);
  await payment.reload();
  return result;
}

async function handleMoolreWebhook(payload) {
  const data = payload?.data;

  if (!data?.secret || !timingSafeEqual(data.secret, moolreConfig.webhookSecret)) {
    throw new AppError('PERMISSION_DENIED', 'Invalid webhook secret', 403);
  }

  if (!data.externalref) {
    throw new AppError('VALIDATION_ERROR', 'Missing externalref in webhook payload', 400);
  }

  const payment = await Payment.findOne({
    where: { externalref: data.externalref },
    include: [{ model: Order, as: 'order' }],
  });

  if (!payment) {
    throw new AppError('NOT_FOUND', 'Payment record not found', 404);
  }

  if (payment.status === 'paid') {
    return { processed: false, status: payment.status };
  }

  await fetchAndApplyPaymentStatus(payment, 'webhook');

  return { processed: true, status: payment.status };
}

async function getPaymentStatus(externalref) {
  const payment = await Payment.findOne({ where: { externalref } });
  if (!payment) {
    throw new AppError('NOT_FOUND', 'Payment not found', 404);
  }

  // Live-check Moolre when still pending so FE poll updates without waiting for webhook.
  if (payment.status === 'pending' && payment.provider === 'moolre') {
    try {
      await reconcilePayment(payment);
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'payment_status_live_reconcile_error',
          paymentId: payment.id,
          externalref: payment.externalref,
          error: err.message,
          code: err.errorCode || err.code,
        })
      );
    }
    await payment.reload();
  }

  const status = POLLING_STATUS_MAP[payment.status] || 'FAILED';
  return { status };
}

async function reconcilePayment(payment) {
  if (payment.status !== 'pending' || payment.provider !== 'moolre') {
    return { skipped: true, reason: 'not_pending' };
  }

  const maxAgeMs = 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(payment.created_at).getTime() > maxAgeMs) {
    payment.status = 'failed';
    payment.metadata = { ...payment.metadata, expired: true };
    payment.last_checked_at = new Date();
    await payment.save();
    console.log(
      JSON.stringify({
        event: 'payment_reconciliation',
        paymentId: payment.id,
        externalref: payment.externalref,
        idtypeUsed: null,
        previousStatus: 'pending',
        newStatus: 'failed',
        reason: 'expired',
      })
    );
    return { expired: true, previousStatus: 'pending', newStatus: 'failed' };
  }

  let response;
  let idtypeUsed = '1';

  try {
    response = await moolreService.checkTransactionStatus({
      idtype: '1',
      id: payment.externalref,
    });
  } catch {
    if (!payment.moolre_reference) {
      payment.last_checked_at = new Date();
      await payment.save();
      return { error: true, idtypeUsed: '1' };
    }
    idtypeUsed = '2';
    try {
      response = await moolreService.checkTransactionStatus({
        idtype: '2',
        id: payment.moolre_reference,
      });
    } catch {
      payment.last_checked_at = new Date();
      await payment.save();
      return { error: true, idtypeUsed: '2' };
    }
  }

  const statusData = response?.data || response || {};

  if (Number(statusData.txstatus) === 1) {
    await validateStatusAmount(payment, statusData);
  }

  const result = await applyMoolreStatus(payment, statusData, 'reconciliation');

  console.log(
    JSON.stringify({
      event: 'payment_reconciliation',
      paymentId: payment.id,
      externalref: payment.externalref,
      idtypeUsed,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
    })
  );

  return { ...result, idtypeUsed };
}

async function reconcilePendingPayments() {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const pending = await Payment.findAll({
    where: {
      status: 'pending',
      provider: 'moolre',
      created_at: { [Op.lt]: twoMinutesAgo },
    },
  });

  for (const payment of pending) {
    await reconcilePayment(payment);
  }
}

module.exports = {
  initializePayment,
  initializePaymentForUssd,
  recordCashPayment,
  handleMoolreWebhook,
  getPaymentStatus,
  fetchAndApplyPaymentStatus,
  applyMoolreStatus,
  reconcilePayment,
  reconcilePendingPayments,
  generateExternalRef,
};
