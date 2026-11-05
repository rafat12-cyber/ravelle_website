// Checks for search engines, feeds, offers, subscribers and order emails.
// Starts the server on a temporary data folder. Run with: npm run test:marketing
"use strict";
var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var zlib = require("zlib");
var spawn = require("child_process").spawn;
var assert = require("assert");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelle-mkt-"));
var PORT = 4100 + Math.floor(Math.random() * 90);
// A stand-in for Meta's Graph API, to see what the store sends to the catalog
var GRAPH_PORT = PORT + 200, graphCalls = [];
var graph = http.createServer(function (req, res) {
  var b = [];
  req.on("data", function (c) { b.push(c); });
  req.on("end", function () {
    graphCalls.push({ url: req.url, body: JSON.parse(Buffer.concat(b).toString() || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"handles":["h1"]}');
  });
}).listen(GRAPH_PORT);
var child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: Object.assign({}, process.env, { PORT: PORT, DATA_DIR: dir, ADMIN_EMAIL: "owner@test.com", ADMIN_PASSWORD: "test-password-1", PUBLIC_URL: "https://shop.example", ADMIN_LOCK: "0",
    META_GRAPH_URL: "http://127.0.0.1:" + GRAPH_PORT }),
  stdio: ["ignore", "pipe", "inherit"]
});

