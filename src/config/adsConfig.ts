export type AdProvider = 'adsterra' | 'exoclick' | 'adsense';

export const ADSTERRA_CONFIG = {
  publisherId: '6190760',
  nativeUnitId: '4085ad0bb94688c1cdc0917f2df29137',
  banner300x250: '6863f1ca8dc093d7a0a913d8f30c47a2',
  banner320x50: '8b239fe78d1bba05c2a125bb36872489',
  banner728x90: 'd8696ddef865fbc92f612a0124ae627f',
  bannerDomain: 'www.highrevenueformat.com',
  nativeDomain: 'pl32301907.profitableratecpmnetwork.com',
  enabled: true,
};

export const EXOCLICK_CONFIG = {
  // Dedicated 300x250 banner zone (eas6a97888e2) - use strictly in containers >= 300x250
  zoneId: '6087300',
  elementClass: 'eas6a97888e2',
  // User-supplied ExoClick Multi-Format Banner zone (eas6a97888e38) - chatroom horizontal/responsive placements
  responsiveBannerZoneId: '6109952',
  responsiveBannerElementClass: 'eas6a97888e38',
  // User-supplied ExoClick Multi-Format zone (eas6a97888e38) - public non-chat content-gap placements
  multiFormatZoneId: '6102500',
  multiFormatElementClass: 'eas6a97888e38',
  // User-supplied ExoClick Sticky Banner zone (eas6a97888e17)
  stickyBannerZoneId: '6110028',
  stickyBannerElementClass: 'eas6a97888e17',
  // ExoClick Video Slider zone (eas6a97888e31)
  videoSliderZoneId: '6102494',
  videoSliderElementClass: 'eas6a97888e31',
  // User-supplied ExoClick VAST Video zone
  horizontalVastZoneId: '6109970',
  horizontalVastUrl: 'https://s.magsrv.com/v1/vast.php?idz=6109970',
  scriptUrl: 'https://a.magsrv.com/ad-provider.js',
  verificationFile: '28befc4532cb8837aa59edffca607a5a.html',
  integrationType: 'async' as const,
  // ExoClick native Ad Refresh supports 30, 60, 90, 120s (max 10 session rotations) on async zones
  // ONLY when enabled & authorized for the zone in ExoClick's publisher dashboard.
  nativeRefreshAuthorized: false,
  supportedNativeRefreshIntervalsSec: [30, 60, 90, 120] as const,
  chosenNativeRefreshIntervalSec: 120,
  maxSessionRotations: 10,
  enabled: true,
};

export const ADSENSE_CONFIG = {
  publisherId: 'ca-pub-7862321512207088',
  adSlot: '1929701241',
  enabled: true, // Enabled for non-chat pages ONLY; strictly excluded from live-chat routes
};

export const TRAFFICSTARS_CONFIG = {
  // Public ads.txt authorizes publisher ID 354866, but no MasterSpot zone ID or script is configured/authorized.
  adsTxtPublisherId: '354866',
  masterSpotZoneId: null as string | null,
  masterSpotRefreshAuthorized: false,
  supportedMasterSpotRefreshIntervalsSec: [30, 60, 90, 120] as const,
  chosenMasterSpotRefreshIntervalSec: 120,
  enabled: false,
};

export type RefreshCapableProvider = AdProvider | 'trafficstars';

export interface ProviderRefreshPolicy {
  provider: RefreshCapableProvider;
  enabled: boolean;
  supportsNativeRefresh: boolean;
  accountAuthorized: boolean;
  supportedIntervalsSec: readonly number[];
  chosenIntervalSec: number | null;
  maxSessionRotations: number | null;
  requiresVisibility: boolean;
  usesCustomJsTimer: false;
  mechanism: 'provider_native_async' | 'none';
  reason: string;
}

