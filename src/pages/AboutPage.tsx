import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { MessageSquare, Shield, Users, Globe, Sparkles, Heart, Lock } from 'lucide-react';

export const AboutPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'চ্যাটলাস্টোরা (ChatLustora) সম্পর্কে – ১৮+ বাংলা ও দেশি কমিউনিটি'
            : 'About ChatLustora – 18+ Bangla & Desi Adult Community'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরা ১৮+ প্রাপ্তবয়স্কদের জন্য একটি আধুনিক বাংলা ও দেশি চ্যাট এবং ডেটিং কমিউনিটি। সম্মানজনক পাবলিক আড্ডা, প্রাইভেট মেসেজিং ও ব্যবহারকারীর গোপনীয়তা।'
            : 'Learn about ChatLustora, a modern adults-only community for Bangla and Desi conversations, dating, flirting, and private messaging.'
        }
        canonicalPath="/about"
      />
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white shadow-xl shadow-rose-500/20 mb-2">
            <MessageSquare className="w-8 h-8 fill-white text-rose-500" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'ChatLustora সম্পর্কে' : 'About ChatLustora'}
          </h1>
          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
            {language === 'bn'
              ? '১৮+ প্রাপ্তবয়স্কদের জন্য উন্মুক্ত বাংলা ও দেশি চ্যাট এবং ডেটিং প্ল্যাটফর্ম। কোনো বাধ্যতামূলক নিবন্ধন ছাড়াই রিয়েল-টাইমে যুক্ত হোন।'
              : 'An adults-only (18+) community designed for Bengali and Desi conversations, dating, flirting, and secure private messaging.'}
          </p>
        </div>

        {/* Mission Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 shadow-sm border border-slate-200 dark:border-slate-800 space-y-6">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-rose-500" />
            {language === 'bn' ? 'আমাদের লক্ষ্য ও নীতিমালা' : 'Our Mission & Values'}
          </h2>
          <p className="text-slate-700 dark:text-slate-300 leading-relaxed text-base">
            {language === 'bn'
              ? 'ChatLustora তৈরি হয়েছে একটি উন্মুক্ত অথচ সম্মানজনক পরিবেশ গড়ে তোলার লক্ষ্যে, যেখানে প্রাপ্তবয়স্করা স্বাধীনভাবে মনের ভাব প্রকাশ করতে পারেন, নতুন মানুষের সাথে রোমান্টিক বা বন্ধুত্বপূর্ণ পরিচয় গড়ে তুলতে পারেন এবং নিরাপদ ১-অন-১ প্রাইভেট মেসেজিংয়ে অংশ নিতে পারেন। আমরা ব্যবহারকারীর গোপনীয়তাকে সর্বোচ্চ অগ্রাধিকার দিই।'
              : 'ChatLustora was established to provide an open, respectful space where adults can connect freely, explore romantic or friendly interactions, and engage in real-time group conversations and direct messaging with confidence in their privacy.'}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? 'বাংলা ও দেশি কমিউনিটি' : 'Bangla & Desi Culture'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? 'বাংলাদেশ, ভারত ও প্রবাসী বাঙালিদের জন্য মাতৃভাষায় আড্ডার সুযোগ।' : 'Connecting Bengali, Indian, and South Asian adults worldwide.'}
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? '১৮+ সম্মতি ও নিরাপত্তা' : '18+ & Mutual Consent'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? 'কঠোর বয়স-নীতিমালা, ব্লক টুলস এবং যেকোনো হয়রানির তাৎক্ষণিক প্রতিকার।' : 'Strict age eligibility, instant blocking tools, and human moderation.'}
              </p>
            </div>
            <div className="p-5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 space-y-2">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {language === 'bn' ? 'ব্যক্তিগত গোপনীয়তা' : 'Privacy Protection'}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {language === 'bn' ? 'গেস্ট আইডেন্টিটি এবং কোনো অনাকাঙ্ক্ষিত ব্যক্তিগত তথ্য সংগ্রহ নয়।' : 'Data minimization with anonymous guest sessions and isolated DMs.'}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="bg-gradient-to-r from-rose-600 to-orange-600 rounded-2xl p-8 text-white shadow-xl text-center space-y-4">
          <h2 className="text-2xl font-bold">
            {language === 'bn' ? 'আজই যোগাযোগ শুরু করুন' : 'Start Connecting Today'}
          </h2>
          <p className="text-rose-100 max-w-xl mx-auto text-sm">
            {language === 'bn'
              ? 'আমাদের পাবলিক চ্যাট রুমগুলো অন্বেষণ করুন অথবা সরাসরি ডেটিং ও ফ্লার্টিং বিভাগে প্রবেশ করুন।'
              : 'Explore our public group chat rooms or visit the dating and flirting section for respectful 1-on-1 conversations.'}
          </p>
          <div className="pt-2 flex flex-wrap justify-center gap-4">
            <button
              onClick={() => navigate('/rooms')}
              className="px-6 py-3 bg-white text-rose-600 font-bold rounded-xl shadow-md hover:bg-rose-50 transition-colors cursor-pointer"
            >
              {language === 'bn' ? 'চ্যাট রুম ব্রাউজ করুন' : 'Browse Chat Rooms'}
            </button>
            <button
              onClick={() => navigate('/dating')}
              className="px-6 py-3 bg-rose-800 text-white font-bold rounded-xl shadow-md hover:bg-rose-900 transition-colors border border-rose-500/50 cursor-pointer"
            >
              {language === 'bn' ? 'ডেটিং ও ফ্লার্টিং' : 'Dating & Flirting'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
