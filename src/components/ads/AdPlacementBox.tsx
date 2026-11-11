import React, { useState, useEffect, useRef } from 'react';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right' | 'footer';
export type AdProvider = 'adsense' | 'adsterra' | 'juicyads' | 'monetag' | 'exoclick';

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

// Global queue for Adsterra banners to prevent atOptions collisions
let adsterraLoadQueue: Array<() => Promise<void>> = [];
let isAdsterraLoading = false;

const processAdsterraQueue = async () => {
  if (isAdsterraLoading || adsterraLoadQueue.length === 0) return;
  isAdsterraLoading = true;
  const next = adsterraLoadQueue.shift();
  if (next) await next();
  isAdsterraLoading = false;
  processAdsterraQueue();
};

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({
  slotId,
  provider = 'adsense',
  className = '',
  isVertical = false,
  position,
  adUnitId,
  onStatusChange,
  renderAd,
}) => {
  const effectiveUnitId =
    adUnitId ||
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env?.[
        `VITE_${provider.toUpperCase()}_SLOT_${slotId.toUpperCase().replace(/-/g, '_')}`
      ]);

  let positionClasses = '';
  if (position === 'top') {
    positionClasses = 'w-full mb-2.5 shrink-0 flex justify-center overflow-hidden';
  } else if (position === 'bottom' || position === 'footer') {
    positionClasses = 'w-full mt-2.5 shrink-0 flex justify-center overflow-hidden';
  } else if (position === 'left' || position === 'right') {
    positionClasses = 'hidden lg:flex shrink-0 w-[160px] xl:w-[200px] max-w-[200px] justify-center overflow-hidden';
  } else if (isVertical) {
    positionClasses = 'hidden lg:flex shrink-0 w-[160px] xl:w-[200px] max-w-[200px] justify-center overflow-hidden';
  } else {
    positionClasses = 'w-full shrink-0 flex justify-center overflow-hidden';
  }

  if (renderAd) {
    const customContent = renderAd();
    if (!customContent) {
      onStatusChange?.('unfilled');
      return null;
    }
    onStatusChange?.('filled');
    return (
      <div
        data-testid={`ad-slot-${slotId}`}
        className={`${positionClasses} ${className}`.trim()}
      >
        {customContent}
      </div>
    );
  }

  if (!effectiveUnitId) {
    onStatusChange?.('unfilled');
    return null;
  }

  const [adStatus, setAdStatus] = useState<'idle' | 'filled' | 'unfilled' | 'error'>('idle');
  const adRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    if (provider === 'adsense') {
      try {
        if (typeof window !== 'undefined') {
          const adsbygoogle = (window as any).adsbygoogle;
          if (Array.isArray(adsbygoogle)) {
            adsbygoogle.push({});
          }
        }
      } catch {
        if (isMounted) {
          setAdStatus('error');
          onStatusChange?.('error');
        }
        return;
      }
    } else if (provider === 'adsterra') {
      const isNative = effectiveUnitId === '4085ad0bb94688c1cdc0917f2df29137';
      
      if (isNative) {
        // Native ad doesn't use atOptions, uses container ID
        const script = document.createElement('script');
        script.async = true;
        script.setAttribute('data-cfasync', 'false');
        script.src = `https://pl32301907.profitableratecpmnetwork.com/${effectiveUnitId}/invoke.js`;
        
        // Use slotId as container ID to allow multiple instances
        const containerId = `container-${slotId}`;
        script.onload = () => {
          if (isMounted) {
            setAdStatus('filled');
            onStatusChange?.('filled');
          }
        };
        
        document.head.appendChild(script);
      } else {
        // Banner ad uses atOptions, needs sequencing
        const loadBanner = () => new Promise<void>((resolve) => {
          if (!isMounted) { resolve(); return; }
          
          // Set dimensions based on unit ID
          let height = 250, width = 300;
          if (effectiveUnitId === '8b239fe78d1bba05c2a125bb36872489') { height = 50; width = 320; }
          else if (effectiveUnitId === 'd8696ddef865fbc92f612a0124ae627f') { height = 90; width = 728; }

          (window as any).atOptions = {
            'key': effectiveUnitId,
            'format': 'iframe',
            'height': height,
            'width': width,
            'params': {}
          };

          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.src = `https://www.highrevenueformat.com/${effectiveUnitId}/invoke.js`;
          
          script.onload = () => {
            if (isMounted) {
              setAdStatus('filled');
              onStatusChange?.('filled');
            }
            resolve();
          };
          
          script.onerror = () => {
            if (isMounted) {
              setAdStatus('error');
              onStatusChange?.('error');
            }
            resolve();
          };

          if (adRef.current) {
            adRef.current.appendChild(script);
          } else {
            resolve();
          }
        });

        adsterraLoadQueue.push(loadBanner);
        processAdsterraQueue();
      }
    }
    
    // MutationObserver only for AdSense
    if (provider === 'adsense') {
      const targetElement = adRef.current;
      if (!targetElement) return;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-ad-status') {
            const status = targetElement.getAttribute('data-ad-status');
            if (status === 'filled') {
              setAdStatus('filled');
              onStatusChange?.('filled');
            } else if (status === 'unfilled') {
              setAdStatus('unfilled');
              onStatusChange?.('unfilled');
            }
          }
        }
      });
      observer.observe(targetElement, { attributes: true });
      return () => {
        isMounted = false;
        observer.disconnect();
      };
    }

    return () => {
      isMounted = false;
    };
  }, [provider, effectiveUnitId, onStatusChange]);

  if (adStatus === 'unfilled' || adStatus === 'error') {
    return null;
  }

  // If advertisement is idle, render a placeholder with fixed dimensions for banners to reduce CLS if we're reasonably sure it will fill
  // But requirement says: "Do not render an empty ad wrapper when no ad is available"
  // So we only render when filled or when we're about to load (idle -> loading)
  if (adStatus === 'idle' && provider === 'adsense') {
    return null;
  }

  if (provider === 'adsterra') {
    const isNative = effectiveUnitId === '4085ad0bb94688c1cdc0917f2df29137';
    return (
      <div
        data-testid={`ad-slot-${slotId}`}
        className={`${positionClasses} ${className}`.trim()}
        ref={adRef as React.RefObject<HTMLDivElement>}
      >
        {isNative && <div id={`container-${slotId}`}></div>}
      </div>
    );
  }

  return (
    <div
      data-testid={`ad-slot-${slotId}`}
      className={`${positionClasses} ${className}`.trim()}
    >
      <ins
        ref={adRef as React.RefObject<HTMLModElement>}
        className="adsbygoogle block overflow-hidden max-w-full"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={effectiveUnitId}
        data-ad-format={isVertical || position === 'left' || position === 'right' ? 'vertical' : 'horizontal'}
        data-full-width-responsive="true"
      />
    </div>
  );
};


