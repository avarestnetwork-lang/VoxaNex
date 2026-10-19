import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import {
  Heart,
  MessageSquare,
  ShieldCheck,
  Users,
  Lock,
  Sparkles,
  ArrowRight,
  Flame,
  Coffee,
  CheckCircle2,
  AlertTriangle,
  Globe2,
} from 'lucide-react';

export const DatingLandingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'বাংলা ও দেশি প্রাপ্তবয়স্ক ডেটিং এবং ফ্লার্টিং চ্যাট – ChatLustora'
            : 'Bangla & Desi Adult Dating, Flirting & Romantic Chat – ChatLustora'
        }
        description={
          language === 'bn'
            ? '১৮+ প্রাপ্তবয়স্কদের জন্য সম্মানজনক বাংলা ডেটিং, মিষ্টি ফ্লার্টিং এবং ১-অন-১ প্রাইভেট চ্যাট। বিশ্বজুড়ে বাঙালি ও দেশি প্রাপ্তবয়স্কদের সাথে পরিচয় ও নিরাপদ বন্ধুত্ব।'
            : 'Explore adult Bangla dating, respectful flirting, and private 1-on-1 messaging for adults aged 18+. Connect with Bengali and Desi adults across Bangladesh, India, and worldwide.'
        }
        canonicalPath="/dating"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'Bangla & Desi Adult Dating and Flirting Chat',
          description:
            'A respectful, 18+ online environment for Bengali and Desi adults interested in dating, flirting, and private conversations.',
          publisher: {
            '@type': 'Organization',
            name: 'ChatLustora',
            url: 'https://chatlustora.com',
          },
        }}
      />

      <div className="max-w-5xl mx-auto space-y-12">
        {/* Hero Section */}
        <div className="text-center space-y-6 pt-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold uppercase tracking-wider">
            <Heart className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />
            <span>{language === 'bn' ? '১৮+ প্রাপ্তবয়স্ক ডেটিং ও ফ্লার্টিং' : '18+ Adult Dating & Flirting Community'}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            {language === 'bn' ? (
              <>
                বাংলা ও দেশি <span className="text-rose-600 dark:text-rose-400">ডেটিং ও রোমান্টিক চ্যাট</span>
              </>
            ) : (
              <>
                Bangla & Desi <span className="text-rose-600 dark:text-rose-400">Adult Dating & Flirting</span>
              </>
            )}
          </h1>

          <p className="max-w-2xl mx-auto text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            {language === 'bn'
              ? 'চ্যাটলাস্টোরায় স্বাগতম — প্রাপ্তবয়স্কদের জন্য অর্থবহ অনলাইন পরিচয়, মিষ্টি ফ্লার্টিং এবং ব্যক্তিগত মেসেজিংয়ের নিরাপদ ঠিকানা। বাংলা ও দেশি কমিউনিটিতে নতুন মানুষের সাথে সম্মানজনকভাবে পরিচিত হোন।'
              : 'Welcome to ChatLustora — a respectful, modern space for adults aged 18+ to connect, flirt, and discover romantic sparks. Connect through real-time public rooms or move into private direct messages.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <button
              onClick={() => navigate('/rooms')}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-lg shadow-rose-600/25 transition-all cursor-pointer"
            >
              <Users className="w-5 h-5" />
              <span>{language === 'bn' ? 'ডেটিং ও ফ্লার্টিং রুম ব্রাউজ করুন' : 'Browse Dating & Chat Rooms'}</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
            <button
              onClick={() => navigate('/messages')}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white font-semibold transition-all cursor-pointer"
            >
              <MessageSquare className="w-5 h-5 text-rose-500" />
              <span>{language === 'bn' ? 'ব্যক্তিগত মেসেজ দেখুন' : 'Open Private Messages'}</span>
            </button>
          </div>
        </div>

        {/* Core Principles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {language === 'bn' ? 'মিউচুয়াল কনসেন্ট ও সম্মান' : 'Mutual Consent & Respect'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'অনলাইন ফ্লার্টিং আনন্দদায়ক তখনই যখন উভয়ের স্পষ্ট সম্মতি থাকে। কারো অনিচ্ছাকে সম্মান জানানো এবং ব্যক্তিগত সীমানা বজায় রাখা বাধ্যতামূলক।'
                : 'Online flirting thrives on mutual enthusiasm and consent. Respect boundaries and always take "no" as final.'}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {language === 'bn' ? 'প্রাইভেসি ও পরিচয় গোপনীয়তা' : 'Privacy-First Architecture'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'আপনার আসল নাম, ফোন নম্বর বা সামাজিক মাধ্যমের তথ্য শেয়ার না করেই চ্যাট শুরু করুন। গেস্ট মোডে আপনার ব্যক্তিগত তথ্য নিরাপদ।'
                : 'Start conversations without exposing your phone number, social accounts, or real identity until you feel completely comfortable.'}
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {language === 'bn' ? 'ব্লক ও তাৎক্ষণিক রিপোর্ট' : 'Instant Block & Report Tools'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'যেকোনো অসৌজন্যমূলক আচরণে সাথে সাথে ব্যবহারকারীকে ব্লক করুন অথবা মডারেশন টিমের কাছে রিপোর্ট করুন।'
                : 'Maintain total control. Block unwanted callers or submit immediate abuse reports directly from chat avatars.'}
            </p>
          </div>
        </div>

        {/* Adult Dating Safety Guide */}
        <div className="p-8 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'প্রাপ্তবয়স্ক অনলাইন ডেটিং ও নিরাপত্তার নির্দেশিকা' : 'Adult Online Dating & Flirting Safety Tips'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-700 dark:text-slate-300">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                {language === 'bn'
                  ? 'কখনোই আর্থিক তথ্য, ব্যাংক অ্যাকাউন্ট, বিকাশ/নগদ নম্বর বা ওটিপি কারো সাথে শেয়ার করবেন না।'
                  : 'Never transfer money or share banking details, mobile wallet accounts, or OTP verification codes.'}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                {language === 'bn'
                  ? 'প্রথম সাক্ষাতে সর্বদা পরিচিত পাবলিক প্লেসে দেখা করুন এবং বিশ্বস্ত বন্ধুকে জানিয়ে রাখুন।'
                  : 'If you choose to meet offline, always meet in a public location and notify a trusted friend.'}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                {language === 'bn'
                  ? 'ব্যক্তিগত ছবি বা সংবেদনশীল কন্টেন্ট শেয়ার করার আগে সতর্ক থাকুন। সম্মানজনক আলাপ বজায় রাখুন।'
                  : 'Guard personal and intimate media cautiously. Never pressure others for photos or contact details.'}
              </span>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                {language === 'bn'
                  ? 'প্ল্যাটফর্মে ১৮ বছরের কম বয়সী কারো সাথে কোনো প্রকার আলোচনা সম্পূর্ণ নিষিদ্ধ ও আইনত দণ্ডনীয়।'
                  : 'ChatLustora strictly enforces an 18+ policy. Interacting with minors is zero-tolerance and illegal.'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
