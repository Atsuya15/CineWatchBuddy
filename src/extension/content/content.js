// CineWatchBuddy Content Script - Video Detection and Sync
class CineBuddyContentScript {
    // Polyfill for requestIdleCallback to support Firefox
    static setupIdleCallbackPolyfill() {
        if (typeof window.requestIdleCallback === 'undefined') {
            window.requestIdleCallback = function (cb) { return setTimeout(cb, 100); };
            window.cancelIdleCallback = function (id) { clearTimeout(id); };
        }
    }

    constructor() {
        this.videoElements = new Set();
        this.currentVideo = null;
        this.isHost = false;
        this.roomId = null;
        this.lastSyncTime = 0;
        this.syncThreshold = 100; // ms
        this.chatOverlay = null;
        this.ws = null;
        this.timeUpdateThrottle = null;
        this.mutationObserverDebounce = null;
        this.videoSyncThrottle = null;
        this.lastVideoSyncTime = 0;
        this.videoSyncCount = 0;
        this.videoSyncResetTime = 0;
        // Echo guard: while applying an incoming sync we briefly suppress
        // outgoing broadcasts so the play/pause/seek we trigger locally is not
        // re-sent back to the room (which would cause an echo loop).
        this._applyingRemoteUntil = 0;
        
                CineBuddyContentScript.setupIdleCallbackPolyfill();
        this.init();
    }

    init() {
        this.detectVideos();
        this.setupEventListeners();
        this.setupMessageHandlers();
        this.createOverlay();
        this.initializeChat();
        this.setupCleanup();
        this.checkRoomStatus();
    }

    setupEventListeners() {
        // Reserved for page-level listeners. Video element events are wired in
        // setupVideoListeners(); teardown is handled in setupCleanup().
        // NOTE: this method used to be missing entirely, which threw during
        // init() and prevented setupMessageHandlers() from ever registering the
        // incoming-sync handler — so remote play/pause/seek were never applied.
    }

