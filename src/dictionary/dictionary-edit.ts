import type { WordKind } from './dictionary-content';

export type DictionaryEdit =
  | {
      type: 'move_example';
      word: string;
      target: string;
      sense: number;
      createSense?: boolean;
      translation?: string;
      phrase?: string;
    }
  | {
      type: 'add_example';
      word: string;
      sense: number;
      phrase: string;
      translation: string;
    }
  | {
      type: 'set_sense';
      word: string;
      sense: number;
      translation: string;
      createSense?: boolean;
    }
  | { type: 'set_sense_pos'; word: string; sense: number; partOfSpeech: string }
  | {
      type: 'set_example';
      word: string;
      sense: number;
      phrase: string;
      translation: string;
    }
  | {
      type: 'set_kind';
      word: string;
      kind: WordKind;
      literalTranslation?: string;
    }
  | {
      type: 'set_status';
      word: string;
      status: 'active' | 'deferred';
      reason?: string;
    };
