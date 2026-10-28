# Ravelle BD website

The online store for [Ravelle – A Life Style Brand](https://ravellebd.com/): storefront, checkout with SSLCOMMERZ, admin panel, live chat and an API for other software. It runs on Node.js with no other dependencies and keeps its data in one JSON file.

## What's in it

**Storefront** (`index.html`)

- Home page with the framed hero, collage, The House collections, offer poster, new arrivals and lookbook.
- Sticky header after you scroll, dropdown menus on desktop and a full menu drawer on phones. Both come from **Admin → Menus**.
- Shop, New in, On sale, every category and sub-category, search, saved items.
- Product page: photo gallery, SKU (changes with the size), stock status, **Size guide** button above the sizes that opens the product's size chart, out-of-stock sizes crossed out, a warning if a customer presses **Add to bag** or **Buy now** without a size, and **Buy now** straight to checkout.
- Checkout: delivery area and fee, coupon codes, cash on delivery or SSLCOMMERZ, and a required checkbox linking the Terms & conditions, Privacy policy and Return & refund policy. Order confirmation and order tracking.
- About us (with trade license, TIN and DBID), Contact us (form and details), Terms, Privacy (payment security and cookies), Return & refund and Delivery policies, all in the footer.
- Footer with every policy, contact details, legal numbers, payment methods and the SSLCOMMERZ banner.
- Live chat bubble, cookie notice, visitor and product analytics.

**Admin panel** (`/admin`)

- **Dashboard:** revenue, orders, average order, visitors, conversion, daily charts, orders by status, payment and area, product analytics (views, add-to-bags, orders, units, revenue, conversion), revenue by category, new and returning customers, low stock, recent orders and a setup checklist.
- **Orders:** filter, search, date range, CSV export, status and payment updates, courier tracking, notes, printable invoice. Cancelled and returned orders go back into stock.
- **Customers:** list with orders and spend, profile, tags and notes, CSV export.
- **Coupons:** percentage, fixed or free delivery; minimum order, cap, usage limit and dates.
- **Products:** photos, prices, categories, variations with their own SKU, price and stock, size guide image, draft or published, duplicate. **Stock** shows every SKU on one page.
- **Categories** and sub-categories, **Variations** (Size, Colour or any type you add).
- **Pages:** a visual editor. Click text in the live preview to type over it, click a photo to change it. The design stays fixed.
- **Menus:** header menu with dropdowns and footer columns, linking categories, pages or any address.
- **Media library**, **Live chat** inbox, contact **Messages**, **Users** with roles (owner, manager, content editor, support), **Settings** and **API & webhooks**.

**API and webhooks:** read and write orders, products, stock, customers and chats with API keys, and get signed webhooks when things happen. See [docs/API.md](docs/API.md). This is how an AI chat reply tool connects.

## Before you go live

1. In **Admin → Settings**, fill in your real **trade license**, **TIN**, **DBID**, phone and full address. They are placeholders now (`XXXX`).
2. Read the four policies in **Admin → Pages** and adjust them to how you actually work. They are drafts.
3. Add your **SSLCOMMERZ** Store ID in Settings and the store password in `.env`, test in sandbox mode, then switch to live.
4. Replace the sample size guide on each product with your real chart.
5. Change the admin password (**Your account**).

## Run it

Needs Node.js 18 or newer.

```sh
cp .env.example .env    # then edit it
npm start               # http://localhost:3000, admin at /admin
npm test                # end-to-end API check
```

On first start the store is filled with the 15 products and the categories from ravellebd.com, and the first admin account is made from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (a random password is printed if you leave it empty).

### `.env`

| Setting | Meaning |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `PUBLIC_URL` | Your public address, like `https://ravellebd.com`. Used for SSLCOMMERZ return links |
| `DATA_DIR` | Where the database, daily backups and uploaded images are kept (default `data`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account, only used when there are no users yet |
| `SSLC_STORE_ID`, `SSLC_STORE_PASSWORD` | SSLCOMMERZ merchant credentials |

### Hosting

Any host that runs Node.js works: a VPS (DigitalOcean, Vultr, a Bangladeshi VPS), cPanel with "Setup Node.js App", Render, Railway or Fly.io. Static-only hosting such as GitHub Pages or Netlify **can't** run the checkout, admin or API.

On a VPS:

```sh
git clone https://github.com/rafat12-cyber/ravelle_website.git && cd ravelle_website
cp .env.example .env && nano .env
npm install -g pm2 && pm2 start server/server.js --name ravelle && pm2 save && pm2 startup
```

Then put Nginx (or Caddy) in front for HTTPS and point your domain at it:

```nginx
server {
  server_name ravellebd.com www.ravellebd.com;
  client_max_body_size 20m;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }
}
```

Back up the `DATA_DIR` folder. It holds everything: `db.json`, `backups/` (one copy a day, 14 days) and `uploads/`.

### SSLCOMMERZ

The checkout sends the customer to SSLCOMMERZ and back to `/api/payments/sslcommerz/success|fail|cancel`. The IPN address to give SSLCOMMERZ is `https://your-domain/api/payments/sslcommerz/ipn`. Every payment is checked with SSLCOMMERZ's validation API before an order is marked paid.

## Demo mode

Open `index.html` straight from the folder, add `?demo` to the address, or host the files without the Node server, and the store runs entirely in your browser with sample orders, customers and chats so you can try the admin. Demo sign-in: `admin@ravellebd.com` / `ravelle-demo`. Nothing leaves the browser; **Reset** in the admin puts the sample data back.

## Structure

| Path | What it is |
|---|---|
| `index.html`, `assets/css/style.css`, `assets/js/store.js` | Storefront |
| `admin.html`, `assets/admin/` | Admin panel |
| `assets/js/core.js` | The store engine: every API route, validation, stock, coupons, orders and analytics. Shared by the server and demo mode |
| `assets/js/seed.js` | Starting data: products and categories from ravellebd.com, pages, policies, menus and settings |
| `assets/js/client.js` | Talks to the server, or runs the engine in the browser for the demo |
| `server/server.js` | Node server: static files, API, sessions, uploads, webhooks, SSLCOMMERZ |
| `server/test.js` | End-to-end test |
| `docs/API.md` | API and webhook guide |

Product photos live in `assets/img/products/` (front, front close-up, side and back for each product). Photos you add in the admin are stored in the data folder. If a photo can't load, the card shows the product name on a colour panel instead.
