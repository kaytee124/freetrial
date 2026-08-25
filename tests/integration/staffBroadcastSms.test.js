const request = require('supertest');
const app = require('../../app');
const moolreService = require('../../services/moolreService');
const { getTokensForRoles } = require('../helpers/auth');
const { SmsOutbox, Customer } = require('../../models');

describe('Staff broadcast SMS', () => {
  let tokens;
  let ctx;
  let sendSmsSpy;

  beforeAll(async () => {
    ctx = global.testContext;
    tokens = await getTokensForRoles(ctx);
  });

  afterEach(async () => {
    if (sendSmsSpy) {
      sendSmsSpy.mockRestore();
      sendSmsSpy = null;
    }
  });

  it('denies employee and client', async () => {
    const emp = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.employee.headers)
      .send({ message: 'Hello', user_ids: [ctx.client.id] });
    expect(emp.status).toBe(403);

    const client = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.client.headers)
      .send({ message: 'Hello', user_ids: [ctx.client.id] });
    expect(client.status).toBe(403);
  });

  it('requires message and targeting', async () => {
    const noMsg = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.admin.headers)
      .send({ user_ids: [ctx.client.id] });
    expect(noMsg.status).toBe(400);

    const noTarget = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.admin.headers)
      .send({ message: 'Hi there' });
    expect(noTarget.status).toBe(400);
  });

  it('admin sends personalized SMS to selected user_ids', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });

    const res = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.admin.headers)
      .send({
        message: 'Hi {{first_name}}, promo from Bubblebytes.',
        user_ids: [ctx.client.id],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.targeted).toBe(1);
    expect(res.body.data.sent).toBe(1);
    expect(res.body.data.skipped).toBe(0);

    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    const payload = sendSmsSpy.mock.calls[0][0];
    expect(payload.message).toMatch(/Hi /);
    expect(payload.message).toMatch(/promo from Bubblebytes/);

    const row = await SmsOutbox.findOne({
      where: { purpose: 'staff_client_broadcast', related_id: ctx.customer.id },
      order: [['id', 'DESC']],
    });
    expect(row).toBeTruthy();
    expect(row.status).toBe('sent');
  });

  it('skips clients with phone_needs_correction', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });
    await Customer.update({ phone_needs_correction: true }, { where: { id: ctx.customer.id } });

    try {
      const res = await request(app)
        .post('/api/notifications/sms/clients/')
        .set(tokens.superadmin.headers)
        .send({
          message: 'Hello',
          user_ids: [ctx.client.id],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.targeted).toBe(0);
      expect(res.body.data.skipped).toBeGreaterThanOrEqual(1);
      expect(res.body.data.skips.some((s) => s.reason === 'phone_needs_correction')).toBe(true);
      expect(sendSmsSpy).not.toHaveBeenCalled();
    } finally {
      await Customer.update({ phone_needs_correction: false }, { where: { id: ctx.customer.id } });
    }
  });

  it('superadmin can use all_active', async () => {
    sendSmsSpy = jest.spyOn(moolreService, 'sendSms').mockResolvedValue({ status: 1, message: 'ok' });

    const res = await request(app)
      .post('/api/notifications/sms/clients/')
      .set(tokens.superadmin.headers)
      .send({
        message: 'Bulk hello {{username}}',
        all_active: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.targeted).toBeGreaterThanOrEqual(1);
    expect(res.body.data.sent).toBe(res.body.data.targeted);
    expect(sendSmsSpy.mock.calls.length).toBe(res.body.data.sent);
  });
});
