/* ===== 飞凡AI - API 通信层 ===== */
/* 流式对话 + 副屏保活 + 断流续传 + 渲染节流 */

const API = (function () {

    /* ---------- 引擎默认配置 ---------- */
    const DEFAULT_PROFILES = {
        openai: {
            id: 'openai', name: 'OpenAI', enabled: true,
            base: 'https://api.openai.com/v1',
            key: '', proxy: false, model: 'gpt-4o-mini',
            type: 'openai',
        },
        claude: {
            id: 'claude', name: 'Claude', enabled: false,
            base: 'https://api.anthropic.com/v1',
            key: '', proxy: false, model: 'claude-3-5-sonnet-20241022',
            type: 'claude',
        },
        gemini: {
            id: 'gemini', name: 'Gemini', enabled: false,
            base: 'https://generativelanguage.googleapis.com/v1beta',
            key: '', proxy: false, model: 'gemini-2.0-flash-exp',
            type: 'gemini',
        },
        openrouter: {
            id: 'openrouter', name: 'OpenRouter', enabled: false,
            base: 'https://openrouter.ai/api/v1',
            key: '', proxy: false, model: 'anthropic/claude-3.5-sonnet',
            type: 'openai',
        },
        zenmux: {
            id: 'zenmux', name: 'ZenMux', enabled: false,
            base: 'https://zenmux.ai/api/v1',
            key: '', proxy: false, model: 'openai/gpt-4o-mini',
            type: 'openai',
        },
    };

    /* ---------- 通用 fetch（支持代理转发） ---------- */
    async function rawFetch(profile, path, options) {
        const opts = options || {};
        const headers = opts.headers || {};

        let url;
        if (profile.proxy) {
            // 走 Cloudflare Pages Functions 代理
            url = '/api/' + encodeURIComponent(profile.base) + '/' + path.replace(/^\//, '');
        } else {
            url = profile.base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
        }

        // 注入鉴权
        if (profile.type === 'claude') {
            headers['x-api-key'] = profile.key;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
        } else if (profile.type === 'gemini') {
            // Gemini 用 query string 传 key
            const sep = url.includes('?') ? '&' : '?';
            url = url + sep + 'key=' + encodeURIComponent(profile.key);
        } else {
            headers['Authorization'] = 'Bearer ' + profile.key;
        }

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

    /* ---------- 把通用 messages 数组转成各引擎格式 ---------- */
    function buildPayload(profile, messages, params) {
        const p = params || {};

        if (profile.type === 'claude') {
            // Claude：system 单独字段，user/assistant 在 messages
            let system = '';
            const msgs = [];
            for (const m of messages) {
                if (m.role === 'system') {
                    system += (system ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
                } else {
                    msgs.push({ role: m.role, content: m.content });
                }
            }
            return {
                model: profile.model,
                messages: msgs,
                system: system || undefined,
                stream: true,
                max_tokens: p.max_tokens || 4096,
                temperature: p.temperature !== undefined ? p.temperature : 0.7,
                top_p: p.top_p !== undefined ? p.top_p : 1,
            };
        }

        if (profile.type === 'gemini') {
            // Gemini 自己的格式
            const contents = [];
            let systemInstruction = '';
            for (const m of messages) {
                if (m.role === 'system') {
                    systemInstruction += (systemInstruction ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
                } else {
                    contents.push({
                        role: m.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
                    });
                }
            }
            const payload = {
                contents: contents,
                generationConfig: {
                    temperature: p.temperature !== undefined ? p.temperature : 0.7,
                    topP: p.top_p !== undefined ? p.top_p : 1,
                    maxOutputTokens: p.max_tokens || 4096,
                },
            };
            if (systemInstruction) {
                payload.systemInstruction = { parts: [{ text: systemInstruction }] };
            }
            return payload;
        }

        // OpenAI 兼容（默认）
        return {
            model: profile.model,
            messages: messages,
            stream: true,
            temperature: p.temperature !== undefined ? p.temperature : 0.7,
            top_p: p.top_p !== undefined ? p.top_p : 1,
            max_tokens: p.max_tokens || 4096,
        };
    }

    /* ---------- 解析各引擎流式 chunk → 统一返回 delta 文本 ---------- */
    function parseChunk(profile, jsonStr) {
        try {
            const obj = JSON.parse(jsonStr);

            if (profile.type === 'claude') {
                // Claude SSE 事件类型
                if (obj.type === 'content_block_delta' && obj.delta && obj.delta.text) {
                    return obj.delta.text;
                }
                return '';
            }

            if (profile.type === 'gemini') {
                if (obj.candidates && obj.candidates[0] && obj.candidates[0].content
                    && obj.candidates[0].content.parts) {
                    return obj.candidates[0].content.parts.map(p => p.text || '').join('');
                }
                return '';
            }

            // OpenAI 兼容
            if (obj.choices && obj.choices[0]) {
                const c = obj.choices[0];
                if (c.delta && c.delta.content) return c.delta.content;
                if (c.message && c.message.content) return c.message.content;
            }
            return '';
        } catch (e) {
            return '';
        }
    }

    /* ---------- 获取流式 endpoint ---------- */
    function getStreamPath(profile) {
        if (profile.type === 'claude') return 'messages';
        if (profile.type === 'gemini') {
            return 'models/' + encodeURIComponent(profile.model) + ':streamGenerateContent?alt=sse';
        }
        return 'chat/completions';
    }

    /* ---------- 核心：流式对话 ---------- */
    /*
        参数:
            profile  - 引擎配置
            messages - 消息数组
            params   - {temperature, top_p, max_tokens}
            handlers - {
                onStart()           - 开始时触发
                onDelta(text, full) - 收到一段增量
                onDone(full)        - 正常结束
                onError(err)        - 出错
                onAbort(full)       - 被中断（保留半截）
            }
        返回:
            { abort() } 用于外部停止
    */
    function streamChat(profile, messages, params, handlers) {
        const h = handlers || {};
        const ctrl = new AbortController();

        // 副屏/后台保活：心跳检测
        let lastChunkTime = Date.now();
        let aborted = false;
        let full = '';

        // 心跳检测器：每 5 秒检查一次，超过 60 秒未收到 chunk 视为卡死
        const HEARTBEAT_INTERVAL = 5000;
        const STALL_TIMEOUT = 60000;
        const heartbeat = setInterval(() => {
            if (aborted) return;
            const elapsed = Date.now() - lastChunkTime;
            if (elapsed > STALL_TIMEOUT) {
                console.warn('[API] 流式超时（' + Math.round(elapsed / 1000) + 's 未响应），自动中断');
                aborted = true;
                clearInterval(heartbeat);
                try { ctrl.abort(); } catch (e) {}
                if (h.onError) h.onError(new Error('网络无响应超过 60 秒，已自动中断'));
            }
        }, HEARTBEAT_INTERVAL);

        // visibilitychange 监听：切回前台时强制刷一次 UI
        const onVisible = () => {
            if (!document.hidden && full && h.onDelta) {
                h.onDelta('', full); // 空 delta，仅触发 UI 刷新
            }
        };
        document.addEventListener('visibilitychange', onVisible);

        function cleanup() {
            clearInterval(heartbeat);
            document.removeEventListener('visibilitychange', onVisible);
        }

        (async () => {
            const path = getStreamPath(profile);
            const payload = buildPayload(profile, messages, params);

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

                    const resp = await rawFetch(profile, path, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        signal: ctrl.signal,
                    });

                    if (!resp.ok) {
                        const errText = await resp.text();
                        const msg = 'HTTP ' + resp.status + ': ' + errText.slice(0, 300);
                        // 5xx / 429 才重试
                        if ((resp.status >= 500 || resp.status === 429) && attempt < MAX_RETRY) {
                            lastErr = new Error(msg);
                            continue;
                        }
                        throw new Error(msg);
                    }

                    if (!resp.body) throw new Error('响应无 body 流');

                    // 流式读取
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
                            if (!trimmed) continue;
                            if (!trimmed.startsWith('data:')) continue;
                            const dataStr = trimmed.slice(5).trim();
                            if (dataStr === '[DONE]') continue;

                            const delta = parseChunk(profile, dataStr);
                            if (delta) {
                                full += delta;
                                if (h.onDelta) h.onDelta(delta, full);
                            }
                        }
                    }

                    // 处理 buffer 剩余
                    if (buffer.trim()) {
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith('data:')) {
                            const dataStr = trimmed.slice(5).trim();
                            if (dataStr && dataStr !== '[DONE]') {
                                const delta = parseChunk(profile, dataStr);
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
                    return; // 成功退出
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

            // 所有重试失败
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

    /* ---------- 暴露 ---------- */
    return {
        DEFAULT_PROFILES: DEFAULT_PROFILES,
        streamChat: streamChat,
        rawFetch: rawFetch,
    };
})();
