import React, { useState, useEffect, useRef } from 'react';
import { RoomBroadcast, AppLanguage } from '../../types';
import { Minus, Maximize2, Minimize2, X, Radio, Volume2, VolumeX, AlertCircle } from 'lucide-react';

interface FloatingBroadcastViewerProps {
  broadcast: RoomBroadcast;
  isBroadcaster: boolean;
  onClose: () => void;
  onEndBroadcast?: () => void;
  language: AppLanguage;
}

export const FloatingBroadcastViewer: React.FC<FloatingBroadcastViewerProps> = ({
  broadcast,
  isBroadcaster,
  onClose,
  onEndBroadcast,
  language,
}) => {
  const [displayMode, setDisplayMode] = useState<'normal' | 'minimized' | 'maximized'>('normal');
  const [isMuted, setIsMuted] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localMediaRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Set up broadcaster local preview or viewer media stream
  useEffect(() => {
    let isCancelled = false;

    async function initMedia() {
      setIsConnecting(true);
      setStreamError(null);

      if (isBroadcaster) {
        // Broadcaster: Acquire local camera stream for live preview
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStreamError('Camera access is not supported on this browser.');
            setIsConnecting(false);
            return;
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
            audio: true,
          });

          if (isCancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }

          localMediaRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.muted = true; // Broadcaster preview is muted to prevent local audio feedback loop
            videoRef.current.play().catch(() => setAutoplayBlocked(true));
          }
          setIsConnecting(false);
        } catch (err: any) {
          if (!isCancelled) {
            let msg = 'Failed to access camera/microphone.';
            if (err.name === 'NotAllowedError') {
              msg = 'Camera permission denied. Please allow camera access in browser settings.';
            } else if (err.name === 'NotFoundError') {
              msg = 'No camera or microphone hardware found.';
            }
            setStreamError(msg);
            setIsConnecting(false);
          }
        }
      } else {
        // Viewer: Check if SFU session credentials exist or show graceful unavailable state
        // In this phase, if SFU is not active on the worker, show clean status
        if (!broadcast.sessionId) {
          setIsConnecting(false);
          setStreamError(
            'Live Room SFU Broadcast requires Cloudflare Calls application credentials (CALLS_APP_ID, CALLS_APP_SECRET) to be configured in Worker environment.'
          );
          return;
        }

        // If session exists, viewer media attaches here
        setIsConnecting(false);
      }
    }

    initMedia();

    return () => {
      isCancelled = true;
      // Cleanup tracks on unmount
      if (localMediaRef.current) {
        localMediaRef.current.getTracks().forEach((track) => track.stop());
        localMediaRef.current = null;
      }
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch {}
        peerConnectionRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [isBroadcaster, broadcast.sessionId]);

  const handlePlayUnmute = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);
      videoRef.current
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {});
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const next = !videoRef.current.muted;
      videoRef.current.muted = next;
      setIsMuted(next);
    }
  };

  // Minimized Mode: Compact pill docked above mobile footer, keeping media streaming
  if (displayMode === 'minimized') {
    return (
      <div
        className="fixed bottom-20 right-4 z-40 bg-[#0c1220] border border-violet-600/70 rounded-xl shadow-2xl p-2.5 flex items-center gap-3 text-white cursor-pointer hover:border-violet-500 transition-all pointer-events-auto"
        onClick={() => setDisplayMode('normal')}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base select-none shrink-0">{broadcast.broadcasterAvatar || '👤'}</span>
          <div className="min-w-0">
            <div className="text-xs font-bold truncate flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <span className="truncate">{broadcast.broadcasterNickname}</span>
            </div>
            <span className="text-[10px] text-rose-400 font-semibold block">LIVE Broadcast</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setDisplayMode('normal')}
            className="p-1 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Restore"
            aria-label="Restore broadcast"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Close"
            aria-label="Close broadcast"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Normal (1:1 Compact) & Maximized Modes
  const containerClasses =
    displayMode === 'maximized'
      ? 'fixed inset-x-4 top-16 bottom-24 sm:inset-auto sm:top-20 sm:right-6 sm:w-[480px] sm:h-[480px] max-w-[95vw] max-h-[85vh] z-50 bg-[#0c1220] border-2 border-violet-600/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto transition-all duration-200'
      : 'fixed bottom-20 right-4 z-40 w-72 h-72 sm:w-80 sm:h-80 aspect-square bg-[#0c1220] border-2 border-violet-600/70 rounded-2xl shadow-2xl flex flex-col overflow-hidden pointer-events-auto transition-all duration-200';

  return (
    <div className={containerClasses}>
      {/* Broadcast Window Header */}
      <div className="px-3 py-2 bg-[#090d18] border-b border-slate-800/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base select-none shrink-0">{broadcast.broadcasterAvatar || '👤'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white truncate">{broadcast.broadcasterNickname}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            </div>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              {isBroadcaster ? 'Broadcasting to Room' : 'Room Live Stream'}
            </span>
          </div>
        </div>

        {/* Boxed Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {!isBroadcaster && (
            <button
              type="button"
              onClick={toggleMute}
              className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label="Toggle mute"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5 text-slate-300" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setDisplayMode('minimized')}
            className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
            title="Minimize"
            aria-label="Minimize broadcast"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setDisplayMode(displayMode === 'maximized' ? 'normal' : 'maximized')}
            className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
            title={displayMode === 'maximized' ? 'Restore to compact 1:1' : 'Maximize'}
            aria-label="Toggle maximize broadcast"
          >
            {displayMode === 'maximized' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg border border-slate-800 bg-[#101729] text-slate-400 hover:text-rose-400 hover:bg-slate-800 hover:border-rose-500/50 transition-colors cursor-pointer shrink-0 flex items-center justify-center"
            title="Close viewer"
            aria-label="Close broadcast viewer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        {/* Red LIVE Badge Overlay */}
        <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 bg-rose-600/90 text-white font-bold text-[10px] px-2 py-0.5 rounded shadow">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span>LIVE</span>
        </div>

        {/* Video Element */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full h-full object-cover ${isBroadcaster ? 'scale-x-[-1]' : ''}`}
        />

        {/* Loading Spinner */}
        {isConnecting && (
          <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center p-4 text-center z-10">
            <Radio className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
            <p className="text-xs font-semibold text-white">Connecting to Broadcast...</p>
            <p className="text-[10px] text-slate-400 mt-1">Negotiating WebRTC stream</p>
          </div>
        )}

        {/* Autoplay blocked overlay */}
        {autoplayBlocked && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-4 text-center z-20">
            <Volume2 className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-xs font-semibold text-white mb-2">Audio is muted by browser policy</p>
            <button
              onClick={handlePlayUnmute}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow cursor-pointer transition-colors"
            >
              Click to Play & Unmute
            </button>
          </div>
        )}

        {/* Error or SFU Unavailable Banner */}
        {streamError && (
          <div className="absolute inset-0 bg-[#090d18]/95 flex flex-col items-center justify-center p-4 text-center z-20">
            <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-xs font-bold text-white mb-1">
              {language === 'bn' ? 'সম্প্রচার সেবা অনুপলব্ধ' : 'Broadcast Notice'}
            </p>
            <p className="text-[11px] text-slate-300 leading-relaxed max-w-xs">{streamError}</p>
          </div>
        )}

        {/* Broadcaster End Controls at Bottom Overlay */}
        {isBroadcaster && onEndBroadcast && (
          <div className="absolute bottom-2 inset-x-2 z-20 flex justify-center">
            <button
              onClick={onEndBroadcast}
              className="px-3 py-1 rounded-lg bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-bold shadow-lg transition-colors cursor-pointer"
            >
              End Broadcast
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
