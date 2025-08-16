# GamersInfo — GitHub Pages Edition

This folder is ready for **GitHub Pages** (static hosting). No backend is included.

## Deploy
1. Create a repo and push these files.
2. In GitHub: **Settings → Pages → Deploy from a branch**. Choose `main` and the root folder.
3. Your site will be at `https://<username>.github.io/<repo>/`.

## Notes
- All links/scripts/styles use `./` so they work from a subpath.
- The Sign Up form uses **localStorage** by default. To hook a real backend later:
  - Edit `script.js` and set `BACKEND_URL` to your API base URL (e.g., Vercel/Netlify function).
  - The code will automatically POST to `BACKEND_URL + /api/subscribe`.

© 2025 GamersInfo
