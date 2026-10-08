import { Repository } from 'typeorm';
import { Word } from './entities/word.entity';
import { WordEditHistory } from './entities/word-edit-history.entity';
import { DictionaryEdit } from './dictionary-edit-input';
import { assertCanEditTranslations } from './translation-permissions';
import { WORD_DELETION_DENIED } from './deletion-permissions';
import {
  assertEditableWord,
  DictionaryContentError,
  getSenses,
  mergeSenses,
  normalizeDictionaryText,
  renderSenses,
  sameText,
} from './dictionary-content';

export interface DictionaryActor {
  userId: number;
  username: string | null;
  chatId?: number;
  threadId?: number | null;
  messageId?: number | null;
  canRemoveEntry: boolean;
}

export interface DictionaryEditResult {
  status: 'updated' | 'unchanged';
  word: Word;
  previousTranslation: string;
  movedWord?: string;
}

export class DictionaryEditor {
  constructor(private readonly repo: Repository<Word>) {}

  async apply(
    edit: DictionaryEdit,
    actor: DictionaryActor,
  ): Promise<DictionaryEditResult> {
    assertCanEditTranslations(actor.username);
    if (!Number.isSafeInteger(actor.userId) || actor.userId <= 0)
      throw new DictionaryContentError('Не удалось определить редактора.');
    if (
      (edit.type === 'move_example' ||
        (edit.type === 'set_status' && edit.status === 'deferred')) &&
      !actor.canRemoveEntry
    ) {
      throw new DictionaryContentError(WORD_DELETION_DENIED);
    }
    const wordName = normalizeDictionaryText(edit.word).toLowerCase();
    if (!wordName || wordName.length > 255)
      throw new DictionaryContentError('Укажи точное слово.');
    return this.repo.manager.transaction(async (manager) => {
      // One short edit lock also covers merge/transfer relationships and command replays.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('tsintskaro.dictionary-edits'))",
      );
      const words = manager.getRepository(Word);
      const history = manager.getRepository(WordEditHistory);
      const requestKey =
        actor.chatId != null && actor.messageId != null
          ? `${actor.chatId}:${actor.messageId}`
          : null;
      const replay = requestKey
        ? await history.findOne({ where: { requestKey } })
        : null;
      if (replay) {
        const after = replay.after as Word[];
        const current = await words.findOne({ where: { id: after[0].id } });
        if (!current)
          throw new DictionaryContentError(
            'Запись изменена после этой команды. Укажи её текущее название.',
          );
        return {
          status: 'unchanged',
          word: current,
          previousTranslation: current.translation,
        };
      }
      const source = await words.findOne({
        where: { word: wordName },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source)
        throw new DictionaryContentError(
          `Не нашёл запись «${wordName}». Ничего не изменено.`,
        );
      if (edit.type === 'move_example' && source.status === 'deleted')
        throw new DictionaryContentError(
          'Исходная запись удалена. Сначала явно верни её в словарь.',
        );
      let word = source;
      const before: Word[] = [];
      if (edit.type === 'move_example') {
        const targetName = normalizeDictionaryText(edit.target).toLowerCase();
        if (sameText(source.word, targetName))
          throw new DictionaryContentError(
            'Нельзя перенести запись в саму себя.',
          );
        word = await words.findOne({
          where: { word: targetName },
          lock: { mode: 'pessimistic_write' },
        });
        if (!word)
          throw new DictionaryContentError(
            `Не нашёл основную запись «${targetName}». Исходная запись сохранена.`,
          );
        assertEditableWord(word);
        if (word.status === 'deferred')
          throw new DictionaryContentError(
            'Основная запись отложена. Сначала верни её в словарь.',
          );
      }
      before.push(structuredClone(word));
      if (word.id !== source.id) before.push(structuredClone(source));
      const previousTranslation = word.translation;
      if (
        edit.type !== 'move_example' &&
        !(edit.type === 'set_status' && source.status === 'deleted')
      )
        assertEditableWord(source);

      if (edit.type === 'set_status') {
        word.status = edit.status;
        word.statusReason =
          edit.status === 'deferred' ? edit.reason?.trim() || null : null;
      } else if (edit.type === 'set_kind') {
        if (!['word', 'idiom', 'proverb'].includes(edit.kind))
          throw new DictionaryContentError('Неизвестный тип записи.');
        word.kind = edit.kind;
        if (edit.literalTranslation !== undefined)
          word.literalTranslation = this.requiredText(edit.literalTranslation);
      } else {
        const senses = getSenses(word);
        if (!Number.isSafeInteger(edit.sense) || edit.sense < 1)
          throw new DictionaryContentError(
            'Номер значения должен быть положительным целым числом.',
          );
        if (edit.sense > senses.length) {
          if (
            !('createSense' in edit && edit.createSense) ||
            edit.sense !== senses.length + 1
          ) {
            throw new DictionaryContentError(
              `У «${word.word}» ${senses.length} значений. Новое значение нужно добавить явно; номера не пропускаются.`,
            );
          }
          senses.push({ translation: null, examples: [] });
        } else if (
          'createSense' in edit &&
          edit.createSense &&
          senses[edit.sense - 1].translation !== null
        ) {
          throw new DictionaryContentError(
            `Значение ${edit.sense} уже заполнено. Укажи существующее значение или следующий номер.`,
          );
        }
        const sense = senses[edit.sense - 1];
        if (edit.type === 'set_sense')
          sense.translation = this.requiredText(edit.translation);
        if (edit.type === 'set_sense_pos') {
          const pos = this.requiredText(edit.partOfSpeech);
          if (
            /^(?:фразеологизм|пословица|поговорка|пословица\/поговорка)$/i.test(
              pos,
            )
          )
            throw new DictionaryContentError(
              'Это тип записи, а не часть речи. Используй «укажи тип записи».',
            );
          if (pos.length > 64)
            throw new DictionaryContentError(
              'Слишком длинная помета части речи.',
            );
          sense.partOfSpeech = pos;
        }
        if (edit.type === 'set_example') {
          const matches = sense.examples.filter((e) =>
            sameText(e.phrase, edit.phrase),
          );
          if (matches.length !== 1)
            throw new DictionaryContentError(
              'Пример не найден однозначно в указанном значении. Уточни выражение.',
            );
          matches[0].translation = this.requiredText(edit.translation);
        }
        if (edit.type === 'move_example' || edit.type === 'add_example') {
          const phrase = this.requiredText(
            edit.type === 'move_example'
              ? (edit.phrase ?? source.word)
              : edit.phrase,
          );
          if (phrase.length > 255)
            throw new DictionaryContentError('Выражение длиннее 255 символов.');
          const translation = this.requiredText(
            edit.translation ?? source.translation,
          );
          const existing = sense.examples.find(
            (e) =>
              sameText(e.phrase, phrase) ||
              (edit.type === 'move_example' && e.sourceWordId === source.id),
          );
          if (
            edit.type === 'move_example' &&
            (source.status === 'embedded' || source.status === 'merged')
          ) {
            if (
              source.status === 'embedded' &&
              source.relatedWordId === word.id &&
              existing &&
              sameText(existing.phrase, phrase) &&
              sameText(existing.translation, translation)
            ) {
              return {
                status: 'unchanged',
                word,
                previousTranslation,
                movedWord: source.word,
              };
            }
            throw new DictionaryContentError(
              'Запись уже перенесена. Для изменения перевода используй команду изменения примера.',
            );
          }
          if (existing && !sameText(existing.translation, translation))
            throw new DictionaryContentError(
              'Такой пример уже есть с другим переводом. Укажи явное изменение перевода примера.',
            );
          if (edit.type === 'move_example') {
            if (
              source.senses?.some((s) => s.examples.length) ||
              (await words.count({ where: { relatedWordId: source.id } })) > 0
            ) {
              throw new DictionaryContentError(
                'У исходной записи уже есть свои примеры или связанные записи. Сначала разберём их отдельно, чтобы ничего не потерять.',
              );
            }
            source.status = 'embedded';
            source.relatedWordId = word.id;
          }
          if (!existing)
            sense.examples.push({
              phrase,
              translation,
              ...(edit.type === 'move_example'
                ? {
                    sourceWordId: source.id,
                    aliases: sameText(phrase, source.word) ? [] : [source.word],
                  }
                : {}),
            });
          else if (edit.type === 'move_example') {
            existing.aliases = [
              ...new Set([...(existing.aliases ?? []), source.word]),
            ];
            existing.sourceWordId ??= source.id;
          }
        }
        word.senses = senses;
        word.translation = renderSenses(senses);
      }
      const after = word.id === source.id ? [word] : [word, source];
      if (JSON.stringify(before) === JSON.stringify(after))
        return { status: 'unchanged', word, previousTranslation };
      await words.save(after);
      await history.save(
        history.create({
          operation: edit.type,
          requestKey,
          before,
          after,
          actor: {
            userId: actor.userId,
            username: actor.username!,
            chatId: actor.chatId,
            threadId: actor.threadId,
            messageId: actor.messageId,
          },
        }),
      );
      return {
        status: 'updated',
        word,
        previousTranslation,
        ...(edit.type === 'move_example' ? { movedWord: source.word } : {}),
      };
    });
  }

