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
    bag: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Z M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 20c.9-3.6 3.7-5.6 7.2-5.6s6.3 2 7.2 5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M3 15 15 3l6 6L9 21l-6-6Z M7 11l2 2M10 8l2 2M13 5l2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  };

  function card(p, i, shop) {
    var off = offOf(p), img = p.images[0] || "";
    return (
      '<a class="card' + (soldOut(p) ? " is-out" : "") + '" data-line="' + esc(p.line) + '" href="#product/' + p.slug + '" style="--tone:' + esc(p.hex || "#7b7e83") + '">' +
        (img ? '<img class="card__img" src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="' + (i < 4 ? "eager" : "lazy") + '">' : "") +
        '<span class="card__type" aria-hidden="true">' + esc(p.line || p.name) + "<small>" + esc(p.color) + "</small></span>" +
        '<span class="card__top">' + (soldOut(p) ? '<span class="chip chip--out">Sold out</span>' : off ? '<span class="chip">−' + off + "%</span>" : p.isNew ? '<span class="chip">New</span>' : "<span></span>") +
          '<button class="card__fav" type="button" data-save="' + p.id + '" aria-pressed="' + (saved.indexOf(p.id) > -1) + '" aria-label="Save ' + esc(p.name) + '">' + heart(12) + "</button></span>" +
        '<span class="card__bar"><span class="card__name"><b class="' + (shop ? "card__full" : "card__short") + '">' + esc(shop ? p.name : shortName(p)) + "</b>" +
          '<span class="card__price">' + (!shop && p.color ? '<span class="card__col">' + esc(p.color) + " · </span>" : "") + taka(p.price) + (off ? "<s>" + taka(p.comparePrice) + "</s>" : "") + "</span>" +
          (shop && inStockSizes(p).length ? '<span class="card__sizes">' + inStockSizes(p).map(function (s) { return "<i>" + esc(s) + "</i>"; }).join("") + "</span>" : "") + "</span>" +
          '<span class="card__go" aria-hidden="true">›</span></span>' +
      "</a>"
    );
  }
  // Sizes that can still be bought (sold-out sizes are left out)
  function inStockSizes(p) {
    var out = [];
    (p.variants || []).forEach(function (v) {
      var o = v.options || {}, s = o.Size || o.size;
      if (s && (v.stock == null || v.stock > 0) && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }
  // "Fearless Oversized T-shirt – Black" shows as "Fearless Oversized T-shirt" with the colour beneath.
  function shortName(p) { return p.color ? p.name.replace(new RegExp("\\s*[–-]\\s*" + p.color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"), "") : p.name; }
  function grid(list) { return list.map(function (p, i) { return card(p, i, false); }).join(""); }

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
      if (v && el.getAttribute("src") !== v) { el.removeAttribute("srcset"); el.setAttribute("src", v); }
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
      // inside the sticky lookbook, measure the whole section so the text keeps sliding while the photos are pinned
      var r = (el.closest(".lookbook") || el.parentElement).getBoundingClientRect();
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
        // cross-fade: the new photo fades in over the old one, then the old one fades away
        imgs.forEach(function (im) { im.classList.remove("is-prev"); });
        imgs[current].classList.remove("is-on");
        imgs[current].classList.add("is-prev");
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
  // Dropdown: links in columns of six (or the count set in Admin > Menus, 1-12), extra links start a new
  // column to the right, and the photo sits on the right.
  // A sub-link with its own photo swaps the panel photo on hover.
  function menuItem(it) {
    var kids = it.children && it.children.length;
    if (!kids) return '<li><a href="' + esc(it.url || "#") + '">' + esc(it.label) + "</a></li>";
    var img = it.image || "";
    var per = Math.min(12, Math.max(1, parseInt(it.perColumn, 10) || 6));
    return '<li class="has-sub"><a href="' + esc(it.url || "#") + '">' + esc(it.label) + "</a>" +
      '<div class="nav__sub' + (img ? " has-img" : "") + '">' +
        '<ul class="nav__sub-list" style="--rows:' + Math.min(per, it.children.length) + '">' + it.children.map(function (c) {
          return '<li><a href="' + esc(c.url) + '"' + (c.image ? ' data-img="' + esc(c.image) + '"' : "") + ">" + esc(c.label) + "</a></li>";
        }).join("") + "</ul>" +
        (img ? '<figure class="nav__sub-img"><img src="' + esc(img) + '" data-base="' + esc(img) + '" alt="" loading="lazy" decoding="async"></figure>' : "") +
      "</div></li>";
  }
  document.addEventListener("mouseover", function (e) {
    var a = e.target.closest && e.target.closest(".nav__sub-list a");
    var sub = e.target.closest && e.target.closest(".nav__sub");
    if (!sub) return;
    var im = $(".nav__sub-img img", sub);
    if (!im) return;
    var want = (a && a.dataset.img) || im.dataset.base;
    if (im.getAttribute("src") !== want) im.setAttribute("src", want);
  });
  // Header & footer options from Admin (defaults filled in by the engine)
  function LAY() {
    var l = S.settings.layout || {};
    return { header: l.header || { showSearch: true, showAccount: true, sticky: true, announce: true }, footer: l.footer || {} };
  }
  function navHTML() {
    var items = S.menus.header || [];
    return '<nav class="nav" aria-label="Main">' +
      '<div class="nav__group nav__start">' +
        '<button class="icon-btn icon-btn--line nav__burger" type="button" data-open-menu aria-label="Open menu">' + ICON.menu + "</button>" +
        '<ul class="nav__group nav__menu">' + items.map(menuItem).join("") + "</ul>" +
      "</div>" +
      '<a class="nav__brand" href="#home" aria-label="' + esc(S.settings.store ? S.settings.store.name : "Ravelle") + ' home"><img src="' + esc(LAY().header.logo || "assets/img/logo.webp") + '" alt="Ravelle" width="100" height="54"></a>' +
      '<div class="nav__group nav__group--end">' +
        (LAY().header.showSearch ? '<button class="icon-btn icon-btn--line" type="button" data-open-search aria-label="Search">' + ICON.search + "</button>" : "") +
        (LAY().header.showAccount ? '<a class="icon-btn icon-btn--line nav__track" href="#track" aria-label="Track your order">' + ICON.user + "</a>" : "") +
        '<button class="icon-btn bag-btn" type="button" data-open-bag aria-label="Open bag">' + ICON.bag + '<span class="bag-count" data-bag-count hidden>0</span></button>' +
      "</div></nav>";
  }
  var codeDone = false;
  function injectCode() {
    if (codeDone || EDIT || document.querySelector('meta[name="rv-code"]')) return;
    codeDone = true;
    var code = S.settings.code || {};
    [[code.head, document.head], [code.bodyEnd, document.body]].forEach(function (pair) {
      if (!pair[0]) return;
      var box = document.createElement("div");
      box.innerHTML = pair[0];
      Array.prototype.slice.call(box.childNodes).forEach(function (n) {
        if (n.nodeName === "SCRIPT") {
          var sc = document.createElement("script");
          Array.prototype.forEach.call(n.attributes, function (a) { sc.setAttribute(a.name, a.value); });
          sc.text = n.text;
          pair[1].appendChild(sc);
        } else pair[1].appendChild(n);
      });
    });
  }
  function drawChrome() {
    var nav = navHTML();
    $(".hero .nav").outerHTML = nav;
    $("#topbar").innerHTML = '<div class="topbar__inner">' + nav + "</div>";
    var st = S.settings.store || {};
    var lay = LAY(), ann = $("#announce");
    ann.hidden = !S.settings.announcement || lay.header.announce === false;
    ann.textContent = S.settings.announcement || "";
    if (lay.header.announceBg) ann.style.background = lay.header.announceBg;
    if (lay.header.announceColor) ann.style.color = lay.header.announceColor;
    document.documentElement.style.setProperty("--logo-h", (lay.header.logoHeight || 40) + "px");
    document.body.classList.toggle("no-sticky", lay.header.sticky === false);
    if (lay.header.logo) $$(".menu__logo img, .poster__logo").forEach(function (im) { im.src = lay.header.logo; });
    // Footer parts
    var ft = lay.footer, home = S.pages.home || {};
    $("#news").hidden = ft.newsletter === false;
    if ((home.footer || {}).newsletter) $("#email").placeholder = home.footer.newsletter;
    if (ft.newsletterButton) $("#news button").textContent = ft.newsletterButton;
    $(".footer__pay").hidden = ft.showPayments === false;
    $(".footer__word").hidden = ft.showWordmark === false;
    if (ft.wordmark) $(".footer__word").textContent = ft.wordmark;
    $("#footerLegal").hidden = ft.showLegal === false;
    injectCode();

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
    // Hero corner: Facebook, Instagram and WhatsApp as round icons
    var ICON = { facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.9v3h2.6V21z"/></svg>', instagram: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor" stroke="none"/></svg>', whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2a8.7 8.7 0 0 0-7.5 13.2L3.3 20.8l4.5-1.2A8.7 8.7 0 1 0 12 3.2zm0 15.9c-1.3 0-2.6-.4-3.7-1l-.3-.2-2.6.7.7-2.6-.2-.3A7.2 7.2 0 1 1 12 19.1zm4-5.4c-.2-.1-1.3-.7-1.5-.7s-.4-.1-.5.1-.6.7-.7.9-.3.2-.5.1a5.9 5.9 0 0 1-2.9-2.6c-.2-.4.2-.4.6-1.2.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.4-.4-.5-.4h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9s.8 2.2.9 2.3c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.3-.5 1.5-1.1.2-.5.2-1 .1-1.1l-.4-.2z"/></svg>' };
    var heroSoc = $("#heroSocial");
    if (heroSoc) heroSoc.innerHTML = [["facebook", "Facebook", soc.facebook], ["instagram", "Instagram", soc.instagram],
      ["whatsapp", "WhatsApp", st.whatsapp ? "https://wa.me/" + st.whatsapp.replace(/[^\d]/g, "") : ""]].filter(function (s) { return s[2]; }).map(function (s) {
      return '<a href="' + esc(s[2]) + '" target="_blank" rel="noopener" aria-label="' + s[1] + '">' + ICON[s[0]] + "</a>";
    }).join("");
    $("#footerCols").innerHTML = (S.menus.footer || []).map(function (col) {
      return '<ul><li class="mono">' + esc(col.title) + "</li>" + col.items.map(function (it) { return '<li><a href="' + esc(it.url) + '">' + esc(it.label) + "</a></li>"; }).join("") + "</ul>";
    }).join("") +
      '<ul class="footer__contact"><li class="mono">Get in touch</li>' +
        (LAY().footer.showContact === false ? "" : (st.address ? "<li>" + esc(st.address) + "</li>" : "") +
        (st.phone ? '<li><a href="tel:' + esc(st.phone.replace(/[^\d+]/g, "")) + '">' + esc(st.phone) + "</a></li>" : "") +
        (st.email ? '<li><a href="mailto:' + esc(st.email) + '">' + esc(st.email) + "</a></li>" : "")) +
        (socials.length && LAY().footer.showSocial !== false ? '<li class="footer__social">' + socials.map(function (s) {
          var url = s[0] === "whatsapp" ? "https://wa.me/" + st.whatsapp.replace(/[^\d]/g, "") : soc[s[0]];
          return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + s[1] + "</a>";
        }).join("") + "</li>" : "") +
      "</ul>";
    var legal = [["Trade license", st.tradeLicense], ["TIN", st.tin], ["DBID", st.dbid], ["BIN", st.bin]].filter(function (x) { return x[1]; });
    $("#footerLegal").innerHTML = legal.map(function (x) { return "<span>" + x[0] + ": " + esc(x[1]) + "</span>"; }).join("");
    $("#footerCopy").innerHTML = LAY().footer.copyright ? esc(LAY().footer.copyright).replace(/\{year\}/g, new Date().getFullYear())
      : "© " + new Date().getFullYear() + " " + esc(st.legalName || "Ravelle") + " · Prices in BDT (৳)";
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
    drawTry();
    current = 0;
    $$(".look__img", homeView).forEach(function (im, i) { im.classList.toggle("is-on", i === 0); });
    drawLook(0);
    // Category tabs (Admin > Pages > Home > Arrivals), eight products each
    HOME_TABS = ((home.arrivals || {}).tabs || DEFAULT_TABS).filter(function (t) { return t && String(t.label || "").trim(); });
    $("#homeFilters").innerHTML = HOME_TABS.map(function (t, i) {
      return '<button class="filter' + (i ? "" : " is-on") + '" data-tab="' + i + '" role="tab" aria-selected="' + !i + '">' + esc(t.label) + "</button>";
    }).join("");
    drawArrivals(0);
    // Categories with products or children, top level first
    var cats = S.categories.filter(function (c) { return c.parentId && CAT_BY_ID[c.parentId] && CAT_BY_ID[c.parentId].slug === "men"; });
    $("#catList").innerHTML = cats.map(function (c) {
      var n = productsIn(c).length;
      return '<li><a href="#category/' + c.slug + '"><span>' + esc(c.name) + '</span><span class="mono">' + (n ? n + (n === 1 ? " style" : " styles") : "Soon") + "</span></a></li>";
    }).join("");
  }
  var HOME_TABS = [];
  var DEFAULT_TABS = [{ label: "T-shirt", category: "t-shirt" }, { label: "Shirt", category: "half-shirt, full-shirt" },
    { label: "Trouser", category: "trouser" }, { label: "Polo", category: "polo" }, { label: "Top Selling", category: "top-selling" }];
  function tabProducts(t) {
    var slugs = String((t && t.category) || "").toLowerCase().split(",").map(function (s) { return s.trim().replace(/^#?category\//, ""); }).filter(Boolean);
    if (!slugs.length || slugs.indexOf("top-selling") > -1 || slugs.indexOf("all") > -1) {
      // Top selling: featured pieces first, then new arrivals, then the rest
      var rank = function (p) { return (p.featured ? 0 : 2) + (p.isNew ? 0 : 1); };
      return S.products.slice().sort(function (a, b) { return rank(a) - rank(b); });
    }
    var out = [];
    slugs.forEach(function (sl) {
      var c = CAT_BY_SLUG[sl];
      if (c) productsIn(c).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    });
    // featured and new pieces lead within a category too
    return out.sort(function (a, b) { return (b.featured ? 2 : 0) + (b.isNew ? 1 : 0) - (a.featured ? 2 : 0) - (a.isNew ? 1 : 0); });
  }
  function drawArrivals(i) {
    var t = HOME_TABS[i], list = t ? tabProducts(t).slice(0, 8) : [];
    $("#grid").innerHTML = list.length ? grid(list) : '<p class="grid__empty">New ' + esc(t ? t.label : "styles") + " pieces are dropping soon.</p>";
    guardImages($("#grid"));
  }
  $("#homeFilters").addEventListener("click", function (e) {
    var btn = e.target.closest(".filter");
    if (!btn) return;
    $$("#homeFilters .filter").forEach(function (b) { b.classList.toggle("is-on", b === btn); b.setAttribute("aria-selected", b === btn ? "true" : "false"); });
    drawArrivals(+btn.dataset.tab);
  });

  // ---------------------------------------------------------------------------
  // Try the look: a layered carousel. The look in the middle stands in
  // front, its neighbours step back behind it, and the next ones further
  // back again. Everything is placed from one number (pos) that eases
  // toward its target every frame, so dragging, the arrows and autoplay all
  // glide. Pieces keep their own sale price.
  // ---------------------------------------------------------------------------
  var TL = { n: 0, pos: 0, target: 0, i: -1, playing: !reduce, seen: false, hover: false, drag: null, sizes: {}, looks: [], timer: null, unit: 200 };
  var tlTrack = $("#tlTrack"), tlStage = $("#tlStage"), tlCursor = $("#tlCursor");
  var TL_MS = 2200; // time on each look while autoplaying
  var TL_TOUCH = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  function tlLooks() {
    return (((S.pages.home || {}).tryLook || {}).looks || []).map(function (l, i) {
      var items = String(l.products || "").split(",").map(function (x) { return BY_SLUG[x.trim()]; }).filter(Boolean);
      return { name: l.name || "Look " + (i + 1), image: l.image, alt: l.imageAlt || "", items: items };
    }).filter(function (l) { return l.image && l.items.length; });
  }
  function tlSize(p) {
    if (!TL.sizes[p.id]) {
      var vs = p.variants || [];
      var v = vs.filter(function (x) { return x.options.Size === "L" && (!p.trackStock || x.stock > 0); })[0] || vs.filter(function (x) { return !p.trackStock || x.stock > 0; })[0];
      TL.sizes[p.id] = v ? v.id : null;
    }
    return TL.sizes[p.id];
  }
  var tlModels = [];
  function drawTry() {
    var looks = tlLooks();
    $("#try").hidden = !looks.length;
    if (!looks.length) return;
    TL.looks = looks; TL.n = looks.length;
    tlTrack.innerHTML = looks.map(function (l, i) {
      return '<div class="tl__model" role="button" tabindex="0" data-i="' + i + '" aria-label="' + esc(l.name) + '">' +
        '<img class="tl__img" src="' + esc(l.image) + '" alt="' + esc(l.alt) + '" draggable="false" decoding="async"' + (i > 4 ? ' loading="lazy"' : "") + ">" +
        '<span class="tl__tag mono" aria-hidden="true">' + String(i + 1).padStart(2, "0") + " · " + esc(l.name) + "</span></div>";
    }).join("");
    tlModels = $$(".tl__model", tlTrack);
    $("#tlSteps").innerHTML = looks.map(function (l, i) {
      return '<li><button type="button" data-i="' + i + '" aria-label="' + esc(l.name) + '"><i></i><span class="mono">' + String(i + 1).padStart(2, "0") + " <b>" + esc(l.name) + "</b></span></button></li>";
    }).join("");
    var keep = TL.i >= 0 && TL.i < TL.n ? TL.i : 0;
    TL.pos = TL.target = keep;
    TL.i = -1;
    tlMeasure();
    tlLayout();
    tlSelect(keep);
  }
  function tlMeasure() {
    var w = tlStage.clientWidth;
    // Phones show three looks (one either side), wider screens show five
    TL.edge = w < 700 ? 1.15 : 2.2;
    TL.unit = w < 700 ? w * 0.34 : Math.max(96, Math.min(300, w * 0.245));
  }
  function tlWrapD(d) { var n = TL.n; d = ((d % n) + n) % n; return d > n / 2 ? d - n : d; }
  // Place every model from the current position
  function tlLayout() {
    var u = TL.unit;
    tlModels.forEach(function (m, k) {
      var d = tlWrapD(k - TL.pos), a = Math.abs(d), sg = d < 0 ? -1 : 1;
      // Each step back adds less sideways distance, so the rows tuck in behind
      var x = sg * (Math.min(a, 1) * u + Math.max(0, Math.min(a, 2) - 1) * u * (TL.edge > 2 ? 0.74 : 0.86) + Math.max(0, Math.min(a, 4) - 2) * u * 0.6);
      var sc = 1 - Math.min(a, 4) * 0.13;
      var y = -Math.min(a, 4) * 16;
      // Five on stage: the middle one and two either side; the rest fade out behind
      var op = a > TL.edge ? Math.max(0, 1 - (a - TL.edge) / 0.6) : 1;
      m.style.transform = "translate3d(calc(-50% + " + x.toFixed(1) + "px)," + y.toFixed(1) + "px,0) scale(" + sc.toFixed(3) + ")";
      m.style.zIndex = String(100 - Math.round(a * 10));
      m.style.opacity = op.toFixed(3);
      m.style.visibility = op <= 0.01 ? "hidden" : "visible";
      // No CSS filters on the photos: some browsers paint a filtered photo's
      // transparent box as a faint tinted rectangle. Models further back just fade.
      var img = m._img || (m._img = m.querySelector(".tl__img"));
      img.style.opacity = (1 - Math.min(a, 3) * 0.12).toFixed(3);
    });
  }
  function tlSelect(i) {
    if (i === TL.i) return;
    TL.i = i;
    tlModels.forEach(function (m, k) { m.classList.toggle("is-on", k === i); });
    $$("#tlSteps button").forEach(function (b, j) {
      b.classList.toggle("is-on", j === i); b.classList.toggle("is-done", j < i);
      b.setAttribute("aria-current", j === i ? "true" : "false");
      var bar = b.querySelector("i"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
    });
    tlPanel();
    tlTimer();
  }
  // Go to look i the short way round
  function tlGoTo(i) { TL.target = TL.target + tlWrapD(i - TL.target); }
  var tlLast = 0;
  function tlFrame(t) {
    var dt = tlLast ? Math.min(0.05, (t - tlLast) / 1000) : 0;
    tlLast = t;
    if (TL.n && TL.seen && !document.hidden && !TL.drag) {
      var diff = TL.target - TL.pos;
      if (Math.abs(diff) > 0.0005) {
        // Smooth, frame-rate independent ease
        TL.pos += diff * (1 - Math.exp(-dt * 9));
        tlLayout();
      } else if (diff) { TL.pos = TL.target; tlLayout(); }
    }
    requestAnimationFrame(tlFrame);
  }
  requestAnimationFrame(tlFrame);
  function tlPanel() {
    var look = TL.looks[TL.i];
    $("#tlAll").disabled = !look;
    if (!look) return;
    var items = look.items, sum = 0, was = 0;
    $("#tlPieces").textContent = items.length + (items.length === 1 ? " piece" : " pieces");
    $("#tlItems").innerHTML = items.map(function (p, k) {
      var cur = tlSize(p);
      sum += p.price; was += Math.max(p.comparePrice || 0, p.price);
      return '<li class="tl__item" data-p="' + p.id + '">' +
        '<a class="tl__thumb" href="#product/' + p.slug + '" aria-label="' + esc(p.name) + '">' + (p.images[0] ? '<img src="' + esc(p.images[0]) + '" alt="" loading="lazy">' : "") + '<span class="mono">' + (k + 1) + "</span></a>" +
        '<div class="tl__info"><span class="tl__brand mono">' + esc(p.line) + '</span><a href="#product/' + p.slug + '">' + esc(shortName(p)) + "</a>" +
          '<p class="tl__price">' + taka(p.price) + (p.comparePrice > p.price ? " <s>" + taka(p.comparePrice) + "</s>" : "") + "</p>" +
          '<label class="tl__size mono"><span>Size</span><select data-size aria-label="Size for ' + esc(shortName(p)) + '">' + (p.variants || []).map(function (v) {
            var out = p.trackStock && v.stock <= 0;
            return '<option value="' + v.id + '"' + (v.id === cur ? " selected" : "") + (out ? " disabled" : "") + ">" + esc(v.options.Size || optText(v.options)) + (out ? " (sold out)" : "") + "</option>";
          }).join("") + "</select></label></div>" +
        '<button class="tl__add" type="button" data-add aria-label="Add ' + esc(shortName(p)) + ' to bag">+</button>' +
      "</li>";
    }).join("");
    $("#tlSum").innerHTML = (was > sum ? "<s>" + taka(was) + "</s>" : "") + taka(sum);
    $("#tlSave").textContent = (items.length > 1 ? "All " + items.length + " pieces" : "This piece") + (was > sum ? " · you save " + taka(was - sum) : "");
  }
  function tlTimer() {
    clearTimeout(TL.timer);
    var on = TL.playing && TL.seen && TL.n > 1 && TL.i >= 0 && !TL.hover && !TL.drag;
    $("#try").classList.toggle("is-playing", on);
    var btn = $("#tlPlay");
    btn.classList.toggle("is-paused", !TL.playing);
    btn.setAttribute("aria-label", TL.playing ? "Pause" : "Play");
    if (on) TL.timer = setTimeout(function () { TL.target = Math.round(TL.target) + 1; tlSelect(((Math.round(TL.target) % TL.n) + TL.n) % TL.n); }, TL_MS);
  }
  function tlStep(dir) { TL.target = Math.round(TL.target) + dir; tlSelect(((Math.round(TL.target) % TL.n) + TL.n) % TL.n); }
  function tlStop() { TL.playing = false; }
  $("#tlPrev").addEventListener("click", function () { tlStop(); tlStep(-1); });
  $("#tlNext").addEventListener("click", function () { tlStop(); tlStep(1); });
  $("#tlPlay").addEventListener("click", function () { TL.playing = !TL.playing; tlTimer(); });
  $("#tlSteps").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) { tlStop(); tlGoTo(+b.dataset.i); tlSelect(+b.dataset.i); }
  });
  // Drag: the row follows the pointer, then settles on the nearest look,
  // carrying a little of the flick speed
  function tlDown(x, t) {
    if (t.closest(".tl__foot, .tl__head")) return false;
    TL.drag = { px: x, p0: TL.pos, moved: 0, lx: x, lt: performance.now(), v: 0 };
    tlStage.classList.add("is-grabbing");
    tlTimer();
    return true;
  }
  function tlMove(x) {
    var g = TL.drag, now = performance.now(), dx = x - g.px;
    g.moved = Math.max(g.moved, Math.abs(dx));
    if (now > g.lt) { g.v = 0.8 * g.v + 0.2 * ((x - g.lx) / (now - g.lt)); g.lx = x; g.lt = now; }
    TL.pos = TL.target = g.p0 - dx / TL.unit;
    tlLayout();
  }
  function tlUp(t) {
    var g = TL.drag;
    TL.drag = null;
    tlStage.classList.remove("is-grabbing");
    var m = t && t.closest && t.closest(".tl__model");
    if (g.moved < 6) {
      if (m && tlTrack.contains(m)) { tlStop(); tlGoTo(+m.dataset.i); tlSelect(+m.dataset.i); }
      else tlTimer();
      return;
    }
    tlStop();
    TL.target = Math.round(TL.pos - g.v * 260 / TL.unit);
    tlSelect(((TL.target % TL.n) + TL.n) % TL.n);
  }
  // Mouse and pen use pointer events
  tlStage.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "touch" || e.button) return;
    tlDown(e.clientX, e.target);
  });
  window.addEventListener("pointermove", function (e) { if (TL.drag && !TL.drag.touch) tlMove(e.clientX); });
  window.addEventListener("pointerup", function (e) { if (TL.drag && !TL.drag.touch) tlUp(e.target); });
  // Touch uses touch events, so a sideways swipe is always ours (the page
  // never steals it as a scroll) while an up/down swipe still scrolls the page
  tlStage.addEventListener("touchstart", function (e) {
    if (e.touches.length > 1) return;
    var p = e.touches[0];
    if (!tlDown(p.clientX, e.target)) return;
    TL.drag.touch = true; TL.drag.py = p.clientY; TL.drag.axis = "";
  }, { passive: true });
  tlStage.addEventListener("touchmove", function (e) {
    var g = TL.drag;
    if (!g || !g.touch) return;
    var p = e.touches[0], dx = p.clientX - g.px, dy = p.clientY - g.py;
    if (!g.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (g.axis === "y") { tlUp(null); TL.target = Math.round(TL.pos); return; }
      g.px = p.clientX; // start the row from here so it doesn't jump
    }
    e.preventDefault();
    tlMove(p.clientX);
  }, { passive: false });
  function tlTouchEnd(e) {
    var g = TL.drag;
    if (!g || !g.touch) return;
    // A tap: work out which model is under the finger (photos ignore taps)
    var t = e.changedTouches && e.changedTouches[0], el = t ? document.elementFromPoint(t.clientX, t.clientY) : null;
    if (g.moved < 6 && e.cancelable) e.preventDefault();
    tlUp(el);
  }
  tlStage.addEventListener("touchend", tlTouchEnd);
  tlStage.addEventListener("touchcancel", function () { if (TL.drag && TL.drag.touch) { TL.drag.moved = 99; TL.drag.v = 0; tlUp(null); } });
  tlTrack.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var m = e.target.closest(".tl__model");
    if (m) { e.preventDefault(); tlStop(); tlGoTo(+m.dataset.i); tlSelect(+m.dataset.i); }
  });
  tlStage.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    var r = tlStage.getBoundingClientRect(), over = e.target.closest(".tl__model"), ui = e.target.closest(".tl__foot, .tl__head");
    tlCursor.style.transform = "translate(" + (e.clientX - r.left) + "px," + (e.clientY - r.top) + "px)";
    tlCursor.textContent = over ? "View" : "Drag";
    tlCursor.classList.toggle("is-on", !ui);
    var h = !!over;
    if (h !== TL.hover) { TL.hover = h; tlTimer(); }
  });
  tlStage.addEventListener("pointerleave", function () { tlCursor.classList.remove("is-on"); if (TL.hover) { TL.hover = false; tlTimer(); } });
  tlStage.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight") { tlStop(); tlStep(1); }
    if (e.key === "ArrowLeft") { tlStop(); tlStep(-1); }
  });
  $("#tlItems").addEventListener("change", function (e) {
    var sel = e.target.closest("[data-size]"), li = sel && sel.closest(".tl__item");
    if (li) TL.sizes[li.dataset.p] = sel.value;
  });
  $("#tlItems").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-add]");
    if (!btn) return;
    var p = BY_ID[btn.closest(".tl__item").dataset.p], v = variantOf(p, tlSize(p));
    if (!v && p.variants.length) { toast("That piece is sold out.", "warn"); return; }
    if (addToBag(p, v, 1)) { btn.classList.add("is-done"); setTimeout(function () { btn.classList.remove("is-done"); }, 1400); }
  });
  $("#tlAll").addEventListener("click", function () {
    var look = TL.looks[TL.i];
    if (!look) return;
    var added = 0, out = [];
    look.items.forEach(function (p) {
      var v = variantOf(p, tlSize(p));
      if (!v && p.variants.length) { out.push(shortName(p)); return; }
      if (addToBag(p, v, 1, true)) added++;
    });
    if (out.length) toast("Sold out: " + esc(out.join(", ")), "warn");
    if (added) { toast("Look added to bag"); openBag(); }
  });
  window.addEventListener("resize", function () { if (TL.n) { tlMeasure(); tlLayout(); } });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { TL.seen = es[0].isIntersecting; tlTimer(); }, { threshold: 0.2 }).observe($("#try"));
  } else TL.seen = true;

  // ---------------------------------------------------------------------------
  // Page header
  // ---------------------------------------------------------------------------
  function head(crumb, title, sub, key) {
    pagehead.classList.remove("has-tools");
    pagehead.innerHTML = '<div class="hero__panel pagehead__panel"' + (key ? ' data-page="' + key + '"' : "") + ">" + navHTML() +
      '<div class="pagehead__copy"><p class="eyebrow">' + crumb + '</p><h1 class="display display--page">' + title + "</h1>" +
      (sub ? '<p class="pagehead__sub">' + sub + "</p>" : "") + "</div></div>";
    syncCount();
  }
  function miniHead() {
    pagehead.classList.remove("has-tools");
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

  // Colour groups for the shop filter. Admin can set a product's group; otherwise it is guessed from the colour name.
  var COLOR_GROUPS = [
    ["Black", "#1f2022", /black|jet|onyx/], ["White", "#f2f1ec", /white|ivory|mono bloom/], ["Grey", "#8a8d91", /grey|gray|charcoal|ash|silver/],
    ["Blue", "#3b6279", /blue|navy|denim|teal/], ["Green", "#3f8a68", /green|olive|sage|mint/], ["Yellow", "#c3ae62", /yellow|mustard|gold/],
    ["Cream", "#d8ccb0", /cream|beige|sand|khaki|line art/], ["Brown", "#5f4535", /brown|coffee|chocolate|tan|mosaic|camel/],
    ["Red", "#a8342b", /red|brick|maroon|wine|burgundy/], ["Pink", "#d0607a", /pink|rose|blush/], ["Orange", "#d27c3c", /orange|coral|rust|peach/],
    ["Purple", "#6c4f8c", /purple|violet|lilac|lavender/]
  ];
  function colorGroup(p) {
    var g = COLOR_GROUPS.filter(function (x) { return x[0] === p.colorGroup; })[0];
    if (!g) { var n = String(p.color || "").toLowerCase(); g = COLOR_GROUPS.filter(function (x) { return x[2].test(n); })[0]; }
    return g ? { name: g[0], hex: g[1] } : (p.color ? { name: p.color, hex: p.hex || "#888888" } : null);
  }
  var CHEVRON = '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

  function viewListing(opts) {
    var base = opts.list;
    head(opts.crumb, opts.title, opts.sub || base.length + (base.length === 1 ? " piece" : " pieces") + ". Prices in BDT.");
    var subcats = opts.cat ? S.categories.filter(function (c) { return c.parentId === opts.cat.id && productsIn(c).length; }) : [];
    var lines = [];
    base.forEach(function (p) { if (p.line && lines.indexOf(p.line) < 0) lines.push(p.line); });
    var chips = subcats.length > 1 ? subcats.map(function (c) { return { key: "cat:" + c.id, label: c.name }; }) : lines.length > 1 ? lines.map(function (l) { return { key: "line:" + l, label: l }; }) : [];
    var colors = [];
    base.forEach(function (p) { var g = colorGroup(p); if (g && !colors.some(function (c) { return c.name === g.name; })) colors.push(g); });
    colors.sort(function (a, b) { return COLOR_GROUPS.map(function (x) { return x[0]; }).indexOf(a.name) - COLOR_GROUPS.map(function (x) { return x[0]; }).indexOf(b.name); });
    var sizes = [];
    base.forEach(function (p) { p.variants.forEach(function (v) { var s = v.options.Size; if (s && sizes.indexOf(s) < 0) sizes.push(s); }); });
    // Four dropdowns sit on the page header: design and colour on the left, size and sort on the right
    var tools = '<div class="pagehead__tools" id="shopTools">' +
      '<div class="tools__side">' +
        (chips.length ? '<label class="sort"><span class="sr">Design</span><select id="chipFilter"><option value="">' + (subcats.length > 1 ? "All types" : "All designs") + "</option>" +
          chips.map(function (c) { return '<option value="' + esc(c.key) + '">' + esc(c.label) + "</option>"; }).join("") + "</select></label>" : "") +
        (colors.length > 1 ? '<div class="cdrop" id="colorDrop"><button class="cdrop__btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Colour">' +
          '<span class="cdrop__txt">Colour</span>' + CHEVRON + "</button>" +
          '<div class="cdrop__pop" role="group" aria-label="Colour" hidden>' +
            '<button class="swatch swatch--any" type="button" data-color="" aria-pressed="true"><span class="sr">Any colour</span></button>' +
            colors.map(function (c) { return '<button class="swatch" type="button" data-color="' + esc(c.name) + '" style="--sw:' + esc(c.hex) + '" aria-pressed="false"><span class="sr">' + esc(c.name) + "</span></button>"; }).join("") +
          "</div></div>" : "") +
      "</div>" +
      '<div class="tools__side">' +
        (sizes.length > 1 ? '<label class="sort"><span class="sr">Size</span><select id="sizeFilter"><option value="">Any size</option>' + sizes.map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("") + "</select></label>" : "") +
        '<label class="sort"><span class="sr">Sort</span><select id="sort">' +
          '<option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option>' +
        "</select></label>" +
      "</div></div>";
    pagehead.insertAdjacentHTML("beforeend", tools);
    pagehead.classList.add("has-tools");
    page.innerHTML =
      '<section class="shop">' +
        '<p class="shop__count mono" id="count"></p>' +
        '<div class="grid" id="shopGrid"></div>' +
        '<div class="empty" id="shopEmpty" hidden><p>Nothing matches those filters.</p><button class="pill pill--dark pill--sm" type="button" id="clearFilters">Clear filters</button></div>' +
      "</section>";
    var state = { chip: "", color: null, size: "", sort: "featured" };
    function draw() {
      var list = base.filter(function (p) {
        if (state.chip.indexOf("cat:") === 0 && !productsIn(CAT_BY_ID[state.chip.slice(4)]).some(function (x) { return x === p; })) return false;
        if (state.chip.indexOf("line:") === 0 && p.line !== state.chip.slice(5)) return false;
        if (state.color && (colorGroup(p) || {}).name !== state.color) return false;
        if (state.size && !p.variants.some(function (v) { return v.options.Size === state.size && (!p.trackStock || v.stock > 0); })) return false;
        return true;
      }).slice();
      if (state.sort === "low") list.sort(function (a, b) { return a.price - b.price || a.order - b.order; });
      if (state.sort === "high") list.sort(function (a, b) { return b.price - a.price || a.order - b.order; });
      if (state.sort === "new") list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      if (state.sort === "featured") list.sort(function (a, b) { return a.order - b.order; });
      // Sold-out products always go to the end, whatever the sort
      list = list.filter(function (p) { return !soldOut(p); }).concat(list.filter(soldOut));
      $("#shopGrid").innerHTML = list.map(function (p, i) { return card(p, i, true); }).join("");
      $("#count").textContent = list.length + (list.length === 1 ? " product" : " products");
      $("#shopEmpty").hidden = list.length > 0;
      guardImages($("#shopGrid"));
    }
    var drop = $("#colorDrop");
    function setColor(name) {
      state.color = name || null;
      $$(".swatch", drop).forEach(function (x) { x.setAttribute("aria-pressed", (x.dataset.color || null) === state.color ? "true" : "false"); });
      var on = colors.filter(function (c) { return c.name === state.color; })[0];
      drop.classList.toggle("is-set", !!on);
    }
    function openDrop(open) {
      $(".cdrop__pop", drop).hidden = !open;
      $(".cdrop__btn", drop).setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (drop) {
      $(".cdrop__btn", drop).addEventListener("click", function (e) { e.stopPropagation(); openDrop($(".cdrop__pop", drop).hidden); });
      $$(".swatch", drop).forEach(function (b) {
        b.addEventListener("click", function () { setColor(b.dataset.color); openDrop(false); draw(); });
      });
      document.addEventListener("click", function (e) { if (drop.isConnected && !drop.contains(e.target)) openDrop(false); });
      drop.addEventListener("keydown", function (e) { if (e.key === "Escape") { openDrop(false); $(".cdrop__btn", drop).focus(); } });
    }
    if ($("#chipFilter")) $("#chipFilter").addEventListener("change", function (e) { state.chip = e.target.value; draw(); });
    if ($("#sizeFilter")) $("#sizeFilter").addEventListener("change", function (e) { state.size = e.target.value; draw(); });
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; draw(); });
    $("#clearFilters").addEventListener("click", function () {
      state = { chip: "", color: null, size: "", sort: state.sort };
      if ($("#chipFilter")) $("#chipFilter").value = "";
      if (drop) setColor("");
      if ($("#sizeFilter")) $("#sizeFilter").value = "";
      draw();
    });
    draw();
  }

  function viewCategory(slug) {
    var cat = CAT_BY_SLUG[slug];
    if (!cat) return viewMissing();
    var list = productsIn(cat);
    track("category", "", { name: cat.name, ids: list.slice(0, 20).map(function (p) { return p.sku; }) });
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
    if (q) track("search", "", { q: q, n: list.length, ids: list.slice(0, 10).map(function (p) { return p.sku; }) });
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
          '<figure class="collage__img reveal slat dark"><img data-ci="image" data-calt="imageAlt" alt="" loading="lazy"></figure>' +
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
          track("contact", "", { method: "Contact form" });
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

  var STATUS = { pending: "Order placed", confirmed: "Confirmed", hold: "On hold", processing: "Packing", shipped: "On the way", delivered: "Delivered", cancelled: "Cancelled", returned: "Returned" };
  var STEPS = ["pending", "confirmed", "processing", "shipped", "delivered"];
  function orderHTML(o) {
    var at = STEPS.indexOf(o.status);
    return '<div class="order panel">' +
      '<div class="order__head"><div><p class="mono">Order ' + esc(o.number) + " · " + new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + "</p>" +
        '<h2 class="h2 order__status">' + esc(STATUS[o.status] || o.status) + "</h2></div>" +
        '<span class="chip ' + (o.paymentStatus === "paid" ? "chip--paid" : "chip--muted") + '">' + (o.paymentStatus === "paid" ? "Paid" : o.paymentMethod === "cod" ? "Cash on delivery" : "Payment " + esc(o.paymentStatus)) + "</span></div>" +
      (at > -1 ? '<ol class="steps">' + STEPS.map(function (s, i) { return '<li class="' + (i <= at ? "is-done" : "") + '">' + STATUS[s] + "</li>"; }).join("") + "</ol>" : "") +
      (o.courier && (o.courier.name || o.courier.code) ? '<p class="order__track">' + esc(o.courier.name ? o.courier.name.charAt(0).toUpperCase() + o.courier.name.slice(1) : "Courier") +
          (o.courier.code ? " · <b>" + esc(o.courier.code) + "</b>" : "") + (o.courier.url ? ' · <a href="' + esc(o.courier.url) + '" target="_blank" rel="noopener">Track with the courier</a>' : "") +
          (o.courier.rider ? "<br>Rider: " + esc(o.courier.rider) + (o.courier.riderPhone ? ' · <a href="tel:' + esc(o.courier.riderPhone) + '">' + esc(o.courier.riderPhone) + "</a>" : "") : "") + "</p>"
        : o.tracking ? '<p class="order__track">Courier tracking: <b>' + esc(o.tracking) + "</b></p>" : "") +
      (o.history && o.history.some(function (h) { return h.note; }) ? '<ol class="order__log">' + o.history.filter(function (h) { return h.note; }).slice().reverse().map(function (h) {
          return "<li><b>" + esc(h.note) + "</b><span class=\"mono\">" + new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + "</span></li>"; }).join("") + "</ol>" : "") +
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
    track("checkout");
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
          '<label class="agree"><input type="checkbox" name="agree" id="co-agree" required checked><span>I have read and agree to the website\'s <a href="#terms" data-policy="terms">Terms &amp; conditions</a>, <a href="#privacy" data-policy="privacy">Privacy policy</a> and <a href="#refund" data-policy="refund">Return &amp; refund policy</a>.</span></label>' +
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
        paymentMethod: payInput ? payInput.value : "", agree: form.agree.checked, note: form.note.value, source: trafficSource(), meta: metaInfo()
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
      track("payment", "", { method: body.paymentMethod === "cod" ? "Cash on delivery" : "Online payment" });
      api("POST", "/api/orders", body).then(function (r) {
        var o = r.order;
        pixelMatch(body.customer);
        adEvent("purchase", "", { order: o });
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
    track("page", "", { path: pagePath() });
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
    track("cart", p.id, { qty: qty });
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
      var pic = m.image ? '<a class="msg__img" href="' + esc(m.image) + '" target="_blank" rel="noopener"><img src="' + esc(m.image) + '" alt="Photo"></a>' : "";
      return '<div class="msg msg--' + (m.from === "customer" ? "me" : "them") + (m.image ? " msg--img" : "") + '">' + pic + (m.text ? "<p>" + br(m.text) + "</p>" : "") + '<span class="mono">' +
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
  function sendChat(text, image) {
    var go = function () {
      var msg = { id: "tmp" + Date.now(), from: "customer", text: text, image: image, at: Date.now() };
      chat.messages.push(msg); drawChat();
      return api("POST", "/api/chat/" + chat.session.id + "/messages", { token: chat.session.token, text: text, image: image || undefined, since: chat.last, name: $("#chatName").value }).then(function (r) {
        chat.messages = chat.messages.filter(function (m) { return m !== msg; });
        r.messages.forEach(function (m) { if (!chat.messages.some(function (x) { return x.id === m.id; })) chat.messages.push(m); });
        chat.messages.sort(function (a, b) { return a.at - b.at; });
        chat.last = chat.messages[chat.messages.length - 1].at;
        drawChat();
        pollChat();
      });
    };
    if (!chat.session) track("contact", "", { method: "Live chat" });
    var start = chat.session ? Promise.resolve() : api("POST", "/api/chat/start", { name: $("#chatName").value, page: location.hash }).then(function (r) {
      chat.session = { id: r.id, token: r.token };
      store.set("chat", chat.session);
      chat.messages = r.messages;
      chat.last = r.messages.length ? r.messages[r.messages.length - 1].at : 0;
    });
    return start.then(go).catch(function (err) {
      chat.messages = chat.messages.filter(function (m) { return String(m.id).indexOf("tmp") !== 0; }); drawChat();
      toast(esc(err.message || "Chat isn't available right now."), "warn");
    });
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
  // "+" button: pick a photo, shrink it to 1280 px and send it
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        var cv = document.createElement("canvas");
        cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        var out = cv.toDataURL("image/webp", 0.82);
        resolve(out.indexOf("data:image/webp") === 0 ? out : cv.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That file isn't a photo we can open.")); };
      img.src = url;
    });
  }
  $("#chatAttach").addEventListener("click", function () { $("#chatFile").click(); });
  $("#chatFile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast("Choose a photo (JPG, PNG or WebP).", "warn"); return; }
    shrinkPhoto(f).then(function (data) {
      var t = $("#chatText"), text = t.value.trim();
      t.value = "";
      sendChat(text, data);
    }, function (err) { toast(esc(err.message), "warn"); });
  });
  $("#chatText").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
  });

  // ---------------------------------------------------------------------------
  // Analytics: one visit per browser per day, product views and add-to-bags
  // ---------------------------------------------------------------------------
  var sid = store.get("sid", null), sidNew = !sid;
  if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("sid", sid); }
  // Where this visit came from: a utm_source tag, an ad click id, or the site that linked here
  function trafficSource() {
    var saved = null;
    try { saved = sessionStorage.getItem("ravelle:src"); } catch (e) {}
    if (saved) return saved;
    var q = location.search, utm = (q.match(/[?&]utm_source=([^&#]+)/) || [])[1], src = "Direct";
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : ""; } catch (e) {}
    if (ref === location.hostname.replace(/^www\./, "")) ref = "";
    var named = [[/facebook|fb\.|fbclid/i, "Facebook"], [/instagram/i, "Instagram"], [/google|gclid/i, "Google"], [/bing/i, "Bing"], [/youtube|youtu\.be/i, "YouTube"],
      [/tiktok/i, "TikTok"], [/whatsapp|wa\.me/i, "WhatsApp"], [/messenger|m\.me/i, "Messenger"], [/t\.co$|twitter|x\.com/i, "X (Twitter)"], [/linkedin/i, "LinkedIn"], [/pinterest/i, "Pinterest"]];
    var name = function (s) { for (var i = 0; i < named.length; i++) if (named[i][0].test(s)) return named[i][1]; return null; };
    if (utm) { utm = decodeURIComponent(utm).replace(/\+/g, " "); src = name(utm) || utm.charAt(0).toUpperCase() + utm.slice(1); }
    else if (/[?&]fbclid=/.test(q)) src = ref && /instagram/i.test(ref) ? "Instagram" : "Facebook";
    else if (/[?&]gclid=/.test(q)) src = "Google Ads";
    else if (ref) src = name(ref) || ref;
    src = src.slice(0, 40);
    try { sessionStorage.setItem("ravelle:src", src); } catch (e) {}
    return src;
  }
  function deviceInfo() {
    var ua = navigator.userAgent, w = Math.min(screen.width || innerWidth, innerWidth || 9999);
    var dev = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "Tablet" : /Mobi|iPhone|Android/i.test(ua) || w < 600 ? "Mobile" : "Desktop";
    var br = /FBAN|FBAV|FB_IAB/.test(ua) ? "Facebook app" : /Instagram/.test(ua) ? "Instagram app" : /SamsungBrowser/.test(ua) ? "Samsung Internet" :
      /OPR\/|Opera/.test(ua) ? "Opera" : /Edg\//.test(ua) ? "Edge" : /UCBrowser/.test(ua) ? "UC Browser" : /Firefox|FxiOS/.test(ua) ? "Firefox" :
      /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Other";
    var os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
    return { dev: dev, br: br, os: os };
  }
  // Shopping events for Meta Pixel (fbq) and Google Analytics 4 (gtag), when their IDs are set in Admin > Header & footer
  var adPages = 0;
  // Meta cookies and page address, sent along so the server copy of each event matches the browser one
  function metaInfo() {
    var ck = function (n) { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : ""; };
    var fbc = ck("_fbc"), click = (location.search.match(/[?&]fbclid=([^&#]+)/) || [])[1];
    if (!fbc && click) fbc = "fb.1." + Date.now() + "." + click;
    // Google Analytics ids, so the server's purchase joins the visitor's session in GA
    var gaCid = (ck("_ga").match(/^GA\d\.\d\.(.+)$/) || [])[1] || "";
    var gid = ((S.settings.code || {}).gaId || "").replace(/^G-/, ""), gs = gid ? ck("_ga_" + gid) : "";
    var gaSid = (gs.match(/^GS1\.\d\.(\d+)/) || gs.match(/^GS2\.\d\.s(\d+)/) || [])[1] || "";
    return { fbp: ck("_fbp"), fbc: fbc, url: location.href.slice(0, 500), sid: sid, gaCid: gaCid, gaSid: gaSid };
  }
  function eventId() { return "ev." + Date.now().toString(36) + "." + Math.random().toString(36).slice(2, 10); }
  function adEvent(type, productId, info, eid) {
    if (EDIT) return;
    var fb = typeof window.fbq === "function" ? window.fbq : null, ga = typeof window.gtag === "function" ? window.gtag : null;
    if (!fb && !ga) return;
    info = info || {};
    var opt = eid ? { eventID: eid } : undefined;
    var p = productId ? BY_ID[productId] : null, qty = info.qty || 1;
    var catOf = function (x) { var c = CAT_BY_ID[x.categoryIds[x.categoryIds.length - 1]] || CAT_BY_ID[x.categoryIds[0]]; return c ? c.name : ""; };
    var gaItem = function (x, q) { return { item_id: x.sku, item_name: x.name, item_variant: x.color, item_category: catOf(x), price: x.price, quantity: q || 1 }; };
    var bag = function () {
      var lines = cart.map(function (l) { var x = BY_ID[l.productId]; return x ? { p: x, qty: l.qty } : null; }).filter(Boolean);
      return { lines: lines, value: lines.reduce(function (s, l) { return s + l.p.price * l.qty; }, 0), units: lines.reduce(function (s, l) { return s + l.qty; }, 0) };
    };
    // One product, in the shape Meta's catalog and Advantage+ ads expect
    var one = function (x, q) {
      return { content_ids: [x.sku], content_name: x.name, content_category: catOf(x), content_type: "product",
        contents: [{ id: x.sku, quantity: q, item_price: x.price }], value: x.price * q, currency: "BDT" };
    };
    var many = function (b) {
      return { content_ids: b.lines.map(function (l) { return l.p.sku; }), content_type: "product", contents: b.lines.map(function (l) { return { id: l.p.sku, quantity: l.qty, item_price: l.p.price }; }),
        num_items: b.units, value: b.value, currency: "BDT" };
    };
    var send = function (name, params, custom) { if (fb) fb(custom ? "trackCustom" : "track", name, params || {}, opt); };
    try {
      if (type === "page") {
        // Every Pixel page view is sent from here (with an event ID). GA sends the first one itself.
        send("PageView");
        if (adPages++ && ga) ga("event", "page_view", { page_location: location.href, page_title: document.title });
      } else if (type === "view" && p) {
        send("ViewContent", one(p, 1));
        if (ga) ga("event", "view_item", { currency: "BDT", value: p.price, items: [gaItem(p)] });
      } else if (type === "cart" && p) {
        send("AddToCart", one(p, qty));
        if (ga) ga("event", "add_to_cart", { currency: "BDT", value: p.price * qty, items: [gaItem(p, qty)] });
      } else if (type === "wishlist" && p) {
        send("AddToWishlist", one(p, 1));
        if (ga) ga("event", "add_to_wishlist", { currency: "BDT", value: p.price, items: [gaItem(p)] });
      } else if (type === "category") {
        var ids = (info.ids || []).slice(0, 20);
        send("ViewCategory", { content_category: info.name || "", content_ids: ids, content_type: "product" }, true);
        if (ga) ga("event", "view_item_list", { item_list_name: info.name || "" });
      } else if (type === "checkout" || type === "payment") {
        var b = bag(), d = many(b);
        if (type === "payment") d.payment_method = info.method || "";
        send(type === "checkout" ? "InitiateCheckout" : "AddPaymentInfo", d);
        if (ga) ga("event", type === "checkout" ? "begin_checkout" : "add_payment_info", Object.assign({ currency: "BDT", value: b.value, items: b.lines.map(function (l) { return gaItem(l.p, l.qty); }) },
          type === "payment" ? { payment_type: info.method || "" } : {}));
      } else if (type === "search" && info.q) {
        send("Search", { search_string: info.q, content_type: "product", content_ids: (info.ids || []).slice(0, 10) });
        if (ga) ga("event", "search", { search_term: info.q });
      } else if (type === "lead") {
        send("Lead", { content_name: info.topic || "Newsletter", content_category: "email signup" });
        if (ga) ga("event", "generate_lead", { lead_source: info.topic || "newsletter" });
      } else if (type === "contact") {
        send("Contact", { content_name: info.method || "" });
        if (ga) ga("event", "contact", { method: info.method || "" });
      } else if (type === "purchase" && info.order) {
        var o = info.order, skuOf = function (l) { return (BY_ID[l.productId] || {}).sku || l.sku; };
        // The order number is the event ID, the same one the server sends to the Conversions API
        if (fb) fb("track", "Purchase", { content_ids: o.items.map(skuOf), content_type: "product",
          contents: o.items.map(function (l) { return { id: skuOf(l), quantity: l.qty, item_price: l.price }; }),
          num_items: o.items.reduce(function (s, l) { return s + l.qty; }, 0), value: o.total, currency: "BDT", order_id: o.number }, { eventID: o.number });
        if (ga) ga("event", "purchase", { transaction_id: o.number, currency: "BDT", value: o.total, shipping: o.shipping || 0, coupon: o.coupon || undefined,
          items: o.items.map(function (l) { return { item_id: skuOf(l), item_name: l.name, item_variant: l.color, price: l.price, quantity: l.qty }; }) });
      }
    } catch (e) {}
  }
  // Advanced matching: tell the Pixel who the shopper is when they have checked out before on this browser
  var matched = false;
  function pixelMatch(cu) {
    var id = (S.settings.code || {}).pixelId;
    if (!id || typeof window.fbq !== "function" || EDIT) return;
    cu = cu || store.get("customer", null);
    if (matched && !cu) return;
    var ud = { external_id: sid, country: "bd" };
    if (cu) {
      var names = String(cu.name || "").trim().toLowerCase().split(/\s+/), ph = String(cu.phone || "").replace(/[^\d]/g, "");
      if (ph) ud.ph = ph.length === 11 ? "88" + ph : ph;
      if (cu.email) ud.em = String(cu.email).trim().toLowerCase();
      if (names[0]) ud.fn = names[0];
      if (names.length > 1) ud.ln = names[names.length - 1];
      if (cu.city) ud.ct = String(cu.city).toLowerCase().replace(/[^a-z]/g, "");
    }
    try { window.fbq("init", id, ud); matched = true; } catch (e) {}
  }
  function track(type, productId, info) {
    if (EDIT) return;
    var eid = eventId();
    if (!matched) pixelMatch();
    adEvent(type, productId, info, eid);
    var body = { type: type, productId: productId || "", sid: sid, eid: eid };
    if (info) Object.keys(info).forEach(function (k) { body[k] = info[k]; });
    var mi = metaInfo();
    body.fbp = mi.fbp; body.fbc = mi.fbc; body.url = mi.url;
    if (type === "checkout" || type === "payment") body.items = cart.map(function (l) { return { productId: l.productId, qty: l.qty }; });
    // Details the shopper gave at an earlier checkout; the server hashes them before they go to Meta
    var cu = store.get("customer", null);
    if (cu) body.cu = { name: cu.name || "", phone: cu.phone || "", email: cu.email || "", city: cu.city || "" };
    api("POST", "/api/track", body).catch(function () {});
  }
  function pagePath() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, "").split("?")[0]);
    if (!h || h === "home" || HOME_ANCHORS[h]) return "home";
    if (/^order\//.test(h)) return "order";
    if (/^search\//.test(h)) return "search";
    if (h.indexOf("p-") === 0) return "product/" + h.slice(2);
    return h.slice(0, 80);
  }

  // ---------------------------------------------------------------------------
  // Delegated clicks and forms
  // ---------------------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (EDIT && t.closest("a") && !t.closest("[data-allow]")) { e.preventDefault(); }
    var reach = t.closest('a[href*="wa.me/"], a[href^="tel:"], a[href*="m.me/"]');
    if (reach && !EDIT) track("contact", "", { method: /wa\.me/.test(reach.href) ? "WhatsApp" : /m\.me/.test(reach.href) ? "Messenger" : "Phone call" });
    var save = t.closest("[data-save]");
    if (save) {
      e.preventDefault();
      var id = save.dataset.save, at = saved.indexOf(id);
      if (at > -1) saved.splice(at, 1); else { saved.push(id); track("wishlist", id); }
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
      track("lead", "", { topic: topic, em: email });
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
    setTimeout(function () { document.documentElement.classList.remove("js-intro"); }, 3600);
    activate(homeView, heroWord); // the hero word eases in with CSS, never scrambles
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
    var di = deviceInfo();
    track("visit", "", { src: trafficSource(), dev: di.dev, br: di.br, os: di.os, nv: sidNew, path: pagePath() });
  }, function (err) {
    console.error(err);
    toast("The store couldn't load. Refresh to try again.", "warn");
  });
})();
