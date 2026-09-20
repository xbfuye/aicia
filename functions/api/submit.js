/**
 * 投稿接收端点
 * POST /api/submit
 *
 * 环境变量：
 *   GITHUB_PAT      - 有仓库 Contents 写权限的 Personal Access Token
 *   GITHUB_REPO     - 格式：xbfuye/aicia
 *   TURNSTILE_SECRET - Turnstile 密钥（T8 接入）
 *   FEISHU_WEBHOOK  - 飞书机器人 webhook（T8 接入）
 */

const requiredFields = ['name', 'type', 'modality', 'quota', 'effect', 'link'];

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function buildYaml(data) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `name: "${data.name.replace(/"/g, '\\"')}"`,
    `type: "${data.type}"`,
    `modality: "${data.modality.replace(/"/g, '\\"')}"`,
    `rating: 3`,
    `quota: "${data.quota.replace(/"/g, '\\"')}"`,
  ];
  if (data.signup) lines.push(`signup: "${data.signup.replace(/"/g, '\\"')}"`);
  lines.push(`effect: "${data.effect.replace(/"/g, '\\"')}"`);
  lines.push(`link: "${data.link}"`);
  if (data.limited) lines.push(`limited: "${data.limited}"`);
  lines.push(`updated: "${today}"`);
  lines.push(`status: pending`);
  if (data.contact) lines.push(`contact: "${data.contact.replace(/"/g, '\\"')}"`);
  return lines.join('\n') + '\n';
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: '请求格式错误' }, 400);
  }

  // 校验必填字段
  for (const field of requiredFields) {
    if (!data[field] || String(data[field]).trim() === '') {
      return json({ ok: false, error: `缺少必填字段: ${field}` }, 400);
    }
  }

  // 校验 URL
  try {
    new URL(data.link);
  } catch {
    return json({ ok: false, error: '链接格式不正确' }, 400);
  }

  const { GITHUB_PAT, GITHUB_REPO } = env;
  if (!GITHUB_PAT || !GITHUB_REPO) {
    return json({ ok: false, error: '服务器未配置 GITHUB_PAT' }, 500);
  }

  // 生成文件名：slug + 时间戳
  const filename = `${slugify(data.name)}-${Date.now()}.yml`;
  const filepath = `data/cards/${filename}`;
  const yamlContent = buildYaml(data);

  // 调 GitHub API 创建文件
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${filepath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_PAT}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'aicia-cms',
      },
      body: JSON.stringify({
        message: `feat: new submission - ${data.name}`,
        content: btoa(unescape(encodeURIComponent(yamlContent))),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('GitHub API error:', res.status, err);
      return json({ ok: false, error: `GitHub ${res.status}: ${err.slice(0, 200)}` }, 502);
    }
  } catch (err) {
    console.error('Fetch error:', err);
    return json({ ok: false, error: '网络错误' }, 502);
  }

  // T8: 发飞书通知
  if (env.FEISHU_WEBHOOK) {
    fetch(env.FEISHU_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: `新投稿：${data.name}\n类型：${data.type}\n链接：${data.link}\n额度：${data.quota.slice(0, 80)}` },
      }),
    }).catch(() => {});
  }

  return json({ ok: true, message: '已收到投稿' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
  });
}
