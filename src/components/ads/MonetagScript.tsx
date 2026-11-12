import React, { useEffect } from 'react';
import { MONETAG_CONFIG } from '../../config/adsConfig';

export const MonetagScript: React.FC = () => {
  useEffect(() => {
    if (!MONETAG_CONFIG.enabled) return;

    const scriptId = 'monetag-multitag';
    if (document.getElementById(scriptId)) return;

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://quge5.com/88/tag.min.js';
    script.setAttribute('data-zone', MONETAG_CONFIG.zoneId);
    script.async = true;
    script.setAttribute('data-cfasync', 'false');
    
    document.head.appendChild(script);

    return () => {
      const existing = document.getElementById(scriptId);
      if (existing) {
        document.head.removeChild(existing);
      }
    };
  }, []);

  return null;
};
