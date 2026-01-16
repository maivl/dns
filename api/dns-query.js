/**
 * Vercel Edge Function – Reverse Split DNS (JSON DoH)
 *
 * 策略：
 * - 默认 → 国内 DNS（阿里 / 腾讯）
 * - 命中“被墙/海外域名列表” → Cloudflare DNS
 *
 * 仅支持：
 * - GET
 * - application/dns-json
 */

export const config = {
  runtime: 'edge',
  regions: [
    'hkg1', // 香港（最优）
    'hnd1', // 东京
    'kix1', // 大阪
    'icn1', // 首尔
    'sin1', // 新加坡
    'fra1', // 法兰克福
    'lhr1', // 伦敦
  ],
};

/* =========================
   可配置策略区
========================= */

// 国内 DNS（JSON DoH）
const CHINA_DOH = [
  'https://dns.alidns.com/resolve',
  'https://doh.pub/resolve',
];

// Cloudflare DNS（海外 / 被墙）
const GLOBAL_DOH = 'https://cloudflare-dns.com/dns-query';

// 被墙 / 海外优先域名（命中即走 Cloudflare）
const GLOBAL_DOMAIN_SUFFIX = [
  '.google.com',
  '.googleapis.com',
  '.gstatic.com',
  '.youtube.com',
  '.ytimg.com',
  '.openai.com',
  '.chatgpt.com',
  '.github.com',
  '.githubusercontent.com',
  '.twitter.com',
  '.x.com',
  '.facebook.com',
  '.instagram.com',
  '.whatsapp.com',
  '.wikipedia.org',
];

// 国内 DNS 轮询
function pickChinaDoH() {
  return CHINA_DOH[Math.floor(Math.random() * CHINA_DOH.length)];
}

// 是否需要走 Cloudflare
function shouldUseGlobalDNS(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return GLOBAL_DOMAIN_SUFFIX.some((suffix) => d.endsWith(suffix));
}

/* =========================
   Edge 主逻辑
========================= */

export default async function handler(req) {
  const start = Date.now();

  try {
    if (req.method !== 'GET') {
      console.warn('[DNS] Reject non-GET:', req.method);
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(req.url);
    const name = url.searchParams.get('name');
    const type = url.searchParams.get('type') || 'A';

    if (!name) {
      console.warn('[DNS] Missing name param');
      return new Response('Bad Request: missing name', { status: 400 });
    }

    const useGlobal = shouldUseGlobalDNS(name);
    const upstream = useGlobal ? GLOBAL_DOH : pickChinaDoH();

    console.log(
      `[DNS] ${name} (${type}) → ${useGlobal ? 'GLOBAL' : 'CHINA'} → ${upstream}`
    );

    const upstreamUrl = new URL(upstream);
    upstreamUrl.searchParams.set('name', name);
    upstreamUrl.searchParams.set('type', type);

    const resp = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/dns-json',
      },
    });

    console.log(
      `[DNS] Upstream status=${resp.status} cost=${Date.now() - start}ms`
    );

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/dns-json',
        'Cache-Control': 'max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[DNS] Internal Error:', err);
    return new Response('DNS Proxy Error', { status: 500 });
  }
}
