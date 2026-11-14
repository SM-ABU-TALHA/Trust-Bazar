import type { Locale } from '@/lib/format';

export const LEGAL_UPDATED = '2026-10-17';

type Localized = Record<Locale, string>;
type LocalizedList = Record<Locale, readonly string[]>;

export interface LegalSection {
  heading: Localized;
  paragraphs?: LocalizedList;
  bullets?: LocalizedList;
}

export interface LegalDoc {
  title: Localized;
  summary: Localized;
  sections: LegalSection[];
}

export interface ProhibitedItem {
  name: Localized;
  examples: Localized;
}

export interface ProhibitedDoc extends LegalDoc {
  items: ProhibitedItem[];
}

/** Terms drafts — sourced from PRD §3, §11 and Pre-Launch_Actions §A.1/A.3. */
export const TERMS: LegalDoc = {
  title: { bn: 'ব্যবহারের শর্তাবলি', en: 'Terms of Use' },
  summary: {
    bn: 'Trust Bazar একটি ক্লাসিফাইড মার্কেটপ্লেস। আমরা ক্রেতা ও বিক্রেতার মধ্যে পরিচয় করিয়ে দিই, কিন্তু কোনো পণ্যের বিক্রয়ে পক্ষ নই। লেনদেন হয় সরাসরি আপনার ও বিক্রেতার মধ্যে।',
    en: 'Trust Bazar is a classifieds marketplace. We introduce buyers and sellers but are not a party to any sale. Transactions happen directly between you and the other user.',
  },
  sections: [
    {
      heading: { bn: '১. প্ল্যাটফর্মের ভূমিকা', en: '1. Our role' },
      paragraphs: {
        bn: [
          'Trust Bazar শুধু বিজ্ঞাপন ও যোগাযোগের সুযোগ দেয়। পণ্যের মালিকানা, গুণমান, বৈধতা ও মূল্য নির্ধারণের দায় সংশ্লিষ্ট বিক্রেতার।',
          'প্ল্যাটফর্ম কোনো এস্ক্রো বা পণ্যের দামের ইন-অ্যাপ পেমেন্ট পরিচালনা করে না। প্ল্যাটফর্মের আয় আসে পেইড বুস্ট থেকে।',
        ],
        en: [
          'Trust Bazar provides advertising and communication tools only. Ownership, quality, legality and pricing of an item are the seller’s responsibility.',
          'We do not operate escrow or process the item price in-app. Platform revenue comes from paid boosts.',
        ],
      },
    },
    {
      heading: { bn: '২. যোগ্যতা ও অ্যাকাউন্ট', en: '2. Eligibility and account' },
      bullets: {
        bn: [
          'আপনার বয়স কমপক্ষে ১৮ বছর হতে হবে; KYC-তে বয়স যাচাই করা হয়।',
          'একটি ফোন নম্বর ও একটি এনআইডি দিয়ে একটি সক্রিয় অ্যাকাউন্ট।',
          'সঠিক তথ্য দিন; ভুয়া পরিচয় বা অন্য ব্যক্তির নথি ব্যবহার নিষিদ্ধ এবং স্থায়ী নিষেধের কারণ।',
          'অ্যাকাউন্ট নিরাপত্তা আপনার দায়িত্ব; সন্দেহ হলে দ্রুত সাপোর্টে জানান।',
        ],
        en: [
          'You must be at least 18; age is checked during KYC.',
          'One active account per phone number and NID.',
          'Provide accurate information. Fake identities or another person’s documents are prohibited and lead to a permanent ban.',
          'You are responsible for your account security; contact support immediately if you suspect compromise.',
        ],
      },
    },
    {
      heading: { bn: '৩. পরিচয় যাচাই', en: '3. Identity verification' },
      paragraphs: {
        bn: [
          'লিস্টিং প্রকাশের আগে বিক্রেতার পূর্ণ KYC বাধ্যতামূলক — NID/পাসপোর্ট/স্মার্ট কার্ড ও লাইভনেস, Porichoy গেটওয়ের মাধ্যমে যাচাইকৃত।',
          'বায়ার ফোন OTP দিয়ে অ্যাকাউন্ট খুলতে পারেন, তবে চ্যাট শুরু ও বিক্রেতার নম্বর দেখতে বায়ার NID যাচাই সম্পন্ন করতে হবে।',
          'পরিচয় NID হ্যাশের সাথে যুক্ত থাকে, ফোন নম্বরের সাথে নয়। নিষিদ্ধ পরিচয় স্থায়ীভাবে ব্লক থাকে।',
        ],
        en: [
          'Full seller KYC is mandatory before publishing a listing — NID/passport/smart card plus liveness, verified through the Porichoy gateway.',
          'Buyers may register with phone OTP, but must complete buyer NID verification to start a chat and see seller phone numbers.',
          'Identity is keyed to an NID hash, not a phone number. Banned identities stay blocked permanently.',
        ],
      },
    },
    {
      heading: { bn: '৪. লিস্টিং ও কন্টেন্ট', en: '4. Listings and content' },
      bullets: {
        bn: [
          'শিরোনাম, বিবরণ, ছবি ও দাম সঠিক ও নিজের মালিকানার হতে হবে।',
          'নিষিদ্ধ পণ্য পোস্ট করা যাবে না (নিষিদ্ধ পণ্যের নীতি দেখুন)।',
          'শিরোনামে ফোন নম্বর বা দাম দেওয়া যাবে না; ছবি ১–১০টি।',
          'ভুল বিভাগ, প্রতারণামূলক বা পুনরাবৃত্তি করা লিস্টিং সরানো হতে পারে।',
        ],
        en: [
          'Titles, descriptions, photos and prices must be accurate and owned by you.',
          'Prohibited items may not be posted (see the Prohibited Items Policy).',
          'Phone numbers or prices in titles are not allowed; 1–10 photos per listing.',
          'Wrong-category, misleading or duplicate listings may be removed.',
        ],
      },
    },
    {
      heading: { bn: '৫. সরাসরি লেনদেন ও নিরাপত্তা', en: '5. Offline deals and safety' },
      paragraphs: {
        bn: [
          'প্ল্যাটফর্ম শুধু পরিচয় করিয়ে দেয়, লেনদেনের পক্ষ নয়। নগদে দেখা করে লেনদেন করার পরামর্শ দেওয়া হয়।',
          'অগ্রিম পেমেন্ট বা ব্যক্তিগত অ্যাকাউন্টে টাকা পাঠানো এড়িয়ে চলুন। জনবহুল নিরাপদ স্থানে দেখা করুন এবং পণ্য যাচাই করে তারপর পেমেন্ট করুন।',
          'চ্যাট বা ফোনে সম্পন্ন ডিল “ডাইরেক্ট সেল” হিসেবে রেকর্ড হতে পারে; ব্যবহারকারীরা রিপোর্ট করতে পারেন।',
        ],
        en: [
          'We only make introductions and are not a party to the transaction. Paying cash after meeting in person is recommended.',
          'Avoid advance payments or transfers to personal accounts. Meet in a busy, safe place and inspect the item before paying.',
          'Deals completed via chat or phone may be recorded as Direct Sales; users can report problems.',
        ],
      },
    },
    {
      heading: { bn: '৬. বুস্ট, পেমেন্ট ও রশিদ', en: '6. Boosts, payments and receipts' },
      bullets: {
        bn: [
          'বুস্টের দাম বাংলাদেশি টাকায় (৳) এবং সার্ভারে নির্ধারিত হয়।',
          'পেমেন্ট bKash বা Nagad-এর মাধ্যমে; সফল হলে বুস্ট সক্রিয় হয়।',
          'সফল পেমেন্টের রশিদ ১২ মাস ডাউনলোডযোগ্য; অ্যাকাউন্ট মুছে ফেলার আগে ডাউনলোড করুন।',
          'ক্রেডিট স্বয়ংক্রিয়ভাবে প্রয়োগ হতে পারে; মেয়াদ শেষে ক্রেডিট বাতিল হয়।',
          'বুস্ট সক্রিয় হওয়ার পর সাধারণত ফেরতযোগ্য নয়, তবে আইন বা গেটওয়ে ব্যর্থতার ক্ষেত্রে ব্যতিক্রম।',
        ],
        en: [
          'Boost prices are in BDT (৳) and resolved server-side.',
          'Payments run through bKash or Nagad; the boost activates on success.',
          'Successful payment receipts stay downloadable for 12 months — download them before deleting your account.',
          'Credits may be applied automatically and expire at the end of their validity.',
          'Boosts are generally non-refundable once active, except where required by law or when the gateway fails.',
        ],
      },
    },
    {
      heading: { bn: '৭. নিষেধাজ্ঞা ও আপিল', en: '7. Enforcement and appeals' },
      paragraphs: {
        bn: [
          'নীতি ভাঙলে সতর্কতা, ৭ দিনের সাসপেনশন বা NID-ভিত্তিক স্থায়ী নিষেধ হতে পারে। প্রতিটি সিদ্ধান্ত অডিট লগে সংরক্ষিত হয়।',
          'নিষেধাজ্ঞার বিরুদ্ধে আপিল করা যায়; সাসপেনশনের ক্ষেত্রে ২৪ ঘণ্টা এবং অন্যান্য ক্ষেত্রে ৭২ কর্মঘণ্টার মধ্যে পর্যালোচনা লক্ষ্য।',
        ],
        en: [
          'Violations may lead to a warning, a 7-day suspension or a permanent NID-based ban. Every decision is written to the audit log.',
          'You can appeal enforcement; we target a 24-hour review for suspensions and 72 business hours otherwise.',
        ],
      },
    },
    {
      heading: { bn: '৮. দায়সীমা ও প্রযোজ্য আইন', en: '8. Liability and governing law' },
      paragraphs: {
        bn: [
          'প্ল্যাটফর্ম “যেমন আছে” ভিত্তিতে 제공됩니다। ব্যবহারকারীর মধ্যে লেনদেন, ক্ষতি বা বিরোধের জন্য Trust Bazar দায়ী নয়, তবে রিপোর্ট তদন্তে সহযোগিতা করে।',
          'এই শর্তাবলি বাংলাদেশের আইনের অধীন। লঞ্চের আগে আইনি পরামর্শের ভিত্তিতে শর্তাবলি হালনাগাদ হতে পারে।',
        ],
        en: [
          'The platform is provided “as is”. Trust Bazar is not liable for transactions, losses or disputes between users, but we cooperate with report investigations.',
          'These terms are governed by the laws of Bangladesh and may be updated following legal review before launch.',
        ],
      },
    },
  ],
};

