import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ADSTERRA_CONFIG, AdProvider, getProviderRotation } from '../../config/adsConfig';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right' | 'footer' | 'sidebar-horizontal';

export interface AdPlacementBoxProps {
  slotId: string;
  provider?: AdProvider;
  label?: string;
  className?: string;
  isVertical?: boolean;
  position?: AdSlotPosition;
  adUnitId?: string; // Used for AdSense slot or Adsterra unit ID
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
  adUnitId,
  onStatusChange,
  renderAd,
}) => {
  // 1. Mandatory Stable Hook Declarations
  const [adStatus, setAdStatus] = useState<'idle' | 'loading' | 'filled' | 'unfilled' | 'error'>('idle');
  const [containerWidth, setContainerWidth] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);
  
  const adRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);
  const observerRef = useRef<MutationObserver | null>(null);

  // Derive active provider from rotation or explicit prop
  const rotation = getProviderRotation(position || '');
  const provider = explicitProvider || rotation[providerIndex];

  // Status update wrapper
  const updateStatus = useCallback((status: 'filled' | 'unfilled' | 'error') => {
    if (!isMountedRef.current) return;

    if (status !== 'filled' && !explicitProvider && providerIndex < rotation.length - 1) {
      // Automatic Fallback/Rotation
      console.log(`[Ads] Slot ${slotId} unfilled by ${provider}. Falling back to next provider.`);
      setProviderIndex(prev => prev + 1);
      setAdStatus('idle');
    } else {
      setAdStatus(status);
      onStatusChange?.(status);
    }
  }, [onStatusChange, explicitProvider, providerIndex, rotation, provider, slotId]);

  // Unit ID resolution
  const effectiveUnitId = adUnitId || (
    typeof import.meta !== 'undefined' &&
    (import.meta as any).env?.[`VITE_${provider.toUpperCase()}_SLOT_${slotId.toUpperCase().replace(/-/g, '_')}`]
  );

  // 2. Lifecycle & Dimensional Awareness
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

  // 3. Ad Integration Orchestration
  useEffect(() => {
    // Skip if we just updated providerIndex and are waiting for next cycle
    if (adStatus !== 'idle') return;

    if (renderAd) {
      const content = renderAd();
      updateStatus(content ? 'filled' : 'unfilled');
      return;
    }

    if (!effectiveUnitId) {
      updateStatus('unfilled');
      return;
    }

    // Safety: Horizontal sidebars must be wide enough
    if (position === 'sidebar-horizontal' && provider === 'adsterra' && effectiveUnitId === ADSTERRA_CONFIG.banner320x50) {
      if (containerWidth > 0 && containerWidth < 320) {
        updateStatus('unfilled');
        return;
      }
    }

    setAdStatus('loading');

    if (provider === 'adsense') {
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
    } else if (provider === 'adsterra') {
      const isNative = effectiveUnitId === ADSTERRA_CONFIG.nativeUnitId;
      
      const loadTask = () => new Promise<void>((resolve) => {
        if (!isMountedRef.current) { resolve(); return; }

        if (isNative) {
          const containerId = `container-${ADSTERRA_CONFIG.nativeUnitId}`;
          const existing = document.getElementById(containerId);
          
          if (existing && !adRef.current?.contains(existing)) {
             // Restriction: Adsterra Native expects a unique global ID
             console.warn(`[Adsterra] Native container ${containerId} already active. Skipping slot ${slotId}.`);
             updateStatus('unfilled');
             resolve();
             return;
          }

          if (adRef.current) {
            adRef.current.innerHTML = `<div id="${containerId}"></div>`;
          }

          const script = document.createElement('script');
          script.async = true;
          script.setAttribute('data-cfasync', 'false');
          script.src = `https://${ADSTERRA_CONFIG.nativeDomain}/${ADSTERRA_CONFIG.nativeUnitId}/invoke.js`;
          
          script.onload = () => {
            setTimeout(() => {
              const el = document.getElementById(containerId);
              if (el && el.children.length > 0) updateStatus('filled');
              else updateStatus('filled'); // Assume filled if script ran
              resolve();
            }, 600);
          };
          script.onerror = () => { updateStatus('error'); resolve(); };
          document.head.appendChild(script);
        } else {
          // Banner Sequencing
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

          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.src = `https://${ADSTERRA_CONFIG.bannerDomain}/${effectiveUnitId}/invoke.js`;
          
          script.onload = () => { updateStatus('filled'); resolve(); };
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
  }, [provider, effectiveUnitId, renderAd, updateStatus, position, slotId, containerWidth, adStatus]);

  // 4. Position Classes & Visibility
  if (adStatus === 'unfilled' || adStatus === 'error') return null;

  let posClasses = 'w-full flex justify-center overflow-hidden';
  if (position === 'top') posClasses += ' mb-2.5 shrink-0';
  else if (position === 'bottom' || position === 'footer') posClasses += ' mt-2.5 shrink-0';
  else if (position === 'left' || position === 'right') posClasses = 'hidden lg:flex shrink-0 w-[160px] xl:w-[200px] max-w-[200px] justify-center overflow-hidden';
  else if (position === 'sidebar-horizontal') posClasses = 'w-full my-2 flex justify-center overflow-hidden px-2';
  else if (isVertical) posClasses = 'hidden lg:flex shrink-0 w-[160px] xl:w-[200px] max-w-[200px] justify-center overflow-hidden';

  const containerProps = {
    'data-testid': `ad-slot-${slotId}`,
    className: `${posClasses} ${className}`.trim(),
    ref: adRef,
  };

  // 5. Final Assembly
  if (renderAd) return <div {...containerProps}>{renderAd()}</div>;
  if (provider === 'adsterra') return <div {...containerProps} />;

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
