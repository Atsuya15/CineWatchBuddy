import React, { useState, useEffect } from 'react'

const ExtensionIntegration = ({ roomId, username, onExtensionReady, onVideoSync, onChatMessage }) => {
  const [extensionAvailable, setExtensionAvailable] = useState(false)
  const [extensionConnected, setExtensionConnected] = useState(false)
  const [extensionSite, setExtensionSite] = useState('')

  useEffect(() => {
    // Check if CineBuddy extension is available
    checkExtensionAvailability()
    
    // Listen for extension messages
    const handleMessage = (event) => {
      if (event.data && event.data.source === 'cinebuddy-extension' && event.data.action) {
        switch (event.data.action) {
          case 'extensionReady':
            handleExtensionReady(event.data.payload)
            break
          case 'videoSync':
            if (onVideoSync) {
              onVideoSync(event.data.payload)
            }
            break
          case 'chatMessage':
            if (onChatMessage) {
              onChatMessage(event.data.payload)
            }
            break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [roomId, username])

  const checkExtensionAvailability = async () => {
    // Bridge relies on content script; assume available after bridgeReady
    setExtensionAvailable(true)
  }

  const sendMessageToExtension = (message) => {
    return new Promise((resolve) => {
      const correlationId = `${Date.now()}-${Math.random()}`
      const listener = (event) => {
        if (!event.data || event.data.source !== 'cinebuddy-extension') return
        if (event.data.correlationId !== correlationId) return
        window.removeEventListener('message', listener)
        resolve(event.data.payload)
      }
      window.addEventListener('message', listener)
      window.postMessage({ source: 'cinebuddy-web', correlationId, payload: message }, '*')
    })
  }

  const joinExtensionRoom = async (roomId, username) => {
    try {
      const response = await sendMessageToExtension({
        action: 'webClientJoinRoom',
        roomId: roomId,
        username: username
      })
      
      if (response.success) {
        setExtensionConnected(true)
        onExtensionReady && onExtensionReady({
          roomId: roomId,
          site: 'extension',
          connected: true
        })
      }
    } catch (error) {
      console.error('Error joining extension room:', error)
    }
  }

  const handleExtensionReady = (data) => {
    setExtensionConnected(true)
    setExtensionSite(data.site)
    onExtensionReady && onExtensionReady(data)
  }

  const sendVideoSyncToExtension = (videoData) => {
    if (extensionConnected) {
      sendMessageToExtension({
        action: 'webClientVideoSync',
        data: videoData
      }).catch(console.error)
    }
  }

  const sendChatMessageToExtension = (messageData) => {
    if (extensionConnected) {
      sendMessageToExtension({
        action: 'webClientChatMessage',
        data: messageData
      }).catch(console.error)
    }
  }

  // Expose methods to parent component
  useEffect(() => {
    if (onVideoSync) {
      // Override the parent's video sync to also send to extension
      const originalOnVideoSync = onVideoSync
      onVideoSync = (data) => {
        originalOnVideoSync(data)
        sendVideoSyncToExtension(data)
      }
    }
  }, [extensionConnected, onVideoSync])

  useEffect(() => {
    if (onChatMessage) {
      // Override the parent's chat message to also send to extension
      const originalOnChatMessage = onChatMessage
      onChatMessage = (data) => {
        originalOnChatMessage(data)
        sendChatMessageToExtension(data)
      }
    }
  }, [extensionConnected, onChatMessage])

  if (!extensionAvailable) {
    return (
      <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <div className="text-blue-400 text-sm">💡</div>
          <div className="text-sm">
            <p className="text-blue-300 font-medium mb-1">Want to watch Netflix, Disney+, or Prime Video?</p>
            <p className="text-blue-400 text-xs">
              Install our Chrome extension for DRM-protected content!
            </p>
            <a 
              href="#" 
              className="text-blue-400 hover:text-blue-300 text-xs underline mt-1 inline-block"
              onClick={(e) => {
                e.preventDefault()
                // Open extension installation page
                window.open('https://chrome.google.com/webstore', '_blank')
              }}
            >
              Install Extension
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        <span className="text-green-300 text-sm font-medium">
          Extension Connected
        </span>
        {extensionSite && (
          <span className="text-green-400 text-xs">
            ({extensionSite})
          </span>
        )}
      </div>
    </div>
  )
}

export default ExtensionIntegration
