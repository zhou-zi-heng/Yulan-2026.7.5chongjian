/* ===== 飞凡AI - 主入口 (v2.3.2) ===== */
/* 全局当前引擎模式 - 所有会话实时跟随设置 */

/* ============================================================
   ===== 全局状态 ==============================================
   ============================================================ */
let S = {
    profiles: {},
    chats: {},
    chatOrder: [],
    currentChatId: null,
    currentEngId: 'zenmux',
    theme: 'light',
    snapInterval: 5,
};

let _saveTimer = null;
let _saveInProgress = null;
let _streamCtrl = null;
let _pendingAtts = [];
let _attContinuous = false;
let _exportMode = 'full';

/* ============================================================
   ===== 持久化 ================================================
   ============================================================ */
function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveNow, 300);
}
async function saveNow() {
    if (_saveInProgress) { await _saveInProgress; return; }
    _saveInProgress = DB.saveState(S);
    try { await _saveInProgress; }
    finally { _saveInProgress = null; }
}
async function loadState() {
    const loaded = await DB.loadState();
    if (loaded && typeof loaded === 'object') {
        S = Object.assign({
            profiles: {}, chats: {}, chatOrder: [],
            currentChatId: null, currentEngId: 'zenmux',
            theme: 'light', snapInterval: 5,
        }, loaded);

        if (!S.chatOrder || !S.chatOrder.length) {
            S.chatOrder = Object.keys(S.chats || {}).sort((a, b) =>
                (S.chats[b].updatedAt || 0) - (S.chats[a].updatedAt || 0));
        }
        // 修复未完成的流式消息
        for (const cid in S.chats) {
            const c = S.chats[cid];
            if (c.messages) {
                c.messages.forEach(m => {
                    if (m._streaming) { m._streaming = false; m._interrupted = true; }
                });
            }
        }
    }
    // 默认引擎
    if (!S.profiles || !Object.keys(S.profiles).length) {
        S.profiles = JSON.parse(JSON.stringify(API.DEFAULT_PROFILES));
    }
    // 兼容老引擎数据：补齐 4 个参数开关
    for (const id in S.profiles) {
        const p = S.profiles[id];
        if (p.useTemp === undefined) p.useTemp = true;
        if (p.useMax === undefined) p.useMax = true;
        if (p.useTopP === undefined) p.useTopP = false;
        if (p.useFreq === undefined) p.useFreq = false;
        if (p.temperature === undefined) p.temperature = 0.7;
        if (p.max_tokens === undefined) p.max_tokens = 4096;
        if (p.top_p === undefined) p.top_p = 1;
        if (p.frequency_penalty === undefined) p.frequency_penalty = 0;
    }
    // 确保 currentEngId 指向一个真实存在的引擎
    if (!S.profiles[S.currentEngId]) {
        S.currentEngId = Object.keys(S.profiles)[0] || 'zenmux';
    }
    // 应用主题
    if (S.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const tb = document.getElementById('themeBtn');
        if (tb) tb.textContent = '☀️';
    }
}

/* ============================================================
   ===== 当前会话/引擎 =========================================
   ============================================================ */
function curChat() {
    if (!S.currentChatId) return null;
    return S.chats[S.currentChatId] || null;
}
/* ✅ 全局当前引擎模式：所有会话实时跟随 S.currentEngId */
function curProfile() {
    const eid = S.currentEngId;
    return S.profiles[eid] || S.profiles[Object.keys(S.profiles)[0]];
}

/* ============================================================
   ===== 会话管理 ==============================================
   ============================================================ */
