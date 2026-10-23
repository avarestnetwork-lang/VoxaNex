import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import {
  MessageSquare,
  Shield,
  Users,
  Video,
  Lock,
  Heart,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Smile,
  Smartphone,
  UserCheck,
} from 'lucide-react';

export const BanglaChatLandingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const faqs = [
    {
      q: language === 'bn' ? 'বাংলা চ্যাট রুম কি বিনামূল্যে ব্যবহার করা যায়?' : 'Is the Bangla chat room free to use?',
      a: language === 'bn'
        ? 'হ্যাঁ, চ্যাটলাস্টোরার বাংলা চ্যাট রুম সম্পূর্ণ বিনামূল্যে উন্মুক্ত। কোনো প্রকার ফি বা সাবস্ক্রিপশন ছাড়াই তাৎক্ষণিকভাবে আড্ডায় যোগ দেওয়া যায়।'
        : 'Yes, ChatLustora Bangla chat is 100% free. You can join group conversations or direct messaging with zero subscription fees.',
    },
    {
      q: language === 'bn' ? 'বাংলা রুমে প্রবেশের জন্য কি অ্যাকাউন্ট রেজিস্ট্রেশন বাধ্যতামূলক?' : 'Do I need to register an account to enter?',
      a: language === 'bn'
        ? 'না, আপনি একটি পছন্দের নিকনেম নির্বাচন করে ১৮+ গেস্ট হিসেবে অবিলম্বে চ্যাট শুরু করতে পারেন। তবে আপনার নিকনেম সংরক্ষণ করতে চাইলে স্থায়ী অ্যাকাউন্ট তৈরি করতে পারেন।'
        : 'No registration is required. You can pick a temporary nickname and enter as an 18+ verified guest immediately, or register an account if you wish to reserve your handle.',
    },
    {
      q: language === 'bn' ? 'বাংলা রুমে কারা আড্ডা দিতে পারেন?' : 'Who joins the Bangla chat community?',
      a: language === 'bn'
        ? 'বাংলাদেশ, ভারতের পশ্চিমবঙ্গ, ত্রিপুরা এবং যুক্তরাজ্য, যুক্তরাষ্ট্র ও মধ্যপ্রাচ্যে বসবাসকারী প্রবাসী বাঙালি প্রাপ্তবয়স্করা (১৮+) এই রুমে বন্ধুত্ব, ডেটিং এবং প্রাণবন্ত আলোচনা করতে যোগ দেন।'
        : 'Adult Bengali speakers from Bangladesh, West Bengal, and the global diaspora join for friendly discussions, dating, flirting, and cultural connection in an 18+ environment.',
    },
    {
      q: language === 'bn' ? 'প্রাইভেট ১-অন-১ চ্যাট কি সুরক্ষিত ও গোপনীয়?' : 'Is private 1-on-1 messaging secure and confidential?',
      a: language === 'bn'
        ? 'হ্যাঁ, যে কোনো সদস্যের নামের ওপর ক্লিক করে আপনি পপ-আপ প্রাইভেট মেসেজিং শুরু করতে পারেন। আপনার প্রাইভেট কথোপকথন এনক্রিপ্টেড এবং শুধুমাত্র সংশ্লিষ্ট দুজনের কাছে দৃশ্যমান।'
        : 'Yes, clicking on any participant opens a confidential private floating chat window with real-time delivery and read receipts, visible solely to the two participants.',
    },
    {
      q: language === 'bn' ? 'নিরাপত্তা ও মডারেশন কীভাবে পরিচালিত হয়?' : 'How is safety and moderation maintained in the room?',
      a: language === 'bn'
        ? 'আমাদের অটোমেটেড ফিল্টার এবং মানব মডারেটররা হয়রানি, অনুমতিহীন কন্টেন্ট ও স্প্যাম রোধে সার্বক্ষণিক সক্রিয় থাকেন। যে কোনো সময় অনাকাঙ্ক্ষিত ব্যবহারকারীকে ব্লক বা রিপোর্ট করা যায়।'
        : 'Automated safety filters and active moderators enforce community standards 24/7. Participants have instant tools to block or report users violating mutual consent.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'বাংলা চ্যাট রুম ও প্রাপ্তবয়স্কদের আড্ডা – ChatLustora'
            : 'Bangla Adult Chat, Dating & Bengali Community Room – ChatLustora'
        }
        description={
          language === 'bn'
            ? 'চ্যাটলাস্টোরায় বাংলা চ্যাট রুমে যুক্ত হোন। প্রাপ্তবয়স্ক বাঙালি সিঙ্গল ও বন্ধুদের সাথে সম্মানজনক আড্ডা, মিষ্টি ফ্লার্টিং এবং সুরক্ষিত ১-অন-১ প্রাইভেট মেসেজিং।'
            : 'Join the Bangla adult chat room on ChatLustora. Meet Bengali singles and adults for friendly conversation, dating, and private messaging in a respectful 18+ space.'
        }
        canonicalPath="/chat/bangla"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: 'Bangla Adult Chat & Bengali Community Room',
          description:
            'A respectful, 18+ online environment for Bengali adults interested in open conversations, dating, flirting, and private direct messaging.',
          publisher: {
            '@type': 'Organization',
            name: 'ChatLustora',
            url: 'https://chatlustora.com',
          },
        }}
      />

      <div className="max-w-5xl mx-auto space-y-12">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/rooms')}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{language === 'bn' ? 'রুম ডিরেক্টরিতে ফিরে যান' : 'Back to Room Directory'}</span>
          </button>
          <div className="text-xs text-slate-400">
            <span>{language === 'bn' ? 'কমিউনিটি' : 'Community'} / </span>
            <span className="font-semibold text-rose-500">{language === 'bn' ? 'বাংলা চ্যাট' : 'Bangla Chat'}</span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="text-center space-y-6 pt-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>{language === 'bn' ? '১৮+ বাংলা কমিউনিটি · লাইভ আড্ডা' : '18+ Bengali Community · Open 24/7'}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            {language === 'bn' ? (
              <>
                বাংলা চ্যাট রুম ও <span className="text-rose-600 dark:text-rose-400">বাঙালিদের আড্ডা</span>
              </>
            ) : (
              <>
                Bangla Adult Chat & <span className="text-rose-600 dark:text-rose-400">Bengali Community</span>
              </>
            )}
          </h1>

          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {language === 'bn'
              ? 'চ্যাটলাস্টোরার প্রধান বাংলা চ্যাট রুমে স্বাগতম। বাংলাদেশ, পশ্চিমবঙ্গ এবং বিশ্বব্যাপী প্রবাসী বাঙালিদের সাথে মুক্ত আলোচনা, ফ্লার্টিং ও বন্ধুত্বে মেতে উঠুন একটি শালীন এবং সম্মানজনক প্রাপ্তবয়স্ক পরিবেশে।'
              : 'Welcome to ChatLustora’s dedicated Bangla room. Connect with Bengali-speaking adults worldwide for vibrant conversations, dating, flirting, and confidential private messaging in a safe, moderated space.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <button
              onClick={() => navigate('/guest-entry', { targetRoom: 'bangla' })}
              className="inline-flex items-center justify-center bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white text-base sm:text-lg font-bold px-8 py-3.5 rounded-xl shadow-lg shadow-rose-600/25 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <span>{language === 'bn' ? 'বাংলা রুমে প্রবেশ করুন' : 'Enter Bangla Chat Room'}</span>
              <ArrowRight className="w-5 h-5 ml-2" />
            </button>
            <button
              onClick={() => navigate('/dating')}
              className="inline-flex items-center justify-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-base font-bold px-6 py-3.5 rounded-xl transition-all cursor-pointer"
            >
              <Heart className="w-4 h-4 mr-2 text-rose-500 fill-rose-500" />
              <span>{language === 'bn' ? 'বাংলা ডেটিং দেখুন' : 'Explore Bangla Dating'}</span>
            </button>
          </div>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
              <UserCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'তাত্ক্ষণিক গেস্ট প্রবেশ' : 'Instant Guest Access'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'বাধ্যতামূলক রেজিস্ট্রেশন ছাড়া একটি নিকনেম নিয়ে সরাসরি বাংলা আড্ডায় যোগ দিন।'
                : 'Pick an avatar and nickname to start chatting immediately without mandatory email signup.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? '১-অন-১ প্রাইভেট উইন্ডো' : '1-on-1 Floating Chat'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'রুমের বাইরে না গিয়ে যে কোনো অংশগ্রহণকারীর সাথে সরাসরি গোপনীয় প্রাইভেট মেসেজিং শুরু করুন।'
                : 'Chat confidentially side-by-side with individual participants without losing your place in the public room.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? '২৪/৭ নিরাপত্তা ও সুরক্ষা' : '24/7 Moderation & Safety'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'সকল রুমে কঠোর মডারেশন এবং হয়রানির বিরুদ্ধে জিরো টলারেন্স নীতি বলবৎ রয়েছে।'
                : 'Moderation safeguards protect members from harassment, with 1-click user blocking and incident reporting.'}
            </p>
          </div>
        </div>

        {/* Community Guidelines Checklist */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-8 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-rose-500" />
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'বাংলা রুমের আচরণবিধি ও নিয়মাবলী' : 'Bangla Room Etiquette & Rules'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{language === 'bn' ? 'ব্যবহারকারীদের অবশ্যই কমপক্ষে ১৮ বছর বা তার বেশি বয়সী হতে হবে।' : 'All participants must be strictly 18 years of age or older.'}</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{language === 'bn' ? 'পারস্পরিক সম্মতি ও ভদ্রতা বজায় রাখা বাধ্যতামূলক।' : 'Mutual consent and respectful conversation are mandatory at all times.'}</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{language === 'bn' ? 'অনুমতিহীন ব্যক্তিগত তথ্য (ফোন নম্বর, সামাজিক যোগাযোগ মাধ্যম) শেয়ার করবেন না।' : 'Never disclose personal identifying information or contact details publicly.'}</span>
            </div>
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <span>{language === 'bn' ? 'স্প্যাম, বাণিজ্যিক বিজ্ঞাপন বা ঘৃণা ছড়ানো সম্পূর্ণ নিষিদ্ধ।' : 'Spam, non-consensual solicitation, and hate speech are strictly prohibited.'}</span>
            </div>
          </div>
        </div>

        {/* FAQ Accordion */}
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'বাংলা চ্যাট সংক্রান্ত সাধারণ জিজ্ঞাসা' : 'Frequently Asked Questions'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {language === 'bn' ? 'বাংলা রুমে অংশগ্রহণের পূর্বে জেনে নিন প্রয়োজনীয় তথ্য' : 'Everything you need to know before joining the Bangla room'}
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden transition-colors"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full py-4 px-6 text-left flex items-center justify-between gap-4 font-semibold text-slate-900 dark:text-white hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <span className="text-base">{faq.q}</span>
                  {openFaq === idx ? (
                    <ChevronUp className="w-5 h-5 text-rose-500 shrink-0" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                </button>
                {openFaq === idx && (
                  <div className="px-6 pb-5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Final CTA Bar */}
        <div className="bg-gradient-to-r from-rose-600/10 via-orange-500/10 to-amber-500/10 border border-rose-500/20 rounded-2xl p-8 text-center space-y-4">
          <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
            {language === 'bn' ? 'বাঙালি কমিউনিটিতে যোগ দিতে প্রস্তুত?' : 'Ready to Meet People in the Bangla Room?'}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
            {language === 'bn'
              ? 'একটি নাম বেছে নিয়ে এখনই নিরাপদ ও সম্মানজনক প্রাপ্তবয়স্ক আড্ডায় যোগ দিন।'
              : 'Pick your nickname and step into a respectful, adult-verified environment today.'}
          </p>
          <button
            onClick={() => navigate('/guest-entry', { targetRoom: 'bangla' })}
            className="inline-flex items-center justify-center bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white font-bold px-8 py-3.5 rounded-xl shadow-lg shadow-rose-600/25 transition-all cursor-pointer"
          >
            <span>{language === 'bn' ? 'গেস্ট হিসেবে প্রবেশ করুন' : 'Join as Guest'}</span>
            <ArrowRight className="w-5 h-5 ml-2" />
          </button>
        </div>
      </div>
    </div>
  );
};
