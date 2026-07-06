// CineWatchBuddy Configuration Manager
class ConfigManager {
    constructor() {
        this.defaultConfig = {
            backendUrl: 'ws://localhost:8080/ws',
            httpUrl: 'http://localhost:8080',
            reconnectAttempts: 5,
            reconnectDelay: 3000,
            maxReconnectDelay: 15000,
            videoSyncThrottle: 100, // ms
            maxVideoSyncPerSecond: 5,
            chatHistoryLimit: 100,
            mutationObserverDebounce: 500 // ms
        };
        
        this.config = { ...this.defaultConfig };
        this.init();
    }

    async init() {
        await this.loadConfig();
        await this.loadEnvironmentConfig();
    }

    async loadConfig() {
        try {
            const result = await chrome.storage.local.get(['cinebuddyConfig']);
            if (result.cinebuddyConfig) {
                this.config = { ...this.defaultConfig, ...result.cinebuddyConfig };
            }
        } catch (error) {
            console.error('Error loading config:', error);
        }
    }

    async loadEnvironmentConfig() {
        // Check for environment-specific overrides
        const hostname = window.location.hostname;
        
        // Production overrides
        if (hostname === 'cinewatchbuddy.app' || hostname.includes('cinewatchbuddy')) {
            this.config.backendUrl = 'wss://api.cinewatchbuddy.app/ws';
            this.config.httpUrl = 'https://api.cinewatchbuddy.app';
        }
        // Staging overrides
        else if (hostname.includes('staging')) {
            this.config.backendUrl = 'wss://staging-api.cinewatchbuddy.app/ws';
            this.config.httpUrl = 'https://staging-api.cinewatchbuddy.app';
        }
    }

    async updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        try {
            await chrome.storage.local.set({ cinebuddyConfig: this.config });
        } catch (error) {
            console.error('Error saving config:', error);
        }
    }

    get(key) {
        return this.config[key];
    }

    getAll() {
        return { ...this.config };
    }

    // Helper methods for common configs
    getBackendUrl() {
        return this.config.backendUrl;
    }

    getHttpUrl() {
        return this.config.httpUrl;
    }

    isSecureConnection() {
        return this.config.backendUrl.startsWith('wss://');
    }

    getReconnectConfig() {
        return {
            attempts: this.config.reconnectAttempts,
            delay: this.config.reconnectDelay,
            maxDelay: this.config.maxReconnectDelay
        };
    }
}

// Global config instance
window.CineBuddyConfig = new ConfigManager();
