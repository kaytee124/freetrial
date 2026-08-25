# Frontend: staff personalized client SMS

Admin and superadmin can send a custom SMS to selected clients or all active clients. Employees and clients get `403`.

Uses the same Moolre SMS outbox as payment/order SMS. Placeholders are optional.

---

## Auth

```http
Authorization: Bearer <admin or superadmin access token>
POST /api/notifications/sms/clients/
Content-Type: application/json
```

---

## Body

```json
{
  "message": "Hi {{first_name}}, Bubblebytes promo this week…",
  "user_ids": [12, 15, 22],
  "all_active": false
}
```

| Field | Rule |
|-------|------|
| `message` | Required, 1–**480** characters after trim |
| `user_ids` | Client **user** ids (same as client list / profile View). Use for select / select-all-on-page |
| `all_active` | If `true`, ignore `user_ids` and message every active client with a usable phone |

Require **either** non-empty `user_ids` **or** `all_active: true`.

Max **500** recipients per request (over → `400`).

### Placeholders

| Token | Value |
|-------|--------|
| `{{first_name}}` | User first name (blank if missing) |
| `{{last_name}}` | User last name |
| `{{username}}` | Username |

Same template for everyone; tokens are filled per recipient.

---

## Skips

Recipients are skipped (listed in `data.skips`) when:

- not found / not a client / inactive
- no customer profile
- no phone / invalid Ghana phone
- `phone_needs_correction`
- duplicate phone (already targeted in this request)

---

## Response

```json
{
  "status": "success",
  "message": "Broadcast SMS queued",
  "data": {
    "requested": 40,
    "targeted": 38,
    "sent": 35,
    "pending": 2,
    "skipped": 2,
    "failed_permanent": 1,
    "skips": [{ "user_id": 9, "reason": "no_phone" }]
  }
}
```

`sent` = Moolre accepted immediately. `pending` = outbox will retry. UI can show a toast from these counts.

---

## FE checklist

- [ ] Only show compose UI for admin / superadmin
- [ ] Multi-select from client list → send `user_ids`
- [ ] Optional “all active clients” → `all_active: true`
- [ ] Preview placeholders with sample name before send
- [ ] Surface `skips` / counts after send
