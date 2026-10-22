/* ================= Navigation ================= */
let TAB='explore';
const RENDER={};
function switchTab(t){
  if(t==='create'){ openCreate(); return; }
  closeAllPages(); closeSheets();
  TAB=t;
  ['explore','search','studio','library','profile'].forEach(x=>$('#tab-'+x).hidden=x!==t);
  $$('#tabbar [data-tab]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.tab===t)));
  RENDER[t](); window.scrollTo(0,0);
  if(t==='search') setTimeout(()=>{ const q=$('#sq'); if(q && !SQ) q.focus(); },60);
}
const STACK=[];
function push(name,render){
  const el=document.createElement('div'); el.className='page'; el.dataset.name=name;
  $('#pages').appendChild(el);
  const entry={el,render,name}; STACK.push(entry); render(el);
  if(STACK.length>1) STACK[STACK.length-2].el.classList.add('under');
  document.body.classList.add('no-tabbar');
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));
  return entry;
}
function pop(){
  const e=STACK.pop(); if(!e) return;
  e.el.classList.remove('in'); setTimeout(()=>e.el.remove(),420);
  const prev=STACK[STACK.length-1];
  if(prev){ prev.el.classList.remove('under'); rerender(prev); }
  else { document.body.classList.remove('no-tabbar'); RENDER[TAB](); }
}
function rerender(entry){ const st=entry.el.scrollTop; entry.render(entry.el); entry.el.scrollTop=st; }
function closeAllPages(){ while(STACK.length) STACK.pop().el.remove(); document.body.classList.remove('no-tabbar'); }
function refresh(){ const e=STACK[STACK.length-1]; if(e) rerender(e); else { const y=window.scrollY; RENDER[TAB](); window.scrollTo(0,y); } updateTabAvatar(); }
const pbar=(title,right='')=>`<div class="pbar"><button class="circ" data-act="back" aria-label="Back">${ic('chevron-left')}</button><h1>${esc(title)}</h1>${right||'<span style="width:44px"></span>'}</div>`;

/* ================= Sheets ================= */
function sheet(html,{onMount,onClose}={}){
  const root=$('#sheets'); const bg=document.createElement('div'); bg.className='sheet-bg';
  const el=document.createElement('div'); el.className='sheet'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true');
  el.innerHTML='<div class="grab"></div>'+html; root.append(bg,el);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ bg.classList.add('in'); el.classList.add('in'); }));
  let closed=false;
  const close=()=>{ if(closed) return; closed=true; bg.classList.remove('in'); el.classList.remove('in'); setTimeout(()=>{ bg.remove(); el.remove(); },360); onClose&&onClose(); };
  bg.onclick=close; el._close=close; onMount&&onMount(el,close);
  const f=el.querySelector('input,button.opt'); if(f && f.tagName==='INPUT') setTimeout(()=>f.focus(),300);
  return {el,close};
}
function closeSheets(){ $$('#sheets .sheet').forEach(s=>s._close&&s._close()); }
function actionSheet(title,opts,sub){
  const html=(title?`<h3>${esc(title)}</h3>`:'')+(sub?`<p class="sub">${esc(sub)}</p>`:'')+opts.filter(Boolean).map((o,i)=>`<button class="opt ${o.danger?'danger':''}" data-i="${i}"><span class="oi">${ic(o.icon)}</span><div><b>${esc(o.label)}</b>${o.sub?`<span>${esc(o.sub)}</span>`:''}</div></button>`).join('');
  const list=opts.filter(Boolean);
  sheet(html,{onMount(el,close){ el.addEventListener('click',e=>{ const b=e.target.closest('.opt'); if(!b) return; close(); setTimeout(()=>list[+b.dataset.i].run(),20); }); }});
}
function confirmSheet(title,sub,label,run){ actionSheet(title,[{icon:'trash',label,danger:true,run},{icon:'x',label:'Cancel',run(){}}],sub); }

/* ================= Builders ================= */
function metaHTML(it){
  switch(it.kind){
    case 'song': return `${ic('play','fill')}${fmtK(playsOf(it.id))}<i class="dot-sep"></i>${esc(it.cat?it.sub:(musicName(it)?'Your song':'No music yet'))}`;
    case 'poem': return `${esc(it.sub||'Your poem')}<i class="dot-sep"></i>${(it.body||'').split('\n').filter(l=>l.trim()).length} lines`;
    case 'line': return `${esc(it.cat?it.genre:'Your scene')}${it.level?`<i class="dot-sep"></i>${esc(it.level)}`:''}`;
    case 'inst': return `${esc(it.mood)}<i class="dot-sep"></i>${esc(it.sub)}`;
    default: return `${wordCount(it.body)} words<i class="dot-sep"></i>${fmt(durOf(it))}`;
  }
}
const titleOf=it=>it.title||('Untitled '+(KIND[it.kind]||KIND.script).label.toLowerCase());
function rowHTML(it,{tag=false,sub=null}={}){
  const d=durOf(it), playing=PREV.id===it.id && !PREV.audio.paused;
  return `<div class="row"><button class="rowmain" data-act="open" data-id="${esc(it.id)}"><span class="th ${playing?'playing':''}" style="${coverCss(it,160)}">${d?`<span class="dur">${fmt(d)}</span>`:''}<span class="play-ov">${ic('audio-lines')}</span></span><span class="tx"><b>${esc(titleOf(it))}${tag?`<span class="tag">${KIND[it.kind].tag}</span>`:''}</b><span>${sub!=null?sub:metaHTML(it)}</span></span></button><button class="kebab" data-act="menu" data-id="${esc(it.id)}" aria-label="More options for ${esc(titleOf(it))}">${ic('ellipsis-vertical')}</button></div>`;
}
const sqHTML=(it,cls='')=>`<button class="sq ${cls}" data-act="open" data-id="${esc(it.id)}"><span class="art" style="${coverCss(it,cls?400:340)}"></span><b>${esc(titleOf(it))}</b><span>${esc(it.sub||KIND[it.kind].label)}</span></button>`;
const fcHTML=it=>`<button class="fc" data-act="open" data-id="${esc(it.id)}"><span class="art" style="${coverCss(it,352)}"><span class="stats"><span class="stat">${ic('play','fill')}${fmtK(playsOf(it.id)*31)}</span><span class="stat">${ic('timer')}${fmt(durOf(it))}</span></span></span><b>${esc(it.title)}</b><span class="s">${esc(it.genre)} · ${esc(it.level)}</span></button>`;
const secHead=(title,act)=>`<div class="sec-h"><h2>${esc(title)}</h2>${act?`<button class="more" ${act}>More ${ic('chevron-right','sm')}</button>`:''}</div>`;
const catList=kind=>[...CAT.values()].filter(x=>x.kind===kind && !x.pdb && !x.user);
const userInst=()=>[...CAT.values()].filter(x=>x.user);
const allInst=()=>[...userInst(),...catList('inst')];

/* ================= Explore ================= */
let CLASSICS=null, CLASSICS_ERR=false;
RENDER.explore=function(){
  const el=$('#tab-explore');
  const ints=(S.profile&&S.profile.interests&&S.profile.interests.length)?S.profile.interests:['song','poem','line','script'];
  const songs=[...catList('song'),...S.items.filter(s=>s.kind==='song')];
  const pick=catList('song')[Math.floor(Date.now()/864e5)%catList('song').length];
  const recent=S.recents.played.map(find).filter(x=>x && x.kind!=='inst').slice(0,10);
  const hour=new Date().getHours(), greet=hour<5?'Up late':hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
  const unread=NEWS.length>S.newsSeen;
  const secs={
    song:`<section class="sec" id="sec-song">${secHead('Sing now','data-act="more" data-kind="song"')}<div class="rowgrid">${songs.map(s=>rowHTML(s)).join('')}</div></section>`,
    poem:`<section class="sec" id="sec-poem">${secHead('Poems for tonight','data-act="more" data-kind="poem"')}<div class="hscroll">${catList('poem').map(p=>sqHTML(p)).join('')}</div></section>
      <section class="sec" id="sec-classic">${secHead('Classic poems','data-act="classics-more"')}<div class="hscroll" id="classics">${classicsHTML()}</div>
      <div class="hscroll" style="margin-top:16px">${CLASSIC_POETS.map(a=>`<button class="chip" data-act="poet" data-name="${esc(a)}">${ic('feather','xs')}${esc(a)}</button>`).join('')}</div></section>`,
    line:`<section class="sec" id="sec-line">${secHead('Movie lines','data-act="more" data-kind="line"')}<div class="hscroll">${catList('line').map(fcHTML).join('')}</div></section>`,
    script:''
  };
  const order=[...ints.filter(k=>secs[k]!==undefined),...['song','poem','line'].filter(k=>!ints.includes(k))];
  el.innerHTML=`
    <div class="pad topline">
      <button class="searchpill" data-act="tab" data-tab="search">${ic('search')}<span>Search</span></button>
      <button class="circ bellwrap" data-act="news" aria-label="What's new">${ic('bell')}${unread?'<i class="badge"></i>':''}</button>
    </div>
    <div class="pad" style="margin-top:22px;color:var(--muted);font-size:.95rem">${greet}${S.auth&&S.auth.signedIn?', '+esc(firstName()):''}</div>
    <button class="hero" data-act="open" data-id="${pick.id}" style="${coverCss({...pick,id:pick.id+':hero'},560)}">
      <div><small>${ic('sparkles','xs')} Tonight's pick</small><h3>${esc(pick.title)}</h3><p>${esc(pick.sub)} · ${fmt(pick.dur)} · Karaoke</p></div>
      <span class="go" aria-hidden="true">${ic('mic-vocal')}</span>
    </button>
    <div class="hscroll cats">
      <button class="chip" data-act="jump" data-sec="sec-song">${ic('mic-vocal','xs')}Karaoke</button>
      <button class="chip" data-act="jump" data-sec="sec-poem">${ic('feather','xs')}Poems</button>
      <button class="chip" data-act="jump" data-sec="sec-line">${ic('clapperboard','xs')}Movie lines</button>
      <button class="chip" data-act="jump" data-sec="sec-inst">${ic('audio-waveform','xs')}Instrumentals</button>
    </div>
    ${recent.length?`<section class="sec">${secHead('Jump back in')}<div class="hscroll">${recent.map(r=>sqHTML(r)).join('')}</div></section>`:''}
    ${order.map(k=>secs[k]).join('')}
    <section class="sec" id="sec-inst">${secHead('Instrumentals','data-act="more" data-kind="inst"')}<div class="rowgrid">${catList('inst').map(x=>rowHTML(x)).join('')}</div>
      <p class="hint pad" style="margin-top:12px">Music by Tanner Helland, CC BY 4.0. Use any track as a music bed for poems, scripts and movie lines.</p></section>`;
  if(!CLASSICS && !CLASSICS_ERR) loadClassics();
};
function classicsHTML(){
  if(CLASSICS) return CLASSICS.map(id=>CAT.get(id)).filter(Boolean).map(p=>sqHTML(p)).join('');
  if(CLASSICS_ERR) return `<div class="empty" style="width:calc(100vw - 40px);max-width:440px;text-align:left;padding:8px 0">${ic('wifi-off')}<b>Couldn't reach the poetry archive</b>Classic poems load from PoetryDB when you're online. <button class="btn sm" data-act="classics-retry" style="margin-top:10px">Try again</button></div>`;
  return Array.from({length:4},()=>`<div class="sq"><div class="art sk"></div><div class="sk" style="height:14px;width:120px;margin-top:12px"></div><div class="sk" style="height:12px;width:80px;margin-top:8px"></div></div>`).join('');
}
async function loadClassics(){
  try{ const list=await pdbRandom(8); if(!list.length) throw new Error('empty'); CLASSICS=list.map(p=>p.id); CLASSICS_ERR=false; }
  catch(e){ CLASSICS_ERR=true; if(S.pdb.length){ CLASSICS=S.pdb.slice(-8).map(p=>p.id); CLASSICS_ERR=false; } }
  const c=$('#classics'); if(c) c.innerHTML=classicsHTML();
}

