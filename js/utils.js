/* ===== ZenMux 工具函数库 ===== */
/* 全部挂在 window 上，全局可用，与原代码兼容 */

const APP_VERSION = '2.0.0';

/* ---------- 通用工具 ---------- */

// 生成唯一 ID
function gId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// HTML 转义
function esc(t) {
    if (t === null || t === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(t);
    return d.innerHTML;
}

/* ============================================================
   ===== 字数统计（对齐 WPS/Word "字数"，含中文标点） =========
   ============================================================ */

/* 内部：清洗 Markdown，去掉格式符号与代码块，保留正文文字 */
function _cleanForCount(text) {
    let s = String(text || '');

    // 1. 代码块整段移除（```...```），不计入字数
    s = s.replace(/```[\s\S]*?```/g, ' ');
    // 2. 行内代码 `code` 移除（含内容）
    s = s.replace(/`[^`\n]*`/g, ' ');
    // 3. 图片 ![alt](url) 整体移除
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    // 4. 链接 [文字](url) → 仅保留"文字"
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 5. HTML 标签 <...> 移除
    s = s.replace(/<[^>]+>/g, ' ');
    // 6. 表格分隔行（| --- | :--: |）移除
    s = s.replace(/^\s*\|?[\s:\-]*\|[\s:\-|]*\|?\s*$/gm, ' ');
    // 7. 表格框线竖线移除（保留单元格文字）
    s = s.replace(/\|/g, ' ');
    // 8. 行首：标题 # / 引用 > / 列表 - * + / 有序列表 1.
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    s = s.replace(/^\s{0,3}>+\s?/gm, '');
    s = s.replace(/^\s{0,3}([-*+])\s+/gm, '');
    s = s.replace(/^\s{0,3}\d+\.\s+/gm, '');
    // 9. 水平分割线 --- *** ___
    s = s.replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, ' ');
    // 10. 加粗/斜体/删除线标记（保留文字）
    s = s.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, '');

    return s;
}

/* 汉字范围：基本区 + 扩展A + 扩展B（覆盖常用与生僻字） */
function _countHan(s) {
    try {
        return (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu) || []).length;
    } catch (e) {
        return (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    }
}

/* 中文标点（常用全角标点） */
function _countCnPunct(s) {
    // ，。！？；：、（）《》「」『』【】〈〉…—～·"" '' 全角标点
    const re = /[\u3000-\u303f\uff00-\uffef“”‘’]/g;
    return (s.match(re) || []).length;
}

/* 主统计函数：对齐 WPS "字数"（含中文标点） */
function cntW(t) {
    if (!t) return 0;
    const s = _cleanForCount(t);
    const han = _countHan(s);                              // 汉字
    const cnPunct = _countCnPunct(s);                       // 中文标点
    const eng = (s.match(/[a-zA-Z]+/g) || []).length;       // 英文单词
    const num = (s.match(/\d+/g) || []).length;             // 数字串
    return han + cnPunct + eng + num;
}

/* 明细统计（调试 / 后续自动化判断字数达标用） */
function cntDetail(t) {
    const s = _cleanForCount(t || '');
    const han = _countHan(s);
    const cnPunct = _countCnPunct(s);
    const eng = (s.match(/[a-zA-Z]+/g) || []).length;
    const num = (s.match(/\d+/g) || []).length;
    return {
        total: han + cnPunct + eng + num,  // 对齐 WPS 字数
        chinese: han + cnPunct,            // 中文字符（含标点）≈ WPS"中文字符"
        han: han,                          // 纯汉字
        cnPunct: cnPunct,                  // 中文标点
        words: eng,                        // 英文单词
        digits: num,                       // 数字串
        nonChinese: eng + num,             // 非中文单词 ≈ WPS"非中文单词"
    };
}

// 当前时间 HH:MM
function nowTime() {
    const d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}

// 文件大小格式化
function fmtSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i ? 1 : 0) + ' ' + u[i];
}

/* ---------- Toast 提示 ---------- */
function toast(msg, type) {
    if (!type) type = 'ok';
    const c = document.getElementById('tc');
    if (!c) { console.log('[toast]', msg); return; }
    const t = document.createElement('div');
    t.className = 'tt ' + type;
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}

/* ---------- 文件下载 ---------- */
function dl(content, filename, mime) {
    const b = new Blob([content], { type: mime + ';charset=utf-8' });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(u);
}

/* ---------- 防抖与节流 ---------- */
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function throttle(fn, interval) {
    let last = 0, timer;
    return function (...args) {
        const now = Date.now();
        const remain = interval - (now - last);
        if (remain <= 0) {
            clearTimeout(timer);
            last = now;
            fn.apply(this, args);
        } else if (!timer) {
            timer = setTimeout(() => {
                last = Date.now();
                timer = null;
                fn.apply(this, args);
            }, remain);
        }
    };
}

/* ---------- requestAnimationFrame 节流（用于流式渲染） ---------- */
function rafThrottle(fn) {
    let scheduled = false, lastArgs;
    return function (...args) {
        lastArgs = args;
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            fn.apply(this, lastArgs);
        });
    };
}

/* ---------- 设备/环境检测 ---------- */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const IS_MOBILE = window.innerWidth <= 768 || /Mobi|Android/i.test(navigator.userAgent);
const SUPPORTS_INDEXEDDB = 'indexedDB' in window;

/* ---------- 简单的 Promise sleep ---------- */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/* ---------- 安全 JSON 解析 ---------- */
function safeJSON(str, fallback) {
    if (fallback === undefined) fallback = null;
    try { return JSON.parse(str); }
    catch (e) { return fallback; }
}
