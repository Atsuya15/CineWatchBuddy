// CineWatchBuddy Background Service Worker - Single WebSocket Controller
class CineBuddyBackground {
    constructor() {
        this.ws = null;
        this.config = null;
        this.reconnectAttempts = 0;
        this.username = null;
        this.currentRoom = null;
        this.chatHistory = [];
        
        // Supported sites for easier maintenance
        this.supportedSites = [
            'netflix.com',
            'hulu.com',
            'youtube.com',
            'disneyplus.com',
            'amazon.com',
            'hbomax.com'
        ];
        
        this.init();
    }

    async init() {
        await this.loadConfig();
        this.setupEventListeners();
        this.connectToBackend();
    }

    async loadConfig() {
        try {
            const result = await chrome.storage.local.get(['cinebuddyConfig']);
            if (result.cinebuddyConfig) {
                this.config = result.cinebuddyConfig;
            } else {
                // Default config
                this.config = {
                    backendUrl: 'ws://localhost:8080/ws',
                    httpUrl: 'http://localhost:8080',
                    reconnectAttempts: 5,
                    reconnectDelay: 3000,
                    maxReconnectDelay: 15000
                };
            }
        } catch (error) {
            console.error('Error loading config:', error);
            this.config = {
                backendUrl: 'ws://localhost:8080/ws',
                httpUrl: 'http://localhost:8080',
                reconnectAttempts: 5,
                reconnectDelay: 3000,
                maxReconnectDelay: 15000
            };
        }
    }

