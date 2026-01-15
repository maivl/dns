// Vercel Edge Functions DNS代理 - 零报错修复版
// 路径：api/dns-query.ts 【必须这个路径+文件名，不可修改】
export const config = {
  runtime: 'edge', // 固定声明为边缘运行时，必写
  regions: ['hkg1', 'sin1', 'hnd1'], // ✅ 修复：废弃tok1，改为合法节点hnd1(东京)，国内访问最优
};

// ✅ 可自定义配置区 - 所有配置不变，想改直接在这里改，和之前一样
const CONFIG = {
  // 上游DoH DNS节点，可自定义替换
  UPSTREAM_DNS_CHINA: 'https://223.5.5.5/dns-query', // 阿里云DoH 国内极速
  UPSTREAM_DNS_GLOBAL: 'https://1.1.1.1/dns-query',  // Cloudflare DoH 纯净抗污染
  
  // 黑白名单 - 支持通配符*，黑名单=屏蔽，白名单=强制放行（优先级更高）
  BLACK_LIST: ['*ad.*', '*analytics.*', '*track.*', '*.doubleclick.net'],
  WHITE_LIST: ['*.google.com', '*.youtube.com', '*.github.com', '*.chat.openai.com'],

  // DNS缓存时间(秒)，推荐300=5分钟，平衡速度和时效性
  TTL: 300,
};

// 国内域名后缀库 - 精简够用版，可自行扩充
const CHINA_DOMAINS = new Set([
  '.cn', '.com.cn', '.net.cn', '.org.cn', '.gov.cn', '.edu.cn',
  '.baidu.com', '.taobao.com', '.jd.com', '.163.com', '.qq.com', '.weixin.qq.com',
  '.bilibili.com', '.xiaohongshu.com', '.douyin.com'
]);

// ✅ 工具函数：替换Node Buffer的base64转ArrayBuffer (Web标准实现)
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
};

// 判断是否为国内域名，用于智能分流
function isChinaDomain(host: string): boolean {
  for (const suffix of CHINA_DOMAINS) {
    if (host.endsWith(suffix)) return true;
  }
  return false;
}

// 判断域名是否在黑白名单内
function isBlocked(host: string): boolean {
  if (CONFIG.WHITE_LIST.some(rule => host.match(rule.replace('*', '.*')))) return false;
  return CONFIG.BLACK_LIST.some(rule => host.match(rule.replace('*', '.*')));
}

// 核心处理函数 - 主逻辑
export default async function handler(req: Request): Promise<Response> {
  // 只允许GET/POST请求，符合DoH标准协议
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const url = new URL(req.url);
  let requestData: ArrayBuffer;

  // ✅ 修复Buffer：GET请求的dns参数(base64)转ArrayBuffer
  if (req.method === 'GET') {
    const dnsParam = url.searchParams.get('dns') || '';
    requestData = dnsParam ? base64ToArrayBuffer(dnsParam) : new ArrayBuffer(0);
  } else {
    // ✅ 修复Buffer：POST请求直接读取ArrayBuffer，无需Buffer转换
    requestData = await req.arrayBuffer();
  }

  // 简易提取请求的域名，用于分流和黑白名单判断
  const hostArr = new Uint8Array(requestData);
  const host = hostArr.length > 12 
    ? new TextDecoder().decode(hostArr.slice(12)).split('\0')[0] 
    : '';

  // 黑名单拦截逻辑：命中黑名单直接返回空响应
  if (host && isBlocked(host)) {
    return new Response('', {
      status: 204,
      headers: new Headers({ 'Cache-Control': `max-age=${CONFIG.TTL}` })
    });
  }

  // ✅ 核心智能分流逻辑：国内域名→阿里云，海外域名→Cloudflare
  const upstreamDns = host && isChinaDomain(host) 
    ? CONFIG.UPSTREAM_DNS_CHINA 
    : CONFIG.UPSTREAM_DNS_GLOBAL;

  // ✅ 修复cf参数报错：移除非法的cf配置，改用标准headers实现缓存
  const proxyResponse = await fetch(upstreamDns, {
    method: req.method,
    headers: new Headers({
      'Content-Type': 'application/dns-message',
      'Accept': 'application/dns-message',
      'Cache-Control': `max-age=${CONFIG.TTL}`,
    }),
    body: req.method === 'POST' ? requestData : undefined,
  });

  // 返回解析结果，配置跨域允许所有设备访问
  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    headers: new Headers({
      'Content-Type': 'application/dns-message',
      'Cache-Control': `max-age=${CONFIG.TTL}`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }),
  });
}