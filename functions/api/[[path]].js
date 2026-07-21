/* ===== 飞凡AI - 后端 (v3.0.0 批次3.2：账号管理) ===== */

/* ---------- 工具：Web Crypto ---------- */
async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(escape(atob(str)));
}
async function hmacSign(message, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function signJWT(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const body = Object.assign({}, payload, { iat: now, exp: now + 5 * 24 * 3600 });
    const h = b64urlEncode(JSON.stringify(header));
    const p = b64urlEncode(JSON.stringify(body));
    const sig = await hmacSign(h + '.' + p, secret);
    return h + '.' + p + '.' + sig;
}
async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const expectSig = await hmacSign(parts[0] + '.' + parts[1], secret);
        if (expectSig !== parts[2]) return null;
        const payload = JSON.parse(b64urlDecode(parts[1]));
        if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
        return payload;
    } catch (e) { return null; }
}
async function verifyAdmin(request, env) {
    const auth = request.headers.get('X-Auth-Token') || '';
    if (!auth) return null;
    const payload = await verifyJWT(auth, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') return null;
    return payload;
}

/* ---------- 引擎Key加密（用 KEY_SECRET） ---------- */
async function encKey(plain, secret) {
    if (!plain) return '';
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 50000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
    const b = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return 'ENC:' + b(salt) + ':' + b(iv) + ':' + b(cipher);
}
async function decKey(stored, secret) {
    if (!stored) return '';
    if (stored.indexOf('ENC:') !== 0) return stored; // 兼容明文
    try {
        const parts = stored.split(':');
        const ub = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
        const salt = ub(parts[1]), iv = ub(parts[2]), cipher = ub(parts[3]);
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'PBKDF2' }, false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 50000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        return new TextDecoder().decode(plain);
    } catch (e) { return ''; }
}

/* ---------- CORS ---------- */
function corsHeaders() {
    return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' };
}
function jsonResp(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()) });
}

