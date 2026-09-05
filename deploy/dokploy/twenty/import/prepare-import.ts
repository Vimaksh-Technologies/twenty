import { lstat, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { matchAgencyCandidates } from './candidate-matcher.js';
import {
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizePostcode,
  normalizeWhitespace,
} from './normalizers.js';
import {
  PREPARED_SCHEMA_VERSION,
  REVIEW_SCHEMA_VERSION,
  assertPathOutsideGit,
  canonicalJson,
  hashCanonical,
  parseStrictCliArguments,
  readPrivateJson,
  sha256,
  writeCliFailure,
  writePrivateJsonAtomic,
  type CliIo,
  type ExistingAgencyCandidate,
  type ImportLimits,
  type NormalizedAgencyInput,
  type PreparedCell,
  type PreparedCellOriginalType,
  type PreparedDataset,
  type PreparedReviewArtifact,
  type PreparedRow,
  type PreparedSheet,
  type StructuredLogger,
} from './types.js';

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxCellBytes: 64 * 1024,
  maxCells: 1_000_000,
  maxRows: 50_000,
  maxSheets: 32,
  maxZipEntries: 10_000,
  maxZipExpandedBytes: 100 * 1024 * 1024,
};

type ImportValidationErrorCode =
  | 'ACTIVE_CONTENT'
  | 'DUPLICATE_HEADER'
  | 'EXTERNAL_LINK'
  | 'INSECURE_FILE_MODE'
  | 'INVALID_BATCH_ID'
  | 'INVALID_CSV'
  | 'INVALID_XLSX'
  | 'LIMIT_EXCEEDED'
  | 'SIGNATURE_MISMATCH'
  | 'UNAPPROVED_EXTENSION'
  | 'UNSAFE_ARCHIVE_PATH'
  | 'UNSUPPORTED_ZIP_METHOD';

export class ImportValidationError extends Error {
  constructor(
    message: string,
    readonly code: ImportValidationErrorCode,
  ) {
    super(message);
    this.name = 'ImportValidationError';
  }
}

type PrepareImportOptions = {
  batchId: string;
  filePath: string;
  limits?: ImportLimits;
  logger?: StructuredLogger;
};

type ZipEntry = {
  contents: Buffer;
  name: string;
};

const log = (
  logger: StructuredLogger | undefined,
  event: string,
  fields: Record<string, boolean | number | string | null>,
) => {
  logger?.({ event, fields });
};

const assertWithinLimit = (
  value: number,
  limit: number,
  label: string,
): void => {
  if (value > limit) {
    throw new ImportValidationError(
      `${label} exceeds the approved limit`,
      'LIMIT_EXCEEDED',
    );
  }
};

const decodeXmlText = (value: string): string =>
  value
    .replace(/&#x([\da-f]+);/giu, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&#(\d+);/gu, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');

const assertSafeXml = (xml: string): void => {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new ImportValidationError(
      'Workbook XML contains an unsafe declaration',
      'ACTIVE_CONTENT',
    );
  }
};

const extractXmlText = (xml: string): string => {
  const textParts = [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/giu)].map(
    (match) => decodeXmlText(match[1] ?? ''),
  );

  return textParts.join('');
};

const attribute = (xmlTag: string, name: string): string | undefined => {
  const match = xmlTag.match(new RegExp(`\\s${name}="([^"]*)"`, 'u'));

  return match?.[1] === undefined ? undefined : decodeXmlText(match[1]);
};

const findEndOfCentralDirectory = (archive: Buffer): number => {
  const minimumOffset = Math.max(0, archive.length - 65_557);

  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new ImportValidationError(
    'XLSX central directory is missing',
    'INVALID_XLSX',
  );
};

