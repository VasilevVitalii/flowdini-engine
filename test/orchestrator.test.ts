import { textToStructure } from 'flowdini-spec';
import type { TFdContent } from 'flowdini-spec';
import { describe, expect, it } from 'vitest';
import { gateDue, nextStep, openArcs, roleBrief } from '../src/orchestrator.js';
import { isCrashed } from '../src/state.js';
import { parseSpec } from '../src/spec.js';

function contentOf(md: string): TFdContent {
  return textToStructure(md, true);
}

describe('openArcs', () => {
  it('fd-to без fd-reply — открыта; с fd-reply — закрыта', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

body

# QUESTIONS 1

## Q 1
[fd-from:: AI.ANALYST]
[fd-to:: HUMAN.ANALYST]

body

# ANSWERS 1

## A 1
[fd-from:: HUMAN.ANALYST]
[fd-to:: AI.ANALYST]
[fd-reply:: [[#QUESTIONS 1#Q 1]]]

body
`);
    expect(openArcs(c)).toEqual([
      { addr: 'ISSUE 1', from: ['AI.WRITER'], to: ['AI.ANALYST'] },
      { addr: 'ANSWERS 1#A 1', from: ['HUMAN.ANALYST'], to: ['AI.ANALYST'] },
    ]);
  });

  it('подтопики FIX → AI.REVIEWER открыты', () => {
    const c = contentOf(`# FIX 1

## BUG 1
[fd-from:: AI.CODER.SENIOR]
[fd-to:: AI.REVIEWER]

fixed
`);
    expect(openArcs(c)).toEqual([{ addr: 'FIX 1#BUG 1', from: ['AI.CODER.SENIOR'], to: ['AI.REVIEWER'] }]);
  });

  it('fd-reply от не-адресата не закрывает дугу', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

body

# QUESTIONS 1

## Q 1
[fd-from:: AI.ANALYST]
[fd-to:: HUMAN.CODER]

body

# ANSWERS 1

## A 1
[fd-from:: HUMAN.ANALYST]
[fd-to:: AI.ANALYST]
[fd-reply:: [[#QUESTIONS 1#Q 1]]]

body
`);
    // Q 1 адресована HUMAN.CODER, а ответил HUMAN.ANALYST → дуга остаётся открытой.
    expect(openArcs(c).map((a) => a.addr)).toEqual(['ISSUE 1', 'QUESTIONS 1#Q 1', 'ANSWERS 1#A 1']);
  });

  it('рулевой ISSUE от HUMAN перебивает старые открытые дуги', () => {
    const c = contentOf(`# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body

# ISSUE 2
[fd-from:: HUMAN.CODER]
[fd-to:: AI.ANALYST]

сменить курс
`);
    // CODE 1 → AI.REVIEWER перебит; осталась только дуга рулевого ISSUE.
    expect(openArcs(c).map((a) => a.addr)).toEqual(['ISSUE 2']);
  });

  it('дуги ПОСЛЕ рулевого ISSUE остаются в игре', () => {
    const c = contentOf(`# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body

# ISSUE 2
[fd-from:: HUMAN.CODER]
[fd-to:: AI.ANALYST]

сменить курс

# CODE 2
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body2
`);
    expect(openArcs(c).map((a) => a.addr)).toEqual(['ISSUE 2', 'CODE 2']);
  });

  it('ISSUE от AI.WRITER (не HUMAN) дуги НЕ перебивает', () => {
    const c = contentOf(`# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body

# ISSUE 2
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

постановка
`);
    expect(openArcs(c).map((a) => a.addr)).toEqual(['CODE 1', 'ISSUE 2']);
  });

  it('последний рулевой ISSUE отменяет всё до него, включая предыдущий рулевой', () => {
    const c = contentOf(`# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body

# ISSUE 2
[fd-from:: HUMAN.CODER]
[fd-to:: AI.ANALYST]

курс 1

# CODE 3
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

body3

# ISSUE 4
[fd-from:: HUMAN.CODER]
[fd-to:: AI.ANALYST]

курс 2
`);
    // Всё до ISSUE 4 (включая ISSUE 2 и CODE 3) перебито; осталась только ISSUE 4.
    expect(openArcs(c).map((a) => a.addr)).toEqual(['ISSUE 4']);
  });
});

describe('nextStep', () => {
  it('HUMAN-дуга приоритетнее AI-дуги', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

# QUESTIONS 1

## Q 1
[fd-from:: AI.ANALYST]
[fd-to:: HUMAN.ANALYST]

body
`);
    const step = nextStep(c);
    expect(step?.roles).toEqual(['HUMAN.ANALYST']);
    expect(step?.section).toBe('ANSWERS');
  });

  it('ISSUE к AI.CODER → CODE', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]

body
`);
    const step = nextStep(c);
    expect(step?.roles).toEqual(['AI.CODER']);
    expect(step?.section).toBe('CODE');
  });

  it('FIX → REVIEW', () => {
    const c = contentOf(`# FIX 1
[fd-from:: AI.CODER.SENIOR]
[fd-to:: AI.REVIEWER]

body
`);
    expect(nextStep(c)?.section).toBe('REVIEW');
  });

  it('ISSUE к AI.ANALYST → section null (аналитик решает)', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

body
`);
    expect(nextStep(c)?.section).toBeNull();
  });

  it('пустой журнал → null', () => {
    expect(nextStep(contentOf(''))).toBeNull();
  });

  it('завершён DONE (без fd-to) → null', () => {
    const c = contentOf(`# DONE 1
[fd-from:: HUMAN.CODER]

закрыто
`);
    expect(nextStep(c)).toBeNull();
  });

  it('CRASH при открытых дугах → null (авария, ход не даём)', () => {
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

body

# CRASH 1

непредвиденная ошибка

~~~
broken link: "[[#ISSUE 9]]"
~~~
`);
    expect(nextStep(c)).toBeNull();
  });
});

