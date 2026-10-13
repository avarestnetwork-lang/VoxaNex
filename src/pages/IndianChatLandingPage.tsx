import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { MessageSquare, ArrowRight, ArrowLeft } from 'lucide-react';

export const IndianChatLandingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  const subRooms = [
    { name: language === 'bn' ? 'হিন্দি চ্যাট' : 'Hindi Chat', route: '/chat/indian/hindi', desc: language === 'bn' ? 'হিন্দি-ভাষী আড্ডা' : 'Hindi language conversation.' },
    { name: language === 'bn' ? 'তামিল চ্যাট' : 'Tamil Chat', route: '/chat/indian/tamil', desc: language === 'bn' ? 'তামিল-ভাষী আড্ডা' : 'Tamil language conversation.' },
    { name: language === 'bn' ? 'পশ্চিমবঙ্গ চ্যাট' : 'West Bengal Chat', route: '/chat/indian/west-bengal', desc: language === 'bn' ? 'পশ্চিমবঙ্গী আড্ডা' : 'Regional Bengal conversation.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-10">
        <button onClick={() => navigate('/rooms')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-orange-600 transition-colors cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
          <span>{language === 'bn' ? 'রুম ডিরেক্টরিতে ফিরে যান' : 'Back to Room Directory'}</span>
        </button>
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            🇮🇳 {language === 'bn' ? 'ভারতীয় চ্যাট' : 'Indian Chat'}
          </h1>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {subRooms.map((room, idx) => (
            <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:border-orange-500 transition-all">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{room.name}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{room.desc}</p>
              <button
                onClick={() => navigate(room.route)}
                className="w-full text-center bg-orange-500 text-white font-bold py-2 rounded-lg hover:bg-orange-600 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {language === 'bn' ? 'যোগ দিন' : 'Join'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
