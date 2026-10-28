// Ravelle admin. Edits a draft of content.js (home page text and images,
// products), shows it in a live preview and publishes it to GitHub, which the
// hosted site deploys from. The draft lives in this browser's localStorage.
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var taka = function (n) { return "৳" + Number(n || 0).toLocaleString("en-US"); };
  var slugify = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); };
  var get = function (obj, path) { return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj); };
  var set = function (obj, path, v) {
    var keys = path.split("."), last = keys.pop();
    var target = keys.reduce(function (o, k) { if (o[k] == null) o[k] = {}; return o[k]; }, obj);
    target[last] = v;
  };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("ravelle:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("ravelle:" + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem("ravelle:" + k); } catch (e) {} }
  };

  var PUBLISHED = clone(window.RAVELLE_CONTENT);
  var draft = store.get("draft", null);
  if (!draft || !draft.home || !draft.products) draft = clone(PUBLISHED);

  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-on"); }, 2800);
  }

  // ---------------------------------------------------------------------------
  // Draft saving and status
  // ---------------------------------------------------------------------------
  var saveTimer, frameStale = false;
  function save(now) {
    clearTimeout(saveTimer);
    var run = function () {
      if (!store.set("draft", draft)) toast("This browser is out of space for the draft. Publish now, or use smaller images.");
      status();
    };
    if (now) run(); else saveTimer = setTimeout(run, 250);
  }
  function isDirty() { return JSON.stringify(draft) !== JSON.stringify(PUBLISHED); }
  function status() {
    var el = $("#status"), dirty = isDirty();
    el.textContent = dirty ? "Draft · not published" : "Up to date";
    el.classList.toggle("is-dirty", dirty);
    if (!$('[data-view="publish"]').hidden) drawChanges();
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  function showTab(name) {
    $$(".tab").forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".view").forEach(function (v) { v.hidden = v.dataset.view !== name; });
    if (name === "home" && frameStale) { reloadFrame(); frameStale = false; }
    if (name === "publish") drawChanges();
    try { history.replaceState(null, "", "#" + name); } catch (e) {}
  }
  $$("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });

  // ---------------------------------------------------------------------------
  // Images: upload (resized in the browser), library, links
  // ---------------------------------------------------------------------------
  var LOCAL_IMAGES = [
    "c-black.webp", "c-blue.webp", "c-yellow.webp", "c-rvchl.webp",
    "p-black.jpg", "p-blue.jpg", "p-yellow.jpg", "p-rvchl.jpg",
    "d-black.jpg", "d-blue.jpg", "d-yellow.jpg", "d-rvchl.jpg",
    "a-black.jpg", "a-blue.jpg", "a-yellow.jpg", "a-rvchl.jpg", "logo.png"
  ].map(function (f) { return "assets/img/" + f; });

  function allImages() {
    var seen = {}, out = [];
    var add = function (s) { if (typeof s === "string" && s && !seen[s]) { seen[s] = 1; out.push(s); } };
    walk(draft, function (v) { if (/^data:image\//.test(v)) add(v); });
    LOCAL_IMAGES.forEach(add);
    walk(draft.home, function (v) { if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(v)) add(v); });
    draft.products.forEach(function (p) { (p.img || []).forEach(add); });
    return out;
  }
  function walk(o, fn) {
    if (typeof o === "string") fn(o);
    else if (Array.isArray(o)) o.forEach(function (x) { walk(x, fn); });
    else if (o && typeof o === "object") Object.keys(o).forEach(function (k) { walk(o[k], fn); });
  }

  // Large photos are scaled to 1600px on the long side and saved as WebP,
  // which keeps transparency for cut-outs.
  function readImage(file, done) {
    if (!file || !/^image\//.test(file.type)) { toast("That file isn't an image."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL("image/webp", 0.86);
        if (out.indexOf("data:image/webp") !== 0) out = c.toDataURL("image/jpeg", 0.86);
        done(out);
      };
      img.onerror = function () { toast("Couldn't read that image."); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  var fileInput = $("#file"), onFile = null;
  fileInput.addEventListener("change", function () {
    var f = fileInput.files[0];
    fileInput.value = "";
    if (f && onFile) readImage(f, onFile);
  });
  function upload(cb) { onFile = cb; fileInput.click(); }

  var lib = $("#lib"), onPick = null;
  function library(cb) {
    onPick = cb;
    $("#libUrl").value = "";
    $("#libGrid").innerHTML = allImages().map(function (src) {
      return '<button type="button" class="lib__item" data-src="' + esc(src) + '"><img src="' + esc(srcOf(src)) + '" alt="" loading="lazy"></button>';
    }).join("");
    if (lib.showModal) lib.showModal(); else lib.setAttribute("open", "");
  }
  function closeLib() { if (lib.close) lib.close(); else lib.removeAttribute("open"); }
  $("#libGrid").addEventListener("click", function (e) {
    var b = e.target.closest(".lib__item");
    if (!b || !onPick) return;
    onPick(b.dataset.src);
    closeLib();
  });
  $("#libUse").addEventListener("click", function () {
    var v = $("#libUrl").value.trim();
    if (!v) return;
    if (onPick) onPick(v);
    closeLib();
  });

  // Photos published from here may not be deployed yet, so the admin keeps
  // its own copy until they are no longer used.
  var uploads = store.get("uploads", {});
  var srcOf = function (src) { return uploads[src] || src; };

  function shortPath(src) {
    if (!src) return "No image";
    if (src.indexOf("data:") === 0) return "New upload · publishes with the site";
    return src.replace(/^https?:\/\/[^/]+\/wp-content\/uploads\//, "ravellebd.com/…/");
  }

  // ---------------------------------------------------------------------------
  // Home page editor
  // ---------------------------------------------------------------------------
  // [path, label, type, hint]
  var HOME = [
    { title: "Hero", tag: "Top of page", fields: [
      ["hero.line1", "Headline, first line"],
      ["hero.lead", "Headline, second line"],
      ["hero.accent", "Highlighted word", "text", "Shown in the thin style at the end of the second line."],
      ["hero.image", "Model photo", "img", "A cut-out with a transparent background looks best."],
      ["hero.imageAlt", "Describe the photo", "text", "Read out by screen readers."],
      ["hero.cta1", "Dark button"],
      ["hero.cta2", "Light button"],
      ["hero.text", "Side text", "area"],
      ["hero.link", "Side link"],
      { group: "Small round photos", fields: [["hero.avatars.0", "Photo 1", "img"], ["hero.avatars.1", "Photo 2", "img"], ["hero.avatars.2", "Photo 3", "img"]] },
      { group: "Lookbook button", fields: [["hero.reelImage", "Thumbnail", "img"], ["hero.reelLabel", "Label"]] }
    ] },
    { title: "Collage", tag: "Section 2", fields: [
      ["collage.word", "Big background word"],
      ["collage.imageA", "Left photo", "img"],
      ["collage.imageB", "Middle photo", "img"],
      ["collage.imageC", "Right photo", "img"],
      { group: "Note 1", fields: [["collage.note1Title", "Label"], ["collage.note1Text", "Text", "area"]] },
      { group: "Note 2", fields: [["collage.note2Title", "Label"], ["collage.note2Text", "Text", "area"]] }
    ] },
    { title: "The House", tag: "Section 3", fields: [
      ["house.eyebrow", "Small label"],
      ["house.titleStart", "Title, before the highlight"],
      ["house.accent", "Highlighted word"],
      ["house.titleEnd", "Title, after the highlight", "area", "Press Enter for a new line."],
      ["house.aside", "Side text", "area"],
      { group: "Card 1", fields: [["house.card1.image", "Photo", "img"], ["house.card1.meta", "Small text", "area"], ["house.card1.title", "Title", "area", "One line per row, up to four rows."], ["house.card1.chip", "Badge"], ["house.card1.link", "Opens", "link"]] },
      { group: "Card 2", fields: [["house.card2.image", "Photo", "img"], ["house.card2.meta", "Small text", "area"], ["house.card2.title", "Title", "area", "One line per row, up to four rows."], ["house.card2.chip", "Badge"], ["house.card2.link", "Opens", "link"]] }
    ] },
    { title: "Offer poster", tag: "Section 4", fields: [
      ["poster.kicker", "Small label"],
      ["poster.title", "Title", "area", "Press Enter for a new line."],
      ["poster.image", "Photo", "img"],
      ["poster.imageAlt", "Describe the photo"],
      ["poster.cta", "Button"],
      ["poster.marqueeTop", "Running text, top"],
      ["poster.marqueeBottom", "Running text, bottom"]
    ] },
    { title: "New arrivals", tag: "Section 5", fields: [
      ["arrivals.eyebrow", "Small label"],
      ["arrivals.titleStart", "Title, before the highlight"],
      ["arrivals.accent", "Highlighted word"],
      ["arrivals.titleEnd", "Title, after the highlight"],
      ["", "The products in this grid come from the Products tab.", "note"]
    ] },
    { title: "Lookbook", tag: "Section 6", fields: [
      ["lookbook.marqueeBack", "Running text, behind"],
      ["lookbook.marqueeFront", "Running text, in front"],
      { group: "Look 1", fields: [["lookbook.looks.0.image", "Photo", "img"], ["lookbook.looks.0.name", "Name", "area"], ["lookbook.looks.0.items", "Pieces", "area"]] },
      { group: "Look 2", fields: [["lookbook.looks.1.image", "Photo", "img"], ["lookbook.looks.1.name", "Name", "area"], ["lookbook.looks.1.items", "Pieces", "area"]] },
      { group: "Look 3", fields: [["lookbook.looks.2.image", "Photo", "img"], ["lookbook.looks.2.name", "Name", "area"], ["lookbook.looks.2.items", "Pieces", "area"]] },
      { group: "Look 4", fields: [["lookbook.looks.3.image", "Photo", "img"], ["lookbook.looks.3.name", "Name", "area"], ["lookbook.looks.3.items", "Pieces", "area"]] }
    ] },
    { title: "Footer", tag: "Bottom of page", fields: [
      ["footer.tagline", "Tagline", "area"]
    ] }
  ];
  var LINKS = [
    ["#shop", "Shop all"], ["#new-in", "New in"], ["#on-sale", "On sale"], ["#the-house", "The House"],
    ["#c-nior-division", "Nior Division"], ["#c-saint-sinners", "Saint & Sinners Hype"], ["#c-essential", "Essential Collection"],
    ["#c-obsedian", "Obsedian Virtue"], ["#c-monarch-drop", "Monarch Drop"]
  ];

  var uid = 0;
  function fieldHTML(f) {
    var path = f[0], label = f[1], type = f[2] || "text", hint = f[3];
    var id = "f" + (++uid), v = get(draft.home, path);
    if (type === "note") return '<p class="hint">' + esc(label) + "</p>";
    if (type === "img") {
      return '<div class="field"><span>' + esc(label) + "</span>" +
        '<div class="img-field" data-img="' + path + '">' +
          '<div class="thumb">' + (v ? '<img src="' + esc(srcOf(v)) + '" alt="">' : "") + "</div>" +
          "<div>" +
            '<div class="img-field__btns"><button class="btn btn--ghost btn--sm" type="button" data-up>Upload</button>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-lib>Choose</button></div>' +
            '<div class="img-field__path">' + esc(shortPath(v)) + "</div>" +
          "</div>" +
        "</div>" + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</div>";
    }
    var input;
    if (type === "area") input = '<textarea class="input" id="' + id + '" data-path="' + path + '" rows="' + Math.min(4, Math.max(2, String(v || "").split("\n").length)) + '">' + esc(v) + "</textarea>";
    else if (type === "link") input = '<select class="input" id="' + id + '" data-path="' + path + '">' + LINKS.map(function (l) {
      return '<option value="' + l[0] + '"' + (l[0] === v ? " selected" : "") + ">" + esc(l[1]) + "</option>";
    }).join("") + "</select>";
    else input = '<input class="input" id="' + id + '" data-path="' + path + '" value="' + esc(v) + '">';
    return '<div class="field"><label for="' + id + '"><span>' + esc(label) + "</span></label>" + input + (hint ? "<small>" + esc(hint) + "</small>" : "") + "</div>";
  }
  function renderHome() {
    var form = $("#homeForm");
    var open = $$("details.sec", form).map(function (d) { return d.open; });
    form.innerHTML =
      '<div class="editor__intro"><h1 class="h1">Home page</h1><p>Change any text or photo. The preview updates as you type.</p></div>' +
      HOME.map(function (sec, i) {
        return '<details class="sec"' + ((open.length ? open[i] : i === 0) ? " open" : "") + "><summary>" + esc(sec.title) + '<span class="mono">' + esc(sec.tag) + "</span></summary>" +
          '<div class="sec__body">' + sec.fields.map(function (f) {
            if (f.group) return '<div class="group"><p class="group__title">' + esc(f.group) + "</p>" + f.fields.map(fieldHTML).join("") + "</div>";
            return fieldHTML(f);
          }).join("") + "</div></details>";
      }).join("");
  }

  var homeForm = $("#homeForm");
  homeForm.addEventListener("input", function (e) {
    var path = e.target.dataset.path;
    if (!path) return;
    set(draft.home, path, e.target.value);
    save();
    pushPreview(path);
  });
  homeForm.addEventListener("change", function (e) {
    if (e.target.tagName === "SELECT" && e.target.dataset.path) { set(draft.home, e.target.dataset.path, e.target.value); save(); pushPreview(); }
  });
  homeForm.addEventListener("click", function (e) {
    var box = e.target.closest("[data-img]");
    if (!box) return;
    var path = box.dataset.img;
    var apply = function (src) {
      set(draft.home, path, src);
      save();
      $(".thumb", box).innerHTML = '<img src="' + esc(src) + '" alt="">';
      $(".img-field__path", box).textContent = shortPath(src);
      pushPreview(path);
    };
    if (e.target.closest("[data-up]")) upload(apply);
    if (e.target.closest("[data-lib]")) library(apply);
  });

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------
  var frame = $("#frame");
  function pushPreview(focus) {
    try { frame.contentWindow.postMessage({ type: "ravelle-home", home: JSON.parse(JSON.stringify(draft.home), function (k, v) { return typeof v === "string" ? srcOf(v) : v; }), focus: focus }, "*"); } catch (e) {}
  }
  function reloadFrame() {
    save(true);
    frame.src = "index.html?preview&t=" + Date.now() + "#home";
  }
  $$(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      $$(".seg button").forEach(function (x) { x.classList.toggle("is-on", x === b); });
      $("#stage").classList.toggle("is-mobile", b.dataset.size === "mobile");
    });
  });

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  var SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
  var selected = -1;
  var nameOf = function (p) { return (p.label || p.line || "New") + " Oversized T-shirt"; };

  function drawRows() {
    var q = $("#psearch").value.trim().toLowerCase();
    var shown = 0;
    $("#prows").innerHTML = draft.products.map(function (p, i) {
      var hay = (nameOf(p) + " " + p.color + " " + p.line).toLowerCase();
      if (q && hay.indexOf(q) < 0) return "";
      shown++;
      var src = (p.img || [])[0];
      return '<li class="prow' + (i === selected ? " is-on" : "") + (p.hidden ? " is-hidden" : "") + '" data-i="' + i + '" tabindex="0" role="button" aria-label="Edit ' + esc(nameOf(p) + ", " + p.color) + '">' +
        '<span class="prow__img" style="--tone:' + esc(p.hex || "#888") + '">' + (src ? '<img src="' + esc(srcOf(src)) + '" alt="" loading="lazy" onerror="this.remove()">' : "<span>No photo</span>") + "</span>" +
        '<span><span class="prow__name">' + esc(nameOf(p)) + '</span><span class="prow__meta"><i class="dot" style="--c:' + esc(p.hex || "#888") + '"></i>' + esc(p.color || "No colour") + "</span></span>" +
        '<span class="prow__tags">' + (p.isNew ? '<span class="tag tag--new">New</span>' : "") + (p.hidden ? '<span class="tag">Hidden</span>' : "") + "</span>" +
        '<span class="prow__price">' + taka(p.price) + (p.was > p.price ? "<s>" + taka(p.was) + "</s>" : "") + "</span>" +
      "</li>";
    }).join("");
    var visible = draft.products.filter(function (p) { return !p.hidden; }).length;
    $("#pcount").textContent = draft.products.length + " products · " + visible + " on the website" + (q ? " · " + shown + " match" : "");
  }
  function pick(i) {
    selected = i;
    drawRows();
    drawEditor();
    if (window.matchMedia("(max-width: 900px)").matches) $("#pedit").scrollIntoView({ behavior: "smooth" });
  }
  $("#prows").addEventListener("click", function (e) {
    var r = e.target.closest(".prow");
    if (r) pick(+r.dataset.i);
  });
  $("#prows").addEventListener("keydown", function (e) {
    var r = e.target.closest(".prow");
    if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(+r.dataset.i); }
  });
  $("#psearch").addEventListener("input", drawRows);
  $("#padd").addEventListener("click", function () {
    draft.products.unshift({ slug: "", line: "", color: "", hex: "#3b5677", price: 890, was: 1190, isNew: true, hidden: true, sizes: ["M", "L", "XL", "2XL"], about: "", img: [] });
    productsChanged();
    pick(0);
    var first = $("#pedit [data-k=line]");
    if (first) first.focus();
    toast("New product added. It stays hidden until you switch on Show on website.");
  });

  function productsChanged() { save(); frameStale = true; }

  function drawEditor() {
    var box = $("#pedit"), p = draft.products[selected];
    if (!p) { box.innerHTML = '<div class="pedit__empty"><p>Pick a product to edit it,<br>or add a new one.</p></div>'; return; }
    var lines = [];
    draft.products.forEach(function (x) { if (x.line && lines.indexOf(x.line) < 0) lines.push(x.line); });
    box.innerHTML =
      '<div class="pedit__head"><div><p class="mono muted">Product ' + (selected + 1) + " of " + draft.products.length + '</p><h2 class="h1" id="pTitle">' + esc(nameOf(p)) + "</h2></div>" +
        '<div class="actions"><button class="icon" type="button" data-move="-1" aria-label="Move up"' + (selected ? "" : " disabled") + ">↑</button>" +
        '<button class="icon" type="button" data-move="1" aria-label="Move down"' + (selected < draft.products.length - 1 ? "" : " disabled") + ">↓</button></div></div>" +
      '<label class="check"><input type="checkbox" data-k="visible"' + (p.hidden ? "" : " checked") + "> Show on website</label>" +
      '<label class="check"><input type="checkbox" data-k="isNew"' + (p.isNew ? " checked" : "") + "> Mark as new arrival</label>" +
      '<div class="row2">' +
        '<label class="field"><span>Line</span><input class="input" data-k="line" list="lineList" value="' + esc(p.line) + '" placeholder="e.g. Fearless"></label>' +
        '<label class="field"><span>Name override</span><input class="input" data-k="label" value="' + esc(p.label || "") + '" placeholder="Optional"></label>' +
      "</div>" +
      '<datalist id="lineList">' + lines.map(function (l) { return '<option value="' + esc(l) + '">'; }).join("") + "</datalist>" +
      '<p class="hint">Shown on the site as “' + esc(nameOf(p)) + "”. The line also groups products in the shop filters.</p>" +
      '<div class="row2">' +
        '<label class="field"><span>Colour name</span><input class="input" data-k="color" value="' + esc(p.color) + '" placeholder="e.g. Ocean Blue"></label>' +
        '<div class="field"><span>Colour swatch</span><div class="color-in"><input type="color" data-k="hex" value="' + esc(p.hex || "#888888") + '" aria-label="Swatch colour"><input class="input" data-k="hex" value="' + esc(p.hex || "") + '" aria-label="Swatch colour code"></div></div>' +
      "</div>" +
      '<div class="row2">' +
        '<label class="field"><span>Price (৳)</span><input class="input" type="number" min="0" step="10" data-k="price" value="' + esc(p.price) + '"></label>' +
        '<label class="field"><span>Old price (৳)</span><input class="input" type="number" min="0" step="10" data-k="was" value="' + esc(p.was || "") + '" placeholder="No discount"></label>' +
      "</div>" +
      '<div class="field"><span>Sizes</span><div class="sizes">' + SIZES.map(function (s) {
        return '<label><input type="checkbox" data-size="' + s + '"' + ((p.sizes || []).indexOf(s) > -1 ? " checked" : "") + "><span>" + s + "</span></label>";
      }).join("") + "</div></div>" +
      '<label class="field"><span>Description</span><textarea class="input" rows="3" data-k="about">' + esc(p.about || "") + "</textarea></label>" +
      '<div class="field"><span>Photos</span><small>The first photo is used on cards and the product page.</small></div>' +
      '<div class="gallery">' + (p.img || []).map(function (src, i, all) {
        return '<div class="gal">' + '<img src="' + esc(srcOf(src)) + '" alt="" loading="lazy" onerror="this.nextElementSibling.hidden=false">' +
          '<span class="gal__bad" hidden>Preview not available here<br>' + esc(shortPath(src)) + "</span>" +
          (i === 0 ? '<span class="gal__first">Main</span>' : "") +
          '<span class="gal__tools">' +
            '<button class="icon" type="button" data-img-move="' + i + ':-1" aria-label="Move photo left"' + (i ? "" : " disabled") + ">←</button>" +
            '<button class="icon" type="button" data-img-del="' + i + '" aria-label="Remove photo">✕</button>' +
            '<button class="icon" type="button" data-img-move="' + i + ':1" aria-label="Move photo right"' + (i < all.length - 1 ? "" : " disabled") + ">→</button>" +
          "</span></div>";
      }).join("") + "</div>" +
      '<div class="actions"><button class="btn btn--ghost btn--sm" type="button" data-add-up>Upload photo</button><button class="btn btn--ghost btn--sm" type="button" data-add-lib>Choose photo</button></div>' +
      '<label class="field" style="margin-top:18px"><span>Web address</span><input class="input" data-k="slug" value="' + esc(p.slug) + '" placeholder="made from the name"></label>' +
      '<p class="hint">The product page lives at #p-' + esc(p.slug || "…") + '. Changing it breaks old links.</p>' +
      '<div class="danger-zone"><button class="btn btn--danger btn--sm" type="button" data-del>Delete product</button></div>';
  }

  var pedit = $("#pedit");
  pedit.addEventListener("input", function (e) {
    var p = draft.products[selected], k = e.target.dataset.k;
    if (!p || !k) return;
    var v = e.target.value;
    if (k === "visible") return;
    if (k === "isNew") return;
    if (k === "price" || k === "was") v = v === "" ? 0 : Math.max(0, Math.round(+v));
    if (k === "hex") {
      $$('[data-k="hex"]', pedit).forEach(function (x) { if (x !== e.target && /^#[0-9a-f]{6}$/i.test(v)) x.value = v; });
    }
    if (k === "label" && !v) delete p.label; else p[k] = v;
    if ((k === "line" || k === "label" || k === "color") && p._autoSlug !== false && (!p.slug || p._autoSlug)) {
      p.slug = slugify((p.label || p.line) + " oversized t-shirt " + p.color);
      p._autoSlug = true;
      var s = $('[data-k="slug"]', pedit); if (s) s.value = p.slug;
    }
    if (k === "slug") { p.slug = slugify(v); p._autoSlug = false; }
    $("#pTitle").textContent = nameOf(p);
    productsChanged();
    drawRows();
  });
  pedit.addEventListener("change", function (e) {
    var p = draft.products[selected];
    if (!p) return;
    var k = e.target.dataset.k;
    if (k === "visible") p.hidden = !e.target.checked;
    else if (k === "isNew") p.isNew = e.target.checked;
    else if (e.target.dataset.size) p.sizes = SIZES.filter(function (s) { var c = $('[data-size="' + s + '"]', pedit); return c && c.checked; });
    else if (k === "slug") { e.target.value = p.slug; }
    else return;
    productsChanged();
    drawRows();
  });
  pedit.addEventListener("click", function (e) {
    var p = draft.products[selected], t = e.target.closest("button");
    if (!p || !t) return;
    var addImg = function (src) { p.img = (p.img || []).concat(src); productsChanged(); drawEditor(); drawRows(); };
    if (t.dataset.move) {
      var to = selected + +t.dataset.move;
      if (to < 0 || to >= draft.products.length) return;
      draft.products.splice(to, 0, draft.products.splice(selected, 1)[0]);
      productsChanged();
      pick(to);
    } else if (t.dataset.imgMove) {
      var parts = t.dataset.imgMove.split(":"), i = +parts[0], j = i + +parts[1];
      p.img.splice(j, 0, p.img.splice(i, 1)[0]);
      productsChanged(); drawEditor(); drawRows();
    } else if (t.dataset.imgDel) {
      p.img.splice(+t.dataset.imgDel, 1);
      productsChanged(); drawEditor(); drawRows();
    } else if (t.hasAttribute("data-add-up")) upload(addImg);
    else if (t.hasAttribute("data-add-lib")) library(addImg);
    else if (t.hasAttribute("data-del")) {
      if (!confirm("Delete " + nameOf(p) + (p.color ? " in " + p.color : "") + "? You can still discard the draft to bring it back before publishing.")) return;
      draft.products.splice(selected, 1);
      selected = Math.min(selected, draft.products.length - 1);
      productsChanged(); drawRows(); drawEditor();
    }
  });

  // ---------------------------------------------------------------------------
  // Publish
  // ---------------------------------------------------------------------------
  var SECTION_NAMES = { hero: "Hero", collage: "Collage", house: "The House", poster: "Offer poster", arrivals: "New arrivals", lookbook: "Lookbook", footer: "Footer" };
  function drawChanges() {
    var items = [];
    Object.keys(SECTION_NAMES).forEach(function (k) {
      if (JSON.stringify(draft.home[k]) !== JSON.stringify(PUBLISHED.home[k])) items.push("Home page: " + SECTION_NAMES[k] + " edited");
    });
    var before = {}, after = {};
    PUBLISHED.products.forEach(function (p) { before[p.slug] = JSON.stringify(p); });
    draft.products.forEach(function (p) { after[p.slug] = JSON.stringify(strip(p)); });
    var added = draft.products.filter(function (p) { return !(p.slug in before); }).length;
    var removed = PUBLISHED.products.filter(function (p) { return !(p.slug in after); }).length;
    var edited = draft.products.filter(function (p) { return p.slug in before && before[p.slug] !== after[p.slug]; }).length;
    if (added) items.push(added + " product" + (added > 1 ? "s" : "") + " added");
    if (edited) items.push(edited + " product" + (edited > 1 ? "s" : "") + " edited");
    if (removed) items.push(removed + " product" + (removed > 1 ? "s" : "") + " deleted");
    if (!added && !removed && draft.products.map(function (p) { return p.slug; }).join() !== PUBLISHED.products.map(function (p) { return p.slug; }).join()) items.push("Product order changed");
    var uploads = 0;
    walk(draft, function (v) { if (/^data:image\//.test(v)) uploads++; });
    if (uploads) items.push(uploads + " new photo" + (uploads > 1 ? "s" : "") + " to upload");
    $("#changes").innerHTML = '<h2 class="h2">Changes in your draft</h2>' +
      (items.length ? '<ul class="changes">' + items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="muted">Nothing to publish. The draft matches the website.</p>');
  }
  function strip(p) { var o = clone(p); delete o._autoSlug; return o; }

  // Products need a name, colour, slug and photo before they can go live.
  function problems() {
    var out = [], seen = {};
    draft.products.forEach(function (p) {
      var n = nameOf(p) + (p.color ? " (" + p.color + ")" : "");
      if (!p.line) out.push("A product has no line name.");
      if (!p.slug) out.push(n + " has no web address.");
      else if (seen[p.slug]) out.push("Two products share the web address " + p.slug + ".");
      seen[p.slug] = 1;
      if (!p.hidden && !(p.img || []).length) out.push(n + " is shown on the website but has no photo.");
      if (!(p.price > 0)) out.push(n + " has no price.");
    });
    return out;
  }

  // Replaces every uploaded image (data URL) with a file path, and returns the
  // files to commit alongside content.js.
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i += 7) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + s.length.toString(36);
  }
  function extract(content) {
    var files = {}, map = {};
    var swap = function (v) {
      if (typeof v !== "string" || !/^data:image\//.test(v)) return v;
      var m = /^data:image\/(\w+);base64,(.*)$/.exec(v);
      if (!m) return v;
      var ext = m[1] === "jpeg" ? "jpg" : m[1];
      var path = "assets/img/uploads/" + hash(v) + "." + ext;
      files[path] = m[2];
      map[path] = v;
      return path;
    };
    var fix = function (o) {
      if (Array.isArray(o)) return o.map(function (x) { return typeof x === "object" ? fix(x) : swap(x); });
      if (o && typeof o === "object") { Object.keys(o).forEach(function (k) { o[k] = typeof o[k] === "object" ? fix(o[k]) : swap(o[k]); }); }
      return o;
    };
    return { content: fix(content), files: files, map: map };
  }
  function contentFile(content) {
    return "// Site content: home page text and images, products and collections.\n" +
      "// Edited from admin.html, which rewrites this file when you publish.\n" +
      "window.RAVELLE_CONTENT = " + JSON.stringify(content, null, 2) + ";\n";
  }
  function cleanDraft() {
    var c = clone(draft);
    c.products = c.products.map(strip);
    return c;
  }

  var gh = store.get("gh", { owner: "rafat12-cyber", repo: "ravelle_website", branch: "main" });
  var token = store.get("ghToken", "");
  var form = $("#ghForm");
  form.owner.value = gh.owner; form.repo.value = gh.repo; form.branch.value = gh.branch;
  form.token.value = token; form.remember.checked = !!token;

  function log(msg, cls) {
    var l = $("#log");
    l.hidden = false;
    var li = document.createElement("li");
    li.textContent = msg;
    if (cls) li.className = cls;
    l.appendChild(li);
  }

  function api(cfg, path, method, body) {
    return fetch("https://api.github.com/repos/" + encodeURIComponent(cfg.owner) + "/" + encodeURIComponent(cfg.repo) + path, {
      method: method || "GET",
      headers: { "Authorization": "Bearer " + cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) return j;
        var why = r.status === 401 ? "GitHub didn't accept the token."
          : r.status === 403 ? "The token can't write to this repository. Give it Contents: Read and write."
          : r.status === 404 ? "Repository or branch not found, or the token can't see it."
          : (j.message || "GitHub error " + r.status);
        var err = new Error(why); err.status = r.status; throw err;
      });
    });
  }

  // One commit with content.js and any new photos, via the Git data API.
  function publish(cfg) {
    var out = extract(cleanDraft());
    var paths = Object.keys(out.files);
    var branch = encodeURIComponent(cfg.branch);
    var base, entries = [];
    log("Connecting to " + cfg.owner + "/" + cfg.repo + " (" + cfg.branch + ")…");
    return api(cfg, "/git/ref/heads/" + branch)
      .then(function (ref) { base = ref.object.sha; return api(cfg, "/git/commits/" + base); })
      .then(function (commit) {
        var chain = Promise.resolve();
        paths.forEach(function (p, i) {
          chain = chain.then(function () {
            log("Uploading photo " + (i + 1) + " of " + paths.length + "…");
            return api(cfg, "/git/blobs", "POST", { content: out.files[p], encoding: "base64" })
              .then(function (b) { entries.push({ path: p, mode: "100644", type: "blob", sha: b.sha }); });
          });
        });
        return chain.then(function () {
          entries.push({ path: "assets/js/content.js", mode: "100644", type: "blob", content: contentFile(out.content) });
          return api(cfg, "/git/trees", "POST", { base_tree: commit.tree.sha, tree: entries });
        });
      })
      .then(function (tree) {
        log("Saving changes…");
        return api(cfg, "/git/commits", "POST", { message: "Update site content from the admin panel", tree: tree.sha, parents: [base] });
      })
      .then(function (c) { return api(cfg, "/git/refs/heads/" + branch, "PATCH", { sha: c.sha }).then(function () { return c; }); })
      .then(function (c) { return { commit: c, content: out.content, map: out.map }; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var cfg = { owner: form.owner.value.trim(), repo: form.repo.value.trim(), branch: form.branch.value.trim(), token: form.token.value.trim() };
    store.set("gh", { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch });
    if (form.remember.checked) store.set("ghToken", cfg.token); else store.del("ghToken");
    $("#log").innerHTML = "";
    var issues = problems();
    if (issues.length) { issues.forEach(function (m) { log(m, "err"); }); log("Fix these first, then publish again.", "err"); return; }
    if (!isDirty()) { log("Nothing to publish. The draft already matches the website.", "ok"); return; }
    var btn = $("#pubBtn");
    btn.disabled = true; btn.textContent = "Publishing…";
    publish(cfg).then(function (res) {
      draft = res.content;
      PUBLISHED = clone(draft);
      var keep = {};
      Object.keys(uploads).concat(Object.keys(res.map)).forEach(function (p) {
        if (JSON.stringify(draft).indexOf(p) > -1) keep[p] = res.map[p] || uploads[p];
      });
      uploads = keep;
      if (!store.set("uploads", uploads)) store.del("uploads");
      save(true);
      renderHome(); drawRows(); drawEditor();
      log("Published. Commit " + res.commit.sha.slice(0, 7) + " is on " + cfg.branch + ". The website shows it once it redeploys, usually within a minute or two.", "ok");
      toast("Published to the website");
    }).catch(function (err) {
      log(err.status ? err.message : "Couldn't reach GitHub from this page. Publishing works when the admin is opened from the hosted website. Use Download content.js meanwhile.", "err");
      if (err.status === 409 || err.status === 422) log("Someone else changed the branch at the same time. Publish again.", "err");
    }).then(function () { btn.disabled = false; btn.textContent = "Publish to website"; status(); });
  });

  $("#download").addEventListener("click", function () {
    var blob = new Blob([contentFile(cleanDraft())], { type: "text/javascript" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "content.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast("Downloaded. Replace assets/js/content.js with it.");
  });

  $("#discard").addEventListener("click", function () {
    if (!isDirty()) { toast("There's no draft to discard."); return; }
    if (!confirm("Discard every unpublished change in this browser?")) return;
    draft = clone(PUBLISHED);
    store.del("draft");
    selected = -1;
    renderHome(); drawRows(); drawEditor(); reloadFrame(); status();
    toast("Draft discarded");
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  save(true);
  renderHome();
  drawRows();
  drawEditor();
  status();
  var start = location.hash.replace("#", "");
  showTab(start === "products" || start === "publish" ? start : "home");
})();
