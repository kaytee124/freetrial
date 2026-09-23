const request = require('supertest');
const app = require('../../app');
const { getTokensForRoles } = require('../helpers/auth');
const { createService, createOrder } = require('../helpers/fixtures');
const { accraTodayDate, accraDateOffset } = require('../../services/pickupNotificationService');

function ymdOffset(baseYmd, days) {
  const d = new Date(`${baseYmd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('Pickup notifications + client profile orders', () => {
  let tokens;
  let ctx;
  let today;
  let yesterday;

  beforeAll(async () => {
    ctx = global.testContext;
    tokens = await getTokensForRoles(ctx);
    today = accraTodayDate();
    yesterday = ymdOffset(today, -1);
  });

  describe('GET /api/notifications/pickups/', () => {
    it('denies employee and client', async () => {
      const emp = await request(app)
        .get('/api/notifications/pickups/preview/')
        .set(tokens.employee.headers);
      expect(emp.status).toBe(403);

      const client = await request(app)
        .get('/api/notifications/pickups/')
        .set(tokens.client.headers);
      expect(client.status).toBe(403);
    });

    it('preview returns at most 5 items with total count; missed sorts first', async () => {
      const service = await createService(ctx.admin, { name: `Notif ${Date.now()}` });
      const missed = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: yesterday,
        delivery_time: '08:00:00',
        order_status: 'ready',
      });

      const todays = [];
      for (let i = 0; i < 6; i += 1) {
        todays.push(
          await createOrder(ctx.employee, ctx.customer, service, {
            quantity: 1,
            unit_price: 10,
            delivery_date: today,
            delivery_time: `1${i}:00:00`,
            order_status: 'ready',
          })
        );
      }

      await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: today,
        picked_up: true,
        picked_up_at: new Date(),
      });
      await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: yesterday,
        order_status: 'cancelled',
      });

      const preview = await request(app)
        .get('/api/notifications/pickups/preview/')
        .set(tokens.admin.headers);
      expect(preview.status).toBe(200);
      expect(preview.body.data.count).toBeGreaterThanOrEqual(7);
      expect(preview.body.data.results.length).toBeLessThanOrEqual(5);
      expect(preview.body.data.results.length).toBe(5);
      expect(
        preview.body.data.results.every((r) =>
          ['pickup_missed', 'pickup_today', 'pickup_upcoming'].includes(r.kind)
        )
      ).toBe(true);

      const list = await request(app)
        .get('/api/notifications/pickups/?page=1&page_size=200')
        .set(tokens.superadmin.headers);
      expect(list.status).toBe(200);
      const all = list.body.data.results;
      const missedRow = all.find((r) => r.order_id === missed.id);
      expect(missedRow).toBeDefined();
      expect(missedRow.kind).toBe('pickup_missed');
      expect(missedRow.customer_username).toBe(ctx.client.username);

      const todayRow = all.find((r) => r.order_id === todays[0].id);
      expect(todayRow).toBeDefined();
      expect(todayRow.kind).toBe('pickup_today');

      const missedIdx = all.findIndex((r) => r.kind === 'pickup_missed');
      const todayIdx = all.findIndex((r) => r.kind === 'pickup_today');
      if (todayIdx !== -1 && missedIdx !== -1) {
        expect(missedIdx).toBeLessThan(todayIdx);
      }

      const page = await request(app)
        .get('/api/notifications/pickups/?page=1&page_size=3')
        .set(tokens.admin.headers);
      expect(page.body.data.page_size).toBe(3);
      expect(page.body.data.results.length).toBe(3);
      expect(page.body.data.total_pages).toBeGreaterThanOrEqual(3);
    });

    it('includes pickups due in the next 48h (T+1/T+2) and excludes T+3', async () => {
      const service = await createService(ctx.admin, { name: `Upcoming ${Date.now()}` });
      const plus1 = accraDateOffset(today, 1);
      const plus2 = accraDateOffset(today, 2);
      const plus3 = accraDateOffset(today, 3);

      const soon = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: plus1,
        delivery_time: '09:00:00',
        order_status: 'ready',
      });
      const later = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: plus2,
        delivery_time: '11:00:00',
        order_status: 'ready',
      });
      const tooFar = await createOrder(ctx.employee, ctx.customer, service, {
        quantity: 1,
        unit_price: 10,
        delivery_date: plus3,
        delivery_time: '10:00:00',
        order_status: 'ready',
      });

      const list = await request(app)
        .get('/api/notifications/pickups/?page=1&page_size=200')
        .set(tokens.admin.headers);
      expect(list.status).toBe(200);
      const all = list.body.data.results;

      const soonRow = all.find((r) => r.order_id === soon.id);
      const laterRow = all.find((r) => r.order_id === later.id);
      expect(soonRow).toBeDefined();
      expect(soonRow.kind).toBe('pickup_upcoming');
      expect(laterRow).toBeDefined();
      expect(laterRow.kind).toBe('pickup_upcoming');
      expect(all.find((r) => r.order_id === tooFar.id)).toBeUndefined();

      const todayIdx = all.findIndex((r) => r.kind === 'pickup_today');
      const upcomingIdx = all.findIndex((r) => r.kind === 'pickup_upcoming');
      if (todayIdx !== -1 && upcomingIdx !== -1) {
        expect(todayIdx).toBeLessThan(upcomingIdx);
      }
    });
  });

  describe('GET /api/accounts/staff/user/:userId/orders/', () => {
    it('denies employee', async () => {
      const res = await request(app)
        .get(`/api/accounts/staff/user/${ctx.client.id}/orders/`)
        .set(tokens.employee.headers);
      expect(res.status).toBe(403);
    });

    it('returns 404 for non-client', async () => {
      const res = await request(app)
        .get(`/api/accounts/staff/user/${ctx.employee.id}/orders/`)
        .set(tokens.admin.headers);
      expect(res.status).toBe(404);
    });

    it('admin lists client orders by user id with pagination', async () => {
      const service = await createService(ctx.admin, { name: `ProfOrd ${Date.now()}` });
      await createOrder(ctx.employee, ctx.customer, service, { quantity: 1, unit_price: 5 });
      await createOrder(ctx.employee, ctx.customer, service, { quantity: 1, unit_price: 6 });

      const page1 = await request(app)
        .get(`/api/accounts/staff/user/${ctx.client.id}/orders/?page=1&page_size=1`)
        .set(tokens.admin.headers);
      expect(page1.status).toBe(200);
      expect(page1.body.data.page_size).toBe(1);
      expect(page1.body.data.results).toHaveLength(1);
      expect(page1.body.data.count).toBeGreaterThanOrEqual(2);
      expect(page1.body.data.results[0].customer_id).toBe(ctx.customer.id);

      const page2 = await request(app)
        .get(`/api/accounts/staff/user/${ctx.client.id}/orders/?page=2&page_size=1`)
        .set(tokens.superadmin.headers);
      expect(page2.status).toBe(200);
      expect(page2.body.data.results).toHaveLength(1);
      expect(page2.body.data.results[0].id).not.toBe(page1.body.data.results[0].id);
    });
  });
});