    setupEventListeners() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            console.log('CineWatchBuddy extension installed:', details);
        });

        // Handle tab updates for video detection
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.status === 'complete' && tab.url) {
                this.checkVideoOnTab(tabId, tab.url);
            }
        });

        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        // Handle WebSocket connection
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        // WebSocket connection will be established in connectToBackend
    }

    async connectToBackend() {
        try {
            this.ws = new WebSocket(this.config.backendUrl);
            
            this.ws.onopen = () => {
                console.log('Background: Connected to CineWatchBuddy backend');
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');
            };
            
            this.ws.onclose = (event) => {
                console.log('Background: Disconnected from backend', event.code, event.reason);
                this.updateConnectionStatus('disconnected');
                this.attemptReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('Background: WebSocket error:', error);
                this.updateConnectionStatus('disconnected');
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (err) {
                    console.error('Background: Malformed WS message', err, event.data);
                }
            };
        } catch (error) {
            console.error('Background: Error connecting to backend:', error);
            this.updateConnectionStatus('disconnected');
        }
    }

    async ensureSingleConnection() {
        const existing = await chrome.storage.local.get('wsConnected');
        if (existing.wsConnected) {
            console.log('Background: Reusing existing WS connection');
            return false;
        }
        await chrome.storage.local.set({ wsConnected: true });
        return true;
    }

    async handleMessage(message, sender, sendResponse) {
        console.log('Background: Received message:', message);
        
        switch (message.action) {
            case 'initUser':
                this.username = message.username;
                await chrome.storage.local.set({ username: this.username });
                sendResponse({ success: true });
                break;
                
            case 'createRoom':
                await this.handleCreateRoom(sendResponse);
                break;
                
            case 'joinRoom':
                await this.handleJoinRoom(message.roomId, sendResponse);
                break;
                
            case 'videoSync':
            case 'syncVideo': // content script uses this action name
                this.handleVideoSync(message.data);
                sendResponse({ success: true });
                break;

            case 'videoDetected':
                // Informational ping from a content script; nothing to forward.
                sendResponse({ success: true });
                break;

            case 'extensionReady':
                // Content script announcing DRM-page readiness; ack only.
                sendResponse({ success: true });
                break;
                
            case 'chatMessage':
                this.handleChatMessage(message.data);
                sendResponse({ success: true });
                break;
                
            case 'showChat':
                this.showChatInTab(sender.tab.id);
                sendResponse({ success: true });
                break;
                
            case 'getConnectionStatus':
                sendResponse({ 
                    status: this.ws ? (this.ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected') : 'disconnected',
                    currentRoom: this.currentRoom,
                    username: this.username
                });
                break;

            // Phase 3: Web client integration
            case 'webClientJoinRoom':
                await this.handleWebClientJoinRoom(message.roomId, message.username, sendResponse);
                break;

            case 'webClientVideoSync':
                this.handleWebClientVideoSync(message.data);
                sendResponse({ success: true });
                break;

            case 'webClientChatMessage':
                this.handleWebClientChatMessage(message.data);
                sendResponse({ success: true });
                break;

            case 'getCurrentRoom':
                sendResponse({ 
                    roomId: this.currentRoom,
                    username: this.username,
                    connected: this.ws && this.ws.readyState === WebSocket.OPEN
                });
                break;
                
            default:
                console.warn('Background: Unknown message action:', message.action);
                sendResponse({ success: false, error: 'Unknown action' });
        }
    }

    async handleCreateRoom(sendResponse) {
        try {
            const response = await fetch(`${this.config.httpUrl}/create-room`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: this.username })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.roomId) {
                this.currentRoom = data.room;
                await chrome.storage.local.set({ currentRoom: this.currentRoom });

                // Send join-room WebSocket message (server reads fields from `data`)
                this.ws.send(JSON.stringify({
                    type: 'join-room',
                    data: {
                        roomId: data.roomId,
                        username: this.username
                    }
                }));

                sendResponse({ success: true, room: data.room, shareLink: data.shareLink });
            } else {
                sendResponse({ success: false, error: data.message || 'Room creation failed' });
            }
        } catch (error) {
            console.error('Background: Error creating room:', error);
            sendResponse({ success: false, error: 'Failed to create room' });
        }
    }

    async handleJoinRoom(roomId, sendResponse) {
        try {
            this.ws.send(JSON.stringify({
                type: 'join-room',
                data: {
                    roomId: roomId,
                    username: this.username
                }
            }));

            // Wait for room-joined response
            const originalOnMessage = this.ws.onmessage;
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'room-joined') {
                        this.currentRoom = data.data?.room || data.data;
                        chrome.storage.local.set({ currentRoom: this.currentRoom });
                        sendResponse({ success: true, room: this.currentRoom });
                        this.ws.onmessage = originalOnMessage; // Restore original handler
                        return;
                    }
                } catch (err) {
                    console.error('Background: Error parsing room-joined message:', err);
                }
                originalOnMessage(event); // Call original handler for other messages
            };
        } catch (error) {
            console.error('Background: Error joining room:', error);
            sendResponse({ success: false, error: 'Failed to join room' });
        }
    }

    // currentRoom may be a room object (create/join) or a roomId string
    // (web-client path). Normalize to the id string the server expects.
    getRoomId() {
        if (!this.currentRoom) return null;
        return typeof this.currentRoom === 'string' ? this.currentRoom : this.currentRoom.id;
    }

    handleVideoSync(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'video-sync',
                data: {
                    ...data,
                    roomId: this.getRoomId(),
                    username: this.username
                }
            }));
        }
    }

    handleChatMessage(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'chat-message',
                data: {
                    ...data,
                    roomId: this.getRoomId(),
                    username: this.username
                }
            }));
        }
    }

    showChatInTab(tabId) {
        chrome.tabs.sendMessage(tabId, { action: 'showChat' });
    }

    // Phase 3: Web client integration methods
    async handleWebClientJoinRoom(roomId, username, sendResponse) {
        try {
            // Set username and room
            this.username = username;
            this.currentRoom = roomId;
            await chrome.storage.local.set({ 
                username: this.username,
                currentRoom: this.currentRoom 
            });

            // Send join room message to backend
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    type: 'join-room',
                    data: {
                        roomId: roomId,
                        username: username
                    }
                }));
            }

            sendResponse({ success: true, roomId: roomId });
        } catch (error) {
            console.error('Background: Error joining room from web client:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    handleWebClientVideoSync(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'video-sync',
                data: {
                    ...data,
                    roomId: this.currentRoom,
                    username: this.username,
                    source: 'web-client'
                }
            }));
        }
    }

    handleWebClientChatMessage(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'chat-message',
                data: {
                    ...data,
                    roomId: this.currentRoom,
                    username: this.username,
                    source: 'web-client'
                }
            }));
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.config.reconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Background: Attempting to reconnect (${this.reconnectAttempts}/${this.config.reconnectAttempts})`);
            
            // Show reconnecting status
            this.updateConnectionStatus('reconnecting');
            
            // Exponential backoff with cap
            const delay = Math.min(this.config.reconnectDelay * this.reconnectAttempts, this.config.maxReconnectDelay);
            
            setTimeout(() => {
                this.connectToBackend();
            }, delay);
        } else {
            console.log('Background: Max reconnection attempts reached');
            this.updateConnectionStatus('disconnected');
        }
    }

    updateConnectionStatus(status) {
        // Update badge based on connection status
        let badgeText, badgeColor;
        
        switch (status) {
            case 'connected':
                badgeText = 'ON';
                badgeColor = '#10b981'; // Green
                break;
            case 'connecting':
                badgeText = '...';
                badgeColor = '#f59e0b'; // Yellow
                break;
            case 'reconnecting':
                badgeText = '↻';
                badgeColor = '#f59e0b'; // Yellow
                break;
            case 'disconnected':
            default:
                badgeText = 'OFF';
                badgeColor = '#ef4444'; // Red
                break;
        }
        
        chrome.action.setBadgeText({ text: badgeText });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor });
        
        // Store status for popup
        chrome.storage.local.set({ connectionStatus: status });
    }

    async checkVideoOnTab(tabId, url) {
        try {
            // Check if URL is supported
            const isSupported = this.supportedSites.some(site => url.includes(site));
            
            if (isSupported) {
                // Inject content script to detect video
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['content/content.js']
                });
                
                // Also inject CSS
                await chrome.scripting.insertCSS({
                    target: { tabId },
                    files: ['content/content.css']
                });
            }
        } catch (error) {
            console.error('Background: Error checking video on tab:', error);
        }
    }

    // Removed duplicate handleMessage; unified earlier implementation handles all actions

    async checkVideoDetection(tabId) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'checkVideo' });
            return response?.videoDetected || false;
        } catch (error) {
            console.error('Background: Error checking video detection:', error);
            return false;
        }
    }

    syncVideoEvent(data, tabId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'video-sync',
                data: {
                    ...data,
                    tabId: tabId,
                    timestamp: Date.now()
                }
            }));
        }
    }

    handleWebSocketMessage(data) {
        console.log('Background: Received WebSocket message:', data.type);
        
        switch (data.type) {
            case 'video-sync':
                this.broadcastToAllTabs({ action: 'videoSync', data: data.data });
                break;
                
            case 'room-created':
            case 'room-joined':
            case 'room-update':
                this.broadcastToAllTabs({ action: 'roomUpdate', data: data.data || data.room });
                break;
                
            case 'participant-joined':
            case 'participant-left':
            case 'participant-update':
                this.broadcastToAllTabs({ action: 'participantUpdate', data: data.data || data.participants });
                break;
                
            case 'chat-message':
                this.broadcastToAllTabs({ action: 'chatMessage', data: data.data });
                // Store in chat history
                this.chatHistory.push(data.data);
                if (this.chatHistory.length > 50) {
                    this.chatHistory = this.chatHistory.slice(-50);
                }
                chrome.storage.local.set({ chatHistory: this.chatHistory });
                break;
                
            default:
                console.log('Background: Unknown message type:', data.type);
        }
    }

    async broadcastToAllTabs(message) {
        try {
            const tabs = await chrome.tabs.query({});
            for (const tab of tabs) {
                if (tab.status === 'complete' && !tab.discarded) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, message);
                    } catch (error) {
                        // Tab might not have content script, ignore
                    }
                }
            }
        } catch (error) {
            console.error('Background: Error broadcasting to tabs:', error);
        }
    }

    async broadcastVideoSync(data) {
        try {
            // Get all tabs that might be interested in this sync event
            const tabs = await chrome.tabs.query({});
            
            for (const tab of tabs) {
                // Filter out inactive tabs to save bandwidth
                if (tab.status === 'unloaded' || tab.discarded) {
                    continue;
                }
                
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'videoSync',
                        data: data
                    });
                } catch (error) {
                    // Check for runtime errors to avoid console noise
                    if (chrome.runtime.lastError) {
                        // Tab might not have content script, ignore silently
                    } else {
                        console.error('Background: Error sending message to tab:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Background: Error broadcasting video sync:', error);
        }
    }

    async broadcastRoomUpdate(room) {
        try {
            // Update storage with room data
            await chrome.storage.local.set({ currentRoom: room });
            
            // Notify popup if it's open
            chrome.runtime.sendMessage({
                action: 'roomUpdate',
                room: room
            }).catch(() => {
                // Popup might not be open, ignore
            });
        } catch (error) {
            console.error('Background: Error broadcasting room update:', error);
        }
    }

    async broadcastParticipantUpdate(participants) {
        try {
            // Notify popup if it's open
            chrome.runtime.sendMessage({
                action: 'participantUpdate',
                participants: participants
            }).catch(() => {
                // Popup might not be open, ignore
            });
        } catch (error) {
            console.error('Background: Error broadcasting participant update:', error);
        }
    }

    async broadcastChatMessage(messageData) {
        try {
            // Get all tabs that might be interested in this chat message
            const tabs = await chrome.tabs.query({});
            
            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'chatMessage',
                        data: messageData
                    });
                } catch (error) {
                    // Tab might not have content script, ignore
                }
            }
        } catch (error) {
            console.error('Background: Error broadcasting chat message:', error);
        }
    }
}

// Initialize the background service worker
new CineBuddyBackground();
