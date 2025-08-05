import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "audio-chatbot.svg"],
      manifest: {
        name: "Sonic Nova Chat",
        short_name: "Sonic Nova Chat",
        description: "Voice driven chat assistant",
        theme_color: "#000000",
        icons: [
          {
            src: "icons/image-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "icons/image-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,jpg,jpeg,gif,webp,woff,woff2,ttf,eot,otf}",
        ],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/stats/,
          /^\/health/,
          /^\/socket\.io/,
          /^\/recordings/,
          /^\/manifest\.json/,
        ],
        // Explicitly exclude paths from being cached
        navigationPreload: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => {
              const paths = ["/stats", "/health", "/socket.io", "/recordings"];
              return paths.some((path) => url.pathname.startsWith(path));
            },
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^\/lib\/.*$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "lib-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 1, // 24 hrs
              },
            },
          },
          {
            urlPattern: /\.(?:mp3|wav|ogg)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "audio-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
          {
            urlPattern: /manifest\.json$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "manifest-cache",
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
            },
          },
          {
            urlPattern: /index\.html$/i, // should trigger authentication
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "index-cache",
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
            },
          },
          {
            urlPattern: /.*\.worklet\.js$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "worklet-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
