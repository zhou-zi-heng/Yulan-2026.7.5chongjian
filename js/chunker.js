/* ===== 飞凡AI - 物理分块打标引擎 (v1.2) ===== */
/* 纯物理切块，严格按字数切，每块附精确坐标。中性话术，不触发保密系统。零AI参与。 */

const Chunker = (function () {

    const DEFAULT_SIZE = 300;       // ★ 默认每块字数（改这里调）
    const EN_FACTOR = 1.6;         // ★ 英文折算系数（仅 weighted 模式生效）

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

    function _autoMode(text) {
        const t = String(text || '');
        const cjk = (t.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
        const en = (t.match(/[A-Za-z]/g) || []).length;
        return (en > cjk * 0.3) ? 'weighted' : 'char';
    }

    /* ========== 核心：分块（严格按 size） ========== */
    function chunk(text, opts) {
        opts = opts || {};
        const size = opts.size || DEFAULT_SIZE;
        const mode = opts.mode || 'auto';    // ★ 默认计数模式，可改 'char' / 'weighted'
        const chars = _chars(text);
        const total = chars.length;
        if (!total) return { total: 0, size: size, blocks: [], marked: '' };

        const actualMode = (mode === 'auto') ? _autoMode(text) : mode;
        const totalW = (actualMode === 'weighted') ? _weightedLen(text) : total;

        const blocks = [];
        let idx = 1, pos = 0;
        while (pos < total) {
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
        };
    }

    function _cumW(blocks, mode, totalW) {
        if (mode === 'weighted') return blocks.reduce((s, b) => s + _weightedLen(b.text), 0);
        return blocks.reduce((s, b) => s + b.chars, 0);
    }

    /* ---------- 渲染标记文本（中性话术，无目录、无指令感） ---------- */
    function _render(blocks, total, mode) {
        const modeLabel = mode === 'weighted' ? '中英加权' : '纯字符';
        const avg = blocks.length ? Math.round(total / blocks.length) : 0;
        let out = '=== 文档分块标注（供定位参考）===\n' +
            '本文档共 ' + total + ' 字符（' + modeLabel + '），已按每约 ' + avg +
            ' 字符切为 ' + blocks.length + ' 块，每块标注了字符区间与占全文百分比。\n' +
            '以下用 ▌块N (a%-b%｜第x-y字) 作为分隔。\n\n';
        blocks.forEach(b => {
            out += '▌块' + b.no + '｜全文' + b.pctStart + '%-' + b.pctEnd +
                '%（第' + b.startChar + '-' + b.endChar + '字）\n' + b.text + '\n\n';
        });

        return out;
    }

    /* ---------- 打标一组附件（发给AI用，无目录） ---------- */
    function chunkAttachments(atts, opts) {
        return atts.map(a => {
            if (!a.text || a.type === 'image') return a;
            const r = chunk(a.text, opts);
            return Object.assign({}, a, {
                text: r.marked,     // ★ 只发 marked，无目录
                _chunked: true,
                _chunkInfo: { total: r.total, blocks: r.blocks.length, mode: r.mode }
            });
        });
    }

    /* ---------- 预览单个附件（无目录） ---------- */
    function previewOne(att) {
        if (!att || !att.text || att.type === 'image') {
            return '[该附件为图片或无文本，不参与打标]';
        }
        const r = chunk(att.text, {});
        const info = '【文件：' + att.fileName + '｜总字符：' + r.total +
            '｜分 ' + r.blocks.length + ' 块｜模式：' + r.mode + '】\n\n';
        return info + r.marked;
    }

    return {
        chunk: chunk,
        chunkAttachments: chunkAttachments,
        previewOne: previewOne,
        weightedLen: _weightedLen,
        DEFAULT_SIZE: DEFAULT_SIZE,
    };
})();

window.Chunker = Chunker;
