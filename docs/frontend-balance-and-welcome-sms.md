# Frontend guide: order balance + customer welcome SMS

This document describes two backend changes the React apps should adopt:

1. **Order `balance`** on list and detail responses.
2. **Welcome SMS** when staff creates a customer (server-side side effect).

The backend is the source of truth. Prefer API money fields over client-only recalculation when they conflict.

Related docs:

- Order sheet shape: [frontend-order-sheet-changes.md](./frontend-order-sheet-changes.md)
- Payments and other SMS triggers: [payment-and-sms-flow.md](./payment-and-sms-flow.md)

---

## Summary

| Area | What changed | Frontend action |
|------|----------------|-----------------|
| Orders | Responses include `balance` | Show remaining balance from API on list + detail |
| Staff create customer | Welcome SMS with magic link + password | Do **not** expect `default_password` in the API; tell staff the client got SMS |
| Public register | Unchanged (no default-password SMS) | Do not show temporary-password / welcome-SMS UI |

---

## 1. Order `balance` on list and detail

Every order payload from:

- `GET /api/orders/list/`
- `GET /api/orders/:id/`
- create / update responses that return a full order

now includes these money fields as **strings**:

| Field | Meaning |
|-------|---------|
| `total_amount` | Order total |
| `amount_paid` | Sum of confirmed payments applied to the order |
| `balance` | Remaining due: `max(0, total_amount − amount_paid)` |

### Example

```json
{
  "total_amount": "89.50",
  "amount_paid": "0.00",
  "balance": "89.50"
}
```

After a partial payment:

```json
{
  "total_amount": "89.50",
  "amount_paid": "30.00",
  "balance": "59.50"
}
```

### Do / don’t

- **Do** display `balance` from the API next to total / paid on list rows and detail (or sheet summary).
- **Do** treat money fields as strings; parse with `parseFloat` only when you need local math or formatting.
- **Do** refetch the order (or list) after a successful payment so `amount_paid`, `balance`, and `payment_status` stay in sync.
- **Don’t** recompute balance for display of server data unless you are showing an unsaved local draft before create/update.
- **Don’t** send `balance` or `amount_paid` in order create/update bodies to change payment state — payments go through the payment APIs.

Payment UX (initialize, webhook, USSD) is unchanged; see [payment-and-sms-flow.md](./payment-and-sms-flow.md).

---

## 2. Staff-created customers + welcome SMS

### Trigger

```
POST /api/customers/create/
```

Staff / employee only. Public self-register is a different route and does **not** send a default-password welcome SMS.

### Success response (existing fields)

```json
{
  "message": "Customer created successfully. Login credentials were sent by SMS.",
  "user": { "id": 1, "username": "client_jane", "role": "client" },
  "customer": { "id": 12 },
  "note": "Customer must change password on first login. Default password is not returned in this response."
}
```

Credentials (`Trenor@{username}` + magic link) are sent by SMS only — staff UI must not expect `default_password` on client create.

### Server side effect (no FE call)

After the create transaction commits, the API sends a **welcome SMS** to the customer’s phone:

- Login URL from server env `CUSTOMER_APP_URL` (e.g. `https://laundry.bafrow-health.org`)
- Username
- Temporary / default password
- Ask the customer to change password after login

Recipient is normalized to international digits (`233…`) for Moolre. SMS failures are logged only — they do **not** fail the HTTP create.

### Phones in the request body

Send Ghana local format (`0…`), for example:

```json
{
  "username": "client_jane",
  "first_name": "Jane",
  "phone_number": "0502412618",
  "whatsapp_number": "0502412618",
  "address": "…",
  "preferred_contact_method": "phone"
}
```

The server normalizes and stores local `0…` form; SMS uses `233…`.

### Public register (unchanged)

```
POST /api/customers/register/
```

The customer chooses their own password. There is **no** default-password welcome SMS. Do not show temporary-password handoff UI on that flow.

---

## 3. What the frontend does not configure

- No frontend env for `CUSTOMER_APP_URL` / Moolre SMS keys. Default passwords are `Trenor@{username}` from the create response (not a shared FE constant).
- No public “send SMS” API route — welcome and order SMS are server side effects only.
- Do not hardcode the customer app host in the staff UI for SMS; the SMS body is built on the server. You may still deep-link your own SPA routes for in-app navigation.

---

## 4. Checklist for FE implementers

- [ ] Show `balance` on order list rows and detail / sheet summary next to total and paid.
- [ ] Treat `total_amount`, `amount_paid`, and `balance` as strings from the API.
- [ ] After successful payment (or staff payment update), refetch the order so `balance` updates.
- [ ] On staff create-customer success: confirm credentials were sent by SMS; do **not** look for `default_password` in the response.
- [ ] Keep public register unchanged — no temporary password / welcome SMS messaging.
