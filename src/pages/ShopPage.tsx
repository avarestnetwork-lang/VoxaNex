import React, { useState } from 'react';
import { ShoppingBag, Zap, Crown, Flame, Shield, CheckCircle, Sparkles, Gift, Star } from 'lucide-react';
import { useRouter } from '../context/RouterContext';

export const ShopPage: React.FC = () => {
  const { navigate } = useRouter();
  const [activeTab, setActiveTab] = useState<'vip' | 'coins' | 'gifts'>('vip');

  const vipPlans = [
    {
      id: 'starter',
      name: 'VIP Bronze',
      price: '$4.99',
      period: '/ month',
      badge: '🥉 Bronze',
      popular: false,
      features: [
        'Custom colored nickname in all rooms',
        'VIP badge on profile and avatar',
        'Ad-free chat experience',
        '500 monthly bonus chat credits',
        'Send standard virtual gifts',
      ],
      color: 'from-amber-600 to-amber-800',
    },
    {
      id: 'pro',
      name: 'VIP Gold',
      price: '$12.99',
      period: '/ month',
      badge: '🌟 Gold VIP',
      popular: true,
      features: [
        'All Bronze benefits',
        'Animated glowing username in chat',
        'Priority HD webcam & audio streaming',
        '2,500 monthly bonus chat credits',
        'Exclusive VIP private room creation',
        'Invisible browsing mode option',
      ],
      color: 'from-amber-400 via-amber-500 to-yellow-600',
    },
    {
      id: 'diamond',
      name: 'Diamond Elite',
      price: '$29.99',
      period: '/ month',
      badge: '💎 Diamond',
      popular: false,
      features: [
        'All Gold VIP benefits',
        'Rainbow animated title badge',
        'Unlimited private 1-on-1 calls',
        '10,000 monthly bonus chat credits',
        'Direct priority moderator support',
        'Custom avatar border effect',
      ],
      color: 'from-cyan-500 to-blue-600',
    },
  ];

  const creditPackages = [
    { credits: 500, price: '$2.99', bonus: '' },
    { credits: 1500, price: '$6.99', bonus: '+200 Free' },
    { credits: 5000, price: '$19.99', bonus: '+1,000 Free' },
    { credits: 15000, price: '$49.99', bonus: '+5,000 Free' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header Banner */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 text-xs font-bold mb-4">
            <ShoppingBag className="w-4 h-4" />
            ChatLustora Official Store
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Upgrade Your <span className="text-rose-600 dark:text-rose-400">Chat Experience</span>
          </h1>
          <p className="mt-3 text-slate-600 dark:text-slate-400 text-sm sm:text-base">
            Get VIP privileges, custom username effects, chat credits, and exclusive virtual gifts to stand out in active rooms.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center mb-10">
          <div className="inline-flex p-1 bg-slate-200 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-700">
            <button
              onClick={() => setActiveTab('vip')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'vip'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Crown className="w-4 h-4 text-amber-500" />
              VIP Memberships
            </button>
            <button
              onClick={() => setActiveTab('coins')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'coins'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Zap className="w-4 h-4 text-yellow-500" />
              Chat Credits
            </button>
            <button
              onClick={() => setActiveTab('gifts')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                activeTab === 'gifts'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Gift className="w-4 h-4 text-purple-500" />
              Virtual Gifts
            </button>
          </div>
        </div>

        {/* VIP Membership Plans */}
        {activeTab === 'vip' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {vipPlans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-2xl bg-white dark:bg-slate-900 border ${
                  plan.popular
                    ? 'border-rose-500 shadow-xl ring-2 ring-rose-500/20'
                    : 'border-slate-200 dark:border-slate-800 shadow-md'
                } p-6 flex flex-col justify-between transition-transform hover:-translate-y-1`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-rose-600 to-pink-600 text-white text-[11px] font-extrabold tracking-wider uppercase shadow-md flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Most Popular
                  </div>
                )}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {plan.badge}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline">
                    <span className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white">{plan.price}</span>
                    <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">{plan.period}</span>
                  </div>
                  <ul className="mt-6 space-y-3">
                    {plan.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={() => navigate('/register')}
                  className={`mt-8 w-full py-3 px-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r ${plan.color} hover:opacity-95 shadow-md transition-all cursor-pointer`}
                >
                  Get {plan.name}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Chat Credits */}
        {activeTab === 'coins' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {creditPackages.map((pkg, idx) => (
              <div
                key={idx}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 text-center shadow-md hover:border-rose-500 transition-all"
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-yellow-100 dark:bg-yellow-950/50 flex items-center justify-center mb-4">
                  <Zap className="w-6 h-6 text-yellow-500 fill-yellow-500" />
                </div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white">{pkg.credits.toLocaleString()} Credits</h4>
                {pkg.bonus && (
                  <span className="inline-block mt-1 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-0.5 rounded-full">
                    {pkg.bonus}
                  </span>
                )}
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-4">{pkg.price}</div>
                <button
                  onClick={() => navigate('/register')}
                  className="mt-6 w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-rose-600 dark:hover:bg-rose-500 dark:hover:text-white transition-colors cursor-pointer"
                >
                  Purchase Credits
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Virtual Gifts */}
        {activeTab === 'gifts' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center shadow-md">
            <Gift className="w-12 h-12 text-rose-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-900 dark:text-white">Virtual Gifts & Reactions</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
              Send animated roses, diamonds, hearts, and VIP tokens directly inside public chatrooms or private 1-on-1 messages!
            </p>
            <button
              onClick={() => navigate('/rooms')}
              className="mt-6 px-6 py-3 rounded-xl bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 transition-colors cursor-pointer shadow-md"
            >
              Enter Rooms & Start Gifting
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
