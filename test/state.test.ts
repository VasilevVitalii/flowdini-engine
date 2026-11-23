import { describe, expect, it } from 'vitest';
import { textToStructure } from 'flowdini-spec';
import { fixReference, isDone, reviewFixIterations, sections, isAccept, acceptOf } from '../src/state.js';

const s = (t: string) => textToStructure(t, true);

describe('reviewFixIterations', () => {
  it('пустой журнал — 0', () => {
    expect(reviewFixIterations(s(''))).toBe(0);
  });

  it('ISSUE без FIX — 0', () => {
    expect(reviewFixIterations(s('# ISSUE 1\n\nbody\n'))).toBe(0);
  });

  it('одинокий REVIEW без FIX не считается — 0', () => {
    expect(reviewFixIterations(s('# ISSUE 1\n\nb\n\n# REVIEW 1\n\nb\n'))).toBe(0);
  });

  it('ISSUE + REVIEW + FIX с fd-reply — 1', () => {
    const j = [
      '# ISSUE 1', '', 'b', '',
      '# REVIEW 1', '',
      '## BUG 1',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
      '', 'bug', '',
      '# FIX 1', '',
      '## BUG 1',
      '[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW 1#BUG 1]]]',
      '', 'fixed',
    ].join('\n');
    expect(reviewFixIterations(s(j))).toBe(1);
  });

  it('две завершённые итерации — 2', () => {
    const fix = (review: number, bug: number) => [
      `# FIX ${review}`, '',
      `## BUG ${bug}`,
      `[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW ${review}#BUG ${bug}]]]`,
      '', 'fixed',
    ].join('\n');
    const j = [
      '# ISSUE 1', '', 'b', '',
      '# REVIEW 1', '',
      '## BUG 1',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
      '', 'bug', '',
      fix(1, 1), '',
      '# REVIEW 2', '',
      '## BUG 1',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#FIX 1#BUG 1]]]',
      '', 'bug', '',
      fix(2, 1),
    ].join('\n');
    expect(reviewFixIterations(s(j))).toBe(2);
  });

  it('fixMode:item — несколько FIX на один REVIEW = одна итерация', () => {
    const fix = (bug: number) => [
      `# FIX ${bug}`, '',
      `## BUG ${bug}`,
      `[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW 1#BUG ${bug}]]]`,
      '', `fixed ${bug}`,
    ].join('\n');
    const j = [
      '# ISSUE 1', '', 'b', '',
      '# REVIEW 1', '',
      '## BUG 1',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
      '', 'bug1', '',
      '## BUG 2',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
      '', 'bug2', '',
      fix(1), '',
      fix(2),
    ].join('\n');
    expect(reviewFixIterations(s(j))).toBe(1);
  });

  it('QUESTIONS сбрасывает счётчик', () => {
    const fix = (bug: number) => [
      `# FIX ${bug}`, '',
      `## BUG ${bug}`,
      `[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW 1#BUG ${bug}]]]`,
      '', 'fixed',
    ].join('\n');
    const j = [
      '# ISSUE 1', '', 'b', '',
      '# REVIEW 1', '',
      '## BUG 1',
      '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
      '', 'bug', '',
      fix(1), '',
      '# QUESTIONS 1', '', 'b', '',
      fix(2),
    ].join('\n');
    expect(reviewFixIterations(s(j))).toBe(0);
  });

  it('## A (ответ человека на Q) без FIX-подзаголовка не считается итерацией', () => {
    const j = [
      '# ISSUE 1', '', 'b', '',
      '# REVIEW 1', '',
      '## Q 1',
      '[fd-to:: HUMAN.CODER]',
      '', 'продолжать?', '',
      '# FIX 1', '',
      '## A 1',
      '[fd-from:: HUMAN.CODER] [fd-reply:: [[#REVIEW 1#Q 1]]]',
      '', '+',
    ].join('\n');
    expect(reviewFixIterations(s(j))).toBe(0);
  });
});

describe('isDone', () => {
  it('нет DONE — false', () => {
    expect(isDone(s('# ISSUE 1\n\nb\n'))).toBe(false);
  });

  it('последний DONE — true', () => {
    expect(isDone(s('# ISSUE 1\n\nb\n\n# DONE 1\n\nb\n'))).toBe(true);
  });
});

describe('sections', () => {
  it('группирует L1 и подзаголовки L2', () => {
    const c = s('# ISSUE 1\n\n## OBJECT 1\n\nb\n\n## OBJECT 2\n\nb\n\n# REVIEW 1\n\n## BUG 1\n\nb\n');
    const secs = sections(c);
    expect(secs.map((x) => x.l1.title)).toEqual(['ISSUE', 'REVIEW']);
    expect(secs[0].l2s.map((x) => `${x.title} ${x.idx}`)).toEqual(['OBJECT 1', 'OBJECT 2']);
    expect(secs[1].l2s.map((x) => `${x.title} ${x.idx}`)).toEqual(['BUG 1']);
  });
});

