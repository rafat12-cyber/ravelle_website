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
var tls = require("tls");
var net = require("net");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var querystring = require("querystring");
var zlib = require("zlib");

var ROOT = path.resolve(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

var PORT = +process.env.PORT || 3000;
var DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || "data");
var UPLOADS = path.join(DATA_DIR, "uploads");
var ASSETS = path.join(ROOT, "assets");
var DB_FILE = path.join(DATA_DIR, "db.json");
var PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/+$/, "");
var SSLC_ID = process.env.SSLC_STORE_ID || "";
var SSLC_PASS = process.env.SSLC_STORE_PASSWORD || "";
var HTTPS_SITE = /^https:/.test(PUBLIC_URL);
// Only trust X-Forwarded-For when the store runs behind your own proxy (nginx, Caddy, cPanel's Node app, Cloudflare).
// Otherwise anyone can send a fake address in that header and skip every rate limit.
var TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
// On the live site (PUBLIC_URL starts with https) the admin sign-in only works at exactly PUBLIC_URL/admin:
// www., the server IP, a hosting preview address or /admin.html all send you there or refuse,
// and the sign-in API refuses requests made from any other page.
var SITE = new URL(PUBLIC_URL);
var ADMIN_LOCK = HTTPS_SITE && process.env.ADMIN_LOCK !== "0";