const readZipEntries = (archive: Buffer, limits: ImportLimits): ZipEntry[] => {
  if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new ImportValidationError(
      'XLSX does not have a ZIP signature',
      'SIGNATURE_MISMATCH',
    );
  }

  const endOffset = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);

  assertWithinLimit(entryCount, limits.maxZipEntries, 'ZIP entry count');

  if (
    centralDirectoryOffset + centralDirectorySize > archive.length ||
    centralDirectoryOffset < 0
  ) {
    throw new ImportValidationError(
      'XLSX central directory is out of bounds',
      'INVALID_XLSX',
    );
  }

  const entries: ZipEntry[] = [];
  let expandedBytes = 0;
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== 0x02014b50
    ) {
      throw new ImportValidationError(
        'XLSX central directory entry is invalid',
        'INVALID_XLSX',
      );
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const expandedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;

    if ((flags & 0x1) !== 0 || nameEnd > archive.length) {
      throw new ImportValidationError(
        'Encrypted or truncated XLSX entries are not accepted',
        'INVALID_XLSX',
      );
    }

    const name = archive.subarray(nameStart, nameEnd).toString('utf8');

    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').includes('..')
    ) {
      throw new ImportValidationError(
        'XLSX contains an unsafe archive path',
        'UNSAFE_ARCHIVE_PATH',
      );
    }

    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new ImportValidationError(
        'XLSX uses an unsupported compression method',
        'UNSUPPORTED_ZIP_METHOD',
      );
    }

    if (
      localHeaderOffset + 30 > archive.length ||
      archive.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new ImportValidationError(
        'XLSX local entry header is invalid',
        'INVALID_XLSX',
      );
    }

    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > archive.length) {
      throw new ImportValidationError(
        'XLSX entry data is out of bounds',
        'INVALID_XLSX',
      );
    }

    const compressedContents = archive.subarray(dataStart, dataEnd);
    let contents: Buffer;

    try {
      contents =
        compressionMethod === 0
          ? Buffer.from(compressedContents)
          : inflateRawSync(compressedContents, {
              maxOutputLength: limits.maxZipExpandedBytes,
            });
    } catch {
      throw new ImportValidationError(
        'XLSX entry decompression failed',
        'INVALID_XLSX',
      );
    }

    if (contents.length !== expandedSize) {
      throw new ImportValidationError(
        'XLSX entry expanded size does not match its directory',
        'INVALID_XLSX',
      );
    }

    expandedBytes += contents.length;
    assertWithinLimit(
      expandedBytes,
      limits.maxZipExpandedBytes,
      'XLSX expanded bytes',
    );
    entries.push({ contents, name });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
};

const assertWorkbookContentIsPassive = (entries: ZipEntry[]): void => {
  const names = entries.map((entry) => entry.name.toLowerCase());

  if (names.some((name) => name.startsWith('xl/externallinks/'))) {
    throw new ImportValidationError(
      'XLSX external links are not accepted',
      'EXTERNAL_LINK',
    );
  }

  if (
    names.some((name) => {
      return (
        name.endsWith('/vbaproject.bin') ||
        name.endsWith('.bin') ||
        name.includes('/activex/') ||
        name.includes('/embeddings/') ||
        name.includes('/oleobjects/') ||
        name.includes('/macrosheets/') ||
        name.endsWith('/connections.xml')
      );
    })
  ) {
    throw new ImportValidationError(
      'XLSX active or embedded content is not accepted',
      'ACTIVE_CONTENT',
    );
  }

  for (const entry of entries.filter((candidate) =>
    candidate.name.toLowerCase().endsWith('.xml'),
  )) {
    const xml = entry.contents.toString('utf8');

    assertSafeXml(xml);
    if (/TargetMode="External"|externalLink/iu.test(xml)) {
      throw new ImportValidationError(
        'XLSX external relationships are not accepted',
        'EXTERNAL_LINK',
      );
    }
  }
};

