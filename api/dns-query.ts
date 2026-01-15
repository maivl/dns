// Vercel Edge Functions 核心DNS代理代码，路径：api/dns-query.ts
export const config = {
  runtime: 'edge', // 必须声明为边缘运行时，核心！
  regions: ['hkg1', 'sin1', 'tok1'], // 优选节点：香港/新加坡/东京，国内访问延迟最低
};

// ✅ 可自定义配置区 - 重点！在这里修改你的规则，全部可视化配置，无需改逻辑
const CONFIG = {
  // 上游DNS节点 - 可自定义替换，推荐保留这两个最优组合
  UPSTREAM_DNS_CHINA: 'https://223.5.5.5/dns-query', // 国内域名解析：阿里云DoH，极速无劫持
  UPSTREAM_DNS_GLOBAL: 'https://1.1.1.1/dns-query', // 海外域名解析：Cloudflare DoH，纯净抗污染
  
  // 黑白名单配置 - 按需添加，支持模糊匹配（*通配符）
  BLACK_LIST: [ // 要屏蔽的域名：广告、恶意网站、弹窗等
    '*ad.*', '*analytics.*', '*track.*', '*.doubleclick.net', '*.googleadservices.com'
  ],
  WHITE_LIST: [ // 强制放行的域名：优先级高于黑名单
    '*.google.com', '*.youtube.com', '*.github.com', '*.chat.openai.com'
  ],

  // 缓存策略：单位秒，降低重复请求，提升解析速度
  TTL: 300,
};

// 国内域名后缀库（精简版，够用，可自行扩充）
const CHINA_DOMAINS = new Set([
  '.cn', '.com.cn', '.net.cn', '.org.cn', '.gov.cn', '.edu.cn',
  '.baidu.com', '.taobao.com', '.jd.com', '.163.com', '.qq.com', '.weixin.qq.com'
]);

// 判断是否为国内域名
function isChinaDomain(host: string): boolean {
  for (const suffix of CHINA_DOMAINS) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// 判断是否在黑白名单
function isBlocked(host: string): boolean {
  if (CONFIG.WHITE_LIST.some(rule => host.match(rule.replace('*', '.*')))) return false;
  return CONFIG.BLACK_LIST.some(rule => host.match(rule.replace('*', '.*')));
}

// 核心处理函数
export default async function handler(req: Request): Promise<Response> {
  // 只允许 GET/POST 请求，符合DoH标准
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // 解析DNS请求体
  const body = req.method === 'POST' ? await req.arrayBuffer() : null;
  const url = new URL(req.url);

  // DoH标准：GET请求参数在url，POST请求在body
  const requestData = req.method === 'GET' 
    ? Buffer.from(url.searchParams.get('dns') || '', 'base64') 
    : Buffer.from(body || new ArrayBuffer(0));

  // 提取请求的域名（简易解析，够用）
  const host = requestData.length > 12 
    ? requestData.toString('utf-8').slice(12).split('\0')[0] 
    : '';

  // 黑名单拦截逻辑
  if (host && isBlocked(host)) {
    return new Response('', { status: 204, headers: { 'Cache-Control': `max-age=${CONFIG.TTL}` } });
  }

  // ✅ 核心分流逻辑：国内域名走阿里云，海外走Cloudflare
  const upstreamDns = host && isChinaDomain(host) 
    ? CONFIG.UPSTREAM_DNS_CHINA 
    : CONFIG.UPSTREAM_DNS_GLOBAL;

  // 转发DNS请求到上游节点
  const proxyResponse = await fetch(upstreamDns, {
    method: req.method,
    headers: {
      'Content-Type': 'application/dns-message',
      'Accept': 'application/dns-message',
      'Cache-Control': `max-age=${CONFIG.TTL}`,
    },
    body: req.method === 'POST' ? body : undefined,
    cf: { cacheTtl: CONFIG.TTL }, // Vercel边缘缓存，提升性能
  });

  // 返回解析结果给用户
  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    headers: {
      'Content-Type': 'application/dns-message',
      'Cache-Control': `max-age=${CONFIG.TTL}`,
      'Access-Control-Allow-Origin': '*', // 允许跨域，所有设备兼容
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}