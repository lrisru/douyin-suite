/**
 * 指纹注入实效验证：注入后页面里的 UA / 时区 / 语言 / 硬件 / WebGL / Canvas 是否真的被改写，
 * 同一 seed 是否稳定，不同 seed 是否可区分。
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { Cdp, launchChrome, waitEndpoint, newTab, findChrome } from '../src/cdp.js';
import { applyFingerprint, fingerprintProfile } from '../src/fingerprint.js';

const chromePath = findChrome({});
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

const PAGE = 'data:text/html,<html><body><canvas id="c" width="120" height="60"></canvas></body></html>';

async function probe(seed, port) {
  const profileDir = path.join(os.tmpdir(), `dy-fp-${seed}-${port}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const proc = launchChrome({ chromePath, profileDir, port, headless: true, width: 1000, height: 800 });
  const ep = await waitEndpoint(port, 20000);
  if (!ep) throw new Error('chrome not ready');

  const cdp = await Cdp.connect((await newTab(port, 'about:blank')).webSocketDebuggerUrl);
  await cdp.enable();
  const fp = fingerprintProfile(seed);
  await applyFingerprint(cdp, fp);
  await cdp.navigate(PAGE, { waitMs: 800 });
  await new Promise((r) => setTimeout(r, 400));

  const data = await cdp.evaluate(`(() => {
    const out = {
      webdriver: navigator.webdriver,
      ua: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      hardwareConcurrency: navigator.hardwareConcurrency,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webglVendor: null,
      webglRenderer: null,
      canvas: null,
    };
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (gl) { out.webglVendor = gl.getParameter(37445); out.webglRenderer = gl.getParameter(37446); }
    } catch (e) { out.webglErr = e.message; }
    try {
      const cv = document.getElementById('c');
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 120, 60);
      ctx.font = '14px sans-serif';
      ctx.fillText('douyin-suite', 6, 30);
      out.canvas = cv.toDataURL().slice(-60);
    } catch (e) { out.canvasErr = e.message; }
    return out;
  })()`);

  cdp.close();
  await new Promise((r) => setTimeout(r, 250));
  try { proc.kill(); } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  return { fp, data };
}

const A = await probe('seed-alpha', 9363);
console.log('\n--- seed-alpha ---');
console.log(JSON.stringify({
  fp: { ua: A.fp.ua.match(/Chrome\/[\d.]+/)?.[0], tz: A.fp.timezone, hc: A.fp.hardwareConcurrency },
  page: {
    webdriver: A.data.webdriver, ua: A.data.ua.match(/Chrome\/[\d.]+/)?.[0], tz: A.data.timezone,
    hc: A.data.hardwareConcurrency, lang: A.data.language, canvas: String(A.data.canvas).slice(-16),
  },
}, null, 1));

check('webdriver=false', A.data.webdriver === false, String(A.data.webdriver));
check('UA 被覆写', A.data.ua === A.fp.ua, A.data.ua.match(/Chrome\/[\d.]+/)?.[0]);
check('platform 生效', A.data.platform === A.fp.platform, A.data.platform);
check('language 生效', A.data.language === A.fp.language, A.data.language);
check('languages 生效', JSON.stringify(A.data.languages) === JSON.stringify(A.fp.languages), JSON.stringify(A.data.languages));
check('hardwareConcurrency 生效', A.data.hardwareConcurrency === A.fp.hardwareConcurrency, String(A.data.hardwareConcurrency));
check('时区生效', A.data.timezone === A.fp.timezone, A.data.timezone);
if (A.data.webglVendor) {
  check('WebGL 厂商', A.data.webglVendor === A.fp.webglVendor, A.data.webglVendor);
  check('WebGL 渲染器', String(A.data.webglRenderer).slice(0, 40) === String(A.fp.webglRenderer).slice(0, 40), String(A.data.webglRenderer).slice(0, 40));
} else {
  console.log('SKIP WebGL（当前环境无 WebGL 上下文）');
}
check('Canvas 可读取', !!A.data.canvas, String(A.data.canvas || A.data.canvasErr).slice(-24));

const B = await probe('seed-alpha', 9364);
check('同 seed 画像稳定', B.fp.ua === A.fp.ua && B.fp.timezone === A.fp.timezone && B.fp.hardwareConcurrency === A.fp.hardwareConcurrency,
  `${B.fp.timezone}/${B.fp.hardwareConcurrency}`);
check('同 seed Canvas 一致', B.data.canvas === A.data.canvas, String(B.data.canvas).slice(-16));

const C = await probe('seed-beta', 9365);
check('不同 seed 画像不同', C.fp.ua !== A.fp.ua || C.fp.timezone !== A.fp.timezone || C.fp.webglRenderer !== A.fp.webglRenderer,
  `${C.fp.timezone}/${C.fp.ua.match(/Chrome\/[\d.]+/)?.[0]}`);
check('不同 seed Canvas 不同', C.data.canvas !== A.data.canvas,
  `${String(A.data.canvas).slice(-12)} vs ${String(C.data.canvas).slice(-12)}`);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
