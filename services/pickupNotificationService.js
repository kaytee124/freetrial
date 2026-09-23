const { Op, literal } = require('sequelize');
const { Order, Customer, User } = require('../models');
const { parsePagination, paginatedResponse } = require('../utils/pagination');

function accraTodayDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra' }).format(new Date());
}

function accraDateOffset(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function formatTime(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (/^\d{2}:\d{2}/.test(s)) return s.length >= 8 ? s.slice(0, 8) : `${s}:00`.slice(0, 8);
  return s;
}

function pickupWhere(today) {
  const horizon = accraDateOffset(today, 2);
  return {
    delivery_date: { [Op.ne]: null, [Op.lte]: horizon },
    picked_up: false,
    order_status: { [Op.ne]: 'cancelled' },
  };
}

function pickupOrder(today) {
  return [
    [
      literal(
        `CASE WHEN delivery_date < '${today}' THEN 0 WHEN delivery_date = '${today}' THEN 1 ELSE 2 END`
      ),
      'ASC',
    ],
    ['delivery_date', 'ASC'],
    ['delivery_time', 'ASC'],
    ['id', 'ASC'],
  ];
}

const PICKUP_INCLUDES = [
  {
    model: Customer,
    as: 'customer',
    attributes: ['id', 'phone_number'],
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'username', 'first_name', 'last_name'],
        required: false,
      },
    ],
  },
];

function formatPickupNotification(order, today) {
  const dateStr = formatDateOnly(order.delivery_date);
  let kind = 'pickup_today';
  if (dateStr && dateStr < today) kind = 'pickup_missed';
  else if (dateStr && dateStr > today) kind = 'pickup_upcoming';
  const customerUser = order.customer?.user;
  const customerName = customerUser
    ? [customerUser.first_name, customerUser.last_name].filter(Boolean).join(' ').trim() ||
      customerUser.username
    : null;

  return {
    kind,
    order_id: order.id,
    order_number: order.order_number,
    customer_name: customerName,
    customer_username: customerUser?.username || null,
    phone_number: order.customer?.phone_number || null,
    delivery_date: dateStr,
    delivery_time: formatTime(order.delivery_time),
    order_status: order.order_status,
  };
}

async function listPickupNotifications({ limit, offset } = {}) {
  const today = accraTodayDate();
  const where = pickupWhere(today);
  const count = await Order.count({ where });
  const rows = await Order.findAll({
    where,
    include: PICKUP_INCLUDES,
    order: pickupOrder(today),
    offset: offset || 0,
    limit,
    subQuery: false,
  });
  return { today, count, results: rows.map((row) => formatPickupNotification(row, today)) };
}

async function previewPickupNotifications() {
  const { count, results } = await listPickupNotifications({ limit: 5, offset: 0 });
  return { count, results };
}

async function paginatedPickupNotifications(query) {
  const { page, pageSize, offset, limit } = parsePagination(query);
  const { count, results } = await listPickupNotifications({ limit, offset });
  return paginatedResponse({ count, page, pageSize, results });
}

module.exports = {
  accraTodayDate,
  accraDateOffset,
  previewPickupNotifications,
  paginatedPickupNotifications,
  formatPickupNotification,
};
