const installButton = document.getElementById('installButton');
const installDialog = document.getElementById('installDialog');
const installIntro = document.getElementById('installIntro');
const iosStep = document.getElementById('iosInstallStep');
const browserStep = document.getElementById('browserInstallStep');

let deferredInstallPrompt = null;
const userAgent = navigator.userAgent || '';
const isIOS = /iphone|ipad|ipod/i.test(userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(userAgent);
let offerManualInstructions = isIOS || isAndroid;

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function syncInstallButton() {
  if (!installButton) return;
  installButton.hidden = isInstalled() || (!deferredInstallPrompt && !offerManualInstructions);
  installButton.setAttribute('aria-label', isIOS ? 'How to add PyStudio to the Home Screen' : 'Install PyStudio');
  installButton.title = isIOS ? 'Add PyStudio to your Home Screen' : 'Install PyStudio';
}

function showInstallInstructions() {
  if (!installDialog) return;
  iosStep.hidden = !isIOS;
  browserStep.hidden = isIOS;
  installIntro.textContent = isIOS
    ? 'Add PyStudio to your iPhone or iPad Home Screen to open it in its own app window.'
    : 'If the browser did not show its install prompt, use its menu to add PyStudio to your Home Screen.';
  installDialog.showModal();
}

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showInstallInstructions();
      return;
    }

    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        installButton.hidden = true;
      } else {
        offerManualInstructions = true;
        showInstallInstructions();
      }
    } catch (error) {
      console.warn('The browser install prompt could not be opened:', error);
      offerManualInstructions = true;
      showInstallInstructions();
    }
    syncInstallButton();
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  if (isInstalled()) return;
  event.preventDefault();
  deferredInstallPrompt = event;
  syncInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  offerManualInstructions = false;
  if (installButton) installButton.hidden = true;
});

syncInstallButton();

// The COI bootstrap registers itself when response headers are unavailable. On
// hosts with native COOP/COEP headers, register that same worker for app-shell
// caching without introducing a second registration or scope.
if (window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator) {
  const workerUrl = new URL('../coi-serviceworker.js', import.meta.url);
  navigator.serviceWorker.register(workerUrl.href).catch((error) => {
    console.warn('PyStudio app-shell service worker could not be registered:', error);
  });
}
