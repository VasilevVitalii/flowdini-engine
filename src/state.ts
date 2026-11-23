import type { TFdContent, TFdLevel } from 'flowdini-spec';

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
 * (`ISSUE`/`QUESTIONS`/`DONE` сбрасывают счётчик). Итерация засчитывается по
 * `FIX` (один на итерацию) — одинокий `REVIEW` без `FIX` счётчик не двигает.
 * Производное состояние журнала: порог — настройка SPEC, счётчик в md не хранится.
 */
export function reviewFixIterations(content: TFdContent): number {
  let count = 0;
  for (const l1 of level1List(content)) {
    switch (l1.title) {
      case 'ISSUE':
      case 'QUESTIONS':
      case 'DONE':
        count = 0;
        break;
      case 'FIX':
        count += 1;
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
