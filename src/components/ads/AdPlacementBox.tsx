import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from '../../context/RouterContext';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  JUICYADS_CONFIG,
  MONETAG_CONFIG,
  ADSENSE_CONFIG,
  AdProvider,
  getProviderRotation,
  isAdSenseExcludedRoute,
} from '../../config/adsConfig';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right' | 'footer' | 'sidebar-horizontal' | 'content-gap';

export type CreativeValidationStatus =
  | 'empty'
  | 'script_only'
  | 'invalid'
  | 'unfilled'
  | 'request_attempted'
  | 'creative_detected'
  | 'confirmed_filled'
  | 'unverifiable';

export interface CreativeValidationResult {
  status: CreativeValidationStatus;
  isConfirmedFilled: boolean;
  isUnverifiable: boolean;
  creativeDetected: boolean;
  reason: string;
}

export type AdSlotStatus = 'idle' | 'loading' | 'filled' | 'unfilled' | 'error' | 'unverifiable';

export interface AdPlacementBoxProps {
  slotId: string;
  provider?: AdProvider;
  label?: string;
  className?: string;
  isVertical?: boolean;
  position?: AdSlotPosition;
  adUnitId?: string;
  onStatusChange?: (status: 'filled' | 'unfilled' | 'error' | 'unverifiable') => void;
  renderAd?: () => React.ReactNode;
  isLiveChatScreen?: boolean;
}

// Global queue for Adsterra to prevent atOptions collisions
interface QueueItem {
  id: string;
  load: () => Promise<void>;
}
let adsterraLoadQueue: QueueItem[] = [];
let isAdsterraProcessing = false;

const processAdsterraQueue = async () => {
  if (isAdsterraProcessing || adsterraLoadQueue.length === 0) return;
  isAdsterraProcessing = true;
  
  while (adsterraLoadQueue.length > 0) {
    const item = adsterraLoadQueue.shift();
    if (item) {
      try {
        await item.load();
      } catch (err) {
        console.error(`[Adsterra] Load error for slot ${item.id}:`, err);
      }
    }
  }
  
  isAdsterraProcessing = false;
};

/**
 * Inspects a candidate container DOM element and performs strict, defensible creative validation.
 * Distinguishes confirmed filled, unverifiable, unfilled, empty, and script-only states.
 */
