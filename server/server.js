#!/usr/bin/env node
// Ravelle store server. No dependencies: Node 18 or newer.
//
//   node server/server.js
//
// Serves the storefront (/), the admin panel (/admin), uploaded media
// (/uploads) and the REST API (/api). Data lives in DATA_DIR/db.json.
// Settings come from environment variables; see .env.example.
"use strict";

var http = require("http");
var https = require("https");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var querystring = require("querystring");

var ROOT = path.resolve(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

var PORT = +process.env.PORT || 3000;
var DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
var UPLOADS = path.join(DATA_DIR, "uploads");
var DB_FILE = path.join(DATA_DIR, "db.json");
var PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/+$/, "");
var SSLC_ID = process.env.SSLC_STORE_ID || "";
var SSLC_PASS = process.env.SSLC_STORE_PASSWORD || "";

var Core = require(path.join(ROOT, "assets/js/core.js"));
var SEED = require(path.join(ROOT, "assets/js/seed.js"));

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });

// ---------------------------------------------------------------------------
// Database: one JSON file, written atomically, with a daily backup
// ---------------------------------------------------------------------------
var db;
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
else {
  db = Core.freshDb(SEED);
  console.log("Created a new store database at " + DB_FILE);
}
if (!db.users.length) {
  var email = (process.env.ADMIN_EMAIL || "admin@ravellebd.com").toLowerCase();
  var pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  var salt = random(8);
  db.users.push({ id: "usr_" + random(6), name: "Owner", email: email, role: "owner", salt: salt, passwordHash: hashPassword(pw, salt), createdAt: Date.now() });
  console.log("\n  Admin login: " + email + " / " + pw + "\n  Change this password after you sign in.\n");
  saveNow();
}

var saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function saveNow() {
  clearTimeout(saveTimer);
  try { writeDb(); } catch (e) { console.error("Couldn't save the database:", e.message); }
}
function writeDb() {
  var tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  var day = new Date().toISOString().slice(0, 10);
  var backup = path.join(DATA_DIR, "backups", "db-" + day + ".json");
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(DB_FILE, backup);
    var old = fs.readdirSync(path.join(DATA_DIR, "backups")).filter(function (f) { return /^db-/.test(f); }).sort();
    old.slice(0, Math.max(0, old.length - 14)).forEach(function (f) { fs.unlinkSync(path.join(DATA_DIR, "backups", f)); });
  }
}
process.on("SIGINT", function () { saveNow(); process.exit(0); });
process.on("SIGTERM", function () { saveNow(); process.exit(0); });

function random(bytes) { return crypto.randomBytes(bytes).toString("hex"); }
function hashPassword(pw, salt) { return "scrypt$" + crypto.scryptSync(String(pw), String(salt), 32).toString("hex"); }

