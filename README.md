# Lab Trend Tracker (GitHub Pages)

A static web app that extracts lab values from text-based PDF blood reports and plots metrics over time.

## Run locally
Open `index.html` directly, or use a simple server:
- VS Code Live Server, or
- `python -m http.server 8000`

## Deploy on GitHub Pages
1. Push this repo to GitHub
2. Settings → Pages
3. Source: Deploy from a branch
4. Branch: main, folder: / (root)

## Notes
- Works best for text-based PDFs.
- Scanned PDFs require OCR (not included in MVP).
- Data is stored locally in your browser (IndexedDB).
