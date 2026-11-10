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
      
      // If valid new status exists, use it immediately and do not touch legacy key
      if (newStatus === 'accepted' || newStatus === 'rejected') {
        setConsentStatus(newStatus as ConsentStatus);
        setIsBannerOpen(false);
        return;
      }

      // New status missing/invalid, check legacy
      const legacyStatus = localStorage.getItem('cookie_consent');
      if (legacyStatus === 'granted' || legacyStatus === 'denied') {
        const status = legacyStatus === 'granted' ? 'accepted' : 'rejected';
        try {
          localStorage.setItem('cookie_consent_status', status);
          localStorage.removeItem('cookie_consent');
        } catch (e) {
          console.warn('Storage migration failed', e);
        }
        setConsentStatus(status);
        setIsBannerOpen(false);
      } else {
        setConsentStatus('unset');
        setIsBannerOpen(true);
      }
    } catch (e) {
      console.warn('Storage access failed', e);
      setConsentStatus('unset');
      setIsBannerOpen(true);
    }
  }, []);

  const saveConsent = React.useCallback((status: ConsentStatus) => {
    try {
      localStorage.setItem('cookie_consent_status', status);
    } catch (e) {
      console.warn('Failed to save consent', e);
    }
    setConsentStatus(status);
    setIsBannerOpen(false);
  }, []);

  const acceptConsent = React.useCallback(() => saveConsent('accepted'), [saveConsent]);
  const rejectConsent = React.useCallback(() => saveConsent('rejected'), [saveConsent]);
  const openConsentBanner = React.useCallback(() => setIsBannerOpen(true), []);
  const closeConsentBanner = React.useCallback(() => setIsBannerOpen(false), []);

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
