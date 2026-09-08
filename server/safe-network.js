import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import ipaddr from 'ipaddr.js';

export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
const loopback = address => { try { return ipaddr.process(address).range() === 'loopback'; } catch { return false; } };
export function providerUrl(value, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请填写有效的 API 基础地址'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.username || url.password || url.search || url.hash || value.length > 500) throw new Error('API 地址不能包含账号、密码、查询参数或片段');
  const local = allowLoopback && (host === 'localhost' || loopback(host));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('API 地址必须使用 HTTPS');
  if (ipaddr.isValid(host) && !publicAddress(host) && !local) throw new Error('不能连接私有或保留网络地址');
  if (host === 'localhost' && !local || /\.(localhost|local|internal)$/.test(host)) throw new Error('不能连接私有网络地址');
  return url;
}

// Pin the validated DNS answer into the socket. No redirects or pooled sockets
// can send a key to a different address after validation.
export function safeProviderFetch({ allowLoopback = false, resolve = lookup, transports = { 'https:': httpsRequest, 'http:': httpRequest } } = {}) {
  return async (value, options) => {
    const url = providerUrl(value, { allowLoopback }), host = url.hostname.replace(/^\[|\]$/g, '');
    if (options.method !== 'POST' || typeof options.body !== 'string') throw new Error('不支持的提供商请求');
    options.signal?.throwIfAborted();
    let addresses;
    try { addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }] : await resolve(host, { all: true, verbatim: true }); }
    catch { throw new Error('无法解析提供商地址'); }
    options.signal?.throwIfAborted();
    if (!addresses.length || addresses.some(item => !publicAddress(item.address) && !(allowLoopback && loopback(item.address)))) throw new Error('提供商地址解析到私有或保留网络');
    const pinned = addresses.find(item => item.family === 4) || addresses[0];
    return new Promise((resolveResponse, reject) => {
      const req = transports[url.protocol](url, {
        method: 'POST', headers: options.headers, signal: options.signal, agent: false,
        family: pinned.family, autoSelectFamily: false, rejectUnauthorized: true,
        lookup: (_host, opts, callback) => opts?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
      }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 1048576) { req.destroy(); reject(new Error('提供商响应超过大小上限')); return; }
          chunks.push(chunk);
        });
        res.on('error', () => reject(new Error('提供商响应被中断')));
        res.on('end', () => resolveResponse({
          ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
          headers: new Headers(Object.entries(res.headers).filter(([, value]) => typeof value === 'string')),
          json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      req.on('error', () => reject(new Error(options.signal?.aborted ? '提供商请求已取消' : '提供商连接失败')));
      req.setTimeout(12000, () => req.destroy());
      req.end(options.body);
    });
  };
}
