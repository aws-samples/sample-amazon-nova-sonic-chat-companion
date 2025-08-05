# Service Worker Configuration Guide

This document outlines the service worker configuration for the Sonic Nova Chat application, including caching strategies, performance optimizations, and handling of specific file types.

## Overview

The service worker is configured using the Vite PWA plugin (`vite-plugin-pwa`) in the `vite.config.ts` file. It provides offline capabilities, caching strategies, and performance optimizations for the Progressive Web App (PWA).

## Critical API Endpoints

The following API endpoints are configured to bypass the service worker and always go directly to the server:

- `/stats` - Application statistics endpoint
- `/health` - Health check endpoint
- `/socket.io` - WebSocket communication endpoint

These endpoints are excluded from caching using:

1. `navigateFallbackDenylist` to prevent the service worker from handling navigation requests
2. A specific `NetworkOnly` caching rule to ensure requests always go directly to the network

```javascript
navigateFallbackDenylist: [/^\/stats/, /^\/health/, /^\/socket\.io/],
navigationPreload: true,
runtimeCaching: [
  {
    urlPattern: ({ url }) => {
      const paths = ["/stats", "/health", "/socket.io"];
      return paths.some((path) => url.pathname.startsWith(path));
    },
    handler: "NetworkOnly",
  },
  // Other caching rules...
]
```

## Manifest.json Handling

The `manifest.json` file is critical for PWA functionality and is configured with a `StaleWhileRevalidate` strategy:

```javascript
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
}
```

This ensures that:

- The manifest is quickly available from cache for fast PWA installation and startup
- It's periodically updated in the background to ensure metadata stays current
- It has a 24-hour expiration policy to ensure regular updates

## Audio Worklet Files

Audio worklet files (`.worklet.js`) are critical for audio processing functionality and are configured with a `StaleWhileRevalidate` strategy:

```javascript
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
}
```

This ensures that:

- Audio worklet files are quickly available from cache for fast audio processing initialization
- They're periodically updated in the background to ensure functionality stays current
- They have a 7-day expiration policy with a limit of 10 entries in the cache

## Library Files

Library files in the `/lib/` directory are configured with a `CacheFirst` strategy:

```javascript
{
  urlPattern: /^\/lib\/.*$/i,
  handler: "CacheFirst",
  options: {
    cacheName: "lib-cache",
    expiration: {
      maxEntries: 50,
      maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
    },
  },
}
```

This ensures that:

- Library files are served from cache whenever possible for maximum performance
- They have a 7-day expiration policy with a limit of 50 entries in the cache

## Audio Files

Audio files (`.mp3`, `.wav`, `.ogg`) are configured with a `CacheFirst` strategy:

```javascript
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
}
```

This ensures that:

- Audio files are served from cache whenever possible for maximum performance
- They have a 7-day expiration policy with a limit of 50 entries in the cache

## Static Assets

Static assets (JS, CSS, HTML, images, fonts, etc.) are included in the service worker's precache manifest using the `globPatterns` configuration:

```javascript
globPatterns: [
  "**/*.{js,css,html,ico,png,svg,jpg,jpeg,gif,webp,woff,woff2,ttf,eot,otf}",
],
```

This ensures that:

- All static assets are cached during service worker installation
- They're available offline immediately after the first visit

## Performance Optimizations

The service worker includes several performance optimizations:

```javascript
skipWaiting: true,
clientsClaim: true,
cleanupOutdatedCaches: true,
```

These settings ensure that:

- `skipWaiting`: New service workers activate immediately without waiting for existing clients to close
- `clientsClaim`: The service worker takes control of pages immediately upon activation
- `cleanupOutdatedCaches`: Old caches are automatically removed to prevent storage bloat

## Complete Configuration

The complete service worker configuration can be found in `vite.config.ts`:

```javascript
VitePWA({
  registerType: "autoUpdate",
  includeAssets: ["favicon.ico", "audio-chatbot.svg"],
  manifest: {
    name: "Sonic Nova Chat",
    short_name: "Sonic Nova",
    description: "Voice chat application",
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
    navigateFallbackDenylist: [/^\/stats/, /^\/health/, /^\/socket\.io/],
    navigationPreload: true,
    runtimeCaching: [
      {
        urlPattern: ({ url }) => {
          const paths = ["/stats", "/health", "/socket.io"];
          return paths.some((path) => url.pathname.startsWith(path));
        },
        handler: "NetworkOnly",
      },
      {
        urlPattern: /^\/lib\/.*$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "lib-cache",
          expiration: {
            maxEntries: 50,
            maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
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
});
```

## Caching Strategies Explained

The service worker uses different caching strategies for different types of resources:

1. **NetworkOnly**: Always fetches from the network and never uses the cache. Used for dynamic API endpoints.

2. **CacheFirst**: Checks the cache first and falls back to the network only if the resource isn't in the cache. Used for static resources that don't change often.

3. **StaleWhileRevalidate**: Serves from the cache if available (even if stale) while fetching an updated version from the network in the background. Used for resources that should be available quickly but also kept relatively up-to-date.

## Deployment Notes

After making changes to the service worker configuration, you need to:

1. Rebuild the application
2. Redeploy to your hosting environment
3. Users will automatically receive the new service worker on their next visit

For users with an existing service worker, the `skipWaiting` and `clientsClaim` settings ensure they'll get the updated version quickly.
