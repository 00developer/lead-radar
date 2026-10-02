// The real network transport for safe-fetch: DNS through the operating system, and a request pinned to the address that
// safe-fetch already checked (so DNS cannot change between check and use). Size and time are capped here.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { Resolved, Transport, TransportResponse } from './safe-fetch';

export function createNodeTransport(): Transport {
  return {
    async resolve(host: string): Promise<Resolved[]> {
      const list = await dns.promises.lookup(host, { all: true, verbatim: true });
      return list.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
    },

    get({ url, ip, family, headers, timeoutMs, maxBytes }): Promise<TransportResponse> {
      return new Promise((resolve, reject) => {
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        let settled = false;
        const finish = (fn: () => void) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            fn();
          }
        };

        const req = lib.request(
          {
            method: 'GET',
            hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            headers: { ...headers, Host: url.host },
            // Pin the connection to the address that was checked. Never look the name up again.
            lookup: ((_h: string, opts: unknown, cb: (...a: unknown[]) => void) => {
              if (typeof opts === 'object' && opts !== null && (opts as { all?: boolean }).all) cb(null, [{ address: ip, family }]);
              else cb(null, ip, family);
            }) as never,
            // SNI / certificate name must be the site name, not the address. Skip for IP literal hosts.
            ...(isHttps && !net.isIP(hostname) ? { servername: hostname } : {}),
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            let truncated = false;
            res.on('data', (c: Buffer) => {
              size += c.length;
              if (size > maxBytes) {
                truncated = true;
                chunks.push(c.subarray(0, Math.max(0, c.length - (size - maxBytes))));
                res.destroy(); // stop reading a huge response
                return;
              }
              chunks.push(c);
            });
            const flat = () => {
              const h: Record<string, string> = {};
              for (const [k, v] of Object.entries(res.headers)) if (typeof v === 'string') h[k.toLowerCase()] = v;
              finish(() => resolve({ status: res.statusCode ?? 0, headers: h, body: Buffer.concat(chunks), truncated }));
            };
            res.on('end', flat);
            res.on('close', flat);
            res.on('error', (e) => finish(() => (truncated ? flat() : reject(e))));
          },
        );
        const timer = setTimeout(() => {
          req.destroy(new Error('timed out'));
          finish(() => reject(new Error('timed out')));
        }, timeoutMs);
        req.on('error', (e) => finish(() => reject(e)));
        req.end();
      });
    },
  };
}
