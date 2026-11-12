import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ADSTERRA_CONFIG,
  EXOCLICK_CONFIG,
  JUICYADS_CONFIG,
  MONETAG_CONFIG,
  ADSENSE_CONFIG,
  AdProvider,
  getProviderRotation,
} from '../../config/adsConfig';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right' | 'footer' | 'sidebar-horizontal' | 'content-gap';

export interface AdPlacementBoxProps {
  slotId: string;
  provider?: AdProvider;
  label?: string;
  className?: string;
  isVertical?: boolean;
  position?: AdSlotPosition;
  adUnitId?: string;
  onStatusChange?: (status: 'filled' | 'unfilled' | 'error') => void;
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

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({
  slotId,
  provider: explicitProvider,
  className = '',
  isVertical = false,
  position,
  adUnitId: primaryAdUnitId,
  onStatusChange,
  renderAd,
  isLiveChatScreen = true,
}) => {
  // 1. Mandatory Stable Hook Declarations
  const [adStatus, setAdStatus] = useState<'idle' | 'loading' | 'filled' | 'unfilled' | 'error'>('idle');
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [providerIndex, setProviderIndex] = useState(0);

  const adRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const observerRef = useRef<MutationObserver | null>(null);
  const lastReportedStatusRef = useRef<'filled' | 'unfilled' | 'error' | null>(null);

  const rotation = getProviderRotation(position || '', isLiveChatScreen);
  const currentProvider = explicitProvider || rotation[providerIndex];

  // Resolve Unit ID Atomically based on current provider
  const getEffectiveUnitId = useCallback((p: AdProvider): string | null => {
    // POLICY RULE: Google AdSense is STRICTLY EXCLUDED from live chat screens
    if (p === 'adsense' && isLiveChatScreen) {
      return null;
    }

    // Check if provider is enabled in system configuration
    if (p === 'exoclick' && !EXOCLICK_CONFIG.enabled) return null;
    if (p === 'monetag' && !MONETAG_CONFIG.enabled) return null;
    if (p === 'juicyads' && !JUICYADS_CONFIG.enabled) return null;
    if (p === 'adsterra' && !ADSTERRA_CONFIG.enabled) return null;
    if (p === 'adsense' && !ADSENSE_CONFIG.enabled) return null;

    // Reject Publisher ID if accidentally passed as a unit ID
    if (primaryAdUnitId && primaryAdUnitId === ADSTERRA_CONFIG.publisherId) {
      // Invalid unit ID, fall back to proper slot configuration
    } else if (primaryAdUnitId && p === rotation[0]) {
      return primaryAdUnitId;
    }

    // Provider Specific Unit Resolution
    if (p === 'adsterra') {
      if (position === 'top' || position === 'bottom' || position === 'footer' || position === 'content-gap') {
        return ADSTERRA_CONFIG.banner728x90;
      }
      if (position === 'sidebar-horizontal') {
        return ADSTERRA_CONFIG.banner320x50;
      }
      if (isVertical || position === 'left' || position === 'right') {
        return ADSTERRA_CONFIG.nativeUnitId;
      }
    }

    if (p === 'juicyads') {
      if (position === 'top' || position === 'bottom' || position === 'footer' || position === 'content-gap') {
        return JUICYADS_CONFIG.zones.banner728x102; // 1131766
      }
      if (position === 'sidebar-horizontal') {
        return JUICYADS_CONFIG.zones.banner300x62; // 1131763
      }
      if (isVertical || position === 'left' || position === 'right') {
        return JUICYADS_CONFIG.zones.banner300x262; // 1131765
      }
    }

    if (p === 'adsense') {
      return ADSENSE_CONFIG.adSlot; // 1929701241
    }

    return null;
  }, [primaryAdUnitId, rotation, position, isVertical, isLiveChatScreen]);

  const effectiveUnitId = getEffectiveUnitId(currentProvider);

  const updateStatus = useCallback((status: 'filled' | 'unfilled' | 'error') => {
    if (!isMountedRef.current) return;

    if (status !== 'filled' && !explicitProvider && providerIndex < rotation.length - 1) {
      setProviderIndex(prev => prev + 1);
      setAdStatus('idle');
      
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    } else {
      setAdStatus(status);
      if (lastReportedStatusRef.current !== status) {
        lastReportedStatusRef.current = status;
        onStatusChange?.(status);
      }
    }
  }, [onStatusChange, explicitProvider, providerIndex, rotation.length]);

  // 2. Lifecycle & Measurement
  useEffect(() => {
    isMountedRef.current = true;
    
    const updateWidth = () => {
      if (adRef.current) {
        setContainerWidth(adRef.current.offsetWidth);
      }
    };
    
    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    if (adRef.current) resizeObserver.observe(adRef.current);
    
    return () => {
      isMountedRef.current = false;
      resizeObserver.disconnect();
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

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

    // Safety: Dimension & Width Constraints
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

        // Render standard JuicyAds ins element
        adRef.current.innerHTML = `<ins id="${effectiveUnitId}" data-width="${width}" data-height="${height}"></ins>`;

        // Ensure JuicyAds library script is injected once into head
        if (!document.querySelector(`script[src="${JUICYADS_CONFIG.scriptUrl}"]`)) {
          const script = document.createElement('script');
          script.async = true;
          script.src = JUICYADS_CONFIG.scriptUrl;
          document.head.appendChild(script);
        }

        // Push adzone to adsbyjuicy array
        const win = window as any;
        win.adsbyjuicy = win.adsbyjuicy || [];
        win.adsbyjuicy.push({ adzone: effectiveUnitId });

        updateStatus('filled');
      } catch (err) {
        updateStatus('error');
      }
    } else if (currentProvider === 'adsense') {
      if (isLiveChatScreen) {
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
              const status = ins?.getAttribute('data-ad-status');
              if (status === 'filled') updateStatus('filled');
              else if (status === 'unfilled') updateStatus('unfilled');
            });
            obs.observe(adRef.current, { attributes: true, subtree: true });
            observerRef.current = obs;
          }
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
              if (el && el.children.length > 0) {
                clearInterval(checkNativeFill);
                updateStatus('filled');
                resolve();
              } else if (attempts > 5) {
                clearInterval(checkNativeFill);
                updateStatus('filled'); // Fallback assume fill if script loaded
                resolve();
              }
              attempts++;
            }, 300);
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
            setTimeout(() => {
              if (!isMountedRef.current) { resolve(); return; }
              updateStatus('filled');
              resolve();
            }, 500);
          };
          script.onerror = () => { updateStatus('error'); resolve(); };

          if (adRef.current) adRef.current.appendChild(script);
          else resolve();
        }
      });

      adsterraLoadQueue.push({ id: slotId, load: loadTask });
      processAdsterraQueue();
    } else {
      updateStatus('unfilled');
    }
  }, [currentProvider, effectiveUnitId, renderAd, updateStatus, position, slotId, containerWidth, adStatus, isLiveChatScreen]);

  // 4. Layout & Visibility rendering
  if (adStatus === 'unfilled' || adStatus === 'error' || (!effectiveUnitId && !renderAd)) return null;
  if (renderAd && renderAd() === null) return null;

  let posClasses = 'w-full flex justify-center overflow-hidden transition-all duration-300';
  if (position === 'top') posClasses += ' mb-2.5 shrink-0';
  else if (position === 'bottom' || position === 'footer') posClasses += ' mt-1 shrink-0';
  else if (position === 'left' || position === 'right') {
    posClasses = 'hidden xl:flex shrink-0 w-[140px] xl:w-[160px] max-w-[200px] justify-center overflow-hidden';
  } else if (position === 'sidebar-horizontal') {
    posClasses = 'w-full my-2 flex justify-center overflow-hidden';
  } else if (position === 'content-gap') {
    posClasses = 'w-full my-8 flex justify-center overflow-hidden';
  } else if (isVertical) {
    posClasses = 'hidden xl:flex shrink-0 w-[140px] xl:w-[160px] max-w-[200px] justify-center overflow-hidden';
  }

  const containerProps = {
    'data-testid': `ad-slot-${slotId}`,
    className: `${posClasses} ${className}`.trim(),
    ref: adRef,
  };

  if (renderAd) return <div {...containerProps}>{renderAd()}</div>;
  if (currentProvider === 'adsterra' || currentProvider === 'juicyads') return <div {...containerProps} />;

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
