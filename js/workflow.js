/* ===== 飞凡AI - 工作流引擎 (v2.4.1) ===== */
/* 步骤由多个片段(segments)交替组成：prompt(隐藏,加密) / input(用户输入框)。
   发送时按顺序拼接：隐藏段文字 + 对应输入框内容 + ... 实际发AI；界面只显示输入内容。 */

const Workflow = (function () {

    const WORKFLOW_SECRET = 'FeiFan-Workflow-2026-Kx7@mP3$qR9#vL2&nW8^bT5*cY1!hG4%zE6';
    const PBKDF2_ITER = 100000;
    const SUPPORTS_CRYPTO = !!(window.crypto && window.crypto.subtle);

    let _data = null, _loaded = false, _decCache = {};

    function _b642ab(b64){const s=atob(b64);const b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b.buffer;}
    async function _key(salt){const e=new TextEncoder();const base=await crypto.subtle.importKey('raw',e.encode(WORKFLOW_SECRET),{name:'PBKDF2'},false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:PBKDF2_ITER,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);}

    async function _decrypt(str){
        if(!str) return '';
        if(str.indexOf('__PLAIN__')===0) return str.slice(9);
        if(str.indexOf('WFX1:')!==0) return str;
        if(_decCache[str]) return _decCache[str];
        if(!SUPPORTS_CRYPTO) throw new Error('浏览器不支持解密');
        const pack=JSON.parse(decodeURIComponent(escape(atob(str.slice(5)))));
        const salt=new Uint8Array(_b642ab(pack.s)),iv=new Uint8Array(_b642ab(pack.i)),cipher=_b642ab(pack.c);
        const key=await _key(salt);
        const buf=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv},key,cipher);
        const plain=new TextDecoder().decode(buf);
        _decCache[str]=plain;
        return plain;
    }

    async function load(url){
        try{
            const resp=await fetch((url||'presets.json')+'?t='+Date.now());
            if(!resp.ok) throw new Error('HTTP '+resp.status);
            _data=await resp.json();
            _loaded=true;
            console.log('[Workflow] 预设库已加载：'+(_data.presets?_data.presets.length:0)+' 个预设');
            return true;
        }catch(e){ console.warn('[Workflow] 加载失败',e); _loaded=false; return false; }
    }
    function isLoaded(){ return _loaded && _data && Array.isArray(_data.presets); }
    function getGroups(){ return isLoaded() && Array.isArray(_data.groups) ? _data.groups.slice() : []; }
    function getPresets(group,keyword){
        if(!isLoaded()) return [];
        let list=_data.presets.slice();
        if(group && group!=='__all__') list=list.filter(p=>p.group===group);
        if(keyword && keyword.trim()){ const kw=keyword.trim().toLowerCase(); list=list.filter(p=>(p.name||'').toLowerCase().indexOf(kw)>=0); }
        return list;
    }
    function getPreset(pid){ return isLoaded() ? (_data.presets.find(p=>p.id===pid)||null) : null; }
    function getSteps(pid){
        const p=getPreset(pid);
        if(!p||!Array.isArray(p.steps)) return [];
        return p.steps.slice().sort((a,b)=>(a.order||0)-(b.order||0));
    }
    function getStep(pid,sid){ return getSteps(pid).find(s=>s.id===sid)||null; }

    /* 取某步骤的输入框列表（供界面渲染），返回 [{index, placeholder}] */
    function getInputs(pid,sid){
        const s=getStep(pid,sid);
        if(!s||!Array.isArray(s.segments)) return [];
        const arr=[];
        s.segments.forEach((seg,i)=>{
            if(seg.type==='input') arr.push({ segIndex:i, placeholder:seg.placeholder||'请输入...' });
        });
        return arr;
    }

    /* 构建发送：inputs 是 { segIndex: 用户输入文本 } 的映射 */
    async function buildSend(pid,sid,inputsMap){
        const s=getStep(pid,sid);
        if(!s) throw new Error('步骤不存在');
        let sendText='';
        const userParts=[];
        for(let i=0;i<s.segments.length;i++){
            const seg=s.segments[i];
            if(seg.type==='prompt'){
                const txt=await _decrypt(seg.hidden);
                sendText+=txt;
            }else{
                const v=(inputsMap && inputsMap[i]!==undefined) ? String(inputsMap[i]) : '';
                sendText+=v;
                if(v.trim()) userParts.push(v.trim());
            }
        }
        // 界面显示：步骤名 + 各输入内容拼接（不含隐藏段）
        const displayText = s.name + (userParts.length ? '：' + userParts.join(' ') : '');
        return { displayText: displayText, sendText: sendText, stepName: s.name };
    }

    return { load, isLoaded, getGroups, getPresets, getPreset, getSteps, getStep, getInputs, buildSend };
})();

window.Workflow = Workflow;
