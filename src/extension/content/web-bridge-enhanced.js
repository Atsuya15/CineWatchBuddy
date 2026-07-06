// Enhanced Bridge between the web app and the extension background via content script
(function() {
  'use strict';
  
  const WEB_SOURCE = 'cinebuddy-web';
  const EXT_SOURCE = 'cinebuddy-extension';
  const BRIDGE_VERSION = '2.0.0';
  
  // Message queue for offline scenarios
  const messageQueue = [];
  const maxQueueSize = 100;
  const pendingRequests = new Map();
  const requestTimeout = 30000; // 30 seconds
  
  // Bridge state
  let isExtensionReady = false;
  let isWebAppReady = false;
  let heartbeatInterval = null;
  let lastHeartbeat = Date.now();
  
  // Initialize bridge
  function init() {
    console.log('CineBuddy Web Bridge v' + BRIDGE_VERSION + ' initialized');
    
    // Set up message listeners
    setupMessageListeners();
    
    // Start heartbeat
    startHeartbeat();
    
    // Notify web app that bridge is ready
    notifyWebAppReady();
    
    // Process any queued messages
    processMessageQueue();
  }
  
  // Set up message listeners
  function setupMessageListeners() {
    // Listen for messages from the web page
    window.addEventListener('message', handleWebAppMessage);
    
    // Listen for messages from the extension background
    chrome.runtime.onMessage.addListener(handleExtensionMessage);
    
    // Listen for page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for page unload
    window.addEventListener('beforeunload', cleanup);
  }
  
  // Handle messages from web app
  function handleWebAppMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== WEB_SOURCE) {
      return;
    }
    
    const { action, payload, correlationId, timestamp } = event.data;
    
    // Handle special bridge actions
    if (action === 'ping') {
      handlePing(correlationId);
      return;
    }
    
    if (action === 'webAppReady') {
      isWebAppReady = true;
      console.log('Web app is ready');
      processMessageQueue();
      return;
    }
    
    // Queue message if extension is not ready
    if (!isExtensionReady) {
      queueMessage({ action, payload, correlationId, timestamp });
      return;
    }
    
    // Send message to extension
    sendToExtension({ action, payload, correlationId, timestamp });
  }
  
  // Handle messages from extension
  function handleExtensionMessage(message, sender, sendResponse) {
    if (message.source !== 'cinebuddy-extension') {
      return;
    }
    
    const { action, payload, correlationId, error } = message;
    
    // Handle special bridge actions
    if (action === 'pong') {
      handlePong(payload);
      return;
    }
    
    if (action === 'extensionReady') {
      isExtensionReady = true;
      console.log('Extension is ready');
      processMessageQueue();
      return;
    }
    
    // Send response to web app
    sendToWebApp({
      action: error ? 'error' : 'response',
      payload: error ? { error: error.message || error } : payload,
      correlationId,
      timestamp: Date.now()
    });
    
    // Remove from pending requests
    if (correlationId) {
      pendingRequests.delete(correlationId);
    }
  }
  
  // Send message to extension
  function sendToExtension(message) {
    try {
      chrome.runtime.sendMessage({
        source: 'cinebuddy-web-bridge',
        ...message
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Extension communication error:', chrome.runtime.lastError);
          sendToWebApp({
            action: 'error',
            payload: { error: chrome.runtime.lastError.message },
            correlationId: message.correlationId,
            timestamp: Date.now()
          });
        }
      });
    } catch (error) {
      console.error('Failed to send message to extension:', error);
      sendToWebApp({
        action: 'error',
        payload: { error: error.message },
        correlationId: message.correlationId,
        timestamp: Date.now()
      });
    }
  }
  
  // Send message to web app
  function sendToWebApp(message) {
    try {
      window.postMessage({
        source: EXT_SOURCE,
        ...message
      }, '*');
    } catch (error) {
      console.error('Failed to send message to web app:', error);
    }
  }
  
  // Queue message for later processing
  function queueMessage(message) {
    if (messageQueue.length >= maxQueueSize) {
      messageQueue.shift(); // Remove oldest message
    }
    
    messageQueue.push({
      ...message,
      queuedAt: Date.now()
    });
    
    console.log(`Message queued: ${message.action} (${messageQueue.length}/${maxQueueSize})`);
  }
  
  // Process queued messages
  function processMessageQueue() {
    if (!isExtensionReady || !isWebAppReady || messageQueue.length === 0) {
      return;
    }
    
    console.log(`Processing ${messageQueue.length} queued messages`);
    
    const messages = [...messageQueue];
    messageQueue.length = 0;
    
    messages.forEach(message => {
      sendToExtension(message);
    });
  }
  
  // Handle ping from web app
  function handlePing(correlationId) {
    sendToWebApp({
      action: 'pong',
      payload: {
        timestamp: Date.now(),
        bridgeVersion: BRIDGE_VERSION,
        extensionReady: isExtensionReady
      },
      correlationId
    });
  }
  
  // Handle pong from extension
  function handlePong(payload) {
    lastHeartbeat = Date.now();
    isExtensionReady = true;
  }
  
  // Start heartbeat
  function startHeartbeat() {
    heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      // Check if extension is still responsive
      if (now - lastHeartbeat > 60000) { // 1 minute timeout
        isExtensionReady = false;
        console.warn('Extension heartbeat timeout');
      }
      
      // Send ping to extension
      sendToExtension({
        action: 'ping',
        payload: { timestamp: now },
        correlationId: 'heartbeat-' + now
      });
    }, 30000); // Send ping every 30 seconds
  }
  
  // Handle visibility change
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Page became visible, check extension status
      sendToExtension({
        action: 'ping',
        payload: { timestamp: Date.now() },
        correlationId: 'visibility-check'
      });
    }
  }
  
  // Notify web app that bridge is ready
  function notifyWebAppReady() {
    sendToWebApp({
      action: 'bridgeReady',
      payload: {
        version: BRIDGE_VERSION,
        timestamp: Date.now()
      }
    });
  }
  
  // Cleanup
  function cleanup() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    // Clear message queue
    messageQueue.length = 0;
    
    // Clear pending requests
    pendingRequests.clear();
  }
  
  // Error handling
  function handleError(error, context) {
    console.error(`Bridge error in ${context}:`, error);
    
    sendToWebApp({
      action: 'error',
      payload: {
        error: error.message || 'Unknown error',
        context,
        timestamp: Date.now()
      }
    });
  }
  
  // Initialize bridge when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  // Expose bridge API for debugging
  window.cinebuddyBridge = {
    version: BRIDGE_VERSION,
    isExtensionReady: () => isExtensionReady,
    isWebAppReady: () => isWebAppReady,
    getQueueSize: () => messageQueue.length,
    clearQueue: () => { messageQueue.length = 0; },
    getStats: () => ({
      version: BRIDGE_VERSION,
      extensionReady: isExtensionReady,
      webAppReady: isWebAppReady,
      queueSize: messageQueue.length,
      lastHeartbeat: lastHeartbeat
    })
  };
  
})();
