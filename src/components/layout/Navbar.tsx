import React, { useState, useRef, useEffect } from 'react';
import {
  Radio,
  Users,
  Compass,
  Shuffle,
  MessageSquare,
  Video,
  ShieldCheck,
  ShieldAlert,
  Globe,
  Menu,
  X,
  User,
  Settings,
  Flame,
  BookOpen,
  Sun,
  Moon,
  Monitor,
  Heart,
} from 'lucide-react';
import { useRouter } from '../../context/RouterContext';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeMode } from '../../context/ThemeContext';

export const Navbar: React.FC = () => {
  const { currentRoute, navigate } = useRouter();
  const { language, toggleLanguage, t } = useLanguage();
  const { user, is18Verified, logout, hasActiveSession } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close theme dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setThemeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navItems = [
    { label: language === 'bn' ? 'হোম' : 'Home', route: '/' },
    { label: language === 'bn' ? 'চ্যাট রুম' : 'Rooms', route: '/rooms' },
    { label: language === 'bn' ? 'ডেটিং ও ফ্লার্টিং' : 'Dating', route: '/dating' },
    { label: language === 'bn' ? 'সেক্স চ্যাট' : 'Sex Chat', route: '/chat/sex' },
    { label: language === 'bn' ? 'প্রাপ্তবয়স্ক চ্যাট' : 'Adult Chat', route: '/chat/adult' },
    { label: language === 'bn' ? 'ভিডিও চ্যাট' : 'Video Chat', route: '/chat/video' },
    { label: language === 'bn' ? 'রুলেট' : 'Roulette', route: '/random' },
    { label: language === 'bn' ? 'গে চ্যাট' : 'Gay Chat', route: '/chat/gay' },
    { label: language === 'bn' ? 'লেসবিয়ান চ্যাট' : 'Lesbian Chat', route: '/chat/lesbian' },
    { label: language === 'bn' ? 'দম্পতি চ্যাট' : 'Couples Chat', route: '/chat/couples' },
    { label: language === 'bn' ? 'রোলপ্লে চ্যাট' : 'Roleplay Chat', route: '/chat/roleplay' },
    { label: language === 'bn' ? 'বিডিএসএম চ্যাট' : 'BDSM Chat', route: '/chat/bdsm' },
    { label: language === 'bn' ? 'ইংরেজি চ্যাট' : 'English Chat', route: '/chat/english' },
    { label: language === 'bn' ? 'এশিয়ান চ্যাট' : 'Asian Chat', route: '/chat/asian' },
    { label: language === 'bn' ? 'আন্তর্জাতিক চ্যাট' : 'International Chat', route: '/chat/international' },
    { label: language === 'bn' ? 'বন্ধুত্ব চ্যাট' : 'Friendship Chat', route: '/chat/friendship' },
    { label: language === 'bn' ? 'ম্যাচিউর চ্যাট' : 'Mature Chat', route: '/chat/mature' },
    { label: language === 'bn' ? 'ইউএসএ চ্যাট' : 'USA Chat', route: '/chat/usa' },
    { label: language === 'bn' ? 'যোগাযোগ' : 'Contact', route: '/contact' },
  ];

  const handleNav = (route: string) => {
    navigate(route);
    setMobileMenuOpen(false);
  };

  const themeOptions: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { id: 'light', label: language === 'bn' ? 'লাইট মোড' : 'Light Mode', icon: <Sun className="w-4 h-4 text-amber-500" /> },
    { id: 'dark', label: language === 'bn' ? 'ডার্ক মোড' : 'Dark Mode', icon: <Moon className="w-4 h-4 text-indigo-400" /> },
    { id: 'system', label: language === 'bn' ? 'সিস্টেম ডিফল্ট' : 'System Default', icon: <Monitor className="w-4 h-4 text-slate-500" /> },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-sm transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand + 18+ Badge */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleNav('/')}
              className="flex items-center gap-2.5 text-left group focus:outline-none cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white flex items-center justify-center font-extrabold shadow-md shadow-rose-500/25 group-hover:opacity-90 transition-opacity">
                <MessageSquare className="w-5 h-5 fill-white text-rose-500" />
              </div>
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

          {/* Desktop Nav Items */}
          <nav className="hidden lg:flex items-center space-x-1" aria-label="Main Navigation">
            <button onClick={() => handleNav('/')} className="px-3 py-2 text-sm font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">Home</button>
            <button onClick={() => handleNav('/rooms')} className="px-3 py-2 text-sm font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">Rooms</button>
            <button onClick={() => handleNav('/dating')} className="px-3 py-2 text-sm font-semibold rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer flex items-center gap-1.5 font-bold">
              <Heart className="w-3.5 h-3.5 fill-rose-500" />
              Dating
            </button>
            
            {/* Chatrooms Dropdown */}
            <div className="relative group">
              <button className="px-3 py-2 text-sm font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer">
                Chatrooms
              </button>
              <div className="absolute top-full left-0 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-2 hidden group-hover:block z-50">
                 {/* List top chatrooms here as requested */}
                 <button onClick={() => handleNav('/chat/sex')} className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">Sex Chat</button>
                 <button onClick={() => handleNav('/chat/adult')} className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">Adult Chat</button>
                 {/* ... etc ... */}
              </div>
            </div>
            
            <button onClick={() => handleNav('/contact')} className="px-3 py-2 text-sm font-semibold rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Contact</button>
          </nav>

          {/* Right Utilities: Theme Dropdown, Language, Profile, Mobile Menu */}
          <div className="flex items-center gap-2">
            {/* Theme Selector Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setThemeDropdownOpen(!themeDropdownOpen)}
                aria-label="Toggle theme menu"
                className="flex items-center gap-1.5 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                title={`Current theme: ${theme}`}
              >
                {resolvedTheme === 'dark' ? (
                  <Moon className="w-4 h-4 text-indigo-400" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-xs font-medium capitalize hidden sm:inline">{theme}</span>
              </button>

              {themeDropdownOpen && (
                <div className="absolute right-0 mt-2 w-44 rounded-xl shadow-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                    {language === 'bn' ? 'থিম নির্বাচন করুন' : 'Select Theme'}
                  </div>
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setTheme(opt.id);
                        setThemeDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-left transition-colors cursor-pointer ${
                        theme === opt.id
                          ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {opt.icon}
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Language Toggle */}
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-orange-500" />
              <span>{language === 'en' ? 'বাংলা' : 'EN'}</span>
            </button>

            {/* User / Profile button */}
            {hasActiveSession && !user.isGuest && (
              <button
                onClick={() => handleNav('/profile')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
              >
                <span className="text-sm select-none" aria-hidden="true">{user.avatar}</span>
                <span className="font-bold max-w-[90px] truncate hidden sm:inline text-slate-800 dark:text-slate-200">
                  {user.nickname}
                </span>
                <Settings className="w-3 h-3 text-slate-400" />
              </button>
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
          {/* Mobile Theme Switcher Bar */}
          <div className="py-2 mb-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'থিম মোড' : 'Theme Mode'}
            </span>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {themeOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setTheme(opt.id)}
                  className={`p-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                    theme === opt.id
                      ? 'bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                  title={opt.label}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>

          {navItems.map((item) => (
            <button
              key={item.route}
              onClick={() => handleNav(item.route)}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
            >
              {item.label}
            </button>
          ))}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <button
              onClick={() => handleNav('/age-gate')}
              className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg"
            >
              18+ Verification Status
            </button>
            {!user.isGuest && (
              <button
                onClick={() => handleNav('/profile')}
                className="text-xs font-bold text-orange-600 dark:text-orange-400 px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/40"
              >
                Profile & Settings
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
