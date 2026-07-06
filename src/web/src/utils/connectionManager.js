// Connection Manager for robust WebSocket reconnection and state management
class ConnectionManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.maxReconnectDelay = 30000; // Max 30 seconds
    this.isReconnecting = false;
    this.connectionState = 'disconnected'; // disconnected, connecting, connected, reconnecting
    this.listeners = new Map();
    this.messageQueue = [];
    this.heartbeatInterval = null;
    this.lastPing = null;
    this.pingTimeout = null;
    this.config = {
      url: 'ws://localhost:8080/ws',
      heartbeatInterval: 30000, // 30 seconds
      pingTimeout: 10000, // 10 seconds
    };
  }

  // Event listener management
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });
  }

  // Connection state management
  setConnectionState(state) {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.emit('connectionStateChanged', state);
    }
  }

  getConnectionState() {
    return this.connectionState;
  }

  // WebSocket connection
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.setConnectionState('connecting');
    this.isReconnecting = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.setConnectionState('connected');
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          this.isReconnecting = false;
          this.startHeartbeat();
          this.processMessageQueue();
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.setConnectionState('disconnected');
          this.stopHeartbeat();
          this.emit('disconnected', event);
          
          if (!event.wasClean && !this.isReconnecting) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        this.setConnectionState('disconnected');
        reject(error);
      }
    });
  }

  // Reconnection logic
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.isReconnecting = true;
    this.setConnectionState('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
        this.scheduleReconnect();
      });
    }, delay);
  }

  // Message handling
  handleMessage(message) {
    switch (message.type) {
      case 'pong':
        this.lastPing = Date.now();
        if (this.pingTimeout) {
          clearTimeout(this.pingTimeout);
          this.pingTimeout = null;
        }
        break;
      case 'room-joined':
        this.emit('roomJoined', message.data);
        break;
      case 'participant-joined':
        this.emit('participantJoined', message.data);
        break;
      case 'participant-left':
        this.emit('participantLeft', message.data);
        break;
      case 'video-sync':
        this.emit('videoSync', message.data);
        break;
      case 'chat-message':
        this.emit('chatMessage', message.data);
        break;
      case 'webrtc-offer':
        this.emit('webrtcOffer', message.data);
        break;
      case 'webrtc-answer':
        this.emit('webrtcAnswer', message.data);
        break;
      case 'webrtc-ice-candidate':
        this.emit('webrtcIceCandidate', message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // Send message with queuing for offline state
  send(type, data) {
    const message = { type, data };
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Failed to send message:', error);
        this.queueMessage(message);
        return false;
      }
    } else {
      this.queueMessage(message);
      return false;
    }
  }

  // Message queuing for offline state
  queueMessage(message) {
    this.messageQueue.push(message);
    // Keep only last 100 messages to prevent memory issues
    if (this.messageQueue.length > 100) {
      this.messageQueue = this.messageQueue.slice(-100);
    }
  }

  processMessageQueue() {
    if (this.messageQueue.length === 0) return;
    
    console.log(`Processing ${this.messageQueue.length} queued messages`);
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    
    messages.forEach(message => {
      this.send(message.type, message.data);
    });
  }

  // Heartbeat management
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendPing();
    }, this.config.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.pingTimeout) {
      clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send('ping', { timestamp: Date.now() });
      
      // Set timeout for pong response
      this.pingTimeout = setTimeout(() => {
        console.warn('Ping timeout - connection may be dead');
        this.ws.close();
      }, this.config.pingTimeout);
    }
  }

  // Room management
  joinRoom(roomId, username) {
    return this.send('join-room', { roomId, username });
  }

  sendVideoSync(data) {
    return this.send('video-sync', data);
  }

  sendChatMessage(data) {
    return this.send('chat-message', data);
  }

  sendWebRTCOffer(data) {
    return this.send('webrtc-offer', data);
  }

  sendWebRTCAnswer(data) {
    return this.send('webrtc-answer', data);
  }

  sendWebRTCIceCandidate(data) {
    return this.send('webrtc-ice-candidate', data);
  }

  // Disconnect
  disconnect() {
    this.isReconnecting = false;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setConnectionState('disconnected');
  }

  // Cleanup
  destroy() {
    this.disconnect();
    this.listeners.clear();
    this.messageQueue = [];
  }
}

// Export singleton instance
export const connectionManager = new ConnectionManager();
export default ConnectionManager;
