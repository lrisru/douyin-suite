import { logger } from './util.js';

async function post(url, body, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) logger.warn('notify', `webhook ${r.status}: ${text.slice(0, 120)}`);
    return { ok: r.ok, status: r.status, body: text.slice(0, 300) };
  } catch (e) {
    logger.warn('notify', `webhook 失败: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

export async function notifyAll(config, text) {
  const n = config.notify || {};
  const jobs = [];
  if (n.feishu) jobs.push(post(n.feishu, { msg_type: 'text', content: { text } }));
  if (n.dingtalk) jobs.push(post(n.dingtalk, { msgtype: 'text', text: { content: text } }));
  if (n.wechat) jobs.push(post(n.wechat, { msgtype: 'text', text: { content: text } }));
  if (!jobs.length) return [];
  return Promise.allSettled(jobs);
}

export async function notifyTest(config, text = '【抖音综合工具】测试消息：通知链路正常') {
  return notifyAll(config, text);
}
