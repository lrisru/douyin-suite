import {
  createTask, updateTask, bumpTask, getAccount, listAccounts,
  upsertItem, upsertUser, upsertComment, upsertLive, upsertConversation, insertLog,
} from './db.js';
import { sleep, randInt, logger, events, truncate } from './util.js';
import { notifyAll } from './notify.js';

export class TaskEngine {
  constructor({ douyin, config, liveManager = null }) {
    this.douyin = douyin;
    this.config = config;
    this.liveManager = liveManager;
    this.queue = [];
    this.running = 0;
    this.stopped = false;
    this.rr = 0;
    this.cancelled = new Set();
    this.stats = { done: 0, failed: 0, cancelled: 0 };
  }

  /** 取消：排队中的直接移除，运行中的打标记由循环自行退出 */
  cancel(taskId) {
    const id = Number(taskId);
    this.cancelled.add(id);
    const before = this.queue.length;
    this.queue = this.queue.filter((t) => t.id !== id);
    if (this.queue.length < before) {
      updateTask(id, { status: 'cancelled', finished_at: Date.now(), error: '已取消（排队中）' });
      events.emit('task', { id, status: 'cancelled' });
      logger.warn('task', `■ 已取消排队任务 #${id}`);
      return { removed: true };
    }
    logger.warn('task', `■ 请求取消运行中任务 #${id}（在当前条结束后退出）`);
    return { removed: false };
  }

  isCancelled(taskId) {
    return this.cancelled.has(Number(taskId));
  }

  start() {
    this.stopped = false;
    this.tick();
    logger.info('task', '任务引擎已启动');
  }

  stop() {
    this.stopped = true;
  }

  enqueue(type, params = {}, accountId = null) {
    const t = createTask({ type, params, account_id: accountId });
    this.queue.push(t);
    logger.info('task', `新建任务 #${t.id} ${type}`);
    events.emit('task', { id: t.id, status: 'pending', type });
    this.tick();
    return t;
  }

  tick() {
    if (this.stopped) return;
    const limit = Math.max(0, Number(this.config.task.concurrency) || 1);
    while (this.running < limit && this.queue.length) {
      const task = this.queue.shift();
      this.running++;
      this.run(task)
        .catch((e) => logger.error('task', `任务 #${task.id} 异常: ${e.message}`))
        .finally(() => {
          this.running--;
          this.tick();
        });
    }
  }

  /** 取账号：指定 > 指定池轮转 > 全局在线账号轮转 */
  resolveAccount(task, params = {}) {
    if (task.account_id) {
      const a = getAccount(task.account_id);
      if (a) return a;
    }
    const pool = Array.isArray(params.account_ids) && params.account_ids.length
      ? params.account_ids.map((id) => getAccount(id)).filter(Boolean)
      : null;
    if (pool?.length) return pool[(this.rr++) % pool.length];
    const online = listAccounts().filter((a) => a.logged_in === 1).sort((x, y) => x.id - y.id);
    if (online.length) return online[(this.rr++) % online.length];
    const any = listAccounts().sort((x, y) => x.id - y.id);
    if (any.length) return any[0];
    throw new Error('没有可用账号：请先在「账号」页添加并登录');
  }

  accountPool(params) {
    if (!Array.isArray(params.account_ids) || params.account_ids.length < 2) return null;
    return params.account_ids.map((id) => getAccount(id)).filter(Boolean);
  }

  accountAt(pool, index, fallback) {
    if (!pool?.length) return fallback;
    return pool[index % pool.length];
  }

