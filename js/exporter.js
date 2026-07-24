/* ===== 飞凡AI - 导出引擎 (批次2a) ===== */
/* 勾选式导出：txt / markdown / html / docx(真) / pdf
   docx: 用 docx.js 生成真Word（带格式）
   pdf : 用 html2pdf 把HTML渲染成PDF */

const Exporter = (function () {

    /* ---------- 按需加载 docx.js ---------- */
    let _docxLoading = null;
    function loadDocx() {
        if (window.docx) return Promise.resolve();
        if (_docxLoading) return _docxLoading;
        _docxLoading = new Promise((resolve, reject) => {
            const urls = [
                'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js',
                'https://unpkg.com/docx@8.5.0/build/index.umd.min.js',
            ];
            let idx = 0;
            const tryLoad = () => {
                if (idx >= urls.length) { reject(new Error('docx.js 所有CDN加载失败')); return; }
                const s = document.createElement('script');
                s.src = urls[idx++];
                s.onload = () => window.docx ? resolve() : tryLoad();
                s.onerror = () => tryLoad();
                document.head.appendChild(s);
            };
            tryLoad();
        });
        return _docxLoading;
    }


    /* ---------- 按需加载 html2pdf ---------- */
    let _pdfLoading = null;
    function loadPdf() {
        if (window.html2pdf) return Promise.resolve();
        if (_pdfLoading) return _pdfLoading;
        _pdfLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
            s.onload = () => window.html2pdf ? resolve() : reject(new Error('html2pdf 加载后未注入'));
            s.onerror = () => reject(new Error('html2pdf CDN 加载失败'));
            document.head.appendChild(s);
        });
        return _pdfLoading;
    }

    /* ========== 简易 Markdown 解析（供 docx 用，逐行处理） ========== */
    /* 返回结构化 tokens，docx 生成器再翻译成 Word 对象 */
    function parseMarkdownToBlocks(md) {
        const lines = String(md || '').split('\n');
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            let line = lines[i];

            // 代码块 ```
            if (/^```/.test(line.trim())) {
                const codeLines = [];
                i++;
                while (i < lines.length && !/^```/.test(lines[i].trim())) {
                    codeLines.push(lines[i]);
                    i++;
                }
                i++; // 跳过结尾 ```
                blocks.push({ type: 'code', text: codeLines.join('\n') });
                continue;
            }

            // 表格（连续以 | 开头的行）
            if (/^\s*\|.*\|\s*$/.test(line)) {
                const tableLines = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
                    tableLines.push(lines[i]);
                    i++;
                }
                blocks.push({ type: 'table', rows: parseTableLines(tableLines) });
                continue;
            }

            // 图片 ![alt](dataUrl)
            const imgM = line.match(/^!\[[^\]]*\]\((data:image\/[^)]+)\)/);
            if (imgM) {
                blocks.push({ type: 'image', src: imgM[1] });
                i++;
                continue;
            }

            // 标题
            const hM = line.match(/^(#{1,6})\s+(.*)$/);
            if (hM) {
                blocks.push({ type: 'heading', level: hM[1].length, text: hM[2] });
                i++;
                continue;
            }

            // 引用
            if (/^>\s?/.test(line)) {
                blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') });
                i++;
                continue;
            }

            // 无序列表
            const ulM = line.match(/^\s*[-*+]\s+(.*)$/);
            if (ulM) {
                blocks.push({ type: 'listItem', ordered: false, text: ulM[1] });
                i++;
                continue;
            }

            // 有序列表
            const olM = line.match(/^\s*\d+\.\s+(.*)$/);
            if (olM) {
                blocks.push({ type: 'listItem', ordered: true, text: olM[1] });
                i++;
                continue;
            }

            // 空行
            if (line.trim() === '') {
                blocks.push({ type: 'empty' });
                i++;
                continue;
            }

            // 普通段落
            blocks.push({ type: 'paragraph', text: line });
            i++;
        }
        return blocks;
    }

    function parseTableLines(lines) {
        const rows = [];
        lines.forEach((ln, idx) => {
            // 跳过分隔行 |---|---|
            if (/^\s*\|[\s:\-|]+\|\s*$/.test(ln)) return;
            const cells = ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
            rows.push(cells);
        });
        return rows;
    }

    /* ---------- 解析行内格式（加粗/斜体/行内代码）→ docx TextRun 数组 ---------- */
    function parseInlineRuns(text, docxLib) {
        const runs = [];
        let remaining = String(text || '');
        // 匹配 **加粗** / *斜体* / `代码`
        const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/;
        let m;
        while ((m = re.exec(remaining)) !== null) {
            const before = remaining.slice(0, m.index);
            if (before) runs.push(new docxLib.TextRun({ text: before, font: 'Microsoft YaHei', size: 24 }));

            if (m[2] !== undefined) {
                runs.push(new docxLib.TextRun({ text: m[2], bold: true, font: 'Microsoft YaHei', size: 24 }));
            } else if (m[4] !== undefined) {
                runs.push(new docxLib.TextRun({ text: m[4], italics: true, font: 'Microsoft YaHei', size: 24 }));
            } else if (m[6] !== undefined) {
                runs.push(new docxLib.TextRun({ text: m[6], font: 'Consolas', size: 22, shading: { fill: 'F0F0F0' } }));
            }
            remaining = remaining.slice(m.index + m[0].length);
        }
        if (remaining) runs.push(new docxLib.TextRun({ text: remaining, font: 'Microsoft YaHei', size: 24 }));
        if (!runs.length) runs.push(new docxLib.TextRun({ text: '', font: 'Microsoft YaHei', size: 24 }));
        return runs;
    }

    /* dataURL → docx 需要的 Uint8Array */
    function dataUrlToUint8(dataUrl) {
        const m = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/);
        if (!m) return null;
        const bin = atob(m[1]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    /* ========== 生成真 docx ========== */
    async function exportDocx(sections, title) {
        await loadDocx();
        const d = window.docx;
        const children = [];

        // 文档大标题
        children.push(new d.Paragraph({
            children: [new d.TextRun({ text: title || '对话记录', bold: true, size: 36, font: 'Microsoft YaHei' })],
            spacing: { after: 200 },
        }));

        sections.forEach(sec => {
            // 角色标签（👤我 / 🤖AI）
            if (sec.roleLabel) {
                children.push(new d.Paragraph({
                    children: [new d.TextRun({ text: sec.roleLabel, bold: true, size: 26, font: 'Microsoft YaHei', color: '667EEA' })],
                    spacing: { before: 200, after: 80 },
                }));
            }

            const blocks = parseMarkdownToBlocks(sec.content);
            blocks.forEach(b => {
                if (b.type === 'heading') {
                    children.push(new d.Paragraph({
                        children: parseInlineRuns(b.text, d),
                        heading: b.level <= 1 ? d.HeadingLevel.HEADING_1 : b.level === 2 ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3,
                        spacing: { before: 120, after: 60 },
                    }));
                } else if (b.type === 'paragraph') {
                    children.push(new d.Paragraph({ children: parseInlineRuns(b.text, d), spacing: { after: 80 } }));
                } else if (b.type === 'listItem') {
                    children.push(new d.Paragraph({
                        children: parseInlineRuns(b.text, d),
                        bullet: b.ordered ? undefined : { level: 0 },
                        numbering: undefined,
                        spacing: { after: 40 },
                        indent: { left: 360 },
                    }));
                } else if (b.type === 'quote') {
                    children.push(new d.Paragraph({
                        children: [new d.TextRun({ text: b.text, italics: true, color: '666666', font: 'Microsoft YaHei', size: 24 })],
                        indent: { left: 360 },
                        spacing: { after: 80 },
                    }));
                } else if (b.type === 'code') {
                    b.text.split('\n').forEach(cl => {
                        children.push(new d.Paragraph({
                            children: [new d.TextRun({ text: cl || ' ', font: 'Consolas', size: 20 })],
                            shading: { fill: 'F6F8FA' },
                            spacing: { after: 0 },
                        }));
                    });
                    children.push(new d.Paragraph({ text: '', spacing: { after: 80 } }));
                } else if (b.type === 'table') {
                    if (b.rows.length) {
                        const tableRows = b.rows.map((row, ri) => new d.TableRow({
                            children: row.map(cell => new d.TableCell({
                                children: [new d.Paragraph({
                                    children: [new d.TextRun({ text: cell, bold: ri === 0, font: 'Microsoft YaHei', size: 22 })],
                                })],
                                shading: ri === 0 ? { fill: 'EEF0FF' } : undefined,
                            })),
                        }));
                        children.push(new d.Table({
                            rows: tableRows,
                            width: { size: 100, type: d.WidthType.PERCENTAGE },
                        }));
                        children.push(new d.Paragraph({ text: '', spacing: { after: 80 } }));
                    }
                } else if (b.type === 'image') {
                    const bytes = dataUrlToUint8(b.src);
                    if (bytes) {
                        try {
                            children.push(new d.Paragraph({
                                children: [new d.ImageRun({ data: bytes, transformation: { width: 400, height: 300 } })],
                                spacing: { after: 80 },
                            }));
                        } catch (e) {
                            children.push(new d.Paragraph({ text: '[图片]' }));
                        }
                    }
                } else if (b.type === 'empty') {
                    // 空行忽略（段落间已有 spacing）
                }
            });
        });

        const doc = new d.Document({
            sections: [{
                properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
                children: children,
            }],
        });

        const blob = await d.Packer.toBlob(doc);
        _downloadBlob(blob, (title || 'chat') + '-' + _ts() + '.docx');
    }

    /* ========== 生成 PDF（html2pdf 拍照HTML） ========== */
    async function exportPdf(html, title) {
        await loadPdf();
        const wrap = document.createElement('div');
        wrap.style.cssText = 'padding:24px;max-width:800px;font-family:Microsoft YaHei,sans-serif;line-height:1.7;color:#222;background:#fff';
        wrap.innerHTML = '<h1 style="font-size:22px">' + _esc(title) + '</h1>' + html;
        document.body.appendChild(wrap);
        try {
            await window.html2pdf().set({
                margin: 10,
                filename: (title || 'chat') + '-' + _ts() + '.pdf',
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            }).from(wrap).save();
        } finally {
            document.body.removeChild(wrap);
        }
    }

    /* ---------- 工具 ---------- */
    function _ts() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); }
    function _esc(t) { const d = document.createElement('div'); d.textContent = String(t == null ? '' : t); return d.innerHTML; }
    function _downloadBlob(blob, filename) {
        const u = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = u; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(u);
    }

    return {
        exportDocx: exportDocx,
        exportPdf: exportPdf,
        parseMarkdownToBlocks: parseMarkdownToBlocks,
    };
})();

window.Exporter = Exporter;
