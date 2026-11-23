import type { TFdContent, TFdItem, TFdLevel } from 'flowdini-spec';
import { extractLinks, parseAddr, topicAddr, topicFields } from './addr.js';
import { roleCovers } from './role.js';
import { contentPretty } from './pretty.js';

/** Заголовки уровня 1 в порядке появления. */
export function level1List(content: TFdContent): TFdLevel[] {
  const out: TFdLevel[] = [];
  let cur: string | null = null;
  for (const item of content.itemList) {
    const l1 = item.topic.level1;
    if (l1 === null) continue;
    const key = `${l1.title}\u0000${l1.idx}`;
    if (key !== cur) {
      out.push(l1);
      cur = key;
    }
  }
  return out;
}

/** Секция уровня 1 с её подзаголовками уровня 2 (в порядке появления). */
export interface TFdSection {
  l1: TFdLevel;
  l2s: TFdLevel[];
}

/** Разбить контент на секции уровня 1; у каждой — подзаголовки уровня 2. */
export function sections(content: TFdContent): TFdSection[] {
  const out: TFdSection[] = [];
  let cur: TFdSection | null = null;
  let lastL2: string | null = null;
  for (const item of content.itemList) {
    const l1 = item.topic.level1;
    if (l1 === null) continue;
    const l1Key = `${l1.title}\u0000${l1.idx}`;
    if (cur === null || l1Key !== `${cur.l1.title}\u0000${cur.l1.idx}`) {
      cur = { l1, l2s: [] };
      out.push(cur);
      lastL2 = null;
    }
    const l2 = item.topic.level2;
    if (l2 !== null) {
      const k = `${l2.title}\u0000${l2.idx}`;
      if (k !== lastL2) {
        cur.l2s.push(l2);
        lastL2 = k;
      }
    }
  }
  return out;
}

/**
 * Число завершённых итераций REVIEW→FIX с последнего прерывания
 * (`ISSUE`/`QUESTIONS`/`DONE` сбрасывают счётчик). Итерация = REVIEW, на который
 * есть хотя бы один FIX-ответ (`fd-reply` на подзаголовок этого REVIEW).
 * Считаем по REVIEW, а не по FIX, чтобы `fixMode: item` (несколько FIX на один
 * REVIEW) не завышал порог: цикл «REVIEW → все его фиксы» — одна итерация.
 * Одинокий REVIEW без FIX счётчик не двигает.
 * Производное состояние журнала: порог — настройка SPEC, счётчик в md не хранится.
 */
export function reviewFixIterations(content: TFdContent): number {
  // REVIEW-разделы, на которые ответил FIX (по fd-reply в подзаголовках FIX).
  const answered = new Set<string>();
  for (const item of content.itemList) {
    if (item.topic.level1 === null || item.topic.level1.title !== 'FIX') continue;
    if (item.topic.level2 !== null && item.topic.level2.title === 'A') continue; // ## A — ответ человека на Q, не FIX-итерация
    for (const v of topicFields(item.topic, 'fd-reply')) {
      for (const raw of extractLinks(v)) {
        const p = parseAddr(raw);
        if (p === null || p.filePath !== '' || p.parts.length === 0) continue;
        const [title] = p.parts[0].split(' ');
        if (title === 'REVIEW') answered.add(p.parts[0]);
      }
    }
  }
  let count = 0;
  for (const l1 of level1List(content)) {
    switch (l1.title) {
      case 'ISSUE':
      case 'QUESTIONS':
      case 'DONE':
        count = 0;
        break;
      case 'REVIEW':
        if (answered.has(`${l1.title} ${l1.idx}`)) count += 1;
        break;
    }
  }
  return count;
}

/** Таск завершён: последний L1-раздел — `# DONE n` (терминальный). */
export function isDone(content: TFdContent): boolean {
  const l1s = level1List(content);
  return l1s.length > 0 && l1s[l1s.length - 1].title === 'DONE';
}

/** Таск в аварийном состоянии: в журнале есть `# CRASH n` (терминальный маркер, процесс стоит). */
export function isCrashed(content: TFdContent): boolean {
  return level1List(content).some((l) => l.title === 'CRASH');
}