function newChat() {
    const id = gId();
    S.chats[id] = {
        id: id,
        title: '新对话',
        messages: [],
        systemPrompt: '',
        knowledgeBase: [],
        isPinned: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    S.chatOrder.unshift(id);
    S.currentChatId = id;
    scheduleSave();
    renderAll();
    if (IS_MOBILE) {
        document.getElementById('sb').classList.remove('open');
        document.getElementById('sbOv').classList.remove('show');
    }
}
function switchChat(id) {
    if (!S.chats[id]) return;
    S.currentChatId = id;
    scheduleSave();
    renderAll();
    if (IS_MOBILE) {
        document.getElementById('sb').classList.remove('open');
        document.getElementById('sbOv').classList.remove('show');
    }
}
function delChat(id) {
    if (!confirm('确认删除此对话？')) return;
    delete S.chats[id];
    S.chatOrder = S.chatOrder.filter(x => x !== id);
    if (S.currentChatId === id) {
        S.currentChatId = S.chatOrder[0] || null;
    }
    scheduleSave();
    renderAll();
}
function renameChat(id) {
    const c = S.chats[id];
    if (!c) return;
    const nv = prompt('重命名对话：', c.title);
    if (nv && nv.trim()) {
        c.title = nv.trim();
        c.updatedAt = Date.now();
        scheduleSave();
        renderAll();
    }
}
function updTitle(v) {
    const c = curChat();
    if (!c) return;
    c.title = (v || '').trim() || '新对话';
    c.updatedAt = Date.now();
    scheduleSave();
    renderSB();
}
function pinC() {
    const c = curChat();
    if (!c) return;
    c.isPinned = !c.isPinned;
    c.updatedAt = Date.now();
    scheduleSave();
    renderAll();
    toast(c.isPinned ? '已置顶' : '已取消置顶');
}
function arcC() {
    const c = curChat();
    if (!c) return;
    c.isArchived = !c.isArchived;
    c.updatedAt = Date.now();
    scheduleSave();
    renderAll();
    toast(c.isArchived ? '已归档' : '已取消归档');
}
function clrC() {
    const c = curChat();
    if (!c) return;
    if (!confirm('清空当前对话所有消息？')) return;
    c.messages = [];
    c.updatedAt = Date.now();
    scheduleSave();
    renderMs();
}

/* ============================================================
   ===== 主题 ==================================================
   ============================================================ */
function togTheme() {
    S.theme = S.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', S.theme === 'dark' ? 'dark' : '');
    document.getElementById('themeBtn').textContent = S.theme === 'dark' ? '☀️' : '🌙';
    scheduleSave();
}

/* ============================================================
   ===== 渲染：侧边栏 ==========================================
   ============================================================ */
function renderSB() {
    const search = (document.getElementById('schIn').value || '').toLowerCase();
    const pinList = document.getElementById('pinList');
    const chatList = document.getElementById('chatList');
    const arcList = document.getElementById('arcList');
    pinList.innerHTML = ''; chatList.innerHTML = ''; arcList.innerHTML = '';

    const order = S.chatOrder.filter(id => S.chats[id]);
    let pinCount = 0, arcCount = 0;

    order.forEach(id => {
        const c = S.chats[id];
        if (search) {
            const hay = (c.title + ' ' + (c.messages || []).map(m =>
                typeof m.content === 'string' ? m.content : '').join(' ')).toLowerCase();
            if (!hay.includes(search)) return;
        }

        const li = document.createElement('li');
        li.className = 'ci' + (id === S.currentChatId ? ' act' : '');
        li.onclick = () => switchChat(id);

        const span = document.createElement('span');
        span.className = 'ct';
        span.textContent = c.title || '新对话';
        li.appendChild(span);

        const acts = document.createElement('div');
        acts.className = 'ia';
        const renBtn = document.createElement('button');
        renBtn.textContent = '✏️'; renBtn.title = '重命名';
        renBtn.onclick = (e) => { e.stopPropagation(); renameChat(id); };
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️'; delBtn.title = '删除';
        delBtn.onclick = (e) => { e.stopPropagation(); delChat(id); };
        acts.appendChild(renBtn);
        acts.appendChild(delBtn);
        li.appendChild(acts);

        if (c.isArchived) { arcList.appendChild(li); arcCount++; }
        else if (c.isPinned) { pinList.appendChild(li); pinCount++; }
        else chatList.appendChild(li);
    });

    document.getElementById('pinLbl').style.display = pinCount ? 'block' : 'none';
    document.getElementById('arcLbl').style.display = arcCount ? 'block' : 'none';

    const p = curProfile();
    document.getElementById('badge').innerHTML = p
        ? '当前引擎: <strong>' + esc(p.name) + '</strong><br>模型: ' + esc(p.model || '-')
        : '请先在 ⚙️ 中配置引擎';
}

/* ============================================================
   ===== 渲染：消息区 ==========================================
   ============================================================ */
function renderMs() {
    const area = document.getElementById('msgsArea');
    const c = curChat();
    if (!c) {
        area.innerHTML = '<div class="empty"><div class="ico">🚀</div><p>请先新建一个对话</p></div>';
        return;
    }
    UI.renderMessages(area, c.messages, {
        onDelete: (m) => {
            c.messages = c.messages.filter(x => x !== m);
            c.updatedAt = Date.now();
            scheduleSave();
            renderMs();
        },
        onRegen: (m) => regenerate(m),
    });
    document.getElementById('titleIn').value = c.title || '';
    document.getElementById('pinBtn').textContent = c.isPinned ? '📍' : '📌';
}

function renderAll() {
    renderSB();
    renderMs();
    renderEngTabs();
    renderEngForm();
    renderCSForm();
    renderStorageInfo();
}

/* ============================================================
   ===== ⚙️ 引擎配置（1:1 还原原版） ===========================
   ============================================================ */

/* ---------- Tab 渲染 ---------- */
function renderEngTabs() {
    const tabs = document.getElementById('engTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    Object.values(S.profiles).forEach(p => {
        const b = document.createElement('button');
        b.className = 'tab' + (p.id === S.currentEngId ? ' act' : '');
        b.textContent = p.name;
        b.onclick = () => {
            S.currentEngId = p.id;
            renderEngTabs();
            renderEngForm();
            renderSB();
            renderMs();
            scheduleSave();
            toast('已切换到：' + p.name);
        };
        tabs.appendChild(b);
    });
}

/* ---------- Max Tokens 预设按钮 ---------- */
const MAX_TOKEN_PRESETS = [
    { label: '4K', val: 4096 },
    { label: '8K', val: 8192 },
    { label: '16K', val: 16384 },
    { label: '32K', val: 32768 },
    { label: '64K', val: 65536 },
    { label: '128K', val: 131072 },
    { label: '256K', val: 262144 },
    { label: '1M', val: 1048576 },
];