function call(method, p, body, token, headers) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : "";
    var req = http.request({ host: "127.0.0.1", port: PORT, path: p, method: method,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, token ? { Authorization: "Bearer " + token } : {}, headers || {}) }, function (res) {
      var b = [];
      res.on("data", function (c) { b.push(c); });
      res.on("end", function () {
        var raw = Buffer.concat(b);
        if (res.headers["content-encoding"] === "gzip") raw = zlib.gunzipSync(raw);
        var t = raw.toString(), j;
        try { j = JSON.parse(t); } catch (e) { j = t; }
        resolve({ status: res.statusCode, body: j, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
function ld(html) {
  var m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  return m ? JSON.parse(m[1])["@graph"] : [];
}

async function main() {
  for (var i = 0; i < 50; i++) { try { await call("GET", "/api/health"); break; } catch (e) { await wait(100); } }
  var store = (await call("GET", "/api/store")).body;
  var tees = store.products.filter(function (p) { return p.categoryIds.indexOf("cat_t_shirt") > -1; });
  var tee = tees[0], tee2 = tees[1];
  var pants = store.products.filter(function (p) { return p.categoryIds.indexOf("cat_trouser") > -1; })[0];
  assert.ok(tee && tee2 && pants, "seed has tees and trousers");

  // --- Page addresses and search engine tags -----------------------------------------------
  var r = await call("GET", "/product/" + tee.slug);
  assert.equal(r.status, 200);
  assert.ok(r.body.indexOf("<title>" + tee.name.replace(/&/g, "&amp;") + " | Ravelle</title>") > -1, "product title");
  assert.ok(r.body.indexOf('<link rel="canonical" href="https://shop.example/product/' + tee.slug + '">') > -1, "canonical uses PUBLIC_URL");
  assert.ok(/<meta property="og:image" content="https:\/\/shop\.example\/assets\/img\/products\//.test(r.body), "og:image is the product photo");
  assert.ok(r.body.indexOf('<base href="/">') > -1 && r.body.indexOf('name="rv-routes"') > -1, "base href and path routing");
  assert.ok(/<section class="ssr">[\s\S]*<h1>/.test(r.body) && r.body.indexOf('data-view="home" data-page="home" hidden') > -1, "readable page content, home hidden");
  var graph = ld(r.body), prod = graph.filter(function (x) { return x["@type"] === "Product"; })[0];
  assert.ok(prod && prod.sku === tee.sku && prod.offers.price === tee.price && prod.offers.priceCurrency === "BDT", "Product structured data");
  assert.ok(graph.some(function (x) { return x["@type"] === "BreadcrumbList"; }), "breadcrumbs");
  console.log("✓ product page: title, canonical, preview tags, Product + Offer data, readable content");

  r = await call("GET", "/product/" + tee.slug + "/?utm_source=fb");
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, "/product/" + tee.slug + "?utm_source=fb");
  r = await call("GET", "/product-category/men/t-shirt/");
  assert.equal(r.status, 301);
  r = await call("GET", "/product-category/t-shirt");
  assert.equal(r.status, 200);
  assert.ok(r.body.indexOf("Oversized T-shirts in Bangladesh | Ravelle") > -1, "category SEO title");
  assert.ok(r.body.indexOf('href="/product/' + tee.slug + '"') > -1, "category lists product links");
  r = await call("GET", "/refund_returns/");
  assert.equal(r.status, 301);
  r = await call("GET", "/refund_returns");
  assert.equal(r.headers.location, "/refund");
  r = await call("GET", "/checkout");
  assert.equal(r.status, 200);
  assert.ok(r.body.indexOf('content="noindex, follow"') > -1, "checkout is noindex");
  r = await call("GET", "/no-such-page");
  assert.equal(r.status, 404);
  r = await call("GET", "/product/not-a-product");
  assert.equal(r.status, 404);
  r = await call("GET", "/");
  assert.ok(ld(r.body).some(function (x) { return x["@type"] === "WebSite"; }), "home has WebSite data");
  console.log("✓ old WooCommerce addresses redirect, checkout noindex, unknown pages 404");

  r = await call("GET", "/sitemap.xml");
  assert.ok(r.body.indexOf("<loc>https://shop.example/product/" + tee.slug + "</loc>") > -1, "sitemap has products");
  assert.ok(r.body.indexOf("/product-category/t-shirt</loc>") > -1, "sitemap has categories");
  r = await call("GET", "/robots.txt");
  assert.ok(r.body.indexOf("Sitemap: https://shop.example/sitemap.xml") > -1);
  r = await call("GET", "/feeds/google.xml");
  assert.ok(r.body.indexOf("<g:id>" + tee.sku + "</g:id>") > -1 && r.body.indexOf("<g:sale_price>" + tee.price + ".00 BDT</g:sale_price>") > -1, "Google feed");
  r = await call("GET", "/feeds/meta.csv");
  assert.equal(r.body.split("\n")[0].split(",")[0], "id");
  assert.ok(r.body.indexOf(tee.sku + ",") > -1, "Meta feed");
  r = await call("GET", "/assets/js/store.js", null, null, { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], "gzip", "JS is compressed");
  r = await call("GET", "/api/store", null, null, { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], "gzip", "API is compressed");
  console.log("✓ sitemap, robots, Google and Meta feeds, gzip");

  // --- Offers -------------------------------------------------------------------------------
  var token = (await call("POST", "/api/auth/login", { email: "owner@test.com", password: "test-password-1" })).body.token;
  var line = function (p, q) { return { productId: p.id, variantId: p.variants[1].id, qty: q || 1 }; };
  r = await call("POST", "/api/coupons", { code: "BUY2TEES", type: "fixed", value: 200, auto: true, minQty: 2, categoryIds: ["cat_t_shirt"], description: "Buy 2 tees, save ৳200" }, token);
  assert.equal(r.status, 201);
  r = await call("POST", "/api/checkout/quote", { items: [line(tee), line(pants)] });
  assert.equal(r.body.discount, 0, "one tee: no offer");
  r = await call("POST", "/api/checkout/quote", { items: [line(tee), line(tee2), line(pants)] });
  assert.equal(r.body.discount, 200, "two tees: offer applies");
  assert.ok(r.body.coupon.auto);
  r = await call("POST", "/api/coupons/validate", { code: "BUY2TEES", subtotal: 5000 });
  assert.equal(r.status, 400, "an automatic offer can't be typed in");
  r = await call("GET", "/api/store");
  assert.ok(r.body.offers.some(function (o) { return o.code === "BUY2TEES" && o.minQty === 2; }), "store lists the offer");
  r = await call("POST", "/api/coupons", { code: "NABILA5", type: "percent", value: 5, owner: "Nabila", commission: 10 }, token);
  assert.equal(r.status, 201);
  r = await call("POST", "/api/checkout/quote", { items: [line(tee), line(tee2)], couponCode: "NABILA5" });
  assert.equal(r.body.coupon.code, "BUY2TEES", "the bigger discount wins");
  r = await call("POST", "/api/checkout/quote", { items: [line(pants)], couponCode: "NABILA5" });
  assert.equal(r.body.coupon.code, "NABILA5");
  var zone = store.settings.shipping.zones[0].id;
  var order = (await call("POST", "/api/orders", { customer: { name: "Rina Akter", phone: "01712345678", email: "rina@example.com", address: "House 1, Road 2, Dhanmondi", city: "Dhaka" },
    items: [line(pants, 2)], zone: zone, couponCode: "NABILA5", paymentMethod: "cod", agree: true })).body.order;
  assert.equal(order.coupon, "NABILA5");
  r = await call("GET", "/api/coupons/report?days=30", null, token);
  var nab = r.body.owners.filter(function (o) { return o.owner === "Nabila"; })[0];
  assert.ok(nab && nab.orders === 1 && nab.payout === Math.round(order.total * 0.1), "influencer report and payout");
  console.log("✓ automatic offer, best discount wins, influencer code report");

  // --- Order update emails --------------------------------------------------------------------
  r = await call("PATCH", "/api/orders/" + order.number, { status: "confirmed" }, token);
  assert.equal(r.status, 200);
  await call("PATCH", "/api/orders/" + order.number, { status: "processing" }, token);
  await call("PATCH", "/api/orders/" + order.number, { status: "confirmed" }, token);
  await call("PATCH", "/api/orders/" + order.number, { status: "shipped", tracking: "Pathao 12345678" }, token);
  var log = (await call("GET", "/api/email-settings", null, token)).body.log;
  var kinds = log.filter(function (l) { return l.ref === order.number; }).map(function (l) { return l.kind; });
  assert.equal(kinds.filter(function (k) { return k === "status-confirmed"; }).length, 1, "confirmed email once");
  assert.ok(kinds.indexOf("status-shipped") > -1, "shipped email");
  await call("PUT", "/api/email-settings", { email: { notifyDelivered: false } }, token);
  await call("PATCH", "/api/orders/" + order.number, { status: "delivered" }, token);
  log = (await call("GET", "/api/email-settings", null, token)).body.log;
  assert.ok(!log.some(function (l) { return l.kind === "status-delivered"; }), "delivered email can be turned off");
  console.log("✓ order update emails: confirmed and shipped, each once; delivered can be turned off");

  // --- Subscribers and the welcome code --------------------------------------------------------
  r = await call("POST", "/api/coupons", { code: "WELCOME10", type: "percent", value: 10 }, token);
  var pop = (await call("GET", "/api/pages/popup", null, token)).body.page;
  pop.capture = "either"; pop.welcomeCode = "WELCOME10";
  r = await call("PUT", "/api/pages/popup", { page: pop }, token);
  assert.equal(r.status, 200);
  r = await call("GET", "/api/store");
  assert.ok(!r.body.pages.popup.welcomeCode && r.body.pages.popup.hasCode, "the code isn't public");
  r = await call("GET", "/api/pages/popup");
  assert.ok(!r.body.page.welcomeCode, "nor through the pages API");
  r = await call("POST", "/api/subscribe", { email: "Fan@Example.com", source: "popup" });
  assert.equal(r.status, 201);
  assert.equal(r.body.code, "WELCOME10");
  r = await call("POST", "/api/subscribe", { phone: "01812345678", source: "new drops" });
  assert.ok(!r.body.code, "no code outside the popup");
  r = await call("POST", "/api/subscribe", { email: "fan@example.com", source: "new drops" });
  r = await call("POST", "/api/subscribe", { email: "not-an-email" });
  assert.equal(r.status, 400);
  r = await call("GET", "/api/subscribers", null, token);
  assert.equal(r.body.total, 2, "duplicates merge");
  r = await call("GET", "/api/subscribers");
  assert.equal(r.status, 401);
  r = await call("GET", "/api/audience?who=all", null, token);
  assert.ok(r.body.rows.some(function (x) { return x.phone === "+8801712345678" && x.kind === "buyer"; }), "buyers in the audience, phone in +880 format");
  assert.ok(r.body.rows.some(function (x) { return x.email === "fan@example.com"; }), "subscribers in the audience");
  console.log("✓ subscribers, popup welcome code, ad audience export");

  // --- Instant Meta catalog updates ---------------------------------------------------------------
  r = await call("PUT", "/api/settings", { settings: { code: { catalogId: "998877665544", catalogToken: "EAAtest" } } }, token);
  assert.equal(r.status, 200);
  r = await call("GET", "/api/settings", null, token);
  assert.ok(r.body.settings.code.catalogTokenSet && !r.body.settings.code.catalogToken, "the token isn't sent back");
  graphCalls = [];
  await call("PUT", "/api/products/" + tee2.id, { price: 777 }, token);
  await wait(3600);
  var up = graphCalls.filter(function (c) { return /\/998877665544\/items_batch$/.test(c.url); })[0];
  assert.ok(up, "product change sent to the catalog");
  assert.equal(up.body.access_token, "EAAtest");
  var item = up.body.requests.filter(function (x) { return x.data.id === tee2.sku; })[0];
  assert.ok(item && item.method === "UPDATE" && item.data.sale_price === "777.00 BDT" && item.data.link === "https://shop.example/product/" + tee2.slug, "the item has the new price and link");
  graphCalls = [];
  await call("DELETE", "/api/products/" + tee2.id, null, token);
  await wait(3600);
  assert.ok(graphCalls.some(function (c) { return c.body.requests.some(function (x) { return x.method === "DELETE" && x.data.id === tee2.sku; }); }), "deleted product removed from the catalog");
  graphCalls = [];
  r = await call("POST", "/api/catalog/sync", {}, token);
  assert.ok(r.body.sent > 30, "send all");
  await wait(500);
  assert.equal(graphCalls[0].body.requests.length, r.body.sent);
  console.log("✓ Meta catalog: edits and deletes pushed within seconds, send-all works");

  // --- Bulk edit ------------------------------------------------------------------------------------
  r = await call("GET", "/api/products/" + tee.id, null, token);
  var full = r.body.product, v0 = full.variants[0], v1 = full.variants[1];
  graphCalls = [];
  r = await call("POST", "/api/products/bulk", { updates: [
    { id: tee.id, price: 990, comparePrice: 1290, featured: true, variants: [{ id: v0.id, stock: 0 }, { id: v1.id, stock: 42 }] },
    { id: pants.id, status: "draft", categoryIds: pants.categoryIds.concat(["cat_men"]) }
  ] }, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saved, 2);
  r = await call("GET", "/api/products/" + tee.id, null, token);
  assert.equal(r.body.product.price, 990); assert.equal(r.body.product.comparePrice, 1290); assert.ok(r.body.product.featured);
  assert.equal(r.body.product.variants[0].stock, 0); assert.equal(r.body.product.variants[1].stock, 42);
  assert.equal(r.body.product.variants[2].stock, full.variants[2].stock, "sizes not sent stay as they were");
  assert.equal(r.body.product.variants[0].sku, v0.sku, "SKUs unchanged");
  r = await call("GET", "/api/products/" + pants.id, null, token);
  assert.equal(r.body.product.status, "draft");
  // One bad row stops the whole save
  r = await call("POST", "/api/products/bulk", { updates: [{ id: tee.id, price: 500 }, { id: pants.id, price: 900, comparePrice: 800 }] }, token);
  assert.equal(r.status, 400);
  assert.ok(/regular price must be more/.test(r.body.error), r.body.error);
  r = await call("GET", "/api/products/" + tee.id, null, token);
  assert.equal(r.body.product.price, 990, "nothing saved when one row is wrong");
  r = await call("POST", "/api/products/bulk", { updates: [{ id: tee.id, price: 500 }] });
  assert.equal(r.status, 401);
  await wait(3600);
  assert.ok(graphCalls.some(function (c) { return c.body.requests.some(function (x) { return x.data.id === tee.sku && x.data.sale_price === "990.00 BDT"; }); }), "bulk changes reach the Meta catalog");
  console.log("✓ bulk edit: prices, sizes, status and categories in one save; all-or-nothing; synced to Meta");
  console.log("\nAll marketing checks passed.");
}

main().then(function () { done(0); }, function (e) { console.error("✗", e.message); done(1); });
function done(code) {
  graph.close();
  child.on("exit", function () {
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  });
  child.kill();
}
