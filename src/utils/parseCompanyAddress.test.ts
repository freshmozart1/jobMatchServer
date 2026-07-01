import { describe, expect, it } from '@jest/globals';
import { parseCompanyAddress } from './parseCompanyAddress.js';

const defaultCompanyAddress = {
  streetAddress: 'Musterstraße 42',
  city: 'Berlin',
  postalCode: '10115',
  countryCode: 'DE',
};

describe('parseCompanyAddress', () => {
  it('returns the parsed address for valid paragraphs', () => {
    expect(
      parseCompanyAddress(['Musterstraße 42', 'Berlin, 10115, DE']),
    ).toEqual(defaultCompanyAddress);
  });

  it('returns null when the paragraphs array is empty', () => {
    expect(parseCompanyAddress([])).toBeNull();
  });

  it('returns null when the second paragraph does not have enough comma-separated parts', () => {
    expect(parseCompanyAddress(['Musterstraße 42', 'Berlin'])).toBeNull();
  });

  it('returns null when the second paragraph has only one comma', () => {
    expect(parseCompanyAddress(['Musterstraße 42', 'Berlin, DE'])).toBeNull();
  });

  it('returns the parsed address for a house number range, keeping the raw postal code', () => {
    expect(
      parseCompanyAddress([
        'Altenholzer Straße 10-14',
        'Altenholz , Schleswig Holstein 24161, DE',
      ]),
    ).toEqual({
      streetAddress: 'Altenholzer Straße 10-14',
      city: 'Altenholz',
      postalCode: 'Schleswig Holstein 24161',
      countryCode: 'DE',
    });
  });

  it('returns the parsed address when the state abbreviation is prefixed to the postal code', () => {
    expect(
      parseCompanyAddress(['Musterstraße 42', 'Bremen, HB 28197, DE']),
    ).toEqual({
      streetAddress: 'Musterstraße 42',
      city: 'Bremen',
      postalCode: 'HB 28197',
      countryCode: 'DE',
    });
  });

  it('parses the address when a label paragraph precedes the address paragraphs', () => {
    expect(
      parseCompanyAddress(['Primär', 'Musterstraße 42', 'Berlin, 10115, DE']),
    ).toEqual(defaultCompanyAddress);
  });

  it('parses the address when a label paragraph follows the address paragraphs', () => {
    expect(
      parseCompanyAddress(['Musterstraße 42', 'Berlin, 10115, DE', 'Primär']),
    ).toEqual(defaultCompanyAddress);
  });

  it('parses the address when a label paragraph is interleaved between the address paragraphs', () => {
    expect(
      parseCompanyAddress(['Musterstraße 42', 'Primär', 'Berlin, 10115, DE']),
    ).toEqual(defaultCompanyAddress);
  });

  it('returns null when only a label and city/postal/country are present without a street address', () => {
    expect(parseCompanyAddress(['Primär', 'Berlin, 10115, DE'])).toBeNull();
  });
});
