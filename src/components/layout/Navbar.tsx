import React, { useState } from 'react';
import {
  Heart,
  Video,
  ShoppingBag,
  BookOpen,
  MessageSquareCode,
  Menu,
  X,
  Settings,
} from 'lucide-react';
import { useRouter } from '../../context/RouterContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

export const Navbar: React.FC = () => {
  const { currentRoute, navigate } = useRouter();
  const { language } = useLanguage();
  const { user, hasActiveSession } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: language === 'bn' ? 'হোম' : 'Home', route: '/' },
    { label: language === 'bn' ? 'চ্যাট রুম' : 'Rooms', route: '/rooms' },
    { label: language === 'bn' ? 'ডেটিং ও ফ্লার্টিং' : 'Dating', route: '/dating' },
    { label: language === 'bn' ? 'ক্যাম' : 'Cam', route: '/chat/video' },
    { label: language === 'bn' ? 'শপ' : 'Shop', route: '/shop' },
    { label: language === 'bn' ? 'ব্লগ' : 'Blog', route: '/blog' },
    { label: language === 'bn' ? 'ফোরাম' : 'Forum', route: '/forum' },
  ];

  const handleNav = (route: string) => {
    navigate(route);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand + 18+ Badge */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleNav('/')}
              className="flex items-center gap-2.5 text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-lg cursor-pointer"
            >
              <img
                src="/logo.png"
                alt="ChatLustora Logo"
                className="w-9 h-9 object-contain drop-shadow-[0_2px_10px_rgba(236,72,153,0.35)] group-hover:scale-105 transition-transform"
                width={36}
                height={36}
              />
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Chat<span className="text-rose-600 dark:text-rose-400">Lustora</span>
                </span>
              </div>
            </button>

            {/* 18+ Tag */}
            <button
              onClick={() => handleNav('/age-gate')}
              className="text-xs font-bold px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors border border-rose-200 dark:border-rose-800 cursor-pointer"
            >
              18+
            </button>
          </div>

          {/* Desktop Navigation Menu (Home, Rooms, Dating, Cam, Shop, Blog, Forum) */}
          <nav className="hidden lg:flex items-center space-x-1" aria-label="Main Navigation">
            <button
              onClick={() => handleNav('/')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                currentRoute === '/'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => handleNav('/rooms')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                currentRoute === '/rooms'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Rooms
            </button>
            <button
              onClick={() => handleNav('/dating')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 font-bold ${
                currentRoute === '/dating'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
              }`}
            >
              <Heart className="w-3.5 h-3.5 fill-rose-500" />
              Dating
            </button>
            <button
              onClick={() => handleNav('/chat/video')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                currentRoute === '/chat/video' || currentRoute === '/av-chat'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <Video className="w-3.5 h-3.5 text-rose-500" />
              Cam
            </button>
            <button
              onClick={() => handleNav('/shop')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                currentRoute === '/shop'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-amber-500" />
              Shop
            </button>
            <button
              onClick={() => handleNav('/blog')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                currentRoute === '/blog'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Blog
            </button>
            <button
              onClick={() => handleNav('/forum')}
              className={`px-3 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                currentRoute === '/forum'
                  ? 'text-rose-600 dark:text-rose-400 bg-slate-100 dark:bg-slate-800'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Forum
            </button>
          </nav>

          {/* Right Utilities: Guest / Register / Member Dashboard & Mobile Toggle */}
          <div className="flex items-center gap-2">
            {/* Member Dashboard button for logged in members */}
            {hasActiveSession && !user.isGuest ? (
              <button
                onClick={() => handleNav('/dashboard')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                title="Member Dashboard"
              >
                <span className="text-sm select-none" aria-hidden="true">{user.avatar || '⚡'}</span>
                <span className="font-bold max-w-[90px] truncate hidden sm:inline text-slate-800 dark:text-slate-200">
                  {user.nickname}
                </span>
                <Settings className="w-3 h-3 text-slate-400" />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleNav('/guest-entry')}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                  title="Continue as Guest"
                >
                  {language === 'bn' ? 'গেস্ট' : 'Guest'}
                </button>
                <button
                  onClick={() => handleNav('/register')}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer shadow-xs"
                  title="Create Free Account"
                >
                  {language === 'bn' ? 'অ্যাকাউন্ট খুলুন' : 'Register'}
                </button>
              </div>
            )}

            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Toggle mobile menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-2 pb-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.route}
              onClick={() => handleNav(item.route)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                currentRoute === item.route
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
            <button
              onClick={() => handleNav('/guest-entry')}
              className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-lg"
            >
              {language === 'bn' ? 'গেস্ট প্রবেশ' : 'Guest Entry'}
            </button>
            {hasActiveSession && !user.isGuest ? (
              <button
                onClick={() => handleNav('/dashboard')}
                className="text-xs font-bold text-rose-600 dark:text-rose-400 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40"
              >
                {language === 'bn' ? 'সদস্য ড্যাশবোর্ড' : 'Member Dashboard'}
              </button>
            ) : (
              <button
                onClick={() => handleNav('/register')}
                className="text-xs font-bold text-white px-4 py-2 rounded-lg bg-rose-600"
              >
                {language === 'bn' ? 'রেজিস্টার' : 'Register'}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