// ---------------------------------------------------------------------------
// Webhooks: signed with HMAC-SHA256, retried three times
// ---------------------------------------------------------------------------
var outbox = [];
function emit(event, data, database, onlyHook) {
  (database.webhooks || []).forEach(function (w) {
    if (onlyHook ? w.id !== onlyHook : !w.active || !(w.events.indexOf("*") > -1 || w.events.indexOf(event) > -1)) return;
    outbox.push({ hook: w, event: event, data: data, id: "evt_" + random(8), at: Date.now() });
  });
}
function flushOutbox() {
  var jobs = outbox.splice(0);
  jobs.forEach(function (job) { deliver(job, 1); });
}
function deliver(job, attempt) {
  var body = JSON.stringify({ id: job.id, event: job.event, createdAt: job.at, data: job.data });
  var sig = crypto.createHmac("sha256", job.hook.secret).update(body).digest("hex");
  postJson(job.hook.url, body, {
    "X-Ravelle-Event": job.event, "X-Ravelle-Delivery": job.id, "X-Ravelle-Signature": "sha256=" + sig
  }, function (err, status) {
    var ok = !err && status >= 200 && status < 300;
    db.webhookLog = (db.webhookLog || []).concat({ id: job.id + "_" + attempt, hookId: job.hook.id, url: job.hook.url, event: job.event, at: Date.now(),
      attempt: attempt, ok: ok, status: err ? String(err.message || err).slice(0, 120) : status }).slice(-300);
    var live = db.webhooks.filter(function (w) { return w.id === job.hook.id; })[0];
    if (live) live.lastStatus = { ok: ok, status: err ? "error" : status, at: Date.now() };
    save();
    if (!ok && attempt < 3) setTimeout(function () { deliver(job, attempt + 1); }, attempt === 1 ? 5000 : 30000);
  });
}
function postJson(url, body, headers, cb) {
  var u;
  try { u = new URL(url); } catch (e) { return cb(e); }
  var lib = u.protocol === "https:" ? https : http;
  var req = lib.request(u, { method: "POST", timeout: 8000, headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "Ravelle-Webhooks/1.0" }, headers) }, function (res) {
    res.resume();
    res.on("end", function () { cb(null, res.statusCode); });
  });
  req.on("timeout", function () { req.destroy(new Error("Timed out")); });
  req.on("error", function (e) { cb(e); });
  req.end(body);
}

