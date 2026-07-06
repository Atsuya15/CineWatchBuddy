// CineBuddy Chat Overlay Component
class ChatOverlay {
    constructor() {
        this.messages = [];
        this.maxMessages = 100; // Limit chat history
        this.isVisible = false;
        this.ws = null;
        this.roomId = null;
        this.username = null;
        this.shouldAutoScroll = true;
        this.isNearBottom = true;
        
        this.init();
    }

    init() {
        this.createOverlay();
        this.setupEventListeners();
        this.setupMessageHandlers();
        this.loadStoredData();
    }

    createOverlay() {
        // Create main overlay container
        const overlay = document.createElement('div');
        overlay.id = 'cinebuddy-chat-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 350px;
            height: 500px;
            background: rgba(0, 0, 0, 0.95);
            color: white;
            border-radius: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            z-index: 10001;
            display: none;
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
        `;
        
        overlay.innerHTML = `
            <div class="chat-header">
                <div class="chat-title">
                    <h3 style="margin: 0; font-size: 16px; color: #667eea;">💬 Chat</h3>
                    <div class="participant-count" id="participant-count">0 participants</div>
                </div>
                <div class="chat-controls">
                    <button id="chat-minimize" class="chat-btn">−</button>
                    <button id="chat-close" class="chat-btn">×</button>
                </div>
            </div>
            
            <div class="chat-messages" id="chat-messages">
                <div class="welcome-message">
                    <p>Welcome to CineBuddy chat! 🎬</p>
                    <p>Start watching together and chat with your friends.</p>
                </div>
            </div>
            
            <div class="chat-input-container">
                <input 
                    type="text" 
                    id="chat-input" 
                    placeholder="Type a message..." 
                    class="chat-input"
                    maxlength="500"
                />
                <button id="chat-send" class="chat-send-btn">Send</button>
            </div>
            
            <div class="chat-status" id="chat-status">
                <span class="status-indicator"></span>
                <span class="status-text">Connecting...</span>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Add CSS styles
        this.addStyles();
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chat-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(102, 126, 234, 0.1);
                border-radius: 12px 12px 0 0;
            }
            
            .chat-title h3 {
                margin: 0;
                font-size: 16px;
                color: #667eea;
            }
            
            .participant-count {
                font-size: 12px;
                color: #a0a0a0;
                margin-top: 2px;
            }
            
            .chat-controls {
                display: flex;
                gap: 8px;
            }
            
            .chat-btn {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                color: white;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                cursor: pointer;
                font-size: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }
            
