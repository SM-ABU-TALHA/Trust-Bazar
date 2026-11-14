import { describe, expect, it } from 'vitest';
import { phoneSchema, dateOfBirthSchema } from '../common.js';
import { nidNumberSchema } from '../kyc.js';
import { districtSchema, listingTitleSchema, updateListingSchema } from '../listing.js';
import { createOfferSchema } from '../chat.js';

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe('phoneSchema', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+880 1712-345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
  ])('normalizes %s to E.164', (input, expected) => {
    expect(phoneSchema.parse(input)).toBe(expected);
  });

  it.each(['0123456789', '0171234567', '017123456789', 'not-a-phone'])('rejects %s', (input) => {
    expect(phoneSchema.safeParse(input).success).toBe(false);
  });
});

describe('nidNumberSchema', () => {
  it('accepts 10 and 13 digit NIDs', () => {
    expect(nidNumberSchema.safeParse('1234567890').success).toBe(true);
    expect(nidNumberSchema.safeParse('1990123456789').success).toBe(true);
  });

  it('rejects wrong length and repeated digits', () => {
    expect(nidNumberSchema.safeParse('12345678901').success).toBe(false);
    expect(nidNumberSchema.safeParse('1111111111111').success).toBe(false);
  });
});

describe('dateOfBirthSchema', () => {
  it('accepts an adult', () => {
    expect(dateOfBirthSchema.safeParse(isoDaysAgo(365 * 20)).success).toBe(true);
  });

  it('rejects a minor', () => {
    expect(dateOfBirthSchema.safeParse(isoDaysAgo(365 * 10)).success).toBe(false);
  });
});

describe('listingTitleSchema', () => {
  it('accepts a normal title', () => {
    expect(listingTitleSchema.safeParse('Used iPhone 13 Pro 128GB').success).toBe(true);
  });

  it('rejects phone numbers and prices in the title', () => {
    expect(listingTitleSchema.safeParse('Call 01712345678 for iPhone 13').success).toBe(false);
    expect(listingTitleSchema.safeParse('iPhone 13 Pro only 45000 taka').success).toBe(false);
  });
});

describe('districtSchema', () => {
  it('accepts a known district and rejects unknown ones', () => {
    expect(districtSchema.safeParse('Dhaka').success).toBe(true);
    expect(districtSchema.safeParse('Atlantis').success).toBe(false);
  });
});

describe('createOfferSchema', () => {
  it('caps the amount at 2x listing price', () => {
    const schema = createOfferSchema(1000);
    expect(schema.safeParse({ amount: 2000 }).success).toBe(true);
    expect(schema.safeParse({ amount: 2001 }).success).toBe(false);
  });
});

describe('updateListingSchema', () => {
  it('requires version and at least one field', () => {
    expect(updateListingSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(
      updateListingSchema.safeParse({ version: 0, title: 'Used iPhone 13 Pro 128GB' }).success,
    ).toBe(true);
  });
});
