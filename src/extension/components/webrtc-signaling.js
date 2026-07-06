// CineWatchBuddy WebRTC Signaling Component
class WebRTCSignaling {
    constructor() {
        this.localStream = null;
        this.peerConnections = new Map();
        this.roomId = null;
        this.username = null;
        this.ws = null;
        this.isInCall = false;
        
        this.iceServers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.loadTURNConfig();
    }

    async loadTURNConfig() {
        try {
            // Load TURN server config from storage or environment
            const result = await chrome.storage.local.get(['turnServers', 'cinebuddyConfig']);
            
            // Check for TURN servers in CineWatchBuddy config
            if (result.cinebuddyConfig?.turnServers) {
                this.iceServers.iceServers.push(...result.cinebuddyConfig.turnServers);
                return;
            }
            
            // Fallback to dedicated TURN config
            if (result.turnServers) {
                this.iceServers.iceServers.push(...result.turnServers);
            }
        } catch (error) {
            console.debug('Could not load TURN config:', error);
        }
    }

    async updateTURNConfig(turnServers) {
        try {
            // Update both storage locations for compatibility
            await chrome.storage.local.set({ 
                turnServers: turnServers,
                cinebuddyConfig: { 
                    ...(await chrome.storage.local.get(['cinebuddyConfig'])).cinebuddyConfig,
                    turnServers: turnServers 
                }
            });
            
            // Update current config
            this.iceServers.iceServers = [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                ...turnServers
            ];
            
            console.log('TURN configuration updated:', turnServers);
        } catch (error) {
            console.error('Error updating TURN config:', error);
        }
    }

    setWebSocket(ws) {
        this.ws = ws;
        this.setupWebSocketHandlers();
    }

    setRoomId(roomId) {
        this.roomId = roomId;
    }

    setUsername(username) {
        this.username = username;
    }

