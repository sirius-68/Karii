/* =====================================================================
   Drafts & recovery
   - While a take records, every 1-second chunk is written to IndexedDB, so a
     crash or the OS closing the app mid-take still leaves a recoverable video.
   - A finished take becomes a draft straight away (video + clean music track
     + editor settings). The take editor saves its settings as you change them.
   - On the next launch, an interrupted take or an editing session that was
     open is offered back. Drafts are listed in Library → Recordings.
   ===================================================================== */
S.drafts=store.get('lectern.drafts',[]);
SAVE.drafts=()=>store.set('lectern.drafts',S.drafts);

const LIVE={sid:null,n:0,meta:null,q:Promise.resolve()};
function liveBegin(meta){
  LIVE.sid='L'+Date.now().toString(36); LIVE.n=0; LIVE.meta=meta;
  store.set('lectern.live',{sid:LIVE.sid,...meta,started:Date.now()});
  return LIVE.sid;
}
function liveChunk(blob){
  if(!LIVE.sid||!blob||!blob.size) return;
  const k='live:'+LIVE.sid+':'+String(LIVE.n++).padStart(5,'0');
  LIVE.q=LIVE.q.then(()=>idb.putx(k,blob,'rec')).catch(()=>{});
}
async function liveEnd(){
  const sid=LIVE.sid; LIVE.sid=null; await LIVE.q;
  store.set('lectern.live',null);
  const ks=await idb.keys('live:'+sid+':','rec'); ks.forEach(k=>idb.del(k,'rec'));
}

async function createDraft(video,meta,music){
  const id='d'+uid();
  await idb.putx('draft:'+id,video,'rec');
  if(music) await idb.putx('draftm:'+id,music,'rec');
  if(meta.stem) await idb.putx('draftstem:'+id,meta.stem,'rec');
  const d={id,title:meta.title||'Take',itemId:meta.itemId||null,kind:meta.kind||'script',created:Date.now(),updated:Date.now(),dur:meta.dur||0,thumb:'',hasMusic:!!music,
    meta:{captions:meta.captions||[],musicVol:meta.musicVol??.8,musicOffset:meta.musicOffset||0,remix:!!meta.remix,loop:meta.kind!=='song',mixed:!!meta.mixed},hasStem:!!meta.stem,edit:null,open:true};
  S.drafts.unshift(d); S.drafts=S.drafts.slice(0,30); SAVE.drafts();
  return d;
}
const draftById=id=>S.drafts.find(d=>d.id===id);
let DRAFT_SAVE_T=0;
function saveDraftEdit(id,edit,extra){
  const d=draftById(id); if(!d) return;
  d.edit=edit; d.updated=Date.now(); if(extra) Object.assign(d,extra);
  clearTimeout(DRAFT_SAVE_T); DRAFT_SAVE_T=setTimeout(()=>{ SAVE.drafts(); draftSavedUI(); },350);
}
function draftSavedUI(){ const el=$('#stSaved'); if(!el) return; el.classList.add('on'); el.innerHTML=ic('check','xs')+'Draft saved'; clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'),1600); }
function markDraftOpen(id,open){ const d=draftById(id); if(!d) return; d.open=open; SAVE.drafts(); }
async function deleteDraft(id){
  S.drafts=S.drafts.filter(d=>d.id!==id); SAVE.drafts();
  await idb.del('draft:'+id,'rec'); await idb.del('draftm:'+id,'rec'); await idb.del('draftstem:'+id,'rec');
  const ks=await idb.keys('draftv:'+id,'rec'); ks.forEach(k=>idb.del(k,'rec'));
}
async function openDraft(id){
  const d=draftById(id); if(!d){ toast('That draft is gone'); return; }
  const video=await idb.get('draft:'+id,'rec'); if(!video){ toast('The video for this draft is missing'); deleteDraft(id); return; }
  const music=d.hasMusic?await idb.get('draftm:'+id,'rec'):null;
  const stem=d.hasStem?await idb.get('draftstem:'+id,'rec'):null;
  openStudio(video,{title:d.title,itemId:d.itemId,kind:d.kind,dur:d.dur,captions:d.meta.captions,music,musicVol:d.meta.musicVol,musicOffset:d.meta.musicOffset,remix:d.meta.remix,mixed:d.meta.mixed,stem},{draftId:id,edit:d.edit});
}

/* Launch-time recovery: an interrupted recording, then an editing session left open. */
async function recoverSessions(){
  const live=store.get('lectern.live',null);
  if(live&&live.sid){
    const ks=(await idb.keys('live:'+live.sid+':','rec')).sort();
    if(ks.length){
      const parts=[]; for(const k of ks){ const b=await idb.get(k,'rec'); if(b) parts.push(b); }
      const blob=new Blob(parts,{type:live.mime||parts[0]&&parts[0].type||'video/webm'});
      const d=await createDraft(blob,{title:live.title,itemId:live.itemId,kind:live.kind,dur:ks.length,captions:live.captions||[],musicVol:live.musicVol,musicOffset:live.musicOffset||0,mixed:!!live.mixed},null);
      d.open=false; d.recovered=true; SAVE.drafts();
      ks.forEach(k=>idb.del(k,'rec'));
      store.set('lectern.live',null);
      setTimeout(()=>resumeSheet(d,'We saved the take that was recording when Lectern closed.'),900);
      return;
    }
    store.set('lectern.live',null);
  }
  const open=S.drafts.find(d=>d.open);
  if(open) setTimeout(()=>resumeSheet(open,'You were editing this take when Lectern closed. Your changes were saved.'),900);
}
function resumeSheet(d,why){
  if(!$('#onb').hidden) return;
  sheet(`<div style="text-align:center;padding:4px 20px 0">
      <div class="draft-th" style="${d.thumb?`background-image:url('${d.thumb}')`:''}">${d.thumb?'':ic('video')}</div>
      <h3 style="margin:0">Pick up where you left off?</h3>
      <p class="sub" style="margin:6px 0 4px"><b>${esc(d.title)}</b>${d.dur?' · '+fmt(d.dur):''}</p>
      <p class="sub" style="margin:0 0 16px">${why}</p></div>
    <div class="row-btns"><button class="btn white" id="rsGo">${ic('pencil','sm')}Keep editing</button><button class="btn" id="rsLater">Later</button></div>`,
    {onMount(el,close){ el.querySelector('#rsGo').onclick=()=>{ close(); openDraft(d.id); };
      el.querySelector('#rsLater').onclick=()=>{ close(); markDraftOpen(d.id,false); toast('Saved in Library → Recordings → Drafts'); }; }});
}
