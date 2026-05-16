#!/usr/bin/env ts-node

/**
 * One-time seed script: pulls both Google Sheets and inserts entries into the `word` table.
 * Idempotent — re-runs skip rows whose `word` already exists.
 *
 * Usage:
 *   pnpm ts-node scripts/seed-words.ts            # actually inserts
 *   pnpm ts-node scripts/seed-words.ts --dry-run  # fetch + connect, no inserts
 *
 * Requires DATABASE_URL env var.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { fetchAllSheetsEntries } from '../src/dictionary/sheets-parser';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  if (dryRun) {
    console.log('=== DRY RUN — nothing will be written to DB ===\n');
  }

  console.log('Fetching entries from Google Sheets...');
  const entries = await fetchAllSheetsEntries();
  console.log(`Fetched ${entries.length} entries total (merged + sorted).`);

  const bySource = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] || 0) + 1;
    return acc;
  }, {});
  console.log(`  By source: ${JSON.stringify(bySource)}`);

  console.log(`\nFirst 5 entries:`);
  for (const e of entries.slice(0, 5)) {
    const pos = e.partOfSpeech ? ` (${e.partOfSpeech})` : '';
    console.log(`  • ${e.word} — ${e.translation}${pos} [${e.source}]`);
  }
  console.log(`\nLast 5 entries:`);
  for (const e of entries.slice(-5)) {
    const pos = e.partOfSpeech ? ` (${e.partOfSpeech})` : '';
    console.log(`  • ${e.word} — ${e.translation}${pos} [${e.source}]`);
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [Word],
    synchronize: !dryRun,
    logging: false,
  });

  await dataSource.initialize();
  console.log('\nConnected to database.');

  const repo = dataSource.getRepository(Word);

  let existingCount = 0;
  try {
    existingCount = await repo.count();
    console.log(`Current 'word' table has ${existingCount} rows.`);
  } catch {
    console.log(`'word' table does not exist yet (would be created on real run).`);
  }

  if (dryRun) {
    console.log('\n=== DRY RUN complete. No data was inserted. ===');
    await dataSource.destroy();
    return;
  }

  let inserted = 0;
  let skipped = 0;
  const batchSize = 200;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize).map((e) => ({
      word: e.word.toLowerCase().trim(),
      translation: e.translation,
      partOfSpeech: e.partOfSpeech ?? null,
      comments: e.comments ?? null,
      source: e.source,
      addedBy: null,
    }));

    const result = await repo
      .createQueryBuilder()
      .insert()
      .into(Word)
      .values(batch)
      .orIgnore()
      .execute();

    const affected = result.identifiers.filter((id) => id && id.id != null).length;
    inserted += affected;
    skipped += batch.length - affected;
    console.log(`Batch ${Math.floor(i / batchSize) + 1}: +${affected} inserted, ${batch.length - affected} skipped`);
  }

  console.log(`\nDone. Inserted: ${inserted}, skipped (already existed): ${skipped}`);

  const total = await repo.count();
  console.log(`Total rows in 'word' table: ${total}`);

  await dataSource.destroy();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