const parseCsv = (contents: string): string[][] => {
  const records: string[][] = [];
  let currentField = '';
  let currentRecord: string[] = [];
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];

    if (quoted) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          currentField += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        currentField += character;
      }
      continue;
    }

    if (character === '"' && currentField.length === 0) {
      quoted = true;
    } else if (character === ',') {
      currentRecord.push(currentField);
      currentField = '';
    } else if (character === '\n') {
      currentRecord.push(currentField.replace(/\r$/u, ''));
      records.push(currentRecord);
      currentRecord = [];
      currentField = '';
    } else {
      currentField += character;
    }
  }

  if (quoted) {
    throw new ImportValidationError(
      'CSV contains an unterminated quoted field',
      'INVALID_CSV',
    );
  }

  if (currentField.length > 0 || currentRecord.length > 0) {
    currentRecord.push(currentField.replace(/\r$/u, ''));
    records.push(currentRecord);
  }

  return records.filter((record) => record.some((value) => value.length > 0));
};

const formulaLike = (value: string): boolean => {
  const leadingTrimmed = value.trimStart();

  return (
    /^[=+@]/u.test(leadingTrimmed) ||
    /^-[^\d.]/u.test(leadingTrimmed) ||
    /^[\t\r]/u.test(value)
  );
};

const safeStringDisplay = (value: string): string => {
  if (formulaLike(value)) {
    return "'[FORMULA]";
  }

  const normalizedValue = value.normalize('NFC');
  let safeValue = '';

  for (const character of normalizedValue) {
    const characterCode = character.codePointAt(0) ?? 0;
    const isUnsafeControlCharacter =
      characterCode <= 0x08 ||
      characterCode === 0x0b ||
      characterCode === 0x0c ||
      (characterCode >= 0x0e && characterCode <= 0x1f) ||
      characterCode === 0x7f;

    if (!isUnsafeControlCharacter) {
      safeValue += character;
    }
  }

  return safeValue;
};

const buildCell = (
  columnIndex: number,
  originalType: PreparedCellOriginalType,
  originalValue: string,
  displayValue = originalValue,
): PreparedCell => {
  const effectiveType =
    originalType === 'string' && formulaLike(originalValue)
      ? 'formula'
      : originalType;

  return {
    columnIndex,
    originalHash: hashCanonical({ originalType: effectiveType, originalValue }),
    originalType: effectiveType,
    safeDisplayValue:
      effectiveType === 'formula'
        ? "'[FORMULA]"
        : safeStringDisplay(displayValue),
  };
};

const assertHeaders = (headers: string[]): void => {
  if (headers.length === 0 || headers.some((header) => header.length === 0)) {
    throw new ImportValidationError(
      'Every source column requires a non-empty header',
      'INVALID_CSV',
    );
  }

  const normalizedHeaders = headers.map((header) =>
    header.toLocaleLowerCase('en'),
  );

  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new ImportValidationError(
      'Source headers must be unique',
      'DUPLICATE_HEADER',
    );
  }
};

const assertTableLimits = (
  headers: string[],
  rows: string[][],
  limits: ImportLimits,
): void => {
  assertWithinLimit(rows.length, limits.maxRows, 'Source row count');
  assertWithinLimit(
    headers.length + rows.reduce((count, row) => count + row.length, 0),
    limits.maxCells,
    'Source cell count',
  );

  for (const value of [...headers, ...rows.flat()]) {
    assertWithinLimit(
      Buffer.byteLength(value),
      limits.maxCellBytes,
      'Source cell bytes',
    );
  }
};

const buildRows = (
  batchId: string,
  sheetName: string,
  headers: string[],
  values: Array<
    Array<{ display: string; original: string; type: PreparedCellOriginalType }>
  >,
  firstRowNumber: number,
): PreparedRow[] =>
  values.map((rowValues, rowIndex) => {
    const cells = Object.fromEntries(
      headers.map((header, columnIndex) => {
        const value = rowValues[columnIndex] ?? {
          display: '',
          original: '',
          type: 'blank' as const,
        };

        return [
          header,
          buildCell(columnIndex, value.type, value.original, value.display),
        ];
      }),
    );
    const rowNumber = firstRowNumber + rowIndex;
    const rowHash = hashCanonical({
      batchId,
      cellHashes: headers.map((header) => cells[header]?.originalHash),
      rowNumber,
      sheetName,
    });

    return { batchId, cells, rowHash, rowNumber, sheetName };
  });

