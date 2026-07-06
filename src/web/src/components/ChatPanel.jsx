import React, { useState, useEffect, useRef } from 'react'
import { websocketManager } from '../utils/websocketManager'

const ChatPanel = ({ roomId, username, showHeader = true }) => {
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [ws, setWs] = useState(null)
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Use shared WebSocket connection from parent
    const handleMessage = (event) => {
      try {
        const data = event.detail
        console.log('💬 ChatPanel received message:', data)
        switch (data.type) {
          case 'chat-message':
            console.log('💬 Processing chat message:', data.data)
            setMessages(prev => {
              // Check if message already exists to prevent duplicates
              const exists = prev.some(msg => msg.id === data.data.id)
              if (exists) {
                console.log('💬 Message already exists, skipping')
                return prev
              }
              console.log('💬 Adding new message to chat')
              return [...prev, data.data]
            })
            break
          case 'room-joined':
            // Load chat history when joining room
            if (data.data && data.data.chatHistory) {
              setMessages(data.data.chatHistory.map(msg => ({
                id: msg.id,
                username: msg.username,
                content: msg.content,
                timestamp: msg.timestamp,
                type: msg.type || 'message'
              })))
            }
            break
          case 'participant-joined':
            // Add system message for new participant (only once)
            if (data.data && data.data.participant) {
              const systemMessage = {
                id: `system-${data.data.participant.id}-joined`,
                username: 'System',
                content: `${data.data.participant.username} joined the room`,
                timestamp: new Date().toISOString(),
                type: 'system'
              }
              setMessages(prev => {
                const exists = prev.some(msg => msg.id === systemMessage.id)
                return exists ? prev : [...prev, systemMessage]
              })
            }
            break
          case 'participant-left':
            // Add system message for leaving participant.
            // Server sends { username }; older shape was { participant: {...} }.
            {
              const leftName = data.data?.username || data.data?.participant?.username
              if (leftName) {
                const systemMessage = {
                  id: `system-${leftName}-left-${Date.now()}`,
                  username: 'System',
                  content: `${leftName} left the room`,
                  timestamp: new Date().toISOString(),
                  type: 'system'
                }
                setMessages(prev => [...prev, systemMessage])
              }
            }
            break
        }
      } catch (err) {
        console.error('Error parsing chat message:', err)
      }
    }

    // Listen to window events for shared WebSocket
    window.addEventListener('cinewatchbuddy-message', handleMessage)

    return () => {
      window.removeEventListener('cinewatchbuddy-message', handleMessage)
    }
  }, [roomId, username])

  const sendMessage = (e) => {
    e.preventDefault()
    if (!newMessage.trim()) return

    const message = {
      id: Date.now().toString(),
      username,
      content: newMessage.trim(),
      timestamp: new Date().toISOString(),
      roomId,
      type: 'message'
    }

    console.log('💬 Sending chat message:', message)

    // Send message directly over the shared WebSocket connection.
    websocketManager.send('chat-message', message)

    // Don't add to local messages - let the WebSocket response handle it
    // This prevents duplicate messages
    setNewMessage('')
  }

  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Chat header */}
      {showHeader && (
        <div className="p-4 border-b border-gray-700">
          <h3 className="font-semibold">Chat</h3>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <p>No messages yet</p>
            <p className="text-sm">Start the conversation!</p>
          </div>
        ) : (
          messages.map((message) => {
            if (message.type === 'system') {
              return (
                <div key={message.id} className="flex justify-center">
                  <div className="bg-gray-800 text-gray-400 text-xs px-3 py-1 rounded-full">
                    {message.content}
                  </div>
                </div>
              )
            }

            return (
              <div
                key={message.id}
                className={`flex ${message.username === username ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs px-3 py-2 rounded-lg ${
                    message.username === username
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">
                      {message.username === username ? 'You' : message.username}
                    </span>
                    <span className="text-xs opacity-70">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm">{message.content}</p>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="input flex-1"
            maxLength={500}
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="btn btn-primary"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default ChatPanel
