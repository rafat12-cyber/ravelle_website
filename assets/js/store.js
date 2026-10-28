// Ravelle storefront: hash-routed pages over the store API (client.js), the
// bag and checkout, chat, and the scroll effects from the reference design
// (slat reveals, scrambled words, drifting type).
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var taka = function (n) { return "৳" + Math.round(n || 0).toLocaleString("en-US"); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var br = function (s) { return esc(s).replace(/\n/g, "<br>"); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var EDIT = /[?&]edit\b/.test(location.search);
  var api = window.Ravelle.call;

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("ravelle:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("ravelle:" + k, JSON.stringify(v)); } catch (e) {} }
  };

  // Catalogue, filled from GET /api/store
  var S = { settings: {}, categories: [], attributes: [], products: [], pages: {}, menus: { header: [], footer: [] } };
  var BY_ID = {}, BY_SLUG = {}, CAT_BY_SLUG = {}, CAT_BY_ID = {};
  var cart = [], saved = store.get("saved", []);

  function index() {
    BY_ID = {}; BY_SLUG = {}; CAT_BY_SLUG = {}; CAT_BY_ID = {};
    S.products.forEach(function (p, i) { p.order = i; BY_ID[p.id] = p; BY_SLUG[p.slug] = p; });
    S.categories.forEach(function (c) { CAT_BY_SLUG[c.slug] = c; CAT_BY_ID[c.id] = c; });
    cart = store.get("cart", []).filter(function (l) {
      var p = BY_ID[l.productId];
      return p && (!p.variants.length || p.variants.some(function (v) { return v.id === l.variantId; }));
    });
  }
  var priceOf = function (p, v) { return v && v.price != null ? v.price : p.price; };
  var offOf = function (p) { return p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0; };
  var variantOf = function (p, id) { return p.variants.filter(function (v) { return v.id === id; })[0] || null; };
  var optText = function (o) { return Object.keys(o || {}).map(function (k) { return k + " " + o[k]; }).join(" · "); };
  var soldOut = function (p) { return p.trackStock && p.stock === 0; };

  // ---------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------
  function heart(n) {
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  var ICON = {
    bag: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Z M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 15 15 3l6 6L9 21l-6-6Z M7 11l2 2M10 8l2 2M13 5l2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  };

  function card(p, i) {
    var off = offOf(p), img = p.images[0] || "";
    return (
      '<a class="card' + (soldOut(p) ? " is-out" : "") + '" data-line="' + esc(p.line) + '" href="#product/' + p.slug + '" style="--tone:' + esc(p.hex || "#7b7e83") + '">' +
        (img ? '<img class="card__img" src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="' + (i < 4 ? "eager" : "lazy") + '">' : "") +
        '<span class="card__type" aria-hidden="true">' + esc(p.line || p.name) + "<small>" + esc(p.color) + "</small></span>" +
        '<span class="card__top">' + (soldOut(p) ? '<span class="chip chip--out">Sold out</span>' : off ? '<span class="chip">−' + off + "%</span>" : p.isNew ? '<span class="chip">New</span>' : "<span></span>") +
          '<button class="card__fav" type="button" data-save="' + p.id + '" aria-pressed="' + (saved.indexOf(p.id) > -1) + '" aria-label="Save ' + esc(p.name) + '">' + heart(12) + "</button></span>" +
        '<span class="card__bar"><span class="card__name"><b>' + esc(shortName(p)) + "</b>" +
          '<span class="card__price">' + (p.color ? esc(p.color) + " · " : "") + taka(p.price) + (off ? "<s>" + taka(p.comparePrice) + "</s>" : "") + "</span></span>" +
          '<span class="card__go" aria-hidden="true">›</span></span>' +
      "</a>"
    );
  }
  // "Fearless Oversized T-shirt – Black" shows as "Fearless Oversized T-shirt" with the colour beneath.
  function shortName(p) { return p.color ? p.name.replace(new RegExp("\\s*[–-]\\s*" + p.color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), "") : p.name; }
  function grid(list) { return list.map(card).join(""); }

  // A photo that can't load gives way to the colour card behind it.
  function guardImages(root) {
    $$("img[data-guard], .card__img", root).forEach(function (img) {
      var fail = function () {
        if (!img.isConnected) return;
        var host = img.closest("[data-fallback]") || img.parentElement;
        host.classList.add("no-img");
        img.remove();
      };
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) fail();
      else img.addEventListener("error", fail, { once: true });
    });
  }

  var toastTimer;
  function toast(msg, kind) {
    var t = $("#toast");
    t.innerHTML = msg;
    t.className = "toast is-on" + (kind ? " toast--" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-on"); }, 3200);
  }

  // Light Markdown for policy pages: ## headings, lists, **bold**, [links](#page)
  function md(src) {
    var out = [], list = null;
    var inline = function (s) {
      return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\[([^\]]+)\]\(((?:#|https?:\/\/|mailto:|tel:)[^)\s]*)\)/g, function (_, t, u) { return '<a class="u" href="' + u + '"' + (/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : "") + ">" + t + "</a>"; });
    };
    var close = function () { if (list) { out.push("</" + list + ">"); list = null; } };
    String(src || "").split(/\n/).forEach(function (line) {
      var m;
      if (!line.trim()) { close(); return; }
      if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) { close(); out.push("<h" + m[1].length + ">" + inline(m[2]) + "</h" + m[1].length + ">"); return; }
      if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(m[1]) + "</li>"); return; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(m[1]) + "</li>"); return; }
      close();
      out.push("<p>" + inline(line) + "</p>");
    });
    close();
    return out.join("");
  }

  // ---------------------------------------------------------------------------
  // Content binding: data-c (text), data-ci (image), data-calt, data-chref,
  // data-lines (one span per line), data-marquee. Paths are relative to the
  // page in the nearest [data-page].
  // ---------------------------------------------------------------------------
  var pick = function (obj, path) { return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); };
  function bind(root, data) {
    if (!data) return;
    $$("[data-c]", root).forEach(function (el) {
      var v = pick(data, el.dataset.c);
      if (typeof v === "string" && el !== document.activeElement) el.innerHTML = br(v);
    });
    $$("[data-ci]", root).forEach(function (el) {
      var v = pick(data, el.dataset.ci);
      if (v && el.getAttribute("src") !== v) el.setAttribute("src", v);
    });
    $$("[data-calt]", root).forEach(function (el) { var v = pick(data, el.dataset.calt); if (typeof v === "string") el.setAttribute("alt", v); });
    $$("[data-chref]", root).forEach(function (el) { var v = pick(data, el.dataset.chref); if (v) el.setAttribute("href", v); });
    $$("[data-lines]", root).forEach(function (el) {
      var v = pick(data, el.dataset.lines);
      if (typeof v !== "string") return;
      if (!el._slots) el._slots = Array.prototype.map.call(el.children, function (s) { return s.className; });
      el.innerHTML = v.split("\n").filter(function (r) { return r.trim(); }).map(function (r, i) {
        var cls = el._slots[i] || "";
        return "<span" + (cls ? ' class="' + cls + '"' : "") + " data-scramble>" + esc(r) + "</span>";
      }).join("");
    });
    $$("[data-marquee]", root).forEach(function (el) {
      var v = pick(data, el.dataset.marquee);
      if (typeof v !== "string" || !v.trim()) return;
      var sep = el.dataset.sep || "✕", one = v.trim() + " " + sep + " ", out = one;
      while (out.length < 64) out += one;
      el.textContent = out.trim();
    });
    $$("[data-md]", root).forEach(function (el) { var v = pick(data, el.dataset.md); if (typeof v === "string") el.innerHTML = md(v); });
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ/#*";
  function scramble(el) {
    if (EDIT) return;
    var final = el.textContent, frame = 0, total = final.length * 3 + 8;
    (function tick() {
      var out = "";
      for (var i = 0; i < final.length; i++) {
        var settle = i * 3 + 6;
        out += frame >= settle || final[i] === " " ? final[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (++frame <= total) requestAnimationFrame(tick);
      else el.textContent = final;
    })();
  }

  // Copies the card's photo into strips; each strip opens sideways from a thin
  // line, then thickens to meet its neighbours, staggered top to bottom.
  function buildSlats(el) {
    var img = el.querySelector(":scope > img");
    if (!img || !img.animate || reduce || EDIT) return;
    $$(".slat__strip", el).forEach(function (s) { s.remove(); });
    var go = function () {
      if (!img.isConnected || !img.naturalWidth) return;
      var N = 14, band = 100 / N, strips = [], done = 0;
      var er = el.getBoundingClientRect(), ir = img.getBoundingClientRect(), cs = getComputedStyle(img);
      var box = { left: ir.left - er.left, top: ir.top - er.top, width: ir.width, height: ir.height };
      el.classList.add("is-building");
      for (var i = 0; i < N; i++) {
        var strip = document.createElement("div");
        strip.className = "slat__strip";
        var copy = img.cloneNode();
        ["loading", "class", "data-guard", "data-ci", "data-calt", "id"].forEach(function (a) { copy.removeAttribute(a); });
        copy.alt = "";
        copy.style.cssText = "position:absolute;max-width:none;margin:0;translate:none;transform:none;" +
          "left:" + box.left + "px;top:" + box.top + "px;width:" + box.width + "px;height:" + box.height + "px;" +
          "object-fit:" + cs.objectFit + ";object-position:" + cs.objectPosition + ";padding:" + cs.padding + ";box-sizing:" + cs.boxSizing + ";";
        strip.appendChild(copy);
        el.insertBefore(strip, img);
        strips.push(strip);
        var top = i * band, bot = 100 - (i + 1) * band - 0.3;
        var thin = band * 0.42;
        var fromLeft = i % 3 !== 1;
        var start = "inset(" + (top + thin) + "% " + (fromLeft ? 100 : 0) + "% " + (bot + thin) + "% " + (fromLeft ? 0 : 100) + "%)";
        var mid = "inset(" + (top + thin) + "% 0% " + (bot + thin) + "% 0%)";
        var end = "inset(" + top + "% 0% " + Math.max(0, bot) + "% 0%)";
        strip.animate(
          [{ clipPath: start }, { clipPath: mid, offset: 0.6 }, { clipPath: end }],
          { duration: 820, delay: i * 45 + (i % 2) * 70, easing: "cubic-bezier(.7,0,.25,1)", fill: "both" }
        ).onfinish = function () {
          if (++done < N) return;
          el.classList.remove("is-building");
          strips.forEach(function (s) { s.remove(); });
        };
      }
    };
    if (img.complete && img.naturalWidth) go();
    else img.addEventListener("load", go, { once: true });
  }

  var io, rio;
  if (!reduce && !EDIT && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        scramble(en.target);
      });
    }, { threshold: 0.4 });
    rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        rio.unobserve(el);
        el.classList.add("is-in");
        if (el.classList.contains("slat")) setTimeout(function () { buildSlats(el); }, 380);
      });
    }, { threshold: 0.2 });
  } else {
    document.documentElement.classList.add("no-reveal");
  }
  function activate(root, skip) {
    guardImages(root);
    if (EDIT) editable(root);
    if (!io) return;
    $$("[data-scramble]", root).forEach(function (el) { if (el !== skip) io.observe(el); });
    $$(".reveal", root).forEach(function (el) { rio.observe(el); });
  }

  // Scroll: sticky header, drifting marquees and the lookbook stack
  var lookbook = document.getElementById("lookbook");
  var current = 0;
  function onScroll() {
    var vh = window.innerHeight, y = window.scrollY;
    var top = $("#topbar");
    var heroNav = homeView.hidden ? $("#pagehead .nav") : $(".hero .nav");
    var limit = heroNav ? heroNav.getBoundingClientRect().bottom + y : 80;
    top.classList.toggle("is-on", y > limit + 10);
    $$("[data-drift]").forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (!r.height || r.bottom < -200 || r.top > vh + 200) return;
      var p = (vh - r.top) / (vh + r.height);
      el.style.transform = "translateX(" + (p * 30 * parseFloat(el.dataset.drift)) + "%)";
    });
    if (lookbook && lookbook.offsetParent) {
      var imgs = $$(".look__img", lookbook);
      var b = lookbook.getBoundingClientRect();
      var prog = Math.min(0.999, Math.max(0, -b.top / (b.height - vh)));
      var idx = Math.floor(prog * imgs.length);
      if (idx !== current && imgs[idx]) {
        imgs[current].classList.remove("is-on");
        imgs[idx].classList.add("is-on");
        drawLook(idx);
        current = idx;
      }
    }
  }
  function drawLook(idx) {
    var looks = ((S.pages.home || {}).lookbook || {}).looks || [];
    var l = looks[idx];
    if (!l) return;
    $("#lookName").innerHTML = br(l.name);
    $("#lookItems").innerHTML = "● " + br(l.items);
    $("#lookCount").textContent = "0" + (idx + 1) + " / 0" + looks.length;
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { onScroll(); ticking = false; });
  }, { passive: true });

  // ---------------------------------------------------------------------------
  // Header, menus and footer
  // ---------------------------------------------------------------------------
  function menuItem(it) {
    var kids = it.children && it.children.length;
    return '<li' + (kids ? ' class="has-sub"' : "") + '><a href="' + esc(it.url || "#") + '">' + esc(it.label) + "</a>" +
      (kids ? '<ul class="nav__sub">' + it.children.map(function (c) { return '<li><a href="' + esc(c.url) + '">' + esc(c.label) + "</a></li>"; }).join("") + "</ul>" : "") + "</li>";
  }
  function navHTML() {
    var items = S.menus.header || [];
    var half = Math.min(4, Math.ceil(items.length / 2));
    return '<nav class="nav" aria-label="Main">' +
      '<div class="nav__group nav__start">' +
        '<button class="icon-btn icon-btn--line nav__burger" type="button" data-open-menu aria-label="Open menu">' + ICON.menu + "</button>" +
        '<ul class="nav__group nav__menu">' + items.slice(0, half).map(menuItem).join("") + "</ul>" +
      "</div>" +
      '<a class="nav__brand" href="#home" aria-label="' + esc(S.settings.store ? S.settings.store.name : "Ravelle") + ' home"><img src="assets/img/logo.png" alt="Ravelle" width="100" height="54"></a>' +
      '<div class="nav__group nav__group--end">' +
        '<ul class="nav__group nav__menu nav__links-end">' + items.slice(half).map(menuItem).join("") + "</ul>" +
        '<button class="icon-btn icon-btn--line" type="button" data-open-search aria-label="Search">' + ICON.search + "</button>" +
        '<a class="icon-btn icon-btn--line nav__track" href="#track" aria-label="Track your order">' + ICON.user + "</a>" +
        '<button class="icon-btn bag-btn" type="button" data-open-bag aria-label="Open bag">' + ICON.bag + '<span class="bag-count" data-bag-count hidden>0</span></button>' +
      "</div></nav>";
  }
  function drawChrome() {
    var nav = navHTML();
    $(".hero .nav").outerHTML = nav;
    $("#topbar").innerHTML = '<div class="topbar__inner">' + nav + "</div>";
    var st = S.settings.store || {};
    var ann = $("#announce");
    ann.hidden = !S.settings.announcement;
    ann.textContent = S.settings.announcement || "";

    // Mobile menu
    $("#menuList").innerHTML = (S.menus.header || []).map(function (it, i) {
      var kids = it.children && it.children.length;
      if (!kids) return '<li><a class="menu__link" href="' + esc(it.url) + '">' + esc(it.label) + "</a></li>";
      return '<li><details' + (i === 0 ? "" : "") + '><summary class="menu__link">' + esc(it.label) + "</summary>" +
        '<ul class="menu__sub"><li><a href="' + esc(it.url) + '">All ' + esc(it.label.toLowerCase()) + "</a></li>" +
        it.children.map(function (c) { return '<li><a href="' + esc(c.url) + '">' + esc(c.label) + "</a></li>"; }).join("") + "</ul></details></li>";
    }).join("");
    $("#menuFoot").innerHTML = '<a href="#track">Track order</a><a href="#saved">Saved items</a><a href="#contact">Contact us</a>' +
      (st.phone ? '<a href="tel:' + esc(st.phone.replace(/[^\d+]/g, "")) + '">' + esc(st.phone) + "</a>" : "");

    // Footer
    var soc = S.settings.social || {};
    var socials = [["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]].filter(function (s) { return soc[s[0]]; });
    if (st.whatsapp) socials.push(["whatsapp", "WhatsApp"]);
    $("#footerCols").innerHTML = (S.menus.footer || []).map(function (col) {
      return '<ul><li class="mono">' + esc(col.title) + "</li>" + col.items.map(function (it) { return '<li><a href="' + esc(it.url) + '">' + esc(it.label) + "</a></li>"; }).join("") + "</ul>";
    }).join("") +
      '<ul class="footer__contact"><li class="mono">Get in touch</li>' +
        (st.address ? "<li>" + esc(st.address) + "</li>" : "") +
        (st.phone ? '<li><a href="tel:' + esc(st.phone.replace(/[^\d+]/g, "")) + '">' + esc(st.phone) + "</a></li>" : "") +
        (st.email ? '<li><a href="mailto:' + esc(st.email) + '">' + esc(st.email) + "</a></li>" : "") +
        (socials.length ? '<li class="footer__social">' + socials.map(function (s) {
          var url = s[0] === "whatsapp" ? "https://wa.me/" + st.whatsapp.replace(/[^\d]/g, "") : soc[s[0]];
          return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + s[1] + "</a>";
        }).join("") + "</li>" : "") +
      "</ul>";
    var legal = [["Trade license", st.tradeLicense], ["TIN", st.tin], ["DBID", st.dbid], ["BIN", st.bin]].filter(function (x) { return x[1]; });
    $("#footerLegal").innerHTML = legal.map(function (x) { return "<span>" + x[0] + ": " + esc(x[1]) + "</span>"; }).join("");
    $("#footerCopy").innerHTML = "© " + new Date().getFullYear() + " " + esc(st.legalName || "Ravelle") + " · Prices in BDT (৳)";
    var payments = S.settings.payments || {};
    $("#payBadges").innerHTML = (payments.sslcommerz ? ["VISA", "Mastercard", "AMEX", "bKash", "Nagad", "Rocket", "Upay", "DBBL Nexus", "Internet banking"] : []).concat(payments.cod ? ["Cash on delivery"] : [])
      .map(function (b) { return '<span class="pay-badge">' + esc(b) + "</span>"; }).join("");
    $("#sslBanner").hidden = !payments.sslcommerz;
    bind($("#footer"), S.pages.home);
    syncCount();
  }

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------
  var homeView = $('[data-view="home"]');
  var pageView = $('[data-view="page"]');
  var page = $("#page");
  var pagehead = $("#pagehead");

  function drawHome() {
    var home = S.pages.home;
    bind(homeView, home);
    current = 0;
    $$(".look__img", homeView).forEach(function (im, i) { im.classList.toggle("is-on", i === 0); });
    drawLook(0);
    var list = S.products.filter(function (p) { return p.featured || p.isNew; }).concat(S.products.filter(function (p) { return !p.featured && !p.isNew; })).slice(0, 12);
    $("#grid").innerHTML = grid(list);
    var lines = [];
    list.forEach(function (p) { if (p.line && lines.indexOf(p.line) < 0) lines.push(p.line); });
    $("#homeFilters").innerHTML = ["All"].concat(lines).map(function (l, i) {
      return '<button class="filter' + (i ? "" : " is-on") + '" data-filter="' + esc(l) + '" role="tab" aria-selected="' + !i + '">' + esc(l) + "</button>";
    }).join("");
    // Categories with products or children, top level first
    var cats = S.categories.filter(function (c) { return c.parentId && CAT_BY_ID[c.parentId] && CAT_BY_ID[c.parentId].slug === "men"; });
    $("#catList").innerHTML = cats.map(function (c) {
      var n = productsIn(c).length;
      return '<li><a href="#category/' + c.slug + '"><span>' + esc(c.name) + '</span><span class="mono">' + (n ? n + (n === 1 ? " style" : " styles") : "Soon") + "</span></a></li>";
    }).join("");
  }
  $("#homeFilters").addEventListener("click", function (e) {
    var btn = e.target.closest(".filter");
    if (!btn) return;
    var f = btn.dataset.filter;
    $$("#homeFilters .filter").forEach(function (b) { b.classList.toggle("is-on", b === btn); b.setAttribute("aria-selected", b === btn ? "true" : "false"); });
    $$("#grid .card").forEach(function (c) { c.hidden = f !== "All" && c.dataset.line !== f; });
  });

  // ---------------------------------------------------------------------------
  // Page header
  // ---------------------------------------------------------------------------
  function head(crumb, title, sub, key) {
    pagehead.innerHTML = '<div class="hero__panel pagehead__panel"' + (key ? ' data-page="' + key + '"' : "") + ">" + navHTML() +
      '<div class="pagehead__copy"><p class="eyebrow">' + crumb + '</p><h1 class="display display--page">' + title + "</h1>" +
      (sub ? '<p class="pagehead__sub">' + sub + "</p>" : "") + "</div></div>";
    syncCount();
  }
  function miniHead() {
    pagehead.innerHTML = '<div class="hero__panel pagehead__panel pagehead__panel--mini">' + navHTML() + "</div>";
    syncCount();
  }

  // ---------------------------------------------------------------------------
  // Listings
  // ---------------------------------------------------------------------------
  function descendants(cat) {
    var out = [cat.id];
    S.categories.forEach(function (c) { if (c.parentId === cat.id) out = out.concat(descendants(c)); });
    return out;
  }
  function productsIn(cat) {
    var ids = descendants(cat);
    return S.products.filter(function (p) { return p.categoryIds.some(function (id) { return ids.indexOf(id) > -1; }); });
  }
  function crumbFor(cat) {
    var parts = [], c = cat;
    while (c) { parts.unshift('<a href="#category/' + c.slug + '">' + esc(c.name) + "</a>"); c = CAT_BY_ID[c.parentId]; }
    return '<a href="#shop">Shop</a> / ' + parts.join(" / ");
  }
  function accent(name) { return esc(name).replace(/(\S+)$/, '<em class="alt" data-scramble>$1</em>'); }

  function viewListing(opts) {
    var base = opts.list;
    head(opts.crumb, opts.title, opts.sub || base.length + (base.length === 1 ? " piece" : " pieces") + ". Prices in BDT.");
    var subcats = opts.cat ? S.categories.filter(function (c) { return c.parentId === opts.cat.id && productsIn(c).length; }) : [];
    var lines = [];
    base.forEach(function (p) { if (p.line && lines.indexOf(p.line) < 0) lines.push(p.line); });
    var chips = subcats.length > 1 ? subcats.map(function (c) { return { key: "cat:" + c.id, label: c.name }; }) : lines.length > 1 ? lines.map(function (l) { return { key: "line:" + l, label: l }; }) : [];
    var colors = [];
    base.forEach(function (p) { if (p.color && !colors.some(function (c) { return c.name === p.color; })) colors.push({ name: p.color, hex: p.hex }); });
    var sizes = [];
    base.forEach(function (p) { p.variants.forEach(function (v) { var s = v.options.Size; if (s && sizes.indexOf(s) < 0) sizes.push(s); }); });
    page.innerHTML =
      '<section class="shop">' +
        '<div class="toolbar">' +
          (chips.length ? '<div class="filters filters--left" role="group" aria-label="Filter">' + [{ key: "", label: "All" }].concat(chips).map(function (c, i) {
            return '<button class="filter' + (i ? "" : " is-on") + '" type="button" data-chip="' + esc(c.key) + '">' + esc(c.label) + "</button>";
          }).join("") + "</div>" : "<span></span>") +
          '<div class="toolbar__right">' +
            (colors.length > 1 ? '<div class="swatches" role="group" aria-label="Colour">' + colors.map(function (c) {
              return '<button class="swatch" type="button" data-color="' + esc(c.name) + '" style="--sw:' + esc(c.hex) + '" aria-pressed="false" title="' + esc(c.name) + '"><span class="sr">' + esc(c.name) + "</span></button>";
            }).join("") + "</div>" : "") +
            (sizes.length > 1 ? '<label class="sort"><span class="sr">Size</span><select id="sizeFilter"><option value="">Any size</option>' + sizes.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></label>" : "") +
            '<label class="sort"><span class="sr">Sort</span><select id="sort">' +
              '<option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option>' +
            "</select></label>" +
          "</div>" +
        "</div>" +
        '<p class="shop__count mono" id="count"></p>' +
        '<div class="grid" id="shopGrid"></div>' +
        '<div class="empty" id="shopEmpty" hidden><p>Nothing matches those filters.</p><button class="pill pill--dark pill--sm" type="button" id="clearFilters">Clear filters</button></div>' +
      "</section>";
    var state = { chip: "", color: null, size: "", sort: "featured" };
    function draw() {
      var list = base.filter(function (p) {
        if (state.chip.indexOf("cat:") === 0 && !productsIn(CAT_BY_ID[state.chip.slice(4)]).some(function (x) { return x === p; })) return false;
        if (state.chip.indexOf("line:") === 0 && p.line !== state.chip.slice(5)) return false;
        if (state.color && p.color !== state.color) return false;
        if (state.size && !p.variants.some(function (v) { return v.options.Size === state.size && (!p.trackStock || v.stock > 0); })) return false;
        return true;
      }).slice();
      if (state.sort === "low") list.sort(function (a, b) { return a.price - b.price || a.order - b.order; });
      if (state.sort === "high") list.sort(function (a, b) { return b.price - a.price || a.order - b.order; });
      if (state.sort === "new") list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      if (state.sort === "featured") list.sort(function (a, b) { return (soldOut(a) ? 1 : 0) - (soldOut(b) ? 1 : 0) || a.order - b.order; });
      $("#shopGrid").innerHTML = grid(list);
      $("#count").textContent = list.length + (list.length === 1 ? " product" : " products");
      $("#shopEmpty").hidden = list.length > 0;
      guardImages($("#shopGrid"));
    }
    $$(".toolbar .filter", page).forEach(function (b) {
      b.addEventListener("click", function () {
        state.chip = b.dataset.chip;
        $$(".toolbar .filter", page).forEach(function (x) { x.classList.toggle("is-on", x === b); });
        draw();
      });
    });
    $$(".swatch", page).forEach(function (b) {
      b.addEventListener("click", function () {
        state.color = state.color === b.dataset.color ? null : b.dataset.color;
        $$(".swatch", page).forEach(function (x) { x.setAttribute("aria-pressed", x.dataset.color === state.color ? "true" : "false"); });
        draw();
      });
    });
    if ($("#sizeFilter")) $("#sizeFilter").addEventListener("change", function (e) { state.size = e.target.value; draw(); });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; draw(); });
    $("#clearFilters").addEventListener("click", function () {
      state = { chip: "", color: null, size: "", sort: state.sort };
      $$(".toolbar .filter", page).forEach(function (x, i) { x.classList.toggle("is-on", i === 0); });
      $$(".swatch", page).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      if ($("#sizeFilter")) $("#sizeFilter").value = "";
      draw();
    });
    draw();
  }

  function viewCategory(slug) {
    var cat = CAT_BY_SLUG[slug];
    if (!cat) return viewMissing();
    var list = productsIn(cat);
    var kids = S.categories.filter(function (c) { return c.parentId === cat.id; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    // A category of collections (like The House) shows its collections first.
    var collections = kids.filter(function (c) { return c.image; });
    if (collections.length >= 3 && collections.length === kids.length) {
      head(crumbFor(cat), accent(cat.name), esc(cat.description || ""));
      page.innerHTML = '<section class="house house--page"><div class="house__grid">' + collections.map(collectionCard).join("") + "</div></section>" +
        (list.length ? '<section class="related"><div class="section-head"><p class="eyebrow">Shop the House</p><h2 class="h2">All <em class="alt" data-scramble>pieces</em></h2></div><div class="grid">' + grid(list) + "</div></section>" : shopNow("While you wait", 'Shop the <em class="alt" data-scramble>summer</em> tees'));
      return;
    }
    if (!list.length) return viewSoon(cat);
    viewListing({ list: list, cat: cat, crumb: crumbFor(cat), title: accent(cat.name), sub: cat.description ? esc(cat.description) + " · " + list.length + " pieces" : "" });
  }
  function collectionCard(c, i) {
    var n = productsIn(c).length;
    return '<a class="drop drop--sm reveal slat dark" href="#category/' + c.slug + '">' +
      '<img src="' + esc(c.image) + '" alt="" loading="lazy">' +
      '<span class="drop__meta mono">0' + (i + 1) + " / " + esc((CAT_BY_ID[c.parentId] || {}).name || "Ravelle") + "</span>" +
      '<span class="drop__title"><span data-scramble>' + esc(c.name) + '</span><span class="fade drop__mood">' + esc(c.description || "") + "</span></span>" +
      '<span class="chip chip--ghost">● ' + (n ? n + " pieces" : "First drop soon") + "</span></a>";
  }
  function notify(id, topic) {
    return '<form class="notify" data-notify="' + esc(topic) + '"><label class="sr" for="' + id + '">Email</label>' +
      '<input id="' + id + '" type="email" required placeholder="Email for drop alerts"><button class="pill pill--dark pill--sm" type="submit">Notify me</button></form>' +
      '<p class="notify__ok mono" hidden>You\'re on the list. We\'ll email you when it drops.</p>';
  }
  function shopNow(eyebrow, title) {
    var list = S.products.filter(function (p) { return p.featured; }).concat(S.products.filter(function (p) { return !p.featured && p.isNew; })).slice(0, 4);
    return '<section class="related"><div class="section-head"><p class="eyebrow">' + eyebrow + '</p><h2 class="h2">' + title + "</h2>" +
      '<a class="eyebrow eyebrow--link" href="#shop">All products →</a></div><div class="grid">' + grid(list) + "</div></section>";
  }
  function viewSoon(cat) {
    var parent = CAT_BY_ID[cat.parentId];
    head(crumbFor(cat), accent(cat.name), "Not in stock yet.");
    page.innerHTML =
      '<section class="soon">' +
        '<div class="soon__card reveal slat dark"><img src="' + esc(cat.image || (parent && parent.image) || "assets/img/c-black.webp") + '" alt="" loading="lazy">' +
          '<span class="drop__meta mono">' + esc(parent ? parent.name : "Ravelle") + " / " + esc(cat.name) + "</span>" +
          '<p class="soon__big" aria-hidden="true">' + esc(cat.name.split(" ")[0]) + "</p></div>" +
        '<div class="soon__copy"><p class="eyebrow">Coming soon</p><h2 class="h2">' + esc(cat.name) + ' is <em class="alt" data-scramble>next</em></h2>' +
          "<p>" + esc(cat.description || "We're still working on this line.") + " Leave your email and we'll tell you the day it goes live.</p>" + notify("n-" + cat.slug, cat.name) +
          (parent ? '<a class="pill pill--light pill--sm" href="#category/' + parent.slug + '">Back to ' + esc(parent.name) + "</a>" : "") + "</div>" +
      "</section>" + shopNow("Live now", 'Shop the <em class="alt" data-scramble>summer</em> tees');
  }

  var SHOPS = {
    "shop": function () { return { list: S.products, crumb: "Shop", title: 'Shop <em class="alt" data-scramble>all</em>' }; },
    "new-in": function () { return { list: S.products.filter(function (p) { return p.isNew; }), crumb: "Shop / New in", title: 'New <em class="alt" data-scramble>in</em>' }; },
    "on-sale": function () {
      var list = S.products.filter(function (p) { return offOf(p) > 0; });
      var max = list.reduce(function (m, p) { return Math.max(m, offOf(p)); }, 0);
      return { list: list, crumb: "Shop / On sale", title: 'Raining <em class="alt" data-scramble>offers</em>', sub: list.length ? list.length + " pieces marked down, up to " + max + "% off." : "No offers right now." };
    }
  };

  function viewSearch(q) {
    q = (q || "").trim();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = S.products.filter(function (p) {
      var hay = (p.name + " " + p.line + " " + p.color + " " + p.sku + " " + p.variants.map(function (v) { return v.sku; }).join(" ") + " " +
        p.categoryIds.map(function (id) { return (CAT_BY_ID[id] || {}).name; }).join(" ")).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    });
    viewListing({ list: list, crumb: "Search", title: '“' + esc(q) + '”', sub: list.length ? list.length + " results" : "Nothing found. Try another word, like tee, black or fearless." });
  }

  // ---------------------------------------------------------------------------
  // Product page
  // ---------------------------------------------------------------------------
  function viewProduct(slug) {
    var p = BY_SLUG[slug];
    if (!p) return viewMissing();
    track("view", p.id);
    miniHead();
    var cat = CAT_BY_ID[p.categoryIds[p.categoryIds.length - 1]] || CAT_BY_ID[p.categoryIds[0]];
    var related = S.products.filter(function (x) { return x !== p && x.line === p.line; })
      .concat(S.products.filter(function (x) { return x !== p && x.line !== p.line && (x.featured || x.isNew); })).slice(0, 4);
    var isSaved = saved.indexOf(p.id) > -1, off = offOf(p);
    var attrDefs = {};
    S.attributes.forEach(function (a) { attrDefs[a.name] = a; });
    var ship = (S.settings.shipping || {});
    page.innerHTML =
      '<section class="pd">' +
        '<div class="pd__gallery">' +
          '<div class="pd__main slat" data-fallback style="--tone:' + esc(p.hex || "#7b7e83") + '">' +
            (p.images[0] ? '<img id="pdMain" data-guard src="' + esc(p.images[0]) + '" alt="' + esc(p.name) + '">' : "") +
            '<span class="card__type" aria-hidden="true">' + esc(p.line || p.name) + "<small>" + esc(p.color) + "</small></span>" +
            (off ? '<span class="pd__tag mono">−' + off + "% off</span>" : "") +
          "</div>" +
          '<div class="pd__thumbs" role="group" aria-label="Photos">' +
            p.images.map(function (src, i) {
              return '<button class="pd__thumb' + (i ? "" : " is-on") + '" type="button" data-src="' + esc(src) + '" data-fallback style="--tone:' + esc(p.hex || "#7b7e83") + '" aria-label="Photo ' + (i + 1) + '">' +
                '<img data-guard src="' + esc(src) + '" alt="" loading="lazy"><span class="card__type" aria-hidden="true"><small>' + (i + 1) + "</small></span></button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="pd__info">' +
          '<p class="eyebrow">' + (cat ? crumbFor(cat) : '<a href="#shop">Shop</a>') + "</p>" +
          '<h1 class="pd__name">' + esc(shortName(p)).replace(/Oversized/i, '<em class="alt" data-scramble>oversized</em>') + (p.color ? ' <span class="pd__color">' + esc(p.color) + "</span>" : "") + "</h1>" +
          '<p class="pd__price"><b id="pdPrice">' + taka(p.price) + "</b>" + (off ? "<s>" + taka(p.comparePrice) + '</s><span class="chip chip--sale">Save ' + taka(p.comparePrice - p.price) + "</span>" : "") + "</p>" +
          '<p class="pd__meta mono"><span>SKU: <b id="pdSku">' + esc(p.sku) + '</b></span><span id="pdStock" class="stock"></span></p>' +
          (p.description ? '<p class="pd__about">' + esc(p.description) + "</p>" : "") +
          p.attributes.map(function (a, ai) {
            var def = attrDefs[a.name] || {};
            var isSize = /size/i.test(a.name);
            return '<div class="pd__block" data-attr="' + esc(a.name) + '">' +
              '<div class="pd__label-row"><p class="pd__label mono">' + esc(a.name) + ' · <span data-attr-label>Choose one</span></p>' +
                (isSize && p.sizeGuide ? '<button class="guide-btn" type="button" data-size-guide>' + ICON.ruler + "Size guide</button>" : "") + "</div>" +
              '<div class="sizes' + (def.type === "color" ? " sizes--color" : "") + '" role="radiogroup" aria-label="' + esc(a.name) + '">' + a.values.map(function (val) {
                var hex = def.type === "color" ? ((def.values || []).filter(function (x) { return x.label === val; })[0] || {}).hex : "";
                return '<button class="size" type="button" role="radio" aria-checked="false" data-value="' + esc(val) + '"' + (hex ? ' style="--sw:' + esc(hex) + '"' : "") + ">" + esc(val) + "</button>";
              }).join("") + "</div>" +
              '<p class="pd__warn" role="alert" hidden>Please choose a ' + esc(a.name.toLowerCase()) + ".</p></div>";
          }).join("") +
          '<div class="pd__buy">' +
            '<div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><span id="qty">1</span><button type="button" data-q="1" aria-label="More">+</button></div>' +
            '<button class="pill pill--light pd__add" type="button" id="addBag">Add to bag</button>' +
            '<button class="icon-btn icon-btn--line pd__save" type="button" data-save="' + p.id + '" aria-pressed="' + isSaved + '" aria-label="Save">' + heart(15) + "</button>" +
          "</div>" +
          '<button class="pill pill--dark pd__now" type="button" id="buyNow">Buy now · <span id="buyTotal">' + taka(p.price) + "</span></button>" +
          '<ul class="pd__perks mono"><li>Cash on delivery</li><li>' + esc((ship.zones || []).map(function (z) { return z.name + " " + z.days; }).join(" · ")) + "</li><li>7-day exchange</li></ul>" +
          '<div class="acc">' +
            (p.details.length ? '<details open><summary>Details &amp; fit</summary><ul class="ticks">' + p.details.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul></details>" : "") +
            '<details><summary>Delivery</summary><p>' + (ship.zones || []).map(function (z) { return esc(z.name) + ": " + esc(z.days) + ", " + taka(z.fee); }).join("<br>") +
              (ship.processing ? "<br>" + esc(ship.processing) : "") + ' <a class="u" href="#delivery">Delivery policy</a></p></details>' +
            '<details><summary>Returns &amp; exchanges</summary><p>Exchange or return within 7 days of delivery, unworn with tags. <a class="u" href="#refund">Return &amp; refund policy</a></p></details>' +
          "</div>" +
        "</div>" +
      "</section>" +
      (related.length ? '<section class="related"><div class="section-head"><p class="eyebrow">Complete the look</p><h2 class="h2">Pair it <em class="alt" data-scramble>with</em></h2></div>' +
        '<div class="grid">' + grid(related) + "</div></section>" : "");

    var chosen = {}, qty = 1;
    function selected() {
      if (!p.variants.length) return null;
      if (Object.keys(chosen).length < p.attributes.length) return null;
      return p.variants.filter(function (v) { return p.attributes.every(function (a) { return v.options[a.name] === chosen[a.name]; }); })[0] || null;
    }
    function inStock(v) { return !p.trackStock || (v ? v.stock > 0 : p.variants.length ? false : p.stock > 0); }
    function refresh() {
      // Grey out values with no stock given the other choices.
      p.attributes.forEach(function (a) {
        $$('[data-attr="' + cssEsc(a.name) + '"] .size', page).forEach(function (b) {
          var val = b.dataset.value;
          var ok = p.variants.some(function (v) {
            return v.options[a.name] === val && p.attributes.every(function (o) { return o.name === a.name || !chosen[o.name] || v.options[o.name] === chosen[o.name]; }) && inStock(v);
          });
          b.classList.toggle("is-out", !ok);
          b.setAttribute("aria-checked", chosen[a.name] === val ? "true" : "false");
          b.title = ok ? "" : "Out of stock";
        });
      });
      var v = selected(), price = priceOf(p, v);
      $("#pdPrice").textContent = taka(price);
      $("#pdSku").textContent = v ? v.sku : p.sku;
      $("#buyTotal").textContent = taka(price * qty);
      var st = $("#pdStock"), limit = S.settings.lowStock || 5;
      var stock = !p.trackStock ? null : v ? v.stock : p.variants.length ? p.stock : p.stock;
      if (stock === null) { st.textContent = "In stock"; st.className = "stock stock--ok"; }
      else if (stock <= 0) { st.textContent = v || !p.variants.length ? "Out of stock" : "Sold out"; st.className = "stock stock--out"; }
      else if (stock <= limit && (v || !p.variants.length)) { st.textContent = "Only " + stock + " left"; st.className = "stock stock--low"; }
      else { st.textContent = "In stock"; st.className = "stock stock--ok"; }
      var out = soldOut(p) || (v && !inStock(v));
      $("#addBag").disabled = $("#buyNow").disabled = !!out;
      $("#addBag").textContent = out ? "Out of stock" : "Add to bag";
    }
    $$(".size", page).forEach(function (b) {
      b.addEventListener("click", function () {
        var name = b.closest("[data-attr]").dataset.attr;
        if (b.classList.contains("is-out")) { toast(esc(name) + " " + esc(b.dataset.value) + " is out of stock" + (p.variants.length ? ". Try another." : ".")); }
        chosen[name] = b.dataset.value;
        var block = b.closest("[data-attr]");
        $("[data-attr-label]", block).textContent = b.dataset.value;
        block.classList.remove("is-missing");
        $(".pd__warn", block).hidden = true;
        refresh();
      });
    });
    $$(".qty button", page).forEach(function (b) {
      b.addEventListener("click", function () {
        qty = Math.max(1, Math.min(20, qty + parseInt(b.dataset.q, 10)));
        $("#qty").textContent = qty;
        refresh();
      });
    });
    function ready() {
      var missing = p.attributes.filter(function (a) { return !chosen[a.name]; });
      if (missing.length) {
        missing.forEach(function (a) {
          var block = $('[data-attr="' + cssEsc(a.name) + '"]', page);
          block.classList.remove("is-missing"); void block.offsetWidth; block.classList.add("is-missing");
          $(".pd__warn", block).hidden = false;
        });
        var first = $('[data-attr="' + cssEsc(missing[0].name) + '"]', page);
        first.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        toast("Please choose a " + esc(missing[0].name.toLowerCase()) + " first.", "warn");
        return null;
      }
      var v = selected();
      if (p.variants.length && !v) { toast("That combination isn't available.", "warn"); return null; }
      if (!inStock(v)) { toast("That one is out of stock.", "warn"); return null; }
      return { v: v };
    }
    $("#addBag").addEventListener("click", function () {
      var r = ready();
      if (!r) return;
      if (addToBag(p, r.v, qty)) openBag();
    });
    $("#buyNow").addEventListener("click", function () {
      var r = ready();
      if (!r) return;
      if (addToBag(p, r.v, qty, true)) location.hash = "#checkout";
    });
    var guide = $("[data-size-guide]", page);
    if (guide) guide.addEventListener("click", function () {
      openModal('<figure class="guide"><img src="' + esc(p.sizeGuide) + '" alt="Size guide for ' + esc(shortName(p)) + '"><figcaption class="mono">' + esc(shortName(p)) + " · size guide</figcaption></figure>", "Size guide");
    });
    var main = $(".pd__main");
    $$(".pd__thumb", page).forEach(function (t) {
      t.addEventListener("click", function () {
        $$(".pd__thumb", page).forEach(function (x) { x.classList.toggle("is-on", x === t); });
        var img = $("#pdMain");
        if (!img) {
          main.classList.remove("no-img");
          main.insertAdjacentHTML("afterbegin", '<img id="pdMain" data-guard alt="">');
          img = $("#pdMain");
        }
        img.src = t.dataset.src;
        guardImages(main);
        buildSlats(main);
      });
    });
    refresh();
    setTimeout(function () { buildSlats(main); }, 120);
  }
  var cssEsc = function (s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); };

  // ---------------------------------------------------------------------------
  // Content pages: about, contact and policies
  // ---------------------------------------------------------------------------
  var POLICIES = [["terms", "Terms & conditions"], ["privacy", "Privacy policy"], ["refund", "Return & refund policy"], ["delivery", "Delivery policy"]];
  function viewPolicy(key) {
    var d = S.pages[key];
    if (!d) return viewMissing();
    head('<a href="#home">Home</a> / <span data-c="title"></span>', '<span data-c="title"></span>', 'Last updated <span data-c="updated"></span>', key);
    page.innerHTML =
      '<section class="policy" data-page="' + key + '">' +
        '<aside class="policy__nav"><p class="mono">Policies</p><ul>' + POLICIES.map(function (x) {
          return '<li><a href="#' + x[0] + '"' + (x[0] === key ? ' aria-current="page"' : "") + ">" + esc(x[1]) + "</a></li>";
        }).join("") + '</ul><a class="pill pill--light pill--sm" href="#contact">Questions? Contact us</a></aside>' +
        '<article class="policy__body"><p class="policy__intro" data-c="intro"></p><div class="prose" data-md="body"></div></article>' +
      "</section>";
    bind(pagehead, d);
    bind(page, d);
  }

  function viewAbout() {
    var d = S.pages.about, st = S.settings.store || {};
    head('<span data-c="eyebrow"></span>', '<span data-c="title"></span> <em class="alt" data-scramble data-c="accent"></em> <span data-c="titleEnd"></span>', '<span data-c="intro"></span>', "about");
    var rows = [["Business name", st.legalName], ["Trade license", st.tradeLicense], ["TIN", st.tin], ["DBID", st.dbid], ["BIN", st.bin], ["Address", st.address], ["Phone", st.phone], ["Email", st.email]]
      .filter(function (r) { return r[1]; });
    page.innerHTML =
      '<section class="about" data-page="about">' +
        '<div class="about__story">' +
          '<figure class="collage__img reveal slat dark about__cut"><img data-ci="image" data-calt="imageAlt" alt="" loading="lazy"></figure>' +
          '<div class="about__text"><p class="eyebrow" data-c="storyTitle"></p><div class="prose prose--lead" data-md="story"></div></div>' +
        "</div>" +
        '<div class="about__pillars about__pillars--row">' + (d.values || []).map(function (v, i) {
          return '<div><p class="mono">0' + (i + 1) + '</p><h3 data-c="values.' + i + '.title"></h3><p data-c="values.' + i + '.text"></p></div>';
        }).join("") + "</div>" +
        '<div class="company panel"><div><h2 class="panel__title" data-c="companyTitle"></h2><p class="company__note" data-c="companyText"></p></div>' +
          '<dl class="company__list">' + rows.map(function (r) { return "<div><dt class=\"mono\">" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") + "</dl></div>" +
        '<p class="about__closing" data-c="closing"></p>' +
        '<div class="center"><a class="pill pill--dark pill--arrow" href="#shop">Shop the collection <span class="pill__arrow" aria-hidden="true">↗</span></a></div>' +
      "</section>";
    bind(pagehead, d);
    bind(page, d);
  }

  function viewContact() {
    var d = S.pages.contact, st = S.settings.store || {}, soc = S.settings.social || {};
    head('<span data-c="eyebrow"></span>', '<span data-c="title"></span> <em class="alt" data-scramble data-c="accent"></em>', '<span data-c="intro"></span>', "contact");
    var tel = (st.phone || "").replace(/[^\d+]/g, "");
    page.innerHTML =
      '<section class="contact" data-page="contact">' +
        '<div class="contact__info">' +
          (st.phone ? '<a class="contact__card" href="tel:' + esc(tel) + '"><span class="mono">Call</span><b>' + esc(st.phone) + "</b><small>" + esc(st.hours || "") + "</small></a>" : "") +
          (st.email ? '<a class="contact__card" href="mailto:' + esc(st.email) + '"><span class="mono">Email</span><b>' + esc(st.email) + "</b><small>We reply within one working day</small></a>" : "") +
          (S.settings.chat && S.settings.chat.enabled ? '<button class="contact__card" type="button" data-open-chat><span class="mono">Live chat</span><b>Chat with us</b><small>Fastest way to reach us</small></button>' : "") +
          (st.whatsapp ? '<a class="contact__card" href="https://wa.me/' + esc(st.whatsapp.replace(/[^\d]/g, "")) + '" target="_blank" rel="noopener"><span class="mono">WhatsApp</span><b>' + esc(st.whatsapp) + "</b><small>Message us any time</small></a>" : "") +
          (st.address ? '<div class="contact__card"><span class="mono">Visit</span><b>' + esc(st.address) + "</b><small>" + esc(st.legalName || "") + "</small></div>" : "") +
          '<div class="contact__card contact__social"><span class="mono">Follow</span>' + [["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]].filter(function (s) { return soc[s[0]]; })
            .map(function (s) { return '<a class="u" href="' + esc(soc[s[0]]) + '" target="_blank" rel="noopener">' + s[1] + "</a>"; }).join(" ") + "</div>" +
        "</div>" +
        '<form class="panel contact__form" id="contactForm" novalidate>' +
          '<h2 class="panel__title" data-c="formTitle"></h2><p class="contact__note" data-c="formNote"></p>' +
          field("ct-name", "Name", '<input id="ct-name" name="name" required autocomplete="name">') +
          '<div class="field-row">' + field("ct-email", "Email", '<input id="ct-email" name="email" type="email" autocomplete="email">') +
          field("ct-phone", "Phone", '<input id="ct-phone" name="phone" type="tel" autocomplete="tel" placeholder="01XXXXXXXXX">') + "</div>" +
          field("ct-subject", "Subject", '<input id="ct-subject" name="subject" placeholder="Order, sizing, collaboration…">') +
          field("ct-message", "Message", '<textarea id="ct-message" name="message" rows="5" required></textarea>') +
          '<button class="pill pill--dark" type="submit">Send message</button>' +
        "</form>" +
      "</section>";
    bind(pagehead, d);
    bind(page, d);
    $("#contactForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target, btn = $("button[type=submit]", f);
      clearErrors(f);
      btn.disabled = true;
      api("POST", "/api/contact", { name: f.name.value, email: f.email.value, phone: f.phone.value, subject: f.subject.value, message: f.message.value })
        .then(function () {
          f.innerHTML = '<h2 class="panel__title">Message sent</h2><p class="contact__note">Thanks, ' + esc(f.name.value.split(" ")[0]) + ". We'll get back to you within one working day.</p>";
        }, function (err) { showErrors(f, err); btn.disabled = false; });
    });
  }
  function field(id, label, input) { return '<label class="field" for="' + id + '"><span>' + label + "</span>" + input + '<em class="field__err" data-err-for="' + id + '" hidden></em></label>'; }
  function clearErrors(f) { $$(".field__err", f).forEach(function (e) { e.hidden = true; }); $$(".is-invalid", f).forEach(function (e) { e.classList.remove("is-invalid"); }); }
  function showErrors(f, err) {
    var fields = (err && err.fields) || {}, first = null;
    Object.keys(fields).forEach(function (k) {
      var input = f.querySelector('[name="' + k + '"]');
      var box = (input && f.querySelector('[data-err-for="' + input.id + '"]')) || f.querySelector('[data-err="' + k + '"]');
      if (input) input.classList.add("is-invalid");
      if (box) { box.textContent = fields[k]; box.hidden = false; }
      if (!first) first = input || box;
    });
    if (first && first.focus) first.focus();
    toast(esc((err && err.message) || "Something went wrong."), "warn");
  }

  // ---------------------------------------------------------------------------
  // Saved, track order, order confirmation
  // ---------------------------------------------------------------------------
  function viewSaved() {
    var list = S.products.filter(function (p) { return saved.indexOf(p.id) > -1; });
    head('<a href="#home">Home</a> / Saved', 'Saved <em class="alt" data-scramble>pieces</em>', list.length ? list.length + " saved on this device." : "Tap the heart on any piece to keep it here.");
    page.innerHTML = '<section class="shop">' + (list.length ? '<div class="grid">' + grid(list) + "</div>" :
      '<div class="empty"><p>Nothing saved yet.</p><a class="pill pill--dark pill--sm" href="#shop">Browse the shop</a></div>') + "</section>";
  }

  var STATUS = { pending: "Order placed", confirmed: "Confirmed", processing: "Packing", shipped: "On the way", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" };
  var STEPS = ["pending", "confirmed", "processing", "shipped", "delivered"];
  function orderHTML(o) {
    var at = STEPS.indexOf(o.status);
    return '<div class="order panel">' +
      '<div class="order__head"><div><p class="mono">Order ' + esc(o.number) + " · " + new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + "</p>" +
        '<h2 class="h2 order__status">' + esc(STATUS[o.status] || o.status) + "</h2></div>" +
        '<span class="chip ' + (o.paymentStatus === "paid" ? "chip--paid" : "chip--muted") + '">' + (o.paymentStatus === "paid" ? "Paid" : o.paymentMethod === "cod" ? "Cash on delivery" : "Payment " + esc(o.paymentStatus)) + "</span></div>" +
      (at > -1 ? '<ol class="steps">' + STEPS.map(function (s, i) { return '<li class="' + (i <= at ? "is-done" : "") + '">' + STATUS[s] + "</li>"; }).join("") + "</ol>" : "") +
      (o.tracking ? '<p class="order__track">Courier tracking: <b>' + esc(o.tracking) + "</b></p>" : "") +
      '<div class="order__items">' + o.items.map(function (it) {
        return '<div class="line-item"><span class="line-item__img" data-fallback style="--tone:#7b7e83">' + (it.image ? '<img data-guard src="' + esc(it.image) + '" alt="">' : "") + '<span class="card__type" aria-hidden="true"><small>' + it.qty + "×</small></span></span>" +
          '<div class="line-item__info"><span class="line-item__name">' + esc(it.name) + '</span><p class="mono">' + esc(optText(it.options)) + " · Qty " + it.qty + " · SKU " + esc(it.sku) + '</p></div><div class="line-item__end"><b>' + taka(it.lineTotal) + "</b></div></div>";
      }).join("") + "</div>" +
      '<dl class="totals"><div><dt>Subtotal</dt><dd>' + taka(o.subtotal) + "</dd></div>" +
        (o.discount ? "<div><dt>Discount" + (o.coupon ? " (" + esc(o.coupon) + ")" : "") + "</dt><dd>−" + taka(o.discount) + "</dd></div>" : "") +
        "<div><dt>Delivery" + (o.shippingZone ? " · " + esc(o.shippingZone.name) : "") + "</dt><dd>" + (o.shipping ? taka(o.shipping) : "Free") + "</dd></div>" +
        '<div class="totals__grand"><dt>Total</dt><dd>' + taka(o.total) + "</dd></div></dl>" +
      '<p class="order__addr"><span class="mono">Deliver to</span>' + esc(o.customer.name) + " · " + esc(o.customer.phone) + "<br>" + esc(o.customer.address) + (o.customer.city ? ", " + esc(o.customer.city) : "") + "</p>" +
    "</div>";
  }
  function myOrders() { return store.get("orders", []); }
  function rememberOrder(o) {
    var list = myOrders().filter(function (x) { return x.number !== o.number; });
    list.unshift(o);
    store.set("orders", list.slice(0, 10));
  }
  function viewOrder(number, query) {
    var o = myOrders().filter(function (x) { return x.number === number; })[0];
    var payment = /payment=(\w+)/.exec(query || "");
    if (!o) return viewTrack(number);
    var name = o.customer.name.split(" ")[0];
    var failed = payment && payment[1] !== "paid";
    head('<a href="#home">Home</a> / Order', failed ? 'Payment <em class="alt" data-scramble>failed</em>' : 'Thank <em class="alt" data-scramble>you!</em>',
      failed ? "The online payment didn't go through. We'll call you to confirm the order and arrange payment." : esc(name) + ", your order " + esc(o.number) + " is in. We'll call or message you to confirm it.");
    page.innerHTML = '<section class="done">' + orderHTML(o) +
      '<div class="done__actions"><a class="pill pill--dark" href="#shop">Keep shopping</a><a class="pill pill--light" href="#track">Track an order</a></div></section>';
    if (payment) refreshOrder(o);
  }
  function refreshOrder(o) {
    api("POST", "/api/orders/track", { number: o.number, phone: o.phone || "" }).then(function (r) {
      var fresh = r.order; fresh.phone = o.phone; rememberOrder(fresh);
      if (location.hash.indexOf(o.number) > -1) route();
    }, function () {});
  }
  function viewTrack(prefill) {
    head('<a href="#home">Home</a> / Track order', 'Track your <em class="alt" data-scramble>order</em>', "Enter your order number and the phone number you ordered with.");
    var mine = myOrders();
    page.innerHTML =
      '<section class="track">' +
        '<form class="panel track__form" id="trackForm" novalidate>' +
          '<div class="field-row">' + field("tr-number", "Order number", '<input id="tr-number" name="number" required placeholder="RV1001" value="' + esc(prefill || "") + '">') +
          field("tr-phone", "Phone", '<input id="tr-phone" name="phone" type="tel" required placeholder="01XXXXXXXXX" autocomplete="tel">') + "</div>" +
          '<button class="pill pill--dark" type="submit">Track order</button></form>' +
        '<div id="trackResult"></div>' +
        (mine.length ? '<div class="track__mine"><p class="eyebrow">Ordered on this device</p><ul>' + mine.map(function (o) {
          return '<li><a href="#order/' + esc(o.number) + '"><b>' + esc(o.number) + "</b><span>" + new Date(o.createdAt).toLocaleDateString("en-GB") + " · " + taka(o.total) + '</span><span class="mono">' + esc(STATUS[o.status] || o.status) + "</span></a></li>";
        }).join("") + "</ul></div>" : "") +
      "</section>";
    $("#trackForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = e.target;
      clearErrors(f);
      api("POST", "/api/orders/track", { number: f.number.value, phone: f.phone.value }).then(function (r) {
        $("#trackResult").innerHTML = orderHTML(r.order);
        guardImages($("#trackResult"));
      }, function (err) {
        $("#trackResult").innerHTML = '<div class="empty"><p>' + esc(err.message) + "</p></div>";
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Checkout
  // ---------------------------------------------------------------------------
  var checkoutState = { zone: null, coupon: null };
  function quote() {
    var sub = 0, saving = 0, lines = [];
    cart.forEach(function (l) {
      var p = BY_ID[l.productId], v = variantOf(p, l.variantId), price = priceOf(p, v);
      sub += price * l.qty;
      if (p.comparePrice > price) saving += (p.comparePrice - price) * l.qty;
      lines.push({ l: l, p: p, v: v, price: price });
    });
    var c = checkoutState.coupon, discount = 0, free = false;
    if (c) { discount = c.type === "free" ? 0 : Math.min(sub, c.discount); free = c.freeShipping; }
    var ship = S.settings.shipping || { zones: [] };
    var z = ship.zones.filter(function (x) { return x.id === checkoutState.zone; })[0];
    var fee = z ? z.fee : null;
    if (fee !== null && (free || (ship.freeOver && sub - discount >= ship.freeOver))) fee = 0;
    return { lines: lines, subtotal: sub, saving: saving, discount: discount, shipping: fee, total: sub - discount + (fee || 0), zone: z };
  }
  function viewCheckout() {
    head('<a href="#home">Home</a> / Checkout', '<em class="alt" data-scramble>Checkout</em>', "Cash on delivery or pay online. We'll call to confirm your order.");
    if (!cart.length) {
      page.innerHTML = '<section class="shop"><div class="empty"><p>Your bag is empty.</p><a class="pill pill--dark pill--sm" href="#shop">Shop the collection</a></div></section>';
      return;
    }
    var ship = S.settings.shipping || { zones: [] }, pay = S.settings.payments || {};
    if (!checkoutState.zone && ship.zones[0]) checkoutState.zone = ship.zones[0].id;
    var saved = store.get("customer", {});
    page.innerHTML =
      '<section class="checkout">' +
        '<form class="checkout__form" id="checkoutForm" novalidate>' +
          '<fieldset class="panel"><legend class="panel__title">Contact</legend>' +
            field("co-name", "Full name", '<input id="co-name" name="name" required autocomplete="name" value="' + esc(saved.name || "") + '">') +
            '<div class="field-row">' + field("co-phone", "Mobile number", '<input id="co-phone" name="phone" type="tel" required autocomplete="tel" inputmode="numeric" placeholder="01XXXXXXXXX" value="' + esc(saved.phone || "") + '">') +
            field("co-email", "Email (optional)", '<input id="co-email" name="email" type="email" autocomplete="email" value="' + esc(saved.email || "") + '">') + "</div></fieldset>" +
          '<fieldset class="panel"><legend class="panel__title">Delivery</legend>' +
            field("co-address", "Full address", '<textarea id="co-address" name="address" required rows="2" autocomplete="street-address" placeholder="House, road, area">' + esc(saved.address || "") + "</textarea>") +
            field("co-city", "District / city", '<input id="co-city" name="city" autocomplete="address-level2" placeholder="Dhaka" value="' + esc(saved.city || "") + '">') +
            '<div class="zones" role="radiogroup" aria-label="Delivery area">' + ship.zones.map(function (z) {
              return '<label class="radio"><input type="radio" name="zone" value="' + esc(z.id) + '"' + (z.id === checkoutState.zone ? " checked" : "") + "><span><b>" + esc(z.name) + " · " + taka(z.fee) + "</b>Delivery in " + esc(z.days) + "</span></label>";
            }).join("") + "</div>" +
            (ship.freeOver ? '<p class="checkout__hint mono">Free delivery on orders over ' + taka(ship.freeOver) + "</p>" : "") +
            field("co-note", "Order note (optional)", '<input id="co-note" name="note" placeholder="Best time to call, landmark…">') + "</fieldset>" +
          '<fieldset class="panel"><legend class="panel__title">Payment</legend>' +
            (pay.cod ? '<label class="radio"><input type="radio" name="pay" value="cod" checked><span><b>Cash on delivery</b>Pay the rider when your order arrives.</span></label>' : "") +
            (pay.sslcommerz ? '<label class="radio"><input type="radio" name="pay" value="sslcommerz"' + (pay.cod ? "" : " checked") + '><span><b>Pay online</b>Card, bKash, Nagad, Rocket or internet banking, secured by SSLCOMMERZ.</span></label>' +
              '<div class="ssl-row"><img src="https://securepay.sslcommerz.com/public/image/SSLCommerz-Pay-With-logo-All-Size-03.png" alt="Pay with SSLCOMMERZ: cards, mobile banking and internet banking" loading="lazy" onerror="this.parentNode.classList.add(\'no-img\');this.remove()"><span class="ssl-row__fallback mono">Secured by SSLCOMMERZ</span></div>' : "") +
            '<em class="field__err" data-err="payment" hidden></em></fieldset>' +
          '<label class="agree"><input type="checkbox" name="agree" id="co-agree" required><span>I have read and agree to the website\'s <a href="#terms" data-policy="terms">Terms &amp; conditions</a>, <a href="#privacy" data-policy="privacy">Privacy policy</a> and <a href="#refund" data-policy="refund">Return &amp; refund policy</a>.</span></label>' +
          '<em class="field__err" data-err="agree" hidden></em>' +
          '<button class="pill pill--dark checkout__submit" type="submit" id="placeOrder">Place order · <span data-total></span></button>' +
          '<p class="checkout__note mono">' + (window.Ravelle.mode === "demo" ? "Demo store: orders are saved in this browser and shown in the admin panel." : "We'll confirm by phone before we ship.") + "</p>" +
        "</form>" +
        '<aside class="summary panel"><h2 class="panel__title">Order summary</h2><div id="summaryLines"></div>' +
          '<form class="coupon" id="couponForm"><label class="sr" for="co-coupon">Coupon code</label><input id="co-coupon" placeholder="Coupon code" autocomplete="off" value="' + esc(checkoutState.coupon ? checkoutState.coupon.code : "") + '">' +
            '<button class="pill pill--light pill--sm" type="submit">' + (checkoutState.coupon ? "Remove" : "Apply") + '</button></form><p class="coupon__msg mono" id="couponMsg"></p>' +
          '<dl class="totals" id="totals"></dl>' +
        "</aside>" +
      "</section>";
    drawSummary();
    var form = $("#checkoutForm");
    $$('input[name="zone"]', form).forEach(function (r) { r.addEventListener("change", function () { checkoutState.zone = r.value; drawSummary(); }); });
    $("#couponForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#co-coupon"), btn = $("#couponForm button"), msg = $("#couponMsg");
      if (checkoutState.coupon) {
        checkoutState.coupon = null; input.value = ""; btn.textContent = "Apply"; msg.textContent = ""; drawSummary(); return;
      }
      if (!input.value.trim()) return;
      btn.disabled = true;
      api("POST", "/api/coupons/validate", { code: input.value, subtotal: quote().subtotal }).then(function (r) {
        checkoutState.coupon = r;
        btn.textContent = "Remove";
        msg.textContent = r.code + " applied · " + r.label;
        msg.className = "coupon__msg mono is-ok";
        drawSummary();
      }, function (err) {
        msg.textContent = err.message;
        msg.className = "coupon__msg mono is-bad";
      }).then(function () { btn.disabled = false; });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErrors(form);
      var payInput = $('input[name="pay"]:checked', form);
      var body = {
        customer: { name: form.name.value, phone: form.phone.value, email: form.email.value, address: form.address.value, city: form.city.value },
        items: cart.map(function (l) { return { productId: l.productId, variantId: l.variantId, qty: l.qty }; }),
        zone: checkoutState.zone, couponCode: checkoutState.coupon ? checkoutState.coupon.code : "",
        paymentMethod: payInput ? payInput.value : "", agree: form.agree.checked, note: form.note.value
      };
      var errs = {};
      if (!body.customer.name.trim()) errs.name = "Enter your name.";
      if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(body.customer.phone.replace(/[\s-]/g, ""))) errs.phone = "Enter a Bangladeshi mobile number, like 01712345678.";
      if (body.customer.address.trim().length < 6) errs.address = "Enter your full delivery address.";
      if (!body.agree) errs.agree = "Please accept the terms and conditions, privacy policy and refund policy.";
      if (Object.keys(errs).length) return showErrors(form, { message: "Please check the highlighted fields.", fields: errs });
      var btn = $("#placeOrder");
      btn.disabled = true;
      btn.firstChild.textContent = "Placing order… ";
      store.set("customer", body.customer);
      api("POST", "/api/orders", body).then(function (r) {
        var o = r.order;
        o.phone = body.customer.phone;
        rememberOrder(o);
        cart = []; store.set("cart", cart); checkoutState.coupon = null; syncCount(); drawBag();
        if (r.payment && r.payment.url) { location.href = r.payment.url; return; }
        if (r.payment && r.payment.error) toast("Online payment couldn't start: " + esc(r.payment.error) + " We'll call you about payment.", "warn");
        location.hash = "#order/" + o.number + (r.payment && r.payment.demo ? "?payment=paid" : "");
      }, function (err) {
        btn.disabled = false;
        btn.firstChild.textContent = "Place order · ";
        if (err.status === 409) { reloadStore(); }
        showErrors(form, err);
      });
    });
  }
  function drawSummary() {
    var box = $("#summaryLines");
    if (!box) return;
    if (!cart.length) { if (location.hash === "#checkout") viewCheckout(); return; }
    box.innerHTML = cart.map(lineHTML).join("");
    guardImages(box);
    var q = quote();
    $("#totals").innerHTML =
      "<div><dt>Subtotal</dt><dd>" + taka(q.subtotal) + "</dd></div>" +
      (q.saving ? "<div><dt>You save on sale prices</dt><dd>" + taka(q.saving) + "</dd></div>" : "") +
      (q.discount ? "<div><dt>Coupon " + esc(checkoutState.coupon.code) + "</dt><dd>−" + taka(q.discount) + "</dd></div>" : "") +
      "<div><dt>Delivery" + (q.zone ? " · " + esc(q.zone.name) : "") + "</dt><dd>" + (q.shipping === null ? "Choose an area" : q.shipping ? taka(q.shipping) : "Free") + "</dd></div>" +
      '<div class="totals__grand"><dt>Total</dt><dd>' + taka(q.total) + "</dd></div>";
    $$("[data-total]").forEach(function (el) { el.textContent = taka(q.total); });
  }

  function viewMissing() {
    head("404", 'Page <em class="alt" data-scramble>missing</em>', "That link doesn't go anywhere.");
    page.innerHTML = '<section class="shop"><div class="empty"><a class="pill pill--dark pill--sm" href="#home">Back to home</a></div></section>';
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  var HOME_ANCHORS = { house: 1, arrivals: 1, lookbook: 1, top: 1 };
  var LEGACY = { "men": "category/men", "women": "category/women", "t-shirt": "category/t-shirt", "the-house": "category/the-house", "account": "track" };
  function route() {
    var raw = location.hash.replace(/^#/, ""), h = decodeURIComponent(raw.split("?")[0]), query = raw.split("?")[1] || "";
    if (LEGACY[h]) h = LEGACY[h];
    if (h.indexOf("p-") === 0) h = "product/" + h.slice(2);
    if (h.indexOf("c-") === 0) h = "category/" + h.slice(2);
    if (h.indexOf("soon-") === 0) h = "category/" + h.slice(5);
    closeBag(); closeMenu(); closeModal();
    if (!h || h === "home" || HOME_ANCHORS[h]) {
      pageView.hidden = true;
      homeView.hidden = false;
      document.title = (S.settings.seo && S.settings.seo.title) || "Ravelle";
      var target = HOME_ANCHORS[h] && h !== "top" ? document.getElementById(h) : null;
      if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
      onScroll();
      return;
    }
    homeView.hidden = true;
    pageView.hidden = false;
    var parts = h.split("/");
    if (SHOPS[h]) viewListing(SHOPS[h]());
    else if (parts[0] === "product") viewProduct(parts[1]);
    else if (parts[0] === "category") viewCategory(parts[1]);
    else if (parts[0] === "search") viewSearch(parts.slice(1).join("/"));
    else if (parts[0] === "order") viewOrder(parts[1], query);
    else if (h === "checkout") viewCheckout();
    else if (h === "track") viewTrack();
    else if (h === "saved") viewSaved();
    else if (h === "about") viewAbout();
    else if (h === "contact") viewContact();
    else if (S.pages[h] && POLICIES.some(function (x) { return x[0] === h; })) viewPolicy(h);
    else viewMissing();
    var t = $("h1", pagehead) || $("h1", page);
    document.title = (t ? t.textContent.replace(/\s+/g, " ").trim() + " · " : "") + ((S.settings.store && S.settings.store.name) || "Ravelle");
    activate(pagehead);
    activate(page);
    window.scrollTo(0, 0);
    onScroll();
  }
  window.addEventListener("hashchange", route);

  // ---------------------------------------------------------------------------
  // Bag
  // ---------------------------------------------------------------------------
  function saveCart() { store.set("cart", cart); syncBag(); }
  function totals() {
    return cart.reduce(function (t, l) {
      var p = BY_ID[l.productId], v = variantOf(p, l.variantId), price = priceOf(p, v);
      t.total += price * l.qty; t.saving += Math.max(0, (p.comparePrice || 0) - price) * l.qty; t.count += l.qty;
      return t;
    }, { total: 0, saving: 0, count: 0 });
  }
  function maxQty(p, v) { return p.trackStock ? Math.min(20, v ? v.stock : p.stock) : 20; }
  function addToBag(p, v, qty, quiet) {
    var line = cart.filter(function (l) { return l.productId === p.id && l.variantId === (v ? v.id : null); })[0];
    var have = line ? line.qty : 0, max = maxQty(p, v);
    if (have + qty > max) {
      if (have >= max) { toast("You already have all " + max + " in your bag.", "warn"); return quiet ? true : false; }
      qty = max - have;
      toast("Only " + max + " available, so we added " + qty + ".", "warn");
    }
    if (line) line.qty += qty; else cart.push({ productId: p.id, variantId: v ? v.id : null, qty: qty });
    saveCart();
    track("cart", p.id);
    if (!quiet) toast("Added to bag · " + esc(shortName(p)) + (v ? " · " + esc(optText(v.options)) : ""));
    return true;
  }
  function lineHTML(l, i) {
    var p = BY_ID[l.productId], v = variantOf(p, l.variantId), price = priceOf(p, v);
    return '<div class="line-item" data-i="' + i + '">' +
      '<a class="line-item__img" href="#product/' + p.slug + '" data-fallback style="--tone:' + esc(p.hex || "#7b7e83") + '">' + (p.images[0] ? '<img data-guard src="' + esc(p.images[0]) + '" alt="">' : "") + '<span class="card__type" aria-hidden="true"><small>' + esc(p.line) + "</small></span></a>" +
      '<div class="line-item__info"><a class="line-item__name" href="#product/' + p.slug + '">' + esc(shortName(p)) + "</a>" +
        '<p class="mono">' + esc([p.color, v ? optText(v.options) : ""].filter(Boolean).join(" · ")) + "</p>" +
        '<div class="qty qty--sm"><button type="button" data-line-q="-1" aria-label="Fewer">−</button><span>' + l.qty + '</span><button type="button" data-line-q="1" aria-label="More">+</button></div></div>' +
      '<div class="line-item__end"><b>' + taka(price * l.qty) + '</b><button class="line-item__rm" type="button" data-line-rm>Remove</button></div>' +
    "</div>";
  }
  function drawBag() {
    var items = $("#bagItems"), foot = $("#bagFoot");
    if (!cart.length) {
      items.innerHTML = '<div class="empty empty--bag"><p>Your bag is empty.</p><a class="pill pill--dark pill--sm" href="#shop">Shop the collection</a></div>';
      foot.innerHTML = "";
      return;
    }
    items.innerHTML = cart.map(lineHTML).join("");
    guardImages(items);
    var t = totals(), ship = S.settings.shipping || {};
    foot.innerHTML =
      '<dl class="totals"><div><dt>Subtotal</dt><dd>' + taka(t.total) + "</dd></div>" + (t.saving ? "<div><dt>You save</dt><dd>" + taka(t.saving) + "</dd></div>" : "") + "</dl>" +
      (ship.freeOver ? '<p class="mono drawer__note">' + (t.total >= ship.freeOver ? "You get free delivery" : "Add " + taka(ship.freeOver - t.total) + " for free delivery") + "</p>" : "") +
      '<a class="pill pill--dark drawer__cta" href="#checkout">Checkout · ' + taka(t.total) + "</a>" +
      '<p class="mono drawer__note">Delivery charge and coupons at checkout</p>';
  }
  function syncCount() {
    var n = totals().count;
    $$("[data-bag-count]").forEach(function (el) { el.textContent = n; el.hidden = !n; });
    $$("[data-bag-count-text]").forEach(function (el) { el.textContent = "(" + n + ")"; });
  }
  function syncBag() { syncCount(); drawBag(); drawSummary(); }

  // Panels: bag, menu, search and modal share one scrim.
  var panelOpen = null;
  function openPanel(el) {
    if (panelOpen && panelOpen !== el) hidePanel(panelOpen);
    panelOpen = el;
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
    $(".scrim").hidden = false;
    document.body.classList.add("is-locked");
    var f = $("input, button, a", el);
    if (f) setTimeout(function () { f.focus({ preventScroll: true }); }, 50);
  }
  function hidePanel(el) {
    el.classList.remove("is-open");
    el.setAttribute("aria-hidden", "true");
  }
  function closePanels() {
    $$(".drawer, .modal").forEach(hidePanel);
    panelOpen = null;
    $(".scrim").hidden = true;
    document.body.classList.remove("is-locked");
  }
  function openBag() { drawBag(); openPanel($("#bag")); }
  function closeBag() { if (panelOpen === $("#bag")) closePanels(); }
  function openMenu() { openPanel($("#menu")); }
  function closeMenu() { if (panelOpen === $("#menu")) closePanels(); }
  function openModal(html, title) {
    $("#modalTitle").textContent = title || "";
    $("#modalBody").innerHTML = html;
    openPanel($("#modal"));
  }
  function closeModal() { if (panelOpen === $("#modal")) closePanels(); }
  function openSearch() {
    openPanel($("#search"));
    $("#searchInput").value = "";
    drawSearch("");
    setTimeout(function () { $("#searchInput").focus(); }, 60);
  }
  function drawSearch(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var list = words.length ? S.products.filter(function (p) {
      var hay = (p.name + " " + p.line + " " + p.color + " " + p.sku).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    }).slice(0, 6) : S.products.filter(function (p) { return p.featured; }).slice(0, 4);
    $("#searchResults").innerHTML = (words.length ? "" : '<p class="mono search__hint">Popular now</p>') + (list.length ? list.map(function (p) {
      return '<a class="search__item" href="#product/' + p.slug + '"><span class="search__img" style="--tone:' + esc(p.hex) + '" data-fallback>' + (p.images[0] ? '<img data-guard src="' + esc(p.images[0]) + '" alt="">' : "") + "</span>" +
        "<span><b>" + esc(shortName(p)) + '</b><span class="mono">' + esc(p.color) + " · " + taka(p.price) + "</span></span></a>";
    }).join("") : '<p class="search__none">No products match “' + esc(q) + '”.</p>') +
      (words.length ? '<a class="pill pill--light pill--sm search__all" href="#search/' + encodeURIComponent(q) + '">See all results</a>' : "");
    guardImages($("#searchResults"));
  }
  $("#searchInput").addEventListener("input", function (e) { drawSearch(e.target.value); });
  $("#searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = $("#searchInput").value.trim();
    if (q) location.hash = "#search/" + encodeURIComponent(q);
  });

  // ---------------------------------------------------------------------------
  // Chat widget
  // ---------------------------------------------------------------------------
  var chat = { open: false, session: store.get("chat", null), messages: [], last: 0, timer: null, unread: 0 };
  function chatEnabled() { return S.settings.chat && S.settings.chat.enabled && !EDIT; }
  function drawChat() {
    var box = $("#chatMessages");
    var greet = (S.settings.chat || {}).greeting;
    var list = chat.messages.length ? chat.messages : greet ? [{ from: "bot", text: greet, at: Date.now() }] : [];
    box.innerHTML = list.map(function (m) {
      return '<div class="msg msg--' + (m.from === "customer" ? "me" : "them") + '"><p>' + br(m.text) + '</p><span class="mono">' +
        (m.from === "customer" ? "You" : esc(m.author || (S.settings.chat || {}).title || "Ravelle")) + " · " + new Date(m.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "</span></div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
    $("#chatIntro").hidden = !!chat.session;
    var badge = $("#chatBadge");
    badge.hidden = !chat.unread || chat.open;
    badge.textContent = chat.unread;
  }
  function pollChat() {
    clearTimeout(chat.timer);
    if (!chat.session) return;
    api("GET", "/api/chat/" + chat.session.id + "?token=" + encodeURIComponent(chat.session.token) + "&since=" + chat.last).then(function (r) {
      if (r.messages.length) {
        var fresh = r.messages.filter(function (m) { return !chat.messages.some(function (x) { return x.id === m.id; }); });
        chat.messages = chat.messages.concat(fresh);
        chat.last = chat.messages[chat.messages.length - 1].at;
        if (!chat.open) chat.unread += fresh.filter(function (m) { return m.from !== "customer"; }).length;
        drawChat();
      }
    }, function (err) {
      if (err.status === 404) { chat.session = null; store.set("chat", null); chat.messages = []; drawChat(); }
    }).then(function () {
      chat.timer = setTimeout(pollChat, chat.open ? 3500 : 20000);
    });
  }
  function sendChat(text) {
    var go = function () {
      var msg = { id: "tmp" + Date.now(), from: "customer", text: text, at: Date.now() };
      chat.messages.push(msg); drawChat();
      return api("POST", "/api/chat/" + chat.session.id + "/messages", { token: chat.session.token, text: text, since: chat.last, name: $("#chatName").value }).then(function (r) {
        chat.messages = chat.messages.filter(function (m) { return m !== msg; });
        r.messages.forEach(function (m) { if (!chat.messages.some(function (x) { return x.id === m.id; })) chat.messages.push(m); });
        chat.messages.sort(function (a, b) { return a.at - b.at; });
        chat.last = chat.messages[chat.messages.length - 1].at;
        drawChat();
        pollChat();
      });
    };
    var start = chat.session ? Promise.resolve() : api("POST", "/api/chat/start", { name: $("#chatName").value, page: location.hash }).then(function (r) {
      chat.session = { id: r.id, token: r.token };
      store.set("chat", chat.session);
      chat.messages = r.messages;
      chat.last = r.messages.length ? r.messages[r.messages.length - 1].at : 0;
    });
    return start.then(go).catch(function (err) { toast(esc(err.message || "Chat isn't available right now."), "warn"); });
  }
  function toggleChat(force) {
    chat.open = force === undefined ? !chat.open : force;
    $("#chat").classList.toggle("is-open", chat.open);
    $("#chatPanel").setAttribute("aria-hidden", chat.open ? "false" : "true");
    if (chat.open) { chat.unread = 0; drawChat(); setTimeout(function () { $("#chatText").focus(); }, 60); pollChat(); }
    drawChat();
  }
  $("#chatForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("#chatText"), text = t.value.trim();
    if (!text) return;
    t.value = "";
    sendChat(text);
  });
  $("#chatText").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
  });

  // ---------------------------------------------------------------------------
  // Analytics: one visit per browser per day, product views and add-to-bags
  // ---------------------------------------------------------------------------
  var sid = store.get("sid", null);
  if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("sid", sid); }
  function track(type, productId) {
    if (EDIT) return;
    api("POST", "/api/track", { type: type, productId: productId || "", sid: sid }).catch(function () {});
  }

  // ---------------------------------------------------------------------------
  // Delegated clicks and forms
  // ---------------------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (EDIT && t.closest("a") && !t.closest("[data-allow]")) { e.preventDefault(); }
    var save = t.closest("[data-save]");
    if (save) {
      e.preventDefault();
      var id = save.dataset.save, at = saved.indexOf(id);
      if (at > -1) saved.splice(at, 1); else saved.push(id);
      store.set("saved", saved);
      $$('[data-save="' + id + '"]').forEach(function (b) { b.setAttribute("aria-pressed", at > -1 ? "false" : "true"); });
      toast(at > -1 ? "Removed from saved" : 'Saved · <a href="#saved">View saved</a>');
      return;
    }
    var pol = t.closest("[data-policy]");
    if (pol) {
      e.preventDefault();
      var d = S.pages[pol.dataset.policy];
      openModal('<div class="prose prose--modal"><p class="policy__intro">' + esc(d.intro) + "</p>" + md(d.body) + "</div>", d.title);
      return;
    }
    if (t.closest("[data-open-bag]")) { openBag(); return; }
    if (t.closest("[data-open-menu]")) { openMenu(); return; }
    if (t.closest("[data-open-search]")) { openSearch(); return; }
    if (t.closest("[data-open-chat]")) { toggleChat(true); return; }
    if (t.closest("[data-chat-toggle]")) { toggleChat(); return; }
    if (t.closest("[data-close]") || t.closest(".scrim")) { closePanels(); return; }
    if (t.closest("[data-cookies-ok]")) { store.set("cookies", 1); $("#cookies").hidden = true; return; }
    if (t.closest("#menu a, #search a")) { closePanels(); }
    var row = t.closest(".line-item[data-i]");
    if (row) {
      var i = parseInt(row.dataset.i, 10), l = cart[i];
      var q = t.closest("[data-line-q]");
      if (q && l) {
        var p = BY_ID[l.productId], max = maxQty(p, variantOf(p, l.variantId));
        var next = l.qty + parseInt(q.dataset.lineQ, 10);
        if (next > max) toast("Only " + max + " available.", "warn");
        l.qty = Math.max(1, Math.min(max, next));
        saveCart();
      }
      if (t.closest("[data-line-rm]")) { cart.splice(i, 1); saveCart(); }
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closePanels(); if (chat.open) toggleChat(false); }
    if (e.key === "/" && !/input|textarea|select/i.test((document.activeElement || {}).tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.matches("[data-notify], #news")) {
      e.preventDefault();
      var email = $("input[type=email]", f).value;
      var topic = f.dataset.notify || "new drops";
      api("POST", "/api/contact", { name: "Drop alert", email: email, subject: "Drop alert: " + topic, message: "Please email me when " + topic + " is available." }).catch(function () {});
      f.hidden = true;
      var ok = f.id === "news" ? $("#newsOk") : f.nextElementSibling;
      if (ok) ok.hidden = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Visual editing inside the admin panel (index.html?edit)
  // ---------------------------------------------------------------------------
  function editable(root) {
    $$("[data-c]", root).forEach(function (el) {
      if (el.closest("#footerCols, .nav")) return;
      if (el.isContentEditable) return;
      try { el.contentEditable = "plaintext-only"; } catch (err) { el.contentEditable = "true"; }
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.classList.add("is-editable");
      el.spellcheck = true;
    });
    $$("[data-ci], [data-md], [data-lines], [data-marquee]", root).forEach(function (el) { el.classList.add("is-pickable"); });
  }
  // The typed text with line breaks, ignoring CSS like text-transform.
  function plainText(el) {
    var out = "";
    (function walk(n) {
      Array.prototype.forEach.call(n.childNodes, function (c) {
        if (c.nodeType === 3) out += c.data;
        else if (c.nodeName === "BR") out += "\n";
        else { if (/^(DIV|P)$/.test(c.nodeName) && out && !/\n$/.test(out)) out += "\n"; walk(c); }
      });
    })(el);
    return out.replace(/\n$/, "");
  }
  function pageKeyOf(el) { var p = el.closest("[data-page]"); return p ? p.dataset.page : null; }
  if (EDIT) {
    document.documentElement.classList.add("is-edit");
    document.addEventListener("input", function (e) {
      var el = e.target.closest && e.target.closest("[data-c]");
      if (!el) return;
      var key = pageKeyOf(el);
      parent.postMessage({ type: "ravelle:edit", key: key, path: el.dataset.c, value: plainText(el) }, "*");
    });
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-ci], [data-md], [data-lines], [data-marquee], [data-c]");
      if (!el) return;
      var key = pageKeyOf(el);
      var path = el.dataset.ci || el.dataset.md || el.dataset.lines || el.dataset.marquee || el.dataset.c;
      var kind = el.dataset.ci ? "image" : "field";
      parent.postMessage({ type: "ravelle:focus", key: key, path: path, kind: kind }, "*");
    }, true);
    window.addEventListener("message", function (e) {
      var m = e.data || {};
      if (m.type === "ravelle:page" && m.key && m.page) {
        S.pages[m.key] = m.page;
        if (m.key === "home") { bind(homeView, m.page); bind($("#footer"), m.page); drawLook(current); editable(homeView); }
        else {
          var root = document.querySelectorAll('[data-page="' + m.key + '"]');
          if (root.length) Array.prototype.forEach.call(root, function (r) { bind(r, m.page); editable(r); });
        }
        if (m.focus) flash(m.focus);
      } else if (m.type === "ravelle:goto") {
        if (location.hash !== m.hash) location.hash = m.hash; else route();
      } else if (m.type === "ravelle:reload") {
        reloadStore();
      }
    });
  }
  function flash(path) {
    var el = $('[data-c="' + path + '"], [data-ci="' + path + '"], [data-md="' + path + '"], [data-lines="' + path + '"], [data-marquee="' + path + '"]');
    if (!el || el.closest("[hidden]")) return;
    var r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: "center" });
    el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash");
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  function reloadStore() {
    return api("GET", "/api/store").then(function (data) {
      S = data;
      index();
      drawChrome();
      drawHome();
      syncBag();
    });
  }
  window.Ravelle.ready.then(reloadStore).then(function () {
    document.documentElement.classList.add("is-ready");
    var heroWord = $(".hero [data-scramble]");
    var intro = document.documentElement.classList.contains("js-intro");
    if (heroWord && intro && io) setTimeout(function () { scramble(heroWord); }, 2350);
    setTimeout(function () { document.documentElement.classList.remove("js-intro"); }, 3600);
    activate(homeView, intro ? heroWord : null);
    activate($("#footer"));
    route();
    if (chatEnabled()) {
      $("#chat").hidden = false;
      $("#chatTitle").textContent = (S.settings.chat && S.settings.chat.title) || "Ravelle";
      if (chat.session) pollChat();
      drawChat();
    }
    if (!store.get("cookies", 0) && !EDIT) $("#cookies").hidden = false;
    if (window.Ravelle.mode === "demo" && !EDIT) $("#demoBar").hidden = false;
    track("visit");
  }, function (err) {
    console.error(err);
    toast("The store couldn't load. Refresh to try again.", "warn");
  });
})();
