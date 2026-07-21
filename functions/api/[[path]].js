/* ===== 飞凡AI - 后端 (v3.0.0 批次3全量) ===== */

/* ---------- Web Crypto 工具 ---------- */
async function sha256(text){const d=new TextEncoder().encode(text);const b=await crypto.subtle.digest('SHA-256',d);return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function b64urlEnc(s){return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function b64urlDec(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return decodeURIComponent(escape(atob(s)));}
async function hmacSign(msg,secret){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg));return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function signJWT(payload,secret){const now=Math.floor(Date.now()/1000);const body=Object.assign({},payload,{iat:now,exp:now+5*24*3600});const h=b64urlEnc(JSON.stringify({alg:'HS256',typ:'JWT'}));const p=b64urlEnc(JSON.stringify(body));const sig=await hmacSign(h+'.'+p,secret);return h+'.'+p+'.'+sig;}
async function verifyJWT(token,secret){try{const parts=token.split('.');if(parts.length!==3)return null;const es=await hmacSign(parts[0]+'.'+parts[1],secret);if(es!==parts[2])return null;const pl=JSON.parse(b64urlDec(parts[1]));if(pl.exp&&Math.floor(Date.now()/1000)>pl.exp)return null;return pl;}catch(e){return null;}}
async function verifyUser(request,env){const a=request.headers.get('X-Auth-Token')||'';if(!a)return null;return await verifyJWT(a,env.JWT_SECRET);}
async function verifyAdmin(request,env){const pl=await verifyUser(request,env);if(!pl||pl.role!=='admin')return null;return pl;}

/* ---------- 引擎Key加密 ---------- */
async function encKey(plain,secret){if(!plain)return '';const enc=new TextEncoder();const km=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'PBKDF2'},false,['deriveKey']);const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:50000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(plain));const b=(buf)=>btoa(String.fromCharCode(...new Uint8Array(buf)));return 'ENC:'+b(salt)+':'+b(iv)+':'+b(cipher);}
async function decKey(stored,secret){if(!stored)return '';if(stored.indexOf('ENC:')!==0)return stored;try{const p=stored.split(':');const ub=(s)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const salt=ub(p[1]),iv=ub(p[2]),cipher=ub(p[3]);const enc=new TextEncoder();const km=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'PBKDF2'},false,['deriveKey']);const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:50000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt']);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher);return new TextDecoder().decode(plain);}catch(e){return '';}}

/* ---------- CORS ---------- */
function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'*'};}
function jr(obj,status){return new Response(JSON.stringify(obj),{status:status||200,headers:Object.assign({'Content-Type':'application/json'},cors())});}

