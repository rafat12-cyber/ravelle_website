// Ravelle website demo: hash-routed pages, bag, checkout and the scroll
// effects from the reference (slat reveals, scrambled words, drifting type).
(function () {
  "use strict";

  var DATA = window.RAVELLE;
  var PRODUCTS = DATA.products;
  var BY_ID = {};
  PRODUCTS.forEach(function (p) { BY_ID[p.id] = p; });

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var taka = function (n) { return "৳" + n.toLocaleString("en-US"); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Per-viewer storage; the page works without it.
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("ravelle:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("ravelle:" + k, JSON.stringify(v)); } catch (e) {} }
  };
  var cart = store.get("cart", []).filter(function (l) { return BY_ID[l.id]; });
  var saved = store.get("saved", []);

  // ---------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------
  function card(p, i) {
    return (
      '<a class="card" data-line="' + esc(p.line) + '" href="#p-' + p.slug + '" style="--tone:' + p.hex + '">' +
        '<img class="card__img" src="' + p.img[0] + '" alt="' + esc(p.name + " in " + p.color) + '" loading="' + (i < 4 ? "eager" : "lazy") + '">' +
        '<span class="card__type" aria-hidden="true">' + esc(p.label || p.line) + "<small>" + esc(p.color) + "</small></span>" +
        '<span class="card__top"><span class="chip">−' + p.off + "%</span>" +
          '<button class="card__fav" type="button" data-save="' + p.id + '" aria-pressed="' + (saved.indexOf(p.id) > -1) + '" aria-label="Save ' + esc(p.name) + '">' + heart(12) + "</button></span>" +
        '<span class="card__bar"><span class="card__name"><b>' + esc(p.name) + "</b>" +
          '<span class="card__price">' + esc(p.color) + " · " + taka(p.price) + "<s>" + taka(p.was) + "</s></span></span>" +
          '<span class="card__go" aria-hidden="true">›</span></span>' +
      "</a>"
    );
  }
  function heart(n) {
    return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  function grid(list) { return list.map(card).join(""); }

  // A photo that can't load (offline, blocked host) gives way to the type card.
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
  function toast(msg) {
    var t = $("#toast");
    t.innerHTML = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-on"); }, 2600);
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ/#*";
  function scramble(el) {
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
    if (!img || !img.animate || reduce) return;
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
        copy.removeAttribute("loading");
        copy.removeAttribute("class");
        copy.removeAttribute("data-guard");
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
  if (!reduce && "IntersectionObserver" in window) {
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        scramble(en.target);
      });
    }, { threshold: 0.4 });
    // Cards rise into place, then the photo builds in horizontal slats.
    rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        rio.unobserve(el);
        el.classList.add("is-in");
        if (el.classList.contains("slat")) setTimeout(function () { buildSlats(el); }, 380);
      });
    }, { threshold: 0.2 });
  }
  function activate(root, skip) {
    guardImages(root);
    if (!io) return;
    $$("[data-scramble]", root).forEach(function (el) { if (el !== skip) io.observe(el); });
    $$(".reveal", root).forEach(function (el) { rio.observe(el); });
  }

  // Scroll: drifting marquees and the lookbook stack
  var lookbook = document.getElementById("lookbook");
  var lookImgs = lookbook ? $$(".look__img", lookbook) : [];
  var LOOKS = [
    ["Fearless tee<br>Black wash", "● Oversized tee<br>Wide trouser"],
    ["Fearless tee<br>Ocean blue", "● Oversized tee<br>Black trouser"],
    ["Fearless tee<br>Yellow wash", "● Oversized tee<br>Black trouser"],
    ["RVCHL tee<br>Yellow", "● Oversized tee<br>Star wide-leg"]
  ];
  var current = 0;
  function onScroll() {
    var vh = window.innerHeight;
    $$("[data-drift]").forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (!r.height || r.bottom < -200 || r.top > vh + 200) return;
      var p = (vh - r.top) / (vh + r.height);
      el.style.transform = "translateX(" + (p * 30 * parseFloat(el.dataset.drift)) + "%)";
    });
    if (lookbook && lookbook.offsetParent) {
      var b = lookbook.getBoundingClientRect();
      var prog = Math.min(0.999, Math.max(0, -b.top / (b.height - vh)));
      var idx = Math.floor(prog * lookImgs.length);
      if (idx !== current) {
        lookImgs[current].classList.remove("is-on");
        lookImgs[idx].classList.add("is-on");
        $("#lookName").innerHTML = LOOKS[idx][0];
        $("#lookItems").innerHTML = LOOKS[idx][1];
        $("#lookCount").textContent = "0" + (idx + 1) + " / 0" + lookImgs.length;
        current = idx;
      }
    }
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { onScroll(); ticking = false; });
  }, { passive: true });

  // ---------------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------------
  var homeGrid = $("#grid");
  var homeList = PRODUCTS.filter(function (p) { return p.local; }).concat(PRODUCTS.filter(function (p) { return !p.local; })).slice(0, 12);
  homeGrid.innerHTML = grid(homeList);
  $$(".filters .filter").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = btn.dataset.filter;
      $$(".filters .filter").forEach(function (b) {
        b.classList.toggle("is-on", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      $$(".card", homeGrid).forEach(function (c) { c.hidden = f !== "all" && c.dataset.line !== f; });
    });
  });
  var heroWord = $(".hero [data-scramble]");
  var intro = document.documentElement.classList.contains("js-intro");
  if (heroWord && intro && io) setTimeout(function () { scramble(heroWord); }, 2350);
  // Play the intro once; coming back to home later shouldn't replay it.
  setTimeout(function () { document.documentElement.classList.remove("js-intro"); }, 3600);
  activate($('[data-view="home"]'), intro ? heroWord : null);

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------
  var homeView = $('[data-view="home"]');
  var pageView = $('[data-view="page"]');
  var page = $("#page");
  var pagehead = $("#pagehead");
  var navTemplate = $(".hero .nav");

  function head(crumb, title, sub) {
    pagehead.innerHTML = '<div class="hero__panel pagehead__panel"></div>';
    var panel = pagehead.firstChild;
    panel.appendChild(navTemplate.cloneNode(true));
    panel.insertAdjacentHTML("beforeend",
      '<div class="pagehead__copy">' +
        '<p class="eyebrow">' + crumb + "</p>" +
        '<h1 class="display display--page">' + title + "</h1>" +
        (sub ? '<p class="pagehead__sub">' + sub + "</p>" : "") +
      "</div>");
    syncCount();
  }

  var SHOPS = {
    "shop": { crumb: "Shop", title: 'Shop <em class="alt" data-scramble>all</em>', list: function () { return PRODUCTS; } },
    "men": { crumb: "Shop / Men", title: '<em class="alt" data-scramble>Men</em>', list: function () { return PRODUCTS; } },
    "t-shirt": { crumb: "Shop / Men / T-shirt", title: 'Oversized <em class="alt" data-scramble>tees</em>', list: function () { return PRODUCTS; } },
    "new-in": { crumb: "Shop / New in", title: 'New <em class="alt" data-scramble>in</em>', list: function () { return PRODUCTS.filter(function (p) { return p.isNew; }); } },
    "on-sale": { crumb: "Shop / On sale", title: 'Raining <em class="alt" data-scramble>offers</em>', sub: "Every tee is marked down for summer, up to 31% off.", list: function () { return PRODUCTS; } }
  };

  function viewShop(key) {
    var cfg = SHOPS[key];
    var base = cfg.list();
    head(cfg.crumb, cfg.title, cfg.sub || base.length + " pieces. Prices in BDT, sizes M to 2XL.");
    var lines = ["All"].concat(Object.keys(DATA.lines));
    var colors = [];
    base.forEach(function (p) { if (!colors.some(function (c) { return c.name === p.color; })) colors.push({ name: p.color, hex: p.hex }); });
    page.innerHTML =
      '<section class="shop">' +
        '<div class="toolbar">' +
          '<div class="filters filters--left" role="group" aria-label="Line">' +
            lines.map(function (l, i) { return '<button class="filter' + (i ? "" : " is-on") + '" type="button" data-line="' + esc(l) + '">' + esc(l === "574" ? "574 Acid Wash" : l) + "</button>"; }).join("") +
          "</div>" +
          '<div class="toolbar__right">' +
            '<div class="swatches" role="group" aria-label="Colour">' +
              colors.map(function (c) { return '<button class="swatch" type="button" data-color="' + esc(c.name) + '" style="--sw:' + c.hex + '" aria-pressed="false" title="' + esc(c.name) + '"><span class="sr">' + esc(c.name) + "</span></button>"; }).join("") +
            "</div>" +
            '<label class="sort"><span class="sr">Sort</span><select id="sort">' +
              '<option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="new">Newest</option>' +
            "</select></label>" +
          "</div>" +
        "</div>" +
        '<p class="shop__count mono" id="count"></p>' +
        '<div class="grid" id="shopGrid"></div>' +
        '<div class="empty" id="shopEmpty" hidden><p>Nothing matches those filters.</p><button class="pill pill--dark pill--sm" type="button" id="clearFilters">Clear filters</button></div>' +
      "</section>";
    var state = { line: "All", color: null, sort: "featured" };
    function draw() {
      var list = base.filter(function (p) {
        return (state.line === "All" || p.line === state.line) && (!state.color || p.color === state.color);
      }).slice();
      if (state.sort === "low") list.sort(function (a, b) { return a.price - b.price || a.order - b.order; });
      if (state.sort === "high") list.sort(function (a, b) { return b.price - a.price || a.order - b.order; });
      if (state.sort === "new") list.sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || a.order - b.order; });
      $("#shopGrid").innerHTML = grid(list);
      $("#count").textContent = list.length + (list.length === 1 ? " product" : " products");
      $("#shopEmpty").hidden = list.length > 0;
      guardImages($("#shopGrid"));
    }
    $$(".toolbar .filter", page).forEach(function (b) {
      b.addEventListener("click", function () {
        state.line = b.dataset.line;
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
    $("#sort").addEventListener("change", function (e) { state.sort = e.target.value; draw(); });
    $("#clearFilters").addEventListener("click", function () {
      state.line = "All"; state.color = null;
      $$(".toolbar .filter", page).forEach(function (x, i) { x.classList.toggle("is-on", i === 0); });
      $$(".swatch", page).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
      draw();
    });
    draw();
  }

  function viewProduct(slug) {
    var p = PRODUCTS.filter(function (x) { return x.slug === slug; })[0];
    if (!p) return viewMissing();
    var related = PRODUCTS.filter(function (x) { return x !== p; }).sort(function (a, b) { return (b.local ? 1 : 0) - (a.local ? 1 : 0); }).slice(0, 4);
    pagehead.innerHTML = "";
    var mini = document.createElement("div");
    mini.className = "hero__panel pagehead__panel pagehead__panel--mini";
    mini.appendChild(navTemplate.cloneNode(true));
    pagehead.appendChild(mini);
    syncCount();
    var isSaved = saved.indexOf(p.id) > -1;
    page.innerHTML =
      '<section class="pd">' +
        '<div class="pd__gallery">' +
          '<div class="pd__main slat" data-fallback style="--tone:' + p.hex + '">' +
            '<img id="pdMain" data-guard src="' + p.img[0] + '" alt="' + esc(p.name + " in " + p.color) + '">' +
            '<span class="card__type" aria-hidden="true">' + esc(p.label || p.line) + "<small>" + esc(p.color) + "</small></span>" +
            '<span class="pd__tag mono">−' + p.off + "% · Summer offer</span>" +
          "</div>" +
          '<div class="pd__thumbs" role="group" aria-label="Photos">' +
            p.img.map(function (src, i) {
              return '<button class="pd__thumb' + (i ? "" : " is-on") + '" type="button" data-src="' + src + '" data-fallback style="--tone:' + p.hex + '" aria-label="Photo ' + (i + 1) + '">' +
                '<img data-guard src="' + src + '" alt="" loading="lazy"><span class="card__type" aria-hidden="true"><small>' + (i + 1) + "</small></span></button>";
            }).join("") +
          "</div>" +
        "</div>" +
        '<div class="pd__info">' +
          '<p class="eyebrow"><a href="#shop">Shop</a> / <a href="#t-shirt">T-shirt</a> / ' + esc(p.line) + "</p>" +
          '<h1 class="pd__name">' + esc(p.label || p.line) + ' <em class="alt" data-scramble>oversized</em> T-shirt <span class="pd__color">' + esc(p.color) + "</span></h1>" +
          '<p class="pd__price"><b>' + taka(p.price) + "</b><s>" + taka(p.was) + '</s><span class="chip chip--sale">Save ' + taka(p.was - p.price) + "</span></p>" +
          '<p class="pd__about">' + esc(p.about) + "</p>" +
          '<div class="pd__block"><p class="pd__label mono">Size · <span id="sizeLabel">Choose one</span></p>' +
            '<div class="sizes" role="radiogroup" aria-label="Size">' + p.sizes.map(function (s) {
              return '<button class="size" type="button" role="radio" aria-checked="false" data-size="' + s + '">' + s + "</button>";
            }).join("") + "</div>" +
            '<p class="pd__hint">Fits true to size. Our model is 6\'2" and wears L.</p></div>' +
          '<div class="pd__buy">' +
            '<div class="qty"><button type="button" data-q="-1" aria-label="Fewer">−</button><span id="qty">1</span><button type="button" data-q="1" aria-label="More">+</button></div>' +
            '<button class="pill pill--dark pd__add" type="button" id="addBag">Add to bag · ' + taka(p.price) + "</button>" +
            '<button class="icon-btn icon-btn--line pd__save" type="button" data-save="' + p.id + '" aria-pressed="' + isSaved + '" aria-label="Save">' + heart(15) + "</button>" +
          "</div>" +
          '<div class="acc">' +
            '<details open><summary>Details</summary><ul class="ticks"><li>Oversized fit with a dropped shoulder</li><li>' + esc(p.color) + " colourway of the " + esc(p.line) + ' line</li><li>Sizes M, L, XL and 2XL</li></ul></details>' +
            '<details><summary>Fit &amp; model</summary><table class="spec"><tr><th>Model height</th><td>6\'2" (183 cm)</td></tr><tr><th>Chest</th><td>38" (97 cm)</td></tr><tr><th>Shoulder</th><td>18.5" (47 cm)</td></tr><tr><th>Wears</th><td>Size L top, 32 waist bottoms</td></tr></table></details>' +
            '<details><summary>Delivery &amp; payment</summary><p>Delivery charge and timing are confirmed with you by phone after you order. You can also order this piece on <a class="u" href="' + p.url + '" target="_blank" rel="noopener">ravellebd.com</a>.</p></details>' +
          "</div>" +
        "</div>" +
      "</section>" +
      '<section class="related"><div class="section-head"><p class="eyebrow">Complete the look</p><h2 class="h2">Pair it <em class="alt" data-scramble>with</em></h2></div>' +
        '<div class="grid">' + grid(related) + "</div></section>";

    var size = null, qty = 1;
    $$(".size", page).forEach(function (b) {
      b.addEventListener("click", function () {
        size = b.dataset.size;
        $$(".size", page).forEach(function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); });
        $("#sizeLabel").textContent = size;
        $(".sizes").classList.remove("is-missing");
      });
    });
    $$(".qty button", page).forEach(function (b) {
      b.addEventListener("click", function () {
        qty = Math.max(1, Math.min(9, qty + parseInt(b.dataset.q, 10)));
        $("#qty").textContent = qty;
        $("#addBag").textContent = "Add to bag · " + taka(p.price * qty);
      });
    });
    $("#addBag").addEventListener("click", function () {
      if (!size) {
        $(".sizes").classList.add("is-missing");
        $("#sizeLabel").textContent = "Pick a size first";
        return;
      }
      addToBag(p.id, size, qty);
      openBag();
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
    setTimeout(function () { buildSlats(main); }, 120);
  }

  function collectionCard(c, i) {
    return '<a class="drop drop--sm reveal slat dark" href="#c-' + c.slug + '">' +
      '<img src="' + c.img + '" alt="" loading="lazy">' +
      '<span class="drop__meta mono">' + c.n + " / The House</span>" +
      '<span class="drop__title"><span data-scramble>' + esc(c.name) + '</span><span class="fade drop__mood">' + esc(c.mood) + "</span></span>" +
      '<span class="chip chip--ghost">● First drop soon</span></a>';
  }

  function viewHouse() {
    head("The House", 'The <em class="alt" data-scramble>House</em>', "Five collections from Ravelle, each with its own mood.");
    page.innerHTML = '<section class="house house--page"><div class="house__grid">' + DATA.collections.map(collectionCard).join("") + "</div></section>" + shopNow("While you wait", "Shop the <em class=\"alt\" data-scramble>summer</em> tees");
  }

  function notify(id) {
    return '<form class="notify" data-notify><label class="sr" for="' + id + '">Email</label>' +
      '<input id="' + id + '" type="email" required placeholder="Email for drop alerts"><button class="pill pill--dark pill--sm" type="submit">Notify me</button></form>' +
      '<p class="notify__ok mono" hidden>You\'re on the list. We\'ll email you when it drops.</p>';
  }
  function shopNow(eyebrow, title) {
    var list = PRODUCTS.filter(function (p) { return p.local; }).concat(PRODUCTS.filter(function (p) { return !p.local && p.isNew; })).slice(0, 4);
    return '<section class="related"><div class="section-head"><p class="eyebrow">' + eyebrow + '</p><h2 class="h2">' + title + "</h2>" +
      '<a class="eyebrow eyebrow--link" href="#shop">All products →</a></div><div class="grid">' + grid(list) + "</div></section>";
  }

  function viewCollection(slug) {
    var c = DATA.collections.filter(function (x) { return x.slug === slug; })[0];
    if (!c) return viewMissing();
    head("The House / " + c.n, esc(c.name).replace(/(\S+)$/, '<em class="alt" data-scramble>$1</em>'), esc(c.mood));
    page.innerHTML =
      '<section class="soon">' +
        '<div class="soon__card reveal slat dark"><img src="' + c.img + '" alt="" loading="lazy">' +
          '<span class="drop__meta mono">' + c.n + " / " + esc(c.name) + "</span>" +
          '<p class="soon__big" aria-hidden="true">' + esc(c.name.split(" ")[0]) + "</p></div>" +
        '<div class="soon__copy"><p class="eyebrow">Coming to the House</p><h2 class="h2">First pieces <em class="alt" data-scramble>drop</em> soon</h2>' +
          "<p>Nothing from " + esc(c.name) + " is in stock yet. Leave your email and we'll tell you the day it goes live.</p>" + notify("n-" + c.slug) +
          '<a class="pill pill--light pill--sm" href="#the-house">See all five collections</a></div>' +
      "</section>" + shopNow("Live now", "Shop the <em class=\"alt\" data-scramble>summer</em> tees");
  }

  var SOON = { "polo": "Polo", "half-shirt": "Half shirt", "full-shirt": "Full shirt", "trouser": "Trouser", "denim-pant": "Denim pant" };
  function viewSoon(name, crumb, img) {
    head(crumb, '<em class="alt" data-scramble>' + esc(name) + "</em>", "Not in stock yet.");
    page.innerHTML =
      '<section class="soon">' +
        '<div class="soon__card reveal slat dark"><img src="' + img + '" alt="" loading="lazy"><p class="soon__big" aria-hidden="true">' + esc(name) + "</p></div>" +
        '<div class="soon__copy"><p class="eyebrow">Coming soon</p><h2 class="h2">' + esc(name) + ' is <em class="alt" data-scramble>next</em></h2>' +
          "<p>We're still working on this line. Leave your email and we'll tell you when it launches.</p>" + notify("n-soon") + "</div>" +
      "</section>" + shopNow("Live now", "Shop the <em class=\"alt\" data-scramble>summer</em> tees");
  }

  function viewSaved() {
    var list = PRODUCTS.filter(function (p) { return saved.indexOf(p.id) > -1; });
    head("Account / Saved", 'Saved <em class="alt" data-scramble>pieces</em>', list.length ? list.length + " saved on this device." : "Tap the heart on any piece to keep it here.");
    page.innerHTML = '<section class="shop">' + (list.length ? '<div class="grid">' + grid(list) + "</div>" :
      '<div class="empty"><p>Nothing saved yet.</p><a class="pill pill--dark pill--sm" href="#shop">Browse the shop</a></div>') + "</section>";
  }

  function viewAccount() {
    head("Account", 'Your <em class="alt" data-scramble>account</em>', "Sign in to see orders and saved addresses.");
    page.innerHTML =
      '<section class="forms">' +
        '<form class="panel" data-demo-form><h2 class="panel__title">Sign in</h2>' +
          '<label class="field"><span>Email or phone</span><input id="si-user" required autocomplete="username"></label>' +
          '<label class="field"><span>Password</span><input id="si-pass" type="password" required autocomplete="current-password"></label>' +
          '<button class="pill pill--dark" type="submit">Sign in</button></form>' +
        '<form class="panel" data-demo-form><h2 class="panel__title">Create an account</h2>' +
          '<label class="field"><span>Full name</span><input id="re-name" required autocomplete="name"></label>' +
          '<label class="field"><span>Phone</span><input id="re-phone" type="tel" required autocomplete="tel" placeholder="01XXXXXXXXX"></label>' +
          '<label class="field"><span>Email</span><input id="re-email" type="email" autocomplete="email"></label>' +
          '<label class="field"><span>Password</span><input id="re-pass" type="password" required autocomplete="new-password"></label>' +
          '<button class="pill pill--light" type="submit">Create account</button></form>' +
      "</section>";
  }

  function viewAbout() {
    head("About", 'Designed for presence, <span class="line"><span>not <em class="alt" data-scramble>attention.</em></span></span>');
    page.innerHTML =
      '<section class="about">' +
        '<p class="about__lead">Ravelle is a lifestyle brand from Bangladesh. We make heavyweight oversized pieces for people who would rather be noticed for how they carry themselves than for a logo.</p>' +
        '<div class="about__cols">' +
          '<figure class="collage__img reveal slat"><img src="assets/img/d-black.jpg" alt="Fearless print detail" loading="lazy"></figure>' +
          '<div class="about__pillars">' +
            '<div><p class="mono">01 — Fit</p><h3>Oversized, on purpose</h3><p>Dropped shoulders and a boxy body, cut in M to 2XL.</p></div>' +
            '<div><p class="mono">02 — Wash</p><h3>Washes with character</h3><p>Dip-dyes, sun-fades and acid washes give each colourway its own look.</p></div>' +
            '<div><p class="mono">03 — The House</p><h3>Five collections</h3><p>Nior Division, Saint &amp; Sinners Hype, Essential, Obsedian Virtue and Monarch Drop.</p></div>' +
          "</div>" +
          '<figure class="collage__img reveal slat dark about__cut"><img src="assets/img/c-yellow.webp" alt="Model in the Fearless tee in yellow" loading="lazy"></figure>' +
        "</div>" +
        '<div class="center"><a class="pill pill--dark pill--arrow" href="#shop">Shop the collection <span class="pill__arrow" aria-hidden="true">↗</span></a></div>' +
      "</section>";
  }

  function viewCheckout() {
    head("Bag / Checkout", '<em class="alt" data-scramble>Checkout</em>', "Cash on delivery or bKash. We'll call to confirm your order.");
    if (!cart.length) {
      page.innerHTML = '<section class="shop"><div class="empty"><p>Your bag is empty.</p><a class="pill pill--dark pill--sm" href="#shop">Shop the collection</a></div></section>';
      return;
    }
    page.innerHTML =
      '<section class="checkout">' +
        '<form class="checkout__form" id="checkoutForm">' +
          '<fieldset class="panel"><legend class="panel__title">Contact</legend>' +
            '<label class="field"><span>Full name</span><input id="co-name" required autocomplete="name"></label>' +
            '<label class="field"><span>Phone</span><input id="co-phone" type="tel" required autocomplete="tel" pattern="01[0-9]{9}" placeholder="01XXXXXXXXX"></label>' +
            '<label class="field"><span>Email (optional)</span><input id="co-email" type="email" autocomplete="email"></label></fieldset>' +
          '<fieldset class="panel"><legend class="panel__title">Delivery</legend>' +
            '<label class="field"><span>Address</span><textarea id="co-address" required rows="3" autocomplete="street-address" placeholder="House, road, area"></textarea></label>' +
            '<div class="field-row"><label class="field"><span>District</span><input id="co-district" required placeholder="Dhaka"></label>' +
            '<label class="field"><span>Area</span><select id="co-zone"><option>Inside Dhaka</option><option>Outside Dhaka</option></select></label></div>' +
            '<label class="field"><span>Order note (optional)</span><input id="co-note" placeholder="Best time to call, landmark…"></label></fieldset>' +
          '<fieldset class="panel"><legend class="panel__title">Payment</legend>' +
            '<label class="radio"><input type="radio" name="pay" id="pay-cod" value="Cash on delivery" checked><span><b>Cash on delivery</b>Pay when your order arrives.</span></label>' +
            '<label class="radio"><input type="radio" name="pay" id="pay-bkash" value="bKash"><span><b>bKash</b>We send payment details when we confirm by phone.</span></label></fieldset>' +
          '<button class="pill pill--dark checkout__submit" type="submit">Place order · <span data-total></span></button>' +
          '<p class="checkout__note mono">Demo: placing an order here sends nothing.</p>' +
        "</form>" +
        '<aside class="summary panel"><h2 class="panel__title">Order summary</h2><div id="summaryLines"></div>' +
          '<dl class="totals"><div><dt>Subtotal</dt><dd data-subtotal></dd></div><div><dt>You save</dt><dd data-saving></dd></div><div><dt>Delivery</dt><dd>Confirmed by phone</dd></div><div class="totals__grand"><dt>Total</dt><dd data-total></dd></div></dl>' +
        "</aside>" +
      "</section>";
    drawSummary();
    $("#checkoutForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var order = "RV-" + String(Date.now()).slice(-6);
      var name = $("#co-name").value.trim().split(" ")[0];
      var pay = $('input[name="pay"]:checked').value;
      var total = totals().total;
      cart = []; store.set("cart", cart); syncCount(); drawBag();
      head("Order placed", 'Thank <em class="alt" data-scramble>you!</em>', esc(name) + ", your order " + order + " · " + taka(total) + " · " + esc(pay));
      page.innerHTML = '<section class="done panel"><p class="mono">Order ' + order + '</p><h2 class="h2">We\'ll call you to <em class="alt">confirm</em></h2>' +
        "<p>This is a demo, so no order was sent and no one will call. On the live site, Ravelle would confirm by phone before delivery.</p>" +
        '<a class="pill pill--dark" href="#shop">Keep shopping</a></section>';
      activate(pagehead);
      window.scrollTo(0, 0);
    });
  }
  function drawSummary() {
    var box = $("#summaryLines");
    if (!box) return;
    if (!cart.length) {
      page.innerHTML = '<section class="shop"><div class="empty"><p>Your bag is empty.</p><a class="pill pill--dark pill--sm" href="#shop">Shop the collection</a></div></section>';
      return;
    }
    box.innerHTML = cart.map(lineHTML).join("");
    guardImages(box);
    var t = totals();
    $$("[data-subtotal]").forEach(function (el) { el.textContent = taka(t.total); });
    $$("[data-saving]").forEach(function (el) { el.textContent = "−" + taka(t.saving); });
    $$("[data-total]").forEach(function (el) { el.textContent = taka(t.total); });
  }

  function viewMissing() {
    head("404", 'Page <em class="alt" data-scramble>missing</em>', "That link doesn't go anywhere.");
    page.innerHTML = '<section class="shop"><div class="empty"><a class="pill pill--dark pill--sm" href="#home">Back to home</a></div></section>';
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------
  var HOME_ANCHORS = { "house": 1, "arrivals": 1, "lookbook": 1, "top": 1 };
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    closeBag();
    if (!h || h === "home" || HOME_ANCHORS[h]) {
      pageView.hidden = true;
      homeView.hidden = false;
      document.title = "Ravelle";
      var target = HOME_ANCHORS[h] && h !== "top" ? document.getElementById(h) : null;
      if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
      onScroll();
      return;
    }
    homeView.hidden = true;
    pageView.hidden = false;
    if (SHOPS[h]) viewShop(h);
    else if (h.indexOf("p-") === 0) viewProduct(h.slice(2));
    else if (h === "the-house") viewHouse();
    else if (h.indexOf("c-") === 0) viewCollection(h.slice(2));
    else if (h === "women") viewSoon("Women", "Shop / Women", "assets/img/c-blue.webp");
    else if (h.indexOf("soon-") === 0 && SOON[h.slice(5)]) viewSoon(SOON[h.slice(5)], "Shop / Men / " + SOON[h.slice(5)], "assets/img/c-black.webp");
    else if (h === "checkout") viewCheckout();
    else if (h === "account") viewAccount();
    else if (h === "saved") viewSaved();
    else if (h === "about") viewAbout();
    else viewMissing();
    var t = $("h1", pagehead) || $("h1", page);
    document.title = (t ? t.textContent.replace(/\s+/g, " ").trim() + " · " : "") + "Ravelle";
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
      var p = BY_ID[l.id];
      t.total += p.price * l.qty; t.saving += (p.was - p.price) * l.qty; t.count += l.qty;
      return t;
    }, { total: 0, saving: 0, count: 0 });
  }
  function addToBag(id, size, qty) {
    var line = cart.filter(function (l) { return l.id === id && l.size === size; })[0];
    if (line) line.qty = Math.min(9, line.qty + qty); else cart.push({ id: id, size: size, qty: qty });
    saveCart();
  }
  function lineHTML(l, i) {
    var p = BY_ID[l.id];
    return '<div class="line-item" data-i="' + i + '">' +
      '<a class="line-item__img" href="#p-' + p.slug + '" data-fallback style="--tone:' + p.hex + '"><img data-guard src="' + p.img[0] + '" alt=""><span class="card__type" aria-hidden="true"><small>' + esc(p.line) + "</small></span></a>" +
      '<div class="line-item__info"><a class="line-item__name" href="#p-' + p.slug + '">' + esc(p.name) + "</a>" +
        '<p class="mono">' + esc(p.color) + " · Size " + l.size + "</p>" +
        '<div class="qty qty--sm"><button type="button" data-line-q="-1" aria-label="Fewer">−</button><span>' + l.qty + '</span><button type="button" data-line-q="1" aria-label="More">+</button></div></div>' +
      '<div class="line-item__end"><b>' + taka(p.price * l.qty) + '</b><button class="line-item__rm" type="button" data-line-rm>Remove</button></div>' +
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
    var t = totals();
    foot.innerHTML =
      '<dl class="totals"><div><dt>Subtotal</dt><dd>' + taka(t.total) + '</dd></div><div><dt>You save</dt><dd>−' + taka(t.saving) + "</dd></div></dl>" +
      '<a class="pill pill--dark drawer__cta" href="#checkout">Checkout · ' + taka(t.total) + "</a>" +
      '<p class="mono drawer__note">Delivery charge confirmed by phone</p>';
  }
  function syncCount() {
    var n = totals().count;
    $$("[data-bag-count]").forEach(function (el) { el.textContent = n; el.hidden = !n; });
    $$("[data-bag-count-text]").forEach(function (el) { el.textContent = "(" + n + ")"; });
  }
  function syncBag() {
    syncCount();
    drawBag();
    drawSummary();
  }
  function openBag() {
    drawBag();
    $("#bag").classList.add("is-open");
    $("#bag").setAttribute("aria-hidden", "false");
    $(".scrim").hidden = false;
    document.body.classList.add("is-locked");
  }
  function closeBag() {
    $("#bag").classList.remove("is-open");
    $("#bag").setAttribute("aria-hidden", "true");
    $(".scrim").hidden = true;
    document.body.classList.remove("is-locked");
  }

  // ---------------------------------------------------------------------------
  // Delegated clicks and forms
  // ---------------------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var t = e.target;
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
    if (t.closest("[data-open-bag]")) { openBag(); return; }
    if (t.closest("[data-close-bag]")) { closeBag(); return; }
    var row = t.closest(".line-item");
    if (row) {
      var i = parseInt(row.dataset.i, 10);
      var q = t.closest("[data-line-q]");
      if (q) { cart[i].qty = Math.max(1, Math.min(9, cart[i].qty + parseInt(q.dataset.lineQ, 10))); saveCart(); }
      if (t.closest("[data-line-rm]")) { cart.splice(i, 1); saveCart(); }
    }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeBag(); });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.matches("[data-notify], #news")) {
      e.preventDefault();
      f.hidden = true;
      var ok = f.id === "news" ? $("#newsOk") : f.nextElementSibling;
      if (ok) ok.hidden = false;
    } else if (f.matches("[data-demo-form]")) {
      e.preventDefault();
      toast('Demo only. Accounts live on <a href="https://ravellebd.com/my-account/" target="_blank" rel="noopener">ravellebd.com</a>');
    }
  });

  syncBag();
  route();
})();
