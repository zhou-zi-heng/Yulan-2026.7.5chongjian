/* ===== 飞凡AI - 物理分块打标引擎 (v1.1) ===== */
/* 纯物理切块，严格按字数切，每块附精确坐标。
   让 AI 用"块号+占比"定位，杜绝语感数数。零AI参与。 */

const Chunker = (function () {

    const DEFAULT_SIZE = 300;       // ★ 默认每块字数（改这里调）
    const EN_FACTOR = 1.6;         // ★ 英文折算系数（仅 weighted 模式生效）

    /* ---------- 字符工具 ---------- */
    function _chars(s) { return [...String(s || '')]; }

    function _isCJK(ch) {
        const c = ch.codePointAt(0);
        return (c >= 0x4E00 && c <= 0x9FFF) ||
               (c >= 0x3400 && c <= 0x4DBF) ||
               (c >= 0x3040 && c <= 0x30FF) ||
               (c >= 0xAC00 && c <= 0xD7A3) ||
               (c >= 0x3000 && c <= 0x303F) ||
               (c >= 0xFF00 && c <= 0xFFEF);
    }

    /* ---------- 加权体量 ---------- */
    function _weightedLen(text) {
        const arr = _chars(text);
        let w = 0, enBuf = 0;
        const flush = () => { if (enBuf > 0) { w += enBuf / EN_FACTOR; enBuf = 0; } };
        for (const ch of arr) {
            if (/\s/.test(ch)) { flush(); continue; }
            if (_isCJK(ch)) { flush(); w += 1; }
            else { enBuf += 1; }
        }
        flush();
        return Math.round(w);
    }

    /* ---------- 自动判断模式 ---------- */
    function _autoMode(text) {
        const t = String(text || '');
        const cjk = (t.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
        const en = (t.match(/[A-Za-z]/g) || []).length;
        return (en > cjk * 0.3) ? 'weighted' : 'char';
    }

    /* ========== 核心：分块（严格按 size，不智能断句） ========== */
    function chunk(text, opts) {
        opts = opts || {};
        const size = opts.size || DEFAULT_SIZE;
        const mode = opts.mode || 'auto';    // ★ 默认计数模式，可改 'char' / 'weighted'
        const chars = _chars(text);
        const total = chars.length;
        if (!total) return { total: 0, size: size, blocks: [], marked: '', toc: '' };

        const actualMode = (mode === 'auto') ? _autoMode(text) : mode;
        const totalW = (actualMode === 'weighted') ? _weightedLen(text) : total;

        const blocks = [];
        let idx = 1, pos = 0;
        while (pos < total) {
            // ★ 严格按 size 切，不做智能断句
            const end = Math.min(pos + size, total);
            const body = chars.slice(pos, end).join('');
            const blockChars = end - pos;
            const startCharNo = pos + 1;
            const endCharNo = end;
            const blockW = (actualMode === 'weighted') ? _weightedLen(body) : blockChars;
            const pctStart = +((_cumW(blocks, actualMode, totalW) / totalW) * 100).toFixed(1);
            const pctEnd = +(((_cumW(blocks, actualMode, totalW) + blockW) / totalW) * 100).toFixed(1);
            blocks.push({
                no: idx++,
                startChar: startCharNo,
                endChar: endCharNo,
                chars: blockChars,
                pctStart: pctStart,
                pctEnd: pctEnd,
                text: body,
            });
            pos = end;
        }

        return {
            total: total,
            totalW: totalW,
            size: size,
            mode: actualMode,
            blocks: blocks,
            marked: _render(blocks, total, actualMode),
            toc: _toc(blocks),
        };
    }

    function _cumW(blocks, mode, totalW) {
        if (mode === 'weighted') {
            return blocks.reduce((s, b) => s + _weightedLen(b.text), 0);
        }
        return blocks.reduce((s, b) => s + b.chars, 0);
    }

    /* ---------- 渲染标记文本 ---------- */
    function _render(blocks, total, mode) {
        const modeLabel = mode === 'weighted' ? '中英加权' : '纯字符';
        const avg = blocks.length ? Math.round(total / blocks.length) : 0;   // ★ 真实平均
        let out = '【本文档已做物理分块打标｜总字符数：' + total + '｜计数模式：' + modeLabel +
            '｜共 ' + blocks.length + ' 块｜平均每块 ' + avg + ' 字符】\n' +
            '【分析时请直接引用"块号"和"占比"定位，严禁自行估算字数或比例】\n\n';
        blocks.forEach(b => {
            out += '━━━【第' + b.no + '块｜第' + b.startChar + '-' + b.endChar + '字符｜' +
                b.pctStart + '%-' + b.pctEnd + '%】━━━\n' + b.text + '\n\n';
        });
        return out;
    }

    /* ---------- 块号目录 ---------- */
    function _toc(blocks) {
        if (!blocks.length) return '';
        let t = '【全文分块坐标目录（共 ' + blocks.length + ' 块 / ' +
            blocks[blocks.length - 1].endChar + ' 字符）】\n';
        blocks.forEach(b => {
            t += '第' + b.no + '块: ' + b.pctStart + '%-' + b.pctEnd +
                '% (第' + b.startChar + '-' + b.endChar + '字符)\n';
        });
        return t + '\n';
    }

    /* ---------- 打标一组附件（给 app 批量调用） ---------- */
    function chunkAttachments(atts, opts) {
        return atts.map(a => {
            if (!a.text || a.type === 'image') return a;
            const r = chunk(a.text, opts);
            return Object.assign({}, a, {
                text: r.toc + r.marked,
                _chunked: true,
                _chunkInfo: { total: r.total, blocks: r.blocks.length, mode: r.mode }
            });
        });
    }

    /* ---------- 仅生成预览（供预览窗用） ---------- */
    function previewOnly(atts) {
        return atts.map(a => {
            if (!a.text || a.type === 'image') return { fileName: a.fileName, type: a.type, text: '[图片，不参与打标]' };
            const r = chunk(a.text, {});
            const info = '【文件：' + a.fileName + '｜总字符：' + r.total + '｜分 ' + r.blocks.length + ' 块｜模式：' + r.mode + '】\n\n';
            return { fileName: a.fileName, type: a.type, text: info + r.toc + r.marked };
        });
    }

    return {
        chunk: chunk,
        chunkAttachments: chunkAttachments,
        previewOnly: previewOnly,
        weightedLen: _weightedLen,
        DEFAULT_SIZE: DEFAULT_SIZE,
    };
})();

window.Chunker = Chunker;
