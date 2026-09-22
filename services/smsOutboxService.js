const { Op } = require('sequelize');
const { SmsOutbox, Customer } = require('../models');
const moolreService = require('./moolreService');
const moolreConfig = require('../config/moolre');
const { formatSmsRecipient } = require('../utils/phone');

/** Due reminders + in-progress SMS are disabled; never retry these outbox rows. */
const OBSOLETE_SMS_PURPOSES = [
  'order_due_1h',
  'order_due_24h',
  'order_due_48h',
  'order_due_1h_staff',
  'order_due_24h_staff',
  'order_due_48h_staff',
  'order_in_progress',
];

/** Payment receipt SMS uses MOOLRE_SMS_SENDER_ID_2 (KolendoPay). */
const PAYMENT_SMS_PURPOSES = ['payment_received', 'payment_received_staff'];

const OBSOLETE_PURPOSE_ERROR = 'obsolete_purpose_disabled';

const PERMANENT_PHONE_PATTERNS = [
  /invalid\s*phone/i,
  /phone\s*number\s*(is\s*)?(invalid|does\s*not\s*exist|doesn't\s*exist)/i,
  /does\s*not\s*exist/i,
  /doesn't\s*exist/i,
  /unknown\s*subscriber/i,
  /number\s*(not|is\s*not)\s*(valid|found|exist)/i,
  /invalid\s*(msisdn|recipient|number)/i,
];

function isPermanentPhoneError(err) {
  const message = String(err?.message || '');
  const code = String(err?.code ?? '');
  const haystack = `${message} ${code}`;
  return PERMANENT_PHONE_PATTERNS.some((re) => re.test(haystack));
}

function senderIdForPurpose(purpose) {
  if (PAYMENT_SMS_PURPOSES.includes(purpose)) {
    return moolreConfig.smsSenderId2;
  }
  return moolreConfig.smsSenderId;
}

async function markCustomerPhoneNeedsCorrection(relatedType, relatedId) {
  if (relatedType !== 'customer' || !relatedId) return;
  await Customer.update(
    { phone_needs_correction: true, updated_at: new Date() },
    { where: { id: relatedId } }
  );
}

/**
 * Attempt to send one outbox row. Updates status in place.
 * @param {import('../models/SmsOutbox')} row
 */
async function attemptSend(row) {
  const now = new Date();
  row.attempts = (row.attempts || 0) + 1;
  row.last_attempt_at = now;

  try {
    await moolreService.sendSms({
      recipient: row.recipient,
      message: row.message,
      ref: row.ref || undefined,
      senderId: senderIdForPurpose(row.purpose),
    });
    row.status = 'sent';
    row.sent_at = now;
    row.last_error = null;
    await row.save();
    return { ok: true, row };
  } catch (err) {
    row.last_error = err.message || String(err);
    if (isPermanentPhoneError(err)) {
      row.status = 'failed_permanent';
      await row.save();
      await markCustomerPhoneNeedsCorrection(row.related_type, row.related_id);
      console.error(
        JSON.stringify({
          event: 'sms_outbox_permanent_failure',
          id: row.id,
          purpose: row.purpose,
          error: err.message,
          code: err.code,
        })
      );
      return { ok: false, permanent: true, row };
    }

    row.status = 'pending';
    await row.save();
    console.error(
      JSON.stringify({
        event: 'sms_outbox_transient_failure',
        id: row.id,
        purpose: row.purpose,
        error: err.message,
        code: err.code,
      })
    );
    return { ok: false, permanent: false, row };
  }
}

/**
 * Insert outbox row and try send immediately.
 * @param {{
 *   recipient: string,
 *   message: string,
 *   ref?: string,
 *   purpose: string,
 *   relatedType?: string|null,
 *   relatedId?: number|string|null,
 * }} payload
 */
async function enqueueSms({ recipient, message, ref, purpose, relatedType = null, relatedId = null }) {
  const formattedRecipient = formatSmsRecipient(recipient);
  const row = await SmsOutbox.create({
    recipient: formattedRecipient,
    message,
    ref: ref || null,
    purpose,
    related_type: relatedType || null,
    related_id: relatedId != null ? relatedId : null,
    status: 'pending',
    attempts: 0,
    created_at: new Date(),
  });

  return attemptSend(row);
}

/**
 * Mark pending rows for disabled purposes as failed_permanent so retries never send them.
 * @returns {Promise<number>} rows cancelled
 */
async function cancelObsoletePendingSms() {
  const [cancelled] = await SmsOutbox.update(
    {
      status: 'failed_permanent',
      last_error: OBSOLETE_PURPOSE_ERROR,
      last_attempt_at: new Date(),
    },
    {
      where: {
        status: 'pending',
        purpose: { [Op.in]: OBSOLETE_SMS_PURPOSES },
      },
    }
  );
  if (cancelled > 0) {
    console.log(
      JSON.stringify({
        event: 'sms_outbox_obsolete_cancelled',
        cancelled,
        purposes: OBSOLETE_SMS_PURPOSES,
      })
    );
  }
  return cancelled;
}

async function processPendingSms({ limit = 100 } = {}) {
  const cancelledObsolete = await cancelObsoletePendingSms();

  const rows = await SmsOutbox.findAll({
    where: {
      status: 'pending',
      purpose: { [Op.notIn]: OBSOLETE_SMS_PURPOSES },
    },
    order: [['id', 'ASC']],
    limit,
  });

  let sent = 0;
  let permanent = 0;
  let stillPending = 0;

  for (const row of rows) {
    const result = await attemptSend(row);
    if (result.ok) sent += 1;
    else if (result.permanent) permanent += 1;
    else stillPending += 1;
  }

  return {
    processed: rows.length,
    sent,
    permanent,
    stillPending,
    cancelledObsolete,
  };
}

module.exports = {
  isPermanentPhoneError,
  OBSOLETE_SMS_PURPOSES,
  OBSOLETE_PURPOSE_ERROR,
  PAYMENT_SMS_PURPOSES,
  senderIdForPurpose,
  enqueueSms,
  attemptSend,
  cancelObsoletePendingSms,
  processPendingSms,
};