const prepareCsv = (
  buffer: Buffer,
  batchId: string,
  limits: ImportLimits,
): PreparedSheet[] => {
  if (
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) ||
    buffer.includes(0)
  ) {
    throw new ImportValidationError(
      'CSV signature/content does not match plain UTF-8 text',
      'SIGNATURE_MISMATCH',
    );
  }

  let contents: string;

  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ImportValidationError('CSV must be valid UTF-8', 'INVALID_CSV');
  }

  const records = parseCsv(contents.replace(/^\uFEFF/u, ''));

  if (records.length === 0) {
    throw new ImportValidationError('CSV requires a header row', 'INVALID_CSV');
  }

  const headers = (records[0] ?? []).map((header) =>
    normalizeWhitespace(header),
  );
  const dataRows = records.slice(1);

  assertHeaders(headers);
  if (dataRows.some((row) => row.length > headers.length)) {
    throw new ImportValidationError(
      'CSV row contains more cells than its header',
      'INVALID_CSV',
    );
  }
  assertTableLimits(headers, dataRows, limits);

  return [
    {
      headers,
      name: 'CSV',
      rows: buildRows(
        batchId,
        'CSV',
        headers,
        dataRows.map((row) =>
          row.map((value) => ({
            display: value,
            original: value,
            type: 'string' as const,
          })),
        ),
        2,
      ),
    },
  ];
};

