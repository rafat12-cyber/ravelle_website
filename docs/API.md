# Ravelle store API

Every part of the store (products, stock, orders, customers, chat and more) can be read and changed over HTTPS with JSON. Use it to connect an AI chat reply tool, a courier or accounting system, a warehouse or POS, Google Sheets, Zapier, Make or your own app.

- **Base address:** your domain, for example `https://ravellebd.com`. All paths below start with `/api`.
- **Format:** send `Content-Type: application/json`; every answer is JSON.
- **Errors:** a non-2xx status with `{ "error": "Message", "fields": { "phone": "…" } }` (`fields` only on form errors).

## Authentication

Create a key in **Admin → API & webhooks → Create key** and send it with each request:

```
Authorization: Bearer rk_xxxxxxxxxxxxxxxxxxxx
```

(`X-Api-Key: rk_…` works too.)

| Key access | Can do |
|---|---|
| Read only | Every `GET` below |
| Read and write | Also create, change and delete: orders, products, stock, categories, variations, coupons, pages, menus, media, chats and messages |

Keys can never manage users, settings or other keys. The admin panel itself signs in with `POST /api/auth/login` and uses a session token the same way.

## Quick examples

```sh
# Pending orders, with items and addresses
curl -H "Authorization: Bearer $KEY" "https://ravellebd.com/api/orders?status=pending&full=1"

# Mark an order shipped and add the courier tracking number
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"shipped","tracking":"Pathao 12345678","note":"Sent with Pathao","notifyCustomer":true}' \
  https://ravellebd.com/api/orders/RV1001

# Set stock for two sizes, and take one off another
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"items":[{"sku":"RV-FRL-BLK-M","stock":12},{"sku":"RV-FRL-BLK-L","stock":8},{"sku":"RV-FRL-BLK-XL","delta":-1}]}' \
  https://ravellebd.com/api/stock

# Reply to a customer in live chat (shows as the bot)
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"text":"Yes, XL is in stock. Want me to hold one for you?"}' \
  https://ravellebd.com/api/chats/chat_ab12cd34ef56/messages
```

## Endpoints

### Orders

| Method | Path | What it does |
|---|---|---|
| GET | `/api/orders` | List orders, newest first. Query: `status`, `q` (number, name, phone, email), `from`, `to` (milliseconds), `full=1` for complete orders |
| GET | `/api/orders/:idOrNumber` | One order, e.g. `/api/orders/RV1001` |
| PATCH | `/api/orders/:idOrNumber` | `status` (pending, confirmed, processing, shipped, delivered, cancelled, returned), `paymentStatus` (unpaid, paid, refunded, failed), `tracking`, `note`, `notifyCustomer` |
| POST | `/api/orders` | Place an order (public; used by checkout). See below |

Cancelling or returning an order puts its items back in stock; reopening takes them out again.

An order looks like:

```json
{
  "id": "ord_…", "number": "RV1001", "createdAt": 1793000000000,
  "status": "pending", "paymentStatus": "unpaid", "paymentMethod": "cod",
  "customer": { "name": "Rina Akter", "phone": "01712345678", "email": "", "address": "House 1, Road 2, Banani", "city": "Dhaka" },
  "shippingZone": { "id": "inside-dhaka", "name": "Inside Dhaka", "days": "1–3 days" },
  "items": [{ "productId": "prd_…", "variantId": "var_…", "name": "Fearless Oversized T-shirt – Black", "sku": "RV-FRL-BLK-L",
              "options": { "Size": "L" }, "price": 890, "qty": 2, "lineTotal": 1780 }],
  "subtotal": 1780, "discount": 178, "coupon": "WELCOME10", "shipping": 70, "total": 1672,
  "tracking": "", "note": "", "history": [{ "at": 1793000000000, "status": "pending", "note": "Order placed", "by": "Customer" }]
}
```

Placing an order (`POST /api/orders`):

```json
{
  "customer": { "name": "…", "phone": "01712345678", "email": "", "address": "…", "city": "Dhaka" },
  "items": [{ "productId": "prd_…", "variantId": "var_…", "qty": 1 }],
  "zone": "inside-dhaka", "couponCode": "WELCOME10", "paymentMethod": "cod", "agree": true, "note": ""
}
```

Prices, delivery and discounts are always worked out on the server. `agree` must be `true` (terms, privacy and refund policy). With `paymentMethod: "sslcommerz"` the answer also has `payment.url`, the SSLCOMMERZ page to send the customer to.

### Products and stock

| Method | Path | What it does |
|---|---|---|
| GET | `/api/products` | All products with variations, SKUs and stock. Query: `q`, `category` (category id), `status` (published, draft) |
| GET | `/api/products/:idSlugOrSku` | One product |
| POST | `/api/products` | Create a product |
| PUT / PATCH | `/api/products/:id` | Update (send only the fields you change) |
| DELETE | `/api/products/:id` | Delete |
| POST | `/api/products/:id/duplicate` | Copy as a draft |
| GET | `/api/stock` | Stock for every SKU: `[{ sku, productId, name, options, stock }]` |
| PATCH | `/api/stock` | `{ "items": [{ "sku": "…", "stock": 10 }, { "sku": "…", "delta": -1 }] }`, up to 500 at once |

