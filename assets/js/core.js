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
  // Links typed in the admin: web pages, store sections, email and phone only. "javascript:" links would run code for whoever clicks.
  function safeUrl(u) {
    u = String(u == null ? "" : u).trim();
    var bare = u.replace(/[\s\x00-\x1f]+/g, "").toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:/.test(bare) && !/^(https?|mailto|tel|sms|whatsapp):/.test(bare)) return "";
    return u;
  }

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
  var AREAS = ["dashboard", "orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "franchise", "users", "settings", "integrations"];
  var ROLES = {
    owner: { label: "Owner", areas: AREAS },
    manager: { label: "Manager", areas: ["dashboard", "orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "franchise", "settings"] },
    editor: { label: "Content editor", areas: ["products", "catalog", "content"] },
    support: { label: "Customer support", areas: ["dashboard", "orders", "customers", "chat", "messages"] },
    custom: { label: "Custom access", areas: [], custom: true }
  };
  // What a user can open: their role's areas, or the modules ticked for them when the role is "Custom access"
  function userAreas(u) {
    if (u.role === "custom") return (u.areas || []).filter(function (a) { return AREAS.indexOf(a) > -1; });
    return (ROLES[u.role] || ROLES.support).areas;
  }
  var FRANCHISE_STATUSES = ["new", "contacted", "meeting", "approved", "declined"];
  // API keys reach the store data, never users, settings or other keys.
  var KEY_AREAS = ["orders", "customers", "products", "catalog", "coupons", "content", "chat", "messages", "dashboard"];

  var ORDER_STATUSES = ["pending", "confirmed", "hold", "processing", "shipped", "delivered", "cancelled", "returned"];
  var PAYMENT_STATUSES = ["unpaid", "paid", "refunded", "failed"];
  var EVENTS = ["order.created", "order.updated", "product.created", "product.updated", "product.deleted", "stock.updated", "stock.low",
    "customer.created", "chat.message.created", "contact.created", "coupon.used", "franchise.created", "subscriber.created"];

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
      id: p.id, slug: p.slug, sku: p.sku, name: p.name, line: p.line, color: p.color, hex: p.hex, colorGroup: p.colorGroup || "",
      price: p.price, comparePrice: p.comparePrice || 0, description: p.description, details: p.details || [], seoTitle: p.seoTitle || "",
      images: p.images || [], sizeGuide: p.sizeGuide || "", categoryIds: p.categoryIds || [],
      attributes: p.attributes || [], isNew: !!p.isNew, featured: !!p.featured, trackStock: !!p.trackStock,
      stock: productStock(p), createdAt: p.createdAt,
      variants: (p.variants || []).map(function (v) {
        return { id: v.id, sku: v.sku, options: v.options, price: v.price == null || v.price === "" ? null : v.price, stock: p.trackStock ? Math.max(0, int(v.stock)) : null };
      })
    };
  }
  function publicUser(u) {
    return { id: u.id, name: u.name, email: u.email, role: u.role, areas: userAreas(u), createdAt: u.createdAt, lastLogin: u.lastLogin || null };
  }
  function orderSummary(o) {
    return { id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      customer: { name: o.customer.name, phone: o.customer.phone }, itemCount: o.items.reduce(function (s, i) { return s + i.qty; }, 0), total: o.total };
  }
  function chatSummary(c) {
    var last = c.messages[c.messages.length - 1];
    return { id: c.id, name: c.name, phone: c.phone, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
      unread: c.unreadAdmin || 0, lastMessage: last ? { from: last.from, text: last.text || (last.image ? "Photo" : ""), at: last.at } : null, page: c.page || "" };
  }
  // Header and footer options (Admin > Header & footer). Older databases get these defaults.
  var LAYOUT_DEFAULTS = {
    header: { announce: true, announceBg: "#111214", announceColor: "#ffffff", logo: "", logoHeight: 40, sticky: true, showSearch: true, showAccount: true },
    footer: { newsletter: true, newsletterButton: "Notify me", showPayments: true, showWordmark: true, wordmark: "RAVELLE", showContact: true,
      showSocial: true, showLegal: true, copyright: "" }
  };
  function siteLayout(s) {
    var l = (s && s.layout) || {}, out = {};
    Object.keys(LAYOUT_DEFAULTS).forEach(function (k) {
      out[k] = {};
      Object.keys(LAYOUT_DEFAULTS[k]).forEach(function (f) { var v = (l[k] || {})[f]; out[k][f] = v === undefined ? LAYOUT_DEFAULTS[k][f] : v; });
    });
    return out;
  }
  function siteCode(s) {
    var c = (s && s.code) || {};
    return { head: c.head || "", bodyEnd: c.bodyEnd || "", gaId: c.gaId || "", pixelId: c.pixelId || "", capiToken: c.capiToken || "", capiTest: c.capiTest || "", gaSecret: c.gaSecret || "",
      catalogId: c.catalogId || "", catalogToken: c.catalogToken || "" };
  }
  // The tracking snippets that go in <head>: Google Analytics 4, Meta Pixel, then any custom code
  function headCode(s) {
    var c = siteCode(s), out = "";
    if (c.gaId) out += '<script async src="https://www.googletagmanager.com/gtag/js?id=' + c.gaId + '"></script>\n' +
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','" + c.gaId + "');</script>\n";
    if (c.pixelId) out += "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
      "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];" +
      "s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','" + c.pixelId + "');</script>\n";
    return out + c.head;
  }
  function publicSettings(s) {
    return {
      store: s.store, social: s.social, shipping: s.shipping,
      payments: { cod: !!(s.payments && s.payments.cod), sslcommerz: !!(s.payments && s.payments.sslcommerz && s.payments.sslcommerz.enabled) },
      chat: { enabled: !!(s.chat && s.chat.enabled), greeting: s.chat && s.chat.greeting, title: s.chat && s.chat.title },
      seo: s.seo, announcement: s.announcement || "", lowStock: s.lowStock,
      layout: siteLayout(s), code: { head: headCode(s), bodyEnd: siteCode(s).bodyEnd, pixelId: siteCode(s).pixelId, gaId: siteCode(s).gaId }
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
      return { kind: "user", user: user, areas: userAreas(user), write: true, name: user.name };
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
      if (b.colorGroup !== undefined) p.colorGroup = str(b.colorGroup, 30);
      // Search engine title and description; left empty, the store writes them from the name, price and description
      if (b.seoTitle !== undefined) p.seoTitle = str(b.seoTitle, 80);
      if (b.seoDescription !== undefined) p.seoDescription = str(b.seoDescription, 200);
      if (b.hex !== undefined) p.hex = /^#[0-9a-f]{6}$/i.test(b.hex) ? b.hex : (p.hex || "#888888");
      if (b.sku !== undefined) p.sku = str(b.sku, 60).toUpperCase();
      if (b.status !== undefined) p.status = b.status === "draft" ? "draft" : "published";
      if (!p.status) p.status = "published";
      if (b.price !== undefined) p.price = Math.max(0, int(b.price));
      if (b.comparePrice !== undefined) p.comparePrice = Math.max(0, int(b.comparePrice));
      if (b.details !== undefined) p.details = (Array.isArray(b.details) ? b.details : String(b.details).split("\n")).map(function (d) { return str(d, 300); }).filter(Boolean).slice(0, 20);
      if (b.images !== undefined) p.images = (b.images || []).map(function (u) { return str(u, 4000000); }).filter(Boolean).slice(0, 20);
      if (b.sizeGuide !== undefined) p.sizeGuide = str(b.sizeGuide, 4000000);
      if (b.categoryIds !== undefined) p.categoryIds = (b.categoryIds || []).filter(function (id, i, all) { return all.indexOf(id) === i && db.categories.some(function (c) { return c.id === id; }); });
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
    // Is the product in one of these categories (or in a sub-category of one)?
    function inCats(db, p, ids) {
      if (!ids || !ids.length) return true;
      return (p.categoryIds || []).some(function (id) {
        var walk = id, n = 0;
        while (walk && n++ < 10) {
          if (ids.indexOf(walk) > -1) return true;
          var cat = db.categories.filter(function (x) { return x.id === walk; })[0];
          walk = cat ? cat.parentId : null;
        }
        return false;
      });
    }
    // Works out a coupon or automatic offer for a bag. cart = { lines, subtotal } (lines can be empty when only the total is known).
    // Returns { error } or the discount.
    function evalCoupon(db, c, cart) {
      var t = now();
      if (!c || !c.active) return { error: "That coupon code isn't valid." };
      if (c.startsAt && t < c.startsAt) return { error: "That coupon isn't active yet." };
      if (c.endsAt && t > c.endsAt) return { error: "That coupon has expired." };
      if (c.maxUses && c.used >= c.maxUses) return { error: "That coupon has been used up." };
      if (c.minOrder && cart.subtotal < c.minOrder) return { error: "Spend at least ৳" + c.minOrder.toLocaleString("en-US") + " to use this " + (c.auto ? "offer" : "coupon") + "." };
      var lines = cart.lines || [], scoped = !!(c.categoryIds && c.categoryIds.length && lines.length);
      var mine = scoped ? lines.filter(function (l) { var p = findProduct(db, l.productId); return p && inCats(db, p, c.categoryIds); }) : lines;
      var sub = scoped ? mine.reduce(function (s, l) { return s + l.lineTotal; }, 0) : cart.subtotal;
      var qty = mine.reduce(function (s, l) { return s + l.qty; }, 0);
      var names = function () { return (c.categoryIds || []).map(function (id) { var x = db.categories.filter(function (k) { return k.id === id; })[0]; return x ? x.name : ""; }).filter(Boolean).join(", "); };
      if (scoped && !mine.length) return { error: "This " + (c.auto ? "offer" : "code") + " is only for " + names() + "." };
      if (c.minQty && lines.length && qty < c.minQty) return { error: "Add " + (c.minQty - qty) + " more " + (scoped ? names() + " " : "") + (c.minQty - qty === 1 ? "piece" : "pieces") + " to use this " + (c.auto ? "offer" : "code") + ".", short: c.minQty - qty };
      var discount = 0, freeShipping = false;
      if (c.type === "percent") discount = Math.round(sub * Math.min(100, c.value) / 100);
      else if (c.type === "fixed") discount = Math.min(sub, c.value);
      else if (c.type === "shipping") freeShipping = true;
      if (c.maxDiscount && discount > c.maxDiscount) discount = c.maxDiscount;
      return { coupon: c, code: c.code, discount: discount, freeShipping: freeShipping, label: c.description || couponLabel(c), auto: !!c.auto };
    }
    function applyCoupon(db, code, cart) {
      if (typeof cart === "number") cart = { lines: [], subtotal: cart };
      var c = findCoupon(db, code);
      if (c && c.auto) fail(400, "That offer applies by itself when your bag qualifies. No code needed.");
      var r = evalCoupon(db, c, cart);
      if (r.error) fail(400, r.error);
      return r;
    }
    // The best automatic offer (a discount with no code, like "buy 2 tees, save ৳200") the bag qualifies for
    function autoOffer(db, cart) {
      var best = null;
      db.coupons.forEach(function (c) {
        if (!c.auto) return;
        var r = evalCoupon(db, c, cart);
        if (!r.error && (r.discount > 0 || r.freeShipping) && (!best || r.discount > best.discount)) best = r;
      });
      return best;
    }
    function publicOffer(c) {
      return { code: c.code, label: c.description || couponLabel(c), type: c.type, value: c.value, minQty: c.minQty || 0, minOrder: c.minOrder || 0,
        maxDiscount: c.maxDiscount || 0, categoryIds: c.categoryIds || [], endsAt: c.endsAt || null };
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
      // Automatic offer: applies without a code when the bag qualifies
      if (b.auto !== undefined) c.auto = bool(b.auto);
      if (b.minQty !== undefined) c.minQty = Math.max(0, Math.min(50, int(b.minQty)));
      if (b.categoryIds !== undefined) c.categoryIds = (Array.isArray(b.categoryIds) ? b.categoryIds : []).filter(function (id) { return db.categories.some(function (x) { return x.id === id; }); }).slice(0, 20);
      // Influencer or partner who shares this code, and their commission on its sales
      if (b.owner !== undefined) c.owner = str(b.owner, 60);
      if (b.commission !== undefined) c.commission = Math.max(0, Math.min(100, num(b.commission, 0)));
      if (c.auto && c.type === "shipping" && !c.minOrder && !c.minQty) fail(400, "Give an automatic free-delivery offer a minimum order or number of items.");
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
        var key = p.id + "|" + (v ? v.id : ""), already = lines.filter(function (l) { return l.productId + "|" + (l.variantId || "") === key; }).reduce(function (n, l) { return n + l.qty; }, 0);
        if (p.trackStock && stock < qty + already) {
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
      if (b.couponCode) c = applyCoupon(db, b.couponCode, cart);
      // An automatic offer applies too, unless the customer's code is worth more (they don't add up)
      var a = autoOffer(db, cart);
      if (a && (!c || (a.discount > c.discount && !c.freeShipping))) c = a;
      var discount = c ? c.discount : 0;
      var ship = b.zone ? shippingFee(db, b.zone, cart.subtotal - discount) : { fee: 0, zone: null };
      var fee = c && c.freeShipping ? 0 : ship.fee;
      return { lines: cart.lines, subtotal: cart.subtotal, discount: discount, coupon: c ? { code: c.code, label: c.label, auto: !!c.auto } : null,
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
    // Meta Conversions API: the server sends the same event as the browser Pixel, with the same event ID,
    // so Meta counts it once even when an ad blocker stops the browser copy. Only the Node server sends it.
    var CAPI_NAMES = { page: "PageView", view: "ViewContent", cart: "AddToCart", checkout: "InitiateCheckout", search: "Search",
      wishlist: "AddToWishlist", category: "ViewCategory", payment: "AddPaymentInfo", lead: "Lead", contact: "Contact" };
    function hashed(v) { v = String(v || "").trim().toLowerCase(); return v ? sha256(v) : undefined; }
    function capi(c, name, eventId, custom, person) {
      var code = siteCode(c.db.settings), req = c.req || {}, h = req.headers || {}, m = (c.body && c.body.meta) || c.body || {};
      if (!host.metaEvent || !code.pixelId || !code.capiToken || !eventId) return;
      person = person || {};
      var phone = person.phone ? "88" + normPhone(person.phone) : "";
      var names = String(person.name || "").trim().split(/\s+/);
      var user = {
        client_ip_address: req.ip || undefined, client_user_agent: h["user-agent"] || undefined,
        fbp: str(m.fbp, 120) || undefined, fbc: str(m.fbc, 300) || undefined,
        external_id: m.sid ? [hashed(m.sid)] : phone ? [hashed(phone)] : undefined,
        ph: phone ? [hashed(phone)] : undefined, em: person.email ? [hashed(person.email)] : undefined,
        fn: names[0] ? [hashed(names[0])] : undefined, ln: names.length > 1 ? [hashed(names[names.length - 1])] : undefined,
        ct: person.city ? [hashed(String(person.city).replace(/[^a-z]/gi, ""))] : undefined, country: [hashed("bd")]
      };
      Object.keys(user).forEach(function (k) { if (user[k] === undefined || (Array.isArray(user[k]) && !user[k][0])) delete user[k]; });
      host.metaEvent({
        pixelId: code.pixelId, token: code.capiToken, testCode: code.capiTest,
        event: { event_name: name, event_time: Math.floor(now() / 1000), event_id: String(eventId).slice(0, 80), action_source: "website",
          event_source_url: str(m.url, 500) || undefined, user_data: user, custom_data: custom || undefined }
      });
    }
    // Google Analytics 4 Measurement Protocol: the server reports purchases and refunds itself, so sales
    // still reach GA when an ad blocker stops the browser tag. GA drops a purchase it already has (same transaction_id).
    // Ads and catalogs know a product by its main SKU, not the size SKU
    function baseSku(db, it) { var p = findProduct(db, it.productId); return (p && p.sku) || it.sku; }
    function gaServer(c, order, name) {
      var code = siteCode(c.db.settings), ga = order.ga || {};
      if (!host.gaEvent || !code.gaId || !code.gaSecret) return;
      var params = {
        transaction_id: order.number, currency: "BDT", value: order.total, engagement_time_msec: 1,
        items: order.items.map(function (it) { return { item_id: baseSku(c.db, it), item_name: it.name, item_variant: it.color || undefined, price: it.price, quantity: it.qty }; })
      };
      if (name === "purchase") { params.shipping = order.shipping || 0; if (order.coupon) params.coupon = order.coupon; if (order.discount) params.discount = order.discount; }
      if (ga.sid) params.session_id = ga.sid;
      host.gaEvent({ measurementId: code.gaId, secret: code.gaSecret, body: {
        client_id: ga.cid || ("rv." + (ga.vid || order.id)), timestamp_micros: (name === "purchase" ? order.createdAt : now()) * 1000,
        events: [{ name: name, params: params }]
      } });
    }
    // Admin "test" buttons on the Pixel & Analytics page
    // Sends every product to the Meta catalog now (it's also kept in step on every change)
    route("POST", "/api/catalog/sync", "settings", function (c) {
      var code = siteCode(c.db.settings);
      if (!code.catalogId) fail(400, "Add the catalog ID first.");
      if (!code.catalogToken && !code.capiToken) fail(400, "Add an access token first.");
      if (!host.catalogSync) fail(400, "The catalog is updated from the live store. The demo has no server.");
      return host.catalogSync(null);
    });
    route("POST", "/api/tracking/test", "settings", function (c) {
      var code = siteCode(c.db.settings), kind = str(c.body.kind, 10);
      if (kind === "meta") {
        if (!code.pixelId) fail(400, "Add the Pixel ID first.");
        if (!code.capiToken) fail(400, "Add the Conversions API access token first.");
        if (!host.metaEvent) fail(400, "Server events are sent from the live store. The demo has no server.");
        var cust = { name: "Test Customer", phone: "01700000000", city: "Dhaka" };
        capi({ db: c.db, req: c.req, body: { meta: { url: (c.req.headers || {}).referer || "", sid: "admin-test" } } }, "PageView", "test." + now(), { content_name: "Ravelle admin test" }, cust);
        return { ok: true, message: "Sent a test PageView to Meta. " + (code.capiTest ? "Look for it in Events Manager › Test events (code " + code.capiTest + ")." : "Add a test event code to see it in Events Manager › Test events.") + " Meta's answer shows here after you reload." };
      }
      if (kind === "ga") {
        if (!code.gaId) fail(400, "Add the Measurement ID first.");
        if (!code.gaSecret) fail(400, "Add the API secret first.");
        if (!host.gaEvent) fail(400, "Server events are sent from the live store. The demo has no server.");
        host.gaEvent({ measurementId: code.gaId, secret: code.gaSecret, debug: true, body: { client_id: "ravelle.admin.test", events: [{ name: "ravelle_test", params: { engagement_time_msec: 1 } }] } });
        return { ok: true, message: "Asked Google to check the ID and secret. The result shows here after you reload." };
      }
      fail(400, "Unknown test.");
    });
    function capiTrack(c, t, b) {
      var name = CAPI_NAMES[t];
      if (!name || !host.metaEvent) return;
      var p = b.productId ? findProduct(c.db, str(b.productId, 40)) : null, custom = null;
      if ((t === "view" || t === "cart" || t === "wishlist") && !p) return;
      var catName = function (x) { var ids = x.categoryIds || [], cat = findCategory(ids[ids.length - 1]) || findCategory(ids[0]); return cat ? cat.name : undefined; };
      var findCategory = function (id) { return c.db.categories.filter(function (x) { return x.id === id; })[0]; };
      if (p) {
        var q = t === "cart" ? Math.max(1, int(b.qty, 1)) : 1;
        custom = { content_ids: [p.sku], content_name: p.name, content_category: catName(p), content_type: "product",
          contents: [{ id: p.sku, quantity: q, item_price: p.price }], currency: "BDT", value: p.price * q };
      }
      if (t === "checkout" || t === "payment") {
        var items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map(function (l) { var x = findProduct(c.db, str(l.productId, 40)); return x ? { id: x.sku, quantity: Math.max(1, int(l.qty, 1)), item_price: x.price } : null; }).filter(Boolean);
        custom = { content_ids: items.map(function (x) { return x.id; }), contents: items, content_type: "product", currency: "BDT",
          num_items: items.reduce(function (s, x) { return s + x.quantity; }, 0), value: items.reduce(function (s, x) { return s + x.item_price * x.quantity; }, 0) };
        if (t === "payment") custom.payment_method = str(b.method, 40);
      }
      if (t === "search") custom = { search_string: str(b.q, 60), content_type: "product", content_ids: (Array.isArray(b.ids) ? b.ids : []).slice(0, 10).map(function (x) { return str(x, 40); }) };
      if (t === "category") custom = { content_category: str(b.name, 80), content_type: "product", content_ids: (Array.isArray(b.ids) ? b.ids : []).slice(0, 20).map(function (x) { return str(x, 40); }) };
      if (t === "lead") custom = { content_name: str(b.topic, 80), content_category: "email signup" };
      if (t === "contact") custom = { content_name: str(b.method, 40) };
      var cu = b.cu && typeof b.cu === "object" ? { name: str(b.cu.name, 80), phone: isPhone(b.cu.phone || "") ? str(b.cu.phone, 20) : "", email: str(b.cu.email, 120), city: str(b.cu.city, 60) } : {};
      if (t === "lead" && b.em) cu.email = str(b.em, 120);
      capi(c, name, str(b.eid, 80), custom, cu);
    }
    // Add one to a counter in a map, folding rare keys into "Other" so a day stays small
    function bump(map, key, by, cap) {
      key = String(key || "").slice(0, 60) || "Unknown";
      if (!(key in map) && Object.keys(map).length >= (cap || 150)) key = "Other";
      map[key] = (map[key] || 0) + (by || 1);
    }
    var FUNNEL_BIT = { view: 2, cart: 4, checkout: 8 };
    function track(db, type, productId, sid, extra, info) {
      var t = now(), d = dayKey(t);
      info = info || {};
      db.stats = db.stats || { days: {} };
      var day = db.stats.days[d] = db.stats.days[d] || { visits: 0, views: {}, carts: {}, sids: {} };
      day.sids = day.sids || {};
      ["pages", "src", "dev", "br", "os", "lands", "searches", "noResults"].forEach(function (k) { day[k] = day[k] || {}; });
      day.hours = day.hours || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      day.funnel = day.funnel || { view: 0, cart: 0, checkout: 0 };
      var mask = sid ? (day.sids[sid] || 0) : 0;
      if (type === "visit") {
        if (sid && !(mask & 1)) {
          day.sids[sid] = mask | 1; day.visits++;
          if (info.nv) day.newVisitors = (day.newVisitors || 0) + 1;
          bump(day.src, info.src || "Direct"); bump(day.dev, info.dev); bump(day.br, info.br); bump(day.os, info.os);
          bump(day.lands, info.path || "home");
          day.hours[(new Date(t).getUTCHours() + 6) % 24]++; // Bangladesh time
        }
        return;
      }
      if (type === "page") { day.pageviews = (day.pageviews || 0) + 1; bump(day.pages, info.path || "home", 1, 300); return; }
      if (type === "search") { bump(day.searches, String(info.q || "").toLowerCase().trim(), 1, 300); if (!info.n) bump(day.noResults, String(info.q || "").toLowerCase().trim(), 1, 200); return; }
      if (FUNNEL_BIT[type] && sid && !(mask & FUNNEL_BIT[type])) { day.sids[sid] = mask | FUNNEL_BIT[type]; day.funnel[type]++; }
      if (type === "checkout") { day.checkouts = (day.checkouts || 0) + 1; return; }
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

    // Everything on the Analytics page: traffic, sources, devices, funnel, sales and products
    function analytics(db, days) {
      var base = dashboard(db, days);
      var start = base.range.start, end = base.range.end, n = base.range.days;
      var counted = function (o) { return o.status !== "cancelled" && o.paymentStatus !== "failed"; };
      var sumMaps = function (key) {
        var out = {};
        Object.keys((db.stats || {}).days || {}).forEach(function (k) {
          var t = new Date(k + "T12:00:00Z").getTime();
          if (t < start || t > end) return;
          var m = db.stats.days[k][key] || {};
          Object.keys(m).forEach(function (x) { out[x] = (out[x] || 0) + m[x]; });
        });
        return Object.keys(out).map(function (x) { return { label: x, value: out[x] }; }).sort(function (a, b) { return b.value - a.value; });
      };
      var tot = { pageviews: 0, newVisitors: 0, checkouts: 0, fView: 0, fCart: 0, fCheckout: 0 }, hours = [];
      for (var h = 0; h < 24; h++) hours.push({ visits: 0, orders: 0, revenue: 0 });
      var series = base.series.map(function (s) {
        var ds = ((db.stats || {}).days || {})[s.date] || {};
        tot.pageviews += ds.pageviews || 0; tot.newVisitors += ds.newVisitors || 0; tot.checkouts += ds.checkouts || 0;
        var f = ds.funnel || {};
        tot.fView += f.view || 0; tot.fCart += f.cart || 0; tot.fCheckout += f.checkout || 0;
        (ds.hours || []).forEach(function (v, i) { hours[i].visits += v; });
        return { date: s.date, visits: s.visits, pageviews: ds.pageviews || 0, orders: s.orders, revenue: s.revenue, newVisitors: ds.newVisitors || 0 };
      });
      var orders = db.orders.filter(function (o) { return o.createdAt >= start && o.createdAt <= end; });
      var good = orders.filter(counted);
      var weekdays = [0, 1, 2, 3, 4, 5, 6].map(function () { return { orders: 0, revenue: 0 }; });
      var bySource = {}, byCity = {}, coupons = {}, sizes = {}, colours = {}, payStatus = {}, customers = {};
      good.forEach(function (o) {
        var bd = new Date(o.createdAt + 6 * 36e5);
        hours[bd.getUTCHours()].orders++; hours[bd.getUTCHours()].revenue += o.total;
        weekdays[bd.getUTCDay()].orders++; weekdays[bd.getUTCDay()].revenue += o.total;
        bump(bySource, o.source && o.source !== "website" ? o.source : "Direct", o.total, 100);
        bump(byCity, (o.customer.city || "").trim() || (o.shippingZone && o.shippingZone.name) || "Not given", o.total, 100);
        if (o.coupon) { coupons[o.coupon] = coupons[o.coupon] || { code: o.coupon, orders: 0, discount: 0, revenue: 0 }; coupons[o.coupon].orders++; coupons[o.coupon].discount += o.discount || 0; coupons[o.coupon].revenue += o.total; }
        o.items.forEach(function (it) {
          var size = (it.options || {}).Size || (it.options || {}).size || Object.keys(it.options || {}).map(function (k) { return it.options[k]; }).join(" / ") || "One size";
          bump(sizes, size, it.qty, 60); bump(colours, it.color || "Other", it.qty, 60);
        });
        var ph = normPhone(o.customer.phone);
        customers[ph] = customers[ph] || { name: o.customer.name, phone: ph, orders: 0, revenue: 0, first: o.createdAt };
        customers[ph].orders++; customers[ph].revenue += o.total;
      });
      orders.forEach(function (o) { bump(payStatus, o.paymentStatus || "unpaid"); });
      var list = function (m) { return Object.keys(m).map(function (k) { return { label: k, value: m[k] }; }).sort(function (a, b) { return b.value - a.value; }); };
      var newRev = 0, retRev = 0;
      Object.keys(customers).forEach(function (ph) {
        var before = db.orders.some(function (o) { return normPhone(o.customer.phone) === ph && o.createdAt < start; });
        if (before) retRev += customers[ph].revenue; else newRev += customers[ph].revenue;
      });
      var cancelled = orders.filter(function (o) { return o.status === "cancelled"; }).length;
      var returned = orders.filter(function (o) { return o.status === "returned"; }).length;
      var visits = base.totals.visits;
      return {
        range: base.range, totals: base.totals, previous: base.previous,
        traffic: { visits: visits, pageviews: tot.pageviews, newVisitors: Math.min(tot.newVisitors, visits), pagesPerVisit: visits ? +(tot.pageviews / visits).toFixed(1) : 0, checkouts: tot.checkouts },
        series: series,
        funnel: [
          { label: "Visited the store", value: visits },
          { label: "Viewed a product", value: Math.min(visits, tot.fView) },
          { label: "Added to bag", value: Math.min(visits, tot.fCart) },
          { label: "Started checkout", value: Math.min(visits, tot.fCheckout) },
          { label: "Placed an order", value: base.totals.orders }
        ],
        sources: sumMaps("src"), devices: sumMaps("dev"), browsers: sumMaps("br"), systems: sumMaps("os"),
        pages: sumMaps("pages").slice(0, 25), landing: sumMaps("lands").slice(0, 15),
        searches: sumMaps("searches").slice(0, 20), noResults: sumMaps("noResults").slice(0, 20),
        hours: hours, weekdays: weekdays,
        revenueBySource: list(bySource), revenueByCity: list(byCity).slice(0, 15),
        coupons: Object.keys(coupons).map(function (k) { return coupons[k]; }).sort(function (a, b) { return b.orders - a.orders; }),
        sizes: list(sizes), colours: list(colours).slice(0, 15), paymentStatus: list(payStatus),
        byPayment: base.byPayment, byStatus: base.byStatus, byZone: base.byZone, categories: base.categories, products: base.products,
        customers: { buyers: base.customers.buyers, returning: base.customers.returning, total: base.customers.total, newRevenue: newRev, returningRevenue: retRev,
          top: Object.keys(customers).map(function (k) { return customers[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 10) },
        rates: { cancelled: orders.length ? +(cancelled / orders.length * 100).toFixed(1) : 0, returned: orders.length ? +(returned / orders.length * 100).toFixed(1) : 0,
          bagToOrder: tot.fCart ? +(base.totals.orders / tot.fCart * 100).toFixed(1) : 0, abandoned: Math.max(0, tot.fCheckout - base.totals.orders) }
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
        pages: publicPages(db.pages),
        menus: db.menus,
        offers: db.coupons.filter(function (x) { var t = now(); return x.auto && x.active && (!x.startsAt || x.startsAt <= t) && (!x.endsAt || x.endsAt >= t) && (!x.maxUses || x.used < x.maxUses); }).map(publicOffer)
      };
    });
    // The popup's welcome code is only handed out after someone signs up
    function publicPages(pages) {
      if (!pages.popup || !pages.popup.welcomeCode) return pages;
      var out = Object.assign({}, pages);
      out.popup = Object.assign({}, pages.popup);
      delete out.popup.welcomeCode;
      out.popup.hasCode = true;
      return out;
    }

    // --- Subscribers: email or phone left in the popup, the footer "Notify me" box and coming-soon pages ----------
    route("POST", "/api/subscribe", null, function (c) {
      var db = c.db, b = c.body || {};
      var email = str(b.email, 120).toLowerCase(), phone = str(b.phone, 20), source = str(b.source, 60) || "newsletter";
      var okE = email && isEmail(email), okP = phone && isPhone(phone);
      if (email && !okE) fail(400, "That email doesn't look right.");
      if (phone && !okP) fail(400, "Enter a Bangladeshi mobile number, like 01712345678.");
      if (!okE && !okP) fail(400, "Enter your email or phone number.");
      if (okP) phone = normPhone(phone); else phone = "";
      if (!okE) email = "";
      db.subscribers = db.subscribers || [];
      var s = db.subscribers.filter(function (x) { return (email && x.email === email) || (phone && x.phone === phone); })[0];
      var isNew = !s;
      if (!s) { s = { id: newId("sub"), email: email, phone: phone, source: source, sources: [source], createdAt: now() }; db.subscribers.push(s); }
      else {
        if (email && !s.email) s.email = email;
        if (phone && !s.phone) s.phone = phone;
        if ((s.sources || []).indexOf(source) < 0) s.sources = (s.sources || [s.source]).concat(source).slice(-10);
        s.updatedAt = now();
      }
      if (b.name) s.name = str(b.name, 80);
      if (db.subscribers.length > 50000) db.subscribers = db.subscribers.slice(-50000);
      if (isNew) emit(db, "subscriber.created", s);
      // The popup's welcome code, when it is set and still valid
      var out = { ok: true };
      var pop = db.pages.popup || {};
      if (source === "popup" && pop.welcomeCode) {
        var cp = findCoupon(db, pop.welcomeCode), r = cp ? evalCoupon(db, cp, { lines: [], subtotal: 1e9 }) : { error: 1 };
        if (!r.error) { out.code = cp.code; out.label = cp.description || couponLabel(cp); }
      }
      return out;
    }, { status: 201 });
    route("GET", "/api/subscribers", "customers", function (c) {
      var q = str(c.query.q).toLowerCase();
      var list = (c.db.subscribers || []).filter(function (s) { return !q || ((s.email || "") + " " + (s.phone || "") + " " + (s.name || "") + " " + (s.sources || []).join(" ")).toLowerCase().indexOf(q) > -1; })
        .slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      return { subscribers: list.slice(0, int(c.query.limit, 5000)), total: list.length };
    }, { readonly: true });
    route("DELETE", "/api/subscribers/:id", "customers", function (c) {
      var before = (c.db.subscribers || []).length;
      c.db.subscribers = (c.db.subscribers || []).filter(function (s) { return s.id !== c.params.id; });
      if (c.db.subscribers.length === before) fail(404, "Subscriber not found.");
      return { ok: true };
    });
    // Customer list for ad audiences: Meta Custom Audiences and Google Customer Match.
    // who = buyers | subscribers | all. The platforms hash the file themselves when it's uploaded.
    route("GET", "/api/audience", "customers", function (c) {
      var db = c.db, who = str(c.query.who) || "all", rows = [], seen = {};
      var split = function (n) { var w = String(n || "").trim().split(/\s+/); return { fn: w[0] || "", ln: w.length > 1 ? w[w.length - 1] : "" }; };
      var add = function (r) {
        var k = (r.phone || "") + "|" + (r.email || "");
        if (k === "|" || seen[r.phone] || seen[r.email]) return;
        if (r.phone) seen[r.phone] = 1;
        if (r.email) seen[r.email] = 1;
        rows.push(r);
      };
      var e164 = function (p) { p = String(p || "").replace(/\D/g, ""); return p ? "+" + (p.length === 11 ? "88" + p : p) : ""; };
      if (who !== "subscribers") db.customers.forEach(function (cu) {
        var st = customerStats(db, cu), nm = split(cu.name);
        if (!st.orders) return;
        add({ email: (cu.email || "").toLowerCase(), phone: e164(cu.phone), fn: nm.fn, ln: nm.ln, ct: cu.city || "", country: "BD", value: st.spent || 0, kind: "buyer" });
      });
      if (who !== "buyers") (db.subscribers || []).forEach(function (s) {
        var nm = split(s.name);
        add({ email: s.email || "", phone: e164(s.phone), fn: nm.fn, ln: nm.ln, ct: "", country: "BD", value: 0, kind: "subscriber" });
      });
      return { rows: rows, total: rows.length };
    }, { readonly: true });
    // Sales by coupon and by the influencer who shares it, for a date range
    route("GET", "/api/coupons/report", "coupons", function (c) {
      var db = c.db, to = num(c.query.to, 0) || now(), from = num(c.query.from, 0) || to - num(c.query.days, 30) * 864e5;
      var by = {};
      db.orders.forEach(function (o) {
        if (!o.coupon || o.createdAt < from || o.createdAt > to || o.status === "cancelled" || o.paymentStatus === "failed") return;
        var cp = findCoupon(db, o.coupon) || {}, k = o.coupon;
        var r = by[k] = by[k] || { code: k, owner: cp.owner || "", commission: cp.commission || 0, auto: !!cp.auto, orders: 0, units: 0, revenue: 0, discount: 0, returned: 0, delivered: 0 };
        if (o.status === "returned") { r.returned++; return; }
        r.orders++; r.revenue += o.total; r.discount += o.discount || 0;
        r.units += o.items.reduce(function (s, i) { return s + i.qty; }, 0);
        if (o.status === "delivered") r.delivered++;
      });
      var codes = Object.keys(by).map(function (k) { var r = by[k]; r.payout = Math.round((r.revenue - 0) * r.commission / 100); return r; }).sort(function (a, b) { return b.revenue - a.revenue; });
      var owners = {};
      codes.forEach(function (r) {
        if (!r.owner) return;
        var o = owners[r.owner] = owners[r.owner] || { owner: r.owner, codes: [], orders: 0, revenue: 0, discount: 0, payout: 0 };
        o.codes.push(r.code); o.orders += r.orders; o.revenue += r.revenue; o.discount += r.discount; o.payout += r.payout;
      });
      return { from: from, to: to, codes: codes, owners: Object.keys(owners).map(function (k) { return owners[k]; }).sort(function (a, b) { return b.revenue - a.revenue; }) };
    }, { readonly: true });
    route("POST", "/api/track", null, function (c) {
      var t = str(c.body.type, 10), b = c.body;
      if (["visit", "view", "cart", "page", "search", "checkout", "wishlist", "category", "payment", "lead", "contact"].indexOf(t) < 0) fail(400, "Unknown event.");
      track(c.db, t, str(b.productId, 40), str(b.sid, 40), 0, {
        path: str(b.path, 80), src: str(b.src, 40), dev: str(b.dev, 20), br: str(b.br, 30), os: str(b.os, 20), nv: !!b.nv, q: str(b.q, 60), n: int(b.n)
      });
      capiTrack(c, t, b);
      return { ok: true };
    }, { quiet: true });

    // Checkout
    route("POST", "/api/checkout/quote", null, function (c) {
      var q = quote(c.db, c.body);
      return { subtotal: q.subtotal, discount: q.discount, coupon: q.coupon, shipping: q.shipping, total: q.total, lines: q.lines };
    }, { readonly: true });
    route("POST", "/api/coupons/validate", null, function (c) {
      var cart = Array.isArray(c.body.items) && c.body.items.length ? priceCart(c.db, c.body.items.slice(0, 50)) : { lines: [], subtotal: Math.max(0, int(c.body.subtotal)) };
      var r = applyCoupon(c.db, c.body.code, cart);
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
      var gm = b.meta || {};
      order.ga = { cid: str(gm.gaCid, 60), sid: str(gm.gaSid, 30), vid: str(gm.sid, 40) };
      emit(db, "order.created", order);
      gaServer(c, order, "purchase");
      acoreSync(c, order);
      cartsOrdered(db, order, str(b.cartId, 40));
      invoiceEmail(db, order);
      capi(c, "Purchase", order.number, {
        content_ids: order.items.map(function (it) { return baseSku(db, it); }), content_type: "product", num_items: order.items.reduce(function (n, it) { return n + it.qty; }, 0), currency: "BDT", value: order.total, delivery_category: "home_delivery",
        contents: order.items.map(function (it) { return { id: baseSku(db, it), quantity: it.qty, item_price: it.price }; }), order_id: order.number
      }, order.customer);
      return { order: publicOrder(order) };
    }, { status: 201 });

    function publicOrder(o) {
      return { number: o.number, createdAt: o.createdAt, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
        customer: { name: o.customer.name, phone: o.customer.phone.replace(/^(\d{3})\d{5}/, "$1•••••"), address: o.customer.address, city: o.customer.city },
        shippingZone: o.shippingZone, items: o.items, subtotal: o.subtotal, discount: o.discount, coupon: o.coupon, shipping: o.shipping, total: o.total,
        tracking: o.tracking || "", courier: o.courier ? { name: o.courier.name || "", code: o.courier.trackingCode || o.courier.consignmentId || "", url: o.courier.trackingUrl || "",
          rider: o.status === "shipped" ? o.courier.riderName || "" : "", riderPhone: o.status === "shipped" ? o.courier.riderPhone || "" : "" } : null, history: o.history.filter(function (h) { return !h.internal; }).map(function (h) { return { at: h.at, status: h.status, note: h.public || "" }; }) };
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

    // =========================================================================
    // Email (company Gmail over SMTP) and abandoned carts
    // =========================================================================
    var EMAIL_DEFAULTS = { enabled: false, host: "smtp.gmail.com", port: 465, user: "", password: "", fromName: "Ravelle", replyTo: "", invoice: true, copyTo: "",
      notifyConfirmed: true, notifyShipped: true, notifyDelivered: true };
    var CART_DEFAULTS = { enabled: true, delay1: 20, delay2: 24, subject1: "You left something in your bag", text1: "Your pieces are still waiting. Sizes sell out fast, so finish your order while they're in stock.",
      subject2: "Still thinking it over?", text2: "Your bag is saved. Complete your order today with cash on delivery all over Bangladesh.", coupon: "" };
    function emailSettings(db) { return Object.assign({}, EMAIL_DEFAULTS, (db.settings || {}).email || {}); }
    function cartSettings(db) { return Object.assign({}, CART_DEFAULTS, (db.settings || {}).carts || {}); }
    function siteUrl(db) { return String(host.publicUrl || ((db.settings.store || {}).website ? "https://" + String(db.settings.store.website).replace(/^https?:\/\//, "") : "")).replace(/\/+$/, ""); }
    function money(n) { return "৳" + Number(n || 0).toLocaleString("en-IN"); }
    function h(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
    function absImg(db, u) { if (!u || /^data:/.test(u)) return ""; return /^https?:/.test(u) ? u : siteUrl(db) ? siteUrl(db) + "/" + u.replace(/^\//, "") : ""; }
    // Sends one email, and keeps a line in the email log (Admin › Email & reminders)
    function sendEmail(db, to, subject, html, text, kind, ref) {
      var es = emailSettings(db);
      db.emailLog = db.emailLog || [];
      var entry = { id: newId("eml"), at: now(), to: to, subject: subject, kind: kind, ref: ref || "", status: "sending", ok: null };
      db.emailLog.push(entry);
      if (db.emailLog.length > 300) db.emailLog = db.emailLog.slice(-300);
      if (!host.sendEmail) { entry.status = "Demo: not sent (the demo has no email server)"; entry.ok = false; return entry; }
      if (!es.enabled || !es.user || !es.password) { entry.status = "Not sent: turn on email in Admin › Email & reminders"; entry.ok = false; return entry; }
      host.sendEmail({ id: entry.id, smtp: { host: es.host, port: int(es.port, 465), user: es.user, password: es.password },
        from: { name: es.fromName || (db.settings.store || {}).name || "Ravelle", email: es.user }, replyTo: es.replyTo || "", to: to, subject: subject, html: html, text: text });
      return entry;
    }
    function emailShell(db, title, body) {
      var st = db.settings.store || {}, site = siteUrl(db);
      return '<!doctype html><html><body style="margin:0;background:#eef0f1;font-family:Arial,Helvetica,sans-serif;color:#111214">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f1;padding:24px 12px"><tr><td align="center">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">' +
        '<tr><td style="background:#111214;padding:22px 28px;color:#ffffff;font-size:20px;letter-spacing:6px;font-weight:bold">' + h((st.name || "Ravelle").toUpperCase()) + "</td></tr>" +
        '<tr><td style="padding:28px">' + (title ? '<h1 style="margin:0 0 14px;font-size:22px;text-transform:uppercase">' + h(title) + "</h1>" : "") + body + "</td></tr>" +
        '<tr><td style="padding:18px 28px;background:#f6f7f8;font-size:12px;color:#5f6368;line-height:1.6">' + h(st.legalName || st.name || "Ravelle") +
          (st.address ? "<br>" + h(st.address) : "") + (st.phone ? "<br>Phone: " + h(st.phone) : "") + (st.email ? " · " + h(st.email) : "") + (site ? '<br><a href="' + h(site) + '" style="color:#5f6368">' + h(site.replace(/^https?:\/\//, "")) + "</a>" : "") +
        "</td></tr></table></td></tr></table></body></html>";
    }
    function itemsTable(db, items) {
      return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">' + items.map(function (it) {
        var img = absImg(db, it.image), opts = Object.keys(it.options || {}).map(function (k) { return k + ": " + it.options[k]; }).join(", ");
        return '<tr><td style="padding:10px 0;border-bottom:1px solid #e3e5e8;width:64px">' + (img ? '<img src="' + h(img) + '" width="56" height="70" style="display:block;border-radius:8px;object-fit:cover" alt="">' : "") + "</td>" +
          '<td style="padding:10px 12px;border-bottom:1px solid #e3e5e8"><b>' + h(it.name) + '</b><br><span style="color:#5f6368;font-size:12px">' + h(opts) + (opts ? " · " : "") + "Qty " + it.qty + "</span></td>" +
          '<td align="right" style="padding:10px 0;border-bottom:1px solid #e3e5e8;white-space:nowrap">' + money(it.lineTotal != null ? it.lineTotal : it.price * it.qty) + "</td></tr>";
      }).join("") + "</table>";
    }
    function button(url, label) { return url ? '<p style="margin:22px 0 6px"><a href="' + h(url) + '" style="display:inline-block;background:#111214;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:13px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">' + h(label) + "</a></p>" : ""; }
    // Invoice email, sent the moment an order is placed
    function invoiceEmail(db, o) {
      var es = emailSettings(db), site = siteUrl(db);
      if (!es.invoice) return;
      var to = [o.customer.email].filter(function (e) { return e && isEmail(e); });
      var copy = String(es.copyTo || "").split(/[,\s]+/).filter(isEmail);
      if (!to.length && !copy.length) return;
      var pay = o.paymentMethod === "cod" ? "Cash on delivery" : "Online payment (SSLCOMMERZ)";
      var row = function (l, v, b) { return '<tr><td style="padding:4px 0;color:#5f6368">' + l + '</td><td align="right" style="padding:4px 0' + (b ? ";font-weight:bold;font-size:16px" : "") + '">' + v + "</td></tr>"; };
      var body = '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hi ' + h(o.customer.name.split(" ")[0]) + ", thanks for your order. We'll call you on " + h(o.customer.phone) + " to confirm it.</p>" +
        '<table role="presentation" width="100%" style="font-size:13px;margin-bottom:16px"><tr><td><b>Invoice / Order ' + h(o.number) + "</b></td><td align=\"right\" style=\"color:#5f6368\">" + h(new Date(o.createdAt).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" })) + "</td></tr></table>" +
        itemsTable(db, o.items) +
        '<table role="presentation" width="100%" style="font-size:14px;margin-top:12px">' + row("Subtotal", money(o.subtotal)) + (o.discount ? row("Discount" + (o.coupon ? " (" + h(o.coupon) + ")" : ""), "−" + money(o.discount)) : "") +
          row("Delivery" + (o.shippingZone ? " · " + h(o.shippingZone.name) : ""), money(o.shipping)) + row("Total", money(o.total), true) + row("Payment", pay) + "</table>" +
        '<table role="presentation" width="100%" style="font-size:13px;margin-top:20px;background:#f6f7f8;border-radius:12px"><tr><td style="padding:14px 16px;line-height:1.6"><b>Delivery to</b><br>' + h(o.customer.name) + "<br>" + h(o.customer.address) + (o.customer.city ? ", " + h(o.customer.city) : "") + "<br>" + h(o.customer.phone) +
          (o.shippingZone && o.shippingZone.days ? '<br><span style="color:#5f6368">Delivery in ' + h(o.shippingZone.days) + "</span>" : "") + (o.note ? '<br><span style="color:#5f6368">Note: ' + h(o.note) + "</span>" : "") + "</td></tr></table>" +
        button(site ? site + "/track" : "", "Track your order");
      var text = "Thanks for your order " + o.number + ".\n\n" + o.items.map(function (it) { return it.qty + " × " + it.name + " – " + money(it.lineTotal); }).join("\n") +
        "\n\nTotal: " + money(o.total) + " (" + pay + ")\nDelivery to: " + o.customer.name + ", " + o.customer.address + (o.customer.city ? ", " + o.customer.city : "") + "\n" + (site ? "\nTrack your order: " + site + "/track\n" : "");
      var subject = "Your order " + o.number + " · invoice from " + ((db.settings.store || {}).name || "Ravelle");
      if (to.length) sendEmail(db, to[0], subject, emailShell(db, "Order received", body), text, "invoice", o.number);
      copy.forEach(function (e) { sendEmail(db, e, "New order " + o.number + " · " + money(o.total) + " · " + o.customer.name, emailShell(db, "New order", body), text, "invoice-copy", o.number); });
    }
    // Order updates: one email when an order is confirmed, handed to the courier, and delivered (each sent once)
    var STATUS_MAIL = {
      confirmed: { key: "notifyConfirmed", title: "Order confirmed", subject: "Your order {n} is confirmed",
        text: "your order is confirmed. We're packing it now and will hand it to the courier soon." },
      shipped: { key: "notifyShipped", title: "On its way", subject: "Your order {n} is on its way",
        text: "your order has left our warehouse and is with the courier." },
      delivered: { key: "notifyDelivered", title: "Delivered", subject: "Your order {n} has been delivered",
        text: "your order has been delivered. We hope you love it. If a size isn't right, you can exchange it within 7 days." }
    };
    function statusEmail(db, o) {
      var m = STATUS_MAIL[o.status], es = emailSettings(db), site = siteUrl(db);
      if (!m || !es[m.key] || !o.customer || !o.customer.email || !isEmail(o.customer.email)) return;
      o.notified = o.notified || {};
      if (o.notified[o.status]) return;
      // An online payment confirms the order and the invoice already says so
      if (o.status === "confirmed" && o.paymentMethod !== "cod" && o.paymentStatus === "paid" && now() - o.createdAt < 36e5) return;
      o.notified[o.status] = now();
      var cr = o.courier || {}, track = cr.trackingUrl || "", code = cr.trackingCode || cr.consignmentId || "";
      var courierLine = o.status === "shipped" && (o.tracking || code) ? '<p style="margin:0 0 16px;padding:14px 16px;background:#f6f7f8;border-radius:12px;font-size:14px;line-height:1.6"><b>Courier</b><br>' +
        h(o.tracking || [cr.name, code].filter(Boolean).join(" ")) + (cr.riderName ? "<br>Rider: " + h(cr.riderName) + (cr.riderPhone ? " · " + h(cr.riderPhone) : "") : "") +
        (o.shippingZone && o.shippingZone.days ? '<br><span style="color:#5f6368">Usually arrives in ' + h(o.shippingZone.days) + "</span>" : "") + "</p>" : "";
      var cod = o.paymentMethod === "cod" && o.paymentStatus !== "paid" && o.status !== "delivered" ? '<p style="margin:0 0 16px;font-size:14px">Please keep <b>' + money(o.total) + "</b> ready for the rider (cash on delivery).</p>" : "";
      var body = '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hi ' + h(o.customer.name.split(" ")[0]) + ", " + h(m.text) + "</p>" + courierLine + cod +
        '<p style="margin:0 0 8px;font-size:13px;color:#5f6368">Order ' + h(o.number) + "</p>" + itemsTable(db, o.items) +
        (o.status === "shipped" && track ? button(track, "Track with the courier") : o.status === "delivered" ? button(site ? site + "/shop" : "", "Shop the new drops") : button(site ? site + "/order/" + o.number : "", "View your order"));
      var text = "Hi " + o.customer.name.split(" ")[0] + ", " + m.text + "\n\nOrder " + o.number + "\n" + o.items.map(function (it) { return it.qty + " × " + it.name; }).join("\n") +
        (o.status === "shipped" && o.tracking ? "\n\nCourier: " + o.tracking + (track ? "\nTrack: " + track : "") : "") + (site ? "\n\n" + site + "/order/" + o.number : "");
      sendEmail(db, o.customer.email, m.subject.replace("{n}", o.number), emailShell(db, m.title, body), text, "status-" + o.status, o.number);
    }
    function reminderEmail(db, cart, n) {
      var cs = cartSettings(db), site = siteUrl(db), link = site ? site + "/restore/" + cart.token : "";
      var subject = n === 1 ? cs.subject1 : cs.subject2, intro = n === 1 ? cs.text1 : cs.text2;
      var body = '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hi ' + h((cart.customer.name || "there").split(" ")[0]) + ", " + h(intro) + "</p>" + itemsTable(db, cart.items) +
        '<p style="margin:12px 0 0;font-size:15px;text-align:right"><b>' + money(cart.total) + "</b></p>" +
        (n === 2 && cs.coupon ? '<p style="margin:18px 0 0;padding:14px 16px;background:#f6f7f8;border-radius:12px;font-size:14px">Use code <b style="letter-spacing:1px">' + h(cs.coupon) + "</b> at checkout.</p>" : "") +
        button(link, "Complete your order");
      var text = intro + "\n\n" + cart.items.map(function (it) { return it.qty + " × " + it.name; }).join("\n") + (n === 2 && cs.coupon ? "\n\nUse code " + cs.coupon + " at checkout." : "") + (link ? "\n\nComplete your order: " + link : "");
      return sendEmail(db, cart.customer.email, subject, emailShell(db, "", body), text, "cart-reminder-" + n, cart.id);
    }
    function restoreLink(db, cart) { var site = siteUrl(db); return (site || "") + "/restore/" + cart.token; }

    // Checkout details are saved as the customer types, so an unfinished checkout can be followed up
    route("POST", "/api/carts/capture", null, function (c) {
      var db = c.db, b = c.body || {}, cu = b.customer || {};
      var info = { name: str(cu.name, 80), phone: str(cu.phone, 20), email: str(cu.email, 120).toLowerCase(), address: str(cu.address, 300), city: str(cu.city, 60) };
      var okPhone = isPhone(info.phone), okEmail = info.email && isEmail(info.email);
      if (!okPhone && !okEmail) return { ok: false };
      if (okPhone) info.phone = normPhone(info.phone); else info.phone = "";
      if (!okEmail) info.email = "";
      var lines;
      try { lines = priceCart(db, (b.items || []).slice(0, 30)); } catch (e) { return { ok: false }; }
      if (!lines.lines.length) return { ok: false };
      db.carts = db.carts || [];
      var cid = str(b.cid, 40), t = now();
      var cart = db.carts.filter(function (x) { return x.cid === cid && x.status === "open"; })[0];
      if (!cart) { cart = { id: newId("crt"), token: host.random(12), cid: cid, createdAt: t, status: "open", reminders: [] }; db.carts.push(cart); }
      cart.customer = info;
      cart.items = lines.lines.map(function (l) { return { productId: l.productId, variantId: l.variantId, name: l.name, options: l.options, image: l.image, price: l.price, qty: l.qty, lineTotal: l.lineTotal }; });
      cart.total = lines.subtotal;
      cart.zone = str(b.zone, 40);
      cart.updatedAt = t;
      cart.source = str(b.source, 40) || cart.source || "";
      if (db.carts.length > 3000) db.carts = db.carts.slice(-3000);
      return { ok: true };
    });
    // The "Complete your order" link puts the bag back
    route("GET", "/api/carts/restore/:token", null, function (c) {
      var cart = (c.db.carts || []).filter(function (x) { return x.token === c.params.token; })[0];
      if (!cart) fail(404, "This link has expired.");
      cart.clickedAt = now();
      return { items: cart.items.map(function (i) { return { productId: i.productId, variantId: i.variantId, qty: i.qty }; }), customer: { name: cart.customer.name, phone: cart.customer.phone, email: cart.customer.email, address: cart.customer.address, city: cart.customer.city }, zone: cart.zone };
    });
    function cartsOrdered(db, order, cid) {
      (db.carts || []).forEach(function (x) {
        if (x.status !== "open" && x.status !== "dismissed") return;
        if (!((cid && x.cid === cid) || (x.customer.phone && x.customer.phone === order.customer.phone))) return;
        x.status = x.reminders.length || x.clickedAt ? "recovered" : "ordered";
        x.orderNumber = order.number; x.orderTotal = order.total; x.orderedAt = order.createdAt;
      });
    }
    function cartDue(db, x, t) {
      var cs = cartSettings(db);
      if (x.status !== "open" || !x.customer.email) return 0;
      var sent = x.reminders.filter(function (r) { return r.auto; }).map(function (r) { return r.n; });
      if (sent.indexOf(1) < 0 && t - x.updatedAt >= num(cs.delay1, 20) * 60e3 && t - x.updatedAt < 7 * 864e5) return 1;
      if (sent.indexOf(2) < 0 && t - x.updatedAt >= num(cs.delay2, 24) * 36e5 && t - x.updatedAt < 9 * 864e5) return 2;
      return 0;
    }
    // Runs every minute on the server: sends the 20-minute and 24-hour reminders
    route("POST", "/api/internal/cart-reminders", "internal", function (c) {
      var db = c.db, cs = cartSettings(db), t = now(), sent = 0;
      purgeTrash(db);
      if (!cs.enabled) return { sent: 0 };
      (db.carts || []).forEach(function (x) {
        var n = cartDue(db, x, t);
        if (!n || sent >= 20) return;
        // Anyone can type any email at checkout. Send each address at most two reminders a day, so the store's Gmail
        // can't be used to flood a stranger's inbox (which would also get the Gmail account blocked).
        var to = String(x.customer.email).toLowerCase();
        var recent = (db.emailLog || []).filter(function (e) { return /^cart-reminder/.test(e.kind) && String(e.to).toLowerCase() === to && t - e.at < 864e5; }).length;
        if (recent >= 2) { x.reminders.push({ n: n, at: t, auto: true, channel: "email", status: "Skipped: this address already got 2 reminders today" }); return; }
        var e = reminderEmail(db, x, n);
        x.reminders.push({ n: n, at: t, auto: true, channel: "email", status: e.status, emailId: e.id });
        sent++;
      });
      return { sent: sent };
    });
    route("GET", "/api/carts", "orders", function (c) {
      var db = c.db, list = (db.carts || []).slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }), t = now();
      var log = {};
      (db.emailLog || []).forEach(function (e) { log[e.id] = e; });
      var abandoned = function (x) { return x.status === "open" && t - x.updatedAt >= num(cartSettings(db).delay1, 20) * 60e3; };
      return {
        carts: list.map(function (x) {
          var o = clone(x);
          o.abandoned = abandoned(x);
          o.reminders = x.reminders.map(function (r) { var e = log[r.emailId]; return Object.assign({}, r, { status: e ? e.status : r.status, ok: e ? e.ok : null }); });
          o.link = restoreLink(db, x);
          return o;
        }),
        stats: { open: list.filter(abandoned).length, openValue: list.filter(abandoned).reduce(function (s, x) { return s + x.total; }, 0),
          recovered: list.filter(function (x) { return x.status === "recovered"; }).length, recoveredValue: list.filter(function (x) { return x.status === "recovered"; }).reduce(function (s, x) { return s + (x.orderTotal || 0); }, 0),
          reminders: list.reduce(function (s, x) { return s + x.reminders.length; }, 0) },
        settings: cartSettings(db), emailReady: !!(host.sendEmail && emailSettings(db).enabled && emailSettings(db).user && emailSettings(db).password)
      };
    }, { readonly: true });
    route("POST", "/api/carts/:id/remind", "orders", function (c) {
      var x = (c.db.carts || []).filter(function (y) { return y.id === c.params.id; })[0];
      if (!x) fail(404, "Cart not found.");
      if (!x.customer.email) fail(400, "This customer didn't give an email. Call or WhatsApp them instead.");
      var n = x.reminders.length ? 2 : 1, e = reminderEmail(c.db, x, n);
      x.reminders.push({ n: n, at: now(), auto: false, channel: "email", status: e.status, emailId: e.id, by: c.auth.name });
      return { ok: true, status: e.status };
    });
    route("POST", "/api/carts/:id/contacted", "orders", function (c) {
      var x = (c.db.carts || []).filter(function (y) { return y.id === c.params.id; })[0];
      if (!x) fail(404, "Cart not found.");
      x.reminders.push({ n: 0, at: now(), auto: false, channel: str(c.body.channel, 20) || "phone", status: "Contacted by " + (c.auth.name || "staff"), by: c.auth.name });
      return { ok: true };
    });
    route("PATCH", "/api/carts/:id", "orders", function (c) {
      var x = (c.db.carts || []).filter(function (y) { return y.id === c.params.id; })[0];
      if (!x) fail(404, "Cart not found.");
      if (c.body.status !== undefined) { if (["open", "dismissed"].indexOf(c.body.status) < 0) fail(400, "Unknown status."); x.status = c.body.status; }
      if (c.body.note !== undefined) x.note = str(c.body.note, 1000);
      return { cart: x };
    });
    route("DELETE", "/api/carts/:id", "orders", function (c) {
      c.db.carts = (c.db.carts || []).filter(function (y) { return y.id !== c.params.id; });
      return { ok: true };
    });
    // Email settings (Admin › Email & reminders). The app password is never sent back.
    route("GET", "/api/email-settings", "settings", function (c) {
      var es = emailSettings(c.db);
      es.passwordSet = !!es.password; es.password = "";
      return { email: es, carts: cartSettings(c.db), log: (c.db.emailLog || []).slice(-60).reverse(), server: !!host.sendEmail };
    }, { readonly: true });
    route("PUT", "/api/email-settings", "settings", function (c) {
      var s = c.db.settings, b = c.body || {};
      if (b.email) {
        var e = emailSettings(c.db), x = b.email;
        // The Gmail app password is sent to the mail server saved here. Changing the server or address needs the owner, and forgets the old password.
        var nh = x.host !== undefined ? str(x.host, 300) : e.host, nu = x.user !== undefined ? str(x.user, 300).toLowerCase() : e.user, np = x.port !== undefined ? int(x.port, 465) : e.port;
        var serverChanged = nh !== e.host || nu !== String(e.user || "").toLowerCase() || np !== int(e.port, 465);
        if (serverChanged || x.password || x.passwordClear) needOwner(c, "change the email server, Gmail address or app password");
        if (serverChanged && !x.password) e.password = "";
        if (nh && !/^[a-z0-9.-]+$/i.test(nh)) fail(400, "The mail server name doesn't look right.");
        ["host", "user", "fromName", "replyTo", "copyTo"].forEach(function (k) { if (x[k] !== undefined) e[k] = str(x[k], 300).trim(); });
        if (x.port !== undefined) e.port = int(x.port, 465);
        ["enabled", "invoice", "notifyConfirmed", "notifyShipped", "notifyDelivered"].forEach(function (k) { if (x[k] !== undefined) e[k] = bool(x[k]); });
        if (x.password) e.password = str(x.password, 200).replace(/\s+/g, "");
        if (x.passwordClear) e.password = "";
        e.user = e.user.toLowerCase();
        if (e.user && !isEmail(e.user)) fail(400, "The Gmail address doesn't look right.");
        if (e.replyTo && !isEmail(e.replyTo)) fail(400, "The reply-to address doesn't look right.");
        if (e.copyTo && String(e.copyTo).split(/[,\s]+/).some(function (a) { return a && !isEmail(a); })) fail(400, "Check the copy-to address.");
        if (e.enabled && (!e.user || !e.password)) fail(400, "Add the Gmail address and app password before turning email on.");
        s.email = e;
      }
      if (b.carts) {
        var cs = cartSettings(c.db), y = b.carts;
        if (y.enabled !== undefined) cs.enabled = bool(y.enabled);
        if (y.delay1 !== undefined) cs.delay1 = Math.max(5, Math.min(1440, int(y.delay1, 20)));
        if (y.delay2 !== undefined) cs.delay2 = Math.max(1, Math.min(168, num(y.delay2, 24)));
        ["subject1", "text1", "subject2", "text2"].forEach(function (k) { if (y[k] !== undefined) cs[k] = str(y[k], k.indexOf("text") === 0 ? 1000 : 150) || CART_DEFAULTS[k]; });
        if (y.coupon !== undefined) cs.coupon = str(y.coupon, 40).toUpperCase();
        s.carts = cs;
      }
      return { ok: true };
    });
    route("POST", "/api/email/test", "settings", function (c) {
      var to = str(c.body.to, 120);
      if (!isEmail(to)) fail(400, "Enter the address to send the test to.");
      var e = sendEmail(c.db, to, "Test email from your store", emailShell(c.db, "It works", '<p style="margin:0;font-size:15px;line-height:1.6">Your store can send emails from this address. Invoices and cart reminders will come from here.</p>'),
        "Your store can send emails from this address.", "test", "");
      return { ok: true, id: e.id, status: e.status };
    });
    route("GET", "/api/email/log/:id", "settings", function (c) {
      var e = (c.db.emailLog || []).filter(function (x) { return x.id === c.params.id; })[0];
      if (!e) fail(404, "Not found.");
      return { email: e };
    }, { readonly: true });

    // Franchise request form
    route("POST", "/api/franchise", null, function (c) {
      var b = c.body || {}, e = {};
      var r = { id: newId("frq"), name: str(b.name, 80), phone: str(b.phone, 20), email: str(b.email, 120), district: str(b.district, 40), area: str(b.area, 200),
        space: str(b.space, 40), investment: str(b.investment, 60), experience: str(b.experience, 2000), meetingDate: str(b.meetingDate, 10),
        meetingTime: str(b.meetingTime, 30), meetingType: str(b.meetingType, 40), message: str(b.message, 3000), status: "new", note: "", read: false, createdAt: now() };
      if (!r.name) e.name = "Enter your name.";
      if (!isPhone(r.phone)) e.phone = "Enter an 11-digit mobile number, like 01712345678.";
      else r.phone = normPhone(r.phone);
      if (r.email && !isEmail(r.email)) e.email = "That email doesn't look right.";
      if (!r.district) e.district = "Choose your district.";
      if (r.meetingDate && !/^\d{4}-\d{2}-\d{2}$/.test(r.meetingDate)) e.meetingDate = "Pick a date.";
      if (Object.keys(e).length) fail(400, "Please check the highlighted fields.", e);
      c.db.franchise = c.db.franchise || [];
      c.db.franchise.push(r);
      if (c.db.franchise.length > 2000) c.db.franchise = c.db.franchise.slice(-2000);
      emit(c.db, "franchise.created", r);
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
      return ch.messages.filter(function (m) { return m.at > since && !m.internal; }).map(function (m) { var o = { id: m.id, from: m.from, text: m.text, at: m.at, author: m.from === "customer" ? "" : m.author || "" }; if (m.image) o.image = m.image; return o; });
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
      var text = str(c.body.text, 2000), image = "";
      // A customer can attach one photo (sent as a data URL; the widget shrinks it to 1280 px first)
      if (c.body.image) {
        var im = /^data:(image\/(png|jpeg|webp|gif));base64,/.exec(String(c.body.image));
        if (!im) fail(400, "Send a PNG, JPG, WebP or GIF photo.");
        if (String(c.body.image).length > 4e6) fail(413, "That photo is too big. Try a smaller one.");
        image = host.saveMedia("chat-" + ch.id + "-" + now(), String(c.body.image), im[1]).url;
      }
      if (!text && !image) fail(400, "Write a message.");
      if (c.body.name) ch.name = str(c.body.name, 80);
      if (c.body.phone) ch.phone = str(c.body.phone, 20);
      var m = { id: newId("m"), from: "customer", text: text, at: now() };
      if (image) m.image = image;
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
      // Ten wrong passwords for one account lock it for 15 minutes, whoever is guessing and from wherever
      if (u && u.lockedUntil && u.lockedUntil > now()) fail(429, "Too many wrong passwords. This account is locked for 15 minutes, or reset the password by email.");
      var good = host.hashPassword(pw, u ? u.salt : "no-such-user") === (u ? u.passwordHash : "-");
      if (!good) {
        if (u) {
          u.failedLogins = (now() - (u.lastFailedLogin || 0) > 15 * 60e3 ? 0 : int(u.failedLogins)) + 1;
          u.lastFailedLogin = now();
          if (u.failedLogins >= 10) { u.lockedUntil = now() + 15 * 60e3; u.failedLogins = 0; }
        }
        fail(401, "Wrong email or password.");
      }
      delete u.failedLogins; delete u.lockedUntil; delete u.lastFailedLogin;
      var token = host.random(24);
      db.sessions = (db.sessions || []).filter(function (s) { return s.expiresAt > now(); });
      db.sessions.push({ hash: sha256(token), userId: u.id, createdAt: now(), expiresAt: now() + 7 * 864e5 });
      u.lastLogin = now();
      return { token: token, user: publicUser(u), areas: userAreas(u) };
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
        // Sign out every other device that had this account open
        var mine = sha256(String((c.req.headers || {}).authorization || "").replace(/^Bearer\s+/i, "").trim());
        c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id || s.hash === mine; });
      }
      return { user: publicUser(u) };
    });
    // Forgotten password (admin panel users only; customers have no accounts here)
    route("POST", "/api/auth/forgot", null, function (c) {
      var db = c.db, email = str(c.body.email, 120).toLowerCase(), out = { ok: true, message: "If that email belongs to an admin user, a reset link is on its way. It works for 30 minutes." };
      if (!isEmail(email)) fail(400, "Enter the email you sign in with.");
      var u = db.users.filter(function (x) { return x.email === email; })[0];
      if (!u) return out;
      if (u.resetAt && now() - u.resetAt < 60e3) return out; // one email a minute
      var token = host.random(24);
      u.resetHash = sha256(token); u.resetExpires = now() + 30 * 60e3; u.resetAt = now();
      var link = siteUrl(db) + "/admin?reset=" + token;
      var e = sendEmail(db, u.email, "Reset your admin password", emailShell(db, "Reset your password",
        '<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Hi ' + h(u.name.split(" ")[0]) + ", someone (hopefully you) asked to reset the password for the " + h((db.settings.store || {}).name || "Ravelle") + " admin panel.</p>" +
        button(link, "Choose a new password") + '<p style="margin:14px 0 0;font-size:13px;color:#5f6368;line-height:1.6">The link works for 30 minutes and only once. If you didn&#39;t ask for this, ignore this email; your password stays the same.</p>'),
        "Reset your admin password: " + link + "\n\nThe link works for 30 minutes. If you didn't ask for this, ignore this email.", "password-reset", u.email);
      if (!host.sendEmail) { out.demoLink = "?reset=" + token; out.message = "Demo: there's no email server, so here is the reset link."; }
      else if (e.ok === false) out.message = "The store can't send email yet, so no link was sent. Ask the store owner to reset your password in Admin › Users.";
      return out;
    });
    function resetUser(db, token) {
      var hs = sha256(String(token || ""));
      var u = db.users.filter(function (x) { return x.resetHash && x.resetHash === hs; })[0];
      if (!u || u.resetExpires < now()) fail(400, "This reset link has expired or was already used. Ask for a new one.");
      return u;
    }
    route("GET", "/api/auth/reset/:token", null, function (c) { var u = resetUser(c.db, c.params.token); return { email: u.email, name: u.name }; }, { readonly: true });
    route("POST", "/api/auth/reset", null, function (c) {
      var u = resetUser(c.db, c.body.token);
      setPassword(u, c.body.password);
      delete u.resetHash; delete u.resetExpires; delete u.lockedUntil; delete u.failedLogins;
      c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id; });
      return { ok: true, email: u.email };
    });
    function setPassword(u, pw) {
      pw = String(pw || "");
      if (pw.length < 8) fail(400, "Use a password of at least 8 characters.");
      u.salt = host.random(8);
      u.passwordHash = host.hashPassword(pw, u.salt);
    }

    // --- Dashboard ----------------------------------------------------------------------
    route("GET", "/api/dashboard", "dashboard", function (c) { return dashboard(c.db, c.query.days); }, { readonly: true });
    route("GET", "/api/analytics", "dashboard", function (c) { return analytics(c.db, c.query.days); }, { readonly: true });

    // --- Products ------------------------------------------------------------------------
    // Manual order: the listed products swap into the places they already hold, so a filtered list can be reordered on its own
    route("PUT", "/api/products-order", "products", function (c) {
      var ids = Array.isArray(c.body.ids) ? c.body.ids.map(String) : [];
      var slots = [], queue = {}, picked = [];
      c.db.products.forEach(function (p, i) { if (ids.indexOf(p.id) > -1) { slots.push(i); (queue[p.id] = queue[p.id] || []).push(p); } });
      ids.forEach(function (id) { var q = queue[id]; if (q && q.length) picked.push(q.shift()); });
      if (picked.length !== slots.length) fail(400, "Send every product in the list once.");
      slots.forEach(function (slot, k) { c.db.products[slot] = picked[k]; });
      return { ok: true, count: picked.length };
    });
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
    // Bulk edit: many products in one save. All changes are checked first; if one is wrong, nothing is saved.
    route("POST", "/api/products/bulk", "products", function (c) {
      var db = c.db, ups = Array.isArray(c.body.updates) ? c.body.updates.slice(0, 1000) : [], made = [];
      if (!ups.length) fail(400, "Nothing to save.");
      ups.forEach(function (u) {
        var idx = db.products.findIndex(function (p) { return p.id === u.id; });
        if (idx < 0) fail(404, "Product not found: " + str(u.id, 40));
        var before = db.products[idx], b = {};
        ["name", "price", "comparePrice", "status", "isNew", "featured", "trackStock", "categoryIds", "stock"].forEach(function (k) { if (u[k] !== undefined) b[k] = u[k]; });
        if (Array.isArray(u.variants) && (before.variants || []).length) {
          var byId = {};
          u.variants.forEach(function (v) { if (v && v.id) byId[v.id] = v; });
          b.variants = before.variants.map(function (v) {
            var n = byId[v.id] || {};
            return { id: v.id, sku: v.sku, options: v.options, price: n.price !== undefined ? n.price : v.price, stock: n.stock !== undefined ? n.stock : v.stock };
          });
        }
        var p;
        try { p = cleanProduct(db, b, before); } catch (e) { e.message = before.name + ": " + e.message; throw e; }
        if (p.comparePrice && p.comparePrice <= p.price) fail(400, before.name + ": the regular price must be more than the sale price.");
        made.push({ idx: idx, before: before, p: p });
      });
      made.forEach(function (m) {
        db.products[m.idx] = m.p;
        emit(db, "product.updated", publicProduct(m.p));
        if (JSON.stringify(productStock(m.before)) !== JSON.stringify(productStock(m.p))) {
          emit(db, "stock.updated", { productId: m.p.id, sku: m.p.sku, stock: productStock(m.p) });
          if ((m.p.variants || []).length) m.p.variants.forEach(function (v, i) { var o = (m.before.variants || [])[i]; if (!o || o.stock !== v.stock) lowStockCheck(db, m.p, v); });
          else lowStockCheck(db, m.p);
        }
      });
      return { saved: made.length, products: made.map(function (m) { return Object.assign(publicProduct(m.p), { status: m.p.status }); }) };
    });
    route("PUT", "/api/products/:id", "products", saveProduct);
    route("PATCH", "/api/products/:id", "products", saveProduct);
    route("DELETE", "/api/products/:id", "products", function (c) {
      var db = c.db, p = findProduct(db, c.params.id);
      if (!p) fail(404, "Product not found.");
      db.products = db.products.filter(function (x) { return x !== p; });
      toTrash(c, "product", p, p.name);
      emit(db, "product.deleted", { id: p.id, sku: p.sku, name: p.name });
      return { ok: true, trash: true };
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
      if (b.seoTitle !== undefined) c.seoTitle = str(b.seoTitle, 80);
      if (b.seoDescription !== undefined) c.seoDescription = str(b.seoDescription, 200);
      if (b.seoText !== undefined) c.seoText = str(b.seoText, 2000);
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
    route("DELETE", "/api/orders/:id", "orders", function (c) {
      needOwner(c, "delete orders");
      var db = c.db, o = db.orders.filter(function (x) { return x.id === c.params.id || x.number === String(c.params.id).toUpperCase(); })[0];
      if (!o) fail(404, "Order not found.");
      var put = !o.restocked && o.status !== "delivered";
      if (put) restock(db, o); // stock held by a live order goes back on the shelf
      db.orders = db.orders.filter(function (x) { return x !== o; });
      toTrash(c, "order", o, "Order " + o.number);
      db.trash[0].restockedOnDelete = put;
      return { ok: true, trash: true, restocked: put };
    });
    route("PATCH", "/api/orders/:id", "orders", function (c) {
      var db = c.db, b = c.body;
      var o = db.orders.filter(function (x) { return x.id === c.params.id || x.number === String(c.params.id).toUpperCase(); })[0];
      if (!o) fail(404, "Order not found.");
      var changes = [];
      if (b.status && b.status !== o.status) {
        setStatus(c, o, b.status);
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
      if (b.status) statusEmail(db, o);
      o.updatedAt = now();
      o.history.push({ at: now(), status: o.status, note: changes.concat(note ? [note] : []).join(" · "), public: b.notifyCustomer ? note : "", by: c.auth ? c.auth.name : "System", internal: !b.notifyCustomer && !changes.length });
      emit(db, "order.updated", o);
      if (changes.length) acoreSync(c, o);
      return { order: o };
    });
    function setStatus(c, o, status) {
      var db = c.db;
      if (ORDER_STATUSES.indexOf(status) < 0) fail(400, "Unknown status.");
      var was = o.status;
      if (status === was) return false;
      o.status = status;
      if ((status === "cancelled" || status === "returned") && !o.restocked) restock(db, o);
      if ((status === "cancelled" || status === "returned") && was !== "cancelled" && was !== "returned") gaServer(c, o, "refund");
      if ((was === "cancelled" || was === "returned") && status !== "cancelled" && status !== "returned" && o.restocked) {
        // Reopening takes the stock back out.
        o.items.forEach(function (it) {
          var p = findProduct(db, it.productId);
          if (!p || !p.trackStock) return;
          var v = it.variantId ? p.variants.filter(function (x) { return x.id === it.variantId; })[0] : null;
          if (v) v.stock = Math.max(0, v.stock - it.qty); else p.stock = Math.max(0, int(p.stock) - it.qty);
        });
        o.restocked = false;
      }
      return true;
    }

    // --- Acore: orders go to Acore, and Acore sends status and courier updates back --------------------
    function acoreSettings(db) {
      var a = db.settings.acore || {};
      return { enabled: !!a.enabled, url: a.url || "", apiKey: a.apiKey || "", webhookSecret: a.webhookSecret || "", since: a.since || 0 };
    }
    // What Acore receives for an order (docs: acore-website-integration-prompt.md). Sent when the order is placed and
    // again on every change; Acore treats it as an upsert keyed on externalId.
    function acorePayload(db, o) {
      return {
        source: "ravelle-website", externalId: o.id, number: o.number, createdAt: o.createdAt, status: o.status,
        paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, codAmount: o.paymentStatus === "paid" ? 0 : o.total,
        customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email || "", address: o.customer.address, city: o.customer.city || "" },
        shippingZone: o.shippingZone ? { id: o.shippingZone.id, name: o.shippingZone.name } : null,
        items: o.items.map(function (it) {
          var p = findProduct(db, it.productId);
          return { sku: it.sku, productSku: (p && p.sku) || it.sku, name: it.name, color: it.color || "", options: it.options || {}, qty: it.qty, price: it.price, lineTotal: it.lineTotal };
        }),
        subtotal: o.subtotal, discount: o.discount || 0, coupon: o.coupon || null, shipping: o.shipping || 0, total: o.total, note: o.note || ""
      };
    }
    function acoreSync(c, o) {
      var a = acoreSettings(c.db);
      if (!host.acoreSend || !a.enabled || !a.url || !a.apiKey) return;
      o.acore = o.acore || {};
      o.acore.pending = true;
      host.acoreSend({ orderId: o.id, url: a.url, apiKey: a.apiKey, payload: acorePayload(c.db, o) });
    }
    // The server reports how a send went
    route("POST", "/api/internal/acore-sent", "internal", function (c) {
      var o = c.db.orders.filter(function (x) { return x.id === c.body.orderId; })[0];
      if (!o) fail(404, "Order not found.");
      o.acore = o.acore || {};
      o.acore.pending = false;
      o.acore.tries = int(o.acore.tries) + 1;
      o.acore.lastTry = now();
      if (c.body.ok) { o.acore.id = str(c.body.acoreId, 80) || o.acore.id || ""; o.acore.sentAt = now(); o.acore.error = ""; o.acore.tries = 0; }
      else o.acore.error = str(c.body.error, 300) || "Could not reach Acore.";
      return { ok: true };
    });
    // Orders that still need sending (new, changed, or failed); the server retries these every few minutes
    route("GET", "/api/internal/acore-due", "internal", function (c) {
      var a = acoreSettings(c.db), t = now(), wait = [60e3, 5 * 60e3, 30 * 60e3, 2 * 36e5];
      if (!a.enabled || !a.url || !a.apiKey) return { orders: [] };
      var due = c.db.orders.filter(function (o) {
        if (o.createdAt < a.since || t - o.createdAt > 14 * 864e5) return false;
        var s = o.acore || {};
        if (s.sentAt && !s.error && !s.dirty) return false;
        if (!s.lastTry) return true;
        return t - s.lastTry > wait[Math.min(wait.length - 1, Math.max(0, int(s.tries) - 1))];
      }).slice(0, 20);
      return { orders: due.map(function (o) { return { orderId: o.id, url: a.url, apiKey: a.apiKey, payload: acorePayload(c.db, o) }; }) };
    });
    // Admin: send one order again now
    route("POST", "/api/orders/:id/acore", "orders", function (c) {
      var o = c.db.orders.filter(function (x) { return x.id === c.params.id || x.number === String(c.params.id).toUpperCase(); })[0];
      if (!o) fail(404, "Order not found.");
      var a = acoreSettings(c.db);
      if (!a.enabled || !a.url || !a.apiKey) fail(400, "Turn on Acore and add its address and API key in Admin › Acore first.");
      if (!host.acoreSend) fail(400, "Orders go to Acore from the live server. The demo can't send them.");
      acoreSync(c, o);
      return { order: o };
    });
    // A signed update from Acore (the server checks the signature first)
    var ACORE_STATUS = { pending: "pending", confirmed: "confirmed", hold: "hold", on_hold: "hold", processing: "processing", packed: "processing",
      sent_to_courier: "shipped", picked_up: "shipped", in_transit: "shipped", out_for_delivery: "shipped", shipped: "shipped", delivered: "delivered",
      cancelled: "cancelled", canceled: "cancelled", returned: "returned", return: "returned" };
    var ACORE_PUBLIC = { pending: "Order received", confirmed: "Order confirmed", hold: "Order on hold. We'll contact you.", processing: "Packing your order",
      sent_to_courier: "Handed to the courier", picked_up: "Picked up by the courier", in_transit: "On the way", out_for_delivery: "Out for delivery", shipped: "On the way",
      delivered: "Delivered", cancelled: "Order cancelled", canceled: "Order cancelled", returned: "Returned to us", return: "Returned to us" };
    route("POST", "/api/internal/acore", "internal", function (c) {
      var b = c.body || {}, db = c.db, d = b.data || {};
      if (typeof d.courier === "object" && d.courier) d.courier = d.courier.name;
      var o = db.orders.filter(function (x) { return (d.externalId && x.id === d.externalId) || (d.number && x.number === String(d.number).toUpperCase()); })[0];
      if (!o) fail(404, "Order not found.");
      o.acore = o.acore || {};
      var seen = o.acore.seen = (o.acore.seen || []);
      var did = str(b.id, 80);
      if (did && seen.indexOf(did) > -1) return { ok: true, duplicate: true };
      if (did) { seen.push(did); if (seen.length > 40) seen.splice(0, seen.length - 40); }
      if (d.acoreId) o.acore.id = str(d.acoreId, 80);
      var raw = str(d.status, 40).toLowerCase().replace(/[\s-]+/g, "_"), mapped = ACORE_STATUS[raw];
      var parts = [];
      if (d.courier || d.consignmentId || d.trackingCode || d.trackingUrl || d.riderName) {
        o.courier = o.courier || {};
        if (d.courier) o.courier.name = str(d.courier, 40);
        if (d.consignmentId) o.courier.consignmentId = str(d.consignmentId, 80);
        if (d.trackingCode) o.courier.trackingCode = str(d.trackingCode, 80);
        if (d.trackingUrl && /^https?:\/\//.test(d.trackingUrl)) o.courier.trackingUrl = str(d.trackingUrl, 300);
        if (d.riderName) o.courier.riderName = str(d.riderName, 60);
        if (d.riderPhone) o.courier.riderPhone = str(d.riderPhone, 20);
        var tr = [o.courier.name, o.courier.trackingCode || o.courier.consignmentId].filter(Boolean).join(" ");
        if (tr && tr !== o.tracking) { o.tracking = tr; parts.push("Courier: " + tr); }
      }
      if (mapped) {
        if (setStatus(c, o, mapped)) { parts.unshift("Status: " + mapped); statusEmail(db, o); }
        if (mapped === "delivered" && o.paymentMethod === "cod" && o.paymentStatus !== "paid" && d.codCollected !== false && d.codCollected !== 0) {
          o.paymentStatus = "paid"; parts.push("Payment: paid (cash collected" + (num(d.codCollected, 0) > 1 ? " ৳" + num(d.codCollected, 0) : "") + ")");
        }
      } else if (raw) parts.push("Acore status: " + raw);
      var at = num(d.at, 0) || now();
      var pub = str(d.note, 200) || ACORE_PUBLIC[raw] || "";
      o.updatedAt = now();
      o.acore.lastUpdate = now();
      o.history.push({ at: Math.min(at, now()), status: o.status, note: (parts.length ? parts.join(" · ") : "Update from Acore") + (d.note ? " · " + str(d.note, 200) : ""), public: pub, by: "Acore", acoreStep: raw || "" });
      emit(db, "order.updated", o);
      return { ok: true, status: o.status, order_number: o.number };
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
      acoreSync(c, o);
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
    route("GET", "/api/pages", null, function (c) { return { pages: canSee(c.auth, "content") ? c.db.pages : publicPages(c.db.pages) }; }, { readonly: true });
    route("GET", "/api/pages/:key", null, function (c) {
      var p = c.db.pages[c.params.key];
      if (!p) fail(404, "Page not found.");
      return { page: canSee(c.auth, "content") ? p : publicPages(c.db.pages)[c.params.key] };
    }, { readonly: true });
    route("PUT", "/api/pages/:key", "content", function (c) {
      if (!c.db.pages[c.params.key]) fail(404, "Page not found.");
      if (!c.body || typeof c.body.page !== "object") fail(400, "Send the page content as { page }.");
      if (JSON.stringify(c.body.page).length > 6e6) fail(413, "This page is too large. Use smaller images.");
      if (c.params.key === "stores") cleanStores(c.body.page);
      if (c.params.key === "franchise") cleanStories(c.body.page);
      c.db.pages[c.params.key] = c.body.page;
      return { page: c.db.pages[c.params.key] };
    });
    // Store locations: every shop needs a name and a district; districts show in the order you set
    function cleanStores(pg) {
      pg.shops = (Array.isArray(pg.shops) ? pg.shops : []).map(function (s, i) {
        s = s || {};
        var o = { id: str(s.id, 40) || newId("shp"), name: str(s.name, 120), type: s.type === "franchise" ? "franchise" : "own", district: str(s.district, 40),
          image: str(s.image, 4000000), address: str(s.address, 400), phone: str(s.phone, 40), email: str(s.email, 120), hours: str(s.hours, 120), map: str(s.map, 600) };
        if (!o.name) fail(400, "Shop " + (i + 1) + " needs a name.");
        if (!o.district) fail(400, "Choose a district for " + o.name + ".");
        if (o.email && !isEmail(o.email)) fail(400, "The email for " + o.name + " doesn't look right.");
        return o;
      });
      var order = (Array.isArray(pg.districtOrder) ? pg.districtOrder : []).map(function (d) { return str(d, 40); }).filter(Boolean);
      pg.shops.forEach(function (s) { if (order.indexOf(s.district) < 0) order.push(s.district); });
      pg.districtOrder = order.filter(function (d, i) { return order.indexOf(d) === i && pg.shops.some(function (s) { return s.district === d; }); });
    }
    function cleanStories(pg) {
      pg.stories = (Array.isArray(pg.stories) ? pg.stories : []).map(function (s, i) {
        s = s || {};
        var o = { id: str(s.id, 40) || newId("fst"), storeName: str(s.storeName, 120), storeImage: str(s.storeImage, 4000000), address: str(s.address, 400),
          ownerName: str(s.ownerName, 120), ownerImage: str(s.ownerImage, 4000000), opinion: str(s.opinion, 600), experience: str(s.experience, 2000) };
        if (!o.ownerName) fail(400, "Franchise card " + (i + 1) + " needs the owner's name.");
        return o;
      });
      pg.pdf = str(pg.pdf, 9000000);
    }
    // PDF files (franchise guide): saved next to uploaded images, not in the media library
    route("POST", "/api/files", "content", function (c) {
      var name = str(c.body.name, 120) || "file", data = String(c.body.dataUrl || "");
      if (!/^data:application\/pdf;base64,/.test(data)) fail(400, "Upload a PDF file.");
      if (data.length > 14e6) fail(413, "That PDF is over 10 MB.");
      var saved = host.saveMedia(name, data, "application/pdf");
      return { url: saved.url, size: saved.size };
    }, { status: 201 });

    route("GET", "/api/menus", null, function (c) { return { menus: c.db.menus }; }, { readonly: true });
    route("PUT", "/api/menus", "content", function (c) {
      var clean = function (items, depth) {
        return (items || []).slice(0, 30).map(function (it) {
          var out = { id: str(it.id, 40) || newId("mi"), label: str(it.label, 60), url: safeUrl(str(it.url, 300)),
            children: depth < 2 ? clean(it.children, depth + 1) : [] };
          if (depth < 2 && safeUrl(str(it.image, 300))) out.image = safeUrl(str(it.image, 300)); // dropdown photo (header menu only)
          if (depth === 0 && it.perColumn) out.perColumn = Math.min(12, Math.max(1, int(it.perColumn) || 6)); // dropdown links per column
          return out;
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
      c.db.media = c.db.media.filter(function (x) { return x !== m; });
      if (host.trashMedia) host.trashMedia(m.url);
      toTrash(c, "media", m, m.name || "Image");
      return { ok: true, trash: true };
    });
    // Where an image is used, so the admin can warn before deleting it
    function mediaUsage(db, url) {
      var out = [], has = function (x) { return x && JSON.stringify(x).indexOf(url) > -1; };
      if (!url) return out;
      db.products.forEach(function (p) { if (has(p)) out.push("Product: " + p.name); });
      (db.categories || []).forEach(function (x) { if (has(x)) out.push("Category: " + x.name); });
      Object.keys(db.pages || {}).forEach(function (k) { var pg = db.pages[k]; if (has(pg)) out.push(k === "popup" ? "Popup banner" : "Page: " + ((pg && pg.title) || k)); });
      if (has(db.menus)) out.push("Menus");
      if (has(db.settings)) out.push("Settings");
      return out;
    }
    route("GET", "/api/media/:id/usage", "content", function (c) {
      var m = c.db.media.filter(function (x) { return x.id === c.params.id; })[0];
      if (!m) fail(404, "Not found.");
      return { usedIn: mediaUsage(c.db, m.url) };
    }, { readonly: true });

    // --- Trash: deleted products, orders and images are kept for 30 days ----------------------------
    var TRASH_DAYS = 30, TRASH_AREA = { product: "products", order: "orders", media: "content" };
    function toTrash(c, kind, item, label) {
      var db = c.db; db.trash = db.trash || [];
      db.trash.unshift({ id: newId("trs"), kind: kind, label: str(label, 160), item: item, deletedAt: now(), deletedBy: (c.auth && c.auth.name) || "", expiresAt: now() + TRASH_DAYS * 864e5 });
    }
    function purgeTrash(db) {
      var t = now(), keep = [];
      (db.trash || []).forEach(function (x) { if (x.expiresAt > t) keep.push(x); else if (x.kind === "media" && host.deleteMedia) host.deleteMedia(x.item.url, true); });
      var changed = keep.length !== (db.trash || []).length;
      db.trash = keep;
      return changed;
    }
    function trashAllowed(c, x) { return x.kind === "order" ? isOwner(c.auth) : canSee(c.auth, TRASH_AREA[x.kind]); }
    function trashItem(c) {
      var x = (c.db.trash || []).filter(function (t) { return t.id === c.params.id; })[0];
      if (!x || !trashAllowed(c, x)) fail(404, "That item isn't in the trash any more.");
      return x;
    }
    route("GET", "/api/trash", "*", function (c) {
      purgeTrash(c.db);
      return { days: TRASH_DAYS, items: (c.db.trash || []).filter(function (x) { return trashAllowed(c, x); }).map(function (x) {
        return { id: x.id, kind: x.kind, label: x.label, deletedAt: x.deletedAt, deletedBy: x.deletedBy, expiresAt: x.expiresAt,
          image: x.kind === "media" ? x.item.url : x.kind === "product" ? (x.item.images || [])[0] || "" : "",
          detail: x.kind === "order" ? (x.item.customer.name + " · ৳" + x.item.total + " · " + x.item.status) : x.kind === "product" ? (x.item.sku || "") : "" };
      }) };
    });
    route("POST", "/api/trash/:id/restore", "*", function (c) {
      var db = c.db, x = trashItem(c), it = x.item;
      if (x.kind === "product") {
        if (db.products.some(function (p) { return p.slug === it.slug; })) it.slug = it.slug + "-" + host.random(2);
        if (it.sku && db.products.some(function (p) { return p.sku === it.sku; })) it.sku = "";
        db.products.unshift(it);
      } else if (x.kind === "order") {
        if (x.restockedOnDelete) {
          it.items.forEach(function (li) {
            var p = findProduct(db, li.productId);
            if (!p || !p.trackStock) return;
            var v = li.variantId ? (p.variants || []).filter(function (y) { return y.id === li.variantId; })[0] : null;
            if (v) v.stock = Math.max(0, v.stock - li.qty); else p.stock = Math.max(0, int(p.stock) - li.qty);
          });
          it.restocked = false;
        }
        db.orders.push(it);
      } else if (x.kind === "media") {
        if (host.restoreMedia) host.restoreMedia(it.url);
        db.media.push(it);
      }
      db.trash = db.trash.filter(function (t) { return t !== x; });
      return { ok: true, kind: x.kind, id: it.id, number: it.number };
    });
    route("DELETE", "/api/trash/:id", "*", function (c) {
      var x = trashItem(c);
      if (x.kind === "media" && host.deleteMedia) host.deleteMedia(x.item.url, true);
      c.db.trash = c.db.trash.filter(function (t) { return t !== x; });
      return { ok: true };
    });
    route("DELETE", "/api/trash", "*", function (c) {
      var mine = (c.db.trash || []).filter(function (x) { return trashAllowed(c, x); });
      mine.forEach(function (x) { if (x.kind === "media" && host.deleteMedia) host.deleteMedia(x.item.url, true); });
      c.db.trash = (c.db.trash || []).filter(function (x) { return mine.indexOf(x) < 0; });
      return { ok: true, removed: mine.length };
    });

    route("GET", "/api/settings", "settings", function (c) {
      var s = clone(c.db.settings);
      s.layout = siteLayout(c.db.settings); s.code = siteCode(c.db.settings);
      s.code.capiTokenSet = !!s.code.capiToken; s.code.capiToken = "";
      s.code.gaSecretSet = !!s.code.gaSecret; s.code.gaSecret = "";
      s.code.catalogTokenSet = !!s.code.catalogToken; s.code.catalogToken = "";
      if (s.email) { s.email.passwordSet = !!s.email.password; s.email.password = ""; }
      var ac = acoreSettings(c.db);
      s.acore = { enabled: ac.enabled, url: ac.url, apiKeySet: !!ac.apiKey, webhookSecret: isOwner(c.auth) ? ac.webhookSecret : (ac.webhookSecret ? "Only the owner can see this" : ""), since: ac.since };
      if (host.describeSettings) host.describeSettings(s);
      return { settings: s };
    }, { readonly: true });
    // "Clear cache": a new asset version, so every browser downloads fresh CSS and JS
    route("POST", "/api/cache/clear", "settings", function (c) {
      c.db.settings.cacheVersion = now().toString(36);
      c.db.settings.cacheClearedAt = now();
      if (host.clearCache) host.clearCache();
      return { ok: true, version: c.db.settings.cacheVersion, clearedAt: c.db.settings.cacheClearedAt };
    });
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
        var ssl = b.payments.sslcommerz || {}, cur = s.payments.sslcommerz || {};
        var nextSsl = { enabled: bool(ssl.enabled), sandbox: bool(ssl.sandbox), storeId: str(ssl.storeId, 80) };
        // Turning sandbox (test) mode on, or swapping the store ID, would let orders "pay" without real money
        if (nextSsl.enabled !== !!cur.enabled || nextSsl.sandbox !== !!cur.sandbox || nextSsl.storeId !== (cur.storeId || "")) needOwner(c, "change the SSLCOMMERZ settings");
        s.payments.cod = bool(b.payments.cod);
        s.payments.sslcommerz = nextSsl;
        if (!s.payments.cod && !s.payments.sslcommerz.enabled) fail(400, "Keep at least one payment method on.");
      }
      if (b.lowStock !== undefined) s.lowStock = Math.max(0, int(b.lowStock));
      if (b.announcement !== undefined) s.announcement = str(b.announcement, 200);
      if (b.layout && typeof b.layout === "object") {
        var cur = siteLayout(s);
        Object.keys(LAYOUT_DEFAULTS).forEach(function (k) {
          var src = b.layout[k] || {};
          Object.keys(LAYOUT_DEFAULTS[k]).forEach(function (f) {
            if (src[f] === undefined) return;
            var def = LAYOUT_DEFAULTS[k][f];
            if (typeof def === "boolean") cur[k][f] = bool(src[f]);
            else if (typeof def === "number") cur[k][f] = Math.min(80, Math.max(20, int(src[f]) || def));
            else if (/Bg$|Color$/.test(f)) cur[k][f] = /^#[0-9a-f]{6}$/i.test(src[f]) ? src[f] : def;
            else cur[k][f] = str(src[f], 300);
          });
        });
        s.layout = cur;
      }
      if (b.acore && typeof b.acore === "object") {
        var ac = s.acore = s.acore || {}, ba = b.acore;
        // The API key is sent to whatever address is saved here, so only the owner may change where it goes
        var newUrl = ba.url !== undefined ? String(ba.url || "").trim().replace(/\/+$/, "") : ac.url || "";
        if (newUrl !== (ac.url || "") || ba.apiKey || ba.apiKeyClear || ba.newSecret) needOwner(c, "change the Acore address, API key or webhook secret");
        var forgetKey = newUrl !== (ac.url || "") && !ba.apiKey;
        if (ba.enabled !== undefined) { var on = bool(ba.enabled); if (on && !ac.enabled) ac.since = now(); ac.enabled = on; }
        if (ba.url !== undefined) {
          var u = String(ba.url || "").trim().replace(/\/+$/, "");
          if (u && !/^https?:\/\/[^\s]+$/.test(u)) fail(400, "The Acore address should start with https://");
          ac.url = u.slice(0, 300);
        }
        if (forgetKey) ac.apiKey = "";
        if (ba.apiKey) ac.apiKey = String(ba.apiKey).trim().slice(0, 300);
        if (ba.apiKeyClear) ac.apiKey = "";
        if (ba.newSecret) ac.webhookSecret = "whsec_" + host.random(16);
        if (!ac.webhookSecret) ac.webhookSecret = "whsec_" + host.random(16);
      }
      if (b.code && typeof b.code === "object") {
        var code = siteCode(s), bc = b.code;
        // Custom code runs on every page for every visitor (and in the admin's page editor), so only the owner may change it
        if ((bc.head !== undefined && String(bc.head || "").slice(0, 20000) !== code.head) || (bc.bodyEnd !== undefined && String(bc.bodyEnd || "").slice(0, 20000) !== code.bodyEnd) ||
          bc.capiToken || bc.capiTokenClear || bc.gaSecret || bc.gaSecretClear || bc.catalogToken || bc.catalogTokenClear ||
          (bc.catalogId !== undefined && String(bc.catalogId || "").trim() !== code.catalogId)) needOwner(c, "change custom code or tracking secrets");
        if (bc.head !== undefined) code.head = String(bc.head || "").slice(0, 20000);
        if (bc.bodyEnd !== undefined) code.bodyEnd = String(bc.bodyEnd || "").slice(0, 20000);
        if (bc.gaId !== undefined) { code.gaId = String(bc.gaId || "").trim().toUpperCase(); if (code.gaId && !/^G-[A-Z0-9]{4,20}$/.test(code.gaId)) fail(400, "The Google Analytics ID looks like G-XXXXXXXXXX."); }
        if (bc.capiToken) code.capiToken = String(bc.capiToken).trim().slice(0, 600);
        if (bc.capiTokenClear) code.capiToken = "";
        if (bc.gaSecret) code.gaSecret = String(bc.gaSecret).trim().slice(0, 200);
        if (bc.gaSecretClear) code.gaSecret = "";
        if (bc.capiTest !== undefined) code.capiTest = str(bc.capiTest, 30);
        // Meta catalog: product changes are pushed to it the moment they're saved
        if (bc.catalogId !== undefined) { code.catalogId = String(bc.catalogId || "").trim(); if (code.catalogId && !/^\d{6,25}$/.test(code.catalogId)) fail(400, "The catalog ID is a number. Commerce Manager › Settings › Catalog details."); }
        if (bc.catalogToken) code.catalogToken = String(bc.catalogToken).trim().slice(0, 600);
        if (bc.catalogTokenClear) code.catalogToken = "";
        if (bc.pixelId !== undefined) { code.pixelId = String(bc.pixelId || "").trim(); if (code.pixelId && !/^\d{6,20}$/.test(code.pixelId)) fail(400, "The Meta Pixel ID is a number, like 123456789012345."); }
        s.code = code;
      }
      return { settings: s };
    });

    // --- Users ---------------------------------------------------------------------------------------------------
    function cleanAreas(list) {
      var out = (Array.isArray(list) ? list : []).filter(function (a, i, all) { return AREAS.indexOf(a) > -1 && all.indexOf(a) === i; });
      if (!out.length) fail(400, "Tick at least one module this person can open.");
      return out;
    }
    function isOwner(auth) { return !!(auth && auth.kind === "user" && auth.user.role === "owner"); }
    function needOwner(c, what) { if (!isOwner(c.auth)) fail(403, "Only the store owner can " + what + "."); }
    // A staff member who can open Users may not give anyone (or themselves) access they don't have
    function checkGrant(c, role, areas) {
      if (isOwner(c.auth)) return;
      if (role === "owner") fail(403, "Only the store owner can make someone an owner.");
      var mine = c.auth.areas, want = role === "custom" ? areas || [] : (ROLES[role] || {}).areas || [];
      var extra = want.filter(function (a) { return mine.indexOf(a) < 0; });
      if (extra.length) fail(403, "You can't give access you don't have yourself: " + extra.join(", ") + ".");
    }
    route("GET", "/api/users", "users", function (c) { return { users: c.db.users.map(publicUser), roles: ROLES }; }, { readonly: true });
    route("POST", "/api/users", "users", function (c) {
      var b = c.body, email = str(b.email, 120).toLowerCase();
      if (!str(b.name)) fail(400, "Enter a name.");
      if (!isEmail(email)) fail(400, "Enter a valid email.");
      if (c.db.users.some(function (u) { return u.email === email; })) fail(400, "Someone already uses that email.");
      if (!ROLES[b.role]) fail(400, "Choose a role.");
      var u = { id: newId("usr"), name: str(b.name, 80), email: email, role: b.role, createdAt: now() };
      if (b.role === "custom") u.areas = cleanAreas(b.areas);
      checkGrant(c, u.role, u.areas);
      setPassword(u, b.password);
      c.db.users.push(u);
      return { user: publicUser(u) };
    }, { status: 201 });
    route("PATCH", "/api/users/:id", "users", function (c) {
      var u = c.db.users.filter(function (x) { return x.id === c.params.id; })[0];
      if (!u) fail(404, "User not found.");
      var b = c.body;
      if (u.role === "owner") needOwner(c, "change an owner's account");
      checkGrant(c, u.role, u.areas); // can't take over (or reset the password of) someone with more access than you
      // Work out the new access first and check it, so a refused change leaves nothing half-applied
      var role = b.role || u.role;
      if (!ROLES[role]) fail(400, "Unknown role.");
      if (u.role === "owner" && role !== "owner" && c.db.users.filter(function (x) { return x.role === "owner"; }).length < 2) fail(400, "Keep at least one owner.");
      var areas = role === "custom" ? (b.areas !== undefined ? cleanAreas(b.areas) : (u.areas || [])) : undefined;
      var accessChanged = role !== u.role || (role === "custom" && JSON.stringify(areas) !== JSON.stringify(u.areas || []));
      if (accessChanged) checkGrant(c, role, areas);
      if (c.auth.user && u.id === c.auth.user.id && userAreas({ role: role, areas: areas }).indexOf("users") < 0) fail(400, "Keep Users ticked for yourself, or you'll lock yourself out of this page.");
      if (b.password) setPassword(u, b.password);
      u.role = role;
      if (role === "custom") u.areas = areas; else delete u.areas;
      if (accessChanged) c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id || (c.auth.user && c.auth.user.id === u.id); });
      if (b.name) u.name = str(b.name, 80);
      if (b.password) { c.db.sessions = c.db.sessions.filter(function (s) { return s.userId !== u.id; }); }
      return { user: publicUser(u) };
    });
    route("DELETE", "/api/users/:id", "users", function (c) {
      var u = c.db.users.filter(function (x) { return x.id === c.params.id; })[0];
      if (!u) fail(404, "User not found.");
      if (c.auth.user && u.id === c.auth.user.id) fail(400, "You can't remove yourself.");
      if (u.role === "owner") needOwner(c, "remove an owner");
      checkGrant(c, u.role, u.areas);
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
    // --- Franchise requests (admin) ------------------------------------------------------------
    route("GET", "/api/franchise", "franchise", function (c) {
      return { requests: (c.db.franchise || []).slice().sort(function (a, b) { return b.createdAt - a.createdAt; }), statuses: FRANCHISE_STATUSES };
    }, { readonly: true });
    route("PATCH", "/api/franchise/:id", "franchise", function (c) {
      var r = (c.db.franchise || []).filter(function (x) { return x.id === c.params.id; })[0];
      if (!r) fail(404, "Request not found.");
      if (c.body.status !== undefined) { if (FRANCHISE_STATUSES.indexOf(c.body.status) < 0) fail(400, "Unknown status."); r.status = c.body.status; }
      if (c.body.note !== undefined) r.note = str(c.body.note, 3000);
      if (c.body.read !== undefined) r.read = bool(c.body.read);
      r.updatedAt = now();
      return { request: r };
    });
    route("DELETE", "/api/franchise/:id", "franchise", function (c) {
      c.db.franchise = (c.db.franchise || []).filter(function (x) { return x.id !== c.params.id; });
      return { ok: true };
    });

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
        if (e && e.status >= 400 && e.status < 500 && e.message) return { status: e.status, body: { error: e.message } };
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
    ["users", "sessions", "apiKeys", "webhooks", "webhookLog", "orders", "customers", "chats", "messages", "media", "coupons", "franchise", "carts", "emailLog", "subscribers"].forEach(function (k) { if (!db[k]) db[k] = []; });
    db.counters = db.counters || { order: 1000 };
    db.stats = db.stats || { days: {} };
    db.upgrades = ["stores-franchise", "popup", "seo-text"];
    return db;
  }
  // Brings an older saved database up to date: new pages and lists, once
  function upgradeDb(db, seed) {
    var done = db.upgrades = db.upgrades || [], changed = false;
    if (!db.franchise) db.franchise = [];
    if (!db.carts) db.carts = [];
    if (!db.emailLog) db.emailLog = [];
    if (!db.subscribers) db.subscribers = [];
    if (!db.trash) db.trash = [];
    if (done.indexOf("stores-franchise") < 0) {
      ["stores", "franchise"].forEach(function (k) { if (!db.pages[k] && seed.pages[k]) db.pages[k] = clone(seed.pages[k]); });
      var col = ((db.menus || {}).footer || []).filter(function (f) { return f.id === "fc_company"; })[0] || ((db.menus || {}).footer || [])[1];
      var has = function (u) { return (db.menus.footer || []).some(function (f) { return (f.items || []).some(function (i) { return i.url === u; }); }); };
      if (col) {
        if (!has("#store-locations")) col.items.push({ id: "f_stores", label: "Store locations", url: "#store-locations", children: [] });
        if (!has("#franchise")) col.items.push({ id: "f_franchise", label: "Franchise", url: "#franchise", children: [] });
      }
      done.push("stores-franchise");
      changed = true;
    }
    if (done.indexOf("seo-text") < 0) {
      (db.categories || []).forEach(function (c) {
        var s = (seed.categories || []).filter(function (x) { return x.slug === c.slug; })[0];
        if (s && s.seoText && !c.seoText) c.seoText = s.seoText;
        if (s && s.seoTitle && !c.seoTitle) c.seoTitle = s.seoTitle;
      });
      done.push("seo-text");
      changed = true;
    }
    if (done.indexOf("popup") < 0) {
      if (!db.pages.popup && seed.pages.popup) { db.pages.popup = clone(seed.pages.popup); db.pages.popup.enabled = false; }
      done.push("popup");
      changed = true;
    }
    return changed;
  }

  return { create: create, freshDb: freshDb, upgradeDb: upgradeDb, sha256: sha256, slugify: slugify, ROLES: ROLES, EVENTS: EVENTS, headCode: headCode, siteCode: siteCode,
    ORDER_STATUSES: ORDER_STATUSES, PAYMENT_STATUSES: PAYMENT_STATUSES, isPhone: isPhone, normPhone: normPhone };
});