/** Privacy drafts — sourced from PRD NFR-05/05a/13 and Pre-Launch_Actions §A.1/A.3. */
export const PRIVACY: LegalDoc = {
  title: { bn: 'গোপনীয়তা নীতি', en: 'Privacy Policy' },
  summary: {
    bn: 'আমরা পরিচয় যাচাই ও প্রতারণা প্রতিরোধের জন্য প্রয়োজনীয় তথ্যই সংগ্রহ করি। KYC নথি এনক্রিপ্টেড ক্লাউড স্টোরেজে থাকে এবং প্রধান ডেটাবেসে শুধু এনক্রিপ্টেড মেটাডেটা রাখা হয়।',
    en: 'We collect only what is needed to verify identity and prevent fraud. KYC documents live in encrypted cloud storage; the main database holds encrypted metadata only.',
  },
  sections: [
    {
      heading: { bn: '১. আমরা কী সংগ্রহ করি', en: '1. What we collect' },
      bullets: {
        bn: [
          'অ্যাকাউন্ট: মোবাইল নম্বর, পছন্দের ভাষা, ডিভাইস টোকেন।',
          'KYC: NID/পাসপোর্ট/স্মার্ট কার্ডের ছবি, সেলফি, NID হ্যাশ ও এনক্রিপ্টেড মেটাডেটা, Porichoy লেনদেন আইডি।',
          'লিস্টিং: শিরোনাম, বিবরণ, দাম, অবস্থা, জেলা, ছবি, ভিউ ও চ্যাট শুরুর পরিসংখ্যান।',
          'যোগাযোগ: চ্যাট বার্তা, অফার ও ডিলের রেকর্ড।',
          'পেমেন্ট: বুস্ট লেনদেন, রশিদ নম্বর, গেটওয়ে রেফারেন্স (কার্ড বা পিন কখনো নয়)।',
          'নিরাপত্তা: অডিট ও সিকিউরিটি ইভেন্ট লগ।',
        ],
        en: [
          'Account: mobile number, language preference, device tokens.',
          'KYC: ID/passport/smart-card images, selfie, NID hash and encrypted metadata, Porichoy transaction id.',
          'Listings: title, description, price, condition, district, photos, view and chat-start counts.',
          'Communication: chat messages, offers and deal records.',
          'Payments: boost transactions, receipt numbers and gateway references (never card numbers or PINs).',
          'Security: audit and security event logs.',
        ],
      },
    },
    {
      heading: { bn: '২. ব্যবহারের উদ্দেশ্য', en: '2. How we use it' },
      paragraphs: {
        bn: [
          'পরিচয় যাচাই, প্রতারণা ও নকল অ্যাকাউন্ট প্রতিরোধ, লিস্টিং ও সার্চ প্রদান, বিরোধ ও রিপোর্ট তদন্ত, পেমেন্ট ও রশিদ, এবং আইনি বাধ্যবাধকতা পালন।',
          'আমরা আপনার ব্যক্তিগত তথ্য বিক্রি করি না।',
        ],
        en: [
          'Identity verification, fraud and duplicate-account prevention, listings and search, report and dispute handling, payments and receipts, and legal compliance.',
          'We do not sell your personal data.',
        ],
      },
    },
    {
      heading: { bn: '৩. KYC সংরক্ষণ ও মেয়াদ', en: '3. KYC storage and retention' },
      bullets: {
        bn: [
          'নথি Cloudflare R2-এ AES-256 এনক্রিপশনে; ৯০ দিন পর Wasabi আর্কাইভে।',
          'সাইনড URL সর্বোচ্চ ৫ মিনিট এবং প্রতিটি অপারেটর ভিউ অডিট লগে থাকে।',
          'সক্রিয় অ্যাকাউন্ট: অ্যাকাউন্ট সক্রিয় থাকা পর্যন্ত।',
          'বাতিল KYC: ৯০ দিন পর মুছে ফেলা হয়।',
          'নিষিদ্ধ পরিচয়: পুনরায় নিবন্ধন ঠেকাতে অনির্দিষ্টকাল।',
          'মুছে ফেলা অ্যাকাউন্ট: ৩ বছর পর্যন্ত ভেরিফিকেশন রেকর্ড।',
          'পেমেন্ট রশিদ: ১২ মাস।',
        ],
        en: [
          'Documents are AES-256 encrypted in Cloudflare R2, archived to Wasabi after 90 days.',
          'Signed URLs last at most 5 minutes and every operator view is audit-logged.',
          'Active accounts: while the account remains active.',
          'Rejected KYC: deleted within 90 days.',
          'Banned identities: retained indefinitely to prevent re-registration.',
          'Deleted accounts: verification record retained for up to 3 years.',
          'Payment receipts: 12 months.',
        ],
      },
    },
    {
      heading: { bn: '৪. তৃতীয় পক্ষের সাথে শেয়ার', en: '4. Sharing with third parties' },
      paragraphs: {
        bn: [
          'Porichoy (e-KYC), Cloudflare R2 ও Wasabi (স্টোরেজ), bKash ও Nagad (পেমেন্ট), SMS প্রোভাইডার এবং FCM/APNs (নোটিফিকেশন) — শুধু সেবা দেওয়ার প্রয়োজনীয় তথ্য শেয়ার করা হয়।',
          'আইনি অনুরোধ বা নিরাপত্তা প্রয়োজনে সংশ্লিষ্ট কর্তৃপক্ষের সাথে তথ্য শেয়ার হতে পারে।',
        ],
        en: [
          'Porichoy (e-KYC), Cloudflare R2 and Wasabi (storage), bKash and Nagad (payments), SMS providers, and FCM/APNs (notifications) receive only what is necessary to provide the service.',
          'We may disclose data to authorities in response to lawful requests or security needs.',
        ],
      },
    },
    {
      heading: { bn: '৫. নিরাপত্তা', en: '5. Security' },
      paragraphs: {
        bn: [
          'NID হ্যাশ HMAC-SHA256 দিয়ে তৈরি; NID নম্বর, নাম ও জন্মতারিখ এনক্রিপ্টেড। অ্যাক্সেস ন্যূনতম এবং প্রতিটি প্রশাসনিক কাজ অডিট লগে সংরক্ষিত।',
          'ওয়েবে সেশন httpOnly কুকিতে রাখা হয়; টোকেন localStorage-এ রাখা হয় না।',
        ],
        en: [
          'NID hashes use HMAC-SHA256; NID numbers, names and dates of birth are encrypted. Access is least-privilege and every administrative action is audit-logged.',
          'Web sessions use httpOnly cookies; tokens are never stored in localStorage.',
        ],
      },
    },
    {
      heading: { bn: '৬. আপনার অধিকার', en: '6. Your rights' },
      bullets: {
        bn: [
          'আপনার তথ্য দেখতে ও সংশোধন করতে অনুরোধ করুন।',
          'অ্যাকাউন্ট মুছুন — ১৪ দিনের গ্রেস পিরিয়ড শেষে প্রোফাইল, লিস্টিং ও চ্যাট মুছে যায়।',
          'মুছে ফেলার আগে পেমেন্ট রশিদ ডাউনলোড করুন; পরে শুধু সাপোর্টের মাধ্যমে পাওয়া যাবে।',
          'অভিযোগ বা প্রশ্ন: support@trustbazar.com।',
        ],
        en: [
          'Request access to and correction of your data.',
          'Delete your account — profile, listings and chats are removed after a 14-day grace period.',
          'Download payment receipts before deletion; afterwards they are available only via support.',
          'Complaints or questions: support@trustbazar.com.',
        ],
      },
    },
    {
      heading: { bn: '৭. কুকি, ভাষা ও শিশুদের গোপনীয়তা', en: '7. Cookies, language and children' },
      paragraphs: {
        bn: [
          'আমরা সেশন কুকি ও ভাষা পছন্দ (NEXT_LOCALE) সংরক্ষণের কুকি ব্যবহার করি। ব্রাউজার সেটিংস থেকে কুকি নিয়ন্ত্রণ করা যায়, তবে লগ ইন কাজ নাও করতে পারে।',
          'প্ল্যাটফর্ম ১৮ বছরের নিচের ব্যক্তিদের জন্য নয়; KYC-তে বয়স যাচাই করা হয়।',
        ],
        en: [
          'We use session cookies and a language-preference cookie (NEXT_LOCALE). You can control cookies in your browser, though sign-in may stop working.',
          'The platform is not for anyone under 18; age is checked during KYC.',
        ],
      },
    },
  ],
};

