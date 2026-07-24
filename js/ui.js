/* ===== 飞凡AI - UI 渲染层 (v3.0.0 批次1) ===== */

const UI = (function () {

    /* ---------- Markdown 渲染器 ---------- */
    let _md = null;
    function getMD() {
        if (_md) return _md;
        if (typeof markdownit === 'undefined') return null;
        _md = markdownit({
            html: false,
            linkify: true,
            breaks: true,
            highlight: function (str, lang) {
                if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
                    } catch (e) {}
                }
                return '';
            },
        });
        try {
            if (window.markdownitSub) _md.use(window.markdownitSub);
            if (window.markdownitSup) _md.use(window.markdownitSup);
            if (window.markdownitMark) _md.use(window.markdownitMark);
            if (window.markdownitFootnote) _md.use(window.markdownitFootnote);
            if (window.markdownitTaskLists) _md.use(window.markdownitTaskLists, { enabled: false });
            if (window.markdownitEmoji && window.markdownitEmoji.full) _md.use(window.markdownitEmoji.full);
        } catch (e) {
            console.warn('[MD plugin]', e);
        }
        return _md;
    }

    /* ---------- 渲染 Markdown 文本 → HTML ---------- */
    function renderMarkdown(text) {
        const md = getMD();
        let html;
        if (md) {
            html = md.render(text || '');
        } else {
            html = '<p>' + esc(text) + '</p>';
        }
        if (window.DOMPurify) {
            html = window.DOMPurify.sanitize(html, {
                ADD_TAGS: ['mark', 'sub', 'sup'],
                ADD_ATTR: ['target'],
            });
        }
        return html;
    }

    /* ---------- 渲染数学公式（KaTeX） ---------- */
    function renderMath(container) {
        if (!window.katex) return;
        const blockRegex = /\$\$([\s\S]+?)\$\$/g;
        const inlineRegex = /\$([^\$\n]+?)\$/g;
        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text.includes('$')) return;
                const parent = node.parentNode;
                if (!parent || parent.tagName === 'CODE' || parent.tagName === 'PRE') return;
                let html = esc(text);
                html = html.replace(blockRegex, (_, expr) => {
                    try { return katex.renderToString(expr, { displayMode: true, throwOnError: false }); }
                    catch (e) { return _; }
                });
                html = html.replace(inlineRegex, (_, expr) => {
                    try { return katex.renderToString(expr, { displayMode: false, throwOnError: false }); }
                    catch (e) { return _; }
                });
                if (html !== esc(text)) {
                    const span = document.createElement('span');
                    span.innerHTML = html;
                    parent.replaceChild(span, node);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'CODE' || node.tagName === 'PRE') return;
                const children = Array.from(node.childNodes);
                children.forEach(processNode);
            }
        }
        processNode(container);
    }

    /* ---------- 渲染 Mermaid 图表 ---------- */
    function renderMermaid(container) {
        if (!window.mermaid) return;
        const blocks = container.querySelectorAll('pre code.language-mermaid, pre code.language-mmd');
        blocks.forEach((codeEl, i) => {
            const code = codeEl.textContent;
            const wrap = document.createElement('div');
            wrap.className = 'mermaid-wrap';
            wrap.id = 'mer-' + Date.now() + '-' + i;
            wrap.textContent = code;
            const pre = codeEl.closest('pre');
            if (pre && pre.parentNode) pre.parentNode.replaceChild(wrap, pre);
            try {
                mermaid.run({ nodes: [wrap] }).then(() => {
                    attachMermaidDownload(wrap);
                }).catch(e => {
                    console.warn('[Mermaid]', e);
                });
            } catch (e) {
                console.warn('[Mermaid]', e);
            }
        });
    }

    /* ---------- 给 mermaid 图挂"下载图片"按钮 ---------- */
    function attachMermaidDownload(wrap) {
        if (!wrap || wrap.querySelector('.mermaid-dl-btn')) return;
        const svg = wrap.querySelector('svg');
        if (!svg) return;

        wrap.style.position = 'relative';

        const btn = document.createElement('button');
        btn.className = 'mermaid-dl-btn';
        btn.textContent = '🖼️ 下载图片';
        btn.onclick = (e) => {
            e.stopPropagation();
            downloadSvgAsPng(svg, btn);
        };
        wrap.appendChild(btn);
    }

    /* ---------- SVG → PNG 下载 ---------- */
    function downloadSvgAsPng(svgEl, btnEl) {
        try {
            // 克隆并补全命名空间
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

            // 取尺寸
            let w = svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width
                ? svgEl.viewBox.baseVal.width : svgEl.getBoundingClientRect().width;
            let h = svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.height
                ? svgEl.viewBox.baseVal.height : svgEl.getBoundingClientRect().height;
            w = Math.max(w, 100);
            h = Math.max(h, 100);

            const svgStr = new XMLSerializer().serializeToString(clone);
            const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                const scale = 2; // 2倍清晰度
                const canvas = document.createElement('canvas');
                canvas.width = w * scale;
                canvas.height = h * scale;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);

                canvas.toBlob((blob) => {
                    if (!blob) { if (typeof toast === 'function') toast('导出失败', 'er'); return; }
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = '图表-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                    if (btnEl) {
                        btnEl.textContent = '✓ 已下载';
                        setTimeout(() => { btnEl.textContent = '🖼️ 下载图片'; }, 1500);
                    }
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                if (typeof toast === 'function') toast('图表转换失败', 'er');
            };
            img.src = url;
        } catch (e) {
            if (typeof toast === 'function') toast('下载失败：' + e.message, 'er');
        }
    }


    /* ---------- 包装代码块 ---------- */
    function wrapCodeBlocks(container) {
        const pres = container.querySelectorAll('pre');
        pres.forEach(pre => {
            if (pre.parentNode.classList.contains('code-wrap')) return;
            const code = pre.querySelector('code');
            if (!code) return;
            const langClass = (code.className || '').match(/language-(\w+)/);
            const lang = langClass ? langClass[1] : '';
            const text = code.textContent;
            const long = text.split('\n').length > 15;
            const wrap = document.createElement('div');
            wrap.className = 'code-wrap' + (long ? ' code-collapsed' : '');
            if (lang) {
                const tag = document.createElement('div');
                tag.className = 'code-lang';
                tag.textContent = lang;
                wrap.appendChild(tag);
            }
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-top';
            copyBtn.textContent = '复制';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(text).then(() => {
                    copyBtn.textContent = '✓ 已复制';
                    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
                }).catch(() => toast('复制失败', 'er'));
            };
            wrap.appendChild(copyBtn);
            pre.parentNode.replaceChild(wrap, pre);
            wrap.appendChild(pre);
            if (long) {
                const toggle = document.createElement('div');
                toggle.className = 'code-toggle';
                const btn = document.createElement('button');
                btn.textContent = '展开全部';
                btn.onclick = () => {
                    wrap.classList.toggle('code-collapsed');
                    btn.textContent = wrap.classList.contains('code-collapsed') ? '展开全部' : '收起';
                };
                toggle.appendChild(btn);
                wrap.appendChild(toggle);
            }
            const bottom = document.createElement('div');
            bottom.className = 'code-copy-bottom';
            const btnB = document.createElement('button');
            btnB.textContent = '📋 复制代码';
            btnB.onclick = () => {
                navigator.clipboard.writeText(text).then(() => {
                    btnB.textContent = '✓ 已复制';
                    setTimeout(() => { btnB.textContent = '📋 复制代码'; }, 1500);
                }).catch(() => toast('复制失败', 'er'));
            };
            bottom.appendChild(btnB);
            wrap.appendChild(bottom);
        });
    }
    /* ---------- 包装表格：加"导出Excel"按钮 ---------- */
    function wrapTables(container) {
        const tables = container.querySelectorAll('table');
        tables.forEach((table, idx) => {
            // 已包装过就跳过
            if (table.parentNode.classList.contains('table-wrap')) return;

            const wrap = document.createElement('div');
            wrap.className = 'table-wrap';

            const btn = document.createElement('button');
            btn.className = 'table-export-btn';
            btn.textContent = '📊 导出Excel';
            btn.onclick = (e) => {
                e.stopPropagation();
                exportTableToXlsx(table, btn);
            };

            table.parentNode.replaceChild(wrap, table);
            wrap.appendChild(btn);
            wrap.appendChild(table);
        });
    }

    /* ---------- 把单个 <table> DOM 导出为 xlsx ---------- */
    function exportTableToXlsx(tableEl, btnEl) {
        const doExport = () => {
            try {
                // 读取表格为二维数组
                const rows = [];
                tableEl.querySelectorAll('tr').forEach(tr => {
                    const cells = [];
                    tr.querySelectorAll('th,td').forEach(td => {
                        cells.push((td.textContent || '').trim());
                    });
                    if (cells.length) rows.push(cells);
                });

                if (!rows.length) {
                    if (typeof toast === 'function') toast('表格为空', 'er');
                    return;
                }

                const ws = XLSX.utils.aoa_to_sheet(rows);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
                const fname = '表格-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.xlsx';
                XLSX.writeFile(wb, fname);

                if (btnEl) {
                    const old = btnEl.textContent;
                    btnEl.textContent = '✓ 已导出';
                    setTimeout(() => { btnEl.textContent = old; }, 1500);
                }
            } catch (e) {
                if (typeof toast === 'function') toast('导出失败：' + e.message, 'er');
            }
        };

        // 按需加载 SheetJS，再导出
        if (window.XLSX) {
            doExport();
        } else if (typeof OfficeParser !== 'undefined' && OfficeParser.loadXLSX) {
            if (btnEl) btnEl.textContent = '⏳ 加载中...';
            OfficeParser.loadXLSX().then(doExport).catch(e => {
                if (typeof toast === 'function') toast('加载Excel库失败：' + e.message, 'er');
                if (btnEl) btnEl.textContent = '📊 导出Excel';
            });
        } else {
            if (typeof toast === 'function') toast('Excel库不可用', 'er');
        }
    }


    /* ---------- 完整渲染流程 ---------- */
    function fullRender(bubElement, text) {
        bubElement.classList.remove('streaming');
        bubElement.innerHTML = renderMarkdown(text);
        try {
            renderMath(bubElement);
            wrapCodeBlocks(bubElement);
            wrapTables(bubElement);
            renderMermaid(bubElement);

            bubElement.querySelectorAll('img').forEach(img => {
                img.onclick = () => {
                    const lb = document.getElementById('lightbox');
                    const lbImg = document.getElementById('lbImg');
                    if (lb && lbImg) { lbImg.src = img.src; lb.classList.add('show'); }
                };
            });
        } catch (e) { console.warn('[fullRender]', e); }
    }

    /* ---------- 流式渲染（仅文本） ---------- */
    function streamRender(bubElement, text) {
        if (!bubElement.classList.contains('streaming')) {
            bubElement.classList.add('streaming');
        }
        bubElement.textContent = text;
    }

    /* ---------- 创建消息 DOM ---------- */
    function createMessageNode(msg, options) {
        const opts = options || {};
        const wrap = document.createElement('div');
        wrap.className = 'msg ' + msg.role;
        wrap.dataset.msgId = msg.id || '';

        // ★ 勾选模式：头像旁加勾选框
        if (opts.selectMode) {
            const selBox = document.createElement('div');
            selBox.className = 'msg-sel';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = opts.selectedMsgs && opts.selectedMsgs.includes(msg.id);
            cb.onchange = () => { if (opts.onSelectToggle) opts.onSelectToggle(msg.id, cb.checked); };
            selBox.appendChild(cb);
            wrap.appendChild(selBox);
        }

        const av = document.createElement('div');
        av.className = 'av';
        av.textContent = msg.role === 'user' ? '👤' : '🤖';
        wrap.appendChild(av);

        const m = document.createElement('div');
        m.className = 'm';

        if (msg.attachments && msg.attachments.length) {
            const mf = document.createElement('div');
            mf.className = 'mf';
            msg.attachments.forEach(a => {
                const fb = document.createElement('span');
                fb.className = 'fb';
                fb.textContent = '📎 ' + (a.name || 'file');
                mf.appendChild(fb);
            });
            m.appendChild(mf);
        }

        // 思考过程折叠区（AI消息且有reasoning时）
        if (msg.role === 'assistant' && msg._reasoning) {
            const think = document.createElement('details');
            think.className = 'think-box';
            const summary = document.createElement('summary');
            summary.textContent = '💭 思考过程';
            think.appendChild(summary);
            const tc = document.createElement('div');
            tc.className = 'think-content';
            tc.textContent = msg._reasoning;
            think.appendChild(tc);
            m.appendChild(think);
        }

        const bub = document.createElement('div');
        bub.className = 'bub';
        if (msg.role === 'assistant') {
            if (msg._streaming) { streamRender(bub, msg.content || ''); }
            else { fullRender(bub, msg.content || ''); }
        } else {
            bub.textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        }
        m.appendChild(bub);


        const mm = document.createElement('div');
        mm.className = 'mm';
        if (msg._time) {
            const t = document.createElement('span');
            t.className = 'msg-time';
            t.textContent = msg._time;
            mm.appendChild(t);
        }
        if (msg.role === 'assistant' && msg.content) {
            const wc = cntW(msg.content);
            if (wc > 0) {
                const w = document.createElement('span');
                w.textContent = wc + ' 字';
                mm.appendChild(w);
            }
        }
        const cpBtn = document.createElement('button');
        cpBtn.textContent = '📋 复制';
        cpBtn.onclick = () => {
            navigator.clipboard.writeText(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
                .then(() => toast('已复制')).catch(() => toast('复制失败', 'er'));
        };
        mm.appendChild(cpBtn);
        if (opts.onDelete) {
            const dBtn = document.createElement('button');
            dBtn.textContent = '🗑️ 删除';
            dBtn.onclick = () => { if (confirm('删除这条消息？')) opts.onDelete(msg); };
            mm.appendChild(dBtn);
        }
        if (msg.role === 'assistant' && opts.onRegen) {
            const rBtn = document.createElement('button');
            rBtn.textContent = '🔄 重答';
            rBtn.onclick = () => opts.onRegen(msg);
            mm.appendChild(rBtn);
        }
        m.appendChild(mm);
        wrap.appendChild(m);
        return { wrap: wrap, bub: bub };
    }

    /* ---------- 渲染整个消息列表 ---------- */
    function renderMessages(container, messages, options) {
        container.innerHTML = '';
        if (!messages || !messages.length) {
            container.innerHTML = '<div class="empty"><div class="ico">🚀</div><p>开始新的对话吧</p>'
                + '<p style="font-size:12px;opacity:.6;margin-top:4px">支持拖拽 / 粘贴上传文档与图片</p></div>';
            return null;
        }
        let lastBub = null;
        messages.forEach(m => {
            const node = createMessageNode(m, options);
            container.appendChild(node.wrap);
            lastBub = node.bub;
        });
        container.scrollTop = container.scrollHeight;
        return lastBub;
    }

    /* ---------- 滚动到底部（节流） ---------- */
    const scrollToBottom = rafThrottle(function (container) {
        container.scrollTop = container.scrollHeight;
    });

    /* ---------- 流式更新（节流50ms + 智能跟随） ---------- */
    function makeStreamUpdater(bub, container) {
        let lastUpdate = 0;
        let pending = '';
        let timer = null;
        const INTERVAL = 50;
        const NEAR_BOTTOM = 80;   // ★ 距底部80px内算"贴近底部"
        function isNearBottom() {
            if (!container) return true;
            return (container.scrollHeight - container.scrollTop - container.clientHeight) < NEAR_BOTTOM;
        }
        function flush() {
            if (!pending) return;
            const stick = isNearBottom();          // ★ 渲染前先看用户在不在底部
            streamRender(bub, pending);
            if (stick) scrollToBottom(container);  // ★ 只有原本贴底才跟随
            lastUpdate = Date.now();
            timer = null;
        }
        return function update(fullText) {
            pending = fullText;
            const now = Date.now();
            const elapsed = now - lastUpdate;
            if (elapsed >= INTERVAL) { flush(); }
            else if (!timer) { timer = setTimeout(flush, INTERVAL - elapsed); }
        };
    }

    /* ---------- 暴露 ---------- */
    return {
        renderMarkdown: renderMarkdown,
        renderMath: renderMath,
        renderMermaid: renderMermaid,
        wrapCodeBlocks: wrapCodeBlocks,
        wrapTables: wrapTables,
        fullRender: fullRender,
        streamRender: streamRender,
        createMessageNode: createMessageNode,
        renderMessages: renderMessages,
        scrollToBottom: scrollToBottom,
        makeStreamUpdater: makeStreamUpdater,
    };
})();
