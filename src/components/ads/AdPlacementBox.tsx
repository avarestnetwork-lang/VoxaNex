import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ADSTERRA_CONFIG, AdProvider, getProviderRotation } from '../../config/adsConfig';

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
}

const ADSENSE_CLIENT_ID = 'ca-pub-7862321512207088';

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
}) => {
  // 1. Mandatory Stable Hook Declarations
  const [adStatus, setAdStatus] = useState<'idle' | 'loading' | 'filled' | 'unfilled' | 'error'>('idle');
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const [providerIndex, setProviderIndex] = useState(0);
  
  const adRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const observerRef = useRef<MutationObserver | null>(null);

  const rotation = getProviderRotation(position || '');
  const currentProvider = explicitProvider || rotation[providerIndex];

  // Resolve Unit ID Atomically based on current provider
  const getEffectiveUnitId = useCallback((p: AdProvider) => {
    // If primary provider is active and adUnitId prop is provided, use it
    if (primaryAdUnitId && p === rotation[0]) return primaryAdUnitId;

    // Otherwise, check env vars for this specific slot and provider
    const envKey = `VITE_${p.toUpperCase()}_SLOT_${slotId.toUpperCase().replace(/-/g, '_')}`;
    const envValue = (import.meta as any).env?.[envKey];
    if (envValue) return envValue;

    // Fallback: If AdSense and we don't have a slot, it's unfilled unless it's auto-ads (not supported here)
    // If Adsterra and no unit, use a default for the position if possible
    if (p === 'adsterra') {
      if (position === 'top' || position === 'bottom' || position === 'footer' || position === 'content-gap') return ADSTERRA_CONFIG.banner728x90;
      if (position === 'sidebar-horizontal') return ADSTERRA_CONFIG.banner320x50;
      if (isVertical || position === 'left' || position === 'right') return ADSTERRA_CONFIG.nativeUnitId;
    }

    return null;
  }, [primaryAdUnitId, rotation, slotId, position, isVertical]);

  const effectiveUnitId = getEffectiveUnitId(currentProvider);

  const updateStatus = useCallback((status: 'filled' | 'unfilled' | 'error') => {
    if (!isMountedRef.current) return;

    if (status !== 'filled' && !explicitProvider && providerIndex < rotation.length - 1) {
      console.log(`[Ads] Slot ${slotId} unfilled by ${currentProvider}. Rotating to ${rotation[providerIndex+1]}.`);
      // Atomic change: Update index, clear previous state
      setProviderIndex(prev => prev + 1);
      setAdStatus('idle');
      
      // Cleanup previous observers
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    } else {
      setAdStatus(status);
      onStatusChange?.(status);
    }
  }, [onStatusChange, explicitProvider, providerIndex, rotation, currentProvider, slotId]);

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

  // 3. Orchestration
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

    // Safety: Dimension Constraints
    if (position === 'sidebar-horizontal' && currentProvider === 'adsterra' && effectiveUnitId === ADSTERRA_CONFIG.banner320x50) {
      if (containerWidth < 320) {
        updateStatus('unfilled');
        return;
      }
    }

    setAdStatus('loading');

    if (currentProvider === 'adsense') {
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
            // Use a polling interval to check for native content injection
            let attempts = 0;
            const checkNativeFill = setInterval(() => {
              if (!isMountedRef.current) { clearInterval(checkNativeFill); resolve(); return; }
              const el = document.getElementById(containerId);
              if (el && el.children.length > 0) {
                clearInterval(checkNativeFill);
                updateStatus('filled');
                resolve();
              } else if (attempts > 5) { // Timeout after ~2.5s
                clearInterval(checkNativeFill);
                updateStatus('unfilled');
                resolve();
              }
              attempts++;
            }, 500);
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
            // For banners, we check for iframe presence after a short delay
            setTimeout(() => {
              if (!isMountedRef.current) { resolve(); return; }
              const hasIframe = adRef.current?.querySelector('iframe');
              if (hasIframe) {
                // Check if iframe has content (not empty)
                try {
                   // Cannot check cross-origin content, so we assume if iframe exists it's filled
                   // but we double check if iframe has 0 height/width
                   if (hasIframe.offsetHeight > 0) updateStatus('filled');
                   else updateStatus('unfilled');
                } catch {
                   updateStatus('filled');
                }
              } else {
                updateStatus('unfilled');
              }
              resolve();
            }, 1000);
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
  }, [currentProvider, effectiveUnitId, renderAd, updateStatus, position, slotId, containerWidth, adStatus]);

  // 4. Layout & Visibility
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
  if (currentProvider === 'adsterra') return <div {...containerProps} />;

  return (
    <div {...containerProps}>
      <ins
        className="adsbygoogle block overflow-hidden max-w-full"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={effectiveUnitId}
        data-ad-format={isVertical || position === 'left' || position === 'right' ? 'vertical' : 'horizontal'}
        data-full-width-responsive="true"
      />
    </div>
  );
};
