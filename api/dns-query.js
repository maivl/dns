/**
 * Vercel Edge Function
 * Dual-Stack DoH Proxy:
 * - binary DoH (Streisand / iOS / RFC8484)
 * - JSON DoH (browser / curl)
 *
 * Strategy:
 * - DEFAULT → China DNS
 * - Hit global list → Cloudflare DNS
 */

export const config = {
  runtime: 'edge',
  regions: [
    'hkg1',
    'hnd1',
    'kix1',
    'icn1',
    'sin1',
    'fra1',
    'lhr1',
  ],
};

/* =========================
   Upstreams
========================= */

const CHINA_DOH = [
  'https://dns.alidns.com/dns-query',
  'https://doh.pub/dns-query',
];

const GLOBAL_DOH = 'https://cloudflare-dns.com/dns-query';

/* =========================
   Global / Blocked Domains
========================= */

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
  '.wikipedia.org',
];

function pickChinaDoH() {
  return CHINA_DOH[Math.floor(Math.random() * CHINA_DOH.length)];
}

function shouldUseGlobalDNS(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return GLOBAL_DOMAIN_SUFFIX.some((s) => d.endsWith(s));
}

/* =========================
   Minimal DNS QNAME Parser
   (binary DoH only)
========================= */

function parseQNameFromDNSQuery(buffer) {
  const view = new DataView(buffer);
  let offset = 12; // DNS header is 12 bytes
  const labels = [];

  while (offset < view.byteLength) {
    const len = view.getUint8(offset);
    if (len === 0) break;

    offset++;
    if (offset + len > view.byteLength) return null;

    let label = '';
    for (let i = 0; i < len; i++) {
      label += String.fromCharCode(view.getUint8(offset + i));
    }
    labels.push(label);
    offset += len;
  }

  return labels.length ? labels.join('.') : null;
}

/* =========================
   Main Handler
========================= */

export default async function handler(req) {
  const start = Date.now();

  try {
    const contentType = req.headers.get('content-type') || '';
    const accept = req.headers.get('accept') || '';

    const isJSON =
      accept.includes('application/dns-json') ||
      req.url.includes('name=');

    let domain = null;
    let upstream = null;

    /* ---------- JSON DoH ---------- */
    if (isJSON) {
      const url = new URL(req.url);
      domain = url.searchParams.get('name');
      upstream = shouldUseGlobalDNS(domain)
        ? GLOBAL_DOH
        : pickChinaDoH();

      console.log(
        `[DNS][JSON] ${domain} → ${upstream}`
      );

      const u = new URL(upstream);
      u.search = url.search;

      const resp = await fetch(u.toString(), {
        method: 'GET',
        headers: { Accept: 'application/dns-json' },
      });

      return new Response(resp.body, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/dns-json',
          'Cache-Control': 'max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    /* ---------- Binary DoH (Streisand) ---------- */
    const body = await req.arrayBuffer();
    domain = parseQNameFromDNSQuery(body);

    upstream = shouldUseGlobalDNS(domain)
      ? GLOBAL_DOH
      : pickChinaDoH();

    console.log(
      `[DNS][BIN] ${domain} → ${upstream}`
    );

    const resp = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/dns-message',
        'Accept': 'application/dns-message',
      },
      body,
    });

    console.log(
      `[DNS] OK ${resp.status} ${Date.now() - start}ms`
    );

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/dns-message',
        'Cache-Control': 'max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[DNS] Fatal error:', err);
    return new Response('DNS Proxy Error', { status: 500 });
  }
}
