/* ===== 飞凡AI - 超管后台 (v3.0.0 批次3.2：账号管理) ===== */

const Admin = (function () {

    let _curTab = 'users';

    async function apiCall(path, method, body) {
        const token = (typeof Auth !== 'undefined' && Auth.getToken()) ? Auth.getToken() : '';
        const opts = { method: method || 'GET', headers: { 'X-Auth-Token': token } };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const resp = await fetch('/api/' + path.replace(/^\//, ''), opts);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
        return data;
    }

    function open() {
        if (typeof Auth === 'undefined' || !Auth.isAdmin()) { toast('无管理员权限', 'er'); return; }
        const mo = document.getElementById('mo-admin');
        if (mo) mo.classList.add('show');
        switchTab(_curTab);
    }
    function close() {
        const mo = document.getElementById('mo-admin');
        if (mo) mo.classList.remove('show');
    }

    function switchTab(tab) {
        _curTab = tab;
        document.querySelectorAll('#adminTabs .admin-tab').forEach(b => b.classList.toggle('act', b.dataset.tab === tab));
        const body = document.getElementById('adminBody');
        if (!body) return;
        if (tab === 'users') renderUsers(body);
        else if (tab === 'engines') renderEngines(body);
        else if (tab === 'presets') renderPresets(body);
        else if (tab === 'monitor') renderMonitor(body);
        else if (tab === 'config') renderConfig(body);
    }

    /* ========== 账号管理 ========== */
    function fmtTime(ts) {
        if (!ts) return '从未';
        const d = Date.now() - ts;
        if (d < 60000) return '刚刚';
        if (d < 3600000) return Math.floor(d / 60000) + '分钟前';
        if (d < 86400000) return Math.floor(d / 3600000) + '小时前';
        return Math.floor(d / 86400000) + '天前';
    }

    async function renderUsers(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            const data = await apiCall('admin/users/list');
            const users = data.users || [];
            let html = `
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                    <button class="btn btn-p btn-s" onclick="Admin.showCreateUser()">➕ 新增账号</button>
                    <label class="btn btn-s" style="cursor:pointer">📥 CSV批量导入<input type="file" accept=".csv" onchange="Admin.importCSV(this)" style="display:none"></label>
                    <button class="btn btn-s" onclick="Admin.exportCSV(false)">📤 导出(脱敏)</button>
                    <button class="btn btn-s btn-d" onclick="Admin.exportCSV(true)">📤 导出(含Key)</button>
                    <button class="btn btn-s" onclick="Admin.downloadTemplate()">📋 下载CSV模板</button>
                    <button class="btn btn-s" onclick="Admin.switchTab('users')">🔄 刷新</button>
                </div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:8px">共 ${users.length} 个账号。🔴=最近7天出现≥3个不同IP（疑似账号外泄）</div>
                <div style="overflow-x:auto"><table class="admin-table">
                    <thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>引擎</th><th>最后活跃</th><th>IP</th><th>操作</th></tr></thead>
                    <tbody>`;
            users.forEach(u => {
                html += `<tr>
                    <td>${esc(u.name || '-')}</td>
                    <td>${esc(u.username)}</td>
                    <td>${u.role === 'admin' ? '👑管理' : '普通'}</td>
                    <td>${u.status === 'active' ? '<span style="color:#10b981">启用</span>' : '<span style="color:#ef4444">禁用</span>'}</td>
                    <td>${u.engineCount}</td>
                    <td style="font-size:11px">${fmtTime(u.lastActive)}</td>
                    <td>${u.ipAbnormal ? '<span title="≥3个不同IP" style="color:#ef4444;font-weight:bold">🔴' + u.ipCount + '</span>' : (u.ipCount || 0)}</td>
                    <td class="admin-ops">
                        <button onclick="Admin.showResetPwd('${esc(u.username)}')" title="改密">🔑</button>
                        <button onclick="Admin.toggleStatus('${esc(u.username)}','${u.status}')" title="启用/禁用">${u.status === 'active' ? '🚫' : '✅'}</button>
                        ${u.username !== 'admin' ? `<button onclick="Admin.delUser('${esc(u.username)}')" title="删除" style="color:#ef4444">🗑️</button>` : ''}
                    </td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            box.innerHTML = html;
        } catch (e) {
            box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>';
        }
    }

    function showCreateUser() {
        const name = prompt('姓名（备注）：', '');
        if (name === null) return;
        const username = prompt('账号（登录用）：', '');
        if (!username || !username.trim()) { toast('账号不能为空', 'er'); return; }
        const password = prompt('密码：', '');
        if (!password || !password.trim()) { toast('密码不能为空', 'er'); return; }
        const isAdmin = confirm('是否设为管理员？\n✅确定=管理员  ❌取消=普通用户');
        apiCall('admin/users/create', 'POST', { username: username.trim(), password: password.trim(), name: name.trim(), role: isAdmin ? 'admin' : 'user' })
            .then(() => { toast('✅ 已创建'); switchTab('users'); })
            .catch(e => toast('创建失败：' + e.message, 'er'));
    }
    function showResetPwd(username) {
        const p = prompt('为【' + username + '】设置新密码：', '');
        if (!p || !p.trim()) return;
        apiCall('admin/users/resetpwd', 'POST', { username: username, password: p.trim() })
            .then(() => toast('✅ 密码已重置，该账号需重新登录'))
            .catch(e => toast('失败：' + e.message, 'er'));
    }
    function toggleStatus(username, cur) {
        const next = cur === 'active' ? 'disabled' : 'active';
        apiCall('admin/users/update', 'POST', { username: username, status: next })
            .then(() => { toast(next === 'active' ? '已启用' : '已禁用'); switchTab('users'); })
            .catch(e => toast('失败：' + e.message, 'er'));
    }
    function delUser(username) {
        if (!confirm('确认删除账号【' + username + '】？\n该账号的引擎配置、会话记录也会一并删除。')) return;
        apiCall('admin/users/delete', 'POST', { username: username })
            .then(() => { toast('✅ 已删除'); switchTab('users'); })
            .catch(e => toast('失败：' + e.message, 'er'));
    }

    /* CSV 解析 */
    function parseCSV(text) {
        text = text.replace(/^\uFEFF/, '');
        const rows = [];
        let cur = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
            } else {
                if (c === '"') inQ = true;
                else if (c === ',') { cur.push(field); field = ''; }
                else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
                else if (c === '\r') {}
                else field += c;
            }
        }
        if (field || cur.length) { cur.push(field); rows.push(cur); }
        if (!rows.length) return [];
        const header = rows[0].map(h => h.trim());
        return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
            const o = {};
            header.forEach((h, i) => o[h] = (r[i] || '').trim());
            return o;
        });
    }

    function importCSV(inputEl) {
        const file = inputEl.files && inputEl.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = parseCSV(e.target.result);
                if (!rows.length) { toast('CSV无有效数据', 'er'); return; }
                if (!confirm('将导入 ' + rows.length + ' 行数据（同账号会覆盖更新+重配引擎）。继续？')) { inputEl.value = ''; return; }
                toast('导入中...');
                const res = await apiCall('admin/users/import', 'POST', { rows: rows });
                let msg = '✅ 账号 ' + res.userCount + ' 个，引擎 ' + res.engCount + ' 个';
                if (res.errors && res.errors.length) msg += '\n⚠️ 错误：' + res.errors.join('；');
                alert(msg);
                switchTab('users');
            } catch (err) { toast('导入失败：' + err.message, 'er'); }
            inputEl.value = '';
        };
        reader.readAsText(file, 'utf-8');
    }

    async function exportCSV(withKey) {
        if (withKey && !confirm('⚠️ 导出含明文APIKey的CSV，请妥善保管文件！\n继续？')) return;
        try {
            const res = await apiCall('admin/users/export?withkey=' + (withKey ? '1' : '0'));
            const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'feifan-accounts-' + (withKey ? 'withkey-' : '') + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
            URL.revokeObjectURL(a.href);
            toast('✅ 已导出');
        } catch (e) { toast('导出失败：' + e.message, 'er'); }
    }

    function downloadTemplate() {
        const header = '姓名,账号,密码,角色,引擎名称,协议,BaseURL,APIKey,模型,输入单价,输出单价,缓存读单价,缓存写单价';
        const example = [
            '张三,zhangsan,pass123,user,快速引擎,openai,https://api.openai-proxy.org/v1,sk-xxx,gpt-4o,2.5,10,0.3,3.75',
            '张三,zhangsan,pass123,user,高质量引擎,anthropic,https://api.openai-proxy.org/anthropic,sk-ant-xxx,claude-opus-4,15,75,1.5,18.75',
            '李四,lisi,pass456,user,便宜引擎,openai,https://api.openai-proxy.org/v1,sk-ds,deepseek-chat,0.14,0.28,0,0',
        ].join('\n');
        const csv = '\uFEFF' + header + '\n' + example;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'feifan-账号导入模板.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        toast('✅ 模板已下载。同一人多引擎=多行（账号密码重复填）');
    }

    /* ========== 其他标签（后续小步） ========== */
    function renderEngines(box) { box.innerHTML = '<div class="admin-placeholder">🔌 引擎管理<br><span>批次3.3 实现</span></div>'; }
    function renderPresets(box) { box.innerHTML = '<div class="admin-placeholder">📋 预设管理<br><span>批次3.5 实现</span></div>'; }
    function renderMonitor(box) { box.innerHTML = '<div class="admin-placeholder">📊 监视面板<br><span>批次3.7 实现</span></div>'; }
    function renderConfig(box) { box.innerHTML = '<div class="admin-placeholder">⚙️ 全局设置<br><span>批次3.7 实现</span></div>'; }

    return {
        open, close, switchTab, apiCall,
        showCreateUser, showResetPwd, toggleStatus, delUser,
        importCSV, exportCSV, downloadTemplate,
    };
})();

window.Admin = Admin;
