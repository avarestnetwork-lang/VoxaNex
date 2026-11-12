export type AdProvider = 'adsense' | 'adsterra' | 'juicyads' | 'monetag' | 'exoclick';

export const ADSTERRA_CONFIG = {
  publisherId: '6190760',
  nativeUnitId: '4085ad0bb94688c1cdc0917f2df29137',
  banner300x250: '6863f1ca8dc093d7a0a913d8f30c47a2',
  banner320x50: '8b239fe78d1bba05c2a125bb36872489',
  banner728x90: 'd8696ddef865fbc92f612a0124ae627f',
  bannerDomain: 'www.highrevenueformat.com',
  nativeDomain: 'pl32301907.profitableratecpmnetwork.com',
};

export const MONETAG_CONFIG = {
  verificationTag: '416e702dd7d166aafe13107553d43a38',
  multitagId: '308899', // JS-based multitag for In-Page Push/Vignette (if enabled)
  workerZoneId: '12241124', // Service Worker zone for background formats
  enabled: false, // DEFERRED until manual verification of dual-zone behavior
};

export const JUICYADS_CONFIG = {
  verificationTag: '97a6aeec522d11d21efa5f84c86eb958',
  enabled: false, // NO SERVING ZONE DEFINED
};

export const EXOCLICK_CONFIG = {
  verificationFile: '28befc4532cb8837aa59edffca607a5a.html',
  enabled: false, // NO SERVING ZONE DEFINED
};

/**
 * Selection strategy: Priority list.
 * Fallback logic: Adsterra -> AdSense.
 * 
 * STRICT POLICY: No pop-ups, pop-unders, redirects, or push notification ads.
 */
export const getProviderRotation = (position: string): AdProvider[] => {
  // Primary strategy: Adsterra first for adult/community slots, AdSense for general.
  if (position === 'footer' || position === 'sidebar-horizontal' || position === 'content-gap') {
    return ['adsterra', 'adsense'];
  }
  
  return ['adsense', 'adsterra'];
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
  '/chat',
];

export const isRouteExcludedFromFooterAds = (currentRoute: string): boolean => {
  const normalized = currentRoute.toLowerCase();
  return FOOTER_EXCLUDED_ROUTES.some(route => 
    normalized === route || 
    normalized.startsWith('/chat/') || 
    normalized.startsWith('/admin/') || 
    normalized.startsWith('/moderator/') ||
    normalized.includes('/auth/') ||
    normalized.includes('/checkout/') ||
    normalized.includes('/payment/')
  );
};

/**
 * Atomic Unit Mapping for Adsterra.
 * Ensures the unit ID changes atomically with the width and position.
 */
export const getAdsterraUnitForWidth = (width: number, position: string): string | null => {
  if (position === 'footer' || position === 'content-gap') {
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