const columnIndexFromReference = (reference: string): number => {
  const letters = reference.match(/^[A-Z]+/iu)?.[0]?.toUpperCase();

  if (letters === undefined) {
    throw new ImportValidationError(
      'Worksheet cell reference is invalid',
      'INVALID_XLSX',
    );
  }

  return (
    [...letters].reduce(
      (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
};

const parseNumberFormats = (stylesXml: string | undefined): string[] => {
  if (stylesXml === undefined) {
    return [];
  }

  assertSafeXml(stylesXml);
  const customFormats: Record<string, string> = {};

  for (const match of stylesXml.matchAll(/<numFmt\b[^>]*\/?\s*>/giu)) {
    const identifier = attribute(match[0], 'numFmtId');
    const formatCode = attribute(match[0], 'formatCode');

    if (identifier !== undefined && formatCode !== undefined) {
      customFormats[identifier] = formatCode;
    }
  }

  const cellFormatsSection = stylesXml.match(
    /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/iu,
  )?.[1];

  if (cellFormatsSection === undefined) {
    return [];
  }

  return [...cellFormatsSection.matchAll(/<xf\b[^>]*\/?\s*>/giu)].map(
    (match) => customFormats[attribute(match[0], 'numFmtId') ?? ''] ?? '',
  );
};

const applyNumberFormat = (value: string, formatCode: string): string => {
  if (/^0+$/u.test(formatCode) && /^-?\d+$/u.test(value)) {
    const negative = value.startsWith('-');
    const digits = negative ? value.slice(1) : value;
    const padded = digits.padStart(formatCode.length, '0');

    return negative ? `-${padded}` : padded;
  }

  return value;
};

const parseWorksheetRows = (
  xml: string,
  sharedStrings: string[],
  numberFormats: string[],
): Array<{
  rowNumber: number;
  values: Array<{
    columnIndex: number;
    display: string;
    original: string;
    type: PreparedCellOriginalType;
  }>;
}> => {
  assertSafeXml(xml);

  return [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/giu)].map(
    (rowMatch, rowIndex) => {
      const rowTag = rowMatch[1] ?? '';
      const rowNumber = Number.parseInt(attribute(rowTag, 'r') ?? '', 10);
      const effectiveRowNumber = Number.isFinite(rowNumber)
        ? rowNumber
        : rowIndex + 1;
      const rowXml = rowMatch[2] ?? '';
      const values = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/giu)].map(
        (cellMatch) => {
          const cellTag = cellMatch[1] ?? '';
          const cellXml = cellMatch[2] ?? '';
          const reference = attribute(cellTag, 'r') ?? '';
          const columnIndex = columnIndexFromReference(reference);
          const cellType = attribute(cellTag, 't');
          const styleIndex = Number.parseInt(
            attribute(cellTag, 's') ?? '0',
            10,
          );
          const rawValue = decodeXmlText(
            cellXml.match(/<v>([\s\S]*?)<\/v>/iu)?.[1] ?? '',
          );
          const formula = cellXml.match(
            /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/iu,
          )?.[1];

          if (formula !== undefined) {
            return {
              columnIndex,
              display: "'[FORMULA]",
              original: `${decodeXmlText(formula)}\u0000${rawValue}`,
              type: 'formula' as const,
            };
          }

          if (cellType === 'inlineStr') {
            const value = extractXmlText(cellXml);

            return {
              columnIndex,
              display: value,
              original: value,
              type: 'string' as const,
            };
          }

          if (cellType === 's') {
            const sharedString = sharedStrings[Number.parseInt(rawValue, 10)];

            if (sharedString === undefined) {
              throw new ImportValidationError(
                'Worksheet references a missing shared string',
                'INVALID_XLSX',
              );
            }

            return {
              columnIndex,
              display: sharedString,
              original: sharedString,
              type: 'string' as const,
            };
          }

          if (cellType === 'b') {
            return {
              columnIndex,
              display: rawValue === '1' ? 'TRUE' : 'FALSE',
              original: rawValue,
              type: 'boolean' as const,
            };
          }

          if (cellType === 'str') {
            return {
              columnIndex,
              display: rawValue,
              original: rawValue,
              type: 'string' as const,
            };
          }

          const formatCode = numberFormats[styleIndex] ?? '';
          const isDateFormat = /[dmyhs]/iu.test(
            formatCode.replace(/"[^"]*"/gu, ''),
          );

          return {
            columnIndex,
            display: applyNumberFormat(rawValue, formatCode),
            original: rawValue,
            type: isDateFormat ? ('date' as const) : ('number' as const),
          };
        },
      );

      return { rowNumber: effectiveRowNumber, values };
    },
  );
};

