import React, { useState, useEffect, useRef } from 'react';
import { EXOCLICK_CONFIG } from '../../config/adsConfig';
import { Volume2, VolumeX, Play, Pause, ExternalLink, Video } from 'lucide-react';

interface HorizontalVastVideoAdProps {
  className?: string;
  onStatusChange?: (status: 'loading' | 'filled' | 'unfilled' | 'error') => void;
}

interface ParsedVastAd {
  mediaFileUrl: string;
  clickThroughUrl?: string;
  impressionUrls: string[];
  trackingUrls: Record<string, string[]>;
}

export const HorizontalVastVideoAd: React.FC<HorizontalVastVideoAdProps> = ({
  className = '',
  onStatusChange,
}) => {
  const [adData, setAdData] = useState<ParsedVastAd | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'filled' | 'unfilled' | 'error'>('idle');
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const firedEventsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const fetchVastAd = async () => {
      setStatus('loading');
      onStatusChange?.('loading');

      try {
        const response = await fetch(EXOCLICK_CONFIG.horizontalVastUrl, {
          signal: controller.signal,
          headers: {
            Accept: 'application/xml, text/xml, */*',
          },
        });

        if (!response.ok) {
          if (isCurrent) {
            setStatus('error');
            onStatusChange?.('error');
          }
          return;
        }

        const xmlText = await response.text();
        if (!xmlText || !xmlText.includes('<VAST')) {
          if (isCurrent) {
            setStatus('unfilled');
            onStatusChange?.('unfilled');
          }
          return;
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

        // Check for XML parse error
        const parseError = xmlDoc.querySelector('parsererror');
        if (parseError) {
          if (isCurrent) {
            setStatus('unfilled');
            onStatusChange?.('unfilled');
          }
          return;
        }

        // Check for VAST Error element (no ad available)
        const vastError = xmlDoc.querySelector('VAST > Error');
        if (vastError && !xmlDoc.querySelector('MediaFile')) {
          if (isCurrent) {
            setStatus('unfilled');
            onStatusChange?.('unfilled');
          }
          return;
        }

        // Extract MediaFiles (prefer MP4 or WebM progressive files)
        const mediaFiles = Array.from(xmlDoc.querySelectorAll('MediaFile'));
        let selectedUrl = '';

        for (const mf of mediaFiles) {
          const type = (mf.getAttribute('type') || '').toLowerCase();
          const url = (mf.textContent || '').trim();
          if (url && (type.includes('mp4') || type.includes('webm') || url.endsWith('.mp4') || url.endsWith('.webm'))) {
            selectedUrl = url;
            break;
          }
        }

        if (!selectedUrl && mediaFiles.length > 0) {
          selectedUrl = (mediaFiles[0].textContent || '').trim();
        }

        if (!selectedUrl) {
          if (isCurrent) {
            setStatus('unfilled');
            onStatusChange?.('unfilled');
          }
          return;
        }

        // Extract ClickThrough
        const clickThroughEl = xmlDoc.querySelector('ClickThrough');
        const clickThroughUrl = clickThroughEl ? (clickThroughEl.textContent || '').trim() : undefined;

        // Extract Impressions
        const impressionUrls = Array.from(xmlDoc.querySelectorAll('Impression'))
          .map((el) => (el.textContent || '').trim())
          .filter(Boolean);

        // Extract TrackingEvents
        const trackingUrls: Record<string, string[]> = {};
        Array.from(xmlDoc.querySelectorAll('Tracking')).forEach((el) => {
          const eventName = el.getAttribute('event');
          const url = (el.textContent || '').trim();
          if (eventName && url) {
            if (!trackingUrls[eventName]) trackingUrls[eventName] = [];
            trackingUrls[eventName].push(url);
          }
        });

        if (isCurrent) {
          setAdData({
            mediaFileUrl: selectedUrl,
            clickThroughUrl,
            impressionUrls,
            trackingUrls,
          });
          setStatus('filled');
          onStatusChange?.('filled');

          // Fire impressions
          impressionUrls.forEach((impUrl) => {
            try {
              new Image().src = impUrl;
            } catch {
              // Ignore tracking beacon errors
            }
          });
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (isCurrent) {
          // Gracefully treat CORS or fetch error as unfilled/safe without breaking page
          setStatus('unfilled');
          onStatusChange?.('unfilled');
        }
      }
    };

    fetchVastAd();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, []);

  const fireTrackingEvent = (eventName: string) => {
    if (!adData || firedEventsRef.current.has(eventName)) return;
    firedEventsRef.current.add(eventName);

    const urls = adData.trackingUrls[eventName] || [];
    urls.forEach((url) => {
      try {
        new Image().src = url;
      } catch {
        // Ignore
      }
    });
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const { currentTime, duration } = videoRef.current;
    if (!duration || isNaN(duration)) return;

    const percent = currentTime / duration;
    if (percent >= 0.25) fireTrackingEvent('firstQuartile');
    if (percent >= 0.5) fireTrackingEvent('midpoint');
    if (percent >= 0.75) fireTrackingEvent('thirdQuartile');
  };

  const handleEnded = () => {
    fireTrackingEvent('complete');
    setIsPlaying(false);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted) fireTrackingEvent('unmute');
    else fireTrackingEvent('mute');
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      fireTrackingEvent('resume');
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      fireTrackingEvent('pause');
    }
  };

  if (status !== 'filled' || !adData) {
    return null;
  }

  return (
    <div
      data-testid="exoclick-horizontal-vast-container"
      className={`w-full max-w-3xl mx-auto my-4 bg-[#0a0f1d] border border-slate-800 rounded-2xl overflow-hidden shadow-xl ${className}`.trim()}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0c1324] border-b border-slate-800 text-xs text-slate-300">
        <div className="flex items-center gap-1.5 font-semibold">
          <Video className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Featured Video</span>
        </div>
        {adData.clickThroughUrl && (
          <a
            href={adData.clickThroughUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 hover:underline"
          >
            <span>Learn More</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Video Viewport (16:9 Aspect Ratio) */}
      <div className="relative aspect-video w-full bg-black flex items-center justify-center group overflow-hidden">
        <video
          ref={videoRef}
          src={adData.mediaFileUrl}
          playsInline
          muted
          autoPlay
          onPlay={() => {
            setIsPlaying(true);
            fireTrackingEvent('start');
          }}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          className="w-full h-full object-contain cursor-pointer"
          onClick={togglePlay}
        />

        {/* Video Overlay Controls */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-auto bg-black/40 backdrop-blur-xs px-2.5 py-1.5 rounded-lg border border-white/10 opacity-90 transition-opacity">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause video' : 'Play video'}
              className="p-1 rounded text-white hover:text-cyan-400 transition-colors cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
              className="p-1 rounded text-white hover:text-cyan-400 transition-colors cursor-pointer"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
            ExoClick VAST Video
          </span>
        </div>
      </div>
    </div>
  );
};
