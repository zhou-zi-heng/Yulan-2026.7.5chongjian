/* ===== 飞凡AI - 物理分块打标引擎 (v2.0) ===== */
/* 纯物理切块：先净化（去无意义空格/特殊字符）→ 每字符算1 → 严格按字数切。
   标记不计入正文字数。零AI参与，绝对可复现。 */

const Chunker = (function () {

    let DEFAULT_SIZE = 300;   // ★ 默认每块字数（批次3将由超管全局参数覆盖）

    /* 允许外部（批次3超管参数）设置块大小 */
    function setBlockSize(n) {
        n = parseInt(n, 10);
        if (n && n >= 50 && n <= 5000) DEFAULT_SIZE = n;
    }
    function getBlockSize() { return DEFAULT_SIZE; }

    /* ---------- 字符工具 ---------- */
    function _chars(s) { return [...String(s || '')]; }

    // 判断是否 CJK（中日韩，含全角标点）
    function _isCJK(ch) {
        const c = ch.codePointAt(0);
        return (c >= 0x4E00 && c <= 0x9FFF) ||
               (c >= 0x3400 && c <= 0x4DBF) ||
               (c >= 0x3040 && c <= 0x30FF) ||
               (c >= 0xAC00 && c <= 0xD7A3) ||
               (c >= 0x3000 && c <= 0x303F) ||
               (c >= 0xFF00 && c <= 0xFFEF);
    }
    // 判断是否"英文/数字类"字符（西文字母、数字、常见西文符号）
    function _isLatinWordChar(ch) {
        return /[A-Za-z0-9]/.test(ch);
    }

    /* ========== 净化：去无意义空格 + 清特殊字符 ========== */
    /* 规则：
       1. 清除零宽字符、BOM、异常控制字符
       2. 删除"CJK字符之间"的空格（你 見 過 → 你見過）
       3. 保留"英文单词之间"的空格（hello world 不变）
       4. 连续空白压缩、连续空行最多保留1个
    */
    function clean(text) {
        let s = String(text || '');

        // 1. 清零宽字符、BOM、方向控制符等
        s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060\u180E]/g, '');
        // 清除其他不可见控制字符（保留 \n \t）
        s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
        // 全角空格转普通空格，便于统一处理
        s = s.replace(/\u3000/g, ' ');

        // 2+3. 逐字符处理：删CJK间空格，保英文间空格
        const arr = _chars(s);
        const out = [];
        for (let i = 0; i < arr.length; i++) {
            const ch = arr[i];
            if (ch === ' ' || ch === '\t') {
                // 找这个空格前后第一个非空白字符
                let prev = '';
                for (let j = out.length - 1; j >= 0; j--) {
                    if (out[j] !== ' ' && out[j] !== '\t') { prev = out[j]; break; }
                    if (out[j] === '\n') { prev = '\n'; break; }
                }
                let next = '';
                for (let k = i + 1; k < arr.length; k++) {
                    if (arr[k] !== ' ' && arr[k] !== '\t') { next = arr[k]; break; }
                    if (arr[k] === '\n') { next = '\n'; break; }
                }
                // 若空格两侧都不是"英文单词字符"，则删除这个空格
                // （即：只有当空格连接两个英文/数字时才保留）
                const keep = _isLatinWordChar(prev) && _isLatinWordChar(next);
                if (keep) out.push(' ');
                // 否则丢弃该空格
            } else {
                out.push(ch);
            }
        }
        s = out.join('');

        // 4. 连续空行压缩（最多保留一个空行）
        s = s.replace(/\n[ \t]*\n[ \t\n]*/g, '\n\n');
        // 行首行尾多余空白
        s = s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
        // 首尾整体裁剪
        s = s.trim();

        return s;
    }

    /* ========== 核心：分块（先净化，再严格按 size 切，每字符算1） ========== */
    function chunk(text, opts) {
        opts = opts || {};
        const size = opts.size || DEFAULT_SIZE;
        const doClean = opts.clean !== false;   // 默认净化，可传 {clean:false} 关闭

        const cleaned = doClean ? clean(text) : String(text || '');
        const chars = _chars(cleaned);
        const total = chars.length;   // ★ 净化后每字符算1，标记不在内

        if (!total) return { total: 0, size: size, blocks: [], marked: '', cleaned: cleaned };

        const blocks = [];
        let idx = 1, pos = 0;
        while (pos < total) {
            const end = Math.min(pos + size, total);
            const body = chars.slice(pos, end).join('');
            const startCharNo = pos + 1;
            const endCharNo = end;
            const pctStart = +((pos / total) * 100).toFixed(1);
            const pctEnd = +((end / total) * 100).toFixed(1);
            blocks.push({
                no: idx++,
                startChar: startCharNo,
                endChar: endCharNo,
                chars: end - pos,
                pctStart: pctStart,
                pctEnd: pctEnd,
                text: body,
            });
            pos = end;
        }

        return {
            total: total,
            size: size,
            blocks: blocks,
            marked: _render(blocks, total),
            cleaned: cleaned,
        };
    }

    /* ---------- 渲染标记文本（中性话术，标记不计入正文字数） ---------- */
    function _render(blocks, total) {
        const avg = blocks.length ? Math.round(total / blocks.length) : 0;
        let out = '=== 文档分块标注（供定位参考）===\n' +
            '本文档已净化后共 ' + total + ' 字符（每字符算1，不含标记），按每约 ' + avg +
            ' 字符切为 ' + blocks.length + ' 块，每块标注了字符区间与占全文百分比。\n' +
            '以下每段用「▌块N｜全文a%-b%」作为分隔，标示其在全文中的位置。\n\n';
        blocks.forEach(b => {
            out += '▌块' + b.no + '｜全文' + b.pctStart + '%-' + b.pctEnd +
                '%（第' + b.startChar + '-' + b.endChar + '字）\n' + b.text + '\n\n';
        });
        return out;
    }

    /* ---------- 打标一组附件（发给AI用） ---------- */
    function chunkAttachments(atts, opts) {
        return atts.map(a => {
            if (!a.text || a.type === 'image') return a;
            const r = chunk(a.text, opts);
            return Object.assign({}, a, {
                text: r.marked,
                _chunked: true,
                _chunkInfo: { total: r.total, blocks: r.blocks.length }
            });
        });
    }

    /* ---------- 预览单个附件对象 ---------- */
    function previewOne(att) {
        if (!att || !att.text || att.type === 'image') {
            return '[该附件为图片或无文本，不参与打标]';
        }
        const r = chunk(att.text, {});
        const info = '【文件：' + (att.fileName || att.name || '未命名') +
            '｜净化后总字符：' + r.total + '｜分 ' + r.blocks.length + ' 块】\n\n';
        return info + r.marked;
    }

    return {
        chunk: chunk,
        clean: clean,
        chunkAttachments: chunkAttachments,
        previewOne: previewOne,
        setBlockSize: setBlockSize,
        getBlockSize: getBlockSize,
        DEFAULT_SIZE: DEFAULT_SIZE,
    };
})();

window.Chunker = Chunker;
