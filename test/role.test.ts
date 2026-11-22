import { describe, expect, it } from 'vitest';
import { roleCovers } from '../src/role.js';

describe('roleCovers', () => {
  it('точное совпадение', () => {
    expect(roleCovers('AI.CODER', 'AI.CODER')).toBe(true);
  });

  it('префикс по сегментам (уровень)', () => {
    expect(roleCovers('AI.CODER', 'AI.CODER.JUNIOR')).toBe(true);
  });

  it('HUMAN покрывает персонажа', () => {
    expect(roleCovers('HUMAN', 'HUMAN.CODER.Petrov')).toBe(true);
  });

  it('не покрывает — расхождение сегмента (не префикс строки)', () => {
    expect(roleCovers('AI.CODERX', 'AI.CODER')).toBe(false);
  });

  it('не покрывает — длиннее цели', () => {
    expect(roleCovers('AI.CODER.JUNIOR', 'AI.CODER')).toBe(false);
  });
});
