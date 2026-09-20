/**
 * AI CIA 构建脚本
 *
 * 输入：data/cards/*.yml + data/watchout.yml + public/index.html 模板
 * 输出：dist/（预渲染 HTML + 静态资源 + SEO 文件）
 *
 * 设计原则：
 * - 所有用户内容在输出 HTML 时统一走 escapeHtml，杜绝 XSS
 * - 精选规则、卡片、观望名单均来自数据文件，不在 HTML 里硬编码
 * - 构建失败时对缺字段/坏数据直接报错，不静默放行
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public');
const cardsDir = join(root, 'data', 'cards');
const distDir = join(root, 'dist');

const SITE = {
  url: 'https://aicia.pages.dev/',
  name: 'AI CIA',
  description: '免费 AI Token 与模型额度情报站：平台、额度、支持模型、领取入口。',
  version: process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8) || 'local',
};

/* ---------- 精选规则（单一数据源，HTML 列表由这里生成） ---------- */
const FEATURED_MODELS = [
  { label: 'DeepSeek V4', note: '国产顶级开源模型' },
  { label: 'GLM 5.2', note: '智谱新一代，1M 无损上下文' },
  { label: 'Kimi K3', note: '月之暗面旗舰，全量开源' },
  { label: '千问 3.8 Max', note: '阿里 Qwen 主力' },
  { label: 'Hy3', note: '腾讯混元 3，开源' },
  { label: 'LongCat 2.0', note: '美团大模型' },
];

const FEATURED_REGEX = [
  /deepseekv(?:[4-9]|1\d)/,
  /glm5(?:[2-9]|1\d)|glm[6-9]/,
  /kimik(?:[3-9]|1\d)/,
  /(?:千问|qwen)3(?:[8-9]|1\d)|(?:千问|qwen)[4-9]/,
  /hy(?:[3-9]|1\d)/,
  /longcat/,
];

