// End-to-end check of the API: starts the server on a temporary data folder
// and walks through the main flows. Run with: npm test
"use strict";
var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");
var spawn = require("child_process").spawn;
var assert = require("assert");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelle-test-"));
var PORT = 3900 + Math.floor(Math.random() * 90);
var HOOK_PORT = PORT + 100;
var received = [];

var hookServer = http.createServer(function (req, res) {
  var b = [];
  req.on("data", function (c) { b.push(c); });
  req.on("end", function () {
    received.push({ headers: req.headers, body: Buffer.concat(b).toString() });
    res.end("ok");
  });
}).listen(HOOK_PORT);

var child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: Object.assign({}, process.env, { PORT: PORT, DATA_DIR: dir, ADMIN_EMAIL: "owner@test.com", ADMIN_PASSWORD: "test-password-1" }),
  stdio: ["ignore", "pipe", "inherit"]
});

function call(method, p, body, token) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : "";
    var req = http.request({ host: "127.0.0.1", port: PORT, path: p, method: method,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, token ? { Authorization: "Bearer " + token } : {}) }, function (res) {
      var b = [];
      res.on("data", function (c) { b.push(c); });
      res.on("end", function () {
        var t = Buffer.concat(b).toString();
        var j; try { j = JSON.parse(t); } catch (e) { j = t; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  for (var i = 0; i < 50; i++) { try { await call("GET", "/api/health"); break; } catch (e) { await wait(100); } }
  var r = await call("GET", "/api/store");
  assert.equal(r.status, 200);
  assert.equal(r.body.products.length, 15, "15 products");
  var product = r.body.products[0], variant = product.variants[1];
  console.log("✓ storefront data:", r.body.products.length, "products,", r.body.categories.length, "categories");

  r = await call("GET", "/api/orders");
  assert.equal(r.status, 401);
  r = await call("POST", "/api/auth/login", { email: "owner@test.com", password: "wrong" });
  assert.equal(r.status, 401);
  r = await call("POST", "/api/auth/login", { email: "owner@test.com", password: "test-password-1" });
  assert.equal(r.status, 200);
  var token = r.body.token;
  console.log("✓ login");

  // Webhook receiver
  r = await call("POST", "/api/webhooks", { url: "http://127.0.0.1:" + HOOK_PORT + "/hook", events: ["order.created", "chat.message.created", "stock.updated"] }, token);
  assert.equal(r.status, 201);
  var secret = r.body.item.secret;

  // Coupon
  r = await call("POST", "/api/coupons/validate", { code: "welcome10", subtotal: 1780 });
  assert.equal(r.body.discount, 178);
  r = await call("POST", "/api/coupons/validate", { code: "welcome10", subtotal: 500 });
  assert.equal(r.status, 400);
  console.log("✓ coupons");

  // Order
  var bad = await call("POST", "/api/orders", { customer: { name: "", phone: "123" }, items: [] });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.phone && bad.body.fields.agree);
  var noSize = await call("POST", "/api/orders", { customer: { name: "Test", phone: "01712345678", address: "House 1, Road 2, Dhaka" }, items: [{ productId: product.id, qty: 1 }], zone: "inside-dhaka", paymentMethod: "cod", agree: true });
  assert.equal(noSize.status, 400);
  var stockBefore = variant.stock;
  r = await call("POST", "/api/orders", { customer: { name: "Test Buyer", phone: "01712345678", address: "House 1, Road 2, Dhaka", city: "Dhaka" },
    items: [{ productId: product.id, variantId: variant.id, qty: 2 }], zone: "inside-dhaka", couponCode: "WELCOME10", paymentMethod: "cod", agree: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  var order = r.body.order;
  assert.equal(order.subtotal, product.price * 2);
  assert.equal(order.discount, Math.round(product.price * 2 * 0.1));
  assert.equal(order.shipping, 70);
  assert.equal(order.total, order.subtotal - order.discount + 70);
  r = await call("GET", "/api/products/" + product.id, null, token);
  assert.equal(r.body.product.variants[1].stock, stockBefore - 2);
  console.log("✓ order", order.number, "· total ৳" + order.total, "· stock reserved");

  r = await call("POST", "/api/orders/track", { number: order.number, phone: "01712345678" });
  assert.equal(r.status, 200);
  r = await call("PATCH", "/api/orders/" + order.number, { status: "cancelled", note: "Customer asked" }, token);
  assert.equal(r.body.order.status, "cancelled");
  r = await call("GET", "/api/products/" + product.id, null, token);
  assert.equal(r.body.product.variants[1].stock, stockBefore);
  console.log("✓ tracking and cancel restock");

  // Products
  r = await call("POST", "/api/products", { name: "Test Tee", price: 500, categoryIds: ["cat_men"], attributes: [{ name: "Size", values: ["M", "L"] }],
    variants: [{ options: { Size: "M" }, stock: 3 }, { options: { Size: "L" }, stock: 0 }] }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  var np = r.body.product;
  assert.ok(np.sku && np.variants[0].sku.indexOf(np.sku) === 0);
  r = await call("PATCH", "/api/stock", { items: [{ sku: np.variants[1].sku, stock: 9 }, { sku: "NOPE", stock: 1 }] }, token);
  assert.equal(r.body.results[0].stock, 9);
  assert.equal(r.body.results[1].ok, false);
  console.log("✓ products, SKUs and stock sync");

  // API key
  r = await call("POST", "/api/keys", { name: "AI chat", scope: "read" }, token);
  var readKey = r.body.key;
  r = await call("GET", "/api/orders", null, readKey);
  assert.equal(r.status, 200);
  r = await call("PATCH", "/api/stock", { items: [] }, readKey);
  assert.equal(r.status, 403);
  r = await call("GET", "/api/users", null, readKey);
  assert.equal(r.status, 403);
  r = await call("POST", "/api/keys", { name: "AI chat writer", scope: "write" }, token);
  var writeKey = r.body.key;
  console.log("✓ API keys and scopes");

  // Chat
  r = await call("POST", "/api/chat/start", { name: "Rina" });
  var chat = r.body;
  r = await call("POST", "/api/chat/" + chat.id + "/messages", { token: chat.token, text: "Do you have XL?" });
  assert.equal(r.status, 201);
  r = await call("GET", "/api/chat/" + chat.id + "?token=wrong");
  assert.equal(r.status, 404);
  r = await call("GET", "/api/chats?status=open", null, writeKey);
  assert.equal(r.body.chats.length, 1);
  r = await call("POST", "/api/chats/" + chat.id + "/messages", { text: "Yes, XL is in stock." }, writeKey);
  assert.equal(r.body.message.from, "bot");
  r = await call("GET", "/api/chat/" + chat.id + "?token=" + chat.token);
  assert.equal(r.body.messages[r.body.messages.length - 1].text, "Yes, XL is in stock.");
  console.log("✓ chat: visitor → API → visitor");

  // Dashboard
  r = await call("GET", "/api/dashboard?days=30", null, token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.series) && r.body.series.length === 30);
  console.log("✓ dashboard");

  // Media
  var png = "data:image/png;base64," + Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000105fe02fea70000000049454e44ae426082", "hex").toString("base64");
  r = await call("POST", "/api/media", { name: "dot.png", dataUrl: png }, token);
  assert.equal(r.status, 201);
  var got = await call("GET", r.body.item.url);
  assert.equal(got.status, 200);
  r = await call("GET", "/data/db.json");
  assert.equal(r.status, 404);
  r = await call("GET", "/assets/../data/db.json");
  assert.notEqual(r.status, 200);
  console.log("✓ media upload and private data folder");

  await wait(600);
  var events = received.map(function (x) { return x.headers["x-ravelle-event"]; });
  assert.ok(events.indexOf("order.created") > -1, "order.created webhook");
  assert.ok(events.indexOf("chat.message.created") > -1, "chat webhook");
  var one = received[0];
  var sig = "sha256=" + crypto.createHmac("sha256", secret).update(one.body).digest("hex");
  assert.equal(one.headers["x-ravelle-signature"], sig);
  console.log("✓ webhooks delivered and signed:", events.join(", "));
  console.log("\nAll checks passed.");
}

main().then(function () { done(0); }, function (e) { console.error("✗", e.message); done(1); });
function done(code) {
  hookServer.close();
  child.on("exit", function () {
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(code);
  });
  child.kill();
}
