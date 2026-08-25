const { Op } = require('sequelize');
const { User, Customer } = require('../models');
const { AppError } = require('../utils/errors');
const { isValidGhanaPhone, formatSmsRecipient } = require('../utils/phone');
const { enqueueSms } = require('./smsOutboxService');

const MAX_MESSAGE_LENGTH = 480;
const MAX_RECIPIENTS = 500;
const PLACEHOLDER_RE = /\{\{\s*(first_name|last_name|username)\s*\}\}/gi;

function applyPlaceholders(template, user) {
  return String(template).replace(PLACEHOLDER_RE, (_match, key) => {
    const value = user?.[key];
    return value != null ? String(value) : '';
  });
}

function normalizeUserIds(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new AppError('VALIDATION_ERROR', 'user_ids must be an array of integers', 400);
  }
  const ids = [];
  for (const value of raw) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new AppError('VALIDATION_ERROR', 'user_ids must contain positive integers only', 400);
    }
    ids.push(n);
  }
  return [...new Set(ids)];
}

/**
 * Send personalized SMS to selected clients or all active clients.
 * @param {{ message: string, user_ids?: number[], all_active?: boolean }} body
 * @param {{ id: number }} actor
 */
async function broadcastToClients(body, actor) {
  const message = String(body?.message ?? '').trim();
  if (!message) {
    throw new AppError('VALIDATION_ERROR', 'message is required', 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `message must be at most ${MAX_MESSAGE_LENGTH} characters`,
      400
    );
  }

  const allActive = Boolean(body?.all_active);
  const userIds = normalizeUserIds(body?.user_ids);

  if (!allActive && userIds.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Provide user_ids or set all_active to true',
      400
    );
  }

  const where = {
    role: 'client',
    is_active: true,
  };
  if (!allActive) {
    where.id = { [Op.in]: userIds };
  }

  const users = await User.findAll({
    where,
    attributes: ['id', 'username', 'first_name', 'last_name', 'role', 'is_active'],
    include: [
      {
        model: Customer,
        as: 'customer_profile',
        required: false,
        attributes: ['id', 'phone_number', 'phone_needs_correction'],
      },
    ],
    order: [['id', 'ASC']],
  });

  const requested = allActive ? users.length : userIds.length;
  if (users.length > MAX_RECIPIENTS) {
    throw new AppError(
      'VALIDATION_ERROR',
      `At most ${MAX_RECIPIENTS} recipients per request`,
      400
    );
  }

  const skips = [];
  if (!allActive) {
    const found = new Set(users.map((u) => u.id));
    for (const id of userIds) {
      if (!found.has(id)) {
        skips.push({ user_id: id, reason: 'not_found_or_not_client' });
      }
    }
  }

  const stamp = Date.now();
  const seenPhones = new Set();
  const targets = [];

  for (const user of users) {
    const customer = user.customer_profile;
    if (!customer) {
      skips.push({ user_id: user.id, reason: 'no_customer_profile' });
      continue;
    }
    const phone = String(customer.phone_number || '').trim();
    if (!phone) {
      skips.push({ user_id: user.id, reason: 'no_phone' });
      continue;
    }
    if (customer.phone_needs_correction) {
      skips.push({ user_id: user.id, reason: 'phone_needs_correction' });
      continue;
    }
    if (!isValidGhanaPhone(phone)) {
      skips.push({ user_id: user.id, reason: 'invalid_phone' });
      continue;
    }

    let recipient;
    try {
      recipient = formatSmsRecipient(phone);
    } catch {
      skips.push({ user_id: user.id, reason: 'invalid_phone' });
      continue;
    }

    if (seenPhones.has(recipient)) {
      skips.push({ user_id: user.id, reason: 'duplicate_phone' });
      continue;
    }
    seenPhones.add(recipient);

    targets.push({
      user,
      customer,
      recipient,
      body: applyPlaceholders(message, user),
    });
  }

  let sent = 0;
  let pending = 0;
  let failedPermanent = 0;

  for (const target of targets) {
    try {
      const result = await enqueueSms({
        recipient: target.recipient,
        message: target.body,
        ref: `bcast-${actor.id}-${stamp}-${target.customer.id}`,
        purpose: 'staff_client_broadcast',
        relatedType: 'customer',
        relatedId: target.customer.id,
      });
      if (result?.ok) sent += 1;
      else if (result?.permanent) failedPermanent += 1;
      else pending += 1;
    } catch (err) {
      pending += 1;
      console.error(
        JSON.stringify({
          event: 'staff_broadcast_sms_enqueue_failed',
          userId: target.user.id,
          customerId: target.customer.id,
          error: err.message,
        })
      );
    }
  }

  return {
    requested,
    targeted: targets.length,
    sent,
    pending,
    skipped: skips.length,
    failed_permanent: failedPermanent,
    skips,
  };
}

module.exports = {
  broadcastToClients,
  applyPlaceholders,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS,
};
