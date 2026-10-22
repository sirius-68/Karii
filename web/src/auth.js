/* ================= Accounts & guest mode =================
   "I'll look around first" leaves the app signed out: Explore, Search and previews work,
   everything that creates or saves asks the person to sign in first, then carries on with
   what they tapped. Accounts live on this device (no server yet); signIn()/signOut() are
   the single seam to swap in a hosted provider later. */
const isGuest=()=>!(S.auth&&S.auth.signedIn);

// Actions that need an account, grouped by the reason shown in the sign-in prompt.
const GATE_REASONS={
  sing:['play','set-voice','clip-for','first-rec'],
  save:['like','addto','menu','dl','new-coll','coll-play','liked','colls','coll','downloads','recs'],
  create:['create','edit','beatmaker','lyricpad','recorder','scripts','clip-new','song-new','music-pick','music-remove','music-toggle','sync','lrc-import','lrc-export','sync-clear','auto-quick','auto-ai','auto-gen','timeline','clip-import','clip-remove'],
  profile:['photo','edit-profile','share-profile','rec-open','rec-share','rec-dl','rec-remix','rec-menu']
};
const GATED=new Map(); Object.entries(GATE_REASONS).forEach(([r,list])=>list.forEach(a=>GATED.set(a,r)));
const GATE_COPY={
  sing:['Sign in to perform','Create a free account to sing, read and record takes with the prompter.','mic-vocal'],
  save:['Sign in to save','Keep songs, poems and lines in your library, and build collections.','bookmark'],
  create:['Sign in to create','Write lyrics, make beats, record sounds and sync your own songs in the studio.','wand-sparkles'],
  profile:['Sign in to set up your profile','Add a photo, keep your recordings and share your profile.','user-round'],
  default:['Sign in to Lectern','One account for your takes, your library and everything you make.','sparkles']
};
let AUTH_RESUME=null;

/* Returns true (and asks the person to sign in) when an action is blocked. */
function gate(act,el){
  if(!isGuest()) return false;
  const r=GATED.get(act); if(!r) return false;
  // Signing in re-renders the screen, so remember the action rather than the button.
  const data={...(el&&el.dataset||{})};
  AUTH_RESUME=()=>{ const f=ACT[act]; if(!f) return;
    const sel=`[data-act="${act}"]`+(data.id?`[data-id="${CSS.escape(data.id)}"]`:'');
    const live=[...document.querySelectorAll(sel)].reverse().find(x=>x.isConnected&&x.offsetParent!==null);
    f(live||{dataset:data,disabled:false,closest:()=>null,querySelector:()=>null}); };
  authPrompt(r); return true;
}

const validEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
function authPrompt(reason){
  const [title,sub,icon]=GATE_COPY[reason]||GATE_COPY.default;
  const prev=S.auth||{};
  sheet(`<div class="auth">
      <div class="auth-mark">${ic(icon)}</div>
      <h3>${title}</h3><p class="mute">${sub}</p>
      <label class="field"><span>Name</span><input id="auName" maxlength="40" autocomplete="name" placeholder="Your name" value="${esc(prev.name||(S.profile&&S.profile.name!=='Performer'?S.profile.name:'')||'')}"></label>
      <label class="field"><span>Email</span><input id="auEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(prev.email||'')}"></label>
      <p class="auth-err" id="auErr" role="alert"></p>
      <button class="btn white block" id="auGo">Continue</button>
      <button class="link block" id="auNo">Not now</button>
      <p class="auth-note">${ic('shield-check','xs')}Your account and everything you make stay on this device.</p>
    </div>`,{onMount(el,close){
      const n=el.querySelector('#auName'), m=el.querySelector('#auEmail'), err=el.querySelector('#auErr');
      const go=()=>{
        const name=n.value.trim(), email=m.value.trim().toLowerCase();
        if(!name){ err.textContent='Add your name.'; n.focus(); return; }
        if(!validEmail(email)){ err.textContent='Enter a valid email address.'; m.focus(); return; }
        close(); signIn({name,email});
        const resume=AUTH_RESUME; AUTH_RESUME=null; if(resume) setTimeout(resume,380);
      };
      el.querySelector('#auGo').onclick=go;
      el.querySelector('#auNo').onclick=()=>{ AUTH_RESUME=null; close(); };
      n.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); m.focus(); } });
      m.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
      [n,m].forEach(i=>i.addEventListener('input',()=>{ err.textContent=''; }));
    },onClose(){ }});
}

