export const config = {
  runtime: 'edge',
  regions: ['hkg1', 'sin1', 'icn1', 'hnd1', 'kix1'],
};

import { encode, decode } from 'base64-arraybuffer';
import dnsPacket from 'dns-packet';

// ===================== 配置区 =====================
const CONFIG = {
  UPSTREAM_DNS_CHINA: 'https://223.5.5.5/dns-query',
  UPSTREAM_DNS_GLOBAL: 'https://1.1.1.1/dns-query',
  BLACK_LIST: ['*ad.*', '*analytics.*', '*track.*', '*.doubleclick.net', '*.googleadservices.com'],
  WHITE_LIST: ['*.google.com', '*.youtube.com', '*.github.com', '*.chat.openai.com'],
  TTL: 300
};

const CHINA_DOMAINS = new Set([
  '.cn', '.com.cn', '.net.cn', '.org.cn', '.gov.cn', '.edu.cn',
  '.baidu.com', '.taobao.com', '.jd.com', '.163.com', '.qq.com', '.weixin.qq.com'
]);

// ===================== 预编译正则 =====================
const WHITE_REGEX = CONFIG.WHITE_LIST.map(r => new RegExp(r.replace(/\*/g, '.*')));
const BLACK_REGEX = CONFIG.BLACK_LIST.map(r => new RegExp(r.replace(/\*/g, '.*')));

// ===================== 辅助函数 =====================
function isChinaDomain(host) {
  for (const suffix of CHINA_DOMAINS) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

function isBlocked(host) {
  if (WHITE_REGEX.some(r => r.test(host))) return false;
  return BLACK_REGEX.some(r => r.test(host));
}

// ===================== 核心处理 =====================
export default async function handler(req) {
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  try {
    const url = new URL(req.url);
    const body = req.method === 'POST' ? await req.arrayBuffer() : null;
    const dnsData = req.method === 'GET' ? decode(url.searchParams.get('dns') || '') : body;

    const dnsRequest = dnsPacket.decode(new Uint8Array(dnsData));
    const host = dnsRequest.questions?.[0]?.name || '';

    if (host && isBlocked(host)) {
      return new Response('', {
        status: 204,
        headers: { 'Cache-Control': `max-age=${CONFIG.TTL}` }
      });
    }

    const upstreamDns = host && isChinaDomain(host)
      ? CONFIG.UPSTREAM_DNS_CHINA
      : CONFIG.UPSTREAM_DNS_GLOBAL;

    const proxyResponse = await fetch(upstreamDns, {
      method: req.method,
      headers: {
        'Content-Type': 'application/dns-message',
        'Accept': 'application/dns-message',
        'Cache-Control': `max-age=${CONFIG.TTL}`
      },
      body: req.method === 'POST' ? body : undefined,
      cf: { cacheTtl: CONFIG.TTL, cacheEverything: true }
    });

    return new Response(proxyResponse.body, {
      status: proxyResponse.status,
      headers: {
        'Content-Type': 'application/dns-message',
        'Cache-Control': `max-age=${CONFIG.TTL}`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
      }
    });

  } catch (err) {
    console.log(err)
    return new Response('DNS Proxy Error', { status: 500 });
  }
}
