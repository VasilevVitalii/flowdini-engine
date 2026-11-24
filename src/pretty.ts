import { inlineFieldToText, levelToText, preambleToText, topicHeading } from 'flowdini-spec';
import type { TFdContent, TFdInlineField, TFdItem } from 'flowdini-spec';

/** Текущее время в UTC (ISO) для канона `fd-createdAt` (`YYYY-MM-DDTHH:MM:SSZ`). */
export function nowStamp(now: () => Date): string {
  return now().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Свойства топика в каноническом порядке: `fd-from`, `fd-createdAt`, `fd-to`,
 * `fd-reply`, затем остальные в исходном порядке. `fd-createdAt` добавляется
 * с текущим временем, если его нет и у топика есть `fd-from` (сообщение).
 * Вызывается только для топиков с телом (`text !== null`) — контейнеры
 * свойств (и `fd-createdAt`) не получают.
 */
function orderFields(
  fields: TFdInlineField[],
  addCreatedAt: boolean,
  now: () => Date,
): TFdInlineField[] {
  const from: TFdInlineField[] = [];
  const createdAt: TFdInlineField[] = [];
  const to: TFdInlineField[] = [];
  const reply: TFdInlineField[] = [];
  const rest: TFdInlineField[] = [];
  for (const f of fields) {
    switch (f.param) {
      case 'fd-from':
        from.push(f);
        break;
      case 'fd-createdAt':
        createdAt.push(f);
        break;
      case 'fd-to':
        to.push(f);
        break;
      case 'fd-reply':
        reply.push(f);
        break;
      default:
        rest.push(f);
    }
  }
  if (addCreatedAt) {
    createdAt.push({ param: 'fd-createdAt', valueList: [nowStamp(now)], source: 'topic' });
  }
  return [...from, ...createdAt, ...to, ...reply, ...rest];
}

/** Один топик: заголовок, свойства одной строкой, пустая строка, тело (если есть). */
function prettyItem(item: TFdItem, now: () => Date): string {
  const { topic } = item;
  const th = topicHeading(topic);
  if (th === null) return '';
  const head = levelToText(th.heading, th.level);

  // `fd-createdAt` считается существующим, если он есть в любом поле топика
  // (не только в свойствах `topic`) — иначе он продублируется.
  const hasCreatedAt = topic.inlineList.some((f) => f.param === 'fd-createdAt');
  const hasFrom = topic.inlineList.some((f) => f.param === 'fd-from');
  const propLine = orderFields(
    topic.inlineList.filter((f) => f.source === 'topic'),
    item.text !== null && hasFrom && !hasCreatedAt,
    now,
  )
    .map(inlineFieldToText)
    .join(' ');
  const lines = [head];
  if (propLine !== '') lines.push(propLine);
  if (item.text !== null) lines.push('', item.text.trimEnd());
  return lines.join('\n');
}

/**
 * Каноническое форматирование контента для записи в файл.
 *
 * Правила:
 * 1. перед каждым заголовком — одна пустая строка, если выше есть контент;
 * 2. после заголовка — свойства одной строкой, затем пустая строка, затем тело;
 * 3. порядок свойств: `fd-from`, `fd-createdAt` (создаётся, если нет и есть
 *    `fd-from`), `fd-to`, `fd-reply`, затем остальные в исходном порядке.
 *
 * `now` — источник времени для создаваемого `fd-createdAt` (по умолчанию текущее
 * время); передаётся для детерминированного вывода в тестах и кеше.
 */
export function contentPretty(content: TFdContent, now: () => Date = () => new Date()): string {
  const segments: string[] = [];
  // Преамбула — точный порядок из `preamble` (парсер заполняет сегментами), иначе
  // откат на `text` + `inlineList` (структуры, собранные вручную).
  const preamble = preambleToText(content).trimEnd();
  if (preamble !== '') segments.push(preamble);
  for (const item of content.itemList) {
    const s = prettyItem(item, now);
    if (s !== '') segments.push(s);
  }
  return segments.join('\n\n');
}
