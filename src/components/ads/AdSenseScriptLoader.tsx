import React, { useEffect } from 'react';
import { useRouter } from '../../context/RouterContext';
import { ADSENSE_CONFIG, isAdSenseExcludedRoute } from '../../config/adsConfig';

export const ADSENSE_SCRIPT_ID = 'google-adsense-script';
export const ADSENSE_SCRIPT_SRC = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CONFIG.publisherId}`;

export const AdSenseScriptLoader: React.FC = () => {
  const { currentRoute } = useRouter();

  useEffect(() => {
    const isExcluded = isAdSenseExcludedRoute(currentRoute);

    if (isExcluded || !ADSENSE_CONFIG.enabled) {
      // Remove AdSense script if present on excluded routes
      const existingScript = document.getElementById(ADSENSE_SCRIPT_ID);
      if (existingScript) {
        existingScript.remove();
      }
    } else {
      // Load AdSense script dynamically on eligible public routes
      if (!document.getElementById(ADSENSE_SCRIPT_ID)) {
        const script = document.createElement('script');
        script.id = ADSENSE_SCRIPT_ID;
        script.src = ADSENSE_SCRIPT_SRC;
        script.async = true;
        script.crossOrigin = 'anonymous';
        document.head.appendChild(script);
      }
    }
  }, [currentRoute]);

  return null;
};
