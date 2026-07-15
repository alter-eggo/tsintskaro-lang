import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { CompletionUsage } from 'openai/resources/completions';
import { And, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { OpenaiUsageLog } from './entities/openai-usage-log.entity';
import { OpenaiUsageReportConfig } from './entities/openai-usage-report-config.entity';

export const OPENAI_USAGE_REPORT_TIME_ZONE = 'Asia/Tbilisi';

export type OpenaiUsagePurpose =
  | 'bot_mention'
  | 'dictionary_normalization'
  | 'message_analysis'
  | 'list_compilation'
  | 'discussion_report';

interface RecordUsageInput {
  purpose: OpenaiUsagePurpose;
  detail: string;
  model: string;
  usage?: CompletionUsage | null;
  metadata?: Record<string, unknown>;
}

interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

const PURPOSE_LABELS: Record<OpenaiUsagePurpose, string> = {
  bot_mention: 'обращения к боту',
  dictionary_normalization: 'разбор слов для словаря',
  message_analysis: 'поиск диалектных слов',
  list_compilation: 'составление списка',
  discussion_report: 'отчёты по обсуждениям',
};

@Injectable()
export class OpenaiUsageService {
  private readonly logger = new Logger(OpenaiUsageService.name);

  constructor(
    @InjectRepository(OpenaiUsageLog)
    private readonly usageRepo: Repository<OpenaiUsageLog>,
    @InjectRepository(OpenaiUsageReportConfig)
    private readonly reportConfigRepo: Repository<OpenaiUsageReportConfig>,
  ) {}

  async record(input: RecordUsageInput): Promise<void> {
    if (!input.usage) {
      this.logger.warn(
        `OpenAI usage missing for ${input.purpose}: ${input.detail}`,
      );
      return;
    }

    const promptTokens = input.usage.prompt_tokens ?? 0;
    const completionTokens = input.usage.completion_tokens ?? 0;
    const totalTokens =
      input.usage.total_tokens ?? promptTokens + completionTokens;

    await this.usageRepo.save(
      this.usageRepo.create({
        purpose: input.purpose,
        detail: this.truncate(input.detail, 512),
        model: input.model,
        promptTokens,
        completionTokens,
        totalTokens,
        rawUsage: input.usage as unknown as Record<string, unknown>,
        metadata: input.metadata ?? {},
      }),
    );
  }

  async setReportTarget(
    chatId: number,
    threadId: number | null,
    recipientUsername: string | null,
    setBy: string | null,
  ): Promise<OpenaiUsageReportConfig> {
    await this.reportConfigRepo.clear();
    return this.reportConfigRepo.save(
      this.reportConfigRepo.create({
        chatId,
        threadId,
        recipientUsername,
        setBy,
      }),
    );
  }

  async clearReportTarget(): Promise<void> {
    await this.reportConfigRepo.clear();
  }

  async getReportTarget(): Promise<OpenaiUsageReportConfig | null> {
    const rows = await this.reportConfigRepo.find({
      order: { setAt: 'DESC' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  getCalendarDayRange(
    date = new Date(),
    timeZone = OPENAI_USAGE_REPORT_TIME_ZONE,
    dayOffset = 0,
  ): { start: Date; end: Date; label: string } {
    const currentParts = this.getZonedDateParts(date, timeZone);
    const targetNoonUtc = new Date(
      Date.UTC(
        currentParts.year,
        currentParts.month - 1,
        currentParts.day + dayOffset,
        12,
      ),
    );
    const target = this.getZonedDateParts(targetNoonUtc, timeZone);
    const nextNoonUtc = new Date(
      Date.UTC(target.year, target.month - 1, target.day + 1, 12),
    );
    const next = this.getZonedDateParts(nextNoonUtc, timeZone);

    const label = this.formatYmd(target);
    return {
      start: this.zonedMidnightToUtc(target, timeZone),
      end: this.zonedMidnightToUtc(next, timeZone),
      label,
    };
  }

  async buildReport(
    start: Date,
    end: Date,
    timeZone = OPENAI_USAGE_REPORT_TIME_ZONE,
    title = 'Отчёт по OpenAI токенам',
  ): Promise<string> {
    const logs = await this.usageRepo.find({
      where: { createdAt: And(MoreThanOrEqual(start), LessThan(end)) },
      order: { totalTokens: 'DESC', createdAt: 'DESC' },
    });

    const period = `${this.formatDateTime(start, timeZone)} - ${this.formatDateTime(end, timeZone)}`;
    if (logs.length === 0) {
      return `${title}\nПериод: ${period}\n\nЗапросов к OpenAI за этот период не было.`;
    }

    const total = this.sum(logs);
    const p95TotalTokens = this.percentile(
      logs.map((log) => log.totalTokens),
      0.95,
    );
    const byPurpose = this.groupBy(logs, (log) => log.purpose);
    const byModel = this.groupBy(logs, (log) => log.model);
    const detailsLimit = 20;
    const details = logs.slice(0, detailsLimit);

    const lines = [
      title,
      `Период: ${period}`,
      '',
      `Итого: ${this.formatNumber(total.totalTokens)} токенов за ${total.requests} запросов`,
      `Вход: ${this.formatNumber(total.promptTokens)}`,
      `Ответ: ${this.formatNumber(total.completionTokens)}`,
      `Из кэша: ${this.formatNumber(total.cachedTokens)} (${this.formatPercent(total.cachedTokens, total.promptTokens)} входа)`,
      `Reasoning: ${this.formatNumber(total.reasoningTokens)}`,
      `p95 на запрос: ${this.formatNumber(p95TotalTokens)} токенов`,
      '',
      'По задачам:',
      ...this.formatGroupedTotals(byPurpose, true),
      '',
      'По моделям:',
      ...this.formatGroupedTotals(byModel, false),
      '',
      'Конкретные операции:',
      ...details.map((log, index) =>
        this.formatUsageDetail(log, index + 1, timeZone),
      ),
    ];

    if (logs.length > detailsLimit) {
      lines.push(`...и ещё ${logs.length - detailsLimit} операций.`);
    }

    return lines.join('\n');
  }

  private sum(logs: OpenaiUsageLog[]): UsageTotals {
    return logs.reduce(
      (acc, log) => ({
        requests: acc.requests + 1,
        promptTokens: acc.promptTokens + log.promptTokens,
        completionTokens: acc.completionTokens + log.completionTokens,
        totalTokens: acc.totalTokens + log.totalTokens,
        cachedTokens: acc.cachedTokens + this.getCachedTokens(log),
        reasoningTokens: acc.reasoningTokens + this.getReasoningTokens(log),
      }),
      {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
      },
    );
  }

  private groupBy(
    logs: OpenaiUsageLog[],
    keySelector: (log: OpenaiUsageLog) => string,
  ): Array<{ key: string; totals: UsageTotals }> {
    const groups = new Map<string, OpenaiUsageLog[]>();
    for (const log of logs) {
      const key = keySelector(log);
      groups.set(key, [...(groups.get(key) ?? []), log]);
    }

    return [...groups.entries()]
      .map(([key, groupedLogs]) => ({ key, totals: this.sum(groupedLogs) }))
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
  }

  private formatGroupedTotals(
    groups: Array<{ key: string; totals: UsageTotals }>,
    usePurposeLabels: boolean,
  ): string[] {
    return groups.map(({ key, totals }, index) => {
      const label =
        usePurposeLabels && key in PURPOSE_LABELS
          ? PURPOSE_LABELS[key as OpenaiUsagePurpose]
          : key;
      return `${index + 1}. ${label}: ${this.formatNumber(totals.totalTokens)} токенов (${totals.requests} запросов; вход ${this.formatNumber(totals.promptTokens)}, ответ ${this.formatNumber(totals.completionTokens)}, кэш ${this.formatNumber(totals.cachedTokens)}, reasoning ${this.formatNumber(totals.reasoningTokens)})`;
    });
  }

  private formatUsageDetail(
    log: OpenaiUsageLog,
    index: number,
    timeZone: string,
  ): string {
    const purpose =
      log.purpose in PURPOSE_LABELS
        ? PURPOSE_LABELS[log.purpose as OpenaiUsagePurpose]
        : log.purpose;
    const cachedTokens = this.getCachedTokens(log);
    const reasoningTokens = this.getReasoningTokens(log);
    const metadata = this.formatMetadata(log.metadata);
    return `${index}. ${this.formatDateTime(log.createdAt, timeZone)} | ${purpose}: ${log.detail}\n   ${this.formatNumber(log.totalTokens)} токенов (вход ${this.formatNumber(log.promptTokens)}, ответ ${this.formatNumber(log.completionTokens)}, кэш ${this.formatNumber(cachedTokens)}, reasoning ${this.formatNumber(reasoningTokens)}), ${log.model}${metadata}`;
  }

  private getCachedTokens(log: OpenaiUsageLog): number {
    return this.getNestedUsageNumber(log.rawUsage, [
      'prompt_tokens_details',
      'cached_tokens',
    ]);
  }

  private getReasoningTokens(log: OpenaiUsageLog): number {
    return this.getNestedUsageNumber(log.rawUsage, [
      'completion_tokens_details',
      'reasoning_tokens',
    ]);
  }

  private getNestedUsageNumber(
    value: Record<string, unknown> | null | undefined,
    path: string[],
  ): number {
    let current: unknown = value;
    for (const key of path) {
      if (!current || typeof current !== 'object') return 0;
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === 'number' && Number.isFinite(current)
      ? current
      : 0;
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * percentile) - 1),
    );
    return sorted[index];
  }

  private formatPercent(part: number, total: number): string {
    if (total <= 0) return '0%';
    return `${Math.round((part / total) * 100)}%`;
  }

  private formatMetadata(metadata: Record<string, unknown>): string {
    const fields = [
      ['messages', metadata?.messagesCount],
      ['словарь', metadata?.dictionaryEntries],
      ['символы', metadata?.inputTextLength],
      ['reasoning', metadata?.reasoningEffort],
      ['лимит', metadata?.maxCompletionTokens],
    ]
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([label, value]) => `${label}=${String(value)}`);
    return fields.length > 0 ? `; ${fields.join(', ')}` : '';
  }

  private formatDateTime(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('ru-RU').format(value);
  }

  private truncate(value: string, maxLength: number): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 1)}…`;
  }

  private formatYmd(parts: {
    year: number;
    month: number;
    day: number;
  }): string {
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
      parts.day,
    ).padStart(2, '0')}`;
  }

  private getZonedDateParts(
    date: Date,
    timeZone: string,
  ): { year: number; month: number; day: number } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    return {
      year: Number(parts.find((p) => p.type === 'year')?.value),
      month: Number(parts.find((p) => p.type === 'month')?.value),
      day: Number(parts.find((p) => p.type === 'day')?.value),
    };
  }

  private getZonedDateTimeParts(
    date: Date,
    timeZone: string,
  ): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);

    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value);

    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour') === 24 ? 0 : get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }

  private zonedMidnightToUtc(
    target: { year: number; month: number; day: number },
    timeZone: string,
  ): Date {
    const desiredUtc = Date.UTC(target.year, target.month - 1, target.day);
    let candidate = new Date(desiredUtc);

    for (let i = 0; i < 3; i += 1) {
      const actual = this.getZonedDateTimeParts(candidate, timeZone);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
      candidate = new Date(candidate.getTime() + desiredUtc - actualAsUtc);
    }

    return candidate;
  }
}
