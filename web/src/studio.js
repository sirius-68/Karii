/* ================= Studio ================= */
const FILTERS=[
  {id:'none',name:'Original',css:'none'},
  {id:'vivid',name:'Vivid',css:'saturate(1.5) contrast(1.08)'},
  {id:'golden',name:'Golden',css:'sepia(.28) saturate(1.3) hue-rotate(-10deg) brightness(1.04)',tint:'rgba(255,170,80,.16)'},
  {id:'cool',name:'Cool',css:'saturate(1.05) hue-rotate(8deg) contrast(1.06)',tint:'rgba(70,130,255,.16)'},
  {id:'mono',name:'Mono',css:'grayscale(1) contrast(1.1)'},
  {id:'noir',name:'Noir',css:'grayscale(1) contrast(1.7) brightness(.86)',vig:true},
  {id:'vintage',name:'Vintage',css:'sepia(.55) contrast(.92) brightness(1.06) saturate(.85)',grain:true},
  {id:'dreamy',name:'Dreamy',css:'saturate(1.25) brightness(1.1) contrast(.88)',glow:true},
  {id:'faded',name:'Faded',css:'contrast(.8) brightness(1.12) saturate(.7)'},
  {id:'neon',name:'Neon',css:'saturate(2) contrast(1.25) hue-rotate(-25deg)',tint:'rgba(236,72,153,.18)'}
];
const VOICES=[
  {id:'none',name:'Original',icon:'mic'},{id:'studio',name:'Studio',icon:'sparkles'},
  {id:'deep',name:'Deep',icon:'chevrons-down'},{id:'chip',name:'Chipmunk',icon:'chevrons-up'},
  {id:'robot',name:'Robot',icon:'bot'},{id:'echo',name:'Echo',icon:'repeat'},
  {id:'hall',name:'Hall',icon:'theater'},{id:'radio',name:'Radio',icon:'radio'}
];
const FILTER_OK=(()=>{ try{ const g=document.createElement('canvas').getContext('2d'); g.filter='grayscale(1)'; return g.filter==='grayscale(1)'; }catch(e){ return false; } })();
const stVideo=$('#stVideo'), stCanvas=$('#stCanvas');
stVideo.playsInline=true; stVideo.muted=true;
let UI_FONT=''; const uiFont=()=>UI_FONT||(UI_FONT=getComputedStyle(document.body).fontFamily);

function delayBuf(c,active,fade,up){ const sr=c.sampleRate,l1=active*sr|0,l2=(active-2*fade)*sr|0,len=l1+l2,b=c.createBuffer(1,len,sr),p=b.getChannelData(0); for(let i=0;i<l1;i++) p[i]=up?(l1-i)/len:i/l1; return b; }
function fadeBuf(c,active,fade){ const sr=c.sampleRate,l1=active*sr|0,l2=(active-2*fade)*sr|0,len=l1+l2,fl=fade*sr|0,i2=l1-fl,b=c.createBuffer(1,len,sr),p=b.getChannelData(0); for(let i=0;i<l1;i++) p[i]=i<fl?Math.sqrt(i/fl):i>=i2?Math.sqrt(1-(i-i2)/fl):1; return b; }
function pitchShifter(c,shift){
  const dt=0.1,ft=0.05,bt=0.1, input=c.createGain(), output=c.createGain();
  const down=delayBuf(c,bt,ft,false), up=delayBuf(c,bt,ft,true), mk=b=>{ const s=c.createBufferSource(); s.buffer=b; s.loop=true; return s; };
  const m1=mk(down),m2=mk(down),m3=mk(up),m4=mk(up), g1=c.createGain(),g2=c.createGain(),g3=c.createGain(),g4=c.createGain(), U=shift>0;
  g1.gain.value=g2.gain.value=U?0:1; g3.gain.value=g4.gain.value=U?1:0;
  m1.connect(g1); m2.connect(g2); m3.connect(g3); m4.connect(g4);
  const mg1=c.createGain(),mg2=c.createGain(); mg1.gain.value=mg2.gain.value=dt*Math.abs(shift);
  g1.connect(mg1); g3.connect(mg1); g2.connect(mg2); g4.connect(mg2);
  const d1=c.createDelay(1),d2=c.createDelay(1); mg1.connect(d1.delayTime); mg2.connect(d2.delayTime);
  const fb=fadeBuf(c,bt,ft),f1=mk(fb),f2=mk(fb),x1=c.createGain(),x2=c.createGain(); x1.gain.value=x2.gain.value=0; f1.connect(x1.gain); f2.connect(x2.gain);
  input.connect(d1); input.connect(d2); d1.connect(x1); d2.connect(x2); x1.connect(output); x2.connect(output);
  const t=c.currentTime+0.05,t2=t+bt-ft; m1.start(t); m2.start(t2); m3.start(t); m4.start(t2); f1.start(t); f2.start(t2);
  return {input,output,srcs:[m1,m2,m3,m4,f1,f2]};
}
function impulse(c,sec,decay){ const sr=c.sampleRate,len=sec*sr|0,b=c.createBuffer(2,len,sr); for(let ch=0;ch<2;ch++){ const d=b.getChannelData(ch); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay); } return b; }

/* ---------------------------------------------------------------------
   Take editor engine
   Audio is the master clock. Each vocal track is a non-destructive region of
   a source buffer (the take, or a layer recorded on top): start position,
   trims, fades, volume, pan and its own effect. Edits are a small settings
   object saved to the draft as you go; the original audio is never changed.
   --------------------------------------------------------------------- */
/* Lyrics are an overlay on the take, never burned into the recording: the camera footage
   is kept as recorded and the lyrics are drawn on top in the preview and in the export,
   with the same code, so they always match. */
const LYR_DEFAULT={size:1,y:0.84,color:'#FFFFFF',font:'sans',bg:'box'};
const LYR_COLORS=[['#FFFFFF','White'],['#FDE047','Yellow'],['#F9A8D4','Pink'],['#67E8F9','Cyan'],['#86EFAC','Green']];
const LYR_FONTS=[['sans','Clean'],['serif','Serif'],['rounded','Friendly'],['mono','Mono']];
const LYR_BGS=[['box','Box'],['outline','Outline'],['shadow','Shadow'],['none','None']];
const lyrStyle=()=>({...LYR_DEFAULT,...(ST.e&&ST.e.lyr||{})});
function lyrFont(f){ return f==='serif'?"'Lora', Georgia, serif":f==='mono'?"'JetBrains Mono', ui-monospace, monospace":f==='rounded'?"'Atkinson Hyperlegible', system-ui, sans-serif":uiFont(); }
const EDIT_DEFAULT={filter:'none',vVol:1,mVol:.8,mirror:false,vignette:false,grain:false,captions:true,watermark:true,clean:true,cleanAmt:.5,enhance:true,enhanceAmt:.5,musicNudge:0,tracks:null,sel:'main'};
const mainTrack=fx=>({id:'main',name:'Main vocal',gain:1,pan:0,mute:false,solo:false,fx:fx||'none',fxv:fxDefaults(fx||'none'),lock:true,clips:[{id:'mainc',src:'take',lock:true,at:0,trimIn:0,trimOut:0,fadeIn:0,fadeOut:0}]});
/* Older drafts stored one clip per track; turn each into a layer with one clip. */
const toLayer=t=>t.clips?t:{id:t.id,name:t.name,gain:t.gain??1,pan:t.pan||0,mute:!!t.mute,solo:!!t.solo,fx:t.fx||'none',fxv:t.fxv||{},lock:!!t.lock,clips:[{id:t.id+'c',src:t.src,lock:!!t.lock,at:t.at||0,trimIn:t.trimIn||0,trimOut:t.trimOut||0,fadeIn:t.fadeIn||0,fadeOut:t.fadeOut||0}]};
const ST={blob:null,meta:null,url:'',draftId:null,tab:'voice',e:{...EDIT_DEFAULT},
  ctx:null,mode:'buffer',bufs:new Map(),musicBuf:null,
  voiceGain:null,musicGain:null,master:null,recDest:null,chains:new Map(),elemIn:null,
  srcs:[],playing:false,pos:0,startCtx:0,raf:0,exporting:false,cancel:false,dur:0,hasMusic:false,thumbFrame:null,cleaning:0,elemSrc:null,overdub:null};
AUDIO.register('studio',{label:()=>ST.meta?ST.meta.title:'Take',sub:'Take editor preview',icon:'video',playing:()=>ST.playing,stop:()=>stPause(),here:()=>!$('#studio').hidden});
const trackById=id=>(ST.e.tracks||[]).find(t=>t.id===id);
const selTrack=()=>trackById(ST.e.sel)||ST.e.tracks[0];

function ensureStudioGraph(){
  if(ST.ctx) return true; const C=window.AudioContext||window.webkitAudioContext; if(!C) return false;
  try{ const c=new C({latencyHint:'playback'}); ST.ctx=c;
    ST.voiceGain=c.createGain(); ST.musicGain=c.createGain(); ST.master=c.createGain(); ST.recDest=c.createMediaStreamDestination();
    ST.voiceGain.connect(ST.master); ST.musicGain.connect(ST.master); ST.master.connect(c.destination); ST.master.connect(ST.recDest);
    return true;
  }catch(e){ ST.ctx=null; return false; }
}
function decodeIn(ctx,blob){ return blob.arrayBuffer().then(ab=>new Promise((res,rej)=>{ try{ const p=ctx.decodeAudioData(ab,res,rej); if(p&&p.then) p.then(res,rej); }catch(e){ rej(e); } })); }

/* Per-track chain: loudness → high-pass → (adaptive enhancer | simple polish) → limiter → effect → fades → pan → volume → vocal bus */
function buildTrackChain(t){
  const c=ST.ctx, nodes=[], srcs=[]; const sb=ST.bufs.get((t.clips[0]||{}).src)||{};
  const input=c.createGain(); nodes.push(input); let head=input;
  if(ST.e.clean||ST.e.enhance){
    const lg=c.createGain(); lg.gain.value=loudnessGain(sb.stats); const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=85; hp.Q.value=.7; head.connect(lg); lg.connect(hp); nodes.push(lg,hp); head=hp;
    if(ST.e.enhance){ const en=buildEnhancer(c,nodes,sb.stats,ST.e.enhanceAmt); head.connect(en.input); head=en.output; }
    else { const pres=c.createBiquadFilter(); pres.type='peaking'; pres.frequency.value=3200; pres.Q.value=.9; pres.gain.value=2; const ess=c.createBiquadFilter(); ess.type='peaking'; ess.frequency.value=6800; ess.Q.value=2.2; ess.gain.value=-3; const cp=c.createDynamicsCompressor(); cp.threshold.value=-20; cp.ratio.value=3; cp.attack.value=.006; cp.release.value=.14; head.connect(pres); pres.connect(ess); ess.connect(cp); nodes.push(pres,ess,cp); head=cp; }
    const lim=c.createDynamicsCompressor(); lim.threshold.value=-3; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=.001; lim.release.value=.08; head.connect(lim); nodes.push(lim); head=lim;
  }
  let fx=null; const def=FXMAP[t.fx];
  if(def&&def.build){ fx=def.build(c,nodes,{...fxDefaults(t.fx),...(t.fxv||{})}); if(fx.srcs) srcs.push(...fx.srcs); head.connect(fx.input); head=fx.output; }
  const fade=c.createGain(), pan=c.createStereoPanner?c.createStereoPanner():c.createGain(), vol=c.createGain();
  if(pan.pan) pan.pan.value=t.pan||0; vol.gain.value=t.gain??1;
  head.connect(fade); fade.connect(pan); pan.connect(vol); vol.connect(ST.voiceGain); nodes.push(fade,pan,vol);
  return {input,fade,pan,vol,fx,nodes,srcs};
}
function dropChain(id){ const ch=ST.chains.get(id); if(!ch) return; ch.srcs.forEach(s=>{ try{ s.stop(); }catch(e){} }); ch.nodes.forEach(n=>{ try{ n.disconnect(); }catch(e){} }); ST.chains.delete(id); }
function rebuildChains(){ [...ST.chains.keys()].forEach(dropChain); if(!ST.ctx) return; (ST.e.tracks||[]).forEach(t=>ST.chains.set(t.id,buildTrackChain(t))); if(ST.elemIn&&ST.mode==='element'){ try{ ST.elemSrc.disconnect(); }catch(e){} const ch=ST.chains.get('main'); if(ch) ST.elemSrc.connect(ch.input); } }
function rebuildVoiceChain(){ rebuildChains(); if(ST.playing){ const t=stNow(); stopSources(); startSources(t); } }

