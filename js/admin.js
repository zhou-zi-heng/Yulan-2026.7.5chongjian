/* ===== 飞凡AI - 超管后台 (v3.0.0 批次3.9) ===== */

const Admin = (function () {

    let _curTab = 'users';
    let _presetData = null;
    let _curPresetIdx = -1;       // 当前编辑的预设索引
    let _openSteps = {};          // 步骤折叠状态
    let _presetDirty = false;     // 未保存标记
    let _usersCache = [];

    async function apiCall(path, method, body) {
        const token = (typeof Auth !== 'undefined' && Auth.getToken()) ? Auth.getToken() : '';
        const opts = { method: method || 'GET', headers: { 'X-Auth-Token': token } };
        if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        const resp = await fetch('/api/' + path.replace(/^\//, ''), opts);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
        return data;
    }
    function loadXLSX() {
        if (window.XLSX) return Promise.resolve();
        if (typeof OfficeParser !== 'undefined' && OfficeParser.loadXLSX) return OfficeParser.loadXLSX();
        return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = () => window.XLSX ? resolve() : reject(new Error('SheetJS加载失败')); s.onerror = () => reject(new Error('SheetJS加载失败')); document.head.appendChild(s); });
    }

    function open() { if (typeof Auth === 'undefined' || !Auth.isAdmin()) { toast('无管理员权限', 'er'); return; } const mo = document.getElementById('mo-admin'); if (mo) mo.classList.add('show'); switchTab(_curTab); }
    function close() {
        if (_curTab === 'presets' && _presetDirty) { if (!confirm('预设有未保存的修改，确定关闭？未保存内容会丢失。')) return; }
        const mo = document.getElementById('mo-admin'); if (mo) mo.classList.remove('show');
    }
    function switchTab(tab) {
        if (_curTab === 'presets' && tab !== 'presets' && _presetDirty) { if (!confirm('预设有未保存的修改，确定切换？未保存内容会丢失。')) return; }
        _curTab = tab;
        document.querySelectorAll('#adminTabs .admin-tab').forEach(b => b.classList.toggle('act', b.dataset.tab === tab));
        const body = document.getElementById('adminBody'); if (!body) return;
        if (tab === 'users') renderUsers(body);
        else if (tab === 'engines') renderEngines(body);
        else if (tab === 'models') renderModels(body);
        else if (tab === 'presets') renderPresets(body);
        else if (tab === 'monitor') renderMonitor(body);
        else if (tab === 'config') renderConfig(body);
    }
    function fmtTime(ts) { if (!ts) return '从未'; const d = Date.now() - ts; if (d < 60000) return '刚刚'; if (d < 3600000) return Math.floor(d / 60000) + '分钟前'; if (d < 86400000) return Math.floor(d / 3600000) + '小时前'; return Math.floor(d / 86400000) + '天前'; }

    /* ========== 账号管理 ========== */
    async function renderUsers(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try { const data = await apiCall('admin/users/list'); _usersCache = data.users || []; drawUsersTable(box, ''); }
        catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }
    function drawUsersTable(box, kw) {
        kw = (kw || '').toLowerCase(); let users = _usersCache;
        if (kw) users = users.filter(u => (u.username + ' ' + (u.name || '')).toLowerCase().includes(kw));
        let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
            <button class="btn btn-p btn-s" onclick="Admin.showCreateUser()">➕ 新增账号</button>
            <label class="btn btn-s" style="cursor:pointer">📥 xlsx导入<input type="file" accept=".xlsx,.xls" onchange="Admin.importXLSX(this)" style="display:none"></label>
            <button class="btn btn-s" onclick="Admin.exportXLSX(false)">📤 导出(脱敏)</button>
            <button class="btn btn-s btn-d" onclick="Admin.exportXLSX(true)">📤 导出(含Key)</button>
            <button class="btn btn-s" onclick="Admin.downloadTemplate()">📋 模板</button>
            <button class="btn btn-s" onclick="Admin.switchTab('users')">🔄 刷新</button>
            <input type="text" placeholder="🔍 搜索姓名/账号" oninput="Admin.searchUsers(this.value)" style="margin-left:auto;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:12px;width:180px"></div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:8px">共 ${_usersCache.length} 个账号${kw ? '，匹配 ' + users.length : ''}。🔴=最近7天≥3个IP。</div>
            <div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>引擎</th><th>权限</th><th>最后活跃</th><th>IP</th><th>操作</th></tr></thead><tbody>`;
        users.forEach(u => { let permTxt = '全部'; try { const p = JSON.parse(u.permissions || '{}'); if (p.allowGroups && p.allowGroups.length) permTxt = p.allowGroups.join('/'); } catch (e) {} html += `<tr><td>${esc(u.name || '-')}</td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '👑' : '普通'}</td><td>${u.status === 'active' ? '<span style="color:#10b981">启用</span>' : '<span style="color:#ef4444">禁用</span>'}</td><td>${u.engineCount}</td><td style="font-size:11px;max-width:110px;overflow:hidden;text-overflow:ellipsis">${esc(permTxt)}</td><td style="font-size:11px">${fmtTime(u.lastActive)}</td><td>${u.ipAbnormal ? '<span style="color:#ef4444;font-weight:bold">🔴' + u.ipCount + '</span>' : (u.ipCount || 0)}</td><td class="admin-ops"><button onclick='Admin.showPerm(${JSON.stringify(u.username)},${JSON.stringify(u.permissions || "{}")})' title="权限">🎫</button><button onclick='Admin.showResetPwd(${JSON.stringify(u.username)})' title="改密">🔑</button><button onclick='Admin.toggleStatus(${JSON.stringify(u.username)},${JSON.stringify(u.status)})' title="启用/禁用">${u.status === 'active' ? '🚫' : '✅'}</button>${u.username !== 'admin' ? `<button onclick='Admin.delUser(${JSON.stringify(u.username)})' style="color:#ef4444">🗑️</button>` : ''}</td></tr>`; });
        html += '</tbody></table></div>'; box.innerHTML = html;
    }
    function searchUsers(kw) { drawUsersTable(document.getElementById('adminBody'), kw); }
    function showCreateUser() { const name = prompt('姓名：', ''); if (name === null) return; const username = prompt('账号：', ''); if (!username || !username.trim()) { toast('账号不能为空', 'er'); return; } const password = prompt('密码：', ''); if (!password || !password.trim()) { toast('密码不能为空', 'er'); return; } const isAdmin = confirm('设为管理员？\n✅=管理员 ❌=普通'); apiCall('admin/users/create', 'POST', { username: username.trim(), password: password.trim(), name: name.trim(), role: isAdmin ? 'admin' : 'user' }).then(() => { toast('✅ 已创建'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function showResetPwd(username) { const p = prompt('为【' + username + '】设新密码：', ''); if (!p || !p.trim()) return; apiCall('admin/users/resetpwd', 'POST', { username, password: p.trim() }).then(() => toast('✅ 已重置')).catch(e => toast('失败：' + e.message, 'er')); }
    function toggleStatus(username, cur) { const next = cur === 'active' ? 'disabled' : 'active'; apiCall('admin/users/update', 'POST', { username, status: next }).then(() => { toast(next === 'active' ? '已启用' : '已禁用'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function delUser(username) { if (!confirm('删除账号【' + username + '】？其引擎、会话也删除。')) return; apiCall('admin/users/delete', 'POST', { username }).then(() => { toast('✅ 已删除'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function showPerm(username, permJson) { let perm = {}; try { perm = JSON.parse(permJson); } catch (e) {} const cur = (perm.allowGroups || []).join(','); const groups = (typeof Workflow !== 'undefined' && Workflow.isLoaded()) ? Workflow.getGroups().join('、') : '（预设未加载）'; const v = prompt('设置【' + username + '】可用工作流分组\n\n可选：' + groups + '\n\n多个用英文逗号；留空=全部：', cur); if (v === null) return; const arr = v.split(',').map(s => s.trim()).filter(Boolean); apiCall('admin/users/perm', 'POST', { username, permissions: Object.assign({}, perm, { allowGroups: arr }) }).then(() => { toast('✅ 权限已更新（实时生效）'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function importXLSX(inputEl) { const file = inputEl.files && inputEl.files[0]; if (!file) return; loadXLSX().then(() => { const reader = new FileReader(); reader.onload = async (e) => { try { const wb = XLSX.read(e.target.result, { type: 'array' }); const sheet = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }); if (!rows.length) { toast('表格无数据', 'er'); inputEl.value = ''; return; } if (!confirm('导入 ' + rows.length + ' 行（同账号覆盖+重配引擎）？')) { inputEl.value = ''; return; } toast('导入中...'); const res = await apiCall('admin/users/import', 'POST', { rows }); let msg = '✅ 账号 ' + res.userCount + '，引擎 ' + res.engCount; if (res.errors && res.errors.length) msg += '\n⚠️ ' + res.errors.join('；'); alert(msg); switchTab('users'); } catch (err) { toast('导入失败：' + err.message, 'er'); } inputEl.value = ''; }; reader.readAsArrayBuffer(file); }).catch(e => toast('加载解析库失败：' + e.message, 'er')); }
    async function exportXLSX(withKey) { if (withKey && !confirm('⚠️ 导出含明文Key，妥善保管！继续？')) return; try { await loadXLSX(); const res = await apiCall('admin/users/export?withkey=' + (withKey ? '1' : '0')); const ws = XLSX.utils.json_to_sheet(res.rows || [], { header: ['姓名', '账号', '密码', '角色', '引擎名称', '协议', 'BaseURL', 'APIKey', '模型', '输入单价', '输出单价', '缓存读单价', '缓存写单价'] }); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '账号'); XLSX.writeFile(wb, 'feifan-accounts-' + (withKey ? 'withkey-' : '') + new Date().toISOString().slice(0, 10) + '.xlsx'); toast('✅ 已导出'); } catch (e) { toast('导出失败：' + e.message, 'er'); } }
    async function downloadTemplate() { try { await loadXLSX(); const rows = [{ 姓名: '张三', 账号: 'zhangsan', 密码: 'pass123', 角色: 'user', 引擎名称: '快速引擎', 协议: 'openai', BaseURL: 'https://api.openai-proxy.org/v1', APIKey: 'sk-xxx', 模型: '', 输入单价: '', 输出单价: '', 缓存读单价: '', 缓存写单价: '' }, { 姓名: '李四', 账号: 'lisi', 密码: 'pass456', 角色: 'user', 引擎名称: '便宜', 协议: 'openai', BaseURL: 'https://api.openai-proxy.org/v1', APIKey: 'sk-ds', 模型: '', 输入单价: '', 输出单价: '', 缓存读单价: '', 缓存写单价: '' }]; const ws = XLSX.utils.json_to_sheet(rows, { header: ['姓名', '账号', '密码', '角色', '引擎名称', '协议', 'BaseURL', 'APIKey', '模型', '输入单价', '输出单价', '缓存读单价', '缓存写单价'] }); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '账号'); XLSX.writeFile(wb, 'feifan-账号导入模板.xlsx'); toast('✅ 模板已下载'); } catch (e) { toast('生成模板失败：' + e.message, 'er'); } }

    /* ========== 引擎管理（加缓存开关） ========== */
    async function renderEngines(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            const usersData = await apiCall('admin/users/list'); const users = usersData.users || [];
            const engData = await apiCall('admin/engines/list'); const engs = engData.engines || [];
            const byUser = {}; engs.forEach(e => { if (!byUser[e.username]) byUser[e.username] = []; byUser[e.username].push(e); });
            let html = `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">给账号配公有引擎。💰=已开缓存（省钱）。模型可留空让用户自选。</div>`;
            users.forEach(u => {
                const ue = byUser[u.username] || [];
                html += `<div class="eng-user-block"><div class="eng-user-hdr"><b>${esc(u.name || u.username)}</b> <span style="color:var(--text2);font-size:11px">(${esc(u.username)})</span><button class="btn btn-p btn-s" style="margin-left:auto" onclick='Admin.showEngEdit(${JSON.stringify(u.username)},"")'>➕ 加引擎</button></div>`;
                if (!ue.length) html += '<div style="font-size:11px;color:var(--text2);padding:4px 0">（无引擎）</div>';
                ue.forEach(e => { html += `<div class="eng-item"><span>📦 ${esc(e.name)} ${e.useCache ? '<span style="color:#10b981">💰缓存</span>' : ''} <span style="color:var(--text2);font-size:11px">${esc(e.protocol)} / ${esc(e.model || '用户自选')}</span></span><div style="margin-left:auto;display:flex;gap:4px"><button class="btn btn-s" onclick='Admin.showEngEdit(${JSON.stringify(e.username)},${JSON.stringify(e.id)})'>✏️改</button><button class="btn btn-s btn-d" onclick='Admin.delEng(${JSON.stringify(e.id)})'>🗑️</button></div></div>`; });
                html += `</div>`;
            });
            box.innerHTML = html; box._engs = engs;
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }
    function showEngEdit(username, engId) {
        const box = document.getElementById('adminBody'); const engs = (box && box._engs) || [];
        const e = engId ? engs.find(x => x.id === engId) : null;
        box.innerHTML = `<div style="max-width:520px"><h3 style="margin-bottom:12px">${e ? '✏️ 编辑' : '➕ 新增'}公有引擎 — ${esc(username)}</h3>
            <div class="fg"><label>引擎名称</label><input id="ee_name" value="${e ? esc(e.name) : ''}"></div>
            <div class="fg"><label>协议</label><select id="ee_proto"><option value="openai"${!e || e.protocol === 'openai' ? ' selected' : ''}>OpenAI/通用</option><option value="anthropic"${e && e.protocol === 'anthropic' ? ' selected' : ''}>Claude原生</option><option value="gemini"${e && e.protocol === 'gemini' ? ' selected' : ''}>Gemini原生</option></select></div>
            <div class="fg"><label>Base URL</label><input id="ee_base" value="${e ? esc(e.base) : 'https://api.openai-proxy.org/v1'}"></div>
            <div class="fg"><label>API Key ${e ? '<span style="color:var(--text2);font-size:11px">（留空=不改）</span>' : ''}</label><input id="ee_key" type="password" placeholder="${e ? '••••（留空不变）' : 'sk-...'}"></div>
            <div class="fg"><label>默认模型 <span style="color:var(--text2);font-size:11px">（可留空，用户自选）</span></label><input id="ee_model" value="${e ? esc(e.model || '') : ''}" placeholder="留空让用户获取选择"></div>
            <div class="fg" style="padding:10px;background:var(--pri-l);border-radius:8px"><label class="pt" style="margin:0"><input type="checkbox" id="ee_cache" ${e && e.useCache ? 'checked' : ''}> 💰 开启 Prompt 缓存（重复内容省钱，Claude等支持）</label><div style="font-size:11px;color:var(--text2);margin-top:4px">开启后，用户对话底部"💰命中"数字>0即生效省钱</div></div>
            <div class="fg"><label style="font-size:11px;color:var(--text2)">单价可留空 → 查"模型库"。也可指定：</label></div>
            <div class="fr"><div class="fg"><label>输入</label><input id="ee_pi" type="number" step="0.01" value="${e ? (e.priceIn || 0) : 0}"></div><div class="fg"><label>输出</label><input id="ee_po" type="number" step="0.01" value="${e ? (e.priceOut || 0) : 0}"></div></div>
            <div class="fr"><div class="fg"><label>缓存读</label><input id="ee_pcr" type="number" step="0.01" value="${e ? (e.priceCR || 0) : 0}"></div><div class="fg"><label>缓存写</label><input id="ee_pcw" type="number" step="0.01" value="${e ? (e.priceCW || 0) : 0}"></div></div>
            <div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-p" onclick='Admin.saveEng(${JSON.stringify(username)},${JSON.stringify(e ? e.id : "")})'>💾 保存</button><button class="btn" onclick="Admin.switchTab('engines')">取消</button></div></div>`;
    }
    function saveEng(username, engId) { const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; }; const body = { username, id: engId || undefined, name: g('ee_name').trim(), protocol: g('ee_proto'), base: g('ee_base').trim(), key: g('ee_key').trim(), model: g('ee_model').trim(), useCache: document.getElementById('ee_cache').checked, priceIn: parseFloat(g('ee_pi')) || 0, priceOut: parseFloat(g('ee_po')) || 0, priceCR: parseFloat(g('ee_pcr')) || 0, priceCW: parseFloat(g('ee_pcw')) || 0 }; if (!body.name) { toast('引擎名必填', 'er'); return; } apiCall('admin/engines/save', 'POST', body).then(() => { toast('✅ 已保存'); switchTab('engines'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function delEng(id) { if (!confirm('删除这个引擎？')) return; apiCall('admin/engines/delete', 'POST', { id }).then(() => { toast('✅ 已删除'); switchTab('engines'); }).catch(e => toast('失败：' + e.message, 'er')); }

    /* ========== 模型库 ========== */
    async function renderModels(box) { box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>'; try { const data = await apiCall('admin/models/list'); const models = data.models || []; let html = `<div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn btn-p btn-s" onclick="Admin.showModelEdit('')">➕ 新增模型</button><button class="btn btn-s" onclick="Admin.switchTab('models')">🔄 刷新</button></div><div style="font-size:12px;color:var(--text2);margin-bottom:8px">模型库：配各模型单价（美元/1M token）。引擎未指定单价时自动查这里。</div><div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>模型名</th><th>输入</th><th>输出</th><th>缓存读</th><th>缓存写</th><th>操作</th></tr></thead><tbody>`; models.forEach(m => { html += `<tr><td>${esc(m.model_name)}</td><td>${m.price_in}</td><td>${m.price_out}</td><td>${m.price_cache_read}</td><td>${m.price_cache_write}</td><td class="admin-ops"><button onclick='Admin.showModelEdit(${JSON.stringify(m.model_name)})'>✏️</button><button onclick='Admin.delModel(${JSON.stringify(m.model_name)})' style="color:#ef4444">🗑️</button></td></tr>`; }); html += '</tbody></table></div>'; box.innerHTML = html; box._models = models; } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; } }
    function showModelEdit(modelName) { const box = document.getElementById('adminBody'); const models = (box && box._models) || []; const m = modelName ? models.find(x => x.model_name === modelName) : null; box.innerHTML = `<div style="max-width:460px"><h3 style="margin-bottom:12px">${m ? '✏️ 编辑' : '➕ 新增'}模型单价</h3><div class="fg"><label>模型名 ${m ? '（不可改）' : ''}</label><input id="mm_name" value="${m ? esc(m.model_name) : ''}" ${m ? 'disabled' : ''} placeholder="如 gpt-4o"></div><div class="fr"><div class="fg"><label>输入</label><input id="mm_pi" type="number" step="0.01" value="${m ? m.price_in : 0}"></div><div class="fg"><label>输出</label><input id="mm_po" type="number" step="0.01" value="${m ? m.price_out : 0}"></div></div><div class="fr"><div class="fg"><label>缓存读</label><input id="mm_pcr" type="number" step="0.01" value="${m ? m.price_cache_read : 0}"></div><div class="fg"><label>缓存写</label><input id="mm_pcw" type="number" step="0.01" value="${m ? m.price_cache_write : 0}"></div></div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-p" onclick='Admin.saveModel(${JSON.stringify(m ? m.model_name : "")})'>💾 保存</button><button class="btn" onclick="Admin.switchTab('models')">取消</button></div></div>`; }
    function saveModel(existName) { const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; }; const name = existName || g('mm_name').trim(); if (!name) { toast('模型名必填', 'er'); return; } apiCall('admin/models/save', 'POST', { model_name: name, priceIn: parseFloat(g('mm_pi')) || 0, priceOut: parseFloat(g('mm_po')) || 0, priceCR: parseFloat(g('mm_pcr')) || 0, priceCW: parseFloat(g('mm_pcw')) || 0 }).then(() => { toast('✅ 已保存'); switchTab('models'); }).catch(e => toast('失败：' + e.message, 'er')); }
    function delModel(name) { if (!confirm('删除模型【' + name + '】单价？')) return; apiCall('admin/models/delete', 'POST', { model_name: name }).then(() => { toast('✅ 已删除'); switchTab('models'); }).catch(e => toast('失败：' + e.message, 'er')); }

    /* ========== 预设管理（左右分栏+折叠，重做） ========== */
    async function renderPresets(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中（解密明文）...</div>';
        try {
            let data = null; const res = await apiCall('admin/presets/get');
            if (res.presets) data = res.presets;
            else if (typeof Workflow !== 'undefined' && Workflow.getRawData) data = Workflow.getRawData();
            if (!data) data = { version: 3, groups: [], security: { sensitiveWords: [], alertWebhook: '', alertKeyword: '飞凡警报', simThreshold: 70, guard: true }, presets: [] };
            _presetData = JSON.parse(JSON.stringify(data));
            if (typeof Workflow !== 'undefined' && Workflow.decrypt) {
                for (const p of (_presetData.presets || [])) for (const s of (p.steps || [])) for (const seg of (s.segments || [])) if (seg.type === 'prompt') { try { seg._plain = await Workflow.decrypt(seg.hidden || ''); } catch (e) { seg._plain = '（解密失败）'; } }
            }
            _presetDirty = false;
            _curPresetIdx = (_presetData.presets && _presetData.presets.length) ? 0 : -1;
            _openSteps = {};
            drawPresetLayout(box);
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }
    /* 左右分栏布局 */
    function drawPresetLayout(box) {
        box.innerHTML = `<div class="preset-layout">
            <div class="preset-left">
                <div class="preset-left-tools">
                    <button class="btn btn-p btn-s btn-b" onclick="Admin.addPreset()">➕ 新建预设</button>
                    <input type="text" id="presetSearch" placeholder="🔍 搜索预设名" oninput="Admin.filterPresetList()">
                </div>
                <div class="preset-list-scroll" id="presetListScroll"></div>
                <div class="preset-left-ft">
                    <button class="btn btn-s btn-b" onclick="Admin.showSecurity()">🛡️ 安全设置</button>
                    <button class="btn btn-p btn-s btn-b" onclick="Admin.savePresets()" style="margin-top:6px">💾 保存到云端</button>
                    <div style="font-size:10px;color:var(--text2);margin-top:6px;display:flex;gap:8px"><a href="javascript:;" onclick="Admin.exportPresetsJSON()">导出备份</a><label style="cursor:pointer">导入JSON<input type="file" accept=".json" onchange="Admin.importPresetsJSON(this)" style="display:none"></label></div>
                    <div id="presetDirtyTip" style="font-size:11px;color:#ef4444;margin-top:4px"></div>
                </div>
            </div>
            <div class="preset-right" id="presetRight"></div>
        </div>`;
        drawPresetList();
        drawPresetEditor();
    }
    function drawPresetList() {
        const scroll = document.getElementById('presetListScroll'); if (!scroll) return;
        const kw = ((document.getElementById('presetSearch') || {}).value || '').toLowerCase();
        let html = '';
        (_presetData.presets || []).forEach((p, i) => {
            if (kw && !(p.name || '').toLowerCase().includes(kw)) return;
            html += `<div class="preset-litem${i === _curPresetIdx ? ' act' : ''}" onclick="Admin.selectPreset(${i})"><div class="pl-name">${esc(p.name || '未命名')}</div><div class="pl-meta">${esc(p.group || '无分组')} · ${(p.steps || []).length}步</div></div>`;
        });
        scroll.innerHTML = html || '<div style="font-size:12px;color:var(--text2);padding:10px;text-align:center">无预设</div>';
    }
    function filterPresetList() { drawPresetList(); }
    function selectPreset(i) { _curPresetIdx = i; _openSteps = {}; drawPresetList(); drawPresetEditor(); }
    function markDirty() { _presetDirty = true; const t = document.getElementById('presetDirtyTip'); if (t) t.textContent = '● 有未保存修改'; }
    function drawPresetEditor() {
        const right = document.getElementById('presetRight'); if (!right) return;
        if (_curPresetIdx < 0 || !_presetData.presets[_curPresetIdx]) { right.innerHTML = '<div style="color:var(--text2);text-align:center;padding:60px">← 左侧选择或新建预设</div>'; return; }
        const p = _presetData.presets[_curPresetIdx]; const pi = _curPresetIdx;
        let html = `<div class="preset-edit-hdr">
            <input value="${esc(p.name)}" onchange="Admin.updP(${pi},'name',this.value)" placeholder="预设名" style="font-weight:600;font-size:15px;flex:1">
            <input value="${esc(p.group || '')}" onchange="Admin.updP(${pi},'group',this.value)" placeholder="分组" style="width:120px">
            <button class="btn btn-s btn-d" onclick="Admin.delPreset(${pi})">🗑️ 删预设</button>
        </div><div class="preset-steps">`;
        (p.steps || []).forEach((s, si) => {
            const open = !!_openSteps[si];
            html += `<div class="pstep${open ? ' open' : ''}">
                <div class="pstep-bar" onclick="Admin.toggleStep(${si})">
                    <span class="pstep-caret">${open ? '▼' : '▶'}</span>
                    <span class="pstep-title">步骤${si + 1}：${esc(s.name || '未命名')}</span>
                    ${s.engineName ? '<span style="font-size:10px;color:var(--pri)">🔌' + esc(s.engineName) + '</span>' : ''}
                    <span class="pstep-ops" onclick="event.stopPropagation()">
                        <button onclick="Admin.moveStep(${si},-1)" title="上移">↑</button>
                        <button onclick="Admin.moveStep(${si},1)" title="下移">↓</button>
                        <button onclick="Admin.delStep(${si})" title="删除" style="color:#ef4444">🗑️</button>
                    </span>
                </div>
                <div class="pstep-body">
                    <div class="fr"><div class="fg"><label>步骤名</label><input value="${esc(s.name || '')}" onchange="Admin.updS(${si},'name',this.value)"></div><div class="fg"><label>绑定引擎名(选填)</label><input value="${esc(s.engineName || '')}" onchange="Admin.updS(${si},'engineName',this.value)" placeholder="该步自动用此公有引擎"></div></div>
                    <div class="seg-list">`;
            (s.segments || []).forEach((seg, gi) => {
                if (seg.type === 'prompt') html += `<div class="seg-item seg-prompt"><div class="seg-label">🔒隐藏指令（明文，保存自动加密）</div><textarea class="seg-prompt-ta" onchange="Admin.updSegPrompt(${si},${gi},this.value)" placeholder="隐藏指令明文">${esc(seg._plain || '')}</textarea><button class="btn btn-s btn-d" onclick="Admin.delSeg(${si},${gi})">删</button></div>`;
                else if (seg.type === 'input') html += `<div class="seg-item seg-input"><div class="seg-label">✍️输入框</div><input value="${esc(seg.placeholder || '')}" onchange="Admin.updSeg(${si},${gi},'placeholder',this.value)" placeholder="提示文字"><input value="${esc(seg.defaultValue || '')}" onchange="Admin.updSeg(${si},${gi},'defaultValue',this.value)" placeholder="默认值"><button class="btn btn-s btn-d" onclick="Admin.delSeg(${si},${gi})">删</button></div>`;
                else if (seg.type === 'blank') html += `<div class="seg-item seg-blank"><div class="seg-label">📝填空题（{}=空位）</div><input value="${esc(seg.template || '')}" onchange="Admin.updSeg(${si},${gi},'template',this.value)" placeholder="如：题材是{}，视角是{}"><button class="btn btn-s btn-d" onclick="Admin.delSeg(${si},${gi})">删</button></div>`;
            });
            html += `</div><div style="display:flex;gap:4px;margin-top:6px"><button class="btn btn-s" onclick="Admin.addSeg(${si},'prompt')">+隐藏指令</button><button class="btn btn-s" onclick="Admin.addSeg(${si},'input')">+输入框</button><button class="btn btn-s" onclick="Admin.addSeg(${si},'blank')">+填空题</button></div></div></div>`;
        });
        html += `</div><button class="btn btn-p btn-s" onclick="Admin.addStep()" style="margin-top:8px">➕ 添加步骤</button>`;
        right.innerHTML = html;
    }
    function updP(pi, f, v) { _presetData.presets[pi][f] = v; markDirty(); if (f === 'name' || f === 'group') drawPresetList(); }
    function updS(si, f, v) { _presetData.presets[_curPresetIdx].steps[si][f] = v; markDirty(); }
    function updSeg(si, gi, f, v) { _presetData.presets[_curPresetIdx].steps[si].segments[gi][f] = v; markDirty(); }
    function updSegPrompt(si, gi, v) { const seg = _presetData.presets[_curPresetIdx].steps[si].segments[gi]; seg._plain = v; seg._dirty = true; markDirty(); }
    function toggleStep(si) { _openSteps[si] = !_openSteps[si]; drawPresetEditor(); }
    function addPreset() { _presetData.presets.push({ id: 'p' + Math.random().toString(36).slice(2, 8), name: '新预设', group: '', steps: [] }); _curPresetIdx = _presetData.presets.length - 1; _openSteps = {}; markDirty(); drawPresetList(); drawPresetEditor(); }
    function delPreset(pi) { if (!confirm('删除此预设？')) return; _presetData.presets.splice(pi, 1); _curPresetIdx = _presetData.presets.length ? 0 : -1; _openSteps = {}; markDirty(); drawPresetList(); drawPresetEditor(); }
    function addStep() { const p = _presetData.presets[_curPresetIdx]; if (!p.steps) p.steps = []; p.steps.push({ id: 's' + Math.random().toString(36).slice(2, 8), name: '新步骤', order: p.steps.length + 1, segments: [] }); _openSteps[p.steps.length - 1] = true; markDirty(); drawPresetList(); drawPresetEditor(); }
    function delStep(si) { if (!confirm('删除此步骤？')) return; _presetData.presets[_curPresetIdx].steps.splice(si, 1); markDirty(); drawPresetList(); drawPresetEditor(); }
    function moveStep(si, dir) { const steps = _presetData.presets[_curPresetIdx].steps; const j = si + dir; if (j < 0 || j >= steps.length) return; const t = steps[si]; steps[si] = steps[j]; steps[j] = t; steps.forEach((s, i) => s.order = i + 1); const to = _openSteps[si], tj = _openSteps[j]; _openSteps[si] = tj; _openSteps[j] = to; markDirty(); drawPresetEditor(); }
    function addSeg(si, type) { const seg = { type }; if (type === 'prompt') { seg.hidden = ''; seg._plain = ''; seg._dirty = true; } else if (type === 'input') { seg.placeholder = '请输入...'; seg.defaultValue = ''; } else if (type === 'blank') { seg.template = ''; } _presetData.presets[_curPresetIdx].steps[si].segments.push(seg); markDirty(); drawPresetEditor(); }
    function delSeg(si, gi) { _presetData.presets[_curPresetIdx].steps[si].segments.splice(gi, 1); markDirty(); drawPresetEditor(); }
    function showSecurity() {
        const sec = _presetData.security || {};
        const right = document.getElementById('presetRight');
        right.innerHTML = `<div style="max-width:520px"><h3 style="margin-bottom:12px">🛡️ 安全设置</h3>
            <div class="fg"><label>分组（逗号隔开）</label><input id="ps_groups" value="${esc((_presetData.groups || []).join(','))}"></div>
            <div class="fg"><label>敏感词（逗号隔开）</label><textarea id="ps_sensitive" rows="4">${esc((sec.sensitiveWords || []).join(','))}</textarea></div>
            <div class="fg"><label>钉钉Webhook</label><input id="ps_webhook" value="${esc(sec.alertWebhook || '')}"></div>
            <div class="fr"><div class="fg"><label>报警关键词</label><input id="ps_keyword" value="${esc(sec.alertKeyword || '飞凡警报')}"></div><div class="fg"><label>相似度阈值%</label><input id="ps_sim" type="number" value="${sec.simThreshold || 70}"></div></div>
            <div class="pt"><input type="checkbox" id="ps_guard" ${sec.guard !== false ? 'checked' : ''}><label for="ps_guard">开启GUARD保密前缀</label></div>
            <button class="btn btn-p" onclick="Admin.applySecurity()" style="margin-top:10px">✔️ 应用（需再点保存到云端）</button></div>`;
    }
    function applySecurity() {
        _presetData.groups = document.getElementById('ps_groups').value.split(',').map(s => s.trim()).filter(Boolean);
        _presetData.security = { sensitiveWords: document.getElementById('ps_sensitive').value.split(',').map(s => s.trim()).filter(Boolean), alertWebhook: document.getElementById('ps_webhook').value.trim(), alertKeyword: document.getElementById('ps_keyword').value.trim() || '飞凡警报', simThreshold: parseInt(document.getElementById('ps_sim').value) || 70, guard: document.getElementById('ps_guard').checked };
        markDirty(); toast('已应用，记得点"💾 保存到云端"'); drawPresetEditor();
    }
    async function savePresets() {
        toast('加密并保存中...');
        try {
            for (const p of _presetData.presets) for (const s of (p.steps || [])) for (const seg of (s.segments || [])) if (seg.type === 'prompt') { if (typeof Workflow !== 'undefined' && Workflow.encrypt) seg.hidden = await Workflow.encrypt(seg._plain || ''); else seg.hidden = '__PLAIN__' + (seg._plain || ''); }
            // 保存时深拷贝并去掉 _plain/_dirty
            const clean = JSON.parse(JSON.stringify(_presetData));
            clean.presets.forEach(p => (p.steps || []).forEach(s => (s.segments || []).forEach(seg => { delete seg._plain; delete seg._dirty; })));
            await apiCall('admin/presets/save', 'POST', { presets: clean });
            _presetDirty = false; const t = document.getElementById('presetDirtyTip'); if (t) t.textContent = '';
            toast('✅ 已保存到云端，所有用户下次加载生效');
            if (typeof Workflow !== 'undefined' && Workflow.reload) await Workflow.reload(clean);
        } catch (e) { toast('保存失败：' + e.message, 'er'); }
    }
    function exportPresetsJSON() { const clean = JSON.parse(JSON.stringify(_presetData)); clean.presets.forEach(p => (p.steps || []).forEach(s => (s.segments || []).forEach(seg => { delete seg._plain; delete seg._dirty; }))); const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'presets-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(a.href); toast('✅ 已导出'); }
    function importPresetsJSON(inputEl) { const file = inputEl.files && inputEl.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (e) => { try { _presetData = JSON.parse(e.target.result); if (typeof Workflow !== 'undefined' && Workflow.decrypt) { for (const p of (_presetData.presets || [])) for (const s of (p.steps || [])) for (const seg of (s.segments || [])) if (seg.type === 'prompt') { try { seg._plain = await Workflow.decrypt(seg.hidden || ''); } catch (er) { seg._plain = ''; } } } _curPresetIdx = _presetData.presets.length ? 0 : -1; _openSteps = {}; markDirty(); drawPresetLayout(document.getElementById('adminBody')); toast('✅ 已导入（点保存生效）'); } catch (err) { toast('JSON解析失败', 'er'); } inputEl.value = ''; }; reader.readAsText(file, 'utf-8'); }

    /* ========== 监视 ========== */
    async function renderMonitor(box) { box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>'; try { const data = await apiCall('admin/monitor'); const logMap = {}; (data.logs || []).forEach(l => logMap[l.username] = l); const sessMap = {}; (data.sessions || []).forEach(s => sessMap[s.username] = s); const usernames = new Set([...Object.keys(logMap), ...Object.keys(sessMap)]); let html = `<div style="display:flex;gap:16px;margin-bottom:12px;flex-wrap:wrap"><div style="padding:10px 16px;background:var(--pri-l);border-radius:8px"><div style="font-size:11px;color:var(--text2)">当前在线（5分钟内）</div><div style="font-size:22px;font-weight:600;color:#10b981">${data.onlineCount || 0} 人</div></div><button class="btn btn-s" onclick="Admin.switchTab('monitor')" style="align-self:center">🔄刷新</button></div><div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>账号</th><th>对话次数</th><th>累计Token</th><th>不同IP</th><th>最后活跃</th></tr></thead><tbody>`; usernames.forEach(un => { const l = logMap[un] || {}; const s = sessMap[un] || {}; html += `<tr><td>${esc(un)}</td><td>${l.logCount || 0}</td><td>${(l.totalTokens || 0).toLocaleString()}</td><td>${(s.ipc || 0) >= 3 ? '<span style="color:#ef4444">🔴' + s.ipc + '</span>' : (s.ipc || 0)}</td><td style="font-size:11px">${fmtTime(s.last || 0)}</td></tr>`; }); html += '</tbody></table></div><h4 style="font-size:13px;margin:16px 0 8px">📋 最近100条</h4><div style="overflow-x:auto;max-height:280px;overflow-y:auto"><table class="admin-table"><thead><tr><th>时间</th><th>账号</th><th>对话</th><th>轮次</th><th>Token</th><th>模型</th></tr></thead><tbody>'; (data.recent || []).forEach(r => { html += `<tr><td style="font-size:11px">${new Date(r.created_at).toLocaleString()}</td><td>${esc(r.username)}</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(r.chat_name || '-')}</td><td>${r.rounds || 0}</td><td>${r.tokens || 0}</td><td>${esc(r.model || '-')}</td></tr>`; }); html += '</tbody></table></div>'; box.innerHTML = html; } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; } }

    /* ========== 全局设置 ========== */
    async function renderConfig(box) { box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>'; try { const data = await apiCall('admin/config/get'); const cfg = data.config || {}; box.innerHTML = `<div style="max-width:400px"><h4 style="font-size:13px;margin-bottom:12px">⚙️ 全局参数（所有用户生效）</h4><div class="fg"><label>📐 物理打标：每块字数</label><input id="cfg_chunkSize" type="number" value="${esc(cfg.chunkSize || '300')}" min="50" max="5000"><div style="font-size:11px;color:var(--text2);margin-top:4px">默认300。</div></div><button class="btn btn-p" onclick="Admin.saveConfig()">💾 保存</button></div>`; } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; } }
    function saveConfig() { const chunkSize = document.getElementById('cfg_chunkSize').value; apiCall('admin/config/save', 'POST', { config: { chunkSize } }).then(() => { toast('✅ 已保存'); if (typeof Chunker !== 'undefined') Chunker.setBlockSize(chunkSize); }).catch(e => toast('失败：' + e.message, 'er')); }

    return {
        open, close, switchTab, apiCall,
        showCreateUser, showResetPwd, toggleStatus, delUser, showPerm, searchUsers,
        importXLSX, exportXLSX, downloadTemplate,
        showEngEdit, saveEng, delEng,
        showModelEdit, saveModel, delModel,
        addPreset, delPreset, selectPreset, filterPresetList, updP, updS, updSeg, updSegPrompt,
        toggleStep, addStep, delStep, moveStep, addSeg, delSeg,
        showSecurity, applySecurity, savePresets, exportPresetsJSON, importPresetsJSON,
        saveConfig,
    };
})();

window.Admin = Admin;
