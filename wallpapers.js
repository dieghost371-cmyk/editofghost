/* ===== AGE GATE + WALLPAPERS ===== */
/* Upload images as wallpapers/girls/1.jpg, 2.jpg ...  wallpapers/boys/1.jpg ...  wallpapers/cars/1.jpg ...
   They appear automatically. Raise "count" if you upload more than that. */
const WALLPAPER_CONFIG = {
  girls: { label:'Anime Girls', folder:'wallpapers/girls/', count:30 },
  boys:  { label:'Anime Boys',  folder:'wallpapers/boys/',  count:30 },
  cars:  { label:'Cars',        folder:'wallpapers/cars/',  count:30 }
};
const WP_EXTS = ['jpg','png','webp','jpeg'];

(function(){
  const KEY = 'ghostAgeGroup';
  const isBot = /bot|crawl|spider|slurp|inspectiontool|lighthouse/i.test(navigator.userAgent);
  let wpTab = null;
  let wpToken = 0;

  function getGroup(){ try{ return localStorage.getItem(KEY); }catch(e){ return null; } }
  function saveGroup(g){ try{ localStorage.setItem(KEY,g); }catch(e){} }

  const gate = document.getElementById('ageGate');
  const selD = document.getElementById('agDay');
  const selM = document.getElementById('agMonth');
  const selY = document.getElementById('agYear');
  const err  = document.getElementById('agErr');

  // fill the selects
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  selD.innerHTML = '<option value="">Day</option>' + Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
  selM.innerHTML = '<option value="">Month</option>' + MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  const thisYear = new Date().getFullYear();
  selY.innerHTML = '<option value="">Year</option>' + Array.from({length:100},(_,i)=>`<option value="${thisYear-i}">${thisYear-i}</option>`).join('');

  function calcAge(d,m,y){
    const dob = new Date(y,m-1,d);
    if(dob.getFullYear()!==y || dob.getMonth()!==m-1 || dob.getDate()!==d) return null; // e.g. 31 Feb
    const now = new Date();
    if(dob > now) return null;
    let age = now.getFullYear() - y;
    if(now.getMonth()+1 < m || (now.getMonth()+1 === m && now.getDate() < d)) age--;
    return age;
  }

  function openGate(){
    err.textContent = '';
    gate.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeGate(){
    gate.classList.remove('show');
    document.body.style.overflow = '';
  }

  document.getElementById('agGo').addEventListener('click', ()=>{
    const d = +selD.value, m = +selM.value, y = +selY.value;
    if(!d || !m || !y){ err.textContent = 'Please choose your day, month and year.'; return; }
    const age = calcAge(d,m,y);
    if(age === null){ err.textContent = 'That date is not valid. Please check it.'; return; }
    saveGroup(age >= 18 ? 'adult' : 'minor');   // only the group is stored, never the birthday
    closeGate();
    if(document.getElementById('page-wallpapers').classList.contains('active')) renderWallpapers();
  });

  window.changeBirthday = function(){
    try{ localStorage.removeItem(KEY); }catch(e){}
    selD.value = selM.value = selY.value = '';
    openGate();
  };

  /* ---------- wallpapers page ---------- */
  window.renderWallpapers = function(){
    const g = isBot ? 'minor' : getGroup();
    if(!g){ openGate(); return; }
    const tabs = g === 'adult' ? ['girls','boys','cars'] : ['boys','cars'];
    if(!tabs.includes(wpTab)) wpTab = tabs[0];

    const tabsEl = document.getElementById('wpTabs');
    tabsEl.innerHTML = tabs.map(t =>
      `<button class="wp-tab${t===wpTab?' active':''}" data-t="${t}">${WALLPAPER_CONFIG[t].label}</button>`).join('');
    tabsEl.querySelectorAll('button').forEach(b => b.onclick = ()=>{ wpTab = b.dataset.t; renderWallpapers(); });

    const cfg = WALLPAPER_CONFIG[wpTab];
    const grid = document.getElementById('wpGrid');
    const empty = document.getElementById('wpEmpty');
    grid.innerHTML = ''; empty.style.display = 'none';
    const tok = ++wpToken;
    let pending = cfg.count;

    function settle(){
      if(tok !== wpToken) return;
      pending--;
      if(pending <= 0 && !grid.children.length) empty.style.display = 'block';
    }

    for(let i=1; i<=cfg.count; i++){
      let ei = 0;
      const tile = document.createElement('button');
      tile.className = 'wp-tile';
      const img = document.createElement('img');
      img.alt = cfg.label + ' wallpaper ' + i;
      img.onload  = ()=>{ if(tok !== wpToken) return; tile.classList.add('ok'); grid.appendChild(tile); settle(); };
      img.onerror = ()=>{
        if(tok !== wpToken) return;
        ei++;
        if(ei < WP_EXTS.length){ img.src = cfg.folder + i + '.' + WP_EXTS[ei]; }
        else { settle(); }
      };
      tile.appendChild(img);
      tile.onclick = ()=> openLight(img.src, cfg.label + ' ' + i);
      img.src = cfg.folder + i + '.' + WP_EXTS[0];
    }
  };

  /* ---------- lightbox ---------- */
  const light = document.getElementById('wpLight');
  const lightImg = document.getElementById('wpLightImg');
  const lightDl = document.getElementById('wpLightDl');
  function openLight(src, name){
    lightImg.src = src;
    lightDl.href = src;
    lightDl.setAttribute('download', name.replace(/\s+/g,'-').toLowerCase() + src.slice(src.lastIndexOf('.')));
    light.classList.add('show');
  }
  window.closeLight = function(){ light.classList.remove('show'); lightImg.src = ''; };
  light.addEventListener('click', e=>{ if(e.target === light) closeLight(); });

  /* ---------- ask for the birthday when the site opens ---------- */
  if(!isBot && !getGroup()) openGate();
})();