/** Items одного подзаголовка (`level1` + `level2` совпадают). */
function itemsOfL2(content: TFdContent, l1: TFdLevel, l2: TFdLevel): TFdItem[] {
  return content.itemList.filter(
    (item) =>
      item.topic.level1 !== null &&
      item.topic.level1.title === l1.title &&
      item.topic.level1.idx === l1.idx &&
      item.topic.level2 !== null &&
      item.topic.level2.title === l2.title &&
      item.topic.level2.idx === l2.idx,
  );
}

/** FIX-ответ на адрес подзаголовка: items с `level1 = FIX` и `fd-reply` на `addr`. */
function fixItemsFor(content: TFdContent, addr: string): TFdItem[] {
  return content.itemList.filter((item) => {
    if (item.topic.level1 === null || item.topic.level1.title !== 'FIX') return false;
    for (const v of topicFields(item.topic, 'fd-reply')) {
      for (const raw of extractLinks(v)) {
        const p = parseAddr(raw);
        if (p !== null && p.filePath === '' && p.parts.join('#') === addr) return true;
      }
    }
    return false;
  });
}

/**
 * Справка кодеру для `fixMode: item`: предыдущие пункты этого REVIEW
 * (замечание целиком) и ответы кодера на них (фикс целиком), в порядке
 * документа. `arcAddr` — адрес текущей дуги (`REVIEW 1#BUG 3`); берутся
 * подзаголовки того же типа (`BUG`) с меньшим номером. Для L1-дуги или не-REVIEW
 * возвращает `''` (справки нет).
 */
export function fixReference(content: TFdContent, arcAddr: string): string {
  const seg = arcAddr.split('#');
  if (seg.length < 2) return '';
  const l1m = /^(\S+)\s+(\d+)$/.exec(seg[0]);
  const l2m = /^(\S+)\s+(\d+)$/.exec(seg[1]);
  if (l1m === null || l2m === null) return '';
  const l1Title = l1m[1];
  const l1Idx = Number(l1m[2]);
  const l2Title = l2m[1];
  const l2Idx = Number(l2m[2]);
  if (l1Title !== 'REVIEW') return '';

  const l1: TFdLevel = { title: l1Title, idx: l1Idx };
  const seen = new Set<string>();
  const prev: TFdLevel[] = [];
  for (const item of content.itemList) {
    const t = item.topic;
    if (t.level1 === null || t.level1.title !== l1Title || t.level1.idx !== l1Idx) continue;
    if (t.level2 === null) continue;
    if (t.level2.title !== l2Title || t.level2.idx >= l2Idx) continue;
    const key = `${t.level2.title}\u0000${t.level2.idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    prev.push(t.level2);
  }

  const chunks: string[] = [];
  for (const l2 of prev) {
    const addr2 = `${l1Title} ${l1Idx}#${l2.title} ${l2.idx}`;
    const note = itemsOfL2(content, l1, l2);
    const fix = fixItemsFor(content, addr2);
    const parts: string[] = [];
    if (note.length > 0) {
      parts.push(`Замечание «${l2.title} ${l2.idx}»:`);
      parts.push(contentPretty({ inlineList: [], itemList: note, text: null }).trimEnd());
    }
    if (fix.length > 0) {
      parts.push('Ответ кодера:');
      parts.push(contentPretty({ inlineList: [], itemList: fix, text: null }).trimEnd());
    }
    if (parts.length > 0) chunks.push(parts.join('\n\n'));
  }
  return chunks.join('\n\n');
}

/**
 * Детерминированный accept ответа человека: тело ровно `+` (после trim).
 * Любой иной ответ («да», «ок», замечания) — не accept, его разбирает `AI.ANALYST`.
 */
export function isAccept(text: string | null): boolean {
  return text !== null && text.trim() === '+';
}

/**
 * Детерминированный accept дуги-ответа человека (`ANSWERS n#A m`, `fd-from` HUMAN.*):
 * тело ровно `+` → `true`; иной ответ человека → `false`; дуга не ответ человека
 * (не `ANSWERS` или `fd-from` не HUMAN.*) → `null`.
 */
export function acceptOf(content: TFdContent, arcAddr: string): boolean | null {
  for (const item of content.itemList) {
    if (topicAddr(item.topic) !== arcAddr) continue;
    const l1 = item.topic.level1;
    if (l1 === null || l1.title !== 'ANSWERS') return null;
    const from = topicFields(item.topic, 'fd-from');
    if (!from.some((v) => roleCovers('HUMAN', v))) return null;
    return isAccept(item.text);
  }
  return null;
}
