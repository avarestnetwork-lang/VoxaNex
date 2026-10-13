-- =============================================================================
-- VOXANEX DATABASE SEED SCRIPT
-- Seeds default chat rooms, forum categories, and initial community guides
-- =============================================================================

-- Seed Chat Rooms
INSERT INTO public.chat_rooms (
    slug, name_en, name_bn, description_en, description_bn,
    category, category_label_en, category_label_bn, language, modes, is_18_plus, requires_account, is_active
) VALUES
(
    'bangla-adult',
    'Bangla Adult Lounge',
    'বাংলা প্রাপ্তবয়স্ক লাউঞ্জ (১৮+)',
    'Unrestricted mature conversation for verified legal adults. Strict consensual etiquette and zero tolerance for harassment.',
    'যাচাইকৃত প্রাপ্তবয়স্কদের জন্য উন্মুক্ত আলোচনা। পারস্পরিক সম্মতি ও শ্রদ্ধা বাধ্যতামূলক।',
    'bangla-adult', 'Adult (18+)', 'প্রাপ্তবয়স্ক (১৮+)',
    'bn', ARRAY['text', 'voice'], TRUE, FALSE, TRUE
),
(
    'bd-random',
    'Bangladesh Random Lounge',
    'বাংলাদেশ আড্ডা লাউঞ্জ',
    'Open social chat for Bengalis and friends worldwide. Share daily thoughts, music, food, and culture.',
    'বিশ্বজুড়ে সকল বাঙালিদের জন্য উন্মুক্ত আড্ডা। দৈনন্দিন অভিজ্ঞতা, সঙ্গীত ও সংস্কৃতি শেয়ার করুন।',
    'bangladesh-random', 'Bangladesh Social', 'বাংলাদেশ সামাজিক',
    'bn', ARRAY['text', 'voice', 'video'], FALSE, FALSE, TRUE
),
(
    'banglish-vibes',
    'Banglish Vibes & Casual',
    'বাংলিশ আড্ডা ও গসিপ',
    'Fast-paced chat in Latin script Bangla (Banglish). Perfect for mobile typists and bilingual friends.',
    'ইংরেজি হরফে বাংলা (বাংলিশ) লেখার দ্রুতগতির আড্ডা। মোবাইল ব্যবহারকারীদের জন্য অত্যন্ত সুবিধাজনক।',
    'banglish-chat', 'Banglish', 'বাংলিশ',
    'mixed', ARRAY['text'], FALSE, FALSE, TRUE
),
(
    'dhaka-central',
    'Dhaka Central Hub',
    'ঢাকা সেন্ট্রাল হাব',
    'Life in the capital: traffic updates, food reviews from Old Dhaka & Dhanmondi, tech meetups, and campus life.',
    'রাজধানীর জীবনযাপন, ট্রাফিক আপডেট, পুরান ঢাকা ও ধানমন্ডির খাবারের গল্প এবং ক্যাম্পাস লাইফ।',
    'regional', 'Regional (Dhaka)', 'আঞ্চলিক (ঢাকা)',
    'bn', ARRAY['text', 'voice'], FALSE, FALSE, TRUE
),
(
    'ctg-port',
    'Chittagong Port & Hills',
    'চট্টগ্রাম পোর্ট ও পাহাড়',
    'Mezban culture, Cox’s Bazar travel plans, port commerce, and Chattagonian dialect chats.',
    'মেজবানি সংস্কৃতি, কক্সবাজার ভ্রমণ পরিকল্পনা, বাণিজ্য এবং চাটগাঁইয়া ভাষার প্রাণবন্ত আড্ডা।',
    'regional', 'Regional (Chittagong)', 'আঞ্চলিক (চট্টগ্রাম)',
    'bn', ARRAY['text', 'voice'], FALSE, FALSE, TRUE
),
(
    'sylhet-tea',
    'Sylhet Green Valley & Diaspora',
    'সিলেট সবুজ উপত্যকা ও প্রবাসী সংযোগ',
    'Tea gardens, Ratargul adventures, and connecting with global Bangladeshi diaspora in the UK, US, and Middle East.',
    'চা বাগান, রাতারগুল ভ্রমণ এবং যুক্তরাজ্য, যুক্তরাষ্ট্র ও মধ্যপ্রাচ্যের প্রবাসীদের সাথে সংযোগ।',
    'regional', 'Regional (Sylhet)', 'আঞ্চলিক (সিলেট)',
    'bn', ARRAY['text', 'voice'], FALSE, FALSE, TRUE
),
(
    'global-exchange',
    'International Cultural Exchange',
    'আন্তর্জাতিক সাংস্কৃতিক বিনিময়',
    'Connect with people worldwide. Discuss travel, language learning, world cinema, and global friendships.',
    'বিশ্বের নানা প্রান্তের মানুষের সাথে যুক্ত হন। ভ্রমণ, ভাষা শিক্ষা ও বৈশ্বিক বন্ধুত্ব নিয়ে আলোচনা।',
    'international', 'International', 'আন্তর্জাতিক',
    'en', ARRAY['text', 'voice', 'video'], FALSE, FALSE, TRUE
),
(
    'tech-devs',
    'Code, AI & Tech Bangladesh',
    'প্রযুক্তি, কোডিং ও স্টার্টআপ',
    'Software development, freelance tips, AI breakthroughs, and building startups in South Asia.',
    'সফটওয়্যার ডেভেলপমেন্ট, ফ্রিল্যান্সিং পরামর্শ, কৃত্রিম বুদ্ধিমত্তা এবং স্থানীয় স্টার্টআপ।',
    'gaming-tech', 'Tech & Gaming', 'প্রযুক্তি ও গেমিং',
    'mixed', ARRAY['text'], FALSE, FALSE, TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- Seed Forum Categories
INSERT INTO public.forum_categories (slug, name_en, name_bn, description_en, description_bn, order_index)
VALUES
('general', 'Announcements & General', 'ঘোষণা ও সাধারণ', 'Platform updates and community governance', 'প্ল্যাটফর্মের আপডেট ও কমিউনিটি নিয়মাবলী', 1),
('banglish', 'Banglish Linguistics', 'বাংলিশ ভাষা চর্চা', 'Spelling conventions and chat expressions', 'ইংরেজি হরফে বাংলা লেখার নিয়ম ও অভিব্যক্তি', 2),
('tech', 'Technology & Startups', 'প্রযুক্তি ও স্টার্টআপ', 'Coding, development, and South Asian tech', 'সফটওয়্যার, ফ্রিল্যান্সিং ও স্টার্টআপ', 3),
('regional', 'Regional Communities', 'আঞ্চলিক মিলনমেলা', 'Dhaka, Chittagong, Sylhet and diaspora hubs', 'বিভাগীয় ও প্রবাসী আলোচনা', 4),
('safety', 'Trust & Platform Safety', 'নিরাপত্তা ও বিশ্বাস', 'Anti-doxxing, consent, and user protection', 'অনলাইন সুরক্ষা ও অধিকার রক্ষা', 5)
ON CONFLICT (slug) DO NOTHING;

-- Seed Initial Blog Posts
INSERT INTO public.blog_posts (
    slug, title_en, title_bn, summary_en, summary_bn,
    content_en, content_bn, category, read_time
) VALUES
(
    'conversing-in-banglish-guide',
    'The Art of Conversing in Banglish: Phonetics, Slang & Modern Etiquette',
    'বাংলিশে কথা বলার শিল্প: ধ্বনিতত্ত্ব, স্ল্যাং ও আধুনিক শিষ্টাচার',
    'How the Latin script became a vibrant medium for Bengali internet culture, and best practices for writing clearly.',
    'কীভাবে ইংরেজি হরফ বাঙালি ইন্টারনেট সংস্কৃতির প্রাণবন্ত মাধ্যম হয়ে উঠল এবং পারস্পরিক শ্রদ্ধাপূর্ণ যোগাযোগের মূলনীতি।',
    'Banglish evolved over two decades from a feature phone SMS limitation into a modern conversational medium for millions of digital natives. On VoxaNex, we celebrate Banglish while upholding respectful boundaries and zero-tolerance for harassment.',
    'বাংলিশ গত দুই দশকে একটি প্রাণবন্ত ডিজিটাল মাধ্যমে পরিণত হয়েছে। ভক্সানেক্সে আমরা আনুষ্ঠানিক বাংলার পাশাপাশি বাংলিশকেও স্বাগত জানাই, যেখানে পারস্পরিক সম্মান ও শ্রদ্ধাবোধ বজায় রাখা আবশ্যক।',
    'Culture & Language', '4 min read'
),
(
    'preventing-online-extortion-bangladesh',
    'Digital Safety 101: Preventing Online Extortion, Blackmail & Doxxing',
    'ডিজিটাল নিরাপত্তা ১০১: অনলাইন ব্ল্যাকমেইল, হয়রানি ও ব্যক্তিগত তথ্য ফাঁস প্রতিরোধ',
    'Practical steps for protecting your privacy and reporting violations under Bangladesh cyber law.',
    'অনলাইনে নিজের গোপনীয়তা রক্ষা এবং সাইবার অপরাধের বিরুদ্ধে আইনি পদক্ষেপ গ্রহণের বাস্তবসম্মত উপায়।',
    'Anonymity should bring freedom, not vulnerability. Protect phone numbers, never stream identifiable documents on webcam, and immediately report intimidation attempts to the Cyber Police Centre (CID) at +880 1769691522.',
    'অনলাইন বেনামী যোগাযোগ আপনার স্বাধীনতা দেবে, দুর্বলতা নয়। ফোন নম্বর সুরক্ষিত রাখুন, ক্যামেরায় গুরুত্বপূর্ণ নথি দেখাবেন না এবং যেকোনো ব্ল্যাকমেইলের ঘটনায় দ্রুত সাইবার পুলিশের সহায়তা নিন।',
    'Safety & Legal', '6 min read'
)
ON CONFLICT (slug) DO NOTHING;
