import React, { useEffect, useRef } from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import {
  JUICYADS_CONFIG,
  getJuicyAdsPageLoadAlternation,
  isEligibleRouteForGlobalAds,
} from '../../config/adsConfig';
import { ensureHeadScriptOnce } from './AdPlacementBox';
import { ExoClickVideoSlider } from './ExoClickVideoSlider';

export const CentralizedAdCoordinator: React.FC = () => {
  const { currentRoute } = useRouter();
  const consent = useOptionalConsent();
  const hasAcceptedConsent = consent?.consentStatus === 'accepted';
  const isMountedRef = useRef(true);
  const hasTriggeredJuicyFloatRef = useRef(false);

  const isEligible = hasAcceptedConsent && isEligibleRouteForGlobalAds(currentRoute);
  const { zone: activeJuicyAdsZone } = getJuicyAdsPageLoadAlternation();

  // Manage root data attribute so global CSS positions #fadeinbox on bottom-left desktop
  // when eligible + consented, and hides it non-destructively when ineligible or unconsented.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isEligible && activeJuicyAdsZone === '1133907') {
      document.documentElement.setAttribute('data-vx-juicy-float', 'left');
    } else {
      document.documentElement.removeAttribute('data-vx-juicy-float');
    }

    return () => {
      document.documentElement.removeAttribute('data-vx-juicy-float');
    };
  }, [isEligible, activeJuicyAdsZone]);

  // JuicyAds Native Floating Ad (Zone 1133907 -> jfc.js -> #fadeinbox)
  // Initializes once per page load ONLY when consent is accepted, route is eligible, and zone is 1133907.
  useEffect(() => {
    isMountedRef.current = true;
    if (!isEligible || activeJuicyAdsZone !== '1133907' || hasTriggeredJuicyFloatRef.current) {
      return;
    }

    hasTriggeredJuicyFloatRef.current = true;
    try {
      const win = window as any;
      win.juicy_adzone = JUICYADS_CONFIG.zones.floating; // '1133907'

      ensureHeadScriptOnce(JUICYADS_CONFIG.floatingScriptUrl, {
        isStillValid: () => isMountedRef.current && isEligible && activeJuicyAdsZone === '1133907',
        onError: () => {
          hasTriggeredJuicyFloatRef.current = false;
        },
      });
    } catch {
      hasTriggeredJuicyFloatRef.current = false;
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isEligible, activeJuicyAdsZone]);

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
      {activeJuicyAdsZone === '1133907' && (
        <div
          data-testid="juicyads-floating-anchor"
          className="pointer-events-auto hidden lg:block fixed left-4 bottom-4 z-40 max-w-[320px]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* jfc.js appends #fadeinbox to document.body; CSS anchors it bottom-left via html[data-vx-juicy-float="left"] */}
        </div>
      )}
    </div>
  );
};