const prepareXlsx = (
  buffer: Buffer,
  batchId: string,
  limits: ImportLimits,
): PreparedSheet[] => {
  const entries = readZipEntries(buffer, limits);

  assertWorkbookContentIsPassive(entries);
  const entriesByName = Object.fromEntries(
    entries.map((entry) => [entry.name, entry.contents]),
  );
  const workbookXml = entriesByName['xl/workbook.xml']?.toString('utf8');
  const relationshipsXml =
    entriesByName['xl/_rels/workbook.xml.rels']?.toString('utf8');

  if (workbookXml === undefined || relationshipsXml === undefined) {
    throw new ImportValidationError(
      'XLSX is missing its workbook metadata',
      'INVALID_XLSX',
    );
  }

  assertSafeXml(workbookXml);
  assertSafeXml(relationshipsXml);
  const relationshipTargetById: Record<string, string> = {};

  for (const match of relationshipsXml.matchAll(
    /<Relationship\b[^>]*\/?\s*>/giu,
  )) {
    const identifier = attribute(match[0], 'Id');
    const target = attribute(match[0], 'Target');

    if (identifier !== undefined && target !== undefined) {
      relationshipTargetById[identifier] = target;
    }
  }

  const sheets = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/giu)].map(
    (match) => {
      const name = attribute(match[0], 'name');
      const relationshipId = attribute(match[0], 'r:id');

      if (name === undefined || relationshipId === undefined) {
        throw new ImportValidationError(
          'XLSX sheet metadata is incomplete',
          'INVALID_XLSX',
        );
      }

      const target = relationshipTargetById[relationshipId];

      if (target === undefined || target.includes('..')) {
        throw new ImportValidationError(
          'XLSX sheet relationship is unsafe or missing',
          'INVALID_XLSX',
        );
      }

      return {
        name: normalizeWhitespace(name),
        path: target.startsWith('/')
          ? target.slice(1)
          : `xl/${target.replace(/^\.\//u, '')}`,
      };
    },
  );

  assertWithinLimit(sheets.length, limits.maxSheets, 'Workbook sheet count');
  const sharedStringsXml =
    entriesByName['xl/sharedStrings.xml']?.toString('utf8');
  const sharedStrings =
    sharedStringsXml === undefined
      ? []
      : [
          ...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/giu),
        ].map((match) => extractXmlText(match[1] ?? ''));
  const numberFormats = parseNumberFormats(
    entriesByName['xl/styles.xml']?.toString('utf8'),
  );
  let totalRows = 0;
  let totalCells = 0;

  return sheets.map<PreparedSheet>((sheet) => {
    const worksheetXml = entriesByName[sheet.path]?.toString('utf8');

    if (worksheetXml === undefined) {
      throw new ImportValidationError(
        'XLSX references a missing worksheet',
        'INVALID_XLSX',
      );
    }

    const worksheetRows = parseWorksheetRows(
      worksheetXml,
      sharedStrings,
      numberFormats,
    );
    const headerRow = worksheetRows[0];

    if (headerRow === undefined) {
      throw new ImportValidationError(
        'Every XLSX sheet requires a header row',
        'INVALID_XLSX',
      );
    }

    const highestHeaderColumn = Math.max(
      -1,
      ...headerRow.values.map((value) => value.columnIndex),
    );
    const headers = Array.from(
      { length: highestHeaderColumn + 1 },
      (_, index) => {
        const header = headerRow.values.find(
          (value) => value.columnIndex === index,
        );

        if (header?.type === 'formula') {
          throw new ImportValidationError(
            'Formula headers are not accepted',
            'ACTIVE_CONTENT',
          );
        }

        return normalizeWhitespace(header?.display ?? '');
      },
    );

    assertHeaders(headers);
    const dataRows = worksheetRows.slice(1);
    totalRows += dataRows.length;
    totalCells +=
      headers.length +
      dataRows.reduce((count, row) => count + row.values.length, 0);
    assertWithinLimit(totalRows, limits.maxRows, 'Workbook row count');
    assertWithinLimit(totalCells, limits.maxCells, 'Workbook cell count');

    for (const row of [headerRow, ...dataRows]) {
      for (const value of row.values) {
        assertWithinLimit(
          Buffer.byteLength(value.original),
          limits.maxCellBytes,
          'Workbook cell bytes',
        );
      }
    }

    return {
      headers,
      name: sheet.name,
      rows: dataRows.map((row) => {
        const rowValues = Array.from(
          { length: headers.length },
          (_, columnIndex) => {
            return (
              row.values.find((value) => value.columnIndex === columnIndex) ?? {
                columnIndex,
                display: '',
                original: '',
                type: 'blank' as const,
              }
            );
          },
        );
        const [preparedRow] = buildRows(
          batchId,
          sheet.name,
          headers,
          [rowValues],
          row.rowNumber,
        );

        if (preparedRow === undefined) {
          throw new ImportValidationError(
            'Worksheet row could not be prepared',
            'INVALID_XLSX',
          );
        }

        return preparedRow;
      }),
    };
  });
};

