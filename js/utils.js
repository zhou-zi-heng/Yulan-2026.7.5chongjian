/* ===== ZenMux 工具函数库 (v2.3.8) ===== */
/* v2.3.8: cntW 精准对齐 WPS/Word "字数" 口径
   = 汉字 + 中文标点 + 英文单词(连续字母算1) + 数字串(连续数字算1)
   清洗 Markdown 格式符号、排除代码块；空格/英文标点/格式符号不计 */

const APP_VERSION = '2.0.0';

/* ---------- 通用工具 ---------- */
function gId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

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

/* ---------- JSON 安全解析 ---------- */
function safeJSON(str, fallback) {
    try { return JSON.parse(str); }
    catch (e) { return fallback !== undefined ? fallback : null; }
}

/* ---------- 时间格式化 ---------- */
function nowTime() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* ---------- 文件大小格式化 ---------- */
function fmtSize(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

/* ---------- 下载文件 ---------- */
function dl(content, filename, mime) {
    const blob = (content instanceof Blob)
        ? content
        : new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Toast 提示 ---------- */
let _toastTimer = null;
function toast(msg, type) {
    const tc = document.getElementById('tc');
    if (!tc) { console.log('[toast]', msg); return; }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'er' ? ' er' : (type === 'ok' ? ' ok' : ''));
    el.textContent = msg;
    tc.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-8px)';
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 2600);
}

/* ---------- 环境检测 ---------- */
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
                  || (window.innerWidth <= 768);
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
               || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SUPPORTS_INDEXEDDB = (function () {
    try { return !!window.indexedDB; } catch (e) { return false; }
})();
