/**
 * SOCKS5 代理检测（零依赖，手写握手）
 * 用于验证 socks5:// 代理是否可用、延迟多少
 */
import net from 'node:net';

/**
 * @param {string} host 代理主机
 * @param {number} port 代理端口
 * @param {object} opts { user, pass, targetHost, targetPort, timeout }
 */
export function socks5Check(host, port, opts = {}) {
  const user = opts.user || '';
  const pass = opts.pass || '';
  const targetHost = opts.targetHost || 'api.ip.sb';
  const targetPort = opts.targetPort || 80;
  const timeout = opts.timeout || 8000;

  return new Promise((resolve) => {
    const start = Date.now();
    const sock = net.connect({ host, port });
    let stage = 0;
    let buf = Buffer.alloc(0);
    let done = false;

    const finish = (r) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ ...r, ms: Date.now() - start });
    };

    sock.setTimeout(timeout, () => finish({ ok: false, error: '超时' }));
    sock.on('error', (e) => finish({ ok: false, error: e.message }));

    sock.on('connect', () => {
      // 阶段 0：握手，声明支持 无认证 / 用户名密码
      const methods = user ? [0x00, 0x02] : [0x00];
      sock.write(Buffer.from([0x05, methods.length, ...methods]));
      stage = 1;
    });

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      if (stage === 1) {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return finish({ ok: false, error: '不是 SOCKS5 代理' });
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === 0x00) {
          sendConnect();
        } else if (method === 0x02) {
          if (!user) return finish({ ok: false, error: '代理要求用户名密码' });
          const u = Buffer.from(user);
          const p = Buffer.from(pass);
          sock.write(Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]));
          stage = 2;
        } else {
          finish({ ok: false, error: '代理拒绝了认证方式' });
        }
        return;
      }

      if (stage === 2) {
        if (buf.length < 2) return;
        if (buf[1] !== 0x00) return finish({ ok: false, error: '用户名或密码错误' });
        buf = buf.subarray(2);
        sendConnect();
        return;
      }

      if (stage === 3) {
        if (buf.length < 10) return;
        if (buf[0] !== 0x05) return finish({ ok: false, error: '响应异常' });
        const rep = buf[1];
        if (rep !== 0x00) {
          const reasons = { 1: '代理服务器故障', 2: '规则不允许', 3: '网络不可达', 4: '主机不可达', 5: '连接被拒', 6: 'TTL 超时', 7: '不支持的命令', 8: '不支持的地址类型' };
          return finish({ ok: false, error: reasons[rep] || `连接失败(${rep})` });
        }
        return finish({ ok: true, via: `${targetHost}:${targetPort}` });
      }
    });

    function sendConnect() {
      const hostBuf = Buffer.from(targetHost);
      sock.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
        hostBuf,
        Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
      ]));
      stage = 3;
    }
  });
}

/** 解析 socks5://user:pass@host:port */
export function parseSocks(proxy) {
  try {
    const u = new URL(proxy.includes('://') ? proxy : 'socks5://' + proxy);
    return {
      host: u.hostname,
      port: Number(u.port || 1080),
      user: decodeURIComponent(u.username || ''),
      pass: decodeURIComponent(u.password || ''),
    };
  } catch {
    return null;
  }
}