/* ---------- Transport ---------- */
/* Where the clean music starts on the timeline: the measured position of the music the mic
   heard (when there is any), otherwise the offset estimated while recording. */
const musicAt=()=>(leakFound()?ST.leak.lag:(ST.meta&&ST.meta.musicOffset||0))+(ST.e.musicNudge||0);
const LEAK_PSR=7; const leakFound=()=>!!(ST.leak&&ST.leak.psr>=LEAK_PSR);
// The music is already in the take when it was recorded through the mic.
const acousticTake=()=>!!ST.meta&&(ST.meta.mode==='acoustic'||(ST.meta.mode==='mic'&&!!ST.meta.ext));
function computeHasMusic(){ const m=ST.meta; if(!m.music) return false; if(acousticTake()) return !!ST.e.addClean; return !(m.mixed&&!m.stem); }
async function measureLeak(){
  ST.leak=null; const t=ST.bufs.get('take'); if(!t||!t.raw||!ST.musicBuf) return;
  try{ ST.leak=await findLeak(t.raw,ST.musicBuf,2.5); }catch(e){ ST.leak=null; }
}
function stNow(){ return ST.playing?Math.min(ST.dur,ST.pos+(ST.ctx.currentTime-ST.startCtx)):ST.pos; }
function bufFor(c){ const b=ST.bufs.get(c.src); if(!b) return null; return (ST.e.clean&&b.clean)?b.clean:b.raw; }
const clipLen=c=>{ const b=ST.bufs.get(c.src); return b&&b.raw?b.raw.duration:0; };
const regionOf=c=>({a:c.at+c.trimIn, b:c.at+clipLen(c)-c.trimOut});
function audible(){ const tr=ST.e.tracks||[]; const solo=tr.some(t=>t.solo); return tr.filter(t=>solo?t.solo:!t.mute); }
function startSources(at){
  const c=ST.ctx, when=c.currentTime+0.05; ST.startCtx=when; ST.pos=at; ST.srcs=[];
  if(ST.mode==='buffer') audible().forEach(t=>{ const ch=ST.chains.get(t.id); if(!ch) return;
    t.clips.forEach(cl=>{
      const buf=bufFor(cl); if(!buf) return;
      const {a,b}=regionOf(cl); if(b<=a||at>=b) return;
      const startTl=Math.max(at,a), wait=startTl-at, off=cl.trimIn+(startTl-a), dur=b-startTl;
      const s=c.createBufferSource(); s.buffer=buf; const fg=c.createGain(); s.connect(fg); fg.connect(ch.input); s.start(when+wait,off,dur); s.onended=()=>{ try{ fg.disconnect(); }catch(e){} }; ST.srcs.push(s);
      // per-clip fades on the timeline
      const g=fg.gain, tl2c=x=>when+(x-at);
      const valAt=x=>{ let v=1; if(cl.fadeIn>0) v=Math.min(v,clamp01((x-a)/cl.fadeIn)); if(cl.fadeOut>0) v=Math.min(v,clamp01((b-x)/cl.fadeOut)); return v; };
      g.setValueAtTime(valAt(startTl),tl2c(startTl));
      if(cl.fadeIn>0&&a+cl.fadeIn>startTl) g.linearRampToValueAtTime(1,tl2c(a+cl.fadeIn));
      if(cl.fadeOut>0){ const fo=Math.max(startTl,b-cl.fadeOut); g.setValueAtTime(valAt(fo),tl2c(fo)); g.linearRampToValueAtTime(0,tl2c(b)); }
    });
  });
  if(ST.musicBuf&&ST.hasMusic){ const m=c.createBufferSource(); m.buffer=ST.musicBuf; m.loop=!!(ST.meta&&ST.meta.loop);
    // music volume changes made on the stage during the take, replayed on the timeline
    const au=ST.meta&&ST.meta.musicAuto; let into=ST.musicGain;
    if(au&&au.length){ const ag=c.createGain(); ag.connect(ST.musicGain); into=ag; let cur=1; for(const [t,v] of au){ if(t<=at) cur=v; }
      ag.gain.setValueAtTime(cur,when); let pv=cur; for(const [t,v] of au){ if(t>at){ const w=when+(t-at); ag.gain.setValueAtTime(pv,w); ag.gain.linearRampToValueAtTime(v,w+0.05); pv=v; } }
      m.onended=()=>{ try{ ag.disconnect(); }catch(e){} }; }
    m.connect(into);
    const mo=at-musicAt();
    if(mo>=0){ if(m.loop||mo<ST.musicBuf.duration){ m.start(when,m.loop?mo%ST.musicBuf.duration:mo); ST.srcs.push(m); } }
    else { m.start(when-mo,0); ST.srcs.push(m); } }
}
function stopSources(){ ST.srcs.forEach(s=>{ try{ s.stop(); }catch(e){} try{ s.disconnect(); }catch(e){} }); ST.srcs=[]; }
function stPlay(){
  if(!ensureStudioGraph()) return; AUDIO.claim('studio');
  if(ST.ctx.state==='suspended') ST.ctx.resume();
  if(ST.pos>=ST.dur-0.05) ST.pos=0;
  try{ stVideo.currentTime=ST.pos; }catch(e){}
  startSources(ST.pos); ST.playing=true;
  if(ST.mode==='element'){ stVideo.muted=false; }
  stVideo.play().catch(()=>{});
  $('#stPrev').classList.add('playing');
}
function stPause(){ if(ST.playing){ ST.pos=stNow(); } ST.playing=false; stopSources(); stVideo.pause(); $('#stPrev').classList.remove('playing'); stVideo.playbackRate=1; drawCapLayer(true); }
function stSeek(t){ const was=ST.playing; if(was){ stopSources(); ST.playing=false; } ST.pos=Math.max(0,Math.min(ST.dur,t)); try{ stVideo.currentTime=ST.pos; }catch(e){} if(was) stPlay(); else drawCapLayer(true); }
function restartIfPlaying(){ if(ST.playing){ const t=stNow(); stopSources(); startSources(t); } }
function seekTo(t){ return new Promise(r=>{ let d=false; const fin=()=>{ if(d) return; d=true; stVideo.removeEventListener('seeked',fin); r(); }; stVideo.addEventListener('seeked',fin); ST.pos=t; try{ stVideo.currentTime=t; }catch(e){ fin(); } setTimeout(fin,1500); }); }
function applyMix(){ if(!ST.ctx) return; const t=ST.ctx.currentTime; ST.voiceGain.gain.setTargetAtTime(ST.e.vVol,t,0.02); ST.musicGain.gain.setTargetAtTime(ST.hasMusic?ST.e.mVol:0,t,0.02); }
/* ---------- Open, prepare, persist ---------- */
async function openStudio(blob,meta,opts={}){
  ST.blob=blob; ST.meta={...meta,loop:meta.loop??(meta.kind!=='song')}; ST.draftId=opts.draftId||null;
  const ed=opts.edit||{};
  // Takes recorded with the in-app mixer already have a processed voice; don't process twice.
  // Natural recordings with music in them aren't processed by default either: the offline cleaner is for voice.
  const fresh=(meta.mixed||(meta.mode&&meta.mode!=='mic')||meta.ext)&&!opts.edit?{clean:false,enhance:false}:{};
  ST.e={...EDIT_DEFAULT,mVol:meta.musicVol??.8,captions:!!(meta.captions&&meta.captions.length)&&S.settings.lyrShow!==false,lyr:{...LYR_DEFAULT,...(S.settings.lyrStyle||{})},...fresh,...ed};
  if(!Array.isArray(ST.e.tracks)||!ST.e.tracks.length) ST.e.tracks=[mainTrack(ed.voice)];
  ST.e.tracks=ST.e.tracks.map(toLayer);
  if(!trackById(ST.e.sel)) ST.e.sel=ST.e.tracks[0].id;
  ST.selClip=(selTrack().clips[0]||{}).id||null; UNDO.past=[]; UNDO.future=[]; SUB='';
  ST.tab=opts.edit?ST.tab:'voice'; ST.cancel=false; ST.thumbFrame=null; ST.pos=0; ST.playing=false;
  ST.bufs=new Map(); ST.musicBuf=null; ST.mode='buffer'; [...ST.chains.keys()].forEach(dropChain);
  if(!ST.draftId&&meta.remix){ const d=await createDraft(blob,meta,meta.music||null); ST.draftId=d.id; }
  if(ST.draftId) markDraftOpen(ST.draftId,true);
  if(ST.url) URL.revokeObjectURL(ST.url);
  ST.url=URL.createObjectURL(blob); stVideo.src=ST.url; stVideo.muted=true;
  // A mixed take without its voice stem (e.g. recovered after a crash) already contains the music.
  ST.leak=null; ST.hasMusic=computeHasMusic();
  $('#studio').hidden=false; document.body.style.overflow='hidden';
  $('#stSaved').classList.remove('on'); $('#stSaved').textContent='';
  ensureStudioGraph();
  await new Promise(r=>{ if(stVideo.readyState>=1) r(); else { stVideo.onloadedmetadata=()=>r(); stVideo.onerror=()=>r(); setTimeout(r,5000); } });
  ST.dur=await fixDuration(stVideo);
  const vw=stVideo.videoWidth||720, vh=stVideo.videoHeight||1280, sc=Math.min(1,1280/Math.max(vw,vh));
  stCanvas.width=Math.round(vw*sc/2)*2; stCanvas.height=Math.round(vh*sc/2)*2;
  $('#stPrev').style.aspectRatio=vw+'/'+vh;
  $('#stSeek').max=ST.dur||1; $('#stDur').textContent=fmt(ST.dur);
  await seekTo(Math.min(0.4,(ST.dur||1)/2)); grabThumbFrame(); drawFrame(); await seekTo(0); drawFrame();
  if(ST.draftId&&ST.thumbFrame){ try{ const c=document.createElement('canvas'); c.width=160; c.height=Math.round(160*stCanvas.height/stCanvas.width); c.getContext('2d').drawImage(ST.thumbFrame,0,0,c.width,c.height); saveDraftEdit(ST.draftId,ST.e,{thumb:c.toDataURL('image/jpeg',.7),dur:ST.dur}); }catch(e){} }
  applyLook(); renderStPanel(); stLoop();
  if(ST.ctx){
    try{ const raw=await decodeIn(ST.ctx,meta.stem||blob); if(raw.duration<0.3) throw new Error('no audio'); ST.bufs.set('take',{raw}); if(!ST.dur||!isFinite(ST.dur)) ST.dur=raw.duration; }
    catch(e){ ST.mode='element'; try{ ST.elemSrc=ST.elemSrc||ST.ctx.createMediaElementSource(stVideo); ST.elemIn=true; stVideo.muted=false; }catch(_){} }
    // recorded layers
    for(const t of ST.e.tracks) for(const cl of t.clips){ if(cl.src.startsWith('ovd:')&&!ST.bufs.has(cl.src)&&ST.draftId){ const b=await idb.get('draftv:'+ST.draftId+':'+cl.src.slice(4),'rec'); if(b){ try{ ST.bufs.set(cl.src,{raw:await decodeIn(ST.ctx,b)}); }catch(e){} } } }
    if(meta.music&&ST.hasMusic){ try{ ST.musicBuf=await decodeIn(ST.ctx,meta.music); }catch(e){ ST.musicBuf=null; ST.hasMusic=false; } }
    // If the mic picked up the music, put the clean copy exactly on top of it (no echo).
    if(ST.musicBuf&&ST.mode==='buffer') await measureLeak();
    rebuildChains(); applyMix();
    if(ST.e.clean||ST.e.enhance) runClean();
  }
  renderStPanel();
}
function fixDuration(v){
  if(isFinite(v.duration)&&v.duration>0) return Promise.resolve(v.duration);
  return new Promise(res=>{ let done=false; const fin=d=>{ if(done) return; done=true; v.removeEventListener('durationchange',on); res(d); };
    const on=()=>{ if(isFinite(v.duration)&&v.duration>0){ fin(v.duration); } };
    v.addEventListener('durationchange',on); try{ v.currentTime=1e101; }catch(e){}
    setTimeout(()=>fin(isFinite(v.duration)&&v.duration>0?v.duration:(ST.meta.dur||0)),3000); });
}
/* Clean (or just measure) every source buffer. Measuring feeds loudness and the enhancer. */
async function runClean(){
  if(ST.cleaning) { ST.cleanAgain=true; return; }
  const jobs=[...ST.bufs.entries()].filter(([,b])=>b.raw); if(!jobs.length) return;
  ST.cleaning=1; ST.cleanAgain=false; renderCleanStatus(0);
  const amt=ST.e.clean?ST.e.cleanAmt:0;
  let i=0;
  for(const [k,b] of jobs){
    try{ const r=await vocalClean(ST.ctx,b.raw,amt,p=>renderCleanStatus((i+p)/jobs.length)); b.clean=ST.e.clean?r.buf:null; b.stats=r.stats; b.amt=amt; }
    catch(e){ toast('Couldn’t clean up this take'); }
    i++;
  }
  ST.cleaning=0;
  if(ST.cleanAgain||(ST.e.clean?ST.e.cleanAmt:0)!==amt){ runClean(); return; }
  rebuildVoiceChain(); renderCleanStatus(1);
}
function renderCleanStatus(p){ const el=$('#stCleanSt'); if(!el) return; const b=ST.bufs.get('take');
  if(ST.cleaning){ el.textContent='Working… '+Math.round(p*100)+'%'; return; }
  const bits=[]; if(ST.e.clean&&b&&b.clean) bits.push('Noise reduced'); if((ST.e.clean||ST.e.enhance)&&b&&b.stats) bits.push('level evened out');
  el.textContent=bits.length?bits.join(' · '):ST.e.clean?'':'Off';
  const en=$('#stEnhSt'); if(en){ if(!ST.e.enhance){ en.textContent='Off'; } else if(b&&b.stats){ const p=enhancePlan(b.stats,ST.e.enhanceAmt); const parts=[]; if(p.presence>0.4) parts.push('presence +'+p.presence.toFixed(1)+' dB'); if(p.mud<-0.4) parts.push('less boom'); parts.push('harshness smoothed'); if(p.deess<-1) parts.push('de-essed'); en.textContent='Tuned to your voice: '+parts.join(' · '); } else en.textContent='Listening to your voice…'; } }
