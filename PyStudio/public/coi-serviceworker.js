/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
/* PyStudio adds same-origin app-shell caching while retaining the COI shim. */
let coepCredentialless = false;
const APP_SHELL_CACHE = 'pystudio-shell-v1';
const APP_SHELL_ASSETS = [
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './favicon.svg',
  './coi-serviceworker.js',
  './icons/pystudio-192.png',
  './icons/pystudio-512.png',
  './icons/pystudio-maskable-192.png',
  './icons/pystudio-maskable-512.png',
  './icons/apple-touch-icon.png',
  './css/main.css',
  './css/editor.css',
  './css/terminal.css',
  './js/app.js',
  './js/editor.js',
  './js/project-manager.js',
  './js/runtime-manager.js',
  './js/terminal.js',
  './js/pwa.js',
  './examples/programs.js',
  './workers/python-worker.js',
];

if (typeof window === 'undefined') {
  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      await self.skipWaiting();
      try {
        const cache = await caches.open(APP_SHELL_CACHE);
        const assetUrls = APP_SHELL_ASSETS.map((asset) => new URL(asset, self.registration.scope).href);
        await cache.addAll(assetUrls);
      } catch (error) {
        // Do not break the COI worker when a host blocks or evicts Cache Storage.
        console.warn('PyStudio app-shell pre-cache was incomplete:', error);
      }
    })());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter((name) => name.startsWith('pystudio-shell-') && name !== APP_SHELL_CACHE)
        .map((name) => caches.delete(name)));
      await self.clients.claim();
    })());
  });

  self.addEventListener('message', (event) => {
    if (!event.data) return;
    if (event.data.type === 'deregister') {
      event.waitUntil(self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url))));
    } else if (event.data.type === 'coepCredentialless') {
      coepCredentialless = event.data.value;
    }
  });

  self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
    const fetchRequest = coepCredentialless && request.mode === 'no-cors'
      ? new Request(request, { credentials: 'omit' })
      : request;
    event.respondWith(fetchWithIsolation(request, fetchRequest));
  });
} else {
  (() => {
    const reloadReason = window.sessionStorage.getItem('coiReloadedBySelf');
    window.sessionStorage.removeItem('coiReloadedBySelf');
    const wasDegrading = reloadReason === 'coepdegrade';
    const settings = {
      shouldRegister: () => !reloadReason,
      shouldDeregister: () => false,
      coepCredentialless: () => true,
      coepDegrade: () => true,
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };
    const serviceWorker = navigator.serviceWorker;
    const controller = serviceWorker && serviceWorker.controller;
    if (controller && !window.crossOriginIsolated) {
      window.sessionStorage.setItem('coiCoepHasFailed', 'true');
    }
    const isolationFailed = window.sessionStorage.getItem('coiCoepHasFailed');

    if (controller) {
      const shouldDegrade = settings.coepDegrade() && !(wasDegrading || window.crossOriginIsolated);
      controller.postMessage({
        type: 'coepCredentialless',
        value: !(shouldDegrade || (isolationFailed && settings.coepDegrade()))
          && settings.coepCredentialless(),
      });
      if (shouldDegrade) {
        if (!settings.quiet) console.log('Reloading page to degrade COEP.');
        window.sessionStorage.setItem('coiReloadedBySelf', 'coepdegrade');
        settings.doReload('coepdegrade');
      }
      if (settings.shouldDeregister()) controller.postMessage({ type: 'deregister' });
    }

    if (!window.crossOriginIsolated && settings.shouldRegister()) {
      if (window.isSecureContext && serviceWorker) {
        serviceWorker.register(window.document.currentScript.src)
          .then((registration) => {
            if (!settings.quiet) console.log('COOP/COEP Service Worker registered', registration.scope);
            registration.addEventListener('updatefound', () => {
              if (!settings.quiet) console.log('Reloading page to make use of updated COOP/COEP Service Worker.');
              window.sessionStorage.setItem('coiReloadedBySelf', 'updatefound');
              settings.doReload();
            });
            if (registration.active && !serviceWorker.controller) {
              if (!settings.quiet) console.log('Reloading page to make use of COOP/COEP Service Worker.');
              window.sessionStorage.setItem('coiReloadedBySelf', 'notcontrolling');
              settings.doReload();
            }
          })
          .catch((error) => {
            if (!settings.quiet) console.error('COOP/COEP Service Worker failed to register:', error);
          });
      } else if (!settings.quiet) {
        console.error('COOP/COEP Service Worker not registered: a secure context and service-worker support are required.');
      }
    }
  })();
}

async function fetchWithIsolation(request, fetchRequest) {
  try {
    // Skip the browser HTTP cache for document navigations so a stale index cannot
    // conceal the offline notice when the network has gone away.
    const response = request.mode === 'navigate'
      ? await fetch(fetchRequest, { cache: 'no-store' })
      : await fetch(fetchRequest);
    if (response.status === 0) return response;

    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
    if (!coepCredentialless) headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    const isolatedResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });

    if (isShellRequest(request) && response.status === 200) {
      try {
        const cache = await caches.open(APP_SHELL_CACHE);
        await cache.put(request, isolatedResponse.clone());
      } catch (error) {
        console.warn('PyStudio app-shell cache update failed:', error);
      }
    }
    return isolatedResponse;
  } catch {
    if (request.method === 'GET' && isWithinScope(request.url)) {
      try {
        const cache = await caches.open(APP_SHELL_CACHE);
        if (request.mode === 'navigate') {
          const offlineUrl = new URL('offline.html', self.registration.scope).href;
          const offlinePage = await cache.match(offlineUrl);
          if (offlinePage) return offlinePage;
        }
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;
      } catch (error) {
        console.warn('PyStudio could not read its app-shell cache:', error);
      }
    }
    return Response.error();
  }
}

function isShellRequest(request) {
  return request.method === 'GET' && isWithinScope(request.url);
}

function isWithinScope(requestUrl) {
  const url = new URL(requestUrl);
  const scope = new URL(self.registration.scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}