  async merge(
    sourceId: number,
    targetId: number,
    actor: { username: string; userId?: number },
    explicitTranslation?: string,
    partOfSpeech?: string | null,
  ): Promise<Word> {
    assertCanEditTranslations(actor.username);
    return this.repo.manager.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('tsintskaro.dictionary-edits'))",
      );
      const words = manager.getRepository(Word);
      const source = await words.findOne({
        where: { id: sourceId },
        lock: { mode: 'pessimistic_write' },
      });
      const target = await words.findOne({
        where: { id: targetId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source || !target || source.id === target.id)
        throw new DictionaryContentError(
          'Записи для объединения изменились. Повтори команду с текущим написанием.',
        );
      assertEditableWord(source);
      assertEditableWord(target);
      if (
        (source.kind ?? 'word') !== (target.kind ?? 'word') ||
        (source.literalTranslation &&
          target.literalTranslation &&
          !sameText(source.literalTranslation, target.literalTranslation))
      )
        throw new DictionaryContentError(
          'У записей различаются тип или буквальный перевод. Сначала согласуйте эти данные.',
        );
      const related = await words.find({ where: { relatedWordId: source.id } });
      const before = structuredClone([target, source, ...related]);
      target.senses = mergeSenses(getSenses(target), getSenses(source));
      if (explicitTranslation)
        target.senses = mergeSenses(
          target.senses,
          getSenses({ translation: explicitTranslation }),
        );
      target.translation = renderSenses(target.senses);
      if (partOfSpeech !== undefined) target.partOfSpeech = partOfSpeech;
      else if (!target.partOfSpeech) target.partOfSpeech = source.partOfSpeech;
      else if (
        source.partOfSpeech &&
        !sameText(target.partOfSpeech, source.partOfSpeech)
      )
        throw new DictionaryContentError(
          'У записей различаются части речи. Укажи согласованную помету явно.',
        );
      target.literalTranslation ||= source.literalTranslation;
      target.comments =
        [...new Set([target.comments, source.comments].filter(Boolean))].join(
          '\n',
        ) || null;
      source.status = 'merged';
      source.relatedWordId = target.id;
      for (const row of related) row.relatedWordId = target.id;
      const after = [target, source, ...related];
      await words.save(after);
      const history = manager.getRepository(WordEditHistory);
      await history.save(
        history.create({
          operation: 'merge',
          requestKey: null,
          before,
          after,
          actor,
        }),
      );
      return target;
    });
  }

  private requiredText(value: string): string {
    if (typeof value !== 'string' || !value.trim())
      throw new DictionaryContentError(
        'Нужен непустой текст перевода или выражения.',
      );
    return normalizeDictionaryText(value);
  }
}
