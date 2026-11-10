import React, { useEffect } from 'react';
import { useConsent } from '../../context/ConsentContext';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';

declare global {
  interface Window {
    gtag?: (type: string, action: string, params: object) => void;
  }
}

export const CookieConsent: React.FC = () => {
  const { consentStatus, isBannerOpen, acceptConsent, rejectConsent, closeConsentBanner, openConsentBanner } = useConsent();
  const { language } = useLanguage();

  useEffect(() => {
    if (consentStatus !== 'unset' || !isBannerOpen) return;

    // Auto-collapse after 10 seconds
    const timer = setTimeout(() => {
      closeConsentBanner();
    }, 10000);

    return () => clearTimeout(timer);
  }, [consentStatus, isBannerOpen, closeConsentBanner]);

  useEffect(() => {
    if (consentStatus !== 'unset') return;

    // Reminder every 20 minutes
    const interval = setInterval(() => {
      openConsentBanner();
    }, 20 * 60 * 1000);

    return () => clearInterval(interval);
  }, [consentStatus, openConsentBanner]);

  const handleConsent = (granted: boolean) => {
    const consent = granted ? 'granted' : 'denied';
    if (typeof window.gtag === 'function') {
      try {
        window.gtag('consent', 'update', {
          'ad_storage': consent,
          'ad_user_data': consent,
          'ad_personalization': consent,
          'analytics_storage': consent
        });
      } catch (e) {
        console.error('gtag error', e);
      }
    }
    
    if (granted) acceptConsent();
    else rejectConsent();
  };

  if (!isBannerOpen) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shadow-lg p-4 sm:flex sm:items-center sm:justify-between sm:px-6">
      <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mb-4 sm:mb-0 sm:mr-6">
        {language === 'bn' 
          ? 'আমরা আমাদের ওয়েবসাইট উন্নত করতে এবং প্রাসঙ্গিক বিজ্ঞাপন দেখাতে কুকি ব্যবহার করি।' 
          : 'We use cookies to improve our website and show relevant advertisements.'}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={() => handleConsent(false)}>{language === 'bn' ? 'প্রত্যাখ্যান করুন' : 'Reject'}</Button>
        <Button size="sm" onClick={() => handleConsent(true)}>{language === 'bn' ? 'গ্রহণ করুন' : 'Accept'}</Button>
      </div>
    </div>
  );
};
