import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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

  it('битая ссылка в преамбуле (тексте до первого заголовка)', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), 'преамбула со ссылкой [[ghost#D 1]]\n\n# Q 1\n\n## Q 1\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'broken link: "[[ghost#D 1]]"' },
    ]);
  });

  it('ссылка на файл целиком без `#`: существующий — чисто, отсутствующий — битая', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# Q 1\n\n## Q 1\n[fd-reply:: [[b]]]\nbody\n');
    await writeFile(join(dir, 'b.md'), '# D 1\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
    await rm(join(dir, 'b.md'));
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'broken link: "[[b]]"' },
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
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nclosed\n\n# ISSUE 2\n[fd-from:: HUMAN.ANALYST]\n[fd-to:: AI.ANALYST]\n\nreopen\n');
    expect(await taskCheck(dir)).toEqual([]);
  });

  it('ISSUE после DONE от не-HUMAN — ошибка переоткрытия', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nclosed\n\n# ISSUE 2\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nreopen\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'non-HUMAN reopen after DONE: "ISSUE 2"' },
    ]);
  });

  it('DONE без fd-from — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n\nclosed\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'DONE must have fd-from' },
    ]);
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

  it('DONE → ISSUE (переоткрытие) → CODE — «section after DONE» не ругается', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# DONE 1\n[fd-from:: HUMAN.ANALYST]\n\nclosed\n\n# ISSUE 2\n[fd-from:: HUMAN.ANALYST]\n[fd-to:: AI.ANALYST]\n\nreopen\n\n# CODE 1\n[fd-from:: AI.CODER]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([]);
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

  it('OBJECT с пустым obj-path — ошибка полноты', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n\n## OBJECT 1\n[obj-kind:: function]\n[obj-action:: create]\n[obj-path:: ]\n\nbody\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'OBJECT incomplete: missing obj-path ("OBJECT 1")' },
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

  it('ссылка за границу vault (path traversal) — ошибка', async () => {
    const dir = await tmp();
    const vault = await tmp();
    const outside = await tmp(); // другой каталог вне vault
    const secret = join(outside, 'secret.md');
    await writeFile(secret, '# secret\n');
    const rel = relative(vault, secret); // ../fd-engine-YYY/secret.md
    await writeFile(join(dir, 'a.md'), `# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n[fd-vault:: ${rel}]\n\nbody\n`);
    expect(await taskCheck(dir, { vaultRoot: vault })).toEqual([
      { relativeFileName: 'a.md', error: `vault file outside vault: "${rel}"` },
    ]);
  });

  it('ссылка на каталог — ошибка (нужен файл)', async () => {
    const dir = await tmp();
    const vault = await tmp();
    await writeFile(join(dir, 'a.md'), '# ISSUE 1\n[fd-from:: AI.ANALYST]\n[fd-to:: AI.CODER]\n[fd-vault:: sub]\n\nbody\n');
    // sub — каталог внутри vault, не файл.
    await mkdir(join(vault, 'sub'));
    expect(await taskCheck(dir, { vaultRoot: vault })).toEqual([
      { relativeFileName: 'a.md', error: 'vault entry is not a file: "sub"' },
    ]);
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

  it('Q без fd-to — ошибка', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'a.md'), '# REVIEW 1\n\n## Q 1\n\nпродолжать?\n');
    expect(await taskCheck(dir)).toEqual([
      { relativeFileName: 'a.md', error: 'gate Q must have fd-to (HUMAN.CODER)' },
    ]);
  });
});

describe('taskCheck: exclude', () => {
  it('служебный файл (knowledge-candidates) не проверяется при exclude', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'chat.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n');
    await writeFile(join(dir, 'knowledge-candidates.md'), '## тема\n\nзаметка\n');
    const without = await taskCheck(dir);
    expect(without.some((e) => e.relativeFileName === 'knowledge-candidates.md')).toBe(true);
    const withExclude = await taskCheck(dir, { exclude: ['knowledge-candidates.md'] });
    expect(withExclude.some((e) => e.relativeFileName === 'knowledge-candidates.md')).toBe(false);
  });

  it('ссылка [[file]] на исключённый файл — не broken link (файл существует)', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'chat.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nсм. [[issue-dom]]\n');
    await writeFile(join(dir, 'issue-dom.md'), 'сырьё (не fd-файл)\n');
    expect(await taskCheck(dir, { exclude: ['issue-dom.md'] })).toEqual([]);
  });

  it('override подменяет chat.md при проверке (валидация кандидата до публикации)', async () => {
    const dir = await tmp();
    await writeFile(join(dir, 'chat.md'), '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n');
    const candidate = '# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody\n\n# ISSUE 1\n[fd-from:: AI.WRITER]\n[fd-to:: AI.ANALYST]\n\nbody2\n';
    expect(await taskCheck(dir, { override: { fileName: 'chat.md', text: candidate } })).toEqual([
      { relativeFileName: 'chat.md', error: 'duplicate heading: "ISSUE 1"' },
    ]);
    const onDisk = await readFile(join(dir, 'chat.md'), 'utf8');
    expect(onDisk).toContain('body\n');
    expect(onDisk).not.toContain('body2');
  });
});
