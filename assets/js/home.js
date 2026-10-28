// Fills the home page from content.js (or the admin draft). Elements opt in
// with data-c (text), data-ci (image src), data-calt (image alt),
// data-chref (link), data-lines (one span per line) and data-marquee.
// The admin preview calls it again on every edit.
(function () {
  "use strict";

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var lines = function (s) { return esc(s).replace(/\n/g, "<br>"); };
  var pick = function (obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  };
  var each = function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); };

  function apply(home) {
    if (!home) return;
    each("[data-c]", function (el) {
      var v = pick(home, el.dataset.c);
      if (typeof v === "string") el.innerHTML = lines(v);
    });
    each("[data-ci]", function (el) {
      var v = pick(home, el.dataset.ci);
      if (v && el.getAttribute("src") !== v) el.setAttribute("src", v);
    });
    each("[data-calt]", function (el) {
      var v = pick(home, el.dataset.calt);
      if (typeof v === "string") el.setAttribute("alt", v);
    });
    each("[data-chref]", function (el) {
      var v = pick(home, el.dataset.chref);
      if (v) el.setAttribute("href", v);
    });
    // Card titles: one span per line, keeping the fade styling of each slot.
    each("[data-lines]", function (el) {
      var v = pick(home, el.dataset.lines);
      if (typeof v !== "string") return;
      if (!el._slots) el._slots = Array.prototype.map.call(el.children, function (s) { return s.className; });
      var rows = v.split("\n").filter(function (r) { return r.trim(); });
      el.innerHTML = rows.map(function (r, i) {
        var cls = el._slots[i] || "";
        return "<span" + (cls ? ' class="' + cls + '"' : "") + " data-scramble>" + esc(r) + "</span>";
      }).join("");
    });
    // Running type: repeat the phrase until it is wide enough to drift.
    each("[data-marquee]", function (el) {
      var v = pick(home, el.dataset.marquee);
      if (typeof v !== "string" || !v.trim()) return;
      var sep = el.dataset.sep || "✕", one = v.trim() + " " + sep + " ", out = one;
      while (out.length < 64) out += one;
      el.textContent = out.trim();
    });
    var look = home.lookbook && home.lookbook.looks && home.lookbook.looks[0];
    if (look) {
      var name = document.getElementById("lookName"), items = document.getElementById("lookItems");
      var on = document.querySelector(".look__img.is-on");
      var idx = on ? Array.prototype.indexOf.call(on.parentNode.querySelectorAll(".look__img"), on) : 0;
      var cur = home.lookbook.looks[idx] || look;
      if (name) name.innerHTML = lines(cur.name);
      if (items) items.innerHTML = "● " + lines(cur.items);
    }
  }

  window.RAVELLE_APPLY_HOME = apply;
  apply(window.RAVELLE && window.RAVELLE.home);

  // Live preview inside the admin panel.
  if (/[?&]preview\b/.test(location.search)) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== "ravelle-home") return;
      window.RAVELLE.home = e.data.home;
      apply(e.data.home);
      if (e.data.focus) {
        var el = document.querySelector('[data-c="' + e.data.focus + '"], [data-ci="' + e.data.focus + '"], [data-lines="' + e.data.focus + '"], [data-marquee="' + e.data.focus + '"]');
        if (el && !el.closest("[hidden]")) {
          var r = el.getBoundingClientRect();
          if (r.top < 60 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: "center" });
          el.classList.remove("is-flash"); void el.offsetWidth; el.classList.add("is-flash");
        }
      }
    });
  }
})();