function signIn({name,email}){
  const returning=S.auth&&S.auth.email===email;
  S.auth={signedIn:true,name,email,provider:'device',since:(returning&&S.auth.since)||Date.now()};
  SAVE.auth();
  const p=S.profile||{};
  if(!returning||!p.name||p.name==='Performer'){
    const base=name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'')||'performer';
    S.profile={...p,name,handle:p.name===name&&p.handle?p.handle:'@'+base+((hash(base)%9000)+1000),created:p.created||Date.now()};
    SAVE.profile();
  }
  updateTabAvatar(); refresh();
  toast(returning?`Welcome back, ${name.split(' ')[0]}`:`Signed in as ${name.split(' ')[0]}`);
}
function signOut(){
  confirmSheet('Sign out?','Your songs and takes stay on this device. Sign in again with the same email to pick up where you left off.','Sign out',()=>{
    S.auth={...(S.auth||{}),signedIn:false}; SAVE.auth();
    try{ stopPreview(); }catch(e){}
    updateTabAvatar(); switchTab('explore'); toast('Signed out');
  });
}
ACT['sign-in']=el=>{ AUTH_RESUME=null; authPrompt(el&&el.dataset.reason||'default'); };
ACT['sign-out']=()=>signOut();

/* ---- Signed-out versions of the tabs that hold personal things ---- */
function gateScreen(icon,title,text,reason,extra=''){
  return `<div class="gate">
    <div class="gate-art">${[0,1,2].map(i=>`<span style="${coverCss({id:'gate-'+reason+i,kind:['song','poem','line'][i],title},300)}"></span>`).join('')}<i>${ic(icon)}</i></div>
    <h1>${title}</h1><p>${text}</p>
    <button class="btn white block" data-act="sign-in" data-reason="${reason}">Sign in</button>
    <button class="link block" data-act="tab" data-tab="explore">Keep exploring</button>${extra}</div>`;
}
const _renderStudio=RENDER.studio, _renderLibrary=RENDER.library, _renderProfile=RENDER.profile, _renderExplore=RENDER.explore;
RENDER.studio=function(){ if(!isGuest()) return _renderStudio(); $('#tab-studio').innerHTML=gateScreen('audio-lines','Your studio','Write lyrics, build beats, record sounds and turn songs into karaoke. Sign in to start creating.','create'); };
RENDER.library=function(){ if(!isGuest()) return _renderLibrary(); $('#tab-library').innerHTML=gateScreen('library','Your library','Songs you save, collections, likes and recordings all live here. Sign in to start your library.','save'); };
RENDER.profile=function(){ if(!isGuest()) return _renderProfile();
  $('#tab-profile').innerHTML=`<div class="libhead"><h1 class="bigtitle">Profile</h1><button class="circ" data-act="settings" aria-label="Settings">${ic('settings')}</button></div>`+
    gateScreen('user-round','You’re browsing as a guest','Sign in to perform, keep your takes, track your streak and set up your profile.','profile'); };
RENDER.explore=function(){ _renderExplore();
  if(!isGuest()) return;
  const t=$('#tab-explore'); const b=document.createElement('button');
  b.className='guestbar'; b.dataset.act='sign-in'; b.dataset.reason='default';
  b.innerHTML=`<span class="gi">${ic('user-round','sm')}</span><span class="gt"><b>Browsing as a guest</b><span>Sign in to sing, record and save</span></span><span class="gb">Sign in</span>`;
  const top=t.querySelector('.topline'); if(top) top.after(b); else t.prepend(b);
};
const _updateTabAvatar=updateTabAvatar;
updateTabAvatar=function(){ const a=$('#tabAv'); if(!a) return;
  if(isGuest()){ a.classList.add('guest'); a.style.backgroundImage=''; a.innerHTML=ic('user-round','sm'); }
  else { a.classList.remove('guest'); a.innerHTML=''; _updateTabAvatar(); } };

/* ---- Account rows in Settings ---- */
const _openSettings=openSettings;
openSettings=function(){ _openSettings(); const e=STACK[STACK.length-1]; if(!e) return; const r=e.render;
  e.render=el=>{ r(el); const bar=el.querySelector('.pbar'); if(!bar) return;
    const sec=document.createElement('div');
    sec.innerHTML=isGuest()
      ?`<div class="h3 pad" style="margin-top:6px">Account</div><div class="card" style="margin:0 20px"><button class="setrow" data-act="sign-in" data-reason="default"><div class="lbl">Sign in<small>Perform, save and create with a free account</small></div>${ic('log-in','sm')}</button></div>`
      :`<div class="h3 pad" style="margin-top:6px">Account</div><div class="card" style="margin:0 20px"><div class="setrow"><div class="lbl">${esc(S.auth.name||S.profile.name)}<small>${esc(S.auth.email||'')}</small></div></div><button class="setrow" data-act="sign-out" style="color:var(--hot)"><div class="lbl">Sign out</div>${ic('log-out','sm')}</button></div>`;
    bar.after(...sec.childNodes); };
  rerender(e); };
