/**
 * 指纹画像：由账号 seed 生成确定性参数，注入到页面上下文。
 * 覆盖：webdriver 标记、UA/平台、语言、时区、硬件并发、WebGL 厂商、Canvas 噪声。
 */

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed) {
  let h = 2166136261;
  const s = String(seed || 'default');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const RESOLUTIONS = [
  [1920, 1080], [2560, 1440], [1600, 900], [1366, 768], [1440, 900], [1680, 1050],
];
const TIMEZONES = ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi'];
const WEBGL = [
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
  ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
];

export function fingerprintProfile(seed) {
  const s = String(seed || 'default');
  const rnd = mulberry32(hashSeed(s));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const [w, h] = pick(RESOLUTIONS);
  const [vendor, renderer] = pick(WEBGL);
  const major = 120 + Math.floor(rnd() * 12);
  return {
    seed: s,
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    platform: 'Win32',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh', 'en-US', 'en'],
    timezone: pick(TIMEZONES),
    width: w,
    height: h,
    hardwareConcurrency: pick([4, 8, 12, 16]),
    deviceMemory: pick([8, 8, 16, 32]),
    webglVendor: vendor,
    webglRenderer: renderer,
    canvasNoise: (rnd() * 0.0008 + 0.0001).toFixed(6),
    colorDepth: 24,
    plugins: 5,
  };
}

/** 注入到每个新文档的脚本 */
export function injectionScript(fp) {
  return `(() => {
  const FP = ${JSON.stringify(fp)};
  const define = (obj, prop, val) => {
    try { Object.defineProperty(obj, prop, { get: () => val, configurable: true }); } catch (e) {}
  };
  define(navigator, 'webdriver', false);
  define(navigator, 'platform', FP.platform);
  define(navigator, 'language', FP.language);
  define(navigator, 'languages', FP.languages);
  define(navigator, 'hardwareConcurrency', FP.hardwareConcurrency);
  define(navigator, 'deviceMemory', FP.deviceMemory);
  try {
    Object.defineProperty(navigator, 'plugins', { get: () => new Array(FP.plugins).fill(0).map((_, i) => ({ name: 'plugin' + i })), configurable: true });
  } catch (e) {}

  // WebGL 厂商/渲染器
  const patchGL = (proto) => {
    if (!proto) return;
    const orig = proto.getParameter;
    proto.getParameter = function (p) {
      if (p === 37445) return FP.webglVendor;
      if (p === 37446) return FP.webglRenderer;
      return orig.apply(this, arguments);
    };
  };
  try { patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype); } catch (e) {}
  try { patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype); } catch (e) {}

  // Canvas 噪声（固定 seed，保证同一账号稳定）
  const seedNum = parseInt(FP.canvasNoise.replace('.', ''), 10) || 1;
  const noise = (data) => {
    for (let i = 0; i < data.length; i += 997) {
      data[i] = (data[i] + (seedNum % 7)) % 256;
    }
  };
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    try {
      const ctx = this.getContext('2d');
      if (ctx && this.width && this.height) {
        const img = ctx.getImageData(0, 0, Math.min(this.width, 64), Math.min(this.height, 64));
        noise(img.data);
        ctx.putImageData(img, 0, 0);
      }
    } catch (e) {}
    return origToDataURL.apply(this, arguments);
  };

  // chrome 对象兜底
  if (!window.chrome) window.chrome = { runtime: {}, app: { isInstalled: false } };
})();`;
}

/** 应用指纹到某个标签页 */
export async function applyFingerprint(cdp, fp) {
  try {
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: fp.ua,
      acceptLanguage: fp.languages.join(','),
      platform: fp.platform,
    });
  } catch { /* ignore */ }
  try { await cdp.send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone }); } catch { /* ignore */ }
  try { await cdp.send('Emulation.setLocaleOverride', { locale: fp.language }); } catch { /* ignore */ }
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: fp.width, height: fp.height, deviceScaleFactor: 1, mobile: false,
      screenWidth: fp.width, screenHeight: fp.height,
    });
  } catch { /* ignore */ }
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: injectionScript(fp) });
  } catch { /* ignore */ }
  return fp;
}
