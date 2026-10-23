/* Dreiecks-Puzzle Cloud Sync v1.3.0 - all player data protected by Supabase Auth and RLS */
(function () {
  'use strict';
  const BASE = 'https://mbpomocjvwxjtprhqjxz.supabase.co';
  const KEY = 'sb_publishable_qtCpZ1w0pKQ2QqA56pWirg_LuCmVoHF';
  const SESSION_KEY = 'trianglePuzzleCloudSessionV1';
  const bridge = window.TriangleCloudBridge;
  const $ = id => document.getElementById(id);
  if (!bridge) return;
  let session = null, syncing = false, queued = false, timer = null;
  const M = $('cloudModal'), badge = $('cloudOpen');
  const mail = $('cloudMail'), pass = $('cloudPass'), message = $('cloudMessage');
  const signout = $('cloudSignOut');
  function msg(text, isError) { message.textContent = text; message.style.color = isError ? '#b31c35' : '#386079'; }
  function badgeText(text) { badge.textContent = text; }
  function updateUi() {
    signout.hidden = !session;
    $('cloudSignIn').hidden = !!session;
    $('cloudSignUp').hidden = !!session;
    mail.disabled = !!session;
    pass.disabled = !!session;
    if (session) {
      badgeText('☁ Spielstand online · ' + (session.user.email || 'angemeldet'));
      msg('Angemeldet als ' + (session.user.email || 'Spieler') + '. Deine Spielstände werden automatisch synchronisiert.');
    } else {
      badgeText('☁ Spielstand nur auf diesem Gerät · Anmelden');
      msg('Melde dich mit derselben E-Mail-Adresse auf allen Geräten an. Vorhandene Sterne und Bestzeiten werden übernommen.');
    }
  }
  function parse(response) { return response.text().then(t => { try { return JSON.parse(t); } catch (_) { return { msg: t }; } }); }
  async function auth(path, body) {
    const r = await fetch(BASE + '/auth/v1/' + path, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
    const data = await parse(r);
    if (!r.ok) throw Error(data.msg || data.error_description || data.message || data.error || ('HTTP ' + r.status));
    return data;
  }
  function persist(data) {
    if (!data || !data.access_token || !data.refresh_token || !data.user || !data.user.id) throw Error('Anmeldung unvollständig.');
    session = { access_token:data.access_token, refresh_token:data.refresh_token, user:{ id:data.user.id, email:data.user.email || '' }, expires_at:Date.now() + Math.max(60,Number(data.expires_in)||3600)*1000 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    updateUi();
  }
  async function validSession() {
    if (!session) return false;
    if (Date.now() < session.expires_at - 120000) return true;
    try {
      const data = await auth('token?grant_type=refresh_token', {refresh_token:session.refresh_token});
      persist(data);
      return true;
    } catch (_) {
      session = null; localStorage.removeItem(SESSION_KEY); updateUi();
      return false;
    }
  }
  async function apiSave(method, data) {
    if (!await validSession()) throw Error('Bitte erneut anmelden.');
    const q = '/rest/v1/triangle_puzzle_saves?' + (method === 'GET' ? ('user_id=eq.' + encodeURIComponent(session.user.id) + '&select=save_data') : 'on_conflict=user_id');
    const r = await fetch(BASE + q, {
      method,
      headers: {
        apikey:KEY, Authorization:'Bearer ' + session.access_token,
        'Content-Type':'application/json',
        ...(method === 'POST' ? {Prefer:'resolution=merge-duplicates,return=minimal'} : {})
      },
      ...(method === 'POST' ? {body:JSON.stringify([{user_id:session.user.id,save_data:data,updated_at:new Date().toISOString()}])} : {})
    });
    if (!r.ok) {
      const result = await parse(r);
      throw Error(result.message || result.msg || ('Datenbankfehler ' + r.status));
    }
    return method === 'GET' ? r.json() : null;
  }
  const clamp = (n,min,max) => Math.min(max,Math.max(min,Number(n)||min));
  function normalize(s) {
    s = s && typeof s === 'object' ? s : {};
    const records = {};
    const obj = s.records && typeof s.records === 'object' ? s.records : {};
    for (let i=1; i<=50; i++) {
      const x = obj[String(i)];
      if (!x || typeof x !== 'object') continue;
      const stars = Math.min(3,Math.max(0,Number(x.stars)||0));
      const best = Math.max(0,Number(x.best)||0);
      if (stars || best) records[String(i)] = {stars,best};
    }
    return {unlocked:clamp(s.unlocked,1,50),records,lastLevel:clamp(s.lastLevel || s.unlocked,1,50),
      progress: s.progress && typeof s.progress === 'object' ? s.progress : null,
      savedAt:Math.max(0,Number(s.savedAt)||0)};
  }
  function merge(a,b) {
    a=normalize(a); b=normalize(b);
    const records={...a.records};
    for (const [k,v] of Object.entries(b.records)) {
      const old=records[k] || {stars:0,best:0};
      const times=[old.best,v.best].filter(n=>n>0);
      records[k]={stars:Math.max(old.stars,v.stars),best:times.length?Math.min(...times):0};
    }
    const newer=a.savedAt >= b.savedAt ? a : b;
    return {unlocked:Math.max(a.unlocked,b.unlocked),records,
      lastLevel:newer.lastLevel,progress:newer.progress,savedAt:Math.max(a.savedAt,b.savedAt)};
  }
  function stable(s) { return JSON.stringify(normalize(s)); }
  async function sync() {
    if (!session) return;
    if (syncing) {queued=true;return;}
    syncing=true;
    badgeText('☁ Synchronisierung läuft …');
    try {
      const rows=await apiSave('GET');
      const remote=rows && rows.length ? rows[0].save_data : {};
      const local=bridge.getLocal();
      const merged=merge(local,remote);
      if (stable(local)!==stable(merged)) bridge.apply(merged);
      if (stable(remote)!==stable(merged) || !rows.length) await apiSave('POST',merged);
      badgeText('☁ Gespeichert · ' + (session.user.email || 'Online'));
    } catch(e) {
      badgeText('☁ Nur lokal gespeichert · Erneut versuchen');
      msg('Online-Speicherung nicht erreichbar: ' + e.message, true);
    } finally {
      syncing=false;
      if (queued) {queued=false; schedule(600);}
    }
  }
  function schedule(ms) {if(!session)return;clearTimeout(timer);timer=setTimeout(sync,ms || 1200);}
  window.addEventListener('triangle-puzzle-save',()=>schedule(1000));
  badge.addEventListener('click',()=>{M.classList.add('show');updateUi();});
  $('cloudClose').addEventListener('click',()=>M.classList.remove('show'));
  M.addEventListener('click',e=>{if(e.target===M)M.classList.remove('show');});
  $('cloudSignIn').addEventListener('click',async()=>{
    const email=mail.value.trim(), password=pass.value;
    if (!email || !password) return msg('Bitte E-Mail-Adresse und Passwort eingeben.',true);
    msg('Anmeldung läuft …');
    try {
      const data=await auth('token?grant_type=password',{email,password});
      persist(data);pass.value='';await sync();
      msg('Angemeldet. Deine Spielstände sind verbunden.');
      M.classList.remove('show');
    } catch(e){msg('Anmeldung fehlgeschlagen: '+e.message,true);}
  });
  $('cloudSignUp').addEventListener('click',async()=>{
    const email=mail.value.trim(),password=pass.value;
    if (!email || password.length<6) return msg('Bitte E-Mail und ein Passwort mit mindestens 6 Zeichen eingeben.',true);
    msg('Registrierung läuft …');
    try {
      const redirect=encodeURIComponent('https://lach2211.github.io/darts-checkout/dreiecks-puzzle/');
      const data=await auth('signup?redirect_to='+redirect,{email,password});
      if(data.access_token && data.user){persist(data);pass.value='';await sync();M.classList.remove('show');}
      else msg('Bestätigungs-E-Mail verschickt. Bitte den Link in der Mail öffnen und danach hier auf „Anmelden“ tippen.');
    } catch(e){msg('Registrierung fehlgeschlagen: '+e.message,true);}
  });
  signout.addEventListener('click',async()=>{
    try {
      if (session) await fetch(BASE+'/auth/v1/logout',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}});
    } catch(_){}
    session=null;localStorage.removeItem(SESSION_KEY);pass.value='';clearTimeout(timer);updateUi();
    msg('Abgemeldet. Der bisherige Spielstand bleibt auf diesem Gerät gespeichert.');
  });
  window.addEventListener('online',()=>schedule(250));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && session)schedule(350);});
  (async function start() {
    try { const old=JSON.parse(localStorage.getItem(SESSION_KEY)||'null'); if(old && old.user && old.refresh_token)session=old;}catch(_){}
    updateUi();
    if(session)await sync();
  })();
})();