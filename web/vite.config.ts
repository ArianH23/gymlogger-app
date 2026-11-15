import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Makes the app installable on the phone's home screen and keeps it working offline.
    VitePWA({
      registerType: 'autoUpdate',
      // the bundled font is cached too, so headings look the same with no signal
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,png}'] },
      manifest: {
        name: 'GymLogger',
        short_name: 'GymLogger',
        description: 'Personal workout logger',
        theme_color: '#0a0c0b',
        background_color: '#0a0c0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
