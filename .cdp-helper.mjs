// CDP 助手：不走 fetch，用 node:http 拿页面列表（内核环境可能没有全局 fetch）
const http = await import('node:http');

export function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

export function attachWs(wsUrl) {
  return (async () => {
    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(wsUrl, { maxPayload: 0 });
    let id = 0;
    const pending = new Map();
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    });
    await new Promise((r) => ws.on('open', r));
    const send = (method, params) => new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    return { send, close: () => ws.close() };
  })();
}
