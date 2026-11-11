// Monetag Service Worker placeholder
// This file is required for Monetag In-Page Push and Vignette features.
// Actual integration script from Monetag dashboard should be added here.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Monetag logic will go here when provided.
