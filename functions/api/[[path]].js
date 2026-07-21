/* ===== 飞凡AI - 后端 (v3.0.0 批次2：账号登录 + 原转发) ===== */

/* ---------- 工具：Web Crypto ---------- */

// SHA-256 哈希（密码加密）
async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Base64URL 编解码
function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
}

// HMAC-SHA256 签名
async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 签发 JWT（5天有效）
async function signJWT(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const body = Object.assign({}, payload, { iat: now, exp: now + 5 * 24 * 3600 });
    const h = b64urlEncode(JSON.stringify(header));
    const p = b64urlEncode(JSON.stringify(body));
    const sig = await hmacSign(h + '.' + p, secret);
    return h + '.' + p + '.' + sig;
}

// 校验 JWT，返回 payload 或 null
async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const expectSig = await hmacSign(parts[0] + '.' + parts[1], secret);
        if (expectSig !== parts[2]) return null;
        const payload = JSON.parse(b64urlDecode(parts[1]));
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

/* ---------- CORS 响应头 ---------- */
function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    };
}
function jsonResp(obj, status) {
    return new Response(JSON.stringify(obj), {
        status: status || 200,
        headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()),
    });
}

/* ---------- 主入口 ---------- */
export async function onRequest(context) {
    const { request, env } = context;

    // OPTIONS 预检
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Max-Age': '86400' }, corsHeaders()) });
    }

    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\//, '');

    // ========== 账号相关接口 ==========

    // 初始化 admin（一次性）
    if (subPath === 'init') {
        return await handleInit(request, env, url);
    }
    // 登录
    if (subPath === 'login') {
        return await handleLogin(request, env);
    }
    // 校验 token
    if (subPath === 'verify') {
        return await handleVerify(request, env);
    }

    // ========== 其他：AI 转发（原逻辑，需登录） ==========
    return await handleProxy(request, env, url, subPath);
}

/* ---------- 初始化 admin ---------- */
async function handleInit(request, env, url) {
    if (!env.DB) return jsonResp({ error: 'D1 未绑定（DB）' }, 500);
    // 用 JWT_SECRET 当初始化密钥校验
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.JWT_SECRET) {
        return jsonResp({ error: '初始化密钥错误' }, 403);
    }
    try {
        // 检查是否已有 admin
        const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ?').bind('admin').first();
        if (existing) {
            return jsonResp({ error: '已存在管理员账号，初始化接口已失效' }, 400);
        }
        const pwdHash = await sha256('admin123');
        await env.DB.prepare(
            'INSERT INTO users (username, password_hash, name, role, status, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind('admin', pwdHash, '超级管理员', 'admin', 'active', '{}', Date.now()).run();
        return jsonResp({ ok: true, msg: '✅ 已创建 admin 账号（密码 admin123），请尽快登录并修改' });
    } catch (e) {
        return jsonResp({ error: '初始化失败：' + e.message }, 500);
    }
}

/* ---------- 登录 ---------- */
async function handleLogin(request, env) {
    if (!env.DB) return jsonResp({ error: 'D1 未绑定（DB）' }, 500);
    if (request.method !== 'POST') return jsonResp({ error: '方法不允许' }, 405);
    let body;
    try { body = await request.json(); } catch (e) { return jsonResp({ error: '请求格式错误' }, 400); }
    const username = (body.username || '').trim();
    const password = (body.password || '').trim();
    if (!username || !password) return jsonResp({ error: '请输入账号和密码' }, 400);

    try {
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
        if (!user) return jsonResp({ error: '账号或密码错误' }, 401);
        if (user.status !== 'active') return jsonResp({ error: '该账号已被禁用' }, 403);
        const pwdHash = await sha256(password);
        if (pwdHash !== user.password_hash) return jsonResp({ error: '账号或密码错误' }, 401);

        // 签发 token
        const token = await signJWT({
            username: user.username,
            name: user.name,
            role: user.role,
            permissions: user.permissions || '{}',
        }, env.JWT_SECRET);

        // 记录会话（在线状态用）
        const ip = request.headers.get('CF-Connecting-IP') || '';
        try {
            await env.DB.prepare(
                'INSERT INTO sessions (username, session_id, ip, last_active, login_at) VALUES (?, ?, ?, ?, ?)'
            ).bind(user.username, token.slice(-16), ip, Date.now(), Date.now()).run();
        } catch (e) {}

        return jsonResp({
            ok: true,
            token: token,
            user: { username: user.username, name: user.name, role: user.role }
        });
    } catch (e) {
        return jsonResp({ error: '登录失败：' + e.message }, 500);
    }
}

/* ---------- 校验 token ---------- */
async function handleVerify(request, env) {
    const auth = request.headers.get('X-Auth-Token') || '';
    if (!auth) return jsonResp({ ok: false, error: '无token' }, 401);
    const payload = await verifyJWT(auth, env.JWT_SECRET);
    if (!payload) return jsonResp({ ok: false, error: 'token无效或过期' }, 401);
    // 更新最后活跃时间
    if (env.DB) {
        const ip = request.headers.get('CF-Connecting-IP') || '';
        try {
            await env.DB.prepare('UPDATE sessions SET last_active = ?, ip = ? WHERE session_id = ?')
                .bind(Date.now(), ip, auth.slice(-16)).run();
        } catch (e) {}
    }
    return jsonResp({ ok: true, user: { username: payload.username, name: payload.name, role: payload.role } });
}

/* ---------- AI 转发（原逻辑 + 登录校验） ---------- */
async function handleProxy(request, env, url, subPath) {
    // 校验登录
    const auth = request.headers.get('X-Auth-Token') || '';
    const payload = auth ? await verifyJWT(auth, env.JWT_SECRET) : null;
    if (!payload) {
        return jsonResp({ error: '未登录或登录已过期，请重新登录' }, 401);
    }

    // 更新活跃时间
    if (env.DB) {
        try {
            await env.DB.prepare('UPDATE sessions SET last_active = ? WHERE session_id = ?')
                .bind(Date.now(), auth.slice(-16)).run();
        } catch (e) {}
    }

    // ===== 以下是你原来的转发逻辑 =====
    const targetBase = request.headers.get('X-Target-Base');
    if (!targetBase) {
        return jsonResp({ error: 'Missing X-Target-Base header' }, 400);
    }

    const targetUrl = targetBase.replace(/\/+$/, '') + '/' + subPath + url.search;

    const headers = new Headers();
    const skipHeaders = [
        'host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-worker',
        'cf-ipcountry', 'cf-ew-via', 'x-target-base', 'x-auth-token', 'content-length',
    ];
    for (const [key, value] of request.headers) {
        if (!skipHeaders.includes(key.toLowerCase())) headers.set(key, value);
    }

    const isAnthropicPath = /\/messages\b/.test(targetUrl) || /anthropic/i.test(targetBase);
    if (isAnthropicPath && !headers.has('anthropic-version')) {
        headers.set('anthropic-version', '2023-06-01');
    }

    try {
        const resp = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
        });
        const newHeaders = new Headers(resp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Expose-Headers', '*');
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: newHeaders });
    } catch (e) {
        return jsonResp({ error: 'Proxy failed: ' + e.message }, 502);
    }
}
