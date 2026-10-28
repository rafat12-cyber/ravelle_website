// Catalogue mirrored from ravellebd.com (WooCommerce Store API, Oct 2026).
// Local photos replace the matching live photo where we have one, so the
// page still has pictures when the live site can't be reached.
window.RAVELLE = (function () {
  var UP = "https://ravellebd.com/wp-content/uploads/2026/10/";
  var u = function (list) { return list.map(function (f) { return f.indexOf("/") > -1 ? f : UP + f; }); };

  var LINES = {
    "Fearless": "Cracked Fearless chest print on a dip-dyed, sun-faded body. Oversized fit with a dropped shoulder.",
    "RVCHL": "A small RVCHL wordmark on a boxy oversized blank. Easy to wear with anything.",
    "Stride Out": "Stride Out graphic on an oversized, dropped-shoulder body.",
    "Paradox": "Paradox graphic on an oversized, dropped-shoulder body.",
    "574": "Acid-washed oversized tee with the 574 graphic."
  };

  var P = [
    { line: "Fearless", color: "Black", hex: "#2b2c2e", price: 890, was: 1190, slug: "oversized-t-shirt-fearless-black",
      img: u(["assets/img/p-black.jpg", "assets/img/d-black.jpg", "DSC06896.jpg", "DSC06885.jpg"]), local: true, isNew: true },
    { line: "Fearless", color: "Ocean Blue", hex: "#3e6577", price: 890, was: 1190, slug: "fearless-oversized-t-shirt-ocean-blue",
      img: u(["assets/img/p-blue.jpg", "assets/img/d-blue.jpg", "DSC06927.jpg", "DSC06929.jpg", "DSC06934.jpg"]), local: true, isNew: true },
    { line: "Fearless", color: "Yellow", hex: "#b4a679", price: 890, was: 1190, slug: "fearless-oversized-t-shirt-yellow",
      img: u(["assets/img/p-yellow.jpg", "assets/img/d-yellow.jpg", "DSC07057-copy.jpg", "DSC07061.jpg", "DSC07059.jpg"]), local: true, isNew: true },
    { line: "Fearless", color: "Brick Red", hex: "#8e3b2c", price: 890, was: 1190, slug: "oversized-t-shirt-fearless-bricks-red",
      img: u(["DSC06870.jpg", "DSC06875-Recovered.jpg", "DSC06860.jpg", "DSC06862.jpg"]) },
    { line: "RVCHL", color: "Yellow", hex: "#b3a578", price: 890, was: 1190, slug: "rvchl-oversized-t-shirt-yellow",
      img: u(["assets/img/p-rvchl.jpg", "assets/img/d-rvchl.jpg", "DSC07102-1.jpg", "DSC07100-1.jpg"]), local: true },
    { line: "RVCHL", color: "Ocean Blue", hex: "#335a6c", price: 890, was: 1190, slug: "rvchl-oversized-t-shirt-ocean-blue",
      img: u(["DSC07019.jpg", "DSC07015.jpg", "DSC07007.jpg"]) },
    { line: "RVCHL", color: "Black", hex: "#1f2022", price: 890, was: 1190, slug: "rvchl-oversized-t-shirt-black",
      img: u(["DSC07142.jpg", "DSC07147.jpg", "DSC07137.jpg"]) },
    { line: "Stride Out", color: "Brick Red", hex: "#8e3b2c", price: 890, was: 1190, slug: "stride-out-oversized-t-shirt-brick-red",
      img: u(["DSC07039-e1791909755544.jpg", "DSC07028.jpg"]), isNew: true },
    { line: "Stride Out", color: "Black", hex: "#232426", price: 890, was: 1190, slug: "stride-out-oversized-t-shirt-black",
      img: u(["DSC06916-e1791909430135.jpg", "DSC06907.jpg", "DSC06912.jpg", "DSC06914.jpg"]), isNew: true },
    { line: "Stride Out", color: "Blue", hex: "#3b5677", price: 890, was: 1190, slug: "stride-out-oversized-t-shirt-blue",
      img: u(["DSC07320-e1791909216302.jpg", "DSC07313.jpg", "DSC07318.jpg", "DSC07326.jpg"]), isNew: true },
    { line: "Paradox", color: "Cream", hex: "#c9bda3", price: 890, was: 1190, slug: "paradox-oversized-t-shirt-cream",
      img: u(["DSC07500-e1791908150328.jpg", "DSC07506.jpg", "DSC07491.jpg"]) },
    { line: "Paradox", color: "Black", hex: "#1f2022", price: 890, was: 1190, slug: "paradox-oversized-t-shirt-black",
      img: u(["DSC07342-1.jpg", "DSC07346-1.jpg", "DSC07350-1.jpg"]) },
    { line: "574", label: "574 Acid Washed", color: "Coffee", hex: "#5b4335", price: 680, was: 990, slug: "574-acid-washed-oversized-t-shirt-coffee",
      img: u(["DSC07487-e1791908605959.jpg", "DSC07490.jpg", "DSC07486.jpg"]) },
    { line: "574", label: "574 Acid Washed", color: "Yellow", hex: "#a3904f", price: 680, was: 990, slug: "574-acid-washed-oversized-t-shirt-yellow",
      img: u(["DSC07374-e1791908428897.jpg", "DSC07368-e1791908334225.jpg", "DSC07353.jpg", "DSC07355.jpg"]) },
    { line: "574", label: "574 Acid Washed", color: "Brick Red", hex: "#8e3b2c", price: 680, was: 990, slug: "574-oversized-t-shirt-brick-red",
      img: u(["DSC07477-e1791908074932.jpg", "DSC07480.jpg", "DSC07469.jpg", "DSC07479.jpg"]) }
  ];
  P.forEach(function (p, i) {
    p.id = p.slug;
    p.order = i;
    p.name = (p.label || p.line) + " Oversized T-shirt";
    p.off = Math.round((1 - p.price / p.was) * 100);
    p.sizes = ["M", "L", "XL", "2XL"];
    p.about = LINES[p.line];
    p.url = "https://ravellebd.com/product/" + p.slug + "/";
  });

  var COLLECTIONS = [
    { slug: "nior-division", name: "Nior Division", mood: "Dark washes for the after hours.", img: "assets/img/c-black.webp", n: "01" },
    { slug: "saint-sinners", name: "Saint & Sinners Hype", mood: "Loud graphics, quiet confidence.", img: "assets/img/c-blue.webp", n: "02" },
    { slug: "essential", name: "Essential Collection", mood: "The everyday blanks, cut heavy.", img: "assets/img/c-yellow.webp", n: "03" },
    { slug: "obsedian", name: "Obsedian Virtue", mood: "Black on black, built to last.", img: "assets/img/c-rvchl.webp", n: "04" },
    { slug: "monarch-drop", name: "Monarch Drop", mood: "Regal details on everyday shapes.", img: "assets/img/c-black.webp", n: "05" }
  ];

  return { products: P, lines: LINES, collections: COLLECTIONS };
})();
