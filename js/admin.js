/* ===== 飞凡AI - 超管后台 (v3.0.0 批次3.1 框架) ===== */

const Admin = (function () {

    let _curTab = 'users';

    /* 后端请求（带token，自动校验admin） */
    async function apiCall(path, method, body) {
        const token = (typeof Auth !== 'undefined' && Auth.getToken()) ? Auth.getToken() : '';
        const opts = {
            method: method || 'GET',
            headers: { 'X-Auth-Token': token },
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch('/api/' + path.replace(/^\//, ''), opts);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
        return data;
    }

    /* 打开后台 */
    function open() {
        if (typeof Auth === 'undefined' || !Auth.isAdmin()) {
            toast('无管理员权限', 'er');
            return;
        }
        const mo = document.getElementById('mo-admin');
        if (mo) mo.classList.add('show');
        switchTab(_curTab);
    }
    function close() {
        const mo = document.getElementById('mo-admin');
        if (mo) mo.classList.remove('show');
    }

    /* 切换标签页 */
    function switchTab(tab) {
        _curTab = tab;
        // 高亮
        document.querySelectorAll('#adminTabs .admin-tab').forEach(b => {
            b.classList.toggle('act', b.dataset.tab === tab);
        });
        const body = document.getElementById('adminBody');
        if (!body) return;
        // 各标签页内容（3.1先占位，后续小步填充）
        if (tab === 'users') renderUsers(body);
        else if (tab === 'engines') renderEngines(body);
        else if (tab === 'presets') renderPresets(body);
        else if (tab === 'monitor') renderMonitor(body);
        else if (tab === 'config') renderConfig(body);
    }

    /* ---------- 各标签页（3.1 占位，后续小步实现） ---------- */
    function renderUsers(box) {
        box.innerHTML = '<div class="admin-placeholder">👥 账号管理<br><span>批次3.2 实现：增删改查 / CSV批量导入导出 / 在线状态 / IP异常</span></div>';
    }
    function renderEngines(box) {
        box.innerHTML = '<div class="admin-placeholder">🔌 引擎管理<br><span>批次3.3 实现：配置公有引擎（含Key、价格），绑定给账号</span></div>';
    }
    function renderPresets(box) {
        box.innerHTML = '<div class="admin-placeholder">📋 预设管理<br><span>批次3.5 实现：在线编辑预设，存D1，覆盖式保存</span></div>';
    }
    function renderMonitor(box) {
        box.innerHTML = '<div class="admin-placeholder">📊 监视面板<br><span>批次3.7 实现：各账号对话数/轮次/token/模型统计</span></div>';
    }
    function renderConfig(box) {
        box.innerHTML = '<div class="admin-placeholder">⚙️ 全局设置<br><span>批次3.7 实现：打标块大小等全局参数</span></div>';
    }

    return {
        open: open,
        close: close,
        switchTab: switchTab,
        apiCall: apiCall,
    };
})();

window.Admin = Admin;
