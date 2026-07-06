# Rupiah Bill Splitter Frontend

Static frontend for GitHub Pages.

The OCR backend is hosted separately on Hugging Face Spaces:

```txt
https://danielanadii-split-bill-ocr.hf.space
```

The API base URL is configured in `config.js`.

## Deploy to GitHub Pages

Push this folder as a GitHub repository:

```bash
cd /Users/userlgi/Documents/Codex/2026-07-06/i/outputs/bill-splitter-frontend
git init
git add .
git commit -m "Deploy frontend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

Then in GitHub:

1. Open repository **Settings**
2. Go to **Pages**
3. Source: **Deploy from a branch**
4. Branch: `main`
5. Folder: `/root`

Your frontend will call:

```txt
https://danielanadii-split-bill-ocr.hf.space/api/ocr
```
