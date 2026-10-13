import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { HelpCircle, MessageSquare, Shield, Video, Shuffle } from 'lucide-react';

export const HelpPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/20 mb-1">
            <HelpCircle className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'চ্যাট সহায়তা ও নির্দেশিকা' : 'Chat Help & Guides'}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
            {language === 'bn'
              ? 'VoxaNex ব্যবহার সংক্রান্ত সাধারণ নির্দেশিকা এবং সহায়ক তথ্যের জন্য নিচের তালিকাটি দেখুন।'
              : 'Find quick answers and guides on how to make the most of your VoxaNex experience.'}
          </p>
        </div>

        {/* Quick Links Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <button
            onClick={() => navigate('/rooms')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-orange-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'চ্যাট রুম নির্দেশিকা' : 'Chat Rooms Guide'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'পাবলিক ও প্রাইভেট রুমে চ্যাট করার নিয়ম।' : 'Learn how public and private rooms work.'}
            </p>
          </button>
          <button
            onClick={() => navigate('/random')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-orange-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <Shuffle className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'রুলেট সাহায্য' : 'Roulette Help'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'র‍্যান্ডম ম্যাচিং এবং ভিডিও চ্যাট টিপস।' : 'Tips for random webcam pairing and chatting.'}
            </p>
          </button>
          <button
            onClick={() => navigate('/safety')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-orange-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'নিরাপত্তা কেন্দ্র' : 'Safety Center'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'রিপোর্ট এবং মডারেশন গাইডলাইন।' : 'Reporting rules and safety best practices.'}
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
