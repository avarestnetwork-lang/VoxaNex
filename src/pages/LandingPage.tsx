import React, { useState } from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { SEOHead } from '../components/common/SEOHead';
import {
  MessageSquare,
  Shuffle,
  Compass,
  Video,
  Mic,
  Shield,
  Lock,
  Globe2,
  MapPin,
  ChevronRight,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap,
  Radio,
  AlertTriangle,
  UserCheck,
  Heart,
  Smile,
  CheckCircle2,
  Plus,
  Minus,
  ArrowRight,
  Tv,
  Smartphone,
  Users,
  MessageCircle,
  Mail,
  User,
  CheckCircle,
  Eye,
  EyeOff,
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const { navigate } = useRouter();
  const { language, t } = useLanguage();
  const { user, hasActiveSession, loginWithAccount } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Hero Sign In State
  const [heroTab, setHeroTab] = useState<'signin' | 'rooms'>(() => {
    return hasActiveSession && !user.isGuest ? 'rooms' : 'signin';
  });
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleHeroLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError(language === 'bn' ? 'অনুগ্রহ করে ইমেইল ও পাসওয়ার্ড দিন।' : 'Please enter your email and password.');
      return;
    }

    setLoginLoading(true);
    try {
      const res = await loginWithAccount(loginEmail.trim(), loginPassword);
      if (res.success) {
        navigate('/dashboard');
      } else {
        setLoginError(res.error || (language === 'bn' ? 'লগইন ব্যর্থ হয়েছে।' : 'Authentication failed. Please check your credentials.'));
      }
    } catch (err: any) {
      setLoginError(err.message || 'An unexpected error occurred during login.');
    } finally {
      setLoginLoading(false);
    }
  };

  const topRooms = [
    { name: language === 'bn' ? 'সেক্স চ্যাট' : 'Sex Chat', subtitle: language === 'bn' ? 'সবচেয়ে জনপ্রিয়' : 'Most popular', icon: MessageSquare, route: '/chat/sex' },
    { name: language === 'bn' ? 'ভারতীয় চ্যাট' : 'Indian Chat', subtitle: language === 'bn' ? 'আঞ্চলিক রুম' : 'Regional room', flag: 'https://flagcdn.com/w40/in.png', route: '/chat/indian' },
    { name: language === 'bn' ? 'বাংলাদেশি চ্যাট' : 'Bangladeshi Chat', subtitle: language === 'bn' ? 'আঞ্চলিক রুম' : 'Regional room', flag: 'https://flagcdn.com/w40/bd.png', route: '/chat/bangladeshi' },
    { name: language === 'bn' ? 'জার্মান চ্যাট' : 'German Chat', subtitle: language === 'bn' ? 'আঞ্চলিক রুম' : 'Regional room', flag: 'https://flagcdn.com/w40/de.png', route: '/chat/german' },
    { name: language === 'bn' ? 'ভিডিও চ্যাট' : 'Video Chat', subtitle: language === 'bn' ? 'ক্যাম টু ক্যাম' : 'Cam to cam', icon: Video, route: '/chat/video' },
    { name: language === 'bn' ? 'রুলেট চ্যাট' : 'Roulette Chat', subtitle: language === 'bn' ? 'র‍্যান্ডম পেয়ারিং' : 'Random pairing', icon: Shuffle, route: '/random' },
  ];

  const mainRooms = [
    {
      title: language === 'bn' ? 'সেক্স চ্যাট' : 'Sex Chat',
      desc: language === 'bn' 
        ? 'আমাদের প্রধান প্রাপ্তবয়স্ক রুম এবং সাইটের সবচেয়ে ব্যস্ততম রুম। এটি অপরিচিতদের সাথে উন্মুক্ত গ্রুপ চ্যাটের জন্য তৈরি। রিয়েল-টাইম ওয়েবক্যাম, ভয়েস এবং টেক্সট...' 
        : 'Our main adult room, and the busiest one on the site. It is built for open group chat with strangers. Real-time webcam, voice and text with people from...',
      badge: language === 'bn' ? 'সবচেয়ে জনপ্রিয়' : 'Most popular',
      badgeColor: 'bg-orange-100 text-orange-700 border-orange-200',
      icon: MessageSquare,
      route: '/chat/sex'
    },
    {
      title: language === 'bn' ? 'এডাল্ট চ্যাট' : 'Adult Chat',
      desc: language === 'bn'
        ? 'প্রাপ্তবয়স্কদের সাধারণ কথোপকথনের জন্য একটি রুম। মূল সেক্স চ্যাটের তুলনায় শান্ত এবং আলাপচারিতাপূর্ণ।'
        : 'A general room for grown-up conversation. Less focused than the main sex chat room and usually a slower, more talkative crowd. Good if you want...',
      badge: language === 'bn' ? '২৪/৭ খোলা' : 'Open 24/7',
      badgeColor: 'bg-amber-100 text-amber-700 border-amber-200',
      icon: Users,
      route: '/chat/sex'
    },
    {
      title: language === 'bn' ? 'ভিডিও চ্যাট' : 'Video Chat',
      desc: language === 'bn'
        ? 'ক্যাম-কেন্দ্রিক রুম। এখানে প্রত্যেকে ভিডিওর জন্য প্রস্তুত, তাই আপনি পাবলিকলি বা প্রাইভেটে ক্যাম-টু-ক্যাম কথা বলতে পারেন।'
        : 'The cam-first room. Everyone here is set up for video, so you can go cam-to-cam in public or take it to a private window without asking around first.',
      badge: language === 'bn' ? 'ক্যাম টু ক্যাম' : 'Cam to cam',
      badgeColor: 'bg-purple-100 text-purple-700 border-purple-200',
      icon: Video,
      route: '/chat/asian'
    },
    {
      title: language === 'bn' ? 'রুলেট চ্যাট' : 'Roulette Chat',
      desc: language === 'bn'
        ? 'র‍্যান্ডম ভিডিও চ্যাট, একের পর এক। কানেক্টে ক্লিক করুন এবং একজন অপরিচিত ব্যক্তির সাথে যুক্ত হন; পছন্দ না হলে স্কিপ করুন।'
        : 'Random video chat, one to one. Click connect and you are paired with a stranger; if it is not going anywhere, skip and you get the next person. No...',
      badge: language === 'bn' ? 'র‍্যান্ডম পেয়ারিং' : 'Random pairing',
      badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
      icon: Shuffle,
      route: '/random'
    },
    {
      title: language === 'bn' ? 'গে চ্যাট' : 'Gay Chat',
      desc: language === 'bn'
        ? 'গে এবং বাই পুরুষদের জন্য একটি নিরাপদ রুম। টেক্সট, ভয়েস এবং ক্যাম সম্পূর্ণ বিনামূল্যে এবং নিবন্ধন ছাড়াই।'
        : 'A room for gay and bi men, with the moderation to keep it that way. Text, voice and cam, free and without registration.',
      badge: 'LGBTQ+',
      badgeColor: 'bg-pink-100 text-pink-700 border-pink-200',
      icon: Heart,
      route: '/chat/gay'
    },
    {
      title: language === 'bn' ? 'লেসবিয়ান চ্যাট' : 'Lesbian Chat',
      desc: language === 'bn'
        ? 'লেসবিয়ান এবং বাই নারীদের জন্য বিশেষভাবে সংরক্ষিত এবং কঠোরভাবে মডারেটেড রুম।'
        : 'A women-only room for lesbian and bi women, moderated more tightly than the rest of the site precisely because rooms like this attract people wh...',
      badge: language === 'bn' ? 'শুধুমাত্র নারীদের জন্য' : 'Women only',
      badgeColor: 'bg-rose-100 text-rose-700 border-rose-200',
      icon: Heart,
      route: '/chat/lesbian'
    },
    {
      title: language === 'bn' ? 'দম্পতি চ্যাট' : 'Couples Chat',
      desc: language === 'bn'
        ? 'দম্পতিদের একসাথে চ্যাট করার জন্য এবং যারা তাদের সাথে কথা বলতে চান তাদের জন্য।'
        : 'For couples chatting together, and for singles who want to talk to them. The pace here is slower and more conversational than the main room.',
      badge: language === 'bn' ? 'দম্পতি ও একক' : 'Couples & singles',
      badgeColor: 'bg-indigo-100 text-indigo-700 border-indigo-200',
      icon: Users,
      route: '/chat/couples'
    },
    {
      title: language === 'bn' ? 'রোলপ্লে চ্যাট' : 'Roleplay Chat',
      desc: language === 'bn'
        ? 'টেক্সট-ভিত্তিক এবং গল্প-চালিত রুম। কিছু দৃশ্য এক সন্ধ্যা স্থায়ী হয়, আবার কিছু সপ্তাহ ধরে চলে।'
        : 'Text-led and story-driven. Some scenes run for an evening, others carry on across weeks with the same partner.',
      badge: language === 'bn' ? 'গল্পভিত্তিক' : 'Story-driven',
      badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      icon: Sparkles,
      route: '/chat/roleplay'
    },
    {
      title: language === 'bn' ? 'বিডিএসএম চ্যাট' : 'BDSM Chat',
      desc: language === 'bn'
        ? 'সম্মতিকে গুরুত্ব দেওয়া প্রাপ্তবয়স্কদের মধ্যে কিন্ক এবং ফেটিশ আলোচনা।'
        : 'Kink and fetish talk between adults who take consent seriously. Dominants, submissives, switches and the plainly curious all use the room.',
      badge: language === 'bn' ? 'সম্মতি প্রথম' : 'Consent first',
      badgeColor: 'bg-violet-100 text-violet-700 border-violet-200',
      icon: Lock,
      route: '/chat/bdsm'
    },
  ];

  const featuresList = [
    {
      title: language === 'bn' ? 'এইচডি ক্যাম ও ভয়েস' : 'HD cam & voice',
      desc: language === 'bn' ? 'পাবলিক এবং প্রাইভেট চ্যাটে ওয়েবআরটিসি ভিডিও ও ভয়েস, সাথে আনলিমিটেড ভয়েস মেসেজ।' : 'WebRTC video and voice in public rooms and private chat, with unlimited voice messages.',
      icon: Video
    },
    {
      title: language === 'bn' ? 'কোনো নিবন্ধন নেই' : 'No registration',
      desc: language === 'bn' ? 'একটি নিকনেম বাছাই করুন এবং প্রবেশ করুন। পরে সংরক্ষণ করতে চাইলে নিবন্ধন করতে পারেন।' : 'Pick a nickname and you are in. Register later if you want to keep it reserved.',
      icon: UserCheck
    },
    {
      title: language === 'bn' ? 'পপ-আপ প্রাইভেট চ্যাট' : 'Pop-up private chats',
      desc: language === 'bn' ? 'রুমের বাইরে না গিয়ে পাশপাশি একাধিক ব্যক্তিগত কথোপকথন চালিয়ে যান।' : 'Run several private conversations side by side without losing your place in the room.',
      icon: MessageCircle
    },
    {
      title: language === 'bn' ? '২৪/৭ মডারেটেড' : 'Moderated 24/7',
      desc: language === 'bn' ? 'মডারেটর ও অ্যাডমিনরা ২৪ ঘণ্টা প্রতিটি রুম পাহারা দেন। হয়রানি করলে ব্যান করা হয়।' : 'Moderators and admins cover every room around the clock. Harassment gets you removed.',
      icon: Shield
    },
    {
      title: language === 'bn' ? 'মোবাইলের জন্য উপযোগী' : 'Built for mobile',
      desc: language === 'bn' ? 'HTML5 চ্যাট যা অ্যান্ড্রয়েড, আইফোন এবং ট্যাবলেটে flawlessly কাজ করে। কোনো অ্যাপ ইন্সটল করতে হয় না।' : 'HTML5 chat that works on Android, iPhone and tablets. No app to install.',
      icon: Smartphone
    },
    {
      title: language === 'bn' ? 'ইমোজি, জিআইএফ, ইউটিউব' : 'Emojis, GIFs, YouTube',
      desc: language === 'bn' ? 'পরিচিত ইমোজি সেট, গিপসি সার্চ এবং ইনলাইন ইউটিউব ভিডিও প্লেব্যাক।' : 'The emoji set you already know, Giphy search, and YouTube links that play inline.',
      icon: Smile
    },
  ];

  const regionalRooms = [
    { name: language === 'bn' ? 'ভারতীয় চ্যাট' : 'Indian Chat', code: 'in' },
    { name: language === 'bn' ? 'ইউকে চ্যাট' : 'UK Chat', code: 'gb' },
    { name: language === 'bn' ? 'কানাডিয়ান চ্যাট' : 'Canadian Chat', code: 'ca' },
    { name: language === 'bn' ? 'অস্ট্রেলিয়ান চ্যাট' : 'Australian Chat', code: 'au' },
    { name: language === 'bn' ? 'আরব চ্যাট' : 'Arab Chat', code: 'ae' },
    { name: language === 'bn' ? 'ব্রাজিলিয়ান চ্যাট' : 'Brazilian Chat', code: 'br' },
    { name: language === 'bn' ? 'বুলগেরিয়ান চ্যাট' : 'Bulgarian Chat', code: 'bg' },
    { name: language === 'bn' ? 'চেক চ্যাট' : 'Czech Chat', code: 'cz' },
    { name: language === 'bn' ? 'চাইনিজ চ্যাট' : 'Chinese Chat', code: 'cn' },
    { name: language === 'bn' ? 'ফ্রেঞ্চ চ্যাট' : 'French Chat', code: 'fr' },
    { name: language === 'bn' ? 'জার্মান চ্যাট' : 'German Chat', code: 'de' },
    { name: language === 'bn' ? 'হাঙ্গেরিয়ান চ্যাট' : 'Hungarian Chat', code: 'hu' },
    { name: language === 'bn' ? 'ইন্ডোনেশিয়ান চ্যাট' : 'Indonesian Chat', code: 'id' },
    { name: language === 'bn' ? 'ইতালিয়ান চ্যাট' : 'Italian Chat', code: 'it' },
    { name: language === 'bn' ? 'ল্যাটিনো চ্যাট' : 'Latino Chat', code: 'mx' },
    { name: language === 'bn' ? 'মালয়েশিয়ান চ্যাট' : 'Malaysian Chat', code: 'my' },
    { name: language === 'bn' ? 'শ্রীলঙ্কান চ্যাট' : 'Sri Lankan Chat', code: 'lk' },
    { name: language === 'bn' ? 'পাকিস্তানি চ্যাট' : 'Pakistani Chat', code: 'pk' },
    { name: language === 'bn' ? 'ফিলিপিনো চ্যাট' : 'Filipino Chat', code: 'ph' },
    { name: language === 'bn' ? 'পোলিশ চ্যাট' : 'Polish Chat', code: 'pl' },
    { name: language === 'bn' ? 'রোমানিয়ান চ্যাট' : 'Romanian Chat', code: 'ro' },
    { name: language === 'bn' ? 'রাশিয়ান চ্যাট' : 'Russian Chat', code: 'ru' },
  ];

  const faqs = [
    {
      q: language === 'bn' ? 'এটি কি বিনামূল্যে এবং নিবন্ধন কি বাধ্যতামূলক?' : 'Is it free, and do I have to register?',
      a: language === 'bn'
        ? 'হ্যাঁ, চ্যাটলাস্টোরা (ChatLustora) সম্পূর্ণ বিনামূল্যে ব্যবহার করা যায়। পাবলিক চ্যাট রুম বা ১-অন-১ প্রাইভেট চ্যাটের জন্য কোনো বাধ্যতামূলক নিবন্ধনের প্রয়োজন নেই; কেবল একটি নিকনেম বেছে নিয়ে নিরাপদে চ্যাট শুরু করুন।'
        : 'Yes, ChatLustora is completely free to use. No registration is required to join public chat rooms or private direct messaging; simply pick a nickname and start chatting immediately.'
    },
    {
      q: language === 'bn' ? 'আমার বয়স কত হতে হবে?' : 'How old do I have to be?',
      a: language === 'bn'
        ? 'চ্যাটলাস্টোরার সমস্ত প্রাপ্তবয়স্ক রুম, ডেটিং ফিচার এবং প্রাইভেট মেসেজিংয়ে প্রবেশের জন্য আপনার বয়স কমপক্ষে ১৮ বছর হতে হবে। ১৮ বছরের কম বয়সীদের প্রবেশ সম্পূর্ণ নিষিদ্ধ।'
        : 'You must be at least 18 years old to access adult rooms, dating features, and private messaging spaces on ChatLustora. Strict 18+ verification applies.'
    },
    {
      q: language === 'bn' ? 'আমি কি মোবাইল ফোনে এটি ব্যবহার করতে পারি?' : 'Can I use it on a phone?',
      a: language === 'bn'
        ? 'হ্যাঁ, ChatLustora রেসপন্সিভ HTML5 প্রযুক্তিতে তৈরি যা অ্যান্ড্রয়েড, আইফোন এবং ট্যাবলেটের ব্রাউজারে অ্যাপ ইনস্টল ছাড়াই স্বাচ্ছন্দ্যে চলে।'
        : 'Yes, ChatLustora is built with modern responsive HTML5 technology that works seamlessly in mobile browsers on Android, iPhone, and tablets with zero app installs required.'
    },
    {
      q: language === 'bn' ? 'কোন ভাষায় চ্যাট করতে পারব?' : 'Which language should I chat in?',
      a: language === 'bn'
        ? 'আপনি বাংলা, ইংরেজি, হিন্দি, উর্দু এবং অন্যান্য আঞ্চলিক ও আন্তর্জাতিক ভাষার রুমে অবাধে চ্যাট ও ফ্লার্টিং করতে পারেন।'
        : 'You can chat in Bangla, English, Hindi, Urdu, and over 20 other regional and international language rooms tailored to Desi and global communities.'
    },
    {
      q: language === 'bn' ? 'কী ধরনের ছবি বা বার্তা শেয়ার করা যাবে?' : 'What kind of pictures can I send?',
      a: language === 'bn'
        ? 'পাবলিক ও প্রাইভেট চ্যাটে শেয়ারকৃত কন্টেন্ট পারস্পরিক সম্মতি এবং আমাদের কঠোর কমিউনিটি মান ও নিরাপত্তা নীতি মেনে চলতে হবে। অনুমতিহীন স্প্যাম বা হয়রানি নিষিদ্ধ।'
        : 'Content shared must adhere to mutual consent and our community guidelines. Harassment, spam, and non-consensual media sharing result in immediate permanent bans.'
    },
  ];

  return (
    <div className="bg-[#F8FAFC] dark:bg-slate-950 text-[#0F172A] dark:text-slate-100 min-h-screen font-sans selection:bg-rose-500 selection:text-white transition-colors">
      <SEOHead
        title="ChatLustora – Bangla & Desi Adult Chat, Dating and Private Messaging"
        description="ChatLustora is an online chat community where you can meet new people, join chat rooms, and discover conversations with people around the world."
        canonicalPath="/"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'ChatLustora',
          url: 'https://chatlustora.com',
          description: 'ChatLustora is an online chat community where you can meet new people, join chat rooms, and discover conversations with people around the world.',
        }}
      />

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Hero Column */}
          <div className="lg:col-span-7 space-y-6 pt-4">
            {/* Open 24/7 Pill */}
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-3.5 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span>{language === 'bn' ? '১৮+ প্রাপ্তবয়স্ক কমিউনিটি · ২৪/৭ লাইভ' : '18+ Adult Community · Open 24/7'}</span>
            </div>

            {/* Semantic visible H1 */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#0F172A] dark:text-white leading-[1.12]">
              {language === 'bn' ? (
                <>
                  চ্যাটলাস্টোরায় <span className="text-rose-600 dark:text-rose-400">নতুন মানুষের সাথে পরিচিত হোন</span>
                </>
              ) : (
                <>
                  Meet New People on <span className="text-rose-600 dark:text-rose-400">ChatLustora</span>
                </>
              )}
            </h1>

            {/* Suggested Phase 5.A Introduction */}
            <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              {language === 'bn'
                ? 'চ্যাটলাস্টোরায় (ChatLustora) স্বাগতম — প্রাপ্তবয়স্কদের চ্যাট, ফ্লার্টিং এবং সংযোগ স্থাপনের আধুনিক স্থান। বাংলা চ্যাট, বাঙালি আড্ডা, দেশি চ্যাট কমিউনিটি এবং প্রাইভেট মেসেজিং উপভোগ করুন এক প্ল্যাটফর্মে। নতুন মানুষের সাথে পরিচিত হোন, আড্ডায় যোগ দিন এবং একটি সম্মানজনক, প্রাপ্তবয়স্কদের উপযুক্ত পরিবেশে সংযোগ আবিষ্কার করুন। উপলব্ধ সুবিধাসমূহ চ্যাটলাস্টোরার বর্তমান পরিষেবার ওপর নির্ভরশীল। ব্যবহারকারীদের অবশ্যই ১৮ বা তার বেশি বয়সী হতে হবে।'
                : 'Welcome to ChatLustora — a place for adults to chat, flirt and connect. Explore Bangla chat, Bengali conversations, desi chat communities and private messaging in one convenient platform. Meet new people, join conversations and discover connections in a respectful, adults-only environment. Available features depend on the services currently offered by ChatLustora. Users must be 18 or older.'}
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => navigate('/rooms')}
                className="inline-flex items-center justify-center bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white text-base sm:text-lg font-bold px-7 py-3.5 rounded-xl shadow-lg shadow-rose-600/25 transition-all transform hover:-translate-y-0.5 cursor-pointer"
              >
                <span>{language === 'bn' ? 'চ্যাট রুমে প্রবেশ করুন' : 'Enter Public Rooms'}</span>
                <ArrowRight className="w-5 h-5 ml-2" />
              </button>
              <button
                onClick={() => navigate('/guest-entry')}
                className="inline-flex items-center justify-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-base font-bold px-6 py-3.5 rounded-xl transition-all cursor-pointer"
              >
                <User className="w-4 h-4 mr-2 text-rose-500" />
                <span>{language === 'bn' ? 'গেস্ট হিসেবে প্রবেশ' : 'Continue as Guest'}</span>
              </button>
              <button
                onClick={() => navigate('/dating')}
                className="inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm font-bold px-5 py-3.5 rounded-xl transition-all cursor-pointer"
              >
                <Heart className="w-4 h-4 mr-1.5 text-rose-500 fill-rose-500" />
                <span>{language === 'bn' ? 'ডেটিং' : 'Dating'}</span>
              </button>
            </div>

            {/* Checklist */}
            <div className="flex flex-wrap items-center gap-y-2 gap-x-6 text-sm text-slate-600 dark:text-slate-400 pt-2 font-medium">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{t.landing.check1}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{t.landing.check2}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{t.landing.check3}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>{t.landing.check4}</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Sign In / Top Rooms Card */}
          <div className="lg:col-span-5">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl p-6 sm:p-7 space-y-5 transition-all">
              {/* Header Tabs */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setHeroTab('signin')}
                    className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      heroTab === 'signin'
                        ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {hasActiveSession && !user.isGuest
                      ? (language === 'bn' ? 'সদস্য পরিচিতি' : 'Member Status')
                      : (language === 'bn' ? 'সাইন ইন' : 'Sign In')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHeroTab('rooms')}
                    className={`text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                      heroTab === 'rooms'
                        ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {t.landing.topRooms}
                  </button>
                </div>
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{t.landing.active}</span>
              </div>

              {/* Tab 1: Member Sign In or Active Session Hub */}
              {heroTab === 'signin' && (
                <>
                  {hasActiveSession && !user.isGuest ? (
                    <div className="space-y-4 py-2">
                      <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-500 to-orange-400 flex items-center justify-center text-3xl font-bold shadow-md">
                          {user.avatar || '⚡'}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                            {language === 'bn' ? 'স্বাগতম' : 'Signed In As'}
                          </div>
                          <div className="text-lg font-black text-slate-900 dark:text-white leading-tight">
                            {user.nickname}
                          </div>
                          <div className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Registered Member</span>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          onClick={() => navigate('/dashboard')}
                          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <User className="w-4 h-4" />
                          <span>Member Dashboard</span>
                        </button>
                        <button
                          onClick={() => navigate('/messages')}
                          className="w-full py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all border border-slate-200 dark:border-slate-700 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <MessageSquare className="w-4 h-4 text-violet-500" />
                          <span>Private DMs</span>
                        </button>
                      </div>

                      <div className="text-center pt-2">
                        <button
                          type="button"
                          onClick={() => setHeroTab('rooms')}
                          className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-semibold cursor-pointer"
                        >
                          {language === 'bn' ? 'শীর্ষ রুমগুলো দেখুন →' : 'Explore Top Rooms →'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleHeroLogin} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                          {language === 'bn' ? 'ইমেইল অ্যাড্রেস' : 'Email Address'}
                        </label>
                        <div className="relative">
                          <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="email"
                            required
                            value={loginEmail}
                            onChange={(e) => setLoginEmail(e.target.value)}
                            placeholder="name@example.com"
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 font-medium"
                          />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                            {language === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                          </label>
                          <button
                            type="button"
                            onClick={() => navigate('/auth')}
                            className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                          >
                            {language === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
                          </button>
                        </div>
                        <div className="relative">
                          <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="••••••••••••"
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 font-medium"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            title={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {loginError && (
                        <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium animate-in fade-in">
                          {loginError}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loginLoading}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white text-sm font-bold shadow-md shadow-rose-600/20 transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        <Lock className="w-4 h-4" />
                        <span>{loginLoading ? (language === 'bn' ? 'যাচাই করা হচ্ছে...' : 'Signing In...') : (language === 'bn' ? 'সাইন ইন করুন' : 'Sign In')}</span>
                      </button>

                      {/* Quick alternate routes */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-center text-xs">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">
                            {language === 'bn' ? 'নতুন অ্যাকাউন্ট খুলতে চান? ' : "Don't have an account? "}
                          </span>
                          <button
                            type="button"
                            onClick={() => navigate('/register')}
                            className="font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                          >
                            {language === 'bn' ? 'অ্যাকাউন্ট তৈরি করুন' : 'Create Free Account'}
                          </button>
                        </div>

                        <div className="text-[11px] text-slate-400 pt-1">
                          <span>{language === 'bn' ? 'অথবা অ্যাকাউন্ট ছাড়াই যোগ দিন: ' : 'Or chat instantly: '}</span>
                          <button
                            type="button"
                            onClick={() => navigate('/guest-entry')}
                            className="font-bold text-orange-600 dark:text-orange-400 hover:underline cursor-pointer"
                          >
                            {language === 'bn' ? 'গেস্ট হিসেবে প্রবেশ করুন' : 'Continue as Guest'}
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
                </>
              )}

              {/* Tab 2: Top Rooms List */}
              {heroTab === 'rooms' && (
                <div className="space-y-4">
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {topRooms.map((room, idx) => {
                      const Icon = room.icon as any;
                      return (
                        <div
                          key={idx}
                          onClick={() => navigate(room.route)}
                          className="py-3.5 flex items-center justify-between group cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 px-2 rounded-xl transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-200 font-bold text-sm">
                              {room.flag ? <img src={room.flag} alt={room.name} className="w-6 h-6 rounded-sm" /> : (Icon && <Icon className="w-4 h-4 text-orange-500" />)}
                            </div>
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                                {room.name}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{room.subtitle}</div>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-orange-500 group-hover:translate-x-0.5 transition-all" />
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{t.landing.countryRooms}</span>
                    <button
                      onClick={() => navigate('/rooms')}
                      className="font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>{t.landing.allRooms}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CHAT ROOMS Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200/60 dark:border-slate-800">
        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-1">{t.landing.chatRoomsHeading}</div>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.landing.pickARoom}</h2>
          <p className="text-slate-600 dark:text-slate-300 mt-1">{t.landing.pickARoomSub}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mainRooms.map((room, idx) => {
            const Icon = room.icon as any;
            return (
              <div
                key={idx}
                onClick={() => navigate(room.route)}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-xl bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
                      {Icon && <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${room.badgeColor}`}>
                      {room.badge}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                      {room.title}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 line-clamp-3 leading-relaxed">
                      {room.desc}
                    </p>
                  </div>
                </div>

                <div className="pt-6 mt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
                  <span className="text-xs font-bold text-orange-600 dark:text-orange-400 group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
                    <span>{t.landing.join}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* FEATURES Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200/60 dark:border-slate-800">
        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-1">{t.landing.featuresHeading}</div>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.landing.whatYouGet}</h2>
          <p className="text-slate-600 dark:text-slate-300 mt-1">{t.landing.whatYouGetSub}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuresList.map((feat, idx) => {
            const Icon = feat.icon as any;
            return (
              <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400 flex items-center justify-center mb-4 font-bold">
                  {Icon && <Icon className="w-5 h-5" />}
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1.5">{feat.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{feat.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* REGIONAL ROOMS Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200/60 dark:border-slate-800">
        <div className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-1">{t.landing.regionalHeading}</div>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.landing.chatInLanguage}</h2>
          <p className="text-slate-600 dark:text-slate-300 mt-1">{t.landing.regionalSub}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {regionalRooms.map((room, idx) => (
            <button
              key={idx}
              onClick={() => navigate('/rooms')}
              className="bg-white dark:bg-slate-900 hover:bg-orange-50 dark:hover:bg-orange-950/30 border border-slate-200/80 dark:border-slate-800 hover:border-orange-200 dark:hover:border-orange-800 rounded-xl p-3.5 text-left flex items-center gap-3 transition-all group shadow-sm cursor-pointer"
            >
              <img src={`https://flagcdn.com/w40/${room.code}.png`} alt={room.name} className="w-6 h-6 rounded-sm object-cover" />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 group-hover:text-orange-600 dark:group-hover:text-orange-400 truncate">
                {room.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Editorial Information & Sidebar Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200/60 dark:border-slate-800">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Left Editorial Articles */}
          <div className="lg:col-span-8 space-y-8 text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
            <div className="space-y-3">
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">{t.landing.editorialTitle1}</h3>
              <p>
                {language === 'bn' 
                  ? 'ভক্সানেক্স একটি ফ্রি এডাল্ট চ্যাট কমিউনিটি যা একটি সাধারণ ধারণার উপর নির্মিত: আপনি পেজ খোলার ৩০ সেকেন্ডের মধ্যে কারো সাথে কথা বলতে পারবেন। এখানে কোনো রেজিস্ট্রেশন ওয়াল বা ডাউনলোড নেই।'
                  : 'VoxaNex is a free adult chat community built around one idea: you should be able to open a page and be talking to somebody thirty seconds later. There is no registration wall, no email confirmation and no download. Enter a nickname and the room is there.'}
              </p>
              <p>
                {language === 'bn' ? 'রুমগুলোতে রয়েছে বৈচিত্র্য।' : 'The rooms cover a wide range. The '}
                <span className="text-orange-600 dark:text-orange-400 font-semibold cursor-pointer" onClick={() => navigate('/rooms')}>{language === 'bn' ? 'মূল প্রাপ্তবয়স্ক রুম' : 'main adult room'}</span>
                {language === 'bn' ? ' সবচেয়ে ব্যস্ততম; ' : ' is the busiest and the most general; '}
                <span className="text-orange-600 dark:text-orange-400 font-semibold cursor-pointer" onClick={() => navigate('/av-chat')}>{language === 'bn' ? 'ভিডিও চ্যাট' : 'video chat'}</span>
                {language === 'bn' ? ' ক্যাম ব্যবহারের জন্য; ' : ' is for people who want to be on cam; '}
                <span className="text-orange-600 dark:text-orange-400 font-semibold cursor-pointer" onClick={() => navigate('/random')}>{language === 'bn' ? 'রুলেট' : 'roulette'}</span>
                {language === 'bn' ? ' আপনাকে একের পর এক অপরিচিতের সাথে সংযুক্ত করে।' : ' pairs you with one stranger at a time and lets you skip.'}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">{t.landing.editorialTitle2}</h3>
              <p>
                {language === 'bn'
                  ? 'প্রতিটি রুম মডারেটর এবং অ্যাডমিনদের দ্বারা চব্বিশ ঘণ্টা পর্যবেক্ষণ করা হয়। হয়রানি বা স্প্যাম করলে তাৎক্ষণিক অপসারণ করা হয়।'
                  : 'Every room is covered by moderators and administrators at all hours. Harassment, spam and advertising get you removed; anything involving minors gets a permanent ban and a report to the authorities. Respecting a "no" is not optional here, and reports are acted on rather than filed.'}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-xl font-extrabold text-slate-900 dark:text-white">{t.landing.editorialTitle3}</h3>
              <p>
                {language === 'bn'
                  ? 'চ্যাটটি HTML5 প্রযুক্তির এবং মোবাইল ব্রাউজারে অ্যান্ড্রয়েড ও আইওএস উভয় ডিভাইসে ক্যামেরা ও মাইক্রোফোনসহ কাজ করে।'
                  : 'The chat is HTML5 and runs in the mobile browser, including camera and microphone on both Android and iOS, with nothing to install. Video is WebRTC and peer-to-peer, so it stays responsive on a normal mobile connection, and voice-only mode keeps a conversation going when the signal will not carry video.'}
              </p>
            </div>
          </div>

          {/* Right Sidebar Cards */}
          <div className="lg:col-span-4 space-y-6">
            {/* New here? Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-4">
              <h4 className="font-bold text-slate-900 dark:text-white text-base">{t.landing.newHere}</h4>
              <ol className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">1</span>
                  <span>{t.landing.step1}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">2</span>
                  <span>{t.landing.step2}</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">3</span>
                  <span>{t.landing.step3}</span>
                </li>
              </ol>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => navigate('/safety')}
                  className="text-xs font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>{t.landing.readChatHelp}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Before you start Card */}
            <div className="bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200/80 dark:border-amber-800 p-6 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-bold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>{t.landing.beforeYouStart}</span>
              </div>
              <p className="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
                {t.landing.beforeYouStartDesc}
              </p>
              <div>
                <button
                  onClick={() => navigate('/safety')}
                  className="text-xs font-bold text-amber-800 dark:text-amber-400 hover:text-amber-950 dark:hover:text-amber-300 inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>{t.landing.publicAwareness}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* The short version of the rules Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
              <h4 className="font-bold text-slate-900 dark:text-white text-base">{t.landing.rulesShort}</h4>
              <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                <li>• {t.landing.rules1}</li>
                <li>• {t.landing.rules2}</li>
                <li>• {t.landing.rules3}</li>
                <li>• {t.landing.rules4}</li>
              </ul>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold">
                <button onClick={() => navigate('/safety')} className="text-orange-600 dark:text-orange-400 hover:text-orange-700 cursor-pointer">{t.landing.allChatRules}</button>
                <button onClick={() => navigate('/profile')} className="text-orange-600 dark:text-orange-400 hover:text-orange-700 cursor-pointer">{t.landing.userLevels}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-slate-200/60 dark:border-slate-800">
        <div className="text-center mb-10">
          <div className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-1">{t.landing.faqHeading}</div>
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{t.landing.commonQuestions}</h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-sm">
                <button
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full px-6 py-4 text-left font-bold text-slate-900 dark:text-white flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                >
                  <span className="text-base">{faq.q}</span>
                  {isOpen ? <Minus className="w-5 h-5 text-orange-500 shrink-0" /> : <Plus className="w-5 h-5 text-slate-400 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Chat by Country Ticker at bottom */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 border-t border-slate-200/60 dark:border-slate-800">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">{t.landing.chatByCountry}</div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
          {regionalRooms.map((r, i) => (
            <span key={i} onClick={() => navigate('/rooms')} className="hover:text-orange-600 dark:hover:text-orange-400 cursor-pointer transition-colors">
              {r.name}{i < regionalRooms.length - 1 ? ',' : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
