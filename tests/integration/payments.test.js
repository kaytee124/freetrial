const request = require('supertest');
const express = require('express');
const axios = require('axios');
const app = require('../../app');
const { createRateLimiter } = require('../../middleware/rateLimit');
const { getTokensForRoles } = require('../helpers/auth');
const { createService, createOrder } = require('../helpers/fixtures');
const { Payment, Order } = require('../../models');

jest.mock('axios');

const WEBHOOK_SECRET = process.env.MOOLRE_WEBHOOK_SECRET;

function mockMoolreLinkInit() {
  axios.post.mockImplementation((url) => {
    if (String(url).includes('/embed/link')) {
      return Promise.resolve({
        data: {
          data: {
            authorization_url: 'https://pay.moolre.com/test',
            reference: 'MOOLRE-REF-001',
          },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

function mockMoolreStatusSuccess(amountGhs, txstatus = 1) {
  axios.post.mockImplementation((url) => {
    if (String(url).includes('/open/transact/status')) {
      return Promise.resolve({
        data: {
          data: {
            txstatus,
            amount: String(amountGhs),
            value: String(amountGhs),
            transactionid: 'TXN-STATUS',
            thirdpartyref: 'TP-STATUS',
            payer: '233240000000',
            ts: new Date().toISOString(),
          },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected URL: ${url}`));
  });
}

function buildWebhookPayload(externalref, overrides = {}) {
  return {
    status: 1,
    code: 'P01',
    message: 'Transaction Successful',
    data: {
      txstatus: 1,
      payer: '233240000000',
      accountnumber: '0000000000',
      amount: '10.00',
      value: '10.00',
      transactionid: 'TXN-001',
      externalref,
      thirdpartyref: 'TP-001',
      secret: WEBHOOK_SECRET,
      ts: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe('Payments API', () => {
  let tokens;
  let ctx;
  let order;

  beforeAll(async () => {
    ctx = global.testContext;
    tokens = await getTokensForRoles(ctx);
    const service = await createService(ctx.admin);
    order = await createOrder(ctx.employee, ctx.customer, service);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/payments/initialize/', () => {
    it('client initializes payment', async () => {
      mockMoolreLinkInit();

      const res = await request(app)
        .post('/api/payments/initialize/')
        .set(tokens.client.headers)
        .send({ order_id: order.id, amount: 10 });

      expect(res.status).toBe(200);
      expect(res.body.data.authorization_url).toBe('https://pay.moolre.com/test');
      expect(res.body.data.externalref).toMatch(/^PAY-/);
    });

    it('denies non-client', async () => {
      const res = await request(app)
        .post('/api/payments/initialize/')
        .set(tokens.admin.headers)
        .send({ order_id: order.id, amount: 10 });
      expect(res.status).toBe(403);
    });

    it('rejects amount exceeding balance', async () => {
      const res = await request(app)
        .post('/api/payments/initialize/')
        .set(tokens.client.headers)
        .send({ order_id: order.id, amount: 999999 });
      expect(res.status).toBe(400);
      expect(res.body.error_code).toBe('AMOUNT_EXCEEDS_BALANCE');
    });
  });

  describe('POST /api/payments/cash/', () => {
    it('employee records cash payment and updates order balance', async () => {
      const service = await createService(ctx.admin, { price: 100 });
      const cashOrder = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 100,
      });

      const paidAt = '2026-08-03T14:30:00.000Z';
      const res = await request(app)
        .post('/api/payments/cash/')
        .set(tokens.employee.headers)
        .send({ order_id: cashOrder.id, amount: 40, paid_at: paidAt });

      expect(res.status).toBe(201);
      expect(res.body.data.payment.payment_method).toBe('cash');
      expect(res.body.data.payment.status).toBe('paid');
      expect(parseFloat(res.body.data.payment.amount)).toBe(40);
      expect(res.body.data.payment.created_by).toBe(ctx.employee.id);
      expect(new Date(res.body.data.payment.paid_at).toISOString()).toBe(paidAt);
      expect(res.body.data.order.payment_status).toBe('partially_paid');
      expect(parseFloat(res.body.data.order.amount_paid)).toBe(40);
      expect(parseFloat(res.body.data.order.balance)).toBe(60);

      const row = await Payment.findOne({ where: { externalref: res.body.data.payment.externalref } });
      expect(row).toBeTruthy();
      expect(row.payment_method).toBe('cash');
    });

    it('rejects overpay and denies client', async () => {
      const service = await createService(ctx.admin, { price: 20 });
      const cashOrder = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 20,
      });

      const overpay = await request(app)
        .post('/api/payments/cash/')
        .set(tokens.admin.headers)
        .send({
          order_id: cashOrder.id,
          amount: 999,
          paid_at: '2026-08-03T10:00:00.000Z',
        });
      expect(overpay.status).toBe(400);
      expect(overpay.body.error_code).toBe('AMOUNT_EXCEEDS_BALANCE');

      const clientRes = await request(app)
        .post('/api/payments/cash/')
        .set(tokens.client.headers)
        .send({
          order_id: cashOrder.id,
          amount: 5,
          paid_at: '2026-08-03T10:00:00.000Z',
        });
      expect(clientRes.status).toBe(403);
    });
  });

  describe('POST /api/payments/moolre/webhook/', () => {
    it('marks payment paid after Moolre status API confirms txstatus 1', async () => {
      const payment = await Payment.create({
        order_id: order.id,
        externalref: 'PAY-WEBHOOK-001',
        amount: 25,
        status: 'pending',
        payment_method: 'moolre',
        provider: 'moolre',
        currency: 'GHS',
        metadata: {},
        created_by: ctx.client.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockMoolreStatusSuccess(25, 1);

      const payload = buildWebhookPayload(payment.externalref, { amount: '25.00', value: '25.00' });
      const res = await request(app).post('/api/payments/moolre/webhook/').send(payload);

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/open/transact/status'),
        expect.objectContaining({ idtype: '1', id: payment.externalref }),
        expect.any(Object)
      );

      await payment.reload();
      expect(payment.status).toBe('paid');

      const updatedOrder = await Order.findByPk(order.id);
      expect(parseFloat(updatedOrder.amount_paid)).toBeGreaterThan(0);
    });

    it('does not mark paid when webhook body says success but status API returns pending', async () => {
      const payment = await Payment.create({
        order_id: order.id,
        externalref: 'PAY-WEBHOOK-PENDING',
        amount: 20,
        status: 'pending',
        payment_method: 'moolre',
        provider: 'moolre',
        currency: 'GHS',
        metadata: {},
        created_by: ctx.client.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockMoolreStatusSuccess(20, 0);

      const payload = buildWebhookPayload(payment.externalref, {
        txstatus: 1,
        amount: '20.00',
        value: '20.00',
      });
      const res = await request(app).post('/api/payments/moolre/webhook/').send(payload);

      expect(res.status).toBe(200);
      await payment.reload();
      expect(payment.status).toBe('pending');
    });

    it('rejects invalid webhook secret before lookup', async () => {
      const res = await request(app)
        .post('/api/payments/moolre/webhook/')
        .send(buildWebhookPayload('PAY-MISSING', { secret: 'wrong-secret' }));
      expect(res.status).toBe(403);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/payments/{externalref}/', () => {
    it('returns uppercase polling status', async () => {
      axios.post.mockImplementation((url) => {
        if (String(url).includes('/open/transact/status')) {
          return Promise.resolve({
            data: { data: { txstatus: 0, amount: '15.00', value: '15.00' } },
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });

      await Payment.create({
        order_id: order.id,
        externalref: 'PAY-STATUS-001',
        amount: 15,
        status: 'pending',
        payment_method: 'moolre',
        provider: 'moolre',
        currency: 'GHS',
        metadata: {},
        created_by: ctx.client.id,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const res = await request(app).get('/api/payments/PAY-STATUS-001/');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
    });

    it('live-reconciles pending moolre payment to PAID', async () => {
      mockMoolreStatusSuccess(25, 1);

      await Payment.create({
        order_id: order.id,
        externalref: 'PAY-STATUS-LIVE-001',
        amount: 25,
        status: 'pending',
        payment_method: 'moolre',
        provider: 'moolre',
        currency: 'GHS',
        metadata: {},
        created_by: ctx.client.id,
        created_at: new Date(Date.now() - 3 * 60 * 1000),
        updated_at: new Date(Date.now() - 3 * 60 * 1000),
      });

      const res = await request(app).get('/api/payments/PAY-STATUS-LIVE-001/');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PAID');

      const payment = await Payment.findOne({ where: { externalref: 'PAY-STATUS-LIVE-001' } });
      expect(payment.status).toBe('paid');
    });

    it('returns 404 for unknown externalref', async () => {
      const res = await request(app).get('/api/payments/PAY-NOT-FOUND/');
      expect(res.status).toBe(404);
    });
  });
});

describe('Moolre webhook rate limiter', () => {
  it('returns 429 when request limit is exceeded', async () => {
    const testApp = express();
    testApp.set('trust proxy', true);
    testApp.use(
      createRateLimiter({
        max: 2,
        windowMs: 60_000,
        keyPrefix: 'test-webhook',
      })
    );
    testApp.post('/hook', (req, res) => res.json({ ok: true }));

    await request(testApp).post('/hook').expect(200);
    await request(testApp).post('/hook').expect(200);
    const limited = await request(testApp).post('/hook');
    expect(limited.status).toBe(429);
    expect(limited.body.error_code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
