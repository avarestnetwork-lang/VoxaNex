import React, { createContext, useContext, useState } from 'react';

interface ConsentContextType {
  openConsentModal: () => void;
  setConsentModalOpen: (open: boolean) => void;
}

const ConsentContext = createContext<ConsentContextType | undefined>(undefined);

export const ConsentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConsentModalOpen, setConsentModalOpen] = useState(false);
  const openConsentModal = () => setConsentModalOpen(true);

  return (
    <ConsentContext.Provider value={{ openConsentModal, setConsentModalOpen }}>
      {children}
    </ConsentContext.Provider>
  );
};

export const useConsent = () => {
  const context = useContext(ConsentContext);
  if (!context) throw new Error('useConsent must be used within a ConsentProvider');
  return context;
};
