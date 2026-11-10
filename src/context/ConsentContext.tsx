import React, { createContext, useContext, useState, useEffect } from 'react';

type ConsentStatus = 'unset' | 'accepted' | 'rejected';

interface ConsentContextType {
  consentStatus: ConsentStatus;
  isBannerOpen: boolean;
  acceptConsent: () => void;
  rejectConsent: () => void;
  openConsentBanner: () => void;
  closeConsentBanner: () => void;
}

const ConsentContext = createContext<ConsentContextType | undefined>(undefined);

export const ConsentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('unset');
  const [isBannerOpen, setIsBannerOpen] = useState(false);

  useEffect(() => {
    try {
      const newStatus = localStorage.getItem('cookie_consent_status');
      const legacyStatus = newStatus ? null : localStorage.getItem('cookie_consent');
      
      let status: ConsentStatus = 'unset';
      if (newStatus === 'accepted' || newStatus === 'rejected') {
        status = newStatus as ConsentStatus;
      } else if (legacyStatus === 'granted') {
        status = 'accepted';
        localStorage.setItem('cookie_consent_status', 'accepted');
        localStorage.removeItem('cookie_consent');
      } else if (legacyStatus === 'denied') {
        status = 'rejected';
        localStorage.setItem('cookie_consent_status', 'rejected');
        localStorage.removeItem('cookie_consent');
      }

      setConsentStatus(status);
      setIsBannerOpen(status === 'unset');
    } catch (e) {
      console.warn('Storage access failed', e);
      setConsentStatus('unset');
      setIsBannerOpen(true);
    }
  }, []);

  const saveConsent = (status: ConsentStatus) => {
    try {
      localStorage.setItem('cookie_consent_status', status);
    } catch (e) {
      console.warn('Failed to save consent', e);
    }
    setConsentStatus(status);
    setIsBannerOpen(false);
  };

  const acceptConsent = () => saveConsent('accepted');
  const rejectConsent = () => saveConsent('rejected');
  const openConsentBanner = () => setIsBannerOpen(true);
  const closeConsentBanner = () => setIsBannerOpen(false);

  return (
    <ConsentContext.Provider value={{ 
      consentStatus, 
      isBannerOpen, 
      acceptConsent, 
      rejectConsent, 
      openConsentBanner, 
      closeConsentBanner 
    }}>
      {children}
    </ConsentContext.Provider>
  );
};

export const useConsent = () => {
  const context = useContext(ConsentContext);
  if (!context) throw new Error('useConsent must be used within a ConsentProvider');
  return context;
};
