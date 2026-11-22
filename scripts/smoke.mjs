import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentPretty, taskCheck } from '../dist/index.js';

const dir = await mkdtemp(join(tmpdir(), 'fd-smoke-'));
await writeFile(join(dir, 'a.md'), '# CODE 1\n\n## C 1\nbody\n');
console.log('taskCheck:', JSON.stringify(await taskCheck(dir)));
await rm(dir, { recursive: true, force: true });

const content = {
  inlineList: [],
  itemList: [
    {
      topic: { level1: { title: 'CODE', idx: 1 }, level2: null, level3: null, inlineList: [] },
      text: null,
    },
  ],
  text: null,
};
console.log('pretty   :', JSON.stringify(contentPretty(content)));