export const validateCreative = (el: HTMLElement | null): CreativeValidationResult => {
  if (!el) {
    return {
      status: 'empty',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container element is null or undefined',
    };
  }

  // 1. Provider-Documented Signals (e.g. Google AdSense data-ad-status attribute on ins)
  const insAdSense = el.matches?.('ins[data-ad-status]')
    ? el
    : el.querySelector?.('ins[data-ad-status]');
  if (insAdSense) {
    const statusAttr = insAdSense.getAttribute('data-ad-status');
    if (statusAttr === 'filled') {
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Provider documented signal: data-ad-status is filled',
      };
    }
    if (statusAttr === 'unfilled') {
      return {
        status: 'unfilled',
        isConfirmedFilled: false,
        isUnverifiable: false,
        creativeDetected: false,
        reason: 'Provider documented signal: data-ad-status is unfilled',
      };
    }
  }

  // 2. Scan ALL candidate elements in the container (supports multiple creatives where earlier candidate is tracking/pixel)

  // 2A. Image Creatives (e.g., Native banner image inside anchor or direct img)
  const images = Array.from(el.querySelectorAll?.('img') || []) as HTMLImageElement[];
  for (const img of images) {
    const style = img.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      img.getAttribute('aria-hidden') === 'true' ||
      img.hidden === true;

    if (isHidden) continue;

    const src = img.getAttribute('src') || img.src || '';
    const hasValidSrc = Boolean(src && src !== 'about:blank' && !src.endsWith('/'));
    if (!hasValidSrc) continue;

    // Rule: offsetWidth / clientWidth alone does NOT qualify without successful image loading!
    // Positive naturalWidth and naturalHeight verify actual image decoding and loading.
    const isLoaded = (img.naturalWidth || 0) > 0 && (img.naturalHeight || 0) > 0;
    const hasRenderedDimensions =
      ((img.offsetWidth || 0) > 0 && (img.offsetHeight || 0) > 0) ||
      ((img.clientWidth || 0) > 0 && (img.clientHeight || 0) > 0);

    if (isLoaded && hasRenderedDimensions) {
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Image creative loaded successfully with positive natural and rendered dimensions',
      };
    }
  }

  // 2B. Media Creatives (object, embed, video)
  const mediaList = Array.from(el.querySelectorAll?.('object, embed, video') || []) as HTMLElement[];
  for (const media of mediaList) {
    const style = media.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      media.getAttribute('aria-hidden') === 'true';

    if (isHidden) continue;

    const hasRenderedDimensions =
      ((media.offsetWidth || 0) > 0 && (media.offsetHeight || 0) > 0) ||
      ((media.clientWidth || 0) > 0 && (media.clientHeight || 0) > 0);

    if (hasRenderedDimensions) {
      return {
        status: 'confirmed_filled',
        isConfirmedFilled: true,
        isUnverifiable: false,
        creativeDetected: true,
        reason: 'Media creative rendered with positive dimensions',
      };
    }
  }

  // 2C. Iframe Creatives (cross-origin and same-origin)
  const iframes = Array.from(el.querySelectorAll?.('iframe') || []) as HTMLIFrameElement[];
  for (const iframe of iframes) {
    const style = iframe.style || {};
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      iframe.getAttribute('aria-hidden') === 'true' ||
      iframe.hidden === true;

    if (isHidden) continue;

    // Rule: An iframe merely having a non-empty src or width/height attributes
    // without actual rendered dimensions must NOT qualify!
    const hasRenderedDimensions =
      ((iframe.offsetWidth || 0) > 0 && (iframe.offsetHeight || 0) > 0) ||
      ((iframe.clientWidth || 0) > 0 && (iframe.clientHeight || 0) > 0);

    if (!hasRenderedDimensions) continue;

    const src = iframe.getAttribute('src') || iframe.src || '';
    const srcdoc = iframe.getAttribute('srcdoc') || (iframe as any).srcdoc || '';
    const hasValidSrc = Boolean(
      (src && src !== 'about:blank' && src.trim() !== '') ||
      (srcdoc && srcdoc.trim() !== '')
    );

    if (!hasValidSrc) continue;

    // Strongest available evidence verification:
    // Attempt same-origin check without violating cross-origin browser security restrictions
    let isSameOrigin = false;
    let sameOriginFilled = false;

    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        isSameOrigin = true;
        const body = doc.body;
        if (body) {
          const hasChildren = body.children && body.children.length > 0;
          const hasText = (body.innerText || body.textContent || '').trim().length > 0;
          const hasDims = (body.offsetWidth || 0) > 0 && (body.offsetHeight || 0) > 0;
          if ((hasChildren || hasText) && (hasDims || body.scrollHeight > 0)) {
            sameOriginFilled = true;
          }
        }
      }
    } catch {
      // Cross-origin iframe: expected and handled safely
      isSameOrigin = false;
    }

    if (isSameOrigin) {
      if (sameOriginFilled) {
        return {
          status: 'confirmed_filled',
          isConfirmedFilled: true,
          isUnverifiable: false,
          creativeDetected: true,
          reason: 'Same-origin iframe creative verified with rendered document content',
        };
      }
      // Blank same-origin iframe: skip to evaluate next candidate
      continue;
    }

    // Cross-origin iframe:
    // Visible, valid external URL, positive rendered dimensions.
    // Document contents cannot be inspected under cross-origin security restrictions.
    // Must NOT be falsely reported as 'confirmed_filled'; explicitly returned as 'unverifiable'.
    return {
      status: 'unverifiable',
      isConfirmedFilled: false,
      isUnverifiable: true,
      creativeDetected: true,
      reason: 'Cross-origin iframe detected with valid URL and rendered dimensions; internal content unverifiable under browser security restrictions',
    };
  }

  // 3. Fallback Classification for Non-Creative Containers
  const allChildren = Array.from(el.querySelectorAll?.('*') || []);
  const nonScriptChildren = allChildren.filter(c => c.tagName !== 'SCRIPT');

  if (allChildren.length > 0 && nonScriptChildren.length === 0) {
    return {
      status: 'script_only',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container contains only script elements',
    };
  }

  const textContent = el.textContent?.trim() || '';
  if (allChildren.length === 0 && !textContent) {
    return {
      status: 'empty',
      isConfirmedFilled: false,
      isUnverifiable: false,
      creativeDetected: false,
      reason: 'Container is completely empty',
    };
  }

  return {
    status: 'unfilled',
    isConfirmedFilled: false,
    isUnverifiable: false,
    creativeDetected: false,
    reason: 'Container contains no qualifying creative (broken images, zero-dimension frames, or arbitrary non-creative DOM)',
  };
};