export const prepareImport = async (
  options: PrepareImportOptions,
): Promise<PreparedDataset> => {
  const limits = options.limits ?? DEFAULT_IMPORT_LIMITS;

  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(options.batchId)) {
    throw new ImportValidationError(
      'Batch ID must be a stable lowercase identifier',
      'INVALID_BATCH_ID',
    );
  }

  const extension = extname(options.filePath).toLowerCase();

  if (extension !== '.csv' && extension !== '.xlsx') {
    throw new ImportValidationError(
      'Only approved CSV and XLSX files are accepted',
      'UNAPPROVED_EXTENSION',
    );
  }

  const fileStat = await lstat(options.filePath);

  if (!fileStat.isFile() || (fileStat.mode & 0o777) !== 0o600) {
    throw new ImportValidationError(
      'Source must be a regular file with mode 0600',
      'INSECURE_FILE_MODE',
    );
  }

  assertWithinLimit(fileStat.size, limits.maxBytes, 'Source bytes');
  const buffer = await readFile(options.filePath);
  const sourceFileHash = sha256(buffer);

  log(options.logger, 'prepare.started', {
    batchIdHash: sha256(options.batchId),
    format: extension.slice(1),
    sourceFileHash,
  });

  try {
    const format: PreparedDataset['format'] =
      extension === '.csv' ? 'csv' : 'xlsx';
    const sheets =
      format === 'csv'
        ? prepareCsv(buffer, options.batchId, limits)
        : prepareXlsx(buffer, options.batchId, limits);
    const withoutHash = {
      batchId: options.batchId,
      format,
      limits,
      schemaVersion: PREPARED_SCHEMA_VERSION,
      sheets,
      sourceFileHash,
    };
    const prepared: PreparedDataset = {
      ...withoutHash,
      datasetHash: sha256(canonicalJson(withoutHash)),
    };

    log(options.logger, 'prepare.completed', {
      batchIdHash: sha256(options.batchId),
      datasetHash: prepared.datasetHash,
      rows: prepared.sheets.reduce(
        (count, sheet) => count + sheet.rows.length,
        0,
      ),
      sheets: prepared.sheets.length,
      sourceFileHash,
    });

    return prepared;
  } catch (error) {
    log(options.logger, 'prepare.failed', {
      batchIdHash: sha256(options.batchId),
      code:
        error instanceof ImportValidationError
          ? error.code
          : 'UNEXPECTED_PREPARE_ERROR',
      sourceFileHash,
    });
    throw error;
  }
};

const normalizedHeader = (value: string): string =>
  normalizeWhitespace(value).toLocaleLowerCase('en');

const cellValue = (row: PreparedRow, aliases: string[]): string | undefined => {
  const aliasSet = new Set(aliases);
  const entry = Object.entries(row.cells).find(([header]) =>
    aliasSet.has(normalizedHeader(header)),
  );
  const value = entry?.[1].safeDisplayValue;

  return value === undefined || value.length === 0 ? undefined : value;
};

const normalizeIfPresent = (
  value: string | undefined,
  normalizer: (input: string) => string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  try {
    return normalizer(value);
  } catch {
    return undefined;
  }
};

const reviewInputForRow = (row: PreparedRow): NormalizedAgencyInput => {
  const normalizedName = normalizeIfPresent(
    cellValue(row, [
      'agency',
      'agency name',
      'company',
      'company name',
      'name',
    ]),
    normalizeName,
  );
  const normalizedEmail = normalizeIfPresent(
    cellValue(row, ['email', 'email address', 'primary email']),
    normalizeEmail,
  );
  const normalizedDomain = normalizeIfPresent(
    cellValue(row, ['domain', 'primary domain', 'website']),
    normalizeDomain,
  );
  const normalizedPhone = normalizeIfPresent(
    cellValue(row, ['mobile', 'phone', 'phone number']),
    normalizePhone,
  );
  const normalizedPostcode = normalizeIfPresent(
    cellValue(row, ['postal code', 'postcode', 'zip', 'zip code']),
    normalizePostcode,
  );

  return {
    ...(normalizedDomain === undefined ? {} : { normalizedDomain }),
    ...(normalizedEmail === undefined ? {} : { normalizedEmail }),
    ...(normalizedName === undefined ? {} : { normalizedName }),
    ...(normalizedPhone === undefined ? {} : { normalizedPhone }),
    ...(normalizedPostcode === undefined ? {} : { normalizedPostcode }),
  };
};

