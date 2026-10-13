import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';

export const SitemapPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  const routes = [
    { name: language === 'bn' ? 'হোম' : 'Home', path: '/' },
    { name: language === 'bn' ? 'রুম ডিরেক্টরি' : 'Room Directory', path: '/rooms' },
    { name: language === 'bn' ? 'র‍্যান্ডম সঙ্গী' : 'Random Partner', path: '/random' },
    { name: language === 'bn' ? 'ভয়েস ও ভিডিও' : 'Voice & Video', path: '/av-chat' },
    { name: language === 'bn' ? 'ফোরাম' : 'Forum', path: '/forum' },
    { name: language === 'bn' ? 'ব্লগ' : 'Blog', path: '/blog' },
    { name: language === 'bn' ? 'সহায়তা' : 'Help', path: '/help' },
    { name: language === 'bn' ? 'সাধারণ জিজ্ঞাসা' : 'FAQ', path: '/faq' },
    { name: language === 'bn' ? 'নিরাপত্তা কেন্দ্র' : 'Safety Center', path: '/safety' },
    { name: language === 'bn' ? 'যোগাযোগ' : 'Contact', path: '/contact' },
    { name: language === 'bn' ? 'গোপনীয়তা নীতি' : 'Privacy Policy', path: '/privacy' },
    { name: language === 'bn' ? 'ব্যবহারের শর্তাবলী' : 'Terms of Service', path: '/terms' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-10">
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight text-center">
          {language === 'bn' ? 'সাইটম্যাপ' : 'Sitemap'}
        </h1>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm">
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {routes.map((route, idx) => (
              <li key={idx}>
                <button
                  onClick={() => navigate(route.path)}
                  className="text-slate-600 dark:text-slate-300 hover:text-orange-600 dark:hover:text-orange-400 transition-colors cursor-pointer"
                >
                  {route.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
