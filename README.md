# Rostrum Education — Prospectus Flipbook

A production-grade, custom PDF flipbook web application built with React, Vite, PDF.js, and Framer Motion.

## Features
- **High-Fidelity Rendering**: Direct PDF-to-canvas rendering at native device resolution (`devicePixelRatio`).
- **Interactive Page Flips**: Realistic page curl animation via `react-pageflip`.
- **Performance Optimized**: Lazy-loaded thumbnails and render-on-demand cache strategy to prevent OOM errors with large PDFs.
- **Deep Linking**: Route directly to specific pages (e.g., `?page=12`).
- **Responsive**: Adapts from single-page view on mobile to a two-page spread on desktop.

## Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Place your PDFs in the `public/pdfs/` directory:
   - `public/pdfs/UG26.pdf`
   - `public/pdfs/PG26.pdf`

3. Start the dev server:
   ```bash
   npm run dev
   ```

## Building for Production

```bash
npm run build
```

This generates a static SPA bundle in the `dist/` directory.

### PDF Optimization
Before deploying, it is highly recommended to compress the source PDFs to reduce loading times. You can use Ghostscript:

```bash
gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=compressed.pdf original.pdf
```
*(Adjust `/screen` to `/ebook` or `/printer` depending on your quality needs.)*

## Deployment to Vercel

This is a Vite React Single Page Application (SPA). To deploy to Vercel:

1. Connect your repository to Vercel.
2. Vercel will automatically detect the Vite build settings.
3. The project includes a `vercel.json` file which rewrites all traffic to `index.html`. This ensures that direct navigation to `/ug` or `/pg` does not result in a 404 error, allowing React Router to handle the route client-side.
4. **Custom Domain Setup**: 
   - Go to your Vercel Project Settings > Domains.
   - Add `prospectus.rostrumedu.com` (or your chosen domain).
   - Configure your DNS provider to add a CNAME record pointing to `cname.vercel-dns.com`.
   - Once DNS propagates, both `prospectus.yourdomain.com/ug` and `/pg` will work automatically.
