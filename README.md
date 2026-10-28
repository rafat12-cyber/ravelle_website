# Ravelle BD website

Demo website for [Ravelle – A Life Style Brand](https://ravellebd.com/), styled after a reference home page design (framed hero, collage, collection cards, sale poster, new-arrivals grid, scroll lookbook).

## Pages

One `index.html` with hash routes: home, `#shop`, `#men`, `#t-shirt`, `#new-in`, `#on-sale`, `#p-<product-slug>`, `#the-house`, `#c-<collection>`, `#women`, `#checkout`, `#account`, `#saved`, `#about`. The bag and saved items are kept in the browser's localStorage. Checkout and sign-in are demos and send nothing.

## Admin panel

Open `admin.html` (it isn't linked from the site). It has three tabs:

- **Home page**: every headline, button, note and photo on the home page, with a live preview beside the form. Photos can be uploaded from your computer (resized in the browser) or picked from the site's images.
- **Products**: add, edit, reorder, hide or delete products: line, colour, swatch, price, old price, sizes, description and photos.
- **Publish**: saves the draft to this GitHub repository in one commit (`assets/js/content.js` plus any new photos in `assets/img/uploads/`). It needs a fine-grained token for this repository with *Contents: Read and write*. Without a token, "Download content.js" gives you the file to upload by hand.

Edits are kept as a draft in the browser until you publish. `index.html?preview` shows the draft. The site is static, so publishing only changes what visitors see once the host redeploys from GitHub (for example GitHub Pages or Netlify).

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Structure

- `index.html` – the home page sections
- `assets/css/style.css` – design tokens and styles
- `assets/js/content.js` – all editable content: home page text and photos, products (mirrored from ravellebd.com) and The House collections. The admin panel rewrites this file.
- `assets/js/data.js` – builds the catalogue from content.js
- `assets/js/home.js` – fills the home page from content.js
- `admin.html`, `assets/admin/` – the admin panel
- `assets/js/main.js` – router, pages, bag, checkout and scroll effects
- `assets/img/` – resized studio photos and the logo

Products without a local photo load their image from ravellebd.com. If it can't load, the card shows the product name on a colour panel instead.
