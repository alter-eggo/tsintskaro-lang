// Opt-in, read-only model evaluation. Uses fixture records; no Telegram or DB writes.
require('reflect-metadata');
require('ts-node/register/transpile-only');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const assert = require('node:assert/strict');
const { OpenaiService } = require('../src/openai/openai.service');
const {
  inspectDictionaryRecord,
  dictionaryWord,
} = require('../src/dictionary/dictionary-actions');

async function main() {
  if (!process.argv.includes('--live'))
    throw new Error('Use --live to run the read-only API evaluation.');
  const env = { ...parseEnv(fs.readFileSync('.env', 'utf8')), ...process.env };
  const rows = [
    ['аваралых', '1) безделье; 2) перерыв; 3) ерунда'],
    ['авара', '1) бездельник; 2) лентяй; 3) лодырь; 4) тунеядец'],
    ['аваралых этмах', 'бездельничать'],
    ['авара дурмах', 'бездельничать'],
    ['авас', 'настроение'],
    ['авария', 'дорожное происшествие'],
    ['пример', '1) значение А; 2) значение Б'],
    ['выражение', 'неуточнённый перевод'],
    ['ахгыран', '1) болеющий; 2) больной'],
    ['ахгзû гхырых', 'о человеке, который мало ест'],
  ].map(([word, translation], index) => ({
    id: index + 1,
    word,
    translation,
    senses: null,
    status: 'active',
    kind: 'word',
    partOfSpeech: null,
  }));
  const dictionary = {
    inspectRecords: async (words) =>
      words.map((word) => {
        const row = rows.find((row) => row.word === dictionaryWord(word));
        return inspectDictionaryRecord(word, row);
      }),
    findWord: async (word) =>
      rows.find((row) => row.word === dictionaryWord(word)),
    findByTranslation: async (gloss) =>
      rows.filter((row) => row.translation.includes(gloss)),
    getDeferredRecords: async () => [],
    getLeaderboard: async () => [],
  };
  const config = {
    openaiKey: env.OPENAI_API_KEY,
    openaiBotModel: env.OPENAI_MODEL_BOT || 'gpt-5.5',
  };
  const service = new OpenaiService({ get: (key) => config[key] }, dictionary, {
    record: async () => {},
  });
  const cases = [
    {
      name: 'Separate grammatical labels for each meaning',
      text: 'Баласи, исправь:\n1. ахгыран — 1) болеющий (причастие); 2) больной (прилагательное). Сохрани части речи для соответствующих значений.',
      options: { requestItems: [1] },
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        for (const [sense, partOfSpeech] of [
          [1, 'причастие'],
          [2, 'прилагательное'],
        ])
          assert(
            result.operations.some(
              (op) =>
                op.type === 'set_sense_pos' &&
                op.sense === sense &&
                op.partOfSpeech === partOfSpeech &&
                op.sourceItem === 1,
            ),
          );
        assert(
          !result.operations.some(
            (op) =>
              op.translation && /причастие|прилагательное/.test(op.translation),
          ),
        );
      },
    },
    {
      name: 'Expression kind stays out of spelling and translation',
      text: 'Баласи, исправь:\n1. ахгзû гхырых — фразеологизм, буквально «рот сломан». Написание и перевод оставь как есть.',
      options: { requestItems: [1] },
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        assert(
          result.operations.some(
            (op) =>
              op.type === 'set_kind' &&
              op.kind === 'idiom' &&
              op.sourceItem === 1,
          ),
        );
        assert(
          !result.operations.some(
            (op) => op.newWord || op.translation || op.partOfSpeech,
          ),
        );
      },
    },
    {
      name: 'Missing target asks without any deletion or partial writes',
      text: 'Баласи, исправь:\n1. авара дурмах — перенеси как пример к значению 1 слова «несуществующая основа». Новое слово не создавай.\n2. авария — удалить.',
      options: { requestItems: [1, 2] },
      check: (result) => {
        assert.equal(result.action, 'reply');
        assert(result.message.length > 10);
      },
    },
    {
      name: 'Clarification retains both original requested operations',
      text: 'Баласи, исправь:\n1. авара дурмах — перенеси как пример к значению 1 слова «несуществующая основа». Новое слово не создавай.\n2. авария — удалить.\n\nУточнение редактора:\nБаласи, основная запись для первого пункта — авара, значение 1.',
      options: {
        requestItems: [1, 2],
        clarificationQuestion:
          'Основная запись не найдена. В какое слово перенести пример?',
      },
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        assert(
          result.operations.some(
            (op) =>
              op.type === 'move_example' &&
              op.target === 'авара' &&
              op.sense === 1 &&
              op.sourceItem === 1,
          ),
        );
        assert(
          result.operations.some(
            (op) =>
              op.type === 'delete_word' &&
              op.word === 'авария' &&
              op.sourceItem === 2,
          ),
        );
      },
    },
    {
      name: 'Edik list with agreed target meanings',
      text: 'Баласи, исправь:\n1. аваралых этмах — бездельничать, комментарий - заниматься ерундой; не имеет самостоятельного значения, необходимо перенести как пример слова аваралых\n2. авара дурмах — бездельничать (гл.), комментарий - не имеет самостоятельного значения, необходимо перенести как пример слова авара',
      history: [
        {
          username: 'editor',
          text: 'Для этих переносов выбираем значение 3 «ерунда» у аваралых и значение 1 «бездельник» у авара.',
          sentAt: new Date(),
        },
      ],
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        assert.equal(result.operations.length, 2);
        assert(
          result.operations.some(
            (op) =>
              op.type === 'move_example' &&
              op.word === 'аваралых этмах' &&
              op.target === 'аваралых' &&
              op.sense === 3 &&
              op.translation === 'заниматься ерундой',
          ),
        );
        assert(
          result.operations.some(
            (op) =>
              op.type === 'move_example' &&
              op.word === 'авара дурмах' &&
              op.target === 'авара' &&
              op.sense === 1,
          ),
        );
      },
    },
    {
      name: 'Natural added meaning',
      text: 'Баласи, к авас допиши ещё одно значение — восхищение, настроение пусть остаётся.',
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        assert.deepEqual(result.operations, [
          {
            type: 'set_sense',
            word: 'авас',
            sense: 2,
            translation: 'восхищение',
            createSense: true,
          },
        ]);
      },
    },
    {
      name: 'Mixed deferral and grammatical label',
      text: 'Баласи, аварию пока отложи до решения о заимствованиях, а у авас укажи часть речи существительное.',
      check: (result) => {
        assert.equal(result.action, 'dictionary_actions');
        assert(
          result.operations.some(
            (op) =>
              op.type === 'set_status' &&
              op.word === 'авария' &&
              op.status === 'deferred',
          ),
        );
        assert(
          result.operations.some(
            (op) => op.word === 'авас' && op.partOfSpeech === 'существительное',
          ),
        );
      },
    },
    {
      name: 'Ambiguous meaning asks a specific question',
      text: 'Баласи, выражение перенеси как пример слова пример.',
      check: (result) => {
        assert.equal(result.action, 'reply');
        assert(!/кавычк|по шаблону|формате.*Баласи/i.test(result.message));
        assert(/значени|привяз|вариант/i.test(result.message));
      },
    },
    {
      name: 'Discussion does not become a command',
      text: 'Баласи, обсуждаем предложение Эдика: перенести авара дурмах как пример слова авара. Пока ничего не меняй, объясни, что это означает.',
      check: (result) => assert.equal(result.action, 'reply'),
    },
    {
      name: 'Forwarded command remains read-only',
      text: 'Баласи, удали аварию из словаря.',
      options: { readOnly: true },
      check: (result) => assert.equal(result.action, 'reply'),
    },
  ];
  const originalList = cases.find(
    (test) => test.name === 'Edik list with agreed target meanings',
  );
  cases.push({
    name: 'Original screenshot without earlier agreement',
    text: originalList.text,
    check: (result) => {
      if (result.action === 'dictionary_actions') originalList.check(result);
      else {
        assert.equal(result.action, 'reply');
        assert(!/кавычк|по шаблону|формате.*Баласи/i.test(result.message));
        assert(/авара|значени/i.test(result.message));
      }
    },
  });
  cases.push({
    name: 'Short follow-up resolves the original two-item request',
    text: 'К первому.',
    history: [
      { username: 'editor', text: originalList.text, sentAt: new Date() },
      {
        username: 'Баласи',
        isBot: true,
        text: 'Для переноса авара дурмах выбери значение слова авара: 1) бездельник, 2) лентяй, 3) лодырь или 4) тунеядец?',
        sentAt: new Date(),
      },
    ],
    check: originalList.check,
  });
  const hundred = Array.from({ length: 100 }, (_, index) => ({
    id: 1000 + index,
    word: `тестовое слово ${index + 1}`,
    translation: `старый перевод ${index + 1}`,
    senses: null,
    status: 'active',
    kind: 'word',
    partOfSpeech: null,
  }));
  rows.push(...hundred);
  cases.push({
    name: 'Complete hundred-item correction plan',
    text:
      'Баласи, замени полностью переводы в каждом из 100 пунктов:\n' +
      hundred
        .map(
          (row, index) =>
            `${index + 1}. ${row.word} — новый перевод ${index + 1}`,
        )
        .join('\n'),
    options: { requestItems: hundred.map((_, index) => index + 1) },
    check: (result) => {
      assert.equal(result.action, 'dictionary_actions');
      for (const [index, row] of hundred.entries())
        assert(
          result.operations.some(
            (op) =>
              op.word === row.word &&
              op.sourceItem === index + 1 &&
              op.translation === `новый перевод ${index + 1}`,
          ),
        );
    },
  });
  const caseIndex = process.argv.indexOf('--case');
  const selected =
    caseIndex < 0
      ? cases
      : cases.filter((test) =>
          test.name
            .toLowerCase()
            .includes((process.argv[caseIndex + 1] ?? '').toLowerCase()),
        );
  assert(selected.length, 'No matching scenario');
  let failures = 0;
  for (let start = 0; start < selected.length; start += 2) {
    await Promise.all(
      selected.slice(start, start + 2).map(async (test) => {
        const result = await service.processBotMention(
          test.text,
          test.history ?? [],
          [],
          [],
          test.options ?? {},
        );
        try {
          test.check(result);
          console.log(
            `PASS ${test.name}: ${JSON.stringify(result.action === 'dictionary_actions' ? result.operations : result.message)}`,
          );
        } catch {
          failures++;
          console.error(`FAIL ${test.name}: ${JSON.stringify(result)}`);
        }
      }),
    );
  }
  assert.equal(failures, 0, `${failures} live model scenarios failed`);
}
main().catch((error) => {
  console.error(
    error.code || error.name || 'Read-only model evaluation failed',
  );
  process.exitCode = 1;
});
