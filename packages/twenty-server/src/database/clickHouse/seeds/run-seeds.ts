/* oxlint-disable no-console */
import { createClient, ClickHouseLogLevel } from '@clickhouse/client';
import { config } from 'dotenv';

import { resolveClickHouseUrl } from 'src/database/clickHouse/resolve-clickhouse-url';

import {
  objectEventFixtures,
  usageEventFixtures,
  workspaceEventFixtures,
} from './fixtures';

config({
  path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  override: false,
});

const client = createClient({
  url: resolveClickHouseUrl(process.env, 'ingest'),
  log: { level: ClickHouseLogLevel.OFF },
});

async function seedEvents() {
  try {
    console.log(`Seeding ${workspaceEventFixtures.length} workspace events...`);

    await client.insert({
      table: 'workspaceEvent',
      values: workspaceEventFixtures,
      format: 'JSONEachRow',
    });

    console.log(`Seeding ${objectEventFixtures.length} object events...`);

    await client.insert({
      table: 'objectEvent',
      values: objectEventFixtures,
      format: 'JSONEachRow',
    });

    console.log(`Seeding ${usageEventFixtures.length} usage events...`);

    await client.insert({
      table: 'usageEvent',
      values: usageEventFixtures,
      format: 'JSONEachRow',
    });

    console.log('All events seeded successfully');
  } finally {
    await client.close();
  }
}

seedEvents().catch(() => {
  console.error('ClickHouse seeding failed');
  process.exit(1);
});
