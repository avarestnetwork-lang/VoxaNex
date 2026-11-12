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
  enabled: false, // Inactive in visual chat slots until zone format & dimensions are confirmed from publisher dashboard
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
  enabled: true, // Active for verified compatible placements
};

export const MONETAG_CONFIG = {
  verificationTag: '416e702dd7d166aafe13107553d43a38',
  zoneId: '12241585',
  scriptUrl: 'https://nap5k.com/tag.min.js',
  enabled: false, // Inactive in visual chat slots until zone format is confirmed from publisher dashboard
};

export const ADSENSE_CONFIG = {
  publisherId: 'ca-pub-7862321512207088',
  adSlot: '1929701241',
  enabled: true, // Enabled for non-chat pages ONLY; strictly excluded from live-chat routes
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

/**
 * Selection strategy: Priority list.
 * CRITICAL POLICY: Google AdSense is STRICTLY EXCLUDED from live-chat screens (/chat).
 */
export const getProviderRotation = (position: string, isLiveChatScreen: boolean = true): AdProvider[] => {
  if (isLiveChatScreen) {
    if (position === 'sidebar-horizontal') {
      return ['adsterra', 'juicyads'];
    }
    if (position === 'top' || position === 'bottom') {
      return ['adsterra', 'juicyads'];
    }
    if (position === 'left' || position === 'right') {
      return ['adsterra'];
    }
    return ['adsterra', 'juicyads'];
  }

  // Non-chat pages (e.g. static landing pages, blog, about, contact)
  return ['adsense', 'adsterra', 'juicyads'];
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
  const normalized = (currentRoute || '').toLowerCase();
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
