import React, { useState, useEffect, useRef } from 'react'
import { connectionManager } from '../utils/connectionManager'
import { crossTabSync } from '../utils/crossTabSync'

const ChatPanelEnhanced = ({ roomId, username, isVisible, onToggle }) => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [typingUsers, setTypingUsers] = useState(new Set())
  const [connectionState, setConnectionState] = useState('disconnected')
  const [unreadCount, setUnreadCount] = useState(0)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const typingTimeout = useRef(null)
  const isFocused = useRef(false)

  // Emoji picker data
  const emojiCategories = {
    'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳'],
    'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
    'Gestures': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '👏', '🙌', '👐', '🤲', '🤜', '🤛'],
    'Objects': ['🎉', '🎊', '🎈', '🎁', '🎀', '🎂', '🍰', '🧁', '🍭', '🍬', '🍫', '🍩', '🍪', '🍨', '🍧', '🍦', '🍰', '🎂']
  }

  useEffect(() => {
    if (!isVisible) return

    // Set up event listeners
    const handleChatMessage = (data) => {
      const message = {
        id: data.id || Date.now() + Math.random(),
        username: data.username,
        content: data.content,
        type: data.type || 'user',
        timestamp: data.timestamp || Date.now(),
        reactions: data.reactions || []
      }
      
      setMessages(prev => [...prev, message])
      
      // Auto-scroll to bottom
      setTimeout(() => {
        scrollToBottom()
      }, 100)
      
      // Update unread count if not focused
      if (!isFocused.current) {
        setUnreadCount(prev => prev + 1)
      }
    }

    const handleTypingStart = (data) => {
      if (data.username !== username) {
        setTypingUsers(prev => new Set([...prev, data.username]))
      }
    }

    const handleTypingStop = (data) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev)
        newSet.delete(data.username)
        return newSet
      })
    }

    const handleConnectionStateChange = (state) => {
      setConnectionState(state)
    }

    // Register listeners
    connectionManager.on('chatMessage', handleChatMessage)
    crossTabSync.on('typingStart', handleTypingStart)
    crossTabSync.on('typingStop', handleTypingStop)
    connectionManager.on('connectionStateChanged', handleConnectionStateChange)

    // Focus input when panel becomes visible
    if (inputRef.current) {
      inputRef.current.focus()
    }

    // Cleanup
    return () => {
      connectionManager.off('chatMessage', handleChatMessage)
      crossTabSync.off('typingStart', handleTypingStart)
      crossTabSync.off('typingStop', handleTypingStop)
      connectionManager.off('connectionStateChanged', handleConnectionStateChange)
    }
  }, [isVisible, username])

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // Handle input focus/blur
  const handleFocus = () => {
    isFocused.current = true
    setUnreadCount(0)
  }

  const handleBlur = () => {
    isFocused.current = false
  }

  // Handle typing
  const handleInputChange = (e) => {
    const value = e.target.value
    setNewMessage(value)

    // Send typing indicator
    if (value.length > 0 && !isTyping) {
      setIsTyping(true)
      crossTabSync.syncChatMessage({
        type: 'typingStart',
        username,
        roomId
      })
    } else if (value.length === 0 && isTyping) {
      setIsTyping(false)
      crossTabSync.syncChatMessage({
        type: 'typingStop',
        username,
        roomId
      })
    }

    // Clear typing timeout
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current)
    }

    // Set timeout to stop typing indicator
    typingTimeout.current = setTimeout(() => {
      if (isTyping) {
        setIsTyping(false)
        crossTabSync.syncChatMessage({
          type: 'typingStop',
          username,
          roomId
        })
      }
    }, 2000)
  }

  // Handle message send
  const handleSendMessage = (e) => {
    e.preventDefault()
    
    if (newMessage.trim() === '') return

    const messageData = {
      id: Date.now() + Math.random(),
      username,
      content: newMessage.trim(),
      type: 'user',
      timestamp: Date.now(),
      roomId
    }

    // Send via connection manager
    connectionManager.sendChatMessage(messageData)
    
    // Also sync across tabs
    crossTabSync.syncChatMessage(messageData)

    setNewMessage('')
    setIsTyping(false)

    // Clear typing timeout
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current)
    }
  }

  // Handle emoji selection
  const handleEmojiSelect = (emoji) => {
    setNewMessage(prev => prev + emoji)
    setShowEmojiPicker(false)
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }

  // Handle key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage(e)
    }
  }

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now - date

    if (diff < 60000) { // Less than 1 minute
      return 'Just now'
    } else if (diff < 3600000) { // Less than 1 hour
      return `${Math.floor(diff / 60000)}m ago`
    } else if (diff < 86400000) { // Less than 1 day
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else {
      return date.toLocaleDateString()
    }
  }

  // Get connection status color
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-500'
      case 'connecting': return 'bg-yellow-500'
      case 'reconnecting': return 'bg-orange-500'
      case 'disconnected': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  if (!isVisible) return null

  return (
    <div className={`fixed bottom-4 right-4 w-80 bg-gray-900 rounded-lg shadow-2xl z-50 transition-all duration-300 ${isMinimized ? 'h-12' : 'h-96'}`}>
      
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()}`}></div>
          <span className="text-white font-semibold">Chat</span>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1">
              {unreadCount}
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {isMinimized ? '📈' : '📉'}
          </button>
          <button
            onClick={onToggle}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-64">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.username === username ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs px-3 py-2 rounded-lg ${
                  message.username === username 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-100'
                }`}>
                  {message.type === 'system' ? (
                    <div className="text-center text-gray-400 text-sm italic">
                      {message.content}
                    </div>
                  ) : (
                    <>
                      <div className="text-xs text-gray-300 mb-1">
                        {message.username} • {formatTimestamp(message.timestamp)}
                      </div>
                      <div className="text-sm">{message.content}</div>
                    </>
                  )}
                </div>
              </div>
            ))}
            
            {/* Typing Indicator */}
            {typingUsers.size > 0 && (
              <div className="flex justify-start">
                <div className="bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm">
                  {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 border-t border-gray-700">
            <form onSubmit={handleSendMessage} className="flex space-x-2">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  placeholder="Type a message..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                {/* Emoji Picker */}
                {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-2 w-64 h-48 bg-gray-800 border border-gray-600 rounded-lg p-3 overflow-y-auto">
                    {Object.entries(emojiCategories).map(([category, emojis]) => (
                      <div key={category} className="mb-3">
                        <div className="text-gray-400 text-xs font-semibold mb-2">{category}</div>
                        <div className="grid grid-cols-8 gap-1">
                          {emojis.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => handleEmojiSelect(emoji)}
                              className="text-lg hover:bg-gray-700 rounded p-1 transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <button
                type="button"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                className="px-3 py-2 text-gray-400 hover:text-white transition-colors"
              >
                😊
              </button>
              
              <button
                type="submit"
                disabled={newMessage.trim() === ''}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}

export default ChatPanelEnhanced
