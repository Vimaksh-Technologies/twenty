import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { matchAgencyCandidates } from '../candidate-matcher.js';
import {
  normalizeDomain,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizePostcode,
  normalizeWhitespace,
} from '../normalizers.js';
import {
  DEFAULT_IMPORT_LIMITS,
  ImportValidationError,
  prepareImport,
  runPrepareImportCli,
} from '../prepare-import.js';
import type { StructuredLogEvent } from '../types.js';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paryatech-import-'));

  temporaryDirectories.push(directory);

  return directory;
};

const writeProtectedFile = async (
  name: string,
  contents: string | Buffer,
  mode = 0o600,
) => {
  const directory = await createTemporaryDirectory();
  const filePath = join(directory, name);

  await writeFile(filePath, contents, { mode });
  await chmod(filePath, mode);

  return filePath;
};

const createStoredZip = (entries: Record<string, string | Buffer>) => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, sourceContents] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const contents = Buffer.isBuffer(sourceContents)
      ? sourceContents
      : Buffer.from(sourceContents);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(contents.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, contents);

    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(contents.length, 20);
    centralHeader.writeUInt32LE(contents.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + contents.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

const createWorkbook = (extraEntries: Record<string, string | Buffer> = {}) =>
  createStoredZip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Agencies" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0000000000"/><numFmt numFmtId="165" formatCode="000000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Phone</t></is></c><c r="B1" t="inlineStr"><is><t>Postcode</t></is></c></row><row r="2"><c r="A2" s="1"><v>123456789</v></c><c r="B2" s="2"><v>12345</v></c></row></sheetData></worksheet>',
    ...extraEntries,
  });

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('prepareImport', () => {
  it('preserves numeric phone and postcode display values and safe provenance', async () => {
    const filePath = await writeProtectedFile(
      'agencies.csv',
      'Name,Email,Domain,Phone,Postcode\n  Café   Voyages  ,Owner@EXAMPLE.COM,HTTPS://WWW.Example.COM/path,0123456789,012345\n',
    );

    const prepared = await prepareImport({
      batchId: 'batch-2026-09-04',
      filePath,
    });
    const row = prepared.sheets[0]?.rows[0];

    expect(row?.rowNumber).toBe(2);
    expect(row?.cells.Phone).toMatchObject({
      originalType: 'string',
      safeDisplayValue: '0123456789',
    });
    expect(row?.cells.Postcode).toMatchObject({
      originalType: 'string',
      safeDisplayValue: '012345',
    });
    expect(row?.cells.Phone?.originalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.sourceFileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.datasetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses XLSX number formats to retain leading zeros without changing numeric provenance', async () => {
    const filePath = await writeProtectedFile(
      'agencies.xlsx',
      createWorkbook(),
    );

    const prepared = await prepareImport({ batchId: 'batch-xlsx', filePath });
    const row = prepared.sheets[0]?.rows[0];

    expect(row?.cells.Phone).toMatchObject({
      originalType: 'number',
      safeDisplayValue: '0123456789',
    });
    expect(row?.cells.Postcode).toMatchObject({
      originalType: 'number',
      safeDisplayValue: '012345',
    });
  });

  it('neutralizes CSV formulas and never emits raw cell values to structured logs', async () => {
    const rawEmail = 'private.person@example.invalid';
    const rawFormula = '=HYPERLINK("https://attacker.invalid","click")';
    const filePath = await writeProtectedFile(
      'agencies.csv',
      `Name,Email,Comment\nPrivate Person,${rawEmail},"${rawFormula.replaceAll('"', '""')}"\n`,
    );
    const events: StructuredLogEvent[] = [];

    const prepared = await prepareImport({
      batchId: 'formula-batch',
      filePath,
      logger: (event) => events.push(event),
    });
    const formulaCell = prepared.sheets[0]?.rows[0]?.cells.Comment;

    expect(formulaCell?.originalType).toBe('formula');
    expect(formulaCell?.safeDisplayValue).toBe("'[FORMULA]");
    expect(JSON.stringify(events)).not.toContain(rawEmail);
    expect(JSON.stringify(events)).not.toContain(rawFormula);
  });

  it.each([
    [
      'macro workbook',
      { 'xl/vbaProject.bin': Buffer.from('macro') },
      'ACTIVE_CONTENT',
    ],
    [
      'external-link workbook',
      { 'xl/externalLinks/externalLink1.xml': '<externalLink/>' },
      'EXTERNAL_LINK',
    ],
  ])('rejects %s', async (_name, entries, expectedCode) => {
    const filePath = await writeProtectedFile(
      'agencies.xlsx',
      createWorkbook(entries),
    );

    await expect(
      prepareImport({ batchId: 'unsafe-xlsx', filePath }),
    ).rejects.toMatchObject({ code: expectedCode });
  });

  it('rejects unapproved extensions, mismatched signatures, non-0600 mode, and oversize input', async () => {
    const textFile = await writeProtectedFile('agencies.txt', 'Name\nAgency\n');
    const fakeWorkbook = await writeProtectedFile(
      'agencies.xlsx',
      'not a zip workbook',
    );
    const exposedFile = await writeProtectedFile(
      'agencies.csv',
      'Name\nAgency\n',
      0o640,
    );
    const readOnlyFile = await writeProtectedFile(
      'readonly.csv',
      'Name\nAgency\n',
      0o400,
    );
    const oversizeFile = await writeProtectedFile(
      'oversize.csv',
      'Name\nAgency\n',
    );

    await expect(
      prepareImport({ batchId: 'bad-extension', filePath: textFile }),
    ).rejects.toBeInstanceOf(ImportValidationError);
    await expect(
      prepareImport({ batchId: 'bad-signature', filePath: fakeWorkbook }),
    ).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(
      prepareImport({ batchId: 'bad-mode', filePath: exposedFile }),
    ).rejects.toMatchObject({ code: 'INSECURE_FILE_MODE' });
    await expect(
      prepareImport({ batchId: 'readonly-mode', filePath: readOnlyFile }),
    ).rejects.toMatchObject({ code: 'INSECURE_FILE_MODE' });
    await expect(
      prepareImport({
        batchId: 'too-large',
        filePath: oversizeFile,
        limits: { ...DEFAULT_IMPORT_LIMITS, maxBytes: 4 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('enforces row, cell, and cell-byte limits', async () => {
    const filePath = await writeProtectedFile(
      'agencies.csv',
      'Name,Email\nOne,one@example.invalid\nTwo,two@example.invalid\n',
    );

    await expect(
      prepareImport({
        batchId: 'row-limit',
        filePath,
        limits: { ...DEFAULT_IMPORT_LIMITS, maxRows: 1 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(
      prepareImport({
        batchId: 'cell-limit',
        filePath,
        limits: { ...DEFAULT_IMPORT_LIMITS, maxCells: 2 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    await expect(
      prepareImport({
        batchId: 'cell-byte-limit',
        filePath,
        limits: { ...DEFAULT_IMPORT_LIMITS, maxCellBytes: 3 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('produces the same output hash for the same bytes, batch, and limits', async () => {
    const filePath = await writeProtectedFile(
      'agencies.csv',
      'Name,Domain\nStable Agency,stable.invalid\n',
    );

    const first = await prepareImport({ batchId: 'stable-batch', filePath });
    const second = await prepareImport({ batchId: 'stable-batch', filePath });

    expect(second).toEqual(first);
    expect(second.datasetHash).toBe(first.datasetHash);
  });
});

describe('normalizers', () => {
  it('normalizes Unicode, whitespace, email, domain, phone, and postcode without guessing', () => {
    expect(normalizeWhitespace('  Cafe\u0301   Voyages  ')).toBe(
      'Café Voyages',
    );
    expect(normalizeName('  Cafe\u0301   Voyages  ')).toBe('café voyages');
    expect(normalizeEmail(' Owner@BÜCHER.Example ')).toBe(
      'owner@xn--bcher-kva.example',
    );
    expect(normalizeDomain('HTTPS://WWW.BÜCHER.Example/path?q=1')).toBe(
      'xn--bcher-kva.example',
    );
    expect(normalizePhone(' 0123 456 789 ')).toBe('0123456789');
    expect(normalizePhone('+91 (987) 654-3210')).toBe('+919876543210');
    expect(normalizePostcode(' 012 345 ')).toBe('012345');
  });
});

describe('matchAgencyCandidates', () => {
  const input = {
    normalizedDomain: 'agency.invalid',
    normalizedEmail: 'owner@agency.invalid',
    normalizedName: 'stable agency',
    normalizedPhone: '0123456789',
    normalizedPostcode: '012345',
  };

  it('returns deterministic multi-signal candidates without choosing or merging one', () => {
    const candidates = [
      {
        id: 'agency-b',
        normalizedDomain: 'agency.invalid',
        normalizedName: 'stable agency',
        normalizedPhone: '9999999999',
      },
      {
        id: 'agency-a',
        normalizedEmail: 'owner@agency.invalid',
        normalizedName: 'stable agency',
        normalizedPhone: '0123456789',
        normalizedPostcode: '012345',
      },
    ];

    const first = matchAgencyCandidates(input, candidates);
    const second = matchAgencyCandidates(input, [...candidates].reverse());

    expect(first).toEqual(second);
    expect(first.candidates[0]).toMatchObject({
      candidateId: 'agency-a',
      signals: ['email', 'name', 'phone', 'postcode'],
    });
    expect(first.requiredDecision).toBe(true);
    expect(first).not.toHaveProperty('selectedCandidateId');
  });

  it('marks close candidates ambiguous and still never auto-merges', () => {
    const result = matchAgencyCandidates(input, [
      {
        id: 'agency-a',
        normalizedDomain: 'agency.invalid',
        normalizedName: 'stable agency',
      },
      {
        id: 'agency-b',
        normalizedEmail: 'owner@agency.invalid',
        normalizedName: 'stable agency',
      },
    ]);

    expect(result.status).toBe('ambiguous');
    expect(result.requiredDecision).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });
});

describe('prepare import CLI', () => {
  it('writes a deterministic 0600 review artifact with candidate evidence', async () => {
    const sourcePath = await writeProtectedFile(
      'agencies.csv',
      'Agency Name,Email,Phone,Postcode\nÄgency One,OWNER@EXAMPLE.INVALID,0123456789,012345\n',
    );
    const candidatesPath = await writeProtectedFile(
      'candidates.json',
      `${JSON.stringify([
        {
          id: 'candidate-one',
          normalizedEmail: 'owner@example.invalid',
          normalizedName: 'ägency one',
          normalizedPhone: '0123456789',
          normalizedPostcode: '012345',
        },
      ])}\n`,
    );
    const outputPath = join(
      await createTemporaryDirectory(),
      'prepared-review.json',
    );
    const stderr: string[] = [];

    const exitCode = await runPrepareImportCli({
      argv: [
        '--source',
        sourcePath,
        '--batch-id',
        'batch-cli',
        '--candidates',
        candidatesPath,
        '--output',
        outputPath,
      ],
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => undefined,
    });
    const artifact = JSON.parse(await readFile(outputPath, 'utf8')) as {
      artifactHash: string;
      reviewRows: Array<{
        match: { candidates: Array<{ candidateId: string }> };
      }>;
      schemaVersion: string;
    };

    expect(exitCode).toBe(0);
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(artifact.schemaVersion).toBe('paryatech-import-review/v1');
    expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.reviewRows[0]?.match.candidates[0]?.candidateId).toBe(
      'candidate-one',
    );
    expect(JSON.stringify(stderr)).not.toContain('OWNER@EXAMPLE.INVALID');
  });

  it('fails closed on unknown arguments and paths inside Git', async () => {
    const stderr: string[] = [];
    const exitCode = await runPrepareImportCli({
      argv: [
        '--source',
        join(process.cwd(), 'package.json'),
        '--batch-id',
        'batch-cli',
        '--output',
        join(process.cwd(), 'review.json'),
        '--unknown',
        'value',
      ],
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => undefined,
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('INVALID_CLI');
    expect(stderr.join('\n')).not.toContain(process.cwd());
  });

  it('rejects otherwise valid private source and output paths inside Git', async () => {
    const sourcePath = join(process.cwd(), '.cli-source.csv');
    const outputPath = join(process.cwd(), '.cli-review.json');
    const stderr: string[] = [];

    await writeFile(sourcePath, 'Agency Name\nPrivate Agency\n', {
      mode: 0o600,
    });
    await chmod(sourcePath, 0o600);

    try {
      const exitCode = await runPrepareImportCli({
        argv: [
          '--source',
          sourcePath,
          '--batch-id',
          'batch-cli',
          '--output',
          outputPath,
        ],
        writeStderr: (line) => stderr.push(line),
        writeStdout: () => undefined,
      });

      expect(exitCode).toBe(1);
      expect(stderr.join('\n')).toContain('PATH_IN_GIT');
    } finally {
      await rm(sourcePath, { force: true });
      await rm(outputPath, { force: true });
    }
  });
});
