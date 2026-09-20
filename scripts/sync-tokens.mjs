/**
 * 半自动同步脚本：从 token-fbi.com 拉取最新卡片数据
 * 对比本地 data/cards/ 已有的卡片，新发现的生成 yml 文件（status: pending）
 *
 * 用法：node scripts/sync-tokens.mjs
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cardsDir = join(root, 'data', 'cards');

const SOURCE_URL = 'https://token-fbi.com/app.js';

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function yamlEscape(v) {
  if (v === undefined || v === null) return '""';
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

function toYaml(card) {
  const lines = [
    `name: ${yamlEscape(card.name)}`,
    `type: ${yamlEscape(card.type)}`,
    `modality: ${yamlEscape(card.modality)}`,
    `rating: ${card.rating || 3}`,
    `quota: ${yamlEscape(card.quota)}`,
  ];
  if (card.signup) lines.push(`signup: ${yamlEscape(card.signup)}`);
  lines.push(`effect: ${yamlEscape(card.effect)}`);
  lines.push(`link: ${yamlEscape(card.link)}`);
  if (card.limited) lines.push(`limited: ${yamlEscape(card.limited)}`);
  lines.push(`updated: ${yamlEscape(card.updated || new Date().toISOString().slice(0, 10))}`);
  if (card.tone) lines.push(`tone: ${yamlEscape(card.tone)}`);
  if (card.badge) lines.push(`badge: ${yamlEscape(card.badge)}`);
  if (card.pin) lines.push(`pin: ${card.pin}`);
  if (card.alwaysShow) lines.push(`alwaysShow: true`);
  lines.push(`status: pending`);
  return lines.join('\n') + '\n';
}

async function main() {
  console.log('拉取 token-fbi 数据...');
  const res = await fetch(SOURCE_URL);
  const js = await res.text();

  // 提取 TOKENS 数组
  const match = js.match(/const TOKENS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    console.error('未找到 TOKENS 数组');
    process.exit(1);
  }

  let tokens;
  try {
    tokens = vm.runInNewContext(match[1]);
  } catch (e) {
    console.error('解析 TOKENS 失败:', e.message);
    process.exit(1);
  }

  console.log(`源站卡片数: ${tokens.length}`);

  // 读取本地已有卡片名
  const existing = new Set();
  const files = readdirSync(cardsDir).filter(f => f.endsWith('.yml'));
  for (const f of files) {
    const content = readFileSync(join(cardsDir, f), 'utf8');
    const nameMatch = content.match(/^name:\s*"?(.+?)"?\s*$/m);
    if (nameMatch) existing.add(nameMatch[1]);
  }
  console.log(`本地已有卡片: ${existing.size}`);

  // 找出新卡片
  const newCards = tokens.filter(t => !existing.has(t.name));
  console.log(`新卡片: ${newCards.length}`);

  if (newCards.length === 0) {
    console.log('没有新卡片，无需更新。');
    return;
  }

  // 生成新 yml 文件
  let count = 0;
  for (const card of newCards) {
    const filename = `${slugify(card.name)}.yml`;
    const filepath = join(cardsDir, filename);
    if (existsSync(filepath)) continue;
    writeFileSync(filepath, toYaml(card), 'utf8');
    console.log(`  + ${filename}  (${card.name})`);
    count++;
  }

  console.log(`\n完成: ${count} 张新卡片已生成（status: pending）`);
  console.log('下一步: npm run check 验证数据，然后 git push 到 GitHub，在 Sveltia CMS 里审核发布');
}

main().catch(e => {
  console.error('错误:', e);
  process.exit(1);
});
