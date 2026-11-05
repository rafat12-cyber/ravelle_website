// Starting data for a new store: settings, categories, variations, the 41
// products from the October 2026 shoot, page content and menus.
// The server copies this into data/db.json on first run; the demo copies it
// into the browser. Edit the live data from the admin panel, not here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RAVELLE_SEED = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Product photos: front, front close-up, side, back (assets/img/products/<name>-1..4.webp)
  var photos = function (name, count) { var out = []; for (var i = 1; i <= count; i++) out.push("assets/img/products/" + name + "-" + i + ".webp"); return out; };
  var T0 = Date.UTC(2026, 9, 20);

  // ---------------------------------------------------------------------------
  // Categories (from the ravellebd.com menu)
  // ---------------------------------------------------------------------------
  var CATS = [
    ["men", "Men", null, 1, "assets/img/home/h-look-3.webp", "Oversized tees, shirts and trousers."],
    ["t-shirt", "T-shirt", "men", 1, "assets/img/home/h-hero.webp", "Heavyweight oversized tees."],
    ["polo", "Polo", "men", 2, "", ""],
    ["half-shirt", "Half shirt", "men", 3, "", ""],
    ["full-shirt", "Full shirt", "men", 4, "", ""],
    ["trouser", "Trouser", "men", 5, "", ""],
    ["denim-pant", "Denim pant", "men", 6, "", ""],
    ["women", "Women", null, 2, "assets/img/c-blue.webp", "The women's line is on its way."],
    ["the-house", "The House", null, 3, "assets/img/home/h-collage-b.webp", "Five collections from Ravelle, each with its own mood."],
    ["nior-division", "Nior Division", "the-house", 1, "assets/img/home/h-house-1.webp", "Dark washes for the after hours."],
    ["saint-sinners", "Saint & Sinners Hype", "the-house", 2, "assets/img/home/h-house-2.webp", "Loud graphics, quiet confidence."],
    ["essential", "Essential Collection", "the-house", 3, "assets/img/home/h-look-4.webp", "The everyday blanks, cut heavy."],
    ["obsedian", "Obsedian Virtue", "the-house", 4, "assets/img/home/h-look-1.webp", "Black on black, built to last."],
    ["monarch-drop", "Monarch Drop", "the-house", 5, "assets/img/home/h-look-2.webp", "Regal details on everyday shapes."]
  ];
  // A short paragraph under each category's products, written for search engines (Admin › Categories)
  var SEO_TEXT = {
    "men": "Oversized T-shirts, boxy shirts and baggy trousers for men, designed in Dhaka. Cash on delivery all over Bangladesh and exchange within 7 days.",
    "t-shirt": "Ravelle oversized T-shirts are cut heavy, with a dropped shoulder and a boxy, relaxed fit. Choose printed graphic tees or acid-washed tees, made in Bangladesh and delivered across the country with cash on delivery.",
    "half-shirt": "Boxy fitted half-sleeve shirts with a straight hem and a relaxed shoulder. Wear one open over a tee or buttoned up on its own.",
    "trouser": "Baggy trousers with a wide, straight leg and an easy waist. They sit right with an oversized tee or a boxy shirt."
  };
  var SEO_TITLE = { "men": "Men's Oversized Clothing in Bangladesh", "t-shirt": "Oversized T-shirts in Bangladesh", "half-shirt": "Boxy Half Shirts in Bangladesh", "trouser": "Baggy Trousers in Bangladesh" };
  var categories = CATS.map(function (c) {
    return { id: "cat_" + c[0].replace(/-/g, "_"), slug: c[0], name: c[1], parentId: c[2] ? "cat_" + c[2].replace(/-/g, "_") : null,
      order: c[3], image: c[4], description: c[5], seoText: SEO_TEXT[c[0]] || "", seoTitle: SEO_TITLE[c[0]] || "", createdAt: T0 };
  });

  var attributes = [
    { id: "att_size", name: "Size", type: "button", values: ["S", "M", "L", "XL", "2XL", "3XL"].map(function (v) { return { label: v }; }), createdAt: T0 },
    { id: "att_color", name: "Color", type: "color", values: [
      { label: "Black", hex: "#1f2022" }, { label: "Ocean Blue", hex: "#3e6577" }, { label: "Yellow", hex: "#b4a679" },
      { label: "Brick Red", hex: "#8e3b2c" }, { label: "Blue", hex: "#3b5677" }, { label: "Cream", hex: "#c9bda3" }, { label: "Coffee", hex: "#5b4335" },
      { label: "Green", hex: "#2f8f6b" }, { label: "Red", hex: "#b52a45" }, { label: "Pink", hex: "#c93f5f" }, { label: "Charcoal", hex: "#45474b" }
    ], createdAt: T0 }
  ];

  // ---------------------------------------------------------------------------
  // Products. One colour is one product; sizes are its variations. A line's
  // type sets how its products are named and which category they sit in.
  // ---------------------------------------------------------------------------
  var TYPE = {
    tee: { name: function (line, color) { return line + " Oversized T-shirt – " + color; }, cat: "cat_t_shirt" },
    shirt: { name: function (line, color) { return "Boxy Fitted Shirt – " + color; }, cat: "cat_half_shirt" },
    trouser: { name: function (line, color) { return "Baggy Trouser – " + color; }, cat: "cat_trouser" }
  };
  var LINE = {
    "Fearless": { code: "FRL", about: "Cracked Fearless chest print on a dip-dyed, sun-faded body. Oversized fit with a dropped shoulder." },
    "RVCHL": { code: "RVC", about: "A small RVCHL wordmark on a boxy oversized blank. Easy to wear with anything." },
    "Stride Out": { code: "STO", about: "Stride Out graphic on an oversized, dropped-shoulder body." },
    "Paradox": { code: "PDX", about: "Paradox graphic on an oversized, dropped-shoulder body." },
    "574 Acid Washed": { code: "574", about: "Acid-washed oversized tee with the 574 graphic." },
    "Brand New Day": { code: "BND", about: "Brand New Day spider graphic on an acid-washed, oversized body." },
    "After Hours": { code: "AFH", about: "After Hours city-at-night print on a sun-faded, dip-dyed oversized body." },
    "Trust Broken": { code: "TRB", about: "Small chest mark up front, Trust Broken chain print across the back. Faded, dip-dyed oversized body." },
    "Starlight": { code: "STL", about: "Small chest logo up front, a big star-burst script print across the back. Faded oversized body." },
    "Santa Rosa": { code: "SRS", about: "Small chest patch up front, a Santa Rosa newspaper-and-roses collage across the back." },
    "Talking Rubbish": { code: "TRS", about: "\"Why do you think you're talking rubbish?\" printed at the chest, photo print on the back." },
    "Cloud Nine": { code: "CL9", about: "Small chest logo up front, a black-and-white cloud photo collage across the back." },
    "Halo": { code: "HAL", about: "Round Halo graphic on an acid-washed, oversized body." },
    "Boxy Fitted Shirt": { code: "BXS", type: "shirt", about: "Short-sleeve shirt with a boxy, relaxed fit, an open collar and an all-over print." },
    "Baggy Trouser": { code: "BGT", type: "trouser", about: "Wide, baggy-fit trouser with a relaxed, full-length leg." }
  };
  var COLOR = { "Black": "BLK", "Ocean Blue": "OBL", "Yellow": "YLW", "Brick Red": "BRD", "Blue": "BLU", "Cream": "CRM", "Coffee": "COF",
    "Green": "GRN", "Red": "RED", "Pink": "PNK", "Charcoal": "CHR",
    "Mosaic": "MOS", "Line Art": "LNA", "Coral Wave": "CRW", "Sage Garden": "SGG", "Mono Bloom": "MNB" };
  var FIT = ["Model usually wears size L top and 32 waist bottoms. Model is wearing size L.", "Fits true to size.",
    "Model height: 6 ft 2 in (183 cm). Chest: 38 in (97 cm). Shoulder: 18.5 in (47 cm)."];
  var P = [
    ["Fearless", "Black", "#2b2c2e", 890, 1190, "oversized-t-shirt-fearless-black", photos("fearless-black", 4), true, true],
    ["Fearless", "Ocean Blue", "#3e6577", 890, 1190, "fearless-oversized-t-shirt-ocean-blue", photos("fearless-ocean-blue", 4), true, true],
    ["Fearless", "Yellow", "#b4a679", 890, 1190, "fearless-oversized-t-shirt-yellow", photos("fearless-yellow", 4), true, true],
    ["Fearless", "Brick Red", "#8e3b2c", 890, 1190, "oversized-t-shirt-fearless-bricks-red", photos("fearless-brick-red", 4), false, false],
    ["RVCHL", "Yellow", "#b3a578", 890, 1190, "rvchl-oversized-t-shirt-yellow", photos("rvchl-yellow", 4), false, true],
    ["RVCHL", "Ocean Blue", "#335a6c", 890, 1190, "rvchl-oversized-t-shirt-ocean-blue", photos("rvchl-ocean-blue", 4), false, false],
    ["RVCHL", "Black", "#1f2022", 890, 1190, "rvchl-oversized-t-shirt-black", photos("rvchl-black", 4), false, false],
    ["Stride Out", "Brick Red", "#8e3b2c", 890, 1190, "stride-out-oversized-t-shirt-brick-red", photos("stride-out-brick-red", 2), true, false],
    ["Stride Out", "Black", "#232426", 890, 1190, "stride-out-oversized-t-shirt-black", photos("stride-out-black", 4), true, false],
    ["Stride Out", "Blue", "#3b5677", 890, 1190, "stride-out-oversized-t-shirt-blue", photos("stride-out-blue", 4), true, false],
    ["Paradox", "Cream", "#c9bda3", 890, 1190, "paradox-oversized-t-shirt-cream", photos("paradox-cream", 4), false, false],
    ["Paradox", "Black", "#1f2022", 890, 1190, "paradox-oversized-t-shirt-black", photos("paradox-black", 4), false, false],
    ["574 Acid Washed", "Coffee", "#5b4335", 680, 990, "574-acid-washed-oversized-t-shirt-coffee", photos("574-coffee", 3), false, false],
    ["574 Acid Washed", "Yellow", "#a3904f", 680, 990, "574-acid-washed-oversized-t-shirt-yellow", photos("574-yellow", 4), false, false],
    ["574 Acid Washed", "Brick Red", "#8e3b2c", 680, 990, "574-oversized-t-shirt-brick-red", photos("574-brick-red", 4), false, false],
    ["Brand New Day", "Black", "#2e2f31", 680, 990, "brand-new-day-acid-washed-oversized-t-shirt-black", photos("brand-new-day-black", 4), true, false],
    ["Brand New Day", "Green", "#2f8f6b", 680, 990, "brand-new-day-acid-washed-oversized-t-shirt-green", photos("brand-new-day-green", 2), true, false],
    ["After Hours", "Black", "#2b2c2e", 890, 1190, "after-hours-oversized-t-shirt-black", photos("after-hours-black", 4), true, false],
    ["After Hours", "Ocean Blue", "#3e6577", 890, 1190, "after-hours-oversized-t-shirt-ocean-blue", photos("after-hours-blue", 4), true, false],
    ["Trust Broken", "Ocean Blue", "#3e6577", 890, 1190, "trust-broken-oversized-t-shirt-ocean-blue", photos("trust-broken-blue", 4), true, false],
    ["Trust Broken", "Black", "#2b2c2e", 890, 1190, "trust-broken-oversized-t-shirt-black", photos("trust-broken-black", 4), true, false],
    ["Starlight", "Ocean Blue", "#3e6577", 890, 1190, "starlight-oversized-t-shirt-ocean-blue", photos("starlight-blue", 4), true, false],
    ["Starlight", "Black", "#2b2c2e", 890, 1190, "starlight-oversized-t-shirt-black", photos("starlight-black", 4), true, false],
    ["Starlight", "Cream", "#c9bda3", 890, 1190, "starlight-oversized-t-shirt-cream", photos("starlight-cream", 4), true, false],
    ["Santa Rosa", "Ocean Blue", "#3e6577", 890, 1190, "santa-rosa-oversized-t-shirt-ocean-blue", photos("santa-rosa-blue", 4), true, false],
    ["Santa Rosa", "Red", "#b52a45", 890, 1190, "santa-rosa-oversized-t-shirt-red", photos("santa-rosa-red", 4), true, false],
    ["Santa Rosa", "Black", "#1f2022", 890, 1190, "santa-rosa-oversized-t-shirt-black", photos("santa-rosa-black", 4), true, false],
    ["Talking Rubbish", "Black", "#1f2022", 890, 1190, "talking-rubbish-oversized-t-shirt-black", photos("talking-rubbish-black", 4), true, false],
    ["Cloud Nine", "Brick Red", "#8e4a3c", 680, 990, "cloud-nine-acid-washed-oversized-t-shirt-brick-red", photos("cloud-nine-brick-red", 4), true, false],
    ["Cloud Nine", "Black", "#1f2022", 890, 1190, "cloud-nine-oversized-t-shirt-black", photos("cloud-nine-black", 4), true, false],
    ["Cloud Nine", "Charcoal", "#45474b", 680, 990, "cloud-nine-acid-washed-oversized-t-shirt-charcoal", photos("cloud-nine-charcoal", 4), true, false],
    ["Halo", "Yellow", "#a3904f", 680, 990, "halo-acid-washed-oversized-t-shirt-yellow", photos("halo-yellow", 4), true, false],
    ["Halo", "Green", "#2f8f6b", 680, 990, "halo-acid-washed-oversized-t-shirt-green", photos("halo-green", 4), true, false],
    ["Halo", "Pink", "#c93f5f", 680, 990, "halo-acid-washed-oversized-t-shirt-pink", photos("halo-pink", 4), true, false],
    ["Boxy Fitted Shirt", "Mosaic", "#7a4a36", 850, 1290, "boxy-fitted-shirt-mosaic", photos("shirt-mosaic", 4), true, true],
    ["Boxy Fitted Shirt", "Line Art", "#d4a184", 850, 1290, "boxy-fitted-shirt-line-art", photos("shirt-line-art", 4), true, false],
    ["Boxy Fitted Shirt", "Coral Wave", "#c98a7c", 850, 1290, "boxy-fitted-shirt-coral-wave", photos("shirt-coral-wave", 3), true, false],
    ["Boxy Fitted Shirt", "Sage Garden", "#8d958c", 850, 1290, "boxy-fitted-shirt-sage-garden", photos("shirt-sage-garden", 4), true, true],
    ["Boxy Fitted Shirt", "Mono Bloom", "#e9e6df", 850, 1290, "boxy-fitted-shirt-mono-bloom", photos("shirt-mono-bloom", 4), true, false],
    ["Baggy Trouser", "Black", "#1f2022", 990, 1390, "baggy-trouser-black", photos("baggy-trouser-black", 3), true, true],
    ["Baggy Trouser", "Charcoal", "#45474b", 990, 1390, "baggy-trouser-charcoal", photos("baggy-trouser-charcoal", 4), true, false]
  ];
  var SIZES = ["M", "L", "XL", "2XL"];
  var STOCK = { M: 18, L: 24, XL: 20, "2XL": 12 };
  var products = P.map(function (r, i) {
    var line = r[0], color = r[1], sku = "RV-" + LINE[line].code + "-" + COLOR[color], type = TYPE[LINE[line].type || "tee"];
    return {
      id: "prd_" + r[5].replace(/-/g, "_").slice(0, 60), slug: r[5], sku: sku, status: "published",
      name: type.name(line, color), line: line, color: color, hex: r[2],
      price: r[3], comparePrice: r[4], description: LINE[line].about, details: FIT.slice(),
      images: r[6], sizeGuide: "assets/img/size-guide-sample.webp",
      categoryIds: ["cat_men", type.cat], isNew: r[7], featured: r[8], trackStock: true, stock: 0,
      attributes: [{ name: "Size", values: SIZES.slice() }],
      variants: SIZES.map(function (s) { return { id: "var_" + i + "_" + s.toLowerCase(), sku: sku + "-" + s, options: { Size: s }, price: null, stock: STOCK[s] - (i % 4) * 2 }; }),
      createdAt: T0 - i * 36e5, updatedAt: T0
    };
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  var settings = {
    store: {
      name: "Ravelle", legalName: "Ravelle – A Life Style Brand", tagline: "Designed for presence, not attention.",
      email: "hello@ravellebd.com", phone: "+880 1XXX-XXXXXX", whatsapp: "",
      address: "Dhaka, Bangladesh", hours: "Saturday to Thursday, 10am to 8pm",
      tradeLicense: "TRAD/DNCC/XXXXXX/2026", tin: "XXXXXXXXXXXX", dbid: "XXXXXXXXXX", bin: "", website: "https://ravellebd.com"
    },
    social: { facebook: "https://www.facebook.com/profile.php?id=61590338530147", instagram: "https://www.instagram.com/ravellebd/", tiktok: "", youtube: "" },
    seo: { title: "Ravelle – A Life Style Brand", description: "Heavyweight oversized tees, acid washes and baggy fits from Dhaka. Designed for presence, not attention." },
    shipping: {
      zones: [
        { id: "inside-dhaka", name: "Inside Dhaka", fee: 70, days: "1–3 days" },
        { id: "outside-dhaka", name: "Outside Dhaka", fee: 130, days: "3–5 days" }
      ],
      freeOver: 0, processing: "Orders are confirmed by phone and packed within 24 hours."
    },
    payments: { cod: true, sslcommerz: { enabled: true, sandbox: true, storeId: "" } },
    chat: { enabled: true, title: "Ravelle", greeting: "Hi! Ask us anything about sizes, delivery or your order.",
      autoReply: true, autoReplyText: "Thanks for your message. We usually reply within a few minutes during store hours." },
    lowStock: 5,
    announcement: "Free exchange within 7 days · Cash on delivery all over Bangladesh"
  };

  // ---------------------------------------------------------------------------
  // Pages. Text uses a light Markdown: "## " headings, "- " lists, **bold**.
  // ---------------------------------------------------------------------------
  var pages = {
    home: {
      hero: {
        line1: "Designed for presence,", lead: "not", accent: "attention!",
        cta1: "Shop now", cta1Link: "#shop", cta2: "Explore the House", cta2Link: "#category/the-house",
        image: "assets/img/home/h-hero-fearless.webp", imageAlt: "Two models in the Fearless tee in black and in ocean blue"
      },
      tryLook: {
        title: "Try the Look.", sub: "Eleven looks, styled head to toe. Tap a look to see the pieces.", panelTitle: "In this look", totalTitle: "Complete the look", cta: "Add full look to bag",
        looks: [
          { name: "Fearless", image: "assets/img/home/look-1.webp", imageAlt: "Model in the Fearless oversized T-shirt in yellow with the black baggy trouser", products: "fearless-oversized-t-shirt-yellow, baggy-trouser-black" },
          { name: "RVCHL", image: "assets/img/home/look-2.webp", imageAlt: "Model in the RVCHL oversized T-shirt in black with the black baggy trouser", products: "rvchl-oversized-t-shirt-black, baggy-trouser-black" },
          { name: "574", image: "assets/img/home/look-7.webp", imageAlt: "Model in the 574 acid washed oversized T-shirt in brick red with the black baggy trouser", products: "574-oversized-t-shirt-brick-red, baggy-trouser-black" },
          { name: "Starlight Blue", image: "assets/img/home/look-10.webp", imageAlt: "Model in the Starlight oversized T-shirt in ocean blue, seen from the back with the black baggy trouser", products: "starlight-oversized-t-shirt-ocean-blue, baggy-trouser-black" },
          { name: "Paradox", image: "assets/img/home/look-8.webp", imageAlt: "Model in the Paradox oversized T-shirt in cream with the black baggy trouser", products: "paradox-oversized-t-shirt-cream, baggy-trouser-black" },
          { name: "Starlight Black", image: "assets/img/home/look-5.webp", imageAlt: "Model in the Starlight oversized T-shirt in black with the black baggy trouser", products: "starlight-oversized-t-shirt-black, baggy-trouser-black" },
          { name: "RVCHL Blue", image: "assets/img/home/look-11.webp", imageAlt: "Model in the RVCHL oversized T-shirt in ocean blue, seen from the back with the black baggy trouser", products: "rvchl-oversized-t-shirt-ocean-blue, baggy-trouser-black" },
          { name: "Fearless Blue", image: "assets/img/home/look-12.webp", imageAlt: "Model in the Fearless oversized T-shirt in ocean blue with the black baggy trouser", products: "fearless-oversized-t-shirt-ocean-blue, baggy-trouser-black" },
          { name: "Stride Out", image: "assets/img/home/look-6.webp", imageAlt: "Model in the Stride Out oversized T-shirt in blue with the black baggy trouser", products: "stride-out-oversized-t-shirt-blue, baggy-trouser-black" },
          { name: "Fearless Black", image: "assets/img/home/look-13.webp", imageAlt: "Model in the Fearless oversized T-shirt in black with the black baggy trouser", products: "oversized-t-shirt-fearless-black, baggy-trouser-black" },
          { name: "Trust Broken", image: "assets/img/home/look-14.webp", imageAlt: "Model in the Trust Broken oversized T-shirt in black with the black baggy trouser", products: "trust-broken-oversized-t-shirt-black, baggy-trouser-black" }
        ]
      },
      house: {
        eyebrow: "New in", titleStart: "Trendy", accent: "oversized", titleEnd: "items.", linkLabel: "Shop all →", link: "#category/men",
        card1: { image: "assets/img/home/h-tee-cat-full.webp", meta: "Shop T-shirts →", title: "Oversized\nT-shirt", link: "#category/t-shirt" },
        card2: { image: "assets/img/home/h-shirt-cat-full.webp", meta: "Shop shirts →", title: "Boxy Fitted\nShirt", link: "#category/half-shirt" }
      },
      poster: {
        kicker: "Up to 31% off", title: "Raining offers\nfor hot summer", cta: "Shop the sale", ctaLink: "#on-sale",
        image: "assets/img/home/h-poster-fearless.webp", imageAlt: "Model in the Fearless oversized T-shirt in yellow with black baggy trousers, in front of a Fearless flag",
        marqueeTop: "RAINING OFFERS FOR HOT SUMMER", marqueeBottom: "OWN THE STREET"
      },
      arrivals: {
        titleStart: "Fresh fits for your", accent: "next", titleEnd: "move!",
        // Tabs under the heading. Category is a category slug (t-shirt, half-shirt, full-shirt, trouser,
        // polo...) or top-selling; join several slugs with commas. Clear a label to hide its tab.
        tabs: [
          { label: "T-shirt", category: "t-shirt" },
          { label: "Shirt", category: "half-shirt, full-shirt" },
          { label: "Trouser", category: "trouser" },
          { label: "Polo", category: "polo" },
          { label: "Top Selling", category: "top-selling" }
        ]
      },
      lookbook: {
        marqueeBack: "FRESH FITS FOR YOUR NEXT MOVE", marqueeFront: "YOUR NEXT MOVE",
        looks: [
          { image: "assets/img/home/lb-1.webp", name: "Fearless tee\nOcean blue" },
          { image: "assets/img/home/lb-2.webp", name: "Brand New Day tee\nBlack" },
          { image: "assets/img/home/lb-3.webp", name: "Starlight tee\nBlack" }
        ]
      },
      categories: { eyebrow: "Shop men" },
      footer: { tagline: "Designed for presence,\nnot attention.", newsletter: "Your email for drop alerts" }
    },
    about: {
      eyebrow: "About us", title: "Own your style.", accent: "Define", titleEnd: "your identity.",
      intro: "Ravelle is a lifestyle brand from Dhaka, built for people who dress for themselves.",
      image: "assets/img/about.webp", imageAlt: "Two models in Fearless oversized T-shirts, black and blue, with black star baggy trousers",
      storyTitle: "Our story",
      story: "Ravelle blends modern streetwear with classic polish. We make everyday staples and bolder statement pieces that feel good, last long and look like you.\n\nEvery piece starts with fabric. We cut heavyweight cotton into relaxed, oversized shapes, then finish them with washes and prints that age well. The result works for a long day in the city and still looks considered at night.\n\nOur goal is simple: make contemporary fashion more expressive, more accessible and more meaningful for people who want to stand out on their own terms.",
      values: [
        { title: "Quality first", text: "Heavyweight fabrics, reinforced seams and washes tested to hold their colour." },
        { title: "Made to be worn", text: "Relaxed fits for real days in Dhaka heat, not just photos." },
        { title: "Honest service", text: "Cash on delivery, easy exchanges and real people on the other end of the chat." }
      ],
      companyTitle: "Company details",
      companyText: "Ravelle is a registered business in Bangladesh. These are our official details.",
      closing: "Welcome to Ravelle."
    },
    contact: {
      eyebrow: "Contact us", title: "Talk to", accent: "us",
      intro: "Questions about sizes, an order or a collaboration? Send a message, chat with us or call during store hours.",
      formTitle: "Send a message", formNote: "We reply within one working day.",
      image: "assets/img/c-blue.webp"
    },
    // Home page popup banner (Admin › Popup banner): shows 2 seconds after the home page opens, once per visit
    popup: {
      enabled: true, delay: 2, image: "assets/img/home/h-poster-fearless.webp", mobileImage: "", imageAlt: "Fearless oversized T-shirt",
      eyebrow: "This week only", title: "Fearless drop\n25% off", text: "The new Fearless oversized tees in four washes. Cash on delivery all over Bangladesh.",
      buttonText: "Shop the drop", buttonLink: "#on-sale", version: 1
    },
    // Store locations: shops are grouped by district, in the order set in districtOrder (Admin › Pages › Store locations)
    stores: {
      eyebrow: "Store locations", title: "Find a", accent: "Ravelle", titleEnd: "store.",
      intro: "Try the fit in person. Every store carries the latest drops.",
      emptyText: "We have no shops yet, you can order online.",
      districtOrder: [],
      shops: []
    },
    franchise: {
      eyebrow: "Franchise", title: "Open a", accent: "Ravelle", titleEnd: "store.",
      intro: "Bring Ravelle to your city. We give you the brand, the stock and the support. You run the store.",
      points: [
        { title: "Proven products", text: "Our best-selling oversized tees, shirts and trousers, restocked every month." },
        { title: "Full support", text: "Store design, staff training, launch marketing and our order system from day one." },
        { title: "Shared growth", text: "Online orders from your area can be picked up and exchanged at your store." }
      ],
      pdfTitle: "Franchise guide", pdfText: "Rules, investment, store requirements and how the franchise system works.", pdf: "",
      formTitle: "Request a franchise", formNote: "Tell us about you and your location, and pick a time to meet. We reply within two working days.",
      storiesTitle: "From our franchise partners",
      stories: []
    },
    terms: {
      title: "Terms & conditions", updated: "28 October 2026",
      intro: "Please read these terms carefully before using ravellebd.com. By using the website or placing an order, you agree to them.",
      body: "## 1. Definitions\n- **\"Ravelle\", \"we\", \"us\"** means Ravelle – A Life Style Brand, Dhaka, Bangladesh, which operates this website.\n- **\"Customer\", \"you\"** means anyone who visits the website or places an order.\n- **\"Products\"** means the clothing and accessories sold on this website.\n\n## 2. Using the website\n- You must be at least 18 years old, or use the website with a parent or guardian's permission.\n- You agree to give true and complete information when you place an order.\n- You must not misuse the website, try to break its security, or copy its content for commercial use.\n\n## 3. Products and prices\n- We show product colours as accurately as we can. Screens differ, so the actual colour may vary slightly.\n- All prices are in Bangladeshi Taka (৳) and include VAT where it applies. Delivery charges are shown at checkout.\n- We may change prices or end offers at any time. The price you pay is the price shown when you place the order.\n\n## 4. Orders\n- After you place an order, we call or message you to confirm it. An order is accepted once we confirm it.\n- We may cancel an order if a product is out of stock, the price was shown wrongly, or we can't verify the order. If you paid online, we refund you in full.\n\n## 5. Payment\n- You can pay cash on delivery, or online by card, mobile banking or internet banking through SSLCOMMERZ.\n- Online payments are processed by SSLCOMMERZ. We never see or store your card details.\n\n## 6. Delivery\nDelivery times and charges are explained in our [Delivery policy](#delivery).\n\n## 7. Returns, exchanges and refunds\nYou can exchange or return products as explained in our [Return & refund policy](#refund).\n\n## 8. Intellectual property\nAll content on this website, including designs, logos, photos and text, belongs to Ravelle. You may not use it without our written permission.\n\n## 9. Limitation of liability\nWe are not responsible for indirect losses arising from the use of this website. Nothing in these terms limits your rights under the Consumer Rights Protection Act, 2009.\n\n## 10. Governing law\nThese terms are governed by the laws of Bangladesh. Disputes are handled by the courts of Dhaka.\n\n## 11. Changes\nWe may update these terms. The date at the top shows the latest version.\n\n## 12. Contact\nQuestions about these terms? Visit our [Contact page](#contact)."
    },
    privacy: {
      title: "Privacy policy", updated: "28 October 2026",
      intro: "Your privacy matters to us. This policy explains what we collect when you use ravellebd.com, how we use it and how we keep it safe.",
      body: "## 1. Information we collect\n- **Order details:** your name, phone number, email, delivery address and the products you buy.\n- **Messages:** what you send through the contact form or chat.\n- **Usage data:** pages you visit and products you view, collected without your name.\n\n## 2. How we use it\n- To confirm, deliver and support your orders.\n- To reply to your messages and chats.\n- To improve the website and our products.\n- To send offers, only if you sign up for them. You can unsubscribe at any time.\n\n## 3. Payment security\n- Online payments are processed by **SSLCOMMERZ**, a payment gateway licensed by Bangladesh Bank and certified to PCI DSS.\n- Card numbers, PINs and mobile banking passwords are entered on SSLCOMMERZ's secure page, not on our website. We never see or store them.\n- Our website uses HTTPS encryption, so everything you send to us is encrypted on the way.\n- We only receive the payment result and a transaction reference, which we keep with your order.\n\n## 4. Cookies\n- **Essential cookies and storage** keep your bag, saved items and checkout working. The website can't work without them.\n- **Analytics** counts visits and product views so we know what people like. It does not identify you.\n- You can delete or block cookies in your browser settings. If you block essential storage, your bag may not be saved.\n- We do not use cookies for third-party advertising.\n\n## 5. Sharing your information\n- We share your name, phone and address with our delivery partners so they can deliver your order.\n- We share payment details with SSLCOMMERZ to process online payments.\n- We never sell your personal information.\n\n## 6. How long we keep it\nWe keep order records for as long as the law requires for tax and accounting. You can ask us to delete other information at any time.\n\n## 7. Your rights\nYou can ask to see, correct or delete your personal information. Contact us through the [Contact page](#contact).\n\n## 8. Children\nOur website is not meant for children under 13, and we don't knowingly collect their information.\n\n## 9. Changes\nWe may update this policy. The date at the top shows the latest version."
    },
    refund: {
      title: "Return & refund policy", updated: "28 October 2026",
      intro: "Not the right fit? You can exchange or return your order. Here is how it works and how long each step takes.",
      body: "## Timeline at a glance\n- **Within 3 days of delivery:** report a damaged, defective or wrong item.\n- **Within 7 days of delivery:** request an exchange or return.\n- **Within 3 working days:** we check the returned item.\n- **Within 7–10 working days:** we send your refund after approval.\n\n## How to request a return or exchange\n1. Contact us through chat, the [Contact page](#contact) or by phone with your order number.\n2. Tell us the item, the reason and, for damaged items, send a photo.\n3. We confirm the request and arrange a pickup, or give you the return address.\n4. Pack the item unused, unwashed, with its tags and original packaging.\n5. Once we receive and check it, we send the exchange or refund.\n\n## Exchanges\n- You can exchange for another size or colour of the same price once per order, if it is in stock.\n- Exchange delivery is free if the mistake was ours. Otherwise the normal delivery charge applies.\n\n## Refunds\n- **Online payments** are refunded to the same card, mobile wallet or bank account through SSLCOMMERZ.\n- **Cash on delivery** orders are refunded by bKash, Nagad or bank transfer.\n- Your bank or wallet may take a few extra days to show the money.\n- Delivery charges are not refundable unless the item was damaged, defective or wrong.\n\n## You may not get a refund if\n- The request is made more than 7 days after delivery.\n- The item has been worn, washed, altered or damaged after delivery.\n- Tags or original packaging are missing.\n- The item was bought on clearance or marked final sale.\n\n## Cancelling an order\nYou can cancel any time before the order is shipped. Online payments for cancelled orders are refunded in full within 7–10 working days."
    },
    delivery: {
      title: "Delivery policy", updated: "28 October 2026",
      intro: "We deliver all over Bangladesh through trusted courier partners. Here are the charges, times and steps.",
      body: "## Delivery times and charges\n- **Inside Dhaka:** 1–3 days · ৳70\n- **Outside Dhaka:** 3–5 days · ৳130\n\nTimes are counted from when we confirm your order and may be longer during holidays, strikes or bad weather.\n\n## How delivery works\n1. **Order placed:** you get an order number on screen.\n2. **Confirmation:** we call or message you within 24 hours to confirm.\n3. **Packed and shipped:** we hand your parcel to the courier and share the tracking details.\n4. **Delivered:** the courier calls you before arriving. For cash on delivery, pay the rider when you receive the parcel.\n\n## Checking your parcel\nPlease check your parcel in front of the rider. If anything is damaged or wrong, tell the rider and contact us within 3 days.\n\n## If delivery fails\nIf we can't reach you after three tries, the parcel comes back to us and the order is cancelled. Online payments are refunded minus the delivery charge.\n\n## Tracking your order\nUse [Track order](#track) with your order number and phone number to see the latest status."
    }
  };

  // ---------------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------------
  var catLink = function (slug, label) { return { id: "mi_" + slug, label: label, url: "#category/" + slug, children: [] }; };
  var menus = {
    header: [
      { id: "mi_shop", label: "Shop", url: "#shop", image: "assets/img/menu-shop.webp", children: [
        { id: "mi_all", label: "All products", url: "#shop", children: [] },
        { id: "mi_new", label: "New in", url: "#new-in", children: [] },
        { id: "mi_sale2", label: "On sale", url: "#on-sale", children: [] }
      ] },
      { id: "mi_men", label: "Men", url: "#category/men", image: "assets/img/menu-men.webp", children: [
        catLink("t-shirt", "T-shirt"), catLink("polo", "Polo"), catLink("half-shirt", "Half shirt"),
        catLink("full-shirt", "Full shirt"), catLink("trouser", "Trouser"), catLink("denim-pant", "Denim pant")
      ] },
      { id: "mi_women", label: "Women", url: "#category/women", children: [] },
      { id: "mi_newin", label: "New in", url: "#new-in", children: [] },
      { id: "mi_sale", label: "On sale", url: "#on-sale", children: [] }
    ],
    footer: [
      { id: "fc_shop", title: "Shop", items: [
        { id: "f1", label: "Men", url: "#category/men", children: [] }, { id: "f2", label: "Women", url: "#category/women", children: [] },
        { id: "f3", label: "The House", url: "#category/the-house", children: [] }, { id: "f4", label: "New in", url: "#new-in", children: [] },
        { id: "f5", label: "On sale", url: "#on-sale", children: [] }
      ] },
      { id: "fc_company", title: "Company", items: [
        { id: "f6", label: "About us", url: "#about", children: [] }, { id: "f7", label: "Contact us", url: "#contact", children: [] },
        { id: "f8", label: "Track order", url: "#track", children: [] }, { id: "f9", label: "Saved items", url: "#saved", children: [] },
        { id: "f_stores", label: "Store locations", url: "#store-locations", children: [] }, { id: "f_franchise", label: "Franchise", url: "#franchise", children: [] }
      ] },
      { id: "fc_policies", title: "Policies", items: [
        { id: "f10", label: "Terms & conditions", url: "#terms", children: [] }, { id: "f11", label: "Privacy policy", url: "#privacy", children: [] },
        { id: "f12", label: "Return & refund policy", url: "#refund", children: [] }, { id: "f13", label: "Delivery policy", url: "#delivery", children: [] }
      ] }
    ]
  };

  var coupons = [
    { id: "cpn_welcome", code: "WELCOME10", type: "percent", value: 10, minOrder: 1000, maxUses: 0, maxDiscount: 300, used: 0,
      startsAt: null, endsAt: null, active: true, description: "10% off your first order", createdAt: T0 }
  ];

  return {
    version: 2, settings: settings, categories: categories, attributes: attributes, products: products,
    pages: pages, menus: menus, coupons: coupons, counters: { order: 1000 }
  };
});
