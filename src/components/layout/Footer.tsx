import React from 'react';
import { useRouter } from '../../context/RouterContext';
import { useLanguage } from '../../context/LanguageContext';
import { MessageSquare, Globe, Shield, Lock, Sun, Moon, Monitor } from 'lucide-react';
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
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-orange-500 text-white flex items-center justify-center font-bold shadow-md shadow-rose-500/20">
                <MessageSquare className="w-4 h-4 fill-white text-rose-500" />
              </div>
              <span className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Chat<span className="text-rose-600 dark:text-rose-400">Lustora</span>
              </span>
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
              {language === 'bn' 
                ? '১৮+ প্রাপ্তবয়স্কদের জন্য বাংলা ও দেশি চ্যাট, ডেটিং এবং প্রাইভেট মেসেজিং। কোনো রেজিস্ট্রেশন ছাড়াই সম্পূর্ণ নিরাপদ ও সার্বক্ষণিক মডারেটেড।'
                : '18+ adult chat and dating community for Bengali, Desi, and international adults. Real-time public rooms, private messaging, and respectful flirting without registration.'}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={() => navigate('/safety')} className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer">
                ✕
              </button>
              <button onClick={() => navigate('/safety')} className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer">
                f
              </button>
              <button onClick={() => navigate('/safety')} className="w-7 h-7 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer">
                ▶
              </button>
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
        <div className="pt-8 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 dark:text-slate-400">
          <div>© 2026 ChatLustora.com. {language === 'bn' ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}</div>
          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
            <span className="bg-red-600 text-white font-bold px-1.5 py-0.5 rounded text-[10px]">18+ only</span>
            <span>{language === 'bn' ? 'শুধুমাত্র প্রাপ্তবয়স্কদের জন্য। ১৮ বছরের কম হলে প্রস্থান করুন।' : 'Adults only. Leave now if you are under 18.'}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
