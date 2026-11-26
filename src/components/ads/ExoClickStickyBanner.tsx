import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import { useOptionalCall } from '../../context/CallContext';
import { EXOCLICK_CONFIG, isEligibleRouteForGlobalAds } from '../../config/adsConfig';
import { serveExoClickZones } from './AdPlacementBox';
import { X } from 'lucide-react';

interface ExoClickStickyBannerProps {
  className?: string;
}

const STICKY_DISMISS_STORAGE_KEY = 'vx_sticky_banner_dismissed';

export const ExoClickStickyBanner: React.FC<ExoClickStickyBannerProps> = ({ className = '' }) => {
  const { currentRoute } = useRouter();
  const consent = useOptionalConsent();
  const callCtx = useOptionalCall();
  const hasAcceptedConsent = consent?.consentStatus === 'accepted';

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage.getItem(STICKY_DISMISS_STORAGE_KEY) === 'true';
      }
    } catch {
      // Ignore storage errors
    }
    return false;
  });

  const [isViewportRestricted, setIsViewportRestricted] = useState<boolean>(false);
  const [hasFilledCreative, setHasFilledCreative] = useState<boolean>(false);
  const [hasNativeCloseButton, setHasNativeCloseButton] = useState<boolean>(false);
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

  // Keep sticky placement off compact/short viewports and active text inputs so nav & composer remain clear
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const evaluateSafety = () => {
      const winW = window.innerWidth || 0;
      const winH = window.innerHeight || 0;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const tagName = activeEl?.tagName?.toUpperCase() || '';
      const isEditableFocused =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        activeEl?.getAttribute?.('contenteditable') === 'true';

      const tooNarrowOrShort = winW < 1024 || winH < 580;
      setIsViewportRestricted(tooNarrowOrShort || isEditableFocused);
    };

    evaluateSafety();
    window.addEventListener('resize', evaluateSafety);
    window.addEventListener('orientationchange', evaluateSafety);
    document.addEventListener('focusin', evaluateSafety);
    document.addEventListener('focusout', evaluateSafety);

    return () => {
      window.removeEventListener('resize', evaluateSafety);
      window.removeEventListener('orientationchange', evaluateSafety);
      document.removeEventListener('focusin', evaluateSafety);
      document.removeEventListener('focusout', evaluateSafety);
    };
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    setHasFilledCreative(false);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(STICKY_DISMISS_STORAGE_KEY, 'true');
      }
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    const host = containerRef.current;

    if (isDismissed || !isEligible) {
      initializedZoneRef.current = null;
      setHasFilledCreative(false);
      setHasNativeCloseButton(false);
      if (host) {
        host.innerHTML = '';
      }
      return;
    }

    if (!host) return;

    const zoneId = EXOCLICK_CONFIG.stickyBannerZoneId; // 6110028
    const elementClass = EXOCLICK_CONFIG.stickyBannerElementClass; // eas6a97888e17
    if (
      initializedZoneRef.current !== zoneId ||
      !host.querySelector(`ins.${elementClass}[data-zoneid="${zoneId}"]`)
    ) {
      const domId = `exoclick-sticky-${zoneId}`;
      host.innerHTML = `<ins id="${domId}" class="${elementClass}" data-zoneid="${zoneId}"></ins>`;
      initializedZoneRef.current = zoneId;
      const insElement = host.querySelector?.(
        `ins.${elementClass}[data-zoneid="${zoneId}"]`
      ) as HTMLElement | null;

      void serveExoClickZones({
        element: insElement,
        isStillValid: () => isMountedRef.current && !isDismissed && isEligible,
        onScriptError: () => {
          if (isMountedRef.current) {
            setHasFilledCreative(false);
            setHasNativeCloseButton(false);
          }
        },
      });
    }

    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            if (!isMountedRef.current || !containerRef.current) return;
            const stickyBox = containerRef.current.querySelector('[id*="msg-sticky-container"]');
            const hasCreative = Boolean(
              stickyBox && containerRef.current.querySelector('img, iframe, video')
            );
            setHasFilledCreative(hasCreative);
            setHasNativeCloseButton(
              Boolean(containerRef.current.querySelector('[class*="msg-sticky-close-button"]'))
            );
          })
        : null;

    observer?.observe(host, { childList: true, subtree: true });

    const handleNativeCloseClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest?.('[class*="msg-sticky-close-button"]')) {
        handleDismiss();
      }
    };
    host.addEventListener('click', handleNativeCloseClick);

    return () => {
      isMountedRef.current = false;
      observer?.disconnect();
      host.removeEventListener('click', handleNativeCloseClick);
    };
  }, [isDismissed, isEligible]);

  if (isDismissed || !isEligible) {
    return null;
  }

  const shouldTemporarilyHide = isViewportRestricted || hasLiveCall;

  return (
    <aside
      aria-label="Sponsored sticky banner"
      data-testid="exoclick-sticky-banner-container"
      data-exoclick-zone={EXOCLICK_CONFIG.stickyBannerZoneId}
      aria-hidden={shouldTemporarilyHide ? 'true' : undefined}
      className={
        shouldTemporarilyHide
          ? 'hidden'
          : `fixed left-4 bottom-4 z-[38] max-w-[300px] transition-opacity duration-200 ${className}`.trim()
      }
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {hasFilledCreative && !hasNativeCloseButton && (
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close sticky advertisement"
          className="fixed left-[292px] bottom-[254px] z-[39] p-1 rounded-full bg-[#0e172a]/95 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 shadow-lg cursor-pointer"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <div ref={containerRef} data-testid="exoclick-sticky-banner-host" />
    </aside>
  );
};