/* ---------- 主入口 ---------- */
export async function onRequest(context){
    const{request,env}=context;
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:Object.assign({'Access-Control-Max-Age':'86400'},cors())});
    const url=new URL(request.url);
    const sub=url.pathname.replace(/^\/api\//,'');

    if(sub==='init')return await hInit(request,env,url);
    if(sub==='login')return await hLogin(request,env);
    if(sub==='verify')return await hVerify(request,env);

    // 普通用户接口（需登录）
    if(sub==='engines')return await hEngines(request,env);
    if(sub==='engines/models')return await hEngineModels(request,env,url);
    if(sub==='presets')return await hGetPresets(request,env);
    if(sub==='log')return await hLog(request,env);
    if(sub==='config')return await hGetConfig(request,env);

    // 管理接口（需admin）
    if(sub.startsWith('admin/')){
        const ap=await verifyAdmin(request,env);
        if(!ap)return jr({error:'无管理员权限'},403);
        return await hAdmin(request,env,sub.replace(/^admin\//,''),ap);
    }

    return await hProxy(request,env,url,sub);
}

/* ---------- init / login / verify ---------- */
async function hInit(request,env,url){
    if(!env.DB)return jr({error:'D1 未绑定（DB）'},500);
    if(url.searchParams.get('secret')!==env.JWT_SECRET)return jr({error:'初始化密钥错误'},403);
    try{
        const ex=await env.DB.prepare('SELECT id FROM users WHERE role=?').bind('admin').first();
        if(ex)return jr({error:'已存在管理员账号'},400);
        const h=await sha256('admin123');
        await env.DB.prepare('INSERT INTO users (username,password_hash,name,role,status,permissions,created_at) VALUES (?,?,?,?,?,?,?)').bind('admin',h,'超级管理员','admin','active','{}',Date.now()).run();
        return jr({ok:true,msg:'✅ 已创建 admin/admin123'});
    }catch(e){return jr({error:e.message},500);}
}
async function hLogin(request,env){
    if(!env.DB)return jr({error:'D1 未绑定'},500);
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim(),pw=(b.password||'').trim();
    if(!un||!pw)return jr({error:'请输入账号密码'},400);
    try{
        const u=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(un).first();
        if(!u)return jr({error:'账号或密码错误'},401);
        if(u.status!=='active')return jr({error:'该账号已被禁用'},403);
        if(await sha256(pw)!==u.password_hash)return jr({error:'账号或密码错误'},401);
        const token=await signJWT({username:u.username,name:u.name,role:u.role,permissions:u.permissions||'{}'},env.JWT_SECRET);
        const ip=request.headers.get('CF-Connecting-IP')||'';
        try{await env.DB.prepare('INSERT INTO sessions (username,session_id,ip,last_active,login_at) VALUES (?,?,?,?,?)').bind(u.username,token.slice(-16),ip,Date.now(),Date.now()).run();}catch(e){}
        return jr({ok:true,token,user:{username:u.username,name:u.name,role:u.role,permissions:u.permissions||'{}'}});
    }catch(e){return jr({error:e.message},500);}
}
async function hVerify(request,env){
    const a=request.headers.get('X-Auth-Token')||'';
    if(!a)return jr({ok:false},401);
    const pl=await verifyJWT(a,env.JWT_SECRET);
    if(!pl)return jr({ok:false,error:'token无效或过期'},401);
    if(env.DB){const ip=request.headers.get('CF-Connecting-IP')||'';try{await env.DB.prepare('UPDATE sessions SET last_active=?,ip=? WHERE session_id=?').bind(Date.now(),ip,a.slice(-16)).run();}catch(e){}}
    return jr({ok:true,user:{username:pl.username,name:pl.name,role:pl.role,permissions:pl.permissions||'{}'}});
}

/* ---------- 普通用户：获取自己的公有引擎（不含Key） ---------- */
async function hEngines(request,env){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录'},401);
    try{
        const rows=(await env.DB.prepare('SELECT id,name,protocol,model,price_in,price_out,price_cache_read,price_cache_write FROM engines_public WHERE username=? ORDER BY name').bind(pl.username).all()).results||[];
        const engines=rows.map(e=>({id:e.id,name:e.name,protocol:e.protocol,model:e.model,priceIn:e.price_in,priceOut:e.price_out,priceCacheRead:e.price_cache_read,priceCacheWrite:e.price_cache_write,origin:'public'}));
        return jr({ok:true,engines});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- 普通用户：获取某公有引擎的模型列表（后端用Key请求） ---------- */
async function hEngineModels(request,env,url){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录'},401);
    const engId=url.searchParams.get('engineId');
    if(!engId)return jr({error:'缺engineId'},400);
    try{
        const e=await env.DB.prepare('SELECT * FROM engines_public WHERE id=? AND username=?').bind(engId,pl.username).first();
        if(!e)return jr({error:'引擎不存在'},404);
        const key=await decKey(e.api_key,env.KEY_SECRET);
        let path='models';
        if(e.protocol==='anthropic')path='v1/models';
        if(e.protocol==='gemini')path='v1beta/models';
        const resp=await fetch(e.base_url.replace(/\/+$/,'')+'/'+path,{headers:{'Authorization':'Bearer '+key,'anthropic-version':'2023-06-01'}});
        if(!resp.ok)return jr({error:'HTTP '+resp.status},500);
        const data=await resp.json();
        let list=[];
        if(Array.isArray(data.data))list=data.data.map(m=>m.id||m.name).filter(Boolean);
        else if(Array.isArray(data.models))list=data.models.map(m=>(m.id||m.name||'').replace(/^models\//,'')).filter(Boolean);
        else if(Array.isArray(data))list=data.map(m=>m.id||m.name||m).filter(Boolean);
        return jr({ok:true,models:list.sort()});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- 普通用户：获取预设（从D1） ---------- */
async function hGetPresets(request,env){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录'},401);
    try{
        const row=await env.DB.prepare('SELECT data FROM presets WHERE id=1').first();
        if(!row||!row.data)return jr({ok:true,presets:null}); // 无D1预设，前端回退presets.json
        return jr({ok:true,presets:JSON.parse(row.data)});
    }catch(e){return jr({ok:true,presets:null});}
}

/* ---------- 普通用户：监视上报 ---------- */
async function hLog(request,env){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录'},401);
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    try{
        await env.DB.prepare('INSERT INTO logs (username,chat_name,rounds,tokens,model,created_at) VALUES (?,?,?,?,?,?)').bind(pl.username,(b.chatName||'').slice(0,100),b.rounds||0,b.tokens||0,(b.model||'').slice(0,60),Date.now()).run();
        return jr({ok:true});
    }catch(e){return jr({ok:false});}
}

/* ---------- 普通用户：获取全局配置（如打标块大小） ---------- */
async function hGetConfig(request,env){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录'},401);
    try{
        const rows=(await env.DB.prepare('SELECT key,value FROM global_config').all()).results||[];
        const cfg={};rows.forEach(r=>cfg[r.key]=r.value);
        return jr({ok:true,config:cfg});
    }catch(e){return jr({ok:true,config:{}});}
}

/* ---------- 管理接口分发 ---------- */
async function hAdmin(request,env,action,payload){
    if(!env.DB)return jr({error:'D1 未绑定'},500);
    if(action==='ping')return jr({ok:true,admin:payload.username});
    // 账号
    if(action==='users/list')return await aUsersList(env);
    if(action==='users/create')return await aUsersCreate(request,env);
    if(action==='users/update')return await aUsersUpdate(request,env);
    if(action==='users/delete')return await aUsersDelete(request,env);
    if(action==='users/resetpwd')return await aUsersResetPwd(request,env);
    if(action==='users/import')return await aUsersImport(request,env);
    if(action==='users/export')return await aUsersExport(request,env);
    if(action==='users/perm')return await aUsersPerm(request,env);
    // 引擎
    if(action==='engines/list')return await aEnginesList(request,env,new URL(request.url));
    if(action==='engines/save')return await aEnginesSave(request,env);
    if(action==='engines/delete')return await aEnginesDelete(request,env);
    // 预设
    if(action==='presets/get')return await aPresetsGet(env);
    if(action==='presets/save')return await aPresetsSave(request,env);
    // 监视
    if(action==='monitor')return await aMonitor(env);
    // 全局配置
    if(action==='config/get')return await aConfigGet(env);
    if(action==='config/save')return await aConfigSave(request,env);
    return jr({error:'未知接口：'+action},404);
}

/* ---------- 账号管理 ---------- */
async function aUsersList(env){
    try{
        const users=(await env.DB.prepare('SELECT id,username,name,role,status,permissions,created_at FROM users ORDER BY created_at DESC').all()).results||[];
        const engRows=(await env.DB.prepare('SELECT username,COUNT(*) AS cnt FROM engines_public GROUP BY username').all()).results||[];
        const engMap={};engRows.forEach(r=>engMap[r.username]=r.cnt);
        const weekAgo=Date.now()-7*24*3600*1000;
        const sess=(await env.DB.prepare('SELECT username,ip,last_active FROM sessions WHERE last_active>?').bind(weekAgo).all()).results||[];
        const sm={};sess.forEach(s=>{if(!sm[s.username])sm[s.username]={last:0,ips:{}};if(s.last_active>sm[s.username].last)sm[s.username].last=s.last_active;if(s.ip)sm[s.username].ips[s.ip]=1;});
        const list=users.map(u=>{const s=sm[u.username]||{last:0,ips:{}};const ipc=Object.keys(s.ips).length;return{username:u.username,name:u.name,role:u.role,status:u.status,permissions:u.permissions||'{}',engineCount:engMap[u.username]||0,lastActive:s.last,ipCount:ipc,ipAbnormal:ipc>=3};});
        return jr({ok:true,users:list});
    }catch(e){return jr({error:e.message},500);}
}
async function aUsersCreate(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim(),pw=(b.password||'').trim(),nm=(b.name||'').trim(),role=b.role==='admin'?'admin':'user';
    if(!un||!pw)return jr({error:'账号密码必填'},400);
    try{
        if(await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(un).first())return jr({error:'账号已存在'},400);
        const h=await sha256(pw);
        await env.DB.prepare('INSERT INTO users (username,password_hash,name,role,status,permissions,created_at) VALUES (?,?,?,?,?,?,?)').bind(un,h,nm,role,'active','{}',Date.now()).run();
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}
async function aUsersUpdate(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim();if(!un)return jr({error:'缺账号'},400);
    try{
        const f=[],v=[];
        if(b.name!==undefined){f.push('name=?');v.push(b.name);}
        if(b.role!==undefined){f.push('role=?');v.push(b.role==='admin'?'admin':'user');}
        if(b.status!==undefined){f.push('status=?');v.push(b.status==='active'?'active':'disabled');}
        if(!f.length)return jr({error:'无更新'},400);
        v.push(un);
        await env.DB.prepare('UPDATE users SET '+f.join(',')+' WHERE username=?').bind(...v).run();
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}
async function aUsersDelete(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim();if(!un)return jr({error:'缺账号'},400);
    if(un==='admin')return jr({error:'不能删admin'},400);
    try{
        await env.DB.prepare('DELETE FROM users WHERE username=?').bind(un).run();
        await env.DB.prepare('DELETE FROM engines_public WHERE username=?').bind(un).run();
        await env.DB.prepare('DELETE FROM sessions WHERE username=?').bind(un).run();
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}
async function aUsersResetPwd(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim(),pw=(b.password||'').trim();
    if(!un||!pw)return jr({error:'必填'},400);
    try{const h=await sha256(pw);await env.DB.prepare('UPDATE users SET password_hash=? WHERE username=?').bind(h,un).run();await env.DB.prepare('DELETE FROM sessions WHERE username=?').bind(un).run();return jr({ok:true});}catch(e){return jr({error:e.message},500);}
}
async function aUsersPerm(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim();if(!un)return jr({error:'缺账号'},400);
    try{
        const perm=JSON.stringify(b.permissions||{});
        await env.DB.prepare('UPDATE users SET permissions=? WHERE username=?').bind(perm,un).run();
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}
async function aUsersImport(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const rows=b.rows||[];if(!rows.length)return jr({error:'无数据'},400);
    let uc=0,ec=0,errs=[];
    const um={};
    rows.forEach(r=>{
        const un=(r['账号']||'').trim();if(!un)return;
        if(!um[un])um[un]={username:un,password:(r['密码']||'').trim(),name:(r['姓名']||'').trim(),role:(r['角色']||'user').trim()==='admin'?'admin':'user',engines:[]};
        const en=(r['引擎名称']||'').trim();
        if(en)um[un].engines.push({name:en,protocol:(r['协议']||'openai').trim(),base:(r['BaseURL']||'').trim(),key:(r['APIKey']||'').trim(),model:(r['模型']||'').trim(),pi:parseFloat(r['输入单价'])||0,po:parseFloat(r['输出单价'])||0,pcr:parseFloat(r['缓存读单价'])||0,pcw:parseFloat(r['缓存写单价'])||0});
    });
    for(const un in um){
        const u=um[un];
        try{
            if(!u.password){errs.push(un+'：缺密码');continue;}
            const h=await sha256(u.password);
            if(await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(un).first()){
                await env.DB.prepare('UPDATE users SET password_hash=?,name=?,role=? WHERE username=?').bind(h,u.name,u.role,un).run();
            }else{
                await env.DB.prepare('INSERT INTO users (username,password_hash,name,role,status,permissions,created_at) VALUES (?,?,?,?,?,?,?)').bind(un,h,u.name,u.role,'active','{}',Date.now()).run();
            }
            uc++;
            await env.DB.prepare('DELETE FROM engines_public WHERE username=?').bind(un).run();
            for(const eng of u.engines){
                const eid='eng_'+un+'_'+Math.random().toString(36).slice(2,8);
                const ke=await encKey(eng.key,env.KEY_SECRET);
                await env.DB.prepare('INSERT INTO engines_public (id,username,name,protocol,base_url,api_key,model,price_in,price_out,price_cache_read,price_cache_write,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(eid,un,eng.name,eng.protocol,eng.base,ke,eng.model,eng.pi,eng.po,eng.pcr,eng.pcw,Date.now()).run();
                ec++;
            }
        }catch(e){errs.push(un+'：'+e.message);}
    }
    return jr({ok:true,userCount:uc,engCount:ec,errors:errs});
}
async function aUsersExport(request,env){
    const url=new URL(request.url);const wk=url.searchParams.get('withkey')==='1';
    try{
        const users=(await env.DB.prepare('SELECT username,name,role FROM users ORDER BY created_at').all()).results||[];
        const engs=(await env.DB.prepare('SELECT * FROM engines_public ORDER BY username').all()).results||[];
        const eb={};engs.forEach(e=>{if(!eb[e.username])eb[e.username]=[];eb[e.username].push(e);});
        const esc=(v)=>{v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
        const header=['姓名','账号','密码','角色','引擎名称','协议','BaseURL','APIKey','模型','输入单价','输出单价','缓存读单价','缓存写单价'];
        const lines=[header.join(',')];
        for(const u of users){
            const ue=eb[u.username]||[];
            if(!ue.length){lines.push([u.name,u.username,'******',u.role,'','','','','','','','',''].map(esc).join(','));}
            else{for(const e of ue){let ko='******';if(wk)ko=await decKey(e.api_key,env.KEY_SECRET);lines.push([u.name,u.username,'******',u.role,e.name,e.protocol,e.base_url,ko,e.model,e.price_in,e.price_out,e.price_cache_read,e.price_cache_write].map(esc).join(','));}}
        }
        return jr({ok:true,csv:'\uFEFF'+lines.join('\n')});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- 引擎管理（admin） ---------- */
async function aEnginesList(request,env,url){
    const un=url.searchParams.get('username');
    try{
        let q='SELECT id,username,name,protocol,base_url,model,price_in,price_out,price_cache_read,price_cache_write FROM engines_public';
        let rows;
        if(un){rows=(await env.DB.prepare(q+' WHERE username=? ORDER BY name').bind(un).all()).results||[];}
        else{rows=(await env.DB.prepare(q+' ORDER BY username,name').all()).results||[];}
        // Key不返回明文，只标记有无
        const engs=rows.map(e=>({id:e.id,username:e.username,name:e.name,protocol:e.protocol,base:e.base_url,model:e.model,hasKey:true,priceIn:e.price_in,priceOut:e.price_out,priceCR:e.price_cache_read,priceCW:e.price_cache_write}));
        return jr({ok:true,engines:engs});
    }catch(e){return jr({error:e.message},500);}
}
async function aEnginesSave(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    const un=(b.username||'').trim();if(!un)return jr({error:'缺账号'},400);
    if(!b.name)return jr({error:'引擎名必填'},400);
    try{
        const id=b.id||('eng_'+un+'_'+Math.random().toString(36).slice(2,8));
        const ex=b.id?await env.DB.prepare('SELECT api_key FROM engines_public WHERE id=?').bind(b.id).first():null;
        // Key：如果传了新key则加密存，没传则保留旧的
        let keyStored;
        if(b.key&&b.key!=='******'){keyStored=await encKey(b.key,env.KEY_SECRET);}
        else if(ex){keyStored=ex.api_key;}
        else{keyStored='';}
        if(ex){
            await env.DB.prepare('UPDATE engines_public SET name=?,protocol=?,base_url=?,api_key=?,model=?,price_in=?,price_out=?,price_cache_read=?,price_cache_write=?,updated_at=? WHERE id=?').bind(b.name,b.protocol||'openai',b.base||'',keyStored,b.model||'',b.priceIn||0,b.priceOut||0,b.priceCR||0,b.priceCW||0,Date.now(),b.id).run();
        }else{
            await env.DB.prepare('INSERT INTO engines_public (id,username,name,protocol,base_url,api_key,model,price_in,price_out,price_cache_read,price_cache_write,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,un,b.name,b.protocol||'openai',b.base||'',keyStored,b.model||'',b.priceIn||0,b.priceOut||0,b.priceCR||0,b.priceCW||0,Date.now()).run();
        }
        return jr({ok:true,id});
    }catch(e){return jr({error:e.message},500);}
}
async function aEnginesDelete(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    if(!b.id)return jr({error:'缺id'},400);
    try{await env.DB.prepare('DELETE FROM engines_public WHERE id=?').bind(b.id).run();return jr({ok:true});}catch(e){return jr({error:e.message},500);}
}

/* ---------- 预设管理（admin） ---------- */
async function aPresetsGet(env){
    try{
        const row=await env.DB.prepare('SELECT data FROM presets WHERE id=1').first();
        return jr({ok:true,presets:row&&row.data?JSON.parse(row.data):null});
    }catch(e){return jr({ok:true,presets:null});}
}
async function aPresetsSave(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    if(!b.presets)return jr({error:'无预设数据'},400);
    try{
        const data=JSON.stringify(b.presets);
        const ex=await env.DB.prepare('SELECT id FROM presets WHERE id=1').first();
        if(ex){await env.DB.prepare('UPDATE presets SET data=?,updated_at=? WHERE id=1').bind(data,Date.now()).run();}
        else{await env.DB.prepare('INSERT INTO presets (id,data,updated_at) VALUES (1,?,?)').bind(data,Date.now()).run();}
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- 监视（admin） ---------- */
async function aMonitor(env){
    try{
        const weekAgo=Date.now()-7*24*3600*1000;
        const sess=(await env.DB.prepare('SELECT username,MAX(last_active) AS last,COUNT(DISTINCT ip) AS ipc FROM sessions WHERE last_active>? GROUP BY username').bind(weekAgo).all()).results||[];
        const logs=(await env.DB.prepare('SELECT username,COUNT(*) AS logCount,SUM(tokens) AS totalTokens FROM logs GROUP BY username').all()).results||[];
        const recent=(await env.DB.prepare('SELECT username,chat_name,rounds,tokens,model,created_at FROM logs ORDER BY created_at DESC LIMIT 100').all()).results||[];
        return jr({ok:true,sessions:sess,logs:logs,recent:recent});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- 全局配置（admin） ---------- */
async function aConfigGet(env){
    try{const rows=(await env.DB.prepare('SELECT key,value FROM global_config').all()).results||[];const cfg={};rows.forEach(r=>cfg[r.key]=r.value);return jr({ok:true,config:cfg});}catch(e){return jr({ok:true,config:{}});}
}
async function aConfigSave(request,env){
    let b;try{b=await request.json();}catch(e){return jr({error:'格式错误'},400);}
    try{
        for(const k in(b.config||{})){
            const v=String(b.config[k]);
            const ex=await env.DB.prepare('SELECT key FROM global_config WHERE key=?').bind(k).first();
            if(ex)await env.DB.prepare('UPDATE global_config SET value=? WHERE key=?').bind(v,k).run();
            else await env.DB.prepare('INSERT INTO global_config (key,value) VALUES (?,?)').bind(k,v).run();
        }
        return jr({ok:true});
    }catch(e){return jr({error:e.message},500);}
}

/* ---------- AI 转发（公有引擎后端持Key / 私有引擎透传） ---------- */
async function hProxy(request,env,url,sub){
    const pl=await verifyUser(request,env);
    if(!pl)return jr({error:'未登录或登录已过期，请重新登录'},401);
    const auth=request.headers.get('X-Auth-Token')||'';
    if(env.DB){try{await env.DB.prepare('UPDATE sessions SET last_active=? WHERE session_id=?').bind(Date.now(),auth.slice(-16)).run();}catch(e){}}

    // 判断公有引擎（带 X-Engine-Id）还是私有（带 X-Target-Base）
    const engineId=request.headers.get('X-Engine-Id')||'';
    let targetBase,apiKey='';
    if(engineId){
        // 公有引擎：后端取Base+Key
        const e=await env.DB.prepare('SELECT * FROM engines_public WHERE id=? AND username=?').bind(engineId,pl.username).first();
        if(!e)return jr({error:'公有引擎不存在或无权使用'},403);
        targetBase=e.base_url;
        apiKey=await decKey(e.api_key,env.KEY_SECRET);
    }else{
        // 私有引擎：透传
        targetBase=request.headers.get('X-Target-Base');
        if(!targetBase)return jr({error:'Missing X-Target-Base'},400);
    }

    const targetUrl=targetBase.replace(/\/+$/,'')+'/'+sub+url.search;
    const headers=new Headers();
    const skip=['host','cf-connecting-ip','cf-ray','cf-visitor','cf-worker','cf-ipcountry','cf-ew-via','x-target-base','x-auth-token','x-engine-id','content-length','authorization'];
    for(const[k,v]of request.headers){if(!skip.includes(k.toLowerCase()))headers.set(k,v);}
    // 公有引擎用后端Key；私有引擎沿用前端传的Authorization
    if(engineId){headers.set('Authorization','Bearer '+apiKey);}
    else{const origAuth=request.headers.get('Authorization');if(origAuth)headers.set('Authorization',origAuth);}
    const isAnthropic=/\/messages\b/.test(targetUrl)||/anthropic/i.test(targetBase);
    if(isAnthropic&&!headers.has('anthropic-version'))headers.set('anthropic-version','2023-06-01');

    try{
        const resp=await fetch(targetUrl,{method:request.method,headers,body:(request.method!=='GET'&&request.method!=='HEAD')?request.body:undefined});
        const nh=new Headers(resp.headers);
        nh.set('Access-Control-Allow-Origin','*');nh.set('Access-Control-Expose-Headers','*');
        return new Response(resp.body,{status:resp.status,statusText:resp.statusText,headers:nh});
    }catch(e){return jr({error:'Proxy failed: '+e.message},502);}
}
