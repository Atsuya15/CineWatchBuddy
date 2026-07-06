// Bridge between the web app and the extension background via content script
(function() {
  const WEB_SOURCE = 'cinewatchbuddy-web';
  const EXT_SOURCE = 'cinewatchbuddy-extension';

  // Listen for messages from the web page and forward to background
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== WEB_SOURCE) return;
    try {
      const request = event.data.payload || {};
      chrome.runtime.sendMessage(request, (response) => {
        // Relay the response back to the web page
        window.postMessage({ source: EXT_SOURCE, action: 'response', correlationId: event.data.correlationId, payload: response }, '*');
      });
    } catch (err) {
      window.postMessage({ source: EXT_SOURCE, action: 'error', error: err?.message }, '*');
    }
  });

  // Optionally notify page that bridge is ready
  window.postMessage({ source: EXT_SOURCE, action: 'bridgeReady' }, '*');
})();
