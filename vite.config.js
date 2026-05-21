import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,gba}'],
        maximumFileSizeToCacheInBytes: 50000000
      },
      manifest: {
        name: "Emerald PWA",
        short_name: "Emerald",
        description: "Play Pokemon Emerald on Web",
        theme_color: "#0fcb8e",
        background_color: "#121212",
        display: "standalone",
        orientation: "landscape",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml"
          }
        ]
      }
    })
  ],
  base: './',
})