/* ================= Search ================= */
let SQ='', SQ_T=0, SQ_SEQ=0;
RENDER.search=function(){
  const el=$('#tab-search');
  el.innerHTML=`<div class="pad sbar"><label class="sfield">${ic('search')}<input id="sq" type="search" placeholder="Songs, poems, movie lines" autocomplete="off" enterkeyhint="search" value="${esc(SQ)}" aria-label="Search"><button class="circ sm ghost" id="sqClear" aria-label="Clear" ${SQ?'':'hidden'}>${ic('x','sm')}</button></label></div><div id="sbody"></div>`;
  const q=$('#sq');
  q.addEventListener('input',()=>{ SQ=q.value; $('#sqClear').hidden=!SQ; clearTimeout(SQ_T); SQ_T=setTimeout(renderSearchBody,160); });
  q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ rememberSearch(); q.blur(); } });
  $('#sqClear').onclick=()=>{ SQ=''; q.value=''; $('#sqClear').hidden=true; renderSearchBody(); q.focus(); };
  renderSearchBody();
};
function rememberSearch(){ const q=SQ.trim(); if(q.length<2) return; S.recents.searches=[q,...S.recents.searches.filter(x=>x.toLowerCase()!==q.toLowerCase())].slice(0,8); SAVE.recents(); }
function recommended(){
  const ints=(S.profile&&S.profile.interests)||['song','line','poem'];
  const pool=[...CAT.values()].filter(x=>!x.pdb && x.kind!=='inst' && ints.includes(x.kind) && !S.recents.played.includes(x.id));
  const r=rng(hash(today())); return pool.sort(()=>r()-.5).slice(0,6);
}
function renderSearchBody(){
  const body=$('#sbody'); if(!body) return;
  const q=SQ.trim().toLowerCase();
  if(!q){
    const rs=S.recents.searches;
    const rec=recommended();
    const sample=k=>catList(k)[0];
    body.innerHTML=`
      ${rs.length?`<section class="sec"><div class="sec-h"><h2>Recent searches</h2><button class="more" data-act="clear-searches">Clear</button></div><div class="pad">${rs.map(s=>`<div class="recent-row"><button class="recent" data-act="search-for" data-q="${esc(s)}">${ic('rotate-ccw-clock')}<span>${esc(s)}</span></button><button class="circ sm ghost" data-act="forget-search" data-q="${esc(s)}" aria-label="Remove ${esc(s)}">${ic('x','sm')}</button></div>`).join('')}</div></section>`:''}
      ${S.recents.played.length?`<section class="sec">${secHead('Recently played')}<div class="list">${S.recents.played.slice(0,4).map(find).filter(Boolean).map(x=>rowHTML(x,{tag:true})).join('')}</div></section>`:''}
      <section class="sec">${secHead('Recommended for you')}<div class="list">${rec.map(x=>rowHTML(x,{tag:true})).join('')}</div></section>
      <section class="sec">${secHead('Browse')}<div class="browse">
        ${[['song','Karaoke','mic-vocal'],['poem','Poems','feather'],['line','Movie lines','clapperboard'],['inst','Instrumentals','audio-waveform']].map(([k,l,i])=>`<button class="btile" data-act="more" data-kind="${k}" style="${coverCss({...sample(k),id:'browse-'+k},300)}">${l}${ic(i)}</button>`).join('')}
        <button class="btile" data-act="classics-more" style="${coverCss({id:'browse-classic',kind:'poem',title:'Classics'},300)}">Classic poets${ic('book-open')}</button>
        <button class="btile" data-act="create" style="${coverCss({id:'browse-mine',kind:'script',title:'Mine'},300)}">Write your own${ic('square-pen')}</button>
      </div></section>`;
    return;
  }
  const all=[...CAT.values(),...S.items];
  const hits=all.filter(x=>((x.title||'')+' '+(x.sub||'')+' '+(x.body||'')+' '+(x.genre||'')+' '+(x.mood||'')).toLowerCase().includes(q));
  const groups=[['song','Karaoke'],['line','Movie lines'],['poem','Poems'],['inst','Instrumentals'],['script','Scripts']];
  const seq=++SQ_SEQ;
  body.innerHTML=groups.map(([k,l])=>{ const g=hits.filter(h=>h.kind===k).slice(0,8); return g.length?`<section class="sec">${secHead(l)}<div class="list">${g.map(x=>rowHTML(x,{tag:k==='poem'&&!x.cat})).join('')}</div></section>`:''; }).join('')
    +`<section class="sec">${secHead('From the poetry archive')}<div class="list" id="pdbres">${Array.from({length:3},()=>`<div class="row"><span class="th sk"></span><span class="tx"><span class="sk" style="display:block;height:14px;width:60%"></span><span class="sk" style="display:block;height:12px;width:35%;margin-top:8px"></span></span></div>`).join('')}</div></section>`
    +(hits.length?'':`<div class="empty">${ic('search')}<b>No matches in Lectern</b>Try a song title, a poet, or a word from a line.</div>`);
  if(q.length<3){ const r=$('#pdbres'); if(r) r.closest('.sec').remove(); return; }
  pdbSearch(q).then(list=>{
    if(seq!==SQ_SEQ) return; const r=$('#pdbres'); if(!r) return;
    r.innerHTML=list.length?list.map(p=>`<div class="row"><button class="rowmain" data-act="pdb-open" data-a="${esc(p.author)}" data-t="${esc(p.title)}"><span class="th" style="${coverCss({id:'pdbq-'+hash(p.author+p.title),kind:'poem',title:p.title},160)}"></span><span class="tx"><b>${esc(p.title)}<span class="tag">Classic</span></b><span>${esc(p.author)}<i class="dot-sep"></i>${p.linecount} lines</span></span></button></div>`).join('')
      :`<p class="hint" style="margin:0">No public-domain poems matched.</p>`;
  }).catch(()=>{ if(seq!==SQ_SEQ) return; const r=$('#pdbres'); if(r) r.innerHTML=`<p class="hint" style="margin:0">${ic('wifi-off','xs')} The poetry archive is offline right now.</p>`; });
}

/* ================= Library ================= */
const LIBF={kind:'all',sort:'recent'};
RENDER.library=function(){
  const el=$('#tab-library');
  let items=S.items.slice();
  if(LIBF.kind!=='all') items=items.filter(s=>s.kind===LIBF.kind);
  items.sort(LIBF.sort==='az'?(a,b)=>titleOf(a).localeCompare(titleOf(b)):(a,b)=>b.updated-a.updated);
  const lbl={all:'All',song:'Karaoke',poem:'Poems',line:'Movie lines',script:'Scripts'}[LIBF.kind];
  el.innerHTML=`
    <div class="libhead"><h1 class="bigtitle">Library</h1><button class="circ" data-act="tab" data-tab="search" aria-label="Search">${ic('search')}</button></div>
    <div class="tiles">
      <button class="tile t-liked" data-act="liked"><span class="ct">${S.likes.size}</span>${ic('thumbs-up','ic')}Liked</button>
      <button class="tile t-coll" data-act="colls"><span class="ct">${S.colls.length}</span>${ic('list-music','ic')}Collections</button>
      <button class="tile t-rec" data-act="recs"><span class="ct">${S.recs.length+S.drafts.length}</span>${ic('video','ic')}Recordings</button>
      <button class="tile t-dl" data-act="downloads">${ic('cloud-download','ic')}Downloads</button>
    </div>
    <div class="lib-h"><h2>My library</h2><button class="flt" data-act="libfilter">${esc(lbl)} ${ic('funnel','sm')}</button></div>
    ${items.length?`<div class="list">${items.map(s=>rowHTML(s,{tag:true,sub:esc(previewLine(s))})).join('')}</div>`
      :`<div class="empty">${ic('library')}<b>${LIBF.kind==='all'?'Your library is empty':'Nothing here yet'}</b>Save songs, poems and movie lines from Explore, or write your own.<div style="display:flex;gap:10px;justify-content:center;margin-top:16px"><button class="btn sm" data-act="tab" data-tab="explore">${ic('compass','sm')}Explore</button><button class="btn white sm" data-act="create">${ic('plus','sm')}Create</button></div></div>`}`;
};
function previewLine(s){
  if(s.kind==='song'){ const n=lyricLines(s.body).length, k=(s.times||[]).filter(v=>v!=null).length; return (musicName(s)||'No music')+' · '+(k?(k>=n&&n?'synced':k+'/'+n+' synced'):'not synced'); }
  const t=(s.body||'').replace(/\[[^\]]*\]/g,' ').replace(/\s+/g,' ').trim();
  return t||'Empty — tap to write';
}

/* ================= Profile ================= */
function profileSteps(){ const p=S.profile||{}; return [{done:!!p.photo,t:'Add a profile picture',s:'An image that feels like you',act:'photo'},{done:!!(p.bio&&p.bio.trim()),t:'Write a short bio',s:'Tell people what you perform',act:'edit-profile'},{done:S.recs.length>0,t:'Make your first recording',s:'Sing, read or perform anything',act:'first-rec'}]; }
function streak(){ const days=new Set(S.stats.days); let n=0; const d=new Date(); for(;;){ const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); if(days.has(k)){ n++; d.setDate(d.getDate()-1); } else break; } return n; }
RENDER.profile=function(){
  const el=$('#tab-profile'), p=S.profile||{name:'Performer',handle:'@performer'};
  const steps=profileSteps(), done=steps.filter(s=>s.done).length, next=steps.find(s=>!s.done);
  const av=avatarURL(), st=streak();
  el.innerHTML=`
    <div class="phero"><div class="bgblur" style="background-image:url('${av}')"></div>
      <div class="bar"><span class="streak">${ic('flame','sm')}${st?st+'-day streak':'Start a streak'}</span><span class="sp"></span>
        <button class="circ glass" data-act="share-profile" aria-label="Share profile">${ic('share-2')}</button>
        <button class="circ glass bellwrap" data-act="news" aria-label="What's new">${ic('bell')}${NEWS.length>S.newsSeen?'<i class="badge"></i>':''}</button>
        <button class="circ glass" data-act="settings" aria-label="Settings">${ic('settings')}</button></div></div>
    <div class="pid"><button class="pav" data-act="photo" style="background-image:url('${av}')" aria-label="Change profile picture"></button>
      <div class="pname"><h1>${esc(p.name)}</h1><span>${esc(p.handle)}</span></div>
      <button class="btn" data-act="edit-profile">${ic('pencil','sm')}Edit</button></div>
    ${p.bio?`<p class="pbio">${esc(p.bio)}</p>`:''}
    <div class="pstats">
      <div><b>${S.recs.length}</b><span>Takes</span></div><div><b>${S.items.length}</b><span>Saved</span></div>
      <div><b>${S.likes.size}</b><span>Liked</span></div><div><b>${Math.round(S.stats.seconds/60)}</b><span>Minutes</span></div>
    </div>
    ${next?`<div class="sec" style="margin-top:28px"><div class="pad"><h2 style="margin:0;font-size:1.45rem;font-weight:500;letter-spacing:-.025em">Complete your profile</h2><div class="mute" style="margin-top:2px">Step ${done+1} of 3</div></div>
      <div class="prog3">${steps.map(s=>`<i class="${s.done?'on':''}"></i>`).join('')}</div>
      <button class="card step" data-act="${next.act}"><div><b>${esc(next.t)}</b><span>${esc(next.s)}</span></div>${ic('chevron-right','chev')}</button></div>`:''}
    <section class="sec">${secHead('Recordings',S.recs.length||S.drafts.length?'data-act="recs"':'')}${S.drafts.length?`<button class="card step" data-act="recs" style="margin:0 20px 14px"><div><b>${S.drafts.length} draft${S.drafts.length>1?'s':''} in progress</b><span>Pick up where you left off</span></div>${ic('chevron-right','chev')}</button>`:''}
      ${S.recs.length?`<div class="recgrid">${S.recs.slice(0,9).map(recCell).join('')}</div>`:`<div class="empty">${ic('video')}<b>No recordings yet</b>Your takes appear here after you save them in the studio.<div style="margin-top:14px"><button class="btn white sm" data-act="first-rec">${ic('mic-vocal','sm')}Make your first take</button></div></div>`}
    </section>
    ${S.likes.size?`<section class="sec">${secHead('Liked',`data-act="liked"`)}<div class="hscroll">${[...S.likes].map(find).filter(Boolean).slice(0,10).map(x=>sqHTML(x)).join('')}</div></section>`:''}`;
};
const recCell=r=>`<button class="rcell" data-act="rec-open" data-id="${r.id}" style="${r.thumb?`background-image:url('${r.thumb}')`:''}" aria-label="${esc(r.title)}"><span class="rd">${ic('play','fill xs')}${fmt(r.dur)}</span></button>`;
function updateTabAvatar(){ const a=$('#tabAv'); if(a) a.style.backgroundImage=`url('${avatarURL()}')`; }

