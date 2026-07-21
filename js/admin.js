/* ===== 飞凡AI - 超管后台 (v3.0.0 批次3全量) ===== */

const Admin = (function () {

    let _curTab = 'users';
    let _presetData = null;      // 预设编辑用的内存对象
    let _editingEngUser = null;  // 当前编辑引擎的账号

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
    function close() { const mo = document.getElementById('mo-admin'); if (mo) mo.classList.remove('show'); }

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

    function fmtTime(ts) {
        if (!ts) return '从未';
        const d = Date.now() - ts;
        if (d < 60000) return '刚刚';
        if (d < 3600000) return Math.floor(d / 60000) + '分钟前';
        if (d < 86400000) return Math.floor(d / 3600000) + '小时前';
        return Math.floor(d / 86400000) + '天前';
    }

    /* ========== 账号管理 ========== */
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
                    <button class="btn btn-s" onclick="Admin.downloadTemplate()">📋 CSV模板</button>
                    <button class="btn btn-s" onclick="Admin.switchTab('users')">🔄 刷新</button>
                </div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:8px">共 ${users.length} 个账号。🔴=最近7天≥3个不同IP（疑似外泄）。点"权限"限制可用工作流分组。</div>
                <div style="overflow-x:auto"><table class="admin-table">
                    <thead><tr><th>姓名</th><th>账号</th><th>角色</th><th>状态</th><th>引擎</th><th>权限</th><th>最后活跃</th><th>IP</th><th>操作</th></tr></thead><tbody>`;
            users.forEach(u => {
                let permTxt = '全部';
                try { const p = JSON.parse(u.permissions || '{}'); if (p.allowGroups && p.allowGroups.length) permTxt = p.allowGroups.join('/'); } catch (e) {}
                html += `<tr>
                    <td>${esc(u.name || '-')}</td><td>${esc(u.username)}</td>
                    <td>${u.role === 'admin' ? '👑' : '普通'}</td>
                    <td>${u.status === 'active' ? '<span style="color:#10b981">启用</span>' : '<span style="color:#ef4444">禁用</span>'}</td>
                    <td>${u.engineCount}</td>
                    <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${esc(permTxt)}</td>
                    <td style="font-size:11px">${fmtTime(u.lastActive)}</td>
                    <td>${u.ipAbnormal ? '<span title="≥3个IP" style="color:#ef4444;font-weight:bold">🔴' + u.ipCount + '</span>' : (u.ipCount || 0)}</td>
                    <td class="admin-ops">
                        <button onclick="Admin.showPerm('${esc(u.username)}','${esc(u.permissions || '{}').replace(/'/g,'&#39;')}')" title="权限">🎫</button>
                        <button onclick="Admin.showResetPwd('${esc(u.username)}')" title="改密">🔑</button>
                        <button onclick="Admin.toggleStatus('${esc(u.username)}','${u.status}')" title="启用/禁用">${u.status === 'active' ? '🚫' : '✅'}</button>
                        ${u.username !== 'admin' ? `<button onclick="Admin.delUser('${esc(u.username)}')" title="删除" style="color:#ef4444">🗑️</button>` : ''}
                    </td></tr>`;
            });
            html += '</tbody></table></div>';
            box.innerHTML = html;
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }

    function showCreateUser() {
        const name = prompt('姓名（备注）：', ''); if (name === null) return;
        const username = prompt('账号（登录用）：', ''); if (!username || !username.trim()) { toast('账号不能为空', 'er'); return; }
        const password = prompt('密码：', ''); if (!password || !password.trim()) { toast('密码不能为空', 'er'); return; }
        const isAdmin = confirm('是否设为管理员？\n✅=管理员  ❌=普通用户');
        apiCall('admin/users/create', 'POST', { username: username.trim(), password: password.trim(), name: name.trim(), role: isAdmin ? 'admin' : 'user' })
            .then(() => { toast('✅ 已创建'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er'));
    }
    function showResetPwd(username) {
        const p = prompt('为【' + username + '】设新密码：', ''); if (!p || !p.trim()) return;
        apiCall('admin/users/resetpwd', 'POST', { username, password: p.trim() }).then(() => toast('✅ 已重置，该账号需重登')).catch(e => toast('失败：' + e.message, 'er'));
    }
    function toggleStatus(username, cur) {
        const next = cur === 'active' ? 'disabled' : 'active';
        apiCall('admin/users/update', 'POST', { username, status: next }).then(() => { toast(next === 'active' ? '已启用' : '已禁用'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er'));
    }
    function delUser(username) {
        if (!confirm('删除账号【' + username + '】？其引擎、会话也删除。')) return;
        apiCall('admin/users/delete', 'POST', { username }).then(() => { toast('✅ 已删除'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er'));
    }

    /* 权限设置（可见工作流分组） */
    function showPerm(username, permJson) {
        let perm = {};
        try { perm = JSON.parse(permJson); } catch (e) {}
        const cur = (perm.allowGroups || []).join(',');
        const groups = (typeof Workflow !== 'undefined' && Workflow.isLoaded()) ? Workflow.getGroups().join('、') : '（预设未加载）';
        const v = prompt('设置【' + username + '】可用的工作流分组\n\n可选分组：' + groups + '\n\n多个用英文逗号隔开；留空=全部可用：', cur);
        if (v === null) return;
        const arr = v.split(',').map(s => s.trim()).filter(Boolean);
        const newPerm = Object.assign({}, perm, { allowGroups: arr });
        apiCall('admin/users/perm', 'POST', { username, permissions: newPerm })
            .then(() => { toast('✅ 权限已更新（该账号重登后生效）'); switchTab('users'); }).catch(e => toast('失败：' + e.message, 'er'));
    }

    /* CSV */
    function parseCSV(text) {
        text = text.replace(/^\uFEFF/, '');
        const rows = []; let cur = [], field = '', inQ = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
            else { if (c === '"') inQ = true; else if (c === ',') { cur.push(field); field = ''; } else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; } else if (c === '\r') {} else field += c; }
        }
        if (field || cur.length) { cur.push(field); rows.push(cur); }
        if (!rows.length) return [];
        const header = rows[0].map(h => h.trim());
        return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => { const o = {}; header.forEach((h, i) => o[h] = (r[i] || '').trim()); return o; });
    }
    function importCSV(inputEl) {
        const file = inputEl.files && inputEl.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const rows = parseCSV(e.target.result);
                if (!rows.length) { toast('CSV无有效数据', 'er'); return; }
                if (!confirm('导入 ' + rows.length + ' 行（同账号覆盖+重配引擎）。继续？')) { inputEl.value = ''; return; }
                toast('导入中...');
                const res = await apiCall('admin/users/import', 'POST', { rows });
                let msg = '✅ 账号 ' + res.userCount + ' 个，引擎 ' + res.engCount + ' 个';
                if (res.errors && res.errors.length) msg += '\n⚠️ ' + res.errors.join('；');
                alert(msg); switchTab('users');
            } catch (err) { toast('导入失败：' + err.message, 'er'); }
            inputEl.value = '';
        };
        reader.readAsText(file, 'utf-8');
    }
    async function exportCSV(withKey) {
        if (withKey && !confirm('⚠️ 导出含明文Key，请妥善保管！继续？')) return;
        try {
            const res = await apiCall('admin/users/export?withkey=' + (withKey ? '1' : '0'));
            const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = 'feifan-accounts-' + (withKey ? 'withkey-' : '') + new Date().toISOString().slice(0, 10) + '.csv';
            a.click(); URL.revokeObjectURL(a.href); toast('✅ 已导出');
        } catch (e) { toast('导出失败：' + e.message, 'er'); }
    }
    function downloadTemplate() {
        const header = '姓名,账号,密码,角色,引擎名称,协议,BaseURL,APIKey,模型,输入单价,输出单价,缓存读单价,缓存写单价';
        const ex = [
            '张三,zhangsan,pass123,user,快速引擎,openai,https://api.openai-proxy.org/v1,sk-xxx,gpt-4o,2.5,10,0.3,3.75',
            '张三,zhangsan,pass123,user,高质量,anthropic,https://api.openai-proxy.org/anthropic,sk-ant,claude-opus-4,15,75,1.5,18.75',
            '李四,lisi,pass456,user,便宜,openai,https://api.openai-proxy.org/v1,sk-ds,deepseek-chat,0.14,0.28,0,0',
        ].join('\n');
        const blob = new Blob(['\uFEFF' + header + '\n' + ex], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'feifan-账号导入模板.csv'; a.click(); URL.revokeObjectURL(a.href);
        toast('✅ 模板已下载。一人多引擎=多行');
    }

    /* ========== 引擎管理 ========== */
    async function renderEngines(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            const usersData = await apiCall('admin/users/list');
            const users = usersData.users || [];
            const engData = await apiCall('admin/engines/list');
            const engs = engData.engines || [];
            const byUser = {}; engs.forEach(e => { if (!byUser[e.username]) byUser[e.username] = []; byUser[e.username].push(e); });
            let html = `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">给每个账号配置公有引擎（Key加密存后端，用户看不到）。修改Key点"更换Key"重填。</div>`;
            users.forEach(u => {
                const ue = byUser[u.username] || [];
                html += `<div class="eng-user-block">
                    <div class="eng-user-hdr"><b>${esc(u.name || u.username)}</b> <span style="color:var(--text2);font-size:11px">(${esc(u.username)})</span>
                        <button class="btn btn-p btn-s" style="margin-left:auto" onclick="Admin.showEngEdit('${esc(u.username)}','')">➕ 加引擎</button></div>`;
                if (!ue.length) html += '<div style="font-size:11px;color:var(--text2);padding:4px 0">（无引擎）</div>';
                ue.forEach(e => {
                    html += `<div class="eng-item">
                        <span>📦 ${esc(e.name)} <span style="color:var(--text2);font-size:11px">${esc(e.protocol)} / ${esc(e.model || '未设模型')}</span></span>
                        <span style="color:var(--text2);font-size:11px">Key:****</span>
                        <div style="margin-left:auto;display:flex;gap:4px">
                            <button class="btn btn-s" onclick="Admin.showEngEdit('${esc(e.username)}','${esc(e.id)}')">✏️改</button>
                            <button class="btn btn-s btn-d" onclick="Admin.delEng('${esc(e.id)}')">🗑️</button>
                        </div></div>`;
                });
                html += `</div>`;
            });
            box.innerHTML = html;
            box._engs = engs;
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }

    function showEngEdit(username, engId) {
        const box = document.getElementById('adminBody');
        const engs = (box && box._engs) || [];
        const e = engId ? engs.find(x => x.id === engId) : null;
        const html = `
            <div style="max-width:520px">
            <h3 style="margin-bottom:12px">${e ? '✏️ 编辑' : '➕ 新增'}公有引擎 — ${esc(username)}</h3>
            <div class="fg"><label>引擎名称</label><input id="ee_name" value="${e ? esc(e.name) : ''}"></div>
            <div class="fg"><label>协议</label><select id="ee_proto">
                <option value="openai"${!e || e.protocol === 'openai' ? ' selected' : ''}>OpenAI/通用</option>
                <option value="anthropic"${e && e.protocol === 'anthropic' ? ' selected' : ''}>Claude原生</option>
                <option value="gemini"${e && e.protocol === 'gemini' ? ' selected' : ''}>Gemini原生</option>
            </select></div>
            <div class="fg"><label>Base URL</label><input id="ee_base" value="${e ? esc(e.base) : 'https://api.openai-proxy.org/v1'}"></div>
            <div class="fg"><label>API Key ${e ? '<span style="color:var(--text2);font-size:11px">（留空=不改；填新值=更换）</span>' : ''}</label><input id="ee_key" type="password" placeholder="${e ? '••••••（留空保持不变）' : 'sk-...'}"></div>
            <div class="fg"><label>模型</label><input id="ee_model" value="${e ? esc(e.model || '') : ''}" placeholder="gpt-4o"></div>
            <div class="fr"><div class="fg"><label>输入单价</label><input id="ee_pi" type="number" step="0.01" value="${e ? (e.priceIn || 0) : 0}"></div><div class="fg"><label>输出单价</label><input id="ee_po" type="number" step="0.01" value="${e ? (e.priceOut || 0) : 0}"></div></div>
            <div class="fr"><div class="fg"><label>缓存读</label><input id="ee_pcr" type="number" step="0.01" value="${e ? (e.priceCR || 0) : 0}"></div><div class="fg"><label>缓存写</label><input id="ee_pcw" type="number" step="0.01" value="${e ? (e.priceCW || 0) : 0}"></div></div>
            <div style="display:flex;gap:8px;margin-top:12px">
                <button class="btn btn-p" onclick="Admin.saveEng('${esc(username)}','${e ? esc(e.id) : ''}')">💾 保存</button>
                <button class="btn" onclick="Admin.switchTab('engines')">取消</button>
            </div></div>`;
        box.innerHTML = html;
    }
    function saveEng(username, engId) {
        const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const body = {
            username, id: engId || undefined, name: g('ee_name').trim(),
            protocol: g('ee_proto'), base: g('ee_base').trim(), key: g('ee_key').trim(),
            model: g('ee_model').trim(),
            priceIn: parseFloat(g('ee_pi')) || 0, priceOut: parseFloat(g('ee_po')) || 0,
            priceCR: parseFloat(g('ee_pcr')) || 0, priceCW: parseFloat(g('ee_pcw')) || 0,
        };
        if (!body.name) { toast('引擎名必填', 'er'); return; }
        apiCall('admin/engines/save', 'POST', body).then(() => { toast('✅ 已保存'); switchTab('engines'); }).catch(e => toast('失败：' + e.message, 'er'));
    }
    function delEng(id) {
        if (!confirm('删除这个引擎？')) return;
        apiCall('admin/engines/delete', 'POST', { id }).then(() => { toast('✅ 已删除'); switchTab('engines'); }).catch(e => toast('失败：' + e.message, 'er'));
    }

    /* ========== 预设管理（可视化编辑，加密存D1） ========== */
    async function renderPresets(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            // 优先从D1读，读不到从当前Workflow内存读（回退presets.json）
            let data = null;
            const res = await apiCall('admin/presets/get');
            if (res.presets) data = res.presets;
            else if (typeof Workflow !== 'undefined' && Workflow.getRawData) data = Workflow.getRawData();
            if (!data) data = { version: 3, groups: [], security: { sensitiveWords: [], alertWebhook: '', alertKeyword: '飞凡警报', simThreshold: 70, guard: true }, presets: [] };
            _presetData = JSON.parse(JSON.stringify(data));
            renderPresetEditor(box);
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }

    function renderPresetEditor(box) {
        const d = _presetData;
        let html = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                <button class="btn btn-p btn-s" onclick="Admin.savePresets()">💾 保存到云端(覆盖)</button>
                <button class="btn btn-s" onclick="Admin.exportPresetsJSON()">📤 导出JSON备份</button>
                <label class="btn btn-s" style="cursor:pointer">📥 导入JSON<input type="file" accept=".json" onchange="Admin.importPresetsJSON(this)" style="display:none"></label>
                <button class="btn btn-s" onclick="Admin.addPreset()">➕ 新增预设</button>
            </div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:10px">分组：<input id="pd_groups" value="${esc((d.groups || []).join(','))}" placeholder="用逗号隔开" style="width:300px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)"> <span style="font-size:11px">（改完点保存生效）</span></div>
            <div class="preset-list">`;
        (d.presets || []).forEach((p, pi) => {
            html += `<div class="preset-block">
                <div class="preset-hdr">
                    <input value="${esc(p.name)}" onchange="Admin.updPresetField(${pi},'name',this.value)" style="font-weight:600;flex:1">
                    <input value="${esc(p.group || '')}" onchange="Admin.updPresetField(${pi},'group',this.value)" placeholder="分组" style="width:100px">
                    <button class="btn btn-s" onclick="Admin.addStep(${pi})">➕步骤</button>
                    <button class="btn btn-s btn-d" onclick="Admin.delPreset(${pi})">🗑️预设</button>
                </div>`;
            (p.steps || []).forEach((s, si) => {
                html += `<div class="step-block">
                    <div class="step-hdr">
                        <span>步骤${si + 1}</span>
                        <input value="${esc(s.name || '')}" onchange="Admin.updStepField(${pi},${si},'name',this.value)" placeholder="步骤名" style="flex:1">
                        <input value="${esc(s.engineName || '')}" onchange="Admin.updStepField(${pi},${si},'engineName',this.value)" placeholder="绑定引擎名(选填)" title="填公有引擎名称，该步自动用它" style="width:130px">
                        <button class="btn btn-s btn-d" onclick="Admin.delStep(${pi},${si})">🗑️</button>
                    </div>
                    <div class="seg-list">`;
                (s.segments || []).forEach((seg, gi) => {
                    if (seg.type === 'prompt') {
                        // 隐藏指令：显示解密后的明文供编辑
                        const plain = (typeof Workflow !== 'undefined' && Workflow.decryptSync) ? '' : '';
                        html += `<div class="seg-item seg-prompt">
                            <div class="seg-label">🔒隐藏指令（保存时自动加密）</div>
                            <textarea onchange="Admin.updSegPrompt(${pi},${si},${gi},this.value)" placeholder="隐藏指令明文" data-pi="${pi}" data-si="${si}" data-gi="${gi}" class="seg-prompt-ta">${esc(seg._plain || '')}</textarea>
                            <button class="btn btn-s" onclick="Admin.loadPromptPlain(${pi},${si},${gi})">🔓解密显示原有内容</button>
                            <button class="btn btn-s btn-d" onclick="Admin.delSeg(${pi},${si},${gi})">删</button>
                        </div>`;
                    } else if (seg.type === 'input') {
                        html += `<div class="seg-item seg-input">
                            <div class="seg-label">✍️输入框</div>
                            <input value="${esc(seg.placeholder || '')}" onchange="Admin.updSegField(${pi},${si},${gi},'placeholder',this.value)" placeholder="提示文字">
                            <input value="${esc(seg.defaultValue || '')}" onchange="Admin.updSegField(${pi},${si},${gi},'defaultValue',this.value)" placeholder="默认值">
                            <button class="btn btn-s btn-d" onclick="Admin.delSeg(${pi},${si},${gi})">删</button>
                        </div>`;
                    } else if (seg.type === 'blank') {
                        html += `<div class="seg-item seg-blank">
                            <div class="seg-label">📝填空题（{}=空位）</div>
                            <input value="${esc(seg.template || '')}" onchange="Admin.updSegField(${pi},${si},${gi},'template',this.value)" placeholder="如：题材是{}，视角是{}">
                            <button class="btn btn-s btn-d" onclick="Admin.delSeg(${pi},${si},${gi})">删</button>
                        </div>`;
                    }
                });
                html += `</div>
                    <div style="display:flex;gap:4px;margin-top:4px">
                        <button class="btn btn-s" onclick="Admin.addSeg(${pi},${si},'prompt')">+隐藏指令</button>
                        <button class="btn btn-s" onclick="Admin.addSeg(${pi},${si},'input')">+输入框</button>
                        <button class="btn btn-s" onclick="Admin.addSeg(${pi},${si},'blank')">+填空题</button>
                    </div>
                </div>`;
            });
            html += `</div>`;
        });
        html += `</div>`;
        // 安全设置
        const sec = d.security || {};
        html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
            <h4 style="font-size:13px;margin-bottom:8px">🛡️ 安全设置</h4>
            <div class="fg"><label>敏感词（逗号隔开）</label><textarea id="ps_sensitive" rows="3">${esc((sec.sensitiveWords || []).join(','))}</textarea></div>
            <div class="fg"><label>钉钉报警Webhook</label><input id="ps_webhook" value="${esc(sec.alertWebhook || '')}"></div>
            <div class="fr"><div class="fg"><label>报警关键词</label><input id="ps_keyword" value="${esc(sec.alertKeyword || '飞凡警报')}"></div>
            <div class="fg"><label>相似度阈值%</label><input id="ps_sim" type="number" value="${sec.simThreshold || 70}"></div></div>
            <div class="pt"><input type="checkbox" id="ps_guard" ${sec.guard !== false ? 'checked' : ''}><label for="ps_guard">开启GUARD保密前缀</label></div>
        </div>`;
        box.innerHTML = html;
    }

    // 预设编辑操作
    function updPresetField(pi, field, val) { _presetData.presets[pi][field] = val; }
    function updStepField(pi, si, field, val) { _presetData.presets[pi].steps[si][field] = val; }
    function updSegField(pi, si, gi, field, val) { _presetData.presets[pi].steps[si].segments[gi][field] = val; }
    function updSegPrompt(pi, si, gi, val) { _presetData.presets[pi].steps[si].segments[gi]._plain = val; _presetData.presets[pi].steps[si].segments[gi]._dirty = true; }
    async function loadPromptPlain(pi, si, gi) {
        const seg = _presetData.presets[pi].steps[si].segments[gi];
        if (typeof Workflow === 'undefined' || !Workflow.decrypt) { toast('无法解密', 'er'); return; }
        try {
            const plain = await Workflow.decrypt(seg.hidden || '');
            seg._plain = plain;
            const ta = document.querySelector(`.seg-prompt-ta[data-pi="${pi}"][data-si="${si}"][data-gi="${gi}"]`);
            if (ta) ta.value = plain;
            toast('已解密显示');
        } catch (e) { toast('解密失败：' + e.message, 'er'); }
    }
    function addPreset() {
        _presetData.presets.push({ id: 'p' + Math.random().toString(36).slice(2, 8), name: '新预设', group: '', steps: [] });
        renderPresetEditor(document.getElementById('adminBody'));
    }
    function delPreset(pi) { if (!confirm('删除此预设？')) return; _presetData.presets.splice(pi, 1); renderPresetEditor(document.getElementById('adminBody')); }
    function addStep(pi) {
        if (!_presetData.presets[pi].steps) _presetData.presets[pi].steps = [];
        const order = _presetData.presets[pi].steps.length + 1;
        _presetData.presets[pi].steps.push({ id: 's' + Math.random().toString(36).slice(2, 8), name: '新步骤', order, segments: [] });
        renderPresetEditor(document.getElementById('adminBody'));
    }
    function delStep(pi, si) { if (!confirm('删除此步骤？')) return; _presetData.presets[pi].steps.splice(si, 1); renderPresetEditor(document.getElementById('adminBody')); }
    function addSeg(pi, si, type) {
        const seg = { type };
        if (type === 'prompt') { seg.hidden = ''; seg._plain = ''; seg._dirty = true; }
        else if (type === 'input') { seg.placeholder = '请输入...'; seg.defaultValue = ''; }
        else if (type === 'blank') { seg.template = ''; }
        _presetData.presets[pi].steps[si].segments.push(seg);
        renderPresetEditor(document.getElementById('adminBody'));
    }
    function delSeg(pi, si, gi) { _presetData.presets[pi].steps[si].segments.splice(gi, 1); renderPresetEditor(document.getElementById('adminBody')); }

    async function savePresets() {
        // 收集分组、安全设置
        _presetData.groups = document.getElementById('pd_groups').value.split(',').map(s => s.trim()).filter(Boolean);
        _presetData.security = {
            sensitiveWords: document.getElementById('ps_sensitive').value.split(',').map(s => s.trim()).filter(Boolean),
            alertWebhook: document.getElementById('ps_webhook').value.trim(),
            alertKeyword: document.getElementById('ps_keyword').value.trim() || '飞凡警报',
            simThreshold: parseInt(document.getElementById('ps_sim').value) || 70,
            guard: document.getElementById('ps_guard').checked,
        };
        // 加密隐藏指令（_dirty的重新加密，其他保留原hidden）
        toast('加密并保存中...');
        try {
            for (const p of _presetData.presets) {
                for (const s of (p.steps || [])) {
                    for (const seg of (s.segments || [])) {
                        if (seg.type === 'prompt') {
                            if (seg._dirty || (seg._plain && !seg.hidden)) {
                                if (typeof Workflow !== 'undefined' && Workflow.encrypt) {
                                    seg.hidden = await Workflow.encrypt(seg._plain || '');
                                } else {
                                    seg.hidden = '__PLAIN__' + (seg._plain || '');
                                }
                            }
                            delete seg._plain; delete seg._dirty;
                        }
                    }
                }
            }
            await apiCall('admin/presets/save', 'POST', { presets: _presetData });
            toast('✅ 已保存到云端，所有用户下次加载生效');
            // 重新加载workflow
            if (typeof Workflow !== 'undefined' && Workflow.reload) await Workflow.reload(_presetData);
        } catch (e) { toast('保存失败：' + e.message, 'er'); }
    }
    function exportPresetsJSON() {
        const blob = new Blob([JSON.stringify(_presetData, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'presets-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(a.href);
        toast('✅ 已导出JSON备份');
    }
    function importPresetsJSON(inputEl) {
        const file = inputEl.files && inputEl.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try { _presetData = JSON.parse(e.target.result); renderPresetEditor(document.getElementById('adminBody')); toast('✅ 已导入（点保存生效）'); }
            catch (err) { toast('JSON解析失败', 'er'); }
            inputEl.value = '';
        };
        reader.readAsText(file, 'utf-8');
    }

    /* ========== 监视 ========== */
    async function renderMonitor(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            const data = await apiCall('admin/monitor');
            const logMap = {}; (data.logs || []).forEach(l => logMap[l.username] = l);
            const sessMap = {}; (data.sessions || []).forEach(s => sessMap[s.username] = s);
            const usernames = new Set([...Object.keys(logMap), ...Object.keys(sessMap)]);
            let html = `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">各账号使用统计。<button class="btn btn-s" onclick="Admin.switchTab('monitor')">🔄刷新</button></div>
                <div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>账号</th><th>对话次数</th><th>累计Token</th><th>不同IP</th><th>最后活跃</th></tr></thead><tbody>`;
            usernames.forEach(un => {
                const l = logMap[un] || {}; const s = sessMap[un] || {};
                html += `<tr><td>${esc(un)}</td><td>${l.logCount || 0}</td><td>${(l.totalTokens || 0).toLocaleString()}</td><td>${(s.ipc || 0) >= 3 ? '<span style="color:#ef4444">🔴' + s.ipc + '</span>' : (s.ipc || 0)}</td><td style="font-size:11px">${fmtTime(s.last || 0)}</td></tr>`;
            });
            html += '</tbody></table></div>';
            html += `<h4 style="font-size:13px;margin:16px 0 8px">📋 最近100条记录</h4><div style="overflow-x:auto;max-height:300px;overflow-y:auto"><table class="admin-table"><thead><tr><th>时间</th><th>账号</th><th>对话</th><th>轮次</th><th>Token</th><th>模型</th></tr></thead><tbody>`;
            (data.recent || []).forEach(r => {
                html += `<tr><td style="font-size:11px">${new Date(r.created_at).toLocaleString()}</td><td>${esc(r.username)}</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(r.chat_name || '-')}</td><td>${r.rounds || 0}</td><td>${r.tokens || 0}</td><td>${esc(r.model || '-')}</td></tr>`;
            });
            html += '</tbody></table></div>';
            box.innerHTML = html;
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }

    /* ========== 全局设置 ========== */
    async function renderConfig(box) {
        box.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">加载中...</div>';
        try {
            const data = await apiCall('admin/config/get');
            const cfg = data.config || {};
            const chunkSize = cfg.chunkSize || '300';
            box.innerHTML = `
                <div style="max-width:400px">
                <h4 style="font-size:13px;margin-bottom:12px">⚙️ 全局参数（所有用户生效）</h4>
                <div class="fg"><label>📐 物理打标：每块字数</label><input id="cfg_chunkSize" type="number" value="${esc(chunkSize)}" min="50" max="5000"><div style="font-size:11px;color:var(--text2);margin-top:4px">默认300。所有用户打标按此值切块。</div></div>
                <button class="btn btn-p" onclick="Admin.saveConfig()">💾 保存</button>
                </div>`;
        } catch (e) { box.innerHTML = '<div style="color:#ef4444;padding:20px">加载失败：' + e.message + '</div>'; }
    }
    function saveConfig() {
        const chunkSize = document.getElementById('cfg_chunkSize').value;
        apiCall('admin/config/save', 'POST', { config: { chunkSize } })
            .then(() => { toast('✅ 已保存（用户下次加载生效）'); if (typeof Chunker !== 'undefined') Chunker.setBlockSize(chunkSize); })
            .catch(e => toast('失败：' + e.message, 'er'));
    }

    return {
        open, close, switchTab, apiCall,
        showCreateUser, showResetPwd, toggleStatus, delUser, showPerm,
        importCSV, exportCSV, downloadTemplate,
        showEngEdit, saveEng, delEng,
        updPresetField, updStepField, updSegField, updSegPrompt, loadPromptPlain,
        addPreset, delPreset, addStep, delStep, addSeg, delSeg,
        savePresets, exportPresetsJSON, importPresetsJSON,
        saveConfig,
    };
})();

window.Admin = Admin;
