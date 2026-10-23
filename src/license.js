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

/**
 * 生成卡密
 * @param machine 机器码；传 '*' 表示通用卡密（不绑机器）
 * @param serial  序号，用于让同一到期日的卡密互不相同
 */
export function makeKey(secret, machine, expiry = '2099-12-31', serial = null) {
  const exp = String(expiry).replace(/-/g, '');
  const s = serial == null ? '' : String(serial).padStart(2, '0');
  const payload = s ? `${machine}|${exp}|${s}` : `${machine}|${exp}`;
  const sig = sign(secret, payload);
  return s ? `DYS-${exp}-${s}-${sig}` : `DYS-${exp}-${sig}`;
}

function expiryOk(exp) {
  const y = Number(exp.slice(0, 4));
  const mo = Number(exp.slice(4, 6)) - 1;
  const d = Number(exp.slice(6, 8));
  const end = new Date(y, mo, d, 23, 59, 59).getTime();
  if (Number.isNaN(end)) return { ok: false, reason: '卡密到期日不合法' };
  if (Date.now() > end) return { ok: false, reason: `卡密已于 ${exp} 到期` };
  return { ok: true, expiry: `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}` };
}

/**
 * 校验卡密。同时接受：
 *   DYS-YYYYMMDD-NN-SIG  （带序号，新格式）
 *   DYS-YYYYMMDD-SIG     （旧格式）
 * 绑定卡密优先用本机机器码，其次接受 '*' 签发的通用卡密。
 */
export function verifyKey(secret, machine, key, { allowAny = true } = {}) {
  if (!key) return { ok: false, reason: '未填写卡密' };
  const raw = String(key).trim().toUpperCase();

  let exp = '';
  let serial = '';
  let sig = '';
  const mNew = raw.match(/^DYS-(\d{8})-(\d{2})-([0-9A-F]{16})$/);
  const mOld = raw.match(/^DYS-(\d{8})-([0-9A-F]{16})$/);
  if (mNew) { [, exp, serial, sig] = mNew; }
  else if (mOld) { [, exp, sig] = mOld; }
  else return { ok: false, reason: '卡密格式不对（应形如 DYS-20261231-01-XXXXXXXXXXXXXX）' };

  const machines = [String(machine).toUpperCase()];
  if (allowAny && machines[0] !== '*') machines.push('*');

  let matched = false;
  for (const mm of machines) {
    const payload = serial ? `${mm}|${exp}|${serial}` : `${mm}|${exp}`;
    if (sign(secret, payload) === sig) { matched = true; break; }
  }
  if (!matched) return { ok: false, reason: '卡密与当前机器不匹配' };

  return expiryOk(exp);
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
