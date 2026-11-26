import React from 'react';
import { useRouter } from '../../context/RouterContext';
import { useOptionalConsent } from '../../context/ConsentContext';
import { isEligibleRouteForGlobalAds } from '../../config/adsConfig';
import { ExoClickVideoSlider } from './ExoClickVideoSlider';
import { ExoClickStickyBanner } from './ExoClickStickyBanner';

export const CentralizedAdCoordinator: React.FC = () => {
  const { currentRoute } = useRouter();
  const consent = useOptionalConsent();
  const hasAcceptedConsent = consent?.consentStatus === 'accepted';

  const browserPathname = typeof window !== 'undefined' ? window.location?.pathname || '' : '';
  const isRouteEligible =
    isEligibleRouteForGlobalAds(currentRoute) &&
    (!browserPathname || isEligibleRouteForGlobalAds(browserPathname));
  const isEligible = hasAcceptedConsent && isRouteEligible;

  if (!isEligible) {
    return null;
  }

  return (
    <div
      data-testid="centralized-ad-coordinator"
      className="pointer-events-none fixed inset-0 z-40 overflow-hidden"
    >
      {/* RIGHT SIDE: ExoClick Video Slider (Zone 6102500 / eas6a97888e38) */}
      <div className="pointer-events-auto">
        <ExoClickVideoSlider />
      </div>

      {/* LEFT SIDE: ExoClick Sticky Banner (Zone 6110028 / eas6a97888e17) */}
      <div className="pointer-events-auto">
        <ExoClickStickyBanner />
      </div>
    </div>
  );
};
