// Security checks: each one is an attack that used to work (or could) against the store.
// Starts the server with its data folder inside the project, like a default install. Run with: npm run test:security
"use strict";
var http = require("http");
var net = require("net");
var fs = require("fs");
var path = require("path");
var spawn = require("child_process").spawn;
var assert = require("assert");

var ROOT = path.resolve(__dirname, "..");
var dirName = "data-sectest-" + process.pid;
var dir = path.join(ROOT, dirName);
var PORT = 4100 + Math.floor(Math.random() * 400);
var envProbe = path.join(ROOT, ".env.sectest-" + process.pid);
fs.writeFileSync(envProbe, "SECRET=do-not-leak\n");

var child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: Object.assign({}, process.env, { PORT: PORT, DATA_DIR: dirName, ADMIN_EMAIL: "owner@test.com", ADMIN_PASSWORD: "test-password-1", TRUST_PROXY: "" }),
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
        var t = Buffer.concat(b).toString();
        var j; try { j = JSON.parse(t); } catch (e) { j = t; }
        resolve({ status: res.statusCode, body: j, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}
// Sends a request line exactly as written (Node would clean up a bad path itself)
function rawGet(p) {
  return new Promise(function (resolve) {
    var s = net.connect(PORT, "127.0.0.1", function () { s.write("GET " + p + " HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"); });
    var out = "";
    s.on("data", function (d) { out += d; });
    s.on("end", function () { resolve(+((/^HTTP\/1\.1 (\d+)/.exec(out) || [])[1] || 0)); });
    s.on("error", function () { resolve(0); });
  });
}
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  for (var i = 0; i < 50; i++) { try { await call("GET", "/api/health"); break; } catch (e) { await wait(100); } }
  var owner = (await call("POST", "/api/auth/login", { email: "owner@test.com", password: "test-password-1" })).body.token;

  // 1. Reading the database, backups, .env or server code through /assets or /uploads
  var probes = ["/assets/..%2f" + dirName + "%2fdb.json", "/assets/..%2f.env.sectest-" + process.pid, "/assets/..%2fserver%2fserver.js", "/assets/..%5cpackage.json",
    "/uploads/..%2fdb.json", "/uploads/..%2fbackups%2f", "/assets/%2e%2e/package.json", "/docs/..%2fpackage.json"];
  for (var k = 0; k < probes.length; k++) {
    var st = await rawGet(probes[k]);
    assert.ok(st === 400 || st === 403 || st === 404, probes[k] + " answered " + st);
  }
  assert.equal(await rawGet("/assets/css/style.css"), 200);
  console.log("✓ no path escapes /assets or /uploads (database, .env and code stay private)");

  // 2. One broken address used to stop the whole server
  assert.equal(await rawGet("/%E0%A4%A"), 400);
  assert.equal(await rawGet("/api/products/%E0%A4%A"), 400);
  assert.equal((await call("GET", "/api/health")).status, 200, "check 1");
  console.log("✓ malformed addresses get an error, the store keeps running");

  // 3. A staff member who can open Users can't make themselves (or anyone) owner, or take over an owner
  var r = await call("POST", "/api/users", { name: "Helper", email: "helper@test.com", role: "custom", areas: ["users", "orders"], password: "helper-pass-1" }, owner);
  assert.equal(r.status, 201);
  var helperId = r.body.user.id;
  var helper = (await call("POST", "/api/auth/login", { email: "helper@test.com", password: "helper-pass-1" })).body.token;
  assert.equal((await call("PATCH", "/api/users/" + helperId, { role: "owner" }, helper)).status, 403, "check 2");
  assert.equal((await call("PATCH", "/api/users/" + helperId, { areas: ["users", "orders", "settings"] }, helper)).status, 403, "check 3");
  assert.equal((await call("POST", "/api/users", { name: "X", email: "x@test.com", role: "owner", password: "xxxxxxxx1" }, helper)).status, 403, "check 4");
  assert.equal((await call("POST", "/api/users", { name: "X", email: "x@test.com", role: "manager", password: "xxxxxxxx1" }, helper)).status, 403, "check 5");
  var me = (await call("GET", "/api/auth/me", null, owner)).body.user;
  assert.equal((await call("PATCH", "/api/users/" + me.id, { password: "taken-over-1" }, helper)).status, 403, "check 6");
  assert.equal((await call("DELETE", "/api/users/" + me.id, null, helper)).status, 403, "check 7");
  r = await call("GET", "/api/users", null, owner);
  assert.equal(r.body.users.filter(function (u) { return u.id === helperId; })[0].role, "custom", "refused change left nothing behind");
  assert.equal((await call("POST", "/api/users", { name: "Y", email: "y@test.com", role: "custom", areas: ["orders"], password: "yyyyyyyy1" }, helper)).status, 201, "check 8");
  console.log("✓ Users access can't be turned into owner access");

  // 4. A manager (Settings access) can't plant code on the store, redirect the Gmail password or the Acore key, or switch payments to sandbox
  await call("POST", "/api/users", { name: "Mgr", email: "mgr@test.com", role: "manager", password: "manager-pass-1" }, owner);
  var mgr = (await call("POST", "/api/auth/login", { email: "mgr@test.com", password: "manager-pass-1" })).body.token;
  r = await call("PUT", "/api/settings", { settings: { code: { head: "<script>steal()</script>" } } }, mgr); assert.equal(r.status, 403, "head: " + JSON.stringify(r.body).slice(0, 200));
  assert.equal((await call("PUT", "/api/settings", { settings: { code: { bodyEnd: "<script>x</script>" } } }, mgr)).status, 403, "check 9");
  assert.equal((await call("PUT", "/api/email-settings", { email: { host: "evil.example.com" } }, mgr)).status, 403, "check 10");
  assert.equal((await call("PUT", "/api/settings", { settings: { acore: { url: "https://evil.example.com" } } }, mgr)).status, 403, "check 11");
  var ssl = (await call("GET", "/api/settings", null, owner)).body.settings.payments.sslcommerz;
  assert.equal((await call("PUT", "/api/settings", { settings: { payments: { cod: true, sslcommerz: { enabled: true, sandbox: !ssl.sandbox, storeId: ssl.storeId || "" } } } }, mgr)).status, 403, "sandbox switch");
  assert.equal((await call("PUT", "/api/settings", { settings: { code: { pixelId: "123456789012" } } }, mgr)).status, 200, "managers still set the Pixel ID");
  assert.equal((await call("PUT", "/api/settings", { settings: { code: { head: "<!-- owner tag -->" } } }, owner)).status, 200, "check 13");
  var s = (await call("GET", "/api/settings", null, mgr)).body.settings;
  assert.ok(!/^whsec_/.test(s.acore.webhookSecret || ""), "managers don't see the Acore webhook secret");
  console.log("✓ custom code, email server, Acore and payment settings are owner-only");

  // 4b. Pathao: managers can't change or read the courier sign-in details, and a webhook needs the secret
  assert.equal((await call("PUT", "/api/settings", { settings: { pathao: { clientId: "x", clientSecret: "y", username: "a@b.c", password: "p" } } }, mgr)).status, 403, "manager sets Pathao login");
  assert.equal((await call("PUT", "/api/settings", { settings: { pathao: { clientId: "cid", clientSecret: "topsecret", username: "a@b.c", password: "pw-secret", webhookSecret: "hook-secret-1" } } }, owner)).status, 200, "owner sets Pathao");
  var ps = JSON.stringify((await call("GET", "/api/settings", null, mgr)).body.settings);
  assert.ok(ps.indexOf("topsecret") < 0 && ps.indexOf("pw-secret") < 0 && ps.indexOf("hook-secret-1") < 0, "Pathao secrets leak to a manager");
  ps = JSON.stringify((await call("GET", "/api/settings", null, owner)).body.settings);
  assert.ok(ps.indexOf("topsecret") < 0 && ps.indexOf("pw-secret") < 0, "Pathao secret and password are never sent back");
  assert.equal((await call("POST", "/api/pathao/webhook", { event: "order.delivered", merchant_order_id: "RV1001" })).status, 401, "unsigned Pathao webhook");
  assert.equal((await call("POST", "/api/pathao/webhook", { event: "order.delivered", merchant_order_id: "RV1001" }, null, { "X-PATHAO-Signature": "wrong" })).status, 401, "wrong Pathao signature");
  assert.equal((await call("GET", "/api/pathao/cities")).status, 401, "Pathao lists need sign-in");
  console.log("✓ Pathao sign-in details are owner-only and never sent back; webhooks need the secret");

  // 5. Menu links can't run code
  var menus = (await call("GET", "/api/menus")).body.menus;
  menus.header[0].url = "javascript:alert(document.domain)";
  menus.header.push({ label: "Tricky", url: " JaVa\tScRiPt:alert(1)", children: [] });
  r = await call("PUT", "/api/menus", { menus: menus }, owner);
  assert.equal(r.status, 200);
  assert.ok(r.body.menus.header.every(function (m) { return !/script:/i.test(m.url.replace(/\s/g, "")); }), "javascript: links removed");
  console.log("✓ javascript: links are dropped from menus");

  // 6. Uploads must really be images/PDFs, and are served sandboxed
  var fake = "data:image/png;base64," + Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
  assert.equal((await call("POST", "/api/media", { name: "x.png", dataUrl: fake }, owner)).status, 400, "check 14");
  assert.equal((await call("POST", "/api/files", { name: "x", dataUrl: "data:application/pdf;base64," + Buffer.from("<script>").toString("base64") }, owner)).status, 400);
  r = await call("POST", "/api/media", { name: "dot.png", dataUrl: PNG }, owner);
  assert.equal(r.status, 201);
  var file = await call("GET", r.body.item.url);
  assert.ok(/sandbox/.test(file.headers["content-security-policy"] || ""), "uploads are sandboxed");
  console.log("✓ fake images are refused; uploads can't run script");

  // 7. Admin page: strict CSP, can't be framed
  r = await call("GET", "/admin");
  assert.ok(/script-src 'self'/.test(r.headers["content-security-policy"] || ""));
  assert.equal(r.headers["x-frame-options"], "DENY");
  console.log("✓ admin page has a strict content security policy");

  // 8. Faking X-Forwarded-For no longer skips the login limit, and one account locks after 10 wrong passwords
  var codes = [];
  for (var n = 0; n < 12; n++) codes.push((await call("POST", "/api/auth/login", { email: "mgr@test.com", password: "wrong" + n }, null, { "X-Forwarded-For": "10.0.0." + n })).status);
  assert.ok(codes.indexOf(429) > -1, "rate limit applies even with fake forwarded addresses: " + codes.join(","));
  await wait(50);
  console.log("✓ fake X-Forwarded-For can't dodge the login limit");

  // 9. SSLCOMMERZ "fail" callback can't cancel a cash-on-delivery order
  var store = (await call("GET", "/api/store")).body, pr = store.products[0];
  r = await call("POST", "/api/orders", { items: [{ productId: pr.id, variantId: pr.variants[0].id, qty: 1 }], zone: store.settings.shipping.zones[0].id, paymentMethod: "cod", agree: true,
    customer: { name: "Test", phone: "01712345678", address: "House 1, Road 2, Dhaka" } });
  assert.equal(r.status, 201);
  var full = (await call("GET", "/api/orders/" + r.body.order.number, null, owner)).body.order;
  await call("POST", "/api/payments/sslcommerz/fail", { tran_id: full.id });
  full = (await call("GET", "/api/orders/" + r.body.order.number, null, owner)).body.order;
  assert.equal(full.status, "pending");
  console.log("✓ payment callbacks only touch online-payment orders");

  // 10. The same size in several bag lines can't buy more than is in stock
  var prod = (await call("GET", "/api/products/" + pr.id, null, owner)).body.product, v = prod.variants[0];
  await call("PATCH", "/api/stock", { items: [{ sku: v.sku, stock: 2 }] }, owner);
  r = await call("POST", "/api/checkout/quote", { items: [{ productId: pr.id, variantId: v.id, qty: 2 }, { productId: pr.id, variantId: v.id, qty: 2 }], zone: store.settings.shipping.zones[0].id });
  assert.equal(r.status, 409);
  console.log("✓ stock can't be oversold by splitting a size over several lines");

  console.log("\nAll security checks passed.");
}

main().then(function () { done(0); }, function (e) { console.error("✗", e.message); done(1); });
function done(code) {
  child.on("exit", function () {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(envProbe, { force: true });
    process.exit(code);
  });
  child.kill();
}
