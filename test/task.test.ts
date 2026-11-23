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

  it('# CRASH 1 с broken link и fd-полями внутри fence — taskCheck чист', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'chat.md'), `# ISSUE 1
[fd-from:: AI.WRITER]
[fd-to:: AI.ANALYST]

body

# CRASH 1

Процесс остановлен из-за непредвиденной ошибки.

Ошибки:

~~~
chat.md: broken link: "[[#ISSUE 9]]"
~~~

Ответ AI, породивший ошибки:

~~~
## BUG
[fd-from:: AI.REVIEWER]
[fd-to:: AI.CODER.SENIOR]
[[#ISSUE 9]]
~~~
`);
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

describe('taskCheck: терминальность DONE', () => {
  it('DONE последним — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n\n# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nзакрыто\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('раздел после DONE — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nclosed\n\n# CODE 1\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'section after DONE: "CODE 1"' },
    ]);
  });

  it('ISSUE после DONE (переоткрытие) — допустимо', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nclosed\n\n# ISSUE 2\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nreopen\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('DONE от не-HUMAN — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: AI.CODER]\n\nclosed\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'DONE fd-from must be HUMAN.*: "AI.CODER"' },
    ]);
  });

  it('DONE с fd-to — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n[fd-to:: AI.CODER]\n\nclosed\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'DONE must not have fd-to' },
    ]);
  });
});

describe('taskCheck: матрица ISSUE', () => {
  it('AI.WRITER → AI.ANALYST — допустимо', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('HUMAN.ANALYST → AI.ANALYST — допустимо', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: HUMAN.ANALYST]\n[fd-to:: AI.ANALYST]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('AI.ANALYST → AI.CODER — допустимо', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('AI.ANALYST → AI.REVIEWER — допустимо', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.REVIEWER]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('AI.WRITER → AI.CODER — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.CODER]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'invalid ISSUE transfer: "AI.WRITER" → "AI.CODER"' },
    ]);
  });

  it('AI.ANALYST → HUMAN.CODER — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: HUMAN.CODER]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'invalid ISSUE transfer: "AI.ANALYST" → "HUMAN.CODER"' },
    ]);
  });
});

describe('taskCheck: валидация OBJECT', () => {
  it('полный OBJECT — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n\n## OBJECT 1\n[obj-kind:: function]\n[obj-action:: create]\n[obj-path:: dbo.sp_x]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('OBJECT без obj-path — ошибка полноты', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n\n## OBJECT 1\n[obj-kind:: function]\n[obj-action:: create]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'OBJECT incomplete: missing obj-path ("OBJECT 1")' },
    ]);
  });

  it('неверный obj-action — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n\n## OBJECT 1\n[obj-kind:: function]\n[obj-action:: drop]\n[obj-path:: dbo.sp_x]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'invalid obj-action: "drop"' },
    ]);
  });

  it('дубль obj-path — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n\n## OBJECT 1\n[obj-kind:: function]\n[obj-action:: create]\n[obj-path:: dbo.sp_x]\n\nbody1\n\n## OBJECT 2\n[obj-kind:: procedure]\n[obj-action:: create]\n[obj-path:: dbo.sp_x]\n\nbody2\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'duplicate obj-path: "dbo.sp_x"' },
    ]);
  });
});

describe('taskCheck: fd-vault', () => {
  it('существующий файл vault — без ошибок', async () => {
    const dir = await tmp();
    const vault = await tmp();
    await writeFile(join(vault, 'gi-schema.md'), '# schema\n');
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n[fd-vault:: gi-schema.md]\n\nbody\n');
    expect(await taskCheck(dir, { vaultRoot: vault })).toEqual([]);
  });

  it('отсутствующий файл vault — ошибка', async () => {
    const dir = await tmp();
    const vault = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n[fd-vault:: ghost.md]\n\nbody\n');
    expect(await taskCheck(dir, { vaultRoot: vault })).toEqual([
      { relativeFileName: 'a.md', error: 'vault file not found: "ghost.md"' },
    ]);
  });

  it('без vaultRoot — fd-vault не проверяется', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n[fd-vault:: ghost.md]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
  });
});

describe('taskCheck: гибридный гейт', () => {
  it('Q первым в REVIEW — без ошибок', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# REVIEW 1\n\n## Q 1\n[fd-to:: HUMAN.CODER]\n\nпродолжать?\n\n## BUG 1\n[fd-from:: AI.REVIEWER]\n[fd-to:: AI.CODER]\n\nзамечание\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('Q не первым в REVIEW — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# REVIEW 1\n\n## BUG 1\n[fd-from:: AI.REVIEWER]\n[fd-to:: AI.CODER]\n\nзамечание\n\n## Q 1\n[fd-to:: HUMAN.CODER]\n\nпродолжать?\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'gate Q must be first in REVIEW: "Q 1"' },
    ]);
  });

  it('Q адресован не HUMAN.CODER — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# REVIEW 1\n\n## Q 1\n[fd-to:: AI.CODER]\n\nпродолжать?\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'gate Q must be to HUMAN.CODER: "AI.CODER"' },
    ]);
  });
});