/* ================= Detail ================= */
function openDetail(id){ push('detail',el=>renderDetail(el,id)); }
function renderDetail(el,id){
  const it=find(id); if(!it){ el.innerHTML=pbar('Not found')+'<div class="empty">This item is no longer available.</div>'; return; }
  const k=KIND[it.kind], liked=S.likes.has(id), lib=isLib(it), d=durOf(it);
  const chips=[k.label, d?fmt(d):'', it.form||'', it.genre||'', it.level||'', it.mood||'', it.cat&&it.kind!=='inst'?fmtK(playsOf(id))+' plays':''].filter(Boolean);
  let body='';
  if(it.kind==='song'){
    const lines=lyricLines(bodyOf(it)), t=it.times||[];
    body=lines.length?`<div class="dbody">${lines.map((l,i)=>`<div class="lrow"><time>${t[i]!=null?fmt(t[i]):'–'}</time><span>${esc(l)}</span></div>`).join('')}</div>`:`<div class="empty">No lyrics yet.</div>`;
  } else if(it.kind==='inst'){
    body=`<div class="prow"><time id="dNow">0:00</time><input type="range" id="dSeek" min="0" max="${it.dur}" step="0.1" value="0" aria-label="Position"><time>${fmt(it.dur)}</time></div>
      <div class="card" style="margin:22px 20px 0;padding:16px 18px"><b style="font-weight:500">Use it as a music bed</b><p class="hint" style="margin-top:4px">Open any poem, script or movie line, tap Tune, and pick this track under Music bed. It plays while you read and is mixed into your take in the studio.</p></div>`;
  } else {
    body=`<div class="dbody ${it.kind==='poem'?'poem':''}">${esc(bodyOf(it)).replace(/\[([^\]]*)\]/g,'<span class="cue">[$1]</span>')}</div>`;
  }
  const credit=it.kind==='inst'?(it.user?'Made by you in Lectern Studio · Stored on this device':`Music by Tanner Helland · CC BY 4.0 · ${it.embed?'Included offline':'Streams from GitHub, downloads for offline use'}`)
    :it.pdb?'Public-domain text via PoetryDB (edition CC BY 4.0)':it.credit||(it.original?'Written for Lectern · Free to perform and share':'');
  const playing=it.kind==='inst' && PREV.id===id && !PREV.audio.paused;
  el.innerHTML=`<div class="pbar clear"><button class="circ glass" data-act="back" aria-label="Back">${ic('chevron-left')}</button><span style="flex:1"></span><button class="circ glass" data-act="share" data-id="${esc(id)}" aria-label="Share">${ic('share-2')}</button></div>
    <div class="dhero"><div class="bgblur" style="background-image:url('${cover(it,320)}')"></div>
      <div class="dart" style="${coverCss(it,520)}"></div>
      <h2>${esc(titleOf(it))}</h2><div class="by">${esc(it.sub||(lib?'In your library':''))}</div>
      <div class="dmeta">${chips.map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div></div>
    <div class="dacts">
      <button class="circ" data-act="like" data-id="${esc(id)}" aria-label="${liked?'Unlike':'Like'}" aria-pressed="${liked}">${ic('heart',liked?'fill':'')}</button>
      <button class="btn white" data-act="play" data-id="${esc(id)}">${ic(it.kind==='inst'?(playing?'pause':'play'):k.play,it.kind==='inst'?'fill':'')}${it.kind==='inst'?(playing?'Pause':'Play'):k.verb}</button>
      ${lib?`<button class="circ" data-act="edit" data-id="${esc(id)}" aria-label="Edit">${ic('pencil')}</button>`:`<button class="circ" data-act="addto" data-id="${esc(id)}" aria-label="Add to collection">${ic('list-plus')}</button>`}
      <button class="circ" data-act="menu" data-id="${esc(id)}" aria-label="More">${ic('ellipsis-vertical')}</button>
    </div>
    ${it.kind==='line'?`<div class="pad" style="margin-top:20px"><div class="mute" style="font-size:.84rem;margin-bottom:8px">Perform with</div><div class="seg2">${[['me','mic','My voice'],['narrator','audio-lines','AI narrator'],...(it.clip?[['original','volume-2','Original clip'],['dub','mic-vocal','Dub over clip']]:[])].map(([v,i,l])=>`<button class="chip" data-act="set-voice" data-id="${esc(id)}" data-v="${v}" aria-pressed="${voiceOf(it)===v}">${ic(i,'xs')}${l}</button>`).join('')}${it.cat?`<button class="chip" data-act="clip-for" data-id="${esc(id)}">${ic('upload','xs')}Use a real clip…</button>`:''}</div></div>`:''}
    ${body}
    ${credit?`<div class="credit">${ic('badge-check','sm')}<span>${esc(credit)}</span></div>`:''}`;
  if(it.kind==='inst') bindDetailSeek(el,it);
}
function bindDetailSeek(el,it){
  const s=el.querySelector('#dSeek'), n=el.querySelector('#dNow'); if(!s) return;
  if(PREV.id===it.id){ s.value=PREV.audio.currentTime||0; n.textContent=fmt(PREV.audio.currentTime); }
  s.oninput=()=>{ if(PREV.id!==it.id){ togglePreview(it).then(()=>{ PREV.audio.currentTime=+s.value; }); } else PREV.audio.currentTime=+s.value; };
}

/* ================= Item menu ================= */
function itemMenu(id){
  const it=find(id); if(!it) return; const k=KIND[it.kind], lib=isLib(it), liked=S.likes.has(id);
  actionSheet(titleOf(it),[
    {icon:it.kind==='inst'?'play':k.play,label:it.kind==='inst'?'Play':k.verb,run:()=>startItem(it)},
    {icon:'heart',label:liked?'Remove from Liked':'Like',run:()=>{ const v=toggleLike(id); toast(v?'Added to Liked':'Removed from Liked'); refresh(); }},
    {icon:'list-plus',label:'Add to collection',run:()=>addToCollection(id)},
    !lib && it.kind!=='inst' && {icon:'copy',label:'Save a copy to edit',sub:'Adds an editable copy to your library',run:()=>saveCopy(it)},
    lib && {icon:'pencil',label:'Edit',run:()=>openEditor(id)},
    lib && {icon:'copy',label:'Duplicate',run:()=>{ const c={...JSON.parse(JSON.stringify(it)),id:uid(),title:titleOf(it)+' (copy)',updated:Date.now()}; if(c.music&&c.music.type==='file') delete c.music; S.items.push(c); SAVE.items(); toast('Duplicated'); refresh(); }},
    it.kind==='inst' && {icon:'cloud-download',label:'Download for offline',run:()=>downloadInst(it)},
    {icon:'share-2',label:'Share',run:()=>shareItem(it)},
    lib && {icon:'trash',label:'Delete',danger:true,run:()=>confirmSheet('Delete “'+titleOf(it)+'”?','This removes it from your library. Recordings you made stay.','Delete',()=>{ deleteItem(it); toast('Deleted'); if(STACK.length && STACK[STACK.length-1].name!=='library') pop(); refresh(); })}
  ]);
}
function deleteItem(it){ S.items=S.items.filter(x=>x!==it); if(it.kind==='song') idb.del(it.id); S.likes.delete(it.id); SAVE.likes(); S.colls.forEach(c=>c.ids=c.ids.filter(x=>x!==it.id)); SAVE.colls(); SAVE.items(); }
function saveCopy(it,open=true){
  const c={id:uid(),kind:it.kind,title:it.title,body:bodyOf(it),updated:Date.now(),from:it.id};
  if(it.kind==='song'){ c.times=(it.times||[]).slice(); c.ends=(it.ends||[]).slice(); c.music={type:'cat',id:it.id,dur:it.dur}; c.offset=0; }
  if(it.sub) c.sub=it.sub;
  S.items.push(c); SAVE.items(); toast('Saved to your library'); if(open) openEditor(c.id); return c;
}
async function shareItem(it){
  const text=`${titleOf(it)}${it.sub?' — '+it.sub:''}\n\n${it.kind==='inst'?'An instrumental':bodyOf(it).slice(0,400)}\n\nPerformed with Lectern`;
  try{ if(navigator.share){ await navigator.share({title:titleOf(it),text}); return; } }catch(e){ if(e&&e.name==='AbortError') return; }
  try{ await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }catch(e){ toast('Sharing isn’t available here'); }
}
async function downloadInst(it){
  if(await isOffline(it)){ toast('Already available offline'); return; }
  toast('Downloading “'+it.title+'”…');
  try{ await instBlob(it); toast('Saved for offline use'); refresh(); }catch(e){ toast('Download failed. Check your connection.'); }
}

/* ================= Collections, Liked, Downloads ================= */
function addToCollection(id){
  const render=(el)=>{
    el.querySelector('.list-c').innerHTML=S.colls.length?S.colls.map(c=>{ const on=c.ids.includes(id); return `<button class="opt" data-c="${c.id}"><span class="oi" style="${c.ids[0]&&find(c.ids[0])?coverCss(find(c.ids[0]),120)+';background-size:cover':''}">${c.ids[0]?'':ic('list-music')}</span><div><b>${esc(c.name)}</b><span>${c.ids.length} item${c.ids.length===1?'':'s'}</span></div><span style="margin-left:auto">${on?ic('circle-check'):''}</span></button>`; }).join(''):`<p class="sub">No collections yet. Make your first one below.</p>`;
  };
  sheet(`<h3>Add to collection</h3><div class="list-c"></div><label class="field" style="margin-top:12px"><span>New collection</span><input id="ncName" placeholder="e.g. Open mic night" maxlength="40"></label><div class="row-btns"><button class="btn white" id="ncMake">${ic('plus','sm')}Create and add</button></div>`,{onMount(el,close){
    render(el);
    el.addEventListener('click',e=>{ const b=e.target.closest('[data-c]'); if(!b) return; const c=S.colls.find(x=>x.id===b.dataset.c); if(c.ids.includes(id)){ c.ids=c.ids.filter(x=>x!==id); toast('Removed from '+c.name); } else { c.ids.unshift(id); toast('Added to '+c.name); } SAVE.colls(); render(el); });
    el.querySelector('#ncMake').onclick=()=>{ const n=el.querySelector('#ncName').value.trim(); if(!n){ el.querySelector('#ncName').focus(); return; } S.colls.unshift({id:uid(),name:n,ids:[id],created:Date.now()}); SAVE.colls(); toast('Created “'+n+'”'); close(); refresh(); };
  }});
}
function openColls(){ push('colls',el=>{
  el.innerHTML=pbar('Collections',`<button class="circ" data-act="new-coll" aria-label="New collection">${ic('plus')}</button>`)+
    (S.colls.length?`<div class="list" style="margin-top:6px">${S.colls.map(c=>{ const f=c.ids.map(find).filter(Boolean); return `<div class="row"><button class="rowmain" data-act="coll" data-id="${c.id}"><span class="th" style="${f[0]?coverCss(f[0],160):''}">${f[0]?'':`<span style="display:grid;place-items:center;height:100%">${ic('list-music')}</span>`}</span><span class="tx"><b>${esc(c.name)}</b><span>${f.length} item${f.length===1?'':'s'}</span></span></button><button class="kebab" data-act="coll-menu" data-id="${c.id}" aria-label="Collection options">${ic('ellipsis-vertical')}</button></div>`; }).join('')}</div>`
    :`<div class="empty">${ic('list-music')}<b>No collections yet</b>Group songs, poems and lines for a set, a class or an open mic.<div style="margin-top:14px"><button class="btn white sm" data-act="new-coll">${ic('plus','sm')}New collection</button></div></div>`);
}); }
function newCollection(){ sheet(`<h3>New collection</h3><label class="field"><span>Name</span><input id="ncName2" maxlength="40" placeholder="e.g. Sunday karaoke"></label><div class="row-btns"><button class="btn white" id="ncOk">Create</button></div>`,{onMount(el,close){ const go=()=>{ const n=el.querySelector('#ncName2').value.trim(); if(!n) return; S.colls.unshift({id:uid(),name:n,ids:[],created:Date.now()}); SAVE.colls(); close(); refresh(); toast('Collection created'); }; el.querySelector('#ncOk').onclick=go; el.querySelector('#ncName2').onkeydown=e=>{ if(e.key==='Enter') go(); }; }}); }
function openColl(cid){ push('coll',el=>{
  const c=S.colls.find(x=>x.id===cid); if(!c){ el.innerHTML=pbar('Collection')+'<div class="empty">Deleted.</div>'; return; }
  const f=c.ids.map(find).filter(Boolean);
  el.innerHTML=pbar(c.name,`<button class="circ" data-act="coll-menu" data-id="${c.id}" aria-label="Options">${ic('ellipsis-vertical')}</button>`)+
    (f.length?`<div class="pad" style="margin:4px 0 16px"><button class="btn white" data-act="coll-play" data-id="${c.id}">${ic('play','fill sm')}Start with “${esc(titleOf(f[0]))}”</button></div><div class="list">${f.map(x=>rowHTML(x,{tag:true})).join('')}</div>`:`<div class="empty">${ic('list-plus')}<b>Empty collection</b>Use the ⋮ menu on anything to add it here.</div>`);
}); }
function collMenu(cid){ const c=S.colls.find(x=>x.id===cid); if(!c) return;
  actionSheet(c.name,[{icon:'pencil',label:'Rename',run:()=>sheet(`<h3>Rename</h3><label class="field"><input id="rn" value="${esc(c.name)}" maxlength="40"></label><div class="row-btns"><button class="btn white" id="rnOk">Save</button></div>`,{onMount(el,close){ el.querySelector('#rnOk').onclick=()=>{ const v=el.querySelector('#rn').value.trim(); if(v){ c.name=v; SAVE.colls(); } close(); refresh(); }; }})},
    {icon:'trash',label:'Delete collection',danger:true,run:()=>confirmSheet('Delete “'+c.name+'”?','The items inside stay in your library.','Delete',()=>{ S.colls=S.colls.filter(x=>x!==c); SAVE.colls(); if(STACK.length&&STACK[STACK.length-1].name==='coll') pop(); refresh(); })}]); }
function openLiked(){ push('liked',el=>{ const f=[...S.likes].map(find).filter(Boolean);
  el.innerHTML=pbar('Liked')+(f.length?`<div class="list" style="margin-top:6px">${f.map(x=>rowHTML(x,{tag:true})).join('')}</div>`:`<div class="empty">${ic('heart')}<b>Nothing liked yet</b>Tap the heart on anything you love.</div>`); }); }
function openDownloads(){ push('downloads',el=>{
  el.innerHTML=pbar('Downloads')+`<p class="hint pad" style="margin:0 0 14px">Instrumentals saved in this browser for offline use. Karaoke arrangements are generated and cached the first time you sing.</p><div class="list" id="dlList">${catList('inst').map(x=>rowHTML(x,{sub:'<span class="dlst" data-id="'+x.id+'">Checking…</span>'})).join('')}</div>`;
  catList('inst').forEach(async x=>{ const off=await isOffline(x); const s=el.querySelector(`.dlst[data-id="${x.id}"]`); if(s) s.innerHTML=off?`${ic('circle-check','xs')} Available offline${x.embed?' · built in':''}`:`<button class="btn sm" data-act="dl" data-id="${x.id}" style="min-height:28px;padding:3px 10px">${ic('cloud-download','xs')}Download</button>`; });
}); }