// ---------------------------------------------------------------------------
// Media: uploads are saved as files under DATA_DIR/uploads
// ---------------------------------------------------------------------------
var EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
function saveMedia(name, dataUrl, type) {
  var buf = Buffer.from(dataUrl.split(",")[1], "base64");
  var d = new Date(), dir = path.join(UPLOADS, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  var base = Core.slugify(String(name).replace(/\.[a-z0-9]+$/i, "")) || "image";
  var file = base + "-" + random(3) + "." + EXT[type];
  fs.writeFileSync(path.join(dir, file), buf);
  return { url: "/uploads/" + path.relative(UPLOADS, path.join(dir, file)).split(path.sep).join("/"), size: buf.length };
}
function deleteMedia(url) {
  if (!/^\/uploads\//.test(url)) return;
  var file = path.join(UPLOADS, url.replace(/^\/uploads\//, ""));
  if (file.indexOf(UPLOADS) === 0 && fs.existsSync(file)) fs.unlinkSync(file);
}

var core = Core.create({
  now: Date.now, random: random, hashPassword: hashPassword, emit: emit, saveMedia: saveMedia, deleteMedia: deleteMedia,
  describeSettings: function (s) { s.payments.sslcommerz.serverReady = !!(SSLC_PASS && (SSLC_ID || s.payments.sslcommerz.storeId)); }
});

// ---------------------------------------------------------------------------
// SSLCOMMERZ
// ---------------------------------------------------------------------------
function sslHost() { return db.settings.payments.sslcommerz.sandbox ? "sandbox.sslcommerz.com" : "securepay.sslcommerz.com"; }
function sslStoreId() { return SSLC_ID || db.settings.payments.sslcommerz.storeId; }
function startPayment(order, cb) {
  if (!sslStoreId() || !SSLC_PASS) return cb(new Error("SSLCOMMERZ isn't set up on the server yet."));
  var form = querystring.stringify({
    store_id: sslStoreId(), store_passwd: SSLC_PASS, total_amount: order.total.toFixed(2), currency: "BDT", tran_id: order.id,
    success_url: PUBLIC_URL + "/api/payments/sslcommerz/success", fail_url: PUBLIC_URL + "/api/payments/sslcommerz/fail",
    cancel_url: PUBLIC_URL + "/api/payments/sslcommerz/cancel", ipn_url: PUBLIC_URL + "/api/payments/sslcommerz/ipn",
    cus_name: order.customer.name, cus_email: order.customer.email || "no-email@ravellebd.com", cus_add1: order.customer.address,
    cus_city: order.customer.city || "Dhaka", cus_country: "Bangladesh", cus_phone: order.customer.phone,
    shipping_method: "Courier", num_of_item: order.items.length, ship_name: order.customer.name, ship_add1: order.customer.address,
    ship_city: order.customer.city || "Dhaka", ship_postcode: "1000", ship_country: "Bangladesh",
    product_name: order.items.map(function (i) { return i.name; }).join(", ").slice(0, 250), product_category: "Clothing", product_profile: "physical-goods",
    value_a: order.number
  });
  var req = https.request({ host: sslHost(), path: "/gwprocess/v4/api.php", method: "POST", timeout: 15000,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form) } }, function (res) {
    readAll(res, function (text) {
      try {
        var j = JSON.parse(text);
        if (j.status === "SUCCESS" && j.GatewayPageURL) cb(null, j.GatewayPageURL);
        else cb(new Error(j.failedreason || "SSLCOMMERZ didn't accept the payment."));
      } catch (e) { cb(new Error("SSLCOMMERZ sent an unexpected reply.")); }
    });
  });
  req.on("timeout", function () { req.destroy(new Error("SSLCOMMERZ timed out.")); });
  req.on("error", cb);
  req.end(form);
}
function validatePayment(valId, cb) {
  var q = querystring.stringify({ val_id: valId, store_id: sslStoreId(), store_passwd: SSLC_PASS, format: "json" });
  https.get({ host: sslHost(), path: "/validator/api/validationserverAPI.php?" + q, timeout: 15000 }, function (res) {
    readAll(res, function (text) {
      try { cb(null, JSON.parse(text)); } catch (e) { cb(e); }
    });
  }).on("error", cb);
}
function paymentCallback(kind, body, res) {
  var orderId = body.tran_id;
  var order = db.orders.filter(function (o) { return o.id === orderId; })[0];
  var back = function (state) { redirect(res, "/#order/" + (order ? order.number : "") + "?payment=" + state); };
  if (!order) return back("missing");
  if (kind !== "success" && kind !== "ipn") {
    if (order.paymentStatus !== "paid") run({ method: "POST", path: "/api/internal/payment", internal: true, body: { orderId: order.id, status: kind === "cancel" ? "cancelled" : "failed" } });
    return kind === "ipn" ? sendJson(res, 200, { ok: true }) : back(kind);
  }
  validatePayment(body.val_id, function (err, v) {
    var good = !err && v && (v.status === "VALID" || v.status === "VALIDATED") && v.tran_id === order.id && Math.abs(+v.amount - order.total) < 1;
    if (good) run({ method: "POST", path: "/api/internal/payment", internal: true, body: { orderId: order.id, status: "paid", ref: v.bank_tran_id || body.val_id } });
    if (kind === "ipn") return sendJson(res, 200, { ok: good });
    back(good ? "paid" : "failed");
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
var LIMITS = { "/api/auth/login": [10, 60e3], "/api/orders": [10, 60e3], "/api/contact": [5, 60e3], "/api/chat": [40, 60e3], "/api/track": [240, 60e3], "/api/coupons/validate": [30, 60e3] };
var hits = {};
function limited(ip, p, method) {
  if (method === "GET") return false;
  var key = Object.keys(LIMITS).filter(function (k) { return p === k || p.indexOf(k + "/") === 0; })[0];
  if (!key || (key === "/api/orders" && p !== "/api/orders")) return false;
  var lim = LIMITS[key], id = ip + " " + key, t = Date.now();
  var h = hits[id] = (hits[id] || []).filter(function (x) { return x > t - lim[1]; });
  h.push(t);
  return h.length > lim[0];
}
setInterval(function () { hits = {}; }, 10 * 60e3).unref();

function run(req) {
  var out = core.handle(req, db);
  if (out.changed && out.status < 400) save();
  setImmediate(flushOutbox);
  return out;
}

var server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  var p = decodeURIComponent(u.pathname);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (p.indexOf("/api/") === 0 || p === "/api") return api(req, res, u, p);
  return serveStatic(req, res, p);
});

function api(req, res, u, p) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  var ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  if (limited(ip, p, req.method)) return sendJson(res, 429, { error: "Too many requests. Wait a minute and try again." });
  var max = p === "/api/media" || /^\/api\/(pages|products|categories)/.test(p) ? 16e6 : 1e6;
  readBody(req, max, function (err, raw) {
    if (err) return sendJson(res, 413, { error: "That request is too large." });
    var body = {};
    var type = req.headers["content-type"] || "";
    try {
      if (/json/.test(type) && raw) body = JSON.parse(raw);
      else if (/urlencoded/.test(type)) body = querystring.parse(raw);
    } catch (e) { return sendJson(res, 400, { error: "The request body isn't valid JSON." }); }

    var ssl = /^\/api\/payments\/sslcommerz\/(success|fail|cancel|ipn)$/.exec(p);
    if (ssl) return paymentCallback(ssl[1], Object.assign({}, Object.fromEntries(u.searchParams), body), res);

    var query = Object.fromEntries(u.searchParams);
    var out;
    try {
      out = run({ method: req.method, path: p, query: query, body: body, headers: req.headers, ip: ip });
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: "Something went wrong on the server." });
    }
    // Online payment: hand the customer to SSLCOMMERZ.
    if (p === "/api/orders" && req.method === "POST" && out.status === 201 && body.paymentMethod === "sslcommerz") {
      var order = db.orders.filter(function (o) { return o.number === out.body.order.number; })[0];
      return startPayment(order, function (e, url) {
        out.body.payment = e ? { error: e.message } : { url: url };
        sendJson(res, out.status, out.body);
      });
    }
    sendJson(res, out.status, out.body);
  });
}

var TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };
function serveStatic(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  var file;
  if (p === "/" || p === "/index.html") file = path.join(ROOT, "index.html");
  else if (p === "/admin/") { res.writeHead(301, { Location: "/admin" }); return res.end(); }
  else if (p === "/admin" || p === "/admin.html") file = path.join(ROOT, "admin.html");
  else if (p === "/robots.txt") return text(res, 200, "User-agent: *\nDisallow: /admin\nDisallow: /api/\n");
  else if (p.indexOf("/assets/") === 0) file = path.join(ROOT, p);
  else if (p.indexOf("/uploads/") === 0) file = path.join(UPLOADS, p.slice(9));
  else if (p === "/docs/API.md") file = path.join(ROOT, "docs/API.md");
  else return text(res, 404, "Not found");
  var base = p.indexOf("/uploads/") === 0 ? UPLOADS : ROOT;
  if (path.resolve(file).indexOf(base) !== 0) return text(res, 403, "Forbidden");
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) return text(res, 404, "Not found");
    var ext = path.extname(file).toLowerCase();
    var headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": st.size, "Last-Modified": st.mtime.toUTCString() };
    headers["Cache-Control"] = ext === ".html" ? "no-cache" : p.indexOf("/uploads/") === 0 ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    if (ext === ".html") headers["X-Frame-Options"] = "SAMEORIGIN";
    if (req.headers["if-modified-since"] === headers["Last-Modified"]) { res.writeHead(304); return res.end(); }
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req, max, cb) {
  var chunks = [], size = 0, done = false;
  req.on("data", function (c) {
    size += c.length;
    if (size > max && !done) { done = true; cb(new Error("too large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", function () { if (!done) { done = true; cb(null, Buffer.concat(chunks).toString("utf8")); } });
  req.on("error", function (e) { if (!done) { done = true; cb(e); } });
}
function readAll(res, cb) { var b = []; res.on("data", function (c) { b.push(c); }); res.on("end", function () { cb(Buffer.concat(b).toString("utf8")); }); }
function sendJson(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function text(res, status, s) { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); res.end(s); }
function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
}

server.listen(PORT, function () {
  console.log("Ravelle is running at " + PUBLIC_URL + "  (admin: " + PUBLIC_URL + "/admin)");
});
