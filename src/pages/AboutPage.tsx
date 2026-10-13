import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { MessageSquare, Shield, Users, Globe, Award, Sparkles, Heart } from 'lucide-react';

export const AboutPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-500 text-white shadow-xl shadow-orange-500/20 mb-2">
            <MessageSquare className="w-8 h-8 fill-white text-orange-500" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'VoxaNex সম্পর্কে' : 'About VoxaNex'}
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {language === 'bn'
              ? 'বিশ্বের অন্যতম প্রধান ফ্রি এবং সুরক্ষিত অনলাইন চ্যাট প্ল্যাটফর্ম। কোনো রেজিস্ট্রেশন ছাড়াই অপরিচিতদের সাথে সংযোগ স্থাপন করুন।'
              : 'The premier free and secure online chat platform connecting people worldwide instantly with zero registration required.'}
          </p>
        </div>

        {/* Mission Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 space-y-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-orange-500" />
            {language === 'bn' ? 'আমাদের লক্ষ্য ও দর্শন' : 'Our Mission & Vision'}
          </h2>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-base">
            {language === 'bn'
              ? 'VoxaNex প্রতিষ্ঠিত হয়েছে এমন একটি নিরাপদ, দ্রুত এবং উন্মুক্ত ডিজিটাল স্থান তৈরি করার উদ্দেশ্যে যেখানে বিশ্বের যে কোনো প্রান্তের মানুষ বাধাহীনভাবে মতামত বিনিময় করতে পারে, নতুন বন্ধু খুঁজে পেতে পারে এবং লাইভ টেক্সট, ভয়েস বা ওয়েবক্যাম চ্যাটে অংশ নিতে পারে।'
              : 'VoxaNex was founded with a singular mission: to create a safe, instant, and open digital space where people from all walks of life can connect spontaneously, share ideas, and engage in live text, voice, and webcam conversations without barriers.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? 'বিশ্বব্যাপী নাগাল' : 'Global Reach'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? 'প্রতিদিন লক্ষাধিক সক্রিয় ব্যবহারকারী ও আন্তর্জাতিক রুম।' : 'Millions of active participants and regional rooms worldwide.'}
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? 'সম্পূর্ণ নিরাপদ' : 'Strict Safety'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? '২৪/৭ সক্রিয় মডারেশন এবং উন্নত এনক্রিপশন প্রোটোকল।' : '24/7 active moderation and advanced security protocols.'}
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? 'কোনো ঝামেলা নেই' : 'No Friction'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? 'সাইন আপ না করেই তাৎক্ষণিক চ্যাট শুরু করুন।' : 'Jump straight into conversations instantly without registration.'}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-2xl p-8 text-white shadow-xl text-center space-y-4">
          <h2 className="text-2xl font-bold">
            {language === 'bn' ? 'আজই চ্যাট শুরু করুন' : 'Ready to Start Chatting?'}
          </h2>
          <p className="text-orange-100 max-w-xl mx-auto text-sm">
            {language === 'bn'
              ? 'আমাদের হাজার হাজার সক্রিয় ব্যবহারকারীর সাথে যোগ দিন এবং আপনার পছন্দের রুমে কথা বলুন।'
              : 'Join thousands of active users online right now in our public chat rooms or random roulette.'}
          </p>
          <div className="pt-2 flex justify-center gap-4">
            <button
              onClick={() => navigate('/rooms')}
              className="px-6 py-3 bg-white text-orange-600 font-bold rounded-xl shadow-md hover:bg-orange-50 transition-colors cursor-pointer"
            >
              {language === 'bn' ? 'চ্যাট রুম ব্রাউজ করুন' : 'Browse Chat Rooms'}
            </button>
            <button
              onClick={() => navigate('/random')}
              className="px-6 py-3 bg-orange-700 text-white font-bold rounded-xl shadow-md hover:bg-orange-800 transition-colors border border-orange-500/50 cursor-pointer"
            >
              {language === 'bn' ? 'রুলেট চ্যাট' : 'Random Roulette'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
