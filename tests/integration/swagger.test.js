const fs = require('fs');
const path = require('path');
const request = require('supertest');
const SwaggerParser = require('swagger-parser');
const app = require('../../app');
const { loadOpenApiSpec, getSwaggerUiOptions, isCsrfProtectedRequest } = require('../../config/swagger');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function countOperations(spec) {
  return Object.values(spec.paths || {}).reduce((sum, pathItem) => {
    const ops = Object.keys(pathItem).filter((key) => HTTP_METHODS.includes(key));
    return sum + ops.length;
  }, 0);
}

function responseJsonContent(openApiSpec, path, method, status) {
  return openApiSpec.paths[path]?.[method]?.responses?.[status]?.content?.['application/json'];
}

function hasResponseExample(openApiSpec, path, method, status) {
  const content = responseJsonContent(openApiSpec, path, method, status);
  if (!content) return false;
  if (content.example !== undefined) return true;
  if (content.examples && Object.keys(content.examples).length > 0) return true;
  return false;
}

function hasErrorExamples(openApiSpec, path, method, status) {
  const content = responseJsonContent(openApiSpec, path, method, status);
  return Boolean(content?.examples && Object.keys(content.examples).length > 0);
}

function iterateOperations(openApiSpec, callback) {
  for (const [path, pathItem] of Object.entries(openApiSpec.paths || {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) callback(path, method, pathItem[method]);
    }
  }
}

function securitySchemeNames(operation) {
  return (operation.security || []).flatMap((req) => Object.keys(req));
}

const PUBLIC_OPENAPI_ROUTES = [
  { method: 'get', path: '/health' },
  { method: 'get', path: '/api/accounts/csrf/' },
  { method: 'post', path: '/api/accounts/token/verify/' },
  { method: 'post', path: '/api/customers/register/' },
  { method: 'get', path: '/api/services/list/' },
  { method: 'post', path: '/api/payments/moolre/webhook/' },
  { method: 'get', path: '/api/payments/{externalref}/' },
  { method: 'post', path: '/api/ussd/payments/initialize/' },
  { method: 'post', path: '/api/ussd/callback/' },
  { method: 'post', path: '/api/accounts/superadmin/create/' },
];

const PROTECTED_OPENAPI_ROUTES = [
  { method: 'post', path: '/api/accounts/change-password/' },
  { method: 'put', path: '/api/accounts/change-password/' },
  { method: 'get', path: '/api/accounts/user/profile/' },
  { method: 'patch', path: '/api/accounts/client/update/' },
  { method: 'post', path: '/api/accounts/admin/create/' },
  { method: 'get', path: '/api/orders/list/' },
  { method: 'post', path: '/api/payments/initialize/' },
  { method: 'get', path: '/api/dashboard/revenue-report/' },
];

