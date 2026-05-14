/* ===== ZenMux IndexedDB 存储层 ===== */
/* 提供与 localStorage 类似的简单 API，背后用 IndexedDB */

const DB = (function () {
    const DB_NAME = 'ZenMuxDB';
    const DB_VERSION = 1;
    const OLD_LS_KEY = 'zenmux_v3'; // 旧 localStorage 键
    const SETTINGS_KEY_STATE = 'app_state'; // 存主状态对象

    let _db = null;

    /* ---------- 打开数据库 ---------- */
    function init() {
        return new Promise((resolve, reject) => {
            if (!SUPPORTS_INDEXEDDB) {
                reject(new Error('当前浏览器不支持 IndexedDB'));
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = function (e) {
                const db = e.target.result;

                // 1. 会话元信息（id, title, 时间, 置顶, 归档等）
                if (!db.objectStoreNames.contains('conversations')) {
                    const s = db.createObjectStore('conversations', { keyPath: 'id' });
                    s.createIndex('updatedAt', 'updatedAt');
                    s.createIndex('isPinned', 'isPinned');
                    s.createIndex('isArchived', 'isArchived');
                }

                // 2. 消息（按 convId 索引）
                if (!db.objectStoreNames.contains('messages')) {
                    const s = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('convId', 'convId');
                    s.createIndex('convId_seq', ['convId', 'seq']);
                }

                // 3. 附件（独立存储，按需加载）
                if (!db.objectStoreNames.contains('attachments')) {
                    const s = db.createObjectStore('attachments', { keyPath: 'id', autoIncrement: true });
                    s.createIndex('convId', 'convId');
                }

                // 4. 设置（key-value）
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // 5. 快照（自动覆盖式，固定 key='auto'）
                if (!db.objectStoreNames.contains('snapshots')) {
                    db.createObjectStore('snapshots', { keyPath: 'key' });
                }
            };

            req.onsuccess = function (e) {
                _db = e.target.result;
                _db.onerror = (ev) => console.error('[DB error]', ev.target.error);
                resolve(_db);
            };

            req.onerror = function (e) {
                reject(e.target.error || new Error('IndexedDB 打开失败'));
            };

            req.onblocked = function () {
                reject(new Error('IndexedDB 被其他标签页占用，请关闭其他标签页后刷新'));
            };
        });
    }

    /* ---------- 通用：取 store ---------- */
    function _store(name, mode) {
        if (!_db) throw new Error('数据库未初始化');
        const tx = _db.transaction(name, mode || 'readonly');
        return tx.objectStore(name);
    }

    /* ---------- Promise 化的请求 ---------- */
    function _req(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /* ---------- settings：键值对 ---------- */
    async function setSetting(key, value) {
        const s = _store('settings', 'readwrite');
        return _req(s.put({ key: key, value: value, updatedAt: Date.now() }));
    }
    async function getSetting(key, defaultValue) {
        const s = _store('settings', 'readonly');
        const r = await _req(s.get(key));
        return r ? r.value : (defaultValue !== undefined ? defaultValue : null);
    }
    async function delSetting(key) {
        const s = _store('settings', 'readwrite');
        return _req(s.delete(key));
    }

    /* ---------- 整体状态保存（兼容当前代码 S 对象） ---------- */
    /* 把整个 S 对象（profiles + chats + currentChatId + theme 等）存进 settings */
    /* 后续可以拆得更细，但第一阶段先保兼容 */
    async function saveState(state) {
        try {
            await setSetting(SETTINGS_KEY_STATE, state);
            return true;
        } catch (e) {
            console.error('[saveState]', e);
            if (e.name === 'QuotaExceededError') {
                toast('⚠️ 存储空间不足，请清理或导出快照', 'er');
            } else {
                toast('保存失败: ' + e.message, 'er');
            }
            return false;
        }
    }
    async function loadState() {
        try {
            return await getSetting(SETTINGS_KEY_STATE, null);
        } catch (e) {
            console.error('[loadState]', e);
            return null;
        }
    }

    /* ---------- 快照（自动覆盖式，单份） ---------- */
    async function saveAutoSnapshot(state) {
        const s = _store('snapshots', 'readwrite');
        return _req(s.put({
            key: 'auto',
            data: state,
            time: Date.now(),
            version: APP_VERSION,
        }));
    }
    async function loadAutoSnapshot() {
        const s = _store('snapshots', 'readonly');
        return _req(s.get('auto'));
    }
    async function clearAutoSnapshot() {
        const s = _store('snapshots', 'readwrite');
        return _req(s.delete('auto'));
    }

    /* ---------- 清空整个数据库（危险操作） ---------- */
    async function clearAll() {
        const stores = ['conversations', 'messages', 'attachments', 'settings', 'snapshots'];
        for (const name of stores) {
            const s = _store(name, 'readwrite');
            await _req(s.clear());
        }
    }

    /* ---------- 旧 localStorage 数据迁移 ---------- */
    async function migrateFromLocalStorage() {
        try {
            const raw = localStorage.getItem(OLD_LS_KEY);
            if (!raw) return false;

            // 检查是否已经迁移过
            const migrated = await getSetting('_migrated_from_ls', false);
            if (migrated) return false;

            const data = safeJSON(raw, null);
            if (!data) return false;

            // 直接整体存为 state
            await saveState(data);

            // 标记已迁移（保留旧数据 7 天作为安全网）
            await setSetting('_migrated_from_ls', { time: Date.now(), version: APP_VERSION });

            console.log('[Migration] 从 localStorage 迁移成功');
            toast('✅ 旧数据已自动迁移到 IndexedDB');
            return true;
        } catch (e) {
            console.error('[Migration] 失败', e);
            toast('数据迁移异常，请手动检查', 'er');
            return false;
        }
    }

    /* ---------- 申请持久化存储（防 iOS 7 天清理） ---------- */
    async function requestPersistent() {
        try {
            if (navigator.storage && navigator.storage.persist) {
                const isPersisted = await navigator.storage.persisted();
                if (isPersisted) {
                    console.log('[Persist] 已经是持久化存储');
                    return true;
                }
                const granted = await navigator.storage.persist();
                console.log('[Persist] 申请结果:', granted);
                return granted;
            }
        } catch (e) {
            console.warn('[Persist] 不支持或失败', e);
        }
        return false;
    }

    /* ---------- 获取存储用量信息 ---------- */
    async function getStorageInfo() {
        const info = {
            used: 0,
            quota: 0,
            usedText: '未知',
            quotaText: '未知',
            percent: 0,
            persisted: false,
        };
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const est = await navigator.storage.estimate();
                info.used = est.usage || 0;
                info.quota = est.quota || 0;
                info.usedText = fmtSize(info.used);
                info.quotaText = fmtSize(info.quota);
                info.percent = info.quota ? (info.used / info.quota * 100).toFixed(1) : 0;
            }
            if (navigator.storage && navigator.storage.persisted) {
                info.persisted = await navigator.storage.persisted();
            }
        } catch (e) {
            console.warn('[getStorageInfo]', e);
        }
        return info;
    }

    /* ---------- 暴露 API ---------- */
    return {
        init: init,
        // 状态
        saveState: saveState,
        loadState: loadState,
        // 快照
        saveAutoSnapshot: saveAutoSnapshot,
        loadAutoSnapshot: loadAutoSnapshot,
        clearAutoSnapshot: clearAutoSnapshot,
        // 设置 KV
        setSetting: setSetting,
        getSetting: getSetting,
        delSetting: delSetting,
        // 工具
        clearAll: clearAll,
        migrateFromLocalStorage: migrateFromLocalStorage,
        requestPersistent: requestPersistent,
        getStorageInfo: getStorageInfo,
        // 内部（高级用法）
        _store: _store,
        _req: _req,
        get raw() { return _db; },
    };
})();
