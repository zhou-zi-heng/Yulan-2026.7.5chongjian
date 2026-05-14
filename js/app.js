/* ===== 飞凡AI - 主入口 ===== */
/* 全局状态 + 事件绑定 + 业务逻辑 */

/* ---------- 全局状态 ---------- */
let S = {
    profiles: {},        // 引擎配置 {id: profile}
    chats: {},           // 会话 {id: chat}
    chatOrder: [],       // 会话显示顺序
    currentChatId: null, // 当前会话 ID
    currentEngId: 'openai', // 当前激活引擎
    theme: 'light',
    snapInterval: 5,     // 快照间隔（分钟）
};

let _saving = false;
let _saveTimer = null;
let _streamCtrl = null;  // 当前流式控制器
let _streamUpdater = null;
let _saveInProgress = null; // Promise，防止并发保存

/* ---------- 数据保存（防抖 + 并发保护） ---------- */
function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveNow, 300);
}

async function saveNow() {
    if (_saveInProgress) {
        await _saveInProgress;
        return;
    }
    _saveInProgress = DB.saveState(S);
    try {
        await _saveInProgress;
    } finally {
        _saveInProgress = null;
    }
}

/* ---------- 加载状态 ---------- */
async function loadState() {
    const loaded = await DB.loadState();
    if (loaded && typeof loaded === 'object') {
        // 兼容老格式：可能没有 chatOrder
        S = Object.assign({
            profiles: {},
            chats: {},
            chatOrder: [],
            currentChatId: null,
            currentEngId: 'openai',
            theme: 'light',
            snapInterval: 5,
        }, loaded);

        // 修补 chatOrder（如果丢失）
        if (!S.chatOrder || !S.chatOrder.length) {
            S.chatOrder = Object.keys(S.chats || {}).sort((a, b) => {
                return (S.chats[b].updatedAt || 0) - (S.chats[a].updatedAt || 0);
            });
        }

        // 修复未完成的流式消息（崩溃恢复）
        for (const cid in S.chats) {
            const c = S.chats[cid];
            if (c.messages) {
                c.messages.forEach(m => {
                    if (m._streaming) {
                        m._streaming = false;
                        m._interrupted = true;
                    }
                });
            }
        }
    }
    // 默认引擎初始化
    if (!S.profiles || !Object.keys(S.profiles).length) {
        S.profiles = JSON.parse(JSON.stringify(API.DEFAULT_PROFILES));
    }
    // 应用主题
    if (S.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const tb = document.getElementById('themeBtn');
        if (tb) tb.textContent = '☀️';
    }
}

/* ---------- 当前会话/引擎获取 ---------- */
function curChat() {
    if (!S.currentChatId) return null;
    return S.chats[S.currentChatId] || null;
}
function curProfile() {
    const c = curChat();
    const eid = (c && c.engineId) || S.currentEngId;
    return S.profiles[eid] || S.profiles[Object.keys(S.profiles)[0]];
}

/* ---------- 创建新会话 ---------- */
function newChat() {
    const id = gId();
    const chat = {
        id: id,
        title: '新对话',
        messages: [],
        engineId: S.currentEngId,
        systemPrompt: '',
        params: { temperature: 0.7, top_p: 1, max_tokens: 4096 },
        knowledgeBase: [],
        isPinned: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    S.chats[id] = chat;
    S.chatOrder.unshift(id);
    S.currentChatId = id;
    scheduleSave();
    renderAll();
    // 关闭移动端侧边栏
    if (IS_MOBILE) {
        document.getElementById('sb').classList.remove('open');
        document.getElementById('sbOv').classList.remove('show');
    }
}

/* ---------- 切换会话 ---------- */
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

/* ---------- 删除会话 ---------- */
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

/* ---------- 重命名会话 ---------- */
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

/* ---------- 置顶/归档/清空 ---------- */
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

/* ---------- 主题切换 ---------- */
function togTheme() {
    S.theme = S.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', S.theme === 'dark' ? 'dark' : '');
    document.getElementById('themeBtn').textContent = S.theme === 'dark' ? '☀️' : '🌙';
    scheduleSave();
}

/* ---------- 渲染：侧边栏 ---------- */
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
            const hay = (c.title + ' ' + (c.messages || []).map(m => typeof m.content === 'string' ? m.content : '').join(' ')).toLowerCase();
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
        renBtn.textContent = '✏️';
        renBtn.title = '重命名';
        renBtn.onclick = (e) => { e.stopPropagation(); renameChat(id); };
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️';
        delBtn.title = '删除';
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

    // 引擎徽章
    const p = curProfile();
    document.getElementById('badge').innerHTML = p
        ? '当前引擎: <strong>' + esc(p.name) + '</strong><br>模型: ' + esc(p.model || '-')
        : '请先在 ⚙️ 中配置引擎';
}

