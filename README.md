# Ravelle BD website

Demo website for [Ravelle – A Life Style Brand](https://ravellebd.com/), styled after a reference home page design (framed hero, collage, collection cards, sale poster, new-arrivals grid, scroll lookbook).

## Pages

One `index.html` with hash routes: home, `#shop`, `#men`, `#t-shirt`, `#new-in`, `#on-sale`, `#p-<product-slug>`, `#the-house`, `#c-<collection>`, `#women`, `#checkout`, `#account`, `#saved`, `#about`. The bag and saved items are kept in the browser's localStorage. Checkout and sign-in are demos and send nothing.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Structure

- `index.html` – the home page sections
- `assets/css/style.css` – design tokens and styles
- `assets/js/data.js` – the 15 products, sizes and galleries mirrored from ravellebd.com, plus The House collections
- `assets/js/main.js` – router, pages, bag, checkout and scroll effects
- `assets/img/` – resized studio photos and the logo

Products without a local photo load their image from ravellebd.com. If it can't load, the card shows the product name on a colour panel instead.
