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
- **Coupons & offers:** percentage, fixed or free delivery; minimum order, minimum items, only for some categories, cap, usage limit and dates. **Automatic offers** apply without a code (like "buy 2 tees, save ৳200") and the bag nudges "add 1 more". Codes can belong to an **influencer** with a commission, and a sales report shows orders, revenue and payout per code and per influencer.
- **Subscribers:** emails and phone numbers from the popup sign-up, the footer box and coming-soon pages, with CSV export and one-click **ad audience** files for Meta Custom Audiences and Google Customer Match.
- **Popup banner** can ask for an email or phone and hand out a welcome code, which is applied at checkout by itself.
- **Email:** invoice on every order, emails when an order is confirmed, shipped (with the courier tracking) and delivered, abandoned-cart reminders.
- **Products:** photos, prices, categories, variations with their own SKU, price and stock, size guide image, draft or published, duplicate. **Stock** shows every SKU on one page. **Bulk edit** changes regular and sale price, stock per size, name, status, New, Featured, stock tracking and categories for many products at once (or % off, add stock, etc. for the selected ones), and can download and upload the same thing as a CSV.
- **Categories** and sub-categories, **Variations** (Size, Colour or any type you add).
- **Pages:** a visual editor. Click text in the live preview to type over it, click a photo to change it. The design stays fixed.
- **Menus:** header menu with dropdowns and footer columns, linking categories, pages or any address.
- **Media library**, **Live chat** inbox, contact **Messages**, **Users** with roles (owner, manager, content editor, support), **Settings** and **API & webhooks**.

**Search engines and ads** (`server/seo.js`)

- Every page has a real address: `/product/<slug>`, `/product-category/<slug>`, `/shop`, `/new-in`, `/on-sale`, `/about`, `/contact`, `/store-locations`, `/franchise`, `/terms`, `/privacy`, `/refund`, `/delivery`. Old WooCommerce addresses (trailing slash, `/product-category/parent/child/`, `/cart`, `/my-account`, `/refund_returns`…) and old `#` links redirect to them, so old Google results and Facebook posts keep working.
- The server writes each page's own title, description, canonical address, Facebook/WhatsApp/X preview tags and schema.org data (Product with price, stock, shipping and return policy; breadcrumbs; Organization; WebSite search; ClothingStore for each shop) and sends readable page content before the JavaScript runs. Checkout, order, search and saved pages are `noindex`.
- `/sitemap.xml` and `/robots.txt` are generated from the catalog.
- Product feeds that update themselves: `/feeds/meta.csv` for Meta Commerce Manager (catalog ads, Shop) and `/feeds/google.xml` for Google Merchant Center (Shopping, free listings). The product id is the SKU, the same id the Pixel and GA4 send. Setup steps are in **Admin → Pixel & Analytics**. With a catalog ID and access token filled in there, every product create, edit, delete, stock change and order is also pushed to the Meta catalog within seconds (Graph API `items_batch`), and **Send all products to Meta now** pushes everything.
- Products and categories have optional "Title in Google" and "Description in Google" fields; categories also have a short text under the product grid.
- Text files and API replies are gzip-compressed; site photos are cached for 30 days and fonts for a year. Fonts are served from the site itself (`assets/fonts/`), not from Google. Phones and small cards load the smaller `-s` copy of each product photo.
- Set `PUBLIC_URL=https://ravellebd.com` in `.env` on the live server. Canonical links, the sitemap, feeds and emails use it.

**API and webhooks:** read and write orders, products, stock, customers and chats with API keys, and get signed webhooks when things happen. See [docs/API.md](docs/API.md). This is how an AI chat reply tool connects.

## Before you go live

1. In **Admin → Settings**, fill in your real **trade license**, **TIN**, **DBID**, phone and full address. They are placeholders now (`XXXX`).
2. Read the four policies in **Admin → Pages** and adjust them to how you actually work. They are drafts.
3. Add your **SSLCOMMERZ** Store ID in Settings and the store password in `.env`, test in sandbox mode, then switch to live.
4. Replace the sample size guide on each product with your real chart.
5. Change the admin password (**Your account**).
6. **Turn SSLCOMMERZ sandbox mode off** before taking real orders. In sandbox, test cards mark orders as paid.
7. Serve the site over **HTTPS** only, and keep `data/` and `.env` out of the web folder and out of git.
8. If the store runs behind nginx, Caddy, cPanel's Node app or Cloudflare, set `TRUST_PROXY=1` in `.env` so rate limits see real visitor addresses.

