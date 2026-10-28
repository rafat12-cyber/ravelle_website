// API client for the storefront and admin. On a server it calls /api; where
// there is no server (opening the files directly, or a static preview) it
// runs the same engine (core.js) in the browser against a demo database kept
// in localStorage, with sample orders so the admin has something to show.
(function () {
  "use strict";

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/js\/client\.js.*$/, "") : "";
  })();
  var DB_KEY = "ravelle:demo-db:v2";
  var DEMO_LOGIN = { email: "admin@ravellebd.com", password: "ravelle-demo" };

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
    if (location.protocol === "file:" || /[?&]demo\b/.test(location.search)) return Promise.resolve("demo");
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

  // Sample data so the dashboard, orders, customers and chat aren't empty.
  function buildDemoDb() {
    var db = RavelleCore.freshDb(window.RAVELLE_SEED);
    db.demo = true;
    var salt = hex(8);
    db.users.push({ id: "usr_demo", name: "Rafat", email: DEMO_LOGIN.email, role: "owner", salt: salt, passwordHash: demoHash(DEMO_LOGIN.password, salt), createdAt: Date.now() });
    var seed = 7;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var first = ["Rafi", "Nabil", "Tanvir", "Sakib", "Arif", "Mehedi", "Fahim", "Rakib", "Shuvo", "Imran", "Nusrat", "Tasnim", "Farhan", "Sabbir", "Jahid", "Rifat", "Ayon", "Siam", "Tahmid", "Zarif"];
    var last = ["Hossain", "Rahman", "Ahmed", "Islam", "Chowdhury", "Khan", "Karim", "Uddin", "Hasan", "Alam"];
    var places = [["Dhanmondi, Dhaka", "Dhaka", "inside-dhaka"], ["Mirpur 10, Dhaka", "Dhaka", "inside-dhaka"], ["Uttara Sector 7, Dhaka", "Dhaka", "inside-dhaka"],
      ["Banani, Dhaka", "Dhaka", "inside-dhaka"], ["Mohammadpur, Dhaka", "Dhaka", "inside-dhaka"], ["Agrabad, Chattogram", "Chattogram", "outside-dhaka"],
      ["Zindabazar, Sylhet", "Sylhet", "outside-dhaka"], ["Shaheb Bazar, Rajshahi", "Rajshahi", "outside-dhaka"], ["Sonadanga, Khulna", "Khulna", "outside-dhaka"]];
    var people = [];
    for (var i = 0; i < 34; i++) {
      var pl = pick(places);
      people.push({ name: pick(first) + " " + pick(last), phone: "01" + pick(["3", "5", "6", "7", "8", "9"]) + String(10000000 + Math.floor(rnd() * 89999999)), place: pl });
    }
    var now = Date.now(), day = 864e5;
    var orderCount = 0;
    var statusFor = function (age) {
      if (age < 1) return pick(["pending", "pending", "confirmed"]);
      if (age < 3) return pick(["confirmed", "processing", "shipped"]);
      if (age < 6) return pick(["shipped", "delivered", "delivered"]);
      return pick(["delivered", "delivered", "delivered", "delivered", "delivered", "delivered", "cancelled", "returned"]);
    };
    for (var d = 44; d >= 0; d--) {
      var dk = new Date(now - d * day).toISOString().slice(0, 10);
      var visits = Math.round(60 + rnd() * 70 + (44 - d) * 2.2);
      var dayStats = db.stats.days[dk] = { visits: visits, views: {}, carts: {} };
      db.products.forEach(function (p, idx) {
        var weight = p.featured ? 3 : p.isNew ? 2 : 1;
        dayStats.views[p.id] = Math.round(rnd() * 9 * weight + 2);
        dayStats.carts[p.id] = Math.round(dayStats.views[p.id] * (0.08 + rnd() * 0.12));
        void idx;
      });
      var n = Math.round(rnd() * 3 + (44 - d) / 16);
      for (var k = 0; k < n; k++) {
        var who = pick(people), at = now - d * day - Math.floor(rnd() * 10 * 36e5);
        var lines = [], count = rnd() < 0.3 ? 2 : 1;
        for (var c = 0; c < count; c++) {
          var p = db.products[Math.floor(Math.pow(rnd(), 1.6) * db.products.length)];
          var v = pick(p.variants);
          var qty = rnd() < 0.15 ? 2 : 1;
          lines.push({ productId: p.id, variantId: v.id, name: p.name, sku: v.sku, options: v.options, color: p.color, image: p.images[0], price: p.price, comparePrice: p.comparePrice, qty: qty, lineTotal: p.price * qty });
        }
        var subtotal = lines.reduce(function (s, l) { return s + l.lineTotal; }, 0);
        var useCoupon = subtotal >= 1000 && rnd() < 0.2;
        var discount = useCoupon ? Math.min(300, Math.round(subtotal * 0.1)) : 0;
        var zone = db.settings.shipping.zones.filter(function (z) { return z.id === who.place[2]; })[0];
        var status = statusFor(d);
        var pay = rnd() < 0.7 ? "cod" : "sslcommerz";
        db.counters.order++;
        orderCount++;
        var order = {
          id: "ord_demo" + orderCount, number: "RV" + db.counters.order, createdAt: at, updatedAt: at, status: status,
          paymentStatus: pay === "sslcommerz" ? (status === "cancelled" ? "refunded" : "paid") : status === "delivered" ? "paid" : "unpaid",
          paymentMethod: pay, customer: { name: who.name, phone: who.phone, email: "", address: "House " + (1 + Math.floor(rnd() * 90)) + ", " + who.place[0], city: who.place[1] },
          shippingZone: { id: zone.id, name: zone.name, days: zone.days }, items: lines, subtotal: subtotal, discount: discount, coupon: useCoupon ? "WELCOME10" : "",
          shipping: zone.fee, total: subtotal - discount + zone.fee, note: "", source: "website", restocked: status === "cancelled" || status === "returned",
          history: [{ at: at, status: "pending", note: "Order placed", by: "Customer" }].concat(status === "pending" ? [] : [{ at: at + 36e5 * 3, status: status, note: "Status: " + status, by: "Rafat" }])
        };
        if (useCoupon) db.coupons[0].used++;
        var cust = db.customers.filter(function (x) { return x.phone === who.phone; })[0];
        if (!cust) {
          cust = { id: "cus_demo" + db.customers.length, phone: who.phone, name: who.name, email: "", address: order.customer.address, city: who.place[1], createdAt: at };
          db.customers.push(cust);
        }
        order.customerId = cust.id;
        db.orders.push(order);
      }
    }
    var t = now - 40 * 6e4;
    db.chats.push({ id: "cht_demo1", tokenHash: "-", name: "Sakib", phone: "", status: "open", createdAt: t, updatedAt: t + 6e4, unreadAdmin: 1, page: "#product/oversized-t-shirt-fearless-black",
      messages: [
        { id: "m1", from: "bot", author: "Ravelle", text: db.settings.chat.greeting, at: t },
        { id: "m2", from: "customer", text: "Is the Fearless black tee available in 2XL? I'm 5'11\".", at: t + 3e4 },
        { id: "m3", from: "bot", author: "Ravelle", text: db.settings.chat.autoReplyText, at: t + 3e4 + 1 }
      ] });
    db.chats.push({ id: "cht_demo2", tokenHash: "-", name: "Nusrat", phone: "", status: "closed", createdAt: t - 864e5, updatedAt: t - 86e6, unreadAdmin: 0, page: "#delivery",
      messages: [
        { id: "m4", from: "customer", text: "How long does delivery to Sylhet take?", at: t - 864e5 },
        { id: "m5", from: "agent", author: "Rafat", text: "Outside Dhaka takes 3–5 days after we confirm your order.", at: t - 86e6 }
      ] });
    db.messages.push({ id: "msg_demo1", name: "Imran Hasan", email: "imran@example.com", phone: "", subject: "Bulk order",
      message: "Hi, can I order 20 tees for our office team? Do you give a discount?", createdAt: now - 5 * 36e5, read: false });
    return db;
  }

  // ---------------------------------------------------------------------------
  // Public client
  // ---------------------------------------------------------------------------
  var mode = null;
  var ready = detect().then(function (m) {
    mode = m;
    if (m === "server") return m;
    return (window.RavelleCore ? Promise.resolve() : loadScript("assets/js/core.js"))
      .then(function () { return window.RAVELLE_SEED ? null : loadScript("assets/js/seed.js"); })
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
