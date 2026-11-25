import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import { useOptionalPrivateChat } from '../../context/PrivateChatContext';
import { EXOCLICK_CONFIG, isEligibleRouteForGlobalAds } from '../../config/adsConfig';
import { ensureHeadScriptOnce } from './AdPlacementBox';
import { X, Minimize2, Maximize2, Video } from 'lucide-react';

interface ExoClickVideoSliderProps {
  className?: string;
}

export const ExoClickVideoSlider: React.FC<ExoClickVideoSliderProps> = ({ className = '' }) => {
  const { currentRoute } = useRouter();
  const consent = useOptionalConsent();
  const privateChat = useOptionalPrivateChat();
  const hasAcceptedConsent = consent?.consentStatus === 'accepted';

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
  const [isCompactOrKeyboardOpen, setIsCompactOrKeyboardOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const initializedZoneRef = useRef<string | null>(null);

  const isEligible = hasAcceptedConsent && isEligibleRouteForGlobalAds(currentRoute);
  const isLiveChatRoute =
    currentRoute === '/chat' ||
    currentRoute === '/chat/bangla' ||
    currentRoute.startsWith('/chat') ||
    currentRoute === '/messages' ||
    currentRoute === '/random' ||
    currentRoute === '/av-chat';

  const hasActiveFloatingChat = Boolean(
    privateChat?.openWindows?.some(
      (w) => w.isOpen && w.displayMode === 'floating' && !w.isMinimized
    )
  );

  // Detect mobile virtual keyboard open, composer focus on compact screens, or short landscape viewports
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const evaluateViewportSafety = () => {
      const winH = window.innerHeight || 0;
      const winW = window.innerWidth || 0;
      const vv = window.visualViewport;
      const keyboardHeight = vv ? Math.max(0, winH - vv.height) : 0;
      const isShortLandscape = winH > 0 && winH < 480;
      const isKeyboardLikelyOpen = keyboardHeight > 140 || (vv ? vv.height < 460 : false);

      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const tagName = activeEl?.tagName?.toUpperCase() || '';
      const isEditableFocused =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        activeEl?.getAttribute?.('contenteditable') === 'true';
      const isMobileFocusedComposer = winW < 1024 && isEditableFocused;

      setIsCompactOrKeyboardOpen(
        isShortLandscape || isKeyboardLikelyOpen || isMobileFocusedComposer
      );
    };

    evaluateViewportSafety();
    window.addEventListener('resize', evaluateViewportSafety);
    window.visualViewport?.addEventListener('resize', evaluateViewportSafety);
    document.addEventListener('focusin', evaluateViewportSafety);
    document.addEventListener('focusout', evaluateViewportSafety);

    return () => {
      window.removeEventListener('resize', evaluateViewportSafety);
      window.visualViewport?.removeEventListener('resize', evaluateViewportSafety);
      document.removeEventListener('focusin', evaluateViewportSafety);
      document.removeEventListener('focusout', evaluateViewportSafety);
    };
  }, []);

  // Initialize ExoClick Video Slider once when eligible & accepted; never re-push on client route navigation
  useEffect(() => {
    isMountedRef.current = true;
    if (isDismissed || !isEligible) {
      initializedZoneRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      return;
    }

    if (!containerRef.current) {
      return;
    }

    const zoneId = EXOCLICK_CONFIG.videoSliderZoneId;
    if (
      initializedZoneRef.current === zoneId &&
      containerRef.current.querySelector(`ins[data-zoneid="${zoneId}"]`)
    ) {
      return;
    }

    const domId = `exoclick-slider-${zoneId}`;
    containerRef.current.innerHTML = `<ins class="${EXOCLICK_CONFIG.videoSliderElementClass}" data-zoneid="${zoneId}" id="${domId}"></ins>`;
    initializedZoneRef.current = zoneId;

    ensureHeadScriptOnce(EXOCLICK_CONFIG.scriptUrl, {
      isStillValid: () => isMountedRef.current && !isDismissed && isEligible,
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
  }, [isDismissed, isEligible]);

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

  // Non-destructively hide slider while mobile keyboard, short landscape viewport,
  // or open bottom-right floating private chat window needs that space; restores automatically afterward.
  const shouldTemporarilyHide = isCompactOrKeyboardOpen || hasActiveFloatingChat;

  // Lift safely above mobile/tablet composer + safe-area inset on <1024px; desktop bottom-right
  const bottomPlacementClass = isLiveChatRoute
    ? 'bottom-[calc(88px+env(safe-area-inset-bottom,0px))] lg:bottom-4'
    : 'bottom-[calc(12px+env(safe-area-inset-bottom,0px))] lg:bottom-4';

  return (
    <aside
      aria-label="Sponsored video advertisement"
      data-testid="exoclick-video-slider-container"
      aria-hidden={shouldTemporarilyHide ? 'true' : undefined}
      className={
        shouldTemporarilyHide
          ? 'hidden'
          : `fixed right-2 sm:right-4 ${bottomPlacementClass} z-40 max-w-[240px] sm:max-w-[300px] lg:max-w-[320px] w-full transition-all duration-300 ${className}`.trim()
      }
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

        {/* Keep video host mounted and toggle visibility via CSS so minimize/expand preserves state cleanly */}
        <div
          data-testid="exoclick-video-slider-host"
          ref={containerRef}
          className={
            isMinimized
              ? 'hidden'
              : 'w-full min-h-[160px] h-[180px] bg-black/60 flex items-center justify-center overflow-hidden'
          }
        />
      </div>
    </aside>
  );
};
