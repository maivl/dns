// app/dns/route.ts
export const runtime = "edge";

const UPSTREAM = "https://1.1.1.1/dns-query";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const upstreamUrl = new URL(UPSTREAM);
  upstreamUrl.search = url.search; // 透传 ?dns=xxxx

  const resp = await fetch(upstreamUrl.toString(), {
    headers: {
      "accept": "application/dns-message",
    },
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "content-type": "application/dns-message",
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const body = await req.arrayBuffer();

  const resp = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      "content-type": "application/dns-message",
      "accept": "application/dns-message",
    },
    body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "content-type": "application/dns-message",
    },
  });
}
