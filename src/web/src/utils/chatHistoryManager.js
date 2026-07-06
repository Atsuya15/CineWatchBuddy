// Chat History Manager for persistent chat and room history
class ChatHistoryManager {
  constructor(connectionManager) {
    this.connectionManager = connectionManager
    this.currentRoomId = null
    this.chatHistory = []
    this.maxHistorySize = 1000
    this.storageKey = 'cinebuddy_chat_history'
    this.listeners = new Map()
    
    this.setupEventListeners()
    this.loadStoredHistory()
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
        console.error('Error in chat history event listener:', error)
      }
    })
  }

  // Set up event listeners
  setupEventListeners() {
    // Listen for room joined events
    this.connectionManager.on('roomJoined', (data) => {
      this.handleRoomJoined(data)
    })

    // Listen for chat messages
    this.connectionManager.on('chatMessage', (data) => {
      this.handleChatMessage(data)
    })

    // Listen for participant events
    this.connectionManager.on('participantJoined', (data) => {
      this.handleParticipantJoined(data)
    })

    this.connectionManager.on('participantLeft', (data) => {
      this.handleParticipantLeft(data)
    })
  }

  // Handle room joined
  handleRoomJoined(data) {
    this.currentRoomId = data.room?.id
    this.chatHistory = data.chatHistory || []
    
    // Emit loaded history
    this.emit('historyLoaded', {
      roomId: this.currentRoomId,
      messages: this.chatHistory
    })
    
    // Store in localStorage
    this.storeHistory()
  }

  // Handle chat message
  handleChatMessage(data) {
    const message = {
      id: data.id || Date.now() + Math.random(),
      roomId: this.currentRoomId,
      username: data.username,
      content: data.content,
      type: data.type || 'user',
      timestamp: data.timestamp || Date.now(),
      reactions: data.reactions || []
    }

    this.chatHistory.push(message)
    
    // Limit history size
    if (this.chatHistory.length > this.maxHistorySize) {
      this.chatHistory = this.chatHistory.slice(-this.maxHistorySize)
    }

    // Store in localStorage
    this.storeHistory()

    // Emit new message
    this.emit('newMessage', message)
  }

  // Handle participant joined
  handleParticipantJoined(data) {
    const systemMessage = {
      id: `system_join_${Date.now()}`,
      roomId: this.currentRoomId,
      username: 'System',
      content: `${data.participant.username} joined the room`,
      type: 'system',
      timestamp: Date.now(),
      reactions: []
    }

    this.chatHistory.push(systemMessage)
    this.storeHistory()
    this.emit('newMessage', systemMessage)
  }

  // Handle participant left
  handleParticipantLeft(data) {
    const systemMessage = {
      id: `system_leave_${Date.now()}`,
      roomId: this.currentRoomId,
      username: 'System',
      content: `A participant left the room`,
      type: 'system',
      timestamp: Date.now(),
      reactions: []
    }

    this.chatHistory.push(systemMessage)
    this.storeHistory()
    this.emit('newMessage', systemMessage)
  }

  // Store history in localStorage
  storeHistory() {
    if (!this.currentRoomId) return

    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      stored[this.currentRoomId] = {
        messages: this.chatHistory,
        lastUpdated: Date.now()
      }
      
      localStorage.setItem(this.storageKey, JSON.stringify(stored))
    } catch (error) {
      console.error('Failed to store chat history:', error)
    }
  }

  // Load stored history
  loadStoredHistory() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      
      // Clean up old entries (older than 7 days)
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000)
      const cleaned = {}
      
      for (const [roomId, data] of Object.entries(stored)) {
        if (data.lastUpdated > sevenDaysAgo) {
          cleaned[roomId] = data
        }
      }
      
      if (Object.keys(cleaned).length !== Object.keys(stored).length) {
        localStorage.setItem(this.storageKey, JSON.stringify(cleaned))
      }
      
      this.emit('storedHistoryLoaded', cleaned)
    } catch (error) {
      console.error('Failed to load stored history:', error)
    }
  }

  // Get history for a specific room
  getRoomHistory(roomId) {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      return stored[roomId]?.messages || []
    } catch (error) {
      console.error('Failed to get room history:', error)
      return []
    }
  }

  // Get all stored room IDs
  getStoredRoomIds() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      return Object.keys(stored)
    } catch (error) {
      console.error('Failed to get stored room IDs:', error)
      return []
    }
  }

  // Clear history for a specific room
  clearRoomHistory(roomId) {
    try {
      const stored = JSON.parse(localStorage.getItem(this.storageKey) || '{}')
      delete stored[roomId]
      localStorage.setItem(this.storageKey, JSON.stringify(stored))
      
      if (roomId === this.currentRoomId) {
        this.chatHistory = []
      }
      
      this.emit('roomHistoryCleared', { roomId })
    } catch (error) {
      console.error('Failed to clear room history:', error)
    }
  }

  // Clear all history
  clearAllHistory() {
    try {
      localStorage.removeItem(this.storageKey)
      this.chatHistory = []
      this.emit('allHistoryCleared')
    } catch (error) {
      console.error('Failed to clear all history:', error)
    }
  }

  // Search messages
  searchMessages(query, roomId = null) {
    const searchRoomId = roomId || this.currentRoomId
    if (!searchRoomId) return []

    const messages = this.getRoomHistory(searchRoomId)
    const lowercaseQuery = query.toLowerCase()

    return messages.filter(message => 
      message.content.toLowerCase().includes(lowercaseQuery) ||
      message.username.toLowerCase().includes(lowercaseQuery)
    )
  }

  // Get message statistics
  getMessageStats(roomId = null) {
    const searchRoomId = roomId || this.currentRoomId
    if (!searchRoomId) return null

    const messages = this.getRoomHistory(searchRoomId)
    const stats = {
      totalMessages: messages.length,
      userMessages: messages.filter(m => m.type === 'user').length,
      systemMessages: messages.filter(m => m.type === 'system').length,
      uniqueUsers: new Set(messages.map(m => m.username)).size,
      timeRange: {
        first: messages.length > 0 ? Math.min(...messages.map(m => m.timestamp)) : null,
        last: messages.length > 0 ? Math.max(...messages.map(m => m.timestamp)) : null
      }
    }

    return stats
  }

  // Export history for a room
  exportRoomHistory(roomId = null) {
    const searchRoomId = roomId || this.currentRoomId
    if (!searchRoomId) return null

    const messages = this.getRoomHistory(searchRoomId)
    const exportData = {
      roomId: searchRoomId,
      exportedAt: Date.now(),
      messageCount: messages.length,
      messages: messages.map(message => ({
        ...message,
        date: new Date(message.timestamp).toISOString()
      }))
    }

    return exportData
  }

  // Get current chat history
  getCurrentHistory() {
    return [...this.chatHistory]
  }

  // Get current room ID
  getCurrentRoomId() {
    return this.currentRoomId
  }

  // Add reaction to message
  addReaction(messageId, emoji, username) {
    const message = this.chatHistory.find(m => m.id === messageId)
    if (!message) return false

    if (!message.reactions) {
      message.reactions = []
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(r => r.emoji === emoji && r.username === username)
    if (existingReaction) {
      // Remove reaction
      message.reactions = message.reactions.filter(r => r !== existingReaction)
    } else {
      // Add reaction
      message.reactions.push({
        emoji,
        username,
        timestamp: Date.now()
      })
    }

    this.storeHistory()
    this.emit('reactionUpdated', { messageId, message })
    return true
  }

  // Cleanup
  destroy() {
    this.listeners.clear()
    this.chatHistory = []
    this.currentRoomId = null
  }
}

export default ChatHistoryManager
