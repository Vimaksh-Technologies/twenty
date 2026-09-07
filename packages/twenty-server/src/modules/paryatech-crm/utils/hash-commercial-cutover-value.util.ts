import { createHash } from 'node:crypto';

const canonicalizeCommercialCutoverValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeCommercialCutoverValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [
          key,
          canonicalizeCommercialCutoverValue(entryValue),
        ]),
    );
  }
  return value;
};

export const hashCommercialCutoverValue = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(canonicalizeCommercialCutoverValue(value)))
    .digest('hex');