describe('fixReference', () => {
  const journal = [
    '# CODE 1',
    '[fd-from:: AI.CODER.JUNIOR] [fd-createdAt:: 2026-11-19T19:45:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#ISSUE 2]]]',
    '', 'code', '',
    '# REVIEW 1', '',
    '## BUG 1',
    '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
    '', 'bug one', '',
    '## BUG 2',
    '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
    '', 'bug two', '',
    '## RISK 3',
    '[fd-from:: AI.REVIEWER] [fd-createdAt:: 2026-11-19T20:09:00Z] [fd-to:: AI.CODER] [fd-reply:: [[#CODE 1]]]',
    '', 'risk three', '',
    '# FIX 1', '',
    '## BUG 1',
    '[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW 1#BUG 1]]]',
    '', 'fixed one', '',
    '## BUG 2',
    '[fd-from:: AI.CODER.SENIOR] [fd-createdAt:: 2026-11-19T20:12:00Z] [fd-to:: AI.REVIEWER] [fd-reply:: [[#REVIEW 1#BUG 2]]]',
    '', 'fixed two',
  ].join('\n');

  it('L1-дуга — пусто', () => {
    expect(fixReference(s(journal), 'REVIEW 1')).toBe('');
  });

  it('не-REVIEW — пусто', () => {
    expect(fixReference(s(journal), 'CODE 1#BUG 1')).toBe('');
  });

  it('первый пункт — пусто (нет предыдущих)', () => {
    expect(fixReference(s(journal), 'REVIEW 1#BUG 1')).toBe('');
  });

  it('собирает предыдущие замечания + фиксы того же типа', () => {
    const r = fixReference(s(journal), 'REVIEW 1#BUG 2');
    expect(r).toContain('Замечание «BUG 1»');
    expect(r).toContain('bug one');
    expect(r).toContain('Ответ кодера');
    expect(r).toContain('fixed one');
    expect(r).not.toContain('bug two');
    expect(r).not.toContain('risk three');
  });

  it('другой тип подзаголовка — только свои предыдущие (их нет → пусто)', () => {
    expect(fixReference(s(journal), 'REVIEW 1#RISK 3')).toBe('');
  });
});

describe('isAccept', () => {
  it('ровно `+` (с пробелами/переносом) — accept', () => {
    expect(isAccept('+')).toBe(true);
    expect(isAccept(' +\n')).toBe(true);
  });

  it('иное («+1», «да», «ок», текст) — не accept', () => {
    expect(isAccept('+1')).toBe(false);
    expect(isAccept('да')).toBe(false);
    expect(isAccept('ок')).toBe(false);
    expect(isAccept('нет, в общем логе')).toBe(false);
  });

  it('null (нет тела) — не accept', () => {
    expect(isAccept(null)).toBe(false);
  });
});

describe('acceptOf', () => {
  const answers = [
    '# ANSWERS 1', '',
    '## A 1',
    '[fd-from:: HUMAN.ANALYST] [fd-to:: AI.ANALYST] [fd-reply:: [[#QUESTIONS 1#Q 1]]]',
    '', '+',
    '',
    '## A 2',
    '[fd-from:: HUMAN.ANALYST] [fd-to:: AI.ANALYST] [fd-reply:: [[#QUESTIONS 1#Q 2]]]',
    '', 'да',
  ].join('\n');

  it('`+` — true', () => {
    expect(acceptOf(s(answers), 'ANSWERS 1#A 1')).toBe(true);
  });

  it('иной ответ — false', () => {
    expect(acceptOf(s(answers), 'ANSWERS 1#A 2')).toBe(false);
  });

  it('не ANSWERS (ISSUE) — null', () => {
    const c = s('# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nb\n');
    expect(acceptOf(c, 'ISSUE 1')).toBeNull();
  });

  it('fd-from не HUMAN — null', () => {
    const c = s('# ANSWERS 1\n\n## A 1\n[fd-from:: AI.ANALYST]\n\nb\n');
    expect(acceptOf(c, 'ANSWERS 1#A 1')).toBeNull();
  });

  it('нет такого адреса — null', () => {
    expect(acceptOf(s(answers), 'ANSWERS 1#A 9')).toBeNull();
  });

  it('fd-from HUMANITY.* (похоже, но не HUMAN) — null', () => {
    const c = s('# ANSWERS 1\n\n## A 1\n[fd-from:: HUMANITY.CODER]\n\n+\n');
    expect(acceptOf(c, 'ANSWERS 1#A 1')).toBeNull();
  });
});
