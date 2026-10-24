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
import { MemberDashboardPage } from './pages/MemberDashboardPage';
import { ProfileSettingsPage } from './pages/ProfileSettingsPage';
import { SafetyCenterPage } from './pages/SafetyCenterPage';
import { ForumPage } from './pages/ForumPage';
import { BlogPage } from './pages/BlogPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { AdminRouteGuard } from './components/auth/AdminRouteGuard';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage';
import { TermsOfServicePage } from './pages/TermsOfServicePage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { HelpPage } from './pages/HelpPage';
import { FaqPage } from './pages/FaqPage';
import { SitemapPage } from './pages/SitemapPage';
import { IndianChatLandingPage } from './pages/IndianChatLandingPage';
import { BanglaChatLandingPage } from './pages/BanglaChatLandingPage';
import { RoomLandingPage } from './pages/RoomLandingPage';
import { DatingLandingPage } from './pages/DatingLandingPage';
import { ShopPage } from './pages/ShopPage';

const AppRoutes: React.FC = () => {
  const { currentRoute, params } = useRouter();
  const { isLoading, hasActiveSession } = useAuth();

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
      case '/register':
        return <AuthPage defaultMode="register" />;
      case '/dashboard':
        return <MemberDashboardPage />;
      case '/rooms':
        return <RoomDirectoryPage />;
      case '/chat/bangla':
        return hasActiveSession ? <PublicChatPage /> : <BanglaChatLandingPage />;
      case '/chat':
        return hasActiveSession ? (
          <PublicChatPage />
        ) : params.roomId ? (
          <RoomLandingPage roomSlug={params.roomId} />
        ) : (
          <BanglaChatLandingPage />
        );
      case '/messages':
        return <PrivateMessagingPage />;
      case '/random':
        return <RandomMatchingPage />;
      case '/av-chat':
      case '/chat/video':
        return <VoiceWebcamPage />;
      case '/auth':
        return <AuthPage />;
      case '/profile':
        return <MemberDashboardPage />;
      case '/safety':
        return <SafetyCenterPage />;
      case '/forum':
        return <ForumPage />;
      case '/blog':
        return <BlogPage />;
      case '/admin/login':
        return <AdminLoginPage />;
      case '/admin':
        return (
          <AdminRouteGuard>
            <AdminDashboardPage />
          </AdminRouteGuard>
        );
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
      case '/shop':
        return <ShopPage />;
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
