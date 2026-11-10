import React, { useEffect } from 'react';
import { useConsent } from '../../context/ConsentContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useLanguage } from '../../context/LanguageContext';

declare global {
  interface Window {
    gtag: (type: string, action: string, params: object) => void;
  }
}

export const CookieConsent: React.FC = () => {
  const { setConsentModalOpen } = useConsent();
  const { language } = useLanguage();

  const handleConsent = (granted: boolean) => {
    const consent = granted ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      'ad_storage': consent,
      'ad_user_data': consent,
      'ad_personalization': consent,
      'analytics_storage': consent
    });
    localStorage.setItem('cookie_consent', consent);
    setConsentModalOpen(false);
  };

  return (
    <Modal isOpen={true} onClose={() => setConsentModalOpen(false)} title={language === 'bn' ? 'কুকি সেটিংস' : 'Cookie Settings'}>
      <div className="p-4 space-y-4 text-xs sm:text-sm text-slate-300">
        <p>{language === 'bn' 
          ? 'আমরা আমাদের ওয়েবসাইট উন্নত করতে এবং প্রাসঙ্গিক বিজ্ঞাপন দেখাতে কুকি ব্যবহার করি।' 
          : 'We use cookies to improve our website and show relevant advertisements.'}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => handleConsent(false)}>{language === 'bn' ? 'প্রত্যাখ্যান করুন' : 'Reject'}</Button>
          <Button onClick={() => handleConsent(true)}>{language === 'bn' ? 'গ্রহণ করুন' : 'Accept'}</Button>
        </div>
      </div>
    </Modal>
  );
};
