import React from 'react';
import { useRouter } from '../../context/RouterContext';
import { useLanguage } from '../../context/LanguageContext';
import { MessageSquare, Globe, Shield, Lock, Sun, Moon, Monitor, Facebook } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

export const Footer: React.FC = () => {
  const { navigate } = useRouter();
  const { language, toggleLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <footer className="w-full bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs mt-auto border-t border-slate-200 dark:border-slate-800 shadow-inner transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Col 1: Logo & Summary */}
          <div className="space-y-4 md:col-span-1">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2.5 text-left group focus:outline-none focus:ring-2 focus:ring-rose-500 rounded-lg cursor-pointer"
            >
              <img
                src="/logo.png"
                alt="ChatLustora Logo"
                className="w-8 h-8 object-contain drop-shadow-[0_2px_8px_rgba(236,72,153,0.35)] group-hover:scale-105 transition-transform"
                width={32}
                height={32}
              />
              <span className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Chat<span className="text-rose-600 dark:text-rose-400">Lustora</span>
              </span>
            </button>
            <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
              {language === 'bn' 
                ? '১৮+ প্রাপ্তবয়স্কদের জন্য বাংলা ও দেশি চ্যাট, ডেটিং এবং প্রাইভেট মেসেজিং। কোনো রেজিস্ট্রেশন ছাড়াই সম্পূর্ণ নিরাপদ ও সার্বক্ষণিক মডারেটেড।'
                : '18+ adult chat and dating community for Bengali, Desi, and international adults. Real-time public rooms, private messaging, and respectful flirting without registration.'}
            </p>
            {/* Official Social Media Links */}
            <div className="flex items-center gap-2.5 pt-1" aria-label="ChatLustora Social Media">
              <a
                href="https://www.facebook.com/chatlustora"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ChatLustora on Facebook"
                title="ChatLustora on Facebook"
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-white hover:bg-[#1877F2] dark:hover:bg-[#1877F2] hover:border-[#1877F2] transition-all border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 cursor-pointer shadow-xs"
              >
                <Facebook className="w-4 h-4" />
              </a>

              <a
                href="https://x.com/chatlustora"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ChatLustora on X"
                title="ChatLustora on X"
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-white hover:bg-black dark:hover:bg-black hover:border-black transition-all border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 cursor-pointer shadow-xs"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>

              <a
                href="https://t.me/ChatLustora"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ChatLustora on Telegram"
                title="ChatLustora on Telegram"
                className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:text-white hover:bg-[#229ED9] dark:hover:bg-[#229ED9] hover:border-[#229ED9] transition-all border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 cursor-pointer shadow-xs"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Col 2: COMMUNITY */}
          <div>
            <h4 className="text-slate-900 dark:text-white font-bold text-xs tracking-wider uppercase mb-3">
              {language === 'bn' ? 'কমিউনিটি' : 'Community'}
            </h4>
            <ul className="space-y-2">
              <li><button onClick={() => navigate('/rooms')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer">{language === 'bn' ? 'চ্যাট রুমসমূহ' : 'Chat Rooms'}</button></li>
              <li><button onClick={() => navigate('/dating')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer font-semibold text-rose-600 dark:text-rose-400">{language === 'bn' ? 'ডেটিং ও ফ্লার্টিং' : 'Dating & Flirting'}</button></li>
              <li><button onClick={() => navigate('/messages')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer">{language === 'bn' ? 'ব্যক্তিগত বার্তা' : 'Private Messages'}</button></li>
              <li><button onClick={() => navigate('/forum')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer">{language === 'bn' ? 'ফোরাম' : 'Forum'}</button></li>
              <li><button onClick={() => navigate('/blog')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer">{language === 'bn' ? 'ব্লগ ও গাইড' : 'Blog & Guides'}</button></li>
              <li><button onClick={() => navigate('/safety')} className="hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer">{language === 'bn' ? 'নিরাপত্তা নির্দেশিকা' : 'Safety Guidelines'}</button></li>
            </ul>
          </div>

          {/* Col 3: HELP */}
          <div>
            <h4 className="text-slate-900 dark:text-white font-bold text-xs tracking-wider uppercase mb-3">
              {language === 'bn' ? 'সাহায্য' : 'Help'}
            </h4>
            <ul className="space-y-2">
              <li><button onClick={() => navigate('/safety')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'চ্যাট সাহায্য' : 'Chat Help'}</button></li>
              <li><button onClick={() => navigate('/safety')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'চ্যাট নিয়মাবলী' : 'Chat Rules'}</button></li>
              <li><button onClick={() => navigate('/profile')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'ব্যবহারকারী লেভেল' : 'User Levels'}</button></li>
              <li><button onClick={() => navigate('/faq')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'সাধারণ প্রশ্ন (FAQ)' : 'FAQ'}</button></li>
              <li><button onClick={() => navigate('/sitemap')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'সাইটম্যাপ' : 'Sitemap'}</button></li>
              <li><button onClick={() => navigate('/safety')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'নিরাপত্তা টিপস' : 'Safety Tips'}</button></li>
            </ul>
          </div>

          {/* Col 4: LEGAL & SETTINGS */}
          <div>
            <h4 className="text-slate-900 dark:text-white font-bold text-xs tracking-wider uppercase mb-3">
              {language === 'bn' ? 'আইনি ও সেটিংস' : 'Legal & Preferences'}
            </h4>
            <ul className="space-y-2">
              <li><button onClick={() => navigate('/terms')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'ব্যবহারের শর্তাবলী' : 'Terms of Use'}</button></li>
              <li><button onClick={() => navigate('/privacy')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'গোপনীয়তা নীতি' : 'Privacy Policy'}</button></li>
              <li><button onClick={() => navigate('/safety')} className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer">{language === 'bn' ? 'দায়মুক্তি ঘোষণা' : 'Disclaimer'}</button></li>
              <li className="pt-2">
                {/* Language Switch Button */}
                <button
                  onClick={toggleLanguage}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer font-medium"
                >
                  <Globe className="w-3.5 h-3.5 text-orange-500" />
                  <span>{language === 'en' ? 'বাংলা (Bangla)' : 'English'}</span>
                </button>
              </li>
              <li className="pt-1">
                {/* Theme quick toggles */}
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded border border-slate-200 dark:border-slate-700 w-fit">
                  <button
                    onClick={() => setTheme('light')}
                    title="Light Mode"
                    className={`p-1 rounded cursor-pointer transition-colors ${theme === 'light' ? 'bg-white text-amber-500 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    <Sun className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    title="Dark Mode"
                    className={`p-1 rounded cursor-pointer transition-colors ${theme === 'dark' ? 'bg-slate-700 text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    <Moon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTheme('system')}
                    title="System Default"
                    className={`p-1 rounded cursor-pointer transition-colors ${theme === 'system' ? 'bg-slate-700 text-slate-200 shadow-sm' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 dark:text-slate-400 text-xs sm:text-sm">
          <div className="text-center md:text-left flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
            <span>© 2026 ChatLustora.com. {language === 'bn' ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}</span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">·</span>
            <span>
              {language === 'bn' ? 'ডিজাইন ও ডেভেলপমেন্টে ' : 'Design and developed by '}
              <a
                href="https://avarestsoft.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 underline underline-offset-4 decoration-rose-500/40 hover:decoration-rose-500 transition-colors"
              >
                Avarest Soft
              </a>
            </span>
          </div>
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            <span className="bg-red-600 text-white font-bold px-1.5 py-0.5 rounded text-[10px]">18+ only</span>
            <span>{language === 'bn' ? 'শুধুমাত্র প্রাপ্তবয়স্কদের জন্য। ১৮ বছরের কম হলে প্রস্থান করুন।' : 'Adults only. Leave now if you are under 18.'}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
