export async function onRequest(context) {
    const { request } = context;

    // 处理预检请求
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
            }
        });
    }

    // 从请求头获取目标 API 地址
    const targetBase = request.headers.get('X-Target-Base');
    if (!targetBase) {
        return new Response(JSON.stringify({ error: 'Missing X-Target-Base header' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 提取子路径：/api/models → models，/api/chat/completions → chat/completions
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\//, '');
    const targetUrl = targetBase.replace(/\/+$/, '') + '/' + subPath + url.search;

    // 转发请求头（过滤掉 Cloudflare 内部头）
    const headers = new Headers();
    const skipHeaders = ['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-worker', 'cf-ipcountry', 'cf-ew-via', 'x-target-base'];
    for (const [key, value] of request.headers) {
        if (!skipHeaders.includes(key.toLowerCase())) {
            headers.set(key, value);
        }
    }

    try {
        const resp = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
        });

        // 返回响应
        const newHeaders = new Headers(resp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(resp.body, {
            status: resp.status,
            statusText: resp.statusText,
            headers: newHeaders,
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Proxy failed: ' + e.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}