  async run(task) {
    if (this.isCancelled(task.id)) {
      updateTask(task.id, { status: 'cancelled', finished_at: Date.now(), error: '已取消' });
      events.emit('task', { id: task.id, status: 'cancelled' });
      return;
    }
    updateTask(task.id, { status: 'running', started_at: Date.now(), error: '' });
    events.emit('task', { id: task.id, status: 'running', type: task.type });
    logger.info('task', `▶ 开始 #${task.id} ${task.type}`);

    let params = {};
    try { params = JSON.parse(task.params || '{}'); } catch { /* ignore */ }

    let account;
    try {
      account = this.resolveAccount(task, params);
    } catch (e) {
      updateTask(task.id, { status: 'failed', finished_at: Date.now(), error: e.message });
      logger.error('task', `✘ #${task.id}: ${e.message}`);
      return;
    }
    const ctx = { task_id: task.id, account_id: account.id };
    let ok = 0;
    let fail = 0;

    try {
      switch (task.type) {
        case 'search_video':
        case 'search_live': {
          const type = task.type === 'search_live' ? 'live' : 'video';
          const r = await this.douyin.search(account, {
            keyword: params.keyword, type,
            scrolls: params.scrolls, limit: params.limit || 200,
          });
          if (type === 'live') {
            for (const l of r.lives || []) { upsertLive({ ...l, ...ctx, keyword: params.keyword }); bumpTask(task.id, 'done'); ok++; }
          } else {
            for (const it of r.items) { upsertItem({ ...it, ...ctx }); bumpTask(task.id, 'done'); ok++; }
          }
          updateTask(task.id, { total: ok });
          break;
        }
        case 'search_user': {
          const { users } = await this.douyin.search(account, {
            keyword: params.keyword, type: 'user', scrolls: params.scrolls, limit: params.limit || 200,
          });
          for (const u of users) { upsertUser({ ...u, ...ctx }); bumpTask(task.id, 'done'); ok++; }
          updateTask(task.id, { total: ok });
          break;
        }
        case 'user_profile': {
          const u = await this.douyin.userProfile(account, { secUid: params.sec_uid, keyword: params.keyword || '' });
          if (u) { upsertUser({ ...u, ...ctx }); bumpTask(task.id, 'done'); ok++; }
          updateTask(task.id, { total: 1 });
          break;
        }
        case 'user_works': {
          const { items } = await this.douyin.userWorks(account, {
            secUid: params.sec_uid, keyword: params.keyword || '', scrolls: params.scrolls, limit: params.limit || 200,
          });
          for (const it of items) { upsertItem({ ...it, ...ctx }); bumpTask(task.id, 'done'); ok++; }
          updateTask(task.id, { total: ok });
          break;
        }
        case 'followers':
        case 'following': {
          const r = task.type === 'followers'
            ? await this.douyin.followers(account, { secUid: params.sec_uid, scrolls: params.scrolls, limit: params.limit || 300 })
            : await this.douyin.following(account, { secUid: params.sec_uid, scrolls: params.scrolls, limit: params.limit || 300 });
          for (const u of r.users) {
            upsertUser({ ...u, ...ctx, keyword: params.keyword || `${task.type}:${params.sec_uid}` });
            bumpTask(task.id, 'done');
            ok++;
          }
          updateTask(task.id, { total: ok });
          break;
        }
        case 'conversations': {
          const r = await this.douyin.conversations(account, { limit: params.limit || 50 });
          for (const c of r.conversations) { upsertConversation({ ...c, ...ctx }); bumpTask(task.id, 'done'); ok++; }
          updateTask(task.id, { total: ok });
          break;
        }
        case 'comments': {
          const ids = params.aweme_ids?.length ? params.aweme_ids : [params.aweme_id].filter(Boolean);
          updateTask(task.id, { total: ids.length });
          for (const id of ids) {
            if (this.isCancelled(task.id)) { logger.warn('task', `■ 任务 #${task.id} 已取消`); break; }
            try {
              const { comments } = await this.douyin.comments(account, { awemeId: id, limit: params.limit || 300 });
              for (const c of comments) upsertComment({ ...c, aweme_id: id, ...ctx });
              bumpTask(task.id, 'done');
              ok++;
            } catch (e) {
              bumpTask(task.id, 'failed');
              fail++;
              logger.warn('task', `评论采集 ${id} 失败: ${e.message}`);
            }
          }
          break;
        }
        case 'live': {
          const r = await this.douyin.live(account, { webRid: params.web_rid, keyword: params.keyword || '' });
          upsertLive({ ...r, ...ctx });
          bumpTask(task.id, 'done');
          updateTask(task.id, { total: 1 });
          ok++;
          break;
        }
        case 'download': {
          const shareUrls = params.urls || [];
          const awemeIds = params.aweme_ids || [];
          updateTask(task.id, { total: shareUrls.length + awemeIds.length });
          const r = await this.douyin.download(account, { shareUrls, awemeIds });
          for (const item of r.results) {
            bumpTask(task.id, item.ok ? 'done' : 'failed');
            if (item.ok) ok++; else fail++;
          }
          updateTask(task.id, { result: JSON.stringify({ dir: r.dir, results: r.results }).slice(0, 200000) });
          logger.ok('task', `下载完成 -> ${r.dir}（成功 ${ok} 失败 ${fail}）`);
          break;
        }
        case 'like':
        case 'collect':
        case 'follow': {
          const list = params.aweme_ids?.length ? params.aweme_ids
            : params.sec_uids?.length ? params.sec_uids
              : [params.aweme_id || params.sec_uid].filter(Boolean);
          const pool = this.accountPool(params);
          updateTask(task.id, { total: list.length });
          for (let i = 0; i < list.length; i++) {
            if (this.isCancelled(task.id)) { logger.warn('task', `■ 任务 #${task.id} 已取消`); break; }
            const acc = this.accountAt(pool, i, account);
            const id = list[i];
            try {
              const r = task.type === 'like' ? await this.douyin.like(acc, { awemeId: id })
                : task.type === 'collect' ? await this.douyin.collect(acc, { awemeId: id })
                  : await this.douyin.follow(acc, { secUid: id });
              logger.ok('task', `#${acc.id} ${task.type} ${id} -> ${r.ok ? '成功' : '未生效'} ${r.state || ''}`);
              bumpTask(task.id, 'done');
              ok++;
            } catch (e) {
              bumpTask(task.id, 'failed');
              fail++;
              logger.warn('task', `#${acc.id} ${task.type} ${id} 失败: ${e.message}`);
              updateTask(task.id, { error: String(e.message || e).slice(0, 200) });
            }
            await sleep(randInt(this.config.task.minDelayMs, this.config.task.maxDelayMs));
          }
          break;
        }
        case 'comment':
        case 'dm': {
          const list = params.aweme_ids?.length ? params.aweme_ids
            : params.sec_uids?.length ? params.sec_uids : [params.aweme_id || params.sec_uid].filter(Boolean);
          const texts = params.texts?.length ? params.texts : [params.text || '支持一下'];
          const pool = this.accountPool(params);
          updateTask(task.id, { total: list.length });
          for (let i = 0; i < list.length; i++) {
            if (this.isCancelled(task.id)) { logger.warn('task', `■ 任务 #${task.id} 已取消`); break; }
            const acc = this.accountAt(pool, i, account);
            const id = list[i];
            const text = texts[randInt(0, texts.length - 1)];
            try {
              const r = task.type === 'comment'
                ? await this.douyin.comment(acc, { awemeId: id, text, dryRun: !!params.dryRun })
                : await this.douyin.dm(acc, { secUid: id, text, dryRun: !!params.dryRun });
              // 私信成功后附带动作（原版支持顺带点赞/收藏）
              if (r.ok && !r.dryRun && Array.isArray(params.after)) {
                for (const act of params.after) {
                  try {
                    if (act === 'like' && task.type === 'comment') await this.douyin.like(acc, { awemeId: id });
                    else if (act === 'collect' && task.type === 'comment') await this.douyin.collect(acc, { awemeId: id });
                    else if (act === 'follow') await this.douyin.follow(acc, { secUid: id });
                    await sleep(randInt(600, 1400));
                  } catch (e) { logger.warn('task', `附带动作 ${act} 失败: ${e.message}`); }
                }
              }
              logger.ok('task', `#${acc.id} ${task.type} ${id} -> ${r.dryRun ? '仅测试输入' : (r.ok ? '成功' : '未确认')} 「${truncate(text, 30)}」`);
              if (r.dryRun) { bumpTask(task.id, 'done'); ok++; }
              else { bumpTask(task.id, r.ok ? 'done' : 'failed'); if (r.ok) ok++; else fail++; }
            } catch (e) {
              bumpTask(task.id, 'failed');
              fail++;
              logger.warn('task', `#${acc.id} ${task.type} ${id} 失败: ${e.message}`);
              updateTask(task.id, { error: String(e.message || e).slice(0, 200) });
            }
            await sleep(randInt(this.config.task.minDelayMs + 800, this.config.task.maxDelayMs + 2500));
          }
          break;
        }
        case 'live_stream': {
          if (!this.liveManager) throw new Error('直播模块未初始化');
          if (!params.web_rid) throw new Error('缺少 web_rid（直播间号）');
          const minutes = Math.max(1, Number(params.minutes) || 30);
          const s = await this.liveManager.start(account, params.web_rid, {
            onMessage: () => { bumpTask(task.id, 'done'); ok++; },
          });
          updateTask(task.id, { total: 0 });
          logger.ok('task', `直播监听已开始 ${params.web_rid}，持续 ${minutes} 分钟`);
          await sleep(minutes * 60000);
          s.stop();
          this.liveManager.stop(params.web_rid);
          logger.info('task', `直播监听结束 ${params.web_rid}，共 ${ok} 条消息`);
          break;
        }
        case 'parse_share': {
          const urls = params.urls || [];
          updateTask(task.id, { total: urls.length });
          const results = [];
          for (const u of urls) {
            try {
              const r = await this.douyin.resolveShare(u);
              results.push(r);
              bumpTask(task.id, r.ok ? 'done' : 'failed');
              if (r.ok) ok++; else fail++;
            } catch {
              fail++;
              bumpTask(task.id, 'failed');
            }
          }
          updateTask(task.id, { result: JSON.stringify(results).slice(0, 200000) });
          break;
        }
        default:
          throw new Error('未知任务类型: ' + task.type);
      }

      if (this.isCancelled(task.id)) {
        updateTask(task.id, { status: 'cancelled', finished_at: Date.now(), done: ok, failed: fail, error: '用户取消' });
        events.emit('task', { id: task.id, status: 'cancelled', type: task.type });
        this.stats.cancelled++;
        logger.warn('task', `■ 已取消 #${task.id}（已处理 ${ok} 条）`);
        return;
      }

      const status = fail > 0 && ok === 0 ? 'failed' : 'done';
      const zeroHint = ok === 0 && status === 'done'
        ? '本次没有采到数据：可能是关键词无结果、目标用户不存在/已注销，或对方的列表未公开'
        : '';
      const finish = { status, finished_at: Date.now(), done: ok, failed: fail };
      // 只有需要提示时才写 error，避免覆盖逐条失败记录下的具体原因
      if (zeroHint) finish.error = zeroHint;
      updateTask(task.id, finish);
      events.emit('task', { id: task.id, status, type: task.type, ok, fail });
      if (status === 'failed') {
        logger.warn('task', `✘ 结束 #${task.id} ${task.type} 成功 ${ok} 失败 ${fail}`);
        this.stats.failed++;
      } else {
        logger.ok('task', `✔ 完成 #${task.id} ${task.type} 成功 ${ok} 失败 ${fail}`);
        this.stats.done++;
      }
      if (ok > 0) notifyAll(this.config, `【抖音综合工具】任务 #${task.id} ${task.type} 完成：成功 ${ok}，失败 ${fail}`).catch(() => {});
    } catch (e) {
      const attempts = task._attempts || 0;
      const maxRetry = Math.max(0, Number(this.config.task.retry) || 0);
      if (attempts < maxRetry && !this.isCancelled(task.id)) {
        task._attempts = attempts + 1;
        updateTask(task.id, { status: 'pending', started_at: null, error: `第 ${task._attempts} 次失败，重试中：${e.message}` });
        events.emit('task', { id: task.id, status: 'pending', type: task.type });
        logger.warn('task', `↻ 重试 #${task.id}（${task._attempts}/${maxRetry}）：${e.message}`);
        this.queue.push(task);
        return;
      }
      updateTask(task.id, { status: 'failed', finished_at: Date.now(), error: String(e.message || e) });
      events.emit('task', { id: task.id, status: 'failed', type: task.type, error: e.message });
      logger.error('task', `✘ 失败 #${task.id} ${task.type}: ${e.message}`);
      this.stats.failed++;
      notifyAll(this.config, `【抖音综合工具】任务 #${task.id} ${task.type} 失败：${e.message}`).catch(() => {});
    }
  }
}

export function saveTaskLog(item) {
  insertLog(item);
}

export function taskStats(engine) {
  return { ...engine.stats, queued: engine.queue.length, running: engine.running };
}
