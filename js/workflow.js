/* ===== 飞凡AI - 工作流引擎 (v2.4.0) ===== */
/* 加载预设库（presets.json）、解密隐藏指令、提供工作流发送数据。
   指令提示词对用户隐藏：界面只显示"友好名称：用户输入"，实际发AI=解密提示词+用户输入。 */

const Workflow = (function () {

    /* 工作流加密密钥（必须与 crypto-tool.html 的 WORKFLOW_SECRET 完全一致） */
    const WORKFLOW_SECRET = 'FeiFan-Workflow-2026-Kx7@mP3$qR9#vL2&nW8^bT5*cY1!hG4%zE6';
    const PBKDF2_ITER = 100000;
    const SUPPORTS_CRYPTO = !!(window.crypto && window.crypto.subtle);

    let _data = null;          // 预设库数据
    let _loaded = false;
    let _decCache = {};        // 解密缓存 { 加密串: 明文 }

    /* ---------- base64 工具 ---------- */
    function _b642ab(b64) {
        const s = atob(b64);
        const b = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        return b.buffer;
    }

    async function _deriveKey(salt) {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey('raw', enc.encode(WORKFLOW_SECRET), { name: 'PBKDF2' }, false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
        );
    }

    /* ---------- 解密单条指令提示词 ---------- */
    async function _decryptPrompt(str) {
        if (!str) return '';
        // 明文占位（测试用）
        if (str.indexOf('__PLAIN__') === 0) return str.slice(9);
        // 非加密串，直接当明文
        if (str.indexOf('WFX1:') !== 0) return str;
        // 缓存
        if (_decCache[str]) return _decCache[str];
        if (!SUPPORTS_CRYPTO) throw new Error('浏览器不支持解密');

        const pack = JSON.parse(decodeURIComponent(escape(atob(str.slice(5)))));
        const salt = new Uint8Array(_b642ab(pack.s));
        const iv = new Uint8Array(_b642ab(pack.i));
        const cipher = _b642ab(pack.c);
        const key = await _deriveKey(salt);
        const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, cipher);
        const plain = new TextDecoder().decode(buf);
        _decCache[str] = plain;
        return plain;
    }

    /* ---------- 加载预设库 ---------- */
    async function load(url) {
        try {
            const resp = await fetch((url || 'presets.json') + '?t=' + Date.now()); // 防缓存
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            _data = await resp.json();
            _loaded = true;
            console.log('[Workflow] 预设库已加载：' + (_data.presets ? _data.presets.length : 0) + ' 个预设');
            return true;
        } catch (e) {
            console.warn('[Workflow] 预设库加载失败', e);
            _loaded = false;
            return false;
        }
    }

    function isLoaded() { return _loaded && _data && Array.isArray(_data.presets); }

    /* ---------- 获取分组列表 ---------- */
    function getGroups() {
        if (!isLoaded()) return [];
        return Array.isArray(_data.groups) ? _data.groups.slice() : [];
    }

    /* ---------- 按分组 + 关键词筛选预设 ---------- */
    function getPresets(group, keyword) {
        if (!isLoaded()) return [];
        let list = _data.presets.slice();
        if (group && group !== '__all__') {
            list = list.filter(p => p.group === group);
        }
        if (keyword && keyword.trim()) {
            const kw = keyword.trim().toLowerCase();
            list = list.filter(p => (p.name || '').toLowerCase().indexOf(kw) >= 0);
        }
        return list;
    }

    /* ---------- 取单个预设 ---------- */
    function getPreset(presetId) {
        if (!isLoaded()) return null;
        return _data.presets.find(p => p.id === presetId) || null;
    }

    /* ---------- 取预设下的指令（按 order 排序） ---------- */
    function getCommands(presetId) {
        const p = getPreset(presetId);
        if (!p || !Array.isArray(p.commands)) return [];
        return p.commands.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    /* ---------- 取单条指令 ---------- */
    function getCommand(presetId, cmdId) {
        const cmds = getCommands(presetId);
        return cmds.find(c => c.id === cmdId) || null;
    }

    /* ---------- 构建发送数据 ---------- */
    /* 返回 { displayText（界面显示）, sendText（实际发AI） } */
    async function buildSend(presetId, cmdId, userInput) {
        const cmd = getCommand(presetId, cmdId);
        if (!cmd) throw new Error('指令不存在');

        const prompt = await _decryptPrompt(cmd.hiddenPrompt);
        const input = (userInput || '').trim();

        // 实际发给 AI：解密后的隐藏提示词 + 用户输入
        const sendText = prompt + (input ? ('\n\n' + input) : '');
        // 界面显示：友好名称：用户输入（不含提示词）
        const displayText = cmd.name + (input ? '：' + input : '');

        return { displayText: displayText, sendText: sendText, cmdName: cmd.name };
    }

    return {
        load: load,
        isLoaded: isLoaded,
        getGroups: getGroups,
        getPresets: getPresets,
        getPreset: getPreset,
        getCommands: getCommands,
        getCommand: getCommand,
        buildSend: buildSend,
    };
})();

window.Workflow = Workflow;
