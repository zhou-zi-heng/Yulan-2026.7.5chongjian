/* ===== ZenMux 工具函数库 (v2.3.8) ===== */
/* 全部挂在 window 上，全局可用，与原代码兼容 */
/* v2.3.8: cntW 精准对齐 WPS/Word "字数" 口径（汉字+英文词+数字串，清洗Markdown，排除代码块） */

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

/* ---------- 字数统计（对齐 WPS/Word "字数" 口径） ---------- */

// 内部：清洗 Markdown，去掉格式符号，保留正文文字
function _stripMarkdownForCount(text) {
    let s = String(text || '');

    // 1. 移除代码块整段（```...```），按需求不计入字数
    s = s.replace(/```[\s\S]*?```/g, ' ');
    // 2. 移除行内代码的反引号（保留里面文字？—— 代码相关一般不算，这里连内容一起去掉）
    s = s.replace(/`[^`\n]*`/g, ' ');
    // 3. 移除图片 ![alt](url) 整体
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    // 4. 链接 [文字](url) → 仅保留"文字"
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 5. 移除 HTML 标签 <...>
    s = s.replace(/<[^>]+>/g, ' ');
    // 6. 移除表格分隔行（| --- | :--: | 这类）
    s = s.replace(/^\s*\|?[\s:\-]*\|[\s:\-|]*\|?\s*$/gm, ' ');
    // 7. 移除表格框线竖线（保留单元格文字）
    s = s.replace(/\|/g, ' ');
    // 8. 移除标题井号、引用符号、列表符号（行首）
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');     // # 标题
    s = s.replace(/^\s{0,3}>+\s?/gm, '');          // > 引用
    s = s.replace(/^\s{0,3}([-*+])\s+/gm, '');     // - * + 无序列表
    s = s.replace(/^\s{0,3}\d+\.\s+/gm, '');       // 1. 有序列表
    // 9. 移除水平分割线 --- *** ___
    s = s.replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, ' ');
    // 10. 移除加粗/斜体/删除线标记符号（保留文字）
    s = s.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, '');

    return s;
}

// 字数统计：汉字 + 英文单词 + 数字串（标点/空格不计），对齐 WPS"字数"
function cntW(t) {
    if (!t) return 0;
    const s = _stripMarkdownForCount(t);

    // 汉字：基本区 + 扩展A + 扩展B（覆盖常用+生僻字）
    let han = 0;
    try {
        han = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu) || []).length;
    } catch (e) {
        // 极旧环境不支持 u 标志的码点范围时降级
        han = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    }
    // 英文单词：连续字母算 1
    const eng = (s.match(/[a-zA-Z]+/g) || []).length;
    // 数字串：连续数字算 1
    const num = (s.match(/\d+/g) || []).length;

    return han + eng + num;
}

// （可选）更细分的统计，返回各项明细，便于调试/未来自动化判断
function cntDetail(t) {
    const s = _stripMarkdownForCount(t || '');
    let han = 0;
    try {
        han = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}]/gu) || []).length;
    } catch (e) {
        han = (s.match(/[\u4收到。两个文件我都看了，问题定位非常清楚。这次先**只解决字数统计**这一个独立的小问题（工作流第二部分以后再推进）。

---

# 一、你现在为什么是 1513，差了 500 多字

看你现在的 `cntW()`：

```javascript
function cntW(t) {
    return (String(t).match(/[\u4e00-\u9fff]/g) || []).length    // 汉字
         + (String(t).match(/[a-zA-Z]+/g) || []).length;          // 英文单词
}
