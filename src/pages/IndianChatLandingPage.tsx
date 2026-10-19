import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { MessageSquare, ArrowRight, ArrowLeft } from 'lucide-react';

export const IndianChatLandingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  const subRooms = [
    { name: language === 'bn' ? 'হিন্দি চ্যাট' : 'Hindi Chat', route: '/chat/indian/hindi', desc: language === 'bn' ? 'হিন্দি-ভাষী প্রাপ্তবয়স্ক আড্ডা ও কথোপকথন' : 'Hindi language adult conversation & social chat.' },
    { name: language === 'bn' ? 'তামিল চ্যাট' : 'Tamil Chat', route: '/chat/indian/tamil', desc: language === 'bn' ? 'তামিল-ভাষী আঞ্চলিক আড্ডা' : 'Tamil language regional adult conversation.' },
    { name: language === 'bn' ? 'পশ্চিমবঙ্গ চ্যাট' : 'West Bengal Chat', route: '/chat/indian/west-bengal', desc: language === 'bn' ? 'পশ্চিমবঙ্গী বাংলা আড্ডা ও ফ্লার্টিং' : 'West Bengal Bengali conversation and flirting.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'ভারতীয় ও হিন্দি প্রাপ্তবয়স্ক চ্যাট রুম – ChatLustora'
            : 'Desi, Hindi & Indian Adult Chat Rooms – ChatLustora'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরায় ভারতীয়, হিন্দি এবং পশ্চিমবঙ্গের বাংলা চ্যাট রুমে যুক্ত হোন। ১৮+ প্রাপ্তবয়স্কদের জন্য নিরাপদ দেশি চ্যাট ও কথোপকথন।'
            : 'Join Indian, Hindi, and West Bengal adult chat rooms on ChatLustora. Connect with Desi singles and adults in a respectful 18+ community.'
        }
        canonicalPath="/chat/indian"
      />

      <div className="max-w-4xl mx-auto space-y-10">
        <button onClick={() => navigate('/rooms')} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600 transition-colors cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
          <span>{language === 'bn' ? 'রুম ডিরেক্টরিতে ফিরে যান' : 'Back to Room Directory'}</span>
        </button>
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            🇮🇳 {language === 'bn' ? 'ভারতীয় ও দেশি চ্যাট' : 'Indian & Desi Chat Lounges'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            {language === 'bn'
              ? 'হিন্দি, তামিল এবং পশ্চিমবঙ্গ আঞ্চলিক প্রাপ্তবয়স্ক চ্যাট রুমে যুক্ত হয়ে কথোপকথন শুরু করুন।'
              : 'Connect in dedicated Hindi, Tamil, and West Bengal Bengali regional rooms with adult participants worldwide.'}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {subRooms.map((room, idx) => (
            <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm hover:border-rose-500 transition-all flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{room.name}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{room.desc}</p>
              </div>
              <button
                onClick={() => navigate(room.route)}
                className="w-full text-center bg-gradient-to-r from-rose-600 to-orange-500 text-white font-bold py-2.5 rounded-xl hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{language === 'bn' ? 'রুমে প্রবেশ করুন' : 'Enter Lounge'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