function persistEdit(){ if(ST.draftId) saveDraftEdit(ST.draftId,JSON.parse(JSON.stringify(ST.e))); }
function grabThumbFrame(){ try{ const c=document.createElement('canvas'); const w=144,h=Math.round(144*stCanvas.height/stCanvas.width); c.width=w; c.height=h; c.getContext('2d').drawImage(stVideo,0,0,w,h); ST.thumbFrame=c; }catch(e){ ST.thumbFrame=null; } }
let GRAIN=null;
function drawFrame(){
  const g=stCanvas.getContext('2d'), w=stCanvas.width, h=stCanvas.height, F=FILTERS.find(f=>f.id===ST.e.filter)||FILTERS[0];
  g.save(); g.clearRect(0,0,w,h);
  if(ST.e.mirror){ g.translate(w,0); g.scale(-1,1); }
  if(FILTER_OK) g.filter=F.css;
  try{ g.drawImage(stVideo,0,0,w,h); }catch(e){}
  g.restore(); g.filter='none';
  if(F.tint){ g.globalCompositeOperation='soft-light'; g.fillStyle=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')'); g.fillRect(0,0,w,h); g.globalCompositeOperation='source-over'; }
  if(F.glow&&FILTER_OK){ g.globalAlpha=.28; g.globalCompositeOperation='screen'; g.filter='blur('+Math.round(w/60)+'px)'; g.drawImage(stCanvas,0,0); g.filter='none'; g.globalAlpha=1; g.globalCompositeOperation='source-over'; }
  if(ST.e.vignette||F.vig){ const vg=g.createRadialGradient(w/2,h/2,Math.min(w,h)*.35,w/2,h/2,Math.max(w,h)*.72); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.6)'); g.fillStyle=vg; g.fillRect(0,0,w,h); }
  if(ST.e.grain||F.grain){ if(!GRAIN) GRAIN=g.createPattern(noiseCanvas(),'repeat'); g.save(); g.globalAlpha=.12; g.globalCompositeOperation='overlay'; g.translate(Math.random()*128|0,Math.random()*128|0); g.fillStyle=GRAIN; g.fillRect(-128,-128,w+256,h+256); g.restore(); }
  drawCaptions(g,w,h,stNow());
  if(ST.e.watermark) drawMark(g,w,h);
}
/* Returns the index of the caption shown at time t, or -1. */
function capAt(t){ const caps=ST.meta&&ST.meta.captions; if(!(ST.e.captions&&caps&&caps.length)) return -1; let i=-1; for(let k=0;k<caps.length;k++){ if(caps[k].t<=t) i=k; else break; } return i>=0&&t<(caps[i+1]?caps[i+1].t:caps[i].e+2)?i:-1; }
function drawCaptions(g,w,h,t,opt={}){
  const caps=ST.meta&&ST.meta.captions;
  if(!(caps&&caps.length)||!(ST.e.captions||opt.force)) return null;
  let i=-1; for(let k=0;k<caps.length;k++){ if(caps[k].t<=t) i=k; else break; }
  const live=i>=0&&t<(caps[i+1]?caps[i+1].t:caps[i].e+2);
  if(!live){ if(!opt.ghost) return null; i=Math.max(0,Math.min(caps.length-1,i<0?0:i+1)); }
  const L=lyrStyle(), c=caps[i];
  // readable default: about 4% of the short side (a 1080-wide video gets ~43 px), adjustable 60–160%
  const fs=Math.max(10,Math.round(Math.min(w,h)*0.04*Math.max(0.6,Math.min(1.6,L.size))));
  let f=live?clamp01((t-c.t)/Math.max(.3,c.e-c.t)):0;
  if(live&&c.w&&c.w.length){ const ws=c.text.split(/\s+/).filter(Boolean); if(ws.length===c.w.length){ const tot=ws.reduce((a,x)=>a+x.length+1,0); let acc=0; ws.forEach((x,k)=>{ acc+=(x.length+1)*clamp01((t-c.w[k].s)/Math.max(.05,c.w[k].e-c.w[k].s)); }); f=acc/tot; } }
  g.save(); g.font=`700 ${fs}px ${lyrFont(L.font)}`; g.textAlign='center'; g.textBaseline='middle';
  const lines=wrapText(g,c.text,w*.86).slice(0,2), lh=fs*1.28, total=lines.length*lh;
  const padY=fs*.42, safe=Math.min(w,h)*.05;
  let yc=h*L.y; yc=Math.max(safe+total/2+padY,Math.min(h-safe-total/2-padY,yc));
  const y0=yc-total/2, bw=Math.min(w*.94,Math.max(...lines.map(l=>g.measureText(l).width))+fs*1.1);
  if(opt.ghost) g.globalAlpha=.75;
  if(L.bg==='box'){ g.fillStyle='rgba(0,0,0,.5)'; roundRectPath(g,(w-bw)/2,y0-padY,bw,total+padY*2,fs*.45); g.fill(); }
  const allW=lines.reduce((a,l)=>a+g.measureText(l).width,0); let done=f*allW;
  const sung=L.color, unsung=L.color.toUpperCase()==='#FFFFFF'?'rgba(255,255,255,.55)':'rgba(255,255,255,.72)';
  lines.forEach((l,j)=>{ const y=y0+j*lh+lh/2, lw=g.measureText(l).width, x0=w/2-lw/2;
    const paint=col=>{ if(L.bg==='outline'){ g.lineJoin='round'; g.lineWidth=Math.max(2,fs*.16); g.strokeStyle='rgba(0,0,0,.85)'; g.strokeText(l,w/2,y); }
      if(L.bg==='shadow'){ g.shadowColor='rgba(0,0,0,.85)'; g.shadowBlur=fs*.35; g.shadowOffsetY=fs*.06; } g.fillStyle=col; g.fillText(l,w/2,y); g.shadowBlur=0; g.shadowOffsetY=0; };
    paint(unsung);
    const pw=Math.max(0,Math.min(lw,done)); done-=lw;
    if(pw>0){ g.save(); g.beginPath(); g.rect(x0-fs,y-fs,pw+fs,fs*2); g.clip(); paint(sung); g.restore(); } });
  g.restore();
  return {y0:y0-padY,y1:y0+total+padY,x0:(w-bw)/2,x1:(w+bw)/2,yc};
}
function drawMark(g,w,h){ { const fs=Math.round(Math.min(w,h)*.028); g.font=`600 ${fs}px ${uiFont()}`; g.textAlign='right'; g.textBaseline='bottom'; g.fillStyle='rgba(255,255,255,.75)'; g.shadowColor='rgba(0,0,0,.5)'; g.shadowBlur=6; g.fillText('● Lectern',w-fs*1.1,h-fs*1.1); g.shadowBlur=0; }
}
function wrapText(g,text,maxW){ const words=text.split(/\s+/), out=[]; let line=''; words.forEach(wd=>{ const t=line?line+' '+wd:wd; if(g.measureText(t).width>maxW&&line){ out.push(line); line=wd; } else line=t; }); if(line) out.push(line); return out.slice(0,3); }
function roundRectPath(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
/* ---------- Preview: GPU-composited video + light overlays ----------
   The preview is the video element itself with the colour filter applied as a CSS
   filter (composited on the GPU) and tint, vignette and grain as overlay layers.
   Only the lyric caption is drawn per frame, on a small transparent canvas.
   The full canvas pipeline is used just for rendering the final video. */
let GRAIN_URL='';
function applyLook(){
  const F=FILTERS.find(f=>f.id===ST.e.filter)||FILTERS[0];
  stVideo.style.filter=(F.css==='none'?'':F.css)+(F.glow?' brightness(1.05)':'');
  stVideo.style.transform=ST.e.mirror?'scaleX(-1)':'';
  const tint=$('#stTint'); tint.hidden=!F.tint; if(F.tint) tint.style.background=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')');
  $('#stVig').hidden=!(ST.e.vignette||F.vig);
  const gr=$('#stGrain'); gr.hidden=!(ST.e.grain||F.grain); if(!gr.hidden&&!GRAIN_URL){ try{ GRAIN_URL=noiseCanvas().toDataURL(); gr.style.backgroundImage=`url(${GRAIN_URL})`; }catch(e){} }
  $('#stMark').hidden=!ST.e.watermark;
  drawCapLayer(true);
}
const CAPL={last:-2,at:0,box:null,drag:null};
function drawCapLayer(force){
  const cv=$('#stCap'); if(!cv) return;
  const t=stNow(), i=capAt(t), now=performance.now();
  if(!force&&i===-1&&CAPL.last===-1&&!CAPL.drag) return;
  if(!force&&now-CAPL.at<33) return;
  CAPL.at=now; CAPL.last=i;
  const r=cv.getBoundingClientRect(), dpr=Math.min(2,devicePixelRatio||1), W=Math.max(1,Math.round(r.width*dpr)), H=Math.max(1,Math.round(r.height*dpr));
  if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
  const g=cv.getContext('2d'); g.clearRect(0,0,W,H);
  // while styling the lyrics with the video paused, show the nearest line so changes are visible
  const ghost=ST.tab==='extras'&&!ST.playing&&ST.e.captions;
  if(i>=0||ghost) CAPL.box=drawCaptions(g,W,H,t,{ghost}); else CAPL.box=null;
  if(CAPL.drag){ g.save(); g.strokeStyle='rgba(255,255,255,.55)'; g.setLineDash([6*dpr,6*dpr]); g.lineWidth=dpr; [0.12,0.5,0.84].forEach(y=>{ g.beginPath(); g.moveTo(0,H*y); g.lineTo(W,H*y); g.stroke(); });
    const m=Math.min(W,H)*.05; g.strokeStyle='rgba(253,224,71,.5)'; g.strokeRect(m,m,W-2*m,H-2*m); g.restore(); }
}
/* Keep the video on the audio clock without seeking: speed it up or slow it down by up
   to 10% until it catches up. Only a large gap (after a stall) jumps, at most every 1.5 s. */
