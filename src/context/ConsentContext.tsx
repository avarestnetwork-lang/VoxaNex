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
    const saved = localStorage.getItem('cookie_consent_status') as ConsentStatus;
    if (saved === 'accepted' || saved === 'rejected') {
      setConsentStatus(saved);
      setIsBannerOpen(false);
    } else {
      setConsentStatus('unset');
      setIsBannerOpen(true);
    }
  }, []);

  const saveConsent = (status: ConsentStatus) => {
    localStorage.setItem('cookie_consent_status', status);
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
