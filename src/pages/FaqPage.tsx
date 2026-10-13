import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { HelpCircle } from 'lucide-react';

export const FaqPage: React.FC = () => {
  const { language } = useLanguage();
  const faqs = [
    {
      q: language === 'bn' ? 'VoxaNex ব্যবহার করতে কি কোনো রেজিস্ট্রেশন বা অ্যাকাউন্ট লাগবে?' : 'Do I need an account or registration to use VoxaNex?',
      a: language === 'bn'
        ? 'না! VoxaNex সম্পূর্ণ বিনামূল্যে এবং অ্যাকাউন্ট ছাড়াই ব্যবহার করা যায়। আপনি সরাসরি চ্যাট রুমে প্রবেশ করতে পারেন বা র‍্যান্ডম চ্যাট শুরু করতে পারেন।'
        : 'No! VoxaNex is 100% free and requires zero registration. You can jump straight into any chat room or start random video matching immediately.',
    },
    {
      q: language === 'bn' ? 'রুলেট চ্যাটে কীভাবে অপরিচিত ব্যক্তির সাথে সংযুক্ত হব?' : 'How do I connect with strangers on Roulette chat?',
      a: language === 'bn'
        ? 'রুলেট পেজে গিয়ে "কানেক্ট" বাটন ক্লিক করুন। সিস্টেম আপনাকে একজন অনলাইন অপরিচিত ব্যক্তির সাথে যুক্ত করবে। পছন্দ না হলে স্কিপ করতে পারেন।'
        : 'Go to the Roulette page and click connect. The system instantly pairs you with an online stranger. If you want someone else, simply click skip.',
    },
    {
      q: language === 'bn' ? 'চ্যাট রুমে নিরাপত্তা এবং নিয়মাবলী কী?' : 'What are the safety rules in chat rooms?',
      a: language === 'bn'
        ? 'আমাদের প্ল্যাটফর্মে ২৪/৭ মডারেশন রয়েছে। অপব্যবহার, স্প্যাম বা অনুপযুক্ত আচরণ কঠোরভাবে নিষিদ্ধ। কারো বিরুদ্ধে রিপোর্ট করতে মডারেশন টুল ব্যবহার করুন।'
        : 'We enforce 24/7 moderation. Harassment, spam, or inappropriate behavior is strictly prohibited. Use the report and block tools if needed.',
    },
    {
      q: language === 'bn' ? 'ভয়েস এবং ওয়েবক্যাম চ্যাট কীভাবে কাজ করে?' : 'How does voice and webcam chat work?',
      a: language === 'bn'
        ? 'আপনি ভয়েস বা ওয়েবক্যাম রুমে প্রবেশ করে ব্রাউজারের মাইক্রোফোন এবং ক্যামেরা পারমিশন দিয়ে সরাসরি কথা বলতে পারেন।'
        : 'Enter any voice or webcam room and grant your browser microphone and camera permissions to begin speaking and video chatting.',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <div className="max-w-4xl mx-auto space-y-10">
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'সাধারণ জিজ্ঞাসা (FAQ)' : 'Frequently Asked Questions'}
          </h1>
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