/* ---------- 渲染：消息区 ---------- */
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

    // 标题
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

/* ---------- 引擎设置 UI ---------- */
function renderEngTabs() {
    const tabs = document.getElementById('engTabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    Object.values(S.profiles).forEach(p => {
        const b = document.createElement('button');
        b.className = 'tab' + (p.id === S.currentEngId ? ' act' : '');
        b.textContent = p.name + (p.enabled ? '' : ' ⏸');
        b.onclick = () => { S.currentEngId = p.id; renderEngTabs(); renderEngForm(); renderSB(); scheduleSave(); };
        tabs.appendChild(b);
    });
}

function renderEngForm() {
    const form = document.getElementById('engForm');
    if (!form) return;
    const p = S.profiles[S.currentEngId];
    if (!p) { form.innerHTML = '<p style="color:var(--text2)">请选择一个引擎</p>'; return; }

    form.innerHTML = '';

    function fg(label, html) {
        const d = document.createElement('div');
        d.className = 'fg';
        d.innerHTML = '<label>' + label + '</label>' + html;
        return d;
    }

    // 启用
    const en = document.createElement('div');
    en.className = 'pt';
    en.innerHTML = '<input type="checkbox" id="engEnabled"' + (p.enabled ? ' checked' : '') + '><label for="engEnabled">启用此引擎</label>';
    form.appendChild(en);
    en.querySelector('input').onchange = (e) => { p.enabled = e.target.checked; scheduleSave(); renderEngTabs(); };

    // 名称
    const nm = fg('引擎名称', '<input type="text" value="' + esc(p.name) + '" id="engName">');
    form.appendChild(nm);
    nm.querySelector('input').onchange = (e) => { p.name = e.target.value; scheduleSave(); renderEngTabs(); renderSB(); };

    // 类型
    const ty = fg('协议类型', '<select id="engType">' +
        ['openai', 'claude', 'gemini'].map(t => '<option value="' + t + '"' + (p.type === t ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>');
    form.appendChild(ty);
    ty.querySelector('select').onchange = (e) => { p.type = e.target.value; scheduleSave(); };

    // Base URL
    const bs = fg('Base URL', '<input type="text" value="' + esc(p.base) + '" id="engBase">');
    form.appendChild(bs);
    bs.querySelector('input').onchange = (e) => { p.base = e.target.value.trim(); scheduleSave(); };

    // Key
    const ky = fg('API Key', '<input type="password" value="' + esc(p.key) + '" id="engKey" autocomplete="off">');
    form.appendChild(ky);
    ky.querySelector('input').onchange = (e) => { p.key = e.target.value.trim(); scheduleSave(); };

    // Model
    const md = fg('模型', '<input type="text" value="' + esc(p.model) + '" id="engModel">');
    form.appendChild(md);
    md.querySelector('input').onchange = (e) => { p.model = e.target.value.trim(); scheduleSave(); renderSB(); };

    // 代理
    const px = document.createElement('div');
    px.className = 'pt';
    px.innerHTML = '<input type="checkbox" id="engProxy"' + (p.proxy ? ' checked' : '') + '><label for="engProxy">通过 Cloudflare Functions 代理（解决跨域/封锁）</label>';
    form.appendChild(px);
    px.querySelector('input').onchange = (e) => { p.proxy = e.target.checked; scheduleSave(); };

    // 删除按钮（不能删除内置）
    if (!API.DEFAULT_PROFILES[p.id]) {
        const dl = document.createElement('button');
        dl.className = 'btn btn-d btn-s';
        dl.textContent = '🗑️ 删除此引擎';
        dl.style.marginTop = '12px';
        dl.onclick = () => {
            if (confirm('删除引擎 ' + p.name + '？')) {
                delete S.profiles[p.id];
                S.currentEngId = Object.keys(S.profiles)[0] || 'openai';
                scheduleSave();
                renderEngTabs(); renderEngForm(); renderSB();
            }
        };
        form.appendChild(dl);
    }
}

function addEng() {
    const name = prompt('新引擎名称：', '我的引擎');
    if (!name || !name.trim()) return;
    const id = 'custom_' + gId().slice(0, 8);
    S.profiles[id] = {
        id: id, name: name.trim(), enabled: true,
        base: 'https://api.openai.com/v1', key: '', proxy: false,
        model: 'gpt-4o-mini', type: 'openai',
    };
    S.currentEngId = id;
    scheduleSave();
    renderEngTabs(); renderEngForm(); renderSB();
}

/* ---------- 会话设置表单 ---------- */
function renderCSForm() {
    const c = curChat();
    if (!c) return;
    document.getElementById('spIn').value = c.systemPrompt || '';
    document.getElementById('snapInterval').value = String(S.snapInterval || 5);
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
    toast('快照间隔已设为 ' + (S.snapInterval || '关闭') + (S.snapInterval ? ' 分钟' : ''));
    // 第四批会真正生效
}

/* ---------- 存储信息 ---------- */
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

/* ---------- 发送消息 ---------- */
async function send() {
    if (_streamCtrl) {
        // 正在流式 → 改为停止
        _streamCtrl.abort();
        return;
    }

    let c = curChat();
    if (!c) {
        newChat();
        c = curChat();
    }

    const inp = document.getElementById('uIn');
    const text = (inp.value || '').trim();
    if (!text) { toast('请输入内容', 'er'); return; }

    const profile = curProfile();
    if (!profile || !profile.key) {
        toast('请先在 ⚙️ 中配置引擎 API Key', 'er');
        openM('set');
        return;
    }

    // 推入用户消息
    const userMsg = {
        id: gId(),
        role: 'user',
        content: text,
        _time: nowTime(),
    };
    c.messages.push(userMsg);

    // 推入占位 assistant 消息（中途持久化的关键）
    const aiMsg = {
        id: gId(),
        role: 'assistant',
        content: '',
        _streaming: true,
        _time: nowTime(),
    };
    c.messages.push(aiMsg);

    // 自动改标题
    if (c.title === '新对话' && c.messages.length <= 2) {
        c.title = text.slice(0, 24);
    }
    c.updatedAt = Date.now();

    // 清空输入
    inp.value = '';
    aRsz(inp);

    await saveNow(); // 立即保存（用户消息不丢）
    renderMs();
    renderSB();

    // 构造 messages
    const sendMsgs = [];
    if (c.systemPrompt && c.systemPrompt.trim()) {
        sendMsgs.push({ role: 'system', content: c.systemPrompt });
    }
    c.messages.forEach(m => {
        if (m === aiMsg) return; // 跳过占位
        if (m._interrupted && !m.content) return;
        sendMsgs.push({ role: m.role, content: m.content });
    });

    // 发送按钮变停止
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.classList.add('stop');
    sendBtn.textContent = '■';

    // 找到当前 bub
    const area = document.getElementById('msgsArea');
    const lastMsgEl = area.querySelector('.msg:last-child .bub');
    if (!lastMsgEl) { console.error('bub not found'); return; }

    const updater = UI.makeStreamUpdater(lastMsgEl, area);

    // 流式中途持久化（每 3 秒）
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL = 3000;

    _streamCtrl = API.streamChat(profile, sendMsgs, c.params, {
        onStart: () => {
            console.log('[Send] 开始流式');
        },
        onDelta: (delta, full) => {
            aiMsg.content = full;
            updater(full);
            // 中途持久化
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

/* ---------- 重新生成 ---------- */
async function regenerate(msg) {
    const c = curChat();
    if (!c) return;
    // 找到这条 assistant 消息的位置，删除后重新发送上一条 user
    const idx = c.messages.indexOf(msg);
    if (idx < 1) return;
    const prev = c.messages[idx - 1];
    if (prev.role !== 'user') {
        toast('无法找到对应的提问', 'er');
        return;
    }
    // 删除当前 assistant
    c.messages.splice(idx, 1);
    // 把 user 内容放回输入框 + 删 user
    const userText = typeof prev.content === 'string' ? prev.content : '';
    c.messages.splice(idx - 1, 1);
    document.getElementById('uIn').value = userText;
    await saveNow();
    renderMs();
    send();
}

/* ---------- 输入区高度自适应 ---------- */
function aRsz(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

/* ---------- 键盘 ---------- */
function hKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
    }
}

/* ---------- 模态框 ---------- */
function openM(n) {
    const m = document.getElementById('mo-' + n);
    if (!m) return;
    m.classList.add('show');
    if (n === 'cs') renderCSForm();
    if (n === 'set') { renderEngTabs(); renderEngForm(); renderStorageInfo(); }
    if (n === 'snap' && IS_IOS) {
        const w = document.getElementById('iosW');
        if (w) w.style.display = 'block';
    }
}
function closeM(n) {
    const m = document.getElementById('mo-' + n);
    if (m) m.classList.remove('show');
}

/* ---------- 侧边栏切换 ---------- */
function togSB() {
    document.getElementById('sb').classList.toggle('open');
    document.getElementById('sbOv').classList.toggle('show');
}

/* ---------- 附件面板（占位，第三批实现） ---------- */
function togAtt() { document.getElementById('attPan').classList.toggle('show'); }
function onAtt() { toast('附件功能将在第三批启用', 'er'); }
function updAttCont() {}
function clrAtt() {}
function addKB() { toast('知识库功能将在第三批启用', 'er'); }

/* ---------- 导出/快照（占位，第四批实现） ---------- */
function updExp() {}
function eTxt() { toast('导出将在第四批实现', 'er'); }
function eHtml() { toast('导出将在第四批实现', 'er'); }
function eDoc() { toast('导出将在第四批实现', 'er'); }
function cpExp() { toast('导出将在第四批实现', 'er'); }
function eSnap() { toast('快照将在第四批实现', 'er'); }
function iSnap() { toast('快照将在第四批实现', 'er'); }

/* ---------- 初始化 ---------- */
async function initApp() {
    try {
        await DB.init();
        // 迁移旧数据
        await DB.migrateFromLocalStorage();
        // 申请持久化
        await DB.requestPersistent();
        // 加载状态
        await loadState();
        // 没有任何会话则新建一个
        if (!S.currentChatId || !S.chats[S.currentChatId]) {
            if (S.chatOrder.length && S.chats[S.chatOrder[0]]) {
                S.currentChatId = S.chatOrder[0];
            } else {
                newChat();
                return; // newChat 已渲染
            }
        }
        renderAll();
        toast('✅ 飞凡AI 就绪');
    } catch (e) {
        console.error('[InitApp]', e);
        toast('初始化失败：' + e.message, 'er');
    }
}

// DOM 就绪后启动
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// 页面卸载前强制保存
window.addEventListener('beforeunload', () => {
    if (_streamCtrl) {
        // 流式中要至少保存一次
        navigator.sendBeacon && DB.saveState(S);
    }
});

// visibilitychange：切回前台时刷新存储信息
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        const setM = document.getElementById('mo-set');
        if (setM && setM.classList.contains('show')) renderStorageInfo();
    }
});
