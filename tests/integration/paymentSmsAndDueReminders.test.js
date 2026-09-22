const request = require('supertest');
const app = require('../../app');
const moolreService = require('../../services/moolreService');
const { getTokensForRoles } = require('../helpers/auth');
const { createService, createOrder } = require('../helpers/fixtures');
const { processDueReminders, computeDueAt } = require('../../services/orderDueReminderService');
const { Order, SmsOutbox } = require('../../models');
const { Op } = require('sequelize');

jest.mock('axios');

async function waitForSms(minCount, maxWaitMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const count = await SmsOutbox.count();
    if (count >= minCount) return count;
    await new Promise((r) => setTimeout(r, 50));
  }
  return SmsOutbox.count();
}

describe('Payment receipt SMS + due reminders', () => {
  let tokens;
  let ctx;

  beforeAll(async () => {
    ctx = global.testContext;
    tokens = await getTokensForRoles(ctx);
    await ctx.superadmin.update({ phone_number: '0240000099' });
    await ctx.admin.update({ phone_number: '0240000077' });
    await ctx.employee.update({ phone_number: '0240000088' });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, code: 'SMS01' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('partial cash does not enqueue payment SMS; full cash SMSs superadmin only', async () => {
    const beforeCustomer = await SmsOutbox.count({ where: { purpose: 'payment_received' } });
    const beforeStaff = await SmsOutbox.count({ where: { purpose: 'payment_received_staff' } });
    const service = await createService(ctx.admin, { name: `Pay SMS ${Date.now()}` });
    const order = await createOrder(ctx.employee, ctx.customer, service, {
      quantity: 1,
      unit_price: 100,
    });

    const partial = await request(app)
      .post('/api/payments/cash/')
      .set(tokens.employee.headers)
      .send({
        order_id: order.id,
        amount: 40,
        paid_at: '2026-08-08T10:00:00.000Z',
      });
    expect(partial.status).toBe(201);
    expect(partial.body.data.order.payment_status).toBe('partially_paid');

    await new Promise((r) => setTimeout(r, 400));
    expect(await SmsOutbox.count({ where: { purpose: 'payment_received' } })).toBe(beforeCustomer);
    expect(await SmsOutbox.count({ where: { purpose: 'payment_received_staff' } })).toBe(beforeStaff);

    const full = await request(app)
      .post('/api/payments/cash/')
      .set(tokens.employee.headers)
      .send({
        order_id: order.id,
        amount: 60,
        paid_at: '2026-08-08T10:05:00.000Z',
      });
    expect(full.status).toBe(201);
    expect(full.body.data.order.payment_status).toBe('paid');
    expect(parseFloat(full.body.data.order.balance)).toBe(0);

    await waitForSms(beforeStaff + 1);

    const deadline = Date.now() + 5000;
    let staffSms = [];
    while (Date.now() < deadline) {
      staffSms = await SmsOutbox.findAll({
        where: { purpose: 'payment_received_staff' },
        order: [['id', 'DESC']],
        limit: 5,
      });
      if (staffSms.some((r) => String(r.related_id) === String(ctx.superadmin.id))) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const staffPaymentForSuperadmin = staffSms.find(
      (r) => String(r.related_id) === String(ctx.superadmin.id)
    );
    expect(staffPaymentForSuperadmin).toBeTruthy();
    expect(staffPaymentForSuperadmin.message).toMatch(/from client1/i);
    expect(staffPaymentForSuperadmin.message).toMatch(/Received by employee1/i);

    const adminPaymentSms = await SmsOutbox.findAll({
      where: {
        purpose: 'payment_received_staff',
        related_id: ctx.admin.id,
      },
    });
    expect(adminPaymentSms).toHaveLength(0);

    expect(await SmsOutbox.count({ where: { purpose: 'payment_received' } })).toBe(beforeCustomer);
  });

  it('due reminder job does not send SMS', async () => {
    const service = await createService(ctx.admin, { name: `Due Rem ${Date.now()}` });
    const dueAt = new Date(Date.now() + 50 * 60 * 1000);
    const deliveryDate = dueAt.toISOString().slice(0, 10);
    const deliveryTime = dueAt.toISOString().slice(11, 19);

    const order = await createOrder(ctx.employee, ctx.customer, service, {
      quantity: 1,
      unit_price: 25,
      delivery_date: deliveryDate,
      delivery_time: deliveryTime,
      assigned_to: ctx.employee.id,
    });

    expect(Math.abs(computeDueAt(deliveryDate, deliveryTime).getTime() - dueAt.getTime())).toBeLessThan(
      2000
    );

    const before = await SmsOutbox.count({
      where: {
        purpose: {
          [Op.in]: [
            'order_due_1h',
            'order_due_1h_staff',
            'order_due_24h',
            'order_due_24h_staff',
            'order_due_48h',
            'order_due_48h_staff',
          ],
        },
      },
    });

    const first = await processDueReminders(new Date());
    expect(first.reminded1h).toBe(0);
    expect(first.reminded48h).toBe(0);
    expect(first.scanned).toBe(0);

    const reloaded = await Order.findByPk(order.id);
    expect(reloaded.reminder_1h_sent_at).toBeFalsy();
    expect(reloaded.reminder_24h_sent_at).toBeFalsy();

    const after = await SmsOutbox.count({
      where: {
        purpose: {
          [Op.in]: [
            'order_due_1h',
            'order_due_1h_staff',
            'order_due_24h',
            'order_due_24h_staff',
            'order_due_48h',
            'order_due_48h_staff',
          ],
        },
      },
    });
    expect(after).toBe(before);
  });
});