/* ---------- 引擎表单 ---------- */
function renderEngForm() {
    const form = document.getElementById('engForm');
    if (!form) return;
    const p = S.profiles[S.currentEngId];
    if (!p) {
        form.innerHTML = '<p style="color:var(--text2)">请选择一个引擎</p>';
        return;
    }

    form.innerHTML = `
        <div class="fg">
            <label>引擎名称</label>
            <input type="text" id="engName" value="${esc(p.name)}">
        </div>

        <div class="fg">
            <label>🌐 Base URL</label>
            <input type="text" id="engBase" value="${esc(p.base)}" placeholder="https://api.openai.com/v1">
        </div>

        <div class="fg">
            <label>🔑 API Key
                <span style="font-weight:normal;color:var(--text2);font-size:11px">（仅本地存储，不上传）</span>
            </label>
            <input type="password" id="engKey" value="${esc(p.key)}" autocomplete="off" placeholder="sk-...">
        </div>

        <div class="fg">
            <label>🧠 模型 ID</label>
            <div style="display:flex;gap:6px">
                <input type="text" id="engModel" value="${esc(p.model)}" placeholder="gpt-4o-mini" style="flex:1">
                <button class="btn btn-s" onclick="fMdls()" id="fMdlsBtn" style="white-space:nowrap">🔄 获取</button>
            </div>
            <div id="mdlSel" style="display:none;margin-top:6px"></div>
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
            <h4 style="font-size:13px;margin-bottom:10px">⚙️ 运行时参数</h4>

            <div class="pt">
                <input type="checkbox" id="engUseTemp" ${p.useTemp ? 'checked' : ''}>
                <label for="engUseTemp">🔥 Temperature 温度</label>
            </div>
            <div class="ps" id="engTempBox" style="${p.useTemp ? '' : 'display:none'}">
                <input type="range" id="engTemp" min="0" max="2" step="0.1" value="${p.temperature}">
                <div>当前值：<span class="pv" id="engTempV">${p.temperature}</span>
                    <span style="font-size:11px;color:var(--text2);margin-left:8px">0=精确, 2=发散</span>
                </div>
            </div>

            <div class="pt">
                <input type="checkbox" id="engUseMax" ${p.useMax ? 'checked' : ''}>
                <label for="engUseMax">📏 Max Tokens 最大输出长度</label>
            </div>
            <div class="ps" id="engMaxBox" style="${p.useMax ? '' : 'display:none'}">
                <input type="number" id="engMax" value="${p.max_tokens}" min="1" max="2097152">
                <div class="presets">
                    ${MAX_TOKEN_PRESETS.map(x =>
                        `<button onclick="setMax(${x.val})">${x.label}</button>`
                    ).join('')}
                </div>
            </div>

            <div class="pt">
                <input type="checkbox" id="engUseTopP" ${p.useTopP ? 'checked' : ''}>
                <label for="engUseTopP">🎲 Top P 核采样</label>
            </div>
            <div class="ps" id="engTopPBox" style="${p.useTopP ? '' : 'display:none'}">
                <input type="range" id="engTopP" min="0" max="1" step="0.05" value="${p.top_p}">
                <div>当前值：<span class="pv" id="engTopPV">${p.top_p}</span></div>
            </div>

            <div class="pt">
                <input type="checkbox" id="engUseFreq" ${p.useFreq ? 'checked' : ''}>
                <label for="engUseFreq">🚫 Frequency Penalty 重复惩罚</label>
            </div>
            <div class="ps" id="engFreqBox" style="${p.useFreq ? '' : 'display:none'}">
                <input type="range" id="engFreq" min="-2" max="2" step="0.1" value="${p.frequency_penalty}">
                <div>当前值：<span class="pv" id="engFreqV">${p.frequency_penalty}</span></div>
            </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
            <button class="btn btn-p" onclick="saveEng()">💾 保存配置</button>
            <button class="btn" onclick="tConn()" id="tConnBtn">🔑 测试连通</button>
            ${API.DEFAULT_PROFILES[p.id] ? '' :
                '<button class="btn btn-d" onclick="delEng()">🗑️ 删除</button>'}
        </div>
    `;

    bindEngEvents(p);
}

function bindEngEvents(p) {
    document.getElementById('engUseTemp').onchange = (e) => {
        document.getElementById('engTempBox').style.display = e.target.checked ? '' : 'none';
    };
    document.getElementById('engUseMax').onchange = (e) => {
        document.getElementById('engMaxBox').style.display = e.target.checked ? '' : 'none';
    };
    document.getElementById('engUseTopP').onchange = (e) => {
        document.getElementById('engTopPBox').style.display = e.target.checked ? '' : 'none';
    };
    document.getElementById('engUseFreq').onchange = (e) => {
        document.getElementById('engFreqBox').style.display = e.target.checked ? '' : 'none';
    };
    document.getElementById('engTemp').oninput = (e) => {
        document.getElementById('engTempV').textContent = e.target.value;
    };
    document.getElementById('engTopP').oninput = (e) => {
        document.getElementById('engTopPV').textContent = e.target.value;
    };
    document.getElementById('engFreq').oninput = (e) => {
        document.getElementById('engFreqV').textContent = e.target.value;
    };
}

function setMax(val) {
    document.getElementById('engMax').value = val;
}

