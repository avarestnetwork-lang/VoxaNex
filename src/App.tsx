import React from 'react';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CallProvider } from './context/CallContext';
import { RouterProvider, useRouter } from './context/RouterContext';
import { ThemeProvider } from './context/ThemeContext';
import { PrivateChatProvider } from './context/PrivateChatContext';
import { FloatingChatManager } from './components/chat/FloatingChatManager';
import { Navbar } from './components/layout/Navbar';
import { Footer } from './components/layout/Footer';
import { BackToTop } from './components/ui/BackToTop';

// Page Views
import { LandingPage } from './pages/LandingPage';
import { GuestEntryPage } from './pages/GuestEntryPage';
import { RoomDirectoryPage } from './pages/RoomDirectoryPage';
import { PublicChatPage } from './pages/PublicChatPage';
import { PrivateMessagingPage } from './pages/PrivateMessagingPage';
import { RandomMatchingPage } from './pages/RandomMatchingPage';
import { VoiceWebcamPage } from './pages/VoiceWebcamPage';
import { AuthPage } from './pages/AuthPage';
import { ProfileSettingsPage } from './pages/ProfileSettingsPage';
import { SafetyCenterPage } from './pages/SafetyCenterPage';
import { ForumPage } from './pages/ForumPage';
import { BlogPage } from './pages/BlogPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { HelpPage } from './pages/HelpPage';
import { FaqPage } from './pages/FaqPage';
import { SitemapPage } from './pages/SitemapPage';
import { IndianChatLandingPage } from './pages/IndianChatLandingPage';
import { DatingLandingPage } from './pages/DatingLandingPage';

const AppRoutes: React.FC = () => {
  const { currentRoute } = useRouter();
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-500 font-medium">Loading ChatLustora...</div>
      </div>
    );
  }

  const renderCurrentPage = () => {
    switch (currentRoute) {
      case '/':
        return <LandingPage />;
      case '/age-gate':
        return <GuestEntryPage />;
      case '/guest-entry':
        return <GuestEntryPage />;
      case '/rooms':
        return <RoomDirectoryPage />;
      case '/chat':
        return <PublicChatPage />;
      case '/messages':
        return <PrivateMessagingPage />;
      case '/random':
        return <RandomMatchingPage />;
      case '/av-chat':
        return <VoiceWebcamPage />;
      case '/auth':
        return <AuthPage />;
      case '/profile':
        return <ProfileSettingsPage />;
      case '/safety':
        return <SafetyCenterPage />;
      case '/forum':
        return <ForumPage />;
      case '/blog':
        return <BlogPage />;
      case '/admin':
        return <AdminDashboardPage />;
      case '/privacy':
        return <PrivacyPolicyPage />;
      case '/terms':
        return <TermsOfServicePage />;
      case '/about':
        return <AboutPage />;
      case '/contact':
        return <ContactPage />;
      case '/help':
        return <HelpPage />;
      case '/faq':
        return <FaqPage />;
      case '/sitemap':
        return <SitemapPage />;
      case '/chat/indian':
        return <IndianChatLandingPage />;
      case '/dating':
        return <DatingLandingPage />;
      default:
        return <LandingPage />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      {/* Top Brand Accent Line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600" />
      <Navbar />
      <main className="flex-1 w-full">{renderCurrentPage()}</main>
      <Footer />
      <BackToTop />
    </div>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <CallProvider>
          <ThemeProvider>
            <RouterProvider>
              <PrivateChatProvider>
                <AppRoutes />
                <FloatingChatManager />
              </PrivateChatProvider>
            </RouterProvider>
          </ThemeProvider>
        </CallProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
