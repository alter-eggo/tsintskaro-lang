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
const { TelegramUpdate } = require('../src/telegram/telegram.update');
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
const { actionWords } = require('../src/dictionary/dictionary-actions');
const {
  DictionaryRequest,
} = require('../src/telegram/entities/dictionary-request.entity');
const {
  DictionaryRequestService,
  requestItems,
  requestText,
} = require('../src/telegram/dictionary-request.service');
const {
  WordReviewBatch,
} = require('../src/word-review/entities/word-review-batch.entity');
const {
  WordReviewItem,
} = require('../src/word-review/entities/word-review-item.entity');

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
      entities: [
        Word,
        WordEditHistory,
        WordTranslationHistory,
        DictionaryRequest,
        WordReviewBatch,
        WordReviewItem,
      ],
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

    await seed('проверка вариантов', '1) безделье; 2) перерыв');
    const numberedVariant = {
      type: 'set_sense',
      word: 'проверка вариантов',
      sense: 3,
      translation: 'ерунда',
      createSense: true,
    };
    await dictionary.editRecord(numberedVariant, { ...actor, messageId: 100 });
    const ordered = await repo.findOneByOrFail({ word: 'проверка вариантов' });
    assert.equal(ordered.translation, '1) безделье; 2) перерыв; 3) ерунда');
    assert.deepEqual(
      ordered.senses.map((s) => s.translation),
      ['безделье', 'перерыв', 'ерунда'],
    );
    await assert.rejects(
      editor.apply({ ...numberedVariant, sense: 5 }, actor),
      /номера не пропускаются/,
    );
    await assert.rejects(
      editor.apply({ ...numberedVariant, sense: 1 }, actor),
      /уже заполнено/,
    );
    await dictionary.editRecord(numberedVariant, { ...actor, messageId: 100 });
    assert.equal(
      (await repo.findOneByOrFail({ id: ordered.id })).translation,
      ordered.translation,
    );

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
    // Model-generated plans execute atomically against the versions actually read.
    const planRoot = await seed('план основа', 'значение');
    const planA = await seed('план пример а', 'перевод а');
    const planB = await seed('план пример б', 'перевод б');
    const operations = [
      {
        type: 'move_example',
        word: planA.word,
        target: planRoot.word,
        sense: 1,
      },
      {
        type: 'move_example',
        word: planB.word,
        target: planRoot.word,
        sense: 1,
        translation: 'уточнённый перевод б',
      },
    ];
    const snapshots = await dictionary.inspectRecords(actionWords(operations));
    const priorHistory = await history.count();
    await assert.rejects(
      dictionary.applyActions(
        [operations[0], { ...operations[1], sense: 99 }],
        { ...actor, messageId: 2001 },
        snapshots,
      ),
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: planA.id })).status,
      'active',
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: planRoot.id })).senses,
      null,
    );
    assert.equal(await history.count(), priorHistory);
    await assert.rejects(
      dictionary.applyActions(
        operations,
        { ...actor, canRemoveEntry: false },
        snapshots,
      ),
    );
    await assert.rejects(
      dictionary.applyActions(
        operations,
        { ...actor, username: 'participant' },
        snapshots,
      ),
    );
    await assert.rejects(
      dictionary.applyActions(operations, actor, []),
      /не проверена/,
    );
    await dictionary.applyActions(
      operations,
      { ...actor, messageId: 2001 },
      snapshots,
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: planRoot.id })).senses[0].examples
        .length,
      2,
    );
    assert.equal((await dictionary.findWord(planA.word)).word, planRoot.word);
    assert.equal((await dictionary.findWord(planB.word)).word, planRoot.word);
    const replay = await dictionary.applyActions(
      operations,
      { ...actor, messageId: 2001 },
      snapshots,
    );
    assert.equal(replay.unchanged, true);
    assert.equal(
      (await repo.findOneByOrFail({ id: planRoot.id })).senses[0].examples
        .length,
      2,
    );
    const stale = await dictionary.inspectRecords([planRoot.word]);
    await repo.update(planRoot.id, { partOfSpeech: 'существительное' });
    await assert.rejects(
      dictionary.applyActions(
        [
          {
            type: 'set_sense',
            word: planRoot.word,
            sense: 1,
            translation: 'другой',
          },
        ],
        actor,
        stale,
      ),
      /изменилась/,
    );
    const mixed = [
      { type: 'add_word', word: 'план новое', translation: 'первый перевод' },
      {
        type: 'set_sense',
        word: 'план новое',
        sense: 2,
        createSense: true,
        translation: 'второй перевод',
      },
      {
        type: 'set_kind',
        word: 'план новое',
        kind: 'idiom',
        literalTranslation: 'буквальное значение',
      },
      { type: 'update_word', word: 'план новое', newWord: 'план исправленное' },
      {
        type: 'set_status',
        word: 'план исправленное',
        status: 'deferred',
        reason: 'обсуждается',
      },
    ];
    await dictionary.applyActions(
      mixed,
      { ...actor, messageId: 2002 },
      await dictionary.inspectRecords(actionWords(mixed)),
    );
    const mixedRow = await repo.findOneByOrFail({ word: 'план исправленное' });
    assert.equal(mixedRow.status, 'deferred');
    assert.equal(mixedRow.kind, 'idiom');
    assert.equal(mixedRow.senses.length, 2);
    const forbiddenAdd = [
      {
        type: 'add_word',
        word: 'план новый участник',
        translation: 'новое слово',
      },
      { type: 'add_word', word: 'аварийа', translation: 'чужое изменение' },
    ];
    await assert.rejects(
      dictionary.applyActions(
        forbiddenAdd,
        { ...actor, username: 'participant' },
        await dictionary.inspectRecords(actionWords(forbiddenAdd)),
      ),
    );
    assert.equal(await repo.findOneBy({ word: 'план новый участник' }), null);
    const deletion = [{ type: 'delete_word', word: mixedRow.word }];
    await dictionary.applyActions(
      deletion,
      { ...actor, messageId: 2003 },
      await dictionary.inspectRecords(actionWords(deletion)),
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: mixedRow.id })).status,
      'deleted',
    );
    console.log(
      'PASS model plans: multi-item rollback, permissions, required reads, stale-version rejection, replay, ordered mixed operations and preserved search.',
    );

    // A deletion followed by an unresolved correction must roll back the deletion too.
    const protectedWord = await seed('защищённая запись', 'старое значение');
    const failingPlan = [
      { type: 'delete_word', word: protectedWord.word },
      {
        type: 'update_word',
        word: 'отсутствующая запись',
        translation: 'новое значение',
      },
    ];
    const beforeFailedPlan = await history.count();
    await assert.rejects(
      dictionary.applyActions(
        failingPlan,
        { ...actor, messageId: 9000 },
        await dictionary.inspectRecords(actionWords(failingPlan)),
      ),
      /Не нашёл запись/,
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: protectedWord.id })).status,
      'active',
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: protectedWord.id })).translation,
      'старое значение',
    );
    assert.equal(await history.count(), beforeFailedPlan);
    const corrected = [
      {
        type: 'update_word',
        word: protectedWord.word,
        translation: 'уточнённое значение',
      },
    ];
    await dictionary.applyActions(
      corrected,
      { ...actor, messageId: 9001 },
      await dictionary.inspectRecords(actionWords(corrected)),
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: protectedWord.id })).translation,
      'уточнённое значение',
    );
    console.log(
      'PASS missing correction: earlier deletion rolled back; old value and history preserved; explicit clarification succeeds.',
    );

    const requestRepo = db.getRepository(DictionaryRequest);
    let requests = new DictionaryRequestService(requestRepo);
    const scope = '-987654:44:42';
    const receive = (messageId, text, addressed = false, otherScope = scope) =>
      requests.receive({ scope: otherScope, messageId, text, addressed });
    const hundred = Array.from({ length: 100 }, (_, index) => ({
      type: 'update_word',
      word: `тест ${index + 1}`,
      translation: `новый перевод ${index + 1}`,
      sourceItem: index + 1,
    }));
    await repo.save(
      hundred.map((operation) =>
        repo.create({
          word: operation.word,
          translation: 'исходный перевод',
          source: 'chat',
        }),
      ),
    );
    const lines = hundred.map(
      (operation) =>
        `${operation.sourceItem}. ${operation.word} — ${operation.translation}`,
    );
    await receive(
      10000,
      'Баласи, исправь:\n' + lines.slice(0, 34).join('\n'),
      true,
    );
    await Promise.all([
      receive(10002, lines.slice(67).join('\n')),
      receive(10001, lines.slice(34, 67).join('\n')),
    ]);
    // New service instance models restart: all input lives in PostgreSQL.
    requests = new DictionaryRequestService(requestRepo);
    await receive(10001, lines.slice(34, 67).join('\n'));
    const ready = await receive(10003, 'Готово 100');
    assert.equal(ready.type, 'process');
    assert.equal(ready.request.parts.length, 3);
    assert.deepEqual(
      requestItems(ready.request),
      hundred.map((operation) => operation.sourceItem),
    );
    for (const line of lines) assert(requestText(ready.request).includes(line));
    assert.equal(
      (await repo.findOneByOrFail({ word: 'тест 100' })).translation,
      'исходный перевод',
    );
    const reads = await dictionary.inspectRecords(actionWords(hundred));
    const saveHundred = () =>
      requests.commit(ready.request, (manager) =>
        new DictionaryService(manager.getRepository(Word)).applyActions(
          hundred,
          { ...actor, messageId: 10000 },
          reads,
        ),
      );
    const repeated = await Promise.allSettled([saveHundred(), saveHundred()]);
    assert.equal(
      repeated.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal((await receive(10004, 'Готово')).type, 'notice');
    for (const operation of hundred)
      assert.equal(
        (await repo.findOneByOrFail({ word: operation.word })).translation,
        operation.translation,
      );
    assert.equal(
      await history.countBy({ requestKey: `${actor.chatId}:10000:actions` }),
      1,
    );

    await receive(
      10100,
      'Баласи, исправь:\n1. защищённая запись — исправление',
      true,
    );
    const staleDraft = (await receive(10101, 'Готово')).request;
    await receive(10102, '2. тест 1 — ещё одно исправление');
    let writes = 0;
    await assert.rejects(
      requests.commit(staleDraft, async () => {
        writes++;
      }),
      /дополнился/,
    );
    assert.equal(writes, 0);
    await receive(10103, 'Отмени список');
    await assert.rejects(
      requests.commit(staleDraft, async () => {
        writes++;
      }),
      /отменён/,
    );
    assert.equal(writes, 0);

    // A failed operation leaves both the data and the complete draft available for clarification.
    await receive(
      10200,
      'Баласи, исправь:\n1. защищённая запись — перенеси в пример отсутствующей записи',
      true,
    );
    const pending = (await receive(10201, 'Готово')).request;
    const missingMove = [
      {
        type: 'move_example',
        word: protectedWord.word,
        target: 'отсутствующая основа',
        sense: 1,
      },
    ];
    const moveReads = await dictionary.inspectRecords(actionWords(missingMove));
    await assert.rejects(
      requests.commit(pending, (manager) =>
        new DictionaryService(manager.getRepository(Word)).applyActions(
          missingMove,
          { ...actor, messageId: 10200 },
          moveReads,
        ),
      ),
      /Не нашёл основную запись/,
    );
    assert.equal(
      (await requestRepo.findOneByOrFail({ id: pending.id })).status,
      'ready',
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: protectedWord.id })).status,
      'active',
    );
    await requests.rememberQuestion(
      pending,
      'В какую основную запись перенести?',
    );
    const clarified = await receive(
      10202,
      'Баласи, основная запись — тест 1',
      true,
    );
    assert.equal(clarified.type, 'process');
    assert(requestText(clarified.request).includes('отсутствующей записи'));
    assert(requestText(clarified.request).includes('основная запись — тест 1'));
    const fixedMove = [{ ...missingMove[0], target: 'тест 1' }];
    const fixedReads = await dictionary.inspectRecords(actionWords(fixedMove));
    await requests.commit(clarified.request, (manager) =>
      new DictionaryService(manager.getRepository(Word)).applyActions(
        fixedMove,
        { ...actor, messageId: 10200 },
        fixedReads,
      ),
    );
    assert.equal(
      (await repo.findOneByOrFail({ id: protectedWord.id })).status,
      'embedded',
    );
    assert.equal(
      (await repo.findOneByOrFail({ word: 'тест 1' })).senses[0].examples.at(-1)
        .translation,
      'уточнённое значение',
    );
    assert.equal(
      (await requestRepo.findOneByOrFail({ id: pending.id })).status,
      'applied',
    );
    console.log(
      'PASS persistent requests: 100 items in 3 parts, out-of-order continuations, restart, duplicate delivery, concurrent completion, stale plans, cancellation and retry after missing target.',
    );

    // Exercise the real Telegram entry point, persistence, plan checks and DB commit together.
    const routedPlan = ['а', 'б', 'в'].map((suffix, index) => ({
      type: 'update_word',
      word: `сквозной тест ${suffix}`,
      translation: `результат ${suffix}`,
      sourceItem: index + 1,
    }));
    for (const operation of routedPlan)
      await seed(operation.word, 'до исправления');
    const replies = [];
    let modelCalls = 0;
    const telegramContext = {
      saveContextMessage: async () => {},
      recordBotEvent: async () => {},
      getRecentMessages: async () => [],
      getBotMemory: async () => [],
      addMessage: async () => {
        throw new Error('Correction escaped to discussion buffer');
      },
    };
    const model = {
      processBotMention: async (text, _history, _memory, _entries, options) => {
        modelCalls++;
        assert.deepEqual(options.requestItems, [1, 2, 3]);
        for (const operation of routedPlan)
          assert(text.includes(operation.word));
        return {
          action: 'dictionary_actions',
          operations: routedPlan,
          snapshots: await dictionary.inspectRecords(actionWords(routedPlan)),
        };
      },
    };
    const handler = new TelegramUpdate(
      {},
      telegramContext,
      model,
      dictionary,
      {},
      {},
      {},
      {},
      {},
      {},
      { get: () => 100 },
      requests,
    );
    const from = { id: 42, username: 'Elvardi' };
    const context = {
      chat: { id: -987655, type: 'supergroup' },
      from,
      botInfo: { id: 900, username: 'fixture_bot' },
      reply: async (text) => {
        replies.push(text);
      },
      sendChatAction: async () => true,
    };
    for (const [index, operation] of routedPlan.entries())
      await handler.onText({
        ...context,
        message: {
          message_id: 12000 + index,
          message_thread_id: 44,
          from,
          text: `${index === 0 ? 'Баласи, исправь:\n' : ''}${index + 1}. ${operation.word} — ${operation.translation}`,
        },
      });
    assert.equal(modelCalls, 0);
    await handler.onText({
      ...context,
      message: {
        message_id: 12003,
        message_thread_id: 44,
        from,
        text: 'Готово 3',
      },
    });
    assert.equal(modelCalls, 1);
    for (const operation of routedPlan)
      assert.equal(
        (await repo.findOneByOrFail({ word: operation.word })).translation,
        operation.translation,
      );
    assert(replies.some((text) => text.includes('✅ Изменения сохранены')));
    await handler.onText({
      ...context,
      message: {
        message_id: 12004,
        message_thread_id: 44,
        from,
        text: 'Готово',
      },
    });
    assert.equal(modelCalls, 1);
    assert.equal(
      await history.countBy({ requestKey: '-987655:12000:actions' }),
      1,
    );
    console.log(
      'PASS complete Telegram flow: 3 messages -> one model plan -> one PostgreSQL transaction -> success reply; retry makes no duplicate.',
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
      const child = spawn(
        'pnpm',
        [
          'exec',
          'next',
          'dev',
          '--webpack',
          '--port',
          '3007',
          '--hostname',
          '127.0.0.1',
        ],
        {
          cwd:
            process.env.DICTIONARY_PREVIEW_DIR ||
            path.resolve(__dirname, '../../tsintskaro-website'),
          env: {
            ...process.env,
            DATABASE_URL: previewUrl.toString(),
            ...(env.DB_CERT ? { DB_CERT: env.DB_CERT } : {}),
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );
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
