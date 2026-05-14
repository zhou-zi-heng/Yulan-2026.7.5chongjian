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

// 字数统计（中英文）
function cntW(t) {
    if (!t) return 0;
    return (String(t).match(/[\u4e00-\u9fff]/g) || []).length
         + (String(t).match(/[a-zA-Z]+/g) || []).length;
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
