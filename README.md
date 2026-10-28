# Ravelle BD website

Demo home page for [Ravelle – A Life Style Brand](https://ravellebd.com/), styled after a reference home page design (framed hero, collage, collection cards, sale poster, new-arrivals grid, scroll lookbook).

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Structure

- `index.html` – the home page sections
- `assets/css/style.css` – design tokens and styles
- `assets/js/main.js` – product data (mirrors ravellebd.com), grid, filters, scroll effects
- `assets/img/` – resized studio photos and the logo

Products without a local photo load their image from ravellebd.com. If it can't load, the card shows the product name on a colour panel instead.
