/* ===== 飞凡AI - 快照系统 ===== */
/* 自动覆盖式快照 + 导入导出 + 全版本兼容解析 */

const Snapshot = (function () {

    let _autoTimer = null;
    let _lastSnapHash = ''; // 简单去重，无变化不重复写

    /* ---------- 简易哈希（用于变化检测） ---------- */
    function quickHash(obj) {
        try {
            const str = JSON.stringify(obj);
            // 简单 hash：字符串长度 + 前后取样
            return str.length + ':' + str.slice(0, 100) + ':' + str.slice(-100);
        } catch (e) {
            return String(Date.now());
        }
    }

    /* ---------- 启动自动快照 ---------- */
    function startAuto(intervalMin, getStateFn) {
        stopAuto();
        const min = parseInt(intervalMin, 10) || 0;
        if (min <= 0) {
            console.log('[Snapshot] 自动快照已关闭');
            return;
        }
        const ms = min * 60 * 1000;
        console.log('[Snapshot] 自动快照启动，间隔 ' + min + ' 分钟');
        _autoTimer = setInterval(async () => {
            try {
                const state = getStateFn();
                const h = quickHash(state);
                if (h === _lastSnapHash) {
                    console.log('[Snapshot] 数据无变化，跳过');
                    return;
                }
                await DB.saveAutoSnapshot(state);
                _lastSnapHash = h;
                console.log('[Snapshot] 自动快照完成 @ ' + new Date().toLocaleTimeString());
            } catch (e) {
                console.error('[Snapshot] 自动快照失败', e);
            }
        }, ms);
    }

    function stopAuto() {
        if (_autoTimer) {
            clearInterval(_autoTimer);
            _autoTimer = null;
        }
    }

    /* ---------- 手动触发一次快照 ---------- */
    async function snapNow(state) {
        await DB.saveAutoSnapshot(state);
        _lastSnapHash = quickHash(state);
    }

    /* ---------- 导出快照为 JSON 文件 ---------- */
    function exportToFile(state) {
        const wrap = {
            __feifan_snapshot__: true,
            version: APP_VERSION,
            exportedAt: new Date().toISOString(),
            data: state,
        };
        const json = JSON.stringify(wrap, null, 2);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        dl(json, 'feifan-backup-' + ts + '.json', 'application/json');
        toast('✅ 已导出快照');
    }

    /* ---------- 解析快照（兼容所有历史版本） ---------- */
    /*
        支持的格式：
        1. 新版包装格式：{ __feifan_snapshot__: true, version, data: {...} }
        2. 你最早 ZenMux 版本：直接是 S 对象 { profiles, chats, currentChatId, ... }
        3. 中间各种变体：尽力识别
    */
    function detectAndNormalize(raw) {
        if (!raw || typeof raw !== 'object') {
            throw new Error('快照内容无效');
        }

        // 新版包装格式
        if (raw.__feifan_snapshot__ && raw.data) {
            return { state: raw.data, source: 'feifan-v' + (raw.version || '?') };
        }

        // ZenMux / 旧版直接 S 格式（含 chats）
        if (raw.chats && typeof raw.chats === 'object') {
            return { state: normalizeOldState(raw), source: 'legacy-direct' };
        }

        // 一些中间版本可能用 conversations 字段
        if (raw.conversations && typeof raw.conversations === 'object') {
            const fixed = Object.assign({}, raw, { chats: raw.conversations });
            delete fixed.conversations;
            return { state: normalizeOldState(fixed), source: 'legacy-conversations' };
        }

        // 兜底：如果有 profiles 但没 chats，也接受
        if (raw.profiles && typeof raw.profiles === 'object') {
            const fixed = Object.assign({ chats: {} }, raw);
            return { state: normalizeOldState(fixed), source: 'legacy-profiles-only' };
        }

        // 单会话格式（极旧版？）：{ messages: [...], title: ... }
        if (Array.isArray(raw.messages)) {
            const id = (raw.id) || ('imp_' + Date.now());
            const chat = {
                id: id,
                title: raw.title || '导入的对话',
                messages: raw.messages,
                engineId: raw.engineId || 'openai',
                systemPrompt: raw.systemPrompt || '',
                params: raw.params || { temperature: 0.7, top_p: 1, max_tokens: 4096 },
                knowledgeBase: raw.knowledgeBase || [],
                isPinned: !!raw.isPinned,
                isArchived: !!raw.isArchived,
                createdAt: raw.createdAt || Date.now(),
                updatedAt: raw.updatedAt || Date.now(),
            };
            return {
                state: normalizeOldState({ chats: { [id]: chat }, currentChatId: id }),
                source: 'legacy-single-chat',
            };
        }

        throw new Error('无法识别此快照格式');
    }

    /* ---------- 老版 state 标准化（补字段） ---------- */
    function normalizeOldState(old) {
        const n = {
            profiles: {},
            chats: {},
            chatOrder: [],
            currentChatId: null,
            currentEngId: 'openai',
            theme: 'light',
            snapInterval: 5,
        };

        // 引擎
        if (old.profiles && typeof old.profiles === 'object') {
            for (const k in old.profiles) {
                const p = old.profiles[k] || {};
                n.profiles[k] = {
                    id: p.id || k,
                    name: p.name || k,
                    enabled: p.enabled !== false,
                    base: p.base || p.baseUrl || p.endpoint || 'https://api.openai.com/v1',
                    key: p.key || p.apiKey || '',
                    proxy: !!p.proxy,
                    model: p.model || p.modelName || 'gpt-4o-mini',
                    type: p.type || 'openai',
                };
            }
        }

        // 会话
        if (old.chats && typeof old.chats === 'object') {
            for (const k in old.chats) {
                const c = old.chats[k] || {};
                const messages = Array.isArray(c.messages) ? c.messages.map(normalizeOldMessage) : [];
                n.chats[k] = {
                    id: c.id || k,
                    title: c.title || '导入的对话',
                    messages: messages,
                    engineId: c.engineId || 'openai',
                    systemPrompt: c.systemPrompt || c.system || '',
                    params: c.params || { temperature: 0.7, top_p: 1, max_tokens: 4096 },
                    knowledgeBase: Array.isArray(c.knowledgeBase) ? c.knowledgeBase :
                                   (Array.isArray(c.kb) ? c.kb : []),
                    isPinned: !!(c.isPinned || c.pinned),
                    isArchived: !!(c.isArchived || c.archived),
                    createdAt: c.createdAt || c.created || Date.now(),
                    updatedAt: c.updatedAt || c.updated || Date.now(),
                };
            }
        }

        // chatOrder
        if (Array.isArray(old.chatOrder)) {
            n.chatOrder = old.chatOrder.filter(id => n.chats[id]);
        }
        // 补全顺序（按 updatedAt 倒序）
        const missingIds = Object.keys(n.chats).filter(id => !n.chatOrder.includes(id));
        missingIds.sort((a, b) => (n.chats[b].updatedAt || 0) - (n.chats[a].updatedAt || 0));
        n.chatOrder = n.chatOrder.concat(missingIds);

        // 其他
        n.currentChatId = old.currentChatId && n.chats[old.currentChatId]
            ? old.currentChatId
            : (n.chatOrder[0] || null);
        n.currentEngId = old.currentEngId || (Object.keys(n.profiles)[0] || 'openai');
        n.theme = old.theme || 'light';
        n.snapInterval = (old.snapInterval !== undefined) ? old.snapInterval : 5;

        return n;
    }

    /* ---------- 老消息标准化 ---------- */
    function normalizeOldMessage(m) {
        if (!m || typeof m !== 'object') return null;
        return {
            id: m.id || gId(),
            role: m.role || 'user',
            content: m.content !== undefined ? m.content : (m.text || ''),
            attachments: Array.isArray(m.attachments) ? m.attachments : [],
            _time: m._time || m.time || '',
            _streaming: false,
            _interrupted: !!m._interrupted,
        };
    }

    /* ---------- 导入文件 → 解析 → 合并 / 替换 ---------- */
    /*
        mode:
            'replace' - 完全替换（默认）
            'merge'   - 合并到当前数据
    */
    async function importFromFile(file, mode) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = async (e) => {
                try {
                    const raw = JSON.parse(e.target.result);
                    const { state, source } = detectAndNormalize(raw);
                    console.log('[Snapshot] 导入来源:', source);
                    if (mode === 'merge') {
                        resolve({ state, source, merged: true });
                    } else {
                        resolve({ state, source, merged: false });
                    }
                } catch (err) {
                    reject(new Error('解析快照失败：' + err.message));
                }
            };
            r.onerror = () => reject(new Error('文件读取失败'));
            r.readAsText(file, 'utf-8');
        });
    }

    /* ---------- 合并两个 state（用于 merge 模式） ---------- */
    function mergeStates(current, incoming) {
        const merged = JSON.parse(JSON.stringify(current));
        // 引擎：incoming 覆盖（保留 current 中没有的）
        merged.profiles = Object.assign({}, current.profiles || {}, incoming.profiles || {});
        // 会话：合并，相同 id 时 incoming 覆盖
        merged.chats = Object.assign({}, current.chats || {}, incoming.chats || {});
        // chatOrder：incoming 优先，再追加 current 独有的
        const seen = new Set();
        const newOrder = [];
        (incoming.chatOrder || []).forEach(id => {
            if (merged.chats[id] && !seen.has(id)) { newOrder.push(id); seen.add(id); }
        });
        (current.chatOrder || []).forEach(id => {
            if (merged.chats[id] && !seen.has(id)) { newOrder.push(id); seen.add(id); }
        });
        Object.keys(merged.chats).forEach(id => {
            if (!seen.has(id)) { newOrder.push(id); seen.add(id); }
        });
        merged.chatOrder = newOrder;
        return merged;
    }

    return {
        startAuto: startAuto,
        stopAuto: stopAuto,
        snapNow: snapNow,
        exportToFile: exportToFile,
        importFromFile: importFromFile,
        mergeStates: mergeStates,
        detectAndNormalize: detectAndNormalize,
    };
})();
