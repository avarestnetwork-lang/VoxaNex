export type AdProvider = 'adsterra' | 'juicyads' | 'exoclick' | 'monetag' | 'adsense';

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
  zoneId: '6087300',
  scriptUrl: 'https://a.magsrv.com/ad-provider.js',
  elementClass: 'eas6a97888e2',
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

export const JUICYADS_CONFIG = {
  verificationTag: '97a6aeec522d11d21efa5f84c86eb958',
  scriptUrl: 'https://poweredby.jads.co/js/jads.js',
  zones: {
    banner300x62: '1131763',
    banner300x262: '1131765',
    banner728x102: '1131766',
    banner300x112: '1131767',
  },
  enabled: true,
};

export const MONETAG_CONFIG = {
  verificationTag: '416e702dd7d166aafe13107553d43a38',
  zoneId: '12241585',
  scriptUrl: 'https://nap5k.com/tag.min.js',
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
        : 'ExoClick native Ad Refresh supports 30/60/90/120s (max 10/session), but dashboard authorization for zone 6087300 is unverified; disabled',
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

  if (provider === 'juicyads') {
    return {
      provider: 'juicyads',
      enabled: JUICYADS_CONFIG.enabled,
      supportsNativeRefresh: false,
      accountAuthorized: false,
      supportedIntervalsSec: [],
      chosenIntervalSec: null,
      maxSessionRotations: null,
      requiresVisibility: true,
      usesCustomJsTimer: false,
      mechanism: 'none',
      reason: 'JuicyAds jads.js zones have no verified publisher auto-refresh setting; fallback only on genuine error/unfilled',
    };
  }

  if (provider === 'monetag') {
    return {
      provider: 'monetag',
      enabled: MONETAG_CONFIG.enabled,
      supportsNativeRefresh: false,
      accountAuthorized: false,
      supportedIntervalsSec: [],
      chosenIntervalSec: null,
      maxSessionRotations: null,
      requiresVisibility: true,
      usesCustomJsTimer: false,
      mechanism: 'none',
      reason: 'Monetag technical requirements prohibit aggressive refreshes and DOM replacement; keep creative stable',
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
  juicyads: getProviderRefreshPolicy('juicyads'),
  monetag: getProviderRefreshPolicy('monetag'),
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
  '/auth',
  '/user/guest-entry',
  '/user/register',
  '/user/login',
  '/admin',
  '/moderator',
];

export const isAdSenseExcludedRoute = (currentRoute: string): boolean => {
  const normalized = (currentRoute || '').toLowerCase();
  if (!normalized) return false;
  
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

const SESSION_PARITY_STORAGE_KEY = 'vx_ad_session_parity';
let inMemorySessionAdParity: 0 | 1 | null = null;

/**
 * Returns a stable per-browser-session parity bit (0 or 1) for balancing
 * ExoClick and JuicyAds primary impressions across approved chatroom slots
 * without random flip-flopping on React re-renders.
 */
export const getSessionAdRotationParity = (): 0 | 1 => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const existing = sessionStorage.getItem(SESSION_PARITY_STORAGE_KEY);
      if (existing === '0') return 0;
      if (existing === '1') return 1;
      let next: 0 | 1 = 0;
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        next = (buf[0] & 1) as 0 | 1;
      } else {
        next = Math.floor(Date.now() / 1000) % 2 === 0 ? 0 : 1;
      }
      sessionStorage.setItem(SESSION_PARITY_STORAGE_KEY, String(next));
      inMemorySessionAdParity = next;
      return next;
    }
  } catch {
    // Ignore storage restrictions
  }
  if (inMemorySessionAdParity !== null) {
    return inMemorySessionAdParity;
  }
  return 0;
};

/**
 * Selection strategy: Deterministic provider priority list.
 * CRITICAL POLICY:
 * - Google AdSense is STRICTLY EXCLUDED from live-chat screens (/chat).
 * - Adsterra is STRICTLY Footer-only (global-footer-responsive).
 * - Monetag is STRICTLY single-slot public-chatroom-body-bottom-only.
 * - Approved chatroom slots share primary impressions deterministically across
 *   ExoClick and JuicyAds with mutual failover.
 */
export const getProviderRotation = (
  position: string,
  isLiveChatScreen: boolean = true,
  slotId?: string,
  rotationParity: number = 0
): AdProvider[] => {
  if (slotId === 'public-chatroom-body-bottom') {
    return ['monetag'];
  }
  if (position === 'footer' || slotId === 'global-footer-responsive' || Boolean(slotId?.includes('footer'))) {
    return ['adsterra'];
  }
  if (isLiveChatScreen) {
    // Dedicated 300x112 participant bar slot prioritizes JuicyAds with ExoClick failover
    if (slotId === 'participant-box-horizontal') {
      return ['juicyads', 'exoclick'];
    }

    const flip = (rotationParity & 1) === 1;
    // Split regular horizontal placements across ExoClick & JuicyAds deterministically
    if (slotId === 'public-chatroom-status-above' || slotId === 'public-chatroom-bottom') {
      return flip ? ['juicyads', 'exoclick'] : ['exoclick', 'juicyads'];
    }

    return flip ? ['exoclick', 'juicyads'] : ['juicyads', 'exoclick'];
  }

  // Non-chat, non-footer public pages: AdSense, JuicyAds, and ExoClick only
  // (Adsterra is strictly Footer-only; Monetag is strictly public-chatroom-body-bottom-only)
  return ['adsense', 'juicyads', 'exoclick'];
};

export const FOOTER_EXCLUDED_ROUTES = [
  '/user/login',
  '/user/register',
  '/user/guest-entry',
  '/user/password-reset',
  '/user/account-recovery',
  '/auth',
  '/admin/login',
  '/moderator/login',
  '/checkout',
  '/payment',
];

export const isRouteExcludedFromFooterAds = (currentRoute: string): boolean => {
  const normalized = (currentRoute || '').toLowerCase().split(/[?#]/)[0];
  if (!normalized) return false;
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

export const getAdsterraUnitForWidth = (width: number, position: string): string | null => {
  if (position === 'footer') {
    if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    return null;
  }

  if (position === 'content-gap') {
    if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  }
  
  if (position === 'sidebar-horizontal') {
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  }

  // General fallback by width
  if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
  if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
  
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
 * - 300x250 (Adsterra) and 300x262 (JuicyAds) have width > height, so they are strictly horizontal/landscape.
 * - Dynamic widgets or un-dimensioned generic zones (Adsterra native, ExoClick 6087300, Monetag MultiTag)
 *   have no statically verifiable vertical dimensions and are intentionally excluded from vertical verification.
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
    id: JUICYADS_CONFIG.zones.banner300x62,
    provider: 'juicyads',
    width: 300,
    height: 62,
    orientation: 'horizontal',
  },
  {
    id: JUICYADS_CONFIG.zones.banner300x112,
    provider: 'juicyads',
    width: 300,
    height: 112,
    orientation: 'horizontal',
  },
  {
    id: JUICYADS_CONFIG.zones.banner300x262,
    provider: 'juicyads',
    width: 300,
    height: 262,
    orientation: 'horizontal',
  },
  {
    id: JUICYADS_CONFIG.zones.banner728x102,
    provider: 'juicyads',
    width: 728,
    height: 102,
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

  if (slotId === 'participant-box-horizontal') {
    return {
      orientation: 'horizontal',
      minWidth: 300,
      maxWidth: 320,
      minHeight: 112,
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