const validateCandidates = (value: unknown): ExistingAgencyCandidate[] => {
  if (!Array.isArray(value)) {
    throw new ImportValidationError(
      'Candidate artifact must be an array',
      'INVALID_CSV',
    );
  }

  const allowedKeys = [
    'id',
    'normalizedDomain',
    'normalizedEmail',
    'normalizedName',
    'normalizedPhone',
    'normalizedPostcode',
  ];

  return value.map((candidateValue) => {
    if (
      candidateValue === null ||
      typeof candidateValue !== 'object' ||
      Array.isArray(candidateValue)
    ) {
      throw new ImportValidationError(
        'Candidate entry must be an object',
        'INVALID_CSV',
      );
    }

    const candidate = candidateValue as Record<string, unknown>;

    if (
      Object.keys(candidate).some((key) => !allowedKeys.includes(key)) ||
      typeof candidate.id !== 'string' ||
      candidate.id.length === 0 ||
      Object.entries(candidate).some(
        ([key, entryValue]) =>
          key !== 'id' &&
          entryValue !== undefined &&
          typeof entryValue !== 'string',
      )
    ) {
      throw new ImportValidationError(
        'Candidate entry has invalid fields',
        'INVALID_CSV',
      );
    }

    return candidateValue as ExistingAgencyCandidate;
  });
};

export const createPreparedReviewArtifact = (
  preparedDataset: PreparedDataset,
  candidates: ExistingAgencyCandidate[],
): PreparedReviewArtifact => {
  const reviewRows = preparedDataset.sheets
    .flatMap((sheet) => sheet.rows)
    .map((row) => {
      const input = reviewInputForRow(row);

      return {
        input,
        match: matchAgencyCandidates(input, candidates),
        rowHash: row.rowHash,
        rowNumber: row.rowNumber,
        sheetName: row.sheetName,
      };
    });
  const withoutHash = {
    preparedDataset,
    reviewRows,
    schemaVersion: REVIEW_SCHEMA_VERSION,
  };

  return {
    ...withoutHash,
    artifactHash: hashCanonical(withoutHash),
  };
};

type PrepareCliOptions = CliIo & {
  argv: string[];
};

export const runPrepareImportCli = async (
  options: PrepareCliOptions,
): Promise<number> => {
  try {
    const argumentsByName = parseStrictCliArguments(
      options.argv,
      ['--batch-id', '--candidates', '--output', '--source'],
      ['--batch-id', '--output', '--source'],
    );
    const sourcePath = argumentsByName['--source']!;
    const outputPath = argumentsByName['--output']!;
    const candidatesPath = argumentsByName['--candidates'];

    await assertPathOutsideGit(sourcePath);
    await assertPathOutsideGit(outputPath);
    const candidates =
      candidatesPath === undefined
        ? []
        : validateCandidates(await readPrivateJson(candidatesPath));
    const logger: StructuredLogger = (event) =>
      options.writeStderr?.(canonicalJson(event));
    const preparedDataset = await prepareImport({
      batchId: argumentsByName['--batch-id']!,
      filePath: sourcePath,
      logger,
    });
    const artifact = createPreparedReviewArtifact(preparedDataset, candidates);

    await writePrivateJsonAtomic(outputPath, artifact);
    options.writeStdout?.(
      canonicalJson({
        artifactHash: artifact.artifactHash,
        event: 'prepare.completed',
        reviewRows: artifact.reviewRows.length,
      }),
    );

    return 0;
  } catch (error) {
    writeCliFailure(error, options.writeStderr);

    return 1;
  }
};

const isPrepareCliMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isPrepareCliMain) {
  process.exitCode = await runPrepareImportCli({
    argv: process.argv.slice(2),
    writeStderr: (line) => process.stderr.write(`${line}\n`),
    writeStdout: (line) => process.stdout.write(`${line}\n`),
  });
}
