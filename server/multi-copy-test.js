// Two copies of the app on one data folder (what cPanel / LiteSpeed can do under heavy traffic) must never
// lose each other's orders, and orders lost before this fix can be recovered from the backups.
// Run with: npm run test:copies
"use strict";
var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var spawn = require("child_process").spawn;
var assert = require("assert");

var dir = fs.mkdtempSync(path.join(os.tmpdir(), "ravelle-copies-"));
var BASE = 4300 + Math.floor(Math.random() * 300);
var kids = [];
function start(port) {
  var child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, { PORT: port, DATA_DIR: dir, ADMIN_EMAIL: "owner@test.com", ADMIN_PASSWORD: "test-password-1", CART_SWEEP_MS: "500" }),
    stdio: ["ignore", "ignore", "inherit"]
  });
  kids.push(child);
  return child;
}
function stopAll() {
  var going = kids.map(function (k) { return new Promise(function (r) { if (k.exitCode !== null) return r(); k.on("exit", r); try { k.kill(); } catch (e) { r(); } }); });
  kids = [];
  return Promise.all(going);
}
function call(port, method, p, body, token) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : "";
    var req = http.request({ host: "127.0.0.1", port: port, path: p, method: method,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, token ? { Authorization: "Bearer " + token } : {}) }, function (res) {
      var b = [];
      res.on("data", function (c) { b.push(c); });
      res.on("end", function () { var t = Buffer.concat(b).toString(), j; try { j = JSON.parse(t); } catch (e) { j = t; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", reject);
    req.end(data);
  });
}
var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
async function up(port) { for (var i = 0; i < 80; i++) { try { await call(port, "GET", "/api/health"); return; } catch (e) { await wait(100); } } throw new Error("server didn't start"); }
var dbFile = path.join(dir, "db.json");
var readDb = function () { return JSON.parse(fs.readFileSync(dbFile, "utf8")); };

async function main() {
  var A = BASE, B = BASE + 1;
  start(A); await up(A); await stopAll();
  var first = readDb(); first.products.forEach(function (p) { (p.variants || []).forEach(function (v) { v.stock = 50; }); }); fs.writeFileSync(dbFile, JSON.stringify(first));
  start(A); await up(A);
  start(B); await up(B);
  var store = (await call(A, "GET", "/api/store")).body, product = store.products.filter(function (p) { return p.variants && p.variants.length && p.variants[0].stock >= 4; })[0];
  function order(port, name) {
    return call(port, "POST", "/api/orders", { customer: { name: name, phone: "01712345678", address: "House 1, Road 2, Dhaka", city: "Dhaka" },
      items: [{ productId: product.id, variantId: product.variants[0].id, qty: 1 }], zone: "inside-dhaka", paymentMethod: "cod", agree: true });
  }
  // Orders alternate between the two copies, and each copy saves other things in between
  var numbers = [];
  for (var i = 0; i < 6; i++) {
    var r = await order(i % 2 ? B : A, "Buyer " + i);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    numbers.push(r.body.order.number);
    await call(i % 2 ? A : B, "POST", "/api/carts/capture", { phone: "0171111111" + i, name: "Cart " + i, items: [] });
  }
  await wait(800); // both copies' background jobs save too
  var db = readDb();
  assert.equal(db.orders.length, 6, "all 6 orders are in db.json, none overwritten by the other copy");
  assert.equal(new Set(db.orders.map(function (o) { return o.number; })).size, 6, "no order number handed out twice");
  numbers.forEach(function (n) { assert.ok(db.orders.some(function (o) { return o.number === n; }), n + " saved"); });
  var log = fs.readFileSync(path.join(dir, "orders-log.jsonl"), "utf8").trim().split("\n");
  assert.ok(log.length >= 6, "every new order is in the order log");
  console.log("✓ two app copies on one database keep every order (" + numbers.join(", ") + ")");

  // Simulate the old bug: an older copy of the database (no orders) is written over db.json
  await stopAll();
  var keep = readDb();
  var backup = path.join(dir, "backups", fs.readdirSync(path.join(dir, "backups")).filter(function (f) { return /^db-/.test(f); })[0]);
  fs.writeFileSync(backup, JSON.stringify(keep)); // the daily backup still has the orders
  fs.unlinkSync(path.join(dir, "orders-log.jsonl"));
  var wiped = JSON.parse(JSON.stringify(keep));
  var stockBefore = wiped.products.filter(function (p) { return p.id === product.id; })[0].variants[0].stock;
  wiped.orders = wiped.orders.slice(0, 1); // one order survived; the copy then handed out RV numbers again
  var clash = JSON.parse(JSON.stringify(keep.orders[1]));
  clash.id = "ord_newone"; clash.customer.name = "New after wipe";
  wiped.orders.push(clash);
  var restocked = keep.products.filter(function (p) { return p.id === product.id; })[0].variants[0].stock + 5; // the wipe also undid the stock
  wiped.products.filter(function (p) { return p.id === product.id; })[0].variants[0].stock = restocked;
  fs.writeFileSync(dbFile, JSON.stringify(wiped));

  start(A); await up(A);
  var token = (await call(A, "POST", "/api/auth/login", { email: "owner@test.com", password: "test-password-1" })).body.token;
  var r2 = await call(A, "GET", "/api/orders-recovery", null, token);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(r2.body.orders.length, 5, "5 lost orders found in the backup");
  assert.ok(r2.body.orders.some(function (o) { return o.numberTaken; }), "number clash is flagged");
  var r3 = await call(A, "POST", "/api/orders-recovery", { ids: r2.body.orders.map(function (o) { return o.id; }), stock: true }, token);
  assert.equal(r3.status, 200, JSON.stringify(r3.body));
  assert.equal(r3.body.recovered.length, 5);
  var moved = r3.body.recovered.filter(function (x) { return x.formerNumber; });
  assert.equal(moved.length, 1, "the clashing order gets a new number");
  await wait(100);
  db = readDb();
  assert.equal(db.orders.length, 7, "1 survivor + 1 new + 5 recovered");
  assert.equal(new Set(db.orders.map(function (o) { return o.number; })).size, 7, "all numbers unique");
  assert.equal(db.products.filter(function (p) { return p.id === product.id; })[0].variants[0].stock, restocked - 5, "recovered orders take their stock again");
  r2 = await call(A, "GET", "/api/orders-recovery", null, token);
  assert.equal(r2.body.orders.length, 0, "nothing left to recover");
  var staff = await call(A, "GET", "/api/orders-recovery");
  assert.equal(staff.status, 401, "needs sign-in");
  console.log("✓ lost orders recovered from the daily backup, number clash renumbered, stock taken again (was " + stockBefore + ")");

  // db.json missing but backups exist: the store starts from the newest backup, not empty
  await stopAll();
  fs.unlinkSync(dbFile);
  start(A); await up(A);
  assert.ok(readDb().orders.length >= 6, "started from the backup");
  console.log("✓ a missing db.json starts from the newest backup instead of an empty store");
  await stopAll();
  console.log("\nAll multi-copy checks passed.");
}
main().catch(function (e) { console.error(e); stopAll(); process.exit(1); });
