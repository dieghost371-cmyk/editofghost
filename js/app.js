/* ================= FIREBASE (safe init — page still works if this fails to load) ================= */
const firebaseConfig = {
  apiKey: "AIzaSyBaNBRcLZGNI8PYMrgdMGVF_87HvI-TcLg",
  authDomain: "ghosteditz-3d4f7.firebaseapp.com",
  databaseURL: "https://ghosteditz-3d4f7-default-rtdb.firebaseio.com",
  projectId: "ghosteditz-3d4f7",
  storageBucket: "ghosteditz-3d4f7.firebasestorage.app",
  messagingSenderId: "398300596363",
  appId: "1:398300596363:web:58c58b73d16cd3182f2c8e",
  measurementId: "G-D6KD66CFVL"
};

let auth, db;
try{
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.database();
}catch(e){
  console.error('Firebase failed to load — check internet connection.', e);
  const offlineErr = ()=>Promise.reject({code:'offline', message:'No connection to Firebase — check your internet.'});
  auth = {
    currentUser:null,
    onAuthStateChanged:(cb)=>cb(null),
    signOut:()=>Promise.resolve(),
    signInWithEmailAndPassword:offlineErr,
    createUserWithEmailAndPassword:offlineErr,
    signInWithPopup:offlineErr
  };
  const dummyRef = { push:offlineErr, set:offlineErr, update:offlineErr, remove:offlineErr, on:()=>{}, off:()=>{}, once:offlineErr, orderByChild(){return this;} };
  db = { ref:()=>dummyRef };
}

const ADMIN_EMAIL = "dieghost371@gmail.com";
function isAdminUser(u){ return !!(u && u.email && u.email.toLowerCase()===ADMIN_EMAIL); }

// shared state (declared early so nothing hits it before initialisation)
let pendingImage = null;      // compressed photo waiting to be posted
let editingId = null;
let editingOldUrl = '';
let adminItems = {};          // id -> post, used by Edit / Delete buttons
let adminRef = null, msgsRef = null, ordersRef = null, myOrdersRef = null, customersRef = null, myCustomerMsgsRef = null;
let _adminOrdersSnap = [], _adminCustomersSnap = {};
const imgCache = {};

/* ================= BACKGROUND (device based live wallpaper — CSS handles visibility, this just nudges playback) ================= */
(function setBackground(){
  try{
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    const mobileVid = document.getElementById('bg-video-mobile');
    const desktopVid = document.getElementById('bg-video-desktop');
    const active = isMobile ? mobileVid : desktopVid;
    if(active) active.play().catch(()=>{ /* autoplay blocked, video stays as static frame */ });
  }catch(e){ /* background video is optional, never block the page */ }
})();

/* ================= TIKTOK PROFILE SEARCH ================= */
/*
  SearchApi.io is used here for the public TikTok profile + profile-videos feeds.
  IMPORTANT: do not publish a real SearchApi key in a public GitHub repository.
  For a production site, move these two requests to your server/backend.
*/
const TIKTOK_API_KEY = "E2ed4aJVUHr4R45KT3bQaRUS";
const SEARCHAPI_TIKTOK_URL = "https://www.searchapi.io/api/v1/search";
let ttUsername = "";
let ttSort = "latest";
let ttNextToken = null;
let ttLoading = false;

