import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import { useOptionalPrivateChat } from '../../context/PrivateChatContext';
import { useOptionalCall } from '../../context/CallContext';
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
  const callCtx = useOptionalCall();
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
  const [sliderAspectStyle, setSliderAspectStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const initializedZoneRef = useRef<string | null>(null);

  const browserPathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  const isRouteEligible =
    isEligibleRouteForGlobalAds(currentRoute) &&
    (!browserPathname || isEligibleRouteForGlobalAds(browserPathname));

  const isVideoCallRoute =
    currentRoute === '/av-chat' ||
    currentRoute === '/chat/video' ||
    browserPathname === '/av-chat' ||
    browserPathname === '/chat/video';

  const hasLiveCall = Boolean(
    callCtx?.isCallModalOpen || (callCtx?.activeCall && callCtx.activeCall.status !== 'ended')
  );

  const isEligible = hasAcceptedConsent && isRouteEligible && !isVideoCallRoute;
  const isLiveChatRoute =
    currentRoute === '/chat' ||
    currentRoute === '/chat/bangla' ||
    currentRoute.startsWith('/chat') ||
    currentRoute === '/messages' ||
    currentRoute === '/random';

  const hasActiveFloatingChat = Boolean(
    privateChat?.openWindows?.some(
      (w) => w.isOpen && w.displayMode === 'floating' && !w.isMinimized
    )
  );

  // Detect mobile virtual keyboard open, composer focus on compact screens, orientation changes, or short landscape viewports
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
    window.addEventListener('orientationchange', evaluateViewportSafety);
    window.visualViewport?.addEventListener('resize', evaluateViewportSafety);
    document.addEventListener('focusin', evaluateViewportSafety);
    document.addEventListener('focusout', evaluateViewportSafety);

    return () => {
      window.removeEventListener('resize', evaluateViewportSafety);
      window.removeEventListener('orientationchange', evaluateViewportSafety);
      window.visualViewport?.removeEventListener('resize', evaluateViewportSafety);
      document.removeEventListener('focusin', evaluateViewportSafety);
      document.removeEventListener('focusout', evaluateViewportSafety);
    };
  }, []);

  // Measure creative dimensions inside host and adapt height without distortion, clipping, or overflow
  useEffect(() => {
    const host = containerRef.current;
    if (!host || isDismissed || !isEligible) return;

    const syncCreativeSizing = () => {
      const hostEl = containerRef.current;
      if (!hostEl) return;
      const hostWidth = hostEl.clientWidth || 280;
      const video = hostEl.querySelector('video') as HTMLVideoElement | null;
      const img = hostEl.querySelector('img') as HTMLImageElement | null;
      const iframe = hostEl.querySelector('iframe') as HTMLIFrameElement | null;

      let intrinsicW = 0;
      let intrinsicH = 0;

      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        intrinsicW = video.videoWidth;
        intrinsicH = video.videoHeight;
      } else if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        intrinsicW = img.naturalWidth;
        intrinsicH = img.naturalHeight;
      } else if (iframe) {
        const styleW = parseInt(iframe.style?.maxWidth || '', 10);
        const styleH = parseInt(iframe.style?.maxHeight || '', 10);
        if (styleW > 0 && styleH > 0) {
          intrinsicW = styleW;
          intrinsicH = styleH;
        }
      }

      if (intrinsicW > 0 && intrinsicH > 0) {
        const maxAllowedH = typeof window !== 'undefined' && window.innerWidth >= 1024 ? 260 : 200;
        const scaledH = Math.max(48, Math.min(maxAllowedH, Math.round((hostWidth * intrinsicH) / intrinsicW)));
        setSliderAspectStyle({ height: `${scaledH}px` });
      }
    };

    const mutObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(syncCreativeSizing)
        : null;
    mutObserver?.observe(host, { childList: true, subtree: true, attributes: true });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(syncCreativeSizing)
        : null;
    resizeObserver?.observe(host);

    return () => {
      mutObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [isDismissed, isEligible]);

  // Pause strictly scoped slider video elements if temporarily hidden or live call opens (never touches user video players)
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    if (isCompactOrKeyboardOpen || hasActiveFloatingChat || hasLiveCall || isMinimized) {
      host.querySelectorAll('video').forEach((v) => {
        try {
          if (!v.paused) v.pause();
        } catch {
          // Ignore playback control error
        }
      });
    }
  }, [isCompactOrKeyboardOpen, hasActiveFloatingChat, hasLiveCall, isMinimized]);

  // Initialize ExoClick Video Slider once when eligible & accepted; never re-push on client route navigation
  useEffect(() => {
    isMountedRef.current = true;
    if (isDismissed || !isEligible) {
      initializedZoneRef.current = null;
      if (containerRef.current) {
        containerRef.current.querySelectorAll('video').forEach((v) => {
          try {
            v.pause();
          } catch {
            // Ignore
          }
        });
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
    if (containerRef.current) {
      containerRef.current.querySelectorAll('video').forEach((v) => {
        try {
          v.pause();
        } catch {
          // Ignore
        }
      });
    }
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
  // live WebRTC call, or open bottom-right floating private chat window needs that space
  const shouldTemporarilyHide = isCompactOrKeyboardOpen || hasActiveFloatingChat || hasLiveCall;

  // Lift safely above mobile/tablet composer + safe-area inset on <1024px; desktop bottom-right
  const bottomPlacementClass = isLiveChatRoute
    ? 'bottom-[calc(88px+env(safe-area-inset-bottom,0px))] lg:bottom-4'
    : 'bottom-[calc(12px+env(safe-area-inset-bottom,0px))] lg:bottom-4';

  return (
    <aside
      aria-label="Sponsored video advertisement"
      data-testid="exoclick-video-slider-container"
      data-exoclick-zone={EXOCLICK_CONFIG.videoSliderZoneId}
      aria-hidden={shouldTemporarilyHide ? 'true' : undefined}
      className={
        shouldTemporarilyHide
          ? 'hidden'
          : `fixed right-2 sm:right-4 ${bottomPlacementClass} z-40 w-[min(288px,calc(100vw-16px))] sm:w-[300px] lg:w-[320px] xl:w-[340px] max-w-[calc(100vw-16px)] transition-all duration-300 ${className}`.trim()
      }
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="bg-[#0b1222]/95 border border-slate-700/80 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden ring-1 ring-white/10">
        {/* Header Bar with Tap-Safe User Controls */}
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-[#0e172a] border-b border-slate-800 text-[11px] font-semibold text-slate-300 select-none">
          <div className="flex items-center gap-1.5 min-w-0">
            <Video className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-slate-400 truncate">
              Sponsored Video
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleMinimize}
              aria-label={isMinimized ? 'Expand video ad' : 'Minimize video ad'}
              className="min-w-[28px] min-h-[28px] p-1.5 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {isMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close and dismiss video ad"
              className="min-w-[28px] min-h-[28px] p-1.5 rounded flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Keep video host mounted and adapt height smoothly to creative dimensions without cropping/distortion */}
        <div
          data-testid="exoclick-video-slider-host"
          ref={containerRef}
          className={
            isMinimized
              ? 'hidden'
              : 'w-full min-h-[64px] max-h-[min(220px,36dvh)] lg:max-h-[260px] bg-black/70 flex items-center justify-center overflow-hidden'
          }
          style={isMinimized ? undefined : sliderAspectStyle}
        />
      </div>
    </aside>
  );
};
