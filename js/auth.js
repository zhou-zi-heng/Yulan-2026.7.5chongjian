/* ===== 飞凡AI - 前端登录/鉴权 (v3.0.0 批次2) ===== */

const Auth = (function () {

    const TOKEN_KEY = 'feifan_token';
    const USER_KEY = 'feifan_user';
    let _user = null;

    function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
    function getUser() {
        if (_user) return _user;
        try { _user = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { _user = null; }
        return _user;
    }
    function isAdmin() { const u = getUser(); return !!(u && u.role === 'admin'); }
    function role() { const u = getUser(); return u ? u.role : ''; }

    function saveSession(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        _user = user;
    }
    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        _user = null;
    }

    /* 登录请求 */
    async function login(username, password) {
        const resp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) throw new Error(data.error || '登录失败');
        saveSession(data.token, data.user);
        return data.user;
    }

    /* 校验当前 token 是否有效 */
    async function verify() {
        const token = getToken();
        if (!token) return false;
        try {
            const resp = await fetch('/api/verify', {
                method: 'POST',
                headers: { 'X-Auth-Token': token },
            });
            const data = await resp.json();
            if (resp.ok && data.ok) {
                if (data.user) { _user = data.user; localStorage.setItem(USER_KEY, JSON.stringify(data.user)); }
                return true;
            }
            return false;
        } catch (e) {
            // 网络异常时，本地有token先放行（离线容错），真正请求AI时后端会再校验
            return !!token;
        }
    }

    function logout() {
        clearSession();
        location.reload();
    }

    /* ---------- 登录页 UI 控制 ---------- */
    function showLoginPage(errMsg) {
        let el = document.getElementById('loginOverlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'loginOverlay';
            el.innerHTML = `
                <div class="login-box">
                    <div class="login-logo">🚀</div>
                    <h2>飞凡AI 对话</h2>
                    <p class="login-sub">请登录后使用</p>
                    <input type="text" id="loginUser" placeholder="账号" autocomplete="username">
                    <input type="password" id="loginPass" placeholder="密码" autocomplete="current-password">
                    <div class="login-err" id="loginErr"></div>
                    <button id="loginBtn">登 录</button>
                </div>
            `;
            document.body.appendChild(el);
            const doLogin = async () => {
                const u = document.getElementById('loginUser').value.trim();
                const p = document.getElementById('loginPass').value.trim();
                const errEl = document.getElementById('loginErr');
                const btn = document.getElementById('loginBtn');
                if (!u || !p) { errEl.textContent = '请输入账号和密码'; return; }
                btn.disabled = true; btn.textContent = '登录中...';
                try {
                    await login(u, p);
                    el.remove();
                    location.reload();
                } catch (e) {
                    errEl.textContent = e.message;
                    btn.disabled = false; btn.textContent = '登 录';
                }
            };
            document.getElementById('loginBtn').onclick = doLogin;
            document.getElementById('loginPass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
            document.getElementById('loginUser').onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); };
        }
        if (errMsg) { const errEl = document.getElementById('loginErr'); if (errEl) errEl.textContent = errMsg; }
        el.style.display = 'flex';
    }

    return {
        getToken: getToken,
        getUser: getUser,
        isAdmin: isAdmin,
        role: role,
        login: login,
        verify: verify,
        logout: logout,
        showLoginPage: showLoginPage,
        clearSession: clearSession,
    };
})();

window.Auth = Auth;
