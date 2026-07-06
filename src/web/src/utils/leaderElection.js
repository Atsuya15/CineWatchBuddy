// Leader Election System for Video Sync
class LeaderElection {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.isLeader = false;
    this.leaderId = null;
    this.participants = new Map();
    this.syncTimeout = null;
    this.lastSyncTime = 0;
    this.syncThrottle = 100; // Minimum 100ms between syncs
    this.leaderHeartbeatInterval = null;
    this.leaderTimeout = 30000; // 30 seconds without leader activity
    this.lastLeaderActivity = 0;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.connectionManager.on('participantJoined', (data) => {
      this.addParticipant(data.participant);
      this.electLeader();
    });

    this.connectionManager.on('participantLeft', (data) => {
      this.removeParticipant(data.participantId);
      this.electLeader();
    });

    this.connectionManager.on('videoSync', (data) => {
      this.handleVideoSync(data);
    });

    this.connectionManager.on('connectionStateChanged', (state) => {
      if (state === 'connected') {
        this.electLeader();
      } else if (state === 'disconnected') {
        this.isLeader = false;
        this.stopLeaderHeartbeat();
      }
    });
  }

  addParticipant(participant) {
    this.participants.set(participant.id, {
      ...participant,
      lastActivity: Date.now(),
      isActive: true
    });
  }

  removeParticipant(participantId) {
    this.participants.delete(participantId);
    
    // If the leader left, elect a new one
    if (this.leaderId === participantId) {
      this.isLeader = false;
      this.leaderId = null;
      this.stopLeaderHeartbeat();
      this.electLeader();
    }
  }

  // Leader election based on join time (first participant becomes leader)
  electLeader() {
    if (this.participants.size === 0) {
      this.isLeader = false;
      this.leaderId = null;
      this.stopLeaderHeartbeat();
      return;
    }

    // Find the participant who joined first
    let earliestParticipant = null;
    let earliestTime = Infinity;

    for (const [id, participant] of this.participants) {
      if (participant.joinedAt && participant.joinedAt < earliestTime) {
        earliestTime = participant.joinedAt;
        earliestParticipant = participant;
      }
    }

    if (earliestParticipant && earliestParticipant.id !== this.leaderId) {
      this.leaderId = earliestParticipant.id;
      this.isLeader = earliestParticipant.id === this.getCurrentParticipantId();
      
      if (this.isLeader) {
        this.startLeaderHeartbeat();
        console.log('Elected as leader for video sync');
      } else {
        this.stopLeaderHeartbeat();
        console.log(`Leader elected: ${earliestParticipant.username}`);
      }
    }
  }

  getCurrentParticipantId() {
    // This should be set by the room component when joining
    return this.currentParticipantId;
  }

  setCurrentParticipantId(participantId) {
    this.currentParticipantId = participantId;
    this.electLeader();
  }

  // Video sync handling
  handleVideoSync(data) {
    const now = Date.now();
    
    // Update leader activity
    if (data.participantId === this.leaderId) {
      this.lastLeaderActivity = now;
    }

    // Throttle sync updates
    if (now - this.lastSyncTime < this.syncThrottle) {
      return;
    }

    this.lastSyncTime = now;
    
    // Emit sync event for UI components
    this.emit('videoSyncUpdate', {
      ...data,
      fromLeader: data.participantId === this.leaderId,
      timestamp: now
    });
  }

  // Send video sync (only leader should broadcast)
  sendVideoSync(data) {
    if (!this.isLeader) {
      console.warn('Only leader can send video sync');
      return false;
    }

    const now = Date.now();
    if (now - this.lastSyncTime < this.syncThrottle) {
      return false;
    }

    this.lastSyncTime = now;
    this.lastLeaderActivity = now;

    const syncData = {
      ...data,
      participantId: this.getCurrentParticipantId(),
      timestamp: now,
      isLeader: true
    };

    return this.connectionManager.sendVideoSync(syncData);
  }

  // Leader heartbeat to detect dead leaders
  startLeaderHeartbeat() {
    this.stopLeaderHeartbeat();
    
    this.leaderHeartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      // Check if leader is still active
      if (this.leaderId && now - this.lastLeaderActivity > this.leaderTimeout) {
        console.warn('Leader appears to be inactive, re-electing...');
        this.removeParticipant(this.leaderId);
      }
    }, 5000); // Check every 5 seconds
  }

  stopLeaderHeartbeat() {
    if (this.leaderHeartbeatInterval) {
      clearInterval(this.leaderHeartbeatInterval);
      this.leaderHeartbeatInterval = null;
    }
  }

  // Sync timeout for non-leader participants
  setSyncTimeout(callback, delay = 2000) {
    this.clearSyncTimeout();
    this.syncTimeout = setTimeout(callback, delay);
  }

  clearSyncTimeout() {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
  }

  // Get current leader info
  getLeader() {
    if (!this.leaderId) return null;
    return this.participants.get(this.leaderId);
  }

  // Check if current user is leader
  isCurrentUserLeader() {
    return this.isLeader;
  }

  // Get all participants
  getParticipants() {
    return Array.from(this.participants.values());
  }

  // Event emitter
  emit(event, data) {
    // This would be connected to a proper event system
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent(`leaderElection:${event}`, { detail: data }));
    }
  }

  // Cleanup
  destroy() {
    this.stopLeaderHeartbeat();
    this.clearSyncTimeout();
    this.participants.clear();
    this.isLeader = false;
    this.leaderId = null;
  }
}

export default LeaderElection;
