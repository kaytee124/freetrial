# Bubblebytes

Laundry management REST API (Node.js + Express + Sequelize + MySQL).

## Setup

```bash
npm install
copy .env.example .env   # configure MySQL, JWT; add Moolre vars in .env (see MOOLRE_* placeholders)
npm start                # applies pending migrations automatically
```

`npm run db:migrate` is still available for CI or one-off runs. For Jest, use `npm run db:migrate:test` (test DB is separate and not migrated via `server.js`).

## Payments (Moolre)

Configure these in `.env` (not `.env.example`):

- `MOOLRE_API_USER`, `MOOLRE_API_PUBKEY`, `MOOLRE_ACCOUNT_NUMBER`
- `MOOLRE_WEBHOOK_URL` — must point to `POST /api/payments/moolre/webhook/`
- `MOOLRE_REDIRECT_URL` — frontend “verifying payment” page (polls `GET /api/payments/{externalref}/`)
- `MOOLRE_WEBHOOK_SECRET` — validated against `data.secret` on webhooks
- `MOOLRE_API_BASE` — Moolre API host (e.g. `https://api.moolre.com`)
- `MOOLRE_MERCHANT_EMAIL` — email sent on web payment link create
- `MOOLRE_PATH_EMBED_LINK`, `MOOLRE_PATH_TRANSACT_STATUS`, `MOOLRE_PATH_TRANSACT_PAYMENT`, `MOOLRE_PATH_SMS_SEND` — API path suffixes
- `CUSTOMER_APP_URL` — customer web app URL included in welcome SMS (e.g. `https://laundry.bafrow-health.org`)
- `WELCOME_LOGIN_TOKEN_TTL_HOURS` — portal/welcome magic-link lifetime in hours (default `720` = 30 days)

Staff-created account passwords are **`Trenor@{username}`** (not a shared env secret). See [docs/frontend-portal-links-and-cash-payments.md](docs/frontend-portal-links-and-cash-payments.md).

Flow: client calls `POST /api/payments/initialize/` → redirect to `authorization_url` → Moolre webhook marks paid (or reconciliation cron after 2 minutes).

Staff cash: `POST /api/payments/cash/` with `order_id`, `amount`, `paid_at` (acceptor = logged-in staff).

Full frontend-to-SMS flow: [docs/payment-and-sms-flow.md](docs/payment-and-sms-flow.md).

## SMS (Moolre)

Configure in `.env`:

- `MOOLRE_SMS_VAS_KEY` — `X-API-VASKEY` for `POST /open/sms/send`
- `MOOLRE_SMS_SENDER_ID` — approved sender ID for notifications (welcome, orders, broadcast; max 11 characters)
- `MOOLRE_SMS_SENDER_ID_2` — approved sender ID for payment receipts (e.g. `KolendoPay`; max 11 characters)

SMS is sent automatically when:

- An order is **created** (staff create) — order-received SMS with order summary and a portal magic link (`/welcome?token=…&next=/orders/{id}`)
- An order transitions to **in_progress** (staff update or ≥30% payment while order is still `pending`)
- An order transitions to **completed** (staff update)
- Staff creates a customer (`POST /api/customers/create/`) — welcome SMS with reusable portal magic link (see [docs/frontend-welcome-magic-login.md](docs/frontend-welcome-magic-login.md)), plus username and `Trenor@{username}` password fallback

Failures are logged only; they do not block order, payment, or customer-create responses.

To backfill order-received SMS for all orders created on the current Africa/Accra calendar day:

```powershell
node scripts/sendSmsForTodaysOrders.js
```

## Testing

### Run everything (Jest + full benchmark)

```powershell
npm run test:all
```

Runs: test DB migrate → all Jest suites (security, integration, concurrency) → benchmark setup → full 5M seed benchmark (k6, race tests, reports). **4–10 hours.**

Quick smoke (~5 min benchmark after Jest):

```powershell
node scripts/run-all-tests.js --quick
```

### Jest only

```powershell
npm run db:migrate:test
npm test                      # all suites
npm run test:security
npm run test:integration
npm run test:concurrency      # race-condition smoke tests
```

### Benchmark only

```powershell
npm run benchmark:setup
npm run benchmark:seed        # ~2–6 hours for 5M orders
npm run benchmark:all         # full pipeline
npm run benchmark:race      # race tests (server on :3000 required)
```

See [benchmark/README.md](benchmark/README.md) for details.

## Databases

| Purpose | Database name |
|---------|---------------|
| Development | `laundry_management_system` |
| Jest tests | `laundry_management_system_test` |
| Benchmarks | `laundry_management_system_benchmark` |

## Reports

After `npm run test:all` or `npm run benchmark:all`:

- `benchmark/results/reports/bottlenecks.md` — primary findings
- `benchmark/results/reports/coverage-matrix.md` — what is tested
- `benchmark/results/race/summary.md` — race / contention results
- `benchmark/results/reports/full-test-run.md` — overall pass/fail
