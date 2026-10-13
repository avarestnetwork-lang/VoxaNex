import { CallSessionData, WebRTCSignal, IceServerConfig, CallMediaKind } from '../types';

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private eventSource: EventSource | null = null;
  private iceServers: IceServerConfig[] = [];

  // Active call state
  private currentCall: CallSessionData | null = null;

  // Callbacks
  private onRemoteStreamCallbacks: Set<(stream: MediaStream) => void> = new Set();
  private onConnectionStateCallbacks: Set<(state: RTCPeerConnectionState) => void> = new Set();
  private onCallStatusCallbacks: Set<(call: CallSessionData) => void> = new Set();
  private onIncomingCallCallbacks: Set<(call: CallSessionData) => void> = new Set();
  private onSignalCallbacks: Set<(signal: WebRTCSignal) => void> = new Set();
  private onErrorCallbacks: Set<(err: string) => void> = new Set();

  /**
   * Initialize signaling SSE stream for current user
   */
  public subscribeToSignaling(userId: string): () => void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const sse = new EventSource(`/api/webrtc/signaling/${encodeURIComponent(userId)}/events`);
    this.eventSource = sse;

    sse.addEventListener('incoming_call', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const incomingSession: CallSessionData = {
          callId: data.callId,
          conversationId: data.conversationId,
          initiator: data.initiator,
          callee: data.callee,
          mediaKind: data.mediaKind,
          status: 'ringing',
          startedAt: Date.now(),
        };
        this.currentCall = incomingSession;
        this.onIncomingCallCallbacks.forEach((cb) => cb(incomingSession));
      } catch (err) {
        console.error('Failed to parse incoming_call event', err);
      }
    });

    sse.addEventListener('call_accepted', async (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (this.currentCall && this.currentCall.callId === data.callId) {
          this.currentCall.status = 'connecting';
          this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));

          // If initiator, create and send WebRTC Offer
          if (this.peerConnection && this.currentCall.initiator.id === userId) {
            await this.createAndSendOffer(data.callId, userId);
          }
        }
      } catch (err) {
        console.error('Failed to handle call_accepted event', err);
      }
    });

    sse.addEventListener('call_rejected', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (this.currentCall && this.currentCall.callId === data.callId) {
          this.currentCall.status = 'rejected';
          this.currentCall.endedReason = data.reason || 'Call rejected';
          this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
          this.cleanupPeerConnection();
        }
      } catch (err) {
        console.error('Failed to handle call_rejected event', err);
      }
    });

    sse.addEventListener('call_ended', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (this.currentCall && this.currentCall.callId === data.callId) {
          this.currentCall.status = 'ended';
          this.currentCall.endedReason = data.reason || 'Call ended';
          this.currentCall.durationSeconds = data.durationSeconds;
          this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
          this.cleanupPeerConnection();
        }
      } catch (err) {
        console.error('Failed to handle call_ended event', err);
      }
    });

    sse.addEventListener('call_timeout', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (this.currentCall && this.currentCall.callId === data.callId) {
          this.currentCall.status = 'missed';
          this.currentCall.endedReason = data.reason || 'No answer (timed out)';
          this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
          this.cleanupPeerConnection();
        }
      } catch (err) {
        console.error('Failed to handle call_timeout event', err);
      }
    });

    sse.addEventListener('webrtc_signal', async (e: MessageEvent) => {
      try {
        const signal: WebRTCSignal = JSON.parse(e.data);
        this.onSignalCallbacks.forEach((cb) => cb(signal));
        await this.handleIncomingSignal(signal, userId);
      } catch (err) {
        console.error('Failed to handle webrtc_signal event', err);
      }
    });

    return () => {
      if (this.eventSource === sse) {
        sse.close();
        this.eventSource = null;
      }
    };
  }

  /**
   * Fetch STUN / TURN servers from backend
   */
  public async fetchIceServers(): Promise<IceServerConfig[]> {
    try {
      const res = await fetch('/api/webrtc/ice-servers');
      const data = await res.json();
      if (data.success && data.iceServers) {
        this.iceServers = data.iceServers;
        return data.iceServers;
      }
    } catch (err) {
      console.warn('Using default STUN servers due to API fetch failure', err);
    }
    // Fallback public STUN
    return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  }

  /**
   * Acquire local browser media (camera / mic)
   */
  public async acquireLocalMedia(constraints: {
    video: boolean | MediaTrackConstraints;
    audio: boolean | MediaTrackConstraints;
  }): Promise<{ success: boolean; stream?: MediaStream; error?: string }> {
    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach((t) => t.stop());
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { success: false, error: 'WebRTC MediaDevices API is not supported in this browser.' };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      return { success: true, stream };
    } catch (err: any) {
      let friendlyError = 'Permission denied or media hardware unavailable.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendlyError = 'Camera/Microphone permission was denied by browser settings. Please allow access in the address bar.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendlyError = 'Requested camera or microphone hardware device was not found.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        friendlyError = 'Media hardware is currently in use by another application.';
      }
      return { success: false, error: friendlyError };
    }
  }

  /**
   * Initialize RTCPeerConnection with STUN/TURN configuration and ICE candidates routing
   */
  public async initPeerConnection(callId: string, currentUserId: string): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.iceServers.length === 0) {
      await this.fetchIceServers();
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });
    this.peerConnection = pc;

    // Attach local media tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Remote track incoming
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
        this.onRemoteStreamCallbacks.forEach((cb) => cb(this.remoteStream!));
      }
    };

    // ICE Candidate generation
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await this.sendSignal(callId, currentUserId, 'ice_candidate', event.candidate.toJSON());
      }
    };

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      this.onConnectionStateCallbacks.forEach((cb) => cb(pc.connectionState));
      if (pc.connectionState === 'connected' && this.currentCall) {
        this.currentCall.status = 'active';
        this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
      } else if (pc.connectionState === 'failed') {
        this.onErrorCallbacks.forEach((cb) => cb('WebRTC connection failed. Network or firewall issue.'));
      }
    };

    return pc;
  }

  /**
   * Create and dispatch SDP Offer
   */
  public async createAndSendOffer(callId: string, currentUserId: string) {
    if (!this.peerConnection) {
      await this.initPeerConnection(callId, currentUserId);
    }
    const pc = this.peerConnection!;
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);

    await this.sendSignal(callId, currentUserId, 'offer', offer);
  }

  /**
   * Handle incoming WebRTC signal (offer, answer, ICE candidate)
   */
  private async handleIncomingSignal(signal: WebRTCSignal, currentUserId: string) {
    const pc = this.peerConnection;

    if (signal.type === 'offer') {
      // Callee received offer
      if (!this.peerConnection) {
        await this.initPeerConnection(signal.callId, currentUserId);
      }
      const activePc = this.peerConnection!;
      await activePc.setRemoteDescription(new RTCSessionDescription(signal.payload));

      const answer = await activePc.createAnswer();
      await activePc.setLocalDescription(answer);

      await this.sendSignal(signal.callId, currentUserId, 'answer', answer);
    } else if (signal.type === 'answer') {
      // Initiator received answer
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
      }
    } else if (signal.type === 'ice_candidate') {
      if (pc && signal.payload) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
        } catch (err) {
          console.warn('Error adding ICE candidate', err);
        }
      }
    } else if (signal.type === 'hangup') {
      this.cleanupPeerConnection();
    }
  }

  /**
   * Send signal to backend
   */
  public async sendSignal(
    callId: string,
    senderId: string,
    type: 'offer' | 'answer' | 'ice_candidate' | 'mute_state' | 'hangup',
    payload: any
  ): Promise<boolean> {
    try {
      const res = await fetch('/api/webrtc/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, senderId, type, payload }),
      });
      const data = await res.json();
      return data.success;
    } catch {
      return false;
    }
  }

  /**
   * Initiate 1-on-1 call
   */
  public async initiateCall(params: {
    initiatorId: string;
    initiatorNickname: string;
    initiatorAvatar: string;
    calleeId: string;
    calleeNickname: string;
    calleeAvatar: string;
    mediaKind: CallMediaKind;
    conversationId?: string;
  }): Promise<{ success: boolean; call?: CallSessionData; error?: string }> {
    try {
      const res = await fetch('/api/webrtc/call/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (data.success && data.call) {
        this.currentCall = data.call;
        return { success: true, call: data.call };
      }
      return { success: false, error: data.error || 'Failed to initiate call.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error initiating call.' };
    }
  }

  /**
   * Accept incoming call
   */
  public async acceptCall(callId: string, calleeId: string): Promise<{ success: boolean; call?: CallSessionData; error?: string }> {
    try {
      const res = await fetch('/api/webrtc/call/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, calleeId }),
      });
      const data = await res.json();
      if (data.success && data.call) {
        this.currentCall = data.call;
        return { success: true, call: data.call };
      }
      return { success: false, error: data.error || 'Failed to accept call.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error accepting call.' };
    }
  }

  /**
   * Reject call
   */
  public async rejectCall(callId: string, calleeId: string, reason?: string): Promise<boolean> {
    try {
      const res = await fetch('/api/webrtc/call/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, calleeId, reason }),
      });
      const data = await res.json();
      if (this.currentCall && this.currentCall.callId === callId) {
        this.currentCall = null;
      }
      this.cleanupPeerConnection();
      return data.success;
    } catch {
      return false;
    }
  }

  /**
   * End call
   */
  public async endCall(callId: string, userId: string, reason?: string): Promise<boolean> {
    try {
      const res = await fetch('/api/webrtc/call/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, userId, reason }),
      });
      const data = await res.json();
      if (this.currentCall && this.currentCall.callId === callId) {
        this.currentCall.status = 'ended';
      }
      this.cleanupPeerConnection();
      return data.success;
    } catch {
      this.cleanupPeerConnection();
      return false;
    }
  }

  /**
   * Clean up PeerConnection and local/remote tracks
   */
  public cleanupPeerConnection() {
    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;
  }

  // Toggles
  public toggleCamera(enabled: boolean): boolean {
    if (this.localStream) {
      const track = this.localStream.getVideoTracks()[0];
      if (track) {
        track.enabled = enabled;
        return track.enabled;
      }
    }
    return false;
  }

  public toggleMicrophone(enabled: boolean): boolean {
    if (this.localStream) {
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = enabled;
        return track.enabled;
      }
    }
    return false;
  }

  // Event Listeners
  public onRemoteStream(cb: (stream: MediaStream) => void): () => void {
    this.onRemoteStreamCallbacks.add(cb);
    return () => this.onRemoteStreamCallbacks.delete(cb);
  }

  public onConnectionState(cb: (state: RTCPeerConnectionState) => void): () => void {
    this.onConnectionStateCallbacks.add(cb);
    return () => this.onConnectionStateCallbacks.delete(cb);
  }

  public onCallStatus(cb: (call: CallSessionData) => void): () => void {
    this.onCallStatusCallbacks.add(cb);
    return () => this.onCallStatusCallbacks.delete(cb);
  }

  public onIncomingCall(cb: (call: CallSessionData) => void): () => void {
    this.onIncomingCallCallbacks.add(cb);
    return () => this.onIncomingCallCallbacks.delete(cb);
  }

  public onError(cb: (err: string) => void): () => void {
    this.onErrorCallbacks.add(cb);
    return () => this.onErrorCallbacks.delete(cb);
  }

  public getCurrentCall(): CallSessionData | null {
    return this.currentCall;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }
}

export const webrtcService = new WebRTCService();
