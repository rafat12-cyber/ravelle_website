// Builds the catalogue from content.js. With ?preview in the URL, the admin
// panel's unpublished draft (saved in this browser) is shown instead.
window.RAVELLE = (function () {
  var C = window.RAVELLE_CONTENT;
  if (/[?&]preview\b/.test(location.search)) {
    try {
      var draft = JSON.parse(localStorage.getItem("ravelle:draft") || "null");
      if (draft && draft.home && draft.products) C = window.RAVELLE_CONTENT = draft;
      // Photos published a moment ago may not be deployed yet; show the copy
      // the admin panel kept.
      var cache = JSON.parse(localStorage.getItem("ravelle:uploads") || "{}");
      C = window.RAVELLE_CONTENT = JSON.parse(JSON.stringify(C), function (k, v) { return typeof v === "string" && cache[v] ? cache[v] : v; });
    } catch (e) {}
  }

  var LINES = {}, ORDER = [];
  var P = C.products.filter(function (p) { return !p.hidden && p.img && p.img.length; });
  P.forEach(function (p, i) {
    p.id = p.slug;
    p.order = i;
    p.name = (p.label || p.line) + " Oversized T-shirt";
    p.was = Math.max(+p.was || 0, +p.price);
    p.off = p.was > p.price ? Math.round((1 - p.price / p.was) * 100) : 0;
    p.sizes = p.sizes && p.sizes.length ? p.sizes : ["M", "L", "XL", "2XL"];
    p.local = !/^https?:/.test(p.img[0]);
    p.url = "https://ravellebd.com/product/" + p.slug + "/";
    if (!(p.line in LINES)) { LINES[p.line] = p.about || ""; ORDER.push(p.line); }
  });

  return { products: P, lines: LINES, lineOrder: ORDER, collections: C.collections, home: C.home };
})();
