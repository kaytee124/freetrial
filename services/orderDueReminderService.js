const { Op } = require('sequelize');
const {
  Order,
  Customer,
  User,
} = require('../models');
const { formatSmsRecipient } = require('../utils/phone');
const { enqueueSms } = require('./smsOutboxService');

/** Africa/Accra is UTC+0 year-round — treat delivery_date/time as Accra local. */
function computeDueAt(deliveryDate, deliveryTime) {
  if (!deliveryDate) return null;
  const dateStr = String(deliveryDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

  let timeStr = '09:00:00';
  if (deliveryTime != null && String(deliveryTime).trim() !== '') {
    const raw = String(deliveryTime).trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const hh = String(match[1]).padStart(2, '0');
      const mm = String(match[2]).padStart(2, '0');
      const ss = String(match[3] || '00').padStart(2, '0');
      timeStr = `${hh}:${mm}:${ss}`;
    }
  }

  const due = new Date(`${dateStr}T${timeStr}+00:00`);
  if (Number.isNaN(due.getTime())) return null;
  return due;
}

function formatDueDisplay(dueAt) {
  const datePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dueAt);
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Accra',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dueAt);
  return `${datePart} ${timePart}`;
}

function buildCustomerDueMessage(orderNumber, dueLabel, kind) {
  const when = kind === '1h' ? 'in about 1 hour' : 'in about 48 hours';
  return (
    `Bubblebytes: Reminder — order ${orderNumber} is due ${when} ` +
    `(${dueLabel} Accra). Please be ready for pickup/delivery.`
  );
}

function buildStaffDueMessage(orderNumber, customerName, dueLabel, kind) {
  const when = kind === '1h' ? '1 hour' : '48 hours';
  const who = customerName ? ` for ${customerName}` : '';
  return (
    `Bubblebytes: Order ${orderNumber}${who} is due in ${when} ` +
    `(${dueLabel} Accra). Please prepare.`
  );
}

async function resolveCustomerName(order) {
  const user = order.customer?.user;
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || null;
}

async function listAdminRecipients() {
  return User.findAll({
    where: {
      role: 'admin',
      is_active: true,
      phone_number: { [Op.ne]: null },
    },
    attributes: ['id', 'phone_number'],
  });
}

async function listSuperadminRecipients() {
  return User.findAll({
    where: {
      role: 'superadmin',
      is_active: true,
      phone_number: { [Op.ne]: null },
    },
    attributes: ['id', 'phone_number'],
  });
}

async function enqueueUniqueSms({ recipient, message, ref, purpose, relatedType, relatedId }) {
  try {
    await enqueueSms({
      recipient: formatSmsRecipient(recipient),
      message,
      ref,
      purpose,
      relatedType,
      relatedId,
    });
    return true;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'due_reminder_sms_failed',
        purpose,
        relatedType,
        relatedId,
        error: err.message,
      })
    );
    return false;
  }
}

async function sendDueReminderSms(order, kind) {
  const dueAt = computeDueAt(order.delivery_date, order.delivery_time);
  if (!dueAt) return { sent: 0 };
  const dueLabel = formatDueDisplay(dueAt);
  const customerName = await resolveCustomerName(order);
  let sent = 0;

  if (order.customer?.phone_number) {
    const ok = await enqueueUniqueSms({
      recipient: order.customer.phone_number,
      message: buildCustomerDueMessage(order.order_number, dueLabel, kind),
      ref: `${order.order_number}-DUE-${kind}-C`,
      purpose: kind === '1h' ? 'order_due_1h' : 'order_due_48h',
      relatedType: 'customer',
      relatedId: order.customer.id,
    });
    if (ok) sent += 1;
  }

  // Order ops SMS: admins + superadmins (not employees). Payment SMS is superadmin-only elsewhere.
  const staffMsg = buildStaffDueMessage(order.order_number, customerName, dueLabel, kind);
  const admins = await listAdminRecipients();
  const superadmins = await listSuperadminRecipients();
  const seen = new Set();

  for (const user of [...admins, ...superadmins]) {
    const phone = String(user.phone_number || '').trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const ok = await enqueueUniqueSms({
      recipient: phone,
      message: staffMsg,
      ref: `${order.order_number}-DUE-${kind}-U${user.id}`,
      purpose: kind === '1h' ? 'order_due_1h_staff' : 'order_due_48h_staff',
      relatedType: 'user',
      relatedId: user.id,
    });
    if (ok) sent += 1;
  }

  return { sent };
}

/**
 * Due-reminder SMS is disabled (customers found reminder volume too high).
 * Job still runs; this is a no-op so no SMS is sent.
 */
async function processDueReminders(_now = new Date()) {
  return { scanned: 0, reminded48h: 0, reminded1h: 0 };
}

module.exports = {
  computeDueAt,
  processDueReminders,
  sendDueReminderSms,
  buildCustomerDueMessage,
  buildStaffDueMessage,
};
