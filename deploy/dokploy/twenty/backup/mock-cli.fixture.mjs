import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

const [tool, ...args] = process.argv.slice(2);

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const resolveLocation = (location) => {
  const remoteMatch = location.match(/^(primary|backup):([^/]+)(?:\/(.*))?$/);

  if (!remoteMatch) {
    return location;
  }

  const [, remote, bucket, key = ''] = remoteMatch;
  const root =
    remote === 'primary'
      ? process.env.MOCK_PRIMARY_REMOTE
      : process.env.MOCK_BACKUP_REMOTE;

  return join(root, bucket, key);
};

const listFiles = (root) => {
  if (!existsSync(root)) {
    return [];
  }

  if (!statSync(root).isDirectory()) {
    return [root];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);

    return entry.isDirectory() ? listFiles(path) : [path];
  });
};

const sha256 = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const copyFile = (source, destination, immutable) => {
  if (immutable && existsSync(destination)) {
    fail(`immutable destination exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination);
};

const copyTree = (source, destination, immutable) => {
  for (const sourceFile of listFiles(source)) {
    const destinationFile = join(destination, relative(source, sourceFile));
    copyFile(sourceFile, destinationFile, immutable);
  }
};

const maybeFailRclone = () => {
  const match = process.env.MOCK_RCLONE_FAIL_MATCH;

  if (match && args.join(' ').includes(match)) {
    fail(`forced rclone failure for ${match}`);
  }
};

switch (tool) {
  case 'stat':
    process.stdout.write('0:0:600\n');
    break;
  case 'psql': {
    const invocation = args.join(' ');

    if (invocation.includes('SELECT current_database()')) {
      process.stdout.write('twenty_restore_validation\n');
    } else if (invocation.includes('SELECT count(*)')) {
      process.stdout.write('0\n');
    } else if (invocation.includes('concat_ws')) {
      process.stdout.write(`${process.env.BACKUP_PG_DATABASE_USER}|0|0|on\n`);
    }
    break;
  }
  case 'pg_dump': {
    const fileArgument = args.find((argument) =>
      argument.startsWith('--file='),
    );

    if (!fileArgument) {
      fail('pg_dump output file missing');
    }

    const outputPath = fileArgument.slice('--file='.length);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, 'deterministic-postgres-backup');
    break;
  }
  case 'pg_restore':
    writeFileSync(process.env.MOCK_PG_RESTORE_MARKER, args.join(' '));
    break;
  case 'curl': {
    const url = args.at(-1);
    writeFileSync(process.env.MOCK_HEARTBEAT_LOG, `${url}\n`, { flag: 'a' });

    if (url === process.env.MOCK_CURL_FAIL_URL) {
      fail('forced heartbeat failure');
    }
    break;
  }
  case 'date':
    process.stdout.write(
      `${process.env.MOCK_FIXED_TIMESTAMP ?? '2026-09-04T12-34-56Z'}\n`,
    );
    break;
  case 'clickhouse':
    fail('ClickHouse must not run in core-only mode');
    break;
  case 'rclone': {
    maybeFailRclone();
    const [command] = args;

    if (command === 'size') {
      const root = resolveLocation(args[1]);
      const files = listFiles(root);
      const bytes = files.reduce((sum, path) => sum + statSync(path).size, 0);
      process.stdout.write(JSON.stringify({ count: files.length, bytes }));
      break;
    }

    if (command === 'hashsum') {
      const outputIndex = args.indexOf('--output-file');
      const source = resolveLocation(args[3]);
      const output = args[outputIndex + 1];
      const lines = listFiles(source)
        .map(
          (path) =>
            `${sha256(path)}  ${relative(source, path).split(sep).join('/')}\n`,
        )
        .join('');
      writeFileSync(output, lines);
      break;
    }

    if (command === 'copyto') {
      const immutable = args.includes('--immutable');
      const locations = args
        .slice(1)
        .filter((argument) => argument !== '--immutable');
      const [sourceLocation, destinationLocation] = locations;
      const source = resolveLocation(sourceLocation);
      const destination = resolveLocation(destinationLocation);
      copyFile(source, destination, immutable);

      const tamperMatch = process.env.MOCK_RCLONE_TAMPER_DOWNLOAD_MATCH;
      if (
        tamperMatch &&
        sourceLocation.startsWith('backup:') &&
        sourceLocation.includes(tamperMatch)
      ) {
        writeFileSync(destination, '{"tampered":true}\n');
      }
      break;
    }

    if (command === 'copy') {
      const immutable = args.includes('--immutable');
      const locations = args
        .slice(1)
        .filter((argument) => argument !== '--immutable');
      const [sourceLocation, destinationLocation] = locations;
      copyTree(
        resolveLocation(sourceLocation),
        resolveLocation(destinationLocation),
        immutable,
      );
      break;
    }

    if (command === 'check') {
      const locations = args
        .slice(1)
        .filter((argument) => !argument.startsWith('--'));
      const [sourceLocation, destinationLocation] = locations;
      const source = resolveLocation(sourceLocation);
      const destination = resolveLocation(destinationLocation);
      const sourceFiles = listFiles(source);
      const destinationFiles = listFiles(destination);

      if (sourceFiles.length !== destinationFiles.length) {
        fail('rclone check count mismatch');
      }

      for (const sourceFile of sourceFiles) {
        const destinationFile = join(destination, relative(source, sourceFile));
        if (
          !existsSync(destinationFile) ||
          sha256(sourceFile) !== sha256(destinationFile)
        ) {
          fail(`rclone check mismatch: ${basename(sourceFile)}`);
        }
      }
      break;
    }

    fail(`unsupported rclone command: ${command}`);
    break;
  }
  default:
    fail(`unsupported mock tool: ${tool}`);
}
