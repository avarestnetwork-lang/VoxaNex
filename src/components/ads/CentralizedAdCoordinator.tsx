import React, { useEffect, useRef } from 'react';
import { useRouter } from '../../context/RouterContext';
import {
  JUICYADS_CONFIG,
  getJuicyAdsPageLoadAlternation,
  isEligibleRouteForGlobalAds,
} from '../../config/adsConfig';
import { ensureHeadScriptOnce } from './AdPlacementBox';
import { ExoClickVideoSlider } from './ExoClickVideoSlider';

export const CentralizedAdCoordinator: React.FC = () => {
  const { currentRoute } = useRouter();
  const isMountedRef = useRef(true);

  const isEligible = isEligibleRouteForGlobalAds(currentRoute);
  const { zone: activeJuicyAdsZone } = getJuicyAdsPageLoadAlternation();

  // JuicyAds Native Floating Ad (Zone 1133907)
  // Only active when alternating zone is 1133907 AND route is eligible
  useEffect(() => {
    isMountedRef.current = true;
    if (!isEligible || activeJuicyAdsZone !== '1133907') {
      return;
    }

    try {
      const win = window as any;
      win.juicy_adzone = JUICYADS_CONFIG.zones.floating; // '1133907'

      ensureHeadScriptOnce(JUICYADS_CONFIG.floatingScriptUrl, {
        isStillValid: () => isMountedRef.current && isEligible && activeJuicyAdsZone === '1133907',
        onError: () => {
          // Graceful fail-closed
        },
      });
    } catch {
      // Safe fail-closed
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [isEligible, activeJuicyAdsZone, currentRoute]);

  if (!isEligible) {
    return null;
  }

  return (
    <div
      data-testid="centralized-ad-coordinator"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {/* 
        ExoClick Video Slider (Zone 6102494) 
        Compact desktop bottom-right, mobile bottom-safe, never covering chat composer
      */}
      <div className="pointer-events-auto">
        <ExoClickVideoSlider />
      </div>

      {/* 
        JuicyAds Floating Placement Container Anchor (Zone 1133907)
        Positioned on bottom-left on desktop to prevent collision with ExoClick Video Slider on bottom-right.
        Hidden on mobile if screen is compact to prioritize the Video Slider without crowding.
      */}
      {activeJuicyAdsZone === '1133907' && (
        <div
          data-testid="juicyads-floating-anchor"
          className="pointer-events-auto hidden sm:block fixed left-4 bottom-4 z-40 max-w-[320px]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* jfc.js renders native floating elements anchored to page */}
        </div>
      )}
    </div>
  );
};
