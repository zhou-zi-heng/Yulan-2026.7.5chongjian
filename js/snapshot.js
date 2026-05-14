/* ===== 飞凡AI - 快照系统 (v2.3.3) ===== */
/* 自动覆盖式快照 + 导入导出 + 全版本兼容 + 智能 key 保护 */

const Snapshot = (function () {

    let _autoTimer = null;
    let _lastSnapHash = '';

    function quickHash(obj) {
        try {
            const str = JSON.stringify(obj);
            return str.length + ':' + str.slice(0, 100) + ':' + str.slice(-100);
        } catch (e) {
            return String(Date.now());
        }
    }

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

    async function snapNow(state) {
        await DB.saveAutoSnapshot(state);
        _lastSnapHash = quickHash(state);
    }

    /* ---------- 导出快照（支持不带 key） ---------- */
    function exportToFile(state, options) {
        const opts = options || {};
        const includeKey = opts.includeKey !== false; // 默认带 key

        // 深拷贝以免影响原数据
        const data = JSON.parse(JSON.stringify(state));

        if (!includeKey) {
            // 清空所有引擎的 key
            if (data.profiles) {
                for (const id in data.profiles) {
                    if (data.profiles[id]) data.profiles[id].key = '';
                }
            }
        }

        const wrap = {
            __feifan_snapshot__: true,
            version: APP_VERSION,
            exportedAt: new Date().toISOString(),
            includeKey: includeKey,
            data: data,
        };
        const json = JSON.stringify(wrap, null, 2);
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const suffix = includeKey ? '' : '-nokey';
        dl(json, 'feifan-backup-' + ts + suffix + '.json', 'application/json');
        toast(includeKey ? '✅ 已导出快照（含 API Key）' : '✅ 已导出快照（不含 API Key）');
    }

    /* ---------- 解析快照（兼容所有历史版本） ---------- */
    function detectAndNormalize(raw) {
        if (!raw || typeof raw !== 'object') {
            throw new Error('快照内容无效');
        }

        if (raw.__feifan_snapshot__ && raw.data) {
            return { state: raw.data, source: 'feifan-v' + (raw.version || '?') };
        }

        if (raw.chats && typeof raw.chats === 'object') {
            return { state: normalizeOldState(raw), source: 'legacy-direct' };
        }

        if (raw.conversations && typeof raw.conversations === 'object') {
            const fixed = Object.assign({}, raw, { chats: raw.conversations });
            delete fixed.conversations;
            return { state: normalizeOldState(fixed), source: 'legacy-conversations' };
        }

        if (raw.profiles && typeof raw.profiles === 'object') {
            const fixed = Object.assign({ chats: {} }, raw);
            return { state: normalizeOldState(fixed), source: 'legacy-profiles-only' };
        }

        if (Array.isArray(raw.messages)) {
            const id = (raw.id) || ('imp_' + Date.now());
            const chat = {
                id: id,
                title: raw.title || '导入的对话',
                messages: raw.messages,
                systemPrompt: raw.systemPrompt || '',
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

    function normalizeOldState(old) {
        const n = {
            profiles: {},
            chats: {},
            chatOrder: [],
            currentChatId: null,
            currentEngId: 'zenmux',
            theme: 'light',
            snapInterval: 5,
        };

        if (old.profiles && typeof old.profiles === 'object') {
            for (const k in old.profiles) {
                const p = old.profiles[k] || {};
                n.profiles[k] = {
                    id: p.id || k,
                    name: p.name || k,
                    base: p.base || p.baseUrl || p.endpoint || 'https://api.openai.com/v1',
                    key: p.key || p.apiKey || '',
                    model: p.model || p.modelName || 'gpt-4o-mini',
                    useTemp: p.useTemp !== false,
                    temperature: p.temperature !== undefined ? p.temperature : 0.7,
                    useMax: p.useMax !== false,
                    max_tokens: p.max_tokens || p.maxTokens || 4096,
                    useTopP: !!p.useTopP,
                    top_p: p.top_p !== undefined ? p.top_p : 1,
                    useFreq: !!p.useFreq,
                    frequency_penalty: p.frequency_penalty !== undefined ? p.frequency_penalty : 0,
                };
            }
        }

        if (old.chats && typeof old.chats === 'object') {
            for (const k in old.chats) {
                const c = old.chats[k] || {};
                const messages = Array.isArray(c.messages) ? c.messages.map(normalizeOldMessage).filter(Boolean) : [];
                n.chats[k] = {
                    id: c.id || k,
                    title: c.title || '导入的对话',
                    messages: messages,
                    systemPrompt: c.systemPrompt || c.system || '',
                    knowledgeBase: Array.isArray(c.knowledgeBase) ? c.knowledgeBase :
                                   (Array.isArray(c.kb) ? c.kb : []),
                    isPinned: !!(c.isPinned || c.pinned),
                    isArchived: !!(c.isArchived || c.archived),
                    createdAt: c.createdAt || c.created || Date.now(),
                    updatedAt: c.updatedAt || c.updated || Date.now(),
                };
            }
        }

        if (Array.isArray(old.chatOrder)) {
            n.chatOrder = old.chatOrder.filter(id => n.chats[id]);
        }
        const missingIds = Object.keys(n.chats).filter(id => !n.chatOrder.includes(id));
        missingIds.sort((a, b) => (n.chats[b].updatedAt || 0) - (n.chats[a].updatedAt || 0));
        n.chatOrder = n.chatOrder.concat(missingIds);

        n.currentChatId = old.currentChatId && n.chats[old.currentChatId]
            ? old.currentChatId
            : (n.chatOrder[0] || null);
        n.currentEngId = old.currentEngId || (Object.keys(n.profiles)[0] || 'zenmux');
        n.theme = old.theme || 'light';
        n.snapInterval = (old.snapInterval !== undefined) ? old.snapInterval : 5;

        return n;
    }

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

    /* ---------- 智能 key 保护：合并时保护本地已有 key ---------- */
    /*
        规则：
        - 如果 incoming 引擎有 key（非空），用 incoming 的
        - 如果 incoming 引擎 key 为空，但 current 同 ID 引擎有 key，保留 current 的 key
        - 其他字段都用 incoming 的
    */
    function protectLocalKeys(incoming, current) {
        if (!incoming || !incoming.profiles || !current || !current.profiles) return incoming;
        const result = JSON.parse(JSON.stringify(incoming));
        let protectedCount = 0;
        for (const id in result.profiles) {
            const incP = result.profiles[id];
            const curP = current.profiles[id];
            if (curP && curP.key && (!incP.key || incP.key.trim() === '')) {
                incP.key = curP.key;
                protectedCount++;
            }
        }
        if (protectedCount > 0) {
            console.log('[Snapshot] 已保护 ' + protectedCount + ' 个本地 API Key');
        }
        return { state: result, protectedCount: protectedCount };
    }

    async function importFromFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = async (e) => {
                try {
                    const raw = JSON.parse(e.target.result);
                    const { state, source } = detectAndNormalize(raw);
                    console.log('[Snapshot] 导入来源:', source);
                    resolve({ state, source });
                } catch (err) {
                    reject(new Error('解析快照失败：' + err.message));
                }
            };
            r.onerror = () => reject(new Error('文件读取失败'));
            r.readAsText(file, 'utf-8');
        });
    }

    function mergeStates(current, incoming) {
        const merged = JSON.parse(JSON.stringify(current));
        merged.profiles = Object.assign({}, current.profiles || {}, incoming.profiles || {});
        merged.chats = Object.assign({}, current.chats || {}, incoming.chats || {});
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
        protectLocalKeys: protectLocalKeys,
        detectAndNormalize: detectAndNormalize,
    };
})();

window.Snapshot = Snapshot;