function isFeatured(card) {
  const text = `${card.name || ''} ${card.modality || ''}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
  return FEATURED_REGEX.some(re => re.test(text));
}

/* ---------- 工具 ---------- */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(value, fallback) {
  try {
    const u = new URL(value, SITE.url);
    if (!['http:', 'https:', ''].includes(u.protocol)) throw new Error('bad protocol');
    return u.href;
  } catch {
    return fallback || SITE.url;
  }
}

function categoryOf(card) {
  return card.type === '工具' ? '工具' : '大模型';
}

function stars(n) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="star-dim">★</span>';
  return s;
}

function fmtMd(d) {
  if (!d) return '';
  const [, m, day] = d.split('-');
  return `${parseInt(m, 10)}/${parseInt(day, 10)}`;
}

/* ---------- 读数据 ---------- */
function loadCards() {
  const files = readdirSync(cardsDir).filter(f => f.endsWith('.yml'));
  const cards = [];
  for (const file of files) {
    const card = yaml.load(readFileSync(join(cardsDir, file), 'utf8'));
    // 必填校验
    for (const k of ['name', 'type', 'modality', 'rating', 'quota', 'effect', 'link', 'updated']) {
      if (card[k] === undefined || card[k] === '') {
        throw new Error(`[${file}] 缺少必填字段: ${k}`);
      }
    }
    card.__file = file;
    // 日期字段统一转字符串（CMS 可能存成 Date 对象）
    if (card.updated) card.updated = String(card.updated).slice(0, 10);
    if (card.limited) card.limited = String(card.limited).slice(0, 10);
    cards.push(card);
  }
  return cards;
}

function loadWatchout() {
  return yaml.load(readFileSync(join(root, 'data', 'watchout.yml'), 'utf8')).watchout || [];
}

/* ---------- 过滤 + 排序 ---------- */
function buildVisible(cards, watchout) {
  const watchoutNames = new Set(watchout.map(w => w.name));
  const today = new Date().toISOString().slice(0, 10);
  let list = cards.filter(c => {
    if (c.status !== 'approved') return false;
    if (watchoutNames.has(c.name)) return false;
    // 限时活动已过期：不在首页展示，数据保留在仓库里，CMS 里仍可见
    if (c.limited && c.limited < today && !c.alwaysShow) return false;
    return true; // CMS 已批准的全部显示
  });
  // pin 排序
  list = list.slice().sort((a, b) => (a.updated < b.updated ? 1 : -1));
  const pinned = list.filter(c => c.pin);
  const rest = list.filter(c => !c.pin);
  for (const p of pinned.sort((a, b) => a.pin - b.pin)) {
    const idx = rest.findIndex(c => c.name === p.name);
    if (idx > -1) rest.splice(idx, 1);
    rest.splice(Math.min((p.pin || 1) - 1, rest.length), 0, p);
  }
  return rest;
}

/* ---------- 渲染 ---------- */
function renderCard(card) {
  const cat = categoryOf(card);
  const region = card.region ? `<span class="region">${escapeHtml(card.region)}</span>` : '';
  const badge = card.badge ? `<span class="badge">${escapeHtml(card.badge)}</span>` : '';
  const limited = card.limited ? `<span class="limited">⏱ 限时 ${fmtMd(card.limited)}</span>` : '';
  const tone = card.tone ? ` tone-${escapeHtml(card.tone)}` : '';
  const extra = card.extraAction
    ? `<a class="btn-secondary" href="${escapeHtml(safeUrl(card.extraAction.link))}" target="_blank" rel="noopener">${escapeHtml(card.extraAction.text)}</a>`
    : '';

  const destination = card.poster ? null : safeUrl(card.link);
  // 邀请码轮换：如果有 inviteCodes，嵌入 data 属性，前端按天轮换
  const inviteAttrs = card.inviteCodes && Array.isArray(card.inviteCodes) && card.inviteCodes.length
    ? ` data-invite-base="${escapeHtml(destination || '')}" data-invite-codes='${escapeHtml(JSON.stringify(card.inviteCodes))}'`
    : '';
  const action = card.poster
    ? `<button class="card-link" data-poster="${escapeHtml(card.poster)}">查看详情</button>`
    : `<a class="card-link" href="${escapeHtml(destination)}" target="_blank" rel="noopener"${inviteAttrs}>查看详情</a>`;

  return `
    <article class="card${tone}" data-cat="${escapeHtml(cat)}">
      <div class="card-head">
        <span class="stars" title="${card.rating}/5">${stars(card.rating)}</span>
        <span class="cat">${escapeHtml(cat)}</span>
        ${limited}
      </div>
      <h3 class="name">${escapeHtml(card.name)} ${region}</h3>
      ${badge}
      <p class="modality">${escapeHtml(card.modality)}</p>
      <p class="quota">${escapeHtml(card.quota)}</p>
      <p class="effect">${escapeHtml(card.effect)}</p>
      <div class="card-actions">${extra}${action}</div>
      <time class="updated">更新于 ${escapeHtml(card.updated)}</time>
    </article>`;
}

function renderWatchout(item, i) {
  return `
    <div class="watchout-row">
      <span class="wo-num">${i + 1}</span>
      <h3 class="wo-name">${escapeHtml(item.name)}</h3>
      <span class="wo-tag">观望</span>
      <p class="wo-why">${escapeHtml(item.why)}</p>
      <a class="wo-action" href="${escapeHtml(safeUrl(item.link))}" target="_blank" rel="noopener">查看 →</a>
    </div>`;
}

function renderFeaturedModels() {
  return FEATURED_MODELS
    .map(m => `<li><span class="check">✓</span><div><strong>${escapeHtml(m.label)}</strong><span>${escapeHtml(m.note)}</span></div></li>`)
    .join('\n');
}

/* ---------- 主流程 ---------- */
const cards = loadCards();
const watchout = loadWatchout();
const visible = buildVisible(cards, watchout);

const html = readFileSync(join(publicDir, 'index.html'), 'utf8');

const stats = {
  models: visible.filter(c => categoryOf(c) === '大模型').length,
  tools: visible.filter(c => categoryOf(c) === '工具').length,
  limited: visible.filter(c => c.limited).length,
  latest: visible.slice().sort((a, b) => b.updated.localeCompare(a.updated))[0]?.updated || '-',
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: SITE.name,
  description: SITE.description,
  inLanguage: 'zh-CN',
  url: SITE.url,
  mainEntity: {
    '@type': 'ItemList',
    numberOfItems: visible.length,
    itemListElement: visible.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      url: c.link || SITE.url,
    })),
  },
};

let out = html
  .replace('<!-- STATIC_CARDS -->', visible.map(renderCard).join('\n'))
  .replace('<!-- STATIC_WATCHOUT -->', watchout.map(renderWatchout).join('\n'))
  .replace('<!-- FEATURED_MODELS -->', renderFeaturedModels())
  .replaceAll('__VERSION__', SITE.version)
  .replace(/id="stat-models">—</, `id="stat-models">${stats.models}<`)
  .replace(/id="stat-tools">—</, `id="stat-tools">${stats.tools}<`)
  .replace(/id="stat-limited">—</, `id="stat-limited">${stats.limited}<`)
  .replace(/id="stat-updated">—</, `id="stat-updated">${stats.latest}<`)
  .replace(/id="list-total">—</, `id="list-total">在录 ${visible.length} 条 · 观望 ${watchout.length} 条<`)
  .replace('</head>', `  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n</head>`);

if (out.includes('<!-- STATIC_') || out.includes('<!-- FEATURED_') || out.includes('>—<')) {
  throw new Error('占位符未被替换，检查模板');
}

/* ---------- 写 dist/ ---------- */
rmSync(distDir, { recursive: true, force: true });
mkdirSync(join(distDir, 'images'), { recursive: true });
writeFileSync(join(distDir, 'index.html'), out);

// 递归复制 public/ 下的静态资源（除 index.html 外）
function copyDir(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (entry === 'index.html') continue;
    const s = join(srcDir, entry);
    const d = join(dstDir, entry);
    const stat = statSync(s);
    if (stat.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}
copyDir(publicDir, distDir);
copyDir(join(root, 'admin'), join(distDir, 'admin'));
copyFileSync(join(root, 'admin', 'index.html'), join(distDir, 'admin', 'index.html'));

// SEO 文件
writeFileSync(join(distDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}sitemap.xml\n`);
writeFileSync(join(distDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE.url}</loc></url>\n</urlset>\n`);
writeFileSync(join(distDir, 'llms.txt'), `# AI CIA\n\n> 免费 AI Token 与模型额度情报导航。\n\n- [首页](${SITE.url}): 平台名称、免费额度、支持模型、领取入口及最后更新日期。\n- 额度和活动会变动，请以各平台官方页面为准。\n- 本站是非官方爱好者项目。\n`);

console.log(`✓ 构建完成`);
console.log(`  卡片: ${visible.length} 张（大模型 ${stats.models} · 工具 ${stats.tools} · 限时 ${stats.limited}）`);
console.log(`  观望: ${watchout.length} 条`);
console.log(`  输出: ${distDir}`);