### Who can change what

Only an **owner** can change custom head/body code, the Gmail server and app password, Meta and GA secrets, the Acore address and key, and SSLCOMMERZ settings. Staff who can open **Users** can't give anyone more access than they have, and can't edit or remove an owner. An account locks for 15 minutes after 10 wrong passwords. `npm run test:security` checks all of this.

## Run it

Needs Node.js 18 or newer.

```sh
cp .env.example .env    # then edit it
npm start               # http://localhost:3000, admin at /admin
npm test                # end-to-end API check
```

On first start the store is filled with the 41 products from the October 2026 shoot and the categories from ravellebd.com, and the first admin account is made from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (a random password is printed if you leave it empty).

Forgot an admin password? Use **Forgot password?** on the admin sign-in page: it emails a one-time link (valid 30 minutes) once email is set up in **Email & reminders**. The owner can also set a staff member's password in **Users**. If nobody can sign in, stop the store and run `node server/reset-password.js you@example.com "new password"`, then start it again.

### `.env`

| Setting | Meaning |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `PUBLIC_URL` | Your public address, like `https://ravellebd.com`. Used for SSLCOMMERZ return links and email links. When it starts with `https`, admin sign-in only works at exactly `PUBLIC_URL/admin` (see below) |
| `DATA_DIR` | Where the database, daily backups and uploaded images are kept (default `data`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account, only used when there are no users yet |
| `SSLC_STORE_ID`, `SSLC_STORE_PASSWORD` | SSLCOMMERZ merchant credentials |
| `TRUST_PROXY` | `1` behind nginx, Caddy, cPanel or Cloudflare, so rate limits see the visitor's real address |
| `ADMIN_LOCK` | Leave empty. `0` turns off the admin address lock (only for testing on another address) |

### Admin address lock

On the live site (`PUBLIC_URL=https://ravellebd.com`) the admin panel only signs in at **https://ravellebd.com/admin**. `/admin.html` is gone, `/admin` opened on `www.`, the server IP, a hosting preview address or plain `http` is sent to that address, and the sign-in, forgot-password and reset calls are refused unless they come from that page. Signed-in staff and API keys for other software (Acore) work as before.

### Hosting

Any host that runs Node.js works: a VPS (DigitalOcean, Vultr, a Bangladeshi VPS), cPanel with "Setup Node.js App" (set the startup file to `server/server.js`, `TRUST_PROXY=1`, and `DATA_DIR` to a folder outside the app, like `/home/<user>/ravelle-data`), Render, Railway or Fly.io. Static-only hosting such as GitHub Pages or Netlify **can't** run the checkout, admin or API.

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

Open `index.html` straight from the folder, add `?demo` to the address (ignored on the live Node server), or host the files without the Node server, and the store runs entirely in your browser with the real products and pages and no orders or customers, so you can try the admin. Demo sign-in: `admin@ravellebd.com` / `ravelle-demo`. Nothing leaves the browser; **Reset** in the admin starts the demo over.

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

Product photos live in `assets/img/products/` (front, front close-up, side and back for each product). Each one has a smaller copy, `<name>-s.webp` (360 px wide), for phones and product cards; make it with `convert <name>.webp -resize 360x -strip -quality 80 <name>-s.webp` (ImageMagick). Try the Look models in `assets/img/home/look-N.webp` get one 600 px tall (`-resize x600`). If a copy is missing the server sends the full photo, so nothing breaks, it only loads slower. `npm test` lists any that are missing. To replace a photo in `assets/`, save it under a new file name, because browsers keep site photos for 30 days. Photos you add in the admin are stored in the data folder. If a photo can't load, the card shows the product name on a colour panel instead.