const VSYNC={media:null,at:0,lastSeek:0};
function videoTime(){ return VSYNC.media!=null&&performance.now()-VSYNC.at<250?VSYNC.media+(performance.now()-VSYNC.at)/1000*stVideo.playbackRate:stVideo.currentTime; }
function syncVideo(t){
  if(ST.mode!=='buffer') return;
  const d=videoTime()-t, now=performance.now();
  if(Math.abs(d)>0.75&&now-VSYNC.lastSeek>1500){ VSYNC.lastSeek=now; VSYNC.media=null; try{ stVideo.currentTime=Math.min(ST.dur,t+0.08); }catch(e){} stVideo.playbackRate=1; return; }
  const r=Math.abs(d)<0.03?1:Math.max(0.9,Math.min(1.1,1-d*0.8));
  if(Math.abs(stVideo.playbackRate-r)>0.01) try{ stVideo.playbackRate=r; }catch(e){}
  if(stVideo.paused&&!stVideo.ended) stVideo.play().catch(()=>{});
}
const HAS_RVFC='requestVideoFrameCallback' in HTMLVideoElement.prototype;
function onVideoFrame(now,meta){ VSYNC.media=meta.mediaTime; VSYNC.at=performance.now(); if(ST.exporting) drawFrame(); stVideo.requestVideoFrameCallback(onVideoFrame); }
if(HAS_RVFC) stVideo.requestVideoFrameCallback(onVideoFrame);
function stLoop(){
  cancelAnimationFrame(ST.raf);
  const step=()=>{ if($('#studio').hidden&&!ST.exporting) return;
    stHealth();
    const t=stNow();
    if(ST.playing){
      if(t>=ST.dur-0.03){ if(ST.exporting){ ST.pos=ST.dur; } else { stPause(); ST.pos=0; try{ stVideo.currentTime=0; }catch(e){} } }
      else syncVideo(t);
      if(ST.exporting){ if(!HAS_RVFC) drawFrame(); } else drawCapLayer();
      if(ST.tab==='tracks') moveLaneHead(t);
    }
    $('#stNow').textContent=fmt(t); if(!ST.seeking) $('#stSeek').value=t;
    if(ST.exporting){ const p=Math.round(clamp01(t/(ST.dur||1))*100); $('#rRing').style.setProperty('--p',p); $('#rPct').textContent=p+'%'; }
    ST.raf=requestAnimationFrame(step); };
  ST.raf=requestAnimationFrame(step);
}
/* Same check as the stage player: if the editor's audio clock runs at the wrong speed or
   stops (an audio-route change on some phones), rebuild the editor's audio graph. */
const STH={a:null,last:0};
function stHealth(){
  if(!ST.ctx||!ST.playing||ST.exporting||ST.mode!=='buffer'||document.hidden){ STH.a=null; return; }
  const now=performance.now(); if(!STH.a){ STH.a=[now,ST.ctx.currentTime]; return; }
  const wall=(now-STH.a[0])/1000; if(wall<2) return;
  const ratio=(ST.ctx.currentTime-STH.a[1])/wall; STH.a=[now,ST.ctx.currentTime];
  if(ratio>0.85&&ratio<1.18||now-STH.last<8000) return;
  STH.last=now; const t=stNow(); stPause(); console.warn('[studio] audio restarted, rate',ratio.toFixed(2));
  try{ ST.ctx.close(); }catch(e){} ST.ctx=null; [...ST.chains.keys()].forEach(k=>ST.chains.delete(k));
  if(ensureStudioGraph()){ rebuildChains(); applyMix(); ST.pos=t; stPlay(); }
}
stVideo.addEventListener('seeked',()=>{ if(!ST.playing){ drawCapLayer(true); if(ST.tab==='tracks') moveLaneHead(ST.pos); } });
$('#stPP').onclick=()=>{ if(ST.exporting) return; ST.playing?stPause():stPlay(); };
const stSeekEl=$('#stSeek');
stSeekEl.addEventListener('pointerdown',()=>ST.seeking=true); stSeekEl.addEventListener('pointerup',()=>ST.seeking=false);
stSeekEl.addEventListener('input',()=>stSeek(+stSeekEl.value));

/* ---------- Panels ---------- */
const PEAKS=new WeakMap();
function peaksOf(buf,n=400){ let p=PEAKS.get(buf); if(p&&p.length===n) return p; const d=buf.getChannelData(0), step=d.length/n; p=new Float32Array(n); for(let i=0;i<n;i++){ let m=0; const a=Math.floor(i*step), b=Math.min(d.length,Math.floor((i+1)*step)); for(let j=a;j<b;j+=16){ const v=Math.abs(d[j]); if(v>m) m=v; } p[i]=m; } let mx=0; for(const v of p) if(v>mx) mx=v; if(mx>0) for(let i=0;i<n;i++) p[i]/=mx; PEAKS.set(buf,p); return p; }
const fxName=id=>(FXMAP[id]||FXMAP.none).name;
function trackPicker(){ const tr=ST.e.tracks; if(tr.length<2) return ''; return `<div class="trk-pick">${tr.map(t=>`<button class="chip" data-pick="${t.id}" aria-pressed="${t.id===ST.e.sel}">${esc(t.name)}</button>`).join('')}</div>`; }
function renderStPanel(){
  $$('.st-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.p===ST.tab)));
  // karaoke takes: the last tab is where the lyric overlay is controlled
  { const xb=$('.st-tabs [data-p="extras"]'), cap=!!(ST.meta&&ST.meta.captions&&ST.meta.captions.length); if(xb&&xb.dataset.cap!==String(cap)){ xb.dataset.cap=String(cap); xb.innerHTML=ic(cap?'captions':'sparkles','sm')+(cap?'Lyrics':'Extras'); } }
  const p=$('#stPanel'), E=ST.e;
  if(ST.tab==='filters'){
    p.innerHTML=`<div class="fthumbs">${FILTERS.map(f=>`<button class="fth" data-f="${f.id}" aria-pressed="${E.filter===f.id}"><canvas width="72" height="96"></canvas>${esc(f.name)}</button>`).join('')}</div>${FILTER_OK?'':'<p class="hint pad">This device can’t apply colour filters to video, so only tints and extras will show.</p>'}`;
    $$('.fth canvas',p).forEach((cv,i)=>{ const g=cv.getContext('2d'), F=FILTERS[i], src=ST.thumbFrame; if(!src){ g.fillStyle='#222'; g.fillRect(0,0,72,96); return; }
      const sw=src.width, sh=src.height, s=Math.max(72/sw,96/sh); if(FILTER_OK) g.filter=F.css; g.drawImage(src,(72-sw*s)/2,(96-sh*s)/2,sw*s,sh*s); g.filter='none'; if(F.tint){ g.globalCompositeOperation='soft-light'; g.fillStyle=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')'); g.fillRect(0,0,72,96); } });
  } else if(ST.tab==='voice'){
    const t=selTrack(), def=FXMAP[t.fx]||FXMAP.none, v={...fxDefaults(t.fx),...(t.fxv||{})};
    const grid=g=>FX.filter(f=>(f.group||'base')===g||(g==='preset'&&f.id==='none')).map(f=>`<button class="vfx" data-v="${f.id}" aria-pressed="${t.fx===f.id}"><span class="oi">${ic(f.icon)}</span>${esc(f.name)}</button>`).join('');
    p.innerHTML=`<div class="card polish" style="margin:0 20px 12px">
        <div class="setrow"><div class="lbl">Clean up voice<small id="stCleanSt"></small></div><button class="toggle" role="switch" data-x="clean" aria-checked="${!!E.clean}" aria-label="Clean up voice" ${ST.mode==='element'?'disabled':''}></button></div>
        <div class="mixrow" ${E.clean?'':'style="opacity:.4"'}><span class="ml">Noise reduction</span><input type="range" id="stCleanAmt" min="0" max="100" step="5" value="${Math.round(E.cleanAmt*100)}" ${E.clean?'':'disabled'}><output>${Math.round(E.cleanAmt*100)}%</output></div>
        <div class="setrow"><div class="lbl">Enhance<small id="stEnhSt"></small></div><button class="toggle" role="switch" data-x="enhance" aria-checked="${!!E.enhance}" aria-label="Enhance" ${ST.mode==='element'?'disabled':''}></button></div>
        <div class="mixrow" ${E.enhance?'':'style="opacity:.4"'}><span class="ml">Smoothing</span><input type="range" id="stEnhAmt" min="0" max="100" step="5" value="${Math.round(E.enhanceAmt*100)}" ${E.enhance?'':'disabled'}><output>${Math.round(E.enhanceAmt*100)}%</output></div>
        <p class="hint" style="margin:0 2px 2px">Enhance listens to your take and smooths harsh tones, tames sibilance, adds presence and evens out dynamics for your voice. Your original take is kept.</p>
      </div>
      ${trackPicker()}
      <div class="h3 pad" style="margin:4px 0 8px">Vocal presets</div><div class="vgrid">${grid('preset')}</div>
      <div class="h3 pad" style="margin:14px 0 8px">Effects</div><div class="vgrid">${grid('fx')}</div>
      ${def.params.length?`<div class="card fxp" style="margin:14px 20px 0"><div class="fxp-h"><b>${esc(def.name)}${ST.e.tracks.length>1?' · '+esc(t.name):''}</b><button class="tlink" data-fxreset>Reset</button></div>
        ${def.params.map(q=>`<div class="mixrow"><span class="ml">${esc(q.label)}</span><input type="range" data-fxp="${q.key}" min="${q.min}" max="${q.max}" step="${q.step}" value="${v[q.key]}"><output>${fmtParam(v[q.key],q)}</output></div>`).join('')}</div>`:''}
      <p class="hint pad" style="margin-top:12px">${ST.ctx?'Press play to hear changes as you make them. '+(acousticTake()?'This take has the music in it, so effects and Clean up apply to both. Clean up is set to leave steady music alone, but keep it gentle.':'Effects apply to your voice'+(ST.hasMusic?', not the music.':'.')):'Voice effects need Web Audio, which this device doesn’t support.'}</p>`;
    renderCleanStatus(1);
  } else if(ST.tab==='tracks'){
    renderTracks(p);
  } else if(ST.tab==='mix'){
    const ac_=acousticTake(), lk=leakFound();
    p.innerHTML=`<div class="mixrow">${ic('mic')}<input type="range" id="mxV" min="0" max="150" value="${Math.round(E.vVol*100)}" aria-label="${ac_?'Recording volume':'Vocals volume'}"><output>${Math.round(E.vVol*100)}%</output></div>
      ${ac_&&ST.meta.music?`<div class="setrow" style="padding:10px 20px"><div class="lbl">Add the original track on top<small>Your mic already recorded the music. This adds the clean track too, lined up with what the mic heard, for a fuller sound.</small></div><button class="toggle" role="switch" data-x="addClean" aria-checked="${!!E.addClean}" aria-label="Add the original track on top"></button></div>`:''}
      <div class="mixrow" ${ST.hasMusic?'':'style="opacity:.4"'}>${ic('eighth-notes')}<input type="range" id="mxM" min="0" max="150" value="${Math.round(E.mVol*100)}" ${ST.hasMusic?'':'disabled'} aria-label="Music volume"><output>${ST.hasMusic?Math.round(E.mVol*100)+'%':'—'}</output></div>
      ${ST.hasMusic?`<div class="mixrow">${ic('timer')}<input type="range" id="mxN" min="-500" max="500" step="10" value="${Math.round((E.musicNudge||0)*1000)}" aria-label="Music timing"><output>${(E.musicNudge>0?'+':'')+Math.round((E.musicNudge||0)*1000)} ms</output></div>
      <p class="hint pad">Music timing: if your voice sounds ahead of or behind the beat, nudge the music. ${lk?`Lined up to the music your mic heard (${Math.round(ST.leak.lag*1000)} ms).`:`Already compensated for ${Math.round((ST.meta.musicOffset||0)*1000)} ms of delay.`}</p>`:''}
      <div class="h3" style="margin:14px 20px 8px">Audio sources</div>
      <div class="srcs">${audioSourcesHTML()}</div>
      <p class="hint pad">Per-track volume and pan are in Tracks.</p>`;
  } else {
    const tg=(k,label,sub,dis)=>`<div class="setrow" ${dis?'style="opacity:.4"':''}><div class="lbl">${label}${sub?`<small>${sub}</small>`:''}</div><button class="toggle" role="switch" data-x="${k}" aria-checked="${!!E[k]}" ${dis?'disabled':''} aria-label="${label}"></button></div>`;
    const hasCaps=!!(ST.meta.captions&&ST.meta.captions.length), L=lyrStyle(), on=hasCaps&&E.captions;
    const chips=(key,list,cur,sw)=>`<div class="chips lyr-chips" role="radiogroup">${list.map(([v,l])=>`<button class="chip${sw?' sw':''}" data-lyr="${key}" data-lv="${v}" aria-pressed="${cur===v}" aria-label="${l}" ${sw?`style="--sw:${v}"`:''}>${sw?'<i></i>':''}${sw?'':l}</button>`).join('')}</div>`;
    p.innerHTML=`<div class="h3" style="margin:0 20px 8px">Lyrics on video</div>
      <div class="card lyr-card" style="margin:0 20px">
        ${tg('captions','Show lyrics',hasCaps?'An overlay on top of your take. Hiding it doesn’t change the recording or delete the lyrics.':'Only for karaoke takes',!hasCaps)}
        ${on?`<div class="lyr-body">
          <label class="fld">Size <input type="range" id="lyrSize" min="60" max="160" step="5" value="${Math.round(L.size*100)}" aria-label="Lyric size"><output>${Math.round(L.size*100)}%</output></label>
          <div class="lyr-row"><span>Position</span>${chips('pos',[['0.12','Top'],['0.5','Middle'],['0.84','Bottom']],[0.12,0.5,0.84].find(v=>Math.abs(v-L.y)<0.005)?String([0.12,0.5,0.84].find(v=>Math.abs(v-L.y)<0.005)):'')}</div>
          <p class="hint" style="margin:-2px 0 10px">Or drag the lyrics on the preview. They snap to guides and stay inside safe margins.</p>
          <div class="lyr-row"><span>Colour</span>${chips('color',LYR_COLORS,L.color,true)}</div>
          <div class="lyr-row"><span>Font</span>${chips('font',LYR_FONTS,L.font)}</div>
          <div class="lyr-row"><span>Backing</span>${chips('bg',LYR_BGS,L.bg)}</div>
          <button class="tlink" id="lyrReset">Reset lyric style</button></div>`:''}
      </div>
      <div class="card" style="margin:14px 20px 0">${tg('mirror','Mirror video','Flip left and right')}${tg('vignette','Vignette','Darkens the edges')}${tg('grain','Film grain')}${tg('watermark','Lectern watermark')}</div>`;
  }
}
const fmtParam=(x,q)=>(Math.abs(q.step)<1?(+x).toFixed(1):Math.round(x))+q.unit;

