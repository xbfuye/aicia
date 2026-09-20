import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cardsDir = join(root, 'data', 'cards');

const required = ['name', 'type', 'modality', 'rating', 'quota', 'effect', 'link', 'updated', 'status'];
const files = readdirSync(cardsDir).filter(f => f.endsWith('.yml'));

let errors = 0;
let approved = 0;

for (const file of files) {
  const raw = readFileSync(join(cardsDir, file), 'utf8');
  let card;
  try {
    card = yaml.load(raw);
  } catch (e) {
    console.error(`[PARSE FAIL] ${file}: ${e.message}`);
    errors++;
    continue;
  }
  const missing = required.filter(k => card[k] === undefined || card[k] === '');
  if (missing.length) {
    console.error(`[MISSING] ${file}: 缺字段 ${missing.join(', ')}`);
    errors++;
  }
  if (card.status === 'approved') approved++;
  if (!card.link && !card.poster) {
    console.error(`[NO LINK] ${file}: 既无 link 也无 poster`);
    errors++;
  }
}

// 验证观望名单
const watchoutRaw = readFileSync(join(root, 'data', 'watchout.yml'), 'utf8');
const watchout = yaml.load(watchoutRaw);
console.log(`\n=== 验证结果 ===`);
console.log(`卡片文件: ${files.length} 个`);
console.log(`已上线(approved): ${approved} 个`);
console.log(`观望名单: ${watchout.watchout.length} 条`);
console.log(`错误: ${errors} 个`);
process.exit(errors ? 1 : 0);
