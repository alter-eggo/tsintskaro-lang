// Dry run by default. --apply requires --backup-dir and writes only these two
// known corrupted records, after locking and checking their exact contents.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { Client } = require('pg');

const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env };
const apply = process.argv.includes('--apply');
const backupIndex = process.argv.indexOf('--backup-dir');
const backupDir = backupIndex >= 0 ? process.argv[backupIndex + 1] : null;
const repairs = [
  {
    id: 5039,
    word: 'аванс',
    before: 'удалить; аванс ( часть заработка, выдаваемое вперёд)',
    beforePos: 'сущ.',
    translation: 'аванс ( часть заработка, выдаваемое вперёд)',
    partOfSpeech: 'сущ.',
  },
  {
    id: 5087,
    word: 'бêй',
    before: 'аванс (часть заработка, выдаваемая вперёд), добавить в раздел Часть речи словаря - существительное',
    beforePos: null,
    translation: 'аванс (часть заработка, выдаваемая вперёд)',
    partOfSpeech: 'существительное',
  },
];

async function main() {
  if (apply && !backupDir) throw new Error('--apply requires --backup-dir');
  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DB_CERT ? { ca: env.DB_CERT } : undefined,
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000,
  });
  let backupPath;
  try {
    await client.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    const { rows } = await client.query(
      'SELECT * FROM word WHERE id = ANY($1::int[]) ORDER BY id' + (apply ? ' FOR UPDATE' : ''),
      [repairs.map((repair) => repair.id)],
    );
    const pending = [];
    for (const repair of repairs) {
      const row = rows.find((item) => item.id === repair.id);
      if (!row || row.word !== repair.word) throw new Error(`Unexpected word at id ${repair.id}`);
      if (row.translation === repair.translation && row.partOfSpeech === repair.partOfSpeech) continue;
      if (row.translation !== repair.before || row.partOfSpeech !== repair.beforePos) {
        throw new Error(`Record ${repair.id} changed since inspection; refusing to overwrite`);
      }
      pending.push(repair);
    }
    console.log(JSON.stringify({ apply, changes: pending }, null, 2));
    if (apply && pending.length) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      backupPath = path.join(backupDir, `dictionary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(backupPath, JSON.stringify({
        status: 'prepared', reason: 'Owner-approved repair of dictionary command parsing incident',
        before: rows, planned: pending,
      }, null, 2), { mode: 0o600, flag: 'wx' });
      for (const repair of pending) {
        const updated = await client.query(
          'UPDATE word SET translation = $1, "partOfSpeech" = $2, "updatedAt" = NOW() WHERE id = $3',
          [repair.translation, repair.partOfSpeech, repair.id],
        );
        if (updated.rowCount !== 1) throw new Error(`Update failed for ${repair.id}`);
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'committed', updated: pending.length, backupPath }));
    } else {
      await client.query('ROLLBACK');
      console.log(pending.length ? 'Dry run; database unchanged.' : 'Already repaired; database unchanged.');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Do not print connection details from driver errors.
    console.error(error.code ? `Database error: ${error.code}` : error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