export const getProviderRefreshPolicy = (
  provider: RefreshCapableProvider,
  options?: { accountAuthorizedOverride?: boolean; zoneIdOverride?: string | null }
): ProviderRefreshPolicy => {
  if (provider === 'exoclick') {
    const authorized =
      options?.accountAuthorizedOverride !== undefined
        ? options.accountAuthorizedOverride
        : Boolean(EXOCLICK_CONFIG.enabled && EXOCLICK_CONFIG.nativeRefreshAuthorized);
    return {
      provider: 'exoclick',
      enabled: EXOCLICK_CONFIG.enabled,
      supportsNativeRefresh: true,
      accountAuthorized: authorized,
      supportedIntervalsSec: EXOCLICK_CONFIG.supportedNativeRefreshIntervalsSec,
      chosenIntervalSec: authorized ? EXOCLICK_CONFIG.chosenNativeRefreshIntervalSec : null,
      maxSessionRotations: EXOCLICK_CONFIG.maxSessionRotations,
      requiresVisibility: true,
      usesCustomJsTimer: false,
      mechanism: authorized ? 'provider_native_async' : 'none',
      reason: authorized
        ? 'ExoClick native async Ad Refresh authorized at longest 120s interval with 10 rotations/session cap'
        : 'ExoClick native Ad Refresh supports 30/60/90/120s (max 10/session), but dashboard authorization is unverified; custom JS timers disabled',
    };
  }

  if (provider === 'trafficstars') {
    const hasZone = Boolean(
      options?.zoneIdOverride !== undefined
        ? options.zoneIdOverride
        : TRAFFICSTARS_CONFIG.masterSpotZoneId
    );
    const authorized =
      options?.accountAuthorizedOverride !== undefined
        ? options.accountAuthorizedOverride && hasZone
        : Boolean(
            TRAFFICSTARS_CONFIG.enabled &&
              hasZone &&
              TRAFFICSTARS_CONFIG.masterSpotRefreshAuthorized
          );
    return {
      provider: 'trafficstars',
      enabled: TRAFFICSTARS_CONFIG.enabled,
      supportsNativeRefresh: true,
      accountAuthorized: authorized,
      supportedIntervalsSec: TRAFFICSTARS_CONFIG.supportedMasterSpotRefreshIntervalsSec,
      chosenIntervalSec: authorized ? TRAFFICSTARS_CONFIG.chosenMasterSpotRefreshIntervalSec : null,
      maxSessionRotations: null,
      requiresVisibility: true,
      usesCustomJsTimer: false,
      mechanism: authorized ? 'provider_native_async' : 'none',
      reason: authorized
        ? 'TrafficStars MasterSpot built-in refresh authorized at longest 120s interval'
        : 'TrafficStars MasterSpot zone & account authorization unverified (ads.txt tsyndicate.com 354866 only); custom JS refresh prohibited',
    };
  }

  if (provider === 'adsterra') {
    return {
      provider: 'adsterra',
      enabled: ADSTERRA_CONFIG.enabled,
      supportsNativeRefresh: false,
      accountAuthorized: false,
      supportedIntervalsSec: [],
      chosenIntervalSec: null,
      maxSessionRotations: null,
      requiresVisibility: true,
      usesCustomJsTimer: false,
      mechanism: 'none',
      reason: 'Adsterra standard tags rely on natural page navigation and prohibit code-altering auto-refresh timers',
    };
  }

  return {
    provider: 'adsense',
    enabled: ADSENSE_CONFIG.enabled,
    supportsNativeRefresh: false,
    accountAuthorized: false,
    supportedIntervalsSec: [],
    chosenIntervalSec: null,
    maxSessionRotations: null,
    requiresVisibility: true,
    usesCustomJsTimer: false,
    mechanism: 'none',
    reason: 'Google AdSense does not support timer-based ad auto-refresh',
  };
};

export const PROVIDER_REFRESH_POLICIES: Record<RefreshCapableProvider, ProviderRefreshPolicy> = {
  exoclick: getProviderRefreshPolicy('exoclick'),
  trafficstars: getProviderRefreshPolicy('trafficstars'),
  adsterra: getProviderRefreshPolicy('adsterra'),
  adsense: getProviderRefreshPolicy('adsense'),
};

export const ADSENSE_EXCLUDED_ROUTES = [
  '/chat',
  '/messages',
  '/random',
  '/av-chat',
  '/chat/video',
  '/guest-entry',
  '/age-gate',
  '/register',
  '/login',
  '/auth',
  '/user/guest-entry',
  '/user/register',
  '/user/login',
  '/user/reset-password',
  '/user/password-reset',
  '/user/account-recovery',
  '/admin',
  '/moderator',
  '/checkout',
  '/payment',
];

