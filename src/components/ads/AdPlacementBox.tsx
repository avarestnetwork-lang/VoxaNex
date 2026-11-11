import React, { useState, useEffect, useRef } from 'react';

export type AdSlotPosition = 'top' | 'bottom' | 'left' | 'right';

export interface AdPlacementBoxProps {
  slotId: string;
  label?: string;
  className?: string;
  isVertical?: boolean;
  position?: AdSlotPosition;
  adUnitId?: string;
  onStatusChange?: (status: 'filled' | 'unfilled' | 'error') => void;
  renderAd?: () => React.ReactNode;
}

// Canonical publisher ID from index.html / ads.txt
const ADSENSE_CLIENT_ID = 'ca-pub-7862321512207088';

export const AdPlacementBox: React.FC<AdPlacementBoxProps> = ({
  slotId,
  className = '',
  isVertical = false,
  position,
  adUnitId,
  onStatusChange,
  renderAd,
}) => {
  // Determine effective unit ID from props or optional environment config
  const effectiveUnitId =
    adUnitId ||
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env?.[
        `VITE_ADSENSE_SLOT_${slotId.toUpperCase().replace(/-/g, '_')}`
      ]);

  // Determine position-aware responsive wrapper classes
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

  // 1. If custom renderAd is supplied (for testing, affiliate banners, or custom provider)
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

  // 2. If no ad unit ID is configured, fail closed immediately with zero DOM footprint
  if (!effectiveUnitId) {
    onStatusChange?.('unfilled');
    return null;
  }

  const [adStatus, setAdStatus] = useState<'idle' | 'filled' | 'unfilled' | 'error'>('idle');
  const adRef = useRef<HTMLModElement | null>(null);

  useEffect(() => {
    // Attempt AdSense rendering
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

    // Observe ad element for actual fill status from provider
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
      observer.disconnect();
    };
  }, [effectiveUnitId, onStatusChange]);

  // If advertisement is unconfirmed, unfilled, or errored, render absolutely nothing
  if (adStatus !== 'filled') {
    return null;
  }

  return (
    <div
      data-testid={`ad-slot-${slotId}`}
      className={`${positionClasses} ${className}`.trim()}
    >
      <ins
        ref={adRef}
        className="adsbygoogle block overflow-hidden max-w-full"
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={effectiveUnitId}
        data-ad-format={isVertical || position === 'left' || position === 'right' ? 'vertical' : 'horizontal'}
        data-full-width-responsive="true"
      />
    </div>
  );
};