describe('isCrashed', () => {
  it('есть # CRASH n → true', () => {
    expect(isCrashed(contentOf(`# CRASH 1\n\nошибка\n`))).toBe(true);
  });

  it('без CRASH → false', () => {
    expect(isCrashed(contentOf(`# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n`))).toBe(false);
  });
});

describe('gateDue', () => {
  const twoReviews = `# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]

# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]

# REVIEW 1
[fd-from:: AI.REVIEWER]
[fd-to:: AI.CODER]

# FIX 1
[fd-from:: AI.CODER.SENIOR]
[fd-to:: AI.REVIEWER]

# REVIEW 2
[fd-from:: AI.REVIEWER]
[fd-to:: AI.CODER]

# FIX 2
[fd-from:: AI.CODER.SENIOR]
[fd-to:: AI.REVIEWER]
`;

  it('число REVIEW достигло порога → true', () => {
    expect(gateDue(contentOf(twoReviews), parseSpec('reviewLimit: 2\nroles: {}\n'))).toBe(true);
  });

  it('ниже порога → false', () => {
    const one = twoReviews.slice(0, twoReviews.indexOf('# REVIEW 2'));
    expect(gateDue(contentOf(one), parseSpec('reviewLimit: 2\nroles: {}\n'))).toBe(false);
  });

  it('без reviewLimit → false', () => {
    expect(gateDue(contentOf(twoReviews), parseSpec('roles: {}\n'))).toBe(false);
  });
});

describe('roleBrief', () => {
  it('оси, контекст, vault, дуги роли', () => {
    const spec = parseSpec(`reviewLimit: 1
roles:
  AI.CODER:
    model: deepseek-v4-pro
    context: [vault/gi/schema.md]
`);
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: gi/schema.md]

body

# ISSUE 2
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]

body
`);
    const brief = roleBrief(spec, 'AI.CODER.JUNIOR', c);
    expect(brief.spec.model).toBe('deepseek-v4-pro');
    expect(brief.context).toEqual(['vault/gi/schema.md']);
    expect(brief.vault).toEqual(['gi/schema.md']);
    expect(brief.arcs.map((a) => a.addr)).toEqual(['ISSUE 1', 'ISSUE 2']);
  });

  it('рулевой ISSUE от HUMAN перебивает vault из старых ISSUE', () => {
    const spec = parseSpec('roles: {}\n');
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: a.md]

body

# ISSUE 2
[fd-from:: HUMAN.CODER]
[fd-to:: AI.ANALYST]

сменить курс

# ISSUE 3
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: b.md]

body
`);
    // a.md из ISSUE 1 — до рулевого ISSUE 2 → перебит; b.md из ISSUE 3 — остаётся.
    expect(roleBrief(spec, 'AI.CODER.JUNIOR', c).vault).toEqual(['b.md']);
  });

  it('без рулевого ISSUE vault накапливается по ISSUE к роли', () => {
    const spec = parseSpec('roles: {}\n');
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: a.md]

body

# ISSUE 2
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: b.md]

body
`);
    expect(roleBrief(spec, 'AI.CODER.JUNIOR', c).vault).toEqual(['a.md', 'b.md']);
  });

  it('vault остаётся у кодера на FIX (дуга ISSUE→CODER уже закрыта)', () => {
    const spec = parseSpec('roles: {}\n');
    const c = contentOf(`# ISSUE 1
[fd-from:: AI.ANALYST]
[fd-to:: AI.CODER]
[fd-vault:: a.md]

body

# CODE 1
[fd-from:: AI.CODER.JUNIOR]
[fd-to:: AI.REVIEWER]
[fd-reply:: [[#ISSUE 1]]]

code

# REVIEW 1
[fd-from:: AI.REVIEWER]
[fd-to:: AI.CODER.SENIOR]
[fd-reply:: [[#CODE 1]]]

review
`);
    // ISSUE 1 → CODER закрыт ответом CODE 1, но vault не должен пропадать на FIX.
    expect(roleBrief(spec, 'AI.CODER.SENIOR', c).vault).toEqual(['a.md']);
  });
});
