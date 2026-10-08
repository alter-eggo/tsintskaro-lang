// Real PostgreSQL checks in a fresh, disposable schema. Never uses public tables.
require('reflect-metadata');
require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { Word } = require('../src/dictionary/entities/word.entity');
const {
  WordEditHistory,
} = require('../src/dictionary/entities/word-edit-history.entity');
const {
  WordTranslationHistory,
} = require('../src/dictionary/entities/word-translation-history.entity');
const { DictionaryService } = require('../src/dictionary/dictionary.service');
const { DictionaryEditor } = require('../src/dictionary/dictionary-editor');
const { renderSenses } = require('../src/dictionary/dictionary-content');

async function main() {
  const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env };
  if (!env.DATABASE_TEST_URL && !process.argv.includes('--isolated-schema'))
    throw new Error(
      'Provide DATABASE_TEST_URL or explicitly use --isolated-schema.',
    );
  const url = env.DATABASE_TEST_URL || env.DATABASE_URL;
  const ssl = env.DB_CERT ? { ca: env.DB_CERT } : undefined;
  const schema = `dictionary_check_${randomBytes(8).toString('hex')}`;
  const admin = new Client({
    connectionString: url,
    ssl,
    connectionTimeoutMillis: 8000,
  });
  let db;
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    db = new DataSource({
      type: 'postgres',
      url,
      ssl,
      schema,
      entities: [Word, WordEditHistory, WordTranslationHistory],
      synchronize: true,
      logging: false,
    });
    await db.initialize();
    const repo = db.getRepository(Word);
    const history = db.getRepository(WordEditHistory);
    const editor = new DictionaryEditor(repo);
    const dictionary = new DictionaryService(repo);
    const actor = {
      userId: 42,
      username: 'Elvardi',
      chatId: -987654,
      canRemoveEntry: true,
    };
    const seed = (word, translation, extra = {}) =>
      repo.save(repo.create({ word, translation, source: 'chat', ...extra }));
    const root = await seed(
      'авара',
      '1) бездельник; 2) лентяй; 3) лодырь; 4) тунеядец',
    );
    const source = await seed('авара дурмах', 'бездельничать');
    const move = {
      type: 'move_example',
      word: source.word,
      target: root.word,
      sense: 1,
    };
    await assert.rejects(
      editor.apply(move, { ...actor, username: 'participant' }),
    );
    await assert.rejects(
      editor.apply(move, { ...actor, canRemoveEntry: false }),
    );
    await assert.rejects(
      editor.apply({ ...move, target: 'не существует' }, actor),
    );
    await assert.rejects(editor.apply({ ...move, sense: 3.5 }, actor));
    assert.equal(
      (await repo.findOneByOrFail({ id: source.id })).status,
      'active',
    );
    const simultaneous = await Promise.all([
      editor.apply(move, { ...actor, messageId: 1 }),
      editor.apply(move, { ...actor, messageId: 1 }),
    ]);
    assert.deepEqual(simultaneous.map((x) => x.status).sort(), [
      'unchanged',
      'updated',
    ]);
    assert.equal(await history.count(), 1);
    const changed = await repo.findOneByOrFail({ id: root.id });
    assert.equal(
      changed.translation,
      '1) бездельник; авара дурмах — бездельничать; 2) лентяй; 3) лодырь; 4) тунеядец',
    );
    assert.equal(changed.partOfSpeech, null);
    assert.equal(
      (await repo.findOneByOrFail({ id: source.id })).relatedWordId,
      root.id,
    );
    assert.equal((await editor.apply(move, actor)).status, 'unchanged');

    await seed('аваралых', '1) безделье; 2) перерыв');
    await seed('аваралых этмах', 'бездельничать');
    await editor.apply(
      {
        type: 'move_example',
        word: 'аваралых этмах',
        target: 'аваралых',
        sense: 3,
        createSense: true,
        translation: 'заниматься ерундой',
      },
      actor,
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'аваралых' })).senses[2].translation,
      null,
    );
    await editor.apply(
      { type: 'set_sense', word: 'аваралых', sense: 3, translation: 'ерунда' },
      actor,
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'аваралых' })).senses[2].examples[0]
        .translation,
      'заниматься ерундой',
    );
    await editor.apply(
      {
        type: 'set_example',
        word: 'аваралых',
        sense: 3,
        phrase: 'аваралых этмах',
        translation: 'заниматься ерундой (пример)',
      },
      actor,
    );
    await assert.rejects(
      dictionary.replaceTranslation({
        word: 'аваралых',
        translation: 'новый текст',
        userId: 42,
        username: 'Elvardi',
      }),
    );
    await assert.rejects(
      dictionary.upsertWord({
        word: 'аваралых',
        translation: 'новый текст',
        addedBy: 'Elvardi',
      }),
    );

    // Force an audit failure: the example and source status must roll back together.
    await seed('неудачный перенос', 'пример');
    await admin.query(
      `ALTER TABLE "${schema}".word_edit_history ADD CONSTRAINT fail_move CHECK (operation <> 'move_example') NOT VALID`,
    );
    await assert.rejects(
      editor.apply(
        {
          type: 'move_example',
          word: 'неудачный перенос',
          target: 'авара',
          sense: 1,
        },
        actor,
      ),
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'неудачный перенос' })).status,
      'active',
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'авара' })).senses[0].examples.length,
      1,
    );
    await admin.query(
      `ALTER TABLE "${schema}".word_edit_history DROP CONSTRAINT fail_move`,
    );

    await seed('второй пример', 'второй');
    await seed('третий пример', 'третий');
    await Promise.all(
      ['второй пример', 'третий пример'].map((word) =>
        editor.apply(
          { type: 'move_example', word, target: 'авара', sense: 1 },
          actor,
        ),
      ),
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'авара' })).senses[0].examples.length,
      3,
    );
    dictionary.reload();
    assert.equal((await dictionary.findWord('авара дурмах')).word, 'авара');
    assert.equal(
      (await dictionary.findByTranslation('бездельничать'))[0].word,
      'авара',
    );
    assert(
      !(await dictionary.getEntries()).some((e) => e.word === 'авара дурмах'),
    );
    assert(
      (await dictionary.findRelevantForPrompt(['авара дурмах'])).some(
        (e) => e.word === 'авара',
      ),
    );

    const old = await seed('агхартмах', 'побелить');
    const correct = await seed('ахгартмах', 'побелить, осветлить');
    const merged = await dictionary.updateWord({
      oldWord: old.word,
      newWord: correct.word,
      updatedBy: 'Elvardi',
      userId: 42,
    });
    assert.equal(merged.status, 'merged');
    assert(merged.word.translation.includes('осветлить'));
    assert.equal((await dictionary.findWord('агхартмах')).word, 'ахгартмах');
    assert.equal((await repo.findOneByOrFail({ id: old.id })).status, 'merged');

    await seed('авария', 'дорожное происшествие');
    await dictionary.editRecord(
      {
        type: 'set_status',
        word: 'авария',
        status: 'deferred',
        reason: 'до решения о заимствованиях',
      },
      actor,
    );
    assert.equal(await dictionary.findWord('авария'), undefined);
    assert.equal((await dictionary.getDeferredRecords())[0].word, 'авария');
    await dictionary.editRecord(
      { type: 'set_status', word: 'авария', status: 'active' },
      actor,
    );
    assert.equal(
      (await dictionary.findWord('авария')).translation,
      'дорожное происшествие',
    );
    await dictionary.deleteWords(['авария']);
    assert.equal(
      (await repo.findOneByOrFail({ word: 'авария' })).status,
      'deleted',
    );
    await dictionary.editRecord(
      { type: 'set_status', word: 'авария', status: 'active' },
      actor,
    );
    await dictionary.replaceTranslation({
      word: 'авария',
      translation: 'происшествие',
      userId: 42,
      username: 'Elvardi',
      chatId: -987654,
      threadId: null,
      messageId: 2,
    });
    await dictionary.upsertWord({
      word: 'авария',
      translation: 'случай',
      addedBy: 'Elvardi',
    });
    await dictionary.updateWord({
      oldWord: 'авария',
      newWord: 'аварийа',
      translation: 'случай, происшествие',
      updatedBy: 'Elvardi',
    });
    assert.equal(
      (await dictionary.findWord('аварийа')).translation,
      'случай, происшествие',
    );
    await seed('ахгзû гхырых', 'о человеке, который мало ест');
    await dictionary.editRecord(
      {
        type: 'set_kind',
        word: 'ахгзû гхырых',
        kind: 'idiom',
        literalTranslation: 'рот сломан',
      },
      actor,
    );
    assert.equal(
      (await dictionary.findByTranslation('рот сломан'))[0].word,
      'ахгзû гхырых',
    );
    await seed('ахгыран', '1) болеющий; 2) больной');
    await dictionary.editRecord(
      {
        type: 'set_sense_pos',
        word: 'ахгыран',
        sense: 1,
        partOfSpeech: 'причастие',
      },
      actor,
    );
    await dictionary.editRecord(
      {
        type: 'set_sense_pos',
        word: 'ахгыран',
        sense: 2,
        partOfSpeech: 'прилагательное',
      },
      actor,
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'ахгыран' })).senses[1].partOfSpeech,
      'прилагательное',
    );
    // Execute the website's actual DB functions against this same disposable schema.
    const websiteFile = path.resolve(
      __dirname,
      '../../tsintskaro-website/lib/db/words.ts',
    );
    if (fs.existsSync(websiteFile)) {
      const oldUrl = process.env.DATABASE_URL;
      const oldCert = process.env.DB_CERT;
      const websiteUrl = new URL(url);
      websiteUrl.searchParams.set('options', `-c search_path=${schema}`);
      process.env.DATABASE_URL = websiteUrl.toString();
      if (env.DB_CERT) process.env.DB_CERT = env.DB_CERT;
      try {
        const website = new Module(websiteFile);
        const localRequire = Module.createRequire(websiteFile);
        website.require = (id) =>
          id === 'server-only' ? {} : localRequire(id);
        website._compile(
          ts.transpileModule(fs.readFileSync(websiteFile, 'utf8'), {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ES2021,
            },
          }).outputText,
          websiteFile,
        );
        const entries = await website.exports.getAllWords();
        assert(!entries.some((e) => e.word === 'авара дурмах'));
        assert(
          entries
            .find((e) => e.word === 'авара')
            .aliases.includes('авара дурмах'),
        );
        await assert.rejects(
          website.exports.addWord({ word: 'авара', translation: 'overwrite' }),
          /значения и примеры/,
        );
        await assert.rejects(
          website.exports.addWord({
            word: 'авара дурмах',
            translation: 'overwrite',
          }),
          /перенесена/,
        );
        await seed('отложенный тест', 'исходный', { status: 'deferred' });
        await assert.rejects(
          website.exports.addWord({
            word: 'отложенный тест',
            translation: 'overwrite',
          }),
          /отложена/,
        );
        assert(
          (
            await website.exports.addWord({
              word: 'новое тестовое слово',
              translation: 'проверка',
            })
          ).created,
        );
        assert.equal(
          (await repo.findOneByOrFail({ word: 'авара' })).senses[0].examples
            .length,
          3,
        );
      } finally {
        await globalThis.tsintskaroWordsPool?.end();
        delete globalThis.tsintskaroWordsPool;
        if (oldUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = oldUrl;
        if (oldCert === undefined) delete process.env.DB_CERT;
        else process.env.DB_CERT = oldCert;
      }
      console.log(
        'PASS website: active-only query, aliases, new-word insert, structured/moved/deferred overwrite protection.',
      );
    }
    console.log(
      'PASS PostgreSQL: atomic transfer, rollback, concurrent edits, replay, permissions, empty sense, example editing, lookup, merge, defer/restore, legacy edits.',
    );
    if (process.argv.includes('--preview')) {
      const avara = await repo.findOneByOrFail({ word: 'авара' });
      avara.senses[0].examples = avara.senses[0].examples.filter(
        (e) => e.sourceWordId === source.id,
      );
      avara.translation = renderSenses(avara.senses);
      await repo.save(avara);
      const avaralyh = await repo.findOneByOrFail({ word: 'аваралых' });
      avaralyh.senses[2].translation = null;
      avaralyh.senses[2].examples[0].translation = 'заниматься ерундой';
      avaralyh.translation = renderSenses(avaralyh.senses);
      await repo.save(avaralyh);
      const previewUrl = new URL(url);
      previewUrl.searchParams.set('options', `-c search_path=${schema}`);
      const child = spawn('pnpm', ['exec', 'next', 'dev', '--port', '3007'], {
        cwd: path.resolve(__dirname, '../../tsintskaro-website'),
        env: {
          ...process.env,
          DATABASE_URL: previewUrl.toString(),
          ...(env.DB_CERT ? { DB_CERT: env.DB_CERT } : {}),
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      console.log(
        'PREVIEW uses disposable records only: http://localhost:3007/language. Stop this process to remove the test schema.',
      );
      await new Promise((resolve, reject) => {
        const stop = () => child.kill('SIGTERM');
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        child.once('error', reject);
        child.once('exit', () => {
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
          resolve();
        });
      });
    }
  } finally {
    if (db?.isInitialized) await db.destroy();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}
main().catch((error) => {
  console.error(
    'Dictionary integration check failed:',
    error.code === 'ERR_ASSERTION' ? error.stack : error.code || error.message,
  );
  process.exitCode = 1;
});