/**
 * Backward-compatible helper. Returns true ONLY for confirmed filled creatives.
 * Unverifiable cross-origin iframes, broken images, and empty wrappers evaluate to false.
 */
export const hasValidCreative = (el: HTMLElement | null): boolean => {
  return validateCreative(el).isConfirmedFilled;
};

export interface UnitResolutionParams {
  provider: AdProvider;
  position?: AdSlotPosition;
  slotId: string;
  isVertical?: boolean;
  containerWidth: number | null;
  primaryAdUnitId?: string;
  isLiveChatScreen: boolean;
}

export function resolveEffectiveUnitId({
  provider,
  position,
  slotId,
  isVertical = false,
  containerWidth,
  primaryAdUnitId,
  isLiveChatScreen,
}: UnitResolutionParams): string | null {
  // 1. Google AdSense is STRICTLY & NON-OVERRIDABLY EXCLUDED from chat/private screens
  if (provider === 'adsense' && isLiveChatScreen) {
    return null;
  }

  // 2. Check if provider is enabled in system configuration
  if (provider === 'exoclick' && !EXOCLICK_CONFIG.enabled) return null;
  if (provider === 'monetag' && !MONETAG_CONFIG.enabled) return null;
  if (provider === 'juicyads' && !JUICYADS_CONFIG.enabled) return null;
  if (provider === 'adsterra' && !ADSTERRA_CONFIG.enabled) return null;
  if (provider === 'adsense' && !ADSENSE_CONFIG.enabled) return null;

  // 3. Reject Publisher ID if accidentally passed as a unit ID
  const sanitizedPrimaryUnit =
    primaryAdUnitId && primaryAdUnitId !== ADSTERRA_CONFIG.publisherId
      ? primaryAdUnitId
      : undefined;

  const posStr = String(position || '');
  const isHorizontalBanner =
    !isVertical &&
    posStr !== 'left' &&
    posStr !== 'right' &&
    (posStr === 'top' ||
      posStr === 'bottom' ||
      posStr === 'footer' ||
      posStr === 'content-gap' ||
      posStr === 'sidebar-horizontal' ||
      posStr === 'status-inline' ||
      posStr === 'message-inline' ||
      slotId.includes('status-inline') ||
      slotId.includes('message-inline') ||
      slotId.includes('top') ||
      slotId.includes('bottom'));

  // 4. Provider-Specific Unit Resolution
  if (provider === 'adsterra') {
    if (isHorizontalBanner) {
      if (containerWidth !== null) {
        if (containerWidth < 320) {
          // Cannot safely accommodate a 320x50 banner without clipping or overflow
          return null;
        }
        if (containerWidth < 728) {
          // Narrow viewport (mobile or tablet): always select 320x50
          // Must NEVER select 728x90 here even if primaryAdUnitId was passed
          return ADSTERRA_CONFIG.banner320x50;
        }
        // containerWidth >= 728:
        // Inline / participant placements should remain compact (320x50) to avoid excessive vertical space
        if (
          posStr === 'sidebar-horizontal' ||
          slotId.includes('inline') ||
          slotId.includes('participant')
        ) {
          return ADSTERRA_CONFIG.banner320x50;
        }
        return ADSTERRA_CONFIG.banner728x90;
      }
      // If containerWidth is null (pre-measurement / SSR), fall back to primaryAdUnitId or sensible default
      if (
        posStr === 'sidebar-horizontal' ||
        slotId.includes('inline') ||
        slotId.includes('participant')
      ) {
        return ADSTERRA_CONFIG.banner320x50;
      }
      return sanitizedPrimaryUnit || ADSTERRA_CONFIG.banner728x90;
    }

    if (isVertical || posStr === 'left' || posStr === 'right') {
      return sanitizedPrimaryUnit || ADSTERRA_CONFIG.nativeUnitId;
    }

    if (posStr === 'sidebar-horizontal') {
      if (containerWidth !== null && containerWidth < 320) return null;
      return ADSTERRA_CONFIG.banner320x50;
    }

    return sanitizedPrimaryUnit || null;
  }

  if (provider === 'juicyads') {
    if (isVertical || posStr === 'left' || posStr === 'right') {
      if (containerWidth !== null && containerWidth < 300) {
        return null;
      }
      return JUICYADS_CONFIG.zones.banner300x262; // 1131765
    }

    // Horizontal JuicyAds
    if (containerWidth !== null && containerWidth < 300) {
      return null;
    }

    if (posStr === 'top' || posStr === 'bottom') {
      if (containerWidth !== null && containerWidth >= 728) {
        return JUICYADS_CONFIG.zones.banner728x102; // 1131766
      }
      return JUICYADS_CONFIG.zones.banner300x62; // 1131763
    }

    return JUICYADS_CONFIG.zones.banner300x62; // 1131763
  }

  if (provider === 'exoclick') {
    return EXOCLICK_CONFIG.zoneId; // 6087300
  }

  if (provider === 'monetag') {
    return MONETAG_CONFIG.zoneId; // 12241585
  }

  if (provider === 'adsense') {
    return ADSENSE_CONFIG.adSlot; // 1929701241
  }

  return sanitizedPrimaryUnit || null;
}

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({
  slotId,
  provider: explicitProvider,
  className = '',
  isVertical = false,
  position,
  adUnitId: primaryAdUnitId,
  onStatusChange,
  renderAd,
  isLiveChatScreen: isLiveChatScreenProp,
}) => {
  const { currentRoute } = useRouter();

  // TASK 2: Non-Overridable AdSense Route Exclusion Policy
  const isExcludedByRoute = isAdSenseExcludedRoute(currentRoute);
  const effectiveIsLiveChatScreen = isExcludedByRoute || Boolean(isLiveChatScreenProp);

  // 1. Mandatory Stable Hook Declarations
  const [adStatus, setAdStatus] = useState<AdSlotStatus>('idle');
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [providerIndex, setProviderIndex] = useState(0);

  const adRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const observerRef = useRef<MutationObserver | null>(null);
  const lastReportedStatusRef = useRef<'filled' | 'unfilled' | 'error' | 'unverifiable' | null>(null);
  const activeTimersRef = useRef<Array<number | NodeJS.Timeout>>([]);

  const clearAllActiveTimers = useCallback(() => {
    activeTimersRef.current.forEach((t) => {
      clearInterval(t as any);
      clearTimeout(t as any);
    });
    activeTimersRef.current = [];
  }, []);

  const disconnectObserver = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  // Clean up timers and observers on route changes or provider changes
  useEffect(() => {
    disconnectObserver();
    clearAllActiveTimers();
  }, [currentRoute, providerIndex, disconnectObserver, clearAllActiveTimers]);

  const rotation = getProviderRotation(position || '', effectiveIsLiveChatScreen);
  const currentProvider = explicitProvider || rotation[providerIndex];

  // Resolve Unit ID Atomically based on current provider
  const getEffectiveUnitId = useCallback(
    (p: AdProvider): string | null => {
      return resolveEffectiveUnitId({
        provider: p,
        position,
        slotId,
        isVertical,
        containerWidth,
        primaryAdUnitId,
        isLiveChatScreen: effectiveIsLiveChatScreen,
      });
    },
    [position, slotId, isVertical, containerWidth, primaryAdUnitId, effectiveIsLiveChatScreen]
  );

  const effectiveUnitId = getEffectiveUnitId(currentProvider);

  const updateStatus = useCallback((status: 'filled' | 'unfilled' | 'error' | 'unverifiable') => {
    if (!isMountedRef.current) return;

    // Clear timers and observer upon reaching a conclusive/terminal status
    clearAllActiveTimers();
    disconnectObserver();

    // Confirmed no-fill or provider error triggers rotation to next eligible provider.
    // 'unverifiable' status (e.g. cross-origin iframe with rendered dimensions) maintains the ad
    // in the layout to preserve monetization and avoid duplicate reloads, without falsely claiming confirmed filled.
    if ((status === 'unfilled' || status === 'error') && !explicitProvider && providerIndex < rotation.length - 1) {
      setProviderIndex(prev => prev + 1);
      setAdStatus('idle');
    } else {
      setAdStatus(status);
      if (lastReportedStatusRef.current !== status) {
        lastReportedStatusRef.current = status;
        onStatusChange?.(status);
      }
    }
  }, [onStatusChange, explicitProvider, providerIndex, rotation.length, clearAllActiveTimers, disconnectObserver]);

  // 2. Lifecycle & Measurement
  useEffect(() => {
    isMountedRef.current = true;
    
    const updateWidth = () => {
      if (adRef.current) {
        const w = adRef.current.offsetWidth;
        setContainerWidth(prev => (prev === w ? prev : w));
      }
    };
    
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    if (adRef.current) resizeObserver.observe(adRef.current);
    
    return () => {
      isMountedRef.current = false;
      clearAllActiveTimers();
      disconnectObserver();
      resizeObserver.disconnect();
    };
  }, [clearAllActiveTimers, disconnectObserver]);

  // 3. Orchestration Effect
  useEffect(() => {
    if (adStatus !== 'idle') return;
    if (containerWidth === null) return;

    if (renderAd) {
      const content = renderAd();
      updateStatus(content ? 'filled' : 'unfilled');
      return;
    }

    if (!effectiveUnitId) {
      updateStatus('unfilled');
      return;
    }

    // Dimension & Width Constraints
    if (currentProvider === 'adsterra') {
      if (effectiveUnitId === ADSTERRA_CONFIG.banner320x50 && containerWidth < 320) {
        updateStatus('unfilled');
        return;
      }
      if (effectiveUnitId === ADSTERRA_CONFIG.banner728x90 && containerWidth < 728) {
        updateStatus('unfilled');
        return;
      }
    }

    if (currentProvider === 'juicyads') {
      if (effectiveUnitId === JUICYADS_CONFIG.zones.banner728x102 && containerWidth < 728) {
        updateStatus('unfilled');
        return;
      }
      if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x62 && containerWidth < 300) {
        updateStatus('unfilled');
        return;
      }
    }

    setAdStatus('loading');

    if (currentProvider === 'juicyads') {
      try {
        if (!adRef.current) { updateStatus('error'); return; }

        let width = 300;
        let height = 250;
        if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x62) { width = 300; height = 62; }
        else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner728x102) { width = 728; height = 102; }
        else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x262) { width = 300; height = 262; }
        else if (effectiveUnitId === JUICYADS_CONFIG.zones.banner300x112) { width = 300; height = 112; }

        const domId = `juicyads-ins-${effectiveUnitId}-${slotId}`;
        adRef.current.innerHTML = `<ins id="${domId}" data-width="${width}" data-height="${height}"></ins>`;

        let script = document.querySelector(`script[src="${JUICYADS_CONFIG.scriptUrl}"]`) as HTMLScriptElement;
        if (!script) {
          script = document.createElement('script');
          script.async = true;
          script.src = JUICYADS_CONFIG.scriptUrl;
          script.onerror = () => {
            if (isMountedRef.current) updateStatus('error');
          };
          document.head.appendChild(script);
        }

        const win = window as any;
        win.adsbyjuicy = win.adsbyjuicy || [];
        win.adsbyjuicy.push({ adzone: effectiveUnitId, id: domId });

        let attempts = 0;
        const checkFillTimer = setInterval(() => {
          if (!isMountedRef.current) {
            clearInterval(checkFillTimer);
            return;
          }
          const insEl = document.getElementById(domId);
          const val = validateCreative(insEl);
          if (val.isConfirmedFilled) {
            clearInterval(checkFillTimer);
            updateStatus('filled');
          } else if (val.isUnverifiable) {
            clearInterval(checkFillTimer);
            updateStatus('unverifiable');
          } else if (attempts >= 8) {
            clearInterval(checkFillTimer);
            updateStatus('unfilled');
          }
          attempts++;
        }, 300);

        activeTimersRef.current.push(checkFillTimer);

      } catch (err) {
        updateStatus('error');
      }
    } else if (currentProvider === 'adsense') {
      if (effectiveIsLiveChatScreen) {
        updateStatus('unfilled');
        return;
      }
      try {
        const win = window as any;
        if (win.adsbygoogle) {
          win.adsbygoogle.push({});
          
          if (adRef.current) {
            const obs = new MutationObserver(() => {
              const ins = adRef.current?.querySelector('ins');
              const val = validateCreative(ins as HTMLElement);
              if (val.isConfirmedFilled) updateStatus('filled');
              else if (val.status === 'unfilled') updateStatus('unfilled');
            });
            obs.observe(adRef.current, { attributes: true, subtree: true });
            observerRef.current = obs;
          }

          const adsenseTimeout = setTimeout(() => {
            if (!isMountedRef.current) return;
            const ins = adRef.current?.querySelector('ins');
            const val = validateCreative(ins as HTMLElement);
            if (!val.isConfirmedFilled) {
              updateStatus('unfilled');
            }
          }, 3000);
          activeTimersRef.current.push(adsenseTimeout);
        } else {
          const unavailableTimeout = setTimeout(() => {
            if (isMountedRef.current) {
              updateStatus('unfilled');
            }
          }, 1000);
          activeTimersRef.current.push(unavailableTimeout);
        }
      } catch (err) {
        updateStatus('error');
      }
    } else if (currentProvider === 'adsterra') {
      const isNative = effectiveUnitId === ADSTERRA_CONFIG.nativeUnitId;
      
      const loadTask = () => new Promise<void>((resolve) => {
        if (!isMountedRef.current) { resolve(); return; }

        if (isNative) {
          const containerId = `container-${effectiveUnitId}-${slotId}`;
          const existing = document.getElementById(containerId);
          
          if (existing && !adRef.current?.contains(existing)) {
             updateStatus('unfilled');
             resolve();
             return;
          }

          if (adRef.current) {
            adRef.current.innerHTML = `<div id="${containerId}"></div>`;
          }

          const scriptSrc = `https://${ADSTERRA_CONFIG.nativeDomain}/${ADSTERRA_CONFIG.nativeUnitId}/invoke.js`;
          const script = document.createElement('script');
          script.async = true;
          script.setAttribute('data-cfasync', 'false');
          script.src = scriptSrc;
          
          script.onload = () => {
            let attempts = 0;
            const checkNativeFill = setInterval(() => {
              if (!isMountedRef.current) { clearInterval(checkNativeFill); resolve(); return; }
              const el = document.getElementById(containerId);
              const val = validateCreative(el);
              if (val.isConfirmedFilled) {
                clearInterval(checkNativeFill);
                updateStatus('filled');
                resolve();
              } else if (val.isUnverifiable) {
                clearInterval(checkNativeFill);
                updateStatus('unverifiable');
                resolve();
              } else if (attempts >= 5) {
                clearInterval(checkNativeFill);
                updateStatus('unfilled');
                resolve();
              }
              attempts++;
            }, 300);
            activeTimersRef.current.push(checkNativeFill);
          };
          script.onerror = () => { updateStatus('error'); resolve(); };
          document.head.appendChild(script);
        } else {
          // Banner
          let h = 250, w = 300;
          if (effectiveUnitId === ADSTERRA_CONFIG.banner320x50) { h = 50; w = 320; }
          else if (effectiveUnitId === ADSTERRA_CONFIG.banner728x90) { h = 90; w = 728; }

          (window as any).atOptions = {
            'key': effectiveUnitId,
            'format': 'iframe',
            'height': h,
            'width': w,
            'params': {}
          };

          const scriptSrc = `https://${ADSTERRA_CONFIG.bannerDomain}/${effectiveUnitId}/invoke.js`;
          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.src = scriptSrc;
          
          script.onload = () => {
            const bannerTimer = setTimeout(() => {
              if (!isMountedRef.current) { resolve(); return; }
              const val = validateCreative(adRef.current);
              if (val.isConfirmedFilled) {
                updateStatus('filled');
              } else if (val.isUnverifiable) {
                updateStatus('unverifiable');
              } else {
                updateStatus('unfilled');
              }
              resolve();
            }, 500);
            activeTimersRef.current.push(bannerTimer);
          };
          script.onerror = () => { updateStatus('error'); resolve(); };

          if (adRef.current) adRef.current.appendChild(script);
          else resolve();
        }
      });

      adsterraLoadQueue.push({ id: slotId, load: loadTask });
      processAdsterraQueue();
    } else if (currentProvider === 'exoclick') {
      try {
        if (!adRef.current) { updateStatus('error'); return; }
        const domId = `exoclick-ins-${EXOCLICK_CONFIG.zoneId}-${slotId}`;
        adRef.current.innerHTML = `<ins id="${domId}" class="${EXOCLICK_CONFIG.elementClass}" data-zoneid="${EXOCLICK_CONFIG.zoneId}" data-keywords="chat,bangla,desi,dating,social,friendship,community,online,international,south-asia,bangladesh,india,usa,united-states,uk,united-kingdom,canada,australia,new-zealand,ireland,germany,france,netherlands,sweden,norway,denmark,switzerland"></ins>`;

        let script = document.querySelector(`script[src="${EXOCLICK_CONFIG.scriptUrl}"]`) as HTMLScriptElement;
        if (!script) {
          script = document.createElement('script');
          script.async = true;
          script.src = EXOCLICK_CONFIG.scriptUrl;
          script.onerror = () => { if (isMountedRef.current) updateStatus('error'); };
          document.head.appendChild(script);
        }

        const win = window as any;
        win.AdProvider = win.AdProvider || [];
        if (typeof win.AdProvider.push === 'function') {
          win.AdProvider.push({ "serve": {} });
        }

        let attempts = 0;
        const checkTimer = setInterval(() => {
          if (!isMountedRef.current) { clearInterval(checkTimer); return; }
          const el = document.getElementById(domId);
          const val = validateCreative(el);
          if (val.isConfirmedFilled) {
            clearInterval(checkTimer);
            updateStatus('filled');
          } else if (val.isUnverifiable) {
            clearInterval(checkTimer);
            updateStatus('unverifiable');
          } else if (attempts >= 10) {
            clearInterval(checkTimer);
            updateStatus('unfilled');
          }
          attempts++;
        }, 300);
        activeTimersRef.current.push(checkTimer);
      } catch {
        updateStatus('error');
      }
    } else if (currentProvider === 'monetag') {
      try {
        if (!adRef.current) { updateStatus('error'); return; }
        const domId = `monetag-wrap-${MONETAG_CONFIG.zoneId}-${slotId}`;
        adRef.current.innerHTML = `<div id="${domId}"></div>`;

        let script = document.querySelector(`script[src="${MONETAG_CONFIG.scriptUrl}"]`) as HTMLScriptElement;
        if (!script) {
          script = document.createElement('script');
          script.async = true;
          script.src = MONETAG_CONFIG.scriptUrl;
          script.setAttribute('data-zone', MONETAG_CONFIG.zoneId);
          script.onerror = () => { if (isMountedRef.current) updateStatus('error'); };
          document.head.appendChild(script);
        }

        let attempts = 0;
        const monetagTimer = setInterval(() => {
          if (!isMountedRef.current) {
            clearInterval(monetagTimer);
            return;
          }
          const wrapEl = document.getElementById(domId);
          const val = validateCreative(wrapEl);
          if (val.isConfirmedFilled) {
            clearInterval(monetagTimer);
            updateStatus('filled');
          } else if (val.isUnverifiable) {
            clearInterval(monetagTimer);
            updateStatus('unverifiable');
          } else if (attempts >= 10) {
            clearInterval(monetagTimer);
            updateStatus('unfilled');
          }
          attempts++;
        }, 300);
        activeTimersRef.current.push(monetagTimer);
      } catch {
        updateStatus('error');
      }
    } else {
      updateStatus('unfilled');
    }
  }, [currentProvider, effectiveUnitId, renderAd, updateStatus, position, slotId, containerWidth, adStatus, effectiveIsLiveChatScreen]);

  // 4. Layout & Visibility rendering
  if (adStatus === 'unfilled' || adStatus === 'error' || (!effectiveUnitId && !renderAd)) return null;

  let posClasses = 'w-full flex justify-center overflow-hidden transition-all duration-300';
  if (position === 'top') posClasses += ' mb-2.5 shrink-0';
  else if (position === 'bottom' || position === 'footer') posClasses += ' mt-1 shrink-0';
  else if (position === 'left' || position === 'right') {
    posClasses = 'hidden xl:flex shrink-0 w-[140px] xl:w-[160px] 2xl:w-[240px] 3xl:w-[300px] max-w-[320px] justify-center overflow-hidden';
  } else if (position === 'sidebar-horizontal') {
    posClasses = 'w-full my-2 flex justify-center overflow-hidden';
  } else if (position === 'content-gap') {
    posClasses = 'w-full my-8 flex justify-center overflow-hidden';
  } else if (isVertical) {
    posClasses = 'hidden xl:flex shrink-0 w-[140px] xl:w-[160px] 2xl:w-[240px] 3xl:w-[300px] max-w-[320px] justify-center overflow-hidden';
  }

  const containerProps = {
    'data-testid': `ad-slot-${slotId}`,
    className: `${posClasses} ${className}`.trim(),
    ref: adRef,
  };

  if (renderAd) return <div {...containerProps}>{renderAd()}</div>;
  if (currentProvider === 'adsterra' || currentProvider === 'juicyads' || currentProvider === 'exoclick' || currentProvider === 'monetag') {
    return <div {...containerProps} />;
  }

  return (
    <div {...containerProps}>
      <ins
        className="adsbygoogle block overflow-hidden max-w-full"
        data-ad-client={ADSENSE_CONFIG.publisherId}
        data-ad-slot={effectiveUnitId}
        data-ad-format={isVertical || position === 'left' || position === 'right' ? 'vertical' : 'horizontal'}
        data-full-width-responsive="true"
      />
    </div>
  );
};
