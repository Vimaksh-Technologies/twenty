import { domainToASCII } from 'node:url';

export class NormalizationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_DOMAIN'
      | 'INVALID_EMAIL'
      | 'INVALID_PHONE'
      | 'INVALID_POSTCODE',
  ) {
    super(message);
    this.name = 'NormalizationError';
  }
}

export const normalizeWhitespace = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/gu, ' ');

export const normalizeName = (value: string): string =>
  normalizeWhitespace(value).toLocaleLowerCase('en');

export const normalizeDomain = (value: string): string => {
  const normalizedInput = normalizeWhitespace(value);
  const valueWithScheme = /^[a-z][a-z\d+.-]*:\/\//iu.test(normalizedInput)
    ? normalizedInput
    : `https://${normalizedInput}`;
  let hostname: string;

  try {
    hostname = new URL(valueWithScheme).hostname;
  } catch {
    throw new NormalizationError(
      'Domain is not a valid hostname',
      'INVALID_DOMAIN',
    );
  }

  const withoutCommonPrefix = hostname
    .replace(/^www\./iu, '')
    .replace(/\.$/u, '');
  const asciiDomain = domainToASCII(withoutCommonPrefix).toLowerCase();

  if (
    asciiDomain.length === 0 ||
    asciiDomain.length > 253 ||
    !asciiDomain.includes('.') ||
    asciiDomain.split('.').some((label) => {
      return (
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label)
      );
    })
  ) {
    throw new NormalizationError(
      'Domain is not a valid hostname',
      'INVALID_DOMAIN',
    );
  }

  return asciiDomain;
};

export const normalizeEmail = (value: string): string => {
  const normalizedInput = normalizeWhitespace(value);
  const separatorIndex = normalizedInput.lastIndexOf('@');

  if (
    separatorIndex <= 0 ||
    separatorIndex === normalizedInput.length - 1 ||
    normalizedInput.indexOf('@') !== separatorIndex
  ) {
    throw new NormalizationError('Email is not valid', 'INVALID_EMAIL');
  }

  const localPart = normalizedInput.slice(0, separatorIndex).toLowerCase();
  const domain = normalizeDomain(normalizedInput.slice(separatorIndex + 1));

  if (
    localPart.length > 64 ||
    /[\\\s<>(),;:"[\]]/u.test(localPart) ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    throw new NormalizationError('Email is not valid', 'INVALID_EMAIL');
  }

  return `${localPart}@${domain}`;
};

export const normalizePhone = (value: string): string => {
  const normalizedInput = normalizeWhitespace(value);
  const hasExplicitCountryCode = normalizedInput.startsWith('+');
  const digits = normalizedInput.replace(/\D/gu, '');

  if (digits.length < 6 || digits.length > 15) {
    throw new NormalizationError(
      'Phone must contain 6 to 15 digits',
      'INVALID_PHONE',
    );
  }

  return hasExplicitCountryCode ? `+${digits}` : digits;
};

export const normalizePostcode = (value: string): string => {
  const normalizedPostcode = normalizeWhitespace(value)
    .replace(/[\s-]/gu, '')
    .toUpperCase();

  if (!/^[A-Z\d]{3,12}$/u.test(normalizedPostcode)) {
    throw new NormalizationError('Postcode is not valid', 'INVALID_POSTCODE');
  }

  return normalizedPostcode;
};
