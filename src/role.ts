/**
 * Покрытие ролей по сегментам: `pattern` покрывает `role` тогда и только тогда,
 * когда `pattern` — префикс `role` по сегментам (граница — точка).
 * `AI.CODER` покрывает `AI.CODER.JUNIOR`; `AI.CODERX` НЕ покрывает `AI.CODER`.
 */
export function roleCovers(pattern: string, role: string): boolean {
  const p = pattern.split('.');
  const r = role.split('.');
  if (p.length > r.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== r[i]) return false;
  }
  return true;
}
