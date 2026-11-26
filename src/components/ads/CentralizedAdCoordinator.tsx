import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import {
  JUICYADS_CONFIG,
  isEligibleRouteForGlobalAds,
} from '../../config/adsConfig';
import { ensureHeadScriptOnce } from './AdPlacementBox';
import { ExoClickVideoSlider } from './ExoClickVideoSlider';

export interface JuicyAdsFloatingDecision {
  shouldExposeLeftAnchor: boolean;
  shouldSetRootLeftAttr: boolean;
  shouldInjectScript: boolean;
  isPostLoadDeferred: boolean;
  reason: string;
}

export function evaluateJuicyAdsFloatingState(params: {
  hasAcceptedConsent: boolean;
  isEligibleRoute: boolean;
  documentReadyState?: DocumentReadyState;
  hasExistingFadeInBox?: boolean;
  hasExistingFloatingScript?: boolean;
}): JuicyAdsFloatingDecision {
  if (!params.hasAcceptedConsent) {
    return {
      shouldExposeLeftAnchor: false,
      shouldSetRootLeftAttr: false,
      shouldInjectScript: false,
      isPostLoadDeferred: false,
      reason: 'Consent not accepted',
    };
  }

  if (!params.isEligibleRoute) {
    return {
      shouldExposeLeftAnchor: false,
      shouldSetRootLeftAttr: false,
      shouldInjectScript: false,
      isPostLoadDeferred: false,
      reason: 'Route excluded from global ads',
    };
  }

  // If jfc.js or #fadeinbox is already present in DOM (e.g., consent re-accepted after prior withdrawal),
  // restore the left anchor safely without duplicating scripts or #fadeinbox nodes.
  if (params.hasExistingFadeInBox || params.hasExistingFloatingScript) {
    return {
      shouldExposeLeftAnchor: true,
      shouldSetRootLeftAttr: true,
      shouldInjectScript: false,
      isPostLoadDeferred: false,
      reason: 'Existing jfc.js or #fadeinbox present; restoring left anchor without duplication',
    };
  }

  // JuicyAds jfc.js loads fadeinbox.js/fib.js, which binds initialization strictly to window.load
  // and immediately sets document.cookie="juicy_fadedin=yes". When consent is accepted after window.load
  // (readyState === 'complete'), JuicyAds exposes no documented post-load reinitialization API.
  // Defer jfc.js cleanly to the next eligible page load instead of dispatching synthetic window.load
  // or reloading the page.
  if (params.documentReadyState === 'complete') {
    return {
      shouldExposeLeftAnchor: true,
      shouldSetRootLeftAttr: false,
      shouldInjectScript: false,
      isPostLoadDeferred: true,
      reason: 'Post-window.load consent acceptance: deferred jfc.js until next eligible page load',
    };
  }

  return {
    shouldExposeLeftAnchor: true,
    shouldSetRootLeftAttr: true,
    shouldInjectScript: true,
    isPostLoadDeferred: false,
    reason: 'Pre-load consented & eligible: initialize JuicyAds zone 1133907 via jfc.js',
  };
}

export const CentralizedAdCoordinator: React.FC = () => {
  const { currentRoute } = useRouter();
  const consent = useOptionalConsent();
  const hasAcceptedConsent = consent?.consentStatus === 'accepted';
  const isMountedRef = useRef(true);
  const hasTriggeredJuicyFloatRef = useRef(false);
  const [isPostLoadDeferred, setIsPostLoadDeferred] = useState(false);

  const browserPathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  const isRouteEligible =
    isEligibleRouteForGlobalAds(currentRoute) &&
    (!browserPathname || isEligibleRouteForGlobalAds(browserPathname));
  const isEligible = hasAcceptedConsent && isRouteEligible;

  // Manage root data attribute and JuicyAds Floating Ad (Zone 1133907 -> jfc.js -> #fadeinbox)
  // Independently active on all eligible consented pages (no alternation lock with 1133909).
  useEffect(() => {
    isMountedRef.current = true;

    if (typeof document === 'undefined') {
      return;
    }

    const existingScript = document.querySelector(
      `script[src="${JUICYADS_CONFIG.floatingScriptUrl}"]`
    ) as HTMLScriptElement | null;
    const hasHealthyFloatingScript = Boolean(
      existingScript && existingScript.getAttribute('data-ad-script-error') !== 'true'
    );
    const hasExistingFadeInBox = Boolean(document.getElementById('fadeinbox'));

    const decision = evaluateJuicyAdsFloatingState({
      hasAcceptedConsent,
      isEligibleRoute: isRouteEligible,
      documentReadyState: document.readyState,
      hasExistingFadeInBox,
      hasExistingFloatingScript: hasHealthyFloatingScript,
    });

    setIsPostLoadDeferred(decision.isPostLoadDeferred);

    if (decision.shouldSetRootLeftAttr) {
      document.documentElement.setAttribute('data-vx-juicy-float', 'left');
    } else {
      document.documentElement.removeAttribute('data-vx-juicy-float');
    }

    if (
      decision.shouldInjectScript &&
      !hasTriggeredJuicyFloatRef.current &&
      !hasHealthyFloatingScript &&
      !hasExistingFadeInBox
    ) {
      hasTriggeredJuicyFloatRef.current = true;
      try {
        const win = window as any;
        win.juicy_adzone = JUICYADS_CONFIG.zones.floating; // '1133907'

        ensureHeadScriptOnce(JUICYADS_CONFIG.floatingScriptUrl, {
          isStillValid: () => isMountedRef.current && hasAcceptedConsent && isEligibleRouteForGlobalAds(currentRoute),
          onError: () => {
            hasTriggeredJuicyFloatRef.current = false;
          },
        });
      } catch {
        hasTriggeredJuicyFloatRef.current = false;
      }
    }

    return () => {
      isMountedRef.current = false;
      document.documentElement.removeAttribute('data-vx-juicy-float');
    };
  }, [hasAcceptedConsent, isRouteEligible, currentRoute]);

  if (!isEligible) {
    return null;
  }

  return (
    <div
      data-testid="centralized-ad-coordinator"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {/*
        RIGHT SIDE: ExoClick Video Slider (Zone 6102500 / eas6a97888e38)
        Desktop bottom-right; lifted above mobile composer when needed; never covers chat controls.
      */}
      <div className="pointer-events-auto">
        <ExoClickVideoSlider />
      </div>

      {/*
        LEFT SIDE: JuicyAds Floating Placement Anchor (Zone 1133907 -> #fadeinbox)
        Positioned bottom-left on desktop (>=1024px) opposite ExoClick Video Slider on bottom-right.
        Hidden on compact/mobile screens (<1024px) to protect chat UX.
      */}
      <div
        data-testid="juicyads-floating-anchor"
        data-juicyads-zone={JUICYADS_CONFIG.zones.floating}
        data-juicyads-post-load-deferred={isPostLoadDeferred ? 'true' : 'false'}
        className="pointer-events-auto hidden lg:block fixed left-4 bottom-4 z-40 max-w-[320px]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* jfc.js appends #fadeinbox to document.body; CSS anchors it bottom-left via html[data-vx-juicy-float="left"] */}
      </div>
    </div>
  );
};