export const isAdSenseExcludedRoute = (currentRoute: string): boolean => {
  const raw = (currentRoute || '').trim().toLowerCase().split(/[?#]/)[0];
  if (!raw) return false;
  const normalized = raw.replace(/\/+$/, '') || '/';

  return ADSENSE_EXCLUDED_ROUTES.some((route) =>
    normalized === route ||
    normalized.startsWith(`${route}/`) ||
    normalized.startsWith('/chat/') ||
    normalized.startsWith('/admin/') ||
    normalized.startsWith('/moderator/') ||
    normalized.includes('/messages') ||
    normalized.includes('/av-chat')
  );
};

/**
 * Selection strategy: Deterministic provider priority list.
 * CRITICAL POLICY:
 * - Google AdSense is STRICTLY EXCLUDED from live-chat screens (/chat).
 * - Adsterra is STRICTLY Footer-only (global-footer-responsive).
 * - Live chatroom placements use ExoClick exclusively.
 * - Non-chat, non-footer public pages use AdSense primary with ExoClick failover.
 */
export const getProviderRotation = (
  position: string,
  isLiveChatScreen: boolean = true,
  slotId?: string
): AdProvider[] => {
  if (position === 'footer' || slotId === 'global-footer-responsive' || Boolean(slotId?.includes('footer'))) {
    return ['adsterra'];
  }
  if (isLiveChatScreen) {
    return ['exoclick'];
  }

  return ['adsense', 'exoclick'];
};

export const FOOTER_EXCLUDED_ROUTES = [
  '/age-gate',
  '/guest-entry',
  '/register',
  '/login',
  '/user/login',
  '/user/register',
  '/user/guest-entry',
  '/user/reset-password',
  '/user/password-reset',
  '/user/account-recovery',
  '/auth',
  '/admin',
  '/admin/login',
  '/moderator',
  '/moderator/login',
  '/checkout',
  '/payment',
];

export const isRouteExcludedFromFooterAds = (currentRoute: string): boolean => {
  const raw = (currentRoute || '').trim().toLowerCase().split(/[?#]/)[0];
  if (!raw) return false;
  const normalized = raw.replace(/\/+$/, '') || '/';
  return FOOTER_EXCLUDED_ROUTES.some((route) =>
    normalized === route ||
    normalized.startsWith(`${route}/`) ||
    normalized.startsWith('/admin/') ||
    normalized.startsWith('/moderator/') ||
    normalized.includes('/auth/') ||
    normalized.includes('/checkout/') ||
    normalized.includes('/payment/')
  );
};

export const GLOBAL_ADS_INELIGIBLE_ROUTES = [
  '/age-gate',
  '/guest-entry',
  '/register',
  '/login',
  '/dashboard',
  '/user/dashboard',
  '/profile',
  '/user/login',
  '/user/register',
  '/user/guest-entry',
  '/user/reset-password',
  '/user/password-reset',
  '/user/account-recovery',
  '/auth',
  '/admin',
  '/moderator',
  '/checkout',
  '/payment',
];

export const isEligibleRouteForGlobalAds = (currentRoute: string): boolean => {
  const raw = (currentRoute || '').trim().toLowerCase().split(/[?#]/)[0];
  if (!raw) return true;
  const normalized = raw.replace(/\/+$/, '') || '/';
  return !GLOBAL_ADS_INELIGIBLE_ROUTES.some(
    (route) =>
      normalized === route ||
      normalized.startsWith(`${route}/`) ||
      normalized === '/admin' ||
      normalized.startsWith('/admin/') ||
      normalized === '/moderator' ||
      normalized.startsWith('/moderator/') ||
      normalized === '/auth' ||
      normalized.startsWith('/auth/') ||
      normalized.includes('/auth/') ||
      normalized.endsWith('/auth') ||
      normalized === '/checkout' ||
      normalized.startsWith('/checkout/') ||
      normalized.includes('/checkout/') ||
      normalized.endsWith('/checkout') ||
      normalized === '/payment' ||
      normalized.startsWith('/payment/') ||
      normalized.includes('/payment/') ||
      normalized.endsWith('/payment')
  );
};

export const getAdsterraUnitForWidth = (width: number, position: string): string | null => {
  if (position === 'footer') {
    if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    return null;
  }

  return null;
};

export type AdPlacementOrientation = 'horizontal' | 'vertical';

export interface AdReservedDimensionTarget {
  orientation: AdPlacementOrientation;
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  allowPortraitCreative: boolean;
}

export interface VerifiedAdUnitSpec {
  id: string;
  provider: AdProvider;
  width: number;
  height: number;
  orientation: AdPlacementOrientation;
}

/**
 * Registry of configured provider units with verified fixed dimensions.
 * - A unit is vertical ONLY when height > width.
 * - 300x250 (Adsterra Footer-only & ExoClick 6087300) have width > height, so they are horizontal/landscape.
 * - Dynamic multi-format zones (ExoClick 6109952 / 6102500) adapt per slot bounds and are omitted from vertical specs.
 */
export const VERIFIED_AD_UNITS: readonly VerifiedAdUnitSpec[] = [
  {
    id: ADSTERRA_CONFIG.banner728x90,
    provider: 'adsterra',
    width: 728,
    height: 90,
    orientation: 'horizontal',
  },
  {
    id: ADSTERRA_CONFIG.banner320x50,
    provider: 'adsterra',
    width: 320,
    height: 50,
    orientation: 'horizontal',
  },
  {
    id: ADSTERRA_CONFIG.banner300x250,
    provider: 'adsterra',
    width: 300,
    height: 250,
    orientation: 'horizontal',
  },
  {
    id: EXOCLICK_CONFIG.zoneId,
    provider: 'exoclick',
    width: 300,
    height: 250,
    orientation: 'horizontal',
  },
];

export const getVerifiedAdUnitSpec = (
  unitId: string,
  provider?: AdProvider
): VerifiedAdUnitSpec | null => {
  return (
    VERIFIED_AD_UNITS.find(
      (u) => u.id === unitId && (provider === undefined || u.provider === provider)
    ) || null
  );
};

export const getVerifiedVerticalUnitForProvider = (
  provider: AdProvider,
  maxContainerWidth: number | null,
  maxContainerHeight: number = 540
): VerifiedAdUnitSpec | null => {
  const candidates = VERIFIED_AD_UNITS.filter(
    (u) =>
      u.provider === provider &&
      u.orientation === 'vertical' &&
      u.height > u.width &&
      u.height <= maxContainerHeight &&
      (maxContainerWidth === null || u.width <= maxContainerWidth)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.width - a.width || b.height - a.height);
  return candidates[0];
};

export const isInternalHorizontalPlacement = (slotId: string): boolean => {
  return (
    slotId === 'public-chatroom-status-above' ||
    slotId === 'public-chatroom-status-inline' ||
    slotId === 'public-chatroom-message-inline'
  );
};

export const getPlacementOrientation = (
  slotId: string,
  position?: string,
  isVertical?: boolean
): AdPlacementOrientation => {
  if (isInternalHorizontalPlacement(slotId) || slotId === 'participant-box-horizontal') {
    return 'horizontal';
  }
  if (position === 'left' || position === 'right' || isVertical) {
    return 'vertical';
  }
  return 'horizontal';
};

export const getReservedDimensionTarget = (
  slotId: string,
  position?: string,
  isVertical?: boolean
): AdReservedDimensionTarget => {
  const orientation = getPlacementOrientation(slotId, position, isVertical);

  if (orientation === 'vertical') {
    return {
      orientation: 'vertical',
      minWidth: 160,
      maxWidth: 300,
      minHeight: 520,
      maxHeight: 540,
      allowPortraitCreative: true,
    };
  }

  if (slotId === 'chatroom-explore-bottom') {
    return {
      orientation: 'horizontal',
      minWidth: 300,
      maxWidth: 300,
      minHeight: 250,
      maxHeight: 250,
      allowPortraitCreative: false,
    };
  }

  if (slotId === 'participant-box-horizontal') {
    return {
      orientation: 'horizontal',
      minWidth: 300,
      maxWidth: 320,
      minHeight: 90,
      maxHeight: 120,
      allowPortraitCreative: false,
    };
  }

  if (isInternalHorizontalPlacement(slotId)) {
    return {
      orientation: 'horizontal',
      minWidth: 300,
      maxWidth: 320,
      minHeight: 62,
      maxHeight: 68,
      allowPortraitCreative: false,
    };
  }

  // Top, Bottom, Footer, Content-Gap main horizontal banners (target max 728x102)
  return {
    orientation: 'horizontal',
    minWidth: 300,
    maxWidth: 728,
    minHeight: 62,
    maxHeight: 102,
    allowPortraitCreative: false,
  };
};
