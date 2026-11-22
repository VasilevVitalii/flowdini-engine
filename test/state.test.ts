import { describe, expect, it } from 'vitest';
import { textToStructure } from 'flowdini-spec';
import { isDone, reviewFixIterations, sections } from '../src/state.js';

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

  it('ISSUE + REVIEW + FIX — 1', () => {
    expect(reviewFixIterations(s('# ISSUE 1\n\nb\n\n# REVIEW 1\n\nb\n\n# FIX 1\n\nb\n'))).toBe(1);
  });

  it('две завершённые итерации — 2', () => {
    expect(reviewFixIterations(s('# ISSUE 1\n\nb\n\n# REVIEW 1\n\nb\n\n# FIX 1\n\nb\n\n# REVIEW 2\n\nb\n\n# FIX 2\n\nb\n'))).toBe(2);
  });

  it('QUESTIONS сбрасывает счётчик', () => {
    expect(reviewFixIterations(s('# ISSUE 1\n\nb\n\n# REVIEW 1\n\nb\n\n# FIX 1\n\nb\n\n# QUESTIONS 1\n\nb\n\n# FIX 2\n\nb\n'))).toBe(1);
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
