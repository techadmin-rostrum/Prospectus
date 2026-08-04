import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Serve PDFs with Accept-Ranges so pdf.js progressive load works in dev */
function pdfRangePlugin() {
  return {
    name: 'pdf-range-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith('/pdfs/') && req.url.includes('.pdf')) {
          res.setHeader('Accept-Ranges', 'bytes')
          res.setHeader('Cache-Control', 'public, max-age=86400')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pdfRangePlugin(),
  ],
  build: {
    target: 'es2022',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      // Dropped require-corp — it interfered with pdf.js worker / range fetches
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
})
