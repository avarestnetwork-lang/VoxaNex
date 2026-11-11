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
};

export const JUICYADS_CONFIG = {
  verificationTag: '97a6aeec522d11d21efa5f84c86eb958',
};

/**
 * Selection strategy: Priority list.
 * If a provider fails (unfilled/error), the AdPlacementBox should fallback to the next one.
 * Rotation is "fair" when we have multiple eligible providers.
 */
export const getProviderRotation = (position: string): AdProvider[] => {
  // Currently, only AdSense and Adsterra have units configured.
  // JuicyAds, ExoClick, and Monetag are in "Verification Only" status.
  
  if (position === 'footer') {
    return ['adsterra', 'adsense'];
  }
  
  if (position === 'sidebar-horizontal') {
    return ['adsterra', 'adsense'];
  }

  // Default rotation
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

export const getAdsterraUnitForWidth = (width: number, position: string) => {
  if (position === 'footer') {
    if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  }
  
  if (position === 'sidebar-horizontal') {
    if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
    if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  }

  if (width >= 728) return ADSTERRA_CONFIG.banner728x90;
  if (width >= 300) return ADSTERRA_CONFIG.banner300x250;
  if (width >= 320) return ADSTERRA_CONFIG.banner320x50;
  
  return null;
};
