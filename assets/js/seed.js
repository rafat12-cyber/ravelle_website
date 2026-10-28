// Starting data for a new store: settings, categories, variations, the 15
// products from ravellebd.com (October 2026), page content and menus.
// The server copies this into data/db.json on first run; the demo copies it
// into the browser. Edit the live data from the admin panel, not here.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RAVELLE_SEED = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Product photos: front, front close-up, side, back (assets/img/products/<name>-1..4.jpg)
  var photos = function (name, count) { var out = []; for (var i = 1; i <= count; i++) out.push("assets/img/products/" + name + "-" + i + ".jpg"); return out; };
  var T0 = Date.UTC(2026, 9, 20);

  // ---------------------------------------------------------------------------
  // Categories (from the ravellebd.com menu)
  // ---------------------------------------------------------------------------
  var CATS = [
    ["men", "Men", null, 1, "assets/img/c-black.webp", "Oversized tees, shirts and trousers."],
    ["t-shirt", "T-shirt", "men", 1, "assets/img/c-yellow.webp", "Heavyweight oversized tees."],
    ["polo", "Polo", "men", 2, "", ""],
    ["half-shirt", "Half shirt", "men", 3, "", ""],
    ["full-shirt", "Full shirt", "men", 4, "", ""],
    ["trouser", "Trouser", "men", 5, "", ""],
    ["denim-pant", "Denim pant", "men", 6, "", ""],
    ["women", "Women", null, 2, "assets/img/c-blue.webp", "The women's line is on its way."],
    ["the-house", "The House", null, 3, "assets/img/c-rvchl.webp", "Five collections from Ravelle, each with its own mood."],
    ["nior-division", "Nior Division", "the-house", 1, "assets/img/c-black.webp", "Dark washes for the after hours."],
    ["saint-sinners", "Saint & Sinners Hype", "the-house", 2, "assets/img/c-blue.webp", "Loud graphics, quiet confidence."],
    ["essential", "Essential Collection", "the-house", 3, "assets/img/c-yellow.webp", "The everyday blanks, cut heavy."],
    ["obsedian", "Obsedian Virtue", "the-house", 4, "assets/img/c-rvchl.webp", "Black on black, built to last."],
    ["monarch-drop", "Monarch Drop", "the-house", 5, "assets/img/c-black.webp", "Regal details on everyday shapes."]
  ];
  var categories = CATS.map(function (c) {
    return { id: "cat_" + c[0].replace(/-/g, "_"), slug: c[0], name: c[1], parentId: c[2] ? "cat_" + c[2].replace(/-/g, "_") : null,
      order: c[3], image: c[4], description: c[5], createdAt: T0 };
  });

  var attributes = [
    { id: "att_size", name: "Size", type: "button", values: ["S", "M", "L", "XL", "2XL", "3XL"].map(function (v) { return { label: v }; }), createdAt: T0 },
    { id: "att_color", name: "Color", type: "color", values: [
      { label: "Black", hex: "#1f2022" }, { label: "Ocean Blue", hex: "#3e6577" }, { label: "Yellow", hex: "#b4a679" },
      { label: "Brick Red", hex: "#8e3b2c" }, { label: "Blue", hex: "#3b5677" }, { label: "Cream", hex: "#c9bda3" }, { label: "Coffee", hex: "#5b4335" }
    ], createdAt: T0 }
  ];

  // ---------------------------------------------------------------------------
  // Products. One colour is one product; sizes are its variations.
  // ---------------------------------------------------------------------------
  var LINE = {
    "Fearless": { code: "FRL", about: "Cracked Fearless chest print on a dip-dyed, sun-faded body. Oversized fit with a dropped shoulder." },
    "RVCHL": { code: "RVC", about: "A small RVCHL wordmark on a boxy oversized blank. Easy to wear with anything." },
    "Stride Out": { code: "STO", about: "Stride Out graphic on an oversized, dropped-shoulder body." },
    "Paradox": { code: "PDX", about: "Paradox graphic on an oversized, dropped-shoulder body." },
    "574 Acid Washed": { code: "574", about: "Acid-washed oversized tee with the 574 graphic." }
  };
  var COLOR = { "Black": "BLK", "Ocean Blue": "OBL", "Yellow": "YLW", "Brick Red": "BRD", "Blue": "BLU", "Cream": "CRM", "Coffee": "COF" };
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
    ["574 Acid Washed", "Brick Red", "#8e3b2c", 680, 990, "574-oversized-t-shirt-brick-red", photos("574-brick-red", 4), false, false]
  ];
  var SIZES = ["M", "L", "XL", "2XL"];
  var STOCK = { M: 18, L: 24, XL: 20, "2XL": 12 };
  var products = P.map(function (r, i) {
    var line = r[0], color = r[1], sku = "RV-" + LINE[line].code + "-" + COLOR[color];
    return {
      id: "prd_" + r[5].replace(/-/g, "_").slice(0, 40), slug: r[5], sku: sku, status: "published",
      name: line + " Oversized T-shirt – " + color, line: line, color: color, hex: r[2],
      price: r[3], comparePrice: r[4], description: LINE[line].about, details: FIT.slice(),
      images: r[6], sizeGuide: "assets/img/size-guide-sample.png",
      categoryIds: ["cat_men", "cat_t_shirt"], isNew: r[7], featured: r[8], trackStock: true, stock: 0,
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
        image: "assets/img/c-yellow.webp", imageAlt: "Model in the Fearless oversized T-shirt in yellow",
        text: "Heavyweight oversized tees, acid washes and baggy fits. Made to be worn hard through a Dhaka summer.",
        link: "New arrivals",
        avatars: ["assets/img/a-black.jpg", "assets/img/a-blue.jpg", "assets/img/a-rvchl.jpg"],
        reelImage: "assets/img/d-black.jpg", reelLabel: "Watch the lookbook"
      },
      collage: {
        word: "FEARLESS", imageA: "assets/img/d-blue.jpg", imageB: "assets/img/c-black.webp", imageC: "assets/img/d-yellow.jpg",
        note1Title: "01 — Wash", note1Text: "Sun-faded dye and a cracked chest print. The Fearless tee comes in four washes.",
        note2Title: "02 — Fit", note2Text: "Dropped shoulder, boxy body. Our model is 6'2\" and wears size L."
      },
      house: {
        eyebrow: "The House", titleStart: "Signature drops", accent: "built", titleEnd: "to be\nworn, not shown.",
        aside: "Five collections, each with its own mood. Start with the two that sell out first.",
        card1: { image: "assets/img/c-black.webp", meta: "01 / Nior Division\nAutumn 2026", title: "Dark\nwashes for\nthe after\nhours.", chip: "Top selling", link: "#category/nior-division" },
        card2: { image: "assets/img/c-blue.webp", meta: "02 / Saint & Sinners Hype\nAutumn 2026", title: "Loud\ngraphics,\nquiet\nconfidence.", chip: "New drop", link: "#category/saint-sinners" }
      },
      poster: {
        kicker: "Up to 31% off", title: "Raining offers\nfor hot summer", cta: "Shop the sale", ctaLink: "#on-sale",
        image: "assets/img/c-rvchl.webp", imageAlt: "Model in the RVCHL oversized T-shirt in yellow with wide black trousers",
        marqueeTop: "RAINING OFFERS FOR HOT SUMMER", marqueeBottom: "OWN THE STREET"
      },
      arrivals: { eyebrow: "New arrival", titleStart: "Fresh fits for your", accent: "next", titleEnd: "move!" },
      lookbook: {
        marqueeBack: "FRESH FITS FOR YOUR NEXT MOVE", marqueeFront: "YOUR NEXT MOVE",
        looks: [
          { image: "assets/img/c-black.webp", name: "Fearless tee\nBlack wash", items: "Oversized tee\nWide trouser" },
          { image: "assets/img/c-blue.webp", name: "Fearless tee\nOcean blue", items: "Oversized tee\nBlack trouser" },
          { image: "assets/img/c-yellow.webp", name: "Fearless tee\nYellow wash", items: "Oversized tee\nBlack trouser" },
          { image: "assets/img/c-rvchl.webp", name: "RVCHL tee\nYellow", items: "Oversized tee\nStar wide-leg" }
        ]
      },
      categories: { eyebrow: "Shop men" },
      footer: { tagline: "Designed for presence,\nnot attention.", newsletter: "Your email for drop alerts" }
    },
    about: {
      eyebrow: "About us", title: "Own your style.", accent: "Define", titleEnd: "your identity.",
      intro: "Ravelle is a lifestyle brand from Dhaka, built for people who dress for themselves.",
      image: "assets/img/c-black.webp", imageAlt: "Model in the Fearless oversized T-shirt in black",
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
      { id: "mi_shop", label: "Shop", url: "#shop", children: [
        { id: "mi_all", label: "All products", url: "#shop", children: [] },
        { id: "mi_new", label: "New in", url: "#new-in", children: [] },
        { id: "mi_sale2", label: "On sale", url: "#on-sale", children: [] }
      ] },
      { id: "mi_men", label: "Men", url: "#category/men", children: [
        catLink("t-shirt", "T-shirt"), catLink("polo", "Polo"), catLink("half-shirt", "Half shirt"),
        catLink("full-shirt", "Full shirt"), catLink("trouser", "Trouser"), catLink("denim-pant", "Denim pant")
      ] },
      { id: "mi_women", label: "Women", url: "#category/women", children: [] },
      { id: "mi_house", label: "The House", url: "#category/the-house", children: [
        catLink("nior-division", "Nior Division"), catLink("saint-sinners", "Saint & Sinners Hype"), catLink("essential", "Essential Collection"),
        catLink("obsedian", "Obsedian Virtue"), catLink("monarch-drop", "Monarch Drop")
      ] },
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
        { id: "f8", label: "Track order", url: "#track", children: [] }, { id: "f9", label: "Saved items", url: "#saved", children: [] }
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