/* ================= List pages ================= */
function openList(kind){ push('list',el=>{
  const ttl={song:'Karaoke',poem:'Poems',line:'Movie lines',inst:'Instrumentals'}[kind];
  const items=[...catList(kind),...(kind==='inst'?[]:S.items.filter(s=>s.kind===kind))];
  el.innerHTML=pbar(ttl)+`<h1 class="big">${ttl}</h1><div class="list">${items.map(x=>rowHTML(x)).join('')}</div>`;
}); }
function openClassics(author){ push('classics',el=>{
  el.innerHTML=pbar(author||'Classic poems')+`<h1 class="big">${esc(author||'Classic poems')}</h1>${author?'':`<div class="hscroll" style="margin-bottom:16px">${CLASSIC_POETS.map(a=>`<button class="chip" data-act="poet" data-name="${esc(a)}">${esc(a)}</button>`).join('')}</div>`}<div class="list" id="clList">${Array.from({length:6},()=>`<div class="row"><span class="th sk"></span><span class="tx"><span class="sk" style="display:block;height:14px;width:60%"></span><span class="sk" style="display:block;height:12px;width:35%;margin-top:8px"></span></span></div>`).join('')}</div><p class="hint pad" style="margin-top:16px">Public-domain poems from PoetryDB (CC BY 4.0 edition). Tap one to read it aloud.</p>`;
  const L=el.querySelector('#clList');
  const p=author?pdbAuthor(author):pdbRandom(14).then(list=>list.map(x=>({author:x.sub,title:x.title,linecount:x.body.split('\n').filter(Boolean).length})));
  p.then(list=>{ L.innerHTML=list.length?list.map(p=>`<div class="row"><button class="rowmain" data-act="pdb-open" data-a="${esc(p.author)}" data-t="${esc(p.title)}"><span class="th" style="${coverCss({id:'pdbq-'+hash(p.author+p.title),kind:'poem',title:p.title},160)}"></span><span class="tx"><b>${esc(p.title)}</b><span>${esc(p.author)}<i class="dot-sep"></i>${p.linecount} lines</span></span></button></div>`).join(''):'<p class="hint">Nothing found.</p>'; })
   .catch(()=>{ L.innerHTML=`<div class="empty">${ic('wifi-off')}<b>You're offline</b>Classic poems need a connection the first time. Ones you've opened stay available.</div>`+(S.pdb.length?`<div class="list">${S.pdb.slice().reverse().map(x=>rowHTML(x)).join('')}</div>`:''); });
}); }
async function openPdb(author,title){
  toast('Opening “'+title+'”…');
  try{ const p=await pdbPoem(author,title); rememberSearch(); openDetail(p.id); }
  catch(e){ toast('Couldn’t load that poem. Check your connection.'); }
}

/* ================= Editor ================= */
function newItem(kind){ const s={id:uid(),kind,title:'',body:'',updated:Date.now()}; if(kind==='song'){ s.times=[]; s.offset=0; } S.items.push(s); SAVE.items(); openEditor(s.id,true); }
function openCreate(){
  actionSheet('Create',[
    {icon:'mic-vocal',label:'Karaoke song',sub:'Your lyrics, your music, synced word by word',run:()=>newItem('song')},
    {icon:'feather',label:'Poem',sub:'Line breaks kept, set in a serif',run:()=>newItem('poem')},
    {icon:'clapperboard',label:'Movie line or monologue',sub:'Practise a scene with stage directions',run:()=>newItem('line')},
    {icon:'scroll-text',label:'Script',sub:'Talks, videos and presentations',run:()=>newItem('script')}
  ]);
}
const PH={script:'Paste or write your script here. Leave a blank line between paragraphs.',poem:'Write your poem here. Line breaks are kept. Leave a blank line between stanzas.',song:'One lyric line per row.\nLabels like [Chorus] on their own line are skipped.\nYou can also paste the contents of an .lrc file.',line:'Write your lines here. Put directions in brackets, like [pause] or [whisper].'};
let edSaveT=0;
function openEditor(id,isNew){ push('edit',el=>renderEditor(el,id,isNew)); }
function renderEditor(el,id,isNew){
  const s=find(id); if(!s||!isLib(s)){ el.innerHTML=pbar('Edit')+'<div class="empty">Not found.</div>'; return; }
  const k=KIND[s.kind];
  el.innerHTML=pbar(isNew?'New '+k.label.toLowerCase():'Edit',`<button class="circ" data-act="menu" data-id="${s.id}" aria-label="More">${ic('ellipsis-vertical')}</button>`)+`
  <div class="ed">
    <div class="head"><span class="art" style="${coverCss(s,200)}"></span><textarea class="title-in" id="edTitle" rows="1" maxlength="80" placeholder="${k.label} title" aria-label="Title">${esc(s.title)}</textarea></div>
    <div class="meta" id="edMeta"></div>
    ${s.kind==='song'?`
      <div class="h3">Music</div>
      <div class="grp">
        <div class="grow"><button class="circ sm mt" data-act="music-toggle" data-id="${s.id}" aria-label="Play or pause the music">${ic('eighth-notes','sm')}</button><div class="lbl"><b id="musName"></b><small id="musSub"></small></div><div class="acts"><button class="btn sm" data-act="music-pick" data-id="${s.id}">Choose</button><button class="circ sm" data-act="music-remove" data-id="${s.id}" id="musDel" aria-label="Remove music">${ic('x','sm')}</button></div></div>
      </div>
      <p class="hint">Pick an instrumental from Lectern or upload your own track. Uploads stay in this browser.</p>
      ${timingGroup(s)}`:''}
    ${s.kind==='line'?`
      <div class="h3">Reference audio</div>
      <div class="grp">
        <div class="grow">${s.clip?`<button class="circ sm mt" data-act="music-toggle" data-id="${s.id}" aria-label="Play or pause the clip">${ic(s.clip.type==='video'?'film':'audio-lines','sm')}</button>`:`<span class="circ sm">${ic('audio-lines','sm')}</span>`}<div class="lbl"><b>${esc(s.clip?s.clip.name:'No clip yet')}</b><small>${s.clip?fmt(s.clip.dur)+' · '+(s.clip.type==='video'?'video clip':'audio clip'):'Import audio or video from a short clip'}</small></div><div class="acts"><button class="btn sm" data-act="clip-import" data-id="${s.id}">${s.clip?'Replace':'Import'}</button>${s.clip?`<button class="circ sm" data-act="clip-remove" data-id="${s.id}" aria-label="Remove clip">${ic('x','sm')}</button>`:''}</div></div>
      </div>
      <div class="h3">Perform with</div>
      <div class="seg2">${[['me','mic','My voice'],['original','volume-2','Original clip'],['dub','mic-vocal','Dub over clip'],['narrator','audio-lines','AI narrator']].map(([v,i,l])=>`<button class="chip" data-act="set-voice" data-id="${s.id}" data-v="${v}" aria-pressed="${voiceOf(s)===v}" ${(v==='original'||v==='dub')&&!s.clip?'disabled':''}>${ic(i,'xs')}${l}</button>`).join('')}</div>
      <p class="hint">${({me:'The prompter scrolls at your pace and you perform the lines yourself.',original:'The real clip audio plays with the lines highlighted in time, and it’s mixed into your take.',dub:'The clip runs silently as a guide (video shows picture-in-picture) so you can voice it yourself.',narrator:'A text-to-speech voice reads the lines so you can hear the rhythm first.'})[voiceOf(s)]}</p>
      ${s.clip?timingGroup(s):''}`:''}
    <div class="h3">${s.kind==='song'?'Lyrics':s.kind==='poem'?'Poem':s.kind==='line'?'Lines':'Script'}<small id="edCount"></small></div>
    <textarea class="body-in ${s.kind==='poem'?'poem':s.kind==='song'?'song':''}" id="edBody" placeholder="${esc(PH[s.kind])}" aria-label="Text">${esc(s.body)}</textarea>
    ${s.kind!=='song'?`<div class="h3">Add a direction</div><div class="chips" id="edCues">${[['pause','pause'],['breathe','wind'],['smile','face-slightly-smiling'],['look at the lens','eye'],['slow down','turtle'],['emphasis','zap'],['whisper','volume-2'],['gesture','hand']].map(([c,i])=>`<button class="chip" data-cue="${c}">${ic(i,'xs')}${c[0].toUpperCase()+c.slice(1)}</button>`).join('')}</div>`:''}
  </div>
  <div class="foot"><button class="btn white" data-act="play" data-id="${s.id}">${ic(k.play,'sm')}${k.verb}</button></div>`;
  const T=el.querySelector('#edTitle'), B=el.querySelector('#edBody');
  const fit=()=>{ T.style.height='auto'; T.style.height=T.scrollHeight+'px'; };
  requestAnimationFrame(fit);
  const stats=()=>{
    const b=B.value, m=el.querySelector('#edMeta');
    let chips=[];
    if(s.kind==='song'){ const n=lyricLines(b).length, kk=(s.times||[]).slice(0,n).filter(v=>v!=null).length; chips=[n+' lines',kk+'/'+n+' synced',musicName(s)?'Music ✓':'No music']; }
    else if(s.kind==='poem') chips=[b.split('\n').filter(l=>l.trim()).length+' lines',b.split(/\n\s*\n/).filter(x=>x.trim()).length+' stanzas',fmt(readSecs(b,'poem'))+' aloud'];
    else chips=[wordCount(b)+' words',fmt(readSecs(b))+' read',cueCount(b)+' directions'];
    m.innerHTML=chips.map(c=>`<span class="chip" style="min-height:30px;padding:5px 11px;font-size:.8rem">${esc(c)}</span>`).join('');
    el.querySelector('#edCount').textContent='';
    if(s.kind==='song'||(s.kind==='line'&&s.clip)) songPanel(el,s);
  };
  const save=()=>{ s.title=T.value.replace(/\n/g,' '); s.body=B.value; s.updated=Date.now(); clearTimeout(edSaveT); edSaveT=setTimeout(SAVE.items,350); stats(); };
  T.addEventListener('input',()=>{ fit(); save(); });
  T.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); B.focus(); } });
  B.addEventListener('input',save);
  const tryLrc=()=>{ if((s.kind==='song'||s.kind==='line') && /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(B.value)) importLrc(s,B.value,true); };
  B.addEventListener('paste',()=>setTimeout(tryLrc,0)); B.addEventListener('blur',tryLrc);
  const cues=el.querySelector('#edCues');
  if(cues) cues.addEventListener('click',e=>{ const b=e.target.closest('[data-cue]'); if(!b) return; const st=B.selectionStart??B.value.length, en=B.selectionEnd??st, before=B.value.slice(0,st), after=B.value.slice(en);
    const ins=(before&&!/\s$/.test(before)?' ':'')+'['+b.dataset.cue+']'+(after&&!/^\s/.test(after)?' ':''); B.value=before+ins+after; const c=st+ins.length; B.focus(); B.setSelectionRange(c,c); save(); });
  stats();
  if(isNew) setTimeout(()=>T.focus(),420);
}
function timingGroup(s){
  const lbl=s.kind==='line'?'lines':'lyrics';
  return `<div class="h3">Timing</div>
      <div class="grp">
        <div class="grow"><div class="lbl"><b id="syncStatus"></b><small>Tap along — taps snap to vocal onsets</small></div><button class="btn white sm" data-act="sync" data-id="${s.id}" id="syncBtn">Tap sync</button></div>
        <div class="grow"><div class="lbl"><b>Auto-sync</b><small>AI aligns your ${lbl} word by word · Quick works offline</small></div><div class="acts"><button class="btn sm" data-act="auto-quick" data-id="${s.id}">Quick</button><button class="btn white sm" data-act="auto-ai" data-id="${s.id}">${ic('sparkles','xs')}AI</button></div></div>
        <div class="grow"><div class="lbl"><b>Generate ${lbl} from audio</b><small>Transcribes the ${s.kind==='line'?'clip':'song'} with Whisper, with timings</small></div><button class="btn sm" data-act="auto-gen" data-id="${s.id}">${ic('wand-sparkles','xs')}Generate</button></div>
        <div class="grow"><div class="lbl"><b>Fine-tune</b><small>Drag lines on the waveform</small></div><button class="btn sm" data-act="timeline" data-id="${s.id}" id="tlBtn">${ic('audio-waveform','xs')}Open</button></div>
        <div class="grow"><div class="lbl"><b>Lyrics file</b><small>.lrc with word timing (A2) import and export</small></div><div class="acts"><button class="btn sm" data-act="lrc-import">Import</button><button class="btn sm" data-act="lrc-export" data-id="${s.id}" id="lrcExp">Export</button></div></div>
        <div class="grow"><div class="lbl"><b>Clear timing</b></div><button class="btn sm" data-act="sync-clear" data-id="${s.id}" id="syncClr">Clear</button></div>
      </div>`;
}
function songPanel(el,s){
  const n=lyricLines(s.body).length, k=(s.times||[]).slice(0,n).filter(v=>v!=null).length;
  const nm=musicName(s);
  if(el.querySelector('#musName')){ el.querySelector('#musName').textContent=nm||'No music yet';
  el.querySelector('#musSub').textContent=nm?(s.music&&s.music.dur?fmt(s.music.dur):'Ready'):'Choose an instrumental or upload a file';
  el.querySelector('#musDel').hidden=!nm; }
  if(!el.querySelector('#syncStatus')) return;
  const wk=(s.wt||[]).filter(Boolean).length;
  const st=el.querySelector('#syncStatus'); st.classList.remove('warn');
  if(!n) st.textContent='Add lyrics, then sync';
  else if(!k) st.textContent='Not synced yet';
  else if(s.times.length!==n){ st.textContent='Lyrics changed — re-sync'; st.classList.add('warn'); }
  else st.textContent=(k>=n?`All ${n} lines synced`:`${k} of ${n} lines synced`)+(wk?' · word timing':'');
  el.querySelector('#syncBtn').textContent=k?'Re-tap':'Tap sync';
  el.querySelector('#lrcExp').disabled=!k; el.querySelector('#syncClr').disabled=!k;
}
function lineEditorRefresh(){ const e=STACK[STACK.length-1]; if(e&&e.name==='edit') rerender(e); }
function pickMusic(s){
  actionSheet('Music for this song',[
    {icon:'upload',label:'Upload an audio file',sub:'MP3, M4A, WAV… stays on this device',run:()=>{ PENDING_UPLOAD=s.id; $('#fileAudio').click(); }},
    ...allInst().map(x=>({icon:x.user?(x.store==='beat'?'drum':'mic'):'audio-waveform',label:x.title,sub:x.mood+' · '+fmt(x.dur)+' · '+x.sub,run:async()=>{ s.music={type:'inst',id:x.id,dur:x.dur}; s.updated=Date.now(); SAVE.items(); player.unload(); lineEditorRefresh(); toast('Music set to “'+x.title+'”'); try{ await instBlob(x); }catch(e){ toast('Will download when you go online'); } }})),
    ...catList('song').filter(x=>x.layout.notes.length||x.original).slice(0,4).map(x=>({icon:'piano',label:x.title+' (arrangement)',sub:'Generated backing track',run:()=>{ s.music={type:'cat',id:x.id,dur:x.dur}; SAVE.items(); player.unload(); lineEditorRefresh(); toast('Music set'); }}))
  ]);
}
let PENDING_UPLOAD=null, PENDING_CLIP=null;
function parseLrc(text){
  const out=[]; let offset=0, title='';
  text.split(/\r?\n/).forEach(raw=>{
    const line=raw.trim(); if(!line) return;
    const meta=line.match(/^\[(ti|ar|al|by|offset|length|re|ve|au):(.*)\]$/i);
    if(meta){ const k=meta[1].toLowerCase(); if(k==='offset') offset=(+meta[2]||0)/1000; if(k==='ti') title=meta[2].trim(); return; }
    const tags=[...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    const txt=line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g,'').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g,'').trim();
    if(!tags.length||!txt) return;
    tags.forEach(m=>{ const frac=m[3]?(+m[3])/Math.pow(10,m[3].length):0; out.push({t:(+m[1])*60+(+m[2])+frac,txt}); });
  });
  out.sort((a,b)=>a.t-b.t);
  return {lines:out.map(o=>({t:Math.max(0,+(o.t-offset).toFixed(2)),txt:o.txt})),title};
}
function importLrc(s,text,quiet){
  const r=parseLrcPro(text); if(!r.lines.length){ if(!quiet) toast('No timed lines found'); return; }
  s.body=r.lines.join('\n'); s.times=r.times; s.wt=r.wt; s.ends=r.wt.map(w=>w&&w.length?w[w.length-1].e:null); if(!r.wt.some(Boolean)){ s.ends=[]; finishTiming(s,null); }
  if(!s.title.trim()&&r.title) s.title=r.title;
  s.updated=Date.now(); SAVE.items(); lineEditorRefresh(); toast('Imported timing for '+r.lines.length+' lines');
}

