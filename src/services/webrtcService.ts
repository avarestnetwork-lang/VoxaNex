import { CallSessionData, WebRTCSignal, IceServerConfig, CallMediaKind } from '../types';
import { getAuthToken, connectCustomSSE } from './messagingService';
import { databaseService } from './databaseService';

export class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private customSseCleanup: (() => void) | null = null;
  private unsubscribeSupabaseEvents: (() => void) | null = null;
  private iceServers: IceServerConfig[] = [];

  // Active call state & ICE candidate buffering for race condition prevention
  private currentCall: CallSessionData | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private processedSignalIds = new Set<string>();

  // Callbacks
  private onRemoteStreamCallbacks: Set<(stream: MediaStream) => void> = new Set();
  private onConnectionStateCallbacks: Set<(state: RTCPeerConnectionState) => void> = new Set();
  private onCallStatusCallbacks: Set<(call: CallSessionData) => void> = new Set();
  private onIncomingCallCallbacks: Set<(call: CallSessionData) => void> = new Set();
  private onSignalCallbacks: Set<(signal: WebRTCSignal) => void> = new Set();
  private onErrorCallbacks: Set<(err: string) => void> = new Set();

  /**
   * Initialize signaling stream (SSE + Supabase Realtime fallback) with Authorization Bearer header
   */
  public subscribeToSignaling(userId: string): () => void {
    if (this.customSseCleanup) {
      this.customSseCleanup();
      this.customSseCleanup = null;
    }
    if (this.unsubscribeSupabaseEvents) {
      this.unsubscribeSupabaseEvents();
      this.unsubscribeSupabaseEvents = null;
    }

    const handleIncomingEvent = (eventName: string, dataObj: any) => {
      try {
        if (eventName === 'incoming_call') {
          const incomingSession: CallSessionData = {
            callId: dataObj.callId,
            conversationId: dataObj.conversationId,
            initiator: dataObj.initiator,
            callee: dataObj.callee,
            mediaKind: dataObj.mediaKind || 'video',
            status: 'ringing',
            startedAt: Date.now(),
          };
          this.currentCall = incomingSession;
          this.onIncomingCallCallbacks.forEach((cb) => cb(incomingSession));
        } else if (eventName === 'call_accepted') {
          if (this.currentCall && this.currentCall.callId === dataObj.callId) {
            this.currentCall.status = 'connecting';
            this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
            if (this.peerConnection && this.currentCall.initiator.id === userId) {
              this.createAndSendOffer(dataObj.callId, userId);
            }
          }
        } else if (eventName === 'call_rejected') {
          if (this.currentCall && this.currentCall.callId === dataObj.callId) {
            this.currentCall.status = 'rejected';
            this.currentCall.endedReason = dataObj.reason || 'Call rejected';
            this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
            this.cleanupPeerConnection();
          }
        } else if (eventName === 'call_ended') {
          if (this.currentCall && this.currentCall.callId === dataObj.callId) {
            this.currentCall.status = 'ended';
            this.currentCall.endedReason = dataObj.reason || 'Call ended';
            this.currentCall.durationSeconds = dataObj.durationSeconds;
            this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
            this.cleanupPeerConnection();
          }
        } else if (eventName === 'call_timeout') {
          if (this.currentCall && this.currentCall.callId === dataObj.callId) {
            this.currentCall.status = 'missed';
            this.currentCall.endedReason = dataObj.reason || 'No answer (timed out)';
            this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
            this.cleanupPeerConnection();
          }
        } else if (eventName === 'webrtc_signal') {
          const signal: WebRTCSignal = dataObj;
          if (signal && signal.id) {
            if (this.processedSignalIds.has(signal.id)) return;
            this.processedSignalIds.add(signal.id);
            if (this.processedSignalIds.size > 200) {
              const oldest = this.processedSignalIds.values().next().value;
              if (oldest) this.processedSignalIds.delete(oldest);
            }
          }
          this.onSignalCallbacks.forEach((cb) => cb(signal));
          this.handleIncomingSignal(signal, userId);
        }
      } catch (err) {
        console.error('Failed to handle incoming WebRTC signaling event', err);
      }
    };

    // 1. Custom SSE Stream with Bearer Token header
    const cleanupSse = connectCustomSSE({
      url: `/api/webrtc/signaling/${encodeURIComponent(userId)}/events`,
      headers: async () => {
        const token = await getAuthToken({ isGuest: false, userId });
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
      },
      onEvent: (eventName, dataStr) => {
        try {
          const parsed = JSON.parse(dataStr);
          handleIncomingEvent(eventName, parsed);
        } catch {
          // ignore non-json pings
        }
      },
      onError: () => {},
      onAuthError: (status) => {
        console.warn(`[WebRTC] SSE Auth error status ${status}`);
      },
    });
    this.customSseCleanup = cleanupSse;

    // 2. Supabase Realtime channel subscription backup
    try {
      const unsubSupabase = databaseService.subscribeToUserWebRTCEvents(userId, (eventName, payload) => {
        handleIncomingEvent(eventName, payload);
      });
      this.unsubscribeSupabaseEvents = unsubSupabase;
    } catch {
      // ignore if supabase not configured
    }

    return () => {
      if (this.customSseCleanup === cleanupSse) {
        cleanupSse();
        this.customSseCleanup = null;
      }
      if (this.unsubscribeSupabaseEvents) {
        this.unsubscribeSupabaseEvents();
        this.unsubscribeSupabaseEvents = null;
      }
    };
  }

  /**
   * Helper to get authenticated headers for /api/webrtc/* calls
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken({ isGuest: false });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Fetch STUN / TURN servers from backend with auth
   */
  public async fetchIceServers(): Promise<IceServerConfig[]> {
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/ice-servers', { headers });
      const data = (await res.json()) as { success?: boolean; iceServers?: IceServerConfig[] };
      if (data.success && data.iceServers) {
        this.iceServers = data.iceServers;
        return data.iceServers;
      }
    } catch (err) {
      console.warn('Using default STUN servers due to API fetch failure', err);
    }
    return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  }

  /**
   * Acquire local browser media (camera / mic) with validation
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
   * Initialize RTCPeerConnection with STUN/TURN configuration and ICE candidate handling
   */
  public async initPeerConnection(callId: string, currentUserId: string): Promise<RTCPeerConnection> {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.pendingIceCandidates = [];

    if (this.iceServers.length === 0) {
      await this.fetchIceServers();
    }

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 2,
    });
    this.peerConnection = pc;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }
      this.onRemoteStreamCallbacks.forEach((cb) => cb(this.remoteStream!));
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await this.sendSignal(callId, currentUserId, 'ice_candidate', event.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      this.onConnectionStateCallbacks.forEach((cb) => cb(pc.connectionState));
      if (pc.connectionState === 'connected' && this.currentCall) {
        this.currentCall.status = 'active';
        this.onCallStatusCallbacks.forEach((cb) => cb(this.currentCall!));
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
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
    const mediaKind = this.currentCall?.mediaKind || 'video';
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: mediaKind === 'video',
    });
    await pc.setLocalDescription(offer);
    await this.sendSignal(callId, currentUserId, 'offer', offer);
  }

  /**
   * Handle incoming WebRTC signal with ICE candidate buffering
   */
  private async handleIncomingSignal(signal: WebRTCSignal, currentUserId: string) {
    const pc = this.peerConnection;

    if (signal.type === 'offer') {
      if (!this.peerConnection) {
        await this.initPeerConnection(signal.callId, currentUserId);
      }
      const activePc = this.peerConnection!;
      await activePc.setRemoteDescription(new RTCSessionDescription(signal.payload));

      // Flush buffered ICE candidates
      if (this.pendingIceCandidates.length > 0) {
        for (const cand of this.pendingIceCandidates) {
          try {
            await activePc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (err) {
            console.warn('Error flushing buffered ICE candidate', err);
          }
        }
        this.pendingIceCandidates = [];
      }

      const answer = await activePc.createAnswer();
      await activePc.setLocalDescription(answer);
      await this.sendSignal(signal.callId, currentUserId, 'answer', answer);
    } else if (signal.type === 'answer') {
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.payload));
        if (this.pendingIceCandidates.length > 0) {
          for (const cand of this.pendingIceCandidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
              console.warn('Error flushing buffered ICE candidate', err);
            }
          }
          this.pendingIceCandidates = [];
        }
      }
    } else if (signal.type === 'ice_candidate') {
      if (signal.payload) {
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.payload));
          } catch (err) {
            console.warn('Error adding ICE candidate', err);
          }
        } else {
          this.pendingIceCandidates.push(signal.payload);
        }
      }
    } else if (signal.type === 'hangup') {
      this.cleanupPeerConnection();
    }
  }

  /**
   * Send signal to backend with auth
   */
  public async sendSignal(
    callId: string,
    senderId: string,
    type: 'offer' | 'answer' | 'ice_candidate' | 'mute_state' | 'hangup',
    payload: any
  ): Promise<boolean> {
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/signal', {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId, senderId, type, payload }),
      });
      const data = (await res.json()) as { success?: boolean };
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * Initiate 1-on-1 call with auth headers
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
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/call/initiate', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      const data = (await res.json()) as { success?: boolean; call?: CallSessionData; error?: string };
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
   * Accept incoming call with auth headers
   */
  public async acceptCall(callId: string, calleeId: string): Promise<{ success: boolean; call?: CallSessionData; error?: string }> {
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/call/accept', {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId, calleeId }),
      });
      const data = (await res.json()) as { success?: boolean; call?: CallSessionData; error?: string };
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
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/call/reject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId, calleeId, reason }),
      });
      const data = (await res.json()) as { success?: boolean };
      if (this.currentCall && this.currentCall.callId === callId) {
        this.currentCall = null;
      }
      this.cleanupPeerConnection();
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * End call
   */
  public async endCall(callId: string, userId: string, reason?: string): Promise<boolean> {
    try {
      const headers = await this.getAuthHeaders();
      const res = await fetch('/api/webrtc/call/end', {
        method: 'POST',
        headers,
        body: JSON.stringify({ callId, userId, reason }),
      });
      const data = (await res.json()) as { success?: boolean };
      if (this.currentCall && this.currentCall.callId === callId) {
        this.currentCall.status = 'ended';
      }
      this.cleanupPeerConnection();
      return Boolean(data.success);
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
    this.pendingIceCandidates = [];
  }

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