/* ---------- Tracks: layers of clips, a contextual toolbar, trim handles, undo ----------
   A layer is one lane (its own volume, pan, effect, mute, solo). It holds clips: regions
   of a recording placed on the timeline. Tap a clip to select it; a toolbar with the
   common actions appears right under the timeline. Drag a clip to move it, drag its
   edges to trim it. Everything is undoable and nothing changes the original audio. */
const UNDO={past:[],future:[]};
const snapEdit=()=>JSON.stringify({tracks:ST.e.tracks,sel:ST.e.sel,clip:ST.selClip});
function pushUndo(){ UNDO.past.push(snapEdit()); if(UNDO.past.length>60) UNDO.past.shift(); UNDO.future=[]; }
function restoreEdit(json){ const s=JSON.parse(json); ST.e.tracks=s.tracks; ST.e.sel=s.sel; ST.selClip=s.clip; rebuildChains(); restartIfPlaying(); persistEdit(); renderStPanel(); }
function undoEdit(){ if(!UNDO.past.length) return; UNDO.future.push(snapEdit()); restoreEdit(UNDO.past.pop()); toast('Undone'); }
function redoEdit(){ if(!UNDO.future.length) return; UNDO.past.push(snapEdit()); restoreEdit(UNDO.future.pop()); toast('Redone'); }
const selClip=()=>{ const t=selTrack(); return t.clips.find(c=>c.id===ST.selClip)||null; };
const panLbl=v=>Math.abs(v)<0.02?'Centre':(v<0?'L ':'R ')+Math.round(Math.abs(v)*100);
const fmtPos=x=>{ const neg=x<0, a=Math.abs(x), m=Math.floor(a/60), s=a-m*60; return (neg?'−':'')+m+':'+s.toFixed(2).padStart(5,'0'); };
function renderTracks(p){
  const t=selTrack(), c=selClip();
  const tool=(id,icon,label,dis,aria)=>`<button class="tbtn" id="${id}" ${dis?'disabled':''} aria-label="${aria||label}" title="${aria||label}">${ic(icon,'sm')}<span>${label}</span></button>`;
  const multi=t.clips.length>1;
  p.innerHTML=`<div class="lanes-bar"><button class="btn sm white" id="tkRec">${ic('mic','xs')}Record a layer</button><span class="sp"></span>
      <button class="circ sm" id="tkUndo" aria-label="Undo" title="Undo" ${UNDO.past.length?'':'disabled'}>${ic('undo-2','sm')}</button><button class="circ sm" id="tkRedo" aria-label="Redo" title="Redo" ${UNDO.future.length?'':'disabled'}>${ic('redo-2','sm')}</button></div>
    <div class="lanes" id="lanes"><canvas id="lanesCv"></canvas><i class="lanes-head" id="lanesHead"></i></div>
    ${c?`<div class="toolbar" role="toolbar" aria-label="Clip tools">
      ${tool('tkSplit','scissors','Split')}${tool('tkDup','copy','Duplicate')}${tool('tkDel','trash','Delete',!multi&&t.lock,multi?'Delete this clip':'Delete this layer')}${tool('tkVol','volume-2','Volume')}${tool('tkFade','activity','Fade')}${tool('tkMore','ellipsis','More')}</div>
      <div class="tsub" id="tkSub"></div>
      <p class="hint pad sel-info">${esc(t.name)} · clip ${t.clips.indexOf(c)+1} of ${t.clips.length} · starts ${fmtPos(c.at+c.trimIn)}${c.lock?' · stays in sync with the video':' · drag to move'}</p>`
    :`<p class="hint pad sel-info">Tap a clip to edit it. Drag a clip to move it, or drag its edges to trim.</p>`}`;
  drawLanes(); renderSub();
}
let SUB='';
function renderSub(){
  const el=$('#tkSub'); if(!el) return; const t=selTrack(), c=selClip(); if(!c){ el.innerHTML=''; return; }
  if(SUB==='vol') el.innerHTML=`<div class="mixrow"><span class="ml">Layer volume</span><input type="range" data-tk="gain" min="0" max="150" value="${Math.round((t.gain??1)*100)}"><output>${Math.round((t.gain??1)*100)}%</output></div>
    <div class="mixrow"><span class="ml">Pan</span><input type="range" data-tk="pan" min="-100" max="100" value="${Math.round((t.pan||0)*100)}"><output>${panLbl(t.pan||0)}</output></div>`;
  else if(SUB==='fade') el.innerHTML=`<div class="mixrow"><span class="ml">Fade in</span><input type="range" data-ck="fadeIn" min="0" max="3" step="0.05" value="${c.fadeIn||0}"><output>${(c.fadeIn||0).toFixed(2)}s</output></div>
    <div class="mixrow"><span class="ml">Fade out</span><input type="range" data-ck="fadeOut" min="0" max="3" step="0.05" value="${c.fadeOut||0}"><output>${(c.fadeOut||0).toFixed(2)}s</output></div>`;
  else el.innerHTML='';
  $$('.toolbar .tbtn').forEach(b=>b.setAttribute('aria-pressed',String((b.id==='tkVol'&&SUB==='vol')||(b.id==='tkFade'&&SUB==='fade'))));
}
const LANE_H=48, HANDLE=16;
function laneGeom(){ const cv=$('#lanesCv'); return {cv,W:cv.clientWidth||cv.parentElement.clientWidth||360,D:Math.max(ST.dur,1)}; }
function drawLanes(){
  const cv=$('#lanesCv'); if(!cv) return; const tr=ST.e.tracks, W=cv.parentElement.clientWidth||360, H=tr.length*LANE_H+(ST.musicBuf&&ST.hasMusic?30:0)+8, dpr=devicePixelRatio||1;
  cv.width=W*dpr; cv.height=H*dpr; cv.style.width=W+'px'; cv.style.height=H+'px'; const g=cv.getContext('2d'); g.scale(dpr,dpr); g.clearRect(0,0,W,H);
  const D=Math.max(ST.dur,1), x=tt=>tt/D*W; let y=4; const font='600 11px '+uiFont();
  const solo=tr.some(z=>z.solo);
  tr.forEach(t=>{ const selL=t.id===ST.e.sel, dim=(solo&&!t.solo)||t.mute;
    g.fillStyle=selL?'rgba(139,92,246,.08)':'rgba(255,255,255,.025)'; g.fillRect(0,y,W,LANE_H-4);
    t.clips.forEach(c=>{ const sel=selL&&c.id===ST.selClip, b=ST.bufs.get(c.src), {a,b:e}=regionOf(c);
      const x0=x(Math.max(0,a)), x1=x(Math.min(D,e)); g.globalAlpha=dim?.35:1;
      g.fillStyle=sel?'rgba(167,139,250,.45)':'rgba(255,255,255,.14)'; roundRectPath(g,x0,y+3,Math.max(3,x1-x0),LANE_H-10,6); g.fill();
      if(b&&b.raw){ const pk=peaksOf(b.raw), len=b.raw.duration; g.fillStyle=sel?'#F5F3FF':'#9A9AA2'; const mid=y+(LANE_H-4)/2;
        for(let px=Math.floor(x0);px<x1;px++){ const st=(px/W*D-c.at)/len; if(st<0||st>1) continue; const v=pk[Math.min(pk.length-1,Math.floor(st*pk.length))]; const h=Math.max(1,v*(LANE_H-18)); g.fillRect(px,mid-h/2,1,h); } }
      if(c.fadeIn>0){ g.fillStyle='rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(x0,y+3); g.lineTo(x(a+c.fadeIn),y+3); g.lineTo(x0,y+LANE_H-7); g.fill(); }
      if(c.fadeOut>0){ g.fillStyle='rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(x1,y+3); g.lineTo(x(e-c.fadeOut),y+3); g.lineTo(x1,y+LANE_H-7); g.fill(); }
      g.globalAlpha=1;
      if(sel){ g.strokeStyle='#C4B5FD'; g.lineWidth=2; roundRectPath(g,x0+1,y+4,Math.max(2,x1-x0-2),LANE_H-12,6); g.stroke();
        g.fillStyle='#fff'; [x0,x1-6].forEach(hx=>{ roundRectPath(g,hx,y+10,6,LANE_H-24,3); g.fill(); }); }
    });
    g.fillStyle=dim?'rgba(255,255,255,.5)':'#fff'; g.font=font; const lbl=t.name+(t.fx!=='none'?' · '+fxName(t.fx):'')+(t.mute?' · muted':'')+(t.solo?' · solo':''); g.fillText(lbl,6,y+14);
    y+=LANE_H; });
  if(ST.musicBuf&&ST.hasMusic){ const a=musicAt(); g.fillStyle='rgba(251,146,60,.18)'; roundRectPath(g,x(Math.max(0,a)),y+3,W-x(Math.max(0,a)),22,6); g.fill(); g.fillStyle='#FDBA74'; g.font=font; g.fillText('Music',x(Math.max(0,a))+6,y+18); }
  moveLaneHead(stNow());
}
function moveLaneHead(t){ const h=$('#lanesHead'), cv=$('#lanesCv'); if(!h||!cv) return; h.style.transform='translateX('+(t/Math.max(ST.dur,1)*cv.clientWidth).toFixed(1)+'px)'; }
function hitClip(ev){ const {cv,W,D}=laneGeom(), r=cv.getBoundingClientRect(), px=ev.clientX-r.left, py=ev.clientY-r.top;
  const li=Math.floor((py-4)/LANE_H), t=ST.e.tracks[li]; if(!t) return {time:px/W*D};
  for(const c of t.clips){ const {a,b}=regionOf(c), x0=a/D*W, x1=b/D*W; if(px>=x0-HANDLE/2&&px<=x1+HANDLE/2){ const sel=t.id===ST.e.sel&&c.id===ST.selClip; const edge=sel&&px<x0+HANDLE?'in':sel&&px>x1-HANDLE?'out':null; return {t,c,edge,time:px/W*D}; } }
  return {t,time:px/W*D}; }
let LDRAG=null;
$('#stPanel').addEventListener('pointerdown',e=>{ if(!e.target.closest('#lanesCv')) return; const h=hitClip(e);
  if(!h.c){ if(h.t){ ST.e.sel=h.t.id; ST.selClip=h.t.clips[0]&&h.t.clips[0].id; } stSeek(h.time); renderStPanel(); return; }
  if(!(h.t.id===ST.e.sel&&h.c.id===ST.selClip)){ ST.e.sel=h.t.id; ST.selClip=h.c.id; SUB=''; renderStPanel(); }
  LDRAG={t:h.t,c:h.c,edge:h.edge,x0:e.clientX,at0:h.c.at,in0:h.c.trimIn,out0:h.c.trimOut,moved:false,pushed:false}; e.target.setPointerCapture(e.pointerId); });
$('#stPanel').addEventListener('pointermove',e=>{ if(!LDRAG) return; const {W,D}=laneGeom(); const dt=(e.clientX-LDRAG.x0)/W*D; if(Math.abs(e.clientX-LDRAG.x0)<4&&!LDRAG.moved) return;
  const c=LDRAG.c, len=clipLen(c);
  if(!LDRAG.pushed){ pushUndo(); LDRAG.pushed=true; } LDRAG.moved=true;
  if(LDRAG.edge==='in') c.trimIn=+Math.max(0,Math.min(len-c.trimOut-0.15,LDRAG.in0+dt)).toFixed(3);
  else if(LDRAG.edge==='out') c.trimOut=+Math.max(0,Math.min(len-c.trimIn-0.15,LDRAG.out0-dt)).toFixed(3);
  else if(!c.lock) c.at=+(LDRAG.at0+dt).toFixed(3);
  else if(!LDRAG.warned){ LDRAG.warned=true; toast('The main vocal stays in sync with the video. Duplicate it to move a copy.'); }
  drawLanes(); });
$('#stPanel').addEventListener('pointerup',()=>{ if(!LDRAG) return; const d=LDRAG; LDRAG=null; if(d.moved){ restartIfPlaying(); persistEdit(); renderStPanel(); } });

function newTrackId(){ return 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function addLayer(t){ ST.e.tracks.push(t); ST.e.sel=t.id; ST.selClip=t.clips[0]&&t.clips[0].id; ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); persistEdit(); renderStPanel(); }
function dupLayer(){ pushUndo(); const t=selTrack(); const n=JSON.parse(JSON.stringify(t)); n.id=newTrackId(); n.name=t.name.replace(/ copy( \d+)?$/,'')+' copy'; n.solo=false; n.clips.forEach(c=>{ c.id=newTrackId(); c.lock=false; c.at=+(c.at+0.02).toFixed(3); }); addLayer(n); toast('Duplicated as a new layer, 20 ms behind for a natural double'); }
function dupClip(){ const t=selTrack(), c=selClip(); if(!c) return; pushUndo(); const n=JSON.parse(JSON.stringify(c)); n.id=newTrackId(); n.lock=false; const {b}=regionOf(c); n.at=+(b-n.trimIn).toFixed(3); t.clips.push(n); ST.selClip=n.id; restartIfPlaying(); persistEdit(); renderStPanel(); toast('Clip copied right after the original'); }
function splitClip(){ const t=selTrack(), c=selClip(); if(!c) return; const p=stNow(), {a,b}=regionOf(c);
  if(p<=a+0.05||p>=b-0.05){ toast('Move the playhead over the selected clip, then split'); return; }
  pushUndo(); const n=JSON.parse(JSON.stringify(c)); n.id=newTrackId(); n.trimIn=+(p-c.at).toFixed(3); n.fadeIn=0;
  c.trimOut=+(c.at+clipLen(c)-p).toFixed(3); c.fadeOut=0; t.clips.push(n); ST.selClip=n.id; restartIfPlaying(); persistEdit(); renderStPanel(); toast('Split at the playhead. Delete either part to crop it out.'); }
function delSelected(){ const t=selTrack(), c=selClip(); if(!c) return;
  if(t.clips.length>1){ pushUndo(); t.clips=t.clips.filter(x=>x!==c); ST.selClip=t.clips[0].id; restartIfPlaying(); persistEdit(); renderStPanel(); toast('Clip deleted'); return; }
  delLayer(); }
function delLayer(){ const t=selTrack(); if(t.lock){ toast('The main vocal can’t be deleted. Mute it instead.'); return; }
  pushUndo(); ST.e.tracks=ST.e.tracks.filter(x=>x!==t); dropChain(t.id); ST.e.sel=ST.e.tracks[0].id; ST.selClip=ST.e.tracks[0].clips[0]&&ST.e.tracks[0].clips[0].id;
  restartIfPlaying(); persistEdit(); renderStPanel(); toast('Layer deleted'); }
function moreSheet(){
  const t=selTrack(), c=selClip(); if(!c) return;
  const nudges=[-0.1,-0.01,0.01,0.1];
  sheet(`<h3>${esc(t.name)}</h3><p class="sub" style="margin:0 20px 8px">Clip ${t.clips.indexOf(c)+1} of ${t.clips.length}</p>
    <div class="list" style="padding:0 8px">
      <button class="opt" data-m="fx">${ic('audio-waveform','sm')}<span><b>Effect</b><small>${esc(fxName(t.fx))}</small></span></button>
      <button class="opt" data-m="mute">${ic(t.mute?'volume-2':'volume-x','sm')}<span><b>${t.mute?'Unmute layer':'Mute layer'}</b></span></button>
      <button class="opt" data-m="solo">${ic('headphones','sm')}<span><b>${t.solo?'Stop solo':'Solo layer'}</b><small>Hear only this layer</small></span></button>
      <button class="opt" data-m="copy">${ic('copy','sm')}<span><b>Copy clip</b><small>Places a copy right after it, on the same layer</small></span></button>
      <button class="opt" data-m="rename">${ic('pencil','sm')}<span><b>Rename layer</b></span></button>
      ${t.lock?'':`<button class="opt" data-m="dellayer" style="color:var(--hot)">${ic('trash','sm')}<span><b>Delete layer</b><small>Removes every clip on it</small></span></button>`}
    </div>
    ${c.lock?'':`<div class="h3 pad" style="margin:12px 0 6px">Nudge clip</div><div class="nudge pad">${nudges.map(v=>`<button class="btn sm" data-n="${v}">${v>0?'+':'−'}${Math.abs(v)>=0.1?Math.round(Math.abs(v)*1000)+' ms':Math.round(Math.abs(v)*1000)}</button>`).join('')}</div>`}
    <div class="h3 pad" style="margin:12px 0 6px">Trim precisely</div>
    <div class="mixrow"><span class="ml">Start</span><input type="range" data-ck="trimIn" min="0" max="${Math.max(0,clipLen(c)-0.2).toFixed(2)}" step="0.01" value="${c.trimIn}"><output>${c.trimIn.toFixed(2)}s</output></div>
    <div class="mixrow"><span class="ml">End</span><input type="range" data-ck="trimOut" min="0" max="${Math.max(0,clipLen(c)-0.2).toFixed(2)}" step="0.01" value="${c.trimOut}"><output>${c.trimOut.toFixed(2)}s</output></div>`,
  {onMount(el,close){
    el.addEventListener('click',e=>{ const m=e.target.closest('[data-m]'), n=e.target.closest('[data-n]');
      if(n){ pushUndo(); c.at=+(c.at+(+n.dataset.n)).toFixed(3); restartIfPlaying(); persistEdit(); drawLanes(); return; }
      if(!m) return; const k=m.dataset.m; close();
      if(k==='fx'){ ST.tab='voice'; renderStPanel(); }
      else if(k==='mute'||k==='solo'){ pushUndo(); t[k]=!t[k]; restartIfPlaying(); persistEdit(); renderStPanel(); }
      else if(k==='copy') dupClip();
      else if(k==='dellayer') delLayer();
      else if(k==='rename') sheet(`<h3>Rename layer</h3><label class="field"><input id="rnL" value="${esc(t.name)}" maxlength="24"></label><div class="row-btns"><button class="btn white" id="rnOk">Save</button></div>`,{onMount(el2,close2){ el2.querySelector('#rnOk').onclick=()=>{ pushUndo(); t.name=el2.querySelector('#rnL').value.trim()||t.name; persistEdit(); close2(); renderStPanel(); }; }});
    });
    el.addEventListener('pointerdown',e=>{ if(e.target.matches('input[type=range]')) pushUndo(); });
    el.addEventListener('input',e=>{ const r=e.target; if(!r.dataset.ck) return; const k=r.dataset.ck, len=clipLen(c), other=k==='trimIn'?c.trimOut:c.trimIn; let v=Math.min(+r.value,Math.max(0,len-other-0.2)); c[k]=v; r.value=v; r.nextElementSibling.textContent=v.toFixed(2)+'s'; drawLanes(); persistEdit(); });
    el.addEventListener('change',()=>restartIfPlaying());
  },onClose(){ renderStPanel(); }});
}

/* Record a new layer on top of the mix (headphones recommended). The layer is placed
   back by the output + input delay so it lines up with what you heard. */
async function recordLayer(){
  if(ST.overdub){ ST.overdub.stop(); return; }
  if(!ST.draftId){ toast('Save this take as a draft first'); return; }
  await refreshRoute();
  if(ROUTE.output==='speaker'&&!store.get('lectern.layerTip',false)){ store.set('lectern.layerTip',true); toast('Tip: wear headphones so the playback isn’t recorded into the new layer'); }
  let mic; try{ mic=await openMic(); }catch(e){ toast('Microphone unavailable'); return; }
  const mt=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported(x))||'';
  let rec; try{ rec=new MediaRecorder(mic,mt?{mimeType:mt,audioBitsPerSecond:160000}:undefined); }catch(e){ mic.getTracks().forEach(t=>t.stop()); toast('Recording isn’t supported here'); return; }
  const chunks=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size) chunks.push(e.data); };
  const startPos=ST.pos>=ST.dur-0.5?0:ST.pos;
  const inLat=micInLatency(mic);
  stPause(); ST.pos=startPos;
  const btn=$('#tkRec'); const n=ST.e.tracks.filter(t=>t.clips.some(c=>c.src.startsWith('ovd:'))).length+1;
  ST.overdub={stop:()=>{ try{ rec.stop(); }catch(e){} }};
  const done=new Promise(r=>rec.onstop=r);
  rec.start(500); stPlay();
  if(btn){ btn.classList.add('rec'); btn.innerHTML=ic('square','fill xs')+'Stop layer'; }
  const auto=setInterval(()=>{ if(!ST.playing){ clearInterval(auto); ST.overdub&&ST.overdub.stop(); } },200);
  await done; clearInterval(auto); stPause(); mic.getTracks().forEach(t=>t.stop()); releaseMicRoute(); ST.overdub=null;
  const blob=new Blob(chunks,{type:(rec.mimeType||mt||'audio/webm').split(';')[0]});
  try{
    const key=Date.now().toString(36); await idb.putx('draftv:'+ST.draftId+':'+key,blob,'rec');
    const raw=await decodeIn(ST.ctx,blob); ST.bufs.set('ovd:'+key,{raw});
    const lat=outLat()+extraLatency()+inLat;
    pushUndo();
    addLayer({id:newTrackId(),name:'Layer '+n,gain:0.8,pan:0,mute:false,solo:false,fx:'none',fxv:{},clips:[{id:newTrackId(),src:'ovd:'+key,lock:false,at:+(startPos-lat).toFixed(3),trimIn:0,trimOut:0,fadeIn:0.02,fadeOut:0.05}]});
    toast('Layer added and lined up for '+Math.round(lat*1000)+' ms of delay'); if(ST.e.clean||ST.e.enhance) runClean();
  }catch(e){ toast('Couldn’t add that layer'); }
  renderStPanel();
}

