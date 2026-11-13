// Ravelle admin panel: a small single-page app over the store API (client.js).
// Each view fetches what it needs, renders plain HTML and wires its own events.
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const taka = (n) => "৳" + Math.round(n || 0).toLocaleString("en-US");
  const int = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const date = (t) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const dateTime = (t) => t ? new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
  const ago = (t) => {
    if (!t) return "never";
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  };
  const human = (k) => String(k).replace(/_/g, " ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ (\d)$/, " $1");
  const optText = (o) => Object.keys(o || {}).map((k) => o[k]).join(" / ");
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const TOKEN_KEY = "ravelle:admin-token";
  // Shop colour-filter groups (same names and colours as COLOR_GROUPS in assets/js/store.js)
  const FILTER_COLORS = [["Black", "#1f2022"], ["White", "#f2f1ec"], ["Grey", "#8a8d91"], ["Blue", "#3b6279"], ["Green", "#3f8a68"], ["Yellow", "#c3ae62"],
    ["Cream", "#d8ccb0"], ["Brown", "#5f4535"], ["Red", "#a8342b"], ["Pink", "#d0607a"], ["Orange", "#d27c3c"], ["Purple", "#6c4f8c"]];
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  let me = null, areas = [], store = null; // store = GET /api/store, for categories/attributes/menus
  let view = $("#view");

  function api(method, path, body) {
    return window.Ravelle.call(method, path, body, token).catch((err) => {
      if (err && err.status === 401 && me) { signOut(true); }
      throw err;
    });
  }
  // "trash" isn't a module of its own: anyone who can delete products or images (and the owner, for orders) sees it
  const can = (area) => area === "trash" ? (areas.indexOf("products") > -1 || areas.indexOf("content") > -1 || !!(me && (me.role === "owner" || me.orderTrash))) : areas.indexOf(area) > -1;

  // ---------------------------------------------------------------------------
  // Toast, modal, confirm
  // ---------------------------------------------------------------------------
  let toastTimer;
  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast is-on" + (bad ? " toast--bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 3200);
  }
  const fail = (err) => toast((err && err.message) || "Something went wrong.", true);

  let modalClose = null;
  function modal(title, html, opts) {
    opts = opts || {};
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = html;
    $(".modal").classList.toggle("modal--wide", !!opts.wide);
    $("#modal").hidden = false;
    modalClose = opts.onClose || null;
    const f = $("#modalBody input, #modalBody select, #modalBody textarea");
    if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
    return $("#modalBody");
  }
  function closeModal() {
    $("#modal").hidden = true;
    $("#modalBody").innerHTML = "";
    const cb = modalClose; modalClose = null;
    if (cb) cb();
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-modal-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      const body = modal(title, `${text && text.html ? `<div class="muted">${text.html}</div>` : `<p class="muted">${esc(text)}</p>`}<div class="modal__foot"><button class="btn btn--ghost" data-no>Cancel</button><button class="btn ${danger ? "btn--danger" : "btn--dark"}" data-yes>${esc(okLabel || "OK")}</button></div>`, { onClose: () => resolve(false), noFocus: true });
      $("[data-yes]", body).focus();
      $("[data-yes]", body).onclick = () => { modalClose = null; closeModal(); resolve(true); };
      $("[data-no]", body).onclick = () => closeModal();
    });
  }
  function busy(btn, on) { if (btn) { btn.disabled = on; } }
  function formData(form) {
    const o = {};
    $$("[name]", form).forEach((el) => {
      if (el.type === "checkbox") o[el.name] = el.checked;
      else if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    });
    return o;
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function csv(rows) {
    return "﻿" + rows.map((r) => r.map((c) => {
      let s = String(c == null ? "" : c);
      // A name like "=HYPERLINK(...)" would run as a formula when the file is opened in Excel or Google Sheets
      if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
  }
  const pill = (s) => `<span class="pill pill--${esc(s)}">${esc(human(s))}</span>`;
  const STATUSES = ["pending", "confirmed", "hold", "processing", "shipped", "delivered", "partial_return", "cancelled", "returned"];
  const PAY_STATUSES = ["unpaid", "paid", "refunded", "failed"];
  const PAY_LABEL = { cod: "Cash on delivery", sslcommerz: "SSLCOMMERZ", bkash: "bKash", nagad: "Nagad" };

  // ---------------------------------------------------------------------------
  // Media: upload (resized in the browser) and the picker
  // ---------------------------------------------------------------------------
  function readImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) return reject(new Error(file.name + " isn't a PNG, JPG, WebP, GIF or AVIF image."));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Couldn't read " + file.name));
      fr.onload = () => {
        if (file.type === "image/gif") return resolve({ dataUrl: fr.result, width: null, height: null });
        const img = new Image();
        img.onerror = () => reject(new Error("Couldn't open " + file.name));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const g0 = c.getContext("2d"); g0.imageSmoothingQuality = "high"; g0.drawImage(img, 0, 0, w, h);
          let out = c.toDataURL("image/webp", 0.88);
          if (out.indexOf("data:image/webp") !== 0) out = c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86);
          // A 600 px wide copy for phones and product cards (saved next to the photo as <name>-s.webp)
          let small = "";
          if (w > 760 && out.indexOf("data:image/webp") === 0) {
            const sw = 600, sh = Math.round(h * sw / w), c2 = document.createElement("canvas");
            c2.width = sw; c2.height = sh;
            const g = c2.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, sw, sh);
            small = c2.toDataURL("image/webp", 0.84);
          }
          // Keep the original when it is already smaller.
          const keepOrig = !(out.length < fr.result.length || scale < 1);
          resolve({ dataUrl: keepOrig ? fr.result : out, small: keepOrig && file.type !== "image/webp" ? "" : small, width: w, height: h });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  async function uploadFiles(files) {
    const max = window.Ravelle.mode === "demo" ? 1200 : 2000;
    const out = [];
    for (const f of Array.from(files)) {
      try {
        const img = await readImage(f, max);
        const r = await api("POST", "/api/media", { name: f.name, dataUrl: img.dataUrl, small: img.small || "", width: img.width, height: img.height, alt: f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") });
        out.push(r.item);
      } catch (err) { fail(err); }
    }
    if (out.length) toast(out.length === 1 ? "Image uploaded" : out.length + " images uploaded");
    return out;
  }
  function dropzone(el, onFiles) {
    const input = $("input[type=file]", el);
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("is-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("is-over"));
    el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("is-over"); onFiles(e.dataTransfer.files); });
    if (input) input.addEventListener("change", () => { onFiles(input.files); input.value = ""; });
  }
  const DROP_HTML = `<label class="drop"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple hidden>
    <b>Drop images here</b> or <span class="btn--link">choose files</span><br><small class="muted">PNG, JPG, WebP, GIF or AVIF. Large photos are resized automatically.</small></label>`;

  // Opens the media library; resolves with the chosen URLs (or null).
  function pickMedia(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let chosen = [], items = [];
      const body = modal(opts.title || "Choose an image", `
        ${DROP_HTML}
        <div class="flex"><input class="input grow" id="pkUrl" placeholder="…or paste an image address (https://…)"><button class="btn btn--ghost btn--sm" id="pkUseUrl" type="button">Use address</button></div>
        <div class="media-grid" id="pkGrid"><p class="muted">Loading…</p></div>
        <div class="modal__foot"><span class="muted grow" id="pkCount"></span><button class="btn btn--ghost" data-modal-close>Cancel</button><button class="btn btn--dark" id="pkOk" disabled>${opts.multiple ? "Add selected" : "Use image"}</button></div>`,
        { wide: true, noFocus: true, onClose: () => resolve(null) });
      const draw = () => {
        $("#pkGrid", body).innerHTML = items.length ? items.map((m) => `<button type="button" class="media${chosen.indexOf(m.url) > -1 ? " is-on" : ""}" data-url="${esc(m.url)}"><img src="${esc(m.url)}" alt="" loading="lazy"><span>${esc(m.name)}</span></button>`).join("")
          : `<p class="muted">No images yet. Upload some above.</p>`;
        $("#pkOk", body).disabled = !chosen.length;
        $("#pkCount", body).textContent = chosen.length ? chosen.length + " selected" : "";
      };
      const done = (urls) => { modalClose = null; closeModal(); resolve(urls); };
      api("GET", "/api/media").then((r) => { items = r.media; draw(); }, fail);
      $("#pkGrid", body).addEventListener("click", (e) => {
        const b = e.target.closest(".media");
        if (!b) return;
        const u = b.dataset.url, i = chosen.indexOf(u);
        if (opts.multiple) { if (i > -1) chosen.splice(i, 1); else chosen.push(u); draw(); }
        else done([u]);
      });
      $("#pkOk", body).onclick = () => done(chosen);
      $("#pkUseUrl", body).onclick = () => {
        const u = $("#pkUrl", body).value.trim();
        if (!/^(https?:\/\/|\/|assets\/|uploads\/)/.test(u)) return toast("Paste a full image address, starting with https://", true);
        done([u]);
      };
      dropzone($(".drop", body), async (files) => {
        const up = await uploadFiles(files);
        items = up.concat(items);
        if (!opts.multiple && up.length === 1) return done([up[0].url]);
        up.forEach((m) => chosen.push(m.url));
        draw();
      });
    });
  }
  // Recommended size and file weight for each image slot, so uploads stay sharp and fast
  const IMG_SPECS = [
    [/^hero\.image$/, 1200, 1212, "see-through background (PNG or WebP cutout)", 250],
    [/^tryLook\.looks\.\d+\.image$/, 400, 1200, "model cutout with a see-through background", 80],
    [/^house\.card\d+\.image$/, 900, 1200, "3:4 photo", 150],
    [/^poster\.image$/, 900, 1125, "4:5 photo", 200],
    [/^lookbook\.looks\.\d+\.image$/, 900, 1200, "3:4 photo", 180],
    [/^sizeGuide$/, 1200, 800, "3:2 landscape chart, shown in full", 120, true],
    [/^image$/, 900, 1200, "3:4 photo", 150],
    [/^product$/, 690, 862, "4:5 photo", 80],
    [/^logo$/, 360, 120, "wide logo with a see-through background", 30],
    [/^popupImage$/, 1000, 1250, "4:5 photo or poster", 220],
    [/^popupMobile$/, 800, 1000, "4:5 photo or poster for phones", 160],
    [/^shops\.\d+\.image$/, 1200, 900, "4:3 photo of the shop", 180],
    [/^stories\.\d+\.storeImage$/, 1200, 900, "4:3 photo of the store", 180],
    [/^stories\.\d+\.ownerImage$/, 400, 400, "square photo of the owner's face", 60]
  ];
  function imgSpec(name) {
    const s = IMG_SPECS.find((x) => x[0].test(name)) || [null, 1200, 0, "longest side", 200];
    return { w: s[1], h: s[2], what: s[3], kb: s[4], fit: !!s[5],
      text: `Best size: ${s[2] ? `${s[1]} × ${s[2]} px` : `${s[1]} px on the ${s[3]}`}${s[2] ? ` (${s[3]})` : ""} · WebP · under ${s[4]} KB` };
  }
  // Show an image's real size and weight, with a warning when it is far off the recommended one
  function measureImg(url, spec, out) {
    if (!out) return;
    if (!url) { out.textContent = ""; return; }
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth, h = im.naturalHeight;
      fetch(url).then((r) => r.blob()).then((b) => b.size, () => 0).then((bytes) => {
        const kb = Math.round(bytes / 1024), warn = [];
        if (spec.h && !spec.fit && Math.abs(w / h - spec.w / spec.h) > 0.03) warn.push("different shape, the edges will be cropped");
        if (spec.fit && (w / h < 0.9 || w / h > 2.2)) warn.push(w / h < 0.9 ? "tall chart, hard to read on phones; a landscape 3:2 chart works best" : "very wide chart, text gets small on phones");
        if (w < spec.w * 0.8) warn.push("smaller than recommended, may look soft");
        if (kb && kb > spec.kb * 1.5) warn.push(`heavy file, aim for under ${spec.kb} KB`);
        out.innerHTML = `This image: ${w} × ${h} px${kb ? ` · ${kb} KB` : ""} ${warn.length ? `· <span style="color:#b3261e">${esc(warn.join("; "))}</span>` : "· good fit"}`;
      });
    };
    im.onerror = () => { out.textContent = ""; };
    im.src = url;
  }
  function imgField(name, value, label, hint, wide) {
    const spec = imgSpec(name);
    return `<div class="field" data-imgfield="${esc(name)}"><span>${esc(label)}</span>
      <div class="imgfield"><img class="imgfield__prev${wide ? " imgfield__prev--wide" : ""}" src="${esc(value || "")}" alt="" ${value ? "" : "hidden"}>
      <div class="stack stack--sm"><div class="flex"><button class="btn btn--ghost btn--sm" type="button" data-pick>${value ? "Change" : "Choose image"}</button>
      <button class="btn btn--ghost btn--sm" type="button" data-clear ${value ? "" : "hidden"}>Remove</button></div>${hint ? `<small>${esc(hint)}</small>` : ""}
      <small class="imgfield__spec">${esc(spec.text)}</small><small class="imgfield__real" data-real></small></div></div>
      <input type="hidden" name="${esc(name)}" value="${esc(value || "")}"></div>`;
  }
  function wireImgFields(root, onChange) {
    $$("[data-imgfield]", root).forEach((f) => {
      const input = $("input[type=hidden]", f), prev = $(".imgfield__prev", f);
      const spec = imgSpec(f.dataset.imgfield);
      measureImg(input.value, spec, $("[data-real]", f));
      const set = (u) => {
        input.value = u || "";
        measureImg(u || "", spec, $("[data-real]", f));
        prev.hidden = !u; if (u) prev.src = u;
        $("[data-pick]", f).textContent = u ? "Change" : "Choose image";
        $("[data-clear]", f).hidden = !u;
        if (onChange) onChange(f.dataset.imgfield, u || "");
      };
      $("[data-pick]", f).onclick = async () => { const u = await pickMedia(); if (u) set(u[0]); };
      $("[data-clear]", f).onclick = () => set("");
      f._set = set;
    });
  }

  // ---------------------------------------------------------------------------
  // Charts: single series, thin bars or a 2px line, hover tooltip
  // ---------------------------------------------------------------------------
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function chart(el, data, opts) {
    const W = 760, H = 220, L = 52, R = 10, T = 10, B = 26;
    const fmt = opts.format || int;
    const max = niceMax(Math.max.apply(null, data.map((d) => d.value).concat([0])));
    const iw = W - L - R, ih = H - T - B, n = data.length, step = iw / Math.max(1, n);
    const y = (v) => T + ih - (v / max) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}"><g class="grid">`;
    for (let i = 0; i <= 4; i++) {
      const v = max * i / 4, yy = y(v);
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`;
    }
    svg += `</g><g class="axis">`;
    for (let i = 0; i <= 4; i++) { const v = max * i / 4; svg += `<text x="${L - 8}" y="${y(v) + 3}" text-anchor="end">${esc(opts.short ? opts.short(v) : fmt(v))}</text>`; }
    const every = Math.ceil(n / 8);
    data.forEach((d, i) => { if (i % every === 0 || i === n - 1 && n < 9) svg += `<text x="${L + step * i + step / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`; });
    svg += `</g>`;
    if (opts.type === "line") {
      const pts = data.map((d, i) => [L + step * i + step / 2, y(d.value)]);
      svg += `<path class="line" d="M${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L")}"/>`;
      svg += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ih}" visibility="hidden"/><circle class="dot" r="4" cx="0" cy="0" visibility="hidden"/>`;
    } else {
      const bw = Math.max(1.5, Math.min(26, step - Math.max(2, step * 0.28)));
      data.forEach((d, i) => {
        const x = L + step * i + (step - bw) / 2, yy = y(d.value), h = T + ih - yy;
        if (h <= 0) return;
        const r = Math.min(4, bw / 2, h);
        svg += `<path class="bar" data-i="${i}" d="M${x},${T + ih}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${T + ih}Z"/>`;
      });
    }
    data.forEach((d, i) => { svg += `<rect class="hit" data-i="${i}" x="${L + step * i}" y="${T}" width="${step}" height="${ih}"/>`; });
    svg += `</svg><div class="tip" hidden></div>`;
    el.innerHTML = svg;
    const tip = $(".tip", el), s = $("svg", el);
    const show = (i) => {
      const d = data[i], rect = s.getBoundingClientRect(), k = rect.width / W;
      const cx = (L + step * i + step / 2) * k, cy = y(d.value) * k;
      tip.innerHTML = d.tip;
      tip.hidden = false;
      tip.style.left = Math.min(rect.width - 70, Math.max(70, cx)) + "px";
      tip.style.top = cy + "px";
      $$(".bar", el).forEach((b) => b.classList.toggle("is-hover", +b.dataset.i === i));
      if (opts.type === "line") {
        const cross = $(".cross", el), dot = $(".dot", el), x = L + step * i + step / 2;
        cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
        dot.setAttribute("cx", x); dot.setAttribute("cy", y(d.value)); dot.setAttribute("visibility", "visible");
      }
    };
    const hide = () => {
      tip.hidden = true;
      $$(".bar", el).forEach((b) => b.classList.remove("is-hover"));
      $$(".cross, .dot", el).forEach((x) => x.setAttribute("visibility", "hidden"));
    };
    $$(".hit", el).forEach((h) => { h.addEventListener("mouseenter", () => show(+h.dataset.i)); h.addEventListener("click", () => show(+h.dataset.i)); });
    s.addEventListener("mouseleave", hide);
  }
  function hbars(rows, fmt) {
    const max = Math.max.apply(null, rows.map((r) => r.value).concat([1]));
    if (!rows.length) return `<p class="muted">No data in this period.</p>`;
    return `<div class="hbars">${rows.map((r) => `<div class="hbar" title="${esc(r.label)}: ${esc((fmt || int)(r.value))}"><span class="hbar__label">${esc(r.label)}</span><span class="hbar__track"><span class="hbar__fill" style="width:${(r.value / max * 100).toFixed(1)}%"></span></span><span class="num">${esc((fmt || int)(r.value))}</span></div>`).join("")}</div>`;
  }
  const shortTaka = (v) => v >= 1e6 ? "৳" + (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : v >= 1e3 ? "৳" + (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k" : "৳" + Math.round(v);

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------
  let dashDays = 30;
  async function viewDashboard() {
    setTitle("Dashboard");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Hello, ${esc(me.name.split(" ")[0])}</h1><p class="muted">Sales, visitors and products for your store.</p></div>
      <div class="tabs" id="range">${[[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "12 months"]].map(([d, l]) => `<button class="tab${d === dashDays ? " is-on" : ""}" data-d="${d}">${l}</button>`).join("")}</div></div>
      <div id="dash"><p class="muted">Loading…</p></div>`;
    $("#range").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { dashDays = +b.dataset.d; viewDashboard(); } };
    let d;
    try { d = await api("GET", "/api/dashboard?days=" + dashDays); } catch (err) { return fail(err); }
    const t = d.totals, p = d.previous;
    const delta = (a, b, money) => {
      if (!b) return `<span class="kpi__delta">${a ? "New this period" : "No data before"}</span>`;
      const ch = (a - b) / b * 100;
      return `<span class="kpi__delta"><b class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</b> vs previous ${dashDays} days</span>`;
    };
    // Bucket long ranges by week so bars stay readable.
    let series = d.series;
    const byWeek = series.length > 92;
    if (byWeek) {
      const w = [];
      for (let i = 0; i < series.length; i += 7) {
        const chunk = series.slice(i, i + 7);
        w.push({ date: chunk[0].date, revenue: chunk.reduce((s, x) => s + x.revenue, 0), orders: chunk.reduce((s, x) => s + x.orders, 0), visits: chunk.reduce((s, x) => s + x.visits, 0) });
      }
      series = w;
    }
    const lab = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const alerts = [];
    if (d.pending) alerts.push(`<a class="alert" href="#/orders?status=pending"><b>${d.pending}</b> new order${d.pending > 1 ? "s" : ""} to confirm</a>`);
    if (d.openChats && can("chat")) alerts.push(`<a class="alert" href="#/chat"><b>${d.openChats}</b> open chat${d.openChats > 1 ? "s" : ""}</a>`);
    if (d.unreadMessages && can("messages")) alerts.push(`<a class="alert" href="#/messages"><b>${d.unreadMessages}</b> unread message${d.unreadMessages > 1 ? "s" : ""}</a>`);
    if (d.lowStock.length) alerts.push(`<a class="alert" href="#/stock"><b>${d.lowStock.length}</b> SKU${d.lowStock.length > 1 ? "s" : ""} low on stock</a>`);
    const setupLeft = d.setup.filter((s) => !s.done);
    const statusRows = STATUSES.map((s) => ({ label: human(s), value: d.byStatus[s] || 0 })).filter((r) => r.value);
    const payRows = Object.keys(d.byPayment).map((k) => ({ label: PAY_LABEL[k] || k, value: d.byPayment[k] }));
    const zoneRows = Object.keys(d.byZone).map((k) => ({ label: k, value: d.byZone[k] }));
    $("#dash").innerHTML = `
      ${alerts.length ? `<div class="alerts">${alerts.join("")}</div>` : ""}
      <div class="kpis" style="margin-top:${alerts.length ? 14 : 0}px">
        <div class="kpi"><span class="kpi__label">Revenue</span><span class="kpi__value">${taka(t.revenue)}</span>${delta(t.revenue, p.revenue)}</div>
        <div class="kpi"><span class="kpi__label">Orders</span><span class="kpi__value">${int(t.orders)}</span>${delta(t.orders, p.orders)}</div>
        <div class="kpi"><span class="kpi__label">Average order</span><span class="kpi__value">${taka(t.aov)}</span>${delta(t.aov, p.aov)}</div>
        <div class="kpi"><span class="kpi__label">Visitors</span><span class="kpi__value">${int(t.visits)}</span>${delta(t.visits, p.visits)}</div>
        <div class="kpi"><span class="kpi__label">Conversion rate</span><span class="kpi__value">${t.conversion}%</span>${delta(t.conversion, p.conversion)}</div>
        <div class="kpi"><span class="kpi__label">Items sold</span><span class="kpi__value">${int(t.items)}</span><span class="kpi__delta">Discounts given: ${taka(t.discounts)}</span></div>
      </div>
      <div class="cols" style="margin-top:18px">
        <div class="stack">
          <div class="card"><div class="card__head"><h2 class="h2">Revenue ${byWeek ? "per week" : "per day"}</h2><button class="btn btn--link" data-table="rev">Show as table</button></div><div class="chart" id="cRev"></div><div id="tRev" hidden></div></div>
          <div class="card"><div class="card__head"><h2 class="h2">Visitors ${byWeek ? "per week" : "per day"}</h2></div><div class="chart" id="cVis"></div></div>
        </div>
        <div class="stack">
          ${setupLeft.length ? `<div class="card"><h2 class="h2">Finish setting up</h2><ul class="checklist">${d.setup.map((s) => `<li class="${s.done ? "is-done" : ""}">${esc(s.text)}</li>`).join("")}</ul>${can("settings") ? `<a class="btn btn--ghost btn--sm" href="#/settings">Open settings</a>` : ""}</div>` : ""}
          <div class="card"><h2 class="h2">Orders by status</h2>${hbars(statusRows)}</div>
          <div class="card"><h2 class="h2">Revenue by payment</h2>${hbars(payRows, taka)}</div>
          <div class="card"><h2 class="h2">Orders by delivery area</h2>${hbars(zoneRows)}</div>
          <div class="card"><h2 class="h2">Customers</h2><dl class="kv"><dt>Bought this period</dt><dd>${int(d.customers.buyers)}</dd><dt>Returning buyers</dt><dd>${int(d.customers.returning)}</dd><dt>All customers</dt><dd>${int(d.customers.total)}</dd></dl></div>
        </div>
      </div>
      <div class="card card--flush" style="margin-top:18px"><div class="card__head" style="padding:16px 18px 6px"><div><h2 class="h2">Product analytics</h2><p class="muted small">Views and add-to-bags come from the storefront. Conversion = orders ÷ views.</p></div><button class="btn btn--ghost btn--sm" id="prodCsv">Export CSV</button></div>
        <div class="table-wrap"><table class="t" id="prodTable"></table></div></div>
      <div class="cols cols--even" style="margin-top:18px">
        <div class="card"><h2 class="h2">Revenue by category</h2>${hbars(d.categories.map((c) => ({ label: c.name, value: c.revenue })), taka)}</div>
        <div class="card"><div class="card__head"><h2 class="h2">Low stock</h2><a class="btn btn--link" href="#/stock">Manage stock</a></div>
          ${d.lowStock.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th>SKU</th><th class="right">Left</th></tr></thead><tbody>${d.lowStock.slice(0, 10).map((l) => `<tr class="is-link" data-href="#/products/${esc(l.productId)}"><td>${esc(l.name)}<br><small class="muted">${esc(optText(l.options))}</small></td><td class="mono">${esc(l.sku)}</td><td class="right num"><b style="color:${l.stock ? "var(--warn)" : "var(--danger)"}">${l.stock}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Everything is well stocked.</p>`}
        </div>
      </div>
      <div class="card card--flush" style="margin-top:18px"><div class="card__head" style="padding:16px 18px 6px"><h2 class="h2">Recent orders</h2><a class="btn btn--link" href="#/orders">All orders</a></div>${ordersTable(d.recent)}</div>`;
    chart($("#cRev"), series.map((s) => ({ label: lab(s.date), value: s.revenue, tip: `<b>${byWeek ? "Week of " : ""}${lab(s.date)}</b><br>${taka(s.revenue)} · ${s.orders} order${s.orders === 1 ? "" : "s"}` })), { label: "Revenue", format: taka, short: shortTaka });
    chart($("#cVis"), series.map((s) => ({ label: lab(s.date), value: s.visits, tip: `<b>${byWeek ? "Week of " : ""}${lab(s.date)}</b><br>${int(s.visits)} visitors · ${s.orders} order${s.orders === 1 ? "" : "s"}` })), { label: "Visitors", type: "line" });
    $("[data-table=rev]").onclick = (e) => {
      const tEl = $("#tRev"), show = tEl.hidden;
      tEl.hidden = !show; $("#cRev").hidden = show;
      e.target.textContent = show ? "Show as chart" : "Show as table";
      tEl.innerHTML = `<div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="t"><thead><tr><th>${byWeek ? "Week of" : "Date"}</th><th class="right">Orders</th><th class="right">Visitors</th><th class="right">Revenue</th></tr></thead><tbody>${series.slice().reverse().map((s) => `<tr><td>${lab(s.date)}</td><td class="right num">${s.orders}</td><td class="right num">${int(s.visits)}</td><td class="right num">${taka(s.revenue)}</td></tr>`).join("")}</tbody></table></div>`;
    };
    // Product analytics table, sortable
    let sortKey = "revenue", dir = -1;
    const cols = [["name", "Product"], ["views", "Views"], ["carts", "Add to bag"], ["orders", "Orders"], ["units", "Units"], ["revenue", "Revenue"], ["conversion", "Conversion"], ["stock", "Stock"]];
    const drawProd = () => {
      const rows = d.products.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
      $("#prodTable").innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th class="sortable${k === "name" ? "" : " right"}" data-k="${k}">${l}${k === sortKey ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${rows.map((p) => `
        <tr class="is-link" data-href="#/products/${esc(p.id)}"><td><div class="flex" style="flex-wrap:nowrap">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : ""}<span>${esc(p.name)}<br><small class="muted mono">${esc(p.sku)}</small></span></div></td>
        <td class="right num">${int(p.views)}</td><td class="right num">${int(p.carts)}</td><td class="right num">${int(p.orders)}</td><td class="right num">${int(p.units)}</td><td class="right num">${taka(p.revenue)}</td><td class="right num">${p.conversion}%</td><td class="right num">${p.stock == null ? "—" : int(p.stock)}</td></tr>`).join("")}</tbody>`;
    };
    drawProd();
    $("#prodTable").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (!th) return;
      if (sortKey === th.dataset.k) dir = -dir; else { sortKey = th.dataset.k; dir = th.dataset.k === "name" ? 1 : -1; }
      drawProd();
    });
    $("#prodCsv").onclick = () => download(`ravelle-products-${dashDays}d.csv`, csv([cols.map((c) => c[1]).concat(["SKU"])].concat(d.products.map((p) => [p.name, p.views, p.carts, p.orders, p.units, p.revenue, p.conversion, p.stock, p.sku]))));
  }
  // Pathao column: the parcel's live status, or a one-click Send button
  // Pathao order (consignment) ID in its own column, next to Send to Pathao / status
  function pathaoIdCell(o) {
    const id = o.pathao && o.pathao.consignmentId;
    return `<td class="nowrap">${id ? `<span class="mono">${esc(id)}</span> <button class="peek" type="button" data-copyid="${esc(id)}" title="Copy Pathao ID" aria-label="Copy Pathao ID ${esc(id)}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>` : `<span class="muted">—</span>`}</td>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-copyid]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    try { navigator.clipboard.writeText(b.dataset.copyid); toast("Copied " + b.dataset.copyid); } catch (_) { toast(b.dataset.copyid); }
  }, true);
  function pathaoCell(o) {
    const pt = o.pathao;
    if (pt) return `<td class="pt-cell"><span class="pill pill--pt${/deliver/.test(pt.status) && !/fail/.test(pt.status) ? " pill--pt-ok" : /return|fail|cancel/.test(pt.status) ? " pill--pt-bad" : ""}">${esc(String(pt.status || "sent").replace(/_/g, " "))}</span>${o.trackingUrl ? `<br><a class="small" href="${esc(o.trackingUrl)}" target="_blank" rel="noopener" data-stop>Track</a>` : ""}</td>`;
    if (o.status === "cancelled" || o.status === "returned" || o.status === "delivered") return `<td class="pt-cell"><span class="muted">—</span></td>`;
    return `<td class="pt-cell"><button class="btn btn--ghost btn--sm" type="button" data-pathao="${esc(o.id)}">Send to Pathao</button></td>`;
  }
  // Hold and cancel straight from the list; not once the courier has the parcel
  const withCourier = (o) => !!((o.pathao && o.pathao.consignmentId) || ["shipped", "delivered", "partial_return", "returned"].indexOf(o.status) > -1);
  const canDo = (o, s) => !withCourier(o) && (s === "hold" ? ["pending", "confirmed", "processing"].indexOf(o.status) > -1 : s === "cancelled" ? ["pending", "confirmed", "processing", "hold"].indexOf(o.status) > -1 : s === "confirmed" ? ["pending", "hold"].indexOf(o.status) > -1 : false);
  function rowActions(o) {
    return [["confirmed", "Confirm"], ["hold", "Hold"], ["cancelled", "Cancel"]].filter((a) => canDo(o, a[0])).map((a) => `<button class="btn btn--ghost btn--sm" type="button" data-act="${a[0]}" data-num="${esc(o.number)}">${a[1]}</button>`).join("").replace(/^(.+)$/, '<div class="row-acts">$1</div>') || `<span class="muted">—</span>`;
  }
  function ordersTable(list, courier) {
    if (!list.length) return `<p class="empty">No orders yet.</p>`;
    return `<div class="table-wrap"><table class="t${courier ? " t--tight" : ""}"><thead><tr>${courier ? `<th style="width:34px"><input type="checkbox" data-selall aria-label="Select all"></th>` : ""}<th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th>Payment</th>${courier ? "<th>Pathao</th><th>Pathao ID</th>" : ""}<th class="right">Items</th><th class="right">Total</th>${courier ? `<th class="right">Actions</th>` : ""}</tr></thead><tbody>${list.map((o) => `
      <tr class="is-link" data-href="#/orders/${esc(o.number)}">${courier ? `<td data-stop><input type="checkbox" data-sel="${esc(o.number)}" aria-label="Select ${esc(o.number)}"></td>` : ""}<td class="nowrap"><b>${esc(o.number)}</b> <button class="peek" type="button" data-peek="${esc(o.number)}" title="Quick view" aria-label="Quick view ${esc(o.number)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg></button></td><td class="nowrap">${dateTime(o.createdAt)}</td><td>${esc(o.customer.name)}<br><small class="muted">${esc(o.customer.phone)}</small></td>
      <td>${pill(o.status)}</td><td>${pill(o.paymentStatus)}<br><small class="muted">${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)}</small></td>${courier ? pathaoCell(o) + pathaoIdCell(o) : ""}<td class="right num">${o.itemCount}</td><td class="right num"><b>${taka(o.total)}</b></td>${courier ? `<td class="right">${rowActions(o)}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }

  // Quick view: the eye button next to an order number shows the customer, items and bill in a box, without leaving the list
  async function orderPeek(num) {
    const body = modal("Order " + num, `<p class="muted">Loading…</p>`, { wide: true, noFocus: true });
    let o;
    try { o = (await api("GET", "/api/orders/" + encodeURIComponent(num))).order; } catch (err) { closeModal(); return fail(err); }
    const ret = (it) => (o.returns || []).filter((r) => r.productId === it.productId && (r.variantId || null) === (it.variantId || null)).reduce((n, r) => n + r.qty, 0);
    const pt = o.pathao || {}, tel = o.customer.phone;
    body.innerHTML = `<div class="stack peek-box">
      <p class="muted" style="margin:0">${dateTime(o.createdAt)} · ${pill(o.status)} ${pill(o.paymentStatus)} · ${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)}</p>
      <div class="cols" style="gap:16px">
        <div class="stack" style="gap:8px">
          <h3 class="h3" style="margin:0">Items</h3>
          <div class="items">${o.items.map((it) => `<div class="item">${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="ph"></span>`}<div><b>${esc(it.name)}</b><small>${esc(optText(it.options))} · SKU ${esc(it.sku)}</small><small>${it.qty} × ${taka(it.price)}</small>${ret(it) ? `<small style="color:var(--danger)">Returned: ${ret(it)}</small>` : ""}</div><b class="num">${taka(it.lineTotal)}</b></div>`).join("")}</div>
          <div class="totals"><div><span>Subtotal</span><span class="num">${taka(o.subtotal)}</span></div>${o.discount ? `<div><span>Discount${o.coupon ? " (" + esc(o.coupon) + ")" : ""}</span><span class="num">−${taka(o.discount)}</span></div>` : ""}
            <div><span>Delivery${o.shippingZone ? " · " + esc(o.shippingZone.name) : ""}</span><span class="num">${o.shipping ? taka(o.shipping) : "Free"}</span></div><div class="grand"><span>Total</span><span class="num">${taka(o.total)}</span></div>
            ${o.returnedValue ? `<div style="color:var(--danger)"><span>Returned items</span><span class="num">−${taka(o.returnedValue)}</span></div><div><span>Kept by customer</span><span class="num">${taka(o.total - o.returnedValue)}</span></div>` : ""}
            ${o.collected != null ? `<div><span>Cash collected</span><span class="num">${taka(o.collected)}</span></div>` : ""}</div>
        </div>
        <div class="stack" style="gap:8px">
          <h3 class="h3" style="margin:0">Customer</h3>
          <dl class="kv"><dt>Name</dt><dd>${esc(o.customer.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(tel)}">${esc(tel)}</a></dd>${o.customer.email ? `<dt>Email</dt><dd>${esc(o.customer.email)}</dd>` : ""}
            <dt>Address</dt><dd>${esc(o.customer.address)}${o.customer.area ? ", " + esc(o.customer.area) : ""}${o.customer.city ? ", " + esc(o.customer.city) : ""}</dd>${o.shippingZone ? `<dt>Delivery</dt><dd>${esc(o.shippingZone.name)}</dd>` : ""}</dl>
          ${pt.consignmentId ? `<h3 class="h3" style="margin:6px 0 0">Pathao</h3><dl class="kv"><dt>Consignment</dt><dd class="mono">${esc(pt.consignmentId)}</dd><dt>Status</dt><dd>${esc(String(pt.status || "sent").replace(/_/g, " "))}</dd></dl>` : ""}
          ${o.note ? `<h3 class="h3" style="margin:6px 0 0">Customer note</h3><p style="margin:0">${esc(o.note)}</p>` : ""}
        </div>
      </div>
      <div class="modal__foot"><a class="btn btn--ghost" href="#/orders/${esc(o.number)}/invoice" data-modal-close>Order invoice</a><a class="btn btn--ghost" href="#/orders/${esc(o.number)}/courier-invoice" data-modal-close>Courier invoice</a><a class="btn btn--dark" href="#/orders/${esc(o.number)}" data-modal-close>Open order</a></div>
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-peek]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    orderPeek(b.dataset.peek);
  }, true);

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------
  async function viewOrders(_, query) {
    setTitle("Orders");
    const q = new URLSearchParams(query || "");
    const state = { status: q.get("status") || "", q: q.get("q") || "", from: "", to: "" };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Orders</h1><p class="muted">Confirm, pack and ship orders. Cancelling or returning an order puts the stock back.</p></div>
      <button class="btn btn--ghost" id="ordCsv">Export CSV</button></div>
      <div class="tabs" id="ordTabs"></div>
      <div class="toolbar"><div class="flex ord-act"><select class="input" id="ordAct" aria-label="Action for ticked orders"><option value="">Action…</option>
          <option value="confirmed">Confirm</option><option value="hold">Hold</option><option value="cancelled">Cancel</option><option value="pathao">Send to Pathao</option>
          <option value="courier">Courier invoice</option><option value="order">Order invoice</option>${me.orderTrash ? `<option value="trash">Move to trash</option>` : ""}</select>
          <button class="btn btn--dark" type="button" id="ordApply">Apply</button><small class="muted" id="ordSelN">Tick orders first</small></div>
        <div class="ord-search"><input class="input" id="ordQ" placeholder="Search order, name or phone" value="${esc(state.q)}"></div>
        <label class="flex small muted">From <input class="input input--sm" type="date" id="ordFrom"></label><label class="flex small muted">To <input class="input input--sm" type="date" id="ordTo"></label></div>
      <div class="card card--flush" id="ordList"><p class="empty">Loading…</p></div>`;
    let all = [], trash = [];
    // Trash tab: deleted orders stay 30 days; restore them, or delete them for good
    const drawTrash = () => {
      const left = (t) => Math.max(0, Math.ceil((t - Date.now()) / 864e5));
      $("#ordList").innerHTML = trash.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Deleted</th><th></th></tr></thead><tbody>${trash.map((x) => `
        <tr><td><b>${esc(x.label.replace(/^Order /, ""))}</b><br><small class="muted">${esc(x.detail || "")}</small></td><td class="nowrap">${dateTime(x.deletedAt)}${x.deletedBy ? ` · ${esc(x.deletedBy)}` : ""}<br><small class="muted">Deleted for good in ${left(x.expiresAt)} days</small></td>
        <td class="right nowrap"><button class="btn btn--dark btn--sm" type="button" data-trestore="${esc(x.id)}">Restore</button> <button class="btn btn--danger btn--sm" type="button" data-tforever="${esc(x.id)}">Delete permanently</button></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="empty">No orders in the trash. Orders you move to the trash wait here for 30 days before they're deleted for good.</p>`;
    };
    $("#ordList").addEventListener("click", async (e) => {
      const rs = e.target.closest("[data-trestore]"), fg = e.target.closest("[data-tforever]");
      if (!rs && !fg) return;
      e.preventDefault(); e.stopPropagation();
      const x = trash.find((t) => t.id === (rs || fg).dataset[rs ? "trestore" : "tforever"]);
      if (rs) { busy(rs, true); try { const out = await api("POST", "/api/trash/" + x.id + "/restore"); toast("Order " + (out.number || "") + " restored"); load(); refreshCounts(); } catch (err) { busy(rs, false); fail(err); } return; }
      if (!(await confirmBox("Delete " + x.label + " permanently?", "It's removed for good and can't be restored.", "Delete permanently", true))) return;
      try { await api("DELETE", "/api/trash/" + x.id); toast(x.label + " deleted permanently"); load(); } catch (err) { fail(err); }
    }, true);
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set("q", state.q);
      if (state.from) params.set("from", new Date(state.from + "T00:00:00").getTime());
      if (state.to) params.set("to", new Date(state.to + "T23:59:59").getTime());
      try { all = (await api("GET", "/api/orders?" + params)).orders; } catch (err) { return fail(err); }
      if (me.orderTrash) { try { trash = (await api("GET", "/api/trash")).items.filter((x) => x.kind === "order"); } catch (_) { trash = []; } }
      draw();
    };
    const draw = () => {
      const counts = {};
      all.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
      $("#ordTabs").innerHTML = [["", "All", all.length]].concat(STATUSES.map((s) => [s, human(s), counts[s] || 0])).concat(me.orderTrash ? [["trash", "Trash", trash.length]] : [])
        .map(([k, l, n]) => `<button class="tab${state.status === k ? " is-on" : ""}${k === "trash" ? " tab--trash" : ""}" data-s="${k}">${l}<small>${n}</small></button>`).join("");
      $(".ord-act").hidden = state.status === "trash";
      if (state.status === "trash") return drawTrash();
      const list = all.filter((o) => !state.status || o.status === state.status);
      $("#ordList").innerHTML = ordersTable(list, true);
      list.forEach((o) => { const b = $(`[data-sel="${o.number}"]`); if (b) b.checked = picked.has(o.number); });
      bulkBar();
    };
    // Tick orders, then print their order or courier invoices together
    const picked = new Set();
    const bulkBar = () => { $("#ordSelN").textContent = picked.size ? picked.size + " selected" : "Tick orders first"; };
    $("#ordList").addEventListener("change", (e) => {
      if (e.target.matches("[data-selall]")) $$("[data-sel]").forEach((b) => { b.checked = e.target.checked; if (b.checked) picked.add(b.dataset.sel); else picked.delete(b.dataset.sel); });
      else if (e.target.matches("[data-sel]")) { if (e.target.checked) picked.add(e.target.dataset.sel); else picked.delete(e.target.dataset.sel); }
      bulkBar();
    });
    // Action box: the chosen action runs on the ticked orders
    $("#ordApply").onclick = () => {
      const act = $("#ordAct").value, sel = all.filter((o) => picked.has(o.number));
      if (!act) return toast("Choose an action first.", true);
      if (!sel.length) return toast("Tick the orders first.", true);
      $("#ordAct").value = "";
      if (act === "order" || act === "courier") return go("invoices?type=" + act + "&orders=" + sel.map((o) => o.number).join(","));
      if (act === "pathao") return bulkPathao(sel);
      if (act === "trash") return bulkTrash(sel);
      listStatus(sel, act);
    };
    const bulkPathao = async (sel) => {
      const ok = sel.filter((o) => !(o.pathao && o.pathao.consignmentId) && ["cancelled", "returned", "delivered", "partial_return", "shipped"].indexOf(o.status) < 0);
      const skip = sel.length - ok.length;
      if (!ok.length) return toast("These orders are already with Pathao, or closed.", true);
      if (!(await confirmBox("Send " + (ok.length === 1 ? ok[0].number : ok.length + " orders") + " to Pathao?", "City and zone are picked from each address. If one can't be matched, a form opens for it." + (skip ? " " + skip + " ticked order" + (skip > 1 ? "s are" : " is") + " skipped: already sent or closed." : ""), "Send to Pathao"))) return;
      const btn = $("#ordApply"); busy(btn, true);
      let done = 0; const bad = [];
      for (const o of ok) { try { if (await pathaoQuickSend(o)) done++; } catch (err) { bad.push(o.number + ": " + err.message); } }
      busy(btn, false); picked.clear();
      toast(done + " sent to Pathao" + (bad.length ? ". Not sent: " + bad.join("; ") : ""), !!bad.length);
      load();
    };
    const bulkTrash = async (sel) => {
      if (!(await confirmBox("Move " + (sel.length === 1 ? "order " + sel[0].number : sel.length + " orders") + " to the trash?", "They leave Orders and your sales numbers, and items of open orders go back into stock. They wait in the Trash tab for 30 days, so you can restore them.", "Move to trash", true))) return;
      let done = 0; const bad = [];
      for (const o of sel) { try { await api("DELETE", "/api/orders/" + o.id); done++; } catch (err) { bad.push(o.number + ": " + err.message); } }
      picked.clear();
      toast(done + " moved to trash" + (bad.length ? ". Not moved: " + bad.join("; ") : ""), !!bad.length);
      load(); refreshCounts();
    };
    // One order (row button) or many (ticked): confirm, hold or cancel with an optional note
    const LABEL = { confirmed: ["Confirm", "confirmed", "btn--dark"], hold: ["Put on hold", "on hold", "btn--dark"], cancelled: ["Cancel", "cancelled", "btn--danger"] };
    const listStatus = (orders, s) => {
      const ok = orders.filter((o) => canDo(o, s)), skip = orders.length - ok.length, L = LABEL[s];
      if (!ok.length) return toast(orders.length > 1 ? "None of these orders can be " + L[1] + " now." : "This order can't be " + L[1] + " now.", true);
      const names = ok.length === 1 ? "order " + ok[0].number : ok.length + " orders";
      const body = modal(L[0] + " " + names + "?", `<form class="stack" id="lsForm">
        <p class="muted" style="margin:0">${ok.length > 1 ? esc(ok.map((o) => o.number).join(", ")) + "." : ""}${s === "cancelled" ? " The items go back into stock." : s === "hold" ? " The items stay reserved while the order is on hold." : ""}${skip ? ` ${skip} selected order${skip > 1 ? "s are" : " is"} skipped: already with the courier, or already in a status that can't change this way.` : ""}</p>
        <label class="field"><span>Reason or note (optional)</span><input class="input" name="note" maxlength="300"></label>
        ${s !== "confirmed" ? `<label class="check"><input type="checkbox" name="notifyCustomer"> Show this note to the customer on the order tracking page</label>` : ""}
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Back</button><button class="btn ${L[2]}" type="submit">${L[0]}${ok.length > 1 ? " " + ok.length : ""}</button></div></form>`);
      $("#lsForm", body).onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target), btn = $("button[type=submit]", e.target); busy(btn, true);
        let done = 0; const bad = [];
        for (const o of ok) { try { await api("PATCH", "/api/orders/" + o.number, { status: s, note: f.note, notifyCustomer: !!f.notifyCustomer }); done++; } catch (err) { bad.push(o.number + ": " + err.message); } }
        closeModal(); picked.clear();
        toast(bad.length ? done + " done. Not changed: " + bad.join("; ") : (done === 1 ? ok[0].number + " " + L[1] : done + " orders " + L[1]), !!bad.length);
        load(); refreshCounts();
      };
    };
    $("#ordList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      listStatus(all.filter((o) => o.number === b.dataset.num), b.dataset.act);
    }, true);
    // One click: Send to Pathao guesses the city and zone from the address; if it can't, the full form opens
    $("#ordList").addEventListener("click", async (e) => {
      if (e.target.closest("[data-stop]")) { e.stopPropagation(); return; }
      const b = e.target.closest("[data-pathao]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const o = all.filter((x) => x.id === b.dataset.pathao)[0];
      if (!o) return;
      b.disabled = true; b.textContent = "Sending…";
      try {
        const sent = await pathaoQuickSend(o);
        if (!sent) { b.disabled = false; b.textContent = "Send to Pathao"; return; }
        toast(o.number + " sent to Pathao · " + sent);
        load();
      } catch (err) { b.disabled = false; b.textContent = "Send to Pathao"; fail(err); }
    }, true);
    // Live: Pathao updates arrive by webhook, so the list reloads by itself every 30 seconds while it's open
    const timer = setInterval(() => { if (!document.body.contains($("#ordList"))) return clearInterval(timer); if (document.visibilityState === "visible" && !document.querySelector("#modal:not([hidden])")) load(); }, 30000);
    $("#ordTabs").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) { state.status = b.dataset.s; draw(); } };
    $("#ordQ").oninput = debounce((e) => { state.q = e.target.value.trim(); load(); }, 250);
    $("#ordFrom").onchange = (e) => { state.from = e.target.value; load(); };
    $("#ordTo").onchange = (e) => { state.to = e.target.value; load(); };
    $("#ordCsv").onclick = async () => {
      const params = new URLSearchParams({ full: "1" });
      if (state.from) params.set("from", new Date(state.from + "T00:00:00").getTime());
      if (state.to) params.set("to", new Date(state.to + "T23:59:59").getTime());
      const r = await api("GET", "/api/orders?" + params).catch(fail);
      if (!r) return;
      const rows = [["Order", "Date", "Status", "Payment status", "Payment method", "Customer", "Phone", "Email", "Address", "City", "Delivery area", "Items", "Subtotal", "Discount", "Coupon", "Delivery", "Total", "Tracking", "Note"]];
      r.orders.filter((o) => !state.status || o.status === state.status).forEach((o) => rows.push([o.number, new Date(o.createdAt).toISOString(), o.status, o.paymentStatus, o.paymentMethod, o.customer.name, o.customer.phone, o.customer.email, o.customer.address, o.customer.city,
        o.shippingZone ? o.shippingZone.name : "", o.items.map((i) => `${i.qty}× ${i.name} ${optText(i.options)} (${i.sku})`).join("; "), o.subtotal, o.discount, o.coupon, o.shipping, o.total, o.tracking || "", o.note || ""]));
      download("ravelle-orders.csv", csv(rows));
    };
    load();
  }

  async function viewOrder(id) {
    setTitle("Order " + id);
    let o;
    let acoreOn = false;
    try { const r = await api("GET", "/api/orders/" + encodeURIComponent(id)); o = r.order; acoreOn = !!r.acoreOn; } catch (err) { view.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const tel = o.customer.phone;
    // Once the courier has the parcel, the order can't be edited here any more
    const onCourier = !!((o.pathao && o.pathao.consignmentId) || (o.courier && o.courier.consignmentId) || ["shipped", "delivered", "partial_return", "returned"].indexOf(o.status) > -1);
    const retOf = (it) => (o.returns || []).filter((r) => r.productId === it.productId && (r.variantId || null) === (it.variantId || null)).reduce((n, r) => n + r.qty, 0);
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/orders">← Orders</a><h1 class="h1" style="margin-top:8px">Order ${esc(o.number)}</h1>
      <p class="muted">${dateTime(o.createdAt)} · ${pill(o.status)} ${pill(o.paymentStatus)}</p></div>
      <div class="flex">${o.status === "pending" || o.status === "hold" ? `<button class="btn btn--dark" type="button" data-quick="confirmed">Confirm</button>` : ""}${!onCourier && ["pending", "confirmed", "processing"].indexOf(o.status) > -1 ? `<button class="btn btn--ghost" type="button" data-quick="hold">Hold</button>` : ""}${["cancelled", "returned", "delivered", "shipped", "partial_return"].indexOf(o.status) < 0 ? `<button class="btn btn--ghost" type="button" data-quick="cancelled">Cancel order</button>` : ""}${o.status === "partial_return" ? `<button class="btn btn--ghost" type="button" data-quick="delivered">Undo partial return</button>` : ""}${o.status === "cancelled" ? `<button class="btn btn--ghost" type="button" data-quick="pending">Reopen</button>` : ""}${onCourier ? "" : `<button class="btn btn--ghost" type="button" id="oEdit">Edit order</button>`}${onCourier && ["cancelled", "returned"].indexOf(o.status) < 0 ? `<button class="btn btn--ghost" type="button" id="oPartial">${o.status === "partial_return" ? "Change returned items" : "Partial return"}</button>` : ""}<a class="btn btn--ghost" href="#/orders/${esc(o.number)}/invoice">Order invoice</a><a class="btn btn--ghost" href="#/orders/${esc(o.number)}/courier-invoice">Courier invoice</a><a class="btn btn--ghost" href="tel:${esc(tel)}">Call customer</a>${me.orderTrash ? `<button class="btn btn--danger" type="button" id="oDel">Move to trash</button>` : ""}</div></div>
      <div class="cols">
        <div class="stack">
          <div class="card"><h2 class="h2">Items</h2><div class="items">${o.items.map((it) => `<div class="item">${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="ph"></span>`}
            <div><a href="#/products/${esc(it.productId)}"><b>${esc(it.name)}</b></a><small>${esc(optText(it.options))} · SKU ${esc(it.sku)}</small><small>${it.qty} × ${taka(it.price)}</small>${retOf(it) ? `<small style="color:var(--danger)">Returned: ${retOf(it)} of ${it.qty}</small>` : ""}</div><b class="num">${taka(it.lineTotal)}</b></div>`).join("")}</div>
            <div class="totals"><div><span>Subtotal</span><span class="num">${taka(o.subtotal)}</span></div>${o.discount ? `<div><span>Discount${o.coupon ? " (" + esc(o.coupon) + ")" : ""}</span><span class="num">−${taka(o.discount)}</span></div>` : ""}
              <div><span>Delivery${o.shippingZone ? " · " + esc(o.shippingZone.name) : ""}</span><span class="num">${o.shipping ? taka(o.shipping) : "Free"}</span></div><div class="grand"><span>Total</span><span class="num">${taka(o.total)}</span></div>${o.returnedValue ? `<div style="color:var(--danger)"><span>Returned items</span><span class="num">−${taka(o.returnedValue)}</span></div><div><span>Kept by customer</span><span class="num">${taka(o.total - o.returnedValue)}</span></div>` : ""}${o.collected != null ? `<div><span>Cash collected by courier</span><span class="num">${taka(o.collected)}</span></div>` : ""}</div>
            ${onCourier && o.status !== "cancelled" ? `<p class="muted small" style="margin:10px 0 0">With the courier: the order can't be edited any more. Status updates from Pathao change it here by themselves.</p>` : ""}</div>
          <div class="card"><h2 class="h2">Update order</h2>
            <form class="stack" id="ordForm">
              <div class="row row--3"><label class="field"><span>Order status</span><select class="input" name="status">${STATUSES.map((s) => `<option value="${s}"${s === o.status ? " selected" : ""}>${human(s)}</option>`).join("")}</select></label>
              <label class="field"><span>Payment</span><select class="input" name="paymentStatus">${PAY_STATUSES.map((s) => `<option value="${s}"${s === o.paymentStatus ? " selected" : ""}>${human(s)}</option>`).join("")}</select></label>
              <label class="field"><span>Courier tracking</span><input class="input" name="tracking" value="${esc(o.tracking || "")}" placeholder="e.g. Pathao 12345678"></label></div>
              <label class="field"><span>Note</span><textarea class="input" name="note" rows="2" placeholder="Called the customer, confirmed size…"></textarea></label>
              <label class="check"><input type="checkbox" name="notifyCustomer"> Show this note to the customer on the order tracking page</label>
              <div class="flex"><button class="btn btn--dark" type="submit">Save changes</button><small class="muted">Cancelled and returned orders go back into stock.</small></div>
            </form></div>
          <div class="card"><h2 class="h2">History</h2><ul class="timeline">${o.history.slice().reverse().map((h) => `<li><div>${esc(h.note || human(h.status))}${h.public ? `<small>Shown to customer: ${esc(h.public)}</small>` : ""}<small>${dateTime(h.at)} · ${esc(h.by || "")}</small></div></li>`).join("")}</ul></div>
        </div>
        <div class="stack">
          <div class="card"><h2 class="h2">Customer</h2><dl class="kv"><dt>Name</dt><dd>${esc(o.customer.name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(tel)}">${esc(tel)}</a></dd>
            ${o.customer.email ? `<dt>Email</dt><dd><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></dd>` : ""}<dt>Address</dt><dd>${esc(o.customer.address)}${o.customer.area ? ", " + esc(o.customer.area) : ""}${o.customer.city ? ", " + esc(o.customer.city) : ""}</dd>
            ${o.shippingZone ? `<dt>Area</dt><dd>${esc(o.shippingZone.name)} · ${esc(o.shippingZone.days)}</dd>` : ""}</dl>
            ${o.customerId && can("customers") ? `<a class="btn btn--ghost btn--sm" href="#/customers/${esc(o.customerId)}">Customer profile</a>` : ""}</div>
          ${(() => {
            const pt = o.pathao || {};
            return `<div class="card"><h2 class="h2">Pathao courier</h2>${pt.consignmentId ? `<dl class="kv"><dt>Consignment</dt><dd class="mono">${esc(pt.consignmentId)}</dd>
              <dt>Pathao status</dt><dd>${esc(String(pt.status || "sent").replace(/_/g, " "))}</dd>${pt.fee ? `<dt>Delivery fee</dt><dd>${taka(pt.fee)}</dd>` : ""}
              <dt>Collect</dt><dd>${taka(pt.amount || 0)}</dd><dt>Sent</dt><dd>${dateTime(pt.sentAt)}</dd>
              ${o.courier && o.courier.trackingUrl ? `<dt>Tracking</dt><dd><a href="${esc(o.courier.trackingUrl)}" target="_blank" rel="noopener">Open Pathao tracking</a></dd>` : ""}</dl>
              <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="pathaoRefresh">Refresh from Pathao</button><button class="btn btn--ghost btn--sm" type="button" id="pathaoSend" data-again="1">Send again</button></div>`
              : `<p class="muted small" style="margin:0 0 10px">Make a Pathao parcel for this order. Pathao picks it up from your store and updates the status here.</p><button class="btn btn--dark btn--sm" type="button" id="pathaoSend">Send to Pathao</button>`}</div>`;
          })()}
          ${(() => {
            const a = o.acore || {}, cr = o.courier || {};
            // Shown while Acore is turned on, or for orders that went to Acore before
            if (!acoreOn && !o.acore) return "";
            const state = a.pending ? "Sending…" : a.error ? `<span style="color:var(--danger)">Not sent: ${esc(a.error)}</span>` : a.sentAt ? `Sent ${dateTime(a.sentAt)}${a.id ? ` · Acore id <span class="mono">${esc(a.id)}</span>` : ""}` : "Not sent yet";
            return `<div class="card"><h2 class="h2">Acore and courier</h2><dl class="kv"><dt>Acore</dt><dd>${state}</dd>
              ${a.lastUpdate ? `<dt>Last update</dt><dd>${dateTime(a.lastUpdate)}</dd>` : ""}
              ${cr.name ? `<dt>Courier</dt><dd>${esc(cr.name)}</dd>` : ""}${cr.consignmentId ? `<dt>Consignment</dt><dd class="mono">${esc(cr.consignmentId)}</dd>` : ""}
              ${cr.trackingUrl ? `<dt>Tracking</dt><dd><a href="${esc(cr.trackingUrl)}" target="_blank" rel="noopener">Open courier page</a></dd>` : ""}
              ${cr.riderName ? `<dt>Rider</dt><dd>${esc(cr.riderName)}${cr.riderPhone ? ` · <a href="tel:${esc(cr.riderPhone)}">${esc(cr.riderPhone)}</a>` : ""}</dd>` : ""}</dl>
              <button class="btn btn--ghost btn--sm" type="button" id="acoreSend">${a.sentAt ? "Send again" : "Send to Acore"}</button></div>`;
          })()}
          <div class="card"><h2 class="h2">Payment</h2><dl class="kv"><dt>Method</dt><dd>${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)}</dd><dt>Status</dt><dd>${pill(o.paymentStatus)}</dd>${o.paymentRef ? `<dt>${o.paymentSender ? "TrxID" : "Reference"}</dt><dd class="mono">${esc(o.paymentRef)}</dd>` : ""}${o.paymentSender ? `<dt>Sent from</dt><dd class="mono">${esc(o.paymentSender)}</dd>` : ""}</dl>
            ${o.paymentSender && o.paymentStatus === "unpaid" ? `<p class="small muted" style="margin:8px 0 0">Check this TrxID in your ${esc(PAY_LABEL[o.paymentMethod])} app or statement. If the money is there, set Payment to Paid above.</p>` : ""}</div>
          ${o.note ? `<div class="card"><h2 class="h2">Customer note</h2><p style="margin:0">${esc(o.note)}</p></div>` : ""}
        </div>
      </div>`;
    $("#pathaoSend").onclick = (e) => pathaoSendDialog(o, !!e.target.dataset.again, () => viewOrder(id));
    if ($("#pathaoRefresh")) $("#pathaoRefresh").onclick = async (e) => {
      busy(e.target, true);
      try { const r = await api("POST", "/api/orders/" + o.id + "/pathao-status"); toast("Pathao: " + String(r.status || "updated").replace(/_/g, " ")); viewOrder(id); } catch (err) { busy(e.target, false); fail(err); }
    };
    if ($("#acoreSend")) $("#acoreSend").onclick = async () => {
      try { await api("POST", "/api/orders/" + o.id + "/acore"); toast("Sending to Acore"); setTimeout(() => viewOrder(id), 1500); } catch (err) { fail(err); }
    };
    $("#ordForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(e.target), btn = $("button[type=submit]", e.target);
      if ((b.status === "cancelled" || b.status === "returned") && b.status !== o.status && !(await confirmBox("Mark as " + b.status + "?", "The items go back into stock.", "Yes, " + b.status, true))) return;
      busy(btn, true);
      try { await api("PATCH", "/api/orders/" + o.number, b); toast("Order updated"); viewOrder(o.number); refreshCounts(); }
      catch (err) { fail(err); busy(btn, false); }
    };
    // Quick status buttons: Confirm, Hold, Cancel, Reopen
    $$("[data-quick]", view).forEach((b) => { b.onclick = async () => {
      const s = b.dataset.quick, msg = { confirmed: ["Confirm order " + o.number + "?", "The order moves to Confirmed.", "Confirm"], hold: ["Put " + o.number + " on hold?", "Use this while you wait for the customer, for example to check the size or address. The items stay reserved.", "Put on hold"],
        cancelled: ["Cancel order " + o.number + "?", "The items go back into stock." + (o.pathao && o.pathao.consignmentId ? " This order is already with Pathao, so cancel the parcel in the Pathao panel too." : ""), "Cancel order"], pending: ["Reopen order " + o.number + "?", "The items come out of stock again.", "Reopen"], delivered: ["Undo the partial return?", "The order goes back to Delivered and the returned items come out of stock again.", "Undo"] }[s];
      let note = "";
      const body = modal(msg[0], `<form class="stack" id="qkForm"><p class="muted" style="margin:0">${esc(msg[1])}</p>
        <label class="field"><span>Reason or note (optional)</span><input class="input" name="note" maxlength="300" placeholder="${s === "hold" ? "Waiting for the customer to confirm the size" : s === "cancelled" ? "Customer cancelled on the phone" : ""}"></label>
        ${s === "cancelled" || s === "hold" ? `<label class="check"><input type="checkbox" name="notifyCustomer"> Show this note to the customer on the order tracking page</label>` : ""}
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Back</button><button class="btn ${s === "cancelled" ? "btn--danger" : "btn--dark"}" type="submit">${msg[2]}</button></div></form>`);
      $("#qkForm", body).onsubmit = async (e) => {
        e.preventDefault();
        const f = formData(e.target), btn = $("button[type=submit]", e.target); busy(btn, true);
        try { await api("PATCH", "/api/orders/" + o.number, { status: s, note: f.note, notifyCustomer: !!f.notifyCustomer }); closeModal(); toast(o.number + ": " + human(s)); viewOrder(o.number); refreshCounts(); }
        catch (err) { busy(btn, false); fail(err); }
      };
    }; });
    if ($("#oEdit")) $("#oEdit").onclick = () => orderEditDialog(o, () => { viewOrder(o.number); refreshCounts(); });
    if ($("#oPartial")) $("#oPartial").onclick = () => partialReturnDialog(o, () => { viewOrder(o.number); refreshCounts(); });
    if ($("#oDel")) $("#oDel").onclick = async () => {
      const live = !o.restocked && o.status !== "delivered";
      if (!(await confirmBox("Delete order " + o.number + "?", "It disappears from Orders and your sales numbers" + (live ? ", and its items go back into stock" : "") + ". It stays in Trash for 30 days, so you can restore it.", "Delete order", true))) return;
      try { await api("DELETE", "/api/orders/" + o.id); toast("Order moved to Trash"); refreshCounts(); go("orders"); } catch (err) { fail(err); }
    };
  }

  // Edit an order by hand: customer, items (size, quantity, price, add or remove), delivery and discount
  async function orderEditDialog(o, done) {
    let st;
    try { st = await loadStore(true); } catch (err) { return fail(err); }
    const prods = st.products.slice().sort((a, b) => a.name.localeCompare(b.name));
    const zones = ((st.settings && st.settings.shipping) || {}).zones || [];
    const locked = o.status === "shipped" || o.status === "delivered";
    // Products on the order that are hidden from the store now still need to be choosable
    o.items.forEach((it) => { if (!prods.some((p) => p.id === it.productId)) prods.unshift({ id: it.productId, name: it.name + " (hidden)", price: it.price, variants: it.variantId ? [{ id: it.variantId, options: it.options, stock: null }] : [], trackStock: false }); });
    let rows = o.items.map((it) => ({ productId: it.productId, variantId: it.variantId, qty: it.qty, price: it.price, was: it.qty, orig: it }));
    const held = !o.restocked;
    const free = (p, v, r) => { if (!p.trackStock) return null; const s = v ? v.stock : p.stock; const back = held && r.orig && r.orig.productId === p.id && (r.orig.variantId || null) === (v ? v.id : null) ? r.orig.qty : 0; return s == null ? null : s + back; };
    const body = modal("Edit order " + o.number, `<form class="stack" id="oeForm">
      ${locked ? `<p class="muted small" style="margin:0">This order is ${esc(o.status)}, so only the customer details can change.</p>` : ""}
      ${o.pathao && o.pathao.consignmentId ? `<p class="small" style="margin:0;color:var(--danger)">Already sent to Pathao (${esc(o.pathao.consignmentId)}). Changes here don't update the Pathao parcel, so change it in the Pathao panel too.</p>` : ""}
      <h3 class="h3" style="margin:4px 0 0">Customer</h3>
      <div class="row row--2"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(o.customer.name)}" maxlength="80" required></label>
      <label class="field"><span>Phone</span><input class="input" name="phone" value="${esc(o.customer.phone)}" maxlength="20" required></label></div>
      <label class="field"><span>Address</span><input class="input" name="address" value="${esc(o.customer.address)}" maxlength="300" required></label>
      <div class="row row--2"><label class="field"><span>City</span><input class="input" name="city" value="${esc(o.customer.city || "")}" maxlength="60"></label>
      <label class="field"><span>Email (optional)</span><input class="input" name="email" type="email" value="${esc(o.customer.email || "")}" maxlength="120"></label></div>
      <h3 class="h3" style="margin:8px 0 0">Items</h3>
      <div id="oeItems" class="stack" style="gap:8px"></div>
      ${locked ? "" : `<button class="btn btn--ghost btn--sm" type="button" id="oeAdd" style="align-self:flex-start">+ Add product</button>`}
      <div class="row row--3"><label class="field"><span>Delivery area</span><select class="input" name="zone"${locked ? " disabled" : ""}>${zones.map((z) => `<option value="${esc(z.id)}" data-fee="${z.fee}"${o.shippingZone && o.shippingZone.id === z.id ? " selected" : ""}>${esc(z.name)} · ${taka(z.fee)}</option>`).join("")}</select></label>
      <label class="field"><span>Delivery charge (৳)</span><input class="input" name="shipping" type="number" min="0" step="1" value="${o.shipping}"${locked ? " disabled" : ""}></label>
      <label class="field"><span>Discount (৳)</span><input class="input" name="discount" type="number" min="0" step="1" value="${o.discount || 0}"${locked ? " disabled" : ""}></label></div>
      <div class="totals" id="oeTotals"></div>
      <label class="field"><span>Why (optional, staff only)</span><input class="input" name="note" maxlength="300" placeholder="Customer asked for size L instead of M"></label>
      <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save changes</button></div></form>`, { wide: true, noFocus: true });
    const f = $("#oeForm", body), box = $("#oeItems", body);
    const pOf = (id) => prods.filter((p) => p.id === id)[0];
    const draw = () => {
      box.innerHTML = rows.map((r, i) => {
        const p = pOf(r.productId), vs = (p && p.variants) || [];
        const v = vs.filter((x) => x.id === r.variantId)[0], left = p ? free(p, v, r) : null;
        return `<div class="flex" data-i="${i}" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
          <label class="field" style="flex:2 1 220px"><span>Product</span><select class="input" data-k="productId"${locked ? " disabled" : ""}>${prods.map((x) => `<option value="${esc(x.id)}"${x.id === r.productId ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
          ${vs.length ? `<label class="field" style="flex:1 1 110px"><span>Size</span><select class="input" data-k="variantId"${locked ? " disabled" : ""}><option value="">Choose…</option>${vs.map((x) => { const l = free(p, x, r); return `<option value="${esc(x.id)}"${x.id === r.variantId ? " selected" : ""}>${esc(optText(x.options))}${l != null ? " · " + l + " left" : ""}</option>`; }).join("")}</select></label>` : ""}
          <label class="field" style="flex:0 1 80px"><span>Qty</span><input class="input" type="number" min="1" max="50" data-k="qty" value="${r.qty}"${locked ? " disabled" : ""}></label>
          <label class="field" style="flex:0 1 110px"><span>Price (৳)</span><input class="input" type="number" min="0" data-k="price" value="${r.price}"${locked ? " disabled" : ""}></label>
          ${locked ? "" : `<button class="btn btn--ghost btn--sm" type="button" data-rm title="Remove" style="margin-bottom:4px">Remove</button>`}
          ${left != null && r.qty > left ? `<small style="flex-basis:100%;color:var(--danger)">Only ${left} in stock</small>` : ""}</div>`;
      }).join("") || `<p class="muted">No items.</p>`;
      totals();
    };
    const totals = () => {
      const sub = rows.reduce((n, r) => n + (+r.price || 0) * (+r.qty || 0), 0), ship = +f.shipping.value || 0, disc = Math.min(sub, +f.discount.value || 0);
      $("#oeTotals", body).innerHTML = `<div><span>Subtotal</span><span class="num">${taka(sub)}</span></div>${disc ? `<div><span>Discount</span><span class="num">−${taka(disc)}</span></div>` : ""}<div><span>Delivery</span><span class="num">${taka(ship)}</span></div>
        <div class="grand"><span>New total</span><span class="num">${taka(sub - disc + ship)}</span></div>${sub - disc + ship !== o.total ? `<small class="muted">Was ${taka(o.total)}</small>` : ""}`;
    };
    box.addEventListener("change", (e) => {
      const row = e.target.closest("[data-i]"); if (!row) return;
      const r = rows[+row.dataset.i], k = e.target.dataset.k;
      if (k === "productId") { const p = pOf(e.target.value); r.productId = p.id; r.variantId = null; r.price = p.price; r.orig = null; const first = (p.variants || []).filter((v) => v.stock == null || v.stock > 0)[0]; if (first) { r.variantId = first.id; if (first.price != null) r.price = first.price; } draw(); }
      else if (k === "variantId") { r.variantId = e.target.value || null; const v = (pOf(r.productId).variants || []).filter((x) => x.id === r.variantId)[0]; if (v && v.price != null && !r.orig) r.price = v.price; draw(); }
      else { r[k] = Math.max(k === "qty" ? 1 : 0, Math.round(+e.target.value || 0)); draw(); }
    });
    box.addEventListener("input", (e) => { const row = e.target.closest("[data-i]"); if (row && (e.target.dataset.k === "qty" || e.target.dataset.k === "price")) { rows[+row.dataset.i][e.target.dataset.k] = +e.target.value || 0; totals(); } });
    box.addEventListener("click", (e) => { if (!e.target.closest("[data-rm]")) return; rows.splice(+e.target.closest("[data-i]").dataset.i, 1); draw(); });
    if ($("#oeAdd", body)) $("#oeAdd", body).onclick = () => { const p = prods.filter((x) => !x.trackStock || x.stock > 0)[0] || prods[0]; const v = (p.variants || []).filter((x) => x.stock == null || x.stock > 0)[0]; rows.push({ productId: p.id, variantId: v ? v.id : null, qty: 1, price: v && v.price != null ? v.price : p.price, orig: null }); draw(); };
    f.zone.onchange = () => { const opt = f.zone.selectedOptions[0]; if (opt) f.shipping.value = opt.dataset.fee; totals(); };
    f.shipping.oninput = totals; f.discount.oninput = totals;
    draw();
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!locked && !rows.length) return toast("Keep at least one item. To drop the whole order, cancel it.", true);
      if (rows.some((r) => { const p = pOf(r.productId); return p && (p.variants || []).length && !r.variantId; })) return toast("Choose a size for every item.", true);
      const b = { customer: { name: f.name.value, phone: f.phone.value, email: f.email.value, address: f.address.value, city: f.city.value }, note: f.note.value };
      if (!locked) Object.assign(b, { items: rows.map((r) => ({ productId: r.productId, variantId: r.variantId, qty: +r.qty, price: +r.price })), zone: f.zone.value, shipping: f.shipping.value, discount: f.discount.value });
      const btn = $("button[type=submit]", f); busy(btn, true);
      try { const r = await api("PUT", "/api/orders/" + o.id + "/edit", b); closeModal(); toast(r.changed ? "Order " + o.number + " updated" : "Nothing changed"); done(); }
      catch (err) { busy(btn, false); fail(err); }
    };
  }

  // Partial return: pick which items (and how many) came back; they go back into stock
  function partialReturnDialog(o, done) {
    const prev = (it) => (o.returns || []).filter((r) => r.productId === it.productId && (r.variantId || null) === (it.variantId || null)).reduce((n, r) => n + r.qty, 0);
    const body = modal("Partial return · " + o.number, `<form class="stack" id="prForm">
      <p class="muted small" style="margin:0">The customer kept some items and sent the rest back with the courier. Enter how many of each item came back. Those go back into stock.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th class="right">Ordered</th><th class="right" style="width:120px">Came back</th></tr></thead><tbody>
      ${o.items.map((it, i) => `<tr><td><b>${esc(it.name)}</b><br><small class="muted">${esc(optText(it.options))} · ${taka(it.price)} each</small></td><td class="right num">${it.qty}</td>
        <td class="right"><input class="input input--sm" type="number" min="0" max="${it.qty}" step="1" data-ri="${i}" value="${prev(it)}" style="width:80px;text-align:right"></td></tr>`).join("")}</tbody></table></div>
      <div class="row row--2"><label class="field"><span>Cash the courier collected (৳)</span><input class="input" name="collected" type="number" min="0" step="1" value="${o.collected != null ? o.collected : ""}" placeholder="${o.paymentStatus === "paid" ? "Paid online" : ""}"></label>
      <div class="totals" id="prSum" style="align-self:end"></div></div>
      <label class="field"><span>Note (optional)</span><input class="input" name="note" maxlength="300" placeholder="Size didn't fit"></label>
      <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save partial return</button></div></form>`, { wide: true });
    const f = $("#prForm", body);
    const picks = () => $$("[data-ri]", f).map((el) => ({ index: +el.dataset.ri, qty: Math.max(0, Math.min(+el.max, Math.round(+el.value || 0))) }));
    const sum = () => {
      const ret = picks().reduce((n, p) => n + p.qty * o.items[p.index].price, 0);
      $("#prSum", body).innerHTML = `<div><span>Returned</span><span class="num">${taka(ret)}</span></div><div class="grand"><span>Customer keeps</span><span class="num">${taka(o.total - ret)}</span></div>`;
    };
    f.addEventListener("input", sum); sum();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", f); busy(btn, true);
      try { await api("POST", "/api/orders/" + o.id + "/partial-return", { items: picks().filter((p) => p.qty), collected: f.collected.value, note: f.note.value }); closeModal(); toast(o.number + " marked partly returned"); done(); }
      catch (err) { busy(btn, false); fail(err); }
    };
  }

  // QR code as SVG (qrcode.js, MIT, Kazuhiko Arase)
  function qr(text, px) {
    if (!window.qrcode) return "";
    const q = window.qrcode(0, "M"); q.addData(String(text)); q.make();
    const n = q.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return `<svg class="qr" viewBox="0 0 ${n + 4} ${n + 4}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR ${esc(text)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  // Code 128 (set B) barcode for order and parcel numbers, drawn as SVG
  function barcode(text, h) {
    const P = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
    const codes = [104].concat([...String(text)].map((ch) => Math.max(0, Math.min(94, ch.charCodeAt(0) - 32))));
    codes.push(codes.reduce((s, c, i) => s + c * (i || 1), 0) % 103, 106);
    let x = 10, bars = "";
    codes.forEach((c) => { [...P[c]].forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="${h}"/>`; x += +w; }); });
    return `<svg viewBox="0 0 ${x + 10} ${h}" height="${h}" style="width:100%;max-width:${(x + 10) * 1.6}px" preserveAspectRatio="none" aria-label="${esc(text)}">${bars}</svg>`;
  }
  const kept = (o, it) => it.qty - (o.returns || []).filter((r) => r.productId === it.productId && (r.variantId || null) === (it.variantId || null)).reduce((n, r) => n + r.qty, 0);
  // Order invoice: the customer's bill, with prices
  function orderInvoiceHtml(o, st) {
    return `<div class="card inv-page" style="max-width:820px;padding:36px">
        <div class="flex flex--between" style="align-items:flex-start"><div><img src="assets/img/logo.webp" alt="Ravelle" style="height:26px;width:auto"><p class="small muted">${esc(st.legalName || "")}<br>${esc(st.address || "")}<br>${esc(st.phone || "")} · ${esc(st.email || "")}${st.tradeLicense ? "<br>Trade license: " + esc(st.tradeLicense) : ""}${st.bin ? " · BIN: " + esc(st.bin) : ""}</p></div>
          <div class="right"><h1 class="h1">Invoice</h1><p class="muted">${esc(o.number)}<br>${date(o.createdAt)}<br>${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)} · ${esc(human(o.paymentStatus))}</p><div class="flex" style="justify-content:flex-end;align-items:center;gap:10px;margin-top:6px"><div style="width:150px">${barcode(o.number, 34)}</div>${qr((st.website || location.origin).replace(/\/$/, "") + "/order/" + o.number, 74)}</div><small class="muted">Scan to track ${esc(o.number)}</small></div></div>
        <div><p class="h3">Bill to</p><p style="margin:0">${esc(o.customer.name)}<br>${esc(o.customer.phone)}<br>${esc(o.customer.address)}${o.customer.area ? ", " + esc(o.customer.area) : ""}${o.customer.city ? ", " + esc(o.customer.city) : ""}</p></div>
        <table class="t"><thead><tr><th>Item</th><th>SKU</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>${o.items.map((it) => `<tr><td>${esc(it.name)}<br><small class="muted">${esc(optText(it.options))}</small>${kept(o, it) < it.qty ? `<br><small>Returned: ${it.qty - kept(o, it)}</small>` : ""}</td><td class="mono">${esc(it.sku)}</td><td class="right">${it.qty}</td><td class="right">${taka(it.price)}</td><td class="right">${taka(it.lineTotal)}</td></tr>`).join("")}</tbody></table>
        <div class="totals" style="margin-left:auto;width:min(300px,100%)"><div><span>Subtotal</span><span>${taka(o.subtotal)}</span></div>${o.discount ? `<div><span>Discount</span><span>−${taka(o.discount)}</span></div>` : ""}<div><span>Delivery</span><span>${taka(o.shipping)}</span></div><div class="grand"><span>Total</span><span>${taka(o.total)}</span></div>
          ${o.returnedValue ? `<div><span>Returned items</span><span>−${taka(o.returnedValue)}</span></div><div class="grand"><span>Final amount</span><span>${taka(o.total - o.returnedValue)}</span></div>` : ""}</div>
        <p class="small muted">Thank you for shopping with ${esc(st.name || "Ravelle")}. Exchanges and returns within 7 days of delivery: ${esc((st.website || "").replace(/^https?:\/\//, ""))}/refund</p>
      </div>`;
  }
  // Courier invoice: the parcel slip that goes on the package. Who to deliver to, cash to collect, what is inside; no item prices
  function courierInvoiceHtml(o, st) {
    const due = o.paymentStatus === "paid" ? 0 : Math.round(o.pathao && o.pathao.amount != null ? o.pathao.amount : o.total);
    const cid = (o.pathao && o.pathao.consignmentId) || (o.courier && o.courier.consignmentId) || "";
    const qty = o.items.reduce((n, it) => n + it.qty, 0);
    return `<div class="slip inv-page">
      <div class="slip__top"><img src="assets/img/logo.webp" alt="Ravelle"><div class="right"><b>${cid ? "Pathao" : "Courier"}</b><br><small>${date(o.createdAt)}</small></div></div>
      <div class="slip__codes"><div><small>Order</small><b class="mono">${esc(o.number)}</b>${barcode(o.number, 46)}</div>${cid ? `<div class="slip__pt"><div><small>Pathao ID</small><b class="mono">${esc(cid)}</b>${barcode(cid, 40)}</div>${qr(cid, 86)}</div>` : ""}</div>
      <div class="slip__to"><small>Deliver to</small><b class="slip__name">${esc(o.customer.name)}</b><b class="slip__phone">${esc(o.customer.phone)}</b>
        <p>${esc(o.customer.address)}${o.customer.area ? ", " + esc(o.customer.area) : ""}${o.customer.city ? ", " + esc(o.customer.city) : ""}</p>${o.shippingZone ? `<small>Delivery: ${esc(o.shippingZone.name)}</small>` : ""}</div>
      <div class="slip__cod"><span>${due ? "Collect cash" : "Paid · collect nothing"}</span><b>${taka(due)}</b></div>
      <table class="slip__items"><tbody>${o.items.map((it) => `<tr><td>${esc(it.name)}${Object.keys(it.options || {}).length ? " · " + esc(optText(it.options)) : ""}</td><td class="right">×${it.qty}</td></tr>`).join("")}</tbody></table>
      <div class="slip__foot"><span>${qty} item${qty === 1 ? "" : "s"}${o.pathao && o.pathao.weight ? " · " + o.pathao.weight + " kg" : ""}</span>${o.note ? `<span>Note: ${esc(o.note)}</span>` : ""}</div>
      <div class="slip__from"><small>From</small> ${esc(st.name || "Ravelle")} · ${esc(st.phone || "")}${st.address ? " · " + esc(st.address) : ""}<br><small>Please call the customer before delivery. Do not hand over the parcel without collecting the amount above.</small></div>
    </div>`;
  }
  async function printInvoices(orders, type, back) {
    await loadStore();
    const st = (store && store.settings && store.settings.store) || {};
    const other = type === "courier" ? "order" : "courier";
    view.innerHTML = `<div class="head no-print"><a class="btn btn--link" href="${back[0]}">${esc(back[1])}</a>
      <div class="flex"><div class="tabs" style="margin:0"><button class="tab${type === "order" ? " is-on" : ""}" data-type="order">Order invoice</button><button class="tab${type === "courier" ? " is-on" : ""}" data-type="courier">Courier invoice</button></div>
      <button class="btn btn--dark" data-print>Print${orders.length > 1 ? " " + orders.length : ""}</button></div></div>
      <div class="inv-list inv-list--${type}">${orders.map((o) => type === "courier" ? courierInvoiceHtml(o, st) : orderInvoiceHtml(o, st)).join("")}</div>`;
    view.querySelector("[data-print]").onclick = () => window.print();
    $$("[data-type]", view).forEach((b) => { b.onclick = () => { if (b.dataset.type !== type) printInvoices(orders, other, back); }; });
  }
  async function viewInvoices(_, query) {
    const q = new URLSearchParams(query || ""), nums = (q.get("orders") || "").split(",").filter(Boolean).slice(0, 100);
    setTitle("Invoices");
    let orders;
    try { orders = await Promise.all(nums.map((n) => api("GET", "/api/orders/" + encodeURIComponent(n)).then((r) => r.order))); } catch (err) { return fail(err); }
    if (!orders.length) { view.innerHTML = `<p class="empty">No orders chosen. Tick orders in the Orders list first.</p>`; return; }
    printInvoices(orders, q.get("type") === "courier" ? "courier" : "order", ["#/orders", "← Orders"]);
  }
  async function viewCourierInvoice(id) { return viewInvoice(id, "courier"); }
  async function viewInvoice(id, type) {
    setTitle((type === "courier" ? "Courier invoice " : "Invoice ") + id);
    let o;
    try { o = (await api("GET", "/api/orders/" + encodeURIComponent(id))).order; } catch (err) { return fail(err); }
    printInvoices([o], type === "courier" ? "courier" : "order", ["#/orders/" + o.number, "← Order " + o.number]);
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------
  // Subscribers: emails and phone numbers from the popup, the footer "Notify me" box and coming-soon pages,
  // plus customer lists for Meta Custom Audiences and Google Customer Match
  async function viewSubscribers() {
    setTitle("Subscribers");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Subscribers</h1><p class="muted">People who left an email or phone number in the popup, the footer box or a coming-soon page.</p></div><button class="btn btn--ghost" id="subCsv">Export CSV</button></div>
      <div class="card"><h2 class="h2">Audiences for ads</h2><p class="muted small" style="margin:0 0 10px">Download a list, then upload it as a <b>Custom Audience</b> in Meta Ads Manager (Audiences › Create › Custom audience › Customer list) or to <b>Customer Match</b> in Google Ads (Tools › Audience manager). Use it to find lookalike shoppers, win back past buyers, or leave buyers out of ads for new customers. Meta and Google scramble (hash) the list before matching it.</p>
        <div class="flex" style="flex-wrap:wrap">${[["buyers", "Buyers"], ["subscribers", "Subscribers"], ["all", "Everyone"]].map(([w, l]) => `<button class="btn btn--ghost btn--sm" data-aud="meta" data-who="${w}">${l} · Meta</button><button class="btn btn--ghost btn--sm" data-aud="google" data-who="${w}">${l} · Google</button>`).join("")}</div>
        <p class="small" style="margin:10px 0 0;color:var(--warn)">These files hold your customers' personal details. Keep them private and delete them after uploading.</p></div>
      <div class="toolbar"><div class="grow"><input class="input" id="subQ" placeholder="Search by email, phone or where they signed up"></div></div><div class="card card--flush" id="subList"><p class="empty">Loading…</p></div>`;
    let list = [];
    const load = async (q) => {
      try { list = (await api("GET", "/api/subscribers" + (q ? "?q=" + encodeURIComponent(q) : ""))).subscribers; } catch (err) { return fail(err); }
      $("#subList").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Email</th><th>Phone</th><th>Signed up from</th><th>Date</th><th></th></tr></thead><tbody>${list.map((s) => `
        <tr><td>${esc(s.email || "—")}</td><td>${esc(s.phone || "—")}</td><td class="small">${esc((s.sources || [s.source]).join(", "))}</td><td class="small">${dateTime(s.createdAt)}</td><td class="right"><button class="btn btn--ghost btn--sm" data-del="${s.id}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No subscribers yet. Turn on the sign-up in <a href="#/popup">Popup banner</a> to start a list.</p>`;
    };
    let t = null;
    $("#subQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value), 250); };
    $("#subCsv").onclick = () => download("ravelle-subscribers.csv", csv([["Email", "Phone", "Name", "Signed up from", "Date"]].concat(list.map((s) => [s.email, s.phone, s.name || "", (s.sources || [s.source]).join(" "), new Date(s.createdAt).toISOString().slice(0, 10)]))));
    view.addEventListener("click", async (e) => {
      const d = e.target.closest("[data-del]");
      if (d) {
        if (!(await confirmBox("Remove this subscriber?", "They won't be in your lists or exports any more.", "Remove", true))) return;
        try { await api("DELETE", "/api/subscribers/" + d.dataset.del); toast("Removed"); load($("#subQ").value); } catch (err) { fail(err); }
        return;
      }
      const a = e.target.closest("[data-aud]");
      if (!a) return;
      let r;
      try { r = await api("GET", "/api/audience?who=" + a.dataset.who); } catch (err) { return fail(err); }
      if (!r.rows.length) return toast("Nobody in that list yet.", "warn");
      const rows = a.dataset.aud === "meta"
        ? [["email", "phone", "fn", "ln", "ct", "country", "value"]].concat(r.rows.map((x) => [x.email, x.phone, x.fn, x.ln, x.ct, x.country, x.value]))
        : [["Email", "Phone", "First Name", "Last Name", "Country", "Zip"]].concat(r.rows.map((x) => [x.email, x.phone, x.fn, x.ln, x.country, ""]));
      download(`ravelle-${a.dataset.who}-${a.dataset.aud}-audience.csv`, csv(rows));
      toast(r.rows.length + " people in the file");
    });
    load();
  }
  async function viewCustomers() {
    setTitle("Customers");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Customers</h1><p class="muted">Everyone who has ordered, with what they spent. A customer is matched by phone number.</p></div><button class="btn btn--ghost" id="cusCsv">Export CSV</button></div>
      <div class="toolbar"><div class="grow"><input class="input" id="cusQ" placeholder="Search by name, phone or email"></div></div><div class="card card--flush" id="cusList"><p class="empty">Loading…</p></div>`;
    let list = [];
    const load = async (q) => {
      try { list = (await api("GET", "/api/customers" + (q ? "?q=" + encodeURIComponent(q) : ""))).customers; } catch (err) { return fail(err); }
      $("#cusList").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Customer</th><th>Phone</th><th>City</th><th class="right">Orders</th><th class="right">Spent</th><th>Last order</th><th>Since</th></tr></thead><tbody>${list.map((c) => `
        <tr class="is-link" data-href="#/customers/${esc(c.id)}"><td><b>${esc(c.name)}</b>${c.email ? `<br><small class="muted">${esc(c.email)}</small>` : ""}${(c.tags || []).map((t) => ` <span class="tag">${esc(t)}</span>`).join("")}</td><td>${esc(c.phone)}</td><td>${esc(c.city || "")}</td>
        <td class="right num">${c.orders}</td><td class="right num"><b>${taka(c.spent)}</b></td><td>${date(c.lastOrder)}</td><td>${date(c.createdAt)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No customers found.</p>`;
    };
    $("#cusQ").oninput = debounce((e) => load(e.target.value.trim()), 250);
    $("#cusCsv").onclick = () => download("ravelle-customers.csv", csv([["Name", "Phone", "Email", "Address", "City", "Orders", "Spent", "Last order", "Customer since", "Tags", "Note"]].concat(list.map((c) => [c.name, c.phone, c.email, c.address, c.city, c.orders, c.spent, c.lastOrder ? new Date(c.lastOrder).toISOString().slice(0, 10) : "", new Date(c.createdAt).toISOString().slice(0, 10), (c.tags || []).join(" "), c.note || ""]))));
    load("");
  }
  async function viewCustomer(id) {
    let r;
    try { r = await api("GET", "/api/customers/" + id); } catch (err) { view.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const c = r.customer;
    setTitle(c.name);
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/customers">← Customers</a><h1 class="h1" style="margin-top:8px">${esc(c.name)}</h1><p class="muted">Customer since ${date(c.createdAt)}</p></div><a class="btn btn--ghost" href="tel:${esc(c.phone)}">Call</a></div>
      <div class="kpis"><div class="kpi"><span class="kpi__label">Orders</span><span class="kpi__value">${c.orders}</span></div><div class="kpi"><span class="kpi__label">Total spent</span><span class="kpi__value">${taka(c.spent)}</span></div><div class="kpi"><span class="kpi__label">Average order</span><span class="kpi__value">${taka(c.orders ? c.spent / c.orders : 0)}</span></div><div class="kpi"><span class="kpi__label">Last order</span><span class="kpi__value" style="font-size:20px">${date(c.lastOrder)}</span></div></div>
      <div class="cols"><div class="card card--flush"><div class="card__head" style="padding:16px 18px 6px"><h2 class="h2">Orders</h2></div>${ordersTable(r.orders)}</div>
        <div class="stack"><div class="card"><h2 class="h2">Details</h2><dl class="kv"><dt>Phone</dt><dd>${esc(c.phone)}</dd><dt>Email</dt><dd>${esc(c.email || "—")}</dd><dt>Address</dt><dd>${esc(c.address || "—")}${c.city ? ", " + esc(c.city) : ""}</dd></dl></div>
          <form class="card" id="cusForm"><h2 class="h2">Notes and tags</h2><label class="field"><span>Tags</span><input class="input" name="tags" value="${esc((c.tags || []).join(", "))}" placeholder="vip, wholesale"><small>Separate with commas.</small></label>
            <label class="field"><span>Private note</span><textarea class="input" name="note" rows="3">${esc(c.note || "")}</textarea></label><button class="btn btn--dark" type="submit">Save</button></form></div></div>`;
    $("#cusForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(e.target);
      try { await api("PATCH", "/api/customers/" + id, { note: b.note, tags: b.tags.split(",").map((t) => t.trim()).filter(Boolean) }); toast("Saved"); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------------
  const catTree = (cats) => {
    const out = [];
    const walk = (pid, depth) => cats.filter((c) => (c.parentId || null) === pid).sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name))
      .forEach((c) => { out.push({ c, depth }); walk(c.id, depth + 1); });
    walk(null, 0);
    return out;
  };
  async function viewProducts(_, query) {
    setTitle("Products");
    await loadStore();
    const qs = new URLSearchParams(query || "");
    const state = { q: "", category: qs.get("category") || "", status: "" };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Products</h1><p class="muted">${store.products.length} published. Drag ⠿ to change the order products show in the shop.</p></div>
      <div class="flex"><button class="btn btn--ghost" id="prdCsv">Export CSV</button><a class="btn btn--ghost" href="#/bulk">Bulk edit</a><a class="btn btn--dark" href="#/products/new">Add product</a></div></div>
      <div class="toolbar"><div class="grow"><input class="input" id="prdQ" placeholder="Search name, SKU, colour"></div>
        <select class="input" id="prdCat"><option value="">All categories</option>${catTree(store.categories).map(({ c, depth }) => `<option value="${c.id}"${c.id === state.category ? " selected" : ""}>${"— ".repeat(depth)}${esc(c.name)}</option>`).join("")}</select>
        <select class="input" id="prdStatus"><option value="">Any status</option><option value="published">Published</option><option value="draft">Draft</option></select></div>
      <div class="card card--flush" id="prdList"><p class="empty">Loading…</p></div>`;
    let list = [];
    const load = async () => {
      const p = new URLSearchParams();
      Object.keys(state).forEach((k) => state[k] && p.set(k, state[k]));
      try { list = (await api("GET", "/api/products?" + p)).products; } catch (err) { return fail(err); }
      const catName = (id) => (store.categories.find((c) => c.id === id) || {}).name;
      const low = store.settings.lowStock || 5;
      $("#prdList").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th style="width:28px"></th><th>Product</th><th>SKU</th><th>Categories</th><th class="right">Price</th><th class="right">Stock</th><th>Status</th><th></th></tr></thead><tbody id="prdRows">${list.map((p) => `
        <tr class="is-link" data-href="#/products/${esc(p.id)}" data-id="${esc(p.id)}"><td class="drag" title="Drag to reorder">⠿</td><td><div class="flex" style="flex-wrap:nowrap">${p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="thumb" style="background:${esc(p.hex || "#ddd")}"></span>`}<span><b>${esc(p.name)}</b><br><small class="muted">${p.variants.length ? p.variants.length + " variations" : "No variations"}${p.featured ? " · Featured" : ""}${p.isNew ? " · New" : ""}</small></span></div></td>
        <td class="mono">${esc(p.sku)}</td><td>${p.categoryIds.map(catName).filter(Boolean).map(esc).join(", ")}</td>
        <td class="right num">${taka(p.price)}${p.comparePrice > p.price ? `<br><small class="muted"><s>${taka(p.comparePrice)}</s></small>` : ""}</td>
        <td class="right num">${p.stock == null ? "—" : `<b style="color:${p.stock === 0 ? "var(--danger)" : p.stock <= low ? "var(--warn)" : "inherit"}">${p.stock}</b>`}</td><td>${pill(p.status)}</td>
        <td class="right nowrap"><button class="btn btn--ghost btn--sm" data-dup="${esc(p.id)}">Duplicate</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No products match.</p>`;
    };
    // Drag rows by the handle to set the order products show in on the store
    let dragRow = null;
    const saveOrder = async () => {
      const ids = $$("#prdRows tr").map((tr) => tr.dataset.id);
      try { await api("PUT", "/api/products-order", { ids }); store = null; toast("Order saved. The shop shows products in this order."); } catch (err) { fail(err); load(); }
    };
    // Mouse, pen and touch: press the handle and move up or down
    $("#prdList").addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".drag");
      if (!h) return;
      e.preventDefault();
      dragRow = h.closest("tr"); dragRow.classList.add("is-dragging");
      try { h.setPointerCapture(e.pointerId); } catch (_) {}
    });
    $("#prdList").addEventListener("pointermove", (e) => {
      if (!dragRow) return;
      const el = document.elementFromPoint(e.clientX, e.clientY), tr = el && el.closest("#prdRows tr");
      if (!tr || tr === dragRow) return;
      const r = tr.getBoundingClientRect();
      tr.parentNode.insertBefore(dragRow, e.clientY > r.top + r.height / 2 ? tr.nextSibling : tr);
    });
    const endDrag = () => { if (!dragRow) return; dragRow.classList.remove("is-dragging"); dragRow = null; saveOrder(); };
    $("#prdList").addEventListener("pointerup", endDrag);
    $("#prdList").addEventListener("pointercancel", endDrag);
    $("#prdQ").oninput = debounce((e) => { state.q = e.target.value.trim(); load(); }, 250);
    $("#prdCat").onchange = (e) => { state.category = e.target.value; load(); };
    $("#prdStatus").onchange = (e) => { state.status = e.target.value; load(); };
    $("#prdList").addEventListener("click", async (e) => {
      if (e.target.closest(".drag")) { e.stopPropagation(); return; }
      const b = e.target.closest("[data-dup]");
      if (!b) return;
      e.stopPropagation();
      try { const r = await api("POST", "/api/products/" + b.dataset.dup + "/duplicate"); toast("Duplicated as a draft"); go("products/" + r.product.id); } catch (err) { fail(err); }
    });
    $("#prdCsv").onclick = () => {
      const rows = [["Product", "SKU", "Variant SKU", "Options", "Price", "Compare at", "Stock", "Status", "Slug"]];
      list.forEach((p) => {
        if (!p.variants.length) rows.push([p.name, p.sku, "", "", p.price, p.comparePrice, p.stock, p.status, p.slug]);
        p.variants.forEach((v) => rows.push([p.name, p.sku, v.sku, optText(v.options), v.price == null ? p.price : v.price, p.comparePrice, v.stock, p.status, p.slug]));
      });
      download("ravelle-products.csv", csv(rows));
    };
    load();
  }

  async function viewProduct(id) {
    await loadStore();
    let p;
    if (id === "new") {
      p = { name: "", slug: "", sku: "", status: "draft", line: "", color: "", hex: "#7b7e83", price: "", comparePrice: "", description: "", details: [], images: [], sizeGuide: "",
        categoryIds: [], isNew: true, featured: false, trackStock: true, stock: 0, attributes: [], variants: [] };
    } else {
      try { p = (await api("GET", "/api/products/" + id)).product; } catch (err) { view.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    }
    const isNew = id === "new";
    setTitle(isNew ? "New product" : p.name);
    const attrs = store.attributes;
    const charts = ((await api("GET", "/api/size-charts").catch(() => null)) || {})["size-charts"] || [];
    let draft = clone(p);
    draft.details = (draft.details || []).join("\n");
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/products">← Products</a><h1 class="h1" style="margin-top:8px">${isNew ? "Add product" : esc(p.name)}</h1>
      ${isNew ? "" : `<p class="muted">SKU ${esc(p.sku)} · ${pill(p.status)} · <a href="./#product/${esc(p.slug)}" target="_blank" rel="noopener">View on store ↗</a> · <a href="#/labels?product=${esc(p.id)}">Print price tags</a></p>`}</div></div>
      <form class="cols" id="pForm" novalidate>
        <div class="stack">
          <div class="card"><label class="field"><span>Product name</span><input class="input" name="name" required value="${esc(draft.name)}" placeholder="Fearless Oversized T-shirt – Black"></label>
            <label class="field"><span>Description</span><textarea class="input" name="description" rows="3">${esc(draft.description || "")}</textarea></label>
            <label class="field"><span>Details &amp; fit</span><textarea class="input" name="details" rows="4" placeholder="One point per line">${esc(draft.details)}</textarea><small>One point per line. Shown under “Details &amp; fit”.</small></label></div>
          <div class="card"><div class="card__head"><h2 class="h2">Photos</h2><small class="muted">The first photo is the main one. Drag order with the arrows. Best size: 690 × 862 px (4:5) · WebP · under 80 KB each.</small></div><div class="gallery" id="gallery"></div></div>
          <div class="card"><h2 class="h2">Price</h2><div class="row row--3">
            <label class="field"><span>Price (৳)</span><input class="input" name="price" type="number" min="0" required value="${esc(draft.price)}"></label>
            <label class="field"><span>Compare-at price (৳)</span><input class="input" name="comparePrice" type="number" min="0" value="${esc(draft.comparePrice || "")}"><small>The old price, shown crossed out.</small></label>
            <label class="field"><span>Product SKU</span><input class="input" name="sku" value="${esc(draft.sku)}" placeholder="Auto: RVL-category no.-0001" style="text-transform:uppercase"></label></div></div>
          <div class="card"><div class="card__head"><div><h2 class="h2">Variations</h2><p class="muted small">Pick the options this product comes in. Each combination gets its own SKU, price and stock.</p></div><a class="btn btn--link" href="#/variations">Manage variation types</a></div>
            <div class="stack" id="attrBox"></div>
            <div class="flex"><select class="input" id="addAttr" style="width:auto"><option value="">+ Add a variation type…</option>${attrs.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join("")}</select></div>
            <div id="varBox"></div>
            <label class="check"><input type="checkbox" name="trackStock" ${draft.trackStock ? "checked" : ""}> Track stock (sold-out sizes can't be ordered)</label>
            <label class="field" id="simpleStock" style="max-width:200px"><span>Stock</span><input class="input" name="stock" type="number" min="0" value="${esc(draft.stock == null ? 0 : draft.stock)}"></label></div>
          <div class="card"><div class="card__head"><div><h2 class="h2">Size guide</h2><p class="muted small" style="margin:0">Pick a size chart template. Customers see a “Size guide” button above the sizes; it opens the chart in a popup.</p></div><a class="btn btn--link" href="#/sizecharts">Manage size charts</a></div>
            <label class="field"><span>Size chart template</span><select class="input" name="sizeChartId"><option value="">None</option>${charts.map((c) => `<option value="${esc(c.id)}"${c.id === draft.sizeChartId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
            <small>${charts.length ? "Made in Catalog › Size charts. Change a template there and every product using it updates." : "No templates yet. Make one in Catalog › Size charts."}</small></label>
            <details${draft.sizeGuide && !draft.sizeChartId ? " open" : ""}><summary class="small muted">Or upload a chart image instead (used only when no template is picked)</summary>
            ${imgField("sizeGuide", draft.sizeGuide, "Size guide image", "Ratio 3:2 landscape, 1200 × 800 px (1200 × 900 also fine). Shown in full, never cropped. Put sizes in rows and chest, length, sleeve in columns, with big text so it reads on phones.", true)}</details></div>
        </div>
        <div class="stack">
          <div class="card"><h2 class="h2">Status</h2>
            <label class="field"><span>Visibility</span><select class="input" name="status"><option value="published"${draft.status === "published" ? " selected" : ""}>Published: on the store</option><option value="draft"${draft.status === "draft" ? " selected" : ""}>Draft: hidden</option></select></label>
            <label class="check"><input type="checkbox" name="isNew" ${draft.isNew ? "checked" : ""}> Show in New in</label>
            <label class="check"><input type="checkbox" name="featured" ${draft.featured ? "checked" : ""}> Feature on the home page</label></div>
          <div class="card"><div class="card__head"><h2 class="h2">Categories</h2><a class="btn btn--link" href="#/categories">Manage</a></div>
            <div class="tree">${catTree(store.categories).map(({ c, depth }) => `<label class="check" style="padding-left:${depth * 18}px"><input type="checkbox" name="cat" value="${c.id}" ${draft.categoryIds.indexOf(c.id) > -1 ? "checked" : ""}> ${esc(c.name)}</label>`).join("")}</div></div>
          <div class="card"><h2 class="h2">Style</h2>
            <label class="field"><span>Line / collection label</span><input class="input" name="line" value="${esc(draft.line || "")}" placeholder="Fearless"><small>Used for the filter chips on the shop page.</small></label>
            <div class="row row--2"><label class="field"><span>Colour name</span><input class="input" name="color" value="${esc(draft.color || "")}" placeholder="Black"></label>
            <label class="field"><span>Colour</span><input class="input" name="hex" type="color" value="${esc(draft.hex || "#7b7e83")}" style="padding:2px"></label></div>
            <div class="field"><span>Shop filter colour</span><input type="hidden" name="colorGroup" value="${esc(draft.colorGroup || "")}">
              <div class="chips" id="cgPick">${[["", "Auto"]].concat(FILTER_COLORS).map(([n, h]) => `<button type="button" class="chipbtn${(draft.colorGroup || "") === n ? " is-on" : ""}" data-cg="${esc(n)}">${h ? `<span class="sw" style="background:${h}"></span>` : ""}${esc(n || "Auto")}</button>`).join("")}</div>
              <small>The colour this product is listed under in the shop's colour filter. Auto picks it from the colour name.</small></div></div>
          <div class="card"><h2 class="h2">Web address</h2><label class="field"><span>Slug</span><input class="input" name="slug" value="${esc(draft.slug || "")}" placeholder="Made from the name"><small>ravellebd.com/product/<b>${esc(draft.slug || "…")}</b></small></label></div>
          <div class="card"><h2 class="h2">Search engines</h2>
            <label class="field"><span>Title in Google</span><input class="input" name="seoTitle" maxlength="80" value="${esc(draft.seoTitle || "")}" placeholder="${esc(draft.name || "Product name")}"><small>Leave empty to use the product name. " | Ravelle" is added.</small></label>
            <label class="field"><span>Description in Google</span><textarea class="input" name="seoDescription" rows="2" maxlength="200" placeholder="Made from the description and price">${esc(draft.seoDescription || "")}</textarea><small>About 150 characters. Also shown when the link is shared on Facebook or WhatsApp.</small></label></div>
        </div>
        <div class="sticky-save" style="grid-column:1/-1"><span class="small">${isNew ? "New product" : "Editing " + esc(p.name)}</span>
          <div class="flex">${isNew ? "" : `<button class="btn btn--danger btn--sm" type="button" id="pDel">Delete</button><button class="btn btn--ghost btn--sm" type="button" id="pDup">Duplicate</button>`}<button class="btn btn--dark" type="submit">${isNew ? "Create product" : "Save product"}</button></div></div>
      </form>`;
    const form = $("#pForm");

    // Gallery
    const drawGallery = () => {
      $("#gallery").innerHTML = draft.images.map((u, i) => `<div class="gallery__item"><img src="${esc(u)}" alt="">${i === 0 ? `<span class="pill first">Main</span>` : ""}<div class="tools">
        <button class="icon" type="button" data-mv="${i}" data-d="-1" ${i ? "" : "disabled"} aria-label="Move left">←</button><button class="icon" type="button" data-rm="${i}" aria-label="Remove">✕</button><button class="icon" type="button" data-mv="${i}" data-d="1" ${i < draft.images.length - 1 ? "" : "disabled"} aria-label="Move right">→</button></div></div>`).join("") +
        `<button class="gallery__add" type="button" id="gAdd">+ Add photos</button>`;
    };
    $("#gallery").addEventListener("click", async (e) => {
      const mv = e.target.closest("[data-mv]"), rm = e.target.closest("[data-rm]");
      if (mv) { const i = +mv.dataset.mv, j = i + +mv.dataset.d; [draft.images[i], draft.images[j]] = [draft.images[j], draft.images[i]]; drawGallery(); }
      else if (rm) { draft.images.splice(+rm.dataset.rm, 1); drawGallery(); }
      else if (e.target.closest("#gAdd")) { const u = await pickMedia({ multiple: true, title: "Add product photos" }); if (u) { draft.images = draft.images.concat(u); drawGallery(); } }
    });
    drawGallery();
    wireImgFields(form, (name, u) => { draft[name] = u; });

    // Variations: attributes → combinations
    const attrDef = (name) => attrs.find((a) => a.name === name) || { name, type: "button", values: [] };
    const drawAttrs = () => {
      $("#attrBox").innerHTML = draft.attributes.map((a, ai) => {
        const def = attrDef(a.name);
        const options = def.values.map((v) => v.label);
        a.values.forEach((v) => { if (options.indexOf(v) < 0) options.push(v); });
        return `<div class="attr" data-ai="${ai}"><div class="flex flex--between"><b>${esc(a.name)}</b><button class="btn btn--link" type="button" data-rm-attr="${ai}" style="color:var(--danger)">Remove</button></div>
          <div class="chips">${options.map((v) => { const hex = (def.values.find((x) => x.label === v) || {}).hex; return `<button type="button" class="chipbtn${a.values.indexOf(v) > -1 ? " is-on" : ""}" data-val="${esc(v)}">${hex ? `<span class="sw" style="background:${esc(hex)}"></span>` : ""}${esc(v)}</button>`; }).join("")}
          <input class="input input--sm" data-new-val placeholder="+ other" style="width:90px"></div></div>`;
      }).join("");
      $("#addAttr").querySelectorAll("option").forEach((o) => { if (o.value) o.disabled = draft.attributes.some((a) => a.name === o.value); });
      syncVariants();
    };
    const syncVariants = () => {
      // Build every combination; keep stock, price and SKU of ones that existed.
      const active = draft.attributes.filter((a) => a.values.length);
      let combos = [{}];
      active.forEach((a) => { const next = []; combos.forEach((c) => a.values.forEach((v) => next.push(Object.assign({}, c, { [a.name]: v })))); combos = next; });
      if (!active.length) combos = [];
      const key = (o) => active.map((a) => o[a.name]).join("|");
      const old = {};
      draft.variants.forEach((v) => { old[key(v.options)] = v; });
      draft.variants = combos.map((o) => old[key(o)] || { options: o, sku: "", price: null, stock: 0 });
      drawVariants();
    };
    const drawVariants = () => {
      const has = draft.variants.length;
      $("#simpleStock").hidden = !!has || !$("[name=trackStock]", form).checked;
      if (!has) { $("#varBox").innerHTML = ""; return; }
      $("#varBox").innerHTML = `<div class="table-wrap"><table class="t vt"><thead><tr><th>Variation</th><th>SKU</th><th>Price (৳)</th><th>Stock</th></tr></thead><tbody>${draft.variants.map((v, i) => `
        <tr><td><b>${esc(optText(v.options))}</b></td><td><input class="input input--sm" data-vi="${i}" data-f="sku" value="${esc(v.sku || "")}" placeholder="Auto" style="text-transform:uppercase"></td>
        <td><input class="input input--sm" type="number" min="0" data-vi="${i}" data-f="price" value="${v.price == null ? "" : esc(v.price)}" placeholder="Same"></td><td><input class="input input--sm" type="number" min="0" data-vi="${i}" data-f="stock" value="${esc(v.stock || 0)}"></td></tr>`).join("")}</tbody></table></div>
        <div class="flex small muted">Set all stock to <input class="input input--sm" type="number" min="0" id="allStock" style="width:80px"><button class="btn btn--ghost btn--sm" type="button" id="setAll">Apply</button></div>`;
      $("#setAll").onclick = () => { const n = +$("#allStock").value || 0; draft.variants.forEach((v) => { v.stock = n; }); drawVariants(); };
    };
    $("#varBox").addEventListener("input", (e) => {
      const el = e.target.closest("[data-vi]");
      if (!el) return;
      const v = draft.variants[+el.dataset.vi], f = el.dataset.f;
      v[f] = f === "sku" ? el.value : el.value === "" ? (f === "price" ? null : 0) : +el.value;
    });
    $("#attrBox").addEventListener("click", (e) => {
      const box = e.target.closest("[data-ai]");
      if (!box) return;
      const a = draft.attributes[+box.dataset.ai];
      const chip = e.target.closest("[data-val]");
      if (chip) {
        const v = chip.dataset.val, i = a.values.indexOf(v);
        if (i > -1) a.values.splice(i, 1);
        else {
          // keep the order defined on the variation type
          const order = attrDef(a.name).values.map((x) => x.label);
          a.values.push(v);
          a.values.sort((x, y) => (order.indexOf(x) + 1 || 999) - (order.indexOf(y) + 1 || 999));
        }
        drawAttrs();
      }
      if (e.target.closest("[data-rm-attr]")) { draft.attributes.splice(+box.dataset.ai, 1); drawAttrs(); }
    });
    $("#attrBox").addEventListener("keydown", (e) => {
      const inp = e.target.closest("[data-new-val]");
      if (!inp || e.key !== "Enter") return;
      e.preventDefault();
      const a = draft.attributes[+inp.closest("[data-ai]").dataset.ai], v = inp.value.trim();
      if (v && a.values.indexOf(v) < 0) { a.values.push(v); drawAttrs(); }
    });
    $("#addAttr").onchange = (e) => {
      if (!e.target.value) return;
      draft.attributes.push({ name: e.target.value, values: [] });
      e.target.value = "";
      drawAttrs();
    };
    $("[name=trackStock]", form).onchange = drawVariants;
    drawAttrs();
    $("#cgPick", form).onclick = (e) => {
      const btn = e.target.closest("[data-cg]");
      if (!btn) return;
      $("[name=colorGroup]", form).value = btn.dataset.cg;
      $$("#cgPick .chipbtn", form).forEach((x) => x.classList.toggle("is-on", x === btn));
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(form);
      const body = {
        name: b.name, slug: b.slug, sku: b.sku, status: b.status, line: b.line, color: b.color, hex: b.hex, colorGroup: b.colorGroup || "", price: b.price, comparePrice: b.comparePrice || 0,
        description: b.description, details: b.details, seoTitle: b.seoTitle, seoDescription: b.seoDescription, images: draft.images, sizeGuide: $("[name=sizeGuide]", form).value, sizeChartId: $("[name=sizeChartId]", form).value,
        categoryIds: $$("[name=cat]:checked", form).map((x) => x.value), isNew: b.isNew, featured: b.featured, trackStock: b.trackStock, stock: b.stock,
        attributes: draft.attributes.filter((a) => a.values.length), variants: draft.variants
      };
      if (!body.name.trim()) return toast("Give the product a name.", true);
      if (!(+body.price > 0)) return toast("Set a price.", true);
      const btn = $("button[type=submit]", form);
      busy(btn, true);
      try {
        const r = isNew ? await api("POST", "/api/products", body) : await api("PUT", "/api/products/" + p.id, body);
        toast(isNew ? "Product created" : "Product saved");
        store = null;
        if (isNew) go("products/" + r.product.id); else viewProduct(p.id);
      } catch (err) { fail(err); busy(btn, false); }
    };
    if (!isNew) {
      $("#pDel").onclick = async () => {
        if (!(await confirmBox("Delete " + p.name + "?", "It's removed from the store and kept in Trash for 30 days, so you can restore it. Past orders keep their details.", "Move to Trash", true))) return;
        try { await api("DELETE", "/api/products/" + p.id); store = null; toast("Moved to Trash"); go("products"); } catch (err) { fail(err); }
      };
      $("#pDup").onclick = async () => {
        try { const r = await api("POST", "/api/products/" + p.id + "/duplicate"); store = null; toast("Duplicated as a draft"); go("products/" + r.product.id); } catch (err) { fail(err); }
      };
    }
  }

  // Trash: deleted products, orders and images, kept for 30 days
  async function viewTrash(_, query) {
    setTitle("Trash");
    const kind = new URLSearchParams(query || "").get("kind") || "";
    let r;
    try { r = await api("GET", "/api/trash"); } catch (err) { return fail(err); }
    const KIND = { product: "Product", order: "Order", media: "Image" };
    const kinds = ["product", "order", "media"].filter((k) => r.items.some((x) => x.kind === k));
    const list = r.items.filter((x) => !kind || x.kind === kind);
    const left = (t) => { const d = Math.max(0, Math.ceil((t - Date.now()) / 864e5)); return d <= 1 ? "Deleted for good within a day" : `Deleted for good in ${d} days`; };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Trash</h1><p class="muted">Deleted products, orders and images stay here for ${r.days} days. Restore puts them back exactly as they were.</p></div>${r.items.length ? `<button class="btn btn--danger" id="trEmpty">Empty trash</button>` : ""}</div>
      ${kinds.length > 1 ? `<div class="tabs" style="margin-bottom:14px"><a class="tab${kind ? "" : " is-on"}" href="#/trash">All ${r.items.length}</a>${kinds.map((k) => `<a class="tab${k === kind ? " is-on" : ""}" href="#/trash?kind=${k}">${KIND[k]}s ${r.items.filter((x) => x.kind === k).length}</a>`).join("")}</div>` : ""}
      ${list.length ? `<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th>Type</th><th>Deleted</th><th></th></tr></thead><tbody>${list.map((x) => `
        <tr><td><div class="flex" style="flex-wrap:nowrap">${x.image ? `<img class="thumb" src="${esc(x.image)}" alt="" loading="lazy">` : `<span class="thumb tr-thumb">${x.kind === "order" ? "#" : "?"}</span>`}<span><b>${esc(x.label)}</b>${x.detail ? `<br><small class="muted">${esc(x.detail)}</small>` : ""}</span></div></td>
        <td><span class="pill">${KIND[x.kind]}</span></td>
        <td class="nowrap">${dateTime(x.deletedAt)}${x.deletedBy ? `<br><small class="muted">by ${esc(x.deletedBy)}</small>` : ""}<br><small class="muted">${left(x.expiresAt)}</small></td>
        <td class="right nowrap"><button class="btn btn--dark btn--sm" data-restore="${esc(x.id)}">Restore</button> <button class="btn btn--ghost btn--sm" data-forever="${esc(x.id)}">Delete for good</button></td></tr>`).join("")}</tbody></table></div></div>`
        : `<div class="card"><p class="empty">Trash is empty. Deleted products, orders and images show up here.</p></div>`}`;
    view.onclick = async (e) => {
      const rs = e.target.closest("[data-restore]"), fg = e.target.closest("[data-forever]");
      if (rs) {
        busy(rs, true);
        try {
          const out = await api("POST", "/api/trash/" + rs.dataset.restore + "/restore");
          store = null; toast(KIND[out.kind] + " restored"); refreshCounts(); viewTrash(_, query);
        } catch (err) { busy(rs, false); fail(err); }
      }
      if (fg) {
        const x = list.find((i) => i.id === fg.dataset.forever);
        if (!(await confirmBox("Delete " + x.label + " for good?", "This can't be undone.", "Delete for good", true))) return;
        try { await api("DELETE", "/api/trash/" + x.id); toast("Deleted for good"); viewTrash(_, query); } catch (err) { fail(err); }
      }
    };
    if ($("#trEmpty")) $("#trEmpty").onclick = async () => {
      if (!(await confirmBox("Empty the trash?", `All ${r.items.length} item${r.items.length > 1 ? "s" : ""} will be deleted for good. This can't be undone.`, "Empty trash", true))) return;
      try { await api("DELETE", "/api/trash"); toast("Trash emptied"); viewTrash(); } catch (err) { fail(err); }
    };
  }

  // Stock: every SKU on one page
  async function viewStock() {
    setTitle("Stock");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Stock</h1><p class="muted">Every SKU in one place. Change the numbers and save; your warehouse or POS can do the same through the API.</p></div><button class="btn btn--dark" id="stSave" disabled>Save changes</button></div>
      <div class="toolbar"><div class="grow"><input class="input" id="stQ" placeholder="Filter by product or SKU"></div><label class="check"><input type="checkbox" id="stLow"> Only low stock</label></div>
      <div class="card card--flush" id="stList"><p class="empty">Loading…</p></div>`;
    let rows = [], changed = {};
    const low = (store && store.settings.lowStock) || 5;
    try { rows = (await api("GET", "/api/stock")).stock; } catch (err) { return fail(err); }
    const draw = () => {
      const q = $("#stQ").value.trim().toLowerCase(), onlyLow = $("#stLow").checked;
      const list = rows.filter((r) => r.stock != null && (!q || (r.name + " " + r.sku).toLowerCase().indexOf(q) > -1) && (!onlyLow || r.stock <= low));
      $("#stList").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th>Option</th><th>SKU</th><th style="width:140px">Stock</th></tr></thead><tbody>${list.map((r) => `
        <tr><td><a href="#/products/${esc(r.productId)}">${esc(r.name)}</a></td><td>${esc(optText(r.options)) || "—"}</td><td class="mono">${esc(r.sku)}</td>
        <td><input class="input input--sm" type="number" min="0" data-sku="${esc(r.sku)}" value="${changed[r.sku] != null ? changed[r.sku] : r.stock}" style="${r.stock === 0 ? "border-color:var(--danger)" : r.stock <= low ? "border-color:var(--warn)" : ""}"></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing to show.</p>`;
    };
    $("#stQ").oninput = debounce(draw, 150);
    $("#stLow").onchange = draw;
    $("#stList").addEventListener("input", (e) => {
      const i = e.target.closest("[data-sku]");
      if (!i) return;
      changed[i.dataset.sku] = Math.max(0, +i.value || 0);
      $("#stSave").disabled = false;
      $("#stSave").textContent = "Save " + Object.keys(changed).length + " change" + (Object.keys(changed).length > 1 ? "s" : "");
    });
    $("#stSave").onclick = async () => {
      const items = Object.keys(changed).map((sku) => ({ sku, stock: changed[sku] }));
      try {
        await api("PATCH", "/api/stock", { items });
        toast("Stock updated");
        rows.forEach((r) => { if (changed[r.sku] != null) r.stock = changed[r.sku]; });
        changed = {}; $("#stSave").disabled = true; $("#stSave").textContent = "Save changes"; store = null; draw();
      } catch (err) { fail(err); }
    };
    draw();
  }

  // ---------------------------------------------------------------------------
  // Bulk edit: prices, stock and shop settings for many products at once
  // ---------------------------------------------------------------------------
  function parseCsvText(text) {
    const rows = []; let row = [], cell = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }
  const BULK_ACTIONS = [
    ["Prices", [["regular", "Set regular price to ৳", 1], ["sale", "Set sale price to ৳", 1], ["salePct", "Sale: % off the regular price", 1], ["saleOff", "Sale: ৳ off the regular price", 1], ["endSale", "End the sale (back to regular price)"], ["upPct", "Change all prices by % (minus to lower)", 1], ["upTk", "Change all prices by ৳ (minus to lower)", 1]]],
    ["Stock", [["stockSet", "Set stock of every size to", 1], ["stockAdd", "Add to stock of every size (minus to remove)", 1], ["trackOn", "Track stock"], ["trackOff", "Don't track stock (always in stock)"]]],
    ["Shop", [["publish", "Publish"], ["draft", "Move to draft (hidden)"], ["newOn", "Show the New badge"], ["newOff", "Remove the New badge"], ["featOn", "Feature on the home page"], ["featOff", "Stop featuring"]]],
    ["Categories", [["catAdd", "Add to category", 2], ["catDel", "Remove from category", 2]]]
  ];
  async function viewBulk() {
    setTitle("Bulk edit");
    await loadStore(true);
    const low = store.settings.lowStock || 5, cats = store.categories;
    const catOpts = catTree(cats).map(({ c, depth }) => `<option value="${c.id}">${"— ".repeat(depth)}${esc(c.name)}</option>`).join("");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Bulk edit</h1><p class="muted">Change prices, stock and shop settings for many products, then save once. Leave the sale price empty for no sale.</p></div>
      <div class="flex"><button class="btn btn--ghost" id="bkCsv">Download CSV</button><label class="btn btn--ghost" style="cursor:pointer">Upload CSV<input type="file" accept=".csv,text/csv" id="bkUp" hidden></label><button class="btn btn--dark" id="bkSave" disabled>Save changes</button></div></div>
      <div class="toolbar"><div class="grow"><input class="input" id="bkQ" placeholder="Search name or SKU"></div>
        <select class="input" id="bkCat"><option value="">All categories</option>${catOpts}</select>
        <select class="input" id="bkStatus"><option value="">Any status</option><option value="published">Published</option><option value="draft">Draft</option></select>
        <label class="check"><input type="checkbox" id="bkLow"> Low stock</label><label class="check"><input type="checkbox" id="bkSaleOnly"> On sale</label></div>
      <div class="card bulk-bar"><b id="bkSel">0 selected</b>
        <select class="input input--sm" id="bkAct"><option value="">Choose a change…</option>${BULK_ACTIONS.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</optgroup>`).join("")}</select>
        <input class="input input--sm" id="bkVal" type="number" style="width:110px" hidden><select class="input input--sm" id="bkCatPick" hidden>${catOpts}</select>
        <label class="check small" id="bkRoundL" hidden><input type="checkbox" id="bkRound"> Round to end in 0</label>
        <button class="btn btn--ghost btn--sm" id="bkApply" disabled>Apply to selected</button>
        <button class="btn btn--ghost btn--sm" id="bkUndo" style="margin-left:auto" hidden>Undo all changes</button></div>
      <div class="card card--flush" id="bkList"><p class="empty">Loading…</p></div>`;
    let list = [], edits = {}, sel = new Set(), shown = [];
    try { list = (await api("GET", "/api/products")).products; } catch (err) { return fail(err); }
    const byId = {}; list.forEach((p) => { byId[p.id] = p; });
    // What the row shows: the saved product, with any unsaved change on top
    const base = (p) => ({ name: p.name, regular: p.comparePrice > p.price ? p.comparePrice : p.price, sale: p.comparePrice > p.price ? p.price : "", status: p.status,
      isNew: p.isNew, featured: p.featured, trackStock: p.trackStock, categoryIds: p.categoryIds.slice(), stock: p.variants.length ? null : (p.stock || 0),
      vstock: Object.fromEntries(p.variants.map((v) => [v.id, v.stock || 0])) });
    const cur = (p) => edits[p.id] || base(p);
    const touch = (p) => (edits[p.id] = edits[p.id] || base(p));
    const dirty = (p) => edits[p.id] && JSON.stringify(edits[p.id]) !== JSON.stringify(base(p));
    const changedIds = () => list.filter(dirty).map((p) => p.id);
    const totalStock = (p, c) => p.variants.length ? Object.values(c.vstock).reduce((s, n) => s + n, 0) : c.stock;
    const was = (p, f, v) => { const b = base(p); return JSON.stringify(f.startsWith("v:") ? b.vstock[f.slice(2)] : b[f]) !== JSON.stringify(v); };
    const mark = (p, f, v) => was(p, f, v) ? " is-changed" : "";
    const count = () => {
      const n = changedIds().length;
      $("#bkSave").disabled = !n; $("#bkSave").textContent = n ? "Save " + n + " product" + (n > 1 ? "s" : "") : "Save changes";
      $("#bkUndo").hidden = !n;
      $("#bkSel").textContent = sel.size + " selected";
      $("#bkApply").disabled = !sel.size || !$("#bkAct").value;
    };
    const draw = () => {
      const q = $("#bkQ").value.trim().toLowerCase(), cat = $("#bkCat").value, st = $("#bkStatus").value, onlyLow = $("#bkLow").checked, onlySale = $("#bkSaleOnly").checked;
      shown = list.filter((p) => {
        const c = cur(p);
        if (q && (c.name + " " + p.sku + " " + p.variants.map((v) => v.sku).join(" ")).toLowerCase().indexOf(q) < 0) return false;
        if (cat && c.categoryIds.indexOf(cat) < 0) return false;
        if (st && c.status !== st) return false;
        if (onlyLow && !(c.trackStock && (p.variants.length ? Object.values(c.vstock).some((n) => n <= low) : c.stock <= low))) return false;
        if (onlySale && !(c.sale !== "" && +c.sale > 0)) return false;
        return true;
      });
      const allOn = shown.length && shown.every((p) => sel.has(p.id));
      $("#bkList").innerHTML = shown.length ? `<div class="table-wrap"><table class="t bulk"><thead><tr><th style="width:30px"><input type="checkbox" id="bkAll"${allOn ? " checked" : ""} title="Select all shown"></th><th>Product</th><th style="width:110px">Regular price</th><th style="width:110px">Sale price</th><th>Stock</th><th style="width:130px">Status</th><th class="center" style="width:50px">New</th><th class="center" style="width:70px">Featured</th></tr></thead><tbody>${shown.map((p) => {
        const c = cur(p), catNames = c.categoryIds.map((id) => (cats.find((x) => x.id === id) || {}).name).filter(Boolean);
        return `<tr data-id="${esc(p.id)}"${dirty(p) ? ' class="is-dirty"' : ""}><td><input type="checkbox" data-sel${sel.has(p.id) ? " checked" : ""}></td>
          <td><div class="flex" style="flex-wrap:nowrap">${p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="thumb" style="background:${esc(p.hex || "#ddd")}"></span>`}<span style="min-width:160px"><input class="input input--sm${mark(p, "name", c.name)}" data-f="name" value="${esc(c.name)}"><small class="muted">${esc(p.sku)}${catNames.length ? " · " + esc(catNames.join(", ")) : ""}</small></span></div></td>
          <td><input class="input input--sm${mark(p, "regular", c.regular)}" type="number" min="0" data-f="regular" value="${esc(c.regular)}"></td>
          <td><input class="input input--sm${mark(p, "sale", c.sale)}" type="number" min="0" data-f="sale" value="${esc(c.sale)}" placeholder="No sale">${c.sale !== "" && +c.sale > 0 && +c.regular > +c.sale ? `<small class="muted">${Math.round((1 - c.sale / c.regular) * 100)}% off</small>` : ""}</td>
          <td>${!c.trackStock ? `<span class="muted small">Not tracked</span>` : p.variants.length ? `<div class="bulk-sizes">${p.variants.map((v) => `<label><span>${esc(optText(v.options))}</span><input class="input input--sm${mark(p, "v:" + v.id, c.vstock[v.id])}${c.vstock[v.id] === 0 ? " is-out" : c.vstock[v.id] <= low ? " is-low" : ""}" type="number" min="0" data-f="v:${esc(v.id)}" value="${esc(c.vstock[v.id])}"></label>`).join("")}<small class="muted">Total ${totalStock(p, c)}</small></div>` : `<input class="input input--sm${mark(p, "stock", c.stock)}" type="number" min="0" data-f="stock" value="${esc(c.stock)}" style="width:90px">`}</td>
          <td><select class="input input--sm${mark(p, "status", c.status)}" data-f="status"><option value="published"${c.status === "published" ? " selected" : ""}>Published</option><option value="draft"${c.status === "draft" ? " selected" : ""}>Draft</option></select></td>
          <td class="center"><input type="checkbox" data-f="isNew"${c.isNew ? " checked" : ""}></td><td class="center"><input type="checkbox" data-f="featured"${c.featured ? " checked" : ""}></td></tr>`;
      }).join("")}</tbody></table></div><p class="muted small" style="padding:10px 14px;margin:0">${shown.length} of ${list.length} products</p>` : `<p class="empty">No products match.</p>`;
      count();
    };
    const redraw = debounce(draw, 150);
    ["#bkQ"].forEach((s) => { $(s).oninput = redraw; });
    ["#bkCat", "#bkStatus", "#bkLow", "#bkSaleOnly"].forEach((s) => { $(s).onchange = draw; });
    $("#bkList").addEventListener("input", (e) => {
      const el = e.target, tr = el.closest("tr[data-id]"), f = el.dataset.f;
      if (!tr || !f) return;
      const p = byId[tr.dataset.id], c = touch(p);
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (f.startsWith("v:")) c.vstock[f.slice(2)] = Math.max(0, Math.round(+v || 0));
      else if (f === "stock") c.stock = Math.max(0, Math.round(+v || 0));
      else if (f === "regular") c.regular = Math.max(0, Math.round(+v || 0));
      else if (f === "sale") c.sale = v === "" ? "" : Math.max(0, Math.round(+v || 0));
      else c[f] = v;
      if (el.type !== "checkbox") el.classList.toggle("is-changed", was(p, f, f.startsWith("v:") ? c.vstock[f.slice(2)] : c[f]));
      tr.classList.toggle("is-dirty", !!dirty(p));
      count();
    });
    $("#bkList").addEventListener("change", (e) => {
      if (e.target.id === "bkAll") { shown.forEach((p) => (e.target.checked ? sel.add(p.id) : sel.delete(p.id))); draw(); return; }
      if (e.target.matches("[data-sel]")) { const id = e.target.closest("tr").dataset.id; e.target.checked ? sel.add(id) : sel.delete(id); count(); }
      if (e.target.dataset.f === "isNew" || e.target.dataset.f === "featured" || e.target.dataset.f === "status") draw();
    });
    $("#bkAct").onchange = () => {
      const a = BULK_ACTIONS.flatMap((g) => g[1]).find((x) => x[0] === $("#bkAct").value) || [];
      $("#bkVal").hidden = a[2] !== 1; $("#bkCatPick").hidden = a[2] !== 2;
      $("#bkRoundL").hidden = !/^(salePct|upPct)$/.test(a[0] || "");
      $("#bkVal").placeholder = /Pct$/.test(a[0] || "") ? "%" : /^stock/.test(a[0] || "") ? "Pieces" : "৳";
      count();
    };
    $("#bkApply").onclick = () => {
      const act = $("#bkAct").value, raw = $("#bkVal").value, val = +raw, cat = $("#bkCatPick").value, round = $("#bkRound").checked;
      const a = BULK_ACTIONS.flatMap((g) => g[1]).find((x) => x[0] === act);
      if (!a) return;
      if (a[2] === 1 && (raw === "" || !isFinite(val))) return toast("Type a number first");
      const r = (n) => Math.max(0, round ? Math.round(n / 10) * 10 : Math.round(n));
      let skipped = 0;
      sel.forEach((id) => {
        const p = byId[id]; if (!p) return;
        const c = touch(p), hasSale = c.sale !== "" && +c.sale > 0;
        if (act === "regular") c.regular = r(val);
        else if (act === "sale") c.sale = r(val);
        else if (act === "salePct") c.sale = r(c.regular * (1 - val / 100));
        else if (act === "saleOff") c.sale = r(c.regular - val);
        else if (act === "endSale") c.sale = "";
        else if (act === "upPct") { c.regular = r(c.regular * (1 + val / 100)); if (hasSale) c.sale = r(c.sale * (1 + val / 100)); }
        else if (act === "upTk") { c.regular = r(c.regular + val); if (hasSale) c.sale = r(+c.sale + val); }
        else if (act === "stockSet" || act === "stockAdd") {
          if (!c.trackStock) { skipped++; return; }
          const f = (n) => Math.max(0, Math.round(act === "stockSet" ? val : n + val));
          if (p.variants.length) Object.keys(c.vstock).forEach((k) => { c.vstock[k] = f(c.vstock[k]); }); else c.stock = f(c.stock);
        }
        else if (act === "trackOn" || act === "trackOff") c.trackStock = act === "trackOn";
        else if (act === "publish" || act === "draft") c.status = act === "publish" ? "published" : "draft";
        else if (act === "newOn" || act === "newOff") c.isNew = act === "newOn";
        else if (act === "featOn" || act === "featOff") c.featured = act === "featOn";
        else if (act === "catAdd") { if (c.categoryIds.indexOf(cat) < 0) c.categoryIds.push(cat); }
        else if (act === "catDel") c.categoryIds = c.categoryIds.filter((x) => x !== cat);
      });
      draw();
      toast("Applied to " + (sel.size - skipped) + " product" + (sel.size - skipped === 1 ? "" : "s") + (skipped ? ". " + skipped + " don't track stock, so they were skipped" : "") + ". Check and save.");
    };
    $("#bkUndo").onclick = async () => {
      if (!(await confirmBox("Undo all changes?", "Everything you changed here and haven't saved goes back.", "Undo"))) return;
      edits = {}; draw();
    };
    $("#bkSave").onclick = async () => {
      const ids = changedIds(), updates = [];
      for (const id of ids) {
        const p = byId[id], c = edits[id], b = base(p), u = { id };
        const sale = c.sale !== "" && +c.sale > 0 ? +c.sale : 0;
        if (!(c.regular > 0)) return toast(c.name + ": the regular price must be more than 0");
        if (sale && sale >= c.regular) return toast(c.name + ": the sale price must be lower than the regular price");
        if (c.regular !== b.regular || c.sale !== b.sale) { u.price = sale || c.regular; u.comparePrice = sale ? c.regular : 0; }
        ["name", "status", "isNew", "featured", "trackStock"].forEach((k) => { if (c[k] !== b[k]) u[k] = c[k]; });
        if (JSON.stringify(c.categoryIds) !== JSON.stringify(b.categoryIds)) u.categoryIds = c.categoryIds;
        if (c.stock !== b.stock) u.stock = c.stock;
        const vs = Object.keys(c.vstock).filter((k) => c.vstock[k] !== b.vstock[k]).map((k) => ({ id: k, stock: c.vstock[k] }));
        if (vs.length) u.variants = vs;
        updates.push(u);
      }
      $("#bkSave").disabled = true;
      try {
        const r = await api("POST", "/api/products/bulk", { updates });
        r.products.forEach((np) => { const i = list.findIndex((x) => x.id === np.id); if (i > -1) { list[i] = np; byId[np.id] = np; } delete edits[np.id]; });
        store = null; toast(r.saved + " product" + (r.saved > 1 ? "s" : "") + " saved"); draw();
      } catch (err) { fail(err); count(); }
    };
    // One row per size, so the file opens neatly in Excel or Google Sheets
    $("#bkCsv").onclick = () => {
      const rows = [["SKU", "Product", "Size", "Regular price", "Sale price", "Stock", "Status"]];
      list.forEach((p) => {
        const c = cur(p);
        if (p.variants.length) p.variants.forEach((v) => rows.push([v.sku, c.name, optText(v.options), c.regular, c.sale, c.trackStock ? c.vstock[v.id] : "", c.status]));
        else rows.push([p.sku, c.name, "", c.regular, c.sale, c.trackStock ? c.stock : "", c.status]);
      });
      download("ravelle-bulk-edit.csv", csv(rows));
    };
    $("#bkUp").onchange = async (e) => {
      const file = e.target.files[0]; e.target.value = "";
      if (!file) return;
      const rows = parseCsvText(await file.text());
      const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
      const col = (n) => head.indexOf(n);
      const iSku = col("sku"), iReg = col("regular price"), iSale = col("sale price"), iStock = col("stock"), iStatus = col("status");
      if (iSku < 0) return toast("The file needs a SKU column. Download the CSV first and edit that.");
      const bySku = {};
      list.forEach((p) => { bySku[p.sku] = { p }; p.variants.forEach((v) => { bySku[v.sku] = { p, v }; }); });
      let hit = 0, miss = 0; const done = {};
      rows.forEach((r) => {
        const m = bySku[String(r[iSku] || "").trim().toUpperCase()];
        if (!m) { miss++; return; }
        hit++;
        const c = touch(m.p), cell = (i) => (i < 0 ? undefined : String(r[i] == null ? "" : r[i]).trim());
        // Prices and status are per product; the first row of a product sets them
        if (!done[m.p.id]) {
          done[m.p.id] = 1;
          if (cell(iReg)) c.regular = Math.max(0, Math.round(+cell(iReg) || 0));
          if (cell(iSale) !== undefined) c.sale = cell(iSale) === "" || !(+cell(iSale) > 0) ? "" : Math.round(+cell(iSale));
          if (/^(published|draft)$/i.test(cell(iStatus) || "")) c.status = cell(iStatus).toLowerCase();
        }
        if (c.trackStock && cell(iStock) !== undefined && cell(iStock) !== "") {
          const n = Math.max(0, Math.round(+cell(iStock) || 0));
          if (m.v) c.vstock[m.v.id] = n; else if (!m.p.variants.length) c.stock = n;
        }
      });
      draw();
      toast(hit + " rows read" + (miss ? ", " + miss + " SKUs not found" : "") + ". Check the highlighted changes and save.");
    };
    draw();
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------
  async function viewCategories() {
    setTitle("Categories");
    await loadStore(true);
    const cats = (await api("GET", "/api/categories").catch(fail) || {}).categories || [];
    const count = {};
    (await api("GET", "/api/products").catch(() => ({ products: [] }))).products.forEach((p) => p.categoryIds.forEach((id) => { count[id] = (count[id] || 0) + 1; }));
    view.innerHTML = `<div class="head"><div><h1 class="h1">Categories</h1><p class="muted">Main categories and sub-categories. Each one gets its own page at #category/slug. Add them to the header menu in <a href="#/menus">Menus</a>.</p></div><button class="btn btn--dark" id="catAdd">Add category</button></div>
      <div class="card card--flush">${catTree(cats).map(({ c, depth }) => `<div class="cat-row" style="padding-left:${14 + depth * 28}px">${c.image ? `<img src="${esc(c.image)}" alt="">` : `<span class="ph"></span>`}
        <div><b>${depth ? "↳ " : ""}${esc(c.name)}</b><small>No. ${String(c.code || "").padStart(2, "0")} · #category/${esc(c.slug)} · ${count[c.id] || 0} products${c.description ? " · " + esc(c.description.slice(0, 60)) : ""}</small></div>
        <div class="flex"><a class="btn btn--ghost btn--sm" href="./#category/${esc(c.slug)}" target="_blank" rel="noopener">View</a><button class="btn btn--ghost btn--sm" data-edit="${c.id}">Edit</button></div></div>`).join("") || `<p class="empty">No categories yet.</p>`}</div>`;
    const edit = (c) => {
      const isNew = !c.id;
      const body = modal(isNew ? "Add category" : "Edit " + c.name, `<form class="stack" id="catForm">
        <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(c.name || "")}"></label>
        <div class="row row--2"><label class="field"><span>Parent</span><select class="input" name="parentId"><option value="">None (main category)</option>${catTree(cats).filter(({ c: x }) => x.id !== c.id).map(({ c: x, depth }) => `<option value="${x.id}"${x.id === c.parentId ? " selected" : ""}>${"— ".repeat(depth)}${esc(x.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Order</span><input class="input" name="order" type="number" value="${esc(c.order || 0)}"><small>Lower shows first.</small></label></div>
        <label class="field"><span>Category number</span><input class="input" name="code" type="number" min="1" max="999" value="${esc(c.code || "")}" placeholder="Next free number"><small>Used in new product SKUs: RVL-<b>${String(c.code || "NN").padStart(2, "0")}</b>-0001. Changing it doesn't change SKUs that already exist.</small></label>
        <label class="field"><span>Slug</span><input class="input" name="slug" value="${esc(c.slug || "")}" placeholder="Made from the name"></label>
        <label class="field"><span>Description</span><textarea class="input" name="description" rows="2">${esc(c.description || "")}</textarea></label>
        ${imgField("image", c.image, "Image", "Used on collection cards and the coming-soon page.")}
        <label class="field"><span>Title in Google</span><input class="input" name="seoTitle" maxlength="80" value="${esc(c.seoTitle || "")}" placeholder="${esc(c.name || "")}"><small>Like "Oversized T-shirts in Bangladesh". Leave empty to use the name.</small></label>
        <label class="field"><span>Description in Google</span><textarea class="input" name="seoDescription" rows="2" maxlength="200" placeholder="Made from the description and prices">${esc(c.seoDescription || "")}</textarea></label>
        <label class="field"><span>Text under the products</span><textarea class="input" name="seoText" rows="3" maxlength="2000">${esc(c.seoText || "")}</textarea><small>A short paragraph shown below the product grid, for search engines. Keep it to 2 or 3 sentences.</small></label>
        <div class="modal__foot">${isNew ? "" : `<button class="btn btn--danger" type="button" id="catDel" style="margin-right:auto">Delete</button>`}<button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save</button></div></form>`);
      wireImgFields(body);
      $("#catForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = formData(e.target);
        try { isNew ? await api("POST", "/api/categories", b) : await api("PUT", "/api/categories/" + c.id, b); closeModal(); toast("Category saved"); store = null; viewCategories(); } catch (err) { fail(err); }
      };
      if (!isNew) $("#catDel").onclick = async () => {
        if (!(await confirmBox("Delete " + c.name + "?", "Sub-categories move up a level and products stay, just without this category.", "Delete", true))) return;
        try { await api("DELETE", "/api/categories/" + c.id); toast("Deleted"); store = null; viewCategories(); } catch (err) { fail(err); }
      };
    };
    $("#catAdd").onclick = () => edit({});
    view.addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) edit(cats.find((c) => c.id === b.dataset.edit)); });
  }

  // Variation types (attributes)
  // ---------------------------------------------------------------------------
  // Size charts: templates with columns and size rows; products pick one by name
  // ---------------------------------------------------------------------------
  function sizeChartHtml(ch, label) {
    const cols = ch.columns || [], rows = ch.rows || [];
    return `<div class="szc"><div class="szc__top"><h3 class="szc__title">${esc(ch.title || ch.name || "Title")}<span>Size chart</span></h3>${ch.unit ? `<p class="szc__unit">Measurements<br>in ${esc(ch.unit)}</p>` : ""}</div>
      <div class="szc__wrap"><table class="szc__t"><thead><tr>${cols.map((c, i) => `<th>${esc(c)}${i && ch.unit ? `<small>${esc(ch.unit)}</small>` : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${cols.map((_, i) => i ? `<td>${esc(r[i] || "")}</td>` : `<th scope="row">${esc(r[i] || "")}</th>`).join("")}</tr>`).join("")}</tbody></table></div>
      <div class="szc__foot">${ch.note ? `<span><b>Tip</b> ${esc(ch.note)}</span>` : "<span></span>"}<span class="szc__logo">${esc(label || "Ravelle")}</span></div></div>`;
  }
  // ---------------------------------------------------------------------------
  // Price tags: labels with brand, name, barcode of the SKU, the number and the price
  // ---------------------------------------------------------------------------
  const BC_TYPES = { code128: "Code 128 (best for SKUs)", code39: "Code 39", code93: "Code 93", ean13: "EAN-13 (numbers only)", upca: "UPC-A (numbers only)", qrcode: "QR code" };
  let bwipLoad = null;
  const loadBwip = () => bwipLoad || (bwipLoad = new Promise((ok, no) => {
    if (window.bwipjs) return ok();
    const sc = document.createElement("script");
    sc.src = "assets/admin/bwip-js.min.js?v=4.5.1";
    sc.onload = () => ok(); sc.onerror = () => { bwipLoad = null; no(new Error("The barcode maker didn't load. Check the connection and open the page again.")); };
    document.head.appendChild(sc);
  }));
  // One barcode as SVG. EAN-13 and UPC-A only take numbers, so a SKU with letters gets a clear message instead
  function labelBarcode(t, code) {
    const digits = /^\d+$/.test(code);
    if (t.type === "ean13" && !(digits && (code.length === 12 || code.length === 13))) return { err: "EAN-13 needs a 12 or 13 digit number. Use Code 128 for SKUs like " + code + "." };
    if (t.type === "upca" && !(digits && (code.length === 11 || code.length === 12))) return { err: "UPC-A needs an 11 or 12 digit number. Use Code 128 for SKUs like " + code + "." };
    try {
      const o = { bcid: t.type, text: code, scale: 2, paddingwidth: 0, paddingheight: 0 };
      if (t.type !== "qrcode") o.height = t.barHeight;
      if (t.type === "code39" || t.type === "code93") o.text = code.toUpperCase();
      if (t.type === "code39") o.text = o.text.replace(/[^0-9A-Z\-. $\/+%]/g, "-");
      return { svg: window.bwipjs.toSVG(o).replace("<svg ", '<svg preserveAspectRatio="none" ') };
    } catch (e) { return { err: "This code can't be made as " + BC_TYPES[t.type] + ": " + String(e.message || e).replace(/^bwipp\.\w+#?\d*:\s*/, "") }; }
  }
  const LABEL_FONT = "Arial, Helvetica, sans-serif";
  function labelHtml(t, it) {
    const line = (k, html, extra) => t.show[k] ? `<div class="lb-${k}" style="font-size:${t.font[k]}pt;font-weight:${t.bold[k] ? 700 : 400}${extra || ""}">${html}</div>` : "";
    const bc = t.show.barcode ? labelBarcode(t, it.sku) : null;
    const bar = bc ? (bc.err ? `<div class="lb-err">${esc(bc.err)}</div>` : t.type === "qrcode"
      ? `<div class="lb-bar" style="height:${t.barHeight}mm;width:${t.barHeight}mm">${bc.svg}</div>`
      : `<div class="lb-bar" style="height:${t.barHeight}mm;width:${t.barWidth}%">${bc.svg}</div>`) : "";
    const price = (t.show.oldPrice && it.oldPrice > it.price ? `<s style="font-weight:400;font-size:.75em;margin-right:4px">${esc(t.pricePrefix)}${it.oldPrice.toLocaleString("en-IN")}</s>` : "") + esc(t.pricePrefix) + Number(it.price || 0).toLocaleString("en-IN");
    const just = t.align === "left" ? "flex-start" : t.align === "right" ? "flex-end" : "center";
    return `<div class="lb" style="width:${t.width}mm;height:${t.height}mm;padding:${t.padding}mm;text-align:${t.align};align-items:${just};${t.border ? "outline:0.2mm solid #000;outline-offset:-0.2mm;" : ""}font-family:${LABEL_FONT}">
      ${line("brand", esc(t.brand || "RAVELLE"), ";letter-spacing:.08em")}
      ${line("name", esc(it.name) + (t.show.size && it.size ? ` <span style="font-weight:700">· ${esc(it.size)}</span>` : ""), ";overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical")}
      ${bar}${line("code", esc(it.sku), ";letter-spacing:.06em")}${line("price", price)}</div>`;
  }
  const LABEL_CSS = `.lb{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:0.6mm;overflow:hidden;background:#fff;color:#000;line-height:1.15}
    .lb>div{max-width:100%}.lb-bar svg{display:block;width:100%;height:100%}.lb-err{font:6pt/1.2 Arial,sans-serif;color:#b00020;border:0.2mm dashed #b00020;padding:1mm}`;
  function labelPrintDoc(t, items) {
    const list = [];
    items.forEach((it) => { for (let i = 0; i < it.qty; i++) list.push(labelHtml(t, it)); });
    const page = t.sheet === "a4"
      ? `@page{size:A4;margin:8mm}.sheet{display:grid;grid-template-columns:repeat(${t.columns},${t.width}mm);gap:${t.gap}mm}.lb{break-inside:avoid}`
      : `@page{size:${t.width}mm ${t.height}mm;margin:0}.lb{break-after:page}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Price tags</title><style>html,body{margin:0;background:#fff}${LABEL_CSS}${page}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><div class="sheet">${list.join("")}</div></body></html>`;
  }
  async function viewLabels(_, query) {
    setTitle("Price tags");
    const q = new URLSearchParams(query || "");
    let t, prods;
    view.innerHTML = `<p class="muted">Loading…</p>`;
    try {
      const [tr, pr] = await Promise.all([api("GET", "/api/label-template"), api("GET", "/api/products"), loadBwip()]);
      t = tr.template; prods = pr.products;
    } catch (err) { return fail(err); }
    if (!t.brand) t.brand = ((store && store.settings && store.settings.store && store.settings.store.name) || "RAVELLE").toUpperCase();
    // every size of every product is one row
    // serial order: by product SKU (RV-1001, RV-1002…), then sizes in their own order (M, L, XL…)
    const rows = [];
    prods.slice().sort((a, b) => String(a.sku || "").localeCompare(String(b.sku || ""), "en", { numeric: true })).forEach((p) => {
      const old = +p.comparePrice || 0;
      if (p.variants && p.variants.length) p.variants.forEach((v) => rows.push({ key: p.id + "|" + v.id, pid: p.id, name: p.name, size: Object.values(v.options || {}).join(" / "), sku: v.sku || p.sku, price: v.price != null ? +v.price : +p.price, oldPrice: old, stock: v.stock, qty: 0 }));
      else rows.push({ key: p.id, pid: p.id, name: p.name, size: "", sku: p.sku, price: +p.price, oldPrice: old, stock: p.stock, qty: 0 });
    });
    let search = "";
    const only = q.get("product");
    if (only) { const p = prods.find((x) => x.id === only); if (p) { search = p.name; rows.filter((r) => r.pid === only).forEach((r) => { r.qty = 1; }); } }
    const num = (id, label, v, min, max, step, unit) => `<label class="field"><span>${label}</span><div class="lb-unit"><input class="input" type="number" data-t="${id}" value="${v}" min="${min}" max="${max}" step="${step || 1}"><small>${unit || ""}</small></div></label>`;
    const chk = (id, label, on) => `<label class="switch"><input type="checkbox" data-t="${id}" ${on ? "checked" : ""}> ${label}</label>`;
    const lineRow = (k, title, extra) => `<div class="lb-row"><div class="lb-row__head">${chk("show." + k, `<b>${title}</b>`, t.show[k])}</div>
      <div class="lb-row__opts">${t.font[k] != null ? num("font." + k, "Text size", t.font[k], 4, 40, 0.5, "pt") + `<label class="switch"><input type="checkbox" data-t="bold.${k}" ${t.bold[k] ? "checked" : ""}> Bold</label>` : ""}${extra || ""}</div></div>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Price tags</h1><p class="muted">Design the label once, pick products and how many of each, then print. The barcode is the size's SKU.</p></div></div>
      <div class="lb-cols">
        <form class="stack" id="lbForm">
          <div class="card"><h2 class="h2">Label size</h2>
            <div class="row row--3">${num("width", "Width", t.width, 15, 210, 1, "mm")}${num("height", "Height", t.height, 10, 297, 1, "mm")}${num("padding", "Inner margin", t.padding, 0, 10, 0.5, "mm")}</div>
            <div class="row row--3"><label class="field"><span>Paper</span><select class="input" data-t="sheet"><option value="roll">Label printer roll (one label per page)</option><option value="a4"${t.sheet === "a4" ? " selected" : ""}>A4 sticker sheet</option></select></label>
              <span data-a4 class="lb-a4">${num("columns", "Labels across", t.columns, 1, 8, 1, "")}${num("gap", "Gap", t.gap, 0, 20, 0.5, "mm")}</span></div>
            <div class="row row--2"><label class="field"><span>Text alignment</span><select class="input" data-t="align">${["left", "center", "right"].map((a) => `<option value="${a}"${t.align === a ? " selected" : ""}>${a[0].toUpperCase() + a.slice(1)}</option>`).join("")}</select></label>
              <div class="field"><span>&nbsp;</span>${chk("border", "Print a border (to test the size)", t.border)}</div></div></div>
          <div class="card"><h2 class="h2">Barcode</h2>
            <div class="row row--3"><label class="field"><span>Barcode type</span><select class="input" data-t="type">${Object.keys(BC_TYPES).map((k) => `<option value="${k}"${t.type === k ? " selected" : ""}>${BC_TYPES[k]}</option>`).join("")}</select></label>
              ${num("barHeight", "Barcode height", t.barHeight, 3, 60, 0.5, "mm")}<span data-linear>${num("barWidth", "Barcode width", t.barWidth, 20, 100, 1, "% of label")}</span></div>
            <p class="muted small" style="margin:0">Code 128 reads SKUs with letters and dashes, like RV-1001-M, and works with every scanner. EAN-13 and UPC-A only take numbers.</p></div>
          <div class="card"><h2 class="h2">On the label, top to bottom</h2>
            ${lineRow("brand", "1. Brand name", `<label class="field"><span>Text</span><input class="input" data-t="brand" value="${esc(t.brand)}"></label>`)}
            ${lineRow("name", "2. Product name", chk("show.size", "Add the size", t.show.size))}
            <div class="lb-row"><div class="lb-row__head">${chk("show.barcode", "<b>3. Barcode</b>", t.show.barcode)}</div><div class="lb-row__opts"><small class="muted">Size and type are set above.</small></div></div>
            ${lineRow("code", "4. Number under the barcode (SKU)")}
            ${lineRow("price", "5. Price", `<label class="field"><span>Before the price</span><input class="input" data-t="pricePrefix" value="${esc(t.pricePrefix)}" style="width:80px"></label>` + chk("show.oldPrice", "Show old price crossed out", t.show.oldPrice))}
          </div>
          <div class="flex"><button class="btn btn--dark" type="submit">Save label design</button><button class="btn btn--ghost" type="button" id="lbReset">Back to default</button></div>
        </form>
        <div class="lb-side"><div class="card"><h2 class="h2">Preview</h2><p class="muted small" style="margin:0 0 10px" id="lbPrevNote"></p><div class="lb-prev" id="lbPrev"></div></div></div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card__head"><div><h2 class="h2">Products to print</h2><p class="muted small" style="margin:0">Type how many tags you need for each size.</p></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="lbStock">Quantity = stock</button><button class="btn btn--ghost btn--sm" type="button" id="lbClear">Clear</button><button class="btn btn--dark" type="button" id="lbPrint">Print</button></div></div>
        <input class="input" id="lbQ" placeholder="Search product, SKU or size" value="${esc(search)}" style="max-width:340px;margin-bottom:10px">
        <div class="table-wrap" id="lbList"></div></div>
      <style>${LABEL_CSS}</style>`;
    const form = $("#lbForm");
    const shown = () => { const w = search.toLowerCase(); return rows.filter((r) => !w || (r.name + " " + r.sku + " " + r.size).toLowerCase().indexOf(w) > -1); };
    const total = () => rows.reduce((n, r) => n + r.qty, 0);
    const drawList = () => {
      const list = shown();
      $("#lbList").innerHTML = list.length ? `<table class="t t--tight"><thead><tr><th>Product</th><th>Size</th><th>SKU</th><th class="right">Price</th><th class="right">Stock</th><th class="right">Tags</th></tr></thead><tbody>${list.slice(0, 300).map((r) => `
        <tr><td>${esc(r.name)}</td><td>${esc(r.size || "–")}</td><td class="mono">${esc(r.sku)}</td><td class="right">${taka(r.price)}</td><td class="right">${r.stock == null ? "–" : r.stock}</td>
        <td class="right"><input class="input lb-qty" type="number" min="0" max="999" data-k="${esc(r.key)}" value="${r.qty || ""}" placeholder="0"></td></tr>`).join("")}</tbody></table>` : `<p class="empty">No products match.</p>`;
      count();
    };
    const count = () => { const n = total(); $("#lbPrint").textContent = n ? "Print " + n + " tag" + (n > 1 ? "s" : "") : "Print"; };
    const sample = () => rows.find((r) => r.qty) || shown()[0] || rows[0] || { name: "Product name", size: "M", sku: "RV-1001-M", price: 1499, oldPrice: 1999 };
    const drawPrev = () => {
      $("#lbPrev").innerHTML = labelHtml(t, sample());
      $("#lbPrevNote").textContent = `Real size ${t.width} × ${t.height} mm, shown bigger. ` + (rows.find((r) => r.qty) ? "Showing the first product you picked." : "Pick products below to see them here.");
      $$("[data-a4]", view).forEach((el) => { el.hidden = t.sheet !== "a4"; });
      $$("[data-linear]", view).forEach((el) => { el.hidden = t.type === "qrcode"; });
    };
    const read = (el) => {
      const [a, b] = el.dataset.t.split(".");
      const v = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value;
      if (el.type === "number" && (el.value === "" || isNaN(v))) return;
      if (b) t[a][b] = v; else t[a] = v;
    };
    form.addEventListener("input", (e) => { const el = e.target.closest("[data-t]"); if (el) { read(el); drawPrev(); } });
    form.addEventListener("change", (e) => { const el = e.target.closest("[data-t]"); if (el) { read(el); drawPrev(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; busy(btn, true);
      try { t = (await api("PUT", "/api/label-template", { template: t })).template; toast("Label design saved"); } catch (err) { fail(err); }
      busy(btn, false);
    };
    $("#lbReset").onclick = async () => {
      if (!(await confirmBox("Go back to the default label?", "Size 50 × 30 mm, Code 128, brand, name, barcode, SKU and price.", "Use default"))) return;
      try { await api("PUT", "/api/label-template", { template: { width: 50, height: 30, padding: 2, type: "code128", barHeight: 10, barWidth: 90, pricePrefix: "৳", align: "center", border: false, sheet: "roll", columns: 3, gap: 2,
        show: { brand: true, name: true, size: true, barcode: true, code: true, price: true, oldPrice: false }, font: { brand: 9, name: 7, code: 6, price: 11 }, bold: { brand: true, name: false, code: false, price: true } } }); viewLabels(_, query); } catch (err) { fail(err); }
    };
    $("#lbQ").oninput = (e) => { search = e.target.value; drawList(); };
    $("#lbList").addEventListener("input", (e) => { const el = e.target.closest("[data-k]"); if (!el) return; const r = rows.find((x) => x.key === el.dataset.k); r.qty = Math.max(0, Math.min(999, parseInt(el.value, 10) || 0)); count(); drawPrev(); });
    $("#lbStock").onclick = () => { shown().forEach((r) => { r.qty = Math.max(0, Math.min(999, r.stock || 0)); }); drawList(); drawPrev(); };
    $("#lbClear").onclick = () => { rows.forEach((r) => { r.qty = 0; }); drawList(); drawPrev(); };
    $("#lbPrint").onclick = () => {
      const pick = rows.filter((r) => r.qty);
      if (!pick.length) return toast("Type how many tags you need next to a product first.", true);
      if (total() > 2000) return toast("That's more than 2000 tags. Print them in smaller batches.", true);
      const bad = pick.map((r) => t.show.barcode && labelBarcode(t, r.sku).err).filter(Boolean);
      if (bad.length) return toast(bad[0], true);
      let fr = $("#lbFrame");
      if (fr) fr.remove();
      fr = document.createElement("iframe");
      fr.id = "lbFrame"; fr.title = "Price tags"; fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      document.body.appendChild(fr);
      const d = fr.contentWindow.document;
      d.open(); d.write(labelPrintDoc(t, pick)); d.close();
      setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); }, 300);
    };
    drawList(); drawPrev();
  }

  async function viewSizeCharts() {
    setTitle("Size charts");
    let list, prods = [];
    try { list = (await api("GET", "/api/size-charts"))["size-charts"]; } catch (err) { return fail(err); }
    try { prods = (await api("GET", "/api/products")).products; } catch (_) { try { prods = (await loadStore(true)).products; } catch (__) {} }
    const used = (id) => prods.filter((p) => p.sizeChartId === id).length;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Size charts</h1><p class="muted">Make a chart once, then pick it on each product (Products › product › Size guide). Edit it here and every product using it updates.</p></div><a class="btn btn--dark" href="#/sizecharts/new">New size chart</a></div>
      ${list.length ? `<div class="sc-grid">${list.map((c) => `<div class="card sc-card"><div class="sc-card__prev">${sizeChartHtml(c)}</div>
        <div class="flex flex--between"><div><b>${esc(c.name)}</b><br><small class="muted">${c.rows.length} sizes · used on ${used(c.id)} product${used(c.id) === 1 ? "" : "s"}</small></div>
        <div class="flex"><a class="btn btn--ghost btn--sm" href="#/sizecharts/${esc(c.id)}">Edit</a><button class="btn btn--ghost btn--sm" type="button" data-dup="${esc(c.id)}">Duplicate</button><button class="btn btn--ghost btn--sm" type="button" data-del="${esc(c.id)}">Delete</button></div></div></div>`).join("")}</div>`
        : `<div class="card"><p class="empty">No size charts yet. Press New size chart to make one.</p></div>`}`;
    view.onclick = async (e) => {
      const d = e.target.closest("[data-dup]"), x = e.target.closest("[data-del]");
      if (d) {
        const c = list.find((y) => y.id === d.dataset.dup);
        let name = c.name + " copy", n = 2; while (list.some((y) => y.name === name)) name = c.name + " copy " + n++;
        try { const r = await api("POST", "/api/size-charts", { name, title: c.title, unit: c.unit, note: c.note, columns: c.columns, rows: c.rows }); toast("Duplicated"); go("sizecharts/" + r.item.id); } catch (err) { fail(err); }
      }
      if (x) {
        const c = list.find((y) => y.id === x.dataset.del), n = used(c.id);
        if (!(await confirmBox("Delete " + c.name + "?", n ? n + " product" + (n > 1 ? "s use" : " uses") + " it. They'll show no size guide until you pick another chart." : "No product uses it.", "Delete", true))) return;
        try { await api("DELETE", "/api/size-charts/" + c.id); toast("Deleted"); viewSizeCharts(); } catch (err) { fail(err); }
      }
    };
  }
  async function viewSizeChart(id) {
    const isNew = id === "new";
    let c;
    if (isNew) c = { name: "", title: "", unit: "inch", note: "", columns: ["Size", "Chest", "Length", "Sleeve"], rows: [["M", "", "", ""], ["L", "", "", ""], ["XL", "", "", ""], ["XXL", "", "", ""]] };
    else { try { c = ((await api("GET", "/api/size-charts"))["size-charts"] || []).find((x) => x.id === id); } catch (err) { return fail(err); } if (!c) { view.innerHTML = `<p class="empty">That size chart doesn't exist any more.</p>`; return; } c = clone(c); }
    setTitle(isNew ? "New size chart" : c.name);
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/sizecharts">← Size charts</a><h1 class="h1" style="margin-top:8px">${isNew ? "New size chart" : esc(c.name)}</h1></div></div>
      <form class="cols sc-edit" id="scForm"><div class="stack">
        <div class="card"><div class="row row--2"><label class="field"><span>Template name</span><input class="input" name="name" value="${esc(c.name)}" placeholder="Oversized T-shirt" required maxlength="60"><small>You pick it by this name on products.</small></label>
          <label class="field"><span>Title on the chart</span><input class="input" name="title" value="${esc(c.title)}" placeholder="Oversized T-shirt" maxlength="60"></label></div>
          <div class="row row--2"><label class="field"><span>Unit</span><input class="input" name="unit" value="${esc(c.unit)}" placeholder="inch" maxlength="20" list="scUnits"><datalist id="scUnits"><option value="inch"><option value="cm"></datalist></label>
          <label class="field"><span>Tip under the chart (optional)</span><input class="input" name="note" value="${esc(c.note || "")}" maxlength="300" placeholder="Between two sizes? Take the bigger one."></label></div></div>
        <div class="card"><div class="card__head"><div><h2 class="h2">Table</h2><p class="muted small" style="margin:0">First column is the size. Type the column titles in the dark row and the measurements below.</p></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="scAddCol">+ Column</button><button class="btn btn--ghost btn--sm" type="button" id="scAddRow">+ Row</button></div></div>
          <div class="table-wrap"><table class="sc-grid-ed" id="scTable"></table></div></div>
        <div class="flex"><button class="btn btn--dark" type="submit">${isNew ? "Save size chart" : "Save changes"}</button><a class="btn btn--ghost" href="#/sizecharts">Cancel</a></div>
      </div>
      <div class="stack"><div class="card sc-preview"><h2 class="h2">Preview</h2><p class="muted small" style="margin:0 0 10px">How customers see it in the Size guide popup.</p><div id="scPrev"></div></div></div></form>`;
    const f = $("#scForm"), tb = $("#scTable");
    const draw = () => {
      tb.innerHTML = `<thead><tr><th class="sc-x"></th>${c.columns.map((h, i) => `<th><div class="flex" style="gap:4px;flex-wrap:nowrap"><input class="input input--sm" data-col="${i}" value="${esc(h)}" maxlength="30" aria-label="Column ${i + 1} title">${c.columns.length > 2 ? `<button class="sc-del" type="button" data-delcol="${i}" title="Remove column" aria-label="Remove column ${i + 1}">×</button>` : ""}</div></th>`).join("")}</tr></thead>
        <tbody>${c.rows.map((r, ri) => `<tr><td class="sc-x">${c.rows.length > 1 ? `<button class="sc-del" type="button" data-delrow="${ri}" title="Remove row" aria-label="Remove row ${ri + 1}">×</button>` : ""}</td>${c.columns.map((_, ci) => `<td><input class="input input--sm${ci ? "" : " sc-size"}" data-cell="${ri}:${ci}" value="${esc(r[ci] || "")}" maxlength="30"></td>`).join("")}</tr>`).join("")}</tbody>`;
      prev();
    };
    const read = () => { c.name = f.name.value; c.title = f.title.value; c.unit = f.unit.value; c.note = f.note.value; };
    const prev = () => { read(); $("#scPrev").innerHTML = sizeChartHtml(c); };
    f.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.col !== undefined) c.columns[+t.dataset.col] = t.value;
      if (t.dataset.cell) { const [r, k] = t.dataset.cell.split(":").map(Number); c.rows[r][k] = t.value; }
      prev();
    });
    tb.addEventListener("click", (e) => {
      const dc = e.target.closest("[data-delcol]"), dr = e.target.closest("[data-delrow]");
      if (dc) { const i = +dc.dataset.delcol; c.columns.splice(i, 1); c.rows.forEach((r) => r.splice(i, 1)); draw(); }
      if (dr) { c.rows.splice(+dr.dataset.delrow, 1); draw(); }
    });
    $("#scAddCol").onclick = () => { if (c.columns.length >= 10) return toast("Up to 10 columns.", true); c.columns.push("New"); c.rows.forEach((r) => r.push("")); draw(); const ins = $$("[data-col]", tb); ins[ins.length - 1].select(); };
    $("#scAddRow").onclick = () => { if (c.rows.length >= 30) return toast("Up to 30 rows.", true); c.rows.push(c.columns.map(() => "")); draw(); const ins = $$(".sc-size", tb); ins[ins.length - 1].focus(); };
    f.onsubmit = async (e) => {
      e.preventDefault(); read();
      const body = { name: c.name.trim(), title: c.title.trim() || c.name.trim(), unit: c.unit.trim(), note: c.note.trim(), columns: c.columns.map((x) => x.trim()), rows: c.rows };
      const btn = $("button[type=submit]", f); busy(btn, true);
      try { isNew ? await api("POST", "/api/size-charts", body) : await api("PUT", "/api/size-charts/" + id, body); store = null; toast("Size chart saved"); go("sizecharts"); }
      catch (err) { busy(btn, false); fail(err); }
    };
    draw();
  }

  async function viewVariations() {
    setTitle("Variations");
    const list = ((await api("GET", "/api/attributes").catch(fail)) || {}).attributes || [];
    view.innerHTML = `<div class="head"><div><h1 class="h1">Variations</h1><p class="muted">The option types products can come in, like Size, Colour or Fit. Pick them on each product to make its variations.</p></div><button class="btn btn--dark" id="atAdd">Add variation type</button></div>
      <div class="grid-3">${list.map((a) => `<div class="card"><div class="card__head"><h2 class="h2">${esc(a.name)}</h2><span class="tag">${a.type === "color" ? "Colour swatches" : "Buttons"}</span></div>
        <div class="chips">${a.values.map((v) => `<span class="chipbtn">${v.hex ? `<span class="sw" style="background:${esc(v.hex)}"></span>` : ""}${esc(v.label)}</span>`).join("")}</div><div class="flex"><button class="btn btn--ghost btn--sm" data-edit="${a.id}">Edit</button></div></div>`).join("") || `<p class="muted">None yet.</p>`}</div>`;
    const edit = (a) => {
      const isNew = !a.id;
      let values = clone(a.values || []);
      const body = modal(isNew ? "Add variation type" : "Edit " + a.name, `<form class="stack" id="atForm">
        <div class="row row--2"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(a.name || "")}" placeholder="Size, Colour, Fit…"></label>
        <label class="field"><span>Shown as</span><select class="input" name="type"><option value="button">Buttons</option><option value="color"${a.type === "color" ? " selected" : ""}>Colour swatches</option></select></label></div>
        <div class="field"><span>Options</span><div class="stack stack--sm" id="atVals"></div><button class="btn btn--ghost btn--sm" type="button" id="atAddVal" style="justify-self:start">+ Add option</button></div>
        <div class="modal__foot">${isNew ? "" : `<button class="btn btn--danger" type="button" id="atDel" style="margin-right:auto">Delete</button>`}<button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save</button></div></form>`);
      const draw = () => {
        const isColor = $("[name=type]", body).value === "color";
        $("#atVals").innerHTML = values.map((v, i) => `<div class="flex" style="flex-wrap:nowrap"><input class="input input--sm grow" data-i="${i}" data-f="label" value="${esc(v.label)}" placeholder="Option">${isColor ? `<input type="color" data-i="${i}" data-f="hex" value="${esc(v.hex || "#888888")}">` : ""}
          <button class="icon" type="button" data-up="${i}" ${i ? "" : "disabled"}>↑</button><button class="icon" type="button" data-del="${i}">✕</button></div>`).join("");
      };
      draw();
      $("[name=type]", body).onchange = draw;
      $("#atVals").addEventListener("input", (e) => { const el = e.target.closest("[data-i]"); if (el) values[+el.dataset.i][el.dataset.f] = el.value; });
      $("#atVals").addEventListener("click", (e) => {
        const up = e.target.closest("[data-up]"), del = e.target.closest("[data-del]");
        if (up) { const i = +up.dataset.up; [values[i - 1], values[i]] = [values[i], values[i - 1]]; draw(); }
        if (del) { values.splice(+del.dataset.del, 1); draw(); }
      });
      $("#atAddVal").onclick = () => { values.push({ label: "" }); draw(); $$("#atVals input[data-f=label]").pop().focus(); };
      $("#atForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = formData(e.target);
        const body2 = { name: b.name, type: b.type, values: values.filter((v) => v.label.trim()).map((v) => b.type === "color" ? v : { label: v.label }) };
        try { isNew ? await api("POST", "/api/attributes", body2) : await api("PUT", "/api/attributes/" + a.id, body2); closeModal(); toast("Saved"); store = null; viewVariations(); } catch (err) { fail(err); }
      };
      if (!isNew) $("#atDel").onclick = async () => {
        if (!(await confirmBox("Delete " + a.name + "?", "Products keep their current variations; you just can't pick this type for new ones.", "Delete", true))) return;
        try { await api("DELETE", "/api/attributes/" + a.id); toast("Deleted"); store = null; viewVariations(); } catch (err) { fail(err); }
      };
    };
    $("#atAdd").onclick = () => edit({ values: [{ label: "" }] });
    view.addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) edit(list.find((a) => a.id === b.dataset.edit)); });
  }

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------
  async function viewCoupons() {
    setTitle("Coupons");
    const list = ((await api("GET", "/api/coupons").catch(fail)) || {}).coupons || [];
    const cats = ((await api("GET", "/api/categories").catch(() => null)) || {}).categories || [];
    const catName = (id) => (cats.find((x) => x.id === id) || {}).name || "";
    const label = (c) => c.type === "percent" ? c.value + "% off" + (c.maxDiscount ? ", up to " + taka(c.maxDiscount) : "") : c.type === "fixed" ? taka(c.value) + " off" : "Free delivery";
    const state = (c) => { const t = Date.now(); return !c.active ? "inactive" : c.endsAt && t > c.endsAt ? "expired" : c.startsAt && t < c.startsAt ? "scheduled" : c.maxUses && c.used >= c.maxUses ? "used up" : "active"; };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Coupons & offers</h1><p class="muted">Codes customers enter at checkout, and automatic offers that apply by themselves (like "buy 2 tees, save ৳200"). An offer and a code don't add up: the one worth more applies.</p></div><div class="flex"><button class="btn btn--ghost" id="ofAdd">Create automatic offer</button><button class="btn btn--dark" id="cpAdd">Create coupon</button></div></div>
      <div class="card card--flush">${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Used</th><th>Dates</th><th>Status</th></tr></thead><tbody>${list.map((c) => `
        <tr class="is-link" data-edit="${c.id}"><td><b class="mono" style="font-size:13px">${esc(c.code)}</b>${c.auto ? ` <span class="tag">Automatic</span>` : ""}${c.owner ? ` <span class="tag">${esc(c.owner)}</span>` : ""}${c.description ? `<br><small class="muted">${esc(c.description)}</small>` : ""}</td><td>${esc(label(c))}${(c.categoryIds || []).length ? `<br><small class="muted">On ${esc(c.categoryIds.map(catName).filter(Boolean).join(", "))}</small>` : ""}</td><td>${[c.minOrder ? taka(c.minOrder) : "", c.minQty ? c.minQty + " items" : ""].filter(Boolean).join(" · ") || "—"}</td>
        <td class="num">${c.used || 0}${c.maxUses ? " / " + c.maxUses : ""}</td><td class="small">${c.startsAt ? date(c.startsAt) : "Now"} → ${c.endsAt ? date(c.endsAt) : "No end"}</td><td>${pill(state(c) === "active" ? "active" : "inactive").replace(/>[^<]*<\/span>$/, ">" + esc(human(state(c))) + "</span>")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No coupons yet.</p>`}</div>`;
    const day = (t) => t ? new Date(t - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : "";
    const edit = (c) => {
      const isNew = !c.id;
      const auto = !!c.auto;
      const body = modal(isNew ? (auto ? "Create automatic offer" : "Create coupon") : "Edit " + c.code, `<form class="stack" id="cpForm">
        <input type="hidden" name="auto" value="${auto ? "1" : ""}">
        ${auto ? `<p class="small muted" style="margin:0">Applies by itself at checkout when the bag qualifies. The bag also shows "Add 1 more to save…" to nudge people.</p>` : ""}
        <div class="row row--2"><label class="field"><span>${auto ? "Offer ID (for reports)" : "Code"}</span><input class="input" name="code" required value="${esc(c.code || "")}" placeholder="${auto ? "BUY2SAVE200" : "EID20"}" style="text-transform:uppercase"></label>
        <label class="field"><span>Type</span><select class="input" name="type"><option value="percent">Percentage off</option><option value="fixed"${c.type === "fixed" ? " selected" : ""}>Fixed amount off</option><option value="shipping"${c.type === "shipping" ? " selected" : ""}>Free delivery</option></select></label></div>
        <div class="row row--3"><label class="field" data-show="value"><span>Value</span><input class="input" name="value" type="number" min="0" value="${esc(c.value || "")}"><small data-unit></small></label>
        <label class="field"><span>Minimum order (৳)</span><input class="input" name="minOrder" type="number" min="0" value="${esc(c.minOrder || "")}"></label>
        <label class="field" data-show="max"><span>Max discount (৳)</span><input class="input" name="maxDiscount" type="number" min="0" value="${esc(c.maxDiscount || "")}"></label></div>
        <div class="row row--3"><label class="field"><span>Usage limit</span><input class="input" name="maxUses" type="number" min="0" value="${esc(c.maxUses || "")}" placeholder="Unlimited"></label>
        <label class="field"><span>Starts</span><input class="input" name="startsAt" type="date" value="${day(c.startsAt)}"></label><label class="field"><span>Ends</span><input class="input" name="endsAt" type="date" value="${day(c.endsAt)}"></label></div>
        <label class="field"><span>Description (shown at checkout${auto ? " and in the bag" : ""})</span><input class="input" name="description" value="${esc(c.description || "")}" placeholder="${auto ? "Buy 2 tees, save ৳200" : "10% off your first order"}"></label>
        <div class="row row--2"><label class="field"><span>Minimum items in the bag</span><input class="input" name="minQty" type="number" min="0" max="50" value="${esc(c.minQty || "")}" placeholder="${auto ? "2" : "Any"}"><small>Counts only the categories below, if you pick any.</small></label>
        <div class="field"><span>Only for these categories</span><div class="chips" style="max-height:120px;overflow:auto">${cats.map((x) => `<label class="chipbtn"><input type="checkbox" name="cat" value="${x.id}" ${(c.categoryIds || []).indexOf(x.id) > -1 ? "checked" : ""}> ${esc(x.name)}</label>`).join("")}</div><small>Leave all unticked for the whole bag. Includes sub-categories.</small></div></div>
        ${auto ? "" : `<div class="row row--2"><label class="field"><span>Influencer or partner (optional)</span><input class="input" name="owner" value="${esc(c.owner || "")}" placeholder="e.g. Nabila"><small>Their sales show in the report below.</small></label>
        <label class="field"><span>Their commission (%)</span><input class="input" name="commission" type="number" min="0" max="100" step="0.5" value="${esc(c.commission || "")}" placeholder="0"><small>Of each order's total, for the payout column.</small></label></div>`}
        <label class="switch"><input type="checkbox" name="active" ${c.active !== false ? "checked" : ""}> Active</label>
        <div class="modal__foot">${isNew ? "" : `<button class="btn btn--danger" type="button" id="cpDel" style="margin-right:auto">Delete</button>`}<button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save coupon</button></div></form>`);
      const sync = () => {
        const t = $("[name=type]", body).value;
        $("[data-show=value]", body).hidden = t === "shipping";
        $("[data-show=max]", body).hidden = t !== "percent";
        $("[data-unit]", body).textContent = t === "percent" ? "Percent" : "Taka";
      };
      $("[name=type]", body).onchange = sync; sync();
      $("#cpForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = formData(e.target);
        if (b.startsAt) b.startsAt = new Date(b.startsAt + "T00:00:00").getTime();
        if (b.endsAt) b.endsAt = new Date(b.endsAt + "T23:59:59").getTime();
        ["value", "minOrder", "maxDiscount", "maxUses", "minQty", "commission"].forEach((k) => { b[k] = +b[k] || 0; });
        b.auto = !!b.auto;
        b.categoryIds = $$("[name=cat]:checked", e.target).map((x) => x.value);
        delete b.cat;
        try { isNew ? await api("POST", "/api/coupons", b) : await api("PUT", "/api/coupons/" + c.id, b); closeModal(); toast("Coupon saved"); viewCoupons(); } catch (err) { fail(err); }
      };
      if (!isNew) $("#cpDel").onclick = async () => {
        if (!(await confirmBox("Delete " + c.code + "?", "Customers won't be able to use it any more.", "Delete", true))) return;
        try { await api("DELETE", "/api/coupons/" + c.id); toast("Deleted"); viewCoupons(); } catch (err) { fail(err); }
      };
    };
    $("#cpAdd").onclick = () => edit({ type: "percent", active: true });
    $("#ofAdd").onclick = () => edit({ type: "fixed", active: true, auto: true, minQty: 2 });
    // Sales per code and per influencer
    view.insertAdjacentHTML("beforeend", `<div class="card" style="margin-top:18px"><div class="card__head"><h2 class="h2">Sales by code and influencer</h2>
        <div class="flex"><select class="input" id="cpDays" style="width:auto"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option></select><button class="btn btn--ghost btn--sm" id="cpRepCsv">Export CSV</button></div></div>
      <div id="cpRep"><p class="empty">Loading…</p></div><p class="muted small" style="margin:8px 0 0">Counts orders that aren't cancelled. Returned orders are listed separately and left out of revenue and payout.</p></div>`);
    let rep = null;
    const drawRep = async () => {
      try { rep = await api("GET", "/api/coupons/report?days=" + $("#cpDays").value); } catch (err) { return fail(err); }
      $("#cpRep").innerHTML = (rep.owners.length ? `<h3 class="small mono" style="margin:6px 0">Influencers</h3><div class="table-wrap"><table class="t"><thead><tr><th>Influencer</th><th>Codes</th><th class="right">Orders</th><th class="right">Revenue</th><th class="right">Discount given</th><th class="right">Payout</th></tr></thead><tbody>${rep.owners.map((o) => `<tr><td><b>${esc(o.owner)}</b></td><td class="mono small">${esc(o.codes.join(", "))}</td><td class="num">${o.orders}</td><td class="num">${taka(o.revenue)}</td><td class="num">${taka(o.discount)}</td><td class="num"><b>${taka(o.payout)}</b></td></tr>`).join("")}</tbody></table></div>` : "") +
        (rep.codes.length ? `<h3 class="small mono" style="margin:14px 0 6px">Every code and offer</h3><div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Influencer</th><th class="right">Orders</th><th class="right">Pieces</th><th class="right">Revenue</th><th class="right">Discount</th><th class="right">Delivered</th><th class="right">Returned</th></tr></thead><tbody>${rep.codes.map((r) => `<tr><td class="mono"><b>${esc(r.code)}</b>${r.auto ? ` <span class="tag">Automatic</span>` : ""}</td><td>${esc(r.owner || "—")}</td><td class="num">${r.orders}</td><td class="num">${r.units}</td><td class="num">${taka(r.revenue)}</td><td class="num">${taka(r.discount)}</td><td class="num">${r.delivered}</td><td class="num">${r.returned}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No orders used a code or offer in this period.</p>`);
    };
    $("#cpDays").onchange = drawRep;
    $("#cpRepCsv").onclick = () => rep && download(`ravelle-coupon-sales-${$("#cpDays").value}d.csv`, csv([["Code", "Influencer", "Commission %", "Orders", "Pieces", "Revenue", "Discount", "Delivered", "Returned", "Payout"]].concat(rep.codes.map((r) => [r.code, r.owner, r.commission, r.orders, r.units, r.revenue, r.discount, r.delivered, r.returned, r.payout]))));
    drawRep();
    view.addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) edit(list.find((c) => c.id === b.dataset.edit)); });
  }

  // ---------------------------------------------------------------------------
  // Pages: visual editor (live preview in an iframe of the store)
  // ---------------------------------------------------------------------------
  const PAGES = {
    home: { title: "Home page", route: "home", sections: { hero: "Hero", tryLook: "Try the look", house: "Oversized items", poster: "Offer poster", arrivals: "Product showcase", lookbook: "Lookbook", categories: "Shop by category", footer: "Footer" } },
    about: { title: "About us", route: "about" },
    contact: { title: "Contact us", route: "contact" },
    stores: { title: "Store locations", route: "store-locations" },
    franchise: { title: "Franchise", route: "franchise" },
    terms: { title: "Terms & conditions", route: "terms" },
    privacy: { title: "Privacy policy", route: "privacy" },
    refund: { title: "Return & refund policy", route: "refund" },
    delivery: { title: "Delivery policy", route: "delivery" }
  };
  const DISTRICTS = ["Bagerhat", "Bandarban", "Barguna", "Barishal", "Bhola", "Bogura", "Brahmanbaria", "Chandpur", "Chapai Nawabganj", "Chattogram", "Chuadanga",
    "Cox's Bazar", "Cumilla", "Dhaka", "Dinajpur", "Faridpur", "Feni", "Gaibandha", "Gazipur", "Gopalganj", "Habiganj", "Jamalpur", "Jashore", "Jhalokati", "Jhenaidah",
    "Joypurhat", "Khagrachhari", "Khulna", "Kishoreganj", "Kurigram", "Kushtia", "Lakshmipur", "Lalmonirhat", "Madaripur", "Magura", "Manikganj", "Meherpur",
    "Moulvibazar", "Munshiganj", "Mymensingh", "Naogaon", "Narail", "Narayanganj", "Narsingdi", "Natore", "Netrokona", "Nilphamari", "Noakhali", "Pabna", "Panchagarh",
    "Patuakhali", "Pirojpur", "Rajbari", "Rajshahi", "Rangamati", "Rangpur", "Satkhira", "Shariatpur", "Sherpur", "Sirajganj", "Sunamganj", "Sylhet", "Tangail", "Thakurgaon"];
  // Pages with cards you can add, edit, move and remove
  const CARDS = {
    stores: { list: "shops", label: "Shops", add: "Add shop", skip: ["shops", "districtOrder"],
      help: "Each shop needs a name and a district. Mark it as a Ravelle own shop or a franchise shop; the page shows which one it is.",
      empty: "No shops. The page shows the “no shops yet” message.",
      title: (s) => s.name, sub: (s) => [s.district || "No district", s.type === "franchise" ? "Franchise" : "Ravelle own shop"].join(" · "),
      blank: () => ({ name: "", type: "own", district: "", image: "", address: "", phone: "", email: "", hours: "", map: "" }),
      fields: [["name", "Shop name", "text", "Ravelle Banani"], ["type", "Shop type", "select", [["own", "Ravelle own shop"], ["franchise", "Franchise shop"]]], ["district", "District", "district"],
        ["image", "Shop photo", "image"], ["address", "Shop address", "textarea"], ["phone", "Shop number", "text", "01XXX-XXXXXX"], ["email", "Shop email", "text", "shop@ravellebd.com"],
        ["hours", "Opening hours (optional)", "text", "Every day, 11am – 10pm"], ["map", "Google Maps link (optional)", "text", "Leave empty to search the address"]] },
    franchise: { list: "stories", label: "Franchise partner cards", add: "Add partner card", skip: ["stories", "pdf"],
      help: "Stories from franchise store owners. If you remove every card, the whole section is hidden on the page.",
      empty: "No cards. The partner section is hidden on the page.",
      title: (s) => s.ownerName, sub: (s) => s.storeName || "",
      blank: () => ({ storeName: "", storeImage: "", address: "", ownerName: "", ownerImage: "", opinion: "", experience: "" }),
      fields: [["storeName", "Store name", "text", "Ravelle GEC Circle"], ["storeImage", "Store photo", "image"], ["address", "Store address", "textarea"], ["ownerName", "Owner name", "text"],
        ["ownerImage", "Owner photo", "image"], ["opinion", "Owner's opinion (short quote)", "textarea"], ["experience", "Owner's experience", "textarea"]] }
  };
  const isImageKey = (k, v) => /(^|[a-z])(image|Image|avatars?|logo)/.test(k) || (typeof v === "string" && /\.(png|jpe?g|webp|gif|avif)(\?|$)|^data:image\//i.test(v));
  const isMdKey = (k) => k === "body" || k === "story";
  async function viewPages() {
    setTitle("Pages");
    const pages = ((await api("GET", "/api/pages").catch(fail)) || {}).pages || {};
    view.innerHTML = `<div class="head"><div><h1 class="h1">Pages</h1><p class="muted">Change the words and pictures on every page. The design stays the same, so the store always looks right.</p></div></div>
      <div class="grid-3">${Object.keys(PAGES).filter((k) => pages[k]).map((k) => `<a class="card" href="#/pages/${k}" style="text-decoration:none"><h2 class="h2">${esc(PAGES[k].title)}</h2><p class="muted small" style="margin:0">${k === "home" ? "Hero, collections, offer poster, lookbook and footer" : pages[k].updated ? "Last updated " + esc(pages[k].updated) : esc((pages[k].intro || "").slice(0, 90))}</p><span class="btn btn--ghost btn--sm" style="justify-self:start">Edit page</span></a>`).join("")}</div>
      <div class="card"><h2 class="h2">Where are the footer and header links?</h2><p class="muted" style="margin:0">Menus live in <a href="#/menus">Menus</a>. Company details, the trade license, TIN and DBID shown on About us and in the footer come from <a href="#/settings">Settings</a>.</p></div>`;
  }
  async function viewPageEditor(key) {
    const meta = PAGES[key];
    if (!meta) return notFound();
    setTitle("Edit " + meta.title);
    let page;
    try { page = (await api("GET", "/api/pages/" + key)).page; } catch (err) { return fail(err); }
    let draft = clone(page), dirty = false;
    const demo = window.Ravelle.mode === "demo";
    view.innerHTML = `<div class="pe">
      <aside class="pe__side"><div class="flex flex--between"><a class="btn btn--link" href="#/pages">← Pages</a><button class="btn btn--dark btn--sm" id="peSave" disabled>Saved</button></div>
        <div><h1 class="h1" style="font-size:22px">${esc(meta.title)}</h1><p class="muted small">Click any text in the preview to type over it, or click a picture to change it. Changes show live; press Save to publish.</p></div>
        <div class="stack" id="peForm"></div></aside>
      <div class="pe__preview"><div class="pe__bar"><span class="small muted">Live preview</span><div class="tabs" id="peSize"><button class="tab is-on" data-s="desk">Desktop</button><button class="tab" data-s="mob">Mobile</button></div>
        <a class="btn btn--ghost btn--sm" href="./#${meta.route}" target="_blank" rel="noopener">Open page ↗</a></div>
        <div class="pe__frame" id="peFrame"><iframe id="peIframe" title="Page preview" src="./?edit${demo ? "&demo" : ""}#${meta.route}"></iframe></div></div></div>`;
    const frame = $("#peIframe");
    const post = (focus) => { try { frame.contentWindow.postMessage({ type: "ravelle:page", key, page: draft, focus }, "*"); } catch (e) {} };
    const setDirty = () => { dirty = true; $("#peSave").disabled = false; $("#peSave").textContent = "Save changes"; };
    const setPath = (path, value) => {
      const parts = path.split(".");
      let o = draft;
      parts.slice(0, -1).forEach((k) => { o = o[k]; });
      o[parts[parts.length - 1]] = value;
    };
    // Build the form from the page's own shape
    const fieldFor = (k, v, path) => {
      const label = human(k);
      if (isImageKey(k, v)) return imgField(path, v, label);
      if (isMdKey(k)) return `<label class="field" data-path="${esc(path)}"><span>${label}</span><textarea class="input input--md" data-p="${esc(path)}">${esc(v)}</textarea><small>## Heading · - list item · 1. step · **bold** · [link text](#contact)</small></label>`;
      const long = v.length > 60 || v.indexOf("\n") > -1;
      const linkHint = /link$/i.test(k) ? `<small>A page link like #shop, #category/men, #about, or a full https:// address.</small>`
        : k === "category" ? `<small>Category: ${esc(((store && store.categories) || []).map((c) => c.slug).join(", "))}, or top-selling. Join several with commas.</small>` : "";
      return `<label class="field" data-path="${esc(path)}"><span>${label}</span>${long ? `<textarea class="input" data-p="${esc(path)}" rows="${Math.min(6, Math.max(2, v.split("\n").length + 1))}">${esc(v)}</textarea>` : `<input class="input" data-p="${esc(path)}" value="${esc(v)}" ${/link$/i.test(k) ? 'list="peLinks"' : ""}>`}${linkHint}</label>`;
    };
    const build = (obj, path, depth) => Object.keys(obj).map((k) => {
      const v = obj[k], p = path ? path + "." + k : k;
      if (!path && CARDS[key] && CARDS[key].skip.indexOf(k) > -1) return "";
      if (typeof v === "string") return fieldFor(k, v, p);
      if (Array.isArray(v)) {
        return `<details class="group"${depth ? "" : " open"}><summary>${human(k)}</summary><div class="group__body">${v.map((item, i) =>
          typeof item === "string" ? fieldFor(k.replace(/s$/, "") + " " + (i + 1), item, p + "." + i).replace(/<span>[^<]*<\/span>/, `<span>${human(k).replace(/s$/, "")} ${i + 1}</span>`)
            : `<details class="group"><summary>${human(k).replace(/s$/, "")} ${i + 1}${item.title || item.name || item.label ? ": " + esc(String(item.title || item.name || item.label).split("\n")[0]) : ""}</summary><div class="group__body">${build(item, p + "." + i, depth + 2)}</div></details>`).join("")}</div></details>`;
      }
      if (v && typeof v === "object") return `<details class="group"${depth === 0 && key !== "home" ? " open" : ""} data-group="${esc(p)}"><summary>${esc((meta.sections && meta.sections[k]) || human(k))}</summary><div class="group__body">${build(v, p, depth + 1)}</div></details>`;
      return "";
    }).join("");
    $("#peForm").innerHTML = build(draft, "", 0) + `<div class="stack" id="peCards"></div><datalist id="peLinks">${["#shop", "#new-in", "#on-sale", "#about", "#contact", "#track", "#lookbook", "#arrivals"].concat(((store && store.categories) || []).map((c) => "#category/" + c.slug)).map((u) => `<option value="${esc(u)}">`).join("")}</datalist>`;
    // opening a section scrolls it into view, so its fields are not hidden below the fold
    if (!$("#peForm")._tog && ($("#peForm")._tog = true)) $("#peForm").addEventListener("toggle", (e) => { if (e.target.open) setTimeout(() => e.target.scrollIntoView({ block: "start", behavior: "smooth" }), 40); }, true);
    $("#peForm").addEventListener("input", (e) => {
      const el = e.target.closest("[data-p]");
      if (!el) return;
      setPath(el.dataset.p, el.value);
      setDirty();
      post();
    });
    wireImgFields($("#peForm"), (path, u) => { setPath(path, u); setDirty(); post(path); });
    // Card lists (shops, franchise partners): add, edit, move and remove cards
    const spec = CARDS[key];
    const drawCards = (openId) => {
      const box = $("#peCards");
      if (!spec || !box) return;
      const list = draft[spec.list] = draft[spec.list] || [];
      const fieldHtml = (item, i, f) => {
        const [k, label, type, extra] = f, p = spec.list + "." + i + "." + k, v = item[k] || "";
        if (type === "image") return imgField(p, v, label, extra || "");
        if (type === "select") return `<label class="field"><span>${label}</span><select class="input" data-cp="${p}">${extra.map(([val, l]) => `<option value="${val}"${v === val ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
        if (type === "district") return `<label class="field"><span>${label} <b style="color:var(--danger)">*</b></span><select class="input" data-cp="${p}" required><option value="">Choose a district</option>${DISTRICTS.map((x) => `<option${v === x ? " selected" : ""}>${esc(x)}</option>`).join("")}</select><small>Shops are grouped and sorted by district.</small></label>`;
        if (type === "textarea") return `<label class="field"><span>${label}</span><textarea class="input" rows="3" data-cp="${p}">${esc(v)}</textarea></label>`;
        return `<label class="field"><span>${label}</span><input class="input" data-cp="${p}" value="${esc(v)}" ${extra ? `placeholder="${esc(extra)}"` : ""}></label>`;
      };
      let html = `<details class="group" open><summary>${esc(spec.label)} (${list.length})</summary><div class="group__body">
        <p class="muted small" style="margin:0">${spec.help}</p>
        ${list.map((item, i) => `<details class="group pe-card"${item.id === openId ? " open" : ""}><summary><span class="pe-card__title">${esc(spec.title(item) || "New card")}</span><small class="muted">${esc(spec.sub(item))}</small></summary>
          <div class="group__body">${spec.fields.map((f) => fieldHtml(item, i, f)).join("")}
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" data-cact="up" data-i="${i}" ${i ? "" : "disabled"}>↑ Move up</button><button class="btn btn--ghost btn--sm" type="button" data-cact="down" data-i="${i}" ${i < list.length - 1 ? "" : "disabled"}>↓ Move down</button>
          <button class="btn btn--danger btn--sm" type="button" data-cact="del" data-i="${i}" style="margin-left:auto">Remove card</button></div></div></details>`).join("") || `<p class="muted small" style="margin:0">${spec.empty}</p>`}
        <button class="btn btn--dark btn--sm" type="button" data-cact="add" style="justify-self:start">+ ${esc(spec.add)}</button></div></details>`;
      if (key === "stores") {
        const order = (draft.districtOrder || []).slice();
        list.forEach((s) => { if (s.district && order.indexOf(s.district) < 0) order.push(s.district); });
        draft.districtOrder = order.filter((d, i) => order.indexOf(d) === i && list.some((s) => s.district === d));
        html += `<details class="group" open><summary>District order</summary><div class="group__body"><p class="muted small" style="margin:0">The district at the top shows first on the page.</p>
          ${draft.districtOrder.map((d, i) => `<div class="pe-dist"><span class="mono muted">${i + 1}</span><b>${esc(d)}</b><small class="muted">${list.filter((s) => s.district === d).length} shop(s)</small>
            <button class="icon" type="button" data-dact="up" data-i="${i}" ${i ? "" : "disabled"} aria-label="Move up">↑</button><button class="icon" type="button" data-dact="down" data-i="${i}" ${i < draft.districtOrder.length - 1 ? "" : "disabled"} aria-label="Move down">↓</button></div>`).join("") || `<p class="muted small" style="margin:0">Add a shop and choose its district first.</p>`}</div></details>`;
      }
      if (key === "franchise") {
        html += `<details class="group" open><summary>Franchise guide PDF</summary><div class="group__body">
          <p class="small" style="margin:0">${draft.pdf ? `✓ A PDF is attached. <a href="${esc(draft.pdf)}" target="_blank" rel="noopener">Open it</a>` : `<span class="muted">No PDF yet. The page shows “PDF coming soon”.</span>`}</p>
          <div class="flex"><label class="btn btn--ghost btn--sm" style="cursor:pointer">${draft.pdf ? "Replace PDF" : "Upload PDF"}<input type="file" accept="application/pdf" id="pePdf" hidden></label>
          ${draft.pdf ? `<button class="btn btn--ghost btn--sm" type="button" id="pePdfDel">Remove PDF</button>` : ""}</div><small class="muted">Up to 10 MB.${demo ? " In this demo keep it under 3 MB." : ""}</small></div></details>`;
      }
      box.innerHTML = html;
      wireImgFields(box, (path, u) => { setPath(path, u); setDirty(); post(); });
      if ($("#pePdf")) $("#pePdf").onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.type !== "application/pdf") return toast("Choose a PDF file.", true);
        if (file.size > (demo ? 3 : 10) * 1048576) return toast("That PDF is too big.", true);
        const fr = new FileReader();
        fr.onload = async () => {
          try {
            const url = demo ? fr.result : (await api("POST", "/api/files", { name: file.name, dataUrl: fr.result })).url;
            draft.pdf = url; setDirty(); post(); drawCards(); toast("PDF attached. Press Save to publish.");
          } catch (err) { fail(err); }
        };
        fr.readAsDataURL(file);
      };
      if ($("#pePdfDel")) $("#pePdfDel").onclick = () => { draft.pdf = ""; setDirty(); post(); drawCards(); };
    };
    if (spec) {
      $("#peCards").addEventListener("input", (e) => {
        const el = e.target.closest("[data-cp]");
        if (!el) return;
        setPath(el.dataset.cp, el.value); setDirty(); post();
        const det = el.closest(".pe-card"), i = +el.dataset.cp.split(".")[1], item = draft[spec.list][i];
        if (det) { $(".pe-card__title", det).textContent = spec.title(item) || "New card"; $("summary small", det).textContent = spec.sub(item); }
        if (el.tagName === "SELECT" && key === "stores") drawCards(item.id);
      });
      $("#peCards").addEventListener("click", async (e) => {
        const b = e.target.closest("[data-cact], [data-dact]");
        if (!b) return;
        const list = draft[spec.list], i = +b.dataset.i;
        if (b.dataset.dact) {
          const o = draft.districtOrder, j = b.dataset.dact === "up" ? i - 1 : i + 1;
          [o[i], o[j]] = [o[j], o[i]];
        } else if (b.dataset.cact === "add") {
          const item = Object.assign({ id: (key === "stores" ? "shp_" : "fst_") + Math.random().toString(36).slice(2, 8) }, spec.blank());
          list.push(item); setDirty(); post(); return drawCards(item.id);
        } else if (b.dataset.cact === "del") {
          if (!(await confirmBox("Remove this card?", (spec.title(list[i]) || "This card") + " will be removed from the page when you save.", "Remove", true))) return;
          list.splice(i, 1);
        } else {
          const j = b.dataset.cact === "up" ? i - 1 : i + 1;
          [list[i], list[j]] = [list[j], list[i]];
          setDirty(); post(); return drawCards(list[j].id);
        }
        setDirty(); post(); drawCards();
      });
      drawCards();
    }

    const onMsg = (e) => {
      const m = e.data || {};
      if (e.source !== frame.contentWindow) return;
      if (m.type === "ravelle:edit" && (m.key === key || (!m.key && key === "home"))) {
        setPath(m.path, m.value);
        const inp = $(`[data-p="${CSS.escape(m.path)}"]`, $("#peForm"));
        if (inp) inp.value = m.value;
        setDirty();
      } else if (m.type === "ravelle:focus" && (m.key === key || (!m.key && key === "home"))) {
        const f = $(`[data-path="${CSS.escape(m.path)}"], [data-imgfield="${CSS.escape(m.path)}"]`, $("#peForm"));
        if (!f) return;
        let d = f.closest("details");
        while (d) { d.open = true; d = d.parentElement.closest("details"); }
        f.scrollIntoView({ block: "center", behavior: "smooth" });
        f.classList.remove("is-flash"); void f.offsetWidth; f.classList.add("is-flash");
        if (m.kind === "image" && f._set) $("[data-pick]", f).click();
      }
    };
    window.addEventListener("message", onMsg);
    frame.addEventListener("load", () => setTimeout(() => post(), 600));
    $("#peSize").onclick = (e) => {
      const b = e.target.closest("[data-s]");
      if (!b) return;
      $$("#peSize .tab").forEach((x) => x.classList.toggle("is-on", x === b));
      $("#peFrame").classList.toggle("is-mobile", b.dataset.s === "mob");
    };
    $("#peSave").onclick = async () => {
      const btn = $("#peSave");
      busy(btn, true);
      try { await api("PUT", "/api/pages/" + key, { page: draft }); dirty = false; btn.textContent = "Saved"; toast("Page published"); }
      catch (err) { fail(err); btn.disabled = false; return; }
    };
    leaveGuard = () => !dirty || confirm("You have unsaved changes on this page. Leave without saving?");
    cleanup = () => window.removeEventListener("message", onMsg);
  }

  // ---------------------------------------------------------------------------
  // Menus: header (with dropdowns) and footer columns
  // ---------------------------------------------------------------------------
  async function viewMenus() {
    setTitle("Menus");
    await loadStore(true);
    let menus = clone(((await api("GET", "/api/menus").catch(fail)) || {}).menus || { header: [], footer: [] });
    let dirty = false;
    const links = [["Shop", [["All products", "#shop"], ["New in", "#new-in"], ["On sale", "#on-sale"], ["Search", "#search"]]],
      ["Categories", catTree(store.categories).map(({ c, depth }) => ["— ".repeat(depth) + c.name, "#category/" + c.slug])],
      ["Pages", [["Home", "#home"], ["About us", "#about"], ["Contact us", "#contact"], ["Store locations", "#store-locations"], ["Franchise", "#franchise"], ["Track order", "#track"], ["Saved items", "#saved"], ["Terms & conditions", "#terms"], ["Privacy policy", "#privacy"], ["Return & refund policy", "#refund"], ["Delivery policy", "#delivery"]]]];
    const linkSelect = `<select class="input input--sm" data-pick-link><option value="">Link to…</option>${links.map(([g, l]) => `<optgroup label="${g}">${l.map(([n, u]) => `<option value="${esc(u)}" data-label="${esc(n.replace(/^(— )+/, ""))}">${esc(n)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Menus</h1><p class="muted">The header menu (with dropdowns) and the footer columns. Link to categories, sub-categories, pages or any web address.</p></div><button class="btn btn--dark" id="mnSave" disabled>Saved</button></div>
      <div class="cols cols--even"><div class="card"><div class="card__head"><h2 class="h2">Header menu</h2><button class="btn btn--ghost btn--sm" data-add="header">+ Add link</button></div><p class="muted small" style="margin:0">On desktop all links sit left of the logo. A link with dropdown links opens a panel: the links in columns (six per column unless you change it), then its photo on the right. On phones everything is in the menu button.</p><div class="stack stack--sm" id="mnHeader"></div></div>
        <div class="card"><div class="card__head"><h2 class="h2">Footer columns</h2><button class="btn btn--ghost btn--sm" data-add-col>+ Add column</button></div><div class="stack" id="mnFooter"></div></div></div>`;
    const setDirty = () => { dirty = true; $("#mnSave").disabled = false; $("#mnSave").textContent = "Save menus"; };
    const row = (it, path, canNest) => `<div><div class="menu-item" data-path="${path}"><input class="input input--sm" data-f="label" value="${esc(it.label)}" placeholder="Label">
      <div class="flex" style="flex-wrap:nowrap"><input class="input input--sm grow" data-f="url" value="${esc(it.url)}" placeholder="#shop or https://…">${linkSelect}</div>
      <div class="menu-tools"><button class="icon" type="button" data-act="up" aria-label="Move up">↑</button><button class="icon" type="button" data-act="down" aria-label="Move down">↓</button>${canNest ? `<button class="icon" type="button" data-act="child" title="Add dropdown link">+</button>` : ""}<button class="icon" type="button" data-act="del" aria-label="Remove">✕</button></div>
      ${path.indexOf("header.") === 0 ? `<div class="menu-photo"><span class="menu-photo__frame">${it.image ? `<img src="${esc(it.image)}" alt="" data-measure>` : ""}</span>
        <div><b class="small">${canNest ? "Dropdown photo" : "Photo on hover (optional)"}</b><br><small class="muted">Upload <b>440 × 550 px</b> (4:5). It shows in a 220 × 275 frame${canNest ? " on the right of this link's dropdown" : " in place of the dropdown photo while this link is hovered"}.</small><br>
        <small class="menu-photo__size" data-size></small>
        ${canNest ? `<label class="flex small" style="margin-top:6px;gap:8px;align-items:center">Links per column <select class="input input--sm" data-f="perColumn" style="width:auto">${Array.from({ length: 12 }, (_, k) => k + 1).map((n) => `<option value="${n}"${(+it.perColumn || 6) === n ? " selected" : ""}>${n}${n === 6 ? " (default)" : ""}</option>`).join("")}</select></label>` : ""}
        <div class="flex" style="margin-top:6px"><button class="btn btn--ghost btn--sm" type="button" data-act="img">${it.image ? "Change photo" : "Choose photo"}</button>${it.image ? `<button class="btn btn--ghost btn--sm" type="button" data-act="noimg">Remove</button>` : ""}</div></div></div>` : ""}</div>
      ${canNest && it.children && it.children.length ? `<div class="menu-kids">${it.children.map((c, j) => row(c, path + ".children." + j, false)).join("")}</div>` : ""}</div>`;
    const draw = () => {
      $("#mnHeader").innerHTML = menus.header.map((it, i) => row(it, "header." + i, true)).join("") || `<p class="muted">No links.</p>`;
      // show each photo's real size, so a wrong size is easy to spot
      $$("#mnHeader img[data-measure]").forEach((im) => {
        const show = () => {
          const out = $("[data-size]", im.closest(".menu-photo")), w = im.naturalWidth, h = im.naturalHeight;
          if (!w) return;
          const ok = Math.abs(w / h - 0.8) < 0.02 && w >= 440;
          out.innerHTML = `This photo: ${w} × ${h} px ${ok ? "· good fit" : `· <span style="color:#b3261e">${Math.abs(w / h - 0.8) >= 0.02 ? "not 4:5, the edges will be cropped" : "smaller than 440 × 550, may look soft"}</span>`}`;
        };
        if (im.complete) show(); else im.onload = show;
      });
      $("#mnFooter").innerHTML = menus.footer.map((col, ci) => `<div class="attr"><div class="flex"><input class="input input--sm grow" data-col="${ci}" value="${esc(col.title)}" placeholder="Column title"><button class="btn btn--ghost btn--sm" data-add="footer.${ci}.items">+ Link</button><button class="icon" data-del-col="${ci}" aria-label="Remove column">✕</button></div>
        <div class="stack stack--sm">${col.items.map((it, i) => row(it, "footer." + ci + ".items." + i, false)).join("")}</div></div>`).join("");
    };
    const get = (path) => path.split(".").reduce((o, k) => o[k], menus);
    const parentOf = (path) => { const p = path.split("."); const i = +p.pop(); return { list: get(p.join(".")), i }; };
    view.addEventListener("input", (e) => {
      const r = e.target.closest(".menu-item");
      if (r && e.target.dataset.f) { get(r.dataset.path)[e.target.dataset.f] = e.target.value; setDirty(); }
      if (e.target.dataset.col != null) { menus.footer[+e.target.dataset.col].title = e.target.value; setDirty(); }
    });
    view.addEventListener("change", (e) => {
      if (e.target.dataset.f === "perColumn") { get(e.target.closest(".menu-item").dataset.path).perColumn = +e.target.value; setDirty(); return; }
      const sel = e.target.closest("[data-pick-link]");
      if (!sel || !sel.value) return;
      const r = sel.closest(".menu-item"), it = get(r.dataset.path), opt = sel.selectedOptions[0];
      it.url = sel.value;
      if (!it.label) it.label = opt.dataset.label;
      setDirty(); draw();
    });
    view.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]"), act = e.target.closest("[data-act]");
      if (add) { get(add.dataset.add).push({ label: "", url: "", children: [] }); setDirty(); draw(); }
      if (e.target.closest("[data-add-col]")) { menus.footer.push({ title: "New column", items: [] }); setDirty(); draw(); }
      const dc = e.target.closest("[data-del-col]");
      if (dc) { menus.footer.splice(+dc.dataset.delCol, 1); setDirty(); draw(); }
      if (act) {
        const path = act.closest(".menu-item").dataset.path, { list, i } = parentOf(path);
        if (act.dataset.act === "del") list.splice(i, 1);
        if (act.dataset.act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
        if (act.dataset.act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
        if (act.dataset.act === "child") { const it = list[i]; it.children = it.children || []; it.children.push({ label: "", url: "", children: [] }); }
        if (act.dataset.act === "img") { pickMedia({ title: "Menu photo (440 × 550 px)" }).then((u) => { if (u) { list[i].image = u[0]; setDirty(); draw(); } }); return; }
        if (act.dataset.act === "noimg") delete list[i].image;
        setDirty(); draw();
      }
    });
    $("#mnSave").onclick = async () => {
      try { menus = (await api("PUT", "/api/menus", { menus })).menus; dirty = false; $("#mnSave").disabled = true; $("#mnSave").textContent = "Saved"; toast("Menus saved"); draw(); } catch (err) { fail(err); }
    };
    leaveGuard = () => !dirty || confirm("You have unsaved menu changes. Leave without saving?");
    draw();
  }

  // ---------------------------------------------------------------------------
  // Media library
  // ---------------------------------------------------------------------------
  async function viewMedia() {
    setTitle("Media library");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Media library</h1><p class="muted">Every image you upload, ready to use on products, categories and pages.</p></div></div>${DROP_HTML}<div class="media-grid" id="mdGrid"><p class="muted">Loading…</p></div>`;
    let items = [];
    const draw = () => {
      $("#mdGrid").innerHTML = items.length ? items.map((m) => `<button class="media" type="button" data-id="${m.id}"><img src="${esc(m.url)}" alt="${esc(m.alt || "")}" loading="lazy"><span>${esc(m.name)}</span></button>`).join("") : `<p class="muted">No images yet.</p>`;
    };
    const load = async () => { try { items = (await api("GET", "/api/media")).media; draw(); } catch (err) { fail(err); } };
    dropzone($(".drop", view), async (files) => { await uploadFiles(files); load(); });
    $("#mdGrid").onclick = (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      const m = items.find((x) => x.id === b.dataset.id);
      const abs = new URL(m.url, location.href).href;
      const body = modal(m.name, `<img src="${esc(m.url)}" alt="" style="max-height:50vh;width:auto;margin:auto;border-radius:10px">
        <dl class="kv"><dt>Size</dt><dd>${m.width ? m.width + " × " + m.height + " px · " : ""}${m.size ? Math.round(m.size / 1024) + " KB" : ""}</dd><dt>Uploaded</dt><dd>${dateTime(m.createdAt)}</dd><dt>Address</dt><dd><span class="code">${esc(m.url.length > 120 ? m.url.slice(0, 60) + "…" : abs)}</span></dd></dl>
        <form class="stack" id="mdForm"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(m.name)}"></label><label class="field"><span>Alt text</span><input class="input" name="alt" value="${esc(m.alt || "")}" placeholder="Describe the picture for screen readers and Google"></label>
        <div class="modal__foot"><button class="btn btn--danger" type="button" id="mdDel" style="margin-right:auto">Delete</button><button class="btn btn--ghost" type="button" id="mdCopy">Copy address</button><button class="btn btn--dark" type="submit">Save</button></div></form>`);
      $("#mdCopy", body).onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(abs) : Promise.reject()).then(() => toast("Address copied"), () => toast("Couldn't copy", true)); };
      $("#mdForm", body).onsubmit = async (ev) => { ev.preventDefault(); try { await api("PATCH", "/api/media/" + m.id, formData(ev.target)); closeModal(); toast("Saved"); load(); } catch (err) { fail(err); } };
      $("#mdDel", body).onclick = async () => {
        const used = ((await api("GET", "/api/media/" + m.id + "/usage").catch(() => null)) || {}).usedIn || [];
        const msg = used.length
          ? `<b style="color:var(--danger)">This image is still in use</b> in ${used.length} place${used.length > 1 ? "s" : ""}:<ul style="margin:8px 0;padding-left:18px">${used.slice(0, 8).map((u) => `<li>${esc(u)}</li>`).join("")}${used.length > 8 ? `<li>…and ${used.length - 8} more</li>` : ""}</ul>Those spots will show an empty space until you pick another image. It stays in Trash for 30 days if you change your mind.`
          : "It isn't used on any product or page. It stays in Trash for 30 days if you change your mind.";
        if (!(await confirmBox(used.length ? "Delete an image that's in use?" : "Delete this image?", { html: msg }, used.length ? "Delete anyway" : "Move to Trash", true))) return;
        try { await api("DELETE", "/api/media/" + m.id); toast("Moved to Trash"); load(); } catch (err) { fail(err); }
      };
    };
    load();
  }

  // ---------------------------------------------------------------------------
  // Live chat inbox
  // ---------------------------------------------------------------------------
  async function viewChat(id) {
    setTitle("Live chat");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Live chat</h1><p class="muted">Conversations from the chat bubble on the store. Your AI reply software can read and answer these through the API (see <a href="#/integrations">Integrations</a>).</p></div>
      <div class="tabs" id="chTabs"><button class="tab is-on" data-s="open">Open</button><button class="tab" data-s="closed">Closed</button><button class="tab" data-s="">All</button></div></div>
      <div class="card card--flush"><div class="inbox"><div class="inbox__list" id="chList"></div><div class="inbox__conv" id="chConv"><p class="empty">Pick a conversation.</p></div></div></div>`;
    let status = "open", list = [], current = id || null, timer = null, alive = true, stamp = 0, shown = null;
    const bubbles = (c) => c.messages.map((m) => `<div class="bubble${m.from === "customer" ? "" : " bubble--out"}${m.from === "bot" ? " bubble--bot" : ""}">${m.image ? `<a href="${esc(m.image)}" target="_blank" rel="noopener"><img src="${esc(m.image)}" alt="Photo from the customer" style="display:block;max-width:220px;max-height:260px;border-radius:10px;margin-bottom:4px"></a>` : ""}${m.text ? `<p>${esc(m.text)}</p>` : ""}<small>${m.from === "customer" ? esc(c.name || "Visitor") : esc(m.author || (m.from === "bot" ? "Bot" : "Team"))}${m.from === "bot" ? " · auto" : ""} · ${dateTime(m.at)}</small></div>`).join("");
    const loadList = async () => {
      try { list = (await api("GET", "/api/chats" + (status ? "?status=" + status : ""))).chats; } catch (err) { return; }
      if (!alive) return;
      list.forEach((c) => { stamp = Math.max(stamp, c.updatedAt); });
      $("#chList").innerHTML = list.map((c) => `<button class="inbox__item${c.id === current ? " is-on" : ""}" data-id="${c.id}"><b><span>${esc(c.name || "Visitor")}</span>${c.unread ? `<span class="side__count">${c.unread}</span>` : `<small>${ago(c.updatedAt)}</small>`}</b><small>${c.lastMessage ? (c.lastMessage.from === "customer" ? "" : "You: ") + esc(c.lastMessage.text) : "No messages"}</small></button>`).join("") || `<p class="empty">No ${status} chats.</p>`;
    };
    // Opening a chat draws all of it; later updates only redraw the messages, so a reply being typed,
    // the cursor and the scroll position stay as they are
    const loadConv = async () => {
      if (!current) return;
      let c;
      const hadUnread = (list.find((x) => x.id === current) || {}).unread;
      try { c = (await api("GET", "/api/chats/" + current + "?markRead=1")).chat; } catch (err) { current = null; return; }
      if (!alive) return;
      const box = $("#chConv");
      const msgs = $("#chMsgs");
      if (shown && shown.id === c.id && msgs) {
        if (shown.updatedAt === c.updatedAt && shown.count === c.messages.length) return;
        const atEnd = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
        msgs.innerHTML = bubbles(c);
        $("#chPill").innerHTML = pill(c.status);
        $("#chToggle").textContent = c.status === "open" ? "Close chat" : "Reopen";
        if (atEnd) msgs.scrollTop = msgs.scrollHeight;
      } else {
        box.innerHTML = `<div class="inbox__head"><div><b>${esc(c.name || "Visitor")}</b> <span id="chPill">${pill(c.status)}</span><br><small class="muted">Started ${dateTime(c.createdAt)}${c.page ? " on " + esc(c.page) : ""} · ID <span class="mono">${esc(c.id)}</span></small></div>
          <button class="btn btn--ghost btn--sm" id="chToggle">${c.status === "open" ? "Close chat" : "Reopen"}</button></div>
          <div class="inbox__msgs" id="chMsgs">${bubbles(c)}</div>
          <form class="inbox__form" id="chForm"><textarea class="input grow" id="chText" rows="2" placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)"></textarea><button class="btn btn--dark" type="submit">Send</button></form>`;
        const m = $("#chMsgs");
        m.scrollTop = m.scrollHeight;
        $("#chText").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chForm").requestSubmit(); } };
        $("#chForm").onsubmit = async (e) => {
          e.preventDefault();
          const text = $("#chText").value.trim();
          if (!text) return;
          $("#chText").value = "";
          try { await api("POST", "/api/chats/" + current + "/messages", { text }); await loadConv(); const mm = $("#chMsgs"); if (mm) mm.scrollTop = mm.scrollHeight; loadList(); } catch (err) { fail(err); $("#chText").value = text; }
        };
      }
      $("#chToggle").onclick = async () => { await api("PATCH", "/api/chats/" + c.id, { status: c.status === "open" ? "closed" : "open" }).catch(fail); loadList(); loadConv(); };
      shown = { id: c.id, updatedAt: c.updatedAt, count: c.messages.length };
      if (hadUnread) refreshCounts(); // the side menu badge only changes when unread messages were just read
    };
    $("#chTabs").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; status = b.dataset.s; $$("#chTabs .tab").forEach((x) => x.classList.toggle("is-on", x === b)); loadList(); };
    $("#chList").onclick = (e) => { const b = e.target.closest("[data-id]"); if (!b) return; current = b.dataset.id; history.replaceState(null, "", PATHS ? "/admin/chat/" + current : "#/chat/" + current); loadList(); loadConv(); };
    await loadList();
    if (!current && list[0]) current = list[0].id;
    loadConv();
    // Waits for changes instead of reloading everything every few seconds: the server answers as soon as any chat
    // changes (or after 25 s with nothing), and only then are the list and the open chat fetched again.
    // Nothing is checked while the admin tab is in the background.
    const watch = async () => {
      if (!alive) return;
      if (document.hidden) { timer = setTimeout(watch, 2000); return; }
      const t0 = Date.now();
      let changed;
      try { changed = (await api("GET", "/api/chats?since=" + stamp + "&wait=1")).chats; } catch (err) { if (alive) timer = setTimeout(watch, 8000); return; }
      if (!alive) return;
      if (changed.length) {
        changed.forEach((c) => { stamp = Math.max(stamp, c.updatedAt); });
        if (changed.some((c) => c.id === current)) await loadConv(); // first, so the open chat is already read in the list
        await loadList();
        if (changed.some((c) => c.unread)) refreshCounts();
      }
      // an answer after a wait (or with news) means the server holds requests: ask again at once; otherwise wait 4 s
      timer = setTimeout(watch, changed.length || Date.now() - t0 > 1500 ? 200 : 4000);
    };
    watch();
    cleanup = () => { alive = false; clearTimeout(timer); };
  }

  // Contact form messages
  async function viewMessages() {
    setTitle("Messages");
    const list = ((await api("GET", "/api/messages").catch(fail)) || {}).messages || [];
    view.innerHTML = `<div class="head"><div><h1 class="h1">Messages</h1><p class="muted">From the contact form and drop-alert sign-ups.</p></div><button class="btn btn--ghost" id="msCsv">Export CSV</button></div>
      <div class="stack">${list.map((m) => `<div class="card" style="${m.read ? "" : "box-shadow:inset 3px 0 0 var(--accent)"}"><div class="card__head"><div><b>${esc(m.subject || "Message")}</b><br><small class="muted">${esc(m.name)}${m.email ? " · " + esc(m.email) : ""}${m.phone ? " · " + esc(m.phone) : ""} · ${dateTime(m.createdAt)}</small></div>
        <div class="flex">${m.email ? `<a class="btn btn--ghost btn--sm" href="mailto:${esc(m.email)}?subject=${encodeURIComponent("Re: " + (m.subject || "Your message to Ravelle"))}">Reply by email</a>` : ""}${m.phone ? `<a class="btn btn--ghost btn--sm" href="tel:${esc(m.phone)}">Call</a>` : ""}
        <button class="btn btn--ghost btn--sm" data-read="${m.id}" data-v="${m.read ? 0 : 1}">${m.read ? "Mark unread" : "Mark read"}</button><button class="btn btn--danger btn--sm" data-del="${m.id}">Delete</button></div></div><p style="margin:0;white-space:pre-wrap">${esc(m.message)}</p></div>`).join("") || `<div class="card"><p class="empty">No messages yet.</p></div>`}</div>`;
    view.onclick = async (e) => {
      const r = e.target.closest("[data-read]"), d = e.target.closest("[data-del]");
      if (r) { await api("PATCH", "/api/messages/" + r.dataset.read, { read: r.dataset.v === "1" }).catch(fail); refreshCounts(); viewMessages(); }
      if (d && (await confirmBox("Delete this message?", "This can't be undone.", "Delete", true))) { await api("DELETE", "/api/messages/" + d.dataset.del).catch(fail); refreshCounts(); viewMessages(); }
    };
    $("#msCsv").onclick = () => download("ravelle-messages.csv", csv([["Date", "Name", "Email", "Phone", "Subject", "Message"]].concat(list.map((m) => [new Date(m.createdAt).toISOString(), m.name, m.email, m.phone, m.subject, m.message]))));
  }

  // ---------------------------------------------------------------------------
  // Abandoned carts: checkouts that stopped before the order was placed
  // ---------------------------------------------------------------------------
  async function viewCarts() {
    setTitle("Abandoned carts");
    let r;
    try { r = await api("GET", "/api/carts"); } catch (err) { return fail(err); }
    let tab = "open";
    const cs = r.settings;
    const remState = (x) => {
      const auto = (n) => x.reminders.find((m) => m.auto && m.n === n);
      const cell = (n, label) => { const m = auto(n); return `<span class="cart-rem${m ? (m.ok === false ? " is-bad" : " is-ok") : ""}" title="${esc(m ? m.status + " · " + dateTime(m.at) : x.customer.email ? "Not sent yet" : "No email")}">${m ? (m.ok === false ? "✕" : "✓") : "○"} ${label}</span>`; };
      return x.customer.email ? cell(1, cs.delay1 + " min") + cell(2, cs.delay2 + " h") : `<small class="muted">No email · call or WhatsApp</small>`;
    };
    const statusPill = (x) => x.status === "open" ? (x.abandoned ? `<span class="pill pill--pending">Abandoned</span>` : `<span class="pill pill--confirmed">At checkout now</span>`)
      : x.status === "recovered" ? `<span class="pill pill--delivered">Recovered · ${esc(x.orderNumber)}</span>` : x.status === "ordered" ? `<span class="pill pill--paid">Ordered · ${esc(x.orderNumber)}</span>` : `<span class="pill pill--draft">Dismissed</span>`;
    const draw = () => {
      const list = r.carts.filter((x) => tab === "all" || (tab === "open" ? x.status === "open" : x.status === tab));
      view.innerHTML = `<div class="head"><div><h1 class="h1">Abandoned carts</h1><p class="muted">People who typed their phone or email at checkout but didn't place the order. Reminder emails go out ${cs.delay1} minutes and ${cs.delay2} hours later${cs.enabled ? "" : " (reminders are off)"}.</p></div>
          <div class="flex"><a class="btn btn--ghost" href="#/email">Reminder settings</a><button class="btn btn--ghost" id="caCsv">Export CSV</button></div></div>
        ${r.emailReady ? "" : `<div class="card" style="background:var(--warn-bg)"><p class="small" style="margin:0">Reminder emails can't go out yet. ${window.Ravelle.mode === "demo" ? "The demo has no email server; on the live store, " : ""}connect your company Gmail in <a href="#/email">Email & reminders</a>. You can still call or WhatsApp people from here.</p></div>`}
        <div class="kpis"><div class="kpi"><span class="kpi__label">Abandoned now</span><span class="kpi__value">${r.stats.open}</span><span class="kpi__delta">${taka(r.stats.openValue)} in bags</span></div>
          <div class="kpi"><span class="kpi__label">Reminders sent</span><span class="kpi__value">${r.stats.reminders}</span><span class="kpi__delta">emails and calls</span></div>
          <div class="kpi"><span class="kpi__label">Recovered</span><span class="kpi__value">${r.stats.recovered}</span><span class="kpi__delta">${taka(r.stats.recoveredValue)} in orders</span></div></div>
        <div class="tabs" id="caTabs">${[["open", "Open"], ["recovered", "Recovered"], ["ordered", "Ordered"], ["dismissed", "Dismissed"], ["all", "All"]].map(([k, l]) => `<button class="tab${tab === k ? " is-on" : ""}" data-t="${k}">${l} <span class="muted">${r.carts.filter((x) => k === "all" || x.status === k).length}</span></button>`).join("")}</div>
        <div class="card card--flush"><div class="table-wrap"><table class="t"><thead><tr><th>Last active</th><th>Customer</th><th>Bag</th><th>Value</th><th>Reminders</th><th>Status</th><th></th></tr></thead><tbody>${list.map((x) => `
          <tr><td>${ago(x.updatedAt)}<br><small class="muted">${dateTime(x.updatedAt)}</small></td>
          <td><b>${esc(x.customer.name || "No name yet")}</b>${x.customer.phone ? `<br><a href="tel:${esc(x.customer.phone)}">${esc(x.customer.phone)}</a>` : ""}${x.customer.email ? `<br><small><a href="mailto:${esc(x.customer.email)}">${esc(x.customer.email)}</a></small>` : ""}</td>
          <td><small>${x.items.map((i) => `${i.qty} × ${esc(i.name)}${Object.keys(i.options || {}).length ? " (" + esc(Object.values(i.options).join(", ")) + ")" : ""}`).join("<br>")}</small></td>
          <td>${taka(x.total)}</td><td>${remState(x)}</td><td>${statusPill(x)}</td><td class="right"><button class="btn btn--ghost btn--sm" data-open="${x.id}">Open</button></td></tr>`).join("") || `<tr><td colspan="7"><p class="empty">${tab === "open" ? "No abandoned carts right now." : "Nothing here."}</p></td></tr>`}</tbody></table></div></div>`;
      $("#caTabs").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { tab = b.dataset.t; draw(); } };
      $("#caCsv").onclick = () => download("ravelle-abandoned-carts.csv", csv([["Last active", "Name", "Phone", "Email", "Address", "City", "Items", "Value", "Reminders", "Status", "Order"]]
        .concat(r.carts.map((x) => [new Date(x.updatedAt).toISOString(), x.customer.name, x.customer.phone, x.customer.email, x.customer.address, x.customer.city, x.items.map((i) => i.qty + " x " + i.name).join("; "), x.total, x.reminders.length, x.status, x.orderNumber || ""]))));
    };
    draw();
    view.onclick = async (e) => {
      const b = e.target.closest("[data-open]");
      if (!b) return;
      const x = r.carts.find((y) => y.id === b.dataset.open);
      const first = (x.customer.name || "").split(" ")[0];
      const wa = x.customer.phone ? x.customer.phone.replace(/^0/, "880") : "";
      const msg = `Hi${first ? " " + first : ""}, this is Ravelle. You left ${x.items.map((i) => i.name).join(", ")} in your bag. Complete your order here: ${x.link}`;
      const body = modal(x.customer.name || "Abandoned cart", `<div class="stack">
        <div class="flex">${x.customer.phone ? `<a class="btn btn--dark btn--sm" href="tel:${esc(x.customer.phone)}" data-contact="phone">Call ${esc(x.customer.phone)}</a><a class="btn btn--ghost btn--sm" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" data-contact="whatsapp">WhatsApp</a>` : ""}
          ${x.customer.email ? `<button class="btn btn--ghost btn--sm" type="button" id="caRemind">Send reminder email now</button>` : ""}</div>
        <dl class="row row--2" style="margin:0;gap:12px 20px"><div><dt class="mono muted small">Email</dt><dd style="margin:2px 0 0">${esc(x.customer.email || "—")}</dd></div><div><dt class="mono muted small">Address</dt><dd style="margin:2px 0 0">${esc([x.customer.address, x.customer.city].filter(Boolean).join(", ") || "—")}</dd></div>
          <div><dt class="mono muted small">Started</dt><dd style="margin:2px 0 0">${dateTime(x.createdAt)}</dd></div><div><dt class="mono muted small">Came from</dt><dd style="margin:2px 0 0">${esc(x.source || "—")}</dd></div></dl>
        <div class="card" style="padding:12px 14px">${x.items.map((i) => `<div class="flex flex--between small"><span>${i.qty} × ${esc(i.name)} ${Object.keys(i.options || {}).length ? `<span class="muted">(${esc(Object.values(i.options).join(", "))})</span>` : ""}</span><b>${taka(i.lineTotal)}</b></div>`).join("")}<div class="flex flex--between" style="margin-top:6px"><span>Total</span><b>${taka(x.total)}</b></div></div>
        <label class="field"><span>Link that puts their bag back</span><div class="flex" style="flex-wrap:nowrap"><input class="input grow" value="${esc(x.link)}" readonly id="caLink"><button class="btn btn--ghost btn--sm" type="button" id="caCopy">Copy</button></div><small>Paste it in a message. It refills their bag and opens checkout.</small></label>
        <div><p class="mono muted small" style="margin:0 0 6px">Follow-up</p>${x.reminders.length ? `<ul class="small" style="margin:0;padding-left:18px">${x.reminders.map((m) => `<li>${dateTime(m.at)} · ${m.channel === "email" ? (m.auto ? "Automatic email " + m.n : "Email sent by " + esc(m.by || "staff")) : esc(m.status)}${m.channel === "email" ? ` · <span style="color:${m.ok === false ? "var(--danger)" : "inherit"}">${esc(m.status)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="small muted" style="margin:0">Nothing sent yet.</p>`}${x.clickedAt ? `<p class="small" style="margin:6px 0 0">✓ Opened the link ${ago(x.clickedAt)}.</p>` : ""}</div>
        <div class="modal__foot"><button class="btn btn--danger" type="button" id="caDel" style="margin-right:auto">Delete</button>${x.status === "open" ? `<button class="btn btn--ghost" type="button" id="caDismiss">Dismiss</button>` : x.status === "dismissed" ? `<button class="btn btn--ghost" type="button" id="caReopen">Reopen</button>` : ""}<button class="btn btn--dark" type="button" data-modal-close>Close</button></div></div>`, { wide: true, noFocus: true });
      const reload = async () => { r = await api("GET", "/api/carts"); draw(); };
      $("#caCopy", body).onclick = () => { $("#caLink").select(); try { navigator.clipboard.writeText(x.link); } catch (err) { document.execCommand("copy"); } toast("Link copied"); };
      $$("[data-contact]", body).forEach((a) => a.addEventListener("click", () => { api("POST", "/api/carts/" + x.id + "/contacted", { channel: a.dataset.contact }).then(reload, () => {}); }));
      if ($("#caRemind", body)) $("#caRemind", body).onclick = async (ev) => { busy(ev.target, true); try { const o = await api("POST", "/api/carts/" + x.id + "/remind"); toast(o.status === "sending" ? "Reminder email is on its way" : o.status, o.status !== "sending"); closeModal(); reload(); } catch (err) { fail(err); busy(ev.target, false); } };
      const setStatus = async (s) => { try { await api("PATCH", "/api/carts/" + x.id, { status: s }); closeModal(); toast(s === "dismissed" ? "Dismissed. No more reminders for this cart." : "Reopened"); reload(); } catch (err) { fail(err); } };
      if ($("#caDismiss", body)) $("#caDismiss", body).onclick = () => setStatus("dismissed");
      if ($("#caReopen", body)) $("#caReopen", body).onclick = () => setStatus("open");
      $("#caDel", body).onclick = async () => { if (!(await confirmBox("Delete this cart?", "This can't be undone.", "Delete", true))) return; try { await api("DELETE", "/api/carts/" + x.id); toast("Deleted"); reload(); } catch (err) { fail(err); } };
    };
  }

  // ---------------------------------------------------------------------------
  // Email & reminders: company Gmail, order invoices, abandoned-cart reminders, email log
  // ---------------------------------------------------------------------------
  async function viewEmail() {
    setTitle("Email & reminders");
    let r;
    try { r = await api("GET", "/api/email-settings"); } catch (err) { return fail(err); }
    const e = r.email, c = r.carts, demo = window.Ravelle.mode === "demo";
    const steps = (list) => `<ol class="trk__steps">${list.map((x) => `<li>${x}</li>`).join("")}</ol>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Email & reminders</h1><p class="muted">Send order invoices and abandoned-cart reminders from your company Gmail, automatically.</p></div></div>
      <form class="stack" id="emForm">
        <div class="card"><div class="card__head"><h2 class="h2">Company Gmail</h2><span class="trk__state ${e.enabled && e.passwordSet ? "is-on" : ""}">${e.enabled && e.passwordSet ? "● Connected" : "○ Not connected"}</span></div>
          ${demo ? `<p class="small muted" style="margin:0">The demo has no email server, so emails are listed in the log below but not sent. On the live store they go out for real.</p>` : ""}
          <div class="row row--2"><label class="field"><span>Gmail address</span><input class="input" name="user" type="email" value="${esc(e.user)}" placeholder="orders@gmail.com or you@ravellebd.com"><small>Emails come from this address.</small></label>
          <label class="field"><span>App password</span><input class="input" name="password" type="password" autocomplete="new-password" placeholder="${e.passwordSet ? "Saved. Paste a new one to replace it." : "16 letters from Google, like abcd efgh ijkl mnop"}"><small>Not your normal Gmail password. Kept on your server only.${e.passwordSet ? ` <a href="#" id="emPwClear">Remove</a>` : ""}</small></label></div>
          <div class="row row--3"><label class="field"><span>Sender name</span><input class="input" name="fromName" value="${esc(e.fromName)}"></label><label class="field"><span>Replies go to (optional)</span><input class="input" name="replyTo" type="email" value="${esc(e.replyTo)}" placeholder="Same as the Gmail address"></label>
          <label class="field"><span>Mail server</span><select class="input" name="server"><option value="smtp.gmail.com:465"${e.host === "smtp.gmail.com" ? " selected" : ""}>Gmail / Google Workspace</option><option value="custom"${e.host !== "smtp.gmail.com" ? " selected" : ""}>Other (${esc(e.host)}:${esc(e.port)})</option></select></label></div>
          <div class="row row--2" id="emCustom" ${e.host === "smtp.gmail.com" ? "hidden" : ""}><label class="field"><span>SMTP host</span><input class="input" name="host" value="${esc(e.host)}"></label><label class="field"><span>Port</span><input class="input" name="port" type="number" value="${esc(e.port)}"><small>465 (SSL) or 587 (STARTTLS)</small></label></div>
          <label class="switch"><input type="checkbox" name="enabled" ${e.enabled ? "checked" : ""}> Send emails from this address</label>
          <div class="flex"><input class="input" id="emTestTo" type="email" placeholder="Send a test to…" value="${esc(e.user)}" style="max-width:280px"><button class="btn btn--ghost btn--sm" type="button" id="emTest">Send test email</button><span class="small" id="emTestOut"></span></div>
          <details class="trk__guide"><summary>How to get a Gmail app password</summary>${steps([
            `Sign in to the Gmail account you want to send from, then open <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">Google Account › Security</a>.`,
            `Turn on <b>2-Step Verification</b> if it's off. Google only gives app passwords to accounts with it on.`,
            `Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">App passwords</a>, type the name "Ravelle store" and press <b>Create</b>.`,
            `Copy the 16-letter password into <b>App password</b> above, tick <b>Send emails from this address</b> and press Save.`,
            `Press <b>Send test email</b>. It should arrive within a minute. Check Spam the first time and mark it "Not spam".`])}
            <p class="muted small">A free Gmail account can send about 500 emails a day; Google Workspace about 2,000. Some hosting companies block outgoing mail ports (465/587) on new servers. If the test fails with a timeout, ask your host to open them.</p></details></div>
        <div class="card"><h2 class="h2">Order invoice</h2>
          <label class="switch"><input type="checkbox" name="invoice" ${e.invoice ? "checked" : ""}> Email an invoice to the customer the moment they place an order</label>
          <p class="small muted" style="margin:0">It lists the items, prices, delivery charge, total, payment method, delivery address and a Track order button. Customers who leave the email empty don't get one.</p>
          <label class="field"><span>Also send a copy of every new order to (optional)</span><input class="input" name="copyTo" value="${esc(e.copyTo)}" placeholder="you@ravellebd.com"><small>Separate several addresses with commas.</small></label></div>
        <div class="card"><h2 class="h2">Order updates</h2>
          <p class="small muted" style="margin:0">Sent once, when you (or Acore) change the order's status. Customers who left the email empty don't get them.</p>
          <label class="switch"><input type="checkbox" name="notifyConfirmed" ${e.notifyConfirmed !== false ? "checked" : ""}> Email the customer when the order is <b>confirmed</b></label>
          <label class="switch"><input type="checkbox" name="notifyShipped" ${e.notifyShipped !== false ? "checked" : ""}> Email when it's <b>shipped</b>, with the courier and tracking number</label>
          <label class="switch"><input type="checkbox" name="notifyDelivered" ${e.notifyDelivered !== false ? "checked" : ""}> Email when it's <b>delivered</b></label>
          <p class="small muted" style="margin:0">Add the courier tracking number on the order before you set it to Shipped, so it goes in the email.</p></div>
        <div class="card"><h2 class="h2">Abandoned cart reminders</h2>
          <label class="switch"><input type="checkbox" name="cEnabled" ${c.enabled ? "checked" : ""}> Email people who left checkout without ordering</label>
          <div class="row row--2"><label class="field"><span>First reminder after (minutes)</span><input class="input" type="number" min="5" max="1440" name="delay1" value="${esc(c.delay1)}"></label><label class="field"><span>Second reminder after (hours)</span><input class="input" type="number" min="1" max="168" name="delay2" value="${esc(c.delay2)}"></label></div>
          <div class="row row--2"><label class="field"><span>First email subject</span><input class="input" name="subject1" value="${esc(c.subject1)}"></label><label class="field"><span>Second email subject</span><input class="input" name="subject2" value="${esc(c.subject2)}"></label></div>
          <div class="row row--2"><label class="field"><span>First email message</span><textarea class="input" rows="3" name="text1">${esc(c.text1)}</textarea></label><label class="field"><span>Second email message</span><textarea class="input" rows="3" name="text2">${esc(c.text2)}</textarea></label></div>
          <label class="field"><span>Coupon in the second email (optional)</span><input class="input" name="coupon" value="${esc(c.coupon)}" placeholder="e.g. COMEBACK5" style="max-width:240px"><small>Create the coupon in <a href="#/coupons">Coupons</a> first.</small></label>
          <p class="small muted" style="margin:0">Each email shows their bag and a "Complete your order" button that refills it. Reminders stop as soon as they order. People who only gave a phone number appear in <a href="#/carts">Abandoned carts</a> for a call or WhatsApp.</p></div>
        <div class="sticky-save"><span class="small">Changes apply right away.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>
      <div class="card card--flush"><div class="card__head" style="padding:16px 18px 0"><h2 class="h2">Email log</h2><span class="muted small">Last ${r.log.length}</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Time</th><th>To</th><th>Email</th><th>Result</th></tr></thead><tbody>${r.log.map((l) => `
        <tr><td>${dateTime(l.at)}</td><td>${esc(l.to)}</td><td>${esc(l.subject)}<br><small class="muted">${esc({ invoice: "Invoice", "invoice-copy": "Order copy", "cart-reminder-1": "Cart reminder 1", "cart-reminder-2": "Cart reminder 2", "status-confirmed": "Order confirmed", "status-shipped": "Order shipped", "status-delivered": "Order delivered", test: "Test" }[l.kind] || l.kind)}${l.ref ? " · " + esc(l.ref) : ""}</small></td>
        <td style="color:${l.ok === false ? "var(--danger)" : l.ok ? "var(--ok)" : "inherit"}">${esc(l.status)}</td></tr>`).join("") || `<tr><td colspan="4"><p class="empty">No emails yet.</p></td></tr>`}</tbody></table></div></div>`;
    const form = $("#emForm");
    let dirty = false;
    form.addEventListener("input", () => { dirty = true; });
    leaveGuard = () => !dirty || confirm("You have unsaved changes on this page. Leave without saving?");
    form.server.onchange = () => { $("#emCustom").hidden = form.server.value !== "custom"; if (form.server.value !== "custom") { form.host.value = "smtp.gmail.com"; form.port.value = 465; } };
    if ($("#emPwClear")) $("#emPwClear").onclick = (ev) => { ev.preventDefault(); form.dataset.pwClear = "1"; dirty = true; ev.target.textContent = "Will be removed when you save"; };
    $("#emTest").onclick = async () => {
      if (dirty) return toast("Save first, then test.", true);
      const out = $("#emTestOut"); out.textContent = "Sending…"; out.style.color = "";
      try {
        const t = await api("POST", "/api/email/test", { to: $("#emTestTo").value.trim() });
        if (t.status !== "sending") { out.textContent = t.status; out.style.color = "var(--danger)"; return; }
        for (let i = 0; i < 15; i++) {
          await new Promise((ok) => setTimeout(ok, 1500));
          const l = (await api("GET", "/api/email/log/" + t.id)).email;
          if (l.ok !== null) { out.textContent = l.ok ? "✓ Sent. Check the inbox (and Spam)." : l.status; out.style.color = l.ok ? "var(--ok)" : "var(--danger)"; return; }
        }
        out.textContent = "Still sending… check the log below in a minute.";
      } catch (err) { out.textContent = err.message; out.style.color = "var(--danger)"; }
    };
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const email = { user: f.user.value.trim(), fromName: f.fromName.value.trim(), replyTo: f.replyTo.value.trim(), host: f.host.value.trim() || "smtp.gmail.com", port: +f.port.value || 465, enabled: f.enabled.checked, invoice: f.invoice.checked, copyTo: f.copyTo.value.trim(),
        notifyConfirmed: f.notifyConfirmed.checked, notifyShipped: f.notifyShipped.checked, notifyDelivered: f.notifyDelivered.checked };
      if (f.password.value.trim()) email.password = f.password.value.trim();
      if (form.dataset.pwClear) email.passwordClear = true;
      const carts = { enabled: f.cEnabled.checked, delay1: +f.delay1.value, delay2: +f.delay2.value, subject1: f.subject1.value, subject2: f.subject2.value, text1: f.text1.value, text2: f.text2.value, coupon: f.coupon.value };
      try { await api("PUT", "/api/email-settings", { email, carts }); dirty = false; toast("Saved"); viewEmail(); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Popup banner on the home page
  // ---------------------------------------------------------------------------
  async function viewPopup() {
    setTitle("Popup banner");
    let p;
    try { p = (await api("GET", "/api/pages/popup")).page; } catch (err) { return fail(err); }
    const demo = window.Ravelle.mode === "demo";
    view.innerHTML = `<div class="head"><div><h1 class="h1">Popup banner</h1><p class="muted">A banner that pops up on the home page for offers, events or news. It opens a moment after someone lands on the home page, shows once per visit, and closes with the ✕ in the corner.</p></div>
        <a class="btn btn--ghost" href="./?popup${demo ? "&demo" : ""}#home" target="_blank" rel="noopener">Preview ↗</a></div>
      <form class="stack" id="ppForm">
        <div class="card"><div class="card__head"><h2 class="h2">Show the popup</h2><span class="pill pill--${p.enabled ? "active" : "inactive"}">${p.enabled ? "On" : "Off"}</span></div>
          <label class="switch"><input type="checkbox" name="enabled" ${p.enabled ? "checked" : ""}> Show the popup banner on the home page</label>
          <div class="row row--2"><label class="field"><span>Show after (seconds)</span><input class="input" type="number" min="0" max="30" step="0.5" name="delay" value="${esc(p.delay == null ? 2 : p.delay)}"></label>
          <div class="field"><span>How often</span><p class="small muted" style="margin:0">Once per visit. If they close the site and come back later, they see it again.</p></div></div></div>
        <div class="card"><h2 class="h2">Picture</h2><div class="row row--2">${imgField("popupImage", p.image, "Banner picture", "Shown on the left on computers and on top on phones.")}${imgField("popupMobile", p.mobileImage, "Phone picture (optional)", "Leave empty to use the same picture on phones.")}</div>
          <label class="field"><span>Picture description (for screen readers)</span><input class="input" name="imageAlt" value="${esc(p.imageAlt || "")}"></label></div>
        <div class="card"><h2 class="h2">Text and button</h2><p class="muted small" style="margin:0">Leave the text and button empty to show only the picture. The picture then links to the button link.</p>
          <div class="row row--2"><label class="field"><span>Small heading</span><input class="input" name="eyebrow" value="${esc(p.eyebrow || "")}" placeholder="This week only"></label><label class="field"><span>Title</span><textarea class="input" name="title" rows="2" placeholder="Eid sale\nUp to 40% off">${esc(p.title || "")}</textarea></label></div>
          <label class="field"><span>Text</span><textarea class="input" name="text" rows="3">${esc(p.text || "")}</textarea></label>
          <div class="row row--2"><label class="field"><span>Button text</span><input class="input" name="buttonText" value="${esc(p.buttonText || "")}" placeholder="Shop now"></label>
          <label class="field"><span>Button link</span><input class="input" name="buttonLink" value="${esc(p.buttonLink || "")}" placeholder="#on-sale, #category/men or https://…"></label></div></div>
        <div class="card"><h2 class="h2">Sign-up and welcome code</h2><p class="muted small" style="margin:0">Ask for an email or phone number in the popup and show a coupon code in return. Sign-ups go to <a href="#/subscribers">Subscribers</a>. The button above is hidden while this is on.</p>
          <div class="row row--2"><label class="field"><span>Ask for</span><select class="input" name="capture">${[["off", "Nothing (no sign-up)"], ["either", "Email or phone"], ["email", "Email"], ["phone", "Phone number"]].map(([v, l]) => `<option value="${v}"${(p.capture || "off") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="field"><span>Welcome code to show</span><input class="input" name="welcomeCode" value="${esc(p.welcomeCode || "")}" placeholder="WELCOME10" style="text-transform:uppercase"><small>Create it first in <a href="#/coupons">Coupons</a> (for example 10% off, usage limit empty). It's applied at checkout by itself.</small></label></div>
          <div class="row row--2"><label class="field"><span>Button text</span><input class="input" name="captureButton" value="${esc(p.captureButton || "")}" placeholder="Get my code"></label>
          <label class="field"><span>Message after sign-up</span><input class="input" name="successText" value="${esc(p.successText || "")}" placeholder="You're in. Here's your code:"></label></div></div>
        <div class="sticky-save"><span class="small">Changes apply to the store right away.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>`;
    const form = $("#ppForm");
    let dirty = false;
    form.addEventListener("input", () => { dirty = true; });
    form.addEventListener("change", () => { dirty = true; });
    wireImgFields(form, () => { dirty = true; });
    leaveGuard = () => !dirty || confirm("You have unsaved changes on this page. Leave without saving?");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, page = Object.assign({}, p, { enabled: f.enabled.checked, delay: Math.max(0, Math.min(30, +f.delay.value || 0)), image: f.popupImage.value, mobileImage: f.popupMobile.value,
        imageAlt: f.imageAlt.value.trim(), eyebrow: f.eyebrow.value.trim(), title: f.title.value.trim(), text: f.text.value.trim(), buttonText: f.buttonText.value.trim(), buttonLink: f.buttonLink.value.trim(), version: (+p.version || 0) + 1,
        capture: f.capture.value, welcomeCode: f.welcomeCode.value.trim().toUpperCase(), captureButton: f.captureButton.value.trim(), successText: f.successText.value.trim() });
      if (page.enabled && !page.image && !page.title && !page.text) return toast("Add a picture or a title before turning the popup on.", true);
      try { await api("PUT", "/api/pages/popup", { page }); dirty = false; toast(page.enabled ? "Saved. The popup is on." : "Saved. The popup is off."); viewPopup(); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Franchise requests (from the Franchise page form)
  // ---------------------------------------------------------------------------
  const FR_LABEL = { new: "New", contacted: "Contacted", meeting: "Meeting set", approved: "Approved", declined: "Declined" };
  async function viewFranchise() {
    setTitle("Franchise requests");
    const r = (await api("GET", "/api/franchise").catch(fail)) || { requests: [], statuses: [] };
    let filter = "";
    const meet = (q) => q.meetingDate ? new Date(q.meetingDate + "T00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + (q.meetingTime ? ", " + q.meetingTime : "") : q.meetingTime || "Any time";
    const draw = () => {
      const list = r.requests.filter((q) => !filter || q.status === filter);
      view.innerHTML = `<div class="head"><div><h1 class="h1">Franchise requests</h1><p class="muted">Sent from the Franchise page. Call them, set the meeting, and keep notes here.</p></div><button class="btn btn--ghost" id="frCsv">Export CSV</button></div>
        <div class="tabs" id="frTabs"><button class="tab${filter ? "" : " is-on"}" data-f="">All <span class="muted">${r.requests.length}</span></button>${r.statuses.map((s) => `<button class="tab${filter === s ? " is-on" : ""}" data-f="${s}">${FR_LABEL[s]} <span class="muted">${r.requests.filter((q) => q.status === s).length}</span></button>`).join("")}</div>
        <div class="card card--flush"><div class="table-wrap"><table class="t"><thead><tr><th>Received</th><th>Name</th><th>Phone</th><th>District</th><th>Budget</th><th>Meeting</th><th>Status</th><th></th></tr></thead><tbody>${list.map((q) => `
          <tr${q.read ? "" : ' style="box-shadow:inset 3px 0 0 var(--accent)"'}><td>${dateTime(q.createdAt)}</td><td><b>${esc(q.name)}</b>${q.email ? `<br><small class="muted">${esc(q.email)}</small>` : ""}</td><td><a href="tel:${esc(q.phone)}">${esc(q.phone)}</a></td>
          <td>${esc(q.district)}${q.area ? `<br><small class="muted">${esc(q.area)}</small>` : ""}</td><td>${esc(q.investment || "–")}</td><td>${esc(meet(q))}<br><small class="muted">${esc(q.meetingType || "")}</small></td>
          <td><span class="pill pill--fr-${q.status}">${FR_LABEL[q.status] || q.status}</span></td><td class="right"><button class="btn btn--ghost btn--sm" data-open="${q.id}">Open</button></td></tr>`).join("") || `<tr><td colspan="8"><p class="empty">${r.requests.length ? "No requests with this status." : "No franchise requests yet. They appear here when someone sends the form on the Franchise page."}</p></td></tr>`}</tbody></table></div></div>`;
      $("#frTabs").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; draw(); } };
      $("#frCsv").onclick = () => download("ravelle-franchise-requests.csv", csv([["Date", "Name", "Phone", "Email", "District", "Area", "Shop space", "Investment", "Experience", "Meeting type", "Meeting date", "Meeting time", "Message", "Status", "Notes"]]
        .concat(r.requests.map((q) => [new Date(q.createdAt).toISOString(), q.name, q.phone, q.email, q.district, q.area, q.space, q.investment, q.experience, q.meetingType, q.meetingDate, q.meetingTime, q.message, FR_LABEL[q.status], q.note]))));
    };
    draw();
    view.onclick = async (e) => {
      const b = e.target.closest("[data-open]");
      if (!b) return;
      const q = r.requests.find((x) => x.id === b.dataset.open);
      if (!q.read) { q.read = true; api("PATCH", "/api/franchise/" + q.id, { read: true }).then(refreshCounts, () => {}); }
      const row = (l, v) => v ? `<div><dt class="mono muted small">${l}</dt><dd style="margin:2px 0 0;white-space:pre-wrap">${esc(v)}</dd></div>` : "";
      const wa = q.phone.replace(/^0/, "880");
      const body = modal(q.name, `<div class="stack"><div class="flex"><a class="btn btn--dark btn--sm" href="tel:${esc(q.phone)}">Call ${esc(q.phone)}</a><a class="btn btn--ghost btn--sm" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>${q.email ? `<a class="btn btn--ghost btn--sm" href="mailto:${esc(q.email)}?subject=${encodeURIComponent("Your Ravelle franchise request")}">Email</a>` : ""}</div>
        <dl class="row row--2" style="margin:0;gap:12px 20px">${row("District", q.district)}${row("Area or market", q.area)}${row("Shop space", q.space)}${row("Planned investment", q.investment)}${row("Meeting", q.meetingType)}${row("Preferred date and time", meet(q))}${row("Received", dateTime(q.createdAt))}${row("Email", q.email)}</dl>
        ${row("Business experience", q.experience)}${row("Message", q.message)}
        <form class="stack" id="frEdit"><label class="field"><span>Status</span><select class="input" name="status">${r.statuses.map((s) => `<option value="${s}"${s === q.status ? " selected" : ""}>${FR_LABEL[s]}</option>`).join("")}</select></label>
        <label class="field"><span>Notes (only you see these)</span><textarea class="input" name="note" rows="3" placeholder="Meeting confirmed for Sunday 4pm…">${esc(q.note || "")}</textarea></label>
        <div class="modal__foot"><button class="btn btn--danger" type="button" id="frDel" style="margin-right:auto">Delete</button><button class="btn btn--ghost" type="button" data-modal-close>Close</button><button class="btn btn--dark" type="submit">Save</button></div></form></div>`, { wide: true, noFocus: true });
      $("#frEdit", body).onsubmit = async (ev) => {
        ev.preventDefault();
        try { Object.assign(q, (await api("PATCH", "/api/franchise/" + q.id, formData(ev.target))).request); closeModal(); toast("Saved"); draw(); } catch (err) { fail(err); }
      };
      $("#frDel", body).onclick = async () => {
        if (!(await confirmBox("Delete this request?", "This can't be undone.", "Delete", true))) return;
        try { await api("DELETE", "/api/franchise/" + q.id); r.requests = r.requests.filter((x) => x !== q); toast("Deleted"); refreshCounts(); draw(); } catch (err) { fail(err); }
      };
      draw();
    };
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  // Each area is one module (or a few related ones) in the menu on the left
  const AREA = { dashboard: "Dashboard & Analytics", orders: "Orders & Abandoned carts", customers: "Customers & Subscribers", products: "Products & Stock", catalog: "Categories & Variations",
    coupons: "Coupons", content: "Pages, Menus & Media library", chat: "Live chat", messages: "Messages", franchise: "Franchise requests", users: "Users",
    settings: "Settings, Header & footer, Pixel & Analytics, Email & reminders, Acore, Pathao", integrations: "API & webhooks" };
  async function viewUsers() {
    setTitle("Users");
    const r = (await api("GET", "/api/users").catch(fail)) || { users: [], roles: {} };
    const areaNames = (list) => list.map((a) => AREA[a] || a).join(", ");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Users</h1><p class="muted">People who can sign in to this admin panel with their email and password. Pick a role, or choose “Custom access” and tick exactly which modules they can open.</p></div><button class="btn btn--dark" id="usAdd">Add user</button></div>
      <div class="card card--flush"><div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Last sign-in</th><th></th></tr></thead><tbody>${r.users.map((u) => `
        <tr><td><b>${esc(u.name)}</b>${u.id === me.id ? ` <span class="tag">You</span>` : ""}</td><td>${esc(u.email)}</td><td>${esc((r.roles[u.role] || {}).label || u.role)}${u.role === "custom" ? `<br><small class="muted">${esc(areaNames(u.areas || []))}</small>` : ""}${u.orderTrash ? `<br><small class="muted">Can delete orders</small>` : ""}</td><td>${ago(u.lastLogin)}</td><td class="right"><button class="btn btn--ghost btn--sm" data-edit="${u.id}">Edit</button></td></tr>`).join("")}</tbody></table></div></div>
      <div class="grid-3">${Object.keys(r.roles).map((k) => `<div class="card"><h2 class="h2">${esc(r.roles[k].label)}</h2><p class="muted small" style="margin:0">${r.roles[k].custom ? "Only the modules you tick for that person." : areaNames(r.roles[k].areas)}</p></div>`).join("")}</div>`;
    const roleOpts = (sel) => Object.keys(r.roles).map((k) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(r.roles[k].label)}</option>`).join("");
    const trashBox = (u) => me.role === "owner" ? `<label class="switch"><input type="checkbox" name="orderTrash" ${u.role === "owner" || u.orderTrash ? "checked" : ""}${u.role === "owner" ? " disabled" : ""}> Can move orders to the trash and delete them permanently</label><small class="muted" style="margin-top:-8px">Off: they can work on orders but can't delete them. Owners can always.</small>` : "";
    const areaBoxes = (u) => trashBox(u) + `<fieldset class="us-areas" data-areas ${u.role === "custom" ? "" : "hidden"}><legend class="small">Modules this person can open</legend>
      <div class="us-areas__grid">${Object.keys(AREA).map((a) => `<label class="switch"><input type="checkbox" value="${a}" ${(u.areas || []).indexOf(a) > -1 ? "checked" : ""}> ${esc(AREA[a])}</label>`).join("")}</div>
      <div class="flex"><button class="btn btn--link btn--sm" type="button" data-all="1">Tick all</button><button class="btn btn--link btn--sm" type="button" data-all="0">Clear</button></div></fieldset>`;
    const wire = (form, u) => {
      const sel = $("[name=role]", form), box = $("[data-areas]", form);
      const sync = () => {
        box.hidden = sel.value !== "custom";
        if (sel.value !== "custom") $$("input", box).forEach((c) => { c.checked = (r.roles[sel.value].areas || []).indexOf(c.value) > -1; });
      };
      sel.onchange = sync;
      if (sel.value !== "custom") sync();
      box.onclick = (e) => { const b = e.target.closest("[data-all]"); if (b) $$("input", box).forEach((c) => { c.checked = b.dataset.all === "1"; }); };
    };
    const payload = (form) => {
      const d = formData(form);
      $$("[data-areas] input", form).forEach((c) => delete d[c.name]);
      if (d.role === "custom") d.areas = $$("[data-areas] input:checked", form).map((c) => c.value);
      return d;
    };
    $("#usAdd").onclick = () => {
      const u = { role: "custom", areas: ["orders", "customers"] };
      modal("Add user", `<form class="stack" id="usForm"><div class="row row--2"><label class="field"><span>Name</span><input class="input" name="name" required></label><label class="field"><span>Email (they sign in with this)</span><input class="input" name="email" type="email" required></label></div>
        <div class="row row--2"><label class="field"><span>Access</span><select class="input" name="role">${roleOpts(u.role)}</select></label><label class="field"><span>Password</span><input class="input" name="password" type="text" minlength="8" required value="${Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)}"><small>At least 8 characters. Share it with them; they can change it later.</small></label></div>
        ${areaBoxes(u)}
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Add user</button></div></form>`, { wide: true });
      wire($("#usForm"), u);
      $("#usForm").onsubmit = async (e) => { e.preventDefault(); try { await api("POST", "/api/users", payload(e.target)); closeModal(); toast("User added. They can sign in at /admin."); viewUsers(); } catch (err) { fail(err); } };
    };
    view.onclick = (e) => {
      const b = e.target.closest("[data-edit]");
      if (!b) return;
      const u = r.users.find((x) => x.id === b.dataset.edit);
      modal("Edit " + u.name, `<form class="stack" id="usForm"><div class="row row--2"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(u.name)}"></label><label class="field"><span>Email</span><input class="input" value="${esc(u.email)}" disabled></label></div>
        <div class="row row--2"><label class="field"><span>Access</span><select class="input" name="role">${roleOpts(u.role)}</select></label><label class="field"><span>New password</span><input class="input" name="password" type="text" minlength="8" placeholder="Leave empty to keep"><small>Changing it signs them out everywhere.</small></label></div>
        ${areaBoxes(u)}
        <div class="modal__foot">${u.id === me.id ? "" : `<button class="btn btn--danger" type="button" id="usDel" style="margin-right:auto">Remove</button>`}<button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save</button></div></form>`, { wide: true });
      wire($("#usForm"), u);
      $("#usForm").onsubmit = async (ev) => { ev.preventDefault(); const d = payload(ev.target); if (!d.password) delete d.password; try { await api("PATCH", "/api/users/" + u.id, d); closeModal(); toast("Saved"); viewUsers(); } catch (err) { fail(err); } };
      if ($("#usDel")) $("#usDel").onclick = async () => { if (!(await confirmBox("Remove " + u.name + "?", "They won't be able to sign in any more.", "Remove", true))) return; try { await api("DELETE", "/api/users/" + u.id); toast("Removed"); viewUsers(); } catch (err) { fail(err); } };
    };
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  async function viewSettings() {
    setTitle("Settings");
    let s;
    try { s = (await api("GET", "/api/settings")).settings; } catch (err) { return fail(err); }
    const st = s.store;
    const f = (group, k, label, hint, ph) => `<label class="field"><span>${label}</span><input class="input" data-g="${group}" name="${k}" value="${esc((s[group] || {})[k] || "")}" placeholder="${esc(ph || "")}">${hint ? `<small>${hint}</small>` : ""}</label>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Settings</h1><p class="muted">Store details, legal numbers, delivery, payments and chat.</p></div></div>
      <form class="stack" id="setForm">
        <div class="card"><h2 class="h2">Store and legal details</h2><p class="muted small" style="margin:0">Shown on About us, Contact us, the footer and invoices. SSLCOMMERZ asks for the trade license, TIN and DBID to be on your site.</p>
          <div class="row row--2">${f("store", "name", "Store name")}${f("store", "legalName", "Registered business name")}</div>
          <div class="row row--3">${f("store", "tradeLicense", "Trade license number")}${f("store", "tin", "TIN")}${f("store", "dbid", "DBID")}</div>
          <div class="row row--3">${f("store", "bin", "BIN / VAT (optional)")}${f("store", "phone", "Phone", "", "+880 17XX-XXXXXX")}${f("store", "whatsapp", "WhatsApp (optional)", "", "+880 17XX-XXXXXX")}</div>
          <div class="row row--3">${f("store", "email", "Email")}${f("store", "hours", "Opening hours")}${f("store", "website", "Website")}</div>
          ${f("store", "address", "Full business address", "", "House, road, area, Dhaka 1212")}${f("store", "tagline", "Tagline")}</div>
        <div class="card"><h2 class="h2">Delivery</h2><div class="stack stack--sm" id="zones"></div><button class="btn btn--ghost btn--sm" type="button" id="addZone" style="justify-self:start">+ Add delivery area</button>
          <div class="row row--2"><label class="field"><span>Free delivery over (৳)</span><input class="input" type="number" min="0" id="freeOver" value="${esc(s.shipping.freeOver || "")}" placeholder="0 = never"></label>
          <label class="field"><span>Processing note</span><input class="input" id="processing" value="${esc(s.shipping.processing || "")}"></label></div></div>
        <div class="card"><h2 class="h2">Payments</h2><p class="muted small" style="margin:0">Cash on delivery, SSLCOMMERZ, bKash and Nagad are set up in <a href="#/payments">Payments</a>.</p></div>
        <div class="card"><h2 class="h2">Live chat</h2>
          <label class="switch"><input type="checkbox" data-g="chat" name="enabled" ${s.chat.enabled ? "checked" : ""}> Show the chat bubble on the store</label>
          <div class="row row--2">${f("chat", "title", "Chat name", "Shown at the top of the chat.")}${f("chat", "greeting", "Greeting")}</div>
          <label class="switch"><input type="checkbox" data-g="chat" name="autoReply" ${s.chat.autoReply ? "checked" : ""}> Send an automatic reply to the first message</label>${f("chat", "autoReplyText", "Automatic reply")}
          <p class="muted small" style="margin:0">Connecting an AI reply tool? Turn the automatic reply off and let the tool answer through the API.</p></div>
        <div class="card"><h2 class="h2">Store front</h2>
          <label class="field"><span>Announcement bar</span><input class="input" id="announcement" value="${esc(s.announcement || "")}" placeholder="Leave empty to hide"></label>
          <div class="row row--2"><label class="field"><span>Low stock warning at</span><input class="input" type="number" min="0" id="lowStock" value="${esc(s.lowStock)}"><small>Sizes with this many or fewer show “Only N left” and appear on the dashboard.</small></label></div>
          <div class="row row--2">${f("seo", "title", "Search engine title")}${f("seo", "description", "Search engine description")}</div></div>
        <div class="card"><h2 class="h2">Social links</h2><div class="row row--2">${f("social", "facebook", "Facebook")}${f("social", "instagram", "Instagram")}${f("social", "tiktok", "TikTok")}${f("social", "youtube", "YouTube")}</div></div>
        <div class="sticky-save"><span class="small">Changes show on the store right away.</span><button class="btn btn--dark" type="submit">Save settings</button></div>
      </form>`;
    let zones = clone(s.shipping.zones);
    const drawZones = () => {
      $("#zones").innerHTML = zones.map((z, i) => `<div class="row" style="grid-template-columns:2fr 1fr 1.2fr auto;align-items:end"><label class="field"><span>Area</span><input class="input" data-z="${i}" data-f="name" value="${esc(z.name)}"></label>
        <label class="field"><span>Fee (৳)</span><input class="input" type="number" min="0" data-z="${i}" data-f="fee" value="${esc(z.fee)}"></label><label class="field"><span>Delivery time</span><input class="input" data-z="${i}" data-f="days" value="${esc(z.days)}"></label>
        <button class="icon" type="button" data-rmz="${i}" aria-label="Remove" style="margin-bottom:3px">✕</button></div>`).join("");
    };
    drawZones();
    $("#zones").addEventListener("input", (e) => { const el = e.target.closest("[data-z]"); if (el) zones[+el.dataset.z][el.dataset.f] = el.value; });
    $("#zones").addEventListener("click", (e) => { const b = e.target.closest("[data-rmz]"); if (b) { zones.splice(+b.dataset.rmz, 1); drawZones(); } });
    $("#addZone").onclick = () => { zones.push({ name: "", fee: 0, days: "" }); drawZones(); };
    $("#setForm").onsubmit = async (e) => {
      e.preventDefault();
      const out = { store: {}, social: {}, seo: {}, chat: {} };
      $$("[data-g]", e.target).forEach((el) => { out[el.dataset.g][el.name] = el.type === "checkbox" ? el.checked : el.value; });
      out.shipping = { zones, freeOver: +$("#freeOver").value || 0, processing: $("#processing").value };
      out.announcement = $("#announcement").value;
      out.lowStock = +$("#lowStock").value || 0;
      try { await api("PUT", "/api/settings", { settings: out }); toast("Settings saved"); store = null; } catch (err) { fail(err); }
    };
    view.insertAdjacentHTML("beforeend", `<div class="card" style="margin-top:16px"><h2 class="h2">Site cache</h2>
      <p class="muted small" style="margin:0 0 12px">Browsers keep a saved copy of the site's design and scripts so pages open fast. The store already gives every update a new version, so visitors get it straight away. If someone still sees an old look after an update, click <b>Clear cache</b>: every browser then downloads fresh files on its next visit. Your products, orders and settings are not touched.</p>
      <div class="flex" style="gap:12px;align-items:center;flex-wrap:wrap"><button class="btn btn--ghost btn--sm" type="button" id="clearCache">Clear cache</button><span class="muted small" id="cacheNote">${s.cacheClearedAt ? "Last cleared " + esc(new Date(s.cacheClearedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })) : ""}</span></div></div>`);
    $("#clearCache").onclick = async (e) => {
      if (!confirm("Clear the site cache? Visitors will download fresh design files on their next visit.")) return;
      busy(e.target, true);
      try {
        await api("POST", "/api/cache/clear", {});
        $("#cacheNote").textContent = "Cleared. Reloading the admin with fresh files…";
        setTimeout(() => location.reload(), 900);
      } catch (err) { busy(e.target, false); fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Header & footer: what shows in the store's header and footer, plus tracking code
  // ---------------------------------------------------------------------------
  async function viewLayout() {
    setTitle("Header & footer");
    let s, home;
    try {
      [s, home] = await Promise.all([api("GET", "/api/settings").then((r) => r.settings), api("GET", "/api/pages/home").then((r) => r.page)]);
    } catch (err) { return fail(err); }
    const H = s.layout.header, F = s.layout.footer, code = s.code || {}, foot = home.footer || {};
    const sw = (g, k, label, on) => `<label class="switch"><input type="checkbox" data-l="${g}" name="${k}" ${on ? "checked" : ""}> ${label}</label>`;
    const txt = (attr, k, label, value, hint, ph) => `<label class="field"><span>${label}</span><input class="input" ${attr} name="${k}" value="${esc(value || "")}" placeholder="${esc(ph || "")}">${hint ? `<small>${hint}</small>` : ""}</label>`;
    const color = (k, label, value) => `<label class="field"><span>${label}</span><span class="flex" style="flex-wrap:nowrap"><input type="color" data-l="header" name="${k}" value="${esc(value)}" style="width:44px;height:36px;padding:2px;border:1px solid var(--line);border-radius:8px;background:none"><code class="small" data-hex="${k}">${esc(value)}</code></span></label>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Header & footer</h1><p class="muted">Everything at the top and bottom of every store page. Meta Pixel and Google Analytics are in <a href="#/tracking">Pixel & Analytics</a>.</p></div>
      <a class="btn btn--ghost" href="#/menus">Edit menu links</a></div>
      <form class="stack" id="layForm">
        <div class="card"><h2 class="h2">Announcement bar</h2><p class="muted small" style="margin:0">The thin strip above the header.</p>
          ${sw("header", "announce", "Show the announcement bar", H.announce)}
          <label class="field"><span>Text</span><input class="input" id="announcement" value="${esc(s.announcement || "")}" placeholder="Free delivery inside Dhaka over ৳2,000"></label>
          <div class="row row--3">${color("announceBg", "Background colour", H.announceBg)}${color("announceColor", "Text colour", H.announceColor)}
            <div class="field"><span>Preview</span><div id="annPrev" style="padding:9px 12px;border-radius:8px;font:500 12px/1.3 ui-monospace,monospace;text-align:center;letter-spacing:.04em"></div></div></div></div>
        <div class="card"><h2 class="h2">Header</h2>
          ${imgField("logo", H.logo, "Logo", "Leave empty to use the Ravelle logo.")}
          <div class="row row--3"><label class="field"><span>Logo height (px)</span><input class="input" type="number" min="20" max="80" data-l="header" name="logoHeight" value="${esc(H.logoHeight)}"><small>20 to 80. The default is 40.</small></label></div>
          ${sw("header", "sticky", "Show the slim header bar when people scroll down", H.sticky)}
          ${sw("header", "showSearch", "Show the search icon", H.showSearch)}
          ${sw("header", "showAccount", "Show the order tracking icon", H.showAccount)}
          <p class="muted small" style="margin:0">Menu links, dropdowns and their photos are in <a href="#/menus">Menus</a>.</p></div>
        <div class="card"><h2 class="h2">Footer</h2>
          <label class="field"><span>Tagline</span><textarea class="input" id="tagline" rows="2">${esc(foot.tagline || "")}</textarea><small>The big line at the top of the footer. Press Enter for a new line.</small></label>
          ${sw("footer", "newsletter", "Show the email sign-up", F.newsletter)}
          <div class="row row--2">${txt('id="newsPh"', "newsPh", "Email box text", foot.newsletter, "", "Your email for drop alerts")}${txt('data-l="footer"', "newsletterButton", "Button text", F.newsletterButton, "", "Notify me")}</div>
          ${sw("footer", "showContact", "Show the contact column (address, phone, email)", F.showContact)}
          ${sw("footer", "showSocial", "Show social media links", F.showSocial)}
          ${sw("footer", "showPayments", "Show the payment methods row", F.showPayments)}
          ${sw("footer", "showLegal", "Show trade license, TIN and DBID", F.showLegal)}
          ${sw("footer", "showWordmark", "Show the big name at the bottom", F.showWordmark)}
          <div class="row row--2">${txt('data-l="footer"', "wordmark", "Big name text", F.wordmark, "", "RAVELLE")}${txt('data-l="footer"', "copyright", "Copyright line", F.copyright, "Leave empty for the default. Write {year} for the current year.", "© {year} Ravelle · Prices in BDT (৳)")}</div>
          <p class="muted small" style="margin:0">Footer link columns are in <a href="#/menus">Menus</a>. Address, phone and legal numbers are in <a href="#/settings">Settings</a>.</p></div>
        <div class="card"><h2 class="h2">Social links</h2><div class="row row--2">
          ${["facebook", "instagram", "tiktok", "youtube"].map((k) => txt('data-s="social"', k, k === "tiktok" ? "TikTok" : k === "youtube" ? "YouTube" : k.charAt(0).toUpperCase() + k.slice(1), (s.social || {})[k], "", `https://www.${k}.com/ravellebd`)).join("")}
          ${txt('data-s="store"', "whatsapp", "WhatsApp number", (s.store || {}).whatsapp, "Turns on the WhatsApp button.", "+880 17XX-XXXXXX")}</div></div>
        <div class="sticky-save"><span class="small">Changes show on the store right away.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>`;
    const form = $("#layForm");
    let dirty = false;
    wireImgFields(form, () => { dirty = true; });
    const prev = () => {
      const p = $("#annPrev");
      p.style.background = $('[name="announceBg"]').value; p.style.color = $('[name="announceColor"]').value;
      p.textContent = $("#announcement").value || "Your announcement";
      $$("[data-hex]").forEach((c) => { c.textContent = $(`[name="${c.dataset.hex}"]`).value; });
    };
    prev();
    form.addEventListener("input", () => { dirty = true; prev(); });
    form.addEventListener("change", () => { dirty = true; });
    leaveGuard = () => !dirty || confirm("You have unsaved changes on this page. Leave without saving?");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const layout = { header: {}, footer: {} }, out = { social: {}, store: {}, code: {} };
      $$("[data-l]", form).forEach((el) => { layout[el.dataset.l][el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value; });
      layout.header.logo = $('input[name="logo"]', form).value;
      $$("[data-s]", form).forEach((el) => { out[el.dataset.s][el.name] = el.value; });
      $$("[data-c]", form).forEach((el) => { out.code[el.name] = el.value; });

      out.layout = layout; out.announcement = $("#announcement").value;
      try {
        await api("PUT", "/api/settings", { settings: out });
        const page = Object.assign({}, home, { footer: Object.assign({}, home.footer, { tagline: $("#tagline").value, newsletter: $("#newsPh").value }) });
        await api("PUT", "/api/pages/home", { page });
        dirty = false; store = null;
        toast("Header and footer saved");
      } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Pixel & Analytics: Meta Pixel + Conversions API, Google Analytics 4 + server purchases, with guides and tests
  // ---------------------------------------------------------------------------
  async function viewTracking() {
    setTitle("Pixel & Analytics");
    let s;
    try { s = (await api("GET", "/api/settings")).settings; } catch (err) { return fail(err); }
    const c = s.code || {}, demo = window.Ravelle.mode === "demo";
    const dot = (on, label) => `<span class="trk__state ${on ? "is-on" : ""}">${on ? "●" : "○"} ${label}</span>`;
    const status = (x, none) => x ? `<p class="small" style="margin:0;color:${x.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">Last server event: <b>${esc(x.event)}</b> · ${esc(x.message)} · ${dateTime(x.at)}</p>` : `<p class="muted small" style="margin:0">${demo ? "The demo has no server, so server events can't be sent from here. This works on the live store." : none}</p>`;
    const steps = (list) => `<ol class="trk__steps">${list.map((x) => `<li>${x}</li>`).join("")}</ol>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Pixel & Analytics</h1><p class="muted">Connect Meta (Facebook and Instagram ads) and Google Analytics. Paste the IDs below. The store sends every event by itself, so you don't need Google Tag Manager or any other app.</p></div></div>
      <form class="stack" id="trkForm">
        <div class="card"><div class="card__head"><h2 class="h2">Meta Pixel and Conversions API</h2>
            <div class="flex">${dot(!!c.pixelId, "Pixel (browser)")}${dot(!!(c.pixelId && c.capiTokenSet), "Conversions API (server)")}</div></div>
          <div class="row row--2">
            <label class="field"><span>Pixel ID</span><input class="input" name="pixelId" value="${esc(c.pixelId || "")}" placeholder="123456789012345" inputmode="numeric"><small>15–16 digits. Events Manager › Data sources › your pixel.</small></label>
            <label class="field"><span>Conversions API access token</span><input class="input" type="password" autocomplete="off" name="capiToken" value="" placeholder="${c.capiTokenSet ? "Saved. Paste a new one to replace it." : "Paste the token from Events Manager"}">
              <small>Kept on your server only, never shown on the website.${c.capiTokenSet ? ` <a href="#" id="capiClear">Remove token</a>` : ""}</small></label></div>
          <div class="row row--2">
            <label class="field"><span>Test event code (only while testing)</span><input class="input" name="capiTest" value="${esc(c.capiTest || "")}" placeholder="TEST12345"><small>From Events Manager › Test events. Clear it when you're done, or real events stay in test mode.</small></label>
            <div class="field"><span>Check the connection</span><div class="flex"><button class="btn btn--ghost btn--sm" type="button" data-test="meta">Send a test event to Meta</button></div><div id="metaStatus">${status(c.capiStatus, c.capiTokenSet ? "No server events sent yet." : "Add the token to turn on server events.")}</div></div></div>
          <details class="trk__guide"><summary>Step-by-step: set up the Pixel and Conversions API</summary>
            <h3>1. Create the Pixel</h3>${steps([
              `Open <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener">Meta Events Manager</a> with the Business account that runs your ads.`,
              `Click <b>Connect data sources › Web › Meta Pixel</b>. Name it "Ravelle website" and enter <b>ravellebd.com</b>.`,
              `When it asks how to install, close that window. You don't need to paste Meta's code; this store adds it.`,
              `Copy the <b>Pixel ID</b> (the number under the pixel's name) into the box above and press Save.`])}
            <h3>2. Turn on the Conversions API</h3>${steps([
              `In Events Manager, open your pixel and go to <b>Settings</b>.`,
              `Under <b>Conversions API</b>, choose <b>Set up direct integration</b> (or "Generate access token").`,
              `Click <b>Generate access token</b>, copy it, and paste it into the token box above. Press Save. Meta shows the token only once.`])}
            <h3>3. Test it</h3>${steps([
              `In Events Manager, open <b>Test events</b> and copy the test code (like TEST12345) into <b>Test event code</b>. Save.`,
              `Press <b>Send a test event to Meta</b> above. It should appear in Test events within a minute, marked <b>Server</b>.`,
              `Open your store in another tab, view a product, add it to the bag and place a test order. Each event should show twice, <b>Browser</b> and <b>Server</b>, and Meta marks them "Deduplicated".`,
              `Clear the test code and Save.`])}
            <h3>4. Finish in Business Settings</h3>${steps([
              `<a href="https://business.facebook.com/settings/owned-domains" target="_blank" rel="noopener">Business Settings › Brand safety › Domains</a>: add and verify ravellebd.com.`,
              `In your pixel, open <b>Aggregated event measurement</b> and put <b>Purchase</b> at the top, then InitiateCheckout, AddToCart, ViewContent.`,
              `After a few days, check <b>Overview › Event match quality</b>. Purchase usually reaches "Good" or "Great" because the server sends hashed phone numbers.`])}
            <p class="muted small">Events the store sends: PageView, ViewCategory, ViewContent, Search, AddToWishlist, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase, Lead, Contact.</p>
          </details></div>
        <div class="card"><div class="card__head"><h2 class="h2">Google Analytics 4</h2>
            <div class="flex">${dot(!!c.gaId, "Tag (browser)")}${dot(!!(c.gaId && c.gaSecretSet), "Purchases from server")}</div></div>
          <div class="row row--2">
            <label class="field"><span>Measurement ID</span><input class="input" name="gaId" value="${esc(c.gaId || "")}" placeholder="G-XXXXXXXXXX"><small>Starts with G-. Admin › Data streams › your web stream.</small></label>
            <label class="field"><span>Measurement Protocol API secret</span><input class="input" type="password" autocomplete="off" name="gaSecret" value="" placeholder="${c.gaSecretSet ? "Saved. Paste a new one to replace it." : "Paste the secret from Google Analytics"}">
              <small>Kept on your server only.${c.gaSecretSet ? ` <a href="#" id="gaClear">Remove secret</a>` : ""}</small></label></div>
          <div class="field"><span>Check the connection</span><div class="flex"><button class="btn btn--ghost btn--sm" type="button" data-test="ga">Check with Google</button></div><div id="gaStatus">${status(c.gaStatus, c.gaSecretSet ? "Nothing sent yet. It sends when an order is placed." : "Add the API secret to send purchases from the server.")}</div></div>
          <details class="trk__guide"><summary>Step-by-step: set up Google Analytics</summary>
            <h3>1. Create the property</h3>${steps([
              `Go to <a href="https://analytics.google.com" target="_blank" rel="noopener">analytics.google.com</a> › <b>Admin › Create › Property</b>. Name it "Ravelle", time zone <b>Bangladesh</b>, currency <b>Bangladeshi Taka (BDT)</b>.`,
              `Choose <b>Web</b> as the platform, enter <b>https://ravellebd.com</b>, and create the stream.`,
              `Copy the <b>Measurement ID</b> (G-…) into the box above and press Save. Skip Google's "install manually" code; the store adds it.`])}
            <h3>2. Send purchases from the server</h3>${steps([
              `In the same web stream page, open <b>Measurement Protocol API secrets › Create</b>. Accept the terms if asked.`,
              `Name it "Ravelle server", copy the <b>Secret value</b>, paste it above and Save.`,
              `Press <b>Check with Google</b>. Google checks the event and the result shows under the button.`])}
            <h3>3. Check it works</h3>${steps([
              `Open <b>Reports › Realtime</b> in Google Analytics, then open your store in another tab. You should appear within a minute.`,
              `Place a test order. It shows under <b>Reports › Monetization › Ecommerce purchases</b> within a few hours.`,
              `Optional: link Google Ads and Search Console under <b>Admin › Product links</b>.`])}
            <p class="muted small">Events the store sends: page_view, view_item_list, view_item, search, add_to_wishlist, add_to_cart, begin_checkout, add_payment_info, purchase, generate_lead, contact, and refund when you cancel or return an order.</p>
          </details></div>
        <div class="card"><h2 class="h2">Product feeds and search engines</h2>
          <p class="muted small" style="margin:0 0 10px">These links update by themselves whenever you change a product, price or stock. Give them to Meta and Google once; they re-read them on a schedule.${demo ? " <b>They work on the live store, not in this demo.</b>" : ""}</p>
          ${[["Meta catalog feed", "/feeds/meta.csv", "For Commerce Manager: catalog ads, Instagram and Facebook Shop."], ["Google Merchant Center feed", "/feeds/google.xml", "For Google Shopping, Performance Max and free listings."], ["Sitemap", "/sitemap.xml", "For Google Search Console and Bing Webmaster Tools."]]
            .map(([l, p, n]) => `<div class="field"><span>${l}</span><div class="flex"><input class="input mono" readonly value="${esc(location.origin + p)}" style="flex:1"><button class="btn btn--ghost btn--sm" type="button" data-copy="${esc(location.origin + p)}">Copy</button><a class="btn btn--ghost btn--sm" href="${p}" target="_blank" rel="noopener">Open ↗</a></div><small>${n}</small></div>`).join("")}
          <h3 class="h2" style="margin-top:18px">Instant updates to the Meta catalog</h3>
          <p class="muted small" style="margin:0 0 10px">With these filled in, every product you create, edit, delete or sell is sent to your catalog within seconds, so catalog ads and the Shop update right away. The feed link above still works as a backup.</p>
          <div class="row row--2">
            <label class="field"><span>Catalog ID</span><input class="input" name="catalogId" value="${esc(c.catalogId || "")}" placeholder="123456789012345" inputmode="numeric"><small>Commerce Manager › your catalog › Settings › Catalog ID.</small></label>
            <label class="field"><span>Catalog access token</span><input class="input" type="password" autocomplete="off" name="catalogToken" value="" placeholder="${c.catalogTokenSet ? "Saved. Paste a new one to replace it." : "System user token with catalog_management"}">
              <small>Kept on your server only.${c.catalogTokenSet ? ` <a href="#" id="catClear">Remove token</a>` : " Leave empty to use the Conversions API token, if it has catalog access."}</small></label></div>
          <div class="field"><span>Check it</span><div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="catSync">Send all products to Meta now</button></div><div id="catStatus">${c.catalogStatus ? `<p class="small" style="margin:0;color:${c.catalogStatus.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">Last update: ${esc(c.catalogStatus.message)} · ${dateTime(c.catalogStatus.at)}</p>` : `<p class="muted small" style="margin:0">${c.catalogId ? "Nothing sent yet." : "Not connected."}</p>`}</div></div>
          <details class="trk__guide"><summary>Step-by-step: get the catalog ID and token</summary>${steps([
              `In <a href="https://business.facebook.com/commerce" target="_blank" rel="noopener">Commerce Manager</a>, open your catalog › <b>Settings</b> and copy the <b>Catalog ID</b>.`,
              `Open <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Business Settings › Users › System users</a>, add one (role Admin) or pick your existing one.`,
              `Press <b>Assign assets</b> › <b>Catalogs</b> › your catalog › <b>Manage catalog</b>. Then press <b>Generate new token</b>, choose your app, tick <b>catalog_management</b> and <b>business_management</b>, and set it to never expire.`,
              `Paste the ID and token above, Save, then press <b>Send all products to Meta now</b>. The products appear in Commerce Manager › Items within a minute.`])}</details>
          <details class="trk__guide"><summary>Step-by-step: connect the feeds and sitemap</summary>
            <h3>Meta catalog (catalog ads and Shop)</h3>${steps([
              `Open <a href="https://business.facebook.com/commerce" target="_blank" rel="noopener">Commerce Manager</a> › <b>Add catalog</b> › <b>E-commerce</b> › <b>Upload product info</b>.`,
              `In the catalog, go to <b>Catalog › Data sources › Add items › Data feed</b> and choose <b>Use a URL</b>. Paste the Meta catalog feed link and set it to update <b>every hour</b>, currency BDT.`,
              `Under <b>Events</b>, connect the catalog to your Pixel. Product IDs already match (the SKU), so Meta can show people the exact pieces they viewed or added to the bag.`,
              `In Ads Manager, create a <b>Sales</b> campaign and turn on <b>Advantage+ catalog ads</b> with this catalog.`])}
            <h3>Google Merchant Center (Shopping)</h3>${steps([
              `Open <a href="https://merchants.google.com" target="_blank" rel="noopener">Merchant Center</a>, add and verify ravellebd.com, country <b>Bangladesh</b>, currency BDT.`,
              `Go to <b>Products › Add products › Add products from a file › Enter a link to your file</b>. Paste the Google feed link and set a <b>daily</b> fetch.`,
              `Turn on <b>free listings</b>. Link Google Ads to run Shopping or Performance Max campaigns.`])}
            <h3>Google Search Console</h3>${steps([
              `Open <a href="https://search.google.com/search-console" target="_blank" rel="noopener">Search Console</a> and add ravellebd.com as a <b>Domain</b> property (verify with a DNS record), or as a URL prefix using the HTML tag. Paste that tag into <b>Code inside &lt;head&gt;</b> below.`,
              `Open <b>Sitemaps</b>, enter <b>sitemap.xml</b> and press Submit. Do the same in <a href="https://www.bing.com/webmasters" target="_blank" rel="noopener">Bing Webmaster Tools</a> (it can import from Search Console).`,
              `After a few days, check <b>Pages</b> for errors and <b>Shopping › Product snippets</b> for the price data.`])}
          </details></div>
        <div class="card"><h2 class="h2">Other tracking code</h2><p class="muted small" style="margin:0">For TikTok Pixel, Google Search Console verification or any other snippet that says "paste in the head". You don't need this for Meta or Google Analytics.</p>
          <label class="field"><span>Code inside &lt;head&gt;</span><textarea class="input mono" name="head" rows="6" spellcheck="false" placeholder="&lt;!-- Paste code here --&gt;">${esc(c.head || "")}</textarea></label>
          <label class="field"><span>Code before &lt;/body&gt;</span><textarea class="input mono" name="bodyEnd" rows="4" spellcheck="false">${esc(c.bodyEnd || "")}</textarea></label>
          <p class="small" style="margin:0;color:var(--warn)">Only paste code from services you trust. It runs for every visitor.</p></div>
        <div class="sticky-save"><span class="small">Changes apply to the store right away.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>`;
    const form = $("#trkForm");
    let dirty = false;
    form.addEventListener("input", () => { dirty = true; });
    leaveGuard = () => !dirty || confirm("You have unsaved changes on this page. Leave without saving?");
    if ($("#capiClear")) $("#capiClear").onclick = (e) => { e.preventDefault(); form.dataset.capiClear = "1"; dirty = true; e.target.textContent = "Will be removed when you save"; };
    if ($("#gaClear")) $("#gaClear").onclick = (e) => { e.preventDefault(); form.dataset.gaClear = "1"; dirty = true; e.target.textContent = "Will be removed when you save"; };
    if ($("#catClear")) $("#catClear").onclick = (e) => { e.preventDefault(); form.dataset.catClear = "1"; dirty = true; e.target.textContent = "Will be removed when you save"; };
    $("#catSync").onclick = async () => {
      if (dirty) return toast("Save first, then send.", "warn");
      const out = $("#catStatus"), btn = $("#catSync");
      btn.disabled = true;
      try {
        const r = await api("POST", "/api/catalog/sync", {});
        out.innerHTML = `<p class="muted small" style="margin:0">${esc(r.message)}</p>`;
        setTimeout(async () => {
          try { const s2 = (await api("GET", "/api/settings")).settings.code.catalogStatus; if (s2) out.innerHTML = `<p class="small" style="margin:0;color:${s2.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">Last update: ${esc(s2.message)} · ${dateTime(s2.at)}</p>`; } catch (er) {}
        }, 5000);
      } catch (err) { out.innerHTML = `<p class="small" style="margin:0;color:var(--danger)">${esc(err.message)}</p>`; }
      btn.disabled = false;
    };
    $$("[data-copy]", form).forEach((b) => { b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Copied"), () => toast("Couldn't copy. Select the link and copy it.", "warn")); }; });
    $$("[data-test]", form).forEach((b) => {
      b.onclick = async () => {
        if (dirty) return toast("Save first, then test.", "warn");
        const kind = b.dataset.test, out = $(kind === "meta" ? "#metaStatus" : "#gaStatus");
        b.disabled = true; out.innerHTML = `<p class="muted small" style="margin:0">Sending…</p>`;
        try {
          const r = await api("POST", "/api/tracking/test", { kind });
          out.innerHTML = `<p class="small" style="margin:0;color:${r.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">${esc(r.message)}</p>`;
        } catch (err) { out.innerHTML = `<p class="small" style="margin:0;color:var(--danger)">${esc(err.message)}</p>`; }
        b.disabled = false;
      };
    });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, code = { pixelId: f.pixelId.value.trim(), capiTest: f.capiTest.value.trim(), gaId: f.gaId.value.trim(), head: f.head.value, bodyEnd: f.bodyEnd.value };
      if (f.capiToken.value.trim()) code.capiToken = f.capiToken.value.trim();
      if (f.gaSecret.value.trim()) code.gaSecret = f.gaSecret.value.trim();
      if (form.dataset.capiClear) code.capiTokenClear = true;
      if (form.dataset.gaClear) code.gaSecretClear = true;
      code.catalogId = f.catalogId.value.trim();
      if (f.catalogToken.value.trim()) code.catalogToken = f.catalogToken.value.trim();
      if (form.dataset.catClear) code.catalogTokenClear = true;
      try { await api("PUT", "/api/settings", { settings: { code } }); dirty = false; toast("Saved"); viewTracking(); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Pathao courier: send an order as a parcel, and the settings page
  // ---------------------------------------------------------------------------
  // Pick the Pathao city and zone whose names appear in the customer's address
  function pathaoGuess(items, text) {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    let best = null;
    items.forEach((x) => { const n = String(x.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (n && t.indexOf(" " + n + " ") > -1 && (!best || n.length > best.n.length)) best = { id: x.id, n }; });
    return best ? best.id : "";
  }
  async function pathaoQuickSend(o) {
    if (o.place && o.place.cityId && o.place.zoneId) {
      const r = await api("POST", "/api/orders/" + o.id + "/pathao", { cityId: o.place.cityId, zoneId: o.place.zoneId });
      return (r.order && r.order.pathao && r.order.pathao.consignmentId) || "sent";
    }
    const addr = [o.customer.address, o.customer.area, o.customer.city].filter(Boolean).join(", ");
    const cities = (await api("GET", "/api/pathao/cities")).items || [];
    const city = pathaoGuess(cities, addr) || ((cities.filter((x) => /dhaka/i.test(x.name))[0]) || {}).id;
    const zones = city ? (await api("GET", "/api/pathao/zones/" + city)).items || [] : [];
    const zone = pathaoGuess(zones, addr);
    if (!city || !zone) {
      // Not sure where it goes: open the form so the zone can be chosen
      return new Promise((resolve) => pathaoSendDialog(o, false, () => resolve("sent")));
    }
    const r = await api("POST", "/api/orders/" + o.id + "/pathao", { cityId: city, zoneId: zone });
    return (r.order && r.order.pathao && r.order.pathao.consignmentId) || "sent";
  }
  async function pathaoSendDialog(o, again, done) {
    const addr = [o.customer.address, o.customer.area, o.customer.city].filter(Boolean).join(", ");
    const pl = o.place || {};
    const due = o.paymentStatus === "paid" ? 0 : Math.round(o.total || 0);
    const body = modal("Send to Pathao", `<form class="stack" id="ptForm">
      <p class="muted small" style="margin:0">${esc(o.number)} · ${esc(o.customer.name)} · ${esc(addr)}</p>
      <div class="row row--2"><label class="field"><span>City</span><select class="input" name="cityId" required><option value="">Loading…</option></select></label>
      <label class="field"><span>Zone</span><select class="input" name="zoneId" required><option value="">Choose the city first</option></select></label></div>
      <label class="field"><span>Area (optional)</span><select class="input" name="areaId"><option value="">—</option></select></label>
      <div class="row row--2"><label class="field"><span>Cash to collect (৳)</span><input class="input" name="amount" type="number" min="0" step="1" value="${due}"><small>${o.paymentStatus === "paid" ? "Paid online, so nothing to collect." : "The order total, cash on delivery."}</small></label>
      <label class="field"><span>Weight (kg)</span><input class="input" name="weight" type="number" min="0.5" max="10" step="0.5" value="0.5"></label></div>
      <label class="field"><span>Note for the rider</span><input class="input" name="note" value="${esc(o.note || "")}" maxlength="200"></label>
      <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">${again ? "Send again" : "Send to Pathao"}</button></div></form>`);
    const f = $("#ptForm", body), sel = (el, items, pick) => { el.innerHTML = `<option value="">Choose…</option>` + items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(""); if (pick) el.value = pick; };
    const loadAreas = async () => { f.areaId.innerHTML = `<option value="">—</option>`; if (!f.zoneId.value) return; try { const r = await api("GET", "/api/pathao/areas/" + f.zoneId.value); sel(f.areaId, r.items || [], pathaoGuess(r.items || [], addr)); f.areaId.options[0].textContent = "—"; } catch (_) {} };
    const loadZones = async () => {
      f.zoneId.innerHTML = `<option value="">Loading…</option>`;
      try { const r = await api("GET", "/api/pathao/zones/" + f.cityId.value); sel(f.zoneId, r.items || [], (+f.cityId.value === pl.cityId && pl.zoneId) || pathaoGuess(r.items || [], addr)); loadAreas(); } catch (err) { fail(err); }
    };
    f.cityId.onchange = loadZones; f.zoneId.onchange = loadAreas;
    try {
      const r = await api("GET", "/api/pathao/cities");
      sel(f.cityId, r.items || [], pl.cityId || pathaoGuess(r.items || [], addr) || ((r.items || []).filter((x) => /dhaka/i.test(x.name))[0] || {}).id);
      if (f.cityId.value) loadZones();
    } catch (err) { closeModal(); return fail(err); }
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(f), btn = $("button[type=submit]", f);
      if (again) b.again = true;
      busy(btn, true);
      try { const r = await api("POST", "/api/orders/" + o.id + "/pathao", b); closeModal(); toast("Sent to Pathao · " + ((r.order && r.order.pathao && r.order.pathao.consignmentId) || "")); done(); }
      catch (err) { busy(btn, false); fail(err); }
    };
  }
  // Payments: each method has its own switch and details; checkout shows only the ones that are on
  async function viewPayments() {
    setTitle("Payments");
    let s;
    try { s = (await api("GET", "/api/settings")).settings; } catch (err) { return fail(err); }
    const p = s.payments, ssl = p.sslcommerz, bk = p.bkash, ng = p.nagad, owner = me.role === "owner", demo = window.Ravelle.mode === "demo";
    const lock = owner ? "" : " disabled";
    const inp = (id, label, val, extra, hint) => `<label class="field"><span>${label}</span><input class="input" id="${id}" value="${esc(val || "")}"${extra || ""}${lock}>${hint ? `<small>${hint}</small>` : ""}</label>`;
    const secret = (id, label, isSet, hint) => `<label class="field"><span>${label}</span><input class="input" id="${id}" type="password" autocomplete="new-password" placeholder="${isSet ? "Saved. Type a new one to change it" : "Not set"}"${lock}>${hint ? `<small>${hint}</small>` : ""}</label>`;
    const acct = (id, v) => `<label class="field"><span>Account type</span><select class="input" id="${id}"${lock}>${["Personal", "Merchant", "Agent"].map((a) => `<option${a === v ? " selected" : ""}>${a}</option>`).join("")}</select></label>`;
    const head = (id, title, on, text) => `<div class="pay-head"><div><h2 class="h2" style="margin:0">${title}</h2><p class="muted small" style="margin:2px 0 0">${text}</p></div>
      <label class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}${id === "payCod" ? "" : lock}> <span data-onoff>${on ? "On" : "Off"}</span></label></div>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Payments</h1><p class="muted">Turn each payment method on or off. Checkout shows only the ones that are on.</p></div></div>
      ${owner ? "" : `<p class="note">Only the store owner can change online payment details. You can turn cash on delivery on or off.</p>`}
      <form class="stack" id="payForm">
        <div class="card pay-card">${head("payCod", "Cash on delivery", p.cod, "The customer pays the rider. Pathao collects the money.")}</div>
        <div class="card pay-card">${head("paySsl", "SSLCOMMERZ", ssl.enabled, "Cards, bKash, Nagad, Rocket and internet banking on SSLCOMMERZ's secure page.")}
          <div class="row row--2">${inp("sslId", "Store ID", ssl.storeId, ` placeholder="From your SSLCOMMERZ merchant panel"`)}
          ${secret("sslPass", "Store password", ssl.storePasswordSet, ssl.envPassword ? "The server's .env file also has a password, and that one is used." : "Kept secret: it is never shown again after saving.")}</div>
          <label class="field"><span>Mode</span><select class="input" id="sslSandbox"${lock}><option value="1">Sandbox (testing)</option><option value="0"${ssl.sandbox ? "" : " selected"}>Live payments</option></select></label>
          <p class="small ${ssl.serverReady ? "" : "muted"}" style="margin:0">${demo ? "In this demo, online payments are simulated." : ssl.serverReady ? "✓ Ready: the store ID and password are set." : "Add the store ID and password to take online payments."}</p></div>
        <div class="card pay-card">${head("payBk", "bKash", bk.enabled, "Customers pay with bKash.")}
          <label class="field"><span>How customers pay</span><select class="input" id="bkMode"${lock}><option value="manual">Send Money to your number, then enter the TrxID</option><option value="api"${bk.mode === "api" ? " selected" : ""}>bKash payment page (API, needs a bKash merchant account)</option></select></label>
          <div data-bk="manual" class="row row--2">${inp("bkNum", "bKash number", bk.number, ` inputmode="numeric" placeholder="01XXXXXXXXX"`)}${acct("bkAcct", bk.accountType)}</div>
          <p data-bk="manual" class="muted small" style="margin:0">The order comes in as unpaid with the customer's TrxID. Check it in your bKash app, then set the order's Payment to Paid.</p>
          <div data-bk="api" class="stack stack--sm"><div class="row row--2">${inp("bkKey", "App key", bk.appKey)}${secret("bkSecret", "App secret", bk.appSecretSet)}</div>
            <div class="row row--2">${inp("bkUser", "Username", bk.username)}${secret("bkPass", "Password", bk.passwordSet)}</div>
            <label class="field"><span>Mode</span><select class="input" id="bkSandbox"${lock}><option value="1">Sandbox (testing)</option><option value="0"${bk.sandbox ? "" : " selected"}>Live payments</option></select></label>
            <p class="muted small" style="margin:0">bKash gives these four details when your merchant account is approved for the tokenized checkout. ${demo ? "In this demo, bKash payments are simulated." : "The order is marked paid by itself after bKash confirms the payment."}</p></div></div>
        <div class="card pay-card">${head("payNg", "Nagad", ng.enabled, "Customers Send Money by Nagad and enter the TrxID.")}
          <div class="row row--2">${inp("ngNum", "Nagad number", ng.number, ` inputmode="numeric" placeholder="01XXXXXXXXX"`)}${acct("ngAcct", ng.accountType)}</div>
          <p class="muted small" style="margin:0">The order comes in as unpaid with the customer's TrxID. Check it in your Nagad app, then set the order's Payment to Paid. The Nagad payment page (API) can be added once you have Nagad merchant keys.</p></div>
        <div class="sticky-save"><span class="small">Changes show at checkout right away.</span><button class="btn btn--dark" type="submit">Save payments</button></div>
      </form>`;
    const mode = () => $$("[data-bk]").forEach((el) => { el.hidden = el.dataset.bk !== $("#bkMode").value; });
    $("#bkMode").onchange = mode; mode();
    $("#payForm").addEventListener("change", (e) => { const t = e.target.closest(".pay-head input"); if (t) t.parentNode.querySelector("[data-onoff]").textContent = t.checked ? "On" : "Off"; });
    $("#payForm").onsubmit = async (e) => {
      e.preventDefault();
      const out = { cod: $("#payCod").checked };
      if (owner) {
        out.sslcommerz = { enabled: $("#paySsl").checked, sandbox: $("#sslSandbox").value === "1", storeId: $("#sslId").value.trim(), storePassword: $("#sslPass").value };
        out.bkash = { enabled: $("#payBk").checked, mode: $("#bkMode").value, sandbox: $("#bkSandbox").value === "1", number: $("#bkNum").value, accountType: $("#bkAcct").value,
          appKey: $("#bkKey").value.trim(), appSecret: $("#bkSecret").value, username: $("#bkUser").value.trim(), password: $("#bkPass").value };
        out.nagad = { enabled: $("#payNg").checked, number: $("#ngNum").value, accountType: $("#ngAcct").value };
      }
      const btn = e.submitter; busy(btn, true);
      try { await api("PUT", "/api/settings", { settings: { payments: out } }); toast("Payments saved"); store = null; viewPayments(); } catch (err) { busy(btn, false); fail(err); }
    };
  }

  async function viewPathao() {
    setTitle("Pathao");
    let s;
    try { s = (await api("GET", "/api/settings")).settings; } catch (err) { return fail(err); }
    const a = s.pathao || {}, demo = window.Ravelle.mode === "demo";
    const hookUrl = a.webhookUrl || (location.origin + "/api/pathao/webhook");
    const last = (x, none) => x ? `<span style="color:${x.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">${esc(x.message)}</span> <small class="muted">${dateTime(x.at)}</small>` : `<span class="muted">${none}</span>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Pathao courier</h1><p class="muted">Send an order to Pathao from its page in Orders. Pathao's status updates (picked, on the way, delivered, returned) change the order here by themselves, and customers see them on Track order.</p></div></div>
      <form class="stack" id="ptSet">
        <div class="card"><h2 class="h2">Sign-in details</h2><p class="muted small" style="margin:0 0 6px">From the Pathao merchant panel › Developer's API. Only the store owner can change these.</p>
          <div class="row row--2"><label class="field"><span>Client ID</span><input class="input" name="clientId" value="${esc(a.clientId || "")}" autocomplete="off"></label>
          <label class="field"><span>Client Secret</span><input class="input" type="password" name="clientSecret" autocomplete="off" placeholder="${a.clientSecretSet ? "Saved. Paste a new one to replace it." : ""}"></label></div>
          <div class="row row--2"><label class="field"><span>Pathao login email</span><input class="input" name="username" type="email" value="${esc(a.username || "")}" autocomplete="off"></label>
          <label class="field"><span>Pathao login password</span><input class="input" type="password" name="password" autocomplete="new-password" placeholder="${a.passwordSet ? "Saved. Type a new one to replace it." : ""}"></label></div>
          <label class="field"><span>Mode</span><select class="input" name="sandbox"><option value="0">Live (real parcels)</option><option value="1"${a.sandbox ? " selected" : ""}>Sandbox (testing)</option></select></label>
          ${demo ? `<p class="small" style="margin:0;color:var(--warn)">This demo has no server, so it can't talk to Pathao. This page works on the live store.</p>` : ""}</div>
        <div class="card"><h2 class="h2">Pickup store and parcel</h2>
          <div class="row row--2"><label class="field"><span>Store ID</span><input class="input" name="storeId" value="${esc(a.storeId || "")}" inputmode="numeric"><small>${a.storeName ? esc(a.storeName) : "Or press Check connection and pick it from the list."}</small></label>
          <label class="field"><span>Default weight (kg)</span><input class="input" type="number" name="weight" min="0.5" max="10" step="0.5" value="${a.weight || 0.5}"></label></div>
          <div class="row row--2"><label class="field"><span>Delivery</span><select class="input" name="deliveryType"><option value="48">Normal delivery</option><option value="12"${a.deliveryType === 12 ? " selected" : ""}>On-demand delivery</option></select></label>
          <label class="field"><span>Item type</span><select class="input" name="itemType"><option value="2">Parcel</option><option value="1"${a.itemType === 1 ? " selected" : ""}>Document</option></select></label></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="ptTest">Check connection</button><span class="small muted" id="ptMsg">Save first, then check.</span></div>
          <div id="ptStores"></div></div>
        <div class="card"><h2 class="h2">Paste these into Pathao</h2><p class="muted small" style="margin:0">Pathao merchant panel › Developer's API › Webhook. Works once this store is live on its own web address.</p>
          <div class="row row--2"><label class="field"><span>Callback URL</span><input class="input" readonly value="${esc(hookUrl)}" data-copy></label>
          <label class="field"><span>Webhook secret</span><input class="input" name="webhookSecret" autocomplete="off" value="${esc(a.webhookSecret || "")}" placeholder="Save once to make one"><small>The same secret as in Pathao. Paste yours here, or copy this one into Pathao.</small></label></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="ptNewSecret">Make a new secret</button><small class="muted">Making a new one stops the old one working, so update Pathao too.</small></div></div>
        <div class="card"><h2 class="h2">Status</h2><dl class="kv">
          <dt>Last parcel sent</dt><dd>${last(a.lastSend, "Nothing sent since the server started.")}</dd>
          <dt>Last update from Pathao</dt><dd>${last(a.lastWebhook, "No updates received since the server started.")}</dd></dl></div>
        <div class="sticky-save"><span class="small">Sign-in details are kept on your server and never shown again.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>`;
    $$("[data-copy]").forEach((el) => { el.onclick = () => { el.select(); try { navigator.clipboard.writeText(el.value); toast("Copied"); } catch (_) {} }; });
    let renew = false;
    $("#ptNewSecret").onclick = (e) => { renew = true; e.target.textContent = "A new secret is made when you save"; };
    $("#ptTest").onclick = async (e) => {
      busy(e.target, true); $("#ptMsg").textContent = "Checking…";
      try {
        const r = await api("POST", "/api/pathao/test");
        $("#ptMsg").textContent = r.message || "Connected";
        $("#ptStores").innerHTML = (r.stores || []).length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Store ID</th><th>Name</th><th>Address</th><th></th></tr></thead><tbody>${r.stores.map((x) => `<tr><td class="mono">${esc(x.id)}</td><td>${esc(x.name)}</td><td class="small">${esc(x.address || "")}</td><td><button class="btn btn--ghost btn--sm" type="button" data-store="${esc(x.id)}" data-name="${esc(x.name)}">Use</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="small muted">No pickup stores on this Pathao account yet.</p>`;
        $$("[data-store]").forEach((b) => { b.onclick = () => { $("#ptSet").storeId.value = b.dataset.store; $("#ptSet").dataset.storeName = b.dataset.name; toast("Store chosen. Press Save."); }; });
      } catch (err) { $("#ptMsg").textContent = err.message || "Couldn't connect"; }
      busy(e.target, false);
    };
    $("#ptSet").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, out = { enabled: true, clientId: f.clientId.value.trim(), username: f.username.value.trim(), sandbox: f.sandbox.value === "1",
        storeId: f.storeId.value.trim(), weight: f.weight.value, deliveryType: f.deliveryType.value, itemType: f.itemType.value };
      if (f.dataset.storeName && out.storeId) out.storeName = f.dataset.storeName; else if (out.storeId !== (a.storeId || "")) out.storeName = "";
      if (f.clientSecret.value.trim()) out.clientSecret = f.clientSecret.value.trim();
      if (f.password.value) out.password = f.password.value;
      const ws = f.webhookSecret.value.trim();
      if (renew) out.newSecret = true; else if (ws && ws !== a.webhookSecret && ws !== "Only the owner can see this") out.webhookSecret = ws;
      try { await api("PUT", "/api/settings", { settings: { pathao: out } }); toast("Pathao settings saved"); viewPathao(); } catch (err) { fail(err); }
    };
  }

  // Acore: website orders go to Acore; Acore sends status and courier updates back
  // ---------------------------------------------------------------------------
  async function viewAcore() {
    setTitle("Acore");
    let s;
    try { s = (await api("GET", "/api/settings")).settings; } catch (err) { return fail(err); }
    const a = s.acore || {}, demo = window.Ravelle.mode === "demo";
    const hookUrl = a.webhookUrl || (location.origin + "/api/acore/webhook");
    const last = (x, none) => x ? `<span style="color:${x.ok ? "var(--ok, #1e7d4f)" : "var(--danger)"}">${esc(x.message)}</span> <small class="muted">${dateTime(x.at)}</small>` : `<span class="muted">${none}</span>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Acore</h1><p class="muted">Every website order goes to Acore by itself. When you hold, cancel or send an order to the courier in Acore, the order here updates by itself, and customers see it on Track order.</p></div></div>
      <form class="stack" id="acForm">
        <div class="card"><h2 class="h2">Connection</h2>
          <label class="switch"><input type="checkbox" name="enabled" ${a.enabled ? "checked" : ""}> Connect to Acore</label>
          <div class="row row--2"><label class="field"><span>Acore address</span><input class="input" name="url" value="${esc(a.url || "")}" placeholder="https://acore.example.com"><small>The web address of your Acore app, without /api.</small></label>
          <label class="field"><span>Store API key</span><input class="input" type="password" autocomplete="off" name="apiKey" value="" placeholder="${a.apiKeySet ? "Saved. Paste a new one to replace it." : "From Acore › Stores › your store"}"><small>Acore makes this key when you add the store there.</small></label></div>
          ${demo ? `<p class="small" style="margin:0;color:var(--warn)">This demo has no server, so it can't talk to Acore. This page works on the live store.</p>` : ""}</div>
        <div class="card"><h2 class="h2">Paste these into Acore</h2><p class="muted small" style="margin:0">In Acore, open your store's settings and fill in its webhook with these two.</p>
          <div class="row row--2"><label class="field"><span>Webhook URL</span><input class="input mono" readonly value="${esc(hookUrl)}" data-copy></label>
          <label class="field"><span>Webhook secret</span><input class="input mono" readonly value="${esc(a.webhookSecret || "Save once to create it")}" data-copy></label></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" type="button" id="newSecret">Make a new secret</button><small class="muted">Making a new one stops the old one working, so update Acore too.</small></div></div>
        <div class="card"><h2 class="h2">Status</h2><dl class="kv">
          <dt>Last order sent</dt><dd>${last(a.lastSend, "Nothing sent since the server started.")}</dd>
          <dt>Last update from Acore</dt><dd>${last(a.lastWebhook, "No updates received since the server started.")}</dd>
          <dt>Connected since</dt><dd>${a.enabled && a.since ? dateTime(a.since) : "—"}</dd></dl>
          <p class="muted small" style="margin:0">Orders placed while connected are sent. If Acore can't be reached, the website keeps trying for two weeks. To send an older order, open it and press Send to Acore.</p></div>
        <div class="card"><h2 class="h2">How statuses match</h2>
          <div class="table-wrap"><table class="t"><thead><tr><th>In Acore</th><th>On the website</th><th>Customer sees</th></tr></thead><tbody>
          ${[["confirmed", "Confirmed", "Order confirmed"], ["hold", "On hold", "Order on hold. We'll contact you."], ["cancelled", "Cancelled (stock goes back)", "Order cancelled"],
            ["processing", "Processing", "Packing your order"], ["sent_to_courier", "Shipped", "Handed to the courier, with the parcel number"], ["in_transit", "Shipped", "On the way"], ["delivered", "Delivered (cash on delivery marked paid)", "Delivered"], ["returned", "Returned (stock goes back)", "Returned to us"]]
            .map((r) => `<tr><td class="mono">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="sticky-save"><span class="small">Saved settings take effect right away.</span><button class="btn btn--dark" type="submit">Save</button></div>
      </form>`;
    $$("[data-copy]").forEach((el) => { el.onclick = () => { el.select(); try { navigator.clipboard.writeText(el.value); toast("Copied"); } catch (_) {} }; });
    let renew = false;
    $("#newSecret").onclick = (e) => { renew = true; e.target.textContent = "A new secret is made when you save"; };
    $("#acForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, out = { enabled: f.enabled.checked, url: f.url.value.trim() };
      if (f.apiKey.value.trim()) out.apiKey = f.apiKey.value.trim();
      if (renew) out.newSecret = true;
      if (out.enabled && (!out.url || !(out.apiKey || a.apiKeySet))) return toast("Add the Acore address and API key to connect.", "warn");
      try { await api("PUT", "/api/settings", { settings: { acore: out } }); toast("Acore settings saved"); viewAcore(); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Analytics: traffic, sources, devices, funnel, sales, products and customers
  // ---------------------------------------------------------------------------
  let anDays = 30;
  const pageName = (p) => {
    const named = { home: "Home", shop: "Shop", men: "Men", women: "Women", "new-in": "New in", "on-sale": "On sale", checkout: "Checkout", search: "Search results",
      track: "Track order", saved: "Saved items", about: "About us", contact: "Contact us", order: "Order confirmation" };
    if (named[p]) return named[p];
    if (/^product\//.test(p)) return "Product: " + p.slice(8).replace(/-/g, " ");
    if (/^category\//.test(p)) return "Category: " + p.slice(9).replace(/-/g, " ");
    return p.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  };
  async function viewAnalytics() {
    setTitle("Analytics");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Analytics</h1><p class="muted">Visitors, where they come from, what they do, and what they buy.</p></div>
      <div class="flex"><div class="tabs" id="anRange">${[[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "12 months"]].map(([d, l]) => `<button class="tab${d === anDays ? " is-on" : ""}" data-d="${d}">${l}</button>`).join("")}</div>
      <button class="btn btn--ghost btn--sm" id="anCsv" disabled>Export CSV</button></div></div>
      <div id="an"><p class="muted">Loading…</p></div>`;
    $("#anRange").onclick = (e) => { const b = e.target.closest("[data-d]"); if (b) { anDays = +b.dataset.d; viewAnalytics(); } };
    let d;
    try { d = await api("GET", "/api/analytics?days=" + anDays); } catch (err) { return fail(err); }
    const t = d.totals, p = d.previous, tr = d.traffic, pct = (a, b) => (b ? (a / b * 100).toFixed(1) : "0.0") + "%";
    const delta = (a, b) => {
      if (!b) return `<span class="kpi__delta">${a ? "New this period" : "No data before"}</span>`;
      const ch = (a - b) / b * 100;
      return `<span class="kpi__delta"><b class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(1)}%</b> vs previous period</span>`;
    };
    const kpi = (label, value, sub) => `<div class="kpi"><span class="kpi__label">${label}</span><span class="kpi__value">${value}</span>${sub}</div>`;
    const card = (title, body, note) => `<div class="card"><h2 class="h2">${title}</h2>${note ? `<p class="muted small" style="margin:-4px 0 4px">${note}</p>` : ""}${body}</div>`;
    const share = (rows) => { const sum = rows.reduce((s, r) => s + r.value, 0) || 1; return rows.map((r) => ({ label: `${r.label} · ${Math.round(r.value / sum * 100)}%`, value: r.value })); };
    const table = (head, rows) => rows.length ? `<div class="table-wrap"><table class="t"><thead><tr>${head.map((h, i) => `<th${i ? ' class="right"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="right num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">No data in this period.</p>`;
    let series = d.series;
    const byWeek = series.length > 92;
    if (byWeek) {
      const w = [];
      for (let i = 0; i < series.length; i += 7) {
        const c = series.slice(i, i + 7), s = (k) => c.reduce((a, x) => a + x[k], 0);
        w.push({ date: c[0].date, visits: s("visits"), pageviews: s("pageviews"), orders: s("orders"), revenue: s("revenue"), newVisitors: s("newVisitors") });
      }
      series = w;
    }
    const lab = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const per = byWeek ? "per week" : "per day";
    const funnelTop = d.funnel[0].value || 1;
    const funnel = `<div class="funnel">${d.funnel.map((f, i) => `<div class="funnel__row"><span class="funnel__label">${esc(f.label)}</span>
      <span class="hbar__track"><span class="hbar__fill" style="width:${(f.value / funnelTop * 100).toFixed(1)}%"></span></span>
      <span class="num"><b>${int(f.value)}</b> <small class="muted">${pct(f.value, funnelTop)}${i ? ` · ${pct(f.value, d.funnel[i - 1].value)} of previous step` : ""}</small></span></div>`).join("")}</div>`;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hourLab = (h) => (h % 12 || 12) + (h < 12 ? "am" : "pm");
    $("#an").innerHTML = `
      <div class="kpis">
        ${kpi("Visitors", int(tr.visits), delta(t.visits, p.visits))}
        ${kpi("Page views", int(tr.pageviews), `<span class="kpi__delta">${tr.pagesPerVisit} pages per visit</span>`)}
        ${kpi("New visitors", pct(tr.newVisitors, tr.visits), `<span class="kpi__delta">${int(tr.newVisitors)} first-time · ${int(tr.visits - tr.newVisitors)} returning</span>`)}
        ${kpi("Conversion rate", t.conversion + "%", delta(t.conversion, p.conversion))}
        ${kpi("Revenue", taka(t.revenue), delta(t.revenue, p.revenue))}
        ${kpi("Orders", int(t.orders), delta(t.orders, p.orders))}
        ${kpi("Average order", taka(t.aov), delta(t.aov, p.aov))}
        ${kpi("Abandoned checkouts", int(d.rates.abandoned), `<span class="kpi__delta">${d.rates.bagToOrder}% of bags become orders</span>`)}
      </div>
      <div class="cols cols--even" style="margin-top:18px">
        <div class="card"><div class="card__head"><h2 class="h2">Visitors ${per}</h2></div><div class="chart" id="aVis"></div></div>
        <div class="card"><div class="card__head"><h2 class="h2">Revenue ${per}</h2></div><div class="chart" id="aRev"></div></div>
      </div>
      <div class="cols cols--even" style="margin-top:18px">
        ${card("Shopping funnel", funnel, "How many visitors reach each step. Each visitor is counted once a day.")}
        <div class="card"><div class="card__head"><h2 class="h2">Page views ${per}</h2></div><div class="chart" id="aPv"></div></div>
      </div>
      <h2 class="h2" style="margin:26px 0 10px">Where visitors come from</h2>
      <div class="cols cols--even">
        ${card("Traffic sources", hbars(share(d.sources)), "From the link people clicked: Facebook, Instagram, Google, or typed in (Direct). Add ?utm_source=name to links in your ads to name them.")}
        ${card("Revenue by source", hbars(d.revenueBySource, taka), "Which source the buyer first came from.")}
      </div>
      <div class="cols cols--even" style="margin-top:18px">
        ${card("Landing pages", hbars(d.landing.map((r) => ({ label: pageName(r.label), value: r.value }))), "The first page people open.")}
        ${card("Most viewed pages", hbars(d.pages.slice(0, 12).map((r) => ({ label: pageName(r.label), value: r.value }))))}
      </div>
      <h2 class="h2" style="margin:26px 0 10px">Devices</h2>
      <div class="cols cols--3">
        ${card("Device", hbars(share(d.devices)))}
        ${card("Browser", hbars(share(d.browsers)))}
        ${card("Operating system", hbars(share(d.systems)))}
      </div>
      <h2 class="h2" style="margin:26px 0 10px">When people shop <small class="muted">(Bangladesh time)</small></h2>
      <div class="cols cols--even">
        <div class="card"><h2 class="h2">Visitors by hour</h2><div class="chart" id="aHour"></div></div>
        <div class="card"><h2 class="h2">Orders by day of week</h2><div class="chart" id="aWeek"></div></div>
      </div>
      <h2 class="h2" style="margin:26px 0 10px">Search</h2>
      <div class="cols cols--even">
        ${card("What people search for", hbars(d.searches))}
        ${card("Searches with no results", hbars(d.noResults), "Products people want that the store doesn't have yet.")}
      </div>
      <h2 class="h2" style="margin:26px 0 10px">Sales</h2>
      <div class="cols cols--3">
        ${card("Payment method", hbars(Object.keys(d.byPayment).map((k) => ({ label: PAY_LABEL[k] || k, value: d.byPayment[k] })), taka))}
        ${card("Payment status", hbars(d.paymentStatus.map((r) => ({ label: human(r.label), value: r.value }))))}
        ${card("Order status", hbars(STATUSES.map((s) => ({ label: human(s), value: d.byStatus[s] || 0 })).filter((r) => r.value)) +
          `<dl class="kv" style="margin-top:10px"><dt>Cancelled</dt><dd>${d.rates.cancelled}%</dd><dt>Returned</dt><dd>${d.rates.returned}%</dd><dt>Discounts given</dt><dd>${taka(t.discounts)}</dd><dt>Items sold</dt><dd>${int(t.items)}</dd></dl>`)}
      </div>
      <div class="cols cols--even" style="margin-top:18px">
        ${card("Revenue by city", hbars(d.revenueByCity, taka))}
        ${card("Revenue by category", hbars(d.categories.map((c) => ({ label: c.name, value: c.revenue })), taka))}
      </div>
      <div class="cols cols--even" style="margin-top:18px">
        ${card("Sizes sold", hbars(d.sizes), "Units sold per size. Use it to plan stock.")}
        ${card("Colours sold", hbars(d.colours))}
      </div>
      <div class="card card--flush" style="margin-top:18px"><div class="card__head" style="padding:16px 18px 6px"><div><h2 class="h2">Products</h2><p class="muted small">Click a column to sort. Conversion = orders ÷ views.</p></div></div>
        <div class="table-wrap"><table class="t" id="anProd"></table></div></div>
      <h2 class="h2" style="margin:26px 0 10px">Customers</h2>
      <div class="cols cols--even">
        ${card("New and returning", hbars([{ label: "New customers", value: d.customers.newRevenue }, { label: "Returning customers", value: d.customers.returningRevenue }], taka) +
          `<dl class="kv" style="margin-top:10px"><dt>Bought this period</dt><dd>${int(d.customers.buyers)}</dd><dt>Bought before too</dt><dd>${int(d.customers.returning)}</dd><dt>All customers</dt><dd>${int(d.customers.total)}</dd></dl>`, "Revenue from first-time buyers and people who bought before.")}
        ${card("Top customers", table(["Customer", "Orders", "Spent"], d.customers.top.map((c) => [`${esc(c.name)}<br><small class="muted">${esc(c.phone)}</small>`, c.orders, taka(c.revenue)])))}
      </div>
      <div style="margin-top:18px">${card("Coupons", table(["Code", "Orders", "Discount given", "Revenue"], d.coupons.map((c) => [`<b class="mono">${esc(c.code)}</b>`, c.orders, taka(c.discount), taka(c.revenue)])))}</div>`;
    const rows = (key, fmt, unit) => series.map((s) => ({ label: lab(s.date), value: s[key], tip: `<b>${byWeek ? "Week of " : ""}${lab(s.date)}</b><br>${fmt(s[key])} ${unit}` }));
    chart($("#aVis"), series.map((s) => ({ label: lab(s.date), value: s.visits, tip: `<b>${byWeek ? "Week of " : ""}${lab(s.date)}</b><br>${int(s.visits)} visitors · ${int(s.newVisitors)} new` })), { label: "Visitors", type: "line" });
    chart($("#aRev"), series.map((s) => ({ label: lab(s.date), value: s.revenue, tip: `<b>${byWeek ? "Week of " : ""}${lab(s.date)}</b><br>${taka(s.revenue)} · ${s.orders} order${s.orders === 1 ? "" : "s"}` })), { label: "Revenue", format: taka, short: shortTaka });
    chart($("#aPv"), rows("pageviews", int, "page views"), { label: "Page views", type: "line" });
    chart($("#aHour"), d.hours.map((h, i) => ({ label: hourLab(i), value: h.visits, tip: `<b>${hourLab(i)}–${hourLab((i + 1) % 24)}</b><br>${int(h.visits)} visitors · ${h.orders} order${h.orders === 1 ? "" : "s"}` })), { label: "Visitors by hour" });
    chart($("#aWeek"), d.weekdays.map((w, i) => ({ label: days[i], value: w.orders, tip: `<b>${days[i]}</b><br>${w.orders} order${w.orders === 1 ? "" : "s"} · ${taka(w.revenue)}` })), { label: "Orders by day of week" });
    let sortKey = "revenue", dir = -1;
    const cols = [["name", "Product"], ["views", "Views"], ["carts", "Add to bag"], ["orders", "Orders"], ["units", "Units"], ["revenue", "Revenue"], ["conversion", "Conversion"], ["stock", "Stock"]];
    const drawProd = () => {
      const list = d.products.slice().sort((a, b) => (a[sortKey] > b[sortKey] ? 1 : a[sortKey] < b[sortKey] ? -1 : 0) * dir);
      $("#anProd").innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th class="sortable${k === "name" ? "" : " right"}" data-k="${k}">${l}${k === sortKey ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead><tbody>${list.map((x) => `
        <tr class="is-link" data-href="#/products/${esc(x.id)}"><td><div class="flex" style="flex-wrap:nowrap">${x.image ? `<img class="thumb" src="${esc(x.image)}" alt="" loading="lazy">` : ""}<span>${esc(x.name)}<br><small class="muted mono">${esc(x.sku)}</small></span></div></td>
        <td class="right num">${int(x.views)}</td><td class="right num">${int(x.carts)}</td><td class="right num">${int(x.orders)}</td><td class="right num">${int(x.units)}</td><td class="right num">${taka(x.revenue)}</td><td class="right num">${x.conversion}%</td><td class="right num">${x.stock == null ? "—" : int(x.stock)}</td></tr>`).join("")}</tbody>`;
    };
    drawProd();
    $("#anProd").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (!th) return;
      if (sortKey === th.dataset.k) dir = -dir; else { sortKey = th.dataset.k; dir = th.dataset.k === "name" ? 1 : -1; }
      drawProd();
    });
    const btn = $("#anCsv");
    btn.disabled = false;
    btn.onclick = () => {
      const out = [["Report", "Item", "Value"]];
      const add = (name, list, fmt) => list.forEach((r) => out.push([name, r.label, fmt ? fmt(r) : r.value]));
      series.forEach((s) => out.push(["Daily", s.date, `${s.visits} visitors; ${s.pageviews} page views; ${s.orders} orders; ${s.revenue} BDT`]));
      add("Funnel", d.funnel); add("Traffic source", d.sources); add("Revenue by source (BDT)", d.revenueBySource);
      add("Device", d.devices); add("Browser", d.browsers); add("Operating system", d.systems);
      add("Landing page", d.landing.map((r) => ({ label: pageName(r.label), value: r.value }))); add("Page", d.pages.map((r) => ({ label: pageName(r.label), value: r.value })));
      add("Search", d.searches); add("Search with no results", d.noResults);
      add("Revenue by city (BDT)", d.revenueByCity); add("Size sold", d.sizes); add("Colour sold", d.colours);
      d.products.forEach((x) => out.push(["Product", x.name, `${x.views} views; ${x.carts} add to bag; ${x.orders} orders; ${x.units} units; ${x.revenue} BDT`]));
      download(`ravelle-analytics-${anDays}d.csv`, csv(out));
    };
  }

  // ---------------------------------------------------------------------------
  // Integrations: API keys, webhooks and the AI chat hookup
  // ---------------------------------------------------------------------------
  async function viewIntegrations() {
    setTitle("Integrations");
    const [k, w, lg] = await Promise.all([api("GET", "/api/keys"), api("GET", "/api/webhooks"), api("GET", "/api/webhooks-log")]).catch((err) => { fail(err); return [{ keys: [] }, { webhooks: [], events: [] }, { log: [] }]; });
    const base = window.Ravelle.mode === "demo" ? "https://your-domain.com" : location.origin + (PATHS ? "" : location.pathname.replace(/admin(\.html)?\/?$/, "").replace(/\/$/, ""));
    view.innerHTML = `<div class="head"><div><h1 class="h1">Integrations</h1><p class="muted">Connect other software to your store: AI chat replies, courier and accounting tools, Google Sheets, Zapier or your own apps.</p></div><a class="btn btn--ghost" href="docs/API.md" target="_blank" rel="noopener">Full API guide ↗</a></div>
      ${window.Ravelle.mode === "demo" ? `<div class="demo-hint">This is the browser demo. Keys and webhooks you make here only work once the store runs on your Node server.</div>` : ""}
      <div class="card"><div class="card__head"><div><h2 class="h2">API keys</h2><p class="muted small" style="margin:0">Send a key as <span class="code">Authorization: Bearer rk_…</span>. Read keys can only look; write keys can also change orders, stock, products and reply to chats.</p></div><button class="btn btn--dark btn--sm" id="kAdd">Create key</button></div>
        ${k.keys.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Key</th><th>Access</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>${k.keys.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="mono">${esc(x.prefix)}…</td><td>${x.scope === "write" ? "Read and write" : "Read only"}</td><td>${date(x.createdAt)}</td><td>${ago(x.lastUsed)}</td><td class="right"><button class="btn btn--danger btn--sm" data-revoke="${x.id}">Revoke</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No keys yet.</p>`}</div>
      <div class="card"><div class="card__head"><div><h2 class="h2">Webhooks</h2><p class="muted small" style="margin:0">We POST JSON to your address when something happens, signed with <span class="code">X-Ravelle-Signature: sha256=…</span> (HMAC of the body with the secret). Failed deliveries retry 3 times.</p></div><button class="btn btn--dark btn--sm" id="wAdd">Add webhook</button></div>
        ${w.webhooks.length ? `<div class="stack">${w.webhooks.map((h) => `<div class="attr"><div class="flex flex--between"><div><b>${esc(h.name || h.url)}</b> ${pill(h.active ? "active" : "inactive")}<br><small class="muted mono">${esc(h.url)}</small></div>
          <div class="flex"><button class="btn btn--ghost btn--sm" data-test="${h.id}">Send test</button><button class="btn btn--ghost btn--sm" data-hedit="${h.id}">Edit</button><button class="btn btn--danger btn--sm" data-hdel="${h.id}">Delete</button></div></div>
          <div class="chips">${h.events.map((e) => `<span class="tag">${esc(e)}</span>`).join("")}</div><div class="small muted">Secret: <span class="code" data-secret="${esc(h.secret)}">whsec_••••••••</span> <button class="btn btn--link" type="button" data-reveal>Show</button></div></div>`).join("")}</div>` : `<p class="muted">No webhooks yet.</p>`}
        <details class="group"><summary>Recent deliveries (${lg.log.length})</summary><div class="group__body">${lg.log.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Event</th><th>Address</th><th>Result</th></tr></thead><tbody>${lg.log.slice(0, 50).map((l) => `<tr><td class="nowrap">${dateTime(l.at)}</td><td class="mono">${esc(l.event)}</td><td class="small">${esc(l.url)}</td><td>${l.ok === null ? `<span class="tag">${esc(l.status)}</span>` : l.ok ? pill("delivered").replace("Delivered", esc(String(l.status || "OK"))) : pill("failed").replace("Failed", esc(String(l.status || l.error || "Failed")))}${l.attempt > 1 ? ` <small class="muted">try ${l.attempt}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nothing sent yet.</p>`}</div></details></div>
      <div class="card"><h2 class="h2">Connect an AI chat reply tool</h2><ol class="small" style="margin:0;padding-left:18px;display:grid;gap:6px">
        <li>Create a <b>read and write</b> API key above and give it to your AI tool.</li>
        <li>Add a webhook for <span class="code">chat.message.created</span> pointing at your tool, so it hears about each new customer message instantly. (Or poll <span class="code">GET /api/chats?status=open&amp;messages=1</span>.)</li>
        <li>Your tool replies with <span class="code">POST /api/chats/{chatId}/messages</span> and <span class="code">{"text": "…"}</span>. The reply appears in the customer's chat window within a few seconds, marked as the bot.</li>
        <li>In <a href="#/settings">Settings → Live chat</a>, turn the automatic reply off so customers only see the AI's answer.</li></ol>
        <pre class="code">curl -X POST ${esc(base)}/api/chats/CHAT_ID/messages \\
  -H "Authorization: Bearer rk_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"text":"Yes, the Fearless tee in XL is in stock."}'</pre></div>
      <div class="card"><h2 class="h2">Most used endpoints</h2><div class="table-wrap"><table class="t"><tbody>
        ${[["GET", "/api/orders?status=pending", "List orders (add &full=1 for items and addresses)"], ["GET", "/api/orders/RV1001", "One order"], ["PATCH", "/api/orders/RV1001", '{"status":"shipped","tracking":"…"}'],
          ["GET", "/api/products", "All products with variations, SKUs and stock"], ["POST", "/api/products", "Create a product"], ["GET", "/api/stock", "Stock for every SKU"], ["PATCH", "/api/stock", '{"items":[{"sku":"RV-FRL-BLK-M","stock":12}]} or "delta":-1'],
          ["GET", "/api/customers", "Customers with order count and spend"], ["GET", "/api/chats?status=open", "Open chats"], ["POST", "/api/chats/:id/messages", "Reply in a chat"], ["GET", "/api/dashboard?days=30", "Sales and product analytics"]]
          .map(([m, p, d]) => `<tr><td class="mono"><b>${m}</b></td><td class="mono">${esc(p)}</td><td class="small muted">${esc(d)}</td></tr>`).join("")}</tbody></table></div>
        <p class="small muted" style="margin:0">Base address: <span class="code">${esc(base)}</span></p></div>`;
    $("#kAdd").onclick = () => {
      modal("Create API key", `<form class="stack" id="kForm"><label class="field"><span>Name</span><input class="input" name="name" required placeholder="AI chat bot, Courier sync…"></label>
        <label class="field"><span>Access</span><select class="input" name="scope"><option value="read">Read only</option><option value="write">Read and write</option></select></label>
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Create key</button></div></form>`);
      $("#kForm").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api("POST", "/api/keys", formData(e.target));
          modal("Copy your key now", `<p class="muted" style="margin:0">This is the only time the full key is shown. Store it somewhere safe.</p><div class="secret"><span class="code" id="newKey">${esc(r.key)}</span><button class="btn btn--dark btn--sm" id="copyKey">Copy</button></div><div class="modal__foot"><button class="btn btn--ghost" data-modal-close>Done</button></div>`, { onClose: viewIntegrations });
          $("#copyKey").onclick = () => navigator.clipboard && navigator.clipboard.writeText(r.key).then(() => toast("Key copied"));
        } catch (err) { fail(err); }
      };
    };
    const hookForm = (h) => {
      const isNew = !h.id;
      modal(isNew ? "Add webhook" : "Edit webhook", `<form class="stack" id="wForm"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(h.name || "")}" placeholder="AI chat, Courier…"></label>
        <label class="field"><span>Address (URL)</span><input class="input" name="url" required value="${esc(h.url || "")}" placeholder="https://…"></label>
        <div class="field"><span>Events</span><div class="row">${w.events.map((e) => `<label class="check"><input type="checkbox" name="ev" value="${e}" ${(h.events || []).indexOf(e) > -1 ? "checked" : ""}> <span class="mono" style="text-transform:none">${e}</span></label>`).join("")}</div></div>
        <label class="switch"><input type="checkbox" name="active" ${h.active !== false ? "checked" : ""}> Active</label>
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save</button></div></form>`);
      $("#wForm").onsubmit = async (e) => {
        e.preventDefault();
        const b = formData(e.target);
        const body = { name: b.name, url: b.url, active: b.active, events: $$("[name=ev]:checked", e.target).map((x) => x.value) };
        try { isNew ? await api("POST", "/api/webhooks", body) : await api("PUT", "/api/webhooks/" + h.id, body); closeModal(); toast("Webhook saved"); viewIntegrations(); } catch (err) { fail(err); }
      };
    };
    $("#wAdd").onclick = () => hookForm({ events: ["order.created", "order.updated"] });
    view.onclick = async (e) => {
      const t = e.target;
      const rv = t.closest("[data-revoke]"), te = t.closest("[data-test]"), he = t.closest("[data-hedit]"), hd = t.closest("[data-hdel]");
      if (rv && (await confirmBox("Revoke this key?", "Apps using it stop working right away.", "Revoke", true))) { await api("DELETE", "/api/keys/" + rv.dataset.revoke).catch(fail); viewIntegrations(); }
      if (te) { await api("POST", "/api/webhooks/" + te.dataset.test + "/test").then(() => toast("Test sent. Check Recent deliveries in a moment."), fail); setTimeout(() => { if (cur() === "integrations") viewIntegrations(); }, 2500); }
      if (he) hookForm(w.webhooks.find((x) => x.id === he.dataset.hedit));
      if (hd && (await confirmBox("Delete this webhook?", "We'll stop sending events to it.", "Delete", true))) { await api("DELETE", "/api/webhooks/" + hd.dataset.hdel).catch(fail); viewIntegrations(); }
      if (t.closest("[data-reveal]")) { const s = t.parentElement.querySelector("[data-secret]"); s.textContent = s.dataset.secret; t.remove(); }
    };
  }

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------
  function viewAccount() {
    setTitle("Your account");
    view.innerHTML = `<div class="head"><div><h1 class="h1">Your account</h1><p class="muted">${esc(me.email)} · ${esc(human(me.role))}</p></div></div>
      <form class="card" id="acForm" style="max-width:520px"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(me.name)}"></label>
        <label class="field"><span>Current password</span><input class="input" name="currentPassword" type="password" autocomplete="current-password"></label>
        <label class="field"><span>New password</span><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
        <button class="btn btn--dark" type="submit" style="justify-self:start">Save</button></form>`;
    $("#acForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(e.target);
      if (!b.password) { delete b.password; delete b.currentPassword; }
      try { me = (await api("PATCH", "/api/auth/me", b)).user; toast("Saved"); drawSide(); e.target.reset(); viewAccount(); } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Shell: sidebar, router, sign in
  // ---------------------------------------------------------------------------
  const NAV = [
    ["", [["dashboard", "Dashboard", "dashboard"], ["analytics", "Analytics", "dashboard"]]],
    ["Sales", [["orders", "Orders", "orders"], ["carts", "Abandoned carts", "orders"], ["customers", "Customers", "customers"], ["subscribers", "Subscribers", "customers"], ["coupons", "Coupons & offers", "coupons"]]],
    ["Catalog", [["products", "Products", "products"], ["stock", "Stock", "products"], ["bulk", "Bulk edit", "products"], ["categories", "Categories", "catalog"], ["variations", "Variations", "catalog"], ["sizecharts", "Size charts", "catalog"], ["labels", "Price tags", "products"]]],
    ["Website", [["pages", "Pages", "content"], ["menus", "Menus", "content"], ["layout", "Header & footer", "settings"], ["tracking", "Pixel & Analytics", "settings"], ["popup", "Popup banner", "content"], ["media", "Media library", "content"]]],
    ["Inbox", [["chat", "Live chat", "chat"], ["messages", "Messages", "messages"], ["franchise", "Franchise requests", "franchise"]]],
    ["Admin", [["users", "Users", "users"], ["settings", "Settings", "settings"], ["payments", "Payments", "settings"], ["email", "Email & reminders", "settings"], ["integrations", "API & webhooks", "integrations"], ["acore", "Acore", "settings"], ["pathao", "Pathao", "settings"], ["trash", "Trash", "trash"]]]
  ];
  const counts = { orders: 0, chat: 0, messages: 0, franchise: 0, carts: 0 };
  function drawSide() {
    const curPage = (cur().split(/[/?]/)[0]) || "dashboard";
    $("#sideNav").innerHTML = NAV.map(([g, items]) => {
      const vis = items.filter((i) => can(i[2]));
      if (!vis.length) return "";
      return (g ? `<p class="side__group mono">${g}</p>` : "") + vis.map(([k, l]) => `<a href="#/${k}"${k === curPage ? ' aria-current="page"' : ""}><span>${l}</span>${counts[k] ? `<span class="side__count">${counts[k]}</span>` : ""}</a>`).join("");
    }).join("");
    $("#sideUser").innerHTML = `${esc(me.name)}<small>${esc(me.email)}</small>`;
  }
  async function refreshCounts() {
    const jobs = [];
    if (can("orders")) jobs.push(api("GET", "/api/orders?status=pending").then((r) => { counts.orders = r.total; }, () => {}));
    if (can("chat")) jobs.push(api("GET", "/api/chats?status=open").then((r) => { counts.chat = r.chats.reduce((s, c) => s + (c.unread ? 1 : 0), 0); }, () => {}));
    if (can("messages")) jobs.push(api("GET", "/api/messages").then((r) => { counts.messages = r.messages.filter((m) => !m.read).length; }, () => {}));
    if (can("orders")) jobs.push(api("GET", "/api/carts").then((r) => { counts.carts = r.stats.open; }, () => {}));
    if (can("franchise")) jobs.push(api("GET", "/api/franchise").then((r) => { counts.franchise = r.requests.filter((m) => !m.read).length; }, () => {}));
    await Promise.all(jobs);
    drawSide();
  }
  async function loadStore(force) {
    if (store && !force) return store;
    store = await api("GET", "/api/store");
    // Admin views need drafts and every category too.
    return store;
  }
  // Clean admin addresses (/admin/orders/RV1001) on the live server; the browser demo keeps #/ links
  const PATHS = /^\/admin(\/|$)/.test(location.pathname);
  function cur() { return PATHS ? location.pathname.replace(/^\/admin\/?/, "") + (location.search ? "?" + location.search.slice(1) : "") : location.hash.replace(/^#\/?/, ""); }
  function go(r, replace) {
    r = String(r || "").replace(/^#\/?/, "").replace(/^\/admin\/?/, "");
    if (!PATHS) { if (replace) location.replace("#/" + r); else location.hash = "#/" + r; return; }
    history[replace ? "replaceState" : "pushState"](null, "", "/admin/" + r);
    route();
  }
  function setTitle(t) { $("#topTitle").textContent = t; document.title = t + " · Ravelle admin"; }
  function notFound() { view.innerHTML = `<p class="empty">That page doesn't exist. <a href="#/dashboard">Go to the dashboard</a></p>`; }

  const ROUTES = [
    [/^dashboard$/, viewDashboard, "dashboard"], [/^analytics$/, viewAnalytics, "dashboard"], [/^layout$/, viewLayout, "settings"], [/^tracking$/, viewTracking, "settings"], [/^popup$/, viewPopup, "content"],
    [/^orders$/, viewOrders, "orders"], [/^orders\/([^/]+)\/invoice$/, viewInvoice, "orders"], [/^orders\/([^/]+)\/courier-invoice$/, viewCourierInvoice, "orders"], [/^invoices$/, viewInvoices, "orders"], [/^orders\/([^/]+)$/, viewOrder, "orders"],
    [/^customers$/, viewCustomers, "customers"], [/^customers\/([^/]+)$/, viewCustomer, "customers"], [/^subscribers$/, viewSubscribers, "customers"],
    [/^coupons$/, viewCoupons, "coupons"], [/^franchise$/, viewFranchise, "franchise"], [/^carts$/, viewCarts, "orders"], [/^email$/, viewEmail, "settings"],
    [/^products$/, viewProducts, "products"], [/^products\/([^/]+)$/, viewProduct, "products"], [/^stock$/, viewStock, "products"], [/^bulk$/, viewBulk, "products"],
    [/^categories$/, viewCategories, "catalog"], [/^variations$/, viewVariations, "catalog"], [/^sizecharts$/, viewSizeCharts, "catalog"], [/^sizecharts\/([^/]+)$/, viewSizeChart, "catalog"],
    [/^pages$/, viewPages, "content"], [/^pages\/([^/]+)$/, viewPageEditor, "content"], [/^menus$/, viewMenus, "content"], [/^media$/, viewMedia, "content"], [/^trash$/, viewTrash, "trash"],
    [/^chat$/, viewChat, "chat"], [/^chat\/([^/]+)$/, viewChat, "chat"], [/^messages$/, viewMessages, "messages"],
    [/^users$/, viewUsers, "users"], [/^settings$/, viewSettings, "settings"], [/^labels$/, viewLabels, "products"], [/^payments$/, viewPayments, "settings"], [/^integrations$/, viewIntegrations, "integrations"], [/^acore$/, viewAcore, "settings"], [/^pathao$/, viewPathao, "settings"],
    [/^account$/, viewAccount, null]
  ];
  let leaveGuard = null, cleanup = null, lastHash = location.href;
  function route() {
    if (!me) return;
    if (leaveGuard && !leaveGuard()) { history.pushState(null, "", lastHash); return; }
    leaveGuard = null;
    if (cleanup) { cleanup(); cleanup = null; }
    if (!$("#modal").hidden) closeModal();
    lastHash = location.href;
    const raw = cur(), path = raw.split("?")[0], query = raw.split("?")[1] || "";
    const first = NAV.flatMap((g) => g[1]).find((i) => can(i[2]));
    if (!path) { go(first ? first[0] : "account", true); return; }
    drawSide();
    $("#side").classList.remove("is-open"); $("#sideScrim").hidden = true;
    view.onclick = null;
    // Views add their own listeners to #view, so give each one a fresh node.
    const fresh = view.cloneNode(false);
    view.parentNode.replaceChild(fresh, view);
    view = fresh;
    for (const [re, fn, area] of ROUTES) {
      const m = re.exec(path);
      if (!m) continue;
      if (area && !can(area)) { view.innerHTML = `<p class="empty">Your role can't open this page.</p>`; return; }
      Promise.resolve(fn(m[1] ? decodeURIComponent(m[1]) : null, query)).catch(fail);
      window.scrollTo(0, 0);
      return;
    }
    notFound();
  }
  window.addEventListener("hashchange", () => { if (PATHS && /^#\//.test(location.hash)) return go(location.hash, true); route(); });
  window.addEventListener("popstate", () => { if (PATHS) route(); });
  if (PATHS && /^#\//.test(location.hash)) history.replaceState(null, "", "/admin/" + location.hash.replace(/^#\/?/, ""));
  // Links written as #/page work as /admin/page: shown that way, and opened without reloading
  if (PATHS) {
    const fix = (root) => { (root.querySelectorAll ? root : document).querySelectorAll('a[href^="#/"]').forEach((a) => { a.setAttribute("href", "/admin/" + a.getAttribute("href").slice(2)); }); };
    fix(document);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches && n.matches('a[href^="#/"]')) n.setAttribute("href", "/admin/" + n.getAttribute("href").slice(2)); fix(n); } }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="/admin/"], a[href^="#/"]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
      e.preventDefault(); go(a.getAttribute("href"));
    });
  }
  // Rows with data-href act as links
  document.addEventListener("click", (e) => {
    const r = e.target.closest("tr[data-href]");
    if (r && !e.target.closest("a, button, input, select, [data-stop]")) go(r.dataset.href);
  });

  function showLogin(msg) {
    $("#app").hidden = true;
    $("#login").hidden = false;
    if (window.Ravelle.mode === "demo") {
      $("#loginNote").innerHTML = `<span class="demo-hint" style="display:block">Demo mode: this admin runs on a copy of the store saved in your browser.<br>Email <b>${esc(window.Ravelle.demoLogin.email)}</b> · Password <b>${esc(window.Ravelle.demoLogin.password)}</b></span>`;
      $("#loginForm").email.value = window.Ravelle.demoLogin.email;
      $("#loginForm").password.value = window.Ravelle.demoLogin.password;
    }
    if (msg) { $("#loginErr").textContent = msg; $("#loginErr").hidden = false; }
  }
  function signOut(expired) {
    api("POST", "/api/auth/logout").catch(() => {});
    token = null; me = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    showLogin(expired ? "Your session ended. Please sign in again." : "");
  }
  async function start() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#demoBadge").hidden = window.Ravelle.mode !== "demo";
    drawSide();
    route();
    refreshCounts();
    setInterval(() => { if (!document.hidden) refreshCounts(); }, 30000);
  }
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(e.target), btn = $("button[type=submit]", e.target);
    $("#loginErr").hidden = true;
    busy(btn, true);
    try {
      const r = await window.Ravelle.call("POST", "/api/auth/login", b);
      token = r.token; me = r.user; areas = r.areas;
      try { localStorage.setItem(TOKEN_KEY, token); } catch (err) {}
      await start();
    } catch (err) { $("#loginErr").textContent = err.message || "Couldn't sign in."; $("#loginErr").hidden = false; }
    busy(btn, false);
  };
  // Forgot password / reset link (admin users only)
  const demoQs = () => (/[?&]demo\b/.test(location.search) ? "?demo" : "");
  const loginCard = (id) => ["loginForm", "forgotForm", "resetForm"].forEach((k) => { $("#" + k).hidden = k !== id; });
  $("#forgotLink").onclick = (e) => { e.preventDefault(); $("#forgotForm").email.value = $("#loginForm").email.value; $("#forgotErr").hidden = true; loginCard("forgotForm"); $("#forgotForm").email.focus(); };
  $$("[data-back-login]").forEach((a) => { a.onclick = (e) => { e.preventDefault(); history.replaceState(null, "", location.pathname + demoQs()); loginCard("loginForm"); }; });
  $("#forgotForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    $("#forgotErr").hidden = true; busy(btn, true);
    try {
      const r = await window.Ravelle.call("POST", "/api/auth/forgot", { email: e.target.email.value.trim() });
      $("#forgotNote").innerHTML = esc(r.message) + (r.demoLink ? ` <a href="${esc(r.demoLink)}${demoQs() ? "&demo" : ""}" id="demoResetLink">Open the reset link</a>` : "");
      $("#forgotNote").classList.remove("muted");
    } catch (err) { $("#forgotErr").textContent = err.message; $("#forgotErr").hidden = false; }
    busy(btn, false);
  };
  const resetToken = new URLSearchParams(location.search).get("reset");
  async function showReset() {
    $("#app").hidden = true; $("#login").hidden = false; loginCard("resetForm");
    const f = $("#resetForm");
    try {
      const r = await window.Ravelle.call("GET", "/api/auth/reset/" + encodeURIComponent(resetToken));
      $("#resetNote").textContent = `Choose a new password for ${r.email}. At least 8 characters.`;
      f.password.focus();
    } catch (err) { $("#resetNote").textContent = err.message; $$("input, button", f).forEach((x) => { x.disabled = true; }); }
    f.onsubmit = async (e) => {
      e.preventDefault();
      $("#resetErr").hidden = true;
      if (f.password.value !== f.password2.value) { $("#resetErr").textContent = "The two passwords don't match."; $("#resetErr").hidden = false; return; }
      const btn = $("button[type=submit]", f); busy(btn, true);
      try {
        const r = await window.Ravelle.call("POST", "/api/auth/reset", { token: resetToken, password: f.password.value });
        history.replaceState(null, "", location.pathname + demoQs());
        loginCard("loginForm");
        $("#loginForm").email.value = r.email; $("#loginForm").password.value = "";
        $("#loginNote").textContent = "Password changed. Sign in with your new password.";
        $("#loginForm").password.focus();
      } catch (err) { $("#resetErr").textContent = err.message; $("#resetErr").hidden = false; }
      busy(btn, false);
    };
  }
  $("#logout").onclick = () => signOut();
  $("#menuBtn").onclick = () => { $("#side").classList.add("is-open"); $("#sideScrim").hidden = false; };
  $("#sideScrim").onclick = () => { $("#side").classList.remove("is-open"); $("#sideScrim").hidden = true; };
  $("#resetDemo").onclick = async () => { if (await confirmBox("Reset the demo?", "This puts back the sample products, orders and pages and removes your changes in this browser.", "Reset demo", true)) window.Ravelle.resetDemo(); };

  window.Ravelle.ready.then(async () => {
    if (resetToken) return showReset();
    if (!token) return showLogin();
    try {
      const r = await window.Ravelle.call("GET", "/api/auth/me", null, token);
      if (!r.user) throw new Error();
      me = r.user; areas = r.areas;
      start();
    } catch (err) { token = null; showLogin(); }
  });
})();
