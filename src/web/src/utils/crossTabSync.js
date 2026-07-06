// Cross-Tab Synchronization Manager
class CrossTabSync {
  constructor() {
    this.channel = null
    this.storageKey = 'cinebuddy_session'
    this.listeners = new Map()
    this.isMaster = false
    this.tabId = this.generateTabId()
    this.lastHeartbeat = Date.now()
    this.heartbeatInterval = null
    this.heartbeatTimeout = 10000 // 10 seconds
    this.sessionData = null
    
    this.init()
  }

  generateTabId() {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  init() {
    // Initialize BroadcastChannel if supported
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('cinebuddy_sync')
      this.channel.onmessage = (event) => this.handleMessage(event.data)
    }

    // Listen for storage changes
    window.addEventListener('storage', (event) => {
      if (event.key === this.storageKey) {
        this.handleStorageChange(event)
      }
    })

    // Start heartbeat
    this.startHeartbeat()

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      this.cleanup()
    })

    // Load existing session
    this.loadSession()
  }

  // Event listener management
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return
    const callbacks = this.listeners.get(event)
    const index = callbacks.indexOf(callback)
    if (index > -1) {
      callbacks.splice(index, 1)
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data)
      } catch (error) {
        console.error('Error in cross-tab event listener:', error)
      }
    })
  }

  // Session management
  loadSession() {
    try {
      const stored = localStorage.getItem(this.storageKey)
      if (stored) {
        this.sessionData = JSON.parse(stored)
        this.emit('sessionLoaded', this.sessionData)
      }
    } catch (error) {
      console.error('Failed to load session:', error)
    }
  }

  saveSession(data) {
    try {
      this.sessionData = {
        ...data,
        tabId: this.tabId,
        lastUpdated: Date.now()
      }
      localStorage.setItem(this.storageKey, JSON.stringify(this.sessionData))
      this.broadcast('sessionUpdated', this.sessionData)
    } catch (error) {
      console.error('Failed to save session:', error)
    }
  }

  clearSession() {
    try {
      localStorage.removeItem(this.storageKey)
      this.sessionData = null
      this.broadcast('sessionCleared', { tabId: this.tabId })
    } catch (error) {
      console.error('Failed to clear session:', error)
    }
  }

  // Message handling
  handleMessage(data) {
    if (data.tabId === this.tabId) return // Ignore own messages

    switch (data.type) {
      case 'sessionUpdated':
        this.handleSessionUpdate(data.payload)
        break
      case 'sessionCleared':
        this.handleSessionCleared(data.payload)
        break
      case 'videoSync':
        this.handleVideoSync(data.payload)
        break
      case 'chatMessage':
        this.handleChatMessage(data.payload)
        break
      case 'participantUpdate':
        this.handleParticipantUpdate(data.payload)
        break
      case 'heartbeat':
        this.handleHeartbeat(data.payload)
        break
      case 'masterElection':
        this.handleMasterElection(data.payload)
        break
      default:
        console.log('Unknown cross-tab message type:', data.type)
    }
  }

  handleStorageChange(event) {
    if (event.newValue) {
      try {
        const data = JSON.parse(event.newValue)
        this.sessionData = data
        this.emit('sessionUpdated', data)
      } catch (error) {
        console.error('Failed to parse storage change:', error)
      }
    } else {
      this.sessionData = null
      this.emit('sessionCleared', {})
    }
  }

  handleSessionUpdate(data) {
    this.sessionData = data
    this.emit('sessionUpdated', data)
  }

  handleSessionCleared(data) {
    this.sessionData = null
    this.emit('sessionCleared', data)
  }

  handleVideoSync(data) {
    this.emit('videoSync', data)
  }

  handleChatMessage(data) {
    this.emit('chatMessage', data)
  }

  handleParticipantUpdate(data) {
    this.emit('participantUpdate', data)
  }

  handleHeartbeat(data) {
    // Update last seen for this tab
    if (this.sessionData && this.sessionData.tabs) {
      this.sessionData.tabs[data.tabId] = {
        lastSeen: Date.now(),
        isActive: true
      }
    }
  }

  handleMasterElection(data) {
    this.isMaster = data.masterTabId === this.tabId
    this.emit('masterElection', { isMaster: this.isMaster, masterTabId: data.masterTabId })
  }

  // Broadcasting
  broadcast(type, payload) {
    const message = {
      type,
      payload,
      tabId: this.tabId,
      timestamp: Date.now()
    }

    // Broadcast via BroadcastChannel
    if (this.channel) {
      this.channel.postMessage(message)
    }

    // Also emit locally
    this.emit(type, payload)
  }

  // Specific sync methods
  syncVideoState(videoData) {
    this.broadcast('videoSync', {
      ...videoData,
      tabId: this.tabId,
      timestamp: Date.now()
    })
  }

  syncChatMessage(messageData) {
    this.broadcast('chatMessage', {
      ...messageData,
      tabId: this.tabId,
      timestamp: Date.now()
    })
  }

  syncParticipantUpdate(participantData) {
    this.broadcast('participantUpdate', {
      ...participantData,
      tabId: this.tabId,
      timestamp: Date.now()
    })
  }

  // Master election
  electMaster() {
    const tabs = this.getActiveTabs()
    if (tabs.length === 0) return

    // Find the tab with the earliest timestamp
    const masterTab = tabs.reduce((earliest, current) => 
      current.timestamp < earliest.timestamp ? current : earliest
    )

    this.isMaster = masterTab.tabId === this.tabId
    this.broadcast('masterElection', {
      masterTabId: masterTab.tabId,
      isMaster: this.isMaster
    })

    return masterTab.tabId
  }

  getActiveTabs() {
    if (!this.sessionData || !this.sessionData.tabs) return []
    
    const now = Date.now()
    const activeTabs = []
    
    for (const [tabId, tabData] of Object.entries(this.sessionData.tabs)) {
      if (now - tabData.lastSeen < this.heartbeatTimeout) {
        activeTabs.push({
          tabId,
          ...tabData
        })
      }
    }
    
    return activeTabs
  }

  // Heartbeat management
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 5000) // Send heartbeat every 5 seconds
  }

  sendHeartbeat() {
    this.lastHeartbeat = Date.now()
    
    // Update session with tab info
    if (this.sessionData) {
      if (!this.sessionData.tabs) {
        this.sessionData.tabs = {}
      }
      
      this.sessionData.tabs[this.tabId] = {
        lastSeen: this.lastHeartbeat,
        isActive: true,
        timestamp: this.sessionData.tabs[this.tabId]?.timestamp || this.lastHeartbeat
      }
      
      this.saveSession(this.sessionData)
    }

    this.broadcast('heartbeat', {
      tabId: this.tabId,
      timestamp: this.lastHeartbeat
    })
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // Utility methods
  isCurrentTabMaster() {
    return this.isMaster
  }

  getTabId() {
    return this.tabId
  }

  getSessionData() {
    return this.sessionData
  }

  // Cleanup
  cleanup() {
    this.stopHeartbeat()
    
    if (this.channel) {
      this.channel.close()
      this.channel = null
    }

    // Remove this tab from session
    if (this.sessionData && this.sessionData.tabs) {
      delete this.sessionData.tabs[this.tabId]
      this.saveSession(this.sessionData)
    }
  }
}

// Export singleton instance
export const crossTabSync = new CrossTabSync()
export default CrossTabSync