/* What is in the file and what the editor plays, so it's clear nothing is heard twice. */
function audioSourcesHTML(){
  const m=ST.meta, E=ST.e, row=(icon,html)=>`<div class="src">${ic(icon,'sm')}<span>${html}</span></div>`;
  const layers=E.tracks.filter(t=>t.clips.some(c=>c.src.startsWith('ovd:'))).length;
  const inFile=m.mixed?'your voice and the music, mixed while recording':acousticTake()?'your microphone: your voice and the music as it sounded in the room':m.mode==='mic'?'your microphone':'the recorded sound';
  const plays=ST.mode==='element'?'the video’s own sound (this device couldn’t decode it separately)':
    ['your '+(acousticTake()?'recording':'voice track')+(m.stem?'':' (from the video)'),ST.hasMusic&&ST.musicBuf?'the clean music'+(leakFound()?', lined up with what the mic heard':''):'',layers?layers+' recorded layer'+(layers>1?'s':''):''].filter(Boolean).join(' + ');
  const proc=[m.mode?RECMODE_LABEL[m.mode]:'',m.nc?'noise cancellation on':m.mode?'noise cancellation off':'',m.aec?'echo cancellation on':m.mode?'echo cancellation off':''].filter(Boolean).join(' · ');
  const dev=m.proc&&(m.proc.ns||m.proc.agc)?' The phone kept its own '+[m.proc.ns&&'noise suppression',m.proc.agc&&'automatic volume'].filter(Boolean).join(' and ')+' on.':'';
  return row('video','<b>In the video file:</b> one audio track with '+inFile+'.')+
    row('play','<b>The editor plays:</b> '+plays+'. The video’s own sound stays muted here, so nothing plays twice. Your export uses the same mix.')+
    (m.health&&(m.health.underrun>0.2||m.health.worst<0.9)?row('info','<b>The audio struggled during this take</b> (about '+m.health.underrun.toFixed(1)+' s of the sound was late). If you hear stutter, record it again: the next take starts on a fresh audio engine.'):'')+
    (m.mixed&&ST.hasMusic&&leakFound()?row('info','<b>Speaker music in the voice track:</b> echo cancellation didn’t fully remove it while recording, so the raw video has the music twice. The editor lines the clean track up with it, and saving rebuilds the video from this single mix.'):'')+
    (proc||dev?row('settings-2','<b>Recorded with:</b> '+(proc||'standard settings')+'.'+dev):'');
}
async function toggleCleanMusic(){
  if(ST.e.addClean&&Math.abs(ST.e.mVol-(ST.meta.musicVol??.8))<0.01) ST.e.mVol=0.5;
  ST.hasMusic=computeHasMusic();
  if(ST.hasMusic&&!ST.musicBuf&&ST.meta.music&&ST.ctx){ try{ ST.musicBuf=await decodeIn(ST.ctx,ST.meta.music); }catch(e){ ST.musicBuf=null; ST.hasMusic=false; toast('Couldn’t load the original track'); } }
  if(ST.hasMusic&&ST.musicBuf&&!ST.leak){ toast('Lining the track up with your recording…'); await measureLeak(); if(!(leakFound())) toast('Couldn’t hear the music clearly in the recording. Use Music timing to line it up.'); }
  applyMix(); restartIfPlaying(); persistEdit(); renderStPanel();
}

