import React, { useState, useEffect, useRef } from 'react';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right';
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
  } else if (position === 'bottom') {
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
  const adRef = useRef<HTMLModElement | HTMLDivElement | null>(null);

  useEffect(() => {
    if (provider === 'adsense') {
      try {
        if (typeof window !== 'undefined') {
          const adsbygoogle = (window as any).adsbygoogle;
          if (Array.isArray(adsbygoogle)) {
            adsbygoogle.push({});
          }
        }
      } catch {
        setAdStatus('error');
        onStatusChange?.('error');
        return;
      }
    } else if (provider === 'adsterra') {
      // Adsterra initialization placeholder
      setAdStatus('filled');
      onStatusChange?.('filled');
    }
    
    // MutationObserver only for AdSense
    if (provider === 'adsense') {
      const targetElement = adRef.current;
      if (!targetElement) return;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-ad-status') {
            const status = (targetElement as HTMLElement).getAttribute('data-ad-status');
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
      return () => observer.disconnect();
    }
  }, [provider, effectiveUnitId, onStatusChange]);

  if (adStatus !== 'filled' && provider === 'adsense') {
    return null;
  }

  if (provider === 'adsterra') {
    return (
      <div
        data-testid={`ad-slot-${slotId}`}
        className={`${positionClasses} ${className}`.trim()}
      >
        <script
          type="text/javascript"
          dangerouslySetInnerHTML={{
            __html: `atOptions = { 'key' : '${effectiveUnitId}', 'format' : 'iframe', 'height' : 250, 'width' : 300, 'params' : {} };`,
          }}
        />
        <script
          type="text/javascript"
          src={`//www.highperformanceformat.com/${effectiveUnitId}/invoke.js`}
        />
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