            .chat-btn:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: scale(1.1);
            }
            
            .chat-messages {
                height: 350px;
                overflow-y: auto;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            
            .chat-messages::-webkit-scrollbar {
                width: 4px;
            }
            
            .chat-messages::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
            }
            
            .chat-messages::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 2px;
            }
            
            .chat-messages::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.5);
            }
            
            .message {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            
            .message-header {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .message-username {
                font-weight: 600;
                color: #667eea;
                font-size: 13px;
            }
            
            .message-time {
                font-size: 11px;
                color: #666;
            }
            
            .message-content {
                background: rgba(255, 255, 255, 0.05);
                padding: 8px 12px;
                border-radius: 8px;
                word-wrap: break-word;
                line-height: 1.4;
            }
            
            .message.own-message .message-content {
                background: rgba(102, 126, 234, 0.2);
                border: 1px solid rgba(102, 126, 234, 0.3);
            }
            
            .welcome-message {
                text-align: center;
                color: #a0a0a0;
                font-style: italic;
                padding: 20px;
            }
            
            .chat-input-container {
                display: flex;
                padding: 16px;
                gap: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .chat-input {
                flex: 1;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 10px 12px;
                color: white;
                font-size: 14px;
                outline: none;
                transition: all 0.2s ease;
            }
            
            .chat-input:focus {
                border-color: #667eea;
                background: rgba(255, 255, 255, 0.08);
            }
            
            .chat-input::placeholder {
                color: #666;
            }
            
            .chat-send-btn {
                background: #667eea;
                border: none;
                color: white;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s ease;
            }
            
            .chat-send-btn:hover {
                background: #5a67d8;
                transform: translateY(-1px);
            }
            
            .chat-send-btn:disabled {
                background: #4a5568;
                cursor: not-allowed;
                transform: none;
            }
            
            .chat-status {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                font-size: 12px;
                color: #a0a0a0;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            .status-indicator {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #ef4444;
                animation: pulse 2s infinite;
            }
            
            .status-indicator.connected {
                background: #10b981;
            }
            
            .status-indicator.connecting {
                background: #f59e0b;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .chat-minimized {
                height: 60px !important;
            }
            
            .chat-minimized .chat-messages,
            .chat-minimized .chat-input-container {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // Close button
        document.getElementById('chat-close').addEventListener('click', () => {
            this.hide();
        });

        // Minimize button
        document.getElementById('chat-minimize').addEventListener('click', () => {
            this.toggleMinimize();
        });

        // Send button
        document.getElementById('chat-send').addEventListener('click', () => {
            this.sendMessage();
        });

        // Enter key to send
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize input
        document.getElementById('chat-input').addEventListener('input', (e) => {
            this.updateSendButton();
        });

        // Scroll detection for auto-scroll logic
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.addEventListener('scroll', () => {
                this.checkScrollPosition();
            });
        }
    }

    setupMessageHandlers() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'chatMessage':
                    this.addMessage(message.data);
                    break;
                case 'showChat':
                    this.show();
                    break;
                case 'hideChat':
                    this.hide();
                    break;
            }
        });
    }

    checkScrollPosition() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;

        const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
        const threshold = 50; // pixels from bottom
        
        this.isNearBottom = (scrollHeight - scrollTop - clientHeight) < threshold;
    }

    async loadStoredData() {
        try {
            const result = await chrome.storage.local.get(['username', 'currentRoom']);
            this.username = result.username;
            this.roomId = result.currentRoom?.id;
        } catch (error) {
            console.error('Error loading stored data:', error);
        }
    }

    show() {
        const overlay = document.getElementById('cinebuddy-chat-overlay');
        if (overlay) {
            overlay.style.display = 'block';
            this.isVisible = true;
            this.scrollToBottom();
        }
    }

    hide() {
        const overlay = document.getElementById('cinebuddy-chat-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            this.isVisible = false;
            
            // Lazy cleanup to reduce background cost
            setTimeout(() => {
                this.cleanupEventListeners();
            }, 5000); // Clean up after 5 seconds of being hidden
        }
    }

    cleanupEventListeners() {
        // Remove event listeners to reduce memory usage
        const closeBtn = document.getElementById('chat-close');
        const minimizeBtn = document.getElementById('chat-minimize');
        const sendBtn = document.getElementById('chat-send');
        const input = document.getElementById('chat-input');
        const messagesContainer = document.getElementById('chat-messages');
        
        if (closeBtn) closeBtn.removeEventListener('click', this.hide);
        if (minimizeBtn) minimizeBtn.removeEventListener('click', this.toggleMinimize);
        if (sendBtn) sendBtn.removeEventListener('click', this.sendMessage);
        if (input) {
            input.removeEventListener('keypress', this.handleKeyPress);
            input.removeEventListener('input', this.updateSendButton);
        }
        if (messagesContainer) {
            messagesContainer.removeEventListener('scroll', this.checkScrollPosition);
        }
    }

    toggleMinimize() {
        const overlay = document.getElementById('cinebuddy-chat-overlay');
        const minimizeBtn = document.getElementById('chat-minimize');
        
        if (overlay.classList.contains('chat-minimized')) {
            overlay.classList.remove('chat-minimized');
            minimizeBtn.textContent = '−';
        } else {
            overlay.classList.add('chat-minimized');
            minimizeBtn.textContent = '+';
        }
    }

    setWebSocket(ws) {
        this.ws = ws;
        this.updateStatus('connected', 'Connected');
    }

    setRoomId(roomId) {
        this.roomId = roomId;
    }

    setUsername(username) {
        this.username = username;
    }

    updateStatus(status, text) {
        const statusIndicator = document.querySelector('.status-indicator');
        const statusText = document.querySelector('.status-text');
        
        if (statusIndicator) {
            statusIndicator.className = `status-indicator ${status}`;
        }
        if (statusText) {
            statusText.textContent = text;
        }
    }

    updateParticipantCount(count) {
        const countElement = document.getElementById('participant-count');
        if (countElement) {
            countElement.textContent = `${count} participant${count !== 1 ? 's' : ''}`;
        }
    }

    addMessage(message) {
        // Sanitize message length
        if (message.content && message.content.length > 500) {
            message.content = message.content.substring(0, 500) + '...';
        }
        
        this.messages.push(message);
        
        // Limit message history
        if (this.messages.length > this.maxMessages) {
            this.messages = this.messages.slice(-this.maxMessages);
        }
        
        this.renderMessage(message);
        
        // Only auto-scroll if user is near bottom
        if (this.shouldAutoScroll && this.isNearBottom) {
            this.scrollToBottom();
        }
    }

    renderMessage(message) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;

        // Remove welcome message if it exists
        const welcomeMessage = messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.username === this.username ? 'own-message' : ''}`;
        
        const time = new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-username">${this.escapeHtml(message.username)}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${this.escapeHtml(message.content)}</div>
        `;

        messagesContainer.appendChild(messageElement);
    }

    sendMessage() {
        const input = document.getElementById('chat-input');
        const content = input.value.trim();
        
        if (!content || !this.roomId) return;

        const message = {
            username: this.username || 'Anonymous',
            content: content,
            timestamp: Date.now(),
            roomId: this.roomId
        };

        // Send via chrome.runtime messaging to background script
        chrome.runtime.sendMessage({
            action: 'chatMessage',
            data: message
        }).catch(error => {
            console.error('Chat: Error sending message:', error);
        });

        // Add to local messages
        this.addMessage(message);

        // Clear input
        input.value = '';
        this.updateSendButton();
    }

    updateSendButton() {
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        
        if (input && sendBtn) {
            const hasContent = input.value.trim().length > 0;
            sendBtn.disabled = !hasContent || !this.ws || !this.roomId;
        }
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    clearMessages() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <p>Welcome to CineBuddy chat! 🎬</p>
                    <p>Start watching together and chat with your friends.</p>
                </div>
            `;
        }
        this.messages = [];
    }
}

// Export for use in other scripts
window.ChatOverlay = ChatOverlay;