/* ================= Recordings ================= */
function draftsHTML(){ if(!S.drafts.length) return '';
  const ago=t=>{ const m=Math.round((Date.now()-t)/60000); return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'; };
  return `<div class="lib-h" style="margin-top:4px"><h2>Drafts</h2><span class="mute" style="font-size:.85rem">${S.drafts.length}</span></div><div class="list">${S.drafts.map(d=>`<div class="row"><button class="rowmain" data-act="draft-open" data-id="${d.id}"><span class="th draft" style="${d.thumb?`background-image:url('${d.thumb}')`:''}">${d.thumb?'':ic('video','sm')}${d.dur?`<span class="dur">${fmt(d.dur)}</span>`:''}</span><span class="tx"><b>${esc(d.title)}${d.recovered?'<span class="tag">Recovered</span>':''}</b><span>Edited ${ago(d.updated)}</span></span></button><button class="kebab" data-act="draft-menu" data-id="${d.id}" aria-label="Draft options">${ic('ellipsis-vertical')}</button></div>`).join('')}</div>`; }
function openRecs(){ push('recs',el=>{
  el.innerHTML=pbar('Recordings')+draftsHTML()+(S.drafts.length&&S.recs.length?'<div class="lib-h"><h2>Saved</h2></div>':'')+(S.recs.length?`<div class="recgrid" style="margin-top:6px">${S.recs.map(recCell).join('')}</div>`:S.drafts.length?'':`<div class="empty">${ic('video')}<b>No recordings yet</b>Record a take, polish it in the studio, and it lands here.</div>`);
}); }
function openRec(id){ push('rec',async el=>{
  const r=S.recs.find(x=>x.id===id); if(!r){ el.innerHTML=pbar('Recording')+'<div class="empty">Deleted.</div>'; return; }
  el.innerHTML=pbar(r.title,`<button class="circ" data-act="rec-menu" data-id="${r.id}" aria-label="Options">${ic('ellipsis-vertical')}</button>`)+`<div class="vplayer"><video controls playsinline id="rvid" poster="${r.thumb||''}"></video></div>
    <div class="pad" style="margin-top:16px"><div class="dmeta" style="justify-content:flex-start">${[fmt(r.dur),new Date(r.created).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),r.filter&&r.filter!=='none'?'Filter: '+(FILTERS.find(f=>f.id===r.filter)||{}).name:'',r.voice&&r.voice!=='none'?'Voice: '+fxName(r.voice):''].filter(Boolean).map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div></div>
    <div class="pad" style="display:flex;gap:10px;margin-top:18px"><button class="btn white" style="flex:1" data-act="rec-share" data-id="${r.id}">${ic('share-2','sm')}Share</button><button class="btn" style="flex:1" data-act="rec-dl" data-id="${r.id}">${ic('download','sm')}Download</button></div>
    <div class="pad" style="margin-top:10px"><button class="btn block" data-act="rec-remix" data-id="${r.id}">${ic('wand-sparkles','sm')}Remix in studio</button></div>`;
  const b=await idb.get(r.id,'rec'); const v=el.querySelector('#rvid'); if(b&&v){ if(v._u) URL.revokeObjectURL(v._u); v._u=URL.createObjectURL(b); v.src=v._u; }
  else if(v) v.insertAdjacentHTML('afterend','<p class="hint pad">This recording’s video file is missing from browser storage.</p>');
}); }
async function recFile(r){ const b=await idb.get(r.id,'rec'); if(!b) return null; const ext=(b.type||'').includes('mp4')?'mp4':'webm'; return new File([b],(r.title||'take').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-').toLowerCase()+'-'+r.id+'.'+ext,{type:b.type||'video/webm'}); }
async function shareRec(r){ const f=await recFile(r); if(!f){ toast('Video missing'); return; } try{ if(navigator.canShare&&navigator.canShare({files:[f]})){ await navigator.share({files:[f],title:r.title}); } else { downloadFile(f); toast('Sharing files isn’t supported here, so it was downloaded'); } }catch(e){ if(e&&e.name!=='AbortError') toast('Couldn’t share'); } }
function downloadFile(f){ const a=document.createElement('a'); a.href=URL.createObjectURL(f); a.download=f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }

/* ================= Profile edit, settings, news ================= */
const NEWS=[
  {icon:'mic-vocal',t:'Karaoke with word-by-word lyrics',s:'Nine songs with full arrangements and an optional guide vocal.'},
  {icon:'wand-sparkles',t:'Studio: voices and filters',s:'Deep, chipmunk, robot, hall and more. Ten film looks, captions and grain.'},
  {icon:'book-open',t:'Thousands of classic poems',s:'Search public-domain poetry from PoetryDB and read it aloud.'},
  {icon:'clapperboard',t:'Movie lines to practise',s:'Eight original scenes across noir, sci-fi, drama and more.'}
];
function openNews(){ S.newsSeen=NEWS.length; store.set('lectern.newsSeen',S.newsSeen); sheet(`<h3>What's new</h3>${NEWS.map(n=>`<div class="opt" style="cursor:default"><span class="oi">${ic(n.icon)}</span><div><b>${esc(n.t)}</b><span>${esc(n.s)}</span></div></div>`).join('')}<div class="row-btns" style="margin-top:12px"><button class="btn white" data-close>Got it</button></div>`,{onMount(el,close){ el.querySelector('[data-close]').onclick=close; },onClose(){ refresh(); }}); }
function editProfile(){
  const p=S.profile;
  sheet(`<h3>Edit profile</h3>
    <div style="display:flex;align-items:center;gap:16px;margin:0 20px 18px"><span class="pav" id="epAv" style="width:76px;height:76px;background-image:url('${avatarURL()}')"></span><div style="display:grid;gap:8px"><button class="btn sm" id="epPhoto">${ic('camera','sm')}${p.photo?'Change photo':'Add photo'}</button>${p.photo?`<button class="btn sm danger" id="epRm">Remove photo</button>`:''}</div></div>
    <div class="field"><span>Colour</span><div class="swatches" id="epSw">${PALETTES.slice(0,8).map((_,i)=>`<button class="sw" data-i="${i}" aria-pressed="${(p.pal??4)===i}" style="background-image:url('${cover({id:'av:'+i+':'+(p.name||''),kind:'av',pal:i},96)}');background-size:cover" aria-label="Colour ${i+1}"></button>`).join('')}</div></div>
    <label class="field"><span>Name</span><input id="epName" maxlength="40" value="${esc(p.name)}"></label>
    <label class="field"><span>Handle</span><input id="epHandle" maxlength="30" value="${esc(p.handle)}"></label>
    <label class="field"><span>Bio</span><textarea id="epBio" maxlength="160" placeholder="Open-mic regular. Sonnet enthusiast.">${esc(p.bio||'')}</textarea></label>
    <div class="row-btns"><button class="btn white" id="epSave">Save</button></div>`,{onMount(el,close){
      el.querySelector('#epPhoto').onclick=()=>{ close(); $('#filePhoto').click(); };
      const rm=el.querySelector('#epRm'); if(rm) rm.onclick=()=>{ p.photo=null; SAVE.profile(); close(); refresh(); };
      el.querySelector('#epSw').onclick=e=>{ const b=e.target.closest('.sw'); if(!b) return; p.pal=+b.dataset.i; $$('#epSw .sw',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b))); if(!p.photo) el.querySelector('#epAv').style.backgroundImage=`url('${avatarURL()}')`; };
      el.querySelector('#epSave').onclick=()=>{ p.name=el.querySelector('#epName').value.trim()||p.name; let h=el.querySelector('#epHandle').value.trim().replace(/\s+/g,''); if(h&&h[0]!=='@') h='@'+h; p.handle=h||p.handle; p.bio=el.querySelector('#epBio').value.trim(); SAVE.profile(); close(); refresh(); toast('Profile updated'); };
    }});
}
function openSettings(){ push('settings',el=>{
  const st=S.settings;
  const tog=(id,on,label,sub)=>`<div class="setrow"><div class="lbl">${label}${sub?`<small>${sub}</small>`:''}</div><button class="toggle" role="switch" data-act="set-toggle" data-k="${id}" aria-checked="${!!on}" aria-label="${label}"></button></div>`;
  el.innerHTML=pbar('Settings')+`
    <div class="h3 pad" style="margin-top:6px">Performing</div>
    <div class="card" style="margin:0 20px">
      ${tog('guide',st.guide,'Guide vocal on karaoke','Plays the melody under your voice')}
      ${tog('mirrorCam',st.mirrorCam,'Mirror front camera preview','Recordings are never mirrored')}
      ${tog('backdrop',st.backdrop,'Dim the camera behind text')}
      <div class="setrow"><div class="lbl">Countdown</div><div class="chips">${[0,3,5].map(v=>`<button class="chip" data-act="set-cd" data-v="${v}" aria-pressed="${st.countdown===v}">${v?v+'s':'Off'}</button>`).join('')}</div></div>
    </div>
    <div class="h3 pad">Sync engine</div>
    <div class="card" style="margin:0 20px">
      <button class="setrow" data-act="calibrate"><div class="lbl">Calibrate tap timing<small>Measured: ${Math.round((st.tapLat??0.08)*1000)} ms · compensates for your reaction and device</small></div>${ic('timer','sm')}</button>
      ${tog('snap',st.snap!==false,'Snap taps to vocal onsets','Pulls each tap to the nearest detected note start')}
      <div class="setrow"><div class="lbl">Audio output delay<small>${AC?Math.round(outLat()*1000)+' ms detected and compensated':'Measured when music first plays'}</small></div></div>
      <button class="setrow" data-act="tts-voice"><div class="lbl">Narrator voice<small>${esc((pickVoice()||{}).name||'System default')}</small></div>${ic('chevron-right','sm')}</button>
    </div>
    <div class="h3 pad">Storage</div>
    <div class="card" style="margin:0 20px">
      <button class="setrow" data-act="downloads"><div class="lbl">Downloads</div>${ic('chevron-right','sm')}</button>
      <button class="setrow" data-act="clear-cache"><div class="lbl">Clear generated arrangements<small>They're rebuilt the next time you sing</small></div>${ic('refresh-cw','sm')}</button>
    </div>
    <div class="h3 pad">About</div>
    <div class="card" style="margin:0 20px">
      <button class="setrow" data-act="replay-onb"><div class="lbl">Replay the welcome tour</div>${ic('sparkles','sm')}</button>
      <button class="setrow" data-act="credits"><div class="lbl">Credits &amp; licences</div>${ic('chevron-right','sm')}</button>
      <button class="setrow" data-act="reset-all" style="color:var(--hot)"><div class="lbl">Erase everything on this device</div>${ic('trash','sm')}</button>
    </div>`;
}); }
function openCredits(){ push('credits',el=>{ el.innerHTML=pbar('Credits & licences')+`<div class="pad" style="color:var(--ink-2);line-height:1.6">
  <div class="card" style="padding:18px;margin-top:6px"><b>Instrumentals</b><p class="mute" style="margin:6px 0 0">Music by Tanner Helland — “Remember”, “Home”, “Leaving Millie”, “Hidden Tears”, “Daybreak”, “Lost Islands”, “The Forest Awakes”, “A Memory Away”, “Wild Waters”, “Now or Never”. Licensed under Creative Commons Attribution 4.0. github.com/tannerhelland/free-music</p></div>
  <div class="card" style="padding:18px;margin-top:12px"><b>Karaoke songs</b><p class="mute" style="margin:6px 0 0">Traditional and 19th-century songs in the public domain. Arrangements and guide melodies are generated in your browser by Lectern. “Lights Up” is an original Lectern song.</p></div>
  <div class="card" style="padding:18px;margin-top:12px"><b>Classic poems</b><p class="mute" style="margin:6px 0 0">Public-domain texts served by PoetryDB (poetrydb.org). The PoetryDB edition is licensed CC BY 4.0.</p></div>
  <div class="card" style="padding:18px;margin-top:12px"><b>Original poems and movie lines</b><p class="mute" style="margin:6px 0 0">Written for Lectern. Free to perform, record and share.</p></div>
  <div class="card" style="padding:18px;margin-top:12px"><b>Icons</b><p class="mute" style="margin:6px 0 0">Lucide icons, ISC License.</p></div></div>`; }); }

/* ================= Onboarding ================= */
const OB={i:0,ints:new Set(),name:'',pal:4,photo:null,timer:0,slide:0};
function startOnboarding(){
  const o=$('#onb'); o.hidden=false; OB.i=0; OB.slide=0;
  if(S.profile){ OB.name=S.profile.name&&S.profile.name!=='Performer'?S.profile.name:''; OB.email=(S.auth&&S.auth.email)||''; OB.pal=S.profile.pal??4; (S.profile.interests||[]).forEach(x=>OB.ints.add(x)); }
  const sc=k=>catList(k);
  const coll=[[sc('song')[0],'left:6%;top:4%;width:44%;height:40%;--r:-6deg'],[sc('poem')[3],'right:5%;top:0%;width:38%;height:30%;--r:5deg;animation-delay:-2s'],[sc('line')[0],'right:8%;top:34%;width:40%;height:38%;--r:-3deg;animation-delay:-4s'],[sc('song')[2],'left:12%;top:48%;width:32%;height:30%;--r:4deg;animation-delay:-1s'],[sc('inst')[0],'left:42%;top:72%;width:24%;height:22%;--r:-8deg;animation-delay:-3s']];
  o.innerHTML=`<div class="wrap">
    <div class="ob-top" id="obTop"><button class="circ ghost" id="obBack" aria-label="Back">${ic('chevron-left')}</button><div class="ob-prog">${[1,2,3,4].map(()=>'<i></i>').join('')}</div><button class="ob-skip" id="obSkip">Skip</button></div>
    <div class="ob-stage">
      <div class="ob-step ob-welcome" data-s="0">
        <div class="collage">${coll.map(([it,st],j)=>`<span class="c ${j===3?'round':''}" style="${st};${coverCss(it,400)}"></span>`).join('')}</div>
        <div class="brandmark"><i>${ic('mic-vocal','sm')}</i>Lectern</div>
        <h1>Your stage,<br><span class="grad-text">in your pocket.</span></h1>
        <p class="lead">Sing karaoke, read poetry and run movie lines with a prompter that follows you. Then polish your take in the studio.</p>
        <div class="ob-foot"><button class="btn white block" data-ob="next">Get started</button><button class="link" data-ob="quick">I’ll look around first</button></div>
      </div>
      <div class="ob-step right" data-s="1">
        <div class="carousel" id="obCar"><div class="ctrack" id="obTrack">
          <div class="cslide"><div class="demo kdemo"><span class="bgart" style="${coverCss(sc('song')[1],400)}"></span><div class="l">Twinkle, twinkle, little star,</div><div class="l now"><span id="kdl">How I wonder what you are!</span></div><div class="l">Up above the world so high,</div></div><h2>Karaoke that keeps time</h2><p>Lyrics light up word by word with the music. Turn the guide vocal on while you learn, then off when you’re ready.</p></div>
          <div class="cslide"><div class="demo pdemo"><span class="bgart" style="${coverCss(sc('poem')[0],400)}"></span><div class="scroll">The room is hushed, the lens a patient eye,<br>my pages squared and waiting on the stand.<br>I count my breath the way the old clocks sigh,<br>and feel the opening line beneath my hand.</div></div><h2>A prompter for every word</h2><p>Poems, scripts and movie lines scroll at your pace, with directions like [pause] in amber. Add a music bed underneath.</p></div>
          <div class="cslide"><div class="demo sdemo"><span class="ph" id="sdph" style="${coverCss(sc('line')[4],400)}"></span><div class="chips"><span class="chip" aria-pressed="true" id="sdchip">Noir</span><span class="chip">Deep voice</span><span class="chip">Captions</span></div></div><h2>Make it yours in the studio</h2><p>Change your voice, add a film look and burn in lyrics. Save it, share it, keep it on your device.</p></div>
        </div></div>
        <div class="cdots" id="obDots"><i class="on"></i><i></i><i></i></div>
        <div class="ob-foot"><button class="btn white block" data-ob="slide">Next</button></div>
      </div>
      <div class="ob-step right" data-s="2">
        <h1>What will you perform?</h1><p class="lead">Pick as many as you like. We’ll shape Explore around them.</p>
        <div class="itiles" id="obInts">${[['song','Karaoke','Sing with synced lyrics',sc('song')[4]],['poem','Poetry','Read classics and originals',sc('poem')[1]],['line','Movie lines','Practise scenes',sc('line')[1]],['script','Scripts & talks','Rehearse presentations',{id:'ob-script',kind:'script',title:'Script'}]].map(([k,l,s,it])=>`<button class="itile" data-k="${k}" aria-pressed="${OB.ints.has(k)}" style="${coverCss(it,300)}"><span class="ck">${ic('check','sm')}</span><b>${l}</b><span>${s}</span></button>`).join('')}</div>
        <div class="ob-foot"><button class="btn white block" data-ob="next" id="obIntNext" ${OB.ints.size?'':'disabled'}>Continue</button></div>
      </div>
      <div class="ob-step right" data-s="3">
        <h1>Create your account</h1><p class="lead">Your name is how you’ll appear on your profile. Your email lets you sign back in.</p>
        <div class="namefield"><button class="pav" id="obAv" aria-label="Add a photo"></button><input id="obName" maxlength="40" placeholder="Your name" autocomplete="name" value="${esc(OB.name)}"></div>
        <div class="handle-prev" id="obHandle"></div>
        <label class="obmail">${ic('mail','sm')}<input id="obEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="Email address" value="${esc(OB.email||'')}"></label>
        <p class="auth-err" id="obErr" role="alert"></p>
        <div style="margin-top:24px"><div class="mute" style="font-size:.88rem;margin-bottom:10px">Pick a colour</div><div class="swatches" id="obSw">${PALETTES.slice(0,8).map((_,i)=>`<button class="sw" data-i="${i}" aria-pressed="${OB.pal===i}" aria-label="Colour ${i+1}"></button>`).join('')}</div></div>
        <div class="ob-foot"><button class="btn white block" data-ob="next" id="obNameNext">Continue</button></div>
      </div>
      <div class="ob-step right" data-s="4">
        <h1>Ready when you are</h1><p class="lead">To record, Lectern needs your camera and microphone. Here’s the deal:</p>
        <div class="permart"><span class="bub">${ic('camera')}</span><span class="bub">${ic('mic')}</span></div>
        <div class="perm">
          <div><span class="oi">${ic('shield-check')}</span><div><b>Stays on your device</b><span>Takes are saved on this device. Nothing is uploaded.</span></div></div>
          <div><span class="oi">${ic('video')}</span><div><b>Only when you press record</b><span>The preview is just for you until you start a take.</span></div></div>
          <div><span class="oi">${ic('settings')}</span><div><b>Change it any time</b><span>You can turn access off in your settings whenever you like.</span></div></div>
        </div>
        <div class="ob-foot"><button class="btn white block" data-ob="perm">${ic('camera','sm')}Allow camera &amp; mic</button><button class="link" data-ob="next">Not now</button></div>
      </div>
      <div class="ob-step right" data-s="5">
        <canvas class="confetti" id="obConf"></canvas>
        <h1 id="obDoneH"></h1><p class="lead">Here are three to start with. Your picks are on Explore too.</p>
        <div class="list" style="padding:0;margin-top:24px" id="obPicks"></div>
        <div class="ob-foot"><button class="btn white block" data-ob="finish">Start exploring</button></div>
      </div>
    </div></div>`;
  bindOnb(); obGo(0,true);
}
function obAvatar(){ return OB.photo || cover({id:'av:'+OB.pal+':'+(OB.name||''),kind:'av',pal:OB.pal},240); }
function obHandle(){ const base=(OB.name||'performer').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'')||'performer'; return '@'+base+((hash(base)%9000)+1000); }
function bindOnb(){
  const o=$('#onb');
  o.addEventListener('click',e=>{
    const b=e.target.closest('[data-ob]'); if(!b) return;
    const a=b.dataset.ob;
    if(a==='next'){ if(OB.i===3&&!obAccountOk()) return; obGo(OB.i+1); }
    else if(a==='quick'){ OB.ints=new Set(['song','poem','line']); OB.guest=true; finishOnb(true); }
    else if(a==='slide'){ if(OB.slide<2) obSlide(OB.slide+1); else obGo(2); }
    else if(a==='perm'){ askPerms().then(()=>obGo(5)); }
    else if(a==='finish') finishOnb();
  });
  $('#obBack').onclick=()=>{ if(OB.i===1 && OB.slide>0) obSlide(OB.slide-1); else obGo(Math.max(0,OB.i-1)); };
  $('#obSkip').onclick=()=>{ if(OB.i===1) obGo(2); else if(OB.i===2){ if(!OB.ints.size) ['song','poem','line'].forEach(k=>OB.ints.add(k)); obGo(3); } else if(OB.i===4) obGo(5); else obGo(OB.i+1); };
  $('#obInts').addEventListener('click',e=>{ const t=e.target.closest('.itile'); if(!t) return; const k=t.dataset.k; if(OB.ints.has(k)) OB.ints.delete(k); else OB.ints.add(k); t.setAttribute('aria-pressed',String(OB.ints.has(k))); $('#obIntNext').disabled=!OB.ints.size; if(navigator.vibrate) try{navigator.vibrate(8);}catch(_){} });
  const nm=$('#obName'); const upd=()=>{ OB.name=nm.value.trim(); $('#obHandle').textContent=OB.name?obHandle()+' · you can change this later':'Your handle will be created from your name'; $('#obAv').style.backgroundImage=`url('${obAvatar()}')`; $$('#obSw .sw').forEach(s=>s.style.backgroundImage=`url('${cover({id:'av:'+s.dataset.i+':'+(OB.name||''),kind:'av',pal:+s.dataset.i},96)}')`); };
  nm.addEventListener('input',()=>{ upd(); $('#obErr').textContent=''; }); nm.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#obEmail').focus(); } }); upd();
  const em=$('#obEmail'); em.addEventListener('input',()=>{ OB.email=em.value.trim(); $('#obErr').textContent=''; }); em.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); if(obAccountOk()) obGo(4); } });
  $('#obSw').onclick=e=>{ const s=e.target.closest('.sw'); if(!s) return; OB.pal=+s.dataset.i; $$('#obSw .sw').forEach(x=>x.setAttribute('aria-pressed',String(x===s))); upd(); };
  $('#obAv').onclick=()=>{ PHOTO_TARGET='onb'; $('#filePhoto').click(); };
  // carousel swipe
  const car=$('#obCar'); let sx=null;
  car.addEventListener('pointerdown',e=>{ sx=e.clientX; });
  car.addEventListener('pointerup',e=>{ if(sx==null) return; const dx=e.clientX-sx; sx=null; if(Math.abs(dx)>40) obSlide(Math.max(0,Math.min(2,OB.slide+(dx<0?1:-1)))); });
  o.addEventListener('keydown',e=>{ if(e.key==='Escape') finishOnb(true); });
}
function obAccountOk(){
  OB.name=$('#obName').value.trim(); OB.email=$('#obEmail').value.trim().toLowerCase();
  const err=$('#obErr');
  if(!OB.name){ err.textContent='Add your name to continue.'; $('#obName').focus(); return false; }
  if(!validEmail(OB.email)){ err.textContent='Enter a valid email address.'; $('#obEmail').focus(); return false; }
  err.textContent=''; return true;
}
function obSlide(n){ OB.slide=n; $('#obTrack').style.transform=`translateX(${-n*100}%)`; $$('#obDots i').forEach((d,i)=>d.classList.toggle('on',i===n)); }
function obGo(n,instant){
  if(n===3) setTimeout(()=>$('#obName').focus(),450);
  if(n===4 && !OB.name){ OB.name=''; }
  if(n===5){ $('#obDoneH').textContent=`You’re all set${OB.name?', '+OB.name.split(' ')[0]:''}.`; const ints=[...OB.ints]; const picks=[]; ints.forEach(k=>{ const l=k==='script'?[]:catList(k); if(l.length) picks.push(l[Math.floor(Math.random()*l.length)]); }); while(picks.length<3){ const l=catList(['song','line','poem'][picks.length%3]); const x=l[Math.floor(Math.random()*l.length)]; if(!picks.includes(x)) picks.push(x); }
    $('#obPicks').innerHTML=picks.slice(0,3).map(x=>`<div class="row"><button class="rowmain" data-ob="finish" data-open="${x.id}"><span class="th" style="${coverCss(x,160)}"><span class="dur">${fmt(durOf(x))}</span></span><span class="tx"><b>${esc(x.title)}<span class="tag">${KIND[x.kind].tag}</span></b><span>${esc(x.sub)}</span></span></button></div>`).join('');
    $$('#obPicks [data-open]').forEach(b=>b.addEventListener('click',()=>{ OB.open=b.dataset.open; },true));
    setTimeout(confetti,250); }
  $$('#onb .ob-step').forEach(s=>{ const i=+s.dataset.s; s.classList.toggle('left',i<n); s.classList.toggle('right',i>n); s.setAttribute('aria-hidden',String(i!==n)); if('inert' in s) s.inert=i!==n; });
  OB.i=n;
  const top=$('#obTop'); top.style.opacity=n===0||n===5?'0':'1'; top.style.pointerEvents=n===0||n===5?'none':'auto';
  $$('#onb .ob-prog i').forEach((p,i)=>p.classList.toggle('on',i<n));
  $('#obSkip').style.visibility=(n===1||n===4)?'visible':'hidden';
  clearInterval(OB.timer);
  if(n===1){ let p=0; const ks=$('#kdl'); const fl=['Noir','Mono','Vivid','Dreamy']; const css=['grayscale(1) contrast(1.5)','grayscale(1)','saturate(1.8)','saturate(1.3) brightness(1.1) blur(1px)']; let fi=0;
    OB.timer=setInterval(()=>{ p=(p+2)%120; if(ks) ks.style.setProperty('--p',Math.min(100,p)+'%'); if(p%30===0){ fi=(fi+1)%4; const ph=$('#sdph'); if(ph) ph.style.filter=css[fi]; const c=$('#sdchip'); if(c) c.textContent=fl[fi]; } },50); }
}
async function askPerms(){
  try{ const s=await navigator.mediaDevices.getUserMedia({video:true,audio:true}); s.getTracks().forEach(t=>t.stop()); toast('Camera and mic are ready'); }
  catch(e){ toast('No problem. You can allow access when you first record.'); }
}
function confetti(){
  const c=$('#obConf'); if(!c||matchMedia('(prefers-reduced-motion: reduce)').matches) return; const W=c.width=c.offsetWidth*devicePixelRatio, H=c.height=c.offsetHeight*devicePixelRatio, g=c.getContext('2d');
  const cols=['#A78BFA','#F472B6','#FB923C','#FDE68A','#5EEAD4','#fff']; const P=Array.from({length:90},()=>({x:W/2,y:H*.35,vx:(Math.random()-.5)*14*devicePixelRatio,vy:(-Math.random()*12-4)*devicePixelRatio,s:(4+Math.random()*6)*devicePixelRatio,c:cols[Math.random()*cols.length|0],r:Math.random()*6,vr:(Math.random()-.5)*.3}));
  let f=0; (function step(){ g.clearRect(0,0,W,H); P.forEach(p=>{ p.vy+=.35*devicePixelRatio; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr; g.save(); g.translate(p.x,p.y); g.rotate(p.r); g.fillStyle=p.c; g.fillRect(-p.s/2,-p.s/4,p.s,p.s/2); g.restore(); }); if(++f<140) requestAnimationFrame(step); else g.clearRect(0,0,W,H); })();
}
function finishOnb(quick){
  clearInterval(OB.timer);
  const name=OB.name||(S.profile&&S.profile.name)||'Performer';
  const prev=S.profile||{};
  S.profile={...prev,name,handle:prev.handle&&prev.name===name?prev.handle:(OB.name?obHandle():'@performer'+(hash(String(Date.now()))%9000+1000)),pal:OB.pal,photo:OB.photo||prev.photo||null,bio:prev.bio||'',interests:[...OB.ints].length?[...OB.ints]:['song','poem','line'],created:prev.created||Date.now()};
  SAVE.profile(); store.set('lectern.onboarded2',true);
  if(OB.guest){ OB.guest=false; if(!(S.auth&&S.auth.signedIn)){ S.auth={...(S.auth||{}),signedIn:false}; SAVE.auth(); } }
  else if(OB.email){ S.auth={signedIn:true,name,email:OB.email,provider:'device',since:(S.auth&&S.auth.email===OB.email&&S.auth.since)||Date.now()}; SAVE.auth(); }
  const o=$('#onb'); o.style.transition='opacity .35s'; o.style.opacity='0';
  setTimeout(()=>{ o.hidden=true; o.style.opacity=''; o.innerHTML=''; },360);
  updateTabAvatar(); switchTab('explore');
  if(OB.open){ const id=OB.open; OB.open=null; setTimeout(()=>openDetail(id),200); }
  else if(!quick) setTimeout(()=>toast('Welcome to Lectern'),400);
  else setTimeout(()=>toast('Look around. Sign in when you’re ready to perform.'),500);
}

