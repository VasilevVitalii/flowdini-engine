import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { taskCheck } from '../src/task.js';

const dirs: string[] = [];

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'fd-engine-'));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('taskCheck', () => {
  it('валидные файлы — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-reply:: [[b#D 1]]]\nbody\n');
    await writeFile(join(dir, 'b.md'), '# D 1\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('exclude пропускает сырьё с «неправильными» заголовками', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE 1\n\nbody\n');
    await writeFile(join(dir, 'issue-draft.md'), '# Задача без номера\n\nсырьё от человека\n');
    expect(await taskCheck(dir, { exclude: ['issue-draft.md'] })).toEqual([]);
  });

  it('дубль заголовка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE 1\n\nbody1\n\n# CODE 1\n\nbody2\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'duplicate heading: "CODE 1"' },
    ]);
  });

  it('заголовок без номера', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'heading without number: "CODE"' },
    ]);
  });

  it('заголовок без номера с подтопиками — одна ошибка, не дублируется', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE\n\n## C 1\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'heading without number: "CODE"' },
    ]);
  });

  it('сиротский ### без родителя — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '### D 1\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'orphan heading: "D 1"' },
    ]);
  });

  it('ссылка в fenced-блоке не проверяется', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE 1\n\n```\n[[ghost#D 1]]\n```\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('битая внутрифайловая ссылка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# CODE 1\n\n## C 1\n[fd-reply:: [[#CODE 1#C 9]]]\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'broken link: "[[#CODE 1#C 9]]"' },
    ]);
  });

  it('битая межфайловая ссылка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-reply:: [[b#D 1]]]\nbody\n');
    await writeFile(join(dir, 'b.md'), '# D 2\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'broken link: "[[b#D 1]]"' },
    ]);
  });

  it('ссылка на отсутствующий файл', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-reply:: [[ghost#D 1]]]\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'broken link: "[[ghost#D 1]]"' },
    ]);
  });

  it('fd-to с несколькими ролями', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-to:: AI.CODER, AI.REVIEWER]\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'multiple roles awaited: "AI.CODER, AI.REVIEWER"' },
    ]);
  });

  it('fd-to с одной ролью — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-to:: AI.CODER]\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('fd-to с несколькими HUMAN-ролями — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-to:: HUMAN.A, HUMAN.B]\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('fd-to со смесью AI и HUMAN — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-to:: AI.CODER, HUMAN.ANALYST]\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'multiple roles awaited: "AI.CODER, HUMAN.ANALYST"' },
    ]);
  });

  it('поле на строке заголовка — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1 [fd-to:: AI.CODER, AI.REVIEWER]\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'field on heading line: "Q 1 [fd-to:: AI.CODER, AI.REVIEWER]"' },
    ]);
  });

  it('несуществующий каталог — отклоняется', async () => {
    await expect(taskCheck(join(tmpdir(), 'fd-engine-nonexistent-xyz'))).rejects.toThrow();
  });

  it('пустой каталог — пустой результат', async () => {
    const dir = await tmp();
    expect(await taskCheck(dir)).toEqual([]);
  });
});
