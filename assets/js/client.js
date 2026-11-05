// API client for the storefront and admin. On a server it calls /api; where
// there is no server (opening the files directly, or a static preview) it
// runs the same engine (core.js) in the browser against a demo database kept
// in localStorage (products and pages only, no sample orders or customers).
(function () {
  "use strict";

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/js\/client\.js.*$/, "") : "";
  })();
  var DB_KEY = "ravelle:demo-db:v28";
  var DEMO_LOGIN = { email: "admin@ravellebd.com", password: "ravelle-demo" };

  // The server stamps the current asset version on the page (cache busting); the demo uses the fixed one
  function assetV(fallback) { var m = document.querySelector('meta[name="rv-v"]'); return (m && m.content) || fallback; }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = BASE + src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(s);
    });
  }

  function detect() {
    if (location.protocol === "file:") return Promise.resolve("demo");
    // ?demo forces the browser demo, but never on a page served by the store server
    if (/[?&]demo\b/.test(location.search) && !document.querySelector('meta[name="rv-v"]')) return Promise.resolve("demo");
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 3000);
    return fetch(BASE + "api/health", { signal: ctl ? ctl.signal : undefined, cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { clearTimeout(timer); return j && j.ravelle ? "server" : "demo"; })
      .catch(function () { clearTimeout(timer); return "demo"; });
  }

  // ---------------------------------------------------------------------------
  // Demo engine
  // ---------------------------------------------------------------------------
  var demo = null;
  function hex(bytes) {
    var a = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  function demoHash(pw, salt) {
    var h = String(salt) + ":" + pw;
    for (var i = 0; i < 300; i++) h = RavelleCore.sha256(h + salt);
    return "sha256$" + h;
  }
  function readDb() {
    try { var raw = localStorage.getItem(DB_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  function writeDb(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { throw { status: 507, message: "This browser is out of storage for the demo. Delete some media or reset the demo." }; }
  }
  function startDemo() {
    var host = {
      now: Date.now, random: hex, hashPassword: demoHash,
      emit: function (event, data, db, onlyHook) {
        (db.webhooks || []).forEach(function (w) {
          if (onlyHook ? w.id !== onlyHook : !w.active || !(w.events.indexOf("*") > -1 || w.events.indexOf(event) > -1)) return;
          db.webhookLog = (db.webhookLog || []).concat({ id: "evt_" + hex(6), hookId: w.id, url: w.url, event: event, at: Date.now(), attempt: 1, ok: null, status: "Demo: not sent" }).slice(-300);
        });
      },
      saveMedia: function (name, dataUrl) { return { url: dataUrl, size: Math.round(dataUrl.length * 0.75) }; },
      describeSettings: function (s) { s.payments.sslcommerz.serverReady = false; s.demo = true; }
    };
    var engine = RavelleCore.create(host);
    if (!readDb()) writeDb(buildDemoDb());
    demo = {
      call: function (method, path, body, token) {
        var db = readDb() || buildDemoDb();
        // the server sends cart reminders every minute; the demo checks on each request
        if (engine.handle({ method: "POST", path: "/api/internal/cart-reminders", internal: true, body: {}, query: {}, headers: {} }, db).body.sent) writeDb(db);
        var q = {}, parts = path.split("?");
        if (parts[1]) parts[1].split("&").forEach(function (kv) { var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
        var out = engine.handle({ method: method, path: parts[0], query: q, body: body ? JSON.parse(JSON.stringify(body)) : {}, headers: token ? { authorization: "Bearer " + token } : {} }, db);
        if (out.changed && out.status < 400) writeDb(db);
        // Online payment in the demo: pretend the customer paid.
        if (method === "POST" && parts[0] === "/api/orders" && out.status === 201 && body.paymentMethod === "sslcommerz") {
          var o = db.orders.filter(function (x) { return x.number === out.body.order.number; })[0];
          engine.handle({ method: "POST", path: "/api/internal/payment", internal: true, body: { orderId: o.id, status: "paid", ref: "DEMO-" + hex(4).toUpperCase() } }, db);
          writeDb(db);
          out.body.payment = { demo: true };
        }
        return out;
      }
    };
  }

  // Demo database: products, pages and settings from the seed and one owner login.
  // No sample orders, customers, carts, analytics, chats or messages.
  function buildDemoDb() {
    var db = RavelleCore.freshDb(window.RAVELLE_SEED);
    db.demo = true;
    var salt = hex(8);
    db.users.push({ id: "usr_demo", name: "Rafat", email: DEMO_LOGIN.email, role: "owner", salt: salt, passwordHash: demoHash(DEMO_LOGIN.password, salt), createdAt: Date.now() });
    return db;
  }

  // ---------------------------------------------------------------------------
  // Public client
  // ---------------------------------------------------------------------------
  var mode = null;
  var ready = detect().then(function (m) {
    mode = m;
    if (m === "server") return m;
    return (window.RavelleCore ? Promise.resolve() : loadScript("assets/js/core.js?v=" + assetV("1172")))
      .then(function () { return window.RAVELLE_SEED ? null : loadScript("assets/js/seed.js?v=" + assetV("1168")); })
      .then(function () { startDemo(); return m; });
  });

  function call(method, path, body, token) {
    return ready.then(function () {
      if (mode === "demo") {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            try {
              var out = demo.call(method, path, body, token);
              if (out.status >= 400) reject({ status: out.status, message: out.body.error, fields: out.body.fields });
              else resolve(out.body);
            } catch (e) { reject(e && e.status ? e : { status: 500, message: String(e && e.message || e) }); }
          }, 60);
        });
      }
      return fetch(BASE + path.replace(/^\//, ""), {
        method: method,
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
        body: body ? JSON.stringify(body) : undefined, cache: "no-store"
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw { status: r.status, message: j.error || "Something went wrong (" + r.status + ").", fields: j.fields };
          return j;
        });
      }, function () { throw { status: 0, message: "Can't reach the store. Check your connection." }; });
    });
  }

  window.Ravelle = {
    ready: ready,
    call: call,
    get mode() { return mode; },
    base: BASE,
    demoLogin: DEMO_LOGIN,
    resetDemo: function () { try { localStorage.removeItem(DB_KEY); } catch (e) {} location.reload(); }
  };
})();
