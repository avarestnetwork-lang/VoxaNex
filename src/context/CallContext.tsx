import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { webrtcService } from '../services/webrtcService';
import { CallSessionData, CallMediaKind, CallSessionStatus } from '../types';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneIncoming,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ShieldAlert,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

interface CallContextType {
  activeCall: CallSessionData | null;
  callStatus: CallSessionStatus;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  cameraActive: boolean;
  micActive: boolean;
  connectionState: RTCPeerConnectionState;
  deviceError: string | null;
  initiateCall: (params: {
    calleeId: string;
    calleeNickname: string;
    calleeAvatar: string;
    mediaKind: CallMediaKind;
    conversationId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endCurrentCall: (reason?: string) => Promise<void>;
  toggleCamera: () => void;
  toggleMic: () => void;
  isCallModalOpen: boolean;
  setIsCallModalOpen: (open: boolean) => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { language } = useLanguage();

  const [activeCall, setActiveCall] = useState<CallSessionData | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSessionData | null>(null);
  const [callStatus, setCallStatus] = useState<CallSessionStatus>('idle');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(true);
  const [micActive, setMicActive] = useState(true);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isCallModalOpen, setIsCallModalOpen] = useState(false);

  // Sound effects simulation flag / timers
  const [callDuration, setCallDuration] = useState(0);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe to SSE incoming calls & signals when user is authenticated
  useEffect(() => {
    if (!user || !user.id) return;

    const unsubscribe = webrtcService.subscribeToSignaling(user.id);

    const unsubIncoming = webrtcService.onIncomingCall((call) => {
      setIncomingCall(call);
    });

    const unsubStatus = webrtcService.onCallStatus((call) => {
      setActiveCall(call);
      setCallStatus(call.status);

      if (call.status === 'active') {
        if (!durationTimerRef.current) {
          durationTimerRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);
        }
      } else if (call.status === 'ended' || call.status === 'rejected' || call.status === 'missed') {
        if (durationTimerRef.current) {
          clearInterval(durationTimerRef.current);
          durationTimerRef.current = null;
        }
      }
    });

    const unsubRemote = webrtcService.onRemoteStream((stream) => {
      setRemoteStream(stream);
    });

    const unsubConnState = webrtcService.onConnectionState((state) => {
      setConnectionState(state);
    });

    const unsubError = webrtcService.onError((err) => {
      setDeviceError(err);
    });

    return () => {
      unsubscribe();
      unsubIncoming();
      unsubStatus();
      unsubRemote();
      unsubConnState();
      unsubError();
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
      }
    };
  }, [user?.id]);

  /**
   * Initiate call to recipient
   */
  const handleInitiateCall = useCallback(
    async (params: {
      calleeId: string;
      calleeNickname: string;
      calleeAvatar: string;
      mediaKind: CallMediaKind;
      conversationId?: string;
    }): Promise<{ success: boolean; error?: string }> => {
      setDeviceError(null);
      setCallDuration(0);

      // Acquire media first with browser permission
      const mediaRes = await webrtcService.acquireLocalMedia({
        video: params.mediaKind === 'video',
        audio: true,
      });

      if (!mediaRes.success) {
        setDeviceError(mediaRes.error || 'Media acquisition failed.');
        return { success: false, error: mediaRes.error };
      }

      setLocalStream(mediaRes.stream || null);
      setCameraActive(params.mediaKind === 'video');
      setMicActive(true);

      const res = await webrtcService.initiateCall({
        initiatorId: user.id,
        initiatorNickname: user.nickname,
        initiatorAvatar: user.avatar,
        calleeId: params.calleeId,
        calleeNickname: params.calleeNickname,
        calleeAvatar: params.calleeAvatar,
        mediaKind: params.mediaKind,
        conversationId: params.conversationId,
      });

      if (res.success && res.call) {
        setActiveCall(res.call);
        setCallStatus('ringing');
        setIsCallModalOpen(true);

        // Pre-initialize peer connection
        await webrtcService.initPeerConnection(res.call.callId, user.id);
        return { success: true };
      } else {
        webrtcService.cleanupPeerConnection();
        setLocalStream(null);
        setDeviceError(res.error || 'Failed to place call.');
        return { success: false, error: res.error };
      }
    },
    [user]
  );

  /**
   * Recipient accepts call
   */
  const handleAcceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    setDeviceError(null);
    setCallDuration(0);

    // Acquire media
    const mediaRes = await webrtcService.acquireLocalMedia({
      video: incomingCall.mediaKind === 'video',
      audio: true,
    });

    if (!mediaRes.success) {
      setDeviceError(mediaRes.error || 'Unable to access microphone/camera.');
      await webrtcService.rejectCall(incomingCall.callId, user.id, 'Permission denied');
      setIncomingCall(null);
      return;
    }

    setLocalStream(mediaRes.stream || null);
    setCameraActive(incomingCall.mediaKind === 'video');
    setMicActive(true);

    // Initialize peer connection before accepting to be ready for offer
    await webrtcService.initPeerConnection(incomingCall.callId, user.id);

    const res = await webrtcService.acceptCall(incomingCall.callId, user.id);
    if (res.success && res.call) {
      setActiveCall(res.call);
      setCallStatus('connecting');
      setIncomingCall(null);
      setIsCallModalOpen(true);
    } else {
      setDeviceError(res.error || 'Failed to accept call.');
      setIncomingCall(null);
      webrtcService.cleanupPeerConnection();
    }
  }, [incomingCall, user.id]);

  /**
   * Recipient rejects call
   */
  const handleRejectIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    await webrtcService.rejectCall(incomingCall.callId, user.id, 'User declined');
    setIncomingCall(null);
  }, [incomingCall, user.id]);

  /**
   * End call
   */
  const handleEndCall = useCallback(
    async (reason = 'Call hung up') => {
      const call = activeCall || incomingCall;
      if (call) {
        await webrtcService.endCall(call.callId, user.id, reason);
      }
      webrtcService.cleanupPeerConnection();
      setActiveCall(null);
      setIncomingCall(null);
      setCallStatus('ended');
      setLocalStream(null);
      setRemoteStream(null);
      setIsCallModalOpen(false);
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    },
    [activeCall, incomingCall, user.id]
  );

  const toggleCamera = () => {
    const nextState = !cameraActive;
    const ok = webrtcService.toggleCamera(nextState);
    setCameraActive(nextState);
  };

  const toggleMic = () => {
    const nextState = !micActive;
    const ok = webrtcService.toggleMicrophone(nextState);
    setMicActive(nextState);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <CallContext.Provider
      value={{
        activeCall,
        callStatus,
        localStream,
        remoteStream,
        cameraActive,
        micActive,
        connectionState,
        deviceError,
        initiateCall: handleInitiateCall,
        acceptIncomingCall: handleAcceptIncomingCall,
        rejectIncomingCall: handleRejectIncomingCall,
        endCurrentCall: handleEndCall,
        toggleCamera,
        toggleMic,
        isCallModalOpen,
        setIsCallModalOpen,
      }}
    >
      {children}

      {/* ========================================================================= */}
      {/* INCOMING CALL BANNER / MODAL (HIGH VISIBILITY)                            */}
      {/* ========================================================================= */}
      {incomingCall && (
        <div className="fixed top-6 right-6 z-50 max-w-sm w-full bg-[#0d1424] border-2 border-cyan-500 rounded-2xl p-5 shadow-2xl shadow-cyan-950/80 animate-bounce duration-1000">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-500 flex items-center justify-center text-2xl shrink-0">
              {incomingCall.initiator.avatar}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-mono text-cyan-400 uppercase tracking-wider">
                <PhoneIncoming className="w-3.5 h-3.5 animate-pulse" />
                <span>Incoming {incomingCall.mediaKind === 'video' ? 'Video' : 'Audio'} Call</span>
              </div>
              <h3 className="text-base font-bold text-white truncate">
                {incomingCall.initiator.nickname}
              </h3>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-4">
            {language === 'bn'
              ? 'একটি নতুন কল এসেছে। রিসিভ করতে সম্মতি দিন।'
              : 'Incoming 1-on-1 WebRTC call session. Click Accept to establish peer connection.'}
          </p>

          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              size="md"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500"
              onClick={handleAcceptIncomingCall}
            >
              <PhoneCall className="w-4 h-4 mr-1.5" />
              <span>{language === 'bn' ? 'গ্রহণ করুন' : 'Accept'}</span>
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              onClick={handleRejectIncomingCall}
            >
              <PhoneOff className="w-4 h-4 mr-1.5" />
              <span>{language === 'bn' ? 'প্রত্যাখ্যান' : 'Decline'}</span>
            </Button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ACTIVE CALL FLOATING MODAL OVERLAY                                        */}
      {/* ========================================================================= */}
      {isCallModalOpen && activeCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-4xl bg-[#080d1a] border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Call Header */}
            <div className="p-4 bg-[#0d1424] border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-xl">
                  {activeCall.initiator.id === user.id ? activeCall.callee.avatar : activeCall.initiator.avatar}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>
                      {activeCall.initiator.id === user.id
                        ? activeCall.callee.nickname
                        : activeCall.initiator.nickname}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950 border border-cyan-800 text-cyan-400 font-mono">
                      {activeCall.mediaKind.toUpperCase()}
                    </span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        callStatus === 'active'
                          ? 'bg-emerald-400 animate-pulse'
                          : callStatus === 'ringing'
                          ? 'bg-amber-400 animate-ping'
                          : 'bg-cyan-400'
                      }`}
                    />
                    <span>
                      {callStatus === 'ringing'
                        ? 'Ringing partner...'
                        : callStatus === 'connecting'
                        ? 'Negotiating WebRTC ICE & DTLS...'
                        : callStatus === 'active'
                        ? `Connected (${formatTimer(callDuration)})`
                        : callStatus}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">ICE: {connectionState}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsCallModalOpen(false)}
                  className="px-3 py-1 text-xs rounded-lg border border-slate-800 text-slate-400 hover:text-white"
                  title="Minimize window"
                >
                  Minimize
                </button>
              </div>
            </div>

            {deviceError && (
              <div className="p-3 bg-amber-950/40 border-b border-amber-900 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{deviceError}</span>
              </div>
            )}

            {/* Video / Audio Stage */}
            <div className="flex-1 bg-[#050811] relative p-4 flex items-center justify-center min-h-[340px]">
              {/* Remote Feed */}
              {remoteStream && activeCall.mediaKind === 'video' ? (
                <video
                  autoPlay
                  playsInline
                  ref={(v) => {
                    if (v && remoteStream) v.srcObject = remoteStream;
                  }}
                  className="w-full h-full object-contain rounded-2xl max-h-[500px]"
                />
              ) : (
                <div className="text-center space-y-4 py-12">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-violet-600 to-cyan-500 p-1 mx-auto shadow-2xl">
                    <div className="w-full h-full bg-[#0a0f1d] rounded-2xl flex items-center justify-center text-4xl select-none">
                      {activeCall.initiator.id === user.id ? activeCall.callee.avatar : activeCall.initiator.avatar}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-lg font-bold text-white">
                      {activeCall.initiator.id === user.id ? activeCall.callee.nickname : activeCall.initiator.nickname}
                    </h4>
                    <p className="text-xs text-slate-400 font-mono mt-1">
                      {callStatus === 'ringing'
                        ? 'Waiting for recipient to accept...'
                        : callStatus === 'active'
                        ? `Audio stream connected · ${formatTimer(callDuration)}`
                        : 'WebRTC Peer Signaling...'}
                    </p>
                  </div>
                </div>
              )}

              {/* Local PiP Preview */}
              {localStream && activeCall.mediaKind === 'video' && (
                <div className="absolute bottom-6 right-6 w-36 sm:w-48 aspect-video rounded-xl border border-slate-700 bg-black overflow-hidden shadow-2xl">
                  <video
                    autoPlay
                    playsInline
                    muted
                    ref={(v) => {
                      if (v && localStream) v.srcObject = localStream;
                    }}
                    className={`w-full h-full object-cover transform -scale-x-100 ${cameraActive ? 'block' : 'hidden'}`}
                  />
                  {!cameraActive && (
                    <div className="w-full h-full bg-slate-900 flex items-center justify-center text-xs text-slate-400">
                      Camera Off
                    </div>
                  )}
                  <div className="absolute bottom-1 left-2 text-[10px] text-white/80 font-mono bg-black/60 px-1 rounded">
                    You ({cameraActive ? 'Cam On' : 'Cam Off'})
                  </div>
                </div>
              )}
            </div>

            {/* In-Call Controls Dock */}
            <div className="p-4 bg-[#0c1222] border-t border-slate-800 flex items-center justify-center gap-3">
              {activeCall.mediaKind === 'video' && (
                <Button
                  size="md"
                  variant={cameraActive ? 'secondary' : 'danger'}
                  onClick={toggleCamera}
                >
                  {cameraActive ? <Video className="w-4 h-4 mr-1.5" /> : <VideoOff className="w-4 h-4 mr-1.5" />}
                  <span>{cameraActive ? 'Camera On' : 'Camera Off'}</span>
                </Button>
              )}

              <Button
                size="md"
                variant={micActive ? 'secondary' : 'danger'}
                onClick={toggleMic}
              >
                {micActive ? <Mic className="w-4 h-4 mr-1.5" /> : <MicOff className="w-4 h-4 mr-1.5" />}
                <span>{micActive ? 'Mic Mute' : 'Mic Unmuted'}</span>
              </Button>

              <Button size="md" variant="danger" onClick={() => handleEndCall('User pressed End Call')}>
                <PhoneOff className="w-4 h-4 mr-1.5" />
                <span>End Call</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