/* Lyric style changes apply to the preview at once, are saved with the draft, and become
   the default for the next take. */
function setLyr(patch){ ST.e.lyr={...lyrStyle(),...patch}; S.settings.lyrStyle={...ST.e.lyr}; SAVE.settings(); drawCapLayer(true); persistEdit(); }
{ const prev=$('#stPrev'); let suppress=false;
  prev.addEventListener('pointerdown',e=>{
    if(ST.tab!=='extras'||!ST.e.captions||ST.exporting||!CAPL.box) return;
    const cv=$('#stCap'), r=cv.getBoundingClientRect(), sy=cv.height/r.height, y=(e.clientY-r.top)*sy, x=(e.clientX-r.left)*(cv.width/r.width), b=CAPL.box;
    if(y<b.y0-20||y>b.y1+20||x<b.x0-20||x>b.x1+20) return;
    e.preventDefault(); e.stopPropagation(); suppress=true; CAPL.drag={dy:b.yc-y,h:cv.height,r,sy}; prev.setPointerCapture(e.pointerId); drawCapLayer(true); },true);
  prev.addEventListener('pointermove',e=>{ const d=CAPL.drag; if(!d) return; let yf=((e.clientY-d.r.top)*d.sy+d.dy)/d.h;
    for(const gd of [0.12,0.5,0.84]) if(Math.abs(yf-gd)<0.025) yf=gd; ST.e.lyr={...lyrStyle(),y:Math.max(0.06,Math.min(0.94,+yf.toFixed(3)))}; drawCapLayer(true); });
  const end=()=>{ if(!CAPL.drag) return; CAPL.drag=null; setLyr({}); renderStPanel(); };
  prev.addEventListener('pointerup',end); prev.addEventListener('pointercancel',end);
  prev.addEventListener('click',e=>{ if(suppress){ suppress=false; e.stopPropagation(); e.preventDefault(); } },true); }

/* ---------- Panel events ---------- */
$('.st-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-p]'); if(!b) return; ST.tab=b.dataset.p; renderStPanel(); drawCapLayer(true); });
$('#stPanel').addEventListener('click',e=>{
  const pk=e.target.closest('[data-pick]'); if(pk){ ST.e.sel=pk.dataset.pick; ST.selClip=(selTrack().clips[0]||{}).id; renderStPanel(); return; }
  const f=e.target.closest('[data-f]'); if(f){ ST.e.filter=f.dataset.f; $$('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===f))); applyLook(); persistEdit(); return; }
  const v=e.target.closest('[data-v]'); if(v){ pushUndo(); const t=selTrack(); t.fx=v.dataset.v; t.fxv=fxDefaults(t.fx); dropChain(t.id); if(ST.ctx) ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); if(!ST.playing) stPlay(); persistEdit(); renderStPanel(); return; }
  if(e.target.closest('[data-fxreset]')){ const t=selTrack(); t.fxv=fxDefaults(t.fx); dropChain(t.id); ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); persistEdit(); renderStPanel(); return; }
  const x=e.target.closest('[data-x]'); if(x&&!x.disabled){ const k=x.dataset.x; ST.e[k]=!ST.e[k]; x.setAttribute('aria-checked',String(ST.e[k]));
    if(k==='clean'||k==='enhance'){ rebuildVoiceChain(); if(ST.e[k]) runClean(); renderStPanel(); }
    else if(k==='addClean'){ toggleCleanMusic(); }
    else if(k==='captions'){ S.settings.lyrShow=!!ST.e.captions; SAVE.settings(); applyLook(); renderStPanel(); }
    else applyLook();
    persistEdit(); return; }
  const ly=e.target.closest('[data-lyr]'); if(ly){ const k=ly.dataset.lyr, v=ly.dataset.lv; setLyr(k==='pos'?{y:+v}:{[k]:v}); renderStPanel(); return; }
  if(e.target.closest('#lyrReset')){ ST.e.lyr={...LYR_DEFAULT}; S.settings.lyrStyle={...LYR_DEFAULT}; SAVE.settings(); drawCapLayer(true); persistEdit(); renderStPanel(); return; }
  const btn=e.target.closest('button'); const id=btn&&!btn.disabled&&btn.id;
  if(id==='tkDup') dupLayer(); else if(id==='tkSplit') splitClip(); else if(id==='tkDel') delSelected(); else if(id==='tkRec') recordLayer();
  else if(id==='tkUndo') undoEdit(); else if(id==='tkRedo') redoEdit(); else if(id==='tkMore') moreSheet();
  else if(id==='tkVol'||id==='tkFade'){ const k=id==='tkVol'?'vol':'fade'; SUB=SUB===k?'':k; renderSub(); }
});
// one undo step per slider drag in the clip sub-panel
$('#stPanel').addEventListener('pointerdown',e=>{ if(e.target.matches('#tkSub input[type=range]')) pushUndo(); });
$('#stPanel').addEventListener('input',e=>{ const t=e.target, E=ST.e;
  if(t.id==='mxV'){ E.vVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxM'){ E.mVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxN'){ E.musicNudge=+t.value/1000; t.nextElementSibling.textContent=(E.musicNudge>0?'+':'')+t.value+' ms'; restartIfPlaying(); }
  if(t.id==='stCleanAmt'){ E.cleanAmt=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='lyrSize'){ t.nextElementSibling.textContent=t.value+'%'; setLyr({size:+t.value/100}); return; }
  if(t.id==='stEnhAmt'){ E.enhanceAmt=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.dataset.fxp){ const tr=selTrack(), q=(FXMAP[tr.fx].params||[]).find(z=>z.key===t.dataset.fxp); tr.fxv={...(tr.fxv||{}),[q.key]:+t.value}; t.nextElementSibling.textContent=fmtParam(+t.value,q);
    const ch=ST.chains.get(tr.id); const live=ch&&ch.fx&&ch.fx.set&&!(ch.fx.rebuildOn||[]).includes(q.key); if(live) ch.fx.set(q.key,+t.value); }
  if(t.dataset.tk){ const tr=selTrack(), k=t.dataset.tk, ch=ST.chains.get(tr.id); let val=+t.value;
    if(k==='gain'){ tr.gain=val/100; if(ch) ch.vol.gain.setTargetAtTime(tr.gain,ST.ctx.currentTime,0.02); t.nextElementSibling.textContent=t.value+'%'; }
    if(k==='pan'){ tr.pan=val/100; if(ch&&ch.pan.pan) ch.pan.pan.setTargetAtTime(tr.pan,ST.ctx.currentTime,0.02); t.nextElementSibling.textContent=panLbl(tr.pan); }
  }
  if(t.dataset.ck&&t.closest('#tkSub')){ const c=selClip(); if(c){ c[t.dataset.ck]=+t.value; t.nextElementSibling.textContent=(+t.value).toFixed(2)+'s'; drawLanes(); } }
  applyMix(); persistEdit(); });
