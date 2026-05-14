/* ===== 飞凡AI - API 通信层 ===== */
/* 统一 OpenAI 协议 + Cloudflare Functions 代理 + 流式 + 保活 + 重试 */

const API = (function () {

    /* ---------- 引擎默认配置（与原版一致） ---------- */
    const DEFAULT_PROFILES = {
        zenmux: {
            id: 'zenmux',
            name: 'ZenMux',
            base: 'https://zenmux.ai/api/v1',
            key: '',
            model: 'openai/gpt-4o-mini',
            // 运行时参数（4 个开关）
            useTemp: true,    temperature: 0.7,
            useMax: true,     max_tokens: 4096,
            useTopP: false,   top_p: 1,
            useFreq: false,   frequency_penalty: 0,
        },
        openai: {
            id: 'openai',
            name: 'OpenAI',
            base: 'https://api.openai.com/v1',
            key: '',
            model: 'gpt-4o-mini',
            useTemp: true,    temperature: 0.7,
            useMax: true,     max_tokens: 4096,
            useTopP: false,   top_p: 1,
            useFreq: false,   frequency_penalty: 0,
        },
        openrouter: {
            id: 'openrouter',
            name: 'OpenRouter',
            base: 'https://openrouter.ai/api/v1',
            key: '',
            model: 'anthropic/claude-3.5-sonnet',
            useTemp: true,    temperature: 0.7,
            useMax: true,     max_tokens: 4096,
            useTopP: false,   top_p: 1,
            useFreq: false,   frequency_penalty: 0,
        },
    };

    /* ---------- 通用 fetch（走 Cloudflare Functions 代理） ---------- */
    /*
        所有请求统一走 /api/{path}
        Header: X-Target-Base: <base url>
        Functions/api/[[path]].js 会把请求转发到目标 base + path
    */
    async function apiF(profile, path, options) {
        const opts = options || {};
        const url = '/api/' + path.replace(/^\//, '');

        const headers = Object.assign({
            'Authorization': 'Bearer ' + (profile.key || ''),
            'X-Target-Base': profile.base || '',
        }, opts.headers || {});

        if (!headers['Content-Type'] && opts.body) {
            headers['Content-Type'] = 'application/json';
        }

        return fetch(url, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body,
            signal: opts.signal,
        });
    }

    /* ---------- 构建请求 payload ---------- */
    function buildPayload(profile, messages) {
        const payload = {
            model: profile.model,
            messages: messages,
            stream: true,
        };
        if (profile.useTemp) payload.temperature = parseFloat(profile.temperature);
        if (profile.useMax) payload.max_tokens = parseInt(profile.max_tokens, 10);
        if (profile.useTopP) payload.top_p = parseFloat(profile.top_p);
        if (profile.useFreq) payload.frequency_penalty = parseFloat(profile.frequency_penalty);
        return payload;
    }

    /* ---------- 解析流式 chunk ---------- */
    function parseChunk(jsonStr) {
        try {
            const obj = JSON.parse(jsonStr);
            if (obj.choices && obj.choices[0]) {
                const c = obj.choices[0];
                if (c.delta && c.delta.content) return c.delta.content;
                if (c.message && c.message.content) return c.message.content;
            }
        } catch (e) {}
        return '';
    }

    /* ---------- 获取模型列表 ---------- */
    async function fetchModels(profile) {
        const resp = await apiF(profile, 'models', { method: 'GET' });
        if (!resp.ok) {
            throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
        }
        const data = await resp.json();
        // 兼容多种返回格式
        let list = [];
        if (Array.isArray(data.data)) {
            list = data.data.map(m => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data.models)) {
            list = data.models.map(m => m.id || m.name).filter(Boolean);
        } else if (Array.isArray(data)) {
            list = data.map(m => m.id || m.name || m).filter(Boolean);
        }
        return list.sort();
    }

    /* ---------- 测试连通性 ---------- */
    async function testConnection(profile) {
        try {
            const resp = await apiF(profile, 'models', { method: 'GET' });
            if (resp.ok) {
                return { ok: true, msg: '✅ 连接成功' };
            }
            return { ok: false, msg: '❌ HTTP ' + resp.status };
        } catch (e) {
            return { ok: false, msg: '❌ ' + e.message };
        }
    }

    /* ---------- 核心：流式对话 ---------- */
    function streamChat(profile, messages, handlers) {
        const h = handlers || {};
        const ctrl = new AbortController();

        let lastChunkTime = Date.now();
        let aborted = false;
        let full = '';

        // 心跳检测：60 秒无响应自动中断（副屏保活）
        const HEARTBEAT_INTERVAL = 5000;
        const STALL_TIMEOUT = 60000;
        const heartbeat = setInterval(() => {
            if (aborted) return;
            const elapsed = Date.now() - lastChunkTime;
            if (elapsed > STALL_TIMEOUT) {
                console.warn('[API] 流式超时（' + Math.round(elapsed / 1000) + 's），自动中断');
                aborted = true;
                clearInterval(heartbeat);
                try { ctrl.abort(); } catch (e) {}
                if (h.onError) h.onError(new Error('网络无响应超过 60 秒，已自动中断'));
            }
        }, HEARTBEAT_INTERVAL);

        // visibilitychange：切回前台时刷一次 UI
        const onVisible = () => {
            if (!document.hidden && full && h.onDelta) {
                h.onDelta('', full);
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        function cleanup() {
            clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', onVisible);
        }

        (async () => {
            const payload = buildPayload(profile, messages);

            // 自动重试（指数退避）
            const MAX_RETRY = 2;
            let lastErr = null;

            for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
                if (aborted) break;
                try {
                    if (attempt > 0) {
                        const delay = 1000 * Math.pow(2, attempt - 1);
                        console.log('[API] 第 ' + attempt + ' 次重试，等待 ' + delay + 'ms');
                        await sleep(delay);
                        if (aborted) break;
                    }

                    if (h.onStart && attempt === 0) h.onStart();

                    const resp = await apiF(profile, 'chat/completions', {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        signal: ctrl.signal,
                    });

                    if (!resp.ok) {
                        const errText = await resp.text();
                        const msg = 'HTTP ' + resp.status + ': ' + errText.slice(0, 300);
                        if ((resp.status >= 500 || resp.status === 429) && attempt < MAX_RETRY) {
                            lastErr = new Error(msg);
                            continue;
                        }
                        throw new Error(msg);
                    }

                    if (!resp.body) throw new Error('响应无 body 流');

                    const reader = resp.body.getReader();
                    const dec = new TextDecoder('utf-8');
                    let buffer = '';
                    lastChunkTime = Date.now();

                    while (true) {
                        if (aborted) {
                            try { reader.cancel(); } catch (e) {}
                            break;
                        }
                        const { done, value } = await reader.read();
                        if (done) {
                            buffer += dec.decode();
                            break;
                        }
                        lastChunkTime = Date.now();
                        buffer += dec.decode(value, { stream: true });

                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data:')) continue;
                            const dataStr = trimmed.slice(5).trim();
                            if (dataStr === '[DONE]') continue;

                            const delta = parseChunk(dataStr);
                            if (delta) {
                                full += delta;
                                if (h.onDelta) h.onDelta(delta, full);
                            }
                        }
                    }

                    if (buffer.trim()) {
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith('data:')) {
                            const dataStr = trimmed.slice(5).trim();
                            if (dataStr && dataStr !== '[DONE]') {
                                const delta = parseChunk(dataStr);
                                if (delta) {
                                    full += delta;
                                    if (h.onDelta) h.onDelta(delta, full);
                                }
                            }
                        }
                    }

                    cleanup();
                    if (aborted) {
                        if (h.onAbort) h.onAbort(full);
                    } else {
                        if (h.onDone) h.onDone(full);
                    }
                    return;
                } catch (err) {
                    lastErr = err;
                    if (err.name === 'AbortError' || aborted) {
                        cleanup();
                        if (h.onAbort) h.onAbort(full);
                        return;
                    }
                    if (attempt >= MAX_RETRY) break;
                    console.warn('[API] 第 ' + (attempt + 1) + ' 次失败:', err.message);
                }
            }

            cleanup();
            if (h.onError) h.onError(lastErr || new Error('未知错误'));
        })();

        return {
            abort: function () {
                aborted = true;
                cleanup();
                try { ctrl.abort(); } catch (e) {}
            },
            get full() { return full; },
        };
    }

    return {
        DEFAULT_PROFILES: DEFAULT_PROFILES,
        apiF: apiF,
        streamChat: streamChat,
        fetchModels: fetchModels,
        testConnection: testConnection,
    };
})();
