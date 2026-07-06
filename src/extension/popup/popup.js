// CineWatchBuddy Popup - Simplified to use background script messaging
class CineBuddyPopup {
    constructor() {
        this.state = {
            username: '',
            isLoggedIn: false,
            currentRoom: null,
            connectionStatus: 'disconnected',
            isCreatingRoom: false,
            isJoiningRoom: false,
            showJoinForm: false,
            roomId: ''
        };
        
        this.config = null;
        this.debounceTimeout = null;
        
        this.init();
    }

    async init() {
        // Render immediately to keep popup responsive
        this.render();

        // Load everything asynchronously without blocking the UI
        this.loadConfig()
            .then(() => this.loadUserData())
            .then(() => this.checkVideoDetection())
            .then(() => this.checkConnectionStatus())
            .catch((err) => console.error('Init error:', err));
    }

    async loadConfig() {
        try {
            const result = await chrome.storage.local.get(['cinebuddyConfig']);
            if (result.cinebuddyConfig) {
                this.config = result.cinebuddyConfig;
            } else {
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

    async loadUserData() {
        try {
            const result = await chrome.storage.local.get(['username', 'currentRoom']);
            if (result.username) {
                this.setState({
                    username: result.username,
                    isLoggedIn: true,
                    currentRoom: result.currentRoom || null
                });
            }
            if (result.currentRoom) {
                this.setState({ currentRoom: result.currentRoom });
            }
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async checkVideoDetection() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url) {
                const isSupported = this.isSupportedSite(tab.url);
                this.setState({ 
                    hasVideo: isSupported,
                    currentUrl: tab.url 
                });
            }
        } catch (error) {
            console.error('Error checking video detection:', error);
        }
    }

    async checkConnectionStatus() {
        try {
            const response = await this.sendMessage({ action: 'getConnectionStatus' });
            if (response && response.status) {
                this.setState({ 
                    connectionStatus: response.status,
                    currentRoom: response.currentRoom,
                    username: response.username || this.state.username
                });
            }
        } catch (error) {
            console.error('Error checking connection status:', error);
        }
    }

    setupMessageListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            switch (message.action) {
                case 'roomCreated':
                    this.setState({ 
                        currentRoom: message.room,
                        isCreatingRoom: false 
                    });
                    this.showToast('Room created successfully!', 'success');
                    break;
                    
                case 'roomJoined':
                    this.setState({ 
                        currentRoom: message.room,
                        isJoiningRoom: false 
                    });
                    this.showToast('Joined room successfully!', 'success');
                    break;
                    
                case 'error':
                    this.setState({ 
                        isCreatingRoom: false,
                        isJoiningRoom: false 
                    });
                    this.showToast(message.error || 'An error occurred', 'error');
                    break;
                    
                case 'connectionStatus':
                    this.setState({ connectionStatus: message.status });
                    break;
            }
        });
    }

    sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    }

    isSupportedSite(url) {
        const supportedSites = [
            'netflix.com',
            'hulu.com',
            'youtube.com',
            'disneyplus.com',
            'amazon.com',
            'hbomax.com'
        ];
        return supportedSites.some(site => url.includes(site));
    }

    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    handleUsernameChange = (e) => {
        const username = e.target.value;
        this.setState({ username });
        
        // Debounce username validation
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        
        this.debounceTimeout = setTimeout(() => {
            if (username.trim().length >= 2) {
                this.setState({ isLoggedIn: true });
                this.sendMessage({ action: 'initUser', username: username.trim() });
            } else {
                this.setState({ isLoggedIn: false });
            }
        }, 300);
    };

    handleRoomIdChange = (e) => {
        this.setState({ roomId: e.target.value });
    };

    handleCreateRoom = async () => {
        if (!this.state.isLoggedIn) {
            this.showToast('Please enter a username first', 'error');
            return;
        }
        
        this.setState({ isCreatingRoom: true });
        
        try {
            const response = await this.sendMessage({ action: 'createRoom' });
            if (response && response.success) {
                this.setState({ 
                    currentRoom: response.room,
                    isCreatingRoom: false 
                });
                this.showToast('Room created successfully!', 'success');
            } else {
                this.setState({ isCreatingRoom: false });
                this.showToast(response?.error || 'Failed to create room', 'error');
            }
        } catch (error) {
            console.error('Error creating room:', error);
            this.setState({ isCreatingRoom: false });
            this.showToast('Failed to create room', 'error');
        }
    };

    handleJoinRoom = async () => {
        const { roomId } = this.state;
        if (!roomId.trim()) {
            this.showToast('Please enter a room ID', 'error');
            return;
        }
        
        if (!this.state.isLoggedIn) {
            this.showToast('Please enter a username first', 'error');
            return;
        }
        
        this.setState({ isJoiningRoom: true });
        
        try {
            const response = await this.sendMessage({ action: 'joinRoom', roomId: roomId.trim() });
            if (response && response.success) {
                this.setState({ 
                    currentRoom: response.room,
                    isJoiningRoom: false,
                    showJoinForm: false,
                    roomId: ''
                });
                this.showToast('Joined room successfully!', 'success');
            } else {
                this.setState({ isJoiningRoom: false });
                this.showToast(response?.error || 'Failed to join room', 'error');
            }
        } catch (error) {
            console.error('Error joining room:', error);
            this.setState({ isJoiningRoom: false });
            this.showToast('Failed to join room', 'error');
        }
    };

    handleShowJoinForm = () => {
        this.setState({ showJoinForm: !this.state.showJoinForm });
    };

    handleShowChat = () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'showChat' });
            }
        });
    };

    handleCopyInviteLink = async () => {
        if (!this.state.currentRoom) {
            this.showToast('No active room', 'error');
            return;
        }
        
        const inviteLink = `${this.config.httpUrl}/join?room=${this.state.currentRoom.id}`;
        
        try {
            await navigator.clipboard.writeText(inviteLink);
            this.showToast('Invite link copied to clipboard!', 'success');
        } catch (error) {
            console.error('Error copying to clipboard:', error);
            this.showToast('Failed to copy link', 'error');
        }
    };

    showToast(message, type = 'info') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        
        // Add to popup
        document.body.appendChild(toast);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    render() {
        const {
            username,
            isLoggedIn,
            currentRoom,
            connectionStatus,
            isCreatingRoom,
            isJoiningRoom,
            showJoinForm,
            roomId,
            hasVideo
        } = this.state;

        const popupHTML = `
            <div class="popup-container">
                <div class="header">
                    <h1>🎬 CineWatchBuddy</h1>
                    <div class="status-indicator ${connectionStatus}">
                        ${connectionStatus === 'connected' ? '🟢' : connectionStatus === 'connecting' ? '🟡' : '🔴'}
                        ${connectionStatus.toUpperCase()}
                    </div>
                </div>

                ${!isLoggedIn ? `
                    <div class="login-section">
                        <input 
                            type="text" 
                            id="username" 
                            placeholder="Enter your username" 
                            value="${username}"
                            maxlength="20"
                        />
                        <div class="username-hint">Username must be 2-20 characters</div>
                    </div>
                ` : ''}

                ${isLoggedIn && !currentRoom ? `
                    <div class="room-section">
                        <button 
                            id="createRoom" 
                            class="btn btn-primary"
                            ${isCreatingRoom ? 'disabled' : ''}
                        >
                            ${isCreatingRoom ? 'Creating...' : 'Create Room'}
                        </button>
                        
                        <button 
                            id="showJoinForm" 
                            class="btn btn-secondary"
                        >
                            Join Room
                        </button>
                        
                        ${showJoinForm ? `
                            <div class="join-form">
                                <input 
                                    type="text" 
                                    id="roomId" 
                                    placeholder="Enter room ID" 
                                    value="${roomId}"
                                />
                                <button 
                                    id="joinRoom" 
                                    class="btn btn-primary"
                                    ${isJoiningRoom ? 'disabled' : ''}
                                >
                                    ${isJoiningRoom ? 'Joining...' : 'Join'}
                                </button>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

                ${currentRoom ? `
                    <div class="room-info">
                        <h3>Room: ${currentRoom.id}</h3>
                        <p>Participants: ${currentRoom.participants?.length || 0}</p>
                        
                        <div class="room-actions">
                            <button id="copyInviteLink" class="btn btn-secondary">
                                📋 Copy Invite Link
                            </button>
                            ${hasVideo ? `
                                <button id="showChat" class="btn btn-primary">
                                    💬 Chat
                                </button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${!hasVideo ? `
                    <div class="video-warning">
                        <p>⚠️ No video detected on this page</p>
                        <p>Navigate to a supported streaming site to start watching together!</p>
                    </div>
                ` : ''}
            </div>
        `;

        document.body.innerHTML = popupHTML;
        this.attachEventListeners();
    }

    attachEventListeners() {
        // Username input
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            usernameInput.addEventListener('input', this.handleUsernameChange);
        }

        // Room ID input
        const roomIdInput = document.getElementById('roomId');
        if (roomIdInput) {
            roomIdInput.addEventListener('input', this.handleRoomIdChange);
        }

        // Buttons
        const createRoomBtn = document.getElementById('createRoom');
        if (createRoomBtn) {
            createRoomBtn.addEventListener('click', this.handleCreateRoom);
        }

        const joinRoomBtn = document.getElementById('joinRoom');
        if (joinRoomBtn) {
            joinRoomBtn.addEventListener('click', this.handleJoinRoom);
        }

        const showJoinFormBtn = document.getElementById('showJoinForm');
        if (showJoinFormBtn) {
            showJoinFormBtn.addEventListener('click', this.handleShowJoinForm);
        }

        const showChatBtn = document.getElementById('showChat');
        if (showChatBtn) {
            showChatBtn.addEventListener('click', this.handleShowChat);
        }

        const copyInviteLinkBtn = document.getElementById('copyInviteLink');
        if (copyInviteLinkBtn) {
            copyInviteLinkBtn.addEventListener('click', this.handleCopyInviteLink);
        }
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CineBuddyPopup();
});