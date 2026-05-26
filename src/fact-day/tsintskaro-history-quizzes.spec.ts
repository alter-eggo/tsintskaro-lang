import {
  formatHistoryQuizExplanation,
  formatHistoryQuizQuestion,
  getHistoryQuizContext,
  MAX_TELEGRAM_QUIZ_EXPLANATION_LENGTH,
  MAX_TELEGRAM_QUIZ_QUESTION_LENGTH,
  TSINTSKARO_HISTORY_QUIZZES,
} from './tsintskaro-history-quizzes';

describe('Tsintskaro history quizzes', () => {
  it('adds a topic context line to every question', () => {
    TSINTSKARO_HISTORY_QUIZZES.forEach((quiz, index) => {
      const context = getHistoryQuizContext(index);
      const formattedQuestion = formatHistoryQuizQuestion(quiz, index);

      expect(context).not.toBeNull();
      expect(formattedQuestion).toBe(`${context}\n${quiz.question}`);
    });
  });

  it('keeps Telegram quiz text within API limits', () => {
    TSINTSKARO_HISTORY_QUIZZES.forEach((quiz, index) => {
      expect(formatHistoryQuizQuestion(quiz, index).length).toBeLessThanOrEqual(
        MAX_TELEGRAM_QUIZ_QUESTION_LENGTH,
      );
      expect(
        formatHistoryQuizExplanation(quiz.explanation).length,
      ).toBeLessThanOrEqual(MAX_TELEGRAM_QUIZ_EXPLANATION_LENGTH);
    });
  });

  it('includes explicit context for the Pontus hellenization question', () => {
    const quizIndex = 9;
    const formattedQuestion = formatHistoryQuizQuestion(
      TSINTSKARO_HISTORY_QUIZZES[quizIndex],
      quizIndex,
    );

    expect(formattedQuestion).toContain('Понт и Трапезунд');
    expect(formattedQuestion).toContain('в Понте');
  });
});