/* ================= Preview player (instrumentals) ================= */
const PREV={audio:new Audio(),id:null,url:''};
PREV.audio.preload='auto';
async function togglePreview(it){
  if(PREV.id===it.id){ if(PREV.audio.paused) PREV.audio.play().catch(()=>{}); else PREV.audio.pause(); return; }
  stopPreview(); PREV.id=it.id; showMini(it);
  let src=it.url;
  try{ const b=await instBlob(it,{download:false}); if(b){ PREV.url=URL.createObjectURL(b); src=PREV.url; } }catch(e){}
  if(PREV.id!==it.id) return;
  PREV.audio.src=src;
  try{ await PREV.audio.play(); bump(it.id); }catch(e){ toast('Couldn’t play this track. Are you online?'); stopPreview(); }
}
function stopPreview(){ PREV.audio.pause(); if(PREV.url){ URL.revokeObjectURL(PREV.url); PREV.url=''; } PREV.id=null; $('#mini').hidden=true; syncPreviewUI(); }
function showMini(it){ $('#miniTh').style.backgroundImage=`url('${cover(it,120)}')`; $('#miniT').textContent=it.title; $('#miniS').textContent=it.mood+' · '+it.sub; $('#mini').hidden=false; }
function syncPreviewUI(){
  const on=PREV.id && !PREV.audio.paused;
  $('#miniPlay').innerHTML=ic(on?'pause':'play','fill sm');
  $$('.row .rowmain[data-id] .th').forEach(t=>{ const id=t.closest('.rowmain').dataset.id; t.classList.toggle('playing',on && id===PREV.id); });
  const top=STACK[STACK.length-1]; if(top&&top.name==='detail'){ const b=top.el.querySelector('.dacts .btn.white'); const it=find(PREV.id); if(b && it && b.dataset.id===it.id) b.innerHTML=ic(on?'pause':'play','fill')+(on?'Pause':'Play'); }
}
['play','pause','ended'].forEach(ev=>PREV.audio.addEventListener(ev,syncPreviewUI));
PREV.audio.addEventListener('play',()=>AUDIO.claim('preview'));
AUDIO.register('preview',{label:()=>{ const it=find(PREV.id); return it?it.title:'Preview'; },sub:'Instrumental preview',icon:'audio-waveform',
  playing:()=>!!PREV.id&&!PREV.audio.paused, stop:()=>stopPreview(), open:()=>{ if(PREV.id) openDetail(PREV.id); }, here:()=>!$('#mini').hidden});
