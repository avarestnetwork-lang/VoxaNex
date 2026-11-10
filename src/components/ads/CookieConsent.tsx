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
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 text-white border-t border-slate-700 shadow-2xl p-4 sm:flex sm:items-center sm:justify-between sm:px-8 lg:px-12 py-5">
      <div className="text-sm text-slate-200 mb-5 sm:mb-0 sm:mr-8 max-w-4xl font-medium leading-relaxed">
        {language === 'bn' 
          ? 'আমরা আমাদের ওয়েবসাইট উন্নত করতে এবং প্রাসঙ্গিক বিজ্ঞাপন দেখাতে কুকি ব্যবহার করি।' 
          : 'We use cookies to improve our website and show relevant advertisements to enhance your experience.'}
      </div>
      <div className="flex gap-3 shrink-0">
        <button 
          onClick={() => handleConsent(false)}
          className="px-6 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-semibold text-sm transition-all shadow-sm focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer min-h-[44px] min-w-[100px]"
        >
          {language === 'bn' ? 'প্রত্যাখ্যান' : 'Reject'}
        </button>
        <button 
          onClick={() => handleConsent(true)}
          className="px-6 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm transition-all shadow-sm hover:shadow-rose-900/40 focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer min-h-[44px] min-w-[100px]"
        >
          {language === 'bn' ? 'গ্রহণ করুন' : 'Accept'}
        </button>
      </div>
    </div>
  );
};
