// Ravelle home page demo. Product data mirrors ravellebd.com (Oct 2026).
(function () {
  "use strict";

  var SITE = "https://ravellebd.com";
  var UP = SITE + "/wp-content/uploads/2026/10/";

  // img: local photo when we have it, otherwise the live product photo.
  // tone: used for the typographic card if the photo can't load.
  var PRODUCTS = [
    { line: "Fearless", color: "Black", price: 890, was: 1190, img: "assets/img/p-black.jpg", slug: "oversized-t-shirt-fearless-black", tone: "#2b2c2e" },
    { line: "Fearless", color: "Ocean Blue", price: 890, was: 1190, img: "assets/img/p-blue.jpg", slug: "fearless-oversized-t-shirt-ocean-blue", tone: "#3e6577" },
    { line: "Fearless", color: "Yellow", price: 890, was: 1190, img: "assets/img/p-yellow.jpg", slug: "fearless-oversized-t-shirt-yellow", tone: "#a89a72" },
    { line: "RVCHL", color: "Yellow", price: 890, was: 1190, img: "assets/img/p-rvchl.jpg", slug: "rvchl-oversized-t-shirt-yellow", tone: "#b3a578" },
    { line: "Stride Out", color: "Brick Red", price: 890, was: 1190, img: UP + "DSC07039-e1791909755544.jpg", slug: "stride-out-oversized-t-shirt-brick-red", tone: "#8e3b2c" },
    { line: "Paradox", color: "Cream", price: 890, was: 1190, img: UP + "DSC07500-e1791908150328.jpg", slug: "paradox-oversized-t-shirt-cream", tone: "#b8ab92" },
    { line: "574", color: "Coffee", price: 680, was: 990, img: UP + "DSC07487-e1791908605959.jpg", slug: "574-acid-washed-oversized-t-shirt-coffee", tone: "#5b4335", label: "574 Acid Washed" },
    { line: "RVCHL", color: "Ocean Blue", price: 890, was: 1190, img: UP + "DSC07019.jpg", slug: "rvchl-oversized-t-shirt-ocean-blue", tone: "#335a6c" },
    { line: "Stride Out", color: "Black", price: 890, was: 1190, img: UP + "DSC06916-e1791909430135.jpg", slug: "stride-out-oversized-t-shirt-black", tone: "#232426" },
    { line: "Paradox", color: "Black", price: 890, was: 1190, img: UP + "DSC07342-1.jpg", slug: "paradox-oversized-t-shirt-black", tone: "#1f2022" },
    { line: "574", color: "Yellow", price: 680, was: 990, img: UP + "DSC07374-e1791908428897.jpg", slug: "574-acid-washed-oversized-t-shirt-yellow", tone: "#a3904f", label: "574 Acid Washed" },
    { line: "Stride Out", color: "Blue", price: 890, was: 1190, img: UP + "DSC07320-e1791909216302.jpg", slug: "stride-out-oversized-t-shirt-blue", tone: "#3b5677" }
  ];

  var taka = function (n) { return "৳" + n.toLocaleString("en-US"); };

  // Grid --------------------------------------------------------------------
  var grid = document.getElementById("grid");
  if (grid) {
    grid.innerHTML = PRODUCTS.map(function (p, i) {
      var name = (p.label || p.line) + " Oversized T-shirt";
      var off = Math.round((1 - p.price / p.was) * 100);
      return (
        '<a class="card" data-line="' + p.line + '" href="' + SITE + "/product/" + p.slug + '/" target="_blank" rel="noopener" style="--tone:' + p.tone + '">' +
          '<img class="card__img" src="' + p.img + '" alt="' + name + " in " + p.color + '" loading="' + (i < 4 ? "eager" : "lazy") + '">' +
          '<span class="card__type" aria-hidden="true">' + (p.label || p.line) + "<small>" + p.color + "</small></span>" +
          '<span class="card__top"><span class="chip">−' + off + "%</span>" +
            '<button class="card__fav" type="button" aria-pressed="false" aria-label="Save ' + name + '">' +
              '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
            "</button></span>" +
          '<span class="card__bar"><span class="card__name"><b>' + name + "</b>" +
            '<span class="card__price">' + p.color + " · " + taka(p.price) + "<s>" + taka(p.was) + "</s></span></span>" +
            '<span class="card__go" aria-hidden="true">›</span></span>' +
        "</a>"
      );
    }).join("");

    // A photo that can't load (offline, blocked host) becomes a type card.
    grid.querySelectorAll(".card__img").forEach(function (img) {
      var fail = function () { img.closest(".card").classList.add("no-img"); img.remove(); };
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) fail();
      else img.addEventListener("error", fail, { once: true });
    });

    grid.addEventListener("click", function (e) {
      var fav = e.target.closest(".card__fav");
      if (!fav) return;
      e.preventDefault();
      fav.setAttribute("aria-pressed", fav.getAttribute("aria-pressed") === "true" ? "false" : "true");
    });
  }

  // Filters -----------------------------------------------------------------
  document.querySelectorAll(".filter").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var f = btn.dataset.filter;
      document.querySelectorAll(".filter").forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      grid.querySelectorAll(".card").forEach(function (c) {
        c.hidden = f !== "all" && c.dataset.line !== f;
      });
    });
  });

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Scramble: the accent word resolves letter by letter, like the reference.
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

  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        if (el.hasAttribute("data-scramble")) scramble(el);
        if (el.classList.contains("shutter")) el.classList.add("is-playing");
        io.unobserve(el);
      });
    }, { threshold: 0.4 });
    document.querySelectorAll("[data-scramble], .shutter").forEach(function (el) { io.observe(el); });
  }

  // Scroll: drifting marquees and the lookbook stack -------------------------
  var drifts = Array.prototype.slice.call(document.querySelectorAll("[data-drift]"));
  var lookbook = document.getElementById("lookbook");
  var lookImgs = lookbook ? lookbook.querySelectorAll(".look__img") : [];
  var LOOKS = [
    ["Fearless tee<br>Black wash", "● Oversized tee<br>Wide trouser"],
    ["Fearless tee<br>Ocean blue", "● Oversized tee<br>Black trouser"],
    ["Fearless tee<br>Yellow wash", "● Oversized tee<br>Black trouser"],
    ["RVCHL tee<br>Yellow", "● Oversized tee<br>Star wide-leg"]
  ];
  var current = 0;

  function onScroll() {
    var vh = window.innerHeight;
    drifts.forEach(function (el) {
      var r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var p = (vh - r.top) / (vh + r.height);
      el.style.transform = "translateX(" + (p * 30 * parseFloat(el.dataset.drift)) + "%)";
    });
    if (lookbook) {
      var b = lookbook.getBoundingClientRect();
      var prog = Math.min(0.999, Math.max(0, -b.top / (b.height - vh)));
      var idx = Math.floor(prog * lookImgs.length);
      if (idx !== current) {
        lookImgs[current].classList.remove("is-on");
        lookImgs[idx].classList.add("is-on");
        document.getElementById("lookName").innerHTML = LOOKS[idx][0];
        document.getElementById("lookItems").innerHTML = LOOKS[idx][1];
        document.getElementById("lookCount").textContent = "0" + (idx + 1) + " / 0" + lookImgs.length;
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
  if (!reduce) onScroll();

  // Newsletter (demo only, nothing is sent) ----------------------------------
  var form = document.getElementById("news");
  if (form) form.addEventListener("submit", function (e) {
    e.preventDefault();
    form.hidden = true;
    document.getElementById("newsOk").hidden = false;
  });
})();
