import React from 'react';
import { useRouter } from '../context/RouterContext';
import { useLanguage } from '../context/LanguageContext';
import { ROOMS_CONFIG } from '../config/voxanexConfig';
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
  Sparkles,
  UserCheck,
} from 'lucide-react';

interface RoomLandingPageProps {
  roomSlug: string;
}

export const RoomLandingPage: React.FC<RoomLandingPageProps> = ({ roomSlug }) => {
  const { navigate } = useRouter();
  const { language } = useLanguage();

  const room = ROOMS_CONFIG.find((r) => r.slug === roomSlug) || {
    id: `room-${roomSlug}`,
    slug: roomSlug,
    name: {
      en: `${roomSlug.charAt(0).toUpperCase() + roomSlug.slice(1).replace('-', ' ')} Chat`,
      bn: `${roomSlug} চ্যাট`,
    },
    description: {
      en: `Connect with adults and explore real-time conversations in our ${roomSlug} community room.`,
      bn: `আমাদের ${roomSlug} কমিউনিটি রুমে প্রাপ্তবয়স্কদের সাথে মুক্ত আড্ডায় যোগ দিন।`,
    },
    category: 'international',
    categoryLabel: { en: 'Community', bn: 'কমিউনিটি' },
    language: 'mixed',
    modes: ['text'],
    is18Plus: true,
    requiresAccount: false,
    backendStatus: 'ready_local_demo',
  };

  const roomName = room.name[language] || room.name.en;
  const roomDesc = room.description[language] || room.description.en;
  const canonicalPath = `/chat/${room.slug}`;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 py-10 px-4 sm:px-6 lg:px-8 transition-colors">
      <SEOHead
        title={`${room.name.en} – Adult Chat & Conversations | ChatLustora`}
        description={`${room.description.en} Connect respectfully and explore private direct messaging on ChatLustora.`}
        canonicalPath={canonicalPath}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: `${room.name.en} Room`,
          description: room.description.en,
          publisher: {
            '@type': 'Organization',
            name: 'ChatLustora',
            url: 'https://chatlustora.com',
          },
        }}
      />

      <div className="max-w-4xl mx-auto space-y-12">
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
            <span className="font-semibold text-rose-500">{roomName}</span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="text-center space-y-6 pt-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-semibold uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>{language === 'bn' ? '১৮+ লাইভ কমিউনিটি' : '18+ Adult Community'}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            {roomName}
          </h1>

          <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            {roomDesc}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <button
              onClick={() => navigate('/guest-entry', { targetRoom: room.slug })}
              className="inline-flex items-center justify-center bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 text-white text-base sm:text-lg font-bold px-8 py-3.5 rounded-xl shadow-lg shadow-rose-600/25 transition-all transform hover:-translate-y-0.5 cursor-pointer"
            >
              <span>{language === 'bn' ? 'রুমে প্রবেশ করুন' : `Enter ${room.name.en}`}</span>
              <ArrowRight className="w-5 h-5 ml-2" />
            </button>
            <button
              onClick={() => navigate('/rooms')}
              className="inline-flex items-center justify-center bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-base font-bold px-6 py-3.5 rounded-xl transition-all cursor-pointer"
            >
              <span>{language === 'bn' ? 'অন্যান্য রুম দেখুন' : 'Explore Other Rooms'}</span>
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
              <UserCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'কোনো নিবন্ধন নেই' : 'No Registration Required'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'একটি নিকনেম বাছাই করে তাৎক্ষণিকভাবে গেস্ট হিসেবে প্রবেশ করুন।'
                : 'Join as a guest instantly with an avatar and nickname. No email required.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'প্রাইভেট মেসেজিং' : 'Private Direct Messages'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'রুমের যে কোনো সদস্যের সাথে গোপনীয় ১-অন-১ চ্যাট উইন্ডো খুলুন।'
                : 'Initiate 1-on-1 private floating conversations with full delivery status and read receipts.'}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <Shield className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'নিরাপদ পরিবেশ' : 'Safe & Moderated'}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {language === 'bn'
                ? 'হয়রানি রোধে সক্রিয় মডারেশন এবং ১-ক্লিক ব্লক ও রিপোর্ট ব্যবস্থা।'
                : 'Zero tolerance for harassment with proactive filters and participant safety controls.'}
            </p>
          </div>
        </div>

        {/* Community Rules */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-8 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-rose-500" />
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {language === 'bn' ? 'কমিউনিটি নিয়মাবলী' : 'Community Guidelines'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Must be 18 years or older to participate.</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Respect all members and mutual consent.</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>No spam, advertising, or unsolicited links.</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Do not post private personal information.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
