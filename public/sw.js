// Monetag Service Worker integration
self.options = {
    "domain": "5gvci.com",
    "zoneId": 12241124
}
self.lary = ""
importScripts('https://5gvci.com/act/files/service-worker.min.js?r=sw')

// PWA lifecycle listeners
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
