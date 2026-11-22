import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../../context/RouterContext';
import { EXOCLICK_CONFIG, isEligibleRouteForGlobalAds } from '../../config/adsConfig';
import { ensureHeadScriptOnce } from './AdPlacementBox';
import { X, Minimize2, Maximize2, Video } from 'lucide-react';

interface ExoClickVideoSliderProps {
  className?: string;
}

export const ExoClickVideoSlider: React.FC<ExoClickVideoSliderProps> = ({ className = '' }) => {
  const { currentRoute } = useRouter();
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem('vx_video_slider_dismissed') === 'true';
      }
    } catch {
      // Ignore
    }
    return false;
  });

  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  const isEligible = isEligibleRouteForGlobalAds(currentRoute);
  const isLiveChatRoute = currentRoute === '/chat' || currentRoute === '/chat/bangla' || currentRoute.startsWith('/chat');

  useEffect(() => {
    isMountedRef.current = true;
    if (isDismissed || !isEligible || !containerRef.current) {
      return;
    }

    const domId = `exoclick-slider-${EXOCLICK_CONFIG.videoSliderZoneId}`;
    containerRef.current.innerHTML = `<ins class="${EXOCLICK_CONFIG.videoSliderElementClass}" data-zoneid="${EXOCLICK_CONFIG.videoSliderZoneId}" id="${domId}"></ins>`;

    ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl, {
      isStillValid: () => isMountedRef.current && !isDismissed,
      onError: () => {
        // Safe fail-closed without crashing React
      },
    });

    const win = window as any;
    win.AdProvider = win.AdProvider || [];
    if (typeof win.AdProvider.push === 'function') {
      win.AdProvider.push({ serve: {} });
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isDismissed, isEligible, currentRoute]);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem('vx_video_slider_dismissed', 'true');
      }
    } catch {
      // Ignore
    }
  };

  const toggleMinimize = () => {
    setIsMinimized((prev) => !prev);
  };

  if (isDismissed || !isEligible) {
    return null;
  }

  // Positioning: On live chat, lift above mobile composer bar (bottom-24 on mobile, bottom-4 on desktop)
  const bottomPlacementClass = isLiveChatRoute
    ? 'bottom-[76px] sm:bottom-4'
    : 'bottom-2 sm:bottom-4';

  return (
    <aside
      aria-label="Sponsored video advertisement"
      data-testid="exoclick-video-slider-container"
      className={`fixed right-2 sm:right-4 ${bottomPlacementClass} z-40 max-w-[280px] sm:max-w-[320px] w-full transition-all duration-300 ${className}`.trim()}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="bg-[#0b1222]/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden ring-1 ring-white/10">
        {/* Header Bar with User Controls */}
        <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#0e172a] border-b border-slate-800 text-[11px] font-semibold text-slate-300 select-none">
          <div className="flex items-center gap-1.5">
            <Video className="w-3 h-3 text-cyan-400" />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Sponsored Video</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleMinimize}
              aria-label={isMinimized ? 'Expand video ad' : 'Minimize video ad'}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close and dismiss video ad"
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Video Player Container */}
        {!isMinimized && (
          <div
            data-testid="exoclick-video-slider-host"
            ref={containerRef}
            className="w-full min-h-[160px] h-[180px] bg-black/60 flex items-center justify-center overflow-hidden"
          />
        )}
      </div>
    </aside>
  );
};
