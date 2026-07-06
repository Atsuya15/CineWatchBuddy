import React, { useState, useEffect, useRef } from 'react'

const ExtensionIntegrationEnhanced = ({ roomId, username, onConnectionChange }) => {
  const [isExtensionAvailable, setIsExtensionAvailable] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [bridgeVersion, setBridgeVersion] = useState(null)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [lastError, setLastError] = useState(null)
  const [stats, setStats] = useState(null)
  
  const messageHandlers = useRef(new Map())
  const pendingRequests = useRef(new Map())
  const heartbeatInterval = useRef(null)
  const reconnectTimeout = useRef(null)
  const requestId = useRef(0)

  // Message types
  const MESSAGE_TYPES = {
    PING: 'ping',
    PONG: 'pong',
    BRIDGE_READY: 'bridgeReady',
    WEB_APP_READY: 'webAppReady',
    RESPONSE: 'response',
    ERROR: 'error',
    EXTENSION_READY: 'extensionReady',
    ROOM_JOIN: 'joinRoom',
    VIDEO_SYNC: 'videoSync',
    CHAT_MESSAGE: 'chatMessage',
    WEBRTC_OFFER: 'webrtcOffer',
    WEBRTC_ANSWER: 'webrtcAnswer',
    WEBRTC_ICE_CANDIDATE: 'webrtcIceCandidate'
  }

  useEffect(() => {
    // Set up message listeners
    setupMessageListeners()
    
    // Check for extension availability
    checkExtensionAvailability()
    
    // Start heartbeat
    startHeartbeat()
    
    // Cleanup
    return () => {
      cleanup()
    }
  }, [])

  // Set up message listeners
  const setupMessageListeners = () => {
    const handleMessage = (event) => {
      if (event.data?.source !== 'cinebuddy-extension') return
      
      const { action, payload, correlationId, error } = event.data
      
      switch (action) {
        case MESSAGE_TYPES.BRIDGE_READY:
          handleBridgeReady(payload)
          break
        case MESSAGE_TYPES.PONG:
          handlePong(payload)
          break
        case MESSAGE_TYPES.EXTENSION_READY:
          handleExtensionReady(payload)
          break
        case MESSAGE_TYPES.RESPONSE:
          handleResponse(payload, correlationId)
          break
        case MESSAGE_TYPES.ERROR:
          handleError(payload, correlationId)
          break
        default:
          // Handle custom message types
          const handler = messageHandlers.current.get(action)
          if (handler) {
            handler(payload, correlationId)
          }
      }
    }

    window.addEventListener('message', handleMessage)
    
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }

  // Check extension availability
  const checkExtensionAvailability = () => {
    // Send ping to check if bridge is available
    sendMessage(MESSAGE_TYPES.PING, { timestamp: Date.now() }, 'availability-check')
      .then(() => {
        setIsExtensionAvailable(true)
        setConnectionState('connected')
        setIsConnected(true)
        onConnectionChange(true)
      })
      .catch(() => {
        setIsExtensionAvailable(false)
        setConnectionState('disconnected')
        setIsConnected(false)
        onConnectionChange(false)
        
        // Retry after 5 seconds
        setTimeout(checkExtensionAvailability, 5000)
      })
  }

  // Handle bridge ready
  const handleBridgeReady = (payload) => {
    console.log('Bridge ready:', payload)
    setBridgeVersion(payload.version)
    setIsExtensionAvailable(true)
    
    // Notify bridge that web app is ready
    sendMessage(MESSAGE_TYPES.WEB_APP_READY, {
      roomId,
      username,
      timestamp: Date.now()
    })
  }

  // Handle pong response
  const handlePong = (payload) => {
    setConnectionState('connected')
    setIsConnected(true)
    onConnectionChange(true)
    setLastError(null)
  }

  // Handle extension ready
  const handleExtensionReady = (payload) => {
    console.log('Extension ready:', payload)
    setConnectionState('connected')
    setIsConnected(true)
    onConnectionChange(true)
  }

  // Handle response
  const handleResponse = (payload, correlationId) => {
    const request = pendingRequests.current.get(correlationId)
    if (request) {
      request.resolve(payload)
      pendingRequests.current.delete(correlationId)
    }
  }

  // Handle error
  const handleError = (payload, correlationId) => {
    const request = pendingRequests.current.get(correlationId)
    if (request) {
      request.reject(new Error(payload.error))
      pendingRequests.current.delete(correlationId)
    }
    
    setLastError(payload.error)
    setConnectionState('error')
  }

  // Send message to extension
  const sendMessage = (action, payload, correlationId) => {
    return new Promise((resolve, reject) => {
      const id = correlationId || `msg_${++requestId.current}_${Date.now()}`
      
      // Store request for response handling
      pendingRequests.current.set(id, { resolve, reject })
      
      // Set timeout
      setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000) // 30 second timeout
      
      // Send message
      window.postMessage({
        source: 'cinebuddy-web',
        action,
        payload,
        correlationId: id,
        timestamp: Date.now()
      }, '*')
    })
  }

  // Start heartbeat
  const startHeartbeat = () => {
    heartbeatInterval.current = setInterval(() => {
      if (isExtensionAvailable) {
        sendMessage(MESSAGE_TYPES.PING, { timestamp: Date.now() })
          .catch(() => {
            console.warn('Heartbeat failed, attempting reconnection')
            setConnectionState('reconnecting')
            setIsConnected(false)
            onConnectionChange(false)
            
            // Attempt reconnection
            if (reconnectTimeout.current) {
              clearTimeout(reconnectTimeout.current)
            }
            
            reconnectTimeout.current = setTimeout(() => {
              checkExtensionAvailability()
            }, 5000)
          })
      }
    }, 30000) // Send ping every 30 seconds
  }

  // Join room
  const joinRoom = (roomId, username) => {
    return sendMessage(MESSAGE_TYPES.ROOM_JOIN, {
      roomId,
      username,
      timestamp: Date.now()
    })
  }

  // Send video sync
  const sendVideoSync = (data) => {
    return sendMessage(MESSAGE_TYPES.VIDEO_SYNC, {
      ...data,
      roomId,
      timestamp: Date.now()
    })
  }

  // Send chat message
  const sendChatMessage = (data) => {
    return sendMessage(MESSAGE_TYPES.CHAT_MESSAGE, {
      ...data,
      roomId,
      timestamp: Date.now()
    })
  }

  // Send WebRTC offer
  const sendWebRTCOffer = (data) => {
    return sendMessage(MESSAGE_TYPES.WEBRTC_OFFER, {
      ...data,
      roomId,
      timestamp: Date.now()
    })
  }

  // Send WebRTC answer
  const sendWebRTCAnswer = (data) => {
    return sendMessage(MESSAGE_TYPES.WEBRTC_ANSWER, {
      ...data,
      roomId,
      timestamp: Date.now()
    })
  }

  // Send WebRTC ICE candidate
  const sendWebRTCIceCandidate = (data) => {
    return sendMessage(MESSAGE_TYPES.WEBRTC_ICE_CANDIDATE, {
      ...data,
      roomId,
      timestamp: Date.now()
    })
  }

  // Register message handler
  const onMessage = (messageType, handler) => {
    messageHandlers.current.set(messageType, handler)
  }

  // Unregister message handler
  const offMessage = (messageType) => {
    messageHandlers.current.delete(messageType)
  }

  // Get bridge stats
  const getStats = () => {
    if (window.cinebuddyBridge) {
      return window.cinebuddyBridge.getStats()
    }
    return null
  }

  // Update stats
  useEffect(() => {
    if (isExtensionAvailable) {
      const updateStats = () => {
        const newStats = getStats()
        if (newStats) {
          setStats(newStats)
        }
      }
      
      updateStats()
      const interval = setInterval(updateStats, 5000)
      
      return () => clearInterval(interval)
    }
  }, [isExtensionAvailable])

  // Cleanup
  const cleanup = () => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current)
      heartbeatInterval.current = null
    }
    
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }
    
    // Clear pending requests
    pendingRequests.current.clear()
  }

  // Get connection status color
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-500'
      case 'connecting': return 'bg-yellow-500'
      case 'reconnecting': return 'bg-orange-500'
      case 'error': return 'bg-red-500'
      case 'disconnected': return 'bg-gray-500'
      default: return 'bg-gray-500'
    }
  }

  // Get connection status text
  const getConnectionStatusText = () => {
    switch (connectionState) {
      case 'connected': return 'Extension Connected'
      case 'connecting': return 'Connecting...'
      case 'reconnecting': return 'Reconnecting...'
      case 'error': return 'Connection Error'
      case 'disconnected': return 'Extension Disconnected'
      default: return 'Unknown'
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold">Extension Integration</h3>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()}`}></div>
          <span className="text-sm text-gray-300">{getConnectionStatusText()}</span>
        </div>
      </div>

      {isExtensionAvailable ? (
        <div className="space-y-2">
          <div className="text-sm text-gray-300">
            Bridge Version: {bridgeVersion || 'Unknown'}
          </div>
          
          {stats && (
            <div className="text-xs text-gray-400">
              Queue: {stats.queueSize} | Last Heartbeat: {new Date(stats.lastHeartbeat).toLocaleTimeString()}
            </div>
          )}
          
          {lastError && (
            <div className="text-xs text-red-400">
              Error: {lastError}
            </div>
          )}
          
          <div className="text-sm text-green-400">
            ✓ Extension is ready for DRM content sync
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-yellow-400">
            ⚠ Extension not detected
          </div>
          <div className="text-xs text-gray-400">
            Install the CineBuddy extension to sync with DRM content (Netflix, Disney+, etc.)
          </div>
        </div>
      )}
    </div>
  )
}

export default ExtensionIntegrationEnhanced