/* ---------- 主入口 ---------- */
export async function onRequest(context) {
    const { request, env } = context;
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Max-Age': '86400' }, corsHeaders()) });
    }
    const url = new URL(request.url);
    const subPath = url.pathname.replace(/^\/api\//, '');

    if (subPath === 'init') return await handleInit(request, env, url);
    if (subPath === 'login') return await handleLogin(request, env);
    if (subPath === 'verify') return await handleVerify(request, env);

    if (subPath.startsWith('admin/')) {
        const adminPayload = await verifyAdmin(request, env);
        if (!adminPayload) return jsonResp({ error: '无管理员权限' }, 403);
        return await handleAdmin(request, env, subPath.replace(/^admin\//, ''), adminPayload);
    }

    return await handleProxy(request, env, url, subPath);
}

/* ---------- 初始化 admin ---------- */
async function handleInit(request, env, url) {
    if (!env.DB) return jsonResp({ error: 'D1 未绑定（DB）' }, 500);
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.JWT_SECRET) return jsonResp({ error: '初始化密钥错误' }, 403);
    try {
        const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ?').bind('admin').first();
        if (existing) return jsonResp({ error: '已存在管理员账号，初始化接口已失效' }, 400);
        const pwdHash = await sha256('admin123');
        await env.DB.prepare('INSERT INTO users (username, password_hash, name, role, status, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('admin', pwdHash, '超级管理员', 'admin', 'active', '{}', Date.now()).run();
        return jsonResp({ ok: true, msg: '✅ 已创建 admin 账号（密码 admin123）' });
    } catch (e) { return jsonResp({ error: '初始化失败：' + e.message }, 500); }
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
        const token = await signJWT({ username: user.username, name: user.name, role: user.role, permissions: user.permissions || '{}' }, env.JWT_SECRET);
        const ip = request.headers.get('CF-Connecting-IP') || '';
        try {
            await env.DB.prepare('INSERT INTO sessions (username, session_id, ip, last_active, login_at) VALUES (?, ?, ?, ?, ?)').bind(user.username, token.slice(-16), ip, Date.now(), Date.now()).run();
        } catch (e) {}
        return jsonResp({ ok: true, token: token, user: { username: user.username, name: user.name, role: user.role, permissions: user.permissions || '{}' } });
    } catch (e) { return jsonResp({ error: '登录失败：' + e.message }, 500); }
}

/* ---------- 校验 token ---------- */
async function handleVerify(request, env) {
    const auth = request.headers.get('X-Auth-Token') || '';
    if (!auth) return jsonResp({ ok: false, error: '无token' }, 401);
    const payload = await verifyJWT(auth, env.JWT_SECRET);
    if (!payload) return jsonResp({ ok: false, error: 'token无效或过期' }, 401);
    if (env.DB) {
        const ip = request.headers.get('CF-Connecting-IP') || '';
        try { await env.DB.prepare('UPDATE sessions SET last_active = ?, ip = ? WHERE session_id = ?').bind(Date.now(), ip, auth.slice(-16)).run(); } catch (e) {}
    }
    return jsonResp({ ok: true, user: { username: payload.username, name: payload.name, role: payload.role, permissions: payload.permissions || '{}' } });
}

/* ---------- 管理后台接口分发 ---------- */
async function handleAdmin(request, env, action, payload) {
    if (!env.DB) return jsonResp({ error: 'D1 未绑定' }, 500);
    if (action === 'ping') return jsonResp({ ok: true, msg: 'admin鉴权通过', admin: payload.username });

    // ===== 账号管理 =====
    if (action === 'users/list') return await adminUsersList(env);
    if (action === 'users/create') return await adminUsersCreate(request, env);
    if (action === 'users/update') return await adminUsersUpdate(request, env);
    if (action === 'users/delete') return await adminUsersDelete(request, env);
    if (action === 'users/resetpwd') return await adminUsersResetPwd(request, env);
    if (action === 'users/import') return await adminUsersImport(request, env);
    if (action === 'users/export') return await adminUsersExport(request, env);

    return jsonResp({ error: '未知管理接口：' + action }, 404);
}

/* ---------- 账号：列表（含在线状态、IP异常） ---------- */
async function adminUsersList(env) {
    try {
        const users = (await env.DB.prepare('SELECT id, username, name, role, status, created_at FROM users ORDER BY created_at DESC').all()).results || [];
        // 引擎数
        const engRows = (await env.DB.prepare('SELECT username, COUNT(*) AS cnt FROM engines_public GROUP BY username').all()).results || [];
        const engMap = {}; engRows.forEach(r => engMap[r.username] = r.cnt);
        // 会话（最近7天）：最后活跃 + 不同IP数
        const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
        const sessRows = (await env.DB.prepare('SELECT username, ip, last_active FROM sessions WHERE last_active > ?').bind(weekAgo).all()).results || [];
        const sessMap = {};
        sessRows.forEach(s => {
            if (!sessMap[s.username]) sessMap[s.username] = { last: 0, ips: {} };
            if (s.last_active > sessMap[s.username].last) sessMap[s.username].last = s.last_active;
            if (s.ip) sessMap[s.username].ips[s.ip] = 1;
        });
        const list = users.map(u => {
            const s = sessMap[u.username] || { last: 0, ips: {} };
            const ipCount = Object.keys(s.ips).length;
            return {
                username: u.username, name: u.name, role: u.role, status: u.status,
                engineCount: engMap[u.username] || 0,
                lastActive: s.last, ipCount: ipCount, ipAbnormal: ipCount >= 3,
            };
        });
        return jsonResp({ ok: true, users: list });
    } catch (e) { return jsonResp({ error: '获取列表失败：' + e.message }, 500); }
}

/* ---------- 账号：新增 ---------- */
async function adminUsersCreate(request, env) {
    let b; try { b = await request.json(); } catch (e) { return jsonResp({ error: '格式错误' }, 400); }
    const username = (b.username || '').trim();
    const password = (b.password || '').trim();
    const name = (b.name || '').trim();
    const role = b.role === 'admin' ? 'admin' : 'user';
    if (!username || !password) return jsonResp({ error: '账号和密码必填' }, 400);
    try {
        const exist = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        if (exist) return jsonResp({ error: '账号已存在：' + username }, 400);
        const pwdHash = await sha256(password);
        await env.DB.prepare('INSERT INTO users (username, password_hash, name, role, status, permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(username, pwdHash, name, role, 'active', '{}', Date.now()).run();
        return jsonResp({ ok: true });
    } catch (e) { return jsonResp({ error: '新增失败：' + e.message }, 500); }
}

/* ---------- 账号：更新（姓名/角色/状态） ---------- */
async function adminUsersUpdate(request, env) {
    let b; try { b = await request.json(); } catch (e) { return jsonResp({ error: '格式错误' }, 400); }
    const username = (b.username || '').trim();
    if (!username) return jsonResp({ error: '缺少账号' }, 400);
    try {
        const fields = [], vals = [];
        if (b.name !== undefined) { fields.push('name = ?'); vals.push(b.name); }
        if (b.role !== undefined) { fields.push('role = ?'); vals.push(b.role === 'admin' ? 'admin' : 'user'); }
        if (b.status !== undefined) { fields.push('status = ?'); vals.push(b.status === 'active' ? 'active' : 'disabled'); }
        if (!fields.length) return jsonResp({ error: '无更新内容' }, 400);
        vals.push(username);
        await env.DB.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE username = ?').bind(...vals).run();
        return jsonResp({ ok: true });
    } catch (e) { return jsonResp({ error: '更新失败：' + e.message }, 500); }
}

/* ---------- 账号：删除 ---------- */
async function adminUsersDelete(request, env) {
    let b; try { b = await request.json(); } catch (e) { return jsonResp({ error: '格式错误' }, 400); }
    const username = (b.username || '').trim();
    if (!username) return jsonResp({ error: '缺少账号' }, 400);
    if (username === 'admin') return jsonResp({ error: '不能删除 admin' }, 400);
    try {
        await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
        await env.DB.prepare('DELETE FROM engines_public WHERE username = ?').bind(username).run();
        await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(username).run();
        return jsonResp({ ok: true });
    } catch (e) { return jsonResp({ error: '删除失败：' + e.message }, 500); }
}

/* ---------- 账号：重置密码 ---------- */
async function adminUsersResetPwd(request, env) {
    let b; try { b = await request.json(); } catch (e) { return jsonResp({ error: '格式错误' }, 400); }
    const username = (b.username || '').trim();
    const password = (b.password || '').trim();
    if (!username || !password) return jsonResp({ error: '账号和新密码必填' }, 400);
    try {
        const pwdHash = await sha256(password);
        await env.DB.prepare('UPDATE users SET password_hash = ? WHERE username = ?').bind(pwdHash, username).run();
        await env.DB.prepare('DELETE FROM sessions WHERE username = ?').bind(username).run();
        return jsonResp({ ok: true });
    } catch (e) { return jsonResp({ error: '重置失败：' + e.message }, 500); }
}

/* ---------- 账号：CSV 批量导入（账号+引擎） ---------- */
async function adminUsersImport(request, env) {
    let b; try { b = await request.json(); } catch (e) { return jsonResp({ error: '格式错误' }, 400); }
    const rows = b.rows || []; // 已在前端解析成对象数组
    if (!rows.length) return jsonResp({ error: '无数据' }, 400);
    let userCount = 0, engCount = 0, errs = [];
    // 先按账号聚合
    const userMap = {};
    rows.forEach(r => {
        const un = (r['账号'] || '').trim();
        if (!un) return;
        if (!userMap[un]) {
            userMap[un] = {
                username: un, password: (r['密码'] || '').trim(), name: (r['姓名'] || '').trim(),
                role: (r['角色'] || 'user').trim() === 'admin' ? 'admin' : 'user', engines: []
            };
        }
        const engName = (r['引擎名称'] || '').trim();
        if (engName) {
            userMap[un].engines.push({
                name: engName, protocol: (r['协议'] || 'openai').trim(),
                base: (r['BaseURL'] || '').trim(), key: (r['APIKey'] || '').trim(), model: (r['模型'] || '').trim(),
                priceIn: parseFloat(r['输入单价']) || 0, priceOut: parseFloat(r['输出单价']) || 0,
                priceCR: parseFloat(r['缓存读单价']) || 0, priceCW: parseFloat(r['缓存写单价']) || 0,
            });
        }
    });
    for (const un in userMap) {
        const u = userMap[un];
        try {
            if (!u.password) { errs.push(un + '：缺密码'); continue; }
            const pwdHash = await sha256(u.password);
            const exist = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(un).first();
            if (exist) {
                await env.DB.prepare('UPDATE users SET password_hash=?, name=?, role=? WHERE username=?').bind(pwdHash, u.name, u.role, un).run();
            } else {
                await env.DB.prepare('INSERT INTO users (username, password_hash, name, role, status, permissions, created_at) VALUES (?,?,?,?,?,?,?)').bind(un, pwdHash, u.name, u.role, 'active', '{}', Date.now()).run();
            }
            userCount++;
            // 引擎：先删该账号旧引擎，再插新的
            await env.DB.prepare('DELETE FROM engines_public WHERE username = ?').bind(un).run();
            for (const eng of u.engines) {
                const engId = 'eng_' + un + '_' + Math.random().toString(36).slice(2, 8);
                const keyEnc = await encKey(eng.key, env.KEY_SECRET);
                await env.DB.prepare('INSERT INTO engines_public (id, username, name, protocol, base_url, api_key, model, price_in, price_out, price_cache_read, price_cache_write, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(engId, un, eng.name, eng.protocol, eng.base, keyEnc, eng.model, eng.priceIn, eng.priceOut, eng.priceCR, eng.priceCW, Date.now()).run();
                engCount++;
            }
        } catch (e) { errs.push(un + '：' + e.message); }
    }
    return jsonResp({ ok: true, userCount, engCount, errors: errs });
}

/* ---------- 账号：CSV 导出 ---------- */
async function adminUsersExport(request, env) {
    const url = new URL(request.url);
    const withKey = url.searchParams.get('withkey') === '1';
    try {
        const users = (await env.DB.prepare('SELECT username, name, role FROM users ORDER BY created_at').all()).results || [];
        const engs = (await env.DB.prepare('SELECT * FROM engines_public ORDER BY username').all()).results || [];
        const engByUser = {};
        engs.forEach(e => { if (!engByUser[e.username]) engByUser[e.username] = []; engByUser[e.username].push(e); });
        const header = ['姓名', '账号', '密码', '角色', '引擎名称', '协议', 'BaseURL', 'APIKey', '模型', '输入单价', '输出单价', '缓存读单价', '缓存写单价'];
        const lines = [header.join(',')];
        for (const u of users) {
            const uEngs = engByUser[u.username] || [];
            if (!uEngs.length) {
                lines.push([u.name, u.username, '******', u.role, '', '', '', '', '', '', '', '', ''].join(','));
            } else {
                for (const e of uEngs) {
                    let keyOut = '******';
                    if (withKey) { keyOut = await decKey(e.api_key, env.KEY_SECRET); }
                    const esc = (v) => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
                    lines.push([u.name, u.username, '******', u.role, e.name, e.protocol, e.base_url, keyOut, e.model, e.price_in, e.price_out, e.price_cache_read, e.price_cache_write].map(esc).join(','));
                }
            }
        }
        return jsonResp({ ok: true, csv: '\uFEFF' + lines.join('\n') });
    } catch (e) { return jsonResp({ error: '导出失败：' + e.message }, 500); }
}

/* ---------- AI 转发 ---------- */
async function handleProxy(request, env, url, subPath) {
    const auth = request.headers.get('X-Auth-Token') || '';
    const payload = auth ? await verifyJWT(auth, env.JWT_SECRET) : null;
    if (!payload) return jsonResp({ error: '未登录或登录已过期，请重新登录' }, 401);
    if (env.DB) {
        try { await env.DB.prepare('UPDATE sessions SET last_active = ? WHERE session_id = ?').bind(Date.now(), auth.slice(-16)).run(); } catch (e) {}
    }
    const targetBase = request.headers.get('X-Target-Base');
    if (!targetBase) return jsonResp({ error: 'Missing X-Target-Base header' }, 400);
    const targetUrl = targetBase.replace(/\/+$/, '') + '/' + subPath + url.search;
    const headers = new Headers();
    const skipHeaders = ['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-worker', 'cf-ipcountry', 'cf-ew-via', 'x-target-base', 'x-auth-token', 'content-length'];
    for (const [key, value] of request.headers) { if (!skipHeaders.includes(key.toLowerCase())) headers.set(key, value); }
    const isAnthropicPath = /\/messages\b/.test(targetUrl) || /anthropic/i.test(targetBase);
    if (isAnthropicPath && !headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
    try {
        const resp = await fetch(targetUrl, { method: request.method, headers: headers, body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined });
        const newHeaders = new Headers(resp.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Expose-Headers', '*');
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: newHeaders });
    } catch (e) { return jsonResp({ error: 'Proxy failed: ' + e.message }, 502); }
}
