// Importa la libreria idb per un accesso più semplice a IndexedDB
importScripts('https://cdn.jsdelivr.net/npm/idb@8/build/iife/index-min.js');

const CACHE_NAME = 'expense-manager-cache-v32';
// Aggiunta la pagina di share-target al caching
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/share-target/',
  // Key CDN dependencies
  'https://cdn.tailwindcss.com',
  'https://esm.sh/react@18.3.1',
  'https://esm.sh/react-dom@18.3.1/client',
  'https://aistudiocdn.com/@google/genai@^1.21.0',
  'https://esm.sh/recharts@2.12.7',
  'https://cdn.jsdelivr.net/npm/idb@8/+esm'
];

// --- Funzioni Helper per IndexedDB (replicate da db.ts per l'uso nel Service Worker) ---
const DB_NAME = 'expense-manager-db';
const STORE_NAME = 'offline-images';
const DB_VERSION = 1;

const getDb = () => {
  return idb.openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache, caching app shell');
        return cache.addAll(urlsToCache);
      })
      
  );
});

// Activate event
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // --- Gestione Share Target ---
  if (event.request.method === 'POST' && url.pathname === '/share-target/') {
    event.respondWith(Response.redirect('/')); // Rispondi subito con un redirect
    
    event.waitUntil(async function() {
      try {
        const formData = await event.request.formData();
        const file = formData.get('screenshot');
        
        if (!file || !file.type.startsWith('image/')) {
            console.warn('Share target: No valid image file received.');
            return;
        }

        const base64Image = await fileToBase64(file);
        
        const db = await getDb();
        await db.add(STORE_NAME, {
            id: crypto.randomUUID(),
            base64Image,
            mimeType: file.type,
        });
        
        console.log('Image from share target saved to IndexedDB.');

        // Cerca un client (tab/finestra) esistente dell'app e mettilo a fuoco
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
        });

        if (clients.length > 0) {
            await clients[0].focus();
        } else {
            self.clients.openWindow('/');
        }
      } catch (error) {
          console.error('Error handling share target:', error);
      }
    }());
    return;
  }
  
  if (event.request.method !== 'GET') {
    return;
  }

  // Strategy: Network falling back to cache for navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Strategy: Cache first for all other assets
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        return cachedResponse || fetch(event.request).then(
          networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
          }
        );
      })
  );
});
self.addEventListener('message', (event) => { if (event.data && (event.data === 'SKIP_WAITING' || event.data.type === 'SKIP_WAITING')) { self.skipWaiting(); } });
