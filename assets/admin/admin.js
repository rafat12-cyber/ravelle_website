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
  const human = (k) => String(k).replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ (\d)$/, " $1");
  const optText = (o) => Object.keys(o || {}).map((k) => o[k]).join(" / ");
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const TOKEN_KEY = "ravelle:admin-token";
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
  const can = (area) => areas.indexOf(area) > -1;

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
      const body = modal(title, `<p class="muted">${esc(text)}</p><div class="modal__foot"><button class="btn btn--ghost" data-no>Cancel</button><button class="btn ${danger ? "btn--danger" : "btn--dark"}" data-yes>${esc(okLabel || "OK")}</button></div>`, { onClose: () => resolve(false), noFocus: true });
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
      const s = String(c == null ? "" : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\n");
  }
  const pill = (s) => `<span class="pill pill--${esc(s)}">${esc(human(s))}</span>`;
  const STATUSES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
  const PAY_STATUSES = ["unpaid", "paid", "refunded", "failed"];
  const PAY_LABEL = { cod: "Cash on delivery", sslcommerz: "SSLCOMMERZ" };

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
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          let out = c.toDataURL("image/webp", 0.86);
          if (out.indexOf("data:image/webp") !== 0) out = c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86);
          // Keep the original when it is already smaller.
          resolve({ dataUrl: out.length < fr.result.length || scale < 1 ? out : fr.result, width: w, height: h });
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
        const r = await api("POST", "/api/media", { name: f.name, dataUrl: img.dataUrl, width: img.width, height: img.height, alt: f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") });
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
  function imgField(name, value, label, hint, wide) {
    return `<div class="field" data-imgfield="${esc(name)}"><span>${esc(label)}</span>
      <div class="imgfield"><img class="imgfield__prev${wide ? " imgfield__prev--wide" : ""}" src="${esc(value || "")}" alt="" ${value ? "" : "hidden"}>
      <div class="stack stack--sm"><div class="flex"><button class="btn btn--ghost btn--sm" type="button" data-pick>${value ? "Change" : "Choose image"}</button>
      <button class="btn btn--ghost btn--sm" type="button" data-clear ${value ? "" : "hidden"}>Remove</button></div>${hint ? `<small>${esc(hint)}</small>` : ""}</div></div>
      <input type="hidden" name="${esc(name)}" value="${esc(value || "")}"></div>`;
  }
  function wireImgFields(root, onChange) {
    $$("[data-imgfield]", root).forEach((f) => {
      const input = $("input[type=hidden]", f), prev = $(".imgfield__prev", f);
      const set = (u) => {
        input.value = u || "";
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
  function ordersTable(list) {
    if (!list.length) return `<p class="empty">No orders yet.</p>`;
    return `<div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Status</th><th>Payment</th><th class="right">Items</th><th class="right">Total</th></tr></thead><tbody>${list.map((o) => `
      <tr class="is-link" data-href="#/orders/${esc(o.number)}"><td><b>${esc(o.number)}</b></td><td class="nowrap">${dateTime(o.createdAt)}</td><td>${esc(o.customer.name)}<br><small class="muted">${esc(o.customer.phone)}</small></td>
      <td>${pill(o.status)}</td><td>${pill(o.paymentStatus)}<br><small class="muted">${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)}</small></td><td class="right num">${o.itemCount}</td><td class="right num"><b>${taka(o.total)}</b></td></tr>`).join("")}</tbody></table></div>`;
  }

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
      <div class="toolbar"><div class="grow"><input class="input" id="ordQ" placeholder="Search by order number, name, phone or email" value="${esc(state.q)}"></div>
        <label class="flex small muted">From <input class="input input--sm" type="date" id="ordFrom"></label><label class="flex small muted">To <input class="input input--sm" type="date" id="ordTo"></label></div>
      <div class="card card--flush" id="ordList"><p class="empty">Loading…</p></div>`;
    let all = [];
    const load = async () => {
      const params = new URLSearchParams();
      if (state.q) params.set("q", state.q);
      if (state.from) params.set("from", new Date(state.from + "T00:00:00").getTime());
      if (state.to) params.set("to", new Date(state.to + "T23:59:59").getTime());
      try { all = (await api("GET", "/api/orders?" + params)).orders; } catch (err) { return fail(err); }
      draw();
    };
    const draw = () => {
      const counts = {};
      all.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
      $("#ordTabs").innerHTML = [["", "All", all.length]].concat(STATUSES.map((s) => [s, human(s), counts[s] || 0]))
        .map(([k, l, n]) => `<button class="tab${state.status === k ? " is-on" : ""}" data-s="${k}">${l}<small>${n}</small></button>`).join("");
      const list = all.filter((o) => !state.status || o.status === state.status);
      $("#ordList").innerHTML = ordersTable(list);
    };
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
    try { o = (await api("GET", "/api/orders/" + encodeURIComponent(id))).order; } catch (err) { view.innerHTML = `<p class="empty">${esc(err.message)}</p>`; return; }
    const tel = o.customer.phone;
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/orders">← Orders</a><h1 class="h1" style="margin-top:8px">Order ${esc(o.number)}</h1>
      <p class="muted">${dateTime(o.createdAt)} · ${pill(o.status)} ${pill(o.paymentStatus)}</p></div>
      <div class="flex"><a class="btn btn--ghost" href="#/orders/${esc(o.number)}/invoice">Invoice</a><a class="btn btn--ghost" href="tel:${esc(tel)}">Call customer</a></div></div>
      <div class="cols">
        <div class="stack">
          <div class="card"><h2 class="h2">Items</h2><div class="items">${o.items.map((it) => `<div class="item">${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="ph"></span>`}
            <div><a href="#/products/${esc(it.productId)}"><b>${esc(it.name)}</b></a><small>${esc(optText(it.options))} · SKU ${esc(it.sku)}</small><small>${it.qty} × ${taka(it.price)}</small></div><b class="num">${taka(it.lineTotal)}</b></div>`).join("")}</div>
            <div class="totals"><div><span>Subtotal</span><span class="num">${taka(o.subtotal)}</span></div>${o.discount ? `<div><span>Discount${o.coupon ? " (" + esc(o.coupon) + ")" : ""}</span><span class="num">−${taka(o.discount)}</span></div>` : ""}
              <div><span>Delivery${o.shippingZone ? " · " + esc(o.shippingZone.name) : ""}</span><span class="num">${o.shipping ? taka(o.shipping) : "Free"}</span></div><div class="grand"><span>Total</span><span class="num">${taka(o.total)}</span></div></div></div>
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
            ${o.customer.email ? `<dt>Email</dt><dd><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></dd>` : ""}<dt>Address</dt><dd>${esc(o.customer.address)}${o.customer.city ? ", " + esc(o.customer.city) : ""}</dd>
            ${o.shippingZone ? `<dt>Area</dt><dd>${esc(o.shippingZone.name)} · ${esc(o.shippingZone.days)}</dd>` : ""}</dl>
            ${o.customerId && can("customers") ? `<a class="btn btn--ghost btn--sm" href="#/customers/${esc(o.customerId)}">Customer profile</a>` : ""}</div>
          <div class="card"><h2 class="h2">Payment</h2><dl class="kv"><dt>Method</dt><dd>${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)}</dd><dt>Status</dt><dd>${pill(o.paymentStatus)}</dd>${o.paymentRef ? `<dt>Reference</dt><dd class="mono">${esc(o.paymentRef)}</dd>` : ""}</dl></div>
          ${o.note ? `<div class="card"><h2 class="h2">Customer note</h2><p style="margin:0">${esc(o.note)}</p></div>` : ""}
        </div>
      </div>`;
    $("#ordForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(e.target), btn = $("button[type=submit]", e.target);
      if ((b.status === "cancelled" || b.status === "returned") && b.status !== o.status && !(await confirmBox("Mark as " + b.status + "?", "The items go back into stock.", "Yes, " + b.status, true))) return;
      busy(btn, true);
      try { await api("PATCH", "/api/orders/" + o.number, b); toast("Order updated"); viewOrder(o.number); refreshCounts(); }
      catch (err) { fail(err); busy(btn, false); }
    };
  }

  async function viewInvoice(id) {
    setTitle("Invoice " + id);
    let o;
    try { o = (await api("GET", "/api/orders/" + encodeURIComponent(id))).order; } catch (err) { return fail(err); }
    const st = (store.settings && store.settings.store) || {};
    view.innerHTML = `<div class="head no-print"><a class="btn btn--link" href="#/orders/${esc(o.number)}">← Order ${esc(o.number)}</a><button class="btn btn--dark" onclick="window.print()">Print invoice</button></div>
      <div class="card" style="max-width:820px;padding:36px">
        <div class="flex flex--between" style="align-items:flex-start"><div><img src="assets/img/logo.png" alt="Ravelle" style="height:40px;width:auto"><p class="small muted">${esc(st.legalName || "")}<br>${esc(st.address || "")}<br>${esc(st.phone || "")} · ${esc(st.email || "")}${st.tradeLicense ? "<br>Trade license: " + esc(st.tradeLicense) : ""}${st.bin ? " · BIN: " + esc(st.bin) : ""}</p></div>
          <div class="right"><h1 class="h1">Invoice</h1><p class="muted">${esc(o.number)}<br>${date(o.createdAt)}<br>${esc(PAY_LABEL[o.paymentMethod] || o.paymentMethod)} · ${esc(human(o.paymentStatus))}</p></div></div>
        <div><p class="h3">Bill to</p><p style="margin:0">${esc(o.customer.name)}<br>${esc(o.customer.phone)}<br>${esc(o.customer.address)}${o.customer.city ? ", " + esc(o.customer.city) : ""}</p></div>
        <table class="t"><thead><tr><th>Item</th><th>SKU</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead><tbody>${o.items.map((it) => `<tr><td>${esc(it.name)}<br><small class="muted">${esc(optText(it.options))}</small></td><td class="mono">${esc(it.sku)}</td><td class="right">${it.qty}</td><td class="right">${taka(it.price)}</td><td class="right">${taka(it.lineTotal)}</td></tr>`).join("")}</tbody></table>
        <div class="totals" style="margin-left:auto;width:min(300px,100%)"><div><span>Subtotal</span><span>${taka(o.subtotal)}</span></div>${o.discount ? `<div><span>Discount</span><span>−${taka(o.discount)}</span></div>` : ""}<div><span>Delivery</span><span>${taka(o.shipping)}</span></div><div class="grand"><span>Total</span><span>${taka(o.total)}</span></div></div>
        <p class="small muted">Thank you for shopping with ${esc(st.name || "Ravelle")}. Exchanges and returns within 7 days of delivery: ${esc((st.website || "").replace(/^https?:\/\//, ""))}/#refund</p>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Customers
  // ---------------------------------------------------------------------------
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
    view.innerHTML = `<div class="head"><div><h1 class="h1">Products</h1><p class="muted">${store.products.length} published. Every product and size has its own SKU.</p></div>
      <div class="flex"><button class="btn btn--ghost" id="prdCsv">Export CSV</button><a class="btn btn--dark" href="#/products/new">Add product</a></div></div>
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
      $("#prdList").innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th>SKU</th><th>Categories</th><th class="right">Price</th><th class="right">Stock</th><th>Status</th><th></th></tr></thead><tbody>${list.map((p) => `
        <tr class="is-link" data-href="#/products/${esc(p.id)}"><td><div class="flex" style="flex-wrap:nowrap">${p.images[0] ? `<img class="thumb" src="${esc(p.images[0])}" alt="" loading="lazy">` : `<span class="thumb" style="background:${esc(p.hex || "#ddd")}"></span>`}<span><b>${esc(p.name)}</b><br><small class="muted">${p.variants.length ? p.variants.length + " variations" : "No variations"}${p.featured ? " · Featured" : ""}${p.isNew ? " · New" : ""}</small></span></div></td>
        <td class="mono">${esc(p.sku)}</td><td>${p.categoryIds.map(catName).filter(Boolean).map(esc).join(", ")}</td>
        <td class="right num">${taka(p.price)}${p.comparePrice > p.price ? `<br><small class="muted"><s>${taka(p.comparePrice)}</s></small>` : ""}</td>
        <td class="right num">${p.stock == null ? "—" : `<b style="color:${p.stock === 0 ? "var(--danger)" : p.stock <= low ? "var(--warn)" : "inherit"}">${p.stock}</b>`}</td><td>${pill(p.status)}</td>
        <td class="right nowrap"><button class="btn btn--ghost btn--sm" data-dup="${esc(p.id)}">Duplicate</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No products match.</p>`;
    };
    $("#prdQ").oninput = debounce((e) => { state.q = e.target.value.trim(); load(); }, 250);
    $("#prdCat").onchange = (e) => { state.category = e.target.value; load(); };
    $("#prdStatus").onchange = (e) => { state.status = e.target.value; load(); };
    $("#prdList").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-dup]");
      if (!b) return;
      e.stopPropagation();
      try { const r = await api("POST", "/api/products/" + b.dataset.dup + "/duplicate"); toast("Duplicated as a draft"); location.hash = "#/products/" + r.product.id; } catch (err) { fail(err); }
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
    let draft = clone(p);
    draft.details = (draft.details || []).join("\n");
    view.innerHTML = `<div class="head"><div><a class="btn btn--link" href="#/products">← Products</a><h1 class="h1" style="margin-top:8px">${isNew ? "Add product" : esc(p.name)}</h1>
      ${isNew ? "" : `<p class="muted">SKU ${esc(p.sku)} · ${pill(p.status)} · <a href="./#product/${esc(p.slug)}" target="_blank" rel="noopener">View on store ↗</a></p>`}</div></div>
      <form class="cols" id="pForm" novalidate>
        <div class="stack">
          <div class="card"><label class="field"><span>Product name</span><input class="input" name="name" required value="${esc(draft.name)}" placeholder="Fearless Oversized T-shirt – Black"></label>
            <label class="field"><span>Description</span><textarea class="input" name="description" rows="3">${esc(draft.description || "")}</textarea></label>
            <label class="field"><span>Details &amp; fit</span><textarea class="input" name="details" rows="4" placeholder="One point per line">${esc(draft.details)}</textarea><small>One point per line. Shown under “Details &amp; fit”.</small></label></div>
          <div class="card"><div class="card__head"><h2 class="h2">Photos</h2><small class="muted">The first photo is the main one. Drag order with the arrows.</small></div><div class="gallery" id="gallery"></div></div>
          <div class="card"><h2 class="h2">Price</h2><div class="row row--3">
            <label class="field"><span>Price (৳)</span><input class="input" name="price" type="number" min="0" required value="${esc(draft.price)}"></label>
            <label class="field"><span>Compare-at price (৳)</span><input class="input" name="comparePrice" type="number" min="0" value="${esc(draft.comparePrice || "")}"><small>The old price, shown crossed out.</small></label>
            <label class="field"><span>Product SKU</span><input class="input" name="sku" value="${esc(draft.sku)}" placeholder="Made for you if empty" style="text-transform:uppercase"></label></div></div>
          <div class="card"><div class="card__head"><div><h2 class="h2">Variations</h2><p class="muted small">Pick the options this product comes in. Each combination gets its own SKU, price and stock.</p></div><a class="btn btn--link" href="#/variations">Manage variation types</a></div>
            <div class="stack" id="attrBox"></div>
            <div class="flex"><select class="input" id="addAttr" style="width:auto"><option value="">+ Add a variation type…</option>${attrs.map((a) => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join("")}</select></div>
            <div id="varBox"></div>
            <label class="check"><input type="checkbox" name="trackStock" ${draft.trackStock ? "checked" : ""}> Track stock (sold-out sizes can't be ordered)</label>
            <label class="field" id="simpleStock" style="max-width:200px"><span>Stock</span><input class="input" name="stock" type="number" min="0" value="${esc(draft.stock == null ? 0 : draft.stock)}"></label></div>
          <div class="card"><h2 class="h2">Size guide</h2><p class="muted small" style="margin:0">Upload a size chart image. Customers see a “Size guide” button above the sizes; it opens this image in a popup.</p>
            ${imgField("sizeGuide", draft.sizeGuide, "Size guide image", "A wide image works best, like a chart with chest, length and sleeve.", true)}</div>
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
            <label class="field"><span>Colour</span><input class="input" name="hex" type="color" value="${esc(draft.hex || "#7b7e83")}" style="padding:2px"></label></div></div>
          <div class="card"><h2 class="h2">Web address</h2><label class="field"><span>Slug</span><input class="input" name="slug" value="${esc(draft.slug || "")}" placeholder="Made from the name"><small>ravellebd.com/#product/<b>${esc(draft.slug || "…")}</b></small></label></div>
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

    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(form);
      const body = {
        name: b.name, slug: b.slug, sku: b.sku, status: b.status, line: b.line, color: b.color, hex: b.hex, price: b.price, comparePrice: b.comparePrice || 0,
        description: b.description, details: b.details, images: draft.images, sizeGuide: $("[name=sizeGuide]", form).value,
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
        if (isNew) location.hash = "#/products/" + r.product.id; else viewProduct(p.id);
      } catch (err) { fail(err); busy(btn, false); }
    };
    if (!isNew) {
      $("#pDel").onclick = async () => {
        if (!(await confirmBox("Delete " + p.name + "?", "This removes the product from the store. Past orders keep their details.", "Delete product", true))) return;
        try { await api("DELETE", "/api/products/" + p.id); store = null; toast("Product deleted"); location.hash = "#/products"; } catch (err) { fail(err); }
      };
      $("#pDup").onclick = async () => {
        try { const r = await api("POST", "/api/products/" + p.id + "/duplicate"); store = null; toast("Duplicated as a draft"); location.hash = "#/products/" + r.product.id; } catch (err) { fail(err); }
      };
    }
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
        <div><b>${depth ? "↳ " : ""}${esc(c.name)}</b><small>#category/${esc(c.slug)} · ${count[c.id] || 0} products${c.description ? " · " + esc(c.description.slice(0, 60)) : ""}</small></div>
        <div class="flex"><a class="btn btn--ghost btn--sm" href="./#category/${esc(c.slug)}" target="_blank" rel="noopener">View</a><button class="btn btn--ghost btn--sm" data-edit="${c.id}">Edit</button></div></div>`).join("") || `<p class="empty">No categories yet.</p>`}</div>`;
    const edit = (c) => {
      const isNew = !c.id;
      const body = modal(isNew ? "Add category" : "Edit " + c.name, `<form class="stack" id="catForm">
        <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(c.name || "")}"></label>
        <div class="row row--2"><label class="field"><span>Parent</span><select class="input" name="parentId"><option value="">None (main category)</option>${catTree(cats).filter(({ c: x }) => x.id !== c.id).map(({ c: x, depth }) => `<option value="${x.id}"${x.id === c.parentId ? " selected" : ""}>${"— ".repeat(depth)}${esc(x.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Order</span><input class="input" name="order" type="number" value="${esc(c.order || 0)}"><small>Lower shows first.</small></label></div>
        <label class="field"><span>Slug</span><input class="input" name="slug" value="${esc(c.slug || "")}" placeholder="Made from the name"></label>
        <label class="field"><span>Description</span><textarea class="input" name="description" rows="2">${esc(c.description || "")}</textarea></label>
        ${imgField("image", c.image, "Image", "Used on collection cards and the coming-soon page.")}
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
    const label = (c) => c.type === "percent" ? c.value + "% off" + (c.maxDiscount ? ", up to " + taka(c.maxDiscount) : "") : c.type === "fixed" ? taka(c.value) + " off" : "Free delivery";
    const state = (c) => { const t = Date.now(); return !c.active ? "inactive" : c.endsAt && t > c.endsAt ? "expired" : c.startsAt && t < c.startsAt ? "scheduled" : c.maxUses && c.used >= c.maxUses ? "used up" : "active"; };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Coupons</h1><p class="muted">Discount codes customers enter at checkout.</p></div><button class="btn btn--dark" id="cpAdd">Create coupon</button></div>
      <div class="card card--flush">${list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Used</th><th>Dates</th><th>Status</th></tr></thead><tbody>${list.map((c) => `
        <tr class="is-link" data-edit="${c.id}"><td><b class="mono" style="font-size:13px">${esc(c.code)}</b>${c.description ? `<br><small class="muted">${esc(c.description)}</small>` : ""}</td><td>${esc(label(c))}</td><td>${c.minOrder ? taka(c.minOrder) : "—"}</td>
        <td class="num">${c.used || 0}${c.maxUses ? " / " + c.maxUses : ""}</td><td class="small">${c.startsAt ? date(c.startsAt) : "Now"} → ${c.endsAt ? date(c.endsAt) : "No end"}</td><td>${pill(state(c) === "active" ? "active" : "inactive").replace(/>[^<]*<\/span>$/, ">" + esc(human(state(c))) + "</span>")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No coupons yet.</p>`}</div>`;
    const day = (t) => t ? new Date(t - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : "";
    const edit = (c) => {
      const isNew = !c.id;
      const body = modal(isNew ? "Create coupon" : "Edit " + c.code, `<form class="stack" id="cpForm">
        <div class="row row--2"><label class="field"><span>Code</span><input class="input" name="code" required value="${esc(c.code || "")}" placeholder="EID20" style="text-transform:uppercase"></label>
        <label class="field"><span>Type</span><select class="input" name="type"><option value="percent">Percentage off</option><option value="fixed"${c.type === "fixed" ? " selected" : ""}>Fixed amount off</option><option value="shipping"${c.type === "shipping" ? " selected" : ""}>Free delivery</option></select></label></div>
        <div class="row row--3"><label class="field" data-show="value"><span>Value</span><input class="input" name="value" type="number" min="0" value="${esc(c.value || "")}"><small data-unit></small></label>
        <label class="field"><span>Minimum order (৳)</span><input class="input" name="minOrder" type="number" min="0" value="${esc(c.minOrder || "")}"></label>
        <label class="field" data-show="max"><span>Max discount (৳)</span><input class="input" name="maxDiscount" type="number" min="0" value="${esc(c.maxDiscount || "")}"></label></div>
        <div class="row row--3"><label class="field"><span>Usage limit</span><input class="input" name="maxUses" type="number" min="0" value="${esc(c.maxUses || "")}" placeholder="Unlimited"></label>
        <label class="field"><span>Starts</span><input class="input" name="startsAt" type="date" value="${day(c.startsAt)}"></label><label class="field"><span>Ends</span><input class="input" name="endsAt" type="date" value="${day(c.endsAt)}"></label></div>
        <label class="field"><span>Description (shown at checkout)</span><input class="input" name="description" value="${esc(c.description || "")}" placeholder="10% off your first order"></label>
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
        ["value", "minOrder", "maxDiscount", "maxUses"].forEach((k) => { b[k] = +b[k] || 0; });
        try { isNew ? await api("POST", "/api/coupons", b) : await api("PUT", "/api/coupons/" + c.id, b); closeModal(); toast("Coupon saved"); viewCoupons(); } catch (err) { fail(err); }
      };
      if (!isNew) $("#cpDel").onclick = async () => {
        if (!(await confirmBox("Delete " + c.code + "?", "Customers won't be able to use it any more.", "Delete", true))) return;
        try { await api("DELETE", "/api/coupons/" + c.id); toast("Deleted"); viewCoupons(); } catch (err) { fail(err); }
      };
    };
    $("#cpAdd").onclick = () => edit({ type: "percent", active: true });
    view.addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) edit(list.find((c) => c.id === b.dataset.edit)); });
  }

  // ---------------------------------------------------------------------------
  // Pages: visual editor (live preview in an iframe of the store)
  // ---------------------------------------------------------------------------
  const PAGES = {
    home: { title: "Home page", route: "home", sections: { hero: "Hero", collage: "Presence collage", house: "The House", poster: "Offer poster", arrivals: "New arrivals", lookbook: "Lookbook", categories: "Shop by category", footer: "Footer" } },
    about: { title: "About us", route: "about" },
    contact: { title: "Contact us", route: "contact" },
    terms: { title: "Terms & conditions", route: "terms" },
    privacy: { title: "Privacy policy", route: "privacy" },
    refund: { title: "Return & refund policy", route: "refund" },
    delivery: { title: "Delivery policy", route: "delivery" }
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
      const linkHint = /link$/i.test(k) ? `<small>A page link like #shop, #category/men, #about, or a full https:// address.</small>` : "";
      return `<label class="field" data-path="${esc(path)}"><span>${label}</span>${long ? `<textarea class="input" data-p="${esc(path)}" rows="${Math.min(6, Math.max(2, v.split("\n").length + 1))}">${esc(v)}</textarea>` : `<input class="input" data-p="${esc(path)}" value="${esc(v)}" ${/link$/i.test(k) ? 'list="peLinks"' : ""}>`}${linkHint}</label>`;
    };
    const build = (obj, path, depth) => Object.keys(obj).map((k) => {
      const v = obj[k], p = path ? path + "." + k : k;
      if (typeof v === "string") return fieldFor(k, v, p);
      if (Array.isArray(v)) {
        return `<details class="group"${depth ? "" : " open"}><summary>${human(k)}</summary><div class="group__body">${v.map((item, i) =>
          typeof item === "string" ? fieldFor(k.replace(/s$/, "") + " " + (i + 1), item, p + "." + i).replace(/<span>[^<]*<\/span>/, `<span>${human(k).replace(/s$/, "")} ${i + 1}</span>`)
            : `<details class="group"><summary>${human(k).replace(/s$/, "")} ${i + 1}${item.title || item.name ? ": " + esc(String(item.title || item.name).split("\n")[0]) : ""}</summary><div class="group__body">${build(item, p + "." + i, depth + 2)}</div></details>`).join("")}</div></details>`;
      }
      if (v && typeof v === "object") return `<details class="group"${depth === 0 && key !== "home" ? " open" : ""} data-group="${esc(p)}"><summary>${esc((meta.sections && meta.sections[k]) || human(k))}</summary><div class="group__body">${build(v, p, depth + 1)}</div></details>`;
      return "";
    }).join("");
    $("#peForm").innerHTML = build(draft, "", 0) + `<datalist id="peLinks">${["#shop", "#new-in", "#on-sale", "#about", "#contact", "#track", "#lookbook", "#arrivals"].concat(((store && store.categories) || []).map((c) => "#category/" + c.slug)).map((u) => `<option value="${esc(u)}">`).join("")}</datalist>`;
    $("#peForm").addEventListener("input", (e) => {
      const el = e.target.closest("[data-p]");
      if (!el) return;
      setPath(el.dataset.p, el.value);
      setDirty();
      post();
    });
    wireImgFields($("#peForm"), (path, u) => { setPath(path, u); setDirty(); post(path); });
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
      ["Pages", [["Home", "#home"], ["About us", "#about"], ["Contact us", "#contact"], ["Track order", "#track"], ["Saved items", "#saved"], ["Terms & conditions", "#terms"], ["Privacy policy", "#privacy"], ["Return & refund policy", "#refund"], ["Delivery policy", "#delivery"]]]];
    const linkSelect = `<select class="input input--sm" data-pick-link><option value="">Link to…</option>${links.map(([g, l]) => `<optgroup label="${g}">${l.map(([n, u]) => `<option value="${esc(u)}" data-label="${esc(n.replace(/^(— )+/, ""))}">${esc(n)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    view.innerHTML = `<div class="head"><div><h1 class="h1">Menus</h1><p class="muted">The header menu (with dropdowns) and the footer columns. Link to categories, sub-categories, pages or any web address.</p></div><button class="btn btn--dark" id="mnSave" disabled>Saved</button></div>
      <div class="cols cols--even"><div class="card"><div class="card__head"><h2 class="h2">Header menu</h2><button class="btn btn--ghost btn--sm" data-add="header">+ Add link</button></div><p class="muted small" style="margin:0">On desktop the first half sits left of the logo, the rest on the right. On phones everything is in the menu button.</p><div class="stack stack--sm" id="mnHeader"></div></div>
        <div class="card"><div class="card__head"><h2 class="h2">Footer columns</h2><button class="btn btn--ghost btn--sm" data-add-col>+ Add column</button></div><div class="stack" id="mnFooter"></div></div></div>`;
    const setDirty = () => { dirty = true; $("#mnSave").disabled = false; $("#mnSave").textContent = "Save menus"; };
    const row = (it, path, canNest) => `<div><div class="menu-item" data-path="${path}"><input class="input input--sm" data-f="label" value="${esc(it.label)}" placeholder="Label">
      <div class="flex" style="flex-wrap:nowrap"><input class="input input--sm grow" data-f="url" value="${esc(it.url)}" placeholder="#shop or https://…">${linkSelect}</div>
      <div class="menu-tools"><button class="icon" type="button" data-act="up" aria-label="Move up">↑</button><button class="icon" type="button" data-act="down" aria-label="Move down">↓</button>${canNest ? `<button class="icon" type="button" data-act="child" title="Add dropdown link">+</button>` : ""}<button class="icon" type="button" data-act="del" aria-label="Remove">✕</button></div></div>
      ${canNest && it.children && it.children.length ? `<div class="menu-kids">${it.children.map((c, j) => row(c, path + ".children." + j, false)).join("")}</div>` : ""}</div>`;
    const draw = () => {
      $("#mnHeader").innerHTML = menus.header.map((it, i) => row(it, "header." + i, true)).join("") || `<p class="muted">No links.</p>`;
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
        if (!(await confirmBox("Delete this image?", "Products or pages that use it will show an empty space.", "Delete", true))) return;
        try { await api("DELETE", "/api/media/" + m.id); toast("Deleted"); load(); } catch (err) { fail(err); }
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
    let status = "open", list = [], current = id || null, timer = null;
    const loadList = async () => {
      try { list = (await api("GET", "/api/chats" + (status ? "?status=" + status : ""))).chats; } catch (err) { return; }
      $("#chList").innerHTML = list.map((c) => `<button class="inbox__item${c.id === current ? " is-on" : ""}" data-id="${c.id}"><b><span>${esc(c.name || "Visitor")}</span>${c.unread ? `<span class="side__count">${c.unread}</span>` : `<small>${ago(c.updatedAt)}</small>`}</b><small>${c.lastMessage ? (c.lastMessage.from === "customer" ? "" : "You: ") + esc(c.lastMessage.text) : "No messages"}</small></button>`).join("") || `<p class="empty">No ${status} chats.</p>`;
    };
    const loadConv = async (scroll) => {
      if (!current) return;
      let c;
      try { c = (await api("GET", "/api/chats/" + current + "?markRead=1")).chat; } catch (err) { current = null; return; }
      const box = $("#chConv");
      const keepDraft = $("#chText") ? $("#chText").value : "";
      box.innerHTML = `<div class="inbox__head"><div><b>${esc(c.name || "Visitor")}</b> ${pill(c.status)}<br><small class="muted">Started ${dateTime(c.createdAt)}${c.page ? " on " + esc(c.page) : ""} · ID <span class="mono">${esc(c.id)}</span></small></div>
        <button class="btn btn--ghost btn--sm" id="chToggle">${c.status === "open" ? "Close chat" : "Reopen"}</button></div>
        <div class="inbox__msgs" id="chMsgs">${c.messages.map((m) => `<div class="bubble${m.from === "customer" ? "" : " bubble--out"}${m.from === "bot" ? " bubble--bot" : ""}"><p>${esc(m.text)}</p><small>${m.from === "customer" ? esc(c.name || "Visitor") : esc(m.author || (m.from === "bot" ? "Bot" : "Team"))}${m.from === "bot" ? " · auto" : ""} · ${dateTime(m.at)}</small></div>`).join("")}</div>
        <form class="inbox__form" id="chForm"><textarea class="input grow" id="chText" rows="2" placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)"></textarea><button class="btn btn--dark" type="submit">Send</button></form>`;
      $("#chText").value = keepDraft;
      const msgs = $("#chMsgs");
      if (scroll !== false) msgs.scrollTop = msgs.scrollHeight;
      $("#chToggle").onclick = async () => { await api("PATCH", "/api/chats/" + c.id, { status: c.status === "open" ? "closed" : "open" }).catch(fail); loadList(); loadConv(); };
      $("#chText").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chForm").requestSubmit(); } };
      $("#chForm").onsubmit = async (e) => {
        e.preventDefault();
        const text = $("#chText").value.trim();
        if (!text) return;
        $("#chText").value = "";
        try { await api("POST", "/api/chats/" + c.id + "/messages", { text }); loadConv(); loadList(); } catch (err) { fail(err); $("#chText").value = text; }
      };
      refreshCounts();
    };
    $("#chTabs").onclick = (e) => { const b = e.target.closest("[data-s]"); if (!b) return; status = b.dataset.s; $$("#chTabs .tab").forEach((x) => x.classList.toggle("is-on", x === b)); loadList(); };
    $("#chList").onclick = (e) => { const b = e.target.closest("[data-id]"); if (!b) return; current = b.dataset.id; history.replaceState(null, "", "#/chat/" + current); loadList(); loadConv(); };
    await loadList();
    if (!current && list[0]) current = list[0].id;
    loadConv();
    const tick = () => { timer = setTimeout(async () => { await loadList(); const m = $("#chMsgs"); const atEnd = !m || m.scrollHeight - m.scrollTop - m.clientHeight < 40; if (!$("#chText") || document.activeElement !== $("#chText") || !$("#chText").value) await loadConv(atEnd); tick(); }, 4000); };
    tick();
    cleanup = () => clearTimeout(timer);
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
  // Users
  // ---------------------------------------------------------------------------
  async function viewUsers() {
    setTitle("Users");
    const r = (await api("GET", "/api/users").catch(fail)) || { users: [], roles: {} };
    const AREA = { dashboard: "Dashboard", orders: "Orders", customers: "Customers", products: "Products", catalog: "Categories & variations", coupons: "Coupons", content: "Pages, menus & media", chat: "Live chat", messages: "Messages", users: "Users", settings: "Settings", integrations: "API & webhooks" };
    view.innerHTML = `<div class="head"><div><h1 class="h1">Users</h1><p class="muted">People who can sign in to this admin panel, and what each role can open.</p></div><button class="btn btn--dark" id="usAdd">Add user</button></div>
      <div class="card card--flush"><div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>${r.users.map((u) => `
        <tr><td><b>${esc(u.name)}</b>${u.id === me.id ? ` <span class="tag">You</span>` : ""}</td><td>${esc(u.email)}</td><td>${esc((r.roles[u.role] || {}).label || u.role)}</td><td>${ago(u.lastLogin)}</td><td class="right"><button class="btn btn--ghost btn--sm" data-edit="${u.id}">Edit</button></td></tr>`).join("")}</tbody></table></div></div>
      <div class="grid-3">${Object.keys(r.roles).map((k) => `<div class="card"><h2 class="h2">${esc(r.roles[k].label)}</h2><p class="muted small" style="margin:0">${r.roles[k].areas.map((a) => AREA[a] || a).join(", ")}</p></div>`).join("")}</div>`;
    const roleOpts = (sel) => Object.keys(r.roles).map((k) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(r.roles[k].label)}</option>`).join("");
    $("#usAdd").onclick = () => {
      modal("Add user", `<form class="stack" id="usForm"><label class="field"><span>Name</span><input class="input" name="name" required></label><label class="field"><span>Email</span><input class="input" name="email" type="email" required></label>
        <div class="row row--2"><label class="field"><span>Role</span><select class="input" name="role">${roleOpts("manager")}</select></label><label class="field"><span>Password</span><input class="input" name="password" type="text" minlength="8" required value="${Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8)}"><small>Share it with them; they can change it later.</small></label></div>
        <div class="modal__foot"><button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Add user</button></div></form>`);
      $("#usForm").onsubmit = async (e) => { e.preventDefault(); try { await api("POST", "/api/users", formData(e.target)); closeModal(); toast("User added"); viewUsers(); } catch (err) { fail(err); } };
    };
    view.onclick = (e) => {
      const b = e.target.closest("[data-edit]");
      if (!b) return;
      const u = r.users.find((x) => x.id === b.dataset.edit);
      modal("Edit " + u.name, `<form class="stack" id="usForm"><label class="field"><span>Name</span><input class="input" name="name" value="${esc(u.name)}"></label>
        <label class="field"><span>Role</span><select class="input" name="role">${roleOpts(u.role)}</select></label><label class="field"><span>New password</span><input class="input" name="password" type="text" minlength="8" placeholder="Leave empty to keep"><small>Changing it signs them out everywhere.</small></label>
        <div class="modal__foot">${u.id === me.id ? "" : `<button class="btn btn--danger" type="button" id="usDel" style="margin-right:auto">Remove</button>`}<button class="btn btn--ghost" type="button" data-modal-close>Cancel</button><button class="btn btn--dark" type="submit">Save</button></div></form>`);
      $("#usForm").onsubmit = async (ev) => { ev.preventDefault(); const d = formData(ev.target); if (!d.password) delete d.password; try { await api("PATCH", "/api/users/" + u.id, d); closeModal(); toast("Saved"); viewUsers(); } catch (err) { fail(err); } };
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
    const st = s.store, ssl = s.payments.sslcommerz;
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
        <div class="card"><h2 class="h2">Payments</h2>
          <label class="switch"><input type="checkbox" id="payCod" ${s.payments.cod ? "checked" : ""}> Cash on delivery</label>
          <label class="switch"><input type="checkbox" id="paySsl" ${ssl.enabled ? "checked" : ""}> Online payment with SSLCOMMERZ (cards, bKash, Nagad, Rocket, banks)</label>
          <div class="row row--2"><label class="field"><span>SSLCOMMERZ Store ID</span><input class="input" id="sslId" value="${esc(ssl.storeId || "")}" placeholder="From your SSLCOMMERZ merchant panel"></label>
          <label class="field"><span>Mode</span><select class="input" id="sslSandbox"><option value="1">Sandbox (testing)</option><option value="0"${ssl.sandbox ? "" : " selected"}>Live payments</option></select></label></div>
          <p class="small ${ssl.serverReady ? "" : "muted"}" style="margin:0">${window.Ravelle.mode === "demo" ? "In this demo, online payments are simulated." : ssl.serverReady ? "✓ The server has your SSLCOMMERZ store password." : "The store password stays secret on the server: set SSLC_STORE_PASSWORD in the server's .env file, then restart. See the README."}</p></div>
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
      out.payments = { cod: $("#payCod").checked, sslcommerz: { enabled: $("#paySsl").checked, sandbox: $("#sslSandbox").value === "1", storeId: $("#sslId").value } };
      out.announcement = $("#announcement").value;
      out.lowStock = +$("#lowStock").value || 0;
      try { await api("PUT", "/api/settings", { settings: out }); toast("Settings saved"); store = null; } catch (err) { fail(err); }
    };
  }

  // ---------------------------------------------------------------------------
  // Integrations: API keys, webhooks and the AI chat hookup
  // ---------------------------------------------------------------------------
  async function viewIntegrations() {
    setTitle("Integrations");
    const [k, w, lg] = await Promise.all([api("GET", "/api/keys"), api("GET", "/api/webhooks"), api("GET", "/api/webhooks-log")]).catch((err) => { fail(err); return [{ keys: [] }, { webhooks: [], events: [] }, { log: [] }]; });
    const base = window.Ravelle.mode === "demo" ? "https://your-domain.com" : location.origin + location.pathname.replace(/admin(\.html)?\/?$/, "").replace(/\/$/, "");
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
      if (te) { await api("POST", "/api/webhooks/" + te.dataset.test + "/test").then(() => toast("Test sent. Check Recent deliveries in a moment."), fail); setTimeout(() => { if (location.hash === "#/integrations") viewIntegrations(); }, 2500); }
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
    ["", [["dashboard", "Dashboard", "dashboard"]]],
    ["Sales", [["orders", "Orders", "orders"], ["customers", "Customers", "customers"], ["coupons", "Coupons", "coupons"]]],
    ["Catalog", [["products", "Products", "products"], ["stock", "Stock", "products"], ["categories", "Categories", "catalog"], ["variations", "Variations", "catalog"]]],
    ["Website", [["pages", "Pages", "content"], ["menus", "Menus", "content"], ["media", "Media library", "content"]]],
    ["Inbox", [["chat", "Live chat", "chat"], ["messages", "Messages", "messages"]]],
    ["Admin", [["users", "Users", "users"], ["settings", "Settings", "settings"], ["integrations", "API & webhooks", "integrations"]]]
  ];
  const counts = { orders: 0, chat: 0, messages: 0 };
  function drawSide() {
    const cur = (location.hash.replace(/^#\/?/, "").split(/[/?]/)[0]) || "dashboard";
    $("#sideNav").innerHTML = NAV.map(([g, items]) => {
      const vis = items.filter((i) => can(i[2]));
      if (!vis.length) return "";
      return (g ? `<p class="side__group mono">${g}</p>` : "") + vis.map(([k, l]) => `<a href="#/${k}"${k === cur ? ' aria-current="page"' : ""}><span>${l}</span>${counts[k] ? `<span class="side__count">${counts[k]}</span>` : ""}</a>`).join("");
    }).join("");
    $("#sideUser").innerHTML = `${esc(me.name)}<small>${esc(me.email)}</small>`;
  }
  async function refreshCounts() {
    const jobs = [];
    if (can("orders")) jobs.push(api("GET", "/api/orders?status=pending").then((r) => { counts.orders = r.total; }, () => {}));
    if (can("chat")) jobs.push(api("GET", "/api/chats?status=open").then((r) => { counts.chat = r.chats.reduce((s, c) => s + (c.unread ? 1 : 0), 0); }, () => {}));
    if (can("messages")) jobs.push(api("GET", "/api/messages").then((r) => { counts.messages = r.messages.filter((m) => !m.read).length; }, () => {}));
    await Promise.all(jobs);
    drawSide();
  }
  async function loadStore(force) {
    if (store && !force) return store;
    store = await api("GET", "/api/store");
    // Admin views need drafts and every category too.
    return store;
  }
  function setTitle(t) { $("#topTitle").textContent = t; document.title = t + " · Ravelle admin"; }
  function notFound() { view.innerHTML = `<p class="empty">That page doesn't exist. <a href="#/dashboard">Go to the dashboard</a></p>`; }

  const ROUTES = [
    [/^dashboard$/, viewDashboard, "dashboard"],
    [/^orders$/, viewOrders, "orders"], [/^orders\/([^/]+)\/invoice$/, viewInvoice, "orders"], [/^orders\/([^/]+)$/, viewOrder, "orders"],
    [/^customers$/, viewCustomers, "customers"], [/^customers\/([^/]+)$/, viewCustomer, "customers"],
    [/^coupons$/, viewCoupons, "coupons"],
    [/^products$/, viewProducts, "products"], [/^products\/([^/]+)$/, viewProduct, "products"], [/^stock$/, viewStock, "products"],
    [/^categories$/, viewCategories, "catalog"], [/^variations$/, viewVariations, "catalog"],
    [/^pages$/, viewPages, "content"], [/^pages\/([^/]+)$/, viewPageEditor, "content"], [/^menus$/, viewMenus, "content"], [/^media$/, viewMedia, "content"],
    [/^chat$/, viewChat, "chat"], [/^chat\/([^/]+)$/, viewChat, "chat"], [/^messages$/, viewMessages, "messages"],
    [/^users$/, viewUsers, "users"], [/^settings$/, viewSettings, "settings"], [/^integrations$/, viewIntegrations, "integrations"],
    [/^account$/, viewAccount, null]
  ];
  let leaveGuard = null, cleanup = null, lastHash = location.hash;
  function route() {
    if (!me) return;
    if (leaveGuard && !leaveGuard()) { history.replaceState(null, "", lastHash); return; }
    leaveGuard = null;
    if (cleanup) { cleanup(); cleanup = null; }
    lastHash = location.hash;
    const raw = location.hash.replace(/^#\/?/, ""), path = raw.split("?")[0], query = raw.split("?")[1] || "";
    const first = NAV.flatMap((g) => g[1]).find((i) => can(i[2]));
    if (!path) { location.replace("#/" + (first ? first[0] : "account")); return; }
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
  window.addEventListener("hashchange", route);
  // Rows with data-href act as links
  document.addEventListener("click", (e) => {
    const r = e.target.closest("tr[data-href]");
    if (r && !e.target.closest("a, button, input, select")) location.hash = r.dataset.href;
  });

  function showLogin(msg) {
    $("#app").hidden = true;
    $("#login").hidden = false;
    if (window.Ravelle.mode === "demo") {
      $("#loginNote").innerHTML = `<span class="demo-hint" style="display:block">Demo mode: this admin runs on sample data saved in your browser.<br>Email <b>${esc(window.Ravelle.demoLogin.email)}</b> · Password <b>${esc(window.Ravelle.demoLogin.password)}</b></span>`;
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
    setInterval(refreshCounts, 30000);
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
  $("#logout").onclick = () => signOut();
  $("#menuBtn").onclick = () => { $("#side").classList.add("is-open"); $("#sideScrim").hidden = false; };
  $("#sideScrim").onclick = () => { $("#side").classList.remove("is-open"); $("#sideScrim").hidden = true; };
  $("#resetDemo").onclick = async () => { if (await confirmBox("Reset the demo?", "This puts back the sample products, orders and pages and removes your changes in this browser.", "Reset demo", true)) window.Ravelle.resetDemo(); };

  window.Ravelle.ready.then(async () => {
    if (!token) return showLogin();
    try {
      const r = await window.Ravelle.call("GET", "/api/auth/me", null, token);
      if (!r.user) throw new Error();
      me = r.user; areas = r.areas;
      start();
    } catch (err) { token = null; showLogin(); }
  });
})();
