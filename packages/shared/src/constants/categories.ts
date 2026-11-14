/** Starter category taxonomy for seeding — server-managed afterwards (database `categories`). */
export interface CategorySeed {
  readonly slug: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly parentSlug?: string;
}

export const CATEGORY_SEED: readonly CategorySeed[] = [
  { slug: 'mobiles', nameBn: 'মোবাইল ফোন', nameEn: 'Mobile Phones' },
  { slug: 'mobiles-smartphones', nameBn: 'স্মার্টফোন', nameEn: 'Smartphones', parentSlug: 'mobiles' },
  { slug: 'mobiles-tablets', nameBn: 'ট্যাবলেট', nameEn: 'Tablets', parentSlug: 'mobiles' },
  { slug: 'mobiles-accessories', nameBn: 'মোবাইল এক্সেসরিজ', nameEn: 'Mobile Accessories', parentSlug: 'mobiles' },

  { slug: 'electronics', nameBn: 'ইলেকট্রনিক্স', nameEn: 'Electronics' },
  { slug: 'electronics-computers', nameBn: 'কম্পিউটার', nameEn: 'Computers', parentSlug: 'electronics' },
  { slug: 'electronics-tv-audio', nameBn: 'টিভি ও অডিও', nameEn: 'TV & Audio', parentSlug: 'electronics' },
  { slug: 'electronics-cameras', nameBn: 'ক্যামেরা', nameEn: 'Cameras', parentSlug: 'electronics' },

  { slug: 'vehicles', nameBn: 'যানবাহন', nameEn: 'Vehicles' },
  { slug: 'vehicles-cars', nameBn: 'গাড়ি', nameEn: 'Cars', parentSlug: 'vehicles' },
  { slug: 'vehicles-motorcycles', nameBn: 'মোটরসাইকেল', nameEn: 'Motorcycles', parentSlug: 'vehicles' },
  { slug: 'vehicles-bicycles', nameBn: 'সাইকেল', nameEn: 'Bicycles', parentSlug: 'vehicles' },

  { slug: 'property', nameBn: 'প্রপার্টি', nameEn: 'Property' },
  { slug: 'property-apartments', nameBn: 'ফ্ল্যাট', nameEn: 'Apartments', parentSlug: 'property' },
  { slug: 'property-land', nameBn: 'জমি', nameEn: 'Land', parentSlug: 'property' },
  { slug: 'property-commercial', nameBn: 'বাণিজ্যিক', nameEn: 'Commercial', parentSlug: 'property' },

  { slug: 'home-appliances', nameBn: 'হোম অ্যাপ্লায়েন্স', nameEn: 'Home Appliances' },
  { slug: 'furniture', nameBn: 'ফার্নিচার', nameEn: 'Furniture' },
  { slug: 'fashion', nameBn: 'ফ্যাশন', nameEn: 'Fashion' },
  { slug: 'baby-kids', nameBn: 'শিশু ও বাচ্চা', nameEn: 'Baby & Kids' },
  { slug: 'books-education', nameBn: 'বই ও শিক্ষা', nameEn: 'Books & Education' },
  { slug: 'sports-fitness', nameBn: 'স্পোর্টস ও ফিটনেস', nameEn: 'Sports & Fitness' },
  { slug: 'pets', nameBn: 'পোষা প্রাণী', nameEn: 'Pets' },
  { slug: 'services', nameBn: 'সেবা', nameEn: 'Services' },
  { slug: 'jobs', nameBn: 'চাকরি', nameEn: 'Jobs' },
  { slug: 'agriculture', nameBn: 'কৃষি', nameEn: 'Agriculture' },
] as const;