$('#stPanel').addEventListener('change',e=>{ const t=e.target;
  if(t.id==='stCleanAmt'||t.id==='stEnhAmt'){ if(t.id==='stEnhAmt') rebuildVoiceChain(); runClean(); }
  if(t.dataset.fxp){ const tr=selTrack(), ch=ST.chains.get(tr.id); if(ch&&ch.fx&&(ch.fx.rebuildOn||[]).includes(t.dataset.fxp)){ dropChain(tr.id); ST.chains.set(tr.id,buildTrackChain(tr)); restartIfPlaying(); } }
  if(t.dataset.ck) restartIfPlaying(); });

// A mixed take whose voice track turned out to contain the speaker music (echo cancellation
// didn't catch it) has the music twice in the raw file, so it's always re-rendered from the
// aligned editor mix rather than shared as recorded.
const needsRender=()=>{ const E=ST.e; if(ST.meta.mixed&&ST.hasMusic&&leakFound()) return true; if((ST.meta.mixed||acousticTake()||ST.meta.mode==='mic')&&isUntouched()) return false; return E.filter!=='none'||E.tracks.length>1||E.tracks.some(t=>t.fx!=='none'||t.gain!==1||t.pan||t.clips.length!==1||t.clips.some(c=>c.fadeIn||c.fadeOut||c.trimIn||c.trimOut))||E.clean||E.enhance||ST.hasMusic||E.mirror||E.vignette||E.grain||E.watermark||(E.captions&&ST.meta.captions&&ST.meta.captions.length)||E.vVol!==1; };
async function stRender(){
  if(!window.MediaRecorder||!stCanvas.captureStream){ toast('This device can’t render video. Saving the original instead.'); return saveRec(ST.blob,true); }
  if(ST.cleaning){ toast('Finishing the clean-up first…'); while(ST.cleaning) await new Promise(r=>setTimeout(r,200)); }
  const okAudio=ensureStudioGraph(); if(ST.ctx) await ST.ctx.resume();
  stPause(); await seekTo(0); drawFrame();
  ST.exporting=true; ST.cancel=false; $('#render').hidden=false; $('#rRing').style.setProperty('--p',0); $('#rPct').textContent='0%';
  const vs=stCanvas.captureStream(30);
  const tracks=[...vs.getVideoTracks(),...(okAudio?ST.recDest.stream.getAudioTracks():[])];
  const m=pickMime(true); let rec;
  try{ rec=new MediaRecorder(new MediaStream(tracks),m?{mimeType:m,videoBitsPerSecond:5000000,audioBitsPerSecond:192000}:undefined); }
  catch(e){ ST.exporting=false; $('#render').hidden=true; toast('Rendering isn’t supported here. Saving the original.'); return saveRec(ST.blob,true); }
  const ch=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size) ch.push(e.data); };
  const stopped=new Promise(r=>rec.onstop=r);
  rec.start(500); stPlay();
  await new Promise(r=>{ const iv=setInterval(()=>{ if(ST.cancel||stNow()>=ST.dur-0.04){ clearInterval(iv); r(); } },100); });
  await new Promise(r=>setTimeout(r,250));
  stPause(); stVideo.playbackRate=1; try{ rec.stop(); }catch(e){} await stopped;
  vs.getTracks().forEach(t=>t.stop());
  ST.exporting=false; $('#render').hidden=true;
  if(ST.cancel){ toast('Render cancelled'); await seekTo(0); ST.pos=0; drawFrame(); return; }
  saveRec(new Blob(ch,{type:(rec.mimeType||m||'video/webm').split(';')[0]}),false);
}
async function saveRec(blob,original){
  const id='rec-'+uid();
  await seekTo(Math.min(0.5,(ST.dur||1)/2)); drawFrame();
  let thumb=''; try{ const c=document.createElement('canvas'); c.width=240; c.height=Math.round(240*stCanvas.height/stCanvas.width); c.getContext('2d').drawImage(stCanvas,0,0,c.width,c.height); thumb=c.toDataURL('image/jpeg',.72); }catch(e){}
  const ok=await idb.put(id,blob,'rec');
  const E=ST.e;
  const r={id,title:ST.meta.title||'Take',itemId:ST.meta.itemId,kind:ST.meta.kind,dur:ST.dur||ST.meta.dur||0,created:Date.now(),thumb,filter:original?'none':E.filter,voice:original?'none':(E.tracks[0]||{}).fx||'none',layers:E.tracks.length,size:blob.size,type:blob.type};
  S.recs.unshift(r); SAVE.recs();
  if(ok&&ST.draftId){ await deleteDraft(ST.draftId); ST.draftId=null; }
  closeStudio(true);
  if(!ok) toast('Saved for this session only. Storage is full or blocked, so download it to keep it.');
  sheet(`<div style="text-align:center;padding:6px 20px 0"><div style="width:120px;margin:4px auto 14px;border-radius:14px;overflow:hidden;aspect-ratio:${stCanvas.width}/${stCanvas.height};background:#000 url('${thumb}') center/cover"></div><h3 style="margin:0">Saved to Recordings</h3><p class="sub" style="margin:6px 0 16px">${fmt(r.dur)} · ${(blob.size/1048576).toFixed(1)} MB${r.filter!=='none'?' · '+FILTERS.find(f=>f.id===r.filter).name:''}${r.voice!=='none'?' · '+fxName(r.voice)+' voice':''}${r.layers>1?' · '+r.layers+' vocal tracks':''}</p></div>
    <div class="row-btns"><button class="btn white" id="svShare">${ic('share-2','sm')}Share</button><button class="btn" id="svDl">${ic('download','sm')}Download</button></div>
    <div class="row-btns"><button class="btn" id="svView">View in library</button><button class="btn" id="svAgain">${ic('rotate-ccw','sm')}Another take</button></div>`,
    {onMount(el,close){ el.querySelector('#svShare').onclick=()=>shareRec(r); el.querySelector('#svDl').onclick=async()=>{ const f=await recFile(r); if(f) downloadFile(f); };
      el.querySelector('#svView').onclick=()=>{ close(); closeStage(); switchTab('library'); openRecs(); };
      el.querySelector('#svAgain').onclick=()=>{ close(); if(stage.hidden) toast('Open something to perform from Explore'); }; }});
}
/* Leaving keeps the draft (unless it was just saved or discarded). */
function closeStudio(quiet){
  stPause(); cancelAnimationFrame(ST.raf); $('#studio').hidden=true; if(stage.hidden) document.body.style.overflow='';
  if(ST.draftId){ SAVE.drafts(); markDraftOpen(ST.draftId,false); }
  stVideo.removeAttribute('src'); try{ stVideo.load(); }catch(e){}
  if(ST.url){ URL.revokeObjectURL(ST.url); ST.url=''; }
  [...ST.chains.keys()].forEach(dropChain); ST.bufs=new Map(); ST.musicBuf=null; VOCAL.cache.clear();
  // back on the stage: bring the camera, lyrics and player back for the next take
  if(!stage.hidden&&stage.dataset.suspended) stageResume();
  else if(!quiet) refresh();
}
function studioLeave(){
  if(ST.exporting) return; stPause();
  if(!ST.draftId){ confirmSheet('Discard this take?','It hasn’t been saved yet.','Discard',()=>closeStudio()); return; }
  sheet(`<h3>Leave the editor?</h3><p class="sub" style="margin:4px 20px 16px">Your take and edits are kept as a draft. Find it in Library → Recordings.</p>
    <div class="row-btns"><button class="btn white" id="lvKeep">${ic('bookmark','sm')}Keep draft</button><button class="btn" id="lvStay">Keep editing</button></div>
    <div class="row-btns"><button class="btn danger" id="lvDel" style="color:var(--hot)">${ic('trash','sm')}${ST.meta.remix?'Discard edits':'Discard take'}</button></div>`,{onMount(el,close){
      el.querySelector('#lvKeep').onclick=()=>{ close(); closeStudio(); toast('Draft saved'); };
      el.querySelector('#lvStay').onclick=()=>close();
      el.querySelector('#lvDel').onclick=()=>{ close(); const id=ST.draftId; ST.draftId=null; closeStudio(); deleteDraft(id); toast(ST.meta.remix?'Edits discarded':'Take discarded'); }; }});
}
$('#stSave').onclick=()=>{ if(ST.exporting) return; needsRender()?stRender():saveRec(ST.blob,true); };
$('#stExport').onclick=()=>{ if(!ST.exporting) stRender(); };
$('#stOriginal').onclick=()=>{ if(!ST.exporting) saveRec(ST.blob,true); };
$('#stClose').onclick=()=>studioLeave();
$('#rCancel').onclick=()=>{ ST.cancel=true; };
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&!$('#studio').hidden){ if(!ST.exporting) stPause(); if(ST.draftId){ ST.draftId&&saveDraftEdit(ST.draftId,{...ST.e}); SAVE.drafts(); } } });
/* True when nothing has been changed from how the take was recorded. */
function isUntouched(){ const E=ST.e, t=E.tracks;
  return E.filter==='none'&&!E.clean&&!E.enhance&&!E.mirror&&!E.vignette&&!E.grain&&E.vVol===1&&Math.abs(E.mVol-(ST.meta.musicVol??.8))<0.01&&!E.musicNudge&&t.length===1&&t[0].fx==='none'&&t[0].gain===1&&!t[0].pan&&t[0].clips.length===1&&!t[0].clips[0].trimIn&&!t[0].clips[0].trimOut&&!t[0].clips[0].fadeIn&&!t[0].clips[0].fadeOut&&!E.captions&&!E.addClean; }
