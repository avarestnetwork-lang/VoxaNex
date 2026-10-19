import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { HelpCircle, MessageSquare, Shield, Video, Shuffle, Heart } from 'lucide-react';

export const HelpPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={language === 'bn' ? 'সহায়তা ও নির্দেশিকা – ChatLustora' : 'Help Center & Community Guides – ChatLustora'}
        description="Comprehensive guides on navigating ChatLustora adult chatrooms, initiating private 1-on-1 chats, dating etiquette, and safety tools."
        canonicalPath="/help"
      />
      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white shadow-xl shadow-rose-500/20 mb-1">
            <HelpCircle className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'চ্যাট সহায়তা ও নির্দেশিকা' : 'Help & Chat Guides'}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
            {language === 'bn'
              ? 'ChatLustora ব্যবহার সংক্রান্ত সাধারণ নির্দেশিকা এবং সহায়ক তথ্যের জন্য নিচের তালিকাটি দেখুন।'
              : 'Find quick answers and guides on how to make the most of your ChatLustora adult community experience.'}
          </p>
        </div>

        {/* Quick Links Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <button
            onClick={() => navigate('/rooms')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-rose-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <MessageSquare className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'চ্যাট রুম নির্দেশিকা' : 'Chat Rooms Guide'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'পাবলিক ও প্রাইভেট রুমে আড্ডার নিয়মাবলী।' : 'Learn how public rooms and participant menus work.'}
            </p>
          </button>

          <button
            onClick={() => navigate('/dating')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-rose-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'ডেটিং ও ফ্লার্টিং' : 'Dating & Flirting'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'সম্মতিসূচক রোমান্টিক কথোপকথনের টিপস।' : 'Safety and respectful connection advice.'}
            </p>
          </button>

          <button
            onClick={() => navigate('/safety')}
            className="p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-rose-500 text-left transition-all cursor-pointer space-y-3 group"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold group-hover:scale-110 transition-transform">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">
              {language === 'bn' ? 'নিরাপত্তা ও রিপোর্ট' : 'Safety & Reporting'}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {language === 'bn' ? 'অনাকাঙ্ক্ষিত ব্যবহারকারীকে ব্লক ও রিপোর্ট করার নিয়ম।' : 'How to report abuse and block users instantly.'}
            </p>
          </button>
        </div>
      </div>
    </div>
  );
};