    setupWebSocketHandlers() {
        if (!this.ws) return;

        this.ws.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            this.handleSignalingMessage(data);
        });
    }

    handleSignalingMessage(data) {
        const roomMatch = data.data?.roomId === this.roomId;
        if (!roomMatch) {
            console.warn('Rejected signaling message from other room', data);
            return;
        }

        switch (data.type) {
            case 'webrtc-offer':
                this.handleOffer(data.data);
                break;
            case 'webrtc-answer':
                this.handleAnswer(data.data);
                break;
            case 'webrtc-ice-candidate':
                this.handleIceCandidate(data.data);
                break;
            case 'webrtc-call-started':
                this.handleCallStarted(data.data);
                break;
            case 'webrtc-call-ended':
                this.handleCallEnded(data.data);
                break;
        }
    }

    async startCall() {
        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

            this.isInCall = true;
            this.createVideoCallUI();
            this.notifyCallStarted();

        } catch (error) {
            console.error('Error starting call:', error);
            this.showError('Could not access camera/microphone. Please check permissions.');
        }
    }

    async endCall() {
        try {
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
                this.localStream = null;
            }

            // Close all peer connections and clean up
            this.peerConnections.forEach((pc, peerId) => {
                pc.close();
                this.peerConnections.delete(peerId);
            });

            this.isInCall = false;
            this.hideVideoCallUI();
            this.notifyCallEnded();

        } catch (error) {
            console.error('Error ending call:', error);
        }
    }

    async handleOffer(data) {
        try {
            const peerConnection = this.createPeerConnection(data.from);
            
            // Safari compatibility
            try {
                await peerConnection.setRemoteDescription(data.offer);
            } catch (error) {
                console.error('Error setting remote description:', error);
                return;
            }
            
            const answer = await peerConnection.createAnswer();
            
            try {
                await peerConnection.setLocalDescription(answer);
            } catch (error) {
                console.error('Error setting local description:', error);
                return;
            }

            // Send answer back
            this.sendSignalingMessage('webrtc-answer', {
                to: data.from,
                answer: answer
            });

        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        try {
            const peerConnection = this.peerConnections.get(data.from);
            if (peerConnection) {
                try {
                    await peerConnection.setRemoteDescription(data.answer);
                } catch (error) {
                    console.error('Error setting remote description (answer):', error);
                }
            }
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(data) {
        try {
            const peerConnection = this.peerConnections.get(data.from);
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(data.candidate);
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }

    handleCallStarted(data) {
        console.log('Call started by:', data.username);
        // Update UI to show call is active
    }

    handleCallEnded(data) {
        console.log('Call ended by:', data.username);
        // Update UI to show call has ended
    }

    createPeerConnection(peerId) {
        const peerConnection = new RTCPeerConnection(this.iceServers);
        
        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignalingMessage('webrtc-ice-candidate', {
                    to: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            this.addRemoteVideo(peerId, event.streams[0]);
        };

        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.connectionState);
            if (['failed', 'disconnected', 'closed'].includes(peerConnection.connectionState)) {
                this.removeRemoteVideo(peerId);
                this.peerConnections.delete(peerId);
            }
        };

        this.peerConnections.set(peerId, peerConnection);
        return peerConnection;
    }

    async initiateCall(peerId) {
        try {
            const peerConnection = this.createPeerConnection(peerId);
            
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            this.sendSignalingMessage('webrtc-offer', {
                to: peerId,
                offer: offer
            });

        } catch (error) {
            console.error('Error initiating call:', error);
        }
    }

    sendSignalingMessage(type, data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: type,
                data: {
                    ...data,
                    from: this.username,
                    roomId: this.roomId
                }
            }));
        }
    }

    notifyCallStarted() {
        this.sendSignalingMessage('webrtc-call-started', {
            username: this.username
        });
    }

    notifyCallEnded() {
        this.sendSignalingMessage('webrtc-call-ended', {
            username: this.username
        });
    }

    createVideoCallUI() {
        // Create video call overlay
        const overlay = document.createElement('div');
        overlay.id = 'cinewatchbuddy-video-call';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            width: 300px;
            height: 200px;
            background: rgba(0, 0, 0, 0.9);
            border-radius: 12px;
            z-index: 10002;
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: flex;
            flex-direction: column;
        `;

        overlay.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <h4 style="margin: 0; color: #667eea;">📹 Video Call</h4>
                <button id="end-call-btn" style="background: #ef4444; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer;">End</button>
            </div>
            <div style="flex: 1; position: relative;">
                <video id="local-video" autoplay muted style="width: 100%; height: 100%; object-fit: cover; border-radius: 0 0 12px 12px;"></video>
                <div id="remote-videos" style="position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 5px;"></div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Set up local video
        const localVideo = document.getElementById('local-video');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
        }

        // Set up event listeners
        document.getElementById('end-call-btn').addEventListener('click', () => {
            this.endCall();
        });
    }

    hideVideoCallUI() {
        const overlay = document.getElementById('cinewatchbuddy-video-call');
        if (overlay) {
            overlay.remove();
        }
    }

    addRemoteVideo(peerId, stream) {
        const remoteVideosContainer = document.getElementById('remote-videos');
        if (!remoteVideosContainer) return;

        const video = document.createElement('video');
        video.id = `remote-video-${peerId}`;
        video.autoplay = true;
        video.style.cssText = `
            width: 80px;
            height: 60px;
            object-fit: cover;
            border-radius: 4px;
            border: 2px solid #667eea;
        `;
        video.srcObject = stream;

        remoteVideosContainer.appendChild(video);
    }

    removeRemoteVideo(peerId) {
        const video = document.getElementById(`remote-video-${peerId}`);
        if (video) {
            video.remove();
        }
    }

    showError(message) {
        // Simple error notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(239, 68, 68, 0.9);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            z-index: 10003;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            max-width: 300px;
            text-align: center;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Export for use in other scripts
window.WebRTCSignaling = WebRTCSignaling;
