/* ===== 飞凡AI - 局域网自动存档引擎 (v2.3.5) ===== */
/* File System Access API：用户选定共享目录后，每小时自动把"有更新的对话"
   以 [标题__用户名__ID短码].html + .feifan-share.json 双份写入，同名覆盖=排重=永远最新版。
   仅 Chrome/Edge + https 环境可用；不支持则静默禁用。 */

const Archive = (function () {

    const SUPPORTS_FSA = ('showDirectoryPicker' in window);

    let _dirHandle = null;       // 当前存档目录句柄
    let _hourlyTimer = null;     // 每小时定时器
    let _getStateFn = null;      // 获取全局状态 S 的函数
    let _buildHtmlFn = null;     // 生成 HTML 的函数（复用 app 的导出逻辑）
    let _archiveTimes = {};      // { chatId: lastArchivedUpdatedAt } 记录每个对话上次存档时的 updatedAt
    let _permissionOK = false;   // 本次会话是否已通过写权限确认

    /* ---------- 是否已配置存档目录 ---------- */
    function isEnabled() {
        return SUPPORTS_FSA && !!_dirHandle;
    }
    function isSupported() {
        return SUPPORTS_FSA;
    }

    /* ---------- 文件名安全化 ---------- */
    function _safe(str) {
        return String(str || '')
            .replace(/[\\/:*?"<>|]/g, '_')   // 非法字符
            .replace(/\s+/g, ' ')             // 多空格合并
            .replace(/__+/g, '_')             // 避免和分隔符混淆
            .trim()
            .slice(0, 60);                    // 限长
    }

    /* ---------- 生成文件基名： [标题]__[用户名]__[ID短码] ---------- */
    function _baseName(chat, userName) {
        const title = _safe(chat.title || '新对话') || '新对话';
        const user = _safe(userName || '未署名') || '未署名';
        const idShort = (chat.id || '').replace(/[^\w]/g, '').slice(-4) || '0000';
        return title + '__' + user + '__' + idShort;
    }

    /* ==========================================================
       ===== 权限相关 ===========================================
       ========================================================== */
    async function _verifyPermission(handle, readWrite) {
        if (!handle) return false;
        const opts = {};
        if (readWrite) opts.mode = 'readwrite';
        try {
            // 已有权限？
            if ((await handle.queryPermission(opts)) === 'granted') return true;
            // 请求权限（会弹"允许"）
            if ((await handle.requestPermission(opts)) === 'granted') return true;
        } catch (e) {
            console.warn('[Archive] 权限检查失败', e);
        }
        return false;
    }

    /* ==========================================================
       ===== 选择 / 恢复 存档目录 ================================
       ========================================================== */

    /* 用户主动选择目录 */
    async function chooseDir() {
        if (!SUPPORTS_FSA) {
            toast('当前浏览器不支持自动存档（需 Chrome/Edge）', 'er');
            return false;
        }
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            const ok = await _verifyPermission(handle, true);
            if (!ok) {
                toast('未授予写入权限', 'er');
                return false;
            }
            _dirHandle = handle;
            _permissionOK = true;
            await DB.saveDirHandle(handle);
            toast('✅ 存档目录已设置：' + (handle.name || '已选定'));
            return true;
        } catch (e) {
            if (e.name === 'AbortError') {
                // 用户取消，不报错
                return false;
            }
            console.error('[Archive] chooseDir', e);
            toast('选择目录失败：' + e.message, 'er');
            return false;
        }
    }

    /* 从 IndexedDB 恢复上次的目录句柄（不主动请求权限，等首次写入时再确认） */
    async function restoreDir() {
        if (!SUPPORTS_FSA) return false;
        try {
            const handle = await DB.loadDirHandle();
            if (handle) {
                _dirHandle = handle;
                _permissionOK = false; // 重开页面后需重新确认一次写权限
                console.log('[Archive] 已恢复存档目录句柄:', handle.name);
                return true;
            }
        } catch (e) {
            console.warn('[Archive] restoreDir 失败', e);
        }
        return false;
    }

    /* 取消存档（清除目录） */
    async function clearDir() {
        _dirHandle = null;
        _permissionOK = false;
        await DB.clearDirHandle();
        toast('已关闭自动存档');
    }

    /* 当前目录名（用于 UI 显示） */
    function getDirName() {
        return _dirHandle ? (_dirHandle.name || '已设置') : '';
    }

    /* ==========================================================
       ===== 写文件 =============================================
       ========================================================== */
    async function _writeFile(fileName, content) {
        const fh = await _dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fh.createWritable();
        await writable.write(content);
        await writable.close();
    }

    /* ==========================================================
       ===== 存档核心 ===========================================
       ========================================================== */

    /* 存单个对话（HTML + JSON 双份） */
    async function _archiveOne(chat, userName) {
        const base = _baseName(chat, userName);

        // 1. HTML（复用 app 提供的生成函数）
        let html = '';
        try {
            html = _buildHtmlFn ? _buildHtmlFn(chat) : '';
        } catch (e) {
            console.warn('[Archive] 生成 HTML 失败', e);
        }
        if (html) {
            await _writeFile(base + '.html', html);
        }

        // 2. JSON（可续聊，复用 Snapshot 的 payload 构建；存档不加密，方便检索/二次导入）
        try {
            const payload = Snapshot._buildSharePayload(chat, {
                includeKB: true,
                sharedBy: userName || '',
            });
            const json = JSON.stringify(payload, null, 2);
            await _writeFile(base + '.feifan-share.json', json);
        } catch (e) {
            console.warn('[Archive] 生成 JSON 失败', e);
        }
    }

    /* 遍历所有对话，存"有更新的" */
    async function archiveAll(opts) {
        opts = opts || {};
        if (!isEnabled()) return { done: 0, skipped: 0, reason: 'disabled' };

        const S = _getStateFn ? _getStateFn() : null;
        if (!S || !S.chats) return { done: 0, skipped: 0, reason: 'no-state' };

        // 首次写入需确认权限
        if (!_permissionOK) {
            const ok = await _verifyPermission(_dirHandle, true);
            if (!ok) {
                if (!opts.silent) toast('存档需要写入权限，请点击"允许"', 'er');
                return { done: 0, skipped: 0, reason: 'no-permission' };
            }
            _permissionOK = true;
        }

        const userName = S.userName || '';
        let done = 0, skipped = 0, failed = 0;

        for (const cid in S.chats) {
            const chat = S.chats[cid];
            if (!chat || !chat.messages || !chat.messages.length) { skipped++; continue; }

            // 增量判断：updatedAt 没变 → 跳过
            const last = _archiveTimes[cid];
            if (last && last === chat.updatedAt) { skipped++; continue; }

            try {
                await _archiveOne(chat, userName);
                _archiveTimes[cid] = chat.updatedAt;
                done++;
            } catch (e) {
                console.error('[Archive] 存档失败 ' + cid, e);
                failed++;
                // 权限突然失效 → 标记需重新确认
                if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
                    _permissionOK = false;
                }
            }
        }

        // 持久化存档时间记录
        try { await DB.setSetting('archive_times', _archiveTimes); } catch (e) {}

        if (!opts.silent && (done > 0 || failed > 0)) {
            toast('📁 已存档 ' + done + ' 个对话' + (failed ? '（' + failed + ' 失败）' : ''));
        }
        if (done > 0) console.log('[Archive] 本轮存档 ' + done + '，跳过 ' + skipped + '，失败 ' + failed);

        return { done: done, skipped: skipped, failed: failed };
    }

    /* 手动立即存档（按钮触发） */
    async function archiveNow() {
        if (!isEnabled()) {
            toast('请先设置存档目录', 'er');
            return;
        }
        toast('正在存档...');
        await archiveAll({ silent: false });
    }

    /* ==========================================================
       ===== 定时器 + 生命周期 ==================================
       ========================================================== */
    function startHourly() {
        stopHourly();
        if (!isEnabled()) return;
        // 从打开页面算起，每小时一次
        _hourlyTimer = setInterval(() => {
            archiveAll({ silent: true });
        }, 60 * 60 * 1000);
        console.log('[Archive] 每小时自动存档已启动');
    }
    function stopHourly() {
        if (_hourlyTimer) { clearInterval(_hourlyTimer); _hourlyTimer = null; }
    }

    /* 关闭/切走页面时存一次（防丢最新内容）。
       注意：beforeunload 里无法 await 异步写文件，浏览器会中断；
       因此用 visibilitychange=hidden 时机做"尽力而为"的存档。 */
    function _bindLifecycle() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && isEnabled()) {
                // 页面切到后台 → 尝试存档（此时还能执行异步）
                archiveAll({ silent: true });
            }
        });
    }

    /* ==========================================================
       ===== 初始化 =============================================
       ========================================================== */
    async function init(config) {
        config = config || {};
        _getStateFn = config.getState;
        _buildHtmlFn = config.buildHtml;

        if (!SUPPORTS_FSA) {
            console.log('[Archive] 浏览器不支持 File System Access，自动存档禁用');
            return;
        }

        // 恢复存档时间记录
        try {
            const t = await DB.getSetting('archive_times', null);
            if (t && typeof t === 'object') _archiveTimes = t;
        } catch (e) {}

        // 恢复目录句柄
        await restoreDir();

        if (isEnabled()) {
            startHourly();
            console.log('[Archive] 已就绪（目录：' + getDirName() + '）');
        } else {
            console.log('[Archive] 未设置存档目录，待用户配置');
        }

        _bindLifecycle();
    }

    /* ---------- 暴露 API ---------- */
    return {
        init: init,
        isSupported: isSupported,
        isEnabled: isEnabled,
        chooseDir: chooseDir,
        clearDir: clearDir,
        getDirName: getDirName,
        archiveNow: archiveNow,
        archiveAll: archiveAll,
        startHourly: startHourly,
        stopHourly: stopHourly,
    };
})();

window.Archive = Archive;
