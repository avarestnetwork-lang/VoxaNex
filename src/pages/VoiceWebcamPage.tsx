import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { Button } from '../components/ui/Button';
import { webrtcService } from '../services/webrtcService';
import { messagingService } from '../services/messagingService';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  AlertCircle,
  Phone,
  PhoneCall,
  Layers,
  MessageSquare,
} from 'lucide-react';

export const VoiceWebcamPage: React.FC = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const {
    activeCall,
    callStatus,
    localStream,
    remoteStream,
    cameraActive,
    micActive,
    connectionState,
    deviceError,
    initiateCall,
    endCurrentCall,
    toggleCamera,
    toggleMic,
  } = useCall();

  const [studioActive, setStudioActive] = useState(false);
  const [studioStream, setStudioStream] = useState<MediaStream | null>(null);
  const [studioCam, setStudioCam] = useState(true);
  const [studioMic, setStudioMic] = useState(true);
  const [studioError, setStudioError] = useState<string | null>(null);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');

  // Real conversations / contacts loaded from backend
  const [userConversations, setUserConversations] = useState<Array<{ partnerId: string; nickname: string; avatar: string }>>([]);
  const [targetPartnerId, setTargetPartnerId] = useState<string>('');
  const [mediaKind, setMediaKind] = useState<'video' | 'audio'>('video');
  const [isCallingTarget, setIsCallingTarget] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Enumerate devices
  useEffect(() => {
    async function getDevices() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter((d) => d.kind === 'videoinput');
        const auds = devices.filter((d) => d.kind === 'audioinput');
        setVideoDevices(vids);
        setAudioDevices(auds);
        if (vids.length > 0) setSelectedVideoId(vids[0].deviceId);
        if (auds.length > 0) setSelectedAudioId(auds[0].deviceId);
      } catch (err) {
        console.warn('Device enumeration error:', err);
      }
    }
    getDevices();
  }, []);

  // Load real user conversations to populate valid call contacts
  useEffect(() => {
    if (!user || !user.id || user.isGuest) return;
    let isMounted = true;
    async function loadContacts() {
      const convIds = await messagingService.fetchUserConversations(user.id, { isGuest: user.isGuest, userId: user.id });
      if (!isMounted) return;

      const contacts = convIds.map((cId) => {
        const parts = cId.replace('conv_', '').split('_');
        const partnerId = parts.find((p) => p !== user.id) || 'partner';
        return {
          partnerId,
          nickname: `User ${partnerId.slice(0, 6)}`,
          avatar: '👤',
        };
      });

      setUserConversations(contacts);
      if (contacts.length > 0 && !targetPartnerId) {
        setTargetPartnerId(contacts[0].partnerId);
      }
    }
    loadContacts();

    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.isGuest, targetPartnerId]);

  // Unmount cleanup for local studio stream
  useEffect(() => {
    return () => {
      if (studioStream) {
        studioStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [studioStream]);

  // Bind local preview stream
  useEffect(() => {
    const stream = localStream || studioStream;
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
  }, [localStream, studioStream]);

  // Bind remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const handleStartStudioPreview = async () => {
    setStudioError(null);
    const res = await webrtcService.acquireLocalMedia({
      video: selectedVideoId ? { deviceId: { exact: selectedVideoId } } : true,
      audio: selectedAudioId ? { deviceId: { exact: selectedAudioId } } : true,
    });

    if (res.success && res.stream) {
      setStudioStream(res.stream);
      setStudioActive(true);
      setStudioCam(true);
      setStudioMic(true);
    } else {
      setStudioError(res.error || 'Failed to initialize local preview.');
    }
  };

  const handleStopStudioPreview = () => {
    if (studioStream) {
      studioStream.getTracks().forEach((t) => t.stop());
      setStudioStream(null);
    }
    setStudioActive(false);
  };

  const handlePlaceCall = async () => {
    if (!targetPartnerId || user.isGuest) return;
    setIsCallingTarget(true);
    setStudioError(null);

    const contact = userConversations.find((c) => c.partnerId === targetPartnerId);

    const res = await initiateCall({
      calleeId: targetPartnerId,
      calleeNickname: contact?.nickname || 'Peer User',
      calleeAvatar: contact?.avatar || '👤',
      mediaKind,
    });

    setIsCallingTarget(false);
    if (!res.success) {
      setStudioError(res.error || 'Call could not be connected.');
    }
  };

  const isCallInProgress = Boolean(activeCall && activeCall.status !== 'ended');
  const activeMediaStream = localStream || studioStream;
  const isCameraEnabled = isCallInProgress ? cameraActive : studioCam;
  const isMicEnabled = isCallInProgress ? micActive : studioMic;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-fuchsia-400 tracking-wider uppercase mb-1">
            <Video className="w-4 h-4" />
            <span>Phase 5 WebRTC Calling & Media Relay</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {t.av.title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
            {t.av.subtitle}
          </p>
        </div>

        <div className="p-2.5 rounded-lg border border-slate-800 bg-[#0c1220] text-xs font-mono">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isCallInProgress ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'
              }`}
            />
            <span className="text-slate-300">
              {isCallInProgress
                ? `Call: ${callStatus} (ICE: ${connectionState})`
                : 'WebRTC Signaling Ready'}
            </span>
          </div>
        </div>
      </div>

      {(deviceError || studioError) && (
        <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-900/60 text-xs text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p>{deviceError || studioError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="relative aspect-video rounded-2xl border border-slate-800 bg-[#070b14] overflow-hidden shadow-2xl flex items-center justify-center">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform -scale-x-100 ${
                  activeMediaStream && isCameraEnabled ? 'block' : 'hidden'
                }`}
              />
            )}

            {(!activeMediaStream || !isCameraEnabled) && !remoteStream && (
              <div className="text-center space-y-4 p-6">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-violet-600 to-cyan-500 p-1 mx-auto shadow-xl">
                  <div className="w-full h-full bg-[#0a0f1d] rounded-full flex items-center justify-center text-4xl select-none">
                    {user.avatar || '👤'}
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{user.nickname || 'Visitor'}</h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    {isCallInProgress
                      ? 'In Call · Camera Off'
                      : studioActive
                      ? 'Camera Muted'
                      : 'Camera Standby'}
                  </p>
                </div>
              </div>
            )}

            {remoteStream && activeMediaStream && (
              <div className="absolute bottom-4 right-4 w-36 sm:w-44 aspect-video rounded-xl border border-slate-700 bg-black overflow-hidden shadow-2xl z-20">
                <video
                  ref={(v) => {
                    if (v && activeMediaStream) v.srcObject = activeMediaStream;
                  }}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover transform -scale-x-100 ${
                    isCameraEnabled ? 'block' : 'hidden'
                  }`}
                />
                {!isCameraEnabled && (
                  <div className="w-full h-full bg-slate-900 flex items-center justify-center text-[11px] text-slate-400">
                    Camera Off
                  </div>
                )}
                <div className="absolute bottom-1 left-2 text-[9px] text-white/80 font-mono bg-black/60 px-1 rounded">
                  You
                </div>
              </div>
            )}

            <div className="absolute top-4 left-4 flex items-center gap-2 z-10">
              <span className="bg-black/60 backdrop-blur-md border border-slate-800 text-white text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCallInProgress
                      ? 'bg-emerald-400 animate-pulse'
                      : studioActive
                      ? 'bg-cyan-400'
                      : 'bg-slate-500'
                  }`}
                />
                <span>
                  {isCallInProgress
                    ? `Live Call (${activeCall?.mediaKind.toUpperCase()})`
                    : studioActive
                    ? 'Local Hardware Test'
                    : 'Inactive'}
                </span>
              </span>

              {isMicEnabled && (
                <span className="bg-black/60 backdrop-blur-md border border-slate-800 text-cyan-400 text-[11px] px-2 py-1 rounded-md flex items-center gap-1">
                  <Mic className="w-3 h-3" />
                  <span>Mic Active</span>
                </span>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0c1220] flex flex-wrap items-center justify-center gap-3">
            {isCallInProgress ? (
              <>
                <Button
                  size="md"
                  variant={isCameraEnabled ? 'secondary' : 'danger'}
                  onClick={toggleCamera}
                >
                  {isCameraEnabled ? <Video className="w-4 h-4 mr-1.5" /> : <VideoOff className="w-4 h-4 mr-1.5" />}
                  <span>{isCameraEnabled ? t.av.camOn : t.av.camOff}</span>
                </Button>

                <Button
                  size="md"
                  variant={isMicEnabled ? 'secondary' : 'danger'}
                  onClick={toggleMic}
                >
                  {isMicEnabled ? <Mic className="w-4 h-4 mr-1.5" /> : <MicOff className="w-4 h-4 mr-1.5" />}
                  <span>{isMicEnabled ? t.av.micOn : t.av.micOff}</span>
                </Button>

                <Button size="md" variant="danger" onClick={() => endCurrentCall('User Ended Call')}>
                  <PhoneOff className="w-4 h-4 mr-1.5" />
                  <span>{t.av.endCall}</span>
                </Button>
              </>
            ) : studioActive ? (
              <>
                <Button
                  size="md"
                  variant={studioCam ? 'secondary' : 'danger'}
                  onClick={() => {
                    const next = !studioCam;
                    if (studioStream) {
                      const tr = studioStream.getVideoTracks()[0];
                      if (tr) tr.enabled = next;
                    }
                    setStudioCam(next);
                  }}
                >
                  {studioCam ? <Video className="w-4 h-4 mr-1.5" /> : <VideoOff className="w-4 h-4 mr-1.5" />}
                  <span>{studioCam ? 'Turn Camera Off' : 'Turn Camera On'}</span>
                </Button>

                <Button
                  size="md"
                  variant={studioMic ? 'secondary' : 'danger'}
                  onClick={() => {
                    const next = !studioMic;
                    if (studioStream) {
                      const tr = studioStream.getAudioTracks()[0];
                      if (tr) tr.enabled = next;
                    }
                    setStudioMic(next);
                  }}
                >
                  {studioMic ? <Mic className="w-4 h-4 mr-1.5" /> : <MicOff className="w-4 h-4 mr-1.5" />}
                  <span>{studioMic ? 'Mute Microphone' : 'Unmute Microphone'}</span>
                </Button>

                <Button size="md" variant="secondary" onClick={handleStopStudioPreview}>
                  <PhoneOff className="w-4 h-4 mr-1.5" />
                  <span>Stop Hardware Test</span>
                </Button>
              </>
            ) : (
              <Button size="lg" variant="accent" onClick={handleStartStudioPreview}>
                <Video className="w-5 h-5 mr-2" />
                <span>Test Local Camera & Microphone</span>
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1222] space-y-4">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-cyan-400" />
              <span>Direct 1-on-1 Call Launcher</span>
            </h3>

            {user.isGuest ? (
              <div className="p-3 bg-amber-950/30 border border-amber-900/60 text-xs text-amber-300 rounded-lg">
                Guest accounts cannot place direct calls. Please register an account to call contacts.
              </div>
            ) : userConversations.length > 0 ? (
              <>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                    Select Peer Contact
                  </label>
                  <select
                    value={targetPartnerId}
                    onChange={(e) => setTargetPartnerId(e.target.value)}
                    className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    {userConversations.map((c) => (
                      <option key={c.partnerId} value={c.partnerId}>
                        {c.nickname} ({c.partnerId.slice(0, 8)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                    Call Media Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMediaKind('video')}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-center gap-1.5 transition-colors ${
                        mediaKind === 'video'
                          ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300 font-bold'
                          : 'border-slate-800 bg-[#101729] text-slate-400'
                      }`}
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Video Call</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMediaKind('audio')}
                      className={`p-2 rounded-lg border text-xs flex items-center justify-center gap-1.5 transition-colors ${
                        mediaKind === 'audio'
                          ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300 font-bold'
                          : 'border-slate-800 bg-[#101729] text-slate-400'
                      }`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Audio Call</span>
                    </button>
                  </div>
                </div>

                <Button
                  size="md"
                  variant="accent"
                  className="w-full"
                  disabled={isCallingTarget || isCallInProgress || !targetPartnerId}
                  onClick={handlePlaceCall}
                >
                  <PhoneCall className="w-4 h-4 mr-2" />
                  <span>{isCallingTarget ? 'Dialing...' : `Place ${mediaKind === 'video' ? 'Video' : 'Voice'} Call`}</span>
                </Button>
              </>
            ) : (
              <div className="p-4 text-center space-y-3">
                <MessageSquare className="w-8 h-8 text-slate-500 mx-auto" />
                <p className="text-xs text-slate-400">No conversations found with registered contacts. Start a chat in private messaging first.</p>
              </div>
            )}
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1222] space-y-4">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-cyan-400" />
              <span>{t.av.devicesLabel}</span>
            </h3>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                {t.av.videoDevice}
              </label>
              <select
                value={selectedVideoId}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {videoDevices.length > 0 ? (
                  videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))
                ) : (
                  <option value="">Default Web Camera</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1 font-medium">
                {t.av.audioDevice}
              </label>
              <select
                value={selectedAudioId}
                onChange={(e) => setSelectedAudioId(e.target.value)}
                className="w-full bg-[#101729] border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {audioDevices.length > 0 ? (
                  audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 5)}`}
                    </option>
                  ))
                ) : (
                  <option value="">Default System Microphone</option>
                )}
              </select>
            </div>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-[#0c1220] space-y-3">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              <span>WebRTC Mesh & Signaling Stack</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Standard browser RTCPeerConnection with DTLS-SRTP end-to-end media encryption. Signaling mediated via server-side authorization.
            </p>
            <div className="space-y-1.5 text-[11px] text-slate-500 font-mono">
              <div className="flex items-center justify-between">
                <span>Signaling Server:</span>
                <span className="text-emerald-400">SSE + Auth Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span>STUN Relay:</span>
                <span className="text-emerald-400">Google STUN Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span>TURN Fallback:</span>
                <span className="text-cyan-400">Configurable (.env)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
