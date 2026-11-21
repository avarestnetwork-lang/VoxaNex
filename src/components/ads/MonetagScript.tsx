import React, { useEffect } from 'react';
import { MONETAG_CONFIG } from '../../config/adsConfig';

export const MonetagScript: React.FC = () => {
  useEffect(() => {
    if (!MONETAG_CONFIG.enabled) return;

    const scriptId = 'monetag-multitag';
    if (document.getElementById(scriptId)) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = MONETAG_CONFIG.scriptUrl;
    script.setAttribute('data-zone', MONETAG_CONFIG.zoneId);
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    script.addEventListener('load', () => script.setAttribute('data-ad-script-loaded', 'true'), { once: true });
    script.addEventListener('error', () => script.setAttribute('data-ad-script-error', 'true'), { once: true });

    document.head.appendChild(script);

    return () => {
      const existing = document.getElementById(scriptId);
      if (existing) {
        existing.remove();
      }
    };
  }, []);

  return null;
};
