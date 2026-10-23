import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { getSetting, setSetting } from './db.js';

function regQuery(key, name) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/REG_SZ\s+(.+)/);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

export function machineCode() {
  const guid = regQuery('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
  const vol = (() => {
    try {
      const out = execFileSync('cmd', ['/c', 'vol', 'C:'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/([0-9A-F]{4}-[0-9A-F]{4})/i);
      return m ? m[1] : '';
    } catch { return ''; }
  })();
  const cpu = os.cpus()?.[0]?.model || '';
  const raw = `${guid}|${vol}|${cpu}|${os.hostname()}`;
  const h = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return h.slice(0, 24).match(/.{1,4}/g).join('-');
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex').toUpperCase().slice(0, 16);
}

export function makeKey(secret, machine, expiry = '2099-12-31') {
  const exp = expiry.replace(/-/g, '');
  const payload = `${machine}|${exp}`;
  return `DYS-${exp}-${sign(secret, payload)}`;
}

export function verifyKey(secret, machine, key) {
  if (!key) return { ok: false, reason: '未填写卡密' };
  const m = String(key).trim().toUpperCase().match(/^DYS-(\d{8})-([0-9A-F]{16})$/);
  if (!m) return { ok: false, reason: '卡密格式不对（示例 DYS-20261231-XXXXXXXXXXXXXX）' };
  const [, exp, sig] = m;
  const expect = sign(secret, `${String(machine).toUpperCase()}|${exp}`);
  if (expect !== sig) return { ok: false, reason: '卡密与当前机器不匹配' };
  const y = Number(exp.slice(0, 4));
  const mo = Number(exp.slice(4, 6)) - 1;
  const d = Number(exp.slice(6, 8));
  const end = new Date(y, mo, d, 23, 59, 59).getTime();
  if (Date.now() > end) return { ok: false, reason: `卡密已于 ${exp} 到期` };
  return { ok: true, expiry: `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}` };
}

export function licenseStatus(config) {
  const enabled = !!config.license?.enabled;
  const machine = machineCode();
  const key = getSetting('license_key', '');
  if (!enabled) return { enabled: false, valid: true, machine, key, note: '授权校验已关闭' };
  const v = verifyKey(config.license.secret, machine, key);
  return { enabled: true, valid: !!v.ok, machine, key, reason: v.reason || '', expiry: v.expiry || '' };
}

export function activate(config, key) {
  const machine = machineCode();
  const v = verifyKey(config.license.secret, machine, key);
  if (!v.ok) return { ok: false, reason: v.reason };
  setSetting('license_key', key.trim().toUpperCase());
  return { ok: true, expiry: v.expiry };
}