PREV.audio.addEventListener('timeupdate',()=>{ const d=PREV.audio.duration||1; $('#miniBar').style.width=(PREV.audio.currentTime/d*100)+'%'; const top=STACK[STACK.length-1]; if(top&&top.name==='detail'){ const s=top.el.querySelector('#dSeek'); const n=top.el.querySelector('#dNow'); const it=find(PREV.id); if(s && it && top.el.querySelector(`[data-act="play"][data-id="${it.id}"]`)){ s.value=PREV.audio.currentTime; n.textContent=fmt(PREV.audio.currentTime); } } });
$('#miniPlay').onclick=()=>{ if(PREV.audio.paused) PREV.audio.play().catch(()=>{}); else PREV.audio.pause(); };
$('#miniClose').onclick=stopPreview;
$('#mini .tx').onclick=()=>{ if(PREV.id) openDetail(PREV.id); };

/* ================= Start an item ================= */
function startItem(it){
  if(!it) return;
  if(it.kind==='inst'){ togglePreview(it); return; }
  stopPreview(); bump(it.id); openStage(it);
}

/* ================= Global actions ================= */
let PHOTO_TARGET='profile';
const ACT={
  back:()=>pop(), tab:el=>switchTab(el.dataset.tab), create:()=>openCreate(),
  open:el=>{ const it=find(el.dataset.id); if(!it) return; if(isLib(it)&&it.kind!=='inst') openDetail(it.id); else openDetail(it.id); },
  play:el=>startItem(find(el.dataset.id)), menu:el=>itemMenu(el.dataset.id),
  like:el=>{ const v=toggleLike(el.dataset.id); toast(v?'Added to Liked':'Removed from Liked'); refresh(); },
  addto:el=>addToCollection(el.dataset.id), edit:el=>openEditor(el.dataset.id), share:el=>shareItem(find(el.dataset.id)),
  more:el=>{ const k=el.dataset.kind; if(k) openList(k); },
  jump:el=>{ const s=document.getElementById(el.dataset.sec); if(s) window.scrollTo({top:s.getBoundingClientRect().top+window.scrollY-10,behavior:'smooth'}); },
  news:()=>openNews(), 'classics-more':()=>openClassics(), 'classics-retry':()=>{ CLASSICS_ERR=false; const c=$('#classics'); if(c) c.innerHTML=classicsHTML(); loadClassics(); },
  poet:el=>openClassics(el.dataset.name), 'pdb-open':el=>openPdb(el.dataset.a,el.dataset.t),
  'search-for':el=>{ SQ=el.dataset.q; RENDER.search(); }, 'forget-search':el=>{ S.recents.searches=S.recents.searches.filter(x=>x!==el.dataset.q); SAVE.recents(); renderSearchBody(); },
  'clear-searches':()=>{ S.recents.searches=[]; SAVE.recents(); renderSearchBody(); },
  liked:()=>openLiked(), colls:()=>openColls(), coll:el=>openColl(el.dataset.id), 'coll-menu':el=>collMenu(el.dataset.id), 'new-coll':()=>newCollection(),
  'coll-play':el=>{ const c=S.colls.find(x=>x.id===el.dataset.id); const f=c&&c.ids.map(find).filter(Boolean)[0]; if(f) startItem(f); },
  recs:()=>openRecs(), downloads:()=>openDownloads(), dl:el=>downloadInst(find(el.dataset.id)),
  libfilter:()=>actionSheet('Show',[['all','All','library'],['song','Karaoke','mic-vocal'],['poem','Poems','feather'],['line','Movie lines','clapperboard'],['script','Scripts','scroll-text']].map(([k,l,i])=>({icon:i,label:l+(LIBF.kind===k?' ✓':''),run:()=>{ LIBF.kind=k; RENDER.library(); }})).concat([{icon:'list',label:LIBF.sort==='az'?'Sort by recent':'Sort A–Z',run:()=>{ LIBF.sort=LIBF.sort==='az'?'recent':'az'; RENDER.library(); }}])),
  photo:()=>{ PHOTO_TARGET='profile'; $('#filePhoto').click(); }, 'edit-profile':()=>editProfile(), settings:()=>openSettings(), credits:()=>openCredits(),
  'share-profile':async()=>{ const p=S.profile; const t=`${p.name} (${p.handle}) performs on Lectern — ${S.recs.length} takes and counting.`; try{ if(navigator.share){ await navigator.share({title:p.name,text:t}); return; } await navigator.clipboard.writeText(t); toast('Copied to clipboard'); }catch(e){} },
  'first-rec':()=>{ const it=CAT.get('k-twinkle'); openDetail(it.id); },
  'draft-open':el=>openDraft(el.dataset.id),
  'draft-menu':el=>{ const d=draftById(el.dataset.id); if(!d) return; actionSheet(d.title,[{icon:'pencil',label:'Keep editing',run:()=>openDraft(d.id)},{icon:'trash',label:'Delete draft',danger:true,run:()=>confirmSheet('Delete this draft?','The take and your edits will be removed.','Delete',async()=>{ await deleteDraft(d.id); refresh(); toast('Draft deleted'); })}]); },
  'rec-open':el=>openRec(el.dataset.id), 'rec-share':el=>shareRec(S.recs.find(r=>r.id===el.dataset.id)),
  'rec-dl':async el=>{ const f=await recFile(S.recs.find(r=>r.id===el.dataset.id)); if(f){ downloadFile(f); toast('Downloading…'); } },
  'rec-remix':async el=>{ const r=S.recs.find(x=>x.id===el.dataset.id); const b=await idb.get(r.id,'rec'); if(b) openStudio(b,{title:r.title,itemId:r.itemId,kind:r.kind,dur:r.dur,captions:[],music:null,remix:true}); },
  'rec-menu':el=>{ const r=S.recs.find(x=>x.id===el.dataset.id); actionSheet(r.title,[{icon:'pencil',label:'Rename',run:()=>sheet(`<h3>Rename take</h3><label class="field"><input id="rrn" value="${esc(r.title)}" maxlength="60"></label><div class="row-btns"><button class="btn white" id="rrOk">Save</button></div>`,{onMount(s,close){ s.querySelector('#rrOk').onclick=()=>{ r.title=s.querySelector('#rrn').value.trim()||r.title; SAVE.recs(); close(); refresh(); }; }})},{icon:'trash',label:'Delete recording',danger:true,run:()=>confirmSheet('Delete this take?','It will be removed from this device.','Delete',async()=>{ await idb.del(r.id,'rec'); S.recs=S.recs.filter(x=>x!==r); SAVE.recs(); pop(); toast('Deleted'); })}]); },
  'music-pick':el=>pickMusic(find(el.dataset.id)),
  'music-remove':async el=>{ const s=find(el.dataset.id); if(s.music&&s.music.type==='file') await idb.del(s.id); s.music=null; SAVE.items(); player.unload(); lineEditorRefresh(); toast('Music removed'); },
  sync:el=>{ clearTimeout(edSaveT); SAVE.items(); openSync(find(el.dataset.id)); },
  'lrc-import':()=>$('#fileLrc').click(),
  'lrc-export':el=>{ const s=find(el.dataset.id); downloadFile(new File([exportLrcPro(s.title,lyricLines(s.body),s.times||[],s.wt)],(s.title||'lyrics').replace(/[^\w\- ]+/g,'').trim().replace(/\s+/g,'-').toLowerCase()+'.lrc',{type:'text/plain'})); },
  'sync-clear':el=>{ const s=find(el.dataset.id); s.times=[]; s.ends=[]; s.wt=[]; SAVE.items(); lineEditorRefresh(); toast('Timing cleared'); },
  'auto-quick':el=>autoSync(find(el.dataset.id),'quick'), 'auto-ai':el=>autoSync(find(el.dataset.id),'ai'), 'auto-gen':el=>{ const s=find(el.dataset.id); if(lyricLines(s.body).length) confirmSheet('Replace your '+(s.kind==='line'?'lines':'lyrics')+'?','Generating writes new text from the audio.','Replace and generate',()=>autoSync(s,'generate')); else autoSync(s,'generate'); },
  timeline:el=>openTimeline(find(el.dataset.id)),
  'clip-import':el=>{ PENDING_CLIP=el.dataset.id; $('#fileClip').click(); },
  'clip-remove':async el=>{ const s=find(el.dataset.id); await idb.del('clip:'+s.id); s.clip=null; if(['original','dub'].includes(s.voice)) s.voice='me'; SAVE.items(); player.unload(); lineEditorRefresh(); toast('Clip removed'); },
  'set-voice':el=>{ const it=find(el.dataset.id); if(!it||el.disabled) return; setVoice(it,el.dataset.v); refresh(); },
  calibrate:()=>openCalibration(),
  'set-toggle':el=>{ const k=el.dataset.k; S.settings[k]=!S.settings[k]; SAVE.settings(); el.setAttribute('aria-checked',String(S.settings[k])); },
  'set-cd':el=>{ S.settings.countdown=+el.dataset.v; SAVE.settings(); refresh(); },
  'clear-cache':async()=>{ for(const s of catList('song')){ await idb.del('cat:'+s.id); await idb.del('cat:'+s.id+':g'); } player.unload(); BUFS.clear(); toast('Cleared. Arrangements rebuild next time.'); },
  'replay-onb':()=>{ closeAllPages(); startOnboarding(); },
  'reset-all':()=>confirmSheet('Erase everything?','Removes your account, library, recordings, likes, profile and downloads from this device.','Erase everything',async()=>{ try{ localStorage.clear(); indexedDB.deleteDatabase('lectern'); }catch(e){} location.reload(); })
};
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]'); if(!el || el.closest('#onb')) return;
  const f=ACT[el.dataset.act]; if(!f) return; e.preventDefault();
  if(gate(el.dataset.act,el)) return;
  f(el,e);
});
$$('#tabbar [data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape') return;
  if(!$('#stage').hidden||!$('#sync').hidden||!$('#studio').hidden||!$('#onb').hidden) return;
  const s=$$('#sheets .sheet'); if(s.length){ s[s.length-1]._close(); return; }
  if(STACK.length) pop();
});
$('#fileAudio').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f||!PENDING_UPLOAD) return;
  const s=find(PENDING_UPLOAD); PENDING_UPLOAD=null; if(!s) return;
  const ok=await idb.put(s.id,f); s.music={type:'file',name:f.name,dur:await probeDuration(f)}; s.updated=Date.now(); SAVE.items(); player.unload(); lineEditorRefresh();
  toast(ok?'Music added':'Music added for this session only. Your browser blocked storage.');
});
$('#fileLrc').addEventListener('change',async e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return; const top=STACK[STACK.length-1]; const id=top&&top.el.querySelector('[data-act="sync"]')&&top.el.querySelector('[data-act="sync"]').dataset.id; const s=find(id); if(s) importLrc(s,await f.text()); });
$('#filePhoto').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
  const img=new Image(); const u=URL.createObjectURL(f);
  img.onload=()=>{ const c=document.createElement('canvas'); const sz=320; c.width=c.height=sz; const g=c.getContext('2d'); const m=Math.min(img.width,img.height); g.drawImage(img,(img.width-m)/2,(img.height-m)/2,m,m,0,0,sz,sz); const d=c.toDataURL('image/jpeg',.85); URL.revokeObjectURL(u);
    if(PHOTO_TARGET==='onb'){ OB.photo=d; const a=$('#obAv'); if(a) a.style.backgroundImage=`url('${d}')`; } else { S.profile.photo=d; SAVE.profile(); refresh(); toast('Profile picture updated'); } };
  img.onerror=()=>toast('That image couldn’t be opened'); img.src=u;
});

