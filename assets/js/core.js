// Ravelle store engine: every API route, shared by the Node server
// (server/server.js) and the in-browser demo (assets/js/client.js).
// Each host supplies storage, hashing, randomness, webhooks and media saving;
// the routes, validation, stock, coupons, orders and analytics live here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RavelleCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------
  function HttpError(status, message, details) {
    this.status = status;
    this.message = message;
    this.details = details;
  }
  function fail(status, message, details) { throw new HttpError(status, message, details); }
  var clone = function (o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); };
  var str = function (v, max) { return v == null ? "" : String(v).trim().slice(0, max || 500); };
  var num = function (v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d); };
  var int = function (v, d) { return Math.round(num(v, d)); };
  var bool = function (v) { return v === true || v === "true" || v === 1 || v === "1"; };
  function slugify(s) {
    return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function uniqueSlug(list, base, selfId) {
    var slug = slugify(base) || "item", n = 2, s = slug;
    while (list.some(function (x) { return x.slug === s && x.id !== selfId; })) s = slug + "-" + n++;
    return s;
  }
  function dayKey(t) { return new Date(t).toISOString().slice(0, 10); }
  function isPhone(p) { return /^(?:\+?88)?01[3-9]\d{8}$/.test(String(p).replace(/[\s-]/g, "")); }
  function normPhone(p) { var d = String(p).replace(/[^\d]/g, ""); return d.length === 13 && d.indexOf("88") === 0 ? d.slice(2) : d; }
  function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  // SHA-256 (sync, used for API keys, sessions and the demo's passwords).
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32), result = "", words = [], i, j;
    ascii = unescape(encodeURIComponent(ascii));
    var bitLen = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pl = k.length;
    var composite = {};
    for (var cand = 2; pl < 64; cand++) {
      if (!composite[cand]) {
        for (i = 0; i < 313; i += cand) composite[i] = cand;
        hash[pl] = (Math.pow(cand, 0.5) * maxWord) | 0;
        k[pl++] = (Math.pow(cand, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii += "\x80";
    while (ascii.length % 64 - 56) ascii += "\x00";
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (bitLen / maxWord) | 0;
    words[words.length] = bitLen;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += (b < 16 ? "0" : "") + b.toString(16); }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Roles and permissions
  // ---------------------------------------------------------------------------
  var AREAS = ["dashboard", "orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "users", "settings", "integrations"];
  var ROLES = {
    owner: { label: "Owner", areas: AREAS },
    manager: { label: "Manager", areas: ["dashboard", "orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "settings"] },
    editor: { label: "Content editor", areas: ["products", "catalog", "content"] },
    support: { label: "Customer support", areas: ["dashboard", "orders", "customers", "chat", "messages"] }
  };
  // API keys reach the store data, never users, settings or other keys.
  var KEY_AREAS = ["orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "dashboard"];

  var ORDER_STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
  var PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed"];
  var EVENTS = ["order.created", "order.updated", "product.created", "product.updated", "product.deleted", "stock.updated", "stock.low",
    "customer.created", "chat.message.created", "contact.created", "coupon.used"];

  // ---------------------------------------------------------------------------
  // Shapes
  // ---------------------------------------------------------------------------
  function productStock(p) {
    if (!p.trackStock) return null;
    if (p.variants && p.variants.length) return p.variants.reduce(function (s, v) { return s + Math.max(0, int(v.stock)); }, 0);
    return Math.max(0, int(p.stock));
  }
  function publicProduct(p) {
    return {
      id: p.id, slug: p.slug, sku: p.sku, name: p.name, line: p.line, color: p.color, hex: p.hex,
      price: p.price, comparePrice: p.comparePrice || 0, description: p.description, details: p.details || [],
      images: p.images || [], sizeGuide: p.sizeGuide || "", categoryIds: p.categoryIds || [],
      attributes: p.attributes || [], isNew: !!p.isNew, featured: !!p.featured, trackStock: !!p.trackStock,
      stock: productStock(p), createdAt: p.createdAt,
      variants: (p.variants || []).map(function (v) {
        return { id: v.id, sku: v.sku, options: v.options, price: v.price == null || v.price === "" ? null : v.price, stock: p.trackStock ? Math.max(0, int(v.stock)) : null };
      })
    };
  }
  function publicUser(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin || null };
  }
  function orderSummary(o) {
    return { id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      customer: { name: o.customer.name, phone: o.customer.phone }, itemCount: o.items.reduce(function (s, i) { return s + i.qty; }, 0), total: o.total };
  }
  function chatSummary(c) {
    var last = c.messages[c.messages.length - 1];
    return { id: c.id, name: c.name, phone: c.phone, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
      unread: c.unreadAdmin || 0, lastMessage: last ? { from: last.from, text: last.text, at: last.at } : null, page: c.page || "" };
  }
  function publicSettings(s) {
    return {
      store: s.store, social: s.social, shipping: s.shipping,
      payments: { cod: !!(s.payments && s.payments.cod), sslcommerz: !!(s.payments && s.payments.sslcommerz && s.payments.sslcommerz.enabled) },
      chat: { enabled: !!(s.chat && s.chat.enabled), greeting: s.chat && s.chat.greeting, title: s.chat && s.chat.title },
      seo: s.seo, announcement: s.announcement || "", lowStock: s.lowStock
    };
  }

  // ---------------------------------------------------------------------------
  // The engine
  // ---------------------------------------------------------------------------
  function create(host) {
    var routes = [];
    function route(method, pattern, area, handler, opts) {
      var keys = [];
      var re = new RegExp("^" + pattern.replace(/:(\w+)/g, function (_, k) { keys.push(k); return "([^/]+)"; }) + "/?$");
      routes.push({ method: method, re: re, keys: keys, area: area, handler: handler, opts: opts || {} });
    }
    var now = function () { return host.now ? host.now() : Date.now(); };
    var newId = function (prefix) { return prefix + "_" + host.random(6); };

    function emit(db, event, data) {
      if (host.emit) host.emit(event, clone(data), db);
    }

    function settings(db) { return db.settings; }

    // --- Auth ----------------------------------------------------------------
    function authenticate(db, req) {
      var h = req.headers || {};
      var token = "";
      var auth = h.authorization || "";
      if (/^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, "").trim();
      if (!token && h["x-api-key"]) token = String(h["x-api-key"]).trim();
      if (!token) return null;
      var hashed = sha256(token);
      if (token.indexOf("rk_") === 0) {
        var key = (db.apiKeys || []).filter(function (k) { return k.hash === hashed && !k.revoked; })[0];
        if (!key) return null;
        key.lastUsed = now();
        return { kind: "key", key: key, areas: KEY_AREAS, write: key.scope === "write", name: "API key: " + key.name };
      }
      var s = (db.sessions || []).filter(function (x) { return x.hash === hashed && x.expiresAt > now(); })[0];
      if (!s) return null;
      var user = db.users.filter(function (u) { return u.id === s.userId; })[0];
      if (!user) return null;
      return { kind: "user", user: user, areas: (ROLES[user.role] || ROLES.support).areas, write: true, name: user.name };
    }
    function canSee(auth, area) { return auth && auth.areas.indexOf(area) > -1; }

    // --- Products --------------------------------------------------------------
    function findProduct(db, idOrSlug) {
      return db.products.filter(function (p) { return p.id === idOrSlug || p.slug === idOrSlug || p.sku === idOrSlug; })[0];
    }
    function cleanProduct(db, b, existing) {
      var p = existing ? clone(existing) : { id: newId("prd"), createdAt: now(), stats: {} };
      if (b.name !== undefined) p.name = str(b.name, 160);
      if (!p.name) fail(400, "Product name is required.");
      if (b.slug !== undefined || !p.slug) p.slug = uniqueSlug(db.products, str(b.slug) || p.name, p.id);
      ["line", "color", "description"].forEach(function (k) { if (b[k] !== undefined) p[k] = str(b[k], k === "description" ? 4000 : 120); });
      if (b.hex !== undefined) p.hex = /^#[0-9a-f]{6}$/i.test(b.hex) ? b.hex : (p.hex || "#888888");
      if (b.sku !== undefined) p.sku = str(b.sku, 60).toUpperCase();
      if (b.status !== undefined) p.status = b.status === "draft" ? "draft" : "published";
      if (!p.status) p.status = "published";
      if (b.price !== undefined) p.price = Math.max(0, int(b.price));
      if (b.comparePrice !== undefined) p.comparePrice = Math.max(0, int(b.comparePrice));
      if (b.details !== undefined) p.details = (Array.isArray(b.details) ? b.details : String(b.details).split("\n")).map(function (d) { return str(d, 300); }).filter(Boolean).slice(0, 20);
      if (b.images !== undefined) p.images = (b.images || []).map(function (u) { return str(u, 4000000); }).filter(Boolean).slice(0, 20);
      if (b.sizeGuide !== undefined) p.sizeGuide = str(b.sizeGuide, 4000000);
      if (b.categoryIds !== undefined) p.categoryIds = (b.categoryIds || []).filter(function (id) { return db.categories.some(function (c) { return c.id === id; }); });
      ["isNew", "featured", "trackStock"].forEach(function (k) { if (b[k] !== undefined) p[k] = bool(b[k]); });
      if (p.trackStock === undefined) p.trackStock = true;
      if (b.stock !== undefined) p.stock = Math.max(0, int(b.stock));
      if (b.attributes !== undefined) {
        p.attributes = (b.attributes || []).map(function (a) {
          return { name: str(a.name, 40), values: (a.values || []).map(function (v) { return str(v, 40); }).filter(Boolean) };
        }).filter(function (a) { return a.name && a.values.length; });
      }
      if (b.variants !== undefined) {
        var seen = {};
        p.variants = (b.variants || []).map(function (v) {
          var opts = {};
          Object.keys(v.options || {}).forEach(function (k) { opts[str(k, 40)] = str(v.options[k], 40); });
          var key = JSON.stringify(opts);
          if (seen[key]) fail(400, "Two variations have the same options: " + Object.keys(opts).map(function (k) { return opts[k]; }).join(" / "));
          seen[key] = 1;
          var old = existing && (existing.variants || []).filter(function (x) { return x.id === v.id; })[0];
          return {
            id: old ? old.id : newId("var"),
            sku: str(v.sku, 60).toUpperCase(),
            options: opts,
            price: v.price === null || v.price === "" || v.price === undefined ? null : Math.max(0, int(v.price)),
            stock: Math.max(0, int(v.stock))
          };
        });
      }
      if (!p.variants) p.variants = [];
      if (!p.attributes) p.attributes = [];
      if (!p.images) p.images = [];
      if (!p.categoryIds) p.categoryIds = [];
      if (!(p.price > 0)) fail(400, "Price must be more than 0.");
      // Every product and variation carries a SKU.
      if (!p.sku) p.sku = autoSku(p);
      var skus = {};
      db.products.forEach(function (o) {
        if (o.id === p.id) return;
        skus[o.sku] = o.name;
        (o.variants || []).forEach(function (v) { skus[v.sku] = o.name; });
      });
      if (skus[p.sku]) fail(400, "SKU " + p.sku + " is already used by " + skus[p.sku] + ".");
      p.variants.forEach(function (v) {
        if (!v.sku) v.sku = p.sku + "-" + Object.keys(v.options).map(function (k) { return slugify(v.options[k]).toUpperCase(); }).join("-");
        if (skus[v.sku]) fail(400, "SKU " + v.sku + " is already used by " + skus[v.sku] + ".");
        skus[v.sku] = p.name;
      });
      p.updatedAt = now();
      return p;
    }
    function autoSku(p) {
      var line = (p.line || p.name || "RV").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4) || "RV";
      var col = (p.color || "").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 3);
      return "RV-" + line + (col ? "-" + col : "") + "-" + host.random(2).toUpperCase();
    }
    function lowStockCheck(db, p, v) {
      var limit = int(db.settings.lowStock, 5);
      var stock = v ? v.stock : p.stock;
      if (p.trackStock && stock <= limit) emit(db, "stock.low", { productId: p.id, name: p.name, sku: v ? v.sku : p.sku, options: v ? v.options : null, stock: stock });
    }

    // --- Coupons --------------------------------------------------------------
    function findCoupon(db, code) {
      code = str(code, 40).toUpperCase();
      return db.coupons.filter(function (c) { return c.code === code; })[0];
    }
    function applyCoupon(db, code, subtotal) {
      var c = findCoupon(db, code), t = now();
      if (!c || !c.active) fail(400, "That coupon code isn't valid.");
      if (c.startsAt && t < c.startsAt) fail(400, "That coupon isn't active yet.");
      if (c.endsAt && t > c.endsAt) fail(400, "That coupon has expired.");
      if (c.maxUses && c.used >= c.maxUses) fail(400, "That coupon has been used up.");
      if (c.minOrder && subtotal < c.minOrder) fail(400, "Spend at least ৳" + c.minOrder.toLocaleString("en-US") + " to use this coupon.");
      var discount = 0, freeShipping = false;
      if (c.type === "percent") discount = Math.round(subtotal * Math.min(100, c.value) / 100);
      else if (c.type === "fixed") discount = Math.min(subtotal, c.value);
      else if (c.type === "shipping") freeShipping = true;
      if (c.maxDiscount && discount > c.maxDiscount) discount = c.maxDiscount;
      return { coupon: c, code: c.code, discount: discount, freeShipping: freeShipping, label: c.description || couponLabel(c) };
    }
    function couponLabel(c) {
      return c.type === "percent" ? c.value + "% off" : c.type === "fixed" ? "৳" + c.value + " off" : "Free delivery";
    }
    function cleanCoupon(db, b, existing) {
      var c = existing ? clone(existing) : { id: newId("cpn"), used: 0, createdAt: now() };
      if (b.code !== undefined) c.code = str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
      if (!c.code) fail(400, "Coupon code is required.");
      if (db.coupons.some(function (x) { return x.code === c.code && x.id !== c.id; })) fail(400, "Coupon " + c.code + " already exists.");
      if (b.type !== undefined) c.type = ["percent", "fixed", "shipping"].indexOf(b.type) > -1 ? b.type : "percent";
      if (b.value !== undefined) c.value = Math.max(0, int(b.value));
      if (c.type === "percent" && c.value > 100) fail(400, "A percentage can't be more than 100.");
      if (c.type !== "shipping" && !(c.value > 0)) fail(400, "Discount value is required.");
      ["minOrder", "maxUses", "maxDiscount"].forEach(function (k) { if (b[k] !== undefined) c[k] = Math.max(0, int(b[k])); });
      ["startsAt", "endsAt"].forEach(function (k) { if (b[k] !== undefined) c[k] = b[k] ? num(new Date(b[k]).getTime(), null) : null; });
      if (b.active !== undefined) c.active = bool(b.active);
      if (c.active === undefined) c.active = true;
      if (b.description !== undefined) c.description = str(b.description, 120);
      return c;
    }

    // --- Orders -----------------------------------------------------------------
    function shippingFee(db, zone, subtotalAfterDiscount) {
      var s = db.settings.shipping || {};
      var z = (s.zones || []).filter(function (x) { return x.id === zone; })[0];
      if (!z) fail(400, "Choose a delivery area.");
      var fee = int(z.fee);
      if (s.freeOver && subtotalAfterDiscount >= s.freeOver) fee = 0;
      return { zone: z, fee: fee };
    }
    function priceCart(db, items) {
      if (!Array.isArray(items) || !items.length) fail(400, "Your bag is empty.");
      if (items.length > 50) fail(400, "Too many items in one order.");
      var lines = [], subtotal = 0;
      items.forEach(function (it) {
        var p = findProduct(db, it.productId);
        if (!p || p.status !== "published") fail(400, "A product in your bag is no longer available.");
        var qty = int(it.qty, 1);
        if (qty < 1 || qty > 20) fail(400, "Quantity must be between 1 and 20.");
        var v = null;
        if (p.variants && p.variants.length) {
          v = p.variants.filter(function (x) { return x.id === it.variantId; })[0];
          if (!v) fail(400, "Choose a size for " + p.name + ".");
        }
        var stock = v ? v.stock : p.stock;
        if (p.trackStock && stock < qty) {
          fail(409, stock > 0 ? "Only " + stock + " left of " + p.name + (v ? " (" + optionText(v.options) + ")" : "") + "." : p.name + (v ? " (" + optionText(v.options) + ")" : "") + " is out of stock.");
        }
        var price = v && v.price != null ? v.price : p.price;
        subtotal += price * qty;
        lines.push({ productId: p.id, variantId: v ? v.id : null, name: p.name, sku: v ? v.sku : p.sku, options: v ? v.options : {}, color: p.color || "",
          image: (p.images || [])[0] || "", price: price, comparePrice: p.comparePrice || 0, qty: qty, lineTotal: price * qty });
      });
      return { lines: lines, subtotal: subtotal };
    }
    function optionText(o) { return Object.keys(o || {}).map(function (k) { return o[k]; }).join(" / "); }
    function quote(db, b) {
      var cart = priceCart(db, b.items);
      var c = null;
      if (b.couponCode) c = applyCoupon(db, b.couponCode, cart.subtotal);
      var discount = c ? c.discount : 0;
      var ship = b.zone ? shippingFee(db, b.zone, cart.subtotal - discount) : { fee: 0, zone: null };
      var fee = c && c.freeShipping ? 0 : ship.fee;
      return { lines: cart.lines, subtotal: cart.subtotal, discount: discount, coupon: c ? { code: c.code, label: c.label } : null,
        shipping: fee, zone: ship.zone, total: cart.subtotal - discount + fee };
    }
    function upsertCustomer(db, info) {
      var phone = normPhone(info.phone);
      var c = db.customers.filter(function (x) { return x.phone === phone; })[0];
      var created = false;
      if (!c) {
        c = { id: newId("cus"), phone: phone, createdAt: now() };
        db.customers.push(c);
        created = true;
      }
      c.name = info.name; c.email = info.email || c.email || ""; c.address = info.address; c.city = info.city || c.city || "";
      c.updatedAt = now();
      if (created) emit(db, "customer.created", c);
      return c;
    }
    function restock(db, o) {
      o.items.forEach(function (it) {
        var p = findProduct(db, it.productId);
        if (!p || !p.trackStock) return;
        var v = it.variantId ? (p.variants || []).filter(function (x) { return x.id === it.variantId; })[0] : null;
        if (v) v.stock += it.qty; else p.stock = int(p.stock) + it.qty;
      });
      o.restocked = true;
    }
    function track(db, type, productId, sid, extra) {
      var d = dayKey(now());
      db.stats = db.stats || { days: {} };
      var day = db.stats.days[d] = db.stats.days[d] || { visits: 0, views: {}, carts: {}, sids: {} };
      if (type === "visit") {
        if (sid && !day.sids[sid]) { day.sids[sid] = 1; day.visits++; }
        return;
      }
      if (!productId) return;
      var bucket = type === "view" ? day.views : type === "cart" ? day.carts : null;
      if (bucket) bucket[productId] = (bucket[productId] || 0) + (extra || 1);
      // Keep about 13 months of daily stats; drop the per-visitor ids after a day.
      var keys = Object.keys(db.stats.days).sort();
      keys.forEach(function (k, i) {
        if (k !== d) delete db.stats.days[k].sids;
        if (i < keys.length - 400) delete db.stats.days[k];
      });
    }

    // --- Analytics ---------------------------------------------------------------
    function dashboard(db, days) {
      days = Math.min(400, Math.max(1, int(days, 30)));
      var end = now(), start = end - days * 864e5, prevStart = start - days * 864e5;
      var counted = function (o) { return o.status !== "cancelled" && o.paymentStatus !== "failed"; };
      var inRange = db.orders.filter(function (o) { return o.createdAt >= start && o.createdAt <= end; });
      var prev = db.orders.filter(function (o) { return o.createdAt >= prevStart && o.createdAt < start; });
      var sum = function (list) {
        var good = list.filter(counted);
        var revenue = good.reduce(function (s, o) { return s + o.total; }, 0);
        var items = good.reduce(function (s, o) { return s + o.items.reduce(function (a, i) { return a + i.qty; }, 0); }, 0);
        return { revenue: revenue, orders: good.length, aov: good.length ? Math.round(revenue / good.length) : 0, items: items,
          discounts: good.reduce(function (s, o) { return s + (o.discount || 0); }, 0) };
      };
      var visitsIn = function (from, to) {
        var n = 0;
        Object.keys((db.stats || {}).days || {}).forEach(function (k) {
          var t = new Date(k + "T12:00:00Z").getTime();
          if (t >= from && t <= to) n += db.stats.days[k].visits || 0;
        });
        return n;
      };
      var cur = sum(inRange), before = sum(prev);
      cur.visits = visitsIn(start, end); before.visits = visitsIn(prevStart, start);
      cur.conversion = cur.visits ? +(cur.orders / cur.visits * 100).toFixed(2) : 0;
      before.conversion = before.visits ? +(before.orders / before.visits * 100).toFixed(2) : 0;

      var series = [];
      for (var i = days - 1; i >= 0; i--) {
        var dk = dayKey(end - i * 864e5);
        var dayOrders = inRange.filter(function (o) { return dayKey(o.createdAt) === dk && counted(o); });
        var ds = ((db.stats || {}).days || {})[dk] || {};
        series.push({ date: dk, revenue: dayOrders.reduce(function (s, o) { return s + o.total; }, 0), orders: dayOrders.length, visits: ds.visits || 0 });
      }
      var byStatus = {};
      ORDER_STATUSES.forEach(function (s) { byStatus[s] = 0; });
      inRange.forEach(function (o) { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
      var byPayment = {}, byZone = {};
      inRange.filter(counted).forEach(function (o) {
        byPayment[o.paymentMethod] = (byPayment[o.paymentMethod] || 0) + o.total;
        var z = (o.shippingZone && o.shippingZone.name) || "Other";
        byZone[z] = (byZone[z] || 0) + 1;
      });

      // Product analytics: views and add-to-bags from tracking, sales from orders.
      var prod = {};
      db.products.forEach(function (p) {
        prod[p.id] = { id: p.id, name: p.name, color: p.color, sku: p.sku, image: (p.images || [])[0] || "", views: 0, carts: 0, orders: 0, units: 0, revenue: 0, stock: productStock(p) };
      });
      Object.keys((db.stats || {}).days || {}).forEach(function (k) {
        var t = new Date(k + "T12:00:00Z").getTime();
        if (t < start || t > end) return;
        var d = db.stats.days[k];
        Object.keys(d.views || {}).forEach(function (id) { if (prod[id]) prod[id].views += d.views[id]; });
        Object.keys(d.carts || {}).forEach(function (id) { if (prod[id]) prod[id].carts += d.carts[id]; });
      });
      inRange.filter(counted).forEach(function (o) {
        var seen = {};
        o.items.forEach(function (it) {
          var p = prod[it.productId];
          if (!p) return;
          p.units += it.qty; p.revenue += it.lineTotal;
          if (!seen[it.productId]) { p.orders++; seen[it.productId] = 1; }
        });
      });
      var products = Object.keys(prod).map(function (k) {
        var p = prod[k];
        p.conversion = p.views ? +(p.orders / p.views * 100).toFixed(1) : 0;
        return p;
      }).sort(function (a, b) { return b.revenue - a.revenue || b.views - a.views; });

      var catSales = {};
      inRange.filter(counted).forEach(function (o) {
        o.items.forEach(function (it) {
          var p = findProduct(db, it.productId);
          (p ? p.categoryIds : []).forEach(function (cid) { catSales[cid] = (catSales[cid] || 0) + it.lineTotal; });
        });
      });
      var categories = db.categories.map(function (c) { return { id: c.id, name: c.name, revenue: catSales[c.id] || 0 }; })
        .filter(function (c) { return c.revenue > 0; }).sort(function (a, b) { return b.revenue - a.revenue; });

      var buyers = {};
      inRange.filter(counted).forEach(function (o) { buyers[normPhone(o.customer.phone)] = 1; });
      var returning = Object.keys(buyers).filter(function (ph) {
        return db.orders.some(function (o) { return normPhone(o.customer.phone) === ph && o.createdAt < start; });
      }).length;

      var limit = int(db.settings.lowStock, 5), low = [];
      db.products.forEach(function (p) {
        if (!p.trackStock) return;
        if (p.variants && p.variants.length) p.variants.forEach(function (v) { if (v.stock <= limit) low.push({ productId: p.id, name: p.name, color: p.color, sku: v.sku, options: v.options, stock: v.stock }); });
        else if (int(p.stock) <= limit) low.push({ productId: p.id, name: p.name, color: p.color, sku: p.sku, options: {}, stock: int(p.stock) });
      });

      var st = db.settings.store || {};
      var setup = [
        { done: !!(st.tradeLicense && !/X{3}/.test(st.tradeLicense)), text: "Add your trade license number" },
        { done: !!(st.tin && !/X{3}/.test(st.tin)), text: "Add your TIN" },
        { done: !!(st.dbid && !/X{3}/.test(st.dbid)), text: "Add your DBID" },
        { done: !!(st.phone && !/X{3}/.test(st.phone)), text: "Add your phone number" },
        { done: !!(st.address && st.address.length > 24), text: "Add your full business address" },
        { done: !!(db.settings.payments && db.settings.payments.sslcommerz && db.settings.payments.sslcommerz.storeId), text: "Connect SSLCOMMERZ" }
      ];

      return {
        range: { days: days, start: start, end: end },
        totals: cur, previous: before, series: series, byStatus: byStatus, byPayment: byPayment, byZone: byZone,
        products: products, categories: categories,
        customers: { buyers: Object.keys(buyers).length, returning: returning, total: db.customers.length },
        lowStock: low.sort(function (a, b) { return a.stock - b.stock; }).slice(0, 30),
        recent: db.orders.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 8).map(orderSummary),
        openChats: db.chats.filter(function (c) { return c.status === "open"; }).length,
        unreadMessages: db.messages.filter(function (m) { return !m.read; }).length,
        pending: db.orders.filter(function (o) { return o.status === "pending"; }).length,
        setup: setup
      };
    }

    // =========================================================================
    // Routes
    // =========================================================================
    route("GET", "/api/health", null, function () { return { ok: true, ravelle: true, version: 2 }; });

    // Storefront data in one request
    route("GET", "/api/store", null, function (c) {
      var db = c.db;
      return {
        settings: publicSettings(db.settings),
        categories: db.categories.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }),
        attributes: db.attributes,
        products: db.products.filter(function (p) { return p.status === "published"; }).map(publicProduct),
        pages: db.pages,
        menus: db.menus
      };
    });
    route("POST", "/api/track", null, function (c) {
      var t = str(c.body.type, 10);
      if (["visit", "view", "cart"].indexOf(t) < 0) fail(400, "Unknown event.");
      track(c.db, t, str(c.body.productId, 40), str(c.body.sid, 40));
      return { ok: true };
    }, { quiet: true });

    // Checkout
    route("POST", "/api/checkout/quote", null, function (c) {
      var q = quote(c.db, c.body);
      return { subtotal: q.subtotal, discount: q.discount, coupon: q.coupon, shipping: q.shipping, total: q.total, lines: q.lines };
    }, { readonly: true });
    route("POST", "/api/coupons/validate", null, function (c) {
      var r = applyCoupon(c.db, c.body.code, Math.max(0, int(c.body.subtotal)));
      return { code: r.code, label: r.label, discount: r.discount, freeShipping: r.freeShipping };
    }, { readonly: true });

    route("POST", "/api/orders", null, function (c) {
      var db = c.db, b = c.body || {}, cu = b.customer || {};
      var info = { name: str(cu.name, 80), phone: str(cu.phone, 20), email: str(cu.email, 120), address: str(cu.address, 300), city: str(cu.city, 60) };
      var errors = {};
      if (!info.name) errors.name = "Enter your name.";
      if (!isPhone(info.phone)) errors.phone = "Enter a Bangladeshi mobile number, like 01712345678.";
      if (info.email && !isEmail(info.email)) errors.email = "That email doesn't look right.";
      if (info.address.length < 6) errors.address = "Enter your full delivery address.";
      if (!b.agree) errors.agree = "Please accept the terms and conditions, privacy policy and refund policy.";
      var pay = str(b.paymentMethod, 20);
      var ps = db.settings.payments || {};
      if (!(pay === "cod" && ps.cod) && !(pay === "sslcommerz" && ps.sslcommerz && ps.sslcommerz.enabled)) errors.payment = "Choose a payment method.";
      if (Object.keys(errors).length) fail(400, "Please check the highlighted fields.", errors);
      var q = quote(db, b);
      db.counters.order = int(db.counters.order, 1000) + 1;
      var t = now();
      var order = {
        id: newId("ord"), number: "RV" + db.counters.order, createdAt: t, updatedAt: t,
        status: "pending", paymentStatus: "unpaid", paymentMethod: pay,
        customer: { name: info.name, phone: normPhone(info.phone), email: info.email, address: info.address, city: info.city },
        shippingZone: q.zone ? { id: q.zone.id, name: q.zone.name, days: q.zone.days } : null,
        items: q.lines, subtotal: q.subtotal, discount: q.discount, coupon: q.coupon ? q.coupon.code : "", shipping: q.shipping, total: q.total,
        note: str(b.note, 500), source: str(b.source, 40) || "website",
        history: [{ at: t, status: "pending", note: "Order placed" + (pay === "cod" ? " · cash on delivery" : " · paying online"), by: "Customer" }]
      };
      // Reserve stock now; cancelling or returning puts it back.
      order.items.forEach(function (it) {
        var p = findProduct(db, it.productId);
        if (!p.trackStock) return;
        var v = it.variantId ? p.variants.filter(function (x) { return x.id === it.variantId; })[0] : null;
        if (v) v.stock -= it.qty; else p.stock = int(p.stock) - it.qty;
        lowStockCheck(db, p, v);
      });
      if (q.coupon) {
        var cp = findCoupon(db, q.coupon.code);
        cp.used = int(cp.used) + 1;
        emit(db, "coupon.used", { code: cp.code, orderNumber: order.number, discount: order.discount });
      }
      var cust = upsertCustomer(db, info);
      order.customerId = cust.id;
      db.orders.push(order);
      emit(db, "order.created", order);
      return { order: publicOrder(order) };
    }, { status: 201 });

    function publicOrder(o) {
      return { number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
        customer: { name: o.customer.name, phone: o.customer.phone.replace(/^(\d{3})\d{5}/, "$1•••••"), address: o.customer.address, city: o.customer.city },
        shippingZone: o.shippingZone, items: o.items, subtotal: o.subtotal, discount: o.discount, coupon: o.coupon, shipping: o.shipping, total: o.total,
        tracking: o.tracking || "", history: o.history.filter(function (h) { return !h.internal; }).map(function (h) { return { at: h.at, status: h.status, note: h.public || "" }; }) };
    }
    route("POST", "/api/orders/track", null, function (c) {
      var number = str(c.body.number, 20).toUpperCase().replace(/^#/, ""), phone = normPhone(c.body.phone);
      var o = c.db.orders.filter(function (x) { return x.number === number && x.customer.phone === phone; })[0];
      if (!o) fail(404, "We couldn't find an order with that number and phone.");
      return { order: publicOrder(o) };
    }, { readonly: true });

    // Contact form
    route("POST", "/api/contact", null, function (c) {
      var b = c.body || {};
      var m = { id: newId("msg"), name: str(b.name, 80), email: str(b.email, 120), phone: str(b.phone, 20), subject: str(b.subject, 120), message: str(b.message, 3000), createdAt: now(), read: false };
      var errors = {};
      if (!m.name) errors.name = "Enter your name.";
      if (!m.email && !m.phone) errors.email = "Give an email or phone so we can reply.";
      if (m.email && !isEmail(m.email)) errors.email = "That email doesn't look right.";
      if (m.message.length < 5) errors.message = "Write a short message.";
      if (Object.keys(errors).length) fail(400, "Please check the highlighted fields.", errors);
      c.db.messages.push(m);
      emit(c.db, "contact.created", m);
      return { ok: true };
    }, { status: 201 });

    // --- Chat: visitor side ---------------------------------------------------------
    function visitorChat(c) {
      var ch = c.db.chats.filter(function (x) { return x.id === c.params.id; })[0];
      var tok = str(c.body.token || c.query.token, 80);
      if (!ch || !tok || ch.tokenHash !== sha256(tok)) fail(404, "Chat not found.");
      return ch;
    }
    function visibleMessages(ch, since) {
      since = num(since, 0);
      return ch.messages.filter(function (m) { return m.at > since && !m.internal; }).map(function (m) { return { id: m.id, from: m.from, text: m.text, at: m.at, author: m.from === "customer" ? "" : m.author || "" }; });
    }
    route("POST", "/api/chat/start", null, function (c) {
      var db = c.db;
      if (!(db.settings.chat && db.settings.chat.enabled)) fail(403, "Chat is turned off.");
      var token = host.random(16);
      var t = now();
      var ch = { id: newId("cht"), tokenHash: sha256(token), name: str(c.body.name, 80), phone: str(c.body.phone, 20), status: "open",
        createdAt: t, updatedAt: t, unreadAdmin: 0, page: str(c.body.page, 200), messages: [] };
      var greet = db.settings.chat.greeting;
      if (greet) ch.messages.push({ id: newId("m"), from: "bot", author: db.settings.chat.title || "Ravelle", text: greet, at: t });
      db.chats.push(ch);
      return { id: ch.id, token: token, messages: visibleMessages(ch, 0), status: ch.status };
    }, { status: 201 });
    route("GET", "/api/chat/:id", null, function (c) {
      var ch = visitorChat(c);
      return { id: ch.id, status: ch.status, messages: visibleMessages(ch, c.query.since) };
    }, { readonly: true });
    route("POST", "/api/chat/:id/messages", null, function (c) {
      var ch = visitorChat(c), db = c.db;
      var text = str(c.body.text, 2000);
      if (!text) fail(400, "Write a message.");
      if (c.body.name) ch.name = str(c.body.name, 80);
      if (c.body.phone) ch.phone = str(c.body.phone, 20);
      var m = { id: newId("m"), from: "customer", text: text, at: now() };
      ch.messages.push(m);
      ch.status = "open"; ch.updatedAt = m.at; ch.unreadAdmin = int(ch.unreadAdmin) + 1;
      var custCount = ch.messages.filter(function (x) { return x.from === "customer"; }).length;
      var cs = db.settings.chat || {};
      // Until an AI or a person replies, the first message gets the auto reply.
      if (custCount === 1 && cs.autoReply && cs.autoReplyText) {
        ch.messages.push({ id: newId("m"), from: "bot", author: cs.title || "Ravelle", text: cs.autoReplyText, at: m.at + 1 });
      }
      emit(db, "chat.message.created", { chatId: ch.id, message: m, chat: chatOut(ch) });
      return { message: m, messages: visibleMessages(ch, c.body.since) };
    }, { status: 201 });

    // --- Auth ------------------------------------------------------------------------
    route("POST", "/api/auth/login", null, function (c) {
      var db = c.db;
      var email = str(c.body.email, 120).toLowerCase(), pw = String(c.body.password || "");
      var u = db.users.filter(function (x) { return x.email === email; })[0];
      if (!u || host.hashPassword(pw, u.salt) !== u.passwordHash) fail(401, "Wrong email or password.");
      var token = host.random(24);
      db.sessions = (db.sessions || []).filter(function (s) { return s.expiresAt > now(); });
      db.sessions.push({ hash: sha256(token), userId: u.id, createdAt: now(), expiresAt: now() + 7 * 864e5 });
      u.lastLogin = now();
      return { token: token, user: publicUser(u), areas: (ROLES[u.role] || ROLES.support).areas };
    });
    route("GET", "/api/auth/me", "*", function (c) {
      if (c.auth.kind !== "user") return { key: { name: c.auth.key.name, scope: c.auth.key.scope }, areas: c.auth.areas };
      return { user: publicUser(c.auth.user), areas: c.auth.areas, roles: ROLES };
    }, { readonly: true });
    route("POST", "/api/auth/logout", "*", function (c) {
      var h = sha256(String((c.req.headers.authorization || "").replace(/^Bearer\s+/i, "")));
      c.db.sessions = c.db.sessions.filter(function (s) { return s.hash !== h; });
      return { ok: true };
    });
    route("PATCH", "/api/auth/me", "*", function (c) {
      if (c.auth.kind !== "user") fail(403, "Only people can change their profile.");
      var u = c.auth.user, b = c.body;
      if (b.name) u.name = str(b.name, 80);
      if (b.password) {
        if (host.hashPassword(String(b.currentPassword || ""), u.salt) !== u.passwordHash) fail(400, "Your current password is wrong.");
        setPassword(u, b.password);
      }
      return { user: publicUser(u) };
    });
    function setPassword(u, pw) {
      pw = String(pw || "");
      if (pw.length < 8) fail(400, "Use a password of at least 8 characters.");
      u.salt = host.random(8);
      u.passwordHash = host.hashPassword(pw, u.salt);
    }

    // --- Dashboard ----------------------------------------------------------------------
    route("GET", "/api/dashboard", "dashboard", function (c) { return dashboard(c.db, c.query.days); }, { readonly: true });

    // --- Products ------------------------------------------------------------------------
    route("GET", "/api/products", "products", function (c) {
      var q = str(c.query.q).toLowerCase(), cat = str(c.query.category), status = str(c.query.status);
      var list = c.db.products.filter(function (p) {
        if (status && p.status !== status) return false;
        if (cat && (p.categoryIds || []).indexOf(cat) < 0) return false;
        if (q) {
          var hay = (p.name + " " + p.sku + " " + (p.line || "") + " " + (p.color || "") + " " + (p.variants || []).map(function (v) { return v.sku; }).join(" ")).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
      return { products: list.map(function (p) { var o = publicProduct(p); o.status = p.status; o.updatedAt = p.updatedAt; return o; }), total: list.length };
    }, { readonly: true });
    route("GET", "/api/products/:id", "products", function (c) {
      var p = findProduct(c.db, c.params.id);
      if (!p) fail(404, "Product not found.");
      var o = publicProduct(p); o.status = p.status; o.updatedAt = p.updatedAt;
      return { product: o };
    }, { readonly: true });
    route("POST", "/api/products", "products", function (c) {
      var p = cleanProduct(c.db, c.body);
      c.db.products.unshift(p);
      emit(c.db, "product.created", publicProduct(p));
      return { product: publicProduct(p) };
    }, { status: 201 });
    function saveProduct(c) {
      var db = c.db, idx = db.products.findIndex(function (p) { return p.id === c.params.id || p.slug === c.params.id || p.sku === c.params.id; });
      if (idx < 0) fail(404, "Product not found.");
      var before = db.products[idx];
      var p = cleanProduct(db, c.body, before);
      db.products[idx] = p;
      emit(db, "product.updated", publicProduct(p));
      if (JSON.stringify(productStock(before)) !== JSON.stringify(productStock(p))) emit(db, "stock.updated", { productId: p.id, sku: p.sku, stock: productStock(p) });
      return { product: Object.assign(publicProduct(p), { status: p.status }) };
    }
    route("PUT", "/api/products/:id", "products", saveProduct);
    route("PATCH", "/api/products/:id", "products", saveProduct);
    route("DELETE", "/api/products/:id", "products", function (c) {
      var db = c.db, p = findProduct(db, c.params.id);
      if (!p) fail(404, "Product not found.");
      db.products = db.products.filter(function (x) { return x !== p; });
      emit(db, "product.deleted", { id: p.id, sku: p.sku, name: p.name });
      return { ok: true };
    });
    route("POST", "/api/products/:id/duplicate", "products", function (c) {
      var db = c.db, p = findProduct(db, c.params.id);
      if (!p) fail(404, "Product not found.");
      var copy = clone(p);
      copy.name = p.name + " (copy)"; copy.slug = ""; copy.sku = ""; copy.status = "draft";
      copy.variants = (copy.variants || []).map(function (v) { return { options: v.options, price: v.price, stock: v.stock, sku: "" }; });
      var made = cleanProduct(db, copy);
      db.products.unshift(made);
      return { product: publicProduct(made) };
    }, { status: 201 });

    // Stock by SKU, for warehouse or POS sync
    route("GET", "/api/stock", "products", function (c) {
      var out = [];
      c.db.products.forEach(function (p) {
        if (p.variants && p.variants.length) p.variants.forEach(function (v) { out.push({ sku: v.sku, productId: p.id, name: p.name, options: v.options, stock: p.trackStock ? v.stock : null }); });
        else out.push({ sku: p.sku, productId: p.id, name: p.name, options: {}, stock: p.trackStock ? int(p.stock) : null });
      });
      return { stock: out };
    }, { readonly: true });
    route("PATCH", "/api/stock", "products", function (c) {
      var db = c.db, items = c.body.items || [], results = [];
      items.slice(0, 500).forEach(function (it) {
        var sku = str(it.sku, 60).toUpperCase(), hit = null;
        db.products.forEach(function (p) {
          if (p.sku === sku && !(p.variants || []).length) hit = { p: p };
          (p.variants || []).forEach(function (v) { if (v.sku === sku) hit = { p: p, v: v }; });
        });
        if (!hit) { results.push({ sku: sku, ok: false, error: "Unknown SKU" }); return; }
        var cur = hit.v ? hit.v.stock : int(hit.p.stock);
        var next = it.stock !== undefined ? int(it.stock) : cur + int(it.delta);
        next = Math.max(0, next);
        if (hit.v) hit.v.stock = next; else hit.p.stock = next;
        hit.p.updatedAt = now();
        emit(db, "stock.updated", { productId: hit.p.id, sku: sku, stock: next });
        lowStockCheck(db, hit.p, hit.v);
        results.push({ sku: sku, ok: true, stock: next });
      });
      return { results: results };
    });

    // --- Categories and variation attributes ------------------------------------------------------
    function crud(name, coll, area, cleaner, opts) {
      opts = opts || {};
      route("GET", "/api/" + name, opts.publicRead ? null : area, function (c) { var o = {}; o[name] = c.db[coll]; return o; }, { readonly: true });
      route("POST", "/api/" + name, area, function (c) {
        var item = cleaner(c.db, c.body);
        c.db[coll].push(item);
        var o = {}; o.item = item; return o;
      }, { status: 201 });
      route("PUT", "/api/" + name + "/:id", area, function (c) {
        var i = c.db[coll].findIndex(function (x) { return x.id === c.params.id; });
        if (i < 0) fail(404, "Not found.");
        c.db[coll][i] = cleaner(c.db, c.body, c.db[coll][i]);
        return { item: c.db[coll][i] };
      });
      route("DELETE", "/api/" + name + "/:id", area, function (c) {
        var item = c.db[coll].filter(function (x) { return x.id === c.params.id; })[0];
        if (!item) fail(404, "Not found.");
        if (opts.beforeDelete) opts.beforeDelete(c.db, item);
        c.db[coll] = c.db[coll].filter(function (x) { return x !== item; });
        return { ok: true };
      });
    }
    crud("categories", "categories", "catalog", function (db, b, ex) {
      var c = ex ? clone(ex) : { id: newId("cat"), createdAt: now() };
      if (b.name !== undefined) c.name = str(b.name, 80);
      if (!c.name) fail(400, "Category name is required.");
      if (b.slug !== undefined || !c.slug) c.slug = uniqueSlug(db.categories, str(b.slug) || c.name, c.id);
      if (b.parentId !== undefined) {
        var pid = str(b.parentId, 40) || null;
        if (pid === c.id) fail(400, "A category can't be its own parent.");
        var walk = pid;
        while (walk) {
          if (walk === c.id) fail(400, "That would put the category inside itself.");
          var par = db.categories.filter(function (x) { return x.id === walk; })[0];
          if (!par) { if (walk === pid) fail(400, "Parent category not found."); break; }
          walk = par.parentId;
        }
        c.parentId = pid;
      }
      ["description", "image", "mood"].forEach(function (k) { if (b[k] !== undefined) c[k] = str(b[k], k === "image" ? 4000000 : 600); });
      if (b.order !== undefined) c.order = int(b.order);
      if (b.showInShop !== undefined) c.showInShop = bool(b.showInShop);
      return c;
    }, { publicRead: true, beforeDelete: function (db, cat) {
      db.categories.forEach(function (x) { if (x.parentId === cat.id) x.parentId = cat.parentId || null; });
      db.products.forEach(function (p) { p.categoryIds = (p.categoryIds || []).filter(function (id) { return id !== cat.id; }); });
    } });
    crud("attributes", "attributes", "catalog", function (db, b, ex) {
      var a = ex ? clone(ex) : { id: newId("att"), createdAt: now() };
      if (b.name !== undefined) a.name = str(b.name, 40);
      if (!a.name) fail(400, "Name is required.");
      if (db.attributes.some(function (x) { return x.name.toLowerCase() === a.name.toLowerCase() && x.id !== a.id; })) fail(400, "There is already a variation called " + a.name + ".");
      if (b.type !== undefined) a.type = b.type === "color" ? "color" : "button";
      if (b.values !== undefined) {
        a.values = (b.values || []).map(function (v) {
          return typeof v === "string" ? { label: str(v, 40) } : { label: str(v.label, 40), hex: /^#[0-9a-f]{6}$/i.test(v.hex || "") ? v.hex : undefined };
        }).filter(function (v) { return v.label; });
      }
      if (!a.values || !a.values.length) fail(400, "Add at least one option.");
      return a;
    }, { publicRead: true });
    route("PUT", "/api/categories-order", "catalog", function (c) {
      (c.body.order || []).forEach(function (o) {
        var cat = c.db.categories.filter(function (x) { return x.id === o.id; })[0];
        if (cat) { cat.order = int(o.order); if (o.parentId !== undefined) cat.parentId = o.parentId || null; }
      });
      return { categories: c.db.categories };
    });

    // --- Coupons -------------------------------------------------------------------------------------
    crud("coupons", "coupons", "coupons", cleanCoupon);

    // --- Orders (admin) -------------------------------------------------------------------------------
    route("GET", "/api/orders", "orders", function (c) {
      var q = str(c.query.q).toLowerCase(), status = str(c.query.status), from = num(c.query.from, 0), to = num(c.query.to, Infinity);
      var list = c.db.orders.filter(function (o) {
        if (status && o.status !== status) return false;
        if (o.createdAt < from || o.createdAt > to) return false;
        if (q && (o.number + " " + o.customer.name + " " + o.customer.phone + " " + (o.customer.email || "")).toLowerCase().indexOf(q) < 0) return false;
        return true;
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });
      var full = bool(c.query.full);
      return { orders: list.map(full ? clone : orderSummary), total: list.length };
    }, { readonly: true });
    route("GET", "/api/orders/:id", "orders", function (c) {
      var o = c.db.orders.filter(function (x) { return x.id === c.params.id || x.number === String(c.params.id).toUpperCase(); })[0];
      if (!o) fail(404, "Order not found.");
      return { order: o };
    }, { readonly: true });
    route("PATCH", "/api/orders/:id", "orders", function (c) {
      var db = c.db, b = c.body;
      var o = db.orders.filter(function (x) { return x.id === c.params.id || x.number === String(c.params.id).toUpperCase(); })[0];
      if (!o) fail(404, "Order not found.");
      var changes = [];
      if (b.status && b.status !== o.status) {
        if (ORDER_STATUSES.indexOf(b.status) < 0) fail(400, "Unknown status.");
        var was = o.status;
        o.status = b.status;
        if ((b.status === "cancelled" || b.status === "returned") && !o.restocked) restock(db, o);
        if ((was === "cancelled" || was === "returned") && o.restocked) {
          // Reopening takes the stock back out.
          o.items.forEach(function (it) {
            var p = findProduct(db, it.productId);
            if (!p || !p.trackStock) return;
            var v = it.variantId ? p.variants.filter(function (x) { return x.id === it.variantId; })[0] : null;
            if (v) v.stock = Math.max(0, v.stock - it.qty); else p.stock = Math.max(0, int(p.stock) - it.qty);
          });
          o.restocked = false;
        }
        changes.push("Status: " + b.status);
      }
      if (b.paymentStatus && b.paymentStatus !== o.paymentStatus) {
        if (PAYMENT_STATUSES.indexOf(b.paymentStatus) < 0) fail(400, "Unknown payment status.");
        o.paymentStatus = b.paymentStatus;
        changes.push("Payment: " + b.paymentStatus);
      }
      if (b.tracking !== undefined && str(b.tracking, 120) !== (o.tracking || "")) { o.tracking = str(b.tracking, 120); changes.push("Tracking: " + (o.tracking || "removed")); }
      if (b.paymentRef !== undefined) o.paymentRef = str(b.paymentRef, 120);
      var note = str(b.note, 500);
      if (!changes.length && !note) return { order: o };
      o.updatedAt = now();
      o.history.push({ at: now(), status: o.status, note: changes.concat(note ? [note] : []).join(" · "), public: b.notifyCustomer ? note : "", by: c.auth ? c.auth.name : "System", internal: !b.notifyCustomer && !changes.length });
      emit(db, "order.updated", o);
      return { order: o };
    });
    // Payment callbacks from the server's SSLCOMMERZ handler
    route("POST", "/api/internal/payment", "internal", function (c) {
      var o = c.db.orders.filter(function (x) { return x.id === c.body.orderId; })[0];
      if (!o) fail(404, "Order not found.");
      var paid = c.body.status === "paid";
      if (paid && o.paymentStatus === "paid") return { order: o };
      o.paymentStatus = paid ? "paid" : "failed";
      o.paymentRef = str(c.body.ref, 120);
      if (paid && o.status === "pending") o.status = "confirmed";
      if (!paid && o.status === "pending") { o.status = "cancelled"; if (!o.restocked) restock(c.db, o); }
      o.history.push({ at: now(), status: o.status, note: paid ? "Paid online · " + o.paymentRef : "Online payment " + str(c.body.status, 20), public: paid ? "Payment received" : "Payment didn't go through", by: "SSLCOMMERZ" });
      emit(c.db, "order.updated", o);
      return { order: o };
    });

    // --- Customers -----------------------------------------------------------------------------------------
    function customerStats(db, cu) {
      var orders = db.orders.filter(function (o) { return o.customerId === cu.id || o.customer.phone === cu.phone; });
      var good = orders.filter(function (o) { return o.status !== "cancelled"; });
      return Object.assign({}, cu, { orders: orders.length, spent: good.reduce(function (s, o) { return s + o.total; }, 0),
        lastOrder: orders.reduce(function (m, o) { return Math.max(m, o.createdAt); }, 0) || null });
    }
    route("GET", "/api/customers", "customers", function (c) {
      var q = str(c.query.q).toLowerCase();
      var list = c.db.customers.filter(function (cu) { return !q || (cu.name + " " + cu.phone + " " + (cu.email || "")).toLowerCase().indexOf(q) > -1; })
        .map(function (cu) { return customerStats(c.db, cu); }).sort(function (a, b) { return (b.lastOrder || 0) - (a.lastOrder || 0); });
      return { customers: list, total: list.length };
    }, { readonly: true });
    route("GET", "/api/customers/:id", "customers", function (c) {
      var cu = c.db.customers.filter(function (x) { return x.id === c.params.id; })[0];
      if (!cu) fail(404, "Customer not found.");
      return { customer: customerStats(c.db, cu), orders: c.db.orders.filter(function (o) { return o.customerId === cu.id || o.customer.phone === cu.phone; }).map(orderSummary) };
    }, { readonly: true });
    route("PATCH", "/api/customers/:id", "customers", function (c) {
      var cu = c.db.customers.filter(function (x) { return x.id === c.params.id; })[0];
      if (!cu) fail(404, "Customer not found.");
      if (c.body.note !== undefined) cu.note = str(c.body.note, 1000);
      if (c.body.tags !== undefined) cu.tags = (c.body.tags || []).map(function (t) { return str(t, 30); }).filter(Boolean);
      return { customer: customerStats(c.db, cu) };
    });

    // --- Pages, menus, media, settings ------------------------------------------------------------------------
    route("GET", "/api/pages", null, function (c) { return { pages: c.db.pages }; }, { readonly: true });
    route("GET", "/api/pages/:key", null, function (c) {
      var p = c.db.pages[c.params.key];
      if (!p) fail(404, "Page not found.");
      return { page: p };
    }, { readonly: true });
    route("PUT", "/api/pages/:key", "content", function (c) {
      if (!c.db.pages[c.params.key]) fail(404, "Page not found.");
      if (!c.body || typeof c.body.page !== "object") fail(400, "Send the page content as { page }.");
      if (JSON.stringify(c.body.page).length > 6e6) fail(413, "This page is too large. Use smaller images.");
      c.db.pages[c.params.key] = c.body.page;
      return { page: c.db.pages[c.params.key] };
    });
    route("GET", "/api/menus", null, function (c) { return { menus: c.db.menus }; }, { readonly: true });
    route("PUT", "/api/menus", "content", function (c) {
      var clean = function (items, depth) {
        return (items || []).slice(0, 30).map(function (it) {
          return { id: str(it.id, 40) || newId("mi"), label: str(it.label, 60), url: str(it.url, 300),
            children: depth < 2 ? clean(it.children, depth + 1) : [] };
        }).filter(function (it) { return it.label; });
      };
      var m = c.body.menus || {};
      c.db.menus = {
        header: clean(m.header, 0),
        footer: (m.footer || []).slice(0, 6).map(function (col) { return { id: str(col.id, 40) || newId("fc"), title: str(col.title, 60), items: clean(col.items, 2) }; })
      };
      return { menus: c.db.menus };
    });

    route("GET", "/api/media", "content", function (c) {
      return { media: c.db.media.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }) };
    }, { readonly: true });
    route("POST", "/api/media", "content", function (c) {
      var name = str(c.body.name, 120) || "image", data = String(c.body.dataUrl || "");
      var m = /^data:(image\/(png|jpeg|webp|gif|avif));base64,/.exec(data);
      if (!m) fail(400, "Upload a PNG, JPG, WebP, GIF or AVIF image.");
      if (data.length > 14e6) fail(413, "That image is over 10 MB.");
      var saved = host.saveMedia(name, data, m[1]);
      var item = { id: newId("med"), url: saved.url, name: name, alt: str(c.body.alt, 200), type: m[1], size: saved.size,
        width: int(c.body.width) || null, height: int(c.body.height) || null, createdAt: now() };
      c.db.media.push(item);
      return { item: item };
    }, { status: 201 });
    route("PATCH", "/api/media/:id", "content", function (c) {
      var m = c.db.media.filter(function (x) { return x.id === c.params.id; })[0];
      if (!m) fail(404, "Not found.");
      if (c.body.alt !== undefined) m.alt = str(c.body.alt, 200);
      if (c.body.name !== undefined) m.name = str(c.body.name, 120);
      return { item: m };
    });
    route("DELETE", "/api/media/:id", "content", function (c) {
      var m = c.db.media.filter(function (x) { return x.id === c.params.id; })[0];
      if (!m) fail(404, "Not found.");
      if (host.deleteMedia) host.deleteMedia(m.url);
      c.db.media = c.db.media.filter(function (x) { return x !== m; });
      return { ok: true };
    });

    route("GET", "/api/settings", "settings", function (c) {
      var s = clone(c.db.settings);
      if (host.describeSettings) host.describeSettings(s);
      return { settings: s };
    }, { readonly: true });
    route("PUT", "/api/settings", "settings", function (c) {
      var s = c.db.settings, b = c.body.settings || {};
      ["store", "social", "seo", "chat"].forEach(function (k) {
        if (b[k] && typeof b[k] === "object") Object.keys(b[k]).forEach(function (f) {
          var v = b[k][f];
          s[k][f] = typeof v === "boolean" ? v : str(v, 1000);
        });
      });
      if (b.shipping) {
        s.shipping.freeOver = Math.max(0, int(b.shipping.freeOver));
        s.shipping.processing = str(b.shipping.processing, 200);
        if (Array.isArray(b.shipping.zones)) s.shipping.zones = b.shipping.zones.slice(0, 10).map(function (z) {
          return { id: slugify(z.id || z.name) || newId("zone"), name: str(z.name, 60), fee: Math.max(0, int(z.fee)), days: str(z.days, 40) };
        }).filter(function (z) { return z.name; });
        if (!s.shipping.zones.length) fail(400, "Keep at least one delivery area.");
      }
      if (b.payments) {
        s.payments.cod = bool(b.payments.cod);
        var ssl = b.payments.sslcommerz || {};
        s.payments.sslcommerz = { enabled: bool(ssl.enabled), sandbox: bool(ssl.sandbox), storeId: str(ssl.storeId, 80) };
        if (!s.payments.cod && !s.payments.sslcommerz.enabled) fail(400, "Keep at least one payment method on.");
      }
      if (b.lowStock !== undefined) s.lowStock = Math.max(0, int(b.lowStock));
      if (b.announcement !== undefined) s.announcement = str(b.announcement, 200);
      return { settings: s };
    });

    // --- Users ---------------------------------------------------------------------------------------------------
    route("GET", "/api/users", "users", function (c) { return { users: c.db.users.map(publicUser), roles: ROLES }; }, { readonly: true });
    route("POST", "/api/users", "users", function (c) {
      var b = c.body, email = str(b.email, 120).toLowerCase();
      if (!str(b.name)) fail(400, "Enter a name.");
      if (!isEmail(email)) fail(400, "Enter a valid email.");
      if (c.db.users.some(function (u) { return u.email === email; })) fail(400, "Someone already uses that email.");
      if (!ROLES[b.role]) fail(400, "Choose a role.");
      var u = { id: newId("usr"), name: str(b.name, 80), email: email, role: b.role, createdAt: now() };
      setPassword(u, b.password);
      c.db.users.push(u);
      return { user: publicUser(u) };
    }, { status: 201 });
    route("PATCH", "/api/users/:id", "users", function (c) {
      var u = c.db.users.filter(function (x) { return x.id === c.params.id; })[0];
      if (!u) fail(404, "User not found.");
      var b = c.body;
      if (b.role && b.role !== u.role) {
        if (!ROLES[b.role]) fail(400, "Unknown role.");
        if (u.role === "owner" && c.db.users.filter(function (x) { return x.role === "owner"; }).length < 2) fail(400, "Keep at least one owner.");
        u.role = b.role;
      }
      if (b.name) u.name = str(b.name, 80);
      if (b.password) { setPassword(u, b.password); c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id; }); }
      return { user: publicUser(u) };
    });
    route("DELETE", "/api/users/:id", "users", function (c) {
      var u = c.db.users.filter(function (x) { return x.id === c.params.id; })[0];
      if (!u) fail(404, "User not found.");
      if (c.auth.user && u.id === c.auth.user.id) fail(400, "You can't remove yourself.");
      if (u.role === "owner" && c.db.users.filter(function (x) { return x.role === "owner"; }).length < 2) fail(400, "Keep at least one owner.");
      c.db.users = c.db.users.filter(function (x) { return x !== u; });
      c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id; });
      return { ok: true };
    });

    // --- Integrations: API keys and webhooks ---------------------------------------------------------------------------
    route("GET", "/api/keys", "integrations", function (c) {
      return { keys: c.db.apiKeys.filter(function (k) { return !k.revoked; }).map(function (k) { return { id: k.id, name: k.name, scope: k.scope, prefix: k.prefix, createdAt: k.createdAt, lastUsed: k.lastUsed || null }; }) };
    }, { readonly: true });
    route("POST", "/api/keys", "integrations", function (c) {
      var name = str(c.body.name, 60);
      if (!name) fail(400, "Name the key after the app that will use it.");
      var key = "rk_" + host.random(20);
      var item = { id: newId("key"), name: name, scope: c.body.scope === "write" ? "write" : "read", prefix: key.slice(0, 10), hash: sha256(key), createdAt: now() };
      c.db.apiKeys.push(item);
      return { key: key, item: { id: item.id, name: item.name, scope: item.scope, prefix: item.prefix, createdAt: item.createdAt } };
    }, { status: 201 });
    route("DELETE", "/api/keys/:id", "integrations", function (c) {
      var k = c.db.apiKeys.filter(function (x) { return x.id === c.params.id; })[0];
      if (!k) fail(404, "Key not found.");
      c.db.apiKeys = c.db.apiKeys.filter(function (x) { return x !== k; });
      return { ok: true };
    });
    function cleanHook(db, b, ex) {
      var w = ex ? clone(ex) : { id: newId("hook"), secret: "whsec_" + host.random(16), createdAt: now() };
      if (b.url !== undefined) w.url = str(b.url, 500);
      if (!/^https?:\/\/[^\s]+$/i.test(w.url || "")) fail(400, "Enter the full web address, starting with https://");
      if (b.events !== undefined) w.events = (b.events || []).filter(function (e) { return e === "*" || EVENTS.indexOf(e) > -1; });
      if (!w.events || !w.events.length) fail(400, "Pick at least one event.");
      if (b.active !== undefined) w.active = bool(b.active);
      if (w.active === undefined) w.active = true;
      if (b.name !== undefined) w.name = str(b.name, 60);
      return w;
    }
    route("GET", "/api/webhooks", "integrations", function (c) { return { webhooks: c.db.webhooks, events: EVENTS }; }, { readonly: true });
    route("POST", "/api/webhooks", "integrations", function (c) { var w = cleanHook(c.db, c.body); c.db.webhooks.push(w); return { item: w }; }, { status: 201 });
    route("PUT", "/api/webhooks/:id", "integrations", function (c) {
      var i = c.db.webhooks.findIndex(function (x) { return x.id === c.params.id; });
      if (i < 0) fail(404, "Webhook not found.");
      c.db.webhooks[i] = cleanHook(c.db, c.body, c.db.webhooks[i]);
      return { item: c.db.webhooks[i] };
    });
    route("DELETE", "/api/webhooks/:id", "integrations", function (c) {
      c.db.webhooks = c.db.webhooks.filter(function (x) { return x.id !== c.params.id; });
      return { ok: true };
    });
    route("POST", "/api/webhooks/:id/test", "integrations", function (c) {
      var w = c.db.webhooks.filter(function (x) { return x.id === c.params.id; })[0];
      if (!w) fail(404, "Webhook not found.");
      if (host.emit) host.emit("ping", { message: "Test from Ravelle admin", at: now() }, c.db, w.id);
      return { ok: true };
    });
    route("GET", "/api/webhooks-log", "integrations", function (c) {
      return { log: (c.db.webhookLog || []).slice(-100).reverse() };
    }, { readonly: true });

    // --- Chat: admin and AI side -------------------------------------------------------------------------------------------
    function findChat(db, id) {
      var ch = db.chats.filter(function (x) { return x.id === id; })[0];
      if (!ch) fail(404, "Chat not found.");
      return ch;
    }
    function chatOut(ch) {
      var o = chatSummary(ch);
      o.messages = ch.messages;
      return o;
    }
    route("GET", "/api/chats", "chat", function (c) {
      var status = str(c.query.status), since = num(c.query.since, 0);
      var list = c.db.chats.filter(function (ch) { return (!status || ch.status === status) && ch.updatedAt > since; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      if (bool(c.query.messages)) return { chats: list.map(chatOut) };
      return { chats: list.map(chatSummary) };
    }, { readonly: true });
    route("GET", "/api/chats/:id", "chat", function (c) {
      var ch = findChat(c.db, c.params.id);
      if (bool(c.query.markRead) && c.auth.kind === "user") ch.unreadAdmin = 0;
      return { chat: chatOut(ch) };
    }, { readonly: true });
    route("POST", "/api/chats/:id/messages", "chat", function (c) {
      var ch = findChat(c.db, c.params.id), text = str(c.body.text, 4000);
      if (!text) fail(400, "Write a message.");
      var from = c.body.from === "bot" || (c.auth.kind === "key" && c.body.from !== "agent") ? "bot" : "agent";
      var m = { id: newId("m"), from: from, author: str(c.body.author, 60) || (from === "bot" ? (c.db.settings.chat.title || "Ravelle") : c.auth.name), text: text, at: now(), internal: !!c.body.internal };
      ch.messages.push(m);
      ch.updatedAt = m.at;
      if (c.auth.kind === "user") ch.unreadAdmin = 0;
      if (ch.status === "closed") ch.status = "open";
      return { message: m, chat: chatSummary(ch) };
    }, { status: 201 });
    route("PATCH", "/api/chats/:id", "chat", function (c) {
      var ch = findChat(c.db, c.params.id);
      if (c.body.status) ch.status = c.body.status === "closed" ? "closed" : "open";
      if (c.body.read) ch.unreadAdmin = 0;
      if (c.body.name !== undefined) ch.name = str(c.body.name, 80);
      ch.updatedAt = now();
      return { chat: chatSummary(ch) };
    });

    // --- Contact messages --------------------------------------------------------------------------------------------------------
    route("GET", "/api/messages", "messages", function (c) {
      return { messages: c.db.messages.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }) };
    }, { readonly: true });
    route("PATCH", "/api/messages/:id", "messages", function (c) {
      var m = c.db.messages.filter(function (x) { return x.id === c.params.id; })[0];
      if (!m) fail(404, "Message not found.");
      if (c.body.read !== undefined) m.read = bool(c.body.read);
      return { message: m };
    });
    route("DELETE", "/api/messages/:id", "messages", function (c) {
      c.db.messages = c.db.messages.filter(function (x) { return x.id !== c.params.id; });
      return { ok: true };
    });

    // =========================================================================
    // Dispatcher
    // =========================================================================
    function handle(req, db) {
      var method = String(req.method || "GET").toUpperCase();
      var path = String(req.path || "/").split("?")[0].replace(/\/+$/, "") || "/";
      var matched = null, params = {}, allowed = [];
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i], m = r.re.exec(path);
        if (!m) continue;
        allowed.push(r.method);
        if (r.method !== method) continue;
        matched = r;
        r.keys.forEach(function (k, j) { params[k] = decodeURIComponent(m[j + 1]); });
        break;
      }
      if (!matched) return { status: allowed.length ? 405 : 404, body: { error: allowed.length ? "Method not allowed." : "Not found." } };
      try {
        var auth = null;
        if (matched.area) {
          auth = authenticate(db, req);
          if (matched.area === "internal") {
            if (!req.internal) fail(403, "Not allowed.");
          } else {
            if (!auth) fail(401, "Sign in or send an API key.");
            if (matched.area !== "*" && !canSee(auth, matched.area)) fail(403, "Your role can't open this.");
            if (method !== "GET" && !auth.write) fail(403, "This API key is read-only.");
          }
        }
        var body = matched.handler({ db: db, req: req, params: params, query: req.query || {}, body: req.body || {}, auth: auth });
        return { status: matched.opts.status || 200, body: body, changed: !matched.opts.readonly || (auth && auth.kind === "key") };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: { error: e.message, fields: e.details } };
        throw e;
      }
    }

    return { handle: handle, dashboard: dashboard };
  }

  // ---------------------------------------------------------------------------
  // Fresh database from the seed
  // ---------------------------------------------------------------------------
  function freshDb(seed) {
    var db = clone(seed);
    ["users", "sessions", "apiKeys", "webhooks", "webhookLog", "orders", "customers", "chats", "messages", "media", "coupons"].forEach(function (k) { if (!db[k]) db[k] = []; });
    db.counters = db.counters || { order: 1000 };
    db.stats = db.stats || { days: {} };
    return db;
  }

  return { create: create, freshDb: freshDb, sha256: sha256, slugify: slugify, ROLES: ROLES, EVENTS: EVENTS,
    ORDER_STATUSES: ORDER_STATUSES, PAYMENT_STATUSES: PAYMENT_STATUSES, isPhone: isPhone, normPhone: normPhone };
});
