/**
 * 图集下载分支：用假的作品详情 + 本地图片服务，验证多图下载路径。
 * （真实图集作品受游客风控影响不稳定，这里只验代码路径）
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { DouyinService } from '../src/douyin.js';
import { loadConfig } from '../src/util.js';

const PORT = 9384;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const server = http.createServer((req, res) => {
  if (/^\/img\d\.jpg$/.test(req.url)) {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    return res.end(PNG);
  }
  res.writeHead(404);
  res.end('no');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const cfg = loadConfig(process.cwd());
const douyin = new DouyinService({ page: async () => ({ cdp: null }) }, cfg);

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); }
};

// 覆盖详情获取，模拟一条图集作品
douyin.awemeDetailFromPage = async () => ({
  aweme_id: 'gallery_test_1',
  desc: '图集作品',
  author: { nickname: '图文作者' },
  video: null,
  images: [
    { url_list: [`http://127.0.0.1:${PORT}/img1.jpg`] },
    { url_list: [`http://127.0.0.1:${PORT}/img2.jpg`] },
    { url_list: [`http://127.0.0.1:${PORT}/img3.jpg`] },
  ],
  music: null,
});

const r = await douyin.download({ id: 1 }, { awemeIds: ['gallery_test_1'] });
const res0 = r.results[0];
const files = res0?.files || [];
const names = files.map((f) => path.basename(f.file)).sort();
const sizes = files.map((f) => f.size);

check('返回成功', res0?.ok === true, JSON.stringify(res0?.reason || ''));
check('下载 3 张图片', files.length === 3, names.join(','));
check('命名规则', names.join(',') === 'gallery_test_1_1.jpg,gallery_test_1_2.jpg,gallery_test_1_3.jpg', names.join(','));
check('文件大小非空', sizes.every((s) => s > 0), sizes.join('/'));

// 视频 + 图集混合
douyin.awemeDetailFromPage = async () => ({
  aweme_id: 'mixed_1',
  video: { play_addr: { url_list: [`http://127.0.0.1:${PORT}/img1.jpg`] } },
  images: [{ url_list: [`http://127.0.0.1:${PORT}/img2.jpg`] }],
  music: { play_url: { url_list: [`http://127.0.0.1:${PORT}/img3.jpg`] } },
});
const r2 = await douyin.download({ id: 1 }, { awemeIds: ['mixed_1'] });
const n2 = (r2.results[0]?.files || []).map((f) => path.basename(f.file)).sort();
check('视频+图集+音乐', n2.join(',') === 'mixed_1.mp3,mixed_1.mp4,mixed_1_1.jpg', n2.join(','));

// 下载失败要能返回原因而不是抛
douyin.awemeDetailFromPage = async () => ({
  aweme_id: 'bad_1',
  video: { play_addr: { url_list: [`http://127.0.0.1:${PORT}/missing.jpg`] } },
  images: [],
});
const r3 = await douyin.download({ id: 1 }, { awemeIds: ['bad_1'] });
check('单文件失败不整体崩', r3.results[0]?.ok === false, JSON.stringify(r3.results[0]?.reason || r3.results[0]?.files));

for (const dir of new Set([r.dir, r2.dir, r3.dir])) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${pass} pass, ${fail} fail`);
server.close();
process.exit(fail ? 1 : 0);
