const PART_OF_SPEECH =
  'существительное|прилагательное|глагол|наречие|местоимение|междометие|предлог|числительное|частица|союз|словосочетание|сущ\\.?|гл\\.?|прил\\.?|нар\\.?|мест\\.?|межд\\.?|предл\\.?|числ\\.?|част\\.?';

// Only a trailing, explicitly separated grammatical label is metadata.
// Parentheses explaining the meaning (e.g. "часть заработка...") stay intact.
const POS_SUFFIX = new RegExp(
  `(?:\\s*\\((${PART_OF_SPEECH})\\)|[,;]\\s*(?:(?:добавить|добавь|указать|укажи)\\s+(?:в\\s+раздел\\s+)?)?(?:часть\\s+речи(?:\\s+словаря)?\\s*[-—–:=]?\\s*)?(${PART_OF_SPEECH}))\\s*$`,
  'i',
);

export function extractPartOfSpeech(translation: string): {
  translation: string;
  partOfSpeech: string | null;
} {
  const match = translation.match(POS_SUFFIX);
  return match
    ? {
        translation: translation.slice(0, match.index).trim(),
        partOfSpeech: (match[1] || match[2]).toLowerCase(),
      }
    : { translation, partOfSpeech: null };
}