describe('Swagger API documentation', () => {
  let spec;

  beforeAll(async () => {
    const specPath = path.join(__dirname, '../../docs/openapi.json');
    const raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    spec = await SwaggerParser.validate(raw);
  });

  describe('OpenAPI spec', () => {
    it('documents at least 43 operations', () => {
      expect(countOperations(spec)).toBeGreaterThanOrEqual(43);
    });

    it('includes critical API paths', () => {
      expect(spec.paths['/health']).toBeDefined();
      expect(spec.paths['/api/accounts/login/']).toBeDefined();
      expect(spec.paths['/api/accounts/superadmins/']).toBeDefined();
      expect(spec.paths['/api/accounts/superadmin/update/']).toBeDefined();
      expect(spec.paths['/api/orders/list/']).toBeDefined();
      expect(spec.paths['/api/dashboard/metrics/']).toBeDefined();
      expect(spec.paths['/api/notifications/pickups/preview/']).toBeDefined();
      expect(spec.paths['/api/accounts/staff/user/{userId}/orders/']).toBeDefined();
      expect(spec.paths['/api/orders/{id}/complete/']).toBeDefined();
      expect(spec.paths['/api/notifications/sms/clients/']).toBeDefined();
    });

    it('defines security schemes', () => {
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
      expect(spec.components.securitySchemes.csrfHeader).toBeDefined();
    });

    it('defines standard error schema', () => {
      expect(spec.components.schemas.ApiError).toBeDefined();
      expect(spec.components.schemas.ApiError.properties.error_code).toBeDefined();
      expect(spec.components.schemas.ApiError.example).toBeDefined();
    });

    it('includes response examples on key endpoints', () => {
      expect(hasResponseExample(spec, '/health', 'get', 200)).toBe(true);
      expect(hasResponseExample(spec, '/api/accounts/login/', 'post', 200)).toBe(true);
      expect(hasErrorExamples(spec, '/api/accounts/login/', 'post', 401)).toBe(true);
      expect(hasResponseExample(spec, '/api/payments/initialize/', 'post', 200)).toBe(true);
      expect(hasResponseExample(spec, '/api/payments/moolre/webhook/', 'post', 200)).toBe(true);
      expect(hasResponseExample(spec, '/api/payments/{externalref}/', 'get', 200)).toBe(true);
      expect(hasResponseExample(spec, '/api/ussd/callback/', 'post', 200)).toBe(true);
    });

    it('documents Moolre payment status polling schema', () => {
      const props = spec.components.schemas.PaymentStatusResponse.properties;
      expect(props.status.enum).toEqual(['PENDING', 'PAID', 'FAILED']);
      const statusExample = responseJsonContent(spec, '/api/payments/{externalref}/', 'get', 200);
      expect(statusExample.example.status).toBe('PENDING');
    });

    it('documents health degraded state', () => {
      const health = responseJsonContent(spec, '/health', 'get', 200);
      expect(health.examples.degraded.value.status).toBe('degraded');
    });

    it('documents dashboard metrics per role with typed schemas', () => {
      expect(spec.components.schemas.DashboardClientMetrics).toBeDefined();
      expect(spec.components.schemas.DashboardEmployeeMetrics).toBeDefined();
      expect(spec.components.schemas.DashboardAdminMetrics).toBeDefined();
      expect(spec.components.schemas.DashboardSuperadminMetrics).toBeDefined();

      const metrics = responseJsonContent(spec, '/api/dashboard/metrics/', 'get', 200);
      expect(metrics.examples.client).toBeDefined();
      expect(metrics.examples.employee).toBeDefined();
      expect(metrics.examples.admin).toBeDefined();
      expect(metrics.examples.superadmin).toBeDefined();

      const clientExample = metrics.examples.client.value;
      expect(clientExample.data.total_spent).toBeDefined();
      expect(clientExample.data.recent_orders[0].balance).toBeDefined();
      expect(metrics.examples.superadmin.value.data.total_staff).toBeDefined();
      expect(metrics.examples.employee.value.data.my_assigned_orders).toBeDefined();
    });

    it('documents bearerAuth scheme with access JWT instructions', () => {
      const bearer = spec.components.securitySchemes.bearerAuth;
      expect(bearer.description).toMatch(/access/i);
      expect(bearer.description).toMatch(/Authorization: Bearer/i);
      expect(spec.components.securitySchemes.csrfHeader.description).toMatch(/X-CSRF-Token/i);
      expect(spec.components.securitySchemes.refreshCookie.description).toMatch(/refresh_token/i);
    });

    it('includes authentication matrix in API description', () => {
      expect(spec.info.description).toMatch(/Authentication matrix/i);
      expect(spec.info.description).toMatch(/token\/verify/);
    });

    it('documents order SMS side effects in API description', () => {
      expect(spec.info.description).toMatch(/Order SMS notifications/i);
      expect(spec.info.description).toMatch(/30%/);
      expect(spec.info.description).toMatch(/payment-and-sms-flow\.md/);
    });

    it('documents SMS side effects on payment and order operations', () => {
      expect(spec.paths['/api/payments/initialize/'].post.description).toMatch(/30%/i);
      expect(spec.paths['/api/payments/initialize/'].post.description).toMatch(/SMS/i);
      expect(spec.paths['/api/payments/moolre/webhook/'].post.description).toMatch(/in_progress/i);
      expect(spec.paths['/api/payments/moolre/webhook/'].post.description).toMatch(/SMS/i);
      expect(spec.paths['/api/payments/{externalref}/'].get.description).toMatch(/SMS/i);
      expect(spec.paths['/api/orders/{id}/update/'].put.description).toMatch(/in_progress/i);
      expect(spec.paths['/api/orders/{id}/update/'].put.description).toMatch(/completed/i);
      expect(spec.paths['/api/ussd/payments/initialize/'].post.description).toMatch(/SMS/i);
    });

    it('marks public routes with empty security', () => {
      PUBLIC_OPENAPI_ROUTES.forEach(({ method, path }) => {
        const op = spec.paths[path][method];
        expect(op.security).toEqual([]);
      });
    });

    it('marks JWT-protected routes with bearerAuth', () => {
      PROTECTED_OPENAPI_ROUTES.forEach(({ method, path }) => {
        expect(securitySchemeNames(spec.paths[path][method])).toContain('bearerAuth');
      });
      expect(securitySchemeNames(spec.paths['/api/accounts/superadmins/'].get)).toContain('bearerAuth');
      expect(securitySchemeNames(spec.paths['/api/accounts/superadmin/update/'].patch)).toContain('bearerAuth');
      expect(spec.paths['/api/accounts/superadmins/'].get.description).toMatch(/Role: superadmin/);
      expect(spec.paths['/api/accounts/superadmin/update/'].patch.description).toMatch(/Role: superadmin/);
    });

    it('documents CSRF-only login, bearer+CSRF logout, cookie+CSRF refresh', () => {
      expect(securitySchemeNames(spec.paths['/api/accounts/login/'].post)).toEqual(['csrfHeader']);
      expect(securitySchemeNames(spec.paths['/api/accounts/logout/'].post)).toEqual(
        expect.arrayContaining(['bearerAuth', 'csrfHeader'])
      );
      expect(securitySchemeNames(spec.paths['/api/accounts/token/refresh/'].post)).toEqual(
        expect.arrayContaining(['refreshCookie', 'csrfHeader'])
      );
    });

    it('includes Required auth on every operation', () => {
      iterateOperations(spec, (path, method, operation) => {
        expect(operation.description).toMatch(/\*\*Required auth:\*\*/);
      });
    });
  });

  describe('Swagger UI mount (test env)', () => {
    it('exposes /api/docs', async () => {
      const res = await request(app).get('/api/docs/');
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/swagger/i);
    });

    it('exposes /api/docs/openapi.json', async () => {
      const res = await request(app)
        .get('/api/docs/openapi.json')
        .set('Host', 'localhost:3000');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.openapi).toBe('3.0.3');
      expect(res.body.paths['/health']).toBeDefined();
    });

    it('injects request host into served spec servers', async () => {
      const res = await request(app)
        .get('/api/docs/openapi.json')
        .set('Host', 'api.example.com');

      expect(res.body.servers[0].url).toBe('http://api.example.com');
    });

    it('ignores BASE_URL and uses request host for served spec servers', async () => {
      const previous = process.env.BASE_URL;
      process.env.BASE_URL = 'https://api.prod.example.com/';

      const res = await request(app)
        .get('/api/docs/openapi.json')
        .set('Host', 'api.example.com');

      process.env.BASE_URL = previous;

      expect(res.body.servers[0].url).toBe('http://api.example.com');
    });

    it('loadOpenApiSpec returns a server URL from request host', () => {
      const loaded = loadOpenApiSpec({
        protocol: 'https',
        get(name) {
          if (name === 'host') return 'docs.example.com';
          return undefined;
        },
      });
      expect(loaded.servers[0].url).toBe('https://docs.example.com');
    });

    it('serves Swagger UI init with credentialed CSRF support', async () => {
      const res = await request(app).get('/api/docs/swagger-ui-init.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toMatch(/"withCredentials":\s*true/);
      expect(res.text).toMatch(/"persistAuthorization":\s*true/);
      expect(res.text).toMatch(/X-CSRF-Token/);
      expect(res.text).toMatch(/\/api\/accounts\/csrf\//);
      expect(res.text).toMatch(/csrfSwaggerRequestInterceptor/);
    });

    it('getSwaggerUiOptions enables credentials and CSRF interceptor', () => {
      const options = getSwaggerUiOptions();
      expect(options.withCredentials).toBe(true);
      expect(options.persistAuthorization).toBe(true);
      expect(typeof options.requestInterceptor).toBe('function');
      expect(isCsrfProtectedRequest('https://api.example.com/api/accounts/login/')).toBe(true);
      expect(isCsrfProtectedRequest('https://api.example.com/api/accounts/user/profile/')).toBe(false);
    });
  });

  describe('when SWAGGER_ENABLED=false', () => {
    const previous = process.env.SWAGGER_ENABLED;

    afterAll(() => {
      if (previous === undefined) {
        delete process.env.SWAGGER_ENABLED;
      } else {
        process.env.SWAGGER_ENABLED = previous;
      }
      jest.resetModules();
    });

    it('does not expose /api/docs or openapi.json', async () => {
      jest.resetModules();
      process.env.SWAGGER_ENABLED = 'false';
      const disabledApp = require('../../app');

      const ui = await request(disabledApp).get('/api/docs/');
      const json = await request(disabledApp).get('/api/docs/openapi.json');

      expect(ui.status).toBe(404);
      expect(json.status).toBe(404);

      jest.resetModules();
      process.env.SWAGGER_ENABLED = previous ?? 'true';
    });
  });
});
