import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { HelpCircle } from 'lucide-react';

export const FaqPage: React.FC = () => {
  const { language } = useLanguage();
  const faqs = [
    {
      q: language === 'bn' ? 'ChatLustora ব্যবহার করতে কি কোনো রেজিস্ট্রেশন বা অ্যাকাউন্ট লাগবে?' : 'Do I need an account or registration to use ChatLustora?',
      a: language === 'bn'
        ? 'না! ChatLustora সম্পূর্ণ বিনামূল্যে এবং বাধ্যতামূলক অ্যাকাউন্ট ছাড়াই ব্যবহার করা যায়। ১৮+ প্রাপ্তবয়স্করা সরাসরি যে কোনো পাবলিক চ্যাট রুমে প্রবেশ করতে পারেন বা ১-অন-১ প্রাইভেট মেসেজিং শুরু করতে পারেন।'
        : 'No! ChatLustora is completely free to access and requires no mandatory sign-up. Adults aged 18+ can jump straight into public group rooms or direct messaging with an anonymous guest session.',
    },
    {
      q: language === 'bn' ? 'রুলেট বা পার্টনার চ্যাটে কীভাবে যুক্ত হব?' : 'How do I connect with people on ChatLustora?',
      a: language === 'bn'
        ? 'রুম ডিরেক্টরি থেকে আপনার পছন্দের রুম (যেমন বাংলা আড্ডা, সেক্স চ্যাট, ডেটিং) বেছে নিন অথবা রুলেট পেজে কানেক্ট ক্লিক করে সরাসরি যুক্ত হোন।'
        : 'Select your preferred lounge from our Room Directory (such as Bangla Adult Chat, Indian/Desi rooms, or Dating) or click connect on the Roulette page.',
    },
    {
      q: language === 'bn' ? 'চ্যাট রুমে ১৮+ নিরাপত্তা এবং নিয়মাবলী কী?' : 'What are the 18+ safety rules in chat rooms?',
      a: language === 'bn'
        ? 'প্ল্যাটফর্মটি কঠোরভাবে ১৮+ প্রাপ্তবয়স্কদের জন্য। হয়রানি, অযাচিত স্প্যাম, অপ্রাপ্তবয়স্কদের সাথে যোগাযোগ বা ব্ল্যাকমেইল সম্পূর্ণরূপে নিষিদ্ধ। কারো বিরুদ্ধে রিপোর্ট করতে ইনস্ট্যান্ট রিপোর্ট ও ব্লক টুল ব্যবহার করুন।'
        : 'ChatLustora is an adults-only community. Minors, harassment, spam, and non-consensual sharing are strictly prohibited. Instant report and block tools are accessible directly from participant avatars.',
    },
    {
      q: language === 'bn' ? 'ব্যক্তিগত বার্তা (প্রাইভেট মেসেজিং) কীভাবে কাজ করে?' : 'How does private direct messaging work?',
      a: language === 'bn'
        ? 'পাবলিক রুমে যে কোনো ব্যক্তির নামের ওপর ক্লিক করে "Private Message" চাপুন। একটি গোপনীয় ১-অন-১ চ্যাট উইন্ডো খুলবে যা শুধুমাত্র আপনাদের দুজনের জন্য দৃশ্যমান।'
        : 'Click any user in a public room and select "Private Message". A confidential direct messaging session opens with real-time delivery and read receipts.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={language === 'bn' ? 'সাধারণ জিজ্ঞাসা (FAQ) – ChatLustora' : 'Frequently Asked Questions (FAQ) – ChatLustora'}
        description="Frequently asked questions about ChatLustora 18+ adult chat, dating, private messaging, safety rules, and guest sessions."
        canonicalPath="/faq"
      />
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white shadow-xl shadow-rose-500/20 mx-auto mb-1">
            <HelpCircle className="w-7 h-7" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'সাধারণ জিজ্ঞাসা (FAQ)' : 'Frequently Asked Questions'}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
            {language === 'bn'
              ? 'ChatLustora সম্পর্কিত প্রায়শই জিজ্ঞাসিত প্রশ্ন ও উত্তর।'
              : 'Answers to common questions about ChatLustora rooms, private chats, dating, and safety.'}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          <div className="space-y-4">
            {faqs.map((faq, idx) => (
              <div key={idx} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden transition-colors">
                <div className="w-full flex items-center justify-between p-4 text-left font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
                  <span>{faq.q}</span>
                </div>
                <div className="p-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                  {faq.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