/** Prohibited items policy — verbatim categories from Pre-Launch_Actions §A.2. */
export const PROHIBITED: ProhibitedDoc = {
  title: { bn: 'নিষিদ্ধ পণ্যের নীতি', en: 'Prohibited Items Policy' },
  summary: {
    bn: 'নিচের পণ্য বা সেবা Trust Bazar-এ পোস্ট করা যাবে না। প্রকাশের সময় কীওয়ার্ড ও ছবি শ্রেণিবিন্যাস চালানো হয়; সন্দেহজনক লিস্টিং মডারেশনে যায়।',
    en: 'The items and services below may not be posted on Trust Bazar. Keyword and image classification runs at publish time; suspicious listings route to moderation.',
  },
  sections: [
    {
      heading: { bn: 'ধূসর এলাকার নীতি', en: 'Grey-zone rule' },
      paragraphs: {
        bn: [
          'সন্দেহ হলে মডারেটররা ডিলিস্ট ও সতর্কতার দিকে ঝুঁকেন; বিক্রেতা প্রমাণসহ আপিল করতে পারেন।',
        ],
        en: [
          'When in doubt, moderators err toward delisting plus a warning; the seller can appeal with proof.',
        ],
      },
    },
    {
      heading: { bn: 'প্রয়োগ', en: 'Enforcement' },
      paragraphs: {
        bn: [
          'নিষিদ্ধ পণ্যের লিস্টিং সরানো হয় এবং নীতি অনুযায়ী সতর্কতা, ৭ দিনের সাসপেনশন বা স্থায়ী NID নিষেধ প্রয়োগ হয়।',
        ],
        en: [
          'Prohibited listings are removed and the enforcement ladder applies: warning, 7-day suspension or a permanent NID ban.',
        ],
      },
    },
  ],
  items: [
    {
      name: { bn: 'অস্ত্র ও বিস্ফোরক', en: 'Weapons and explosives' },
      examples: {
        bn: 'আগ্নেয়াস্ত্র, গোলাবারুদ, অস্ত্র হিসেবে বিক্রিত ছুরি, বিস্ফোরক, আতশবাজি',
        en: 'Firearms, ammunition, knives sold as weapons, explosives, fireworks',
      },
    },
    {
      name: { bn: 'মাদক ও নিয়ন্ত্রিত পদার্থ', en: 'Drugs and controlled substances' },
      examples: {
        bn: 'প্রেসক্রিপশন ওষুধ, নেশাজাতীয় দ্রব্য, অনিবন্ধিত সাপ্লিমেন্ট',
        en: 'Prescription drugs, narcotics, unregistered supplements',
      },
    },
    {
      name: { bn: 'তামাক ও অ্যালকোহল', en: 'Tobacco and alcohol' },
      examples: {
        bn: 'সিগারেট, ই-সিগারেট/ভেপ, যেকোনো ধরনের অ্যালকোহল',
        en: 'Cigarettes, e-cigarettes/vapes, alcohol of any kind',
      },
    },
    {
      name: { bn: 'চুরি বা অবৈধ পণ্য', en: 'Stolen or illegal goods' },
      examples: {
        bn: 'অনুরোধে মালিকানা প্রমাণ করতে না পারা পণ্য, পুলিশে ফ্ল্যাগ করা আইটেম',
        en: 'Goods without proof of ownership on request, items flagged by police',
      },
    },
    {
      name: { bn: 'মুদ্রা ও আর্থিক উপকরণ', en: 'Currency and financial instruments' },
      examples: {
        bn: 'জাল মুদ্রা, প্রকাশ না করে অভিহিত মূল্যের বেশি দামে বিক্রিত মুদ্রা, ক্লোনড কার্ড/ডিভাইস',
        en: 'Counterfeit currency, currency sold above face value without disclosure, cloned cards/devices',
      },
    },
    {
      name: { bn: 'প্রাপ্তবয়স্ক ও স্পষ্ট কন্টেন্ট', en: 'Adult and explicit material' },
      examples: {
        bn: 'পর্নোগ্রাফি, যৌন সেবা, যেকোনো স্পষ্ট কন্টেন্ট',
        en: 'Pornography, sexual services, explicit content of any kind',
      },
    },
    {
      name: { bn: 'বন্যপ্রাণী ও প্রাণী', en: 'Wildlife and animals' },
      examples: {
        bn: 'বিলুপ্ত/সংরক্ষিত প্রজাতি, হাতির দাঁত, অনুমতিপ্রয়োজনীয় জীবন্ত প্রাণী',
        en: 'Endangered/protected species, ivory, live animals requiring permits',
      },
    },
    {
      name: { bn: 'মানব অবশেষ ও অঙ্গ', en: 'Human remains and body parts' },
      examples: { bn: 'যেকোনো ধরনের', en: 'Any' },
    },
    {
      name: { bn: 'ব্যক্তিগত তথ্য ও নথি', en: 'Personal data and documents' },
      examples: {
        bn: 'অন্যের NID/পাসপোর্টের কপি, ভোটার তালিকা, অন্যের নামে নিবন্ধিত সিম, ব্যাংক নথি',
        en: 'NID/passport copies of others, voter lists, SIM cards registered to others, bank documents',
      },
    },
    {
      name: { bn: 'নকল ও আইপি লঙ্ঘনকারী পণ্য', en: 'Counterfeit and IP-infringing goods' },
      examples: {
        bn: 'আসল বলে বিক্রিত নকল ব্র্যান্ড, পাইরেটেড সফটওয়্যার/মিডিয়া',
        en: 'Fake branded items sold as genuine, pirated software/media',
      },
    },
    {
      name: { bn: 'বিপজ্জনক উপকরণ', en: 'Hazardous materials' },
      examples: {
        bn: 'শিল্প রাসায়নিক, মেডিকেল বর্জ্য, মেয়াদোত্তীর্ণ ভোগ্যপণ্য',
        en: 'Industrial chemicals, medical waste, expired consumables',
      },
    },
    {
      name: { bn: 'সরকারি ও জরুরি সেবার আইটেম', en: 'Government and emergency services items' },
      examples: {
        bn: 'পুলিশ/RAB/সেনাবাহিনীর ইউনিফর্ম বা ব্যাজ, সরকারি পরিচয়পত্র',
        en: 'Police/RAB/military uniforms or insignia, official badges',
      },
    },
    {
      name: { bn: 'জুয়া ও বেটিং', en: 'Gambling and betting' },
      examples: {
        bn: 'বেটিং অ্যাকাউন্ট, লটারি রিসেল, জুয়ার ডিভাইস',
        en: 'Betting accounts, lottery resale, gambling devices',
      },
    },
    {
      name: { bn: 'সেবা ও অ-ভৌত লিস্টিং', en: 'Services and non-physical listings' },
      examples: {
        bn: 'চাকরির বিজ্ঞাপন, ভাড়া লিস্টিং, সেবা (v1-এ ক্যাটাগরির বাইরে)',
        en: 'Job ads, rental listings, services (out of category scope in v1)',
      },
    },
    {
      name: { bn: 'লাইসেন্সপ্রয়োজনীয় মেডিকেল ডিভাইস', en: 'Medical devices requiring a licence' },
      examples: {
        bn: 'কাগজ ছাড়া অক্সিজেন কনসেনট্রেটর, প্রেসক্রিপশন-শুধু ডিভাইস',
        en: 'Oxygen concentrators without papers, prescription-only devices',
      },
    },
    {
      name: { bn: 'রিকল বা অনিরাপদ পণ্য', en: 'Recalled or unsafe products' },
      examples: {
        bn: 'নির্মাতার রিকলের অধীনে থাকা পণ্য, নিম্নমানের ইলেকট্রিক্যালস',
        en: 'Items under manufacturer recall, substandard electricals',
      },
    },
  ],
};