Product fields: `name`, `slug`, `sku`, `status`, `price`, `comparePrice`, `description`, `details` (list), `images` (list of URLs), `sizeGuide` (image URL), `categoryIds`, `line`, `color`, `hex`, `isNew`, `featured`, `trackStock`, `stock` (when there are no variations), `attributes` (`[{ "name": "Size", "values": ["M","L"] }]`) and `variants` (`[{ "options": { "Size": "M" }, "sku": "", "price": null, "stock": 5 }]`). Empty SKUs are generated; a `null` variant price uses the product price.

### Catalog

| Method | Path | What it does |
|---|---|---|
| GET | `/api/categories` | All categories (public) |
| POST / PUT / DELETE | `/api/categories`, `/api/categories/:id` | `name`, `slug`, `parentId`, `description`, `image`, `order` |
| GET | `/api/attributes` | Variation types such as Size and Colour (public) |
| POST / PUT / DELETE | `/api/attributes`, `/api/attributes/:id` | `name`, `type` (button, color), `values` (`[{ "label": "Black", "hex": "#111111" }]`) |
| GET / POST / PUT / DELETE | `/api/coupons`, `/api/coupons/:id` | `code`, `type` (percent, fixed, shipping), `value`, `minOrder`, `maxDiscount`, `maxUses`, `startsAt`, `endsAt`, `active`, `description` |

### Customers

| Method | Path | What it does |
|---|---|---|
| GET | `/api/customers` | Customers with `orders`, `spent` and `lastOrder`. Query: `q` |
| GET | `/api/customers/:id` | One customer and their orders |
| PATCH | `/api/customers/:id` | `note`, `tags` |

### Live chat (for an AI reply tool)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/chats` | Conversations. Query: `status` (open, closed), `since` (ms, only chats updated after), `messages=1` to include messages |
| GET | `/api/chats/:id` | One conversation with all messages |
| POST | `/api/chats/:id/messages` | Reply: `{ "text": "…" }`. With an API key it shows as the bot; add `"author": "Ravelle AI"` to change the name |
| PATCH | `/api/chats/:id` | `{ "status": "closed" }`, `{ "read": true }` |

How to wire an AI tool:

1. Create a read-and-write key.
2. Add a webhook for `chat.message.created`. Each new customer message is POSTed to your tool with the chat id, the message and the whole conversation so far.
3. Your tool answers with `POST /api/chats/:id/messages`. The customer sees it within a few seconds.
4. Turn off the automatic reply in **Admin → Settings → Live chat**.

No webhook endpoint? Poll `GET /api/chats?status=open&messages=1&since=<last time you checked>` every few seconds instead.

### Content

| Method | Path | What it does |
|---|---|---|
| GET | `/api/store` | Everything the storefront needs: settings, categories, variation types, published products, pages and menus (public) |
| GET / PUT | `/api/pages/:key` | Page text and images (`home`, `about`, `contact`, `terms`, `privacy`, `refund`, `delivery`). PUT `{ "page": { … } }` |
| GET / PUT | `/api/menus` | `{ "menus": { "header": [{ label, url, children }], "footer": [{ title, items }] } }` |
| GET / POST / PATCH / DELETE | `/api/media`, `/api/media/:id` | Media library. POST `{ "name": "photo.jpg", "dataUrl": "data:image/jpeg;base64,…" }` |
| GET / PATCH / DELETE | `/api/messages`, `/api/messages/:id` | Contact form messages; PATCH `{ "read": true }` |

### Analytics

`GET /api/dashboard?days=30` returns revenue, orders, average order, visitors and conversion for the period and the one before, a daily series, orders by status, revenue by payment method and delivery area, product analytics (views, add-to-bags, orders, units, revenue, conversion, stock), revenue by category, new and returning customers, low stock and recent orders.

## Webhooks

Add them in **Admin → API & webhooks**. When an event happens we POST this to your address:

```json
{ "id": "evt_…", "event": "order.created", "createdAt": 1793000000000, "data": { … } }
```

| Event | `data` |
|---|---|
| `order.created`, `order.updated` | The full order |
| `product.created`, `product.updated` | The product |
| `product.deleted` | `{ id, sku, name }` |
| `stock.updated` | `{ productId, sku, stock }` |
| `stock.low` | `{ productId, name, sku, options, stock }` when a SKU reaches the low-stock level |
| `customer.created` | The customer |
| `chat.message.created` | `{ chatId, message, chat }` (chat includes all messages) |
| `contact.created` | The contact message |
| `coupon.used` | `{ code, orderNumber, discount }` |

Headers: `X-Ravelle-Event`, `X-Ravelle-Delivery` (unique id) and `X-Ravelle-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw body using the webhook's secret. Check it before trusting the data:

```js
const crypto = require("crypto");
const expected = "sha256=" + crypto.createHmac("sha256", process.env.RAVELLE_WEBHOOK_SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-ravelle-signature"] || ""));
```

Answer with any 2xx status within 8 seconds. Failed deliveries are retried after 5 and 30 seconds; the last 300 attempts are listed in the admin.

## Limits

Public form endpoints are rate limited per IP address: sign-in 10 a minute, orders 10, contact 5, chat 40, coupon checks 30. Uploads can be up to 10 MB.