    setupCleanup() {
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    cleanup() {
        // Disconnect observers and listeners
        if (this.observer) {
            this.observer.disconnect();
        }
        
        // Remove video indicators
        document.querySelectorAll('.cinewatchbuddy-video-indicator').forEach(el => el.remove());
        
        // Clear video elements
        this.videoElements.clear();
        
        // Close WebSocket if open
        if (this.ws) {
            this.ws.close();
        }
    }

    initializeChat() {
        // The chat overlay is optional and independent of video sync. When the
        // component class is available in this (isolated) world we use it;
        // otherwise we skip it. Injecting it as a page <script> would run it in
        // the main world where the content script can't reference it, so we do
        // not attempt that (it previously threw "ChatOverlay is not defined").
        try {
            if (typeof ChatOverlay !== 'undefined') {
                this.chatOverlay = new ChatOverlay();
            }
        } catch (e) {
            console.debug('Chat overlay unavailable:', e);
        }
    }

    detectVideos() {
        // Find all video elements on the page
        const videos = document.querySelectorAll('video');
        
        videos.forEach(video => {
            this.videoElements.add(video);
            this.setupVideoListeners(video);
            this.addVideoIndicator(video);
        });

        // Platform-specific video detection
        this.detectPlatformSpecificVideos();

        // Set up observer for dynamically added videos with debouncing
        const observer = new MutationObserver((mutations) => {
            // Debounce mutation observer callbacks
            if (this.mutationObserverDebounce) {
                clearTimeout(this.mutationObserverDebounce);
            }
            
            this.mutationObserverDebounce = setTimeout(() => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'VIDEO') {
                                this.videoElements.add(node);
                                this.setupVideoListeners(node);
                                this.addVideoIndicator(node);
                            }
                            
                            // Check for videos in added subtree
                            const newVideos = node.querySelectorAll && node.querySelectorAll('video');
                            if (newVideos) {
                                newVideos.forEach(video => {
                                    this.videoElements.add(video);
                                    this.setupVideoListeners(video);
                                    this.addVideoIndicator(video);
                                });
                            }
                        }
                    });
                });
            }, 500); // 500ms debounce
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Notify background script about video detection
        this.notifyVideoDetection();
    }

    detectPlatformSpecificVideos() {
        const hostname = window.location.hostname;
        
        // Netflix specific detection
        if (hostname.includes('netflix.com')) {
            this.detectNetflixVideos();
        }
        // YouTube specific detection
        else if (hostname.includes('youtube.com')) {
            this.detectYouTubeVideos();
        }
        // Hulu specific detection
        else if (hostname.includes('hulu.com')) {
            this.detectHuluVideos();
        }
        // Disney+ specific detection
        else if (hostname.includes('disneyplus.com')) {
            this.detectDisneyPlusVideos();
        }
        // Amazon Prime specific detection
        else if (hostname.includes('amazon.com')) {
            this.detectAmazonPrimeVideos();
        }
        // Generic site example: watch32.sx or any site with HTML5 video
        else if (hostname.includes('watch32.sx')) {
            // Generic detection already covers <video> tags; ensure we attach listeners
            const genericVideos = document.querySelectorAll('video');
            genericVideos.forEach(video => {
                if (!this.videoElements.has(video)) {
                    this.videoElements.add(video);
                    this.setupVideoListeners(video);
                    this.addVideoIndicator(video);
                }
            });
        }
    }

    detectNetflixVideos() {
        // Netflix uses a custom player, look for their video container
        const netflixPlayer = document.querySelector('.PlayerContainer video, .VideoContainer video');
        if (netflixPlayer && !this.videoElements.has(netflixPlayer)) {
            this.videoElements.add(netflixPlayer);
            this.setupVideoListeners(netflixPlayer);
            this.addVideoIndicator(netflixPlayer);
        }
    }

    detectYouTubeVideos() {
        // YouTube player detection
        const youtubePlayer = document.querySelector('#movie_player video, .html5-video-player video');
        if (youtubePlayer && !this.videoElements.has(youtubePlayer)) {
            this.videoElements.add(youtubePlayer);
            this.setupVideoListeners(youtubePlayer);
            this.addVideoIndicator(youtubePlayer);
        }
    }

    detectHuluVideos() {
        // Hulu player detection
        const huluPlayer = document.querySelector('.player video, .video-player video');
        if (huluPlayer && !this.videoElements.has(huluPlayer)) {
            this.videoElements.add(huluPlayer);
            this.setupVideoListeners(huluPlayer);
            this.addVideoIndicator(huluPlayer);
        }
    }

    detectDisneyPlusVideos() {
        // Disney+ player detection
        const disneyPlayer = document.querySelector('.dss-player video, .video-player video');
        if (disneyPlayer && !this.videoElements.has(disneyPlayer)) {
            this.videoElements.add(disneyPlayer);
            this.setupVideoListeners(disneyPlayer);
            this.addVideoIndicator(disneyPlayer);
        }
    }

    detectAmazonPrimeVideos() {
        // Amazon Prime player detection
        const primePlayer = document.querySelector('.webPlayerContainer video, .video-player video');
        if (primePlayer && !this.videoElements.has(primePlayer)) {
            this.videoElements.add(primePlayer);
            this.setupVideoListeners(primePlayer);
            this.addVideoIndicator(primePlayer);
        }
    }

    addVideoIndicator(video) {
        // Add a small indicator to show video is detected
        // Avoid injecting into DRM overlays or protected content
        if (video.parentNode && 
            !video.parentNode.querySelector('.cinewatchbuddy-video-indicator') &&
            !this.isDRMOverlay(video.parentNode)) {
            try {
                const indicator = document.createElement('div');
                indicator.className = 'cinewatchbuddy-video-indicator';
                indicator.textContent = '🎬 CineWatchBuddy Ready';
                video.parentNode.style.position = 'relative';
                video.parentNode.appendChild(indicator);
            } catch (error) {
                // Silently fail if we can't inject (DRM protection)
                console.debug('Could not inject video indicator:', error);
            }
        }
    }

    isDRMOverlay(element) {
        // Check for common DRM overlay selectors
        const drmSelectors = [
            '.drm-overlay',
            '.protection-overlay',
            '.encrypted-content',
            '[data-drm]',
            '.widevine-overlay'
        ];
        
        return drmSelectors.some(selector => 
            element.matches(selector) || element.querySelector(selector)
        );
    }

    setupVideoListeners(video) {
        // Play/Pause events
        video.addEventListener('play', () => this.handleVideoEvent('play', video));
        video.addEventListener('pause', () => this.handleVideoEvent('pause', video));
        
        // Seek events
        video.addEventListener('seeked', () => this.handleVideoEvent('seeked', video));
        video.addEventListener('seeking', () => this.handleVideoEvent('seeking', video));
        
        // Time update events (for sync) - throttled
        video.addEventListener('timeupdate', () => this.handleTimeUpdateThrottled(video));
        
        // Volume events
        video.addEventListener('volumechange', () => this.handleVideoEvent('volumechange', video));
        
        // Rate change events
        video.addEventListener('ratechange', () => this.handleVideoEvent('ratechange', video));
    }

    handleTimeUpdateThrottled(video) {
        // Use requestIdleCallback for better performance
        if (this.timeUpdateThrottle) {
            cancelIdleCallback(this.timeUpdateThrottle);
        }
        
        this.timeUpdateThrottle = requestIdleCallback(() => {
            this.handleVideoEvent('timeupdate', video);
        }, { timeout: 100 });
    }

    handleVideoEvent(eventType, video) {
        // Any participant may drive playback (like the web client). We no longer
        // gate on isHost — instead we suppress events that were caused by us
        // applying a remote sync, to avoid echo loops.
        if (Date.now() < this._applyingRemoteUntil) return;

        // Don't broadcast raw timeupdate ticks — they create cross-jitter and
        // echo noise. Play/pause/seek carry the position we actually need.
        if (eventType === 'timeupdate') return;

        // Guard against videos that aren't ready
        if (video.readyState < 1) {
            return;
        }
        
        const now = Date.now();
        if (eventType === 'timeupdate' && now - this.lastSyncTime < this.syncThreshold) {
            return; // Throttle timeupdate events
        }
        
        // Throttle video sync broadcasts to max 5 per second
        if (this.shouldThrottleVideoSync(now)) {
            return;
        }
        
        this.lastSyncTime = now;
        
        const eventData = {
            type: eventType,
            currentTime: video.currentTime,
            duration: video.duration,
            paused: video.paused,
            volume: video.volume,
            playbackRate: video.playbackRate,
            videoId: this.getVideoId(video),
            url: window.location.href,
            timestamp: now,
            platform: this.getCurrentPlatform(),
            videoTitle: this.getVideoTitle(),
            quality: this.getVideoQuality(video)
        };

        this.syncVideoEvent(eventData);
        this.updateSyncStatus('syncing');
        this.videoSyncCount++;
    }

    shouldThrottleVideoSync(now) {
        // Reset counter every second
        if (now - this.videoSyncResetTime >= 1000) {
            this.videoSyncCount = 0;
            this.videoSyncResetTime = now;
        }
        
        // Throttle if we've exceeded 5 syncs per second
        return this.videoSyncCount >= 5;
    }

    getCurrentPlatform() {
        const hostname = window.location.hostname;
        if (hostname.includes('netflix.com')) return 'netflix';
        if (hostname.includes('youtube.com')) return 'youtube';
        if (hostname.includes('hulu.com')) return 'hulu';
        if (hostname.includes('disneyplus.com')) return 'disneyplus';
        if (hostname.includes('amazon.com')) return 'amazon';
        if (hostname.includes('hbomax.com')) return 'hbomax';
        return 'generic';
    }

    getVideoTitle() {
        // Try to extract video title from various sources
        const titleSelectors = [
            'h1.title',
            '.title',
            '[data-testid="title"]',
            '.video-title',
            'h1',
            'title'
        ];
        
        for (const selector of titleSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }
        
        return document.title || 'Unknown Title';
    }

    getVideoQuality(video) {
        // Try to get video quality information
        if (video.videoWidth && video.videoHeight) {
            return `${video.videoWidth}x${video.videoHeight}`;
        }
        return 'unknown';
    }

    updateSyncStatus(status) {
        const statusElement = document.querySelector('.cinewatchbuddy-sync-status');
        if (statusElement) {
            statusElement.className = `cinewatchbuddy-sync-status ${status}`;
            statusElement.textContent = status === 'syncing' ? 'Syncing...' : 
                                      status === 'synced' ? 'Synced' : 'Error';
        }
    }

    getVideoId(video) {
        // Try to get a unique identifier for the video
        return video.id || video.src || video.currentSrc || 'video-' + Array.from(this.videoElements).indexOf(video);
    }

    syncVideoEvent(eventData) {
        chrome.runtime.sendMessage({
            action: 'syncVideo',
            data: eventData
        }).catch(error => {
            console.error('Content: Error syncing video event:', error);
        });
    }

    setupMessageHandlers() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            switch (request.action) {
                case 'checkVideo':
                    sendResponse({ 
                        videoDetected: this.videoElements.size > 0,
                        videoCount: this.videoElements.size
                    });
                    break;
                    
                case 'videoSync':
                    this.handleVideoSync(request.data);
                    sendResponse({ success: true });
                    break;
                    
                case 'setHost':
                    this.isHost = request.isHost;
                    this.roomId = request.roomId;
                    if (this.chatOverlay) {
                        this.chatOverlay.setRoomId(request.roomId);
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'showChat':
                    if (this.chatOverlay) {
                        this.chatOverlay.show();
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'roomUpdate':
                    this.handleRoomUpdate(request.data);
                    sendResponse({ success: true });
                    break;
                    
                case 'participantUpdate':
                    this.handleParticipantUpdate(request.data);
                    sendResponse({ success: true });
                    break;
                    
                case 'hideChat':
                    if (this.chatOverlay) {
                        this.chatOverlay.hide();
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'setWebSocket':
                    this.ws = request.ws;
                    if (this.chatOverlay) {
                        this.chatOverlay.setWebSocket(request.ws);
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'chatMessage':
                    if (this.chatOverlay) {
                        this.chatOverlay.addMessage(request.data);
                    }
                    sendResponse({ success: true });
                    break;
                    
                case 'getVideoInfo':
                    const videoInfo = this.getCurrentVideoInfo();
                    sendResponse(videoInfo);
                    break;
                    
                default:
                    sendResponse({ error: 'Unknown action' });
            }
        });
    }

    handleVideoSync(data) {
        const video = this.findVideoById(data.videoId) || this.currentVideo || Array.from(this.videoElements)[0];
        if (!video) return;

        // Check if we're on the same platform (skip check for web-client origin)
        if (data.platform && data.platform !== this.getCurrentPlatform() && data.source !== 'web-client') {
            console.warn('Platform mismatch, skipping sync');
            return;
        }

        // State-based apply. The server broadcasts the desired video *state*
        // (paused, currentTime, volume, playbackRate) rather than an event type,
        // so we reconcile our element to that state — mirroring the web client.
        //
        // IMPORTANT: only arm the echo guard when we actually CHANGE the video.
        // The server also echoes our own broadcasts back to us; applying a
        // no-op self-echo must NOT arm the guard, or it would suppress our next
        // genuine action (e.g. a pause issued right after we played).
        let changed = false;
        try {
            if (typeof data.currentTime === 'number' && isFinite(data.currentTime)) {
                if (Math.abs(video.currentTime - data.currentTime) > 0.75) {
                    try { video.currentTime = data.currentTime; changed = true; } catch (e) { /* non-seekable stream */ }
                }
            }

            if (typeof data.paused === 'boolean') {
                if (data.paused && !video.paused) {
                    video.pause();
                    changed = true;
                } else if (!data.paused && video.paused) {
                    video.play().catch(() => { /* autoplay/stream restrictions */ });
                    changed = true;
                }
            }

            if (typeof data.volume === 'number' && Math.abs(video.volume - data.volume) > 0.05) {
                video.volume = data.volume;
                changed = true;
            }

            if (typeof data.playbackRate === 'number' && data.playbackRate > 0 &&
                video.playbackRate !== data.playbackRate) {
                video.playbackRate = data.playbackRate;
                changed = true;
            }

            if (changed) {
                // Suppress the local media events our apply will trigger.
                this._applyingRemoteUntil = Date.now() + 500;
                this.updateSyncStatus('synced');
            }
        } catch (error) {
            console.error('Error applying video sync:', error);
            this.updateSyncStatus('error');
        }
    }

    findVideoById(videoId) {
        for (const video of this.videoElements) {
            if (this.getVideoId(video) === videoId) {
                return video;
            }
        }
        return null;
    }

    getCurrentVideoInfo() {
        const videos = Array.from(this.videoElements);
        const activeVideo = videos.find(v => !v.paused) || videos[0];
        
        if (!activeVideo) {
            return { videoDetected: false };
        }
        
        return {
            videoDetected: true,
            videoCount: videos.length,
            currentVideo: {
                id: this.getVideoId(activeVideo),
                currentTime: activeVideo.currentTime,
                duration: activeVideo.duration,
                paused: activeVideo.paused,
                volume: activeVideo.volume,
                playbackRate: activeVideo.playbackRate,
                src: activeVideo.src || activeVideo.currentSrc
            }
        };
    }

    notifyVideoDetection() {
        chrome.runtime.sendMessage({
            action: 'videoDetected',
            data: {
                videoCount: this.videoElements.size,
                url: window.location.href
            }
        }).catch(error => {
            console.error('Content: Error notifying video detection:', error);
        });
    }

    createOverlay() {
        // Create overlay container
        const overlay = document.createElement('div');
        overlay.id = 'cinewatchbuddy-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 300px;
            max-height: 400px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            border-radius: 8px;
            padding: 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            z-index: 10000;
            display: none;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        `;
        
        overlay.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h3 style="margin: 0; font-size: 16px;">🎬 CineWatchBuddy</h3>
                <button id="cinewatchbuddy-close" style="background: none; border: none; color: white; cursor: pointer; font-size: 18px;">×</button>
            </div>
            <div id="cinewatchbuddy-content">
                <div id="cinewatchbuddy-status">Not connected</div>
                <div id="cinewatchbuddy-participants"></div>
                <div id="cinewatchbuddy-chat"></div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Close button handler
        document.getElementById('cinewatchbuddy-close').addEventListener('click', () => {
            overlay.style.display = 'none';
        });
        
        // Show overlay when videos are detected
        if (this.videoElements.size > 0) {
            overlay.style.display = 'block';
        }
    }

    updateOverlay(data) {
        const overlay = document.getElementById('cinewatchbuddy-overlay');
        if (!overlay) return;
        
        const statusEl = document.getElementById('cinewatchbuddy-status');
        const participantsEl = document.getElementById('cinewatchbuddy-participants');
        
        if (statusEl) {
            statusEl.textContent = data.status || 'Connected';
        }
        
        if (participantsEl && data.participants) {
            participantsEl.innerHTML = `
                <div style="margin-top: 8px;">
                    <strong>Participants (${data.participants.length}/15):</strong>
                    <ul style="margin: 4px 0; padding-left: 16px;">
                        ${data.participants.map(p => `<li>${p.username}${p.isHost ? ' 👑' : ''}</li>`).join('')}
                    </ul>
                </div>
            `;
        }
    }

    async checkRoomStatus() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getConnectionStatus' });
            if (response && response.currentRoom) {
                // currentRoom is a roomId string from background
                this.roomId = response.currentRoom;
                this.currentRoom = { id: this.roomId };
                this.isHost = false;
                this.updateSyncStatus('ready');
                
                // Phase 3: Notify web client that extension is ready
                this.notifyWebClientReady();
            }
        } catch (error) {
            console.error('Error checking room status:', error);
        }
    }

    // Phase 3: Notify web client that extension is ready for DRM sync
    notifyWebClientReady() {
        // Send message to all tabs that might be the web client
        chrome.runtime.sendMessage({
            action: 'extensionReady',
            data: {
                roomId: this.roomId,
                site: window.location.hostname,
                videoDetected: this.videoElements.size > 0
            }
        });
    }

    handleRoomUpdate(roomData) {
        this.currentRoom = roomData;
        this.roomId = roomData?.id || this.roomId;
        if (!this.currentVideo) {
            this.currentVideo = Array.from(this.videoElements)[0] || null;
        }
        this.updateSyncStatus('ready');
    }

    handleParticipantUpdate(participants) {
        if (this.currentRoom) {
            this.currentRoom.participants = participants;
        }
        this.updateSyncStatus('ready');
    }
}

// Initialize content script
new CineBuddyContentScript();
