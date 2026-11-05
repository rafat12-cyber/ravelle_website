// Search engines, link previews and shopping feeds.
//
// Every store page has a real address (/product/<slug>, /product-category/<slug>, /shop...).
// For each one the server writes the page's own <title>, description, canonical address,
// Facebook/WhatsApp preview tags and structured data (schema.org) into index.html before
// sending it, so Google, Facebook and Merchant Center see the right page without running
// the store's JavaScript. It also serves /sitemap.xml, /robots.txt and the product feeds
// for Meta (/feeds/meta.csv) and Google Merchant Center (/feeds/google.xml).
"use strict";

var POLICIES = { terms: "Terms & conditions", privacy: "Privacy policy", refund: "Return & refund policy", delivery: "Delivery policy" };
var LISTS = {
  shop: { title: "Shop all", text: "Every Ravelle piece: oversized T-shirts, boxy shirts and baggy trousers." },
  "new-in": { title: "New in", text: "The latest Ravelle drops." },
  "on-sale": { title: "On sale", text: "Ravelle pieces marked down." }
};
var PAGES = { about: "About", contact: "Contact", "store-locations": "Store locations", franchise: "Franchise" };
// Pages people (and Google) shouldn't land on from search
var PRIVATE = { checkout: "Checkout", track: "Track your order", saved: "Saved", order: "Order", search: "Search", restore: "Your bag" };
// Addresses from the old WooCommerce site and other common spellings, moved for good (301)
var MOVED = {
  "home": "/", "cart": "/checkout", "my-account": "/track", "account": "/track", "stores": "/store-locations",
  "about-us": "/about", "contact-us": "/contact", "privacy-policy": "/privacy", "terms-and-conditions": "/terms", "terms-conditions": "/terms",
  "refund_returns": "/refund", "refund-policy": "/refund", "return-policy": "/refund", "returns": "/refund", "delivery-policy": "/delivery", "shipping-policy": "/delivery",
  "men": "/product-category/men", "women": "/product-category/women", "t-shirt": "/product-category/t-shirt", "the-house": "/product-category/the-house"
};

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function clip(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  s = s.slice(0, n - 1);
  return s.slice(0, Math.max(s.lastIndexOf(" "), n - 20)).replace(/[\s,.;:–-]+$/, "") + "…";
}
function money(n) { return Math.round(Number(n) || 0).toLocaleString("en-IN"); }
function storeName(db) { return ((db.settings || {}).store || {}).name || "Ravelle"; }
function abs(base, u) {
  if (!u || /^data:/.test(u)) return "";
  if (/^https?:\/\//.test(u)) return u;
  return base + "/" + String(u).replace(/^\.?\//, "").split("?")[0];
}
function published(db) { return (db.products || []).filter(function (p) { return p.status !== "draft"; }); }
function stockOf(p) {
  if (!p.trackStock) return null;
  if (p.variants && p.variants.length) return p.variants.reduce(function (s, v) { return s + Math.max(0, parseInt(v.stock, 10) || 0); }, 0);
  return Math.max(0, parseInt(p.stock, 10) || 0);
}
function inStock(p) { var s = stockOf(p); return s === null || s > 0; }
function catById(db, id) { return (db.categories || []).filter(function (c) { return c.id === id; })[0]; }
function catBySlug(db, slug) { return (db.categories || []).filter(function (c) { return c.slug === slug; })[0]; }
function catPath(db, c) { var out = []; while (c && out.length < 6) { out.unshift(c); c = c.parentId ? catById(db, c.parentId) : null; } return out; }
// The deepest category a product sits in (T-shirt rather than Men)
function mainCat(db, p) {
  var cats = (p.categoryIds || []).map(function (id) { return catById(db, id); }).filter(Boolean);
  return cats.sort(function (a, b) { return catPath(db, b).length - catPath(db, a).length; })[0] || null;
}
function catTree(db, p) {
  var seen = {};
  (p.categoryIds || []).forEach(function (id) { catPath(db, catById(db, id)).forEach(function (c) { seen[c.slug] = 1; }); });
  return seen;
}
function productsIn(db, cat) {
  return published(db).filter(function (p) { return catTree(db, p)[cat.slug]; });
}
function offOf(p) { return p.comparePrice > p.price ? Math.round((1 - p.price / p.comparePrice) * 100) : 0; }
function productUrl(base, p) { return base + "/product/" + encodeURIComponent(p.slug); }
function catUrl(base, c) { return base + "/product-category/" + encodeURIComponent(c.slug); }

// Google's product types: T-shirts, polos and shirts are "Shirts & Tops" (212), trousers are "Pants" (204)
function googleCategory(db, p) {
  var t = catTree(db, p);
  if (t.trouser || t["denim-pant"]) return "204";
  if (t["t-shirt"] || t.polo || t["half-shirt"] || t["full-shirt"]) return "212";
  var n = (p.name || "").toLowerCase();
  if (/trouser|pant|jogger|denim/.test(n)) return "204";
  if (/shirt|tee|polo|top/.test(n)) return "212";
  return "1604";
}
function gender(db, p) {
  var t = catTree(db, p);
  return t.men && t.women ? "unisex" : t.women ? "female" : t.men ? "male" : "unisex";
}
function sizesOf(p) {
  var out = [];
  (p.variants || []).forEach(function (v) {
    var s = v.options && (v.options.Size || v.options.size);
    if (s && out.indexOf(s) < 0 && (!p.trackStock || (parseInt(v.stock, 10) || 0) > 0)) out.push(s);
  });
  return out;
}
function productDescription(db, p) {
  if (p.seoDescription) return p.seoDescription;
  var lead = clip(p.description || p.name, 110);
  return clip(lead + " ৳" + money(p.price) + (offOf(p) ? " (was ৳" + money(p.comparePrice) + ")" : "") + ". Cash on delivery all over Bangladesh.", 160);
}

// --- Structured data (schema.org JSON-LD) ------------------------------------------------------
function organization(db, base) {
  var st = (db.settings || {}).store || {}, so = (db.settings || {}).social || {};
  var same = ["facebook", "instagram", "tiktok", "youtube"].map(function (k) { return so[k]; }).filter(function (u) { return /^https?:\/\//.test(u || ""); });
  var org = { "@type": "Organization", "@id": base + "/#organization", name: storeName(db), url: base + "/", logo: base + "/assets/img/logo.webp" };
  if (st.legalName) org.legalName = st.legalName;
  if (st.email) org.email = st.email;
  if (st.phone && !/X{3}/.test(st.phone)) org.telephone = st.phone;
  if (same.length) org.sameAs = same;
  return org;
}
function breadcrumbs(items) {
  return { "@type": "BreadcrumbList", itemListElement: items.map(function (it, i) { return { "@type": "ListItem", position: i + 1, name: it[0], item: it[1] }; }) };
}
function shippingDetails(db) {
  var sh = (db.settings || {}).shipping || {}, zones = sh.zones || [];
  return zones.slice(0, 4).map(function (z) {
    var days = String(z.days || "").match(/(\d+)\D+(\d+)/) || String(z.days || "").match(/(\d+)/);
    var d = { "@type": "OfferShippingDetails", shippingLabel: z.name,
      shippingRate: { "@type": "MonetaryAmount", value: Number(z.fee) || 0, currency: "BDT" },
      shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD" } };
    if (days) d.deliveryTime = { "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: +days[1], maxValue: +(days[2] || days[1]), unitCode: "DAY" } };
    return d;
  });
}
function returnPolicy() {
  return { "@type": "MerchantReturnPolicy", applicableCountry: "BD", returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 7, returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/FreeReturn" };
}
function productLd(db, base, p) {
  var url = productUrl(base, p), cat = mainCat(db, p);
  var until = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
  var offer = { "@type": "Offer", url: url, priceCurrency: "BDT", price: p.price, priceValidUntil: until, itemCondition: "https://schema.org/NewCondition",
    availability: inStock(p) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", seller: { "@id": base + "/#organization" },
    hasMerchantReturnPolicy: returnPolicy() };
  var ship = shippingDetails(db);
  if (ship.length) offer.shippingDetails = ship;
  if (offOf(p)) offer.priceSpecification = [
    { "@type": "UnitPriceSpecification", price: p.price, priceCurrency: "BDT" },
    { "@type": "UnitPriceSpecification", priceType: "https://schema.org/StrikethroughPrice", price: p.comparePrice, priceCurrency: "BDT" }];
  var ld = { "@type": "Product", "@id": url + "#product", name: p.name, url: url, sku: p.sku, mpn: p.sku,
    description: clip(p.description || p.name, 1000), image: (p.images || []).slice(0, 8).map(function (i) { return abs(base, i); }).filter(Boolean),
    brand: { "@type": "Brand", name: storeName(db) }, offers: offer };
  if (p.color) ld.color = p.color;
  if (cat) ld.category = catPath(db, cat).map(function (c) { return c.name; }).join(" > ");
  var sz = sizesOf(p);
  if (sz.length) ld.size = sz.join(", ");
  ld.audience = { "@type": "PeopleAudience", suggestedGender: gender(db, p), suggestedMinAge: 13 };
  return ld;
}

// --- Page head for each address ----------------------------------------------------------------
// Returns { redirect } for a moved address, otherwise { status, title, description, canonical, image, type, noindex, ld, extra }
function resolve(db, base, pathname) {
  var p = pathname;
  if (p.length > 1 && /\/$/.test(p)) return { redirect: p.replace(/\/+$/, "") || "/" };
  var parts = p.replace(/^\/+/, "").split("/").filter(Boolean), first = parts[0] || "";
  var name = storeName(db), seo = (db.settings || {}).seo || {}, st = (db.settings || {}).store || {};
  var home = { "@type": "WebSite", "@id": base + "/#website", name: name, url: base + "/", publisher: { "@id": base + "/#organization" },
    potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: base + "/search/{q}" }, "query-input": "required name=q" } };
  var hero = ((db.pages || {}).home || {}).hero || {};
  var out = { status: 200, title: seo.title || name, description: seo.description || st.tagline || "", canonical: base + "/", image: abs(base, hero.image || "assets/img/logo.webp"),
    imageAlt: hero.imageAlt || name, type: "website", noindex: false, ld: [organization(db, base), home] };
  if (!first) return out;
  out.ld = [organization(db, base)];
  if (MOVED[first] && parts.length === 1) return { redirect: MOVED[first] };
  if (first === "category" && parts[1]) return { redirect: "/product-category/" + encodeURIComponent(parts[parts.length - 1]) };

  if (first === "product" && parts.length === 2) {
    var pr = published(db).filter(function (x) { return x.slug === parts[1]; })[0];
    if (!pr) return notFound(out, base);
    var cat = mainCat(db, pr), crumbs = [["Home", base + "/"]];
    if (cat) catPath(db, cat).forEach(function (c) { crumbs.push([c.name, catUrl(base, c)]); });
    crumbs.push([pr.name, productUrl(base, pr)]);
    out.title = (pr.seoTitle || pr.name) + " | " + name;
    out.description = productDescription(db, pr);
    out.canonical = productUrl(base, pr);
    out.image = abs(base, (pr.images || [])[0]) || out.image;
    out.imageAlt = pr.name;
    out.type = "product";
    out.extra = [["product:price:amount", String(pr.price)], ["product:price:currency", "BDT"], ["product:availability", inStock(pr) ? "in stock" : "out of stock"],
      ["product:condition", "new"], ["product:brand", name], ["product:retailer_item_id", pr.sku]];
    out.ld.push(productLd(db, base, pr), breadcrumbs(crumbs));
    out.body = crumbHtml(crumbs) + "<h1>" + esc(pr.name) + "</h1>" +
      '<p class="ssr__price">৳' + money(pr.price) + (offOf(pr) ? " <s>৳" + money(pr.comparePrice) + "</s>" : "") + (inStock(pr) ? "" : " · Sold out") + "</p>" +
      ((pr.images || [])[0] ? '<img src="' + esc(pr.images[0]) + '" alt="' + esc(pr.name) + '" width="690" height="966">' : "") +
      (pr.description ? "<p>" + esc(pr.description) + "</p>" : "") +
      ((pr.details || []).length ? "<ul>" + pr.details.map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul>" : "") +
      (sizesOf(pr).length ? "<p>Sizes: " + esc(sizesOf(pr).join(", ")) + "</p>" : "");
    return out;
  }
  if (first === "product-category" && parts.length >= 2) {
    var c = catBySlug(db, parts[parts.length - 1]);
    if (!c) return notFound(out, base);
    if (parts.length > 2) return { redirect: "/product-category/" + encodeURIComponent(c.slug) };
    var list = productsIn(db, c), crumbs2 = [["Home", base + "/"]];
    catPath(db, c).forEach(function (x) { crumbs2.push([x.name, catUrl(base, x)]); });
    out.title = (c.seoTitle || c.name) + " | " + name;
    out.description = c.seoDescription || clip((c.description ? c.description + " " : "") + (list.length ? "Shop " + list.length + " " + c.name.toLowerCase() + " pieces from " + name + ", from ৳" +
      money(Math.min.apply(null, list.map(function (x) { return x.price; }))) + ". Cash on delivery all over Bangladesh." : "Coming soon to " + name + "."), 160);
    out.canonical = catUrl(base, c);
    out.image = abs(base, c.image || (list[0] && list[0].images[0])) || out.image;
    out.imageAlt = c.name;
    out.ld.push(breadcrumbs(crumbs2), itemList(base, list));
    out.body = crumbHtml(crumbs2) + "<h1>" + esc(c.name) + "</h1>" + (c.description ? "<p>" + esc(c.description) + "</p>" : "") + listHtml(list) +
      (c.seoText ? c.seoText.split(/\n{2,}/).map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") : "");
    return out;
  }
  if (LISTS[first] && parts.length === 1) {
    var items = published(db).filter(function (x) { return first === "new-in" ? x.isNew : first === "on-sale" ? offOf(x) > 0 : true; });
    out.title = LISTS[first].title + " | " + name;
    out.description = clip(LISTS[first].text + " " + items.length + " pieces. Cash on delivery all over Bangladesh.", 160);
    out.canonical = base + "/" + first;
    out.ld.push(breadcrumbs([["Home", base + "/"], [LISTS[first].title, out.canonical]]), itemList(base, items));
    out.body = "<h1>" + esc(LISTS[first].title) + "</h1><p>" + esc(LISTS[first].text) + "</p>" + listHtml(items);
    return out;
  }
  if ((PAGES[first] || POLICIES[first]) && parts.length === 1) {
    var pg = (db.pages || {})[first === "store-locations" ? "stores" : first] || {};
    if (POLICIES[first] && !(db.pages || {})[first]) return notFound(out, base);
    var heading = POLICIES[first] || [pg.title, pg.accent, pg.titleEnd].filter(Boolean).join(" ") || PAGES[first];
    out.title = (POLICIES[first] || PAGES[first]) + " | " + name;
    out.description = clip(pg.intro || pg.text || (POLICIES[first] ? heading + " for " + name + "." : out.description), 160);
    out.canonical = base + "/" + first;
    if (pg.image) out.image = abs(base, pg.image);
    out.ld.push(breadcrumbs([["Home", base + "/"], [POLICIES[first] || PAGES[first], out.canonical]]));
    if (first === "store-locations") storesLd(db, base, pg).forEach(function (x) { out.ld.push(x); });
    out.body = "<h1>" + esc(heading) + "</h1>" + [pg.intro, pg.body, pg.story, pg.text].filter(function (t) { return typeof t === "string" && t; }).join("\n\n")
      .split(/\n{2,}/).slice(0, 40).map(function (t) { t = t.replace(/\*\*/g, "").trim(); return /^##\s/.test(t) ? "<h2>" + esc(t.replace(/^##\s*/, "")) + "</h2>" : "<p>" + esc(t.replace(/^-\s/gm, "· ")) + "</p>"; }).join("");
    return out;
  }
  if (PRIVATE[first] && (parts.length === 1 || ["order", "search", "restore"].indexOf(first) > -1)) {
    out.title = (first === "search" && parts[1] ? "Search: " + decodeSafe(parts.slice(1).join("/")) : PRIVATE[first]) + " | " + name;
    out.canonical = base + "/" + first;
    out.noindex = true;
    out.ld = [];
    return out;
  }
  return notFound(out, base);
}
function crumbHtml(items) {
  return '<nav class="ssr__crumbs" aria-label="Breadcrumb">' + items.map(function (it) { return '<a href="' + esc(it[1].replace(/^https?:\/\/[^/]+/, "") || "/") + '">' + esc(it[0]) + "</a>"; }).join(" / ") + "</nav>";
}
function listHtml(list) {
  return list.length ? '<ul class="ssr__list">' + list.map(function (p) { return '<li><a href="/product/' + esc(encodeURIComponent(p.slug)) + '">' + esc(p.name) + "</a> · ৳" + money(p.price) + "</li>"; }).join("") + "</ul>" : "";
}
function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function notFound(out, base) {
  out.status = 404; out.title = "Page not found | " + out.title.split(" | ").pop(); out.noindex = true; out.ld = []; out.canonical = base + "/";
  return out;
}
function itemList(base, list) {
  return { "@type": "ItemList", itemListElement: list.slice(0, 30).map(function (p, i) { return { "@type": "ListItem", position: i + 1, url: productUrl(base, p) }; }) };
}
// Each shop on the Store locations page, so it can show on Google Maps and in local search
function storesLd(db, base, pg) {
  var shops = [];
  (pg.districts || pg.groups || []).forEach(function (d) { (d.shops || d.stores || []).forEach(function (s) { shops.push(Object.assign({ district: d.name || d.district }, s)); }); });
  (pg.shops || pg.stores || []).forEach(function (s) { shops.push(s); });
  return shops.filter(function (s) { return s && s.name && s.address; }).slice(0, 40).map(function (s) {
    var o = { "@type": "ClothingStore", name: storeName(db) + " – " + s.name, parentOrganization: { "@id": base + "/#organization" }, url: base + "/store-locations",
      address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: s.district || s.city || "", addressCountry: "BD" } };
    if (s.phone) o.telephone = s.phone;
    if (s.hours) o.openingHours = s.hours;
    if (s.image) o.image = abs(base, s.image);
    return o;
  });
}

// Writes the head tags into index.html
function render(html, head) {
  var tags = [
    '<link rel="canonical" href="' + esc(head.canonical) + '">',
    head.noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="' + esc(head.type) + '">',
    '<meta property="og:site_name" content="' + esc(head.title.split(" | ").pop()) + '">',
    '<meta property="og:title" content="' + esc(head.title.split(" | ")[0]) + '">',
    '<meta property="og:description" content="' + esc(head.description) + '">',
    '<meta property="og:url" content="' + esc(head.canonical) + '">',
    '<meta property="og:locale" content="en_US">',
    head.image ? '<meta property="og:image" content="' + esc(head.image) + '">\n<meta property="og:image:alt" content="' + esc(head.imageAlt || "") + '">' : "",
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(head.title) + '">',
    '<meta name="twitter:description" content="' + esc(head.description) + '">',
    head.image ? '<meta name="twitter:image" content="' + esc(head.image) + '">' : ""
  ].concat((head.extra || []).map(function (e) { return '<meta property="' + esc(e[0]) + '" content="' + esc(e[1]) + '">'; }));
  if (head.ld && head.ld.length) tags.push('<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@graph": head.ld }).replace(/</g, "\\u003c") + "</script>");
  if (head.body) {
    // A page other than home: show the page view (not the home page) with its content already in it.
    // The store's JavaScript draws the full page over it a moment later.
    html = html.replace('<div data-view="home" data-page="home">', '<div data-view="home" data-page="home" hidden>')
      .replace('<div data-view="page" hidden>', '<div data-view="page">')
      .replace(/<link rel="preload" as="image"[^>]*>\n?/, "")
      // the home page's hero photo is hidden on this page: don't download it
      .replace(/(<figure class="hero__model">\s*<img )([^>]*?)fetchpriority="high"/, '$1$2loading="lazy"')
      .replace('<main id="page" class="page"></main>', '<main id="page" class="page"><section class="ssr">' + head.body + "</section></main>");
  }
  return html
    .replace(/<meta charset="utf-8">/i, '<meta charset="utf-8">\n<base href="/">')
    .replace(/<title>[\s\S]*?<\/title>/i, "<title>" + esc(head.title) + "</title>")
    .replace(/<meta name="description" content="[^"]*">/i, '<meta name="description" content="' + esc(head.description) + '">\n<meta name="rv-routes" content="path">\n' + tags.filter(Boolean).join("\n"));
}

// --- Sitemap and robots ------------------------------------------------------------------------
function sitemap(db, base) {
  var day = function (t) { return new Date(t || Date.now()).toISOString().slice(0, 10); };
  var newest = published(db).reduce(function (m, p) { return Math.max(m, p.updatedAt || p.createdAt || 0); }, 0);
  var urls = [{ loc: base + "/", mod: newest, pri: "1.0" }];
  ["shop", "new-in", "on-sale"].forEach(function (k) { urls.push({ loc: base + "/" + k, mod: newest, pri: "0.8" }); });
  (db.categories || []).forEach(function (c) { if (productsIn(db, c).length) urls.push({ loc: catUrl(base, c), mod: newest, pri: "0.8" }); });
  published(db).forEach(function (p) {
    urls.push({ loc: productUrl(base, p), mod: p.updatedAt || p.createdAt, pri: "0.9", images: (p.images || []).slice(0, 4).map(function (i) { return abs(base, i); }).filter(Boolean) });
  });
  ["about", "contact", "store-locations", "franchise"].forEach(function (k) { urls.push({ loc: base + "/" + k, pri: "0.5" }); });
  Object.keys(POLICIES).forEach(function (k) { if ((db.pages || {})[k]) urls.push({ loc: base + "/" + k, pri: "0.3" }); });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    urls.map(function (u) {
      return "<url><loc>" + esc(u.loc) + "</loc>" + (u.mod ? "<lastmod>" + day(u.mod) + "</lastmod>" : "") + "<priority>" + u.pri + "</priority>" +
        (u.images || []).map(function (i) { return "<image:image><image:loc>" + esc(i) + "</image:loc></image:image>"; }).join("") + "</url>";
    }).join("\n") + "\n</urlset>\n";
}
function robots(base) {
  return "User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\nDisallow: /order/\nDisallow: /restore/\nDisallow: /saved\n\nSitemap: " + base + "/sitemap.xml\n";
}

// --- Product feeds -----------------------------------------------------------------------------
// One row per product (one colour). The id is the product SKU, the same id the Meta Pixel and GA4
// send with every view, add to bag and purchase, so catalog ads can show people what they looked at.
function feedRows(db, base) {
  var name = storeName(db), zones = (((db.settings || {}).shipping || {}).zones || []);
  return published(db).filter(function (p) { return p.sku && p.price > 0 && (p.images || []).length; }).map(function (p) {
    var cat = mainCat(db, p), sale = offOf(p) > 0;
    return {
      id: p.sku, group: p.line || "", title: clip(p.name, 150), description: clip(p.description || p.name, 4900), link: productUrl(base, p),
      image: abs(base, p.images[0]), images: p.images.slice(1, 10).map(function (i) { return abs(base, i); }).filter(Boolean),
      available: inStock(p), price: sale ? p.comparePrice : p.price, salePrice: sale ? p.price : 0, brand: name,
      googleCategory: googleCategory(db, p), productType: cat ? catPath(db, cat).map(function (c) { return c.name; }).join(" > ") : "",
      color: p.color || "", gender: gender(db, p), sizes: sizesOf(p), zones: zones, isNew: !!p.isNew, stock: stockOf(p)
    };
  });
}
function googleFeed(db, base) {
  var x = function (tag, v) { return v === "" || v == null ? "" : "<g:" + tag + ">" + esc(v) + "</g:" + tag + ">"; };
  var items = feedRows(db, base).map(function (r) {
    return "<item>" + x("id", r.id) + "<title>" + esc(r.title) + "</title><description>" + esc(r.description) + "</description><link>" + esc(r.link) + "</link>" +
      x("image_link", r.image) + r.images.map(function (i) { return x("additional_image_link", i); }).join("") +
      x("availability", r.available ? "in_stock" : "out_of_stock") + x("price", r.price.toFixed(2) + " BDT") + (r.salePrice ? x("sale_price", r.salePrice.toFixed(2) + " BDT") : "") +
      x("brand", r.brand) + x("condition", "new") + x("identifier_exists", "no") + x("google_product_category", r.googleCategory) + x("product_type", r.productType) +
      x("item_group_id", r.group) + x("color", r.color) + x("gender", r.gender) + x("age_group", "adult") + (r.sizes.length ? x("size", r.sizes.join("/")) : "") +
      r.zones.map(function (z) { return "<g:shipping>" + x("country", "BD") + x("service", z.name) + x("price", (Number(z.fee) || 0).toFixed(2) + " BDT") + "</g:shipping>"; }).join("") +
      (r.isNew ? x("custom_label_0", "new in") : "") + (r.salePrice ? x("custom_label_1", "on sale") : "") + "</item>";
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>' + esc(storeName(db)) + "</title><link>" + esc(base + "/") +
    "</link><description>" + esc(storeName(db)) + " products</description>\n" + items.join("\n") + "\n</channel></rss>\n";
}
function csvCell(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function metaFeed(db, base) {
  var head = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "additional_image_link", "brand",
    "google_product_category", "product_type", "item_group_id", "color", "gender", "age_group", "size", "quantity_to_sell_on_facebook", "custom_label_0", "custom_label_1"];
  var rows = feedRows(db, base).map(function (r) {
    return [r.id, r.title, r.description, r.available ? "in stock" : "out of stock", "new", r.price.toFixed(2) + " BDT", r.salePrice ? r.salePrice.toFixed(2) + " BDT" : "",
      r.link, r.image, r.images.join(","), r.brand, r.googleCategory, r.productType, r.group, r.color, r.gender, "adult", r.sizes.join("/"),
      r.stock === null ? "" : r.stock, r.isNew ? "new in" : "", r.salePrice ? "on sale" : ""].map(csvCell).join(",");
  });
  return [head.join(",")].concat(rows).join("\n") + "\n";
}

// One product as a Meta catalog item (the same fields as the feed), for the instant catalog updates
function metaItem(db, base, p) {
  var r = feedRows(db, base).filter(function (x) { return x.id === p.sku; })[0];
  if (!r) return null;
  var d = { id: r.id, title: r.title, description: r.description, availability: r.available ? "in stock" : "out of stock", condition: "new",
    price: r.price.toFixed(2) + " BDT", link: r.link, image_link: r.image, brand: r.brand, google_product_category: r.googleCategory,
    gender: r.gender, age_group: "adult" };
  if (r.salePrice) d.sale_price = r.salePrice.toFixed(2) + " BDT";
  if (r.images.length) d.additional_image_link = r.images.join(",");
  if (r.productType) d.product_type = r.productType;
  if (r.group) d.item_group_id = r.group;
  if (r.color) d.color = r.color;
  if (r.sizes.length) d.size = r.sizes.join("/");
  if (r.stock !== null) d.quantity_to_sell_on_facebook = r.stock;
  // Labels for product sets in Commerce Manager ("New in", "On sale"); empty clears an old label
  d.custom_label_0 = r.isNew ? "new in" : "";
  d.custom_label_1 = r.salePrice ? "on sale" : "";
  return d;
}
function catalogProducts(db) { return published(db).filter(function (p) { return p.sku && p.price > 0 && (p.images || []).length; }); }

// The announcement bar, drawn into the page by the server so it is there from the first paint
// (when the script added it later, the whole page jumped down: Google counts that as layout shift)
function announce(html, settings) {
  var head = ((settings || {}).layout || {}).header || {}, text = (settings || {}).announcement;
  if (!text || head.announce === false) return html;
  var color = function (c) { return c && /^[#\w(),.%\s-]{1,40}$/.test(c) ? c : ""; };
  var style = (color(head.announceBg) ? "background:" + color(head.announceBg) + ";" : "") + (color(head.announceColor) ? "color:" + color(head.announceColor) + ";" : "");
  return html.replace('<p class="announce mono" id="announce" hidden></p>', '<p class="announce mono" id="announce"' + (style ? ' style="' + esc(style) + '"' : "") + ">" + esc(text) + "</p>");
}

module.exports = { announce: announce, metaItem: metaItem, catalogProducts: catalogProducts, resolve: resolve, render: render, sitemap: sitemap, robots: robots, googleFeed: googleFeed, metaFeed: metaFeed };
