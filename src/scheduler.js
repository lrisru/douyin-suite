import { dueSchedules, updateSchedule, listSchedules } from './db.js';
import { logger } from './util.js';

/**
 * 最小可用的定时调度：每 30 秒扫一次 due 任务。
 * interval_min 控制频率；支持指定账号列表（任务内轮转）。
 */
export class Scheduler {
  constructor({ engine, config }) {
    this.engine = engine;
    this.config = config;
    this.timer = null;
  }

  start() {
    this.repair();
    this.timer = setInterval(() => this.tick(), 30000);
    logger.info('schedule', '定时调度已启动（30s 扫描）');
  }

  /** next_run 为 0 的记录补一个触发点 */
  repair() {
    const now = Date.now();
    for (const s of listSchedules()) {
      if (!s.next_run) {
        updateSchedule(s.id, { next_run: now + Math.max(1, s.interval_min) * 60000 });
      }
    }
  }

  tick() {
    let due = [];
    try { due = dueSchedules(Date.now()); } catch { return; }
    for (const s of due) {
      try {
        const params = JSON.parse(s.params || '{}');
        const ids = String(s.account_ids || '').split(',').map((x) => Number(x)).filter(Boolean);
        if (ids.length) params.account_ids = ids;
        const task = this.engine.enqueue(s.type, params, ids[0] || s.account_id || null);
        const next = Date.now() + Math.max(1, s.interval_min) * 60000;
        updateSchedule(s.id, { last_run: Date.now(), next_run: next, last_task_id: task.id });
        logger.ok('schedule', `定时任务「${s.name}」已触发 → #${task.id}，下次 ${new Date(next).toLocaleString()}`);
      } catch (e) {
        logger.error('schedule', `定时任务 ${s.id} 触发失败: ${e.message}`);
        updateSchedule(s.id, { next_run: Date.now() + 5 * 60000 });
      }
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}