function ttEsc(v){
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function ttNum(n){
  n = Number(n || 0);
  if(n >= 1e9) return (n/1e9).toFixed(n>=1e10?0:1)+'B';
  if(n >= 1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M';
  if(n >= 1e3) return (n/1e3).toFixed(n>=1e4?0:1)+'K';
  return String(n);
}
function ttDuration(sec){
  sec = Math.max(0, Number(sec||0));
  const m=Math.floor(sec/60), s=String(sec%60).padStart(2,'0');
  return `${m}:${s}`;
}
function ttApiReady(){
  return TIKTOK_API_KEY && !TIKTOK_API_KEY.includes('PASTE_YOUR');
}
function ttSetMessage(msg, bad=true){
  const el=document.getElementById('tiktokMsg');
  if(!el) return;
  el.textContent=msg||'';
  el.style.color=bad ? 'var(--blood)' : 'var(--ink-dim)';
}
async function ttRequest(params){
  if(!ttApiReady()) throw new Error('Add your SearchApi.io API key in TIKTOK_API_KEY first.');
  const u=new URL(SEARCHAPI_TIKTOK_URL);
  u.searchParams.set('api_key',TIKTOK_API_KEY);
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined && v!==null && v!=='') u.searchParams.set(k,v); });
  const res=await fetch(u.toString(),{headers:{'Accept':'application/json'}});
  let data=null;
  try{ data=await res.json(); }catch(_){ throw new Error('TikTok API returned an invalid response.'); }
  if(!res.ok || data?.error) throw new Error(data?.error?.message || data?.message || `TikTok API error (${res.status})`);
  return data;
}
async function searchTikTokProfile(){
  const input=document.getElementById('tiktokUsername');
  const username=(input?.value||'').trim().replace(/^@/,'');
  if(!username){ ttSetMessage('Enter a TikTok username.'); return; }
  ttUsername=username;
  ttSort='latest';
  ttNextToken=null;
  document.getElementById('tiktokProfile').style.display='none';
  document.getElementById('tiktokSortBar').style.display='none';
  document.getElementById('tiktokMore').style.display='none';
  document.getElementById('tiktokVideos').innerHTML='<div class="tt-loading">Searching TikTok…</div>';
  ttSetMessage('',false);
  try{
    const [profileData,videosData]=await Promise.all([
      ttRequest({engine:'tiktok_profile',username}),
      ttRequest({engine:'tiktok_profile_videos',username,sort_by:'latest'})
    ]);
    renderTikTokProfile(profileData.profile || videosData.profile);
    renderTikTokVideos(videosData.videos || []);
    ttNextToken=videosData?.pagination?.next_page_token || null;
    document.getElementById('tiktokProfile').style.display='block';
    document.getElementById('tiktokSortBar').style.display='flex';
    document.getElementById('tiktokMore').style.display=ttNextToken?'block':'none';
    if(!videosData?.videos?.length) document.getElementById('tiktokVideos').innerHTML='<div class="tt-empty">No public videos were returned for this profile.</div>';
  }catch(err){
    document.getElementById('tiktokVideos').innerHTML='';
    ttSetMessage(err.message || 'Could not load this TikTok profile.');
  }
}
function renderTikTokProfile(p){
  const box=document.getElementById('tiktokProfile');
  if(!p){ box.innerHTML=''; return; }
  const avatar=p.avatar_hd || p.avatar || '';
  const initial=ttEsc((p.name||p.username||'?').charAt(0).toUpperCase());
  box.innerHTML=`
    <div class="tiktok-profile-card">
      ${avatar ? `<img src="${ttEsc(avatar)}" alt="TikTok avatar" onerror="this.style.display='none'">` : `<div class="tt-avatar-fallback">${initial}</div>`}
      <div class="tt-profile-main">
        <div class="tt-profile-name">${ttEsc(p.name||p.username||'TikTok User')}${p.is_verified ? '<span class="tt-verified">✓ VERIFIED</span>' : ''}</div>
        <div class="tt-profile-user">@${ttEsc(p.username||'')} · <a href="${ttEsc(p.link||`https://www.tiktok.com/@${encodeURIComponent(p.username||'')}`)}" target="_blank" rel="noopener">Open TikTok ↗</a></div>
        <div class="tt-bio">${ttEsc(p.bio||'')}</div>
        <div class="tt-stats">
          <div class="tt-stat"><b>${ttNum(p.followers)}</b><span>FOLLOWERS</span></div>
          <div class="tt-stat"><b>${ttNum(p.following)}</b><span>FOLLOWING</span></div>
          <div class="tt-stat"><b>${ttNum(p.posts)}</b><span>POSTS</span></div>
          <div class="tt-stat"><b>${ttNum(p.hearts)}</b><span>LIKES</span></div>
        </div>
      </div>
    </div>`;
}
function setTtSortButtons(){
  ['latest','popular','oldest'].forEach(x=>document.getElementById('ttSort'+x.charAt(0).toUpperCase()+x.slice(1))?.classList.toggle('active',ttSort===x));
}
async function loadTikTokVideos(sort){
  if(!ttUsername) return;
  ttSort=sort; ttNextToken=null; ttLoading=true; setTtSortButtons();
  const list=document.getElementById('tiktokVideos');
  list.innerHTML='<div class="tt-loading">Loading videos…</div>';
  document.getElementById('tiktokMore').style.display='none';
  try{
    const data=await ttRequest({engine:'tiktok_profile_videos',username:ttUsername,sort_by:ttSort});
    renderTikTokVideos(data.videos||[]);
    ttNextToken=data?.pagination?.next_page_token||null;
    document.getElementById('tiktokMore').style.display=ttNextToken?'block':'none';
  }catch(err){ list.innerHTML=`<div class="tt-empty">${ttEsc(err.message||'Could not load videos.')}</div>`; }
  finally{ttLoading=false;}
}
function renderTikTokVideos(videos,append=false){
  const list=document.getElementById('tiktokVideos');
  if(!append) list.innerHTML='';
  videos.forEach(v=>{
    const card=document.createElement('article');
    card.className='tt-video-card';
    card.onclick=()=>openTikTokPlayer(v);
    card.innerHTML=`
      <div class="tt-thumb-wrap">
        <img class="tt-thumb" src="${ttEsc(v.thumbnail||v.dynamic_thumbnail||'')}" alt="TikTok video thumbnail" loading="lazy" onerror="this.style.background='#111'">
        <span class="tt-play">▶</span>
        ${v.duration ? `<span class="tt-duration">${ttDuration(v.duration)}</span>` : ''}
      </div>
      <div class="tt-video-body">
        <div class="tt-caption">${ttEsc(v.caption||'TikTok video')}</div>
        <div class="tt-meta"><span>▶ ${ttNum(v.views)}</span><span>♥ ${ttNum(v.likes)}</span><span>💬 ${ttNum(v.comments)}</span><span>↗ ${ttNum(v.shares)}</span></div>
      </div>`;
    list.appendChild(card);
  });
}
async function loadMoreTikTokVideos(){
  if(!ttNextToken || ttLoading || !ttUsername) return;
  ttLoading=true;
  const btn=document.getElementById('tiktokMore');
  btn.disabled=true; btn.textContent='LOADING…';
  try{
    const data=await ttRequest({engine:'tiktok_profile_videos',username:ttUsername,sort_by:ttSort,next_page_token:ttNextToken});
    renderTikTokVideos(data.videos||[],true);
    ttNextToken=data?.pagination?.next_page_token||null;
    btn.style.display=ttNextToken?'block':'none';
  }catch(err){ ttSetMessage(err.message||'Could not load more videos.'); }
  finally{ttLoading=false;btn.disabled=false;btn.textContent='LOAD MORE VIDEOS';}
}
function openTikTokPlayer(v){
  const modal=document.getElementById('tiktokPlayerModal');
  const player=document.getElementById('tiktokPlayer');
  document.getElementById('tiktokPlayerTitle').textContent=v.caption ? String(v.caption).slice(0,80) : 'TikTok Video';
  player.innerHTML=`
    <blockquote class="tiktok-embed" cite="${ttEsc(v.link)}" data-video-id="${ttEsc(v.id)}" style="max-width:605px;min-width:325px;width:100%;margin:0;">
      <section><a target="_blank" href="${ttEsc(v.link)}">View this video on TikTok</a></section>
    </blockquote>`;
  modal.style.display='flex';
  if(window.tiktokEmbedLoad) window.tiktokEmbedLoad();
  else{
    const sc=document.createElement('script');
    sc.src='https://www.tiktok.com/embed.js'; sc.async=true;
    sc.onload=()=>window.tiktokEmbedLoad?.();
    document.body.appendChild(sc);
  }
}
function closeTikTokPlayer(){
  const modal=document.getElementById('tiktokPlayerModal');
  modal.style.display='none';
  document.getElementById('tiktokPlayer').innerHTML='';
}
window.addEventListener('keydown',e=>{if(e.key==='Escape') closeTikTokPlayer();});

/* ================= APPS (public page + admin) ================= */
const DEFAULT_APPS = [{
  id:'builtin-tiktok-you', builtin:true, name:'TikTok You',
  logo:'https://i.ibb.co/5WvrwmY1/tiktok-you-android.webp',
  link:'https://www.mediafire.com/file/ko2ccxriqmtmvwi/TikTok_You-4.4-(46.8.3)+(1).apk/file',
  ver:'v4.4 (46.8.3)', desc:'TikTok You for Android — free APK download.'
}];
let dbApps = [];          // apps added from the admin panel
let appsRef = null, adminAppsRef = null, appEditingId = null, adminAppsMap = {};
let appsShown = [];       // what is currently drawn on the Apps page

function safeUrl(u){ u = String(u||'').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
function logoSrc(u){ u = String(u||'').trim(); return /^data:image\/(png|jpeg|webp);base64,/i.test(u) ? u : safeUrl(u); }

/* ---- app image picked from the phone gallery (stored inside the app record) ---- */
let pendingAppLogo = null;
function compressLogo(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('That file is not a valid image.'));
      img.onload = ()=>{
        let side = 256, q = 0.88;
        for(let i=0;i<6;i++){
          const scale = Math.min(1, side/Math.max(img.width,img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1,Math.round(img.width*scale));
          c.height = Math.max(1,Math.round(img.height*scale));
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          let out = c.toDataURL('image/webp', q);
          if(out.indexOf('data:image/webp')!==0) out = c.toDataURL('image/png');
          if(out.length < 120000) return resolve(out);
          side *= 0.8; q = Math.max(0.5, q-0.08);
        }
        reject(new Error('Image is too large — pick a smaller one.'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function showAppLogoPreview(src){
  const pv = document.getElementById('appLogoPreview'), cl = document.getElementById('appLogoClear');
  if(src){ pv.src = src; pv.style.display = 'block'; cl.style.display = 'inline-block'; }
  else { pv.removeAttribute('src'); pv.style.display = 'none'; cl.style.display = 'none'; }
}
function pickAppLogo(input){
  const f = input.files && input.files[0]; if(!f) return;
  const msg = document.getElementById('appMsg'); msg.style.color=''; msg.textContent='';
  compressLogo(f).then(data=>{ pendingAppLogo = data; showAppLogoPreview(data); })
    .catch(err=>{ msg.textContent = err.message; input.value=''; });
}
function clearAppLogo(){
  pendingAppLogo = null;
  document.getElementById('appLogoFile').value = '';
  showAppLogoPreview(null);
}

function startAppsListener(){
  if(appsRef) return;
  try{
    appsRef = db.ref('apps').orderByChild('createdAt');
    appsRef.on('value', snap=>{
      const items = [];
      snap.forEach(c=>{ items.push({id:c.key, ...c.val()}); });
      dbApps = items;
      renderApps();
    }, ()=>{ dbApps = []; renderApps(); });
  }catch(e){ dbApps = []; }
}

function renderApps(){
  const box = document.getElementById('appsList');
  if(!box) return;
  appsShown = DEFAULT_APPS.concat(dbApps.slice().reverse()); // TikTok You first, then newest admin apps
  box.innerHTML = appsShown.map((a,i)=>`
    <div class="app-card" style="animation-delay:${i*0.08}s">
      ${i===0 ? '<span class="app-new">NEW</span>' : ''}
      <img class="app-logo" src="${escapeHtml(logoSrc(a.logo))}" alt="${escapeHtml(a.name)}" onerror="this.style.visibility='hidden'">
      <h3>${escapeHtml(a.name)}</h3>
      <div class="app-ver">ANDROID · APK${a.ver ? ' · '+escapeHtml(a.ver) : ''}</div>
      <p>${escapeHtml(a.desc||'')}</p>
      <button class="dl-anim" onclick="startAppDownload(this, ${i})">
        <span class="dl-fill"></span>
        <span class="dl-label"><span class="dl-ico">⬇</span><span class="dl-txt">DOWNLOAD</span></span>
      </button>
    </div>`).join('');
}

function startAppDownload(btn, idx){
  const app = appsShown[idx]; if(!app) return;
  const url = safeUrl(app.link); if(!url){ toast('Download link missing.'); return; }
  if(btn.classList.contains('busy')) return;
  const fill = btn.querySelector('.dl-fill'), txt = btn.querySelector('.dl-txt'), ico = btn.querySelector('.dl-ico');
  btn.classList.remove('done'); btn.classList.add('busy');
  const dur = 2600, t0 = performance.now();
  (function tick(now){
    let t = Math.min(1, (now - t0) / dur);
    const e = t<.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;      // ease in-out
    const pct = Math.round(e*100);
    fill.style.width = pct+'%';
    txt.textContent = pct<100 ? 'DOWNLOADING '+pct+'%' : 'FINISHING...';
    if(t<1){ requestAnimationFrame(tick); return; }
    btn.classList.remove('busy'); btn.classList.add('done');
    ico.textContent = '✓'; txt.textContent = 'DOWNLOADED';
    dlSparks(btn);
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('download','');
    document.body.appendChild(a); a.click(); a.remove();
    toast(app.name+' download started');
    setTimeout(()=>{ btn.classList.remove('done'); fill.style.width='0'; ico.textContent='⬇'; txt.textContent='DOWNLOAD AGAIN'; }, 3200);
  })(t0);
}

function dlSparks(btn){
  const colors = ['#39ff8f','#ffffff','#ff7a18','#ff1b4c','#00e5ff'];
  for(let i=0;i<18;i++){
    const s = document.createElement('i'); s.className='dl-spark';
    const ang = Math.random()*Math.PI*2, d = 30+Math.random()*50;
    s.style.left='50%'; s.style.top='50%';
    s.style.background = colors[i%colors.length];
    s.style.setProperty('--dx', Math.cos(ang)*d+'px');
    s.style.setProperty('--dy', Math.sin(ang)*d+'px');
    btn.appendChild(s); setTimeout(()=>s.remove(), 900);
  }
}

/* ---- admin: add / edit / delete apps ---- */
function loadAdminApps(){
  const list = document.getElementById('adminApps');
  if(adminAppsRef) adminAppsRef.off('value');
  adminAppsRef = db.ref('apps').orderByChild('createdAt');
  adminAppsRef.on('value', snap=>{
    const items = []; adminAppsMap = {};
    snap.forEach(c=>{ const it={id:c.key, ...c.val()}; items.push(it); adminAppsMap[it.id]=it; });
    items.reverse();
    let h = `<div class="update"><h3>${escapeHtml(DEFAULT_APPS[0].name)} <span class="admin-chip">BUILT-IN</span></h3><div class="meta">${escapeHtml(DEFAULT_APPS[0].ver)}</div></div>`;
    h += items.map(a=>`
      <div class="update">
        <h3>${escapeHtml(a.name||'')}</h3>
        <div class="meta">${escapeHtml(a.ver||'')} ${a.createdAt ? '· '+new Date(a.createdAt).toLocaleString() : ''}</div>
        <p style="word-break:break-all;font-size:12px;">${escapeHtml(a.link||'')}</p>
        <div class="admin-row">
          <button onclick="editApp('${a.id}')" style="border-color:var(--cyan);color:var(--cyan);">Edit</button>
          <button onclick="deleteApp('${a.id}')">Delete</button>
        </div>
      </div>`).join('');
    list.innerHTML = h;
  }, err=>{
    list.innerHTML = '<div class="empty-note">Cannot load apps: '+escapeHtml(err.message)+'</div>';
  });
}

function saveApp(){
  const msg = document.getElementById('appMsg'), btn = document.getElementById('appSubmitBtn');
  const name = document.getElementById('appName').value.trim();
  const logo = pendingAppLogo || document.getElementById('appLogo').value.trim();
  const link = document.getElementById('appLink').value.trim();
  const ver  = document.getElementById('appVer').value.trim();
  const desc = document.getElementById('appDesc').value.trim();
  msg.style.color=''; msg.textContent='';
  if(!name){ msg.textContent='App name is required.'; return; }
  if(!logoSrc(logo)){ msg.textContent='Pick an image from your gallery (or paste a direct image link).'; return; }
  if(!safeUrl(link)){ msg.textContent='Download link must start with https://'; return; }
  btn.disabled = true;
  const payload = { name, logo, link, ver, desc, author: auth.currentUser.email };
  const op = appEditingId
    ? db.ref('apps/'+appEditingId).update({...payload, updatedAt: Date.now()})
    : db.ref('apps').push({...payload, createdAt: Date.now()});
  op.then(()=>{ toast(appEditingId ? 'App saved!' : 'App added!'); cancelAppEdit(); })
    .catch(err=>{
      msg.textContent = /permission/i.test(err.message||'')
        ? 'Permission denied — add a database rule for "apps" (read: true, write: admin only).'
        : err.message;
    }).finally(()=>{ btn.disabled = false; });
}

function editApp(id){
  const a = adminAppsMap[id]; if(!a) return;
  appEditingId = id;
  document.getElementById('appName').value = a.name||'';
  clearAppLogo();
  if(/^data:image\//i.test(a.logo||'')){ pendingAppLogo = a.logo; showAppLogoPreview(a.logo); document.getElementById('appLogo').value = ''; }
  else { document.getElementById('appLogo').value = a.logo||''; showAppLogoPreview(safeUrl(a.logo)||null); }
  document.getElementById('appLink').value = a.link||'';
  document.getElementById('appVer').value  = a.ver||'';
  document.getElementById('appDesc').value = a.desc||'';
  document.getElementById('appFormTitle').textContent = 'Editing Application';
  document.getElementById('appSubmitBtn').textContent = 'Save Changes';
  document.getElementById('appCancelBtn').style.display = 'inline-block';
  document.getElementById('appName').scrollIntoView({behavior:'smooth', block:'center'});
}

function cancelAppEdit(){
  appEditingId = null;
  ['appName','appLogo','appLink','appVer','appDesc'].forEach(i=>document.getElementById(i).value='');
  clearAppLogo();
  document.getElementById('appFormTitle').textContent = 'Add New Application';
  document.getElementById('appSubmitBtn').textContent = 'Add Application';
  document.getElementById('appCancelBtn').style.display = 'none';
  document.getElementById('appMsg').textContent = '';
}

function deleteApp(id){
  if(!confirm('Delete this app?')) return;
  db.ref('apps/'+id).remove().then(()=>toast('Deleted.')).catch(err=>toast(err.message));
}

/* ================= ROUTER ================= */
const PAGES = ["home","updates","mygame","apps","music","wallpapers","tiktok","videos","orders","contact","privacy","auth","profile","admin"];
let authMode = "login"; // or "signup"

/* ---------- per-page background wallpaper ---------- */
const PAGE_BG = {
  home:   { mobile:'https://livegirl.edgeone.dev/',          desktop:'https://livepc.edgeone.dev/' },
  admin:  { mobile:'https://monileadmin.edgeone.dev/',       desktop:'https://pcadmin.edgeone.dev/' },
  updates:{ mobile:'https://itachimobile.edgeone.dev/',      desktop:'https://itachipc.edgeone.dev/' },
  music:  { mobile:'https://gtrmobile.edgeone.dev/',         desktop:'https://gtrr35oc.edgeone.dev/' },
  orders: { mobile:'https://carsportgirlmobile.edgeone.dev/',desktop:'https://carsportgirlmobile.edgeone.dev/' },
  apps:   { mobile:'https://animegirlgtrmobile.edgeone.dev/',desktop:'https://lovely-coral-vn8syagj.edgeone.dev/' },
  mygame: { mobile:'https://animegirlgtrmobile.edgeone.dev/',desktop:'https://lovely-coral-vn8syagj.edgeone.dev/' },
  tiktok: { mobile:'https://livegirl.edgeone.dev/',desktop:'https://livepc.edgeone.dev/' }
};
function updatePageBackground(page){
  const bg = PAGE_BG[page] || PAGE_BG.home;
  const mobileVid = document.getElementById('bg-video-mobile');
  const desktopVid = document.getElementById('bg-video-desktop');
  if(mobileVid && mobileVid.src !== bg.mobile){
    mobileVid.classList.remove('ready');
    mobileVid.src = bg.mobile; mobileVid.load(); mobileVid.play().catch(()=>{});
  }
  if(desktopVid && desktopVid.src !== bg.desktop){
    desktopVid.classList.remove('ready');
    desktopVid.src = bg.desktop; desktopVid.load(); desktopVid.play().catch(()=>{});
  }
}
['bg-video-mobile','bg-video-desktop'].forEach(id=>{
  const v = document.getElementById(id);
  if(!v) return;
  if(v.readyState >= 2) v.classList.add('ready'); // already loaded before this listener attached
  v.addEventListener('loadeddata', ()=>v.classList.add('ready'));
});

function go(page){
  if(!PAGES.includes(page)) page = "home";
  PAGES.forEach(p=>{
    document.getElementById('page-'+p).classList.toggle('active', p===page);
  });
  document.querySelectorAll('nav.links button').forEach(b=>{
    b.classList.toggle('active', b.dataset.p===page);
  });
  document.querySelector('nav.links').classList.remove('open');
  window.scrollTo({top:0,behavior:'smooth'});
  window.location.hash = page;
  updatePageBackground(page);
  updateHomeUserBadge(auth.currentUser);
  if(page==='profile') renderProfile();
  if(page==='admin') renderAdmin();
  if(page==='apps') renderApps();
  if(page==='wallpapers') renderWallpapers();
  if(page!=='music'){ stopPreview(); closeFullPlayer(); }
  if(page==='updates') markUpdatesSeen();
}
window.addEventListener('hashchange', ()=>{
  const p = window.location.hash.replace('#','');
  if(PAGES.includes(p)) go(p);
});

/* ================= PRIVATE VIDEOS ================= */
// This is a simple front-end gate, not strong security: the password and source URLs
// are necessarily present in the public HTML/JavaScript.
const VIDEO_PAGE_PASSWORD = '12345678';
let videosUnlocked = false;
function unlockVideos(){
  const input = document.getElementById('videoPassword');
  const msg = document.getElementById('videoPasswordMsg');
  if(!input) return;
  if(input.value === VIDEO_PAGE_PASSWORD){
    videosUnlocked = true;
    document.getElementById('videoGate').style.display = 'none';
    document.getElementById('videoList').style.display = 'grid';
    msg.textContent = '';
    input.value = '';
  }else{
    msg.textContent = 'Wrong password.';
  }
}

/* ================= MUSIC SEARCH (iTunes Search API — free, no key, 30s previews) ================= */
let previewAudio = null;
let previewPlayingRow = null;
let wasSiteAudioPlaying = false;

async function searchMusic(){
  const q = document.getElementById('musicSearchInput').value.trim();
  const results = document.getElementById('musicResults');
  if(!q){ results.innerHTML = '<div class="music-empty">Type something to search.</div>'; return; }
  results.innerHTML = '<div class="music-empty">Searching…</div>';
  try{
    const res = await fetch('https://itunes.apple.com/search?media=music&limit=25&term=' + encodeURIComponent(q));
    const data = await res.json();
    if(!data.results || !data.results.length){
      results.innerHTML = '<div class="music-empty">No results. Try a different search.</div>';
      return;
    }
    results.innerHTML = '';
    data.results.forEach((track, i)=>{
      const row = document.createElement('div');
      row.className = 'music-row';
      row.dataset.idx = i;
      const fullQuery = `${track.trackName || ''} ${track.artistName || ''}`.trim();
      row.innerHTML = `
        <img src="${track.artworkUrl60 || ''}" alt="" onerror="this.style.visibility='hidden'">
        <div class="mtxt"><b>${escapeHtml(track.trackName || 'Unknown title')}</b><span>${escapeHtml(track.artistName || '')}</span></div>
        <div class="mplay">▶ PREVIEW</div>
        <div class="mfull" style="margin-left:8px;font-family:'Orbitron';font-size:10px;letter-spacing:1px;
          color:var(--blood);border:1px solid var(--blood);padding:6px 10px;cursor:pointer;white-space:nowrap;">FULL SONG</div>
      `;
      row.querySelector('.mplay').onclick = (e)=>{ e.stopPropagation(); playPreview(track.previewUrl, row); };
      row.querySelector('.mfull').onclick = (e)=>{ e.stopPropagation(); playFullSong(fullQuery, track.trackName, track.artistName); };
      results.appendChild(row);
    });
  }catch(e){
    results.innerHTML = '<div class="music-empty">Search failed — check your connection and try again.<br><span style="font-size:11px;opacity:.7;">(' + escapeHtml(e.message||'') + ')</span></div>';
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function playPreview(url, row){
  if(!url) return;
  // toggle off if the same row is tapped again
  if(previewPlayingRow === row){
    stopPreview();
    return;
  }
  if(!previewAudio){
    previewAudio = new Audio();
    previewAudio.addEventListener('ended', stopPreview);
  }
  if(!previewPlayingRow){
    wasSiteAudioPlaying = !bgAudio.paused;
    bgAudio.pause();
  }
  if(previewPlayingRow) previewPlayingRow.classList.remove('playing');
  previewAudio.src = url;
  previewAudio.play().catch(()=>{});
  row.classList.add('playing');
  previewPlayingRow = row;
}

function stopPreview(){
  if(previewAudio){ previewAudio.pause(); }
  if(previewPlayingRow) previewPlayingRow.classList.remove('playing');
  previewPlayingRow = null;
  if(wasSiteAudioPlaying){ bgAudio.play().catch(()=>{}); }
}

/* Full-length playback via YouTube's own embed player (no API key needed —
   listType=search plays the best-matching real upload as a queue). This is
   YouTube's official player, so nothing is downloaded or re-hosted. */
/* Full-length playback via YouTube's official IFrame Player API (no API key
   needed for this part — only the Data API's *search* would need a key).
   We queue a "search as playlist" and, if a particular video refuses to
   embed, jump to the next matching result automatically instead of getting
   stuck on a dead player. */
let ytApiReady = false;
let ytPlayer = null;
let ytPendingQuery = null;
let ytErrorRetries = 0;
(function loadYouTubeApi(){
  if(document.getElementById('yt-iframe-api')) return;
  const tag = document.createElement('script');
  tag.id = 'yt-iframe-api';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
})();
window.onYouTubeIframeAPIReady = function(){
  ytApiReady = true;
  if(ytPendingQuery){ const q = ytPendingQuery; ytPendingQuery = null; startYtPlayback(q); }
};

function startYtPlayback(query){
  ytErrorRetries = 0;
  document.getElementById('fullPlayerMsg').style.display = 'none';
  if(!ytPlayer){
    ytPlayer = new YT.Player('fullPlayerFrame', {
      width:'100%', height:'100%',
      playerVars:{ listType:'search', list:query, autoplay:1 },
      events:{ onError:onYtError }
    });
    const fitFrame = setInterval(()=>{
      const f = ytPlayer.getIframe && ytPlayer.getIframe();
      if(f){
        f.style.position='absolute'; f.style.top=0; f.style.left=0;
        f.style.width='100%'; f.style.height='100%'; f.style.border='0';
        clearInterval(fitFrame);
      }
    }, 200);
  } else {
    ytPlayer.loadPlaylist({listType:'search', list:query});
  }
}

function onYtError(e){
  ytErrorRetries++;
  if(ytErrorRetries <= 6){
    try{ e.target.nextVideo(); }catch(err){}
  } else {
    document.getElementById('fullPlayerMsg').style.display = 'block';
  }
}

let fullPlayerWasSiteAudioPlaying = false;
function playFullSong(query, title, artist){
  stopPreview();
  fullPlayerWasSiteAudioPlaying = !bgAudio.paused;
  bgAudio.pause();
  const wrap = document.getElementById('fullPlayerWrap');
  document.getElementById('fullPlayerTitle').textContent = `${title || ''} — ${artist || ''}`;
  document.getElementById('fullPlayerYtLink').href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
  wrap.style.display = 'block';
  wrap.scrollIntoView({behavior:'smooth', block:'center'});
  if(ytApiReady){ startYtPlayback(query); } else { ytPendingQuery = query; }
}

function closeFullPlayer(){
  const wrap = document.getElementById('fullPlayerWrap');
  if(ytPlayer && ytPlayer.stopVideo){ try{ ytPlayer.stopVideo(); }catch(e){} }
  wrap.style.display = 'none';
  if(fullPlayerWasSiteAudioPlaying){ bgAudio.play().catch(()=>{}); }
}

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ================= ORDERS ================= */
const VPN_PREMIUM = [
  { name:'100GB Plan', price:200, features:['100GB Premium Bandwidth','Private Dedicated Client config','30-Day Active Validity','Multi-Network SNI Config','24/7 Priority Support'] },
  { name:'200GB Plan', price:300, hot:true, features:['200GB Premium Bandwidth','Private Dedicated Client config','30-Day Active Validity','Multi-Network SNI Config','24/7 Priority Support'] },
  { name:'300GB Plan', price:400, features:['300GB Premium Bandwidth','Private Dedicated Client config','30-Day Active Validity','Multi-Network SNI Config','24/7 Priority Support'] },
  { name:'Unlimited Plan', price:600, features:['Truly Unlimited Bandwidth','Private Dedicated Client config','30-Day Active Validity','Multi-Network SNI Config','24/7 Priority Support'] }
];
const VPN_BYPASS = [
  { name:'50GB Bypass Plan', price:200, features:['50GB Premium Bypass Bandwidth','Unlimited Bypass Speed (5G Support)','Dialog 348/488/1188 Packages Bypass','Dedicated Private Client Config','30-Day Active Validity'] },
  { name:'100GB Bypass Plan', price:300, hot:true, features:['100GB Premium Bypass Bandwidth','Unlimited Bypass Speed (5G Support)','Dialog 348/488/1188 Packages Bypass','Dedicated Private Client Config','30-Day Active Validity'] },
  { name:'350GB Bypass Plan', price:600, features:['350GB Premium Bypass Bandwidth','Unlimited Bypass Speed (5G Support)','Dialog 348/488/1188 Packages Bypass','Dedicated Private Client Config','30-Day Active Validity'] }
];
const WEBSITE_PLANS = [
  { name:'Normal Website', price:500, icon:'💻', features:['Simple informational site','Up to 5 pages','Mobile responsive'] },
  { name:'Business Website', price:1000, icon:'💼', features:['Professional business site','Contact & services pages','Mobile responsive'] },
  { name:'Gaming Website', price:2000, icon:'🎮', features:['Gaming-style design','Custom effects & theme','Mobile responsive'] },
  { name:'Both (Business + Gaming)', price:3500, icon:'🔥', features:['Combined feature set','Fully custom design','Mobile responsive'] }
];
const DESIGNER_PLANS = [
  { name:'Logo Design', price:100, icon:'🎨', features:['Custom logo design','2-3 concept revisions','High-res PNG file'] },
  { name:'Banner Design', price:100, icon:'🖼️', features:['Custom banner (YouTube/social)','Sized to your platform','High-res file'] },
  { name:'Thumbnail Design', price:200, icon:'🎬', features:['Eye-catching video thumbnail','Text + effects included','High-res file'] }
];

/* ================= MINECRAFT SERVER PLANS ================= */
/* MC_PANEL_URL = where your hosting panel/backend runs (the VPS). Change this one line if the address changes. */
const MC_PANEL_URL = 'https://mc.ghosteditz.work.gd';
/* ids + prices must match backend/config/plans.js */
const MC_PLANS = [
  { id:'mc_2gb', name:'Starter — 2GB', price:400, icon:'⛏️', features:['2GB RAM · 20 players','Real plugins / mods','24/7 online + auto-restart','Own IP & port','Web console & file manager'] },
  { id:'mc_4gb', name:'Standard — 4GB', price:800, icon:'🧱', hot:true, features:['4GB RAM · 40 players','Real plugins / mods','24/7 online + auto-restart','Own IP & port','Web console & file manager'] },
  { id:'mc_6gb', name:'Pro — 6GB', price:1200, icon:'💎', features:['6GB RAM · 60 players','Real plugins / mods','24/7 online + auto-restart','Own IP & port','Web console & file manager'] },
  { id:'mc_8gb', name:'Ultra — 8GB', price:1600, icon:'🐉', features:['8GB RAM · 100 players','Real plugins / mods','24/7 online + auto-restart','Own IP & port','Web console & file manager'] }
];
function renderMcCard(plan){
  return `
    <div class="order-card">
      ${plan.hot ? '<span style="align-self:flex-end;background:var(--cyan);color:#000;font-family:\'Orbitron\';font-size:9px;padding:3px 8px;border-radius:2px;">HOT</span>' : ''}
      <div style="font-size:28px;">${plan.icon}</div>
      <div class="oc-name">${escapeHtml(plan.name)}</div>
      <div class="oc-price">Rs. ${plan.price}<span> /month</span></div>
      <ul>${plan.features.map(f=>`<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <button class="btn" style="margin-top:6px;" onclick='openOrder("minecraft", ${JSON.stringify("Minecraft "+plan.name)}, ${plan.price}, ${JSON.stringify(plan.id)})'>ORDER SERVER</button>
    </div>`;
}
async function loadMcVersions(){
  const sw = document.getElementById('mcSoftware').value;
  const sel = document.getElementById('mcVersion');
  sel.innerHTML = '<option value="">Loading versions…</option>';
  try{
    const r = await fetch(MC_PANEL_URL + '/api/versions/' + encodeURIComponent(sw));
    const j = await r.json();
    if(!r.ok || !j.versions || !j.versions.length) throw new Error('none');
    sel.innerHTML = j.versions.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }catch(e){
    sel.innerHTML = '<option value="">Versions unavailable — close and try again</option>';
  }
}
function setMcFields(on){
  document.getElementById('mcFields').style.display = on ? 'flex' : 'none';
  ['mcName','mcSoftware','mcVersion'].forEach(id=>{ document.getElementById(id).required = on; });
  if(on) loadMcVersions();
}
function setDesignerFields(on){
  document.getElementById('designerFields').style.display = on ? 'flex' : 'none';
  document.getElementById('designerDetails').required = on;
}
function mcOrderBlock(o, isAdmin){
  if(o.category !== 'minecraft' || !o.mc) return '';
  const p = MC_PLANS.find(x=>x.id===o.mc.planId);
  let h = `<div style="margin-top:10px;font-size:13px;color:var(--ink-dim);">⛏️ ${escapeHtml(o.mc.serverName||'')} · ${escapeHtml(o.mc.software||'')} ${escapeHtml(o.mc.version||'')}</div>`;
  if(o.server){
    const safe = s => String(s==null?'':s).replace(/[^\w.:-]/g,'');
    const addr = safe(o.server.host)+':'+safe(o.server.port);
    h += `<div class="card" style="margin-top:10px;padding:14px;">
      <div style="font-size:12px;color:var(--ink-dim);">SERVER ADDRESS (Minecraft Java)</div>
      <div style="font-family:'Orbitron';font-size:15px;color:var(--cyan);margin:4px 0 10px;word-break:break-all;">${addr}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button class="btn" style="padding:6px 12px;font-size:11px;" onclick="navigator.clipboard.writeText('${addr}');toast('Copied ✔')">COPY IP</button>
        <button class="btn" style="padding:6px 12px;font-size:11px;" onclick="window.open(MC_PANEL_URL+'/server/${Number(o.server.id)||0}','_blank')">OPEN PANEL</button>
      </div>
      ${o.server.expiresAt ? `<div style="margin-top:10px;font-size:12px;color:var(--ink-dim);">Valid until: ${new Date(o.server.expiresAt).toLocaleDateString()}</div>` : ''}
      ${o.server.state === 'suspended' ? `<div style="margin-top:8px;color:#ff4d6d;font-size:13px;">⛔ Suspended (month ended). Contact admin to activate it again.</div>` : ''}
      ${isAdmin ? `<div class="admin-row" style="flex-wrap:wrap;">
        <button onclick="mcServerAction(${Number(o.server.id)||0}, 'renew', this)">➕ ACTIVATE / RENEW 30 DAYS</button>
        <button onclick="mcServerAction(${Number(o.server.id)||0}, 'suspend', this)">⏸ SUSPEND</button>
      </div>` : ''}
    </div>`;
  } else if(isAdmin){
    if(o.status !== 'cancelled'){
      if(p && Number(o.price) !== p.price) h += `<div style="margin-top:8px;color:#ff4d6d;font-size:12px;">⚠ Price mismatch: order says Rs. ${escapeHtml(String(o.price))} but plan costs Rs. ${p.price}</div>`;
      h += `<div class="admin-row"><button onclick="buildMcServer('${o.id}', this)">✅ ACCEPT &amp; BUILD SERVER</button></div>`;
    }
  } else {
    h += `<div style="margin-top:8px;font-size:12px;color:var(--ink-dim);">Waiting for admin to confirm your payment — your server IP &amp; port will appear here.</div>`;
  }
  return h;
}
async function mcServerAction(serverId, action, btn){
  if(!confirm(action==='renew' ? 'Activate this server / add 30 days?' : 'Suspend this server now?')) return;
  const label = btn.textContent; btn.disabled = true;
  try{
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(MC_PANEL_URL + '/api/admin/servers/' + Number(serverId) + '/' + action, {
      method:'POST',
      headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' },
      body: JSON.stringify(action==='renew' ? { days: 30 } : {})
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ('HTTP '+r.status));
    toast(action==='renew' ? 'Server activated ✅ (+30 days)' : 'Server suspended ⏸');
  }catch(e){ toast(e.message || 'Failed'); }
  btn.disabled = false; btn.textContent = label;
}
async function buildMcServer(orderId, btn){
  if(!confirm('Payment verified? Build this Minecraft server now?')) return;
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'BUILDING...';
  try{
    const token = await auth.currentUser.getIdToken();
    const r = await fetch(MC_PANEL_URL + '/api/admin/orders/' + encodeURIComponent(orderId) + '/provision', { method:'POST', headers:{ Authorization:'Bearer '+token } });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || ('HTTP '+r.status));
    toast('Server is being built ✅ — IP & port will show on the order shortly.');
  }catch(e){
    toast(e.message || 'Build failed');
    btn.disabled = false; btn.textContent = label;
  }
}

function renderOrderCard(plan, kind){
  return `
    <div class="order-card">
      ${plan.hot ? '<span style="align-self:flex-end;background:var(--cyan);color:#000;font-family:\'Orbitron\';font-size:9px;padding:3px 8px;border-radius:2px;">HOT</span>' : ''}
      ${plan.icon ? `<div style="font-size:28px;">${plan.icon}</div>` : ''}
      <div class="oc-name">${escapeHtml(plan.name)}</div>
      <div class="oc-price">Rs. ${plan.price}<span> /${(kind==='website'||kind==='designer')?'once':'month'}</span></div>
      <ul>${plan.features.map(f=>`<li>${escapeHtml(f)}</li>`).join('')}</ul>
      <button class="btn" style="margin-top:6px;" onclick='openOrder(${JSON.stringify(kind)}, ${JSON.stringify(plan.name)}, ${plan.price})'>BUY</button>
    </div>`;
}

function renderOrderPage(){
  document.getElementById('vpnPremiumList').innerHTML = VPN_PREMIUM.map(p=>renderOrderCard(p,'vpn')).join('');
  document.getElementById('vpnBypassList').innerHTML = VPN_BYPASS.map(p=>renderOrderCard(p,'vpn')).join('');
  document.getElementById('websiteList').innerHTML = WEBSITE_PLANS.map(p=>renderOrderCard(p,'website')).join('');
  document.getElementById('designerList').innerHTML = DESIGNER_PLANS.map(p=>renderOrderCard(p,'designer')).join('');
  updateDomainPrice();
}

function switchOrderTab(tab){
  document.querySelectorAll('.order-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.order-tab-panel').forEach(p=>p.classList.toggle('active', p.id==='orderTab-'+tab));
}

function updateDomainPrice(){
  const years = parseInt(document.getElementById('domainYears').value, 10) || 1;
  document.getElementById('domainPrice').textContent = years * 500;
}
function orderDomain(){
  const years = parseInt(document.getElementById('domainYears').value, 10) || 1;
  openOrder('domain', `Domain — ${years} Year${years>1?'s':''}`, years * 500);
}

let currentOrder = null;
function openOrder(type, planLabel, price, planId){
  if(!auth.currentUser){
    toast('Please log in first — so you can track your order.');
    go('auth');
    return;
  }
  currentOrder = { type, planLabel, price, planId };
  document.getElementById('orderSummary').textContent = `${planLabel} — Rs. ${price}`;
  document.getElementById('orderForm').reset();
  setMcFields(type === 'minecraft');
  setDesignerFields(type === 'designer');
  document.getElementById('orderModal').style.display = 'flex';
}
function closeOrder(){
  document.getElementById('orderModal').style.display = 'none';
}
async function submitOrder(e){
  e.preventDefault();
  const user = auth.currentUser;
  if(!user){ toast('Please log in first.'); go('auth'); return; }
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'SENDING...';
  const fd = new FormData(form);
  const firstName = fd.get('First Name') || '';
  const lastName = fd.get('Last Name') || '';
  const age = fd.get('Age') || '';
  const whatsapp = fd.get('WhatsApp Number') || '';
  const file = fd.get('attachment');
  try{
    let receiptImg = null;
    if(file && file.size){ receiptImg = await compressImage(file); }
    const mcData = (currentOrder && currentOrder.type === 'minecraft') ? {
      planId: currentOrder.planId,
      serverName: String(fd.get('Server Name') || '').trim(),
      software: String(fd.get('Software') || ''),
      version: String(fd.get('Version') || '')
    } : null;
    const designDetails = (currentOrder && currentOrder.type === 'designer') ? String(fd.get('Design Details') || '').trim() : null;

    /* save it so it shows up under Your Orders (customer) and Orders (admin) */
    await db.ref('orders').push({
      uid: user.uid,
      email: user.email,
      name: `${firstName} ${lastName}`.trim(),
      age, whatsapp,
      category: currentOrder ? currentOrder.type : '',
      plan: currentOrder ? currentOrder.planLabel : '',
      price: currentOrder ? currentOrder.price : 0,
      receiptImg,
      mc: mcData,
      description: designDetails,
      status: 'pending',
      createdAt: Date.now()
    });
    db.ref('stats/ordersCount').transaction(cur => (cur||0) + 1);

    /* also email it immediately as a backup notification */
    fd.append('_subject', 'New Order — ' + (currentOrder ? currentOrder.planLabel : ''));
    fd.append('Plan', currentOrder ? currentOrder.planLabel : '');
    fd.append('Price', currentOrder ? ('Rs. ' + currentOrder.price) : '');
    fd.append('Category', currentOrder ? currentOrder.type : '');
    fetch('https://formsubmit.co/ajax/dieghost371@gmail.com', {
      method:'POST', headers:{'Accept':'application/json'}, body: fd
    }).catch(()=>{});

    toast('Order sent! Track it under Profile → Your Orders.');
    closeOrder();
  }catch(err){
    toast(err.message || 'Failed to send — please try again.');
  }
  btn.disabled = false; btn.textContent = originalLabel;
}

/* ================= AUTH ================= */
function toggleAuthMode(){
  authMode = authMode==='login' ? 'signup' : 'login';
  document.getElementById('authTitle').textContent = authMode==='login' ? 'Login' : 'Create Account';
  document.getElementById('authSubmitBtn').textContent = authMode==='login' ? 'Login' : 'Sign Up';
  document.getElementById('authSwitchNote').innerHTML = authMode==='login'
    ? 'No account? <a onclick="toggleAuthMode()">Create one</a>'
    : 'Already have an account? <a onclick="toggleAuthMode()">Login</a>';
  document.getElementById('authMsg').textContent='';
}

function emailAuth(){
  const email = document.getElementById('authEmail').value.trim();
  const pass = document.getElementById('authPass').value;
  const msgEl = document.getElementById('authMsg');
  msgEl.textContent='';
  if(!email || !pass){ msgEl.textContent='Enter email and password.'; return; }

  const action = authMode==='login'
    ? auth.signInWithEmailAndPassword(email, pass)
    : auth.createUserWithEmailAndPassword(email, pass);

  action.then((cred)=>{
    if(authMode==='signup'){
      return saveUserRecord(cred.user);
    }
  }).then(()=>{
    toast(authMode==='login' ? 'Welcome back!' : 'Account created!');
    go(email.toLowerCase()===ADMIN_EMAIL ? 'admin' : 'profile');
  }).catch(err=>{
    msgEl.textContent = friendlyAuthError(err);
  });
}

function googleLogin(){
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).then(cred=>{
    return saveUserRecord(cred.user).then(()=>cred.user);
  }).then((user)=>{
    toast('Welcome!');
    go(user.email && user.email.toLowerCase()===ADMIN_EMAIL ? 'admin' : 'profile');
  }).catch(err=>{
    document.getElementById('authMsg').textContent = friendlyAuthError(err);
  });
}

function saveUserRecord(user){
  return db.ref('users/'+user.uid).set({
    name: user.displayName || user.email.split('@')[0],
    email: user.email,
    photoURL: user.photoURL || "",
    updatedAt: Date.now()
  });
}

function friendlyAuthError(err){
  const map = {
    'auth/email-already-in-use':'That email already has an account — try logging in.',
    'auth/invalid-email':'That email looks invalid.',
    'auth/weak-password':'Password should be at least 6 characters.',
    'auth/user-not-found':'No account found with that email.',
    'auth/wrong-password':'Wrong password.',
    'auth/invalid-credential':'Incorrect email or password.',
    'auth/popup-closed-by-user':'Google sign-in was closed.',
    'auth/popup-blocked':'Popup was blocked — allow popups for this site and try again.',
    'auth/unauthorized-domain':'This website domain is not authorized in Firebase (Authentication > Settings > Authorized domains).',
    'auth/operation-not-allowed':'This login method is not enabled in Firebase (Authentication > Sign-in method).'
  };
  return map[err.code] || err.message;
}

function logout(){
  auth.signOut().then(()=>{ toast('Logged out.'); go('home'); });
}

/* ================= AUTH STATE ================= */
auth.onAuthStateChanged(user=>{
  const navProfile = document.getElementById('navProfileBtn');
  const navAdmin = document.getElementById('navAdminBtn');
  const navAuth = document.getElementById('navAuthBtn');
  updateHomeUserBadge(user);
  if(user){
    try{ db.ref('users/'+user.uid).update({ name:user.displayName||(user.email?user.email.split('@')[0]:'User'), email:user.email||'', photoURL:user.photoURL||'', updatedAt:Date.now() }).catch(()=>{}); }catch(e){}
    navProfile.style.display='inline-block';
    navAuth.textContent='Logout';
    navAuth.onclick = logout;
    navAuth.dataset.p='';
    if(isAdminUser(user)){
      navAdmin.style.display='inline-block';
    } else {
      navAdmin.style.display='none';
    }
  } else {
    navProfile.style.display='none';
    navAdmin.style.display='none';
    navAuth.textContent='Login';
    navAuth.onclick = ()=>go('auth');
    navAuth.dataset.p='auth';
  }
  renderProfile();
  renderAdmin();
});

function updateHomeUserBadge(user){
  const badge = document.getElementById('homeUserBadge');
  const avatar = document.getElementById('homeUserAvatar');
  const nameEl = document.getElementById('homeUserName');
  if(!badge || !avatar || !nameEl) return;

  if(!user){
    badge.classList.remove('show');
    return;
  }

  const name = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
  nameEl.textContent = name;

  if(user.photoURL){
    avatar.className = 'hub-avatar';
    avatar.src = user.photoURL;
    avatar.alt = name;
    avatar.onerror = ()=>{
      avatar.onerror = null;
      avatar.removeAttribute('src');
      avatar.className = 'hub-avatar hub-avatar-fallback';
      avatar.textContent = name.charAt(0).toUpperCase();
    };
  }else{
    avatar.removeAttribute('src');
    avatar.className = 'hub-avatar hub-avatar-fallback';
    avatar.textContent = name.charAt(0).toUpperCase();
  }

  // Show it only while the Home page is active.
  const home = document.getElementById('page-home');
  badge.classList.toggle('show', !!home && home.classList.contains('active'));
}

/* ================= PROFILE ================= */
function renderProfile(){
  const body = document.getElementById('profileBody');
  const user = auth.currentUser;
  if(!user){
    body.innerHTML = '<div class="lock-note">You need to be logged in to see your profile.<br><br><button class="btn" onclick="go(\'auth\')">Login / Sign Up</button></div>';
    return;
  }
  const initials = (user.displayName || user.email || '?').charAt(0).toUpperCase();
  const isAdmin = isAdminUser(user);
  body.innerHTML = `
    <div class="profile-head">
      ${user.photoURL ? `<img src="${escapeHtml(user.photoURL)}">` : `<div class="avatar-fallback">${initials}</div>`}
      <div>
        <h2>${escapeHtml(user.displayName || 'GHOST Member')}</h2>
        <p>${escapeHtml(user.email)}</p>
        ${isAdmin ? '<span class="admin-chip">ADMIN</span>' : ''}
      </div>
    </div>
    <div class="card" style="max-width:480px;">
      <div class="kv"><span>Email</span><span>${escapeHtml(user.email)}</span></div>
      <div class="kv"><span>Signed in with</span><span>${user.providerData[0] ? user.providerData[0].providerId : '—'}</span></div>
      <div class="kv"><span>Account ID</span><span style="font-size:11px;">${user.uid.slice(0,12)}...</span></div>
    </div>
    <div style="margin-top:22px;display:flex;gap:10px;">
      ${isAdmin ? '<button class="btn" onclick="go(\'admin\')">Open Admin Panel</button>' : ''}
      <button class="btn ghost" onclick="logout()">Logout</button>
    </div>
    <div class="section-title" style="font-size:18px;margin-top:40px;">Your Orders</div>
    <div id="myOrders"><p class="empty-note">Loading...</p></div>
  `;
  loadMyOrders(user.uid);
}

/* ================= ADMIN ================= */
function renderAdmin(){
  const guard = document.getElementById('adminGuard');
  const body = document.getElementById('adminBody');
  const user = auth.currentUser;
  if(!isAdminUser(user)){
    guard.innerHTML = '<div class="lock-note">Admin access only.<br><br><button class="btn" onclick="go(\'auth\')">Login</button></div>';
    body.style.display='none';
    if(adminRef){ adminRef.off('value'); adminRef=null; }
    if(adminAppsRef){ adminAppsRef.off('value'); adminAppsRef=null; }
    if(msgsRef){ msgsRef.off('value'); msgsRef=null; }
    if(ordersRef){ ordersRef.off('value'); ordersRef=null; }
    if(customersRef){ customersRef.off('value'); customersRef=null; }
    return;
  }
  guard.innerHTML='';
  body.style.display='block';
  loadAdminApps();
  loadAdminList();
  loadAdminMessages();
  loadAdminOrders();
}

function imgKeyOf(url){ return (url||'').indexOf('img:')===0 ? url.slice(4) : null; }

/* shrink a photo in the browser so it is small enough to host in the database */
function designFileToDataURL(file){
  const isPng = /png/i.test(file.type) || /\.png$/i.test(file.name||'');
  if(!isPng) return compressImage(file);   // jpg/other: reuse the existing compressor
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('That file is not a valid image.'));
      img.onload = ()=>{
        let side = 1400;
        for(let i=0;i<6;i++){
          const scale = Math.min(1, side/Math.max(img.width,img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1,Math.round(img.width*scale));
          c.height = Math.max(1,Math.round(img.height*scale));
          const ctx = c.getContext('2d');
          ctx.clearRect(0,0,c.width,c.height);       // keeps transparent background (logos)
          ctx.drawImage(img,0,0,c.width,c.height);
          const out = c.toDataURL('image/png');
          if(out.length < 700000) return resolve(out);
          side *= 0.8;
        }
        reject(new Error('That PNG is too large — try a smaller/simpler file.'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function compressImage(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=>reject(new Error('Could not read that file.'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=>reject(new Error('That file is not a valid image.'));
      img.onload = ()=>{
        let side = 1000, q = 0.8;
        for(let i=0;i<7;i++){
          const scale = Math.min(1, side/Math.max(img.width,img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1,Math.round(img.width*scale));
          c.height = Math.max(1,Math.round(img.height*scale));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
          ctx.drawImage(img,0,0,c.width,c.height);
          const out = c.toDataURL('image/jpeg', q);
          if(out.length < 380000) return resolve(out);
          side *= 0.8; q = Math.max(0.5, q-0.06);
        }
        reject(new Error('Photo is too large — pick a smaller one.'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function pickPhoto(input){
  const msgEl = document.getElementById('adminMsg');
  msgEl.textContent = '';
  const file = input.files && input.files[0];
  if(!file) return;
  msgEl.style.color = 'var(--ink-dim)';
  msgEl.textContent = 'Preparing photo...';
  compressImage(file).then(data=>{
    pendingImage = data;
    const pv = document.getElementById('aPreview');
    pv.src = data; pv.style.display = 'block';
    document.getElementById('aClearPhoto').style.display = 'inline-block';
    document.getElementById('aType').value = 'image';
    msgEl.textContent = '';
    msgEl.style.color = '';
  }).catch(err=>{
    msgEl.style.color = '';
    msgEl.textContent = err.message;
    clearPhoto();
  });
}

function clearPhoto(){
  pendingImage = null;
  document.getElementById('aFile').value = '';
  document.getElementById('aPreview').style.display = 'none';
  document.getElementById('aPreview').removeAttribute('src');
  document.getElementById('aClearPhoto').style.display = 'none';
}

function postUpdate(){
  const title = document.getElementById('aTitle').value.trim();
  const desc = document.getElementById('aDesc').value.trim();
  let type = document.getElementById('aType').value;
  let url = document.getElementById('aUrl').value.trim();
  const msgEl = document.getElementById('adminMsg');
  const btn = document.getElementById('aSubmitBtn');
  msgEl.style.color = ''; msgEl.textContent='';
  if(!title){ msgEl.textContent='Title is required.'; return; }
  if(type==='none' && !pendingImage) url = '';

  const oldKey = editingId ? imgKeyOf(editingOldUrl) : null;
  btn.disabled = true;

  let step = Promise.resolve();
  if(pendingImage){
    // host the photo automatically; the post keeps only a short reference to it
    step = db.ref('images').push(pendingImage).then(ref=>{ url = 'img:'+ref.key; type = 'image'; });
  }

  step.then(()=>{
    const payload = { title, desc, mediaType: type, mediaUrl: url, author: auth.currentUser.email };
    return editingId
      ? db.ref('updates/'+editingId).update({...payload, updatedAt: Date.now()})
      : db.ref('updates').push({...payload, createdAt: Date.now()});
  }).then(()=>{
    const newKey = imgKeyOf(url);
    if(oldKey && oldKey!==newKey) db.ref('images/'+oldKey).remove().catch(()=>{});
    toast(editingId ? 'Update saved!' : 'Update posted!');
    cancelEdit();
  }).catch(err=>{
    msgEl.textContent = /permission/i.test(err.message||'')
      ? 'Permission denied — log in with Google using '+ADMIN_EMAIL+' and check your database rules.'
      : (err.message || 'Something went wrong.');
  }).then(()=>{ btn.disabled = false; });
}

function editUpdate(id){
  const u = adminItems[id];
  if(!u) return;
  editingId = id;
  editingOldUrl = u.mediaUrl || '';
  clearPhoto();
  document.getElementById('aTitle').value = u.title || '';
  document.getElementById('aDesc').value = u.desc || '';
  document.getElementById('aType').value = u.mediaType || 'none';
  document.getElementById('aUrl').value = u.mediaUrl || '';
  document.getElementById('adminFormTitle').textContent = 'Editing Announcement';
  document.getElementById('aSubmitBtn').textContent = 'Save Changes';
  document.getElementById('aCancelBtn').style.display = 'inline-block';
  document.getElementById('aTitle').scrollIntoView({behavior:'smooth', block:'center'});
}

function cancelEdit(){
  editingId = null;
  editingOldUrl = '';
  clearPhoto();
  document.getElementById('aTitle').value='';
  document.getElementById('aDesc').value='';
  document.getElementById('aUrl').value='';
  document.getElementById('aType').value='none';
  document.getElementById('adminFormTitle').textContent = 'New Announcement';
  document.getElementById('aSubmitBtn').textContent = 'Post Update';
  document.getElementById('aCancelBtn').style.display = 'none';
  document.getElementById('adminMsg').textContent = '';
}

function deleteUpdate(id){
  if(!confirm('Delete this post?')) return;
  const u = adminItems[id];
  const key = u ? imgKeyOf(u.mediaUrl) : null;
  db.ref('updates/'+id).remove().then(()=>{
    if(key) db.ref('images/'+key).remove().catch(()=>{});
    toast('Deleted.');
    if(editingId===id) cancelEdit();
  }).catch(err=>{ toast(err.message); });
}

function loadAdminList(){
  const list = document.getElementById('adminList');
  if(adminRef) adminRef.off('value');
  adminRef = db.ref('updates').orderByChild('createdAt');
  adminRef.on('value', snap=>{
    const items = [];
    adminItems = {};
    snap.forEach(child=>{ const it = {id:child.key, ...child.val()}; items.push(it); adminItems[it.id] = it; });
    items.reverse();
    if(items.length===0){
      list.innerHTML = '<div class="empty-note">No posts yet.</div>';
      return;
    }
    list.innerHTML = items.map(u=>`
      <div class="update">
        <h3>${escapeHtml(u.title)}</h3>
        <div class="meta">${new Date(u.createdAt).toLocaleString()}</div>
        <p>${escapeHtml(u.desc||'')}</p>
        ${renderMedia(u)}
        <div class="admin-row">
          <button onclick="editUpdate('${u.id}')" style="border-color:var(--cyan);color:var(--cyan);">Edit</button>
          <button onclick="deleteUpdate('${u.id}')">Delete</button>
        </div>
      </div>
    `).join('');
    hydrateImages(list);
  }, err=>{
    list.innerHTML = '<div class="empty-note">Cannot load posts: '+escapeHtml(err.message)+'</div>';
  });
}

function loadAdminMessages(){
  const box = document.getElementById('adminMsgs');
  if(msgsRef) msgsRef.off('value');
  msgsRef = db.ref('messages').orderByChild('createdAt');
  msgsRef.on('value', snap=>{
    const items = [];
    snap.forEach(c=>{ items.push({id:c.key, ...c.val()}); });
    items.reverse();
    if(items.length===0){
      box.innerHTML = '<div class="empty-note">No messages yet.</div>';
      return;
    }
    box.innerHTML = items.map(m=>`
      <div class="update">
        <h3>${escapeHtml(m.name||'')}</h3>
        <div class="meta">${escapeHtml(m.email||'')} · ${new Date(m.createdAt).toLocaleString()}</div>
        <p>${escapeHtml(m.msg||'')}</p>
        <div class="admin-row"><button onclick="deleteMessage('${m.id}')">Delete</button></div>
      </div>
    `).join('');
  }, err=>{
    box.innerHTML = '<div class="empty-note">Cannot load messages: '+escapeHtml(err.message)+'</div>';
  });
}

function deleteMessage(id){
  if(!confirm('Delete this message?')) return;
  db.ref('messages/'+id).remove().then(()=>toast('Deleted.')).catch(err=>toast(err.message));
}

/* ================= ORDER TRACKING (Your Orders / Admin Orders) ================= */
const ORDER_STATUS_LABEL = { pending:'Pending', confirmed:'Confirmed', completed:'Completed', cancelled:'Cancelled' };
const ORDER_STATUS_COLOR = { pending:'#ffb020', confirmed:'#00e5ff', completed:'#39ff8f', cancelled:'#ff4d6d' };

/* ---- per-CUSTOMER chat (one shared inbox per uid, covers all their orders) ---- */
function renderCustomerMsg(m, isAdmin, customerName){
  const who = m.from==='admin' ? 'GHOST EDITZ' : (isAdmin?escapeHtml(customerName||'Customer'):'You');
  const color = m.from==='admin' ? 'var(--cyan)' : 'var(--ink)';
  let body = m.text ? `${escapeHtml(m.text)}` : '';
  if(m.file){
    const isImg = /^data:image\//.test(m.file);
    body += `<div style="margin-top:6px;">
      ${isImg ? `<img src="${m.file}" alt="" style="max-width:180px;max-height:180px;display:block;border:1px solid var(--border);margin-bottom:6px;background:repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 50%/16px 16px;">` : ''}
      <a class="btn" style="padding:6px 12px;font-size:11px;display:inline-block;" href="${m.file}" download="${escapeHtml(m.fileName||'design-file')}">⬇ Download ${escapeHtml(m.fileName||'file')}</a>
    </div>`;
  }
  return `<p style="font-size:13px;padding:3px 0;"><b style="color:${color};">${who}:</b> ${body}</p>`;
}
function renderCustomerThread(uid, isAdmin, customerName, msgsObj){
  const msgs = msgsObj ? Object.values(msgsObj).sort((a,b)=>a.createdAt-b.createdAt) : [];
  const inputId = (isAdmin ? 'custReply-' : 'myCustReply-') + uid;
  const fileInputId = 'custFile-' + uid;
  return `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-family:'Orbitron',sans-serif;font-size:11px;letter-spacing:1.5px;color:var(--ink-dim);margin-bottom:8px;">💬 ${isAdmin ? ('INBOX — '+escapeHtml(customerName||'Customer')) : 'YOUR INBOX'}</div>
      ${msgs.length===0 ? '<p class="empty-note" style="padding:4px 0;">No messages yet.</p>' :
        msgs.map(m=>renderCustomerMsg(m, isAdmin, customerName)).join('')}
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
        <input class="order-input" id="${inputId}" style="flex:1;min-width:120px;" placeholder="Type a message..."
          onkeydown="if(event.key==='Enter'){ event.preventDefault(); sendCustomerMessage('${uid}','${isAdmin?'admin':'customer'}'); }">
        <button class="btn" style="white-space:nowrap;padding:10px 16px;" onclick="sendCustomerMessage('${uid}','${isAdmin?'admin':'customer'}')">Send</button>
      </div>
      ${isAdmin ? `
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center;">
        <input type="file" accept="image/*" id="${fileInputId}" style="display:none;" onchange="sendCustomerFile('${uid}', this)">
        <button class="btn" style="padding:6px 12px;font-size:11px;" onclick="document.getElementById('${fileInputId}').click()">📎 Upload finished file</button>
      </div>` : ''}
    </div>`;
}
function sendCustomerFile(uid, inputEl){
  const file = inputEl.files && inputEl.files[0];
  if(!file) return;
  designFileToDataURL(file).then(dataUrl=>{
    return db.ref('customers/'+uid+'/messages').push({ from:'admin', text:'', file:dataUrl, fileName:file.name, createdAt: Date.now() });
  }).then(()=>{
    inputEl.value = '';
    toast('File sent ✔ — customer can download it from their inbox.');
  }).catch(err=>toast(err.message || 'Upload failed'));
}
function sendCustomerMessage(uid, from){
  const inputId = (from==='admin' ? 'custReply-' : 'myCustReply-') + uid;
  const input = document.getElementById(inputId);
  if(!input) return;
  const text = input.value.trim();
  if(!text) return;
  db.ref('customers/'+uid+'/messages').push({from, text, createdAt: Date.now()})
    .then(()=>{ input.value = ''; })
    .catch(err=>toast(err.message));
}

/* ---- individual order card (status + details only — chat now lives at the customer level) ---- */
function renderOrderCardFull(o, isAdmin){
  const status = o.status || 'pending';
  return `
    <div class="update" style="margin-bottom:10px;">
      <h3>${escapeHtml(o.plan||'')} — Rs. ${o.price||0}</h3>
      <div class="meta">${new Date(o.createdAt).toLocaleString()}</div>
      ${mcOrderBlock(o, isAdmin)}
      ${o.description ? `<div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);font-size:13px;color:var(--ink);white-space:pre-wrap;">📝 ${escapeHtml(o.description)}</div>` : ''}
      ${isAdmin && o.receiptImg ? `<img src="${o.receiptImg}" alt="" style="max-width:220px;margin-top:10px;border:1px solid var(--border);display:block;">` : ''}
      <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        ${isAdmin ? `
          <label style="font-size:12px;color:var(--ink-dim);">Status</label>
          <select onchange="updateOrderStatus('${o.id}', this.value)" style="background:rgba(255,255,255,0.05);color:var(--ink);border:1px solid var(--border);padding:6px;border-radius:2px;">
            ${Object.keys(ORDER_STATUS_LABEL).map(s=>`<option value="${s}" ${status===s?'selected':''}>${ORDER_STATUS_LABEL[s]}</option>`).join('')}
          </select>
          <button class="btn red" style="padding:6px 12px;font-size:11px;margin-left:auto;" onclick="deleteOrder('${o.id}')">Delete</button>
        ` : `
          <span style="font-family:'Orbitron';font-size:11px;padding:4px 10px;border:1px solid ${ORDER_STATUS_COLOR[status]||'#888'};color:${ORDER_STATUS_COLOR[status]||'#888'};border-radius:2px;">${ORDER_STATUS_LABEL[status]||status}</span>
        `}
      </div>
    </div>`;
}

/* ---- group all of one customer's orders under one card, with one shared inbox ---- */
function renderCustomerGroup(uid, orders, msgsObj){
  orders = orders.slice().sort((a,b)=>b.createdAt-a.createdAt);
  const latest = orders[0];
  return `
    <div class="update" style="margin-bottom:26px;border-left:2px solid var(--cyan);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;">
        <h3 style="margin:0;">${escapeHtml(latest.name||'Customer')}</h3>
        <span style="font-size:12px;color:var(--ink-dim);">${escapeHtml(latest.whatsapp||'')}${latest.age?(' · Age '+escapeHtml(String(latest.age))):''}</span>
      </div>
      <div style="font-size:11px;color:var(--ink-dim);margin-top:2px;">${orders.length} order${orders.length>1?'s':''}</div>
      <div style="margin-top:12px;">
        ${orders.map(o=>renderOrderCardFull(o, true)).join('')}
      </div>
      ${renderCustomerThread(uid, true, latest.name, msgsObj)}
    </div>`;
}

function updateOrderStatus(orderId, status){
  db.ref('orders/'+orderId+'/status').set(status).then(()=>toast('Status updated.')).catch(err=>toast(err.message));
}

function deleteOrder(orderId){
  if(!confirm('Delete this order?')) return;
  db.ref('orders/'+orderId).remove().then(()=>toast('Deleted.')).catch(err=>toast(err.message));
}

function renderAdminOrders(){
  const box = document.getElementById('adminOrders');
  if(!box) return;
  const orders = _adminOrdersSnap;
  const customers = _adminCustomersSnap || {};
  if(orders.length===0){ box.innerHTML = '<div class="empty-note">No orders yet.</div>'; return; }
  const groups = {};
  orders.forEach(o=>{ const key = o.uid || 'unknown'; (groups[key] = groups[key]||[]).push(o); });
  const uids = Object.keys(groups).sort((a,b)=>{
    const la = Math.max(...groups[a].map(o=>o.createdAt||0));
    const lb = Math.max(...groups[b].map(o=>o.createdAt||0));
    return lb - la;
  });
  box.innerHTML = uids.map(uid=>renderCustomerGroup(uid, groups[uid], customers[uid] && customers[uid].messages)).join('');
}

function loadAdminOrders(){
  const box = document.getElementById('adminOrders');
  if(box) box.innerHTML = '<div class="empty-note">Loading...</div>';
  if(ordersRef) ordersRef.off('value');
  ordersRef = db.ref('orders').orderByChild('createdAt');
  ordersRef.on('value', snap=>{
    const items = [];
    snap.forEach(c=>{ items.push({id:c.key, ...c.val()}); });
    _adminOrdersSnap = items;
    renderAdminOrders();
  }, err=>{
    if(box) box.innerHTML = '<div class="empty-note">Cannot load orders: '+escapeHtml(err.message)+'</div>';
  });
  if(customersRef) customersRef.off('value');
  customersRef = db.ref('customers');
  customersRef.on('value', snap=>{
    _adminCustomersSnap = snap.val() || {};
    renderAdminOrders();
  });
}

function loadMyOrders(uid){
  const box = document.getElementById('myOrders');
  if(!box) return;
  let latestOrders = [];
  let latestMsgs = null;
  function render(){
    const chatHtml = renderCustomerThread(uid, false, null, latestMsgs);
    const ordersHtml = latestOrders.length===0
      ? '<p class="empty-note">No orders yet — place one from the Orders page.</p>'
      : latestOrders.map(o=>renderOrderCardFull(o, false)).join('');
    box.innerHTML = ordersHtml + chatHtml;
  }
  if(myOrdersRef) myOrdersRef.off('value');
  myOrdersRef = db.ref('orders').orderByChild('uid').equalTo(uid);
  myOrdersRef.on('value', snap=>{
    const items = [];
    snap.forEach(c=>{ items.push({id:c.key, ...c.val()}); });
    items.sort((a,b)=>b.createdAt-a.createdAt);
    latestOrders = items;
    render();
  }, err=>{
    box.innerHTML = '<p class="empty-note">Cannot load orders: '+escapeHtml(err.message)+'</p>';
  });
  if(myCustomerMsgsRef) myCustomerMsgsRef.off('value');
  myCustomerMsgsRef = db.ref('customers/'+uid+'/messages');
  myCustomerMsgsRef.on('value', snap=>{
    latestMsgs = snap.val();
    render();
  });
}

/* ================= HOME STATS (site visits / orders placed) ================= */
function initHomeStats(){
  db.ref('stats/visits').on('value', snap=>{
    const el = document.getElementById('statVisits');
    if(el) el.textContent = snap.val() || 0;
  });
  db.ref('stats/ordersCount').on('value', snap=>{
    const el = document.getElementById('statOrders');
    if(el) el.textContent = snap.val() || 0;
  });
  if(!sessionStorage.getItem('ghost_visited')){
    sessionStorage.setItem('ghost_visited', '1');
    db.ref('stats/visits').transaction(cur => (cur||0) + 1);
  }
}

/* ================= MEMBERS STRIP (logged-in profiles) ================= */
function escHtml(t){ return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function initMembers(){
  const wrap = document.getElementById('membersWrap');
  const vp = document.getElementById('membersViewport');
  const track = document.getElementById('membersTrack');
  const countEl = document.getElementById('membersCount');
  const statEl = document.getElementById('statMembers');
  if(!wrap || !track) return;
  db.ref('users').limitToLast(60).on('value', snap=>{
    const val = snap.val() || {};
    const list = Object.keys(val).map(uid=>({uid, ...val[uid]}))
      .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    if(statEl) statEl.textContent = list.length;
    if(!list.length){ wrap.style.display='none'; return; }
    wrap.style.display='block';
    if(countEl) countEl.textContent = list.length;
    const meUid = auth.currentUser && auth.currentUser.uid;
    const card = u=>{
      const name = u.name || 'User';
      const av = u.photoURL
        ? `<img src="${escHtml(u.photoURL)}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;m-fallback&quot;>${escHtml(name.charAt(0).toUpperCase())}</div>'">`
        : `<div class="m-fallback">${escHtml(name.charAt(0).toUpperCase())}</div>`;
      return `<div class="member${u.uid===meUid?' me':''}">${av}<span class="m-name">${escHtml(name)}</span></div>`;
    };
    const cards = list.map(card).join('');
    if(list.length >= 5){
      // side-scrolling loop: content twice so the -50% shift is seamless
      track.innerHTML = cards + cards;
      vp.className = 'members-viewport marquee';
      vp.style.setProperty('--mdur', Math.max(18, list.length*4)+'s');
    } else {
      track.innerHTML = cards;
      vp.className = 'members-viewport static';
    }
  }, ()=>{ wrap.style.display='none'; });
}

/* ================= UPDATES (public feed) ================= */
function renderMedia(u){
  if(!u.mediaUrl || u.mediaType==='none') return '';
  const safe = escapeAttr(u.mediaUrl);
  if(u.mediaType==='image'){
    const key = imgKeyOf(u.mediaUrl);
    if(key) return `<div class="media"><img data-imgkey="${escapeAttr(key)}" alt=""></div>`;
    return `<div class="media"><img src="${safe}" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
  }
  if(u.mediaType==='video'){
    return `<div class="media"><video src="${safe}" controls></video></div>`;
  }
  if(u.mediaType==='youtube'){
    const id = extractYouTubeId(u.mediaUrl);
    if(id){
      return `<div class="media"><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe></div>`;
    }
    return `<div class="media"><a href="${safe}" target="_blank" rel="noopener">${safe}</a></div>`;
  }
  return `<div class="media"><a href="${safe}" target="_blank" rel="noopener">${safe}</a></div>`;
}

/* photos uploaded from the admin panel are stored in the database; load them on demand */
function hydrateImages(root){
  root.querySelectorAll('img[data-imgkey]').forEach(el=>{
    const key = el.dataset.imgkey;
    if(imgCache[key]){ el.src = imgCache[key]; return; }
    db.ref('images/'+key).once('value').then(snap=>{
      const v = snap.val();
      if(v){ imgCache[key] = v; el.src = v; } else { el.style.display = 'none'; }
    }).catch(()=>{ el.style.display = 'none'; });
  });
}

function extractYouTubeId(url){
  const m = url.match(/(?:youtu\.be\/|v=|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function loadUpdatesFeed(){
  const list = document.getElementById('updatesList');
  db.ref('updates').orderByChild('createdAt').on('value', snap=>{
    const items = [];
    snap.forEach(child=>{ items.push({id:child.key, ...child.val()}); });
    items.reverse();
    document.getElementById('statCount').textContent = items.length;
    try{ checkUpdateChanges(items); }catch(e){ console.error(e); }
    if(items.length===0){
      list.innerHTML = '<div class="empty-note">No updates yet — check back soon.</div>';
      return;
    }
    list.innerHTML = items.map(u=>`
      <div class="update">
        <h3>${escapeHtml(u.title)}</h3>
        <div class="meta">${new Date(u.createdAt).toLocaleDateString()}</div>
        <p>${escapeHtml(u.desc||'')}</p>
        ${renderMedia(u)}
      </div>
    `).join('');
    hydrateImages(list);
  }, err=>{
    list.innerHTML = '<div class="empty-note">Could not load updates right now.</div>';
    console.error(err);
  });
}
loadUpdatesFeed();

/* ================= CONTACT ================= */
function sendContact(){
  const name = document.getElementById('cName').value.trim();
  const email = document.getElementById('cEmail').value.trim();
  const msg = document.getElementById('cMsg').value.trim();
  const out = document.getElementById('contactMsg');
  if(!name || !email || !msg){ out.textContent='Fill in all fields.'; out.style.color='var(--blood)'; return; }
  db.ref('messages').push({name, email, msg, createdAt: Date.now()}).then(()=>{
    out.style.color = 'var(--cyan)';
    out.textContent='Message sent — thanks!';
    document.getElementById('cName').value='';
    document.getElementById('cEmail').value='';
    document.getElementById('cMsg').value='';
  }).catch(err=>{ out.style.color='var(--blood)'; out.textContent=err.message; });
}

/* ================= UPDATE NOTIFICATIONS ================= */
/* Tells visitors when you post a new update or edit one:
   - red badge on the Updates tab + title counter until they open Updates
   - pop-up card inside the site the moment it happens
   - real phone/PC notification (if they tapped "Enable notifications") */
const SIG_KEY = 'ge_update_sigs';
let swReg = null;
let knownSigs = null;      // id -> signature, as of the last snapshot
let currentSigs = {};      // latest signatures from the database
let unseenCount = 0;
let noticeTimer = null;
const BASE_TITLE = document.title;

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').then(r=>{ swReg = r; }).catch(()=>{});
  navigator.serviceWorker.addEventListener('message', e=>{ if(e.data && e.data.go) go(e.data.go); });
}

function updSig(u){ return (u.createdAt||0)+'|'+(u.updatedAt||0)+'|'+(u.title||''); }
function loadSavedSigs(){
  try{ const v = localStorage.getItem(SIG_KEY); return v ? JSON.parse(v) : null; }catch(e){ return null; }
}
function saveSigs(o){ try{ localStorage.setItem(SIG_KEY, JSON.stringify(o)); }catch(e){} }

function setBadge(n){
  unseenCount = n;
  const b = document.getElementById('updBadge');
  if(b){ b.textContent = n; b.style.display = n>0 ? 'inline-block' : 'none'; }
  document.title = n>0 ? '('+n+') '+BASE_TITLE : BASE_TITLE;
}

function markUpdatesSeen(){
  if(knownSigs === null && Object.keys(currentSigs).length===0) return; // feed not loaded yet
  saveSigs(currentSigs);
  knownSigs = Object.assign({}, currentSigs);
  setBadge(0);
  const n = document.getElementById('notice'); if(n) n.classList.remove('show');
}

function showNotice(title, body){
  document.getElementById('noticeTitle').textContent = title;
  document.getElementById('noticeBody').textContent = body;
  const n = document.getElementById('notice');
  n.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(()=>n.classList.remove('show'), 9000);
}
function openNotice(){ go('updates'); }

async function systemNotify(title, body){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  try{
    const reg = swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    if(reg && reg.showNotification){
      await reg.showNotification(title, { body, tag:'ge-update', renotify:true });
      return;
    }
  }catch(e){}
  try{ new Notification(title, { body }); }catch(e){}
}

function announce(title, body){
  showNotice(title, body);
  systemNotify(title, body);
}

function checkUpdateChanges(items){
  currentSigs = {};
  items.forEach(u=>{ currentSigs[u.id] = updSig(u); });
  const onUpdatesPage = document.getElementById('page-updates').classList.contains('active');

  // first snapshot after page load: compare with what this visitor saw last time
  if(knownSigs === null){
    const saved = loadSavedSigs();
    if(saved === null){ saveSigs(currentSigs); knownSigs = Object.assign({}, currentSigs); return; } // brand-new visitor
    knownSigs = saved;
    let fresh = 0, first = null;
    items.forEach(u=>{ if(knownSigs[u.id] !== currentSigs[u.id]){ fresh++; if(!first) first = u; } });
    if(fresh>0){
      if(onUpdatesPage){ markUpdatesSeen(); return; }
      setBadge(fresh);
      showNotice(fresh===1 ? '🔔 New update' : '🔔 '+fresh+' new updates', fresh===1 ? first.title : 'Tap to see what\'s new');
    }
    return;
  }

  // live changes while the site is open
  const changed = items.filter(u=>knownSigs[u.id] !== currentSigs[u.id]);
  if(changed.length===0) return;
  if(onUpdatesPage){ markUpdatesSeen(); return; }
  changed.forEach(u=>{ knownSigs[u.id] = currentSigs[u.id]; });
  if(isAdminUser(auth.currentUser)) return; // don't notify the admin about their own posts
  setBadge(unseenCount + changed.length);
  const u = changed[0];
  const wasEdit = /^\d+\|[1-9]/.test(currentSigs[u.id]);
  const short = (u.desc||'').length>110 ? u.desc.slice(0,110)+'…' : (u.desc||'');
  announce((wasEdit ? '✏️ Updated: ' : '🔔 New update: ') + u.title, short || 'Tap to view');
}

function refreshNotifButtons(){
  document.querySelectorAll('.notif-btn').forEach(b=>{
    if(!('Notification' in window)){ b.style.display='none'; return; }
    const p = Notification.permission;
    b.textContent = p==='granted' ? '🔔 Notifications ON' : p==='denied' ? '🔕 Blocked in browser settings' : '🔔 Enable notifications';
    b.disabled = (p!=='default');
  });
}
function enableNotifications(){
  if(!('Notification' in window)){ toast('This browser does not support notifications.'); return; }
  Notification.requestPermission().then(p=>{
    refreshNotifButtons();
    if(p==='granted'){ toast('Notifications enabled!'); systemNotify('GHOST EDITZ','You will be notified about new updates 🔔'); }
  });
}
refreshNotifButtons();

/* ================= UTIL ================= */
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function escapeAttr(str){ return escapeHtml(str); }

/* ================= BACKGROUND MUSIC (random track, falls-in now-playing badge) ================= */
const SONGS = [
  { file: 'https://song33.edgeone.dev/', title: 'Track 1', theme:{cyan:'#ff2438', blood:'#ff0022', violet:'#ff5a3c', v1:'#ff2dd4', v2:'#00e5ff', v3:'#8a2be2', speed:1.0} },
  { file: 'https://song3wu.edgeone.dev/', title: 'Track 2', theme:{cyan:'#ff5ad1', blood:'#e0007a', violet:'#ff8adf', v1:'#ff5ad1', v2:'#ffd1f0', v3:'#c400a5', speed:1.15} },
  { file: 'https://artistic-peach-dkl27hwo.edgeone.dev/', title: 'Track 3', theme:{cyan:'#00e5ff', blood:'#0099c2', violet:'#3cc7ff', v1:'#00e5ff', v2:'#7cffe8', v3:'#0066ff', speed:0.9} },
  { file: 'https://songdhd.edgeone.dev/', title: 'Track 4', theme:{cyan:'#ffb020', blood:'#ff7a00', violet:'#ffd166', v1:'#ffb020', v2:'#fff066', v3:'#ff5a00', speed:1.25} },
  { file: 'https://clumsy-emerald-g9tvozne.edgeone.dev/', title: 'Track 5', theme:{cyan:'#39ff8f', blood:'#00c26a', violet:'#8affc1', v1:'#39ff8f', v2:'#d0ffb3', v3:'#00a86b', speed:0.85} },
  { file: 'https://helpful-amber-zt2wi3yg.edgeone.dev/', title: 'Track 6', theme:{cyan:'#c04cff', blood:'#8a2be2', violet:'#e2a8ff', v1:'#c04cff', v2:'#ffb3ff', v3:'#5a00b3', speed:1.1} },
  { file: 'https://impressed-salmon-sfb7b2lx.edgeone.dev/', title: 'Track 7', theme:{cyan:'#ff4d6d', blood:'#c9184a', violet:'#ff8fa3', v1:'#ff4d6d', v2:'#ffccd5', v3:'#800f2f', speed:1.3} },
  { file: 'https://new-amethyst-rku9ylmk.edgeone.dev/', title: 'Track 8', theme:{cyan:'#7cf9ff', blood:'#00b4d8', violet:'#caf0f8', v1:'#7cf9ff', v2:'#e0fbfc', v3:'#0077b6', speed:0.8} },
  { file: 'https://comparable-amber-wdnmp6gn.edgeone.dev/', title: 'Track 9', theme:{cyan:'#ffe066', blood:'#ffb703', violet:'#fff3b0', v1:'#ffe066', v2:'#fffbd6', v3:'#fb8500', speed:1.2} },
  { file: 'https://academic-lime-jmxaiop4.edgeone.dev/', title: 'Track 10', theme:{cyan:'#9dff33', blood:'#5fb700', violet:'#c8ff8a', v1:'#9dff33', v2:'#eaffc2', v3:'#4d8000', speed:0.95} },
  { file: 'https://song6.edgeone.dev/', title: 'Track 11', theme:{cyan:'#ff2438', blood:'#ff0022', violet:'#ff5a3c', v1:'#ff2dd4', v2:'#00e5ff', v3:'#8a2be2', speed:1.05} },
  // Track 12: its own video takes over the whole background + site shakes. Live wallpaper returns when it ends.
  { file: 'https://catttack.edgeone.dev/', title: 'Track 12', mode:'takeover', shake:true, theme:{cyan:'#ff9e2c', blood:'#ff5a00', violet:'#ffd08a', v1:'#ff9e2c', v2:'#fff066', v3:'#ff3c00', speed:1.4} },
  // Track 13: green-screen cat dances in from the side while it plays.
  { file: 'https://cattrack2.edgeone.dev/', title: 'Track 13', mode:'cutout', side:'right', theme:{cyan:'#ff6ad5', blood:'#c400a5', violet:'#ffb3ee', v1:'#ff6ad5', v2:'#ffe0f7', v3:'#8a2be2', speed:1.3} },
  // Track 14 & 15: phonk. The video's own audio is the track, and the anime girl (green screen removed) dances in from the side only while it plays.
  { file: 'https://dancegirl.edgeone.dev/', title: 'Track 14', mode:'cutout', side:'right', theme:{cyan:'#ff2d55', blood:'#b0002a', violet:'#ff8fa3', v1:'#ff2d55', v2:'#ffd1dc', v3:'#5a0015', speed:1.35} },
  { file: 'https://danc2.edgeone.dev/', title: 'Track 15', mode:'cutout', side:'left', theme:{cyan:'#b06bff', blood:'#6a00d4', violet:'#d9b3ff', v1:'#b06bff', v2:'#f0dcff', v3:'#3a0080', speed:1.35} },
  // Track 16: audio-only background track. No video overlay — instead the
  // whole site (header + main) pulses/bounces live to the beat.
  { file: 'https://displaydj.edgeone.dev/', title: 'Track 16', dance:true, retryOnError:true, theme:{cyan:'#00e5ff', blood:'#0072ff', violet:'#7df9ff', v1:'#00e5ff', v2:'#c8faff', v3:'#0038a8', speed:1.2} }
];


/* apply a per-song "anime vibe" — recolors the whole site + resets the
   visualizer's beat speed to roughly match that track's energy */
const vizBars = document.querySelectorAll('#anime-viz .bar');
const vizBaseDurations = [0.78,0.62,0.9,0.55,0.7,0.85,0.6];
function applyTheme(theme){
  if(!theme) return;
  const root = document.documentElement.style;
  root.setProperty('--cyan', theme.cyan);
  root.setProperty('--cyan-dim', theme.blood);
  root.setProperty('--blood', theme.blood);
  root.setProperty('--violet', theme.violet);
  root.setProperty('--border', theme.cyan + '48');
  root.setProperty('--viz-c1', theme.v1);
  root.setProperty('--viz-c2', theme.v2);
  root.setProperty('--viz-c3', theme.v3);
  vizBars.forEach((el,i)=>{ el.style.animationDuration = (vizBaseDurations[i]/theme.speed)+'s'; });
}

const bgAudio = document.getElementById('bgAudio');
const npBadge = document.getElementById('now-playing');
const npTitle = document.getElementById('npTitle');
const animeViz = document.getElementById('anime-viz');
let currentSongIdx = -1;
let watchdogTimer = null;

/* anime-vibe visualizer bars bounce whenever a track is actually playing */
bgAudio.addEventListener('playing', ()=>animeViz.classList.add('playing'));
bgAudio.addEventListener('pause', ()=>animeViz.classList.remove('playing'));
bgAudio.addEventListener('waiting', ()=>animeViz.classList.remove('playing'));

const bgAudioToggle = document.getElementById('bgAudioToggle');
let userPausedAudio = false;
bgAudio.addEventListener('playing', ()=>{ bgAudioToggle.textContent = '⏸'; bgAudioToggle.title = 'Pause music'; });
bgAudio.addEventListener('pause', ()=>{ bgAudioToggle.textContent = '▶'; bgAudioToggle.title = 'Play music'; });
function toggleBgAudio(){
  if(bgAudio.paused){
    userPausedAudio = false;
    bgAudio.muted = false;
    bgAudio.play().catch(()=>{});
  } else {
    userPausedAudio = true;
    bgAudio.pause();
  }
}

function nextSongIdx(fromIdx){
  return (fromIdx + 1) % SONGS.length;
}

function clearWatchdog(){
  if(watchdogTimer){ clearTimeout(watchdogTimer); watchdogTimer = null; }
}

// If a track hasn't actually started playing ~10s after we tried (dead/slow
// link), stop waiting on the next track and just loop the current one so
// there's never silence.
function armWatchdog(){
  clearWatchdog();
  watchdogTimer = setTimeout(()=>{
    if(bgAudio.paused || bgAudio.readyState < 2){
      bgAudio.loop = true;
      bgAudio.play().catch(()=>{});
    }
  }, 10000);
}

/* ================= SPECIAL VISUALS (takeover bg / shake / green-screen dancers) ================= */
const takeoverVid = document.getElementById('takeoverVideo');
const cutVid = document.getElementById('sideCut');
let visualToken = 0;
let syncVid = null;      // video that follows the audio clock
let syncLocked = false;  // true = same file as the audio (keep time in sync)

function clearVideo(v){
  v.oncanplay = null;
  v.onerror = null;
  try{ v.pause(); }catch(e){}
  v.removeAttribute('src');
  try{ v.load(); }catch(e){}
}
function stopVisuals(){
  visualToken++;
  const tok = visualToken;
  document.body.classList.remove('takeover','shaking');
  takeoverVid.classList.remove('on');
  cutVid.classList.remove('on');
  syncVid = null;
  setTimeout(()=>{           // let fade / slide-out finish, then free the videos
    if(tok !== visualToken) return;
    clearVideo(takeoverVid);
    clearVideo(cutVid);
  }, 950);
}
function startVisuals(song){
  stopVisuals();
  const tok = visualToken;

  if(song.mode === 'takeover'){
    clearVideo(takeoverVid);
    takeoverVid.loop = true;               // never end on a stuck/black last frame
    takeoverVid.onerror = ()=>{ if(tok===visualToken) stopVisuals(); };
    takeoverVid.oncanplay = ()=>{
      if(tok !== visualToken) return;
      takeoverVid.oncanplay = null;
      takeoverVid.currentTime = 0.03;      // force-render a real frame (avoids black flash)
      takeoverVid.classList.add('on');
      document.body.classList.add('takeover');
      if(song.shake) document.body.classList.add('shaking');
    };
    takeoverVid.src = song.file;
    syncVid = takeoverVid; syncLocked = true;
    takeoverVid.play().catch(()=>{});
    return;
  }

  if(song.mode !== 'cutout') return;
  const cut = { src: song.file, side: song.side || 'right', locked: true };
  clearVideo(cutVid);
  cutVid.className = 'side-' + cut.side;
  cutVid.loop = true;                      // never end on a stuck/black last frame
  cutVid.onerror = ()=>{ if(tok===visualToken) stopVisuals(); };
  cutVid.oncanplay = ()=>{
    if(tok !== visualToken) return;
    cutVid.oncanplay = null;
    cutVid.currentTime = 0.03;             // force-render a real frame (avoids black flash)
    requestAnimationFrame(()=>cutVid.classList.add('on'));
  };
  cutVid.src = cut.src;
  syncVid = cutVid; syncLocked = cut.locked;
  cutVid.play().catch(()=>{});
}
function syncTick(){
  const v = syncVid;
  if(!v) return;
  if(bgAudio.paused){
    if(!v.paused) v.pause();
  } else {
    if(v.paused) v.play().catch(()=>{});
    if(syncLocked && bgAudio.readyState >= 2 && Math.abs(v.currentTime - bgAudio.currentTime) > 0.35){
      try{ v.currentTime = bgAudio.currentTime; }catch(e){}
    }
  }
}
setInterval(syncTick, 400);
bgAudio.addEventListener('playing', syncTick);
bgAudio.addEventListener('pause', syncTick);
bgAudio.addEventListener('seeked', syncTick);

function playSong(idx){
  currentSongIdx = idx;
  const song = SONGS[idx];
  if(song) song._retried = false;
  bgAudio.loop = false;
  bgAudio.src = song.file;
  bgAudio.muted = !audioUnlocked;
  bgAudio.play().catch(()=>{});
  npTitle.textContent = song.title;
  applyTheme(song.theme);
  startVisuals(song);
  npBadge.classList.remove('show');
  requestAnimationFrame(()=>{
    setTimeout(()=>npBadge.classList.add('show'), 50);
  });
  armWatchdog();
}

function skipTrack(){
  playSong(nextSongIdx(currentSongIdx));
}

bgAudio.addEventListener('playing', clearWatchdog);
bgAudio.addEventListener('ended', ()=>{
  clearWatchdog();
  playSong(nextSongIdx(currentSongIdx));
});
bgAudio.addEventListener('error', ()=>{
  clearWatchdog();
  const failedIdx = currentSongIdx;
  const failedSong = SONGS[failedIdx];
  // Give a broken/slow track one clean reload before moving on. This is
  // especially useful for the final track when the CDN is temporarily slow.
  if(failedSong && failedSong.retryOnError && !failedSong._retried){
    failedSong._retried = true;
    setTimeout(()=>{
      if(currentSongIdx === failedIdx){
        bgAudio.src = failedSong.file + (failedSong.file.includes('?')?'&':'?') + 'retry=' + Date.now();
        bgAudio.load();
        bgAudio.play().catch(()=>{});
        armWatchdog();
      }
    }, 500);
    return;
  }
  playSong(nextSongIdx(failedIdx));
});

// Browsers block audible autoplay until the visitor interacts with the page.
// Start muted immediately (this plays from the site on load), then unmute
// automatically the instant the visitor taps/clicks/scrolls anywhere.
let audioUnlocked = false;
function unlockAudio(){
  if(audioUnlocked) return;
  audioUnlocked = true;
  bgAudio.muted = false;
  bgAudio.play().catch(()=>{});
  window.removeEventListener('click', unlockAudio);
  window.removeEventListener('touchstart', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
  window.removeEventListener('scroll', unlockAudio);
}
window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);
window.addEventListener('keydown', unlockAudio);
window.addEventListener('scroll', unlockAudio);

/* ================= LIVE BEAT DANCE (whole site pulses to the bass) ================= */
let danceCtx=null, danceAnalyser=null, danceSrcNode=null, danceFreq=null;
let danceEnergyAvg=0, danceLastHit=0, danceScale=1;
function ensureDanceAnalyser(){
  if(danceAnalyser) return true;
  try{
    danceCtx = new (window.AudioContext||window.webkitAudioContext)();
    danceSrcNode = danceCtx.createMediaElementSource(bgAudio);
    danceAnalyser = danceCtx.createAnalyser();
    danceAnalyser.fftSize = 512;
    danceAnalyser.smoothingTimeConstant = 0.55;
    danceFreq = new Uint8Array(danceAnalyser.frequencyBinCount);
    danceSrcNode.connect(danceAnalyser);
    danceAnalyser.connect(danceCtx.destination);   // must reconnect or audio goes silent
    return true;
  }catch(e){ return false; }
}
function danceBassEnergy(){
  danceAnalyser.getByteFrequencyData(danceFreq);
  const n = Math.max(2, Math.round(danceFreq.length*0.10));  // low-end bins ~ bass/kick
  let sum=0;
  for(let i=1;i<=n;i++) sum += danceFreq[i];
  return sum/n;
}
function danceLoop(ts){
  requestAnimationFrame(danceLoop);
  const song = SONGS[currentSongIdx];
  const active = song && song.dance && !bgAudio.paused && audioUnlocked;
  if(active){
    if(ensureDanceAnalyser()){
      if(danceCtx.state === 'suspended') danceCtx.resume().catch(()=>{});
      const e = danceBassEnergy();
      danceEnergyAvg = danceEnergyAvg*0.92 + e*0.08;
      if(e > danceEnergyAvg*1.3 && e > 38 && ts - danceLastHit > 180){
        danceLastHit = ts;
        danceScale = 1.045;
      }
    }
  }
  danceScale += (1 - danceScale) * 0.18;
  document.documentElement.style.setProperty('--dance-scale', danceScale.toFixed(4));
}
requestAnimationFrame(danceLoop);

/* ================= INTRO LOADER (sun-ray open) ================= */
(function(){
  const el = document.getElementById('introLoader');
  if(!el) return;
  let done = false;
  function dismiss(){
    if(done) return;
    done = true;
    el.classList.add('burst');
    setTimeout(()=>{ el.classList.add('hide'); setTimeout(()=>el.remove(), 750); }, 650);
  }
  window.addEventListener('load', ()=>setTimeout(dismiss, 350));
  setTimeout(dismiss, 4500);   // safety net so a slow asset never traps the visitor
})();

playSong(0);

/* ================= INIT ================= */
(function init(){
  renderOrderPage();
  renderApps();
  startAppsListener();
  initHomeStats();
  initMembers();
  const p = window.location.hash.replace('#','');
  go(PAGES.includes(p) ? p : 'home');
})();