/* ================= Clips, calibration, narrator voice ================= */
ACT['clip-for']=el=>{ const it=find(el.dataset.id); const c=saveCopy(it,false); PENDING_CLIP=c.id; PENDING_CLIP_OPEN=true; $('#fileClip').click(); };
ACT['tts-voice']=()=>{ const vs=ttsVoices(); if(!vs.length){ toast('No voices available yet. Try again in a moment.'); return; }
  const sorted=vs.slice().sort((a,b)=>(/^en/i.test(b.lang)-/^en/i.test(a.lang))||a.name.localeCompare(b.name)).slice(0,40);
  actionSheet('Narrator voice',sorted.map(v=>({icon:'audio-lines',label:v.name+(S.settings.ttsVoice===v.name?' ✓':''),sub:v.lang+(v.localService?' · on device':' · online'),run:()=>{ S.settings.ttsVoice=v.name; SAVE.settings(); try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance('This is how I will read your lines.'); u.voice=v; speechSynthesis.speak(u); }catch(e){} refresh(); }}))); };
let PENDING_CLIP_OPEN=false;
$('#fileClip').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
  let s=PENDING_CLIP?find(PENDING_CLIP):null; PENDING_CLIP=null;
  if(!s){ s={id:uid(),kind:'line',title:f.name.replace(/\.[^.]+$/,'').slice(0,60),body:'',updated:Date.now()}; S.items.push(s); PENDING_CLIP_OPEN=true; }
  toast('Importing clip…');
  const ok=await idb.put('clip:'+s.id,f);
  const type=/^video\//.test(f.type)||/\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)?'video':'audio';
  s.clip={name:f.name,type,dur:await probeDuration(f)}; if(!s.voice||s.voice==='me') s.voice='original';
  s.updated=Date.now(); SAVE.items(); player.unload();
  if(!ok) toast('Clip kept for this session only. Your browser blocked storage.');
  const after=()=>actionSheet('Clip imported',[
    {icon:'wand-sparkles',label:'Generate the lines from this clip',sub:'Transcribes speech with Whisper, with timings',run:()=>autoSync(s,'generate')},
    lyricLines(s.body).length&&{icon:'sparkles',label:'Sync my lines to the clip',sub:'AI aligns your text word by word',run:()=>autoSync(s,'ai')},
    {icon:'hand',label:'I’ll sync it myself',sub:'Tap along to the clip',run:()=>{ if(lyricLines(s.body).length) openSync(s); else toast('Write the lines, then tap Tap sync'); }},
    {icon:'x',label:'Later',run(){}}
  ],'“'+f.name+'” · '+fmt(s.clip.dur));
  if(PENDING_CLIP_OPEN){ PENDING_CLIP_OPEN=false; openEditor(s.id); setTimeout(after,450); } else { lineEditorRefresh(); after(); }
});
$('#fileSong').addEventListener('change',async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f) return;
  const s={id:uid(),kind:'song',title:f.name.replace(/\.[^.]+$/,'').slice(0,60),body:'',times:[],offset:0,updated:Date.now()};
  S.items.push(s); await idb.put(s.id,f); s.music={type:'file',name:f.name,dur:await probeDuration(f)}; SAVE.items();
  openEditor(s.id); setTimeout(()=>actionSheet('Song imported',[
    {icon:'wand-sparkles',label:'Generate lyrics from the song',sub:'Whisper transcribes and times every word',run:()=>autoSync(s,'generate')},
    {icon:'square-pen',label:'I’ll paste the lyrics',sub:'Then use AI or Quick auto-sync',run:()=>{ const b=$('#edBody'); if(b) b.focus(); }}
  ],'“'+f.name+'”'),450);
});
function openCalibration(){
  let cal=null, n=0, done=false;
  sheet(`<h3>Calibrate tap timing</h3><p class="sub">Press Start, then tap the big button on every click. We measure how far your taps land from the beat and correct for it when you sync.</p>
    <button class="recbig" id="calTap" style="background:var(--s3)" aria-label="Tap"><span style="font-weight:600;font-size:1.1rem" id="calTxt">Start</span></button>
    <p class="sub" style="text-align:center" id="calRes">Current: ${Math.round((S.settings.tapLat??0.08)*1000)} ms</p>
    <div class="row-btns"><button class="btn" id="calReset">Reset to default</button><button class="btn white" id="calDone">Done</button></div>`,{onMount(el,close){
      const btn=el.querySelector('#calTap'), txt=el.querySelector('#calTxt'), res=el.querySelector('#calRes');
      btn.addEventListener('pointerdown',e=>{ e.preventDefault();
        if(!cal||done){ cal=calibrateTaps(); n=0; done=false; txt.textContent='Tap!'; res.textContent='Listen for the clicks…'; setTimeout(()=>{ done=true; const r=cal.result(); if(!r){ txt.textContent='Retry'; res.textContent='Not enough taps landed near the clicks. Try again.'; return; }
          const v=Math.max(-0.05,Math.min(0.35,r.latency)); S.settings.tapLat=+v.toFixed(3); SAVE.settings(); txt.textContent='Again'; res.innerHTML=`Your taps land <b>${Math.round(r.latency*1000)} ms</b> ${r.latency>=0?'after':'before'} the beat (±${Math.round(r.jitter*1000)} ms). Saved.`; },(cal.end-ac().currentTime+0.6)*1000); return; }
        n=cal.tap(); txt.textContent=String(n); });
      el.querySelector('#calReset').onclick=()=>{ S.settings.tapLat=0.08; SAVE.settings(); res.textContent='Reset to 80 ms'; };
      el.querySelector('#calDone').onclick=()=>{ close(); refresh(); };
    }});
}

/* ================= Inline music play/pause (editor rows) ================= */
const MUSP={id:null,raf:0,label:''};
function musBtns(id){ return $$(`[data-act="music-toggle"][data-id="${id}"]`).filter(b=>b.isConnected&&!b.closest('.page:not(.in)')); }
function musLoop(){
  cancelAnimationFrame(MUSP.raf);
  const step=()=>{
    const id=MUSP.id; if(!id) return;
    const btns=musBtns(id);
    if(!btns.length||!stage.hidden||!$('#sync').hidden){ if(!btns.length&&stage.hidden&&$('#sync').hidden) player.pause(); musReset(); return; }
    const t=player.time(), d=player.duration()||1, on=player.playing();
    btns.forEach(b=>{ b.style.setProperty('--p',(t/d*100).toFixed(1)); b.classList.add('active'); b.classList.toggle('on',on);
      const want=on?'pause':'play'; if(b.dataset.icon!==want){ b.dataset.icon=want; b.innerHTML=ic(want,'fill sm'); }
      const sm=b.closest('.grow')&&b.closest('.grow').querySelector('.lbl small'); if(sm){ if(!sm.dataset.orig) sm.dataset.orig=sm.textContent; sm.textContent=fmt(t)+' / '+fmt(d); } });
    if(!on&&t>=d-0.05){ player.seek(0); }
    MUSP.raf=requestAnimationFrame(step);
  };
  MUSP.raf=requestAnimationFrame(step);
}
function musReset(){ const id=MUSP.id; MUSP.id=null; cancelAnimationFrame(MUSP.raf);
  if(id) $$(`[data-act="music-toggle"][data-id="${id}"]`).forEach(b=>{ b.classList.remove('active','on'); b.style.removeProperty('--p'); delete b.dataset.icon; const s=find(id); b.innerHTML=ic(s&&s.kind==='line'?(s.clip&&s.clip.type==='video'?'film':'audio-lines'):'eighth-notes','sm'); const sm=b.closest('.grow')&&b.closest('.grow').querySelector('.lbl small'); if(sm&&sm.dataset.orig){ sm.textContent=sm.dataset.orig; delete sm.dataset.orig; } }); }
ACT['music-toggle']=async el=>{
  const s=find(el.dataset.id); if(!s) return;
  if(MUSP.id===s.id){ if(player.playing()) player.pause(); else { ac().resume(); player.play(); } return; }
  if(s.kind==='song'&&!s.music&&!s.cat){ pickMusic(s); return; }
  stopPreview(); musReset();
  el.innerHTML='<span class="spin"></span>';
  ac().resume();
  await loadTimedAudio(s);
  if(!player.hasAudio){ el.innerHTML=ic('eighth-notes','sm'); toast('Couldn’t play this audio'); return; }
  player.setVolume(1); player.setRate(1); player.seek(0);
  MUSP.id=s.id; playerOwner({label:titleOf(s),sub:s.kind==='line'?'Reference clip':'Song editor',icon:'eighth-notes',open:()=>openEditor(s.id),here:()=>musBtns(s.id).length>0}); player.play(); musLoop();
};