/* ---------- 保存配置 ---------- */
function saveEng() {
    const p = S.profiles[S.currentEngId];
    if (!p) return;

    p.name = document.getElementById('engName').value.trim() || p.name;
    p.base = document.getElementById('engBase').value.trim();
    p.key = document.getElementById('engKey').value.trim();
    p.model = document.getElementById('engModel').value.trim();

    p.useTemp = document.getElementById('engUseTemp').checked;
    p.temperature = parseFloat(document.getElementById('engTemp').value);

    p.useMax = document.getElementById('engUseMax').checked;
    p.max_tokens = parseInt(document.getElementById('engMax').value, 10);

    p.useTopP = document.getElementById('engUseTopP').checked;
    p.top_p = parseFloat(document.getElementById('engTopP').value);

    p.useFreq = document.getElementById('engUseFreq').checked;
    p.frequency_penalty = parseFloat(document.getElementById('engFreq').value);

    scheduleSave();
    renderEngTabs();
    renderSB();
    renderMs();
    toast('✅ 配置已保存');
}

/* ---------- 获取模型列表 ---------- */
async function fMdls() {
    const p = S.profiles[S.currentEngId];
    if (!p) return;
    p.base = document.getElementById('engBase').value.trim();
    p.key = document.getElementById('engKey').value.trim();
    if (!p.base || !p.key) {
        toast('请先填写 Base URL 和 API Key', 'er');
        return;
    }

    const btn = document.getElementById('fMdlsBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 获取中...';

    try {
        const list = await API.fetchModels(p);
        if (!list.length) {
            toast('未返回任何模型', 'er');
            return;
        }
        const sel = document.getElementById('mdlSel');
        sel.style.display = '';
        sel.innerHTML = '<select id="mdlPick" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)">'
            + list.map(m => '<option value="' + esc(m) + '"' + (m === p.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('')
            + '</select>';
        document.getElementById('mdlPick').onchange = (e) => {
            document.getElementById('engModel').value = e.target.value;
        };
        toast('✅ 已获取 ' + list.length + ' 个模型');
    } catch (e) {
        toast('获取失败：' + e.message, 'er');
    } finally {
        btn.disabled = false;
        btn.textContent = '🔄 获取';
    }
}

/* ---------- 测试连通 ---------- */
async function tConn() {
    const p = S.profiles[S.currentEngId];
    if (!p) return;
    p.base = document.getElementById('engBase').value.trim();
    p.key = document.getElementById('engKey').value.trim();
    if (!p.base || !p.key) {
        toast('请先填写 Base URL 和 API Key', 'er');
        return;
    }

    const btn = document.getElementById('tConnBtn');
    btn.disabled = true;
    btn.textContent = '⏳ 测试中...';

    const result = await API.testConnection(p);
    btn.disabled = false;
    btn.textContent = '🔑 测试连通';
    toast(result.msg, result.ok ? 'ok' : 'er');
}

/* ---------- 新增引擎 ---------- */
function addEng() {
    const name = prompt('新引擎名称：', '我的引擎');
    if (!name || !name.trim()) return;
    const id = 'custom_' + gId().slice(0, 8);
    S.profiles[id] = {
        id: id, name: name.trim(),
        base: 'https://api.openai.com/v1', key: '',
        model: 'gpt-4o-mini',
        useTemp: true, temperature: 0.7,
        useMax: true, max_tokens: 4096,
        useTopP: false, top_p: 1,
        useFreq: false, frequency_penalty: 0,
    };
    S.currentEngId = id;
    scheduleSave();
    renderEngTabs();
    renderEngForm();
    renderSB();
    renderMs();
}

/* ---------- 删除引擎 ---------- */
function delEng() {
    const p = S.profiles[S.currentEngId];
    if (!p) return;
    if (API.DEFAULT_PROFILES[p.id]) {
        toast('内置引擎不可删除', 'er');
        return;
    }
    if (!confirm('删除引擎 ' + p.name + '？')) return;
    delete S.profiles[p.id];
    S.currentEngId = Object.keys(S.profiles)[0] || 'zenmux';
    scheduleSave();
    renderEngTabs();
    renderEngForm();
    renderSB();
    renderMs();
    toast('已删除');
}

/* ============================================================
   ===== 会话设置 ==============================================
   ============================================================ */
function renderCSForm() {
    const c = curChat();
    if (!c) return;
    const sp = document.getElementById('spIn');
    if (sp) sp.value = c.systemPrompt || '';
    const si = document.getElementById('snapInterval');
    if (si) si.value = String(S.snapInterval || 5);
}
function updSP(v) {
    const c = curChat();
    if (!c) return;
    c.systemPrompt = v || '';
    c.updatedAt = Date.now();
    scheduleSave();
}
function updSnapInterval(v) {
    S.snapInterval = parseInt(v, 10) || 0;
    scheduleSave();
    if (typeof Snapshot !== 'undefined') {
        Snapshot.startAuto(S.snapInterval, () => S);
    }
    toast('快照间隔：' + (S.snapInterval ? S.snapInterval + ' 分钟' : '关闭'));
}

/* ============================================================
   ===== 存储信息 ==============================================
   ============================================================ */
async function renderStorageInfo() {
    const el = document.getElementById('storageInfo');
    if (!el) return;
    try {
        const info = await DB.getStorageInfo();
        el.innerHTML =
            '已用：<strong>' + info.usedText + '</strong><br>' +
            '配额：' + info.quotaText + '（' + info.percent + '%）<br>' +
            '持久化：' + (info.persisted ? '✅ 已启用' : '⚠️ 未启用（可能被清理）') + '<br>' +
            '版本：' + APP_VERSION;
    } catch (e) {
        el.textContent = '存储信息获取失败';
    }
}

/* ============================================================
   ===== 发送消息 ==============================================
   ============================================================ */
async function send() {
    if (_streamCtrl) { _streamCtrl.abort(); return; }

    let c = curChat();
    if (!c) { newChat(); c = curChat(); }

    const inp = document.getElementById('uIn');
    const text = (inp.value || '').trim();
    const hasText = !!text;
    const hasAtts = _pendingAtts.length > 0;
    if (!hasText && !hasAtts) { toast('请输入内容或上传附件', 'er'); return; }

    const profile = curProfile();
    if (!profile || !profile.key) {
        toast('请先在 ⚙️ 中配置引擎 API Key', 'er');
        openM('set');
        return;
    }

    const userVisibleText = text || '(已上传 ' + _pendingAtts.length + ' 个附件)';
    const attsForUser = _pendingAtts.slice();

    let attachedText = '';
    const imageAtts = [];
    attsForUser.forEach(a => {
        if (a.type === 'image') {
            imageAtts.push(a);
        } else if (a.text) {
            attachedText += '\n\n=== 📎 附件：' + a.fileName + ' ===\n' + a.text + '\n=== 附件结束 ===\n';
        }
    });

    let kbText = '';
    if (c.knowledgeBase && c.knowledgeBase.length) {
        c.knowledgeBase.forEach(k => {
            if (k.type === 'image') {
                imageAtts.push({ fileName: k.name, dataUrl: k.dataUrl, type: 'image' });
            } else if (k.text) {
                kbText += '\n\n=== 📚 知识库：' + k.name + ' ===\n' + k.text + '\n=== 知识库结束 ===\n';
            }
        });
    }

    const composedText = (kbText ? kbText + '\n' : '') + (attachedText ? attachedText + '\n' : '') + text;

    const userMsg = {
        id: gId(),
        role: 'user',
        content: userVisibleText,
        attachments: attsForUser.map(a => ({
            name: a.fileName, type: a.type, ext: a.meta && a.meta.ext,
        })),
        _time: nowTime(),
    };
    c.messages.push(userMsg);

    const aiMsg = {
        id: gId(),
        role: 'assistant',
        content: '',
        _streaming: true,
        _time: nowTime(),
    };
    c.messages.push(aiMsg);

    if (c.title === '新对话' && c.messages.length <= 2) {
        c.title = (text || (attsForUser[0] && attsForUser[0].fileName) || '新对话').slice(0, 24);
    }
    c.updatedAt = Date.now();

    inp.value = '';
    aRsz(inp);
    _pendingAtts = [];
    renderAttList();

    await saveNow();
    renderMs();
    renderSB();

    const sendMsgs = [];
    if (c.systemPrompt && c.systemPrompt.trim()) {
        sendMsgs.push({ role: 'system', content: c.systemPrompt });
    }
    const lastUserIdx = c.messages.length - 2;
    c.messages.forEach((m, idx) => {
        if (m === aiMsg) return;
        if (m._interrupted && !m.content) return;
        if (idx === lastUserIdx && m.role === 'user') {
            if (imageAtts.length) {
                const parts = [];
                if (composedText) parts.push({ type: 'text', text: composedText });
                imageAtts.forEach(im => {
                    parts.push({ type: 'image_url', image_url: { url: im.dataUrl } });
                });
                sendMsgs.push({ role: 'user', content: parts });
            } else {
                sendMsgs.push({ role: 'user', content: composedText || userVisibleText });
            }
        } else {
            sendMsgs.push({ role: m.role, content: m.content });
        }
    });

    const sendBtn = document.getElementById('sendBtn');
    sendBtn.classList.add('stop');
    sendBtn.textContent = '■';

    const area = document.getElementById('msgsArea');
    const lastMsgEl = area.querySelector('.msg:last-child .bub');
    if (!lastMsgEl) { console.error('bub not found'); return; }

    const updater = UI.makeStreamUpdater(lastMsgEl, area);
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 3000;

    _streamCtrl = API.streamChat(profile, sendMsgs, {
        onStart: () => {},
        onDelta: (delta, full) => {
            aiMsg.content = full;
            updater(full);
            if (Date.now() - lastSaveTime > SAVE_INTERVAL) {
                lastSaveTime = Date.now();
                scheduleSave();
            }
        },
        onDone: async (full) => {
            aiMsg.content = full;
            aiMsg._streaming = false;
            c.updatedAt = Date.now();
            _streamCtrl = null;
            sendBtn.classList.remove('stop');
            sendBtn.textContent = '➤';
            UI.fullRender(lastMsgEl, full);
            await saveNow();
            renderMs();
            renderSB();
        },
        onAbort: async (full) => {
            aiMsg.content = full;
            aiMsg._streaming = false;
            aiMsg._interrupted = true;
            _streamCtrl = null;
            sendBtn.classList.remove('stop');
            sendBtn.textContent = '➤';
            UI.fullRender(lastMsgEl, full || '_（已中断）_');
            await saveNow();
            renderMs();
            toast('已停止');
        },
        onError: async (err) => {
            console.error('[Send] 错误', err);
            aiMsg.content = (aiMsg.content || '') + '\n\n❌ **错误**：' + err.message;
            aiMsg._streaming = false;
            aiMsg._interrupted = true;
            _streamCtrl = null;
            sendBtn.classList.remove('stop');
            sendBtn.textContent = '➤';
            UI.fullRender(lastMsgEl, aiMsg.content);
            await saveNow();
            toast('请求失败：' + err.message, 'er');
        },
    });
}

async function regenerate(msg) {
    const c = curChat();
    if (!c) return;
    const idx = c.messages.indexOf(msg);
    if (idx < 1) return;
    const prev = c.messages[idx - 1];
    if (prev.role !== 'user') {
        toast('无法找到对应的提问', 'er');
        return;
    }
    c.messages.splice(idx, 1);
    const userText = typeof prev.content === 'string' ? prev.content : '';
    c.messages.splice(idx - 1, 1);
    document.getElementById('uIn').value = userText;
    await saveNow();
    renderMs();
    send();
}

/* ============================================================
   ===== 输入区 / 键盘 / 模态框 ===============================
   ============================================================ */
function aRsz(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}
function hKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
    }
}
function openM(n) {
    const m = document.getElementById('mo-' + n);
    if (!m) return;
    m.classList.add('show');
    if (n === 'cs') { renderCSForm(); renderKBList(); }
    if (n === 'set') { renderEngTabs(); renderEngForm(); renderStorageInfo(); }
    if (n === 'exp') updExpPreview();
    if (n === 'snap' && IS_IOS) {
        const w = document.getElementById('iosW');
        if (w) w.style.display = 'block';
    }
}
function closeM(n) {
    const m = document.getElementById('mo-' + n);
    if (m) m.classList.remove('show');
}
function togSB() {
    document.getElementById('sb').classList.toggle('open');
    document.getElementById('sbOv').classList.toggle('show');
}

/* ============================================================
   ===== 附件 / 知识库 / 上传 =================================
   ============================================================ */
function togAtt() {
    document.getElementById('attPan').classList.toggle('show');
}
function updAttCont() {
    _attContinuous = document.getElementById('attCont').checked;
}
function onAtt(inputEl) {
    Upload.fromInput(inputEl);
}

async function handleUploadedFiles(files) {
    if (!files || !files.length) return;
    const fileArr = Array.from(files);
    toast('开始解析 ' + fileArr.length + ' 个文件...');

    const results = await Parser.parseFiles(fileArr);

    let okCount = 0, failCount = 0;
    results.forEach(r => {
        if (r.ok) {
            _pendingAtts.push(r.result);
            okCount++;
        } else {
            failCount++;
            toast('❌ ' + r.file.name + '：' + r.error, 'er');
        }
    });

    if (_attContinuous && okCount > 0) {
        const c = curChat();
        if (c) {
            if (!c.knowledgeBase) c.knowledgeBase = [];
            results.forEach(r => {
                if (r.ok) {
                    c.knowledgeBase.push({
                        id: gId(),
                        name: r.result.fileName,
                        type: r.result.type,
                        text: r.result.text || '',
                        dataUrl: r.result.dataUrl || null,
                        meta: r.result.meta || {},
                        addedAt: Date.now(),
                    });
                }
            });
            c.updatedAt = Date.now();
            await saveNow();
            renderKBList();
        }
    }

    if (okCount > 0) toast('✅ 已解析 ' + okCount + ' 个文件' + (failCount ? '（' + failCount + ' 失败）' : ''));
    renderAttList();
    if (okCount > 0) {
        document.getElementById('attPan').classList.add('show');
    }
}

function renderAttList() {
    const box = document.getElementById('attListBox');
    const list = document.getElementById('attList');
    const cnt = document.getElementById('attCount');
    const btn = document.getElementById('attBtn');

    if (!_pendingAtts.length) {
        box.style.display = 'none';
        btn.classList.remove('has');
        return;
    }
    box.style.display = 'block';
    cnt.textContent = '📎 ' + _pendingAtts.length + ' 个附件待发送';
    btn.classList.add('has');

    list.innerHTML = '';
    _pendingAtts.forEach((a, idx) => {
        const item = document.createElement('div');
        item.className = 'att-item';
        const icon = a.type === 'image' ? '🖼️' :
                     a.type === 'table' ? '📊' :
                     a.type === 'document' ? '📄' : '📝';
        const nm = document.createElement('span');
        nm.className = 'ai-nm';
        nm.textContent = icon + ' ' + a.fileName;
        item.appendChild(nm);

        const sz = document.createElement('span');
        sz.className = 'ai-sz';
        sz.textContent = a.type === 'image'
            ? (a.meta.sizeText || '')
            : (cntW(a.text) + ' 字');
        item.appendChild(sz);

        const rm = document.createElement('button');
        rm.className = 'ai-rm';
        rm.textContent = '×';
        rm.title = '移除';
        rm.onclick = () => { _pendingAtts.splice(idx, 1); renderAttList(); };
        item.appendChild(rm);
        list.appendChild(item);
    });
}

function clrAtt() {
    _pendingAtts = [];
    renderAttList();
}

async function addKB(inputEl) {
    if (!inputEl.files || !inputEl.files.length) return;
    const c = curChat();
    if (!c) { toast('请先创建会话', 'er'); return; }

    toast('解析知识库文件...');
    const results = await Parser.parseFiles(inputEl.files);
    if (!c.knowledgeBase) c.knowledgeBase = [];
    let ok = 0;
    results.forEach(r => {
        if (r.ok) {
            c.knowledgeBase.push({
                id: gId(),
                name: r.result.fileName,
                type: r.result.type,
                text: r.result.text || '',
                dataUrl: r.result.dataUrl || null,
                meta: r.result.meta || {},
                addedAt: Date.now(),
            });
            ok++;
        } else {
            toast('❌ ' + r.file.name + '：' + r.error, 'er');
        }
    });
    if (ok > 0) {
        c.updatedAt = Date.now();
        await saveNow();
        toast('✅ 已加入 ' + ok + ' 个知识库文件');
    }
    renderKBList();
    inputEl.value = '';
}

function renderKBList() {
    const wrap = document.getElementById('kbList');
    if (!wrap) return;
    const c = curChat();
    if (!c || !c.knowledgeBase || !c.knowledgeBase.length) {
        wrap.innerHTML = '<div style="font-size:11px;color:var(--text2)">（暂无知识库文件）</div>';
        return;
    }
    wrap.innerHTML = '';
    c.knowledgeBase.forEach((k, idx) => {
        const item = document.createElement('div');
        item.className = 'att-item';
        item.style.marginBottom = '4px';
        const icon = k.type === 'image' ? '🖼️' :
                     k.type === 'table' ? '📊' :
                     k.type === 'document' ? '📄' : '📝';
        const nm = document.createElement('span');
        nm.className = 'ai-nm';
        nm.textContent = icon + ' ' + k.name;
        item.appendChild(nm);
        const sz = document.createElement('span');
        sz.className = 'ai-sz';
        sz.textContent = k.type === 'image' ? '图片' : (cntW(k.text || '') + ' 字');
        item.appendChild(sz);
        const rm = document.createElement('button');
        rm.className = 'ai-rm';
        rm.textContent = '×';
        rm.title = '移除';
        rm.onclick = async () => {
            if (!confirm('从知识库移除 "' + k.name + '"？')) return;
            c.knowledgeBase.splice(idx, 1);
            c.updatedAt = Date.now();
            await saveNow();
            renderKBList();
        };
        item.appendChild(rm);
        wrap.appendChild(item);
    });
}

/* ============================================================
   ===== 快照 / 导入导出 (v2.3.3) =============================
   ============================================================ */

/* 导出：弹一个简单的选择框 */
function eSnap() {
    const includeKey = confirm(
        '导出快照\n\n' +
        '✅ 确定 = 包含 API Key（推荐：仅本地备份用）\n' +
        '❌ 取消 = 不含 API Key（推荐：分享/上传云盘用）\n\n' +
        '提示：不含 Key 的快照导入后需要重新填写 Key。'
    );
    Snapshot.exportToFile(S, { includeKey: includeKey });
}

/* 导入：自动智能保护本地 Key */
async function iSnap(inputEl) {
    if (!inputEl.files || !inputEl.files.length) return;
    const file = inputEl.files[0];

    const mode = confirm(
        '导入模式选择：\n\n' +
        '✅ 确定 = 替换模式（清除现有数据，完全使用快照）\n' +
        '❌ 取消 = 合并模式（保留现有 + 添加快照内容）\n\n' +
        '✨ 两种模式都会智能保护你本地已有的 API Key（如快照里 Key 为空，自动保留本地 Key）'
    );

    try {
        const { state: importedState, source } = await Snapshot.importFromFile(file);

        let finalState;
        if (mode) {
            // 替换模式：先把空 key 用本地 key 填上
            const { state: protectedState, protectedCount } =
                Snapshot.protectLocalKeys(importedState, S);
            finalState = protectedState;
            if (protectedCount > 0) {
                toast('🔑 已保护 ' + protectedCount + ' 个本地 API Key');
            }
        } else {
            // 合并模式：先 protectLocalKeys，再 merge
            const { state: protectedState, protectedCount } =
                Snapshot.protectLocalKeys(importedState, S);
            finalState = Snapshot.mergeStates(S, protectedState);
            if (protectedCount > 0) {
                toast('🔑 已保护 ' + protectedCount + ' 个本地 API Key');
            }
        }

        // 应用
        S = finalState;
        if (!S.profiles[S.currentEngId]) {
            S.currentEngId = Object.keys(S.profiles)[0] || 'zenmux';
        }
        await saveNow();
        await Snapshot.snapNow(S);
        renderAll();
        const chatCount = Object.keys(S.chats || {}).length;
        toast('✅ 导入成功（' + source + '）：共 ' + chatCount + ' 个会话');
        closeM('snap');
    } catch (e) {
        console.error('[Import]', e);
        toast('导入失败：' + e.message, 'er');
    }
    inputEl.value = '';
}


/* ============================================================
   ===== 对话导出 ==============================================
   ============================================================ */
function updExp() {
    _exportMode = document.getElementById('expFmt').value;
    updExpPreview();
}

function buildExportContent() {
    const c = curChat();
    if (!c || !c.messages || !c.messages.length) {
        return { plain: '（无内容）', html: '<p>（无内容）</p>', title: '空对话' };
    }
    const title = c.title || '对话记录';
    const isPure = _exportMode === 'pure';
    let plain = '', html = '';
    if (!isPure) {
        plain = '【' + title + '】\n导出时间：' + new Date().toLocaleString() + '\n\n';
        html = '<h1>' + esc(title) + '</h1><p style="color:#888;font-size:12px">导出时间：'
             + esc(new Date().toLocaleString()) + '</p><hr>';
    }
    c.messages.forEach((m) => {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (isPure) {
            if (m.role === 'assistant' && text) {
                plain += text + '\n\n';
                html += UI.renderMarkdown(text)
                     + '<hr style="border:none;border-top:1px dashed #ccc;margin:24px 0">';
            }
        } else {
            const roleName = m.role === 'user' ? '👤 我' :
                             (m.role === 'assistant' ? '🤖 AI' : '⚙️ 系统');
            plain += '【' + roleName + '】' + (m._time ? ' ' + m._time : '') + '\n' + text + '\n\n';
            html += '<div style="margin:18px 0;padding:12px 16px;background:'
                  + (m.role === 'user' ? '#e3f2fd' : '#f5f5f5')
                  + ';border-radius:8px"><strong>' + esc(roleName) + '</strong>'
                  + (m._time ? ' <span style="color:#888;font-size:12px">' + esc(m._time) + '</span>' : '')
                  + '<div style="margin-top:6px">'
                  + (m.role === 'assistant' ? UI.renderMarkdown(text)
                     : '<pre style="white-space:pre-wrap;font-family:inherit;margin:0">' + esc(text) + '</pre>')
                  + '</div></div>';
        }
    });
    return { plain: plain.trim(), html: html, title: title };
}

function updExpPreview() {
    const ta = document.getElementById('expTA');
    if (!ta) return;
    const { plain } = buildExportContent();
    ta.value = plain;
}
function eTxt() {
    const { plain, title } = buildExportContent();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    dl(plain, (title || 'chat') + '-' + ts + '.txt', 'text/plain');
    toast('✅ TXT 已导出');
}
function eHtml() {
    const { html, title } = buildExportContent();
    const full = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'
        + esc(title) + '</title>'
        + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">'
        + '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'
        + 'max-width:860px;margin:32px auto;padding:0 16px;line-height:1.7;color:#222}'
        + 'pre{background:#f6f8fa;border-radius:8px;padding:12px;overflow-x:auto;font-size:13px}'
        + 'code{font-family:SF Mono,Consolas,monospace}'
        + 'table{border-collapse:collapse;margin:12px 0}'
        + 'th,td{border:1px solid #ddd;padding:6px 12px}th{background:#f0f0f0}'
        + 'blockquote{border-left:4px solid #667eea;padding-left:12px;color:#666;margin:8px 0}'
        + 'img{max-width:100%}</style></head><body>' + html + '</body></html>';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    dl(full, (title || 'chat') + '-' + ts + '.html', 'text/html');
    toast('✅ HTML 已导出');
}
function eDoc() {
    const { html, title } = buildExportContent();
    const full = '<html xmlns:o="urn:schemas-microsoft-com:office:office" '
        + 'xmlns:w="urn:schemas-microsoft-com:office:word" '
        + 'xmlns="http://www.w3.org/TR/REC-html40">'
        + '<head><meta charset="UTF-8"><title>' + esc(title) + '</title>'
        + '<style>body{font-family:微软雅黑,Microsoft YaHei,Arial;line-height:1.7;font-size:14px}'
        + 'pre{background:#f6f8fa;padding:8px;border:1px solid #ddd;font-family:Consolas,monospace}'
        + 'table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}'
        + '</style></head><body>' + html + '</body></html>';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    dl(full, (title || 'chat') + '-' + ts + '.doc', 'application/msword');
    toast('✅ Word 已导出');
}
function cpExp() {
    const ta = document.getElementById('expTA');
    if (!ta || !ta.value) { toast('无内容', 'er'); return; }
    ta.select();
    try {
        document.execCommand('copy');
        toast('✅ 已复制到剪贴板');
    } catch (e) {
        navigator.clipboard.writeText(ta.value).then(() => toast('✅ 已复制'));
    }
}

/* ============================================================
   ===== 初始化 ================================================
   ============================================================ */
async function initApp() {
    try {
        await DB.init();
        await DB.migrateFromLocalStorage();
        await DB.requestPersistent();
        await loadState();

        if (!S.currentChatId || !S.chats[S.currentChatId]) {
            if (S.chatOrder.length && S.chats[S.chatOrder[0]]) {
                S.currentChatId = S.chatOrder[0];
            } else {
                newChat();
                initUpload();
                initSnapshot();
                return;
            }
        }
        renderAll();
        initUpload();
        initSnapshot();
        toast('✅ 飞凡AI 就绪');
    } catch (e) {
        console.error('[InitApp]', e);
        toast('初始化失败：' + e.message, 'er');
    }
}

function initUpload() {
    if (typeof Upload === 'undefined') return;
    Upload.onFiles(handleUploadedFiles);
    Upload.init({
        dropTarget: document.getElementById('msgsArea'),
        dropMask: document.getElementById('dropMask'),
        paste: true,
    });
    console.log('[Upload] 已就绪');
}

function initSnapshot() {
    if (typeof Snapshot === 'undefined') return;
    Snapshot.startAuto(S.snapInterval || 5, () => S);
    console.log('[Snapshot] 已挂载');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

window.addEventListener('beforeunload', () => {
    if (_streamCtrl) {
        try { DB.saveState(S); } catch (e) {}
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        const setM = document.getElementById('mo-set');
        if (setM && setM.classList.contains('show')) renderStorageInfo();
    }
});

/* ============================================================
   ===== Service Worker 注册（PWA） ===========================
   ============================================================ */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('[PWA] SW registered:', reg.scope);
        }).catch(err => {
            console.warn('[PWA] SW failed:', err);
        });
    });
}
