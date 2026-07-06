// Shared WebSocket connection manager for all components
class WebSocketManager {
  constructor() {
    this.ws = null
    this.roomId = null
    this.username = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 1000
    this.isConnecting = false
  }

  connect(roomId, username) {
    // Reuse the existing socket if it's already open or in the middle of
    // connecting for the same room (multiple components share this singleton).
    if (this.ws && this.roomId === roomId &&
        (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('WebSocket already connected/connecting for room:', roomId)
      return this.connectPromise || Promise.resolve()
    }

    this.roomId = roomId
    this.username = username
    this.isConnecting = true

    this.connectPromise = new Promise((resolve, reject) => {
      try {
        // [TUNNEL] Use the current page origin so this works behind Cloudflare
        // Tunnel (https -> wss) and any reverse proxy, as well as locally.
        // Revert to `ws://localhost:8080/ws` for the original direct-to-backend setup.
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${wsProto}//${window.location.host}/ws?room=${roomId}&user=${encodeURIComponent(username)}`
        console.log('Attempting to connect to WebSocket:', wsUrl)
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          console.log('✅ WebSocket connected successfully to room:', roomId, 'user:', username)
          this.isConnecting = false
          this.reconnectAttempts = 0
          this.reconnectDelay = 1000
          // Register as a room participant. This is what makes the server emit
          // room-joined (chat history, participant list, video state) and
          // broadcast participant-joined/left to everyone else.
          this.send('join-room', { roomId, username })
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            console.log('WebSocket message received:', data)
            // Dispatch to all components via custom event
            window.dispatchEvent(new CustomEvent('cinewatchbuddy-message', {
              detail: data
            }))
          } catch (err) {
            console.error('Error parsing WebSocket message:', err)
          }
        }

        this.ws.onclose = (event) => {
          console.log('❌ WebSocket disconnected:', event.code, event.reason)
          this.isConnecting = false
          this.scheduleReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error)
          this.isConnecting = false
          reject(error)
        }

      } catch (error) {
        console.error('Failed to create WebSocket:', error)
        this.isConnecting = false
        reject(error)
      }
    })

    return this.connectPromise
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000)
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(() => {
      if (this.roomId && this.username) {
        this.connect(this.roomId, this.username).catch(console.error)
      }
    }, delay)
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { type, data }
      console.log('WebSocket sending:', message)
      this.ws.send(JSON.stringify(message))
      return true
    }
    console.warn('WebSocket not connected, cannot send:', { type, data })
    return false
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.roomId = null
    this.username = null
    this.reconnectAttempts = 0
    this.connectPromise = null
  }
}

// Export singleton instance
export const websocketManager = new WebSocketManager()
export default WebSocketManager
