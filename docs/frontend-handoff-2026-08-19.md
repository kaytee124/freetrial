# Frontend handoff — 19 Aug 2026

Pass this file to frontend. It covers **today’s API work**: one-click complete, in-app pickup notifications, and paginated client profile orders.

Related: [frontend-pickup-notifications.md](./frontend-pickup-notifications.md), [payment-and-sms-flow.md](./payment-and-sms-flow.md).

Shared list pagination: `page` (default 1), `page_size` (default 20, **max 200**).

---

## 1. Complete order (admin, employee, superadmin)

One-click. Empty body. Do **not** send `order_status`.

```http
POST /api/orders/{id}/complete/
Authorization: Bearer <staff access token>
```

| Role | Result |
|------|--------|
| admin, employee (worker), superadmin | 200 |
| client | 403 `PERMISSION_DENIED` |
| no token | 401 `NO_TOKEN` |
| cancelled order | 400 `VALIDATION_ERROR` |
| missing order | 404 `ORDER_NOT_FOUND` |

**200**

```json
{
  "status": "success",
  "message": "Order completed successfully",
  "data": { }
}
```

`data` is the same order object as `GET /api/orders/{id}/` / `GET /api/orders/list/` (`formatOrder`): `order_status` is `completed`, `completed_at` is set.

If the order is **already** `completed`, still **200** (no extra SMS).

Completed SMS still fires when status **changes** to completed (same as `PUT /api/orders/{id}/update/` with `{ "order_status": "completed" }`). Prefer this POST for the button.

**UI**

- Show **Complete** on order list, order detail, and client profile order rows.
- Hide or disable when `order_status` is `completed` or `cancelled`.
- After success, refresh the row from `data` (or refetch the page).

---

## 2. Pickup notifications (admin / superadmin only)

In-app only. **No SMS.** Employees and clients get `403`.

Pickup day = **`delivery_date`** (Accra calendar). Ignore `pickup_date`. Skip `picked_up = true` and `order_status = cancelled`.

No mark-as-read. When staff sets `picked_up: true`, the row disappears on the next fetch.

### Bell — `GET /api/notifications/pickups/preview/`

On login / header: fetch this. Badge = `data.count`. Dropdown = `data.results` (at most **5**).

Sort: **missed first** (oldest `delivery_date`), then today (`delivery_time`, then `id`).

```json
{
  "status": "success",
  "data": {
    "count": 12,
    "results": [
      {
        "kind": "pickup_missed",
        "order_id": 12,
        "order_number": "ORD-ABC12345",
        "customer_name": "John Doe",
        "customer_username": "john",
        "phone_number": "0240000001",
        "delivery_date": "2026-08-18",
        "delivery_time": "09:00:00",
        "order_status": "ready"
      }
    ]
  }
}
```

| `kind` | Meaning |
|--------|---------|
| `pickup_today` | Due today |
| `pickup_missed` | Due yesterday or earlier (not picked up) |
| `pickup_upcoming` | Due tomorrow or the next day (within two Accra days) |

### View all — `GET /api/notifications/pickups/`

Same filter/sort as preview (missed, today, and upcoming within two Accra days). Query: `page`, `page_size`.

Envelope: `{ status, data: { count, page, page_size, total_pages, results } }`.

Click a row → order detail. Optional: Complete button on that order if not completed/cancelled.

---

## 3. Client profile orders (admin / superadmin)

Stay on the profile. `userId` is the **user** id from View (not `customer.id`).

```http
GET /api/accounts/staff/user/{userId}/orders/?page=1&page_size=20
Authorization: Bearer <admin or superadmin access token>
```

- Employee / client: `403`
- Not a client: `404`
- Newest first
- Same order objects as `GET /api/orders/list/`

Do **not** expect a full order list on `GET /api/accounts/staff/user/:userId/` or superadmin user detail. Load page 1 on View; next page with this URL (do not navigate away).

Complete button on each row: `POST /api/orders/{order.id}/complete/`.

---

## 4. Also live (do not regress)

These are already in production/docs; keep them:

- **No in-progress SMS** (staff `in_progress` or auto at ≥30% paid). Status still becomes `in_progress`.
- **Receipt SMS on full pay only** (not partials).
  - MoMo / USSD: customer + every active superadmin.
  - Cash: **superadmin only** (not the customer). Admins/employees do not get payment SMS.
- **Due-reminder SMS is off** (job runs, sends nothing).
- **Revenue** on dashboards/reports is **paid** money only.
- Completed / schedule-change / pickup SMS still exist.

Full SMS/payment detail: [payment-and-sms-flow.md](./payment-and-sms-flow.md).

---

## FE checklist

- [ ] Complete button for admin, employee, superadmin on list, detail, and profile order rows
- [ ] Hide/disable Complete when `completed` or `cancelled`
- [ ] Bell only for admin / superadmin; badge = preview `count`
- [ ] Dropdown ≤5; missed labelled; View all uses paginated pickups list
- [ ] Profile: paginate via `.../user/:userId/orders/` without leaving the page
- [ ] `page_size` never above 200
