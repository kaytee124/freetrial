# Frontend: pickup notifications + client profile orders

In-app only (no SMS). **Admin and superadmin.** Employees and clients get `403 PERMISSION_DENIED`.

Pickup day is **`delivery_date`** (Accra calendar). `pickup_date` is ignored. Orders that are `picked_up` or `cancelled` are not shown.

Related: [payment-and-sms-flow.md](./payment-and-sms-flow.md).

---

## Auth

```http
Authorization: Bearer <admin or superadmin access token>
```

---

## 1. Bell preview — `GET /api/notifications/pickups/preview/`

On login / header bell: fetch this. `count` is the badge. `results` is at most **5** rows.

Sort: **missed first** (oldest `delivery_date`), then today’s, then **upcoming** (soonest `delivery_date`, then `delivery_time`, then `id`). Includes pickups due **today plus the next two Accra calendar days**.

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
| `pickup_today` | `delivery_date` is today; not picked up |
| `pickup_missed` | `delivery_date` is before today; not picked up (forgot / missed) |
| `pickup_upcoming` | `delivery_date` is tomorrow or the day after (within 48h / two Accra days) |

There is no mark-as-read. When staff sets `picked_up: true`, the row disappears on the next fetch.

---

## 2. View all — `GET /api/notifications/pickups/`

Same filter and sort as preview (missed, today, and upcoming within two Accra days). Paginated.

| Query | Notes |
|-------|--------|
| `page` | Default 1 |
| `page_size` | Default 20, max **200** |

Response envelope: `{ status, data: { count, page, page_size, total_pages, results } }` — same item shape as preview.

---

## 3. Client profile orders — `GET /api/accounts/staff/user/:userId/orders/`

Stay on the client profile. `userId` is the **user** id from View (not `customer.id`).

Admin or superadmin. `404` if the user is not a client.

Paginated, newest first. Same order objects as `GET /api/orders/list/`.

```http
GET /api/accounts/staff/user/42/orders/?page=1&page_size=20
```

Do **not** expect a full order list on `GET /api/accounts/staff/user/:userId/` or superadmin user detail — load this endpoint on the profile page.

Staff can mark an order completed from a profile row with `POST /api/orders/{id}/complete/` (see [frontend-handoff-2026-08-19.md](./frontend-handoff-2026-08-19.md)).

---

## FE checklist

- [ ] Bell only for admin / superadmin
- [ ] Preview on load; badge = `data.count`
- [ ] Dropdown shows `results` (≤5); missed / today / upcoming labelled clearly
- [ ] View all uses paginated pickups list (today + missed)
- [ ] Clicking a row can open `/orders/{order_id}`
- [ ] Client profile: paginate orders via `.../user/:userId/orders/` without leaving the page
