/** 重启账号浏览器并检查页面是否还被验证码拦截 */
const base = 'http://127.0.0.1:9527';
const j = async (p, o = {}) => {
  const r = await fetch(base + p, { headers: { 'content-type': 'application/json' }, ...o, body: o.body ? JSON.stringify(o.body) : undefined });
  return r.json();
};

console.log('stop:', JSON.stringify(await j('/api/accounts/9/stop', { method: 'POST' })));
await new Promise((r) => setTimeout(r, 2500));
console.log('login:', JSON.stringify(await j('/api/accounts/9/login', { method: 'POST' })));
await new Promise((r) => setTimeout(r, 6000));
console.log('check:', JSON.stringify(await j('/api/accounts/9/check', { method: 'POST' })));
