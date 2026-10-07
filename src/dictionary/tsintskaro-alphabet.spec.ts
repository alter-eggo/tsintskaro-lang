import {
  compareTsintskaroWords,
  TSINTSKARO_ALPHABET,
} from './tsintskaro-alphabet';

describe('illustrated Tsintskaro alphabet', () => {
  it('has 40 letters, including Ê between Е and Ё and no hard sign', () => {
    expect(TSINTSKARO_ALPHABET).toHaveLength(40);
    expect(TSINTSKARO_ALPHABET.slice(8, 11)).toEqual(['Е', 'Ê', 'Ё']);
    expect(TSINTSKARO_ALPHABET).not.toContain('Ъ');
  });
  it('sorts бêй within Б and preserves the distinct letters', () => {
    expect(
      ['бя', 'бё', 'бêй', 'бе', 'ба'].sort(compareTsintskaroWords),
    ).toEqual(['ба', 'бе', 'бêй', 'бё', 'бя']);
  });
  it('treats decomposed accents identically and retains digraph ordering', () => {
    expect(compareTsintskaroWords('бêй'.normalize('NFD'), 'бêй')).toBe(0);
    expect(
      ['да', 'гха', 'гя', 'джа', 'ея'].sort(compareTsintskaroWords),
    ).toEqual(['гя', 'гха', 'да', 'джа', 'ея']);
  });
});
