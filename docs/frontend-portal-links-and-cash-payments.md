# Frontend: portal magic links, cash payments, and default passwords

This guide covers the portal SMS deep-link flow, staff cash payments, and the per-username default password used when staff create accounts.

Related docs:

- [frontend-welcome-magic-login.md](./frontend-welcome-magic-login.md) — detailed welcome-login API contract
- [payment-and-sms-flow.md](./payment-and-sms-flow.md) — Moolre + cash overview
- [frontend-balance-and-welcome-sms.md](./frontend-balance-and-welcome-sms.md) — order `balance` field
- [frontend-partial-payment-status.md](./frontend-partial-payment-status.md) — `partially_paid` status for the UI

---

## Summary

| Area | Behavior | Frontend action |
|------|----------|-----------------|
| Magic link | SMS opens `{CUSTOMER_APP_URL}/welcome?token=…` (orders add `&next=/orders/{id}`) | Exchange token via welcome-login; follow `next` after optional password change |
| Cash pay | Staff `POST /api/payments/cash/` | Form: order, amount, payment date; refresh order money fields |
| Default password | Clients: SMS only (`Trenor@{username}` + magic link). Staff roles: SMS + `default_password` in create response | Client create UI: no password display. Staff create UI: show returned password and require Ghana `phone_number` |
| Ghana phone | `0XXXXXXXXX` (10) or `+233XXXXXXXXX` (13) | Reject other formats in forms; show `phone_needs_correction` and block new orders until fixed |

---

## 1. Portal magic links

SMS links look like:

```text
https://laundry.bafrow-health.org/welcome?token=<raw>&next=%2Forders%2F13
```

- Tokens are **reusable until expiry** (default 30 days).
- If the link expires, customers log in with username + temporary password from the SMS.
- Portal `/welcome` should:
  1. Read `token` and optional `next`
  2. `GET /api/accounts/csrf/` then `POST /api/accounts/welcome-login/` with `{ "token" }`
  3. Store `access` like normal login
  4. If `requires_password_change`, complete change-password first
  5. Navigate to `next` only when it is a relative path starting with `/`

Full contract: [frontend-welcome-magic-login.md](./frontend-welcome-magic-login.md).

---

## 2. Staff cash payments

```
POST /api/payments/cash/
Authorization: Bearer <staff access JWT>
```

```json
{
  "order_id": 13,
  "amount": 50.00,
  "paid_at": "2026-08-03T14:30:00.000Z"
}
```

- Roles: `admin`, `employee`, `superadmin` only (clients get 403).
- `paid_at` is required (ISO date/datetime).
- Accepting staff is the JWT user (`created_by` on the Payment row).
- Success `201` returns payment + updated order fields including `amount_paid`, `balance`, `payment_status` (`pending` | `partially_paid` | `paid`).
- Overpay → `400` `AMOUNT_EXCEEDS_BALANCE`.
- Server SMS: **cash** full pay → active **superadmins only** (customer name + who received the cash). **MoMo** full pay → customer + superadmins. Partial payments, due reminders, and in-progress SMS are not sent. **Admins do not receive payment SMS.**

UI checklist:

- [ ] Staff form: select order, enter amount, pick/enter payment date
- [ ] On success, update list/detail with returned `balance` / `amount_paid` / `payment_status` (treat `partially_paid` as partial)
- [ ] Show who recorded cash from staff session (no separate acceptor field to send)
- [ ] Do **not** send `payment_status` on order create/update — it is computed from payments

---

## 3. Default passwords (`Trenor@{username}`)

### Client (staff create)

When staff creates a **client**:

1. Password is set to `Trenor@{username}`
2. Welcome SMS includes magic link + username + that password
3. API response does **not** include `default_password`

Staff should tell the customer to check SMS; do not display a password from the create response.

### Admin / employee / superadmin create

When those roles are created:

1. Password is `Trenor@{username}`
2. Create body **requires** `phone_number`
3. SMS sends username + password and asks them to keep credentials secret (**no** magic link)
4. API still returns `default_password` for the creator

Example staff create response:

```json
{
  "message": "Employee created successfully with default password",
  "user": { "id": 12, "username": "jane_doe", "role": "employee" },
  "default_password": "Trenor@jane_doe",
  "note": "User must change password on first login"
}
```

### Do / don’t

- **Do** require/collect Ghana-format `phone_number` when creating admin/employee/superadmin
- **Do** show `default_password` only for staff-role creates
- **Don’t** expect `default_password` on client create
- **Do** surface `phone_needs_correction` on client profiles; block “create order” until staff updates the phone (`422 PHONE_NEEDS_CORRECTION`)
- **Don’t** hardcode a global temp password in the FE
- **Don’t** put passwords in magic-link URLs
- Public self-register is unchanged — user chooses their own password

Existing accounts keep their previous passwords; only **new** creates use `Trenor@{username}`.
