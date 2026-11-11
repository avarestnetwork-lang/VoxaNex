import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { SEOHead } from '../components/common/SEOHead';
import { Mail, Send, CheckCircle2, MessageSquare, AlertCircle, Info } from 'lucide-react';

export const ContactPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('general');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError(language === 'bn' ? 'দয়া করে সমস্ত প্রয়োজনীয় ক্ষেত্র পূরণ করুন।' : 'Please fill in all required fields.');
      return;
    }
    setError('');
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={
          language === 'bn'
            ? 'যোগাযোগ ও সহায়তা - বাংলা, দেশি ও আন্তর্জাতিক সাপোর্ট – ChatLustora'
            : 'Contact ChatLustora – Bangla, Desi & International Support'
        }
        description={
          language === 'bn'
            ? 'বাংলা, দেশি ও আন্তর্জাতিক সাপোর্টের জন্য চ্যাটলুস্টোরার সাথে যোগাযোগ করুন। চ্যাট, নিরাপত্তা বা কমিউনিটি জিজ্ঞাসায় সহায়তার জন্য আমাদের গ্লোবাল টিমের সাথে যোগাযোগ করুন।'
            : 'Get in touch with ChatLustora for Bangla, Desi, and international support. Reach out to our global team for help with chat, safety, or community inquiries.'
        }
        canonicalPath="/contact"
      />

      <div className="max-w-4xl mx-auto space-y-10">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-rose-600 to-orange-500 text-white shadow-xl shadow-rose-500/20 mb-1">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {language === 'bn' ? 'আমাদের সাথে যোগাযোগ করুন' : 'Contact Support & Inquiries'}
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto leading-relaxed">
            {language === 'bn'
              ? 'যেকোনো প্রশ্ন, মতামত, বা প্রযুক্তিগত সহায়তার জন্য আমাদের বার্তা পাঠান। আমরা দ্রুত উত্তর দেওয়ার চেষ্টা করি।'
              : 'Have a question, feedback, or need moderation support? Send us a message and our team will review it.'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Contact Info Sidebar */}
          <div className="space-y-6 lg:col-span-1">
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {language === 'bn' ? 'সহায়তা ও যোগাযোগ চ্যানেল' : 'Support Channels'}
              </h3>
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white block">
                      {language === 'bn' ? 'অফিসিয়াল ইমেইল' : 'Official Support Email'}
                    </span>
                    <a
                      href="mailto:chatlustora@gmail.com"
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline block break-all"
                    >
                      chatlustora@gmail.com
                    </a>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mt-0.5">
                      {language === 'bn' ? 'যেকোনো জিজ্ঞাসায় সরাসরি ইমেইল করুন' : 'Default inbox for support, safety, & business'}
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-white block">
                      {language === 'bn' ? 'ওয়েব সাপোর্ট ফর্ম' : 'Web Support Form'}
                    </span>
                    <span className="text-xs">
                      {language === 'bn' ? 'নিচের ফর্মের মাধ্যমে বার্তা পাঠান' : 'Submit inquiries via the form alongside'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-900 dark:text-rose-300 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold">
                  <Mail className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{language === 'bn' ? 'ডিফল্ট সাপোর্ট ডেস্ক' : 'Official Support Desk'}</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {language === 'bn'
                    ? 'আমাদের প্রাথমিক যোগাযোগ ইমেইল: chatlustora@gmail.com। যেকোনো প্ল্যাটফর্ম প্রশ্ন, মডারেশন রিপোর্ট বা কারিগরি সহায়তার জন্য নির্দ্বিধায় যোগাযোগ করুন।'
                    : 'Our default primary contact email is chatlustora@gmail.com. Feel free to contact our moderation & support team directly via email or the form.'}
                </p>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm lg:col-span-2">
            {submitted ? (
              <div className="text-center py-12 space-y-4">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {language === 'bn' ? 'বার্তাটি সফলভাবে পাঠানো হয়েছে!' : 'Message Sent Successfully!'}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                  {language === 'bn'
                    ? 'আমাদের সাথে যোগাযোগের জন্য ধন্যবাদ। আমাদের টিম শীঘ্রই আপনার সাথে যোগাযোগ করবে।'
                    : 'Thank you for reaching out to ChatLustora. Our trust & support team will review your inquiry.'}
                </p>
                <div className="pt-4">
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setName('');
                      setEmail('');
                      setMessage('');
                    }}
                    className="px-6 py-2.5 bg-rose-600 text-white font-semibold text-xs rounded-xl shadow hover:bg-rose-700 transition-colors cursor-pointer"
                  >
                    {language === 'bn' ? 'আরেকটি বার্তা পাঠান' : 'Send Another Message'}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                      {language === 'bn' ? 'আপনার নাম' : 'Your Name'} *
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Arif Hossain"
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                      {language === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'} *
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. arif@example.com"
                      className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                    {language === 'bn' ? 'বিষয়' : 'Subject'}
                  </label>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-rose-500"
                  >
                    <option value="general">{language === 'bn' ? 'সাধারণ প্রশ্ন' : 'General Inquiry'}</option>
                    <option value="support">{language === 'bn' ? 'প্রযুক্তিগত সহায়তা' : 'Technical Support'}</option>
                    <option value="safety">{language === 'bn' ? 'নিরাপত্তা ও রিপোর্ট' : 'Trust & Safety Question'}</option>
                    <option value="feedback">{language === 'bn' ? 'মতামত বা পরামর্শ' : 'Feedback & Suggestions'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                    {language === 'bn' ? 'বার্তা' : 'Message'} *
                  </label>
                  <textarea
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={language === 'bn' ? 'আপনার বার্তা লিখুন...' : 'Write your message here...'}
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:border-rose-500"
                  ></textarea>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{language === 'bn' ? 'বার্তা পাঠান' : 'Submit Message'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
