/* ===== 飞凡AI - Service Worker ===== */
/* 离线打开 + 静态资源缓存 */

const CACHE_NAME = 'feifan-ai-v2.2.0';
const PRECACHE = [
    './',
    './index.html',
    './css/main.css?v=2.2.0',
    './css/theme.css?v=2.2.0',
    './js/utils.js?v=2.2.0',
    './js/storage.js?v=2.2.0',
    './js/api.js?v=2.2.0',
    './js/ui.js?v=2.2.0',
    './js/parser.js?v=2.2.0',
    './js/upload.js?v=2.2.0',
    './js/snapshot.js?v=2.2.0',
    './js/app.js?v=2.2.0',
    './js/parsers/text.js?v=2.2.0',
    './js/parsers/csv.js?v=2.2.0',
    './js/parsers/office.js?v=2.2.0',
    './js/parsers/pdf.js?v=2.2.0',
    './manifest.json',
];

/* 安装：预缓存核心文件 */
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.allSettled(PRECACHE.map(url =>
                fetch(url, { cache: 'reload' }).then(resp => {
                    if (resp.ok) return cache.put(url, resp);
                }).catch(() => {})
            ));
        }).then(() => self.skipWaiting())
    );
});

/* 激活：清理旧缓存 */
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

/* 拦截请求：网络优先（保证 API 调用直通），失败回退缓存 */
self.addEventListener('fetch', (e) => {
    const req = e.request;

    // 仅处理 GET
    if (req.method !== 'GET') return;

    // API 请求直通（不缓存）
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return;

    // 跨域 CDN 不拦截
    if (url.origin !== self.location.origin) return;

    // 静态资源：网络优先 + 缓存兜底
    e.respondWith(
        fetch(req).then(resp => {
            if (resp && resp.ok) {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
            }
            return resp;
        }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
});