var Core = require(path.join(ROOT, "assets/js/core.js"));
var SEED = require(path.join(ROOT, "assets/js/seed.js"));
var Seo = require("./seo.js");

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
var upgraded = Core.upgradeDb(db, SEED);
if (!db.users.length) {
  var email = (process.env.ADMIN_EMAIL || "admin@ravellebd.com").toLowerCase();
  var pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
  var salt = random(8);
  db.users.push({ id: "usr_" + random(6), name: "Owner", email: email, role: "owner", salt: salt, passwordHash: hashPassword(pw, salt), createdAt: Date.now() });
  console.log("\n  Admin login: " + email + " / " + pw + "\n  Change this password after you sign in.\n");
  saveNow();
} else if (upgraded) saveNow();

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
  if (!onlyHook) catalogWatch(event, data);
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
// Meta catalog: every product change is pushed to the catalog in Commerce Manager a few seconds after it's saved,
// so catalog ads and the Shop show the new price, photos and stock without waiting for the feed to be re-read.
var catalogPending = {}, catalogTimer = null, catalogStatus = null;
function catalogConf() {
  var c = Core.siteCode(db.settings);
  return c.catalogId && (c.catalogToken || c.capiToken) ? { id: c.catalogId, token: c.catalogToken || c.capiToken } : null;
}
function catalogWatch(event, data) {
  if (!catalogConf() || !data) return;
  var mark = function (pid, sku) { if (pid) catalogPending[pid] = catalogPending[pid] || sku || true; };
  if (event === "product.created" || event === "product.updated") mark(data.id, data.sku);
  else if (event === "product.deleted") catalogPending["deleted:" + data.sku] = data.sku;
  else if (event === "stock.updated") mark(data.productId, data.sku);
  // Orders take stock out (and cancelled or returned ones put it back)
  else if (event === "order.created" || event === "order.updated") (data.items || []).forEach(function (i) { mark(i.productId); });
  else return;
  clearTimeout(catalogTimer);
  catalogTimer = setTimeout(catalogFlush, 3000);
}
function catalogFlush() {
  var conf = catalogConf(), keys = Object.keys(catalogPending), base = PUBLIC_URL;
  catalogPending = {};
  if (!conf || !keys.length) return;
  var requests = [];
  keys.forEach(function (k) {
    if (k.indexOf("deleted:") === 0) return requests.push({ method: "DELETE", data: { id: k.slice(8) } });
    var p = db.products.filter(function (x) { return x.id === k; })[0];
    var item = p && p.status !== "draft" ? Seo.metaItem(db, base, p) : null;
    if (item) requests.push({ method: "UPDATE", data: item });
    else if (p && p.sku) requests.push({ method: "DELETE", data: { id: p.sku } });
  });
  catalogSend(conf, requests, "update");
}
function catalogSyncAll() {
  var conf = catalogConf();
  var requests = Seo.catalogProducts(db).map(function (p) { return { method: "UPDATE", data: Seo.metaItem(db, PUBLIC_URL, p) }; }).filter(function (r) { return r.data; });
  catalogSend(conf, requests, "sync");
  return { ok: true, sent: requests.length, message: "Sending " + requests.length + " products to the Meta catalog. The result shows here in a few seconds." };
}
function catalogSend(conf, requests, kind) {
  if (!requests.length) return;
  var chunks = [];
  for (var i = 0; i < requests.length; i += 1000) chunks.push(requests.slice(i, i + 1000));
  chunks.forEach(function (chunk) {
    var body = JSON.stringify({ access_token: conf.token, item_type: "PRODUCT_ITEM", allow_upsert: true, requests: chunk });
    var url = (process.env.META_GRAPH_URL || "https://graph.facebook.com/v21.0") + "/" + encodeURIComponent(conf.id) + "/items_batch";
    var req = (url.indexOf("https:") === 0 ? https : http).request(url, { method: "POST", timeout: 15000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, function (res) {
      readAll(res, function (txt) {
        var msg;
        try { var j = JSON.parse(txt); msg = j.error ? j.error.message : (kind === "sync" ? "Sent all " : "Updated ") + chunk.length + " product" + (chunk.length === 1 ? "" : "s"); } catch (e) { msg = "HTTP " + res.statusCode; }
        catalogStatus = { at: Date.now(), ok: res.statusCode === 200, count: chunk.length, message: String(msg).slice(0, 300) };
        if (res.statusCode !== 200) console.warn("Meta catalog:", msg);
      });
    });
    req.on("timeout", function () { req.destroy(new Error("Timed out")); });
    req.on("error", function (e) { catalogStatus = { at: Date.now(), ok: false, count: chunk.length, message: e.message }; });
    req.end(body);
  });
}
// Meta Conversions API: send one event straight to Meta from this server (no Google Tag Manager or other app)
var capiStatus = null;
function metaEvent(job) {
  var body = JSON.stringify(Object.assign({ data: [job.event] }, job.testCode ? { test_event_code: job.testCode } : {}));
  var url = (process.env.META_GRAPH_URL || "https://graph.facebook.com/v21.0") + "/" + encodeURIComponent(job.pixelId) + "/events?access_token=" + encodeURIComponent(job.token);
  var req = (url.indexOf("https:") === 0 ? https : http).request(url, { method: "POST", timeout: 8000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, function (res) {
    var chunks = "";
    res.on("data", function (d) { if (chunks.length < 2000) chunks += d; });
    res.on("end", function () {
      var msg = "";
      try { var j = JSON.parse(chunks); msg = j.error ? j.error.message : "Received " + (j.events_received || 0) + " event"; } catch (e) { msg = "HTTP " + res.statusCode; }
      capiStatus = { at: Date.now(), ok: res.statusCode === 200, event: job.event.event_name, message: String(msg).slice(0, 300) };
      if (res.statusCode !== 200) console.warn("Meta Conversions API:", msg);
    });
  });
  req.on("timeout", function () { req.destroy(new Error("Timed out")); });
  req.on("error", function (e) { capiStatus = { at: Date.now(), ok: false, event: job.event.event_name, message: e.message }; });
  req.end(body);
}
// Acore: send orders to Acore, retry the ones that failed, and take signed status updates back
var acoreLast = { send: null, webhook: null };
function acoreSend(job) {
  // Called from inside a request; send after it finishes so the order is saved first
  setImmediate(function () {
    var body = JSON.stringify(job.payload);
    var url = job.url + "/api/integrations/website/orders";
    var u;
    try { u = new URL(url); } catch (e) { return acoreDone(job, false, "", "The Acore address isn't valid."); }
    var req = (u.protocol === "https:" ? https : http).request(u, { method: "POST", timeout: 10000, headers: {
      "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Authorization": "Bearer " + job.apiKey, "User-Agent": "Ravelle-Website/1.0" } }, function (res) {
      var text = "";
      res.on("data", function (d) { if (text.length < 4000) text += d; });
      res.on("end", function () {
        var j = {};
        try { j = JSON.parse(text || "{}"); } catch (e) {}
        var ok = res.statusCode >= 200 && res.statusCode < 300;
        var errText = j.error && typeof j.error === "object" ? j.error.message || JSON.stringify(j.error) : j.error;
        acoreDone(job, ok, ok ? String(j.id || j.acore_order_id || (j.order && j.order.id) || (j.data && j.data.id) || "") : "", ok ? "" : (errText || j.message || "Acore answered " + res.statusCode));
      });
    });
    req.on("timeout", function () { req.destroy(new Error("Acore didn't answer in time.")); });
    req.on("error", function (e) { acoreDone(job, false, "", e.message); });
    req.end(body);
  });
}
function acoreDone(job, ok, acoreId, error) {
  acoreLast.send = { at: Date.now(), ok: ok, order: job.payload.number, message: ok ? "Sent" + (acoreId ? " · Acore id " + acoreId : "") : String(error).slice(0, 200) };
  if (!ok) console.warn("Acore: order " + job.payload.number + " not sent: " + error);
  try { run({ method: "POST", path: "/api/internal/acore-sent", internal: true, body: { orderId: job.orderId, ok: ok, acoreId: acoreId, error: error } }); } catch (e) { console.error(e); }
}
setInterval(function () {
  var out = core.handle({ method: "GET", path: "/api/internal/acore-due", internal: true }, db);
  ((out.body || {}).orders || []).forEach(acoreSend);
}, 2 * 60e3).unref();
function acoreWebhook(req, raw, body, res) {
  var secret = ((db.settings || {}).acore || {}).webhookSecret || "";
  var sent = String(req.headers["x-acore-signature"] || "").replace(/^sha256=/, "");
  var want = secret ? crypto.createHmac("sha256", secret).update(raw || "").digest("hex") : "";
  var good = !!(secret && sent.length === want.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(want)));
  if (!good) {
    acoreLast.webhook = { at: Date.now(), ok: false, message: "Rejected: the signature didn't match the webhook secret." };
    return sendJson(res, 401, { error: "Bad signature." });
  }
  if (!((db.settings.acore || {}).enabled)) return sendJson(res, 409, { error: "The Acore connection is turned off on the website." });
  // A timestamp more than 10 minutes off is a replayed or delayed message
  var ts = req.headers["x-acore-timestamp"];
  if (ts) {
    var tms = /^\d+$/.test(ts) ? (+ts < 1e12 ? +ts * 1000 : +ts) : Date.parse(ts);
    if (!tms || Math.abs(Date.now() - tms) > 10 * 60e3) {
      acoreLast.webhook = { at: Date.now(), ok: false, message: "Rejected: the timestamp is too old. Check the clock on the Acore server." };
      return sendJson(res, 401, { error: "Stale timestamp." });
    }
  }
  if (!body.id) body.id = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
  var out;
  try { out = run({ method: "POST", path: "/api/internal/acore", internal: true, body: body }); } catch (e) { console.error(e); return sendJson(res, 500, { error: "Something went wrong on the server." }); }
  var d = body.data || {};
  acoreLast.webhook = { at: Date.now(), ok: out.status < 400, message: (d.number || d.externalId || "?") + " · " + (d.status || body.event || "update") + (out.status < 400 ? "" : " · " + ((out.body || {}).error || out.status)) };
  return sendJson(res, out.status, out.body);
}

// Google Analytics 4 Measurement Protocol, straight from this server
var gaStatus = null;
function gaEvent(job) {
  var body = JSON.stringify(job.body), base = process.env.GA_MP_URL || ("https://www.google-analytics.com/" + (job.debug ? "debug/" : "") + "mp/collect");
  var url = base + "?measurement_id=" + encodeURIComponent(job.measurementId) + "&api_secret=" + encodeURIComponent(job.secret);
  var name = job.body.events[0].name;
  var req = (url.indexOf("https:") === 0 ? https : http).request(url, { method: "POST", timeout: 8000, headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, function (res) {
    var text = "";
    res.on("data", function (d) { if (text.length < 4000) text += d; });
    res.on("end", function () {
      var ok = res.statusCode >= 200 && res.statusCode < 300, msg = ok ? "Sent to Google Analytics" : "HTTP " + res.statusCode;
      // The debug endpoint (test button) explains what's wrong instead of silently accepting
      if (job.debug && ok) {
        try {
          var v = (JSON.parse(text || "{}").validationMessages || [])[0];
          if (v) { ok = false; msg = "Google says: " + v.description; } else msg = "Google accepted the test event. The ID and secret look right.";
        } catch (e) {}
      }
      gaStatus = { at: Date.now(), ok: ok, event: name, message: msg };
      if (!ok) console.warn("GA Measurement Protocol: HTTP " + res.statusCode);
    });
  });
  req.on("timeout", function () { req.destroy(new Error("Timed out")); });
  req.on("error", function (e) { gaStatus = { at: Date.now(), ok: false, event: name, message: e.message }; });
  req.end(body);
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
var EXT = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
// The first bytes of each allowed file type. A file that claims to be a photo but isn't one is refused.
function looksLike(buf, type) {
  var hex = buf.slice(0, 12).toString("hex"), asc = buf.slice(0, 12).toString("latin1");
  if (type === "image/png") return hex.indexOf("89504e470d0a1a0a") === 0;
  if (type === "image/jpeg") return hex.indexOf("ffd8ff") === 0;
  if (type === "image/gif") return /^GIF8[79]a/.test(asc);
  if (type === "image/webp") return asc.slice(0, 4) === "RIFF" && asc.slice(8, 12) === "WEBP";
  if (type === "image/avif") return asc.slice(4, 8) === "ftyp";
  if (type === "application/pdf") return asc.slice(0, 5) === "%PDF-";
  return false;
}
function saveMedia(name, dataUrl, type) {
  if (!EXT[type]) throw Object.assign(new Error("That file type isn't allowed."), { status: 400 });
  var buf = Buffer.from(String(dataUrl).split(",")[1] || "", "base64");
  if (!buf.length || !looksLike(buf, type)) throw Object.assign(new Error("That file doesn't look like a real " + EXT[type].toUpperCase() + "."), { status: 400 });
  var d = new Date(), dir = path.join(UPLOADS, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  var base = Core.slugify(String(name).replace(/\.[a-z0-9]+$/i, "")) || "image";
  var file = base + "-" + random(3) + "." + EXT[type];
  fs.writeFileSync(path.join(dir, file), buf);
  return { url: "/uploads/" + path.relative(UPLOADS, path.join(dir, file)).split(path.sep).join("/"), size: buf.length };
}
var TRASH_DIR = path.join(DATA_DIR, "trash");
function mediaPaths(url) {
  if (!/^\/uploads\/(\d{4}\/\d{2}\/)?[\w-]+\.\w+$/.test(url)) return null;
  var name = url.replace(/^\/uploads\//, "");
  return { live: path.join(UPLOADS, name), trash: path.join(TRASH_DIR, name) };
}
// Deleting an image moves the file to data/trash for 30 days; restoring moves it back
function trashMedia(url) {
  var p = mediaPaths(url); if (!p || !fs.existsSync(p.live)) return;
  fs.mkdirSync(path.dirname(p.trash), { recursive: true }); fs.renameSync(p.live, p.trash);
}
function restoreMedia(url) {
  var p = mediaPaths(url); if (!p || !fs.existsSync(p.trash)) return;
  fs.mkdirSync(path.dirname(p.live), { recursive: true }); fs.renameSync(p.trash, p.live);
}
function deleteMedia(url, fromTrash) {
  var p = mediaPaths(url); if (!p) return;
  var file = fromTrash ? p.trash : p.live;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---------------------------------------------------------------------------
// Email: a small SMTP client (Gmail: smtp.gmail.com, port 465 with an app password)
// ---------------------------------------------------------------------------
function b64(s) { return Buffer.from(String(s), "utf8").toString("base64"); }
function wrap76(s) { return s.replace(/.{1,76}/g, "$&\r\n").trim(); }
function mimeWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64(s) + "?="; }
function buildMessage(job) {
  var boundary = "rv_" + random(8), domain = String(job.from.email).split("@")[1] || "localhost";
  return [
    "From: " + mimeWord(String(job.from.name || "").replace(/["\r\n]/g, "")) + " <" + job.from.email + ">",
    "To: <" + job.to + ">",
    job.replyTo ? "Reply-To: <" + job.replyTo + ">" : null,
    "Subject: " + mimeWord(String(job.subject).replace(/[\r\n]/g, " ")),
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + random(12) + "@" + domain + ">",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    "",
    "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(b64(job.text || "")),
    "--" + boundary, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(b64(job.html || "")),
    "--" + boundary + "--", ""
  ].filter(function (l) { return l !== null; }).join("\r\n");
}
function smtpSend(job, cb) {
  var cfg = job.smtp, port = +cfg.port || 465, done = false, buf = "", step = 0, sock;
  var finish = function (err) { if (done) return; done = true; try { sock.end(); } catch (e) {} cb(err); };
  var plainOk = /^(localhost|127\.0\.0\.1)$/.test(cfg.host) && process.env.SMTP_ALLOW_PLAIN === "1"; // tests only
  var steps;
  var send = function (line) { sock.write(line + "\r\n"); };
  var onLine = function (code, text, last) {
    if (!last) return;
    var want = steps[step];
    if (!want) return;
    if (want.expect.indexOf(code) < 0) return finish(new Error("SMTP " + code + " " + text.slice(0, 160)));
    step++;
    if (want.then) want.then(text);
  };
  var attach = function (s) {
    sock = s;
    s.setEncoding("utf8");
    s.setTimeout(20000, function () { finish(new Error("The mail server didn't answer in time.")); });
    s.on("error", function (e) { finish(e); });
    s.on("data", function (d) {
      buf += d;
      var i;
      while ((i = buf.indexOf("\r\n")) > -1) {
        var line = buf.slice(0, i); buf = buf.slice(i + 2);
        onLine(+line.slice(0, 3), line.slice(4), line.charAt(3) !== "-");
      }
    });
  };
  var ehloText = "";
  var auth = [
    { expect: [250], then: function () { send("AUTH LOGIN"); } },
    { expect: [334], then: function () { send(b64(cfg.user)); } },
    { expect: [334], then: function () { send(b64(cfg.password)); } },
    { expect: [235], then: function () { send("MAIL FROM:<" + job.from.email + ">"); } },
    { expect: [250], then: function () { send("RCPT TO:<" + job.to + ">"); } },
    { expect: [250, 251], then: function () { send("DATA"); } },
    { expect: [354], then: function () { sock.write(buildMessage(job) + "\r\n.\r\n"); } },
    { expect: [250], then: function () { send("QUIT"); finish(null); } }
  ];
  if (port === 465) {
    steps = [{ expect: [220], then: function () { send("EHLO ravelle"); } }].concat(auth);
    attach(tls.connect({ host: cfg.host, port: port, servername: cfg.host }));
  } else {
    // 587: start plain, then switch to TLS with STARTTLS
    steps = [
      { expect: [220], then: function () { send("EHLO ravelle"); } },
      { expect: [250], then: function (t) {
        if (plainOk) { step = 1; steps = [null].concat(auth); send("EHLO ravelle"); return; }
        send("STARTTLS");
      } },
      { expect: [220], then: function () {
        var raw = sock; raw.removeAllListeners("data");
        buf = ""; step = 0;
        steps = [null].concat(auth); step = 1;
        attach(tls.connect({ socket: raw, servername: cfg.host }, function () { send("EHLO ravelle"); }));
      } }
    ];
    attach(net.connect(port, cfg.host));
  }
}
var emailQueue = [], emailBusy = false;
function sendEmail(job) {
  emailQueue.push(job);
  if (!emailBusy) nextEmail();
}
function nextEmail() {
  var job = emailQueue.shift();
  if (!job) { emailBusy = false; return; }
  emailBusy = true;
  smtpSend(job, function (err) {
    var e = (db.emailLog || []).filter(function (x) { return x.id === job.id; })[0];
    if (e) {
      e.ok = !err;
      e.status = err ? "Failed: " + (/535|534|Username and Password/i.test(err.message) ? "Gmail refused the login. Check the address and the 16-letter app password." : err.message) : "Sent";
      e.sentAt = Date.now();
      save();
    }
    if (err) console.error("Email to " + job.to + " failed:", err.message);
    setTimeout(nextEmail, 300);
  });
}
setInterval(function () { run({ method: "POST", path: "/api/internal/cart-reminders", internal: true, headers: {}, body: {}, query: {} }); }, +process.env.CART_SWEEP_MS || 60e3).unref();

var core = Core.create({
  now: Date.now, random: random, hashPassword: hashPassword, emit: emit, saveMedia: saveMedia, deleteMedia: deleteMedia, trashMedia: trashMedia, restoreMedia: restoreMedia,
  describeSettings: function (s) { s.payments.sslcommerz.serverReady = !!(SSLC_PASS && (SSLC_ID || s.payments.sslcommerz.storeId)); if (s.code) { s.code.capiStatus = capiStatus; s.code.gaStatus = gaStatus; s.code.catalogStatus = catalogStatus; } if (s.acore) { s.acore.lastSend = acoreLast.send; s.acore.lastWebhook = acoreLast.webhook; s.acore.webhookUrl = PUBLIC_URL + "/api/acore/webhook"; } },
  metaEvent: metaEvent, gaEvent: gaEvent, catalogSync: catalogSyncAll, acoreSend: acoreSend, sendEmail: sendEmail, publicUrl: PUBLIC_URL
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
  var back = function (state) { redirect(res, "/order/" + (order ? order.number : "") + "?payment=" + state); };
  if (!order) return back("missing");
  // Only online-payment orders can be touched by these callbacks (a forged "fail" can't cancel a cash-on-delivery order)
  if (order.paymentMethod !== "sslcommerz") return kind === "ipn" ? sendJson(res, 200, { ok: false }) : back("missing");
  if (kind !== "success" && kind !== "ipn") {
    if (order.paymentStatus !== "paid" && order.status === "pending") run({ method: "POST", path: "/api/internal/payment", internal: true, body: { orderId: order.id, status: kind === "cancel" ? "cancelled" : "failed" } });
    return kind === "ipn" ? sendJson(res, 200, { ok: true }) : back(kind);
  }
  validatePayment(body.val_id, function (err, v) {
    var good = !err && v && (v.status === "VALID" || v.status === "VALIDATED") && v.tran_id === order.id && Math.abs(+v.amount - order.total) < 1 &&
      (!v.currency_type || v.currency_type === "BDT") && (!v.currency || v.currency === "BDT");
    if (good) run({ method: "POST", path: "/api/internal/payment", internal: true, body: { orderId: order.id, status: "paid", ref: v.bank_tran_id || body.val_id } });
    if (kind === "ipn") return sendJson(res, 200, { ok: good });
    back(good ? "paid" : "failed");
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
var LIMITS = { "/api/acore/webhook": [600, 60e3], "/api/auth/login": [10, 60e3], "/api/auth/forgot": [5, 60e3], "/api/auth/reset": [10, 60e3], "/api/orders": [10, 60e3], "/api/contact": [5, 60e3], "/api/franchise": [5, 60e3], "/api/carts/capture": [30, 60e3], "/api/chat": [40, 60e3], "/api/track": [240, 60e3], "/api/coupons/validate": [30, 60e3], "/api/subscribe": [10, 60e3],
  "/api/orders/track": [15, 60e3], "/api/chat/start": [10, 60e3], "/api/payments": [60, 60e3], "/api/auth/reset/": [20, 60e3] };
var hits = {};
function limited(ip, p, method) {
  // Reset links are checked with GET, so that one counts too; other GETs are free
  var key = Object.keys(LIMITS).filter(function (k) { return p === k || p.indexOf(k + (k.slice(-1) === "/" ? "" : "/")) === 0; })
    .sort(function (a, b) { return b.length - a.length; })[0];
  if (method === "GET" && key !== "/api/auth/reset/") return false;
  if (!key || (key === "/api/orders" && p !== "/api/orders")) return false;
  var lim = LIMITS[key], id = ip + " " + key, t = Date.now();
  var h = hits[id] = (hits[id] || []).filter(function (x) { return x > t - lim[1]; });
  h.push(t);
  return h.length > lim[0];
}
setInterval(function () { hits = {}; }, 10 * 60e3).unref();

function clientIp(req) {
  var direct = req.socket.remoteAddress || "";
  if (!TRUST_PROXY) return direct;
  if (req.headers["cf-connecting-ip"]) return String(req.headers["cf-connecting-ip"]).trim();
  // The proxy adds the real visitor address at the end; anything before it can be made up by the visitor
  var list = String(req.headers["x-forwarded-for"] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
  return list[list.length - 1] || direct;
}
// Is this request for the real site address over https? (behind cPanel/Cloudflare the proxy tells us the scheme)
function onSite(req) {
  var host = String(req.headers.host || "").toLowerCase();
  if (host !== SITE.host) return false;
  var proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return !(TRUST_PROXY && proto === "http");
}
// Sign-in calls must come from the admin page on the real site address
var SIGN_IN = /^\/api\/auth\/(login|forgot|reset)(\/|$)/;
function fromAdminPage(req) {
  var from = req.headers.origin || req.headers.referer || "";
  try { from = new URL(from); } catch (e) { return false; }
  return from.origin === SITE.origin && onSite(req);
}
function run(req) {
  var out = core.handle(req, db);
  if (out.changed && out.status < 400) { save(); chatChanged(req, out); }
  setImmediate(flushOutbox);
  return out;
}

// Live chat without constant polling: when a chat window (or the admin inbox) asks for new messages with
// ?wait=1 and there are none yet, the server holds the request for up to 25 seconds and answers the moment
// a message arrives. Replies show instantly and an idle chat costs one request every 25 seconds, not every few.
var WAIT_MS = 25e3, MAX_WAITERS = 300, waiters = [];
function waitKey(p, query, out) {
  if (!query.wait || out.status !== 200) return "";
  var m = /^\/api\/chat\/([^/]+)$/.exec(p);
  if (m && out.body.messages && !out.body.messages.length) return "chat:" + m[1];
  if (p === "/api/chats" && query.since && out.body.chats && !out.body.chats.length) return "chats";
  return "";
}
function park(key, res, rerun, first) {
  if (waiters.length >= MAX_WAITERS) return sendJson(res, first.status, first.body);
  var w = { key: key, done: false };
  var stop = function () { if (w.done) return false; w.done = true; clearTimeout(w.timer); var i = waiters.indexOf(w); if (i > -1) waiters.splice(i, 1); return true; };
  w.fire = function () { if (!stop()) return; var out = rerun(); sendJson(res, out.status, out.body); };
  w.timer = setTimeout(w.fire, WAIT_MS);
  res.on("close", stop); // the visitor closed the window or left the page
  waiters.push(w);
}
function wake(keys) {
  waiters.filter(function (w) { return keys.indexOf(w.key) > -1; }).forEach(function (w) { setImmediate(w.fire); });
}
function chatChanged(req, out) {
  var m = /^\/api\/chats?\/([^/]+)/.exec(String(req.path || ""));
  if (!m || req.method === "GET") return;
  var id = m[1] === "start" ? out.body && out.body.id : m[1];
  wake(["chats", "chat:" + id]);
}

var server = http.createServer(function (req, res) {
  var u, p;
  // A broken address (like "/%E0%A4%A") used to throw here and stop the whole store
  try { u = new URL(req.url, "http://localhost"); p = decodeURIComponent(u.pathname); }
  catch (e) { return text(res, 400, "Bad request"); }
  // An encoded slash or backslash ("..%2f") would let a path climb out of /assets and read data/db.json or .env
  if (/[\\\0]/.test(p) || p.split("/").indexOf("..") > -1) return text(res, 400, "Bad request");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (HTTPS_SITE) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  try {
    if (ADMIN_LOCK && (p === "/admin" || p === "/admin/") && !onSite(req)) { res.writeHead(301, { Location: PUBLIC_URL + "/admin" + u.search }); return res.end(); }
    if (p.indexOf("/api/") === 0 || p === "/api") return api(req, res, u, p);
    return serveStatic(req, res, p, u.search);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) text(res, 500, "Something went wrong on the server.");
  }
});
// Last line of defence: log a bug instead of letting one bad request stop the store
process.on("uncaughtException", function (e) { console.error("Unexpected error:", e); });

function api(req, res, u, p) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  var ip = clientIp(req);
  if (limited(ip, p, req.method)) return sendJson(res, 429, { error: "Too many requests. Wait a minute and try again." });
  if (ADMIN_LOCK && SIGN_IN.test(p) && !fromAdminPage(req)) return sendJson(res, 403, { error: "Sign in at " + PUBLIC_URL + "/admin" });
  // Large bodies (photo uploads) only for signed-in staff, so nobody can tie up the server's memory with huge anonymous requests
  var signedIn = /^Bearer\s+\S/i.test(req.headers.authorization || "") || !!req.headers["x-api-key"];
  var max = signedIn && (p === "/api/media" || p === "/api/files" || /^\/api\/(pages|products|categories)/.test(p)) ? 16e6 : /^\/api\/chat\/[^/]+\/messages$/.test(p) ? 5e6 : 1e6;
  readBody(req, max, function (err, raw) {
    if (err) return sendJson(res, 413, { error: "That request is too large." });
    var body = {};
    var type = req.headers["content-type"] || "";
    try {
      if (/json/.test(type) && raw) body = JSON.parse(raw);
      else if (/urlencoded/.test(type)) body = querystring.parse(raw);
    } catch (e) { return sendJson(res, 400, { error: "The request body isn't valid JSON." }); }

    if (p === "/api/acore/webhook" && req.method === "POST") return acoreWebhook(req, raw, body, res);
    var ssl = /^\/api\/payments\/sslcommerz\/(success|fail|cancel|ipn)$/.exec(p);
    if (ssl) return paymentCallback(ssl[1], Object.assign({}, Object.fromEntries(u.searchParams), body), res);

    var query = Object.fromEntries(u.searchParams);
    var out, call = function () { return run({ method: req.method, path: p, query: query, body: body, headers: req.headers, ip: ip }); };
    try {
      out = call();
    } catch (e) {
      console.error(e);
      return sendJson(res, 500, { error: "Something went wrong on the server." });
    }
    var hold = req.method === "GET" && waitKey(p, query, out);
    if (hold) return park(hold, res, function () { try { return call(); } catch (e) { console.error(e); return { status: 500, body: { error: "Something went wrong on the server." } }; } }, out);
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
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8" };
// Cache busting: every CSS/JS link in the pages gets ?v=<fingerprint of the asset files>-<admin "Clear cache" version>,
// so after an update (or a click on Clear cache) browsers fetch the new files instead of an old saved copy.
var assetFp = { at: 0, v: "" };
function assetVersion() {
  if (Date.now() - assetFp.at > 5000) {
    var hash = crypto.createHash("sha1");
    ["assets/js", "assets/css", "assets/admin"].forEach(function (dir) {
      var d = path.join(ROOT, dir);
      (fs.existsSync(d) ? fs.readdirSync(d) : []).sort().forEach(function (n) {
        if (!/\.(js|css)$/.test(n)) return;
        var st = fs.statSync(path.join(d, n)); hash.update(dir + "/" + n + ":" + st.size + ":" + st.mtimeMs + ";");
      });
    });
    assetFp = { at: Date.now(), v: hash.digest("hex").slice(0, 10) };
  }
  return assetFp.v + (db.settings.cacheVersion ? "-" + db.settings.cacheVersion : "");
}
function versioned(html) {
  var v = assetVersion();
  return html.replace(/(assets\/[\w\/.-]+\.(?:js|css))\?v=[\w-]+/g, "$1?v=" + v)
    .replace("</head>", '<meta name="rv-v" content="' + v + '">\n</head>');
}
// The admin panel runs only its own files: an injected <script> can't run there or send the sign-in token anywhere
var ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; frame-src 'self' https://www.google.com https://maps.google.com; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
function serveAdmin(req, res) {
  fs.readFile(path.join(ROOT, "admin.html"), "utf8", function (err, html) {
    if (err) return text(res, 500, "Could not read the page.");
    send(req, res, 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": ADMIN_CSP }, versioned(html));
  });
}
// Sends a reply, gzip-compressed when the browser accepts it (text files shrink by about 70%)
var COMPRESS = /^(text\/|application\/(json|javascript|xml|rss\+xml)|image\/svg)/;
function send(req, res, status, headers, body) {
  var buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body == null ? "" : body), "utf8");
  if (buf.length > 1024 && COMPRESS.test(headers["Content-Type"] || "") && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    buf = zlib.gzipSync(buf, { level: 6 });
    headers["Content-Encoding"] = "gzip";
  }
  headers.Vary = "Accept-Encoding";
  headers["Content-Length"] = buf.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : buf);
}
// The public address used in links search engines see: PUBLIC_URL, or the address the visitor used
function siteBase(req) {
  if (process.env.PUBLIC_URL) return PUBLIC_URL;
  var host = String(req.headers.host || "localhost:" + PORT).replace(/[^\w.:-]/g, "");
  var proto = TRUST_PROXY && /^https$/i.test(String(req.headers["x-forwarded-proto"] || "")) ? "https" : "http";
  return proto + "://" + host;
}
// The store page, with this page's title, description, link-preview tags and structured data (server/seo.js),
// and the tracking code from Admin > Header & footer placed in <head> and before </body>
function serveIndex(req, res, p, search) {
  var page = Seo.resolve(db, siteBase(req), p || "/");
  if (page.redirect) { res.writeHead(301, { Location: page.redirect + (search || "") }); return res.end(); }
  fs.readFile(path.join(ROOT, "index.html"), "utf8", function (err, html) {
    if (err) return text(res, 500, "Could not read the page.");
    var head = Core.headCode(db.settings), end = Core.siteCode(db.settings).bodyEnd;
    html = Seo.announce(Seo.render(versioned(html), page), db.settings).replace("</head>", '<meta name="rv-code" content="server">\n' + head + "\n</head>")
      .replace(/<\/body>(?![\s\S]*<\/body>)/, end + "\n</body>");
    send(req, res, page.status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Frame-Options": "SAMEORIGIN" }, html);
  });
}
// Static text files, compressed once and kept in memory until the file changes
var gzCache = {};
function sendFile(req, res, file, st, headers) {
  var ext = path.extname(file).toLowerCase();
  if (!COMPRESS.test(headers["Content-Type"]) || st.size < 1024 || st.size > 5e6 || !/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    res.writeHead(200, Object.assign(headers, ext === ".webp" || COMPRESS.test(headers["Content-Type"]) ? { Vary: "Accept-Encoding" } : {}));
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  var key = file + "|" + st.mtimeMs, hit = gzCache[file];
  var done = function (gz) {
    delete headers["Content-Length"];
    headers["Content-Encoding"] = "gzip"; headers["Content-Length"] = gz.length; headers.Vary = "Accept-Encoding";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : gz);
  };
  if (hit && hit.key === key) return done(hit.gz);
  fs.readFile(file, function (err, raw) {
    if (err) { res.writeHead(500); return res.end(); }
    zlib.gzip(raw, { level: 9 }, function (e2, gz) {
      if (e2) { res.writeHead(200, headers); return res.end(raw); }
      gzCache[file] = { key: key, gz: gz };
      done(gz);
    });
  });
}
function serveStatic(req, res, p, search) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
  var file;
  if (p === "/index.html") { res.writeHead(301, { Location: "/" }); return res.end(); }
  else if (p === "/admin/") { res.writeHead(301, { Location: "/admin" }); return res.end(); }
  else if (p === "/admin") return serveAdmin(req, res);
  else if (p === "/robots.txt") return send(req, res, 200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }, Seo.robots(siteBase(req)));
  else if (p === "/sitemap.xml") return send(req, res, 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }, Seo.sitemap(db, siteBase(req)));
  // Product feeds for Meta Commerce Manager and Google Merchant Center (they fetch these on a schedule)
  else if (p === "/feeds/google.xml") return send(req, res, 200, { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900" }, Seo.googleFeed(db, siteBase(req)));
  else if (p === "/feeds/meta.csv") return send(req, res, 200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=900" }, Seo.metaFeed(db, siteBase(req)));
  else if (p.indexOf("/assets/") === 0) file = path.join(ROOT, p);
  else if (p.indexOf("/uploads/") === 0) file = path.join(UPLOADS, p.slice(9));
  else if (p === "/docs/API.md") file = path.join(ROOT, "docs/API.md");
  // Everything else is a store page: /product/<slug>, /product-category/<slug>, /shop, /about...
  // (unknown addresses get the store's "not found" page with a 404 status)
  else if (!/\.[a-z0-9]{2,5}$/i.test(p)) return serveIndex(req, res, p, search);
  else return text(res, 404, "Not found");
  var base = p.indexOf("/uploads/") === 0 ? UPLOADS : ROOT;
  // Files must stay inside /assets (or the uploads folder): never the database, backups, .env or the server code
  var inside = p === "/docs/API.md" ? path.join(ROOT, "docs") : base === UPLOADS ? UPLOADS : ASSETS;
  if (path.resolve(file).indexOf(inside + path.sep) !== 0) return text(res, 403, "Forbidden");
  fs.stat(file, function (err, st) {
    // A small copy of a site photo ("-s" / "-m") that doesn't exist yet: send the full photo instead
    if ((err || !st.isFile()) && base === ROOT && /-[sm]\.webp$/i.test(file)) {
      var full = file.replace(/-[sm]\.webp$/i, ".webp");
      return fs.stat(full, function (e2, st2) {
        if (e2 || !st2.isFile()) return text(res, 404, "Not found");
        sendFile(req, res, full, st2, { "Content-Type": "image/webp", "Content-Length": st2.size, "Last-Modified": st2.mtime.toUTCString(), "Cache-Control": "public, max-age=3600" });
      });
    }
    // Site images are WebP now; older saved data may still point at the .jpg/.png name
    if ((err || !st.isFile()) && base === ROOT && /\.(jpe?g|png)$/i.test(file)) {
      return fs.stat(file.replace(/\.(jpe?g|png)$/i, ".webp"), function (e2, st2) {
        if (e2 || !st2.isFile()) return text(res, 404, "Not found");
        res.writeHead(301, { Location: p.replace(/\.(jpe?g|png)$/i, ".webp") }); res.end();
      });
    }
    if (err || !st.isFile()) return text(res, 404, "Not found");
    var ext = path.extname(file).toLowerCase();
    var headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": st.size, "Last-Modified": st.mtime.toUTCString() };
    // Uploads never change name; CSS/JS with ?v= are cached for a year (a new version = a new URL); anything else is re-checked each time
    var versionedAsset = /[?&]v=/.test(req.url) && /\.(js|css)$/.test(ext);
    // Fonts never change; site photos change only with an update: kept 30 days, then refreshed in the background
    // (to change a photo in /assets, save the new one under a new file name so browsers fetch it)
    var media = /\.(webp|jpe?g|png|gif|avif|svg|ico)$/.test(ext);
    headers["Cache-Control"] = ext === ".html" ? "no-cache" : p.indexOf("/uploads/") === 0 || versionedAsset || ext === ".woff2" ? "public, max-age=31536000, immutable" :
      media ? "public, max-age=2592000, stale-while-revalidate=604800" : "no-cache";
    if (ext === ".html") headers["X-Frame-Options"] = "SAMEORIGIN";
    if (base === UPLOADS) { headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"; if (ext === ".pdf") headers["Content-Disposition"] = "inline"; }
    if (req.headers["if-modified-since"] === headers["Last-Modified"]) { res.writeHead(304); return res.end(); }
    sendFile(req, res, file, st, headers);
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
  if (res.req) return send(res.req, res, status, { "Content-Type": "application/json; charset=utf-8" }, body);
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
  var ssl = db.settings.payments.sslcommerz || {};
  if (ssl.enabled && ssl.sandbox && HTTPS_SITE) console.warn("\n  WARNING: SSLCOMMERZ is in sandbox (test) mode. Test cards will mark real orders as paid.\n  Turn sandbox off in Admin > Settings > Payments before taking real orders.\n");
  if (ADMIN_LOCK) console.log("  Admin sign-in only works at " + PUBLIC_URL + "/admin");
  if (!TRUST_PROXY && HTTPS_SITE) console.log("  Tip: behind nginx, Caddy, cPanel or Cloudflare, set TRUST_PROXY=1 so rate limits see each visitor's real address.");
});
