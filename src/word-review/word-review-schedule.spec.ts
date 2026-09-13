import { nextReviewDate, reviewCalendarDate } from './word-review-schedule';

describe('word review calendar', () => {
  it.each([
    ['2026-09-13T06:30:00Z', '2026-09-13T06:30:00Z', '2026-09-16T05:00:00Z'],
    ['2026-09-30T05:00:00Z', '2026-09-30T05:00:00Z', '2026-10-03T05:00:00Z'],
    ['2026-12-30T05:00:00Z', '2026-12-30T05:00:00Z', '2027-01-02T05:00:00Z'],
    ['2026-09-16T05:00:00Z', '2026-09-23T06:00:00Z', '2026-09-25T05:00:00Z'],
    ['2028-02-27T05:00:00Z', '2028-02-27T05:00:00Z', '2028-03-01T05:00:00Z'],
  ])(
    'advances the three-day cycle from %s through %s',
    (anchor, now, expected) => {
      expect(nextReviewDate(new Date(anchor), new Date(now))).toEqual(
        new Date(expected),
      );
    },
  );

  it('uses the Tbilisi date when UTC is still on the previous day', () => {
    const start = new Date('2026-09-12T21:00:00Z');
    expect(reviewCalendarDate(start)).toBe('2026-09-13');
    expect(nextReviewDate(start, start)).toEqual(
      new Date('2026-09-16T05:00:00Z'),
    );
  });
});
