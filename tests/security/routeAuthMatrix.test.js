const request = require('supertest');
const app = require('../../app');

const PUBLIC_ROUTES = [
  { method: 'get', path: '/api/accounts/csrf/', expectStatus: [200] },
  { method: 'post', path: '/api/accounts/login/', body: { username: 'x', password: 'y' }, expectStatus: [400, 401, 403] },
  { method: 'post', path: '/api/accounts/welcome-login/', body: { token: 'x' }, expectStatus: [400, 401, 403, 429] },
  { method: 'post', path: '/api/accounts/token/refresh/', body: {}, expectStatus: [401, 403] },
  { method: 'post', path: '/api/accounts/token/verify/', body: {}, expectStatus: [400, 401] },
  { method: 'post', path: '/api/customers/register/', body: {}, expectStatus: [400, 422] },
  { method: 'get', path: '/api/services/list/', expectStatus: [200] },
  { method: 'get', path: '/api/payments/callback/', expectStatus: [200] },
];

const PROTECTED_ROUTES = [
  { method: 'post', path: '/api/accounts/logout/', body: {} },
  { method: 'post', path: '/api/accounts/change-password/', body: {} },
  { method: 'get', path: '/api/accounts/user/profile/' },
  { method: 'patch', path: '/api/accounts/client/update/', body: {} },
  { method: 'post', path: '/api/accounts/admin/create/', body: {} },
  { method: 'patch', path: '/api/accounts/admin/update/', body: {} },
  { method: 'patch', path: '/api/accounts/admin/employee/1/update/', body: {} },
  { method: 'post', path: '/api/accounts/employee/create/', body: {} },
  { method: 'patch', path: '/api/accounts/employee/update/', body: {} },
  { method: 'patch', path: '/api/accounts/staff/client/1/update/', body: {} },
  { method: 'get', path: '/api/accounts/staff/user/1/' },
  { method: 'get', path: '/api/accounts/staff/user/1/orders/' },
  { method: 'post', path: '/api/accounts/superadmin/create/', body: {} },
  { method: 'patch', path: '/api/accounts/superadmin/update/', body: {} },
  { method: 'patch', path: '/api/accounts/superadmin/admin/1/update/', body: {} },
  { method: 'patch', path: '/api/accounts/superadmin/employee/1/update/', body: {} },
  { method: 'patch', path: '/api/accounts/superadmin/client/1/update/', body: {} },
  { method: 'get', path: '/api/accounts/superadmin/user/1/' },
  { method: 'get', path: '/api/accounts/admins/' },
  { method: 'get', path: '/api/accounts/superadmins/' },
  { method: 'get', path: '/api/accounts/employees/' },
  { method: 'get', path: '/api/accounts/clients/' },
  { method: 'post', path: '/api/customers/create/', body: {} },
  { method: 'post', path: '/api/services/create/', body: {} },
  { method: 'get', path: '/api/services/1/' },
  { method: 'patch', path: '/api/services/1/update/', body: {} },
  { method: 'get', path: '/api/orders/list/' },
  { method: 'post', path: '/api/orders/create/', body: {} },
  { method: 'get', path: '/api/orders/1/' },
  { method: 'put', path: '/api/orders/1/update/', body: {} },
  { method: 'post', path: '/api/orders/1/complete/', body: {} },
  { method: 'post', path: '/api/payments/initialize/', body: {} },
  { method: 'post', path: '/api/payments/cash/', body: {} },
  { method: 'get', path: '/api/dashboard/metrics/' },
  { method: 'get', path: '/api/dashboard/revenue-report/' },
  { method: 'get', path: '/api/notifications/pickups/preview/' },
  { method: 'get', path: '/api/notifications/pickups/' },
  { method: 'post', path: '/api/notifications/sms/clients/', body: {} },
];

describe('Security: Route auth matrix', () => {
  describe('public routes without token', () => {
    PUBLIC_ROUTES.forEach(({ method, path, body, expectStatus }) => {
      it(`${method.toUpperCase()} ${path} is reachable without auth`, async () => {
        const req = request(app)[method](path);
        if (body) req.send(body);
        const res = await req;
        expect(expectStatus).toContain(res.status);
      });
    });
  });

  describe('protected routes without token', () => {
    PROTECTED_ROUTES.forEach(({ method, path, body }) => {
      it(`${method.toUpperCase()} ${path} returns 401 without token`, async () => {
        const req = request(app)[method](path);
        if (body) req.send(body);
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.body.error_code).toBe('NO_TOKEN');
      });
    });
  });
});
