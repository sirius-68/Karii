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
stVideo.removeAttribute('hidden'); Object.assign(stVideo.style,{position:'fixed',left:'-10000px',top:'0',width:'4px',height:'4px',opacity:'0',pointerEvents:'none'});
stVideo.playsInline=true; stVideo.muted=true;

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
const EDIT_DEFAULT={filter:'none',vVol:1,mVol:.8,mirror:false,vignette:false,grain:false,captions:true,watermark:true,clean:true,cleanAmt:.5,enhance:true,enhanceAmt:.5,musicNudge:0,tracks:null,sel:'main'};
const mainTrack=fx=>({id:'main',name:'Main vocal',src:'take',lock:true,at:0,trimIn:0,trimOut:0,gain:1,pan:0,mute:false,solo:false,fadeIn:0,fadeOut:0,fx:fx||'none',fxv:fxDefaults(fx||'none')});
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
  const c=ST.ctx, nodes=[], srcs=[]; const sb=ST.bufs.get(t.src)||{};
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
const musicAt=()=>(ST.meta&&ST.meta.musicOffset||0)+(ST.e.musicNudge||0);
function stNow(){ return ST.playing?Math.min(ST.dur,ST.pos+(ST.ctx.currentTime-ST.startCtx)):ST.pos; }
function bufFor(t){ const b=ST.bufs.get(t.src); if(!b) return null; return (ST.e.clean&&b.clean)?b.clean:b.raw; }
const trackLen=t=>{ const b=ST.bufs.get(t.src); return b&&b.raw?b.raw.duration:0; };
const regionOf=t=>({a:t.at+t.trimIn, b:t.at+trackLen(t)-t.trimOut});
function audible(){ const tr=ST.e.tracks||[]; const solo=tr.some(t=>t.solo); return tr.filter(t=>solo?t.solo:!t.mute); }
function startSources(at){
  const c=ST.ctx, when=c.currentTime+0.05; ST.startCtx=when; ST.pos=at; ST.srcs=[];
  if(ST.mode==='buffer') audible().forEach(t=>{
    const buf=bufFor(t), ch=ST.chains.get(t.id); if(!buf||!ch) return;
    const {a,b}=regionOf(t); if(b<=a||at>=b) return;
    const startTl=Math.max(at,a), wait=startTl-at, off=t.trimIn+(startTl-a), dur=b-startTl;
    const s=c.createBufferSource(); s.buffer=buf; s.connect(ch.input); s.start(when+wait,off,dur); ST.srcs.push(s);
    // fades on the timeline
    const g=ch.fade.gain, tl2c=x=>when+(x-at); g.cancelScheduledValues(0);
    const valAt=x=>{ let v=1; if(t.fadeIn>0) v=Math.min(v,clamp01((x-a)/t.fadeIn)); if(t.fadeOut>0) v=Math.min(v,clamp01((b-x)/t.fadeOut)); return v; };
    g.setValueAtTime(valAt(startTl),tl2c(startTl));
    if(t.fadeIn>0&&a+t.fadeIn>startTl) g.linearRampToValueAtTime(1,tl2c(a+t.fadeIn));
    if(t.fadeOut>0){ const fo=Math.max(startTl,b-t.fadeOut); g.setValueAtTime(valAt(fo),tl2c(fo)); g.linearRampToValueAtTime(0,tl2c(b)); }
  });
  if(ST.musicBuf){ const m=c.createBufferSource(); m.buffer=ST.musicBuf; m.loop=!!(ST.meta&&ST.meta.loop); m.connect(ST.musicGain);
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
function stPause(){ if(ST.playing){ ST.pos=stNow(); } ST.playing=false; stopSources(); stVideo.pause(); $('#stPrev').classList.remove('playing'); drawFrame(); }
function stSeek(t){ const was=ST.playing; if(was){ stopSources(); ST.playing=false; } ST.pos=Math.max(0,Math.min(ST.dur,t)); try{ stVideo.currentTime=ST.pos; }catch(e){} if(was) stPlay(); else drawFrame(); }
function restartIfPlaying(){ if(ST.playing){ const t=stNow(); stopSources(); startSources(t); } }
function seekTo(t){ return new Promise(r=>{ let d=false; const fin=()=>{ if(d) return; d=true; stVideo.removeEventListener('seeked',fin); r(); }; stVideo.addEventListener('seeked',fin); ST.pos=t; try{ stVideo.currentTime=t; }catch(e){ fin(); } setTimeout(fin,1500); }); }
function applyMix(){ if(!ST.ctx) return; const t=ST.ctx.currentTime; ST.voiceGain.gain.setTargetAtTime(ST.e.vVol,t,0.02); ST.musicGain.gain.setTargetAtTime(ST.hasMusic?ST.e.mVol:0,t,0.02); }
/* ---------- Open, prepare, persist ---------- */
async function openStudio(blob,meta,opts={}){
  ST.blob=blob; ST.meta={...meta,loop:meta.loop??(meta.kind!=='song')}; ST.draftId=opts.draftId||null;
  const ed=opts.edit||{};
  ST.e={...EDIT_DEFAULT,mVol:meta.musicVol??.8,captions:!!(meta.captions&&meta.captions.length),...ed};
  if(!Array.isArray(ST.e.tracks)||!ST.e.tracks.length) ST.e.tracks=[mainTrack(ed.voice)];
  if(!trackById(ST.e.sel)) ST.e.sel=ST.e.tracks[0].id;
  ST.tab=opts.edit?ST.tab:'voice'; ST.cancel=false; ST.thumbFrame=null; ST.pos=0; ST.playing=false;
  ST.bufs=new Map(); ST.musicBuf=null; ST.mode='buffer'; [...ST.chains.keys()].forEach(dropChain);
  if(!ST.draftId&&meta.remix){ const d=await createDraft(blob,meta,meta.music||null); ST.draftId=d.id; }
  if(ST.draftId) markDraftOpen(ST.draftId,true);
  if(ST.url) URL.revokeObjectURL(ST.url);
  ST.url=URL.createObjectURL(blob); stVideo.src=ST.url; stVideo.muted=true;
  ST.hasMusic=!!meta.music;
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
  renderStPanel(); stLoop();
  if(ST.ctx){
    try{ const raw=await decodeIn(ST.ctx,blob); if(raw.duration<0.3) throw new Error('no audio'); ST.bufs.set('take',{raw}); if(!ST.dur||!isFinite(ST.dur)) ST.dur=raw.duration; }
    catch(e){ ST.mode='element'; try{ ST.elemSrc=ST.elemSrc||ST.ctx.createMediaElementSource(stVideo); ST.elemIn=true; stVideo.muted=false; }catch(_){} }
    // recorded layers
    for(const t of ST.e.tracks){ if(t.src.startsWith('ovd:')&&!ST.bufs.has(t.src)&&ST.draftId){ const b=await idb.get('draftv:'+ST.draftId+':'+t.src.slice(4),'rec'); if(b){ try{ ST.bufs.set(t.src,{raw:await decodeIn(ST.ctx,b)}); }catch(e){} } } }
    if(meta.music){ try{ ST.musicBuf=await decodeIn(ST.ctx,meta.music); }catch(e){ ST.musicBuf=null; ST.hasMusic=false; } }
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
  const caps=ST.meta&&ST.meta.captions;
  if(ST.e.captions&&caps&&caps.length){
    const t=stNow(); let i=-1; for(let k=0;k<caps.length;k++){ if(caps[k].t<=t) i=k; else break; }
    if(i>=0 && t<(caps[i+1]?caps[i+1].t:caps[i].e+2)){
      const c=caps[i], fs=Math.round(Math.min(w,h)*.055);
      let f=clamp01((t-c.t)/Math.max(.3,c.e-c.t));
      if(c.w&&c.w.length){ const ws=c.text.split(/\s+/).filter(Boolean); if(ws.length===c.w.length){ const L=ws.reduce((a,x)=>a+x.length+1,0); let acc=0; ws.forEach((x,k)=>{ acc+=(x.length+1)*clamp01((t-c.w[k].s)/Math.max(.05,c.w[k].e-c.w[k].s)); }); f=acc/L; } }
      g.font=`700 ${fs}px ${getComputedStyle(document.body).fontFamily}`; g.textAlign='center'; g.textBaseline='middle';
      const lines=wrapText(g,c.text,w*.84), lh=fs*1.25, total=lines.length*lh, y0=h*.86-total/2;
      const bw=Math.min(w*.92,Math.max(...lines.map(l=>g.measureText(l).width))+fs*1.2);
      g.fillStyle='rgba(0,0,0,.5)'; roundRectPath(g,(w-bw)/2,y0-fs*.45,bw,total+fs*.3,fs*.5); g.fill();
      const allW=lines.reduce((a,l)=>a+g.measureText(l).width,0); let done=f*allW;
      lines.forEach((l,j)=>{ const y=y0+j*lh+lh/2-fs*.1, lw=g.measureText(l).width, x0=w/2-lw/2;
        g.fillStyle='rgba(255,255,255,.55)'; g.fillText(l,w/2,y);
        const p=Math.max(0,Math.min(lw,done)); done-=lw;
        if(p>0){ g.save(); g.beginPath(); g.rect(x0,y-fs,p,fs*2); g.clip(); g.fillStyle='#fff'; g.fillText(l,w/2,y); g.restore(); } });
    }
  }
  if(ST.e.watermark){ const fs=Math.round(Math.min(w,h)*.028); g.font=`600 ${fs}px ${getComputedStyle(document.body).fontFamily}`; g.textAlign='right'; g.textBaseline='bottom'; g.fillStyle='rgba(255,255,255,.75)'; g.shadowColor='rgba(0,0,0,.5)'; g.shadowBlur=6; g.fillText('● Lectern',w-fs*1.1,h-fs*1.1); g.shadowBlur=0; }
}
function wrapText(g,text,maxW){ const words=text.split(/\s+/), out=[]; let line=''; words.forEach(wd=>{ const t=line?line+' '+wd:wd; if(g.measureText(t).width>maxW&&line){ out.push(line); line=wd; } else line=t; }); if(line) out.push(line); return out.slice(0,3); }
function roundRectPath(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
function stLoop(){
  cancelAnimationFrame(ST.raf);
  const step=()=>{ if($('#studio').hidden&&!ST.exporting) return;
    const t=stNow();
    if(ST.playing){
      if(t>=ST.dur-0.03){ if(ST.exporting){ ST.pos=ST.dur; } else { stPause(); ST.pos=0; try{ stVideo.currentTime=0; }catch(e){} } }
      // video follows the audio clock
      else if(ST.mode==='buffer'&&Math.abs(stVideo.currentTime-t)>0.12){ try{ stVideo.currentTime=t; }catch(e){} }
      drawFrame(); if(ST.tab==='tracks') drawLanes();
    }
    $('#stNow').textContent=fmt(t); if(!ST.seeking) $('#stSeek').value=t;
    if(ST.exporting){ const p=Math.round(clamp01(t/(ST.dur||1))*100); $('#rRing').style.setProperty('--p',p); $('#rPct').textContent=p+'%'; }
    ST.raf=requestAnimationFrame(step); };
  ST.raf=requestAnimationFrame(step);
}
stVideo.addEventListener('seeked',()=>{ if(!ST.playing) drawFrame(); });
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
      <p class="hint pad" style="margin-top:12px">${ST.ctx?'Press play to hear changes as you make them. Effects apply to your voice'+(ST.hasMusic?', not the music.':'.'):'Voice effects need Web Audio, which this device doesn’t support.'}</p>`;
    renderCleanStatus(1);
  } else if(ST.tab==='tracks'){
    renderTracks(p);
  } else if(ST.tab==='mix'){
    p.innerHTML=`<div class="mixrow">${ic('mic')}<input type="range" id="mxV" min="0" max="150" value="${Math.round(E.vVol*100)}" aria-label="Vocals volume"><output>${Math.round(E.vVol*100)}%</output></div>
      <div class="mixrow" ${ST.hasMusic?'':'style="opacity:.4"'}>${ic('eighth-notes')}<input type="range" id="mxM" min="0" max="150" value="${Math.round(E.mVol*100)}" ${ST.hasMusic?'':'disabled'} aria-label="Music volume"><output>${ST.hasMusic?Math.round(E.mVol*100)+'%':'—'}</output></div>
      ${ST.hasMusic?`<div class="mixrow">${ic('timer')}<input type="range" id="mxN" min="-500" max="500" step="10" value="${Math.round((E.musicNudge||0)*1000)}" aria-label="Music timing"><output>${(E.musicNudge>0?'+':'')+Math.round((E.musicNudge||0)*1000)} ms</output></div>
      <p class="hint pad">Music timing: if your voice sounds ahead of or behind the beat, nudge the music until they line up. Already compensated for ${Math.round((ST.meta.musicOffset||0)*1000)} ms of headphone delay.</p>`:''}
      <p class="hint pad">${ST.hasMusic?'Music is mixed in clean from the original track, so it sounds better than what your mic picked up.':'No music in this take. Add a music bed in Tune before recording, or sing a karaoke song.'} Per-track volume and pan are in Tracks.</p>`;
  } else {
    const tg=(k,label,sub,dis)=>`<div class="setrow" ${dis?'style="opacity:.4"':''}><div class="lbl">${label}${sub?`<small>${sub}</small>`:''}</div><button class="toggle" role="switch" data-x="${k}" aria-checked="${!!E[k]}" ${dis?'disabled':''} aria-label="${label}"></button></div>`;
    p.innerHTML=`<div class="card" style="margin:0 20px">${tg('captions','Lyric captions','Burns the karaoke line into the video',!(ST.meta.captions&&ST.meta.captions.length))}${tg('mirror','Mirror video','Flip left and right')}${tg('vignette','Vignette','Darkens the edges')}${tg('grain','Film grain')}${tg('watermark','Lectern watermark')}</div>`;
  }
}
const fmtParam=(x,q)=>(Math.abs(q.step)<1?(+x).toFixed(1):Math.round(x))+q.unit;

/* ---------- Tracks: lanes, selection and per-track tools ---------- */
function renderTracks(p){
  const tr=ST.e.tracks, t=selTrack(), len=trackLen(t), r=regionOf(t);
  p.innerHTML=`<div class="lanes" id="lanes"><canvas id="lanesCv"></canvas></div>
    <div class="trk-add"><button class="btn sm" id="tkDup">${ic('copy','xs')}Duplicate</button><button class="btn sm" id="tkSplit">${ic('scissors','xs')}Split at playhead</button><button class="btn sm white" id="tkRec">${ic('mic','xs')}Record a layer</button></div>
    <div class="card trk" style="margin:12px 20px 0">
      <div class="trk-h"><input class="trk-name" id="tkName" value="${esc(t.name)}" maxlength="24" aria-label="Track name">
        <button class="chip" id="tkMute" aria-pressed="${!!t.mute}">${ic(t.mute?'volume-x':'volume-2','xs')}Mute</button><button class="chip" id="tkSolo" aria-pressed="${!!t.solo}">${ic('headphones','xs')}Solo</button>
        ${t.lock?'':`<button class="circ sm" id="tkDel" aria-label="Delete track">${ic('trash','xs')}</button>`}</div>
      <div class="mixrow"><span class="ml">Volume</span><input type="range" data-tk="gain" min="0" max="150" value="${Math.round((t.gain??1)*100)}"><output>${Math.round((t.gain??1)*100)}%</output></div>
      <div class="mixrow"><span class="ml">Pan</span><input type="range" data-tk="pan" min="-100" max="100" value="${Math.round((t.pan||0)*100)}"><output>${panLbl(t.pan||0)}</output></div>
      <div class="mixrow"><span class="ml">Fade in</span><input type="range" data-tk="fadeIn" min="0" max="3" step="0.05" value="${t.fadeIn||0}"><output>${(t.fadeIn||0).toFixed(2)}s</output></div>
      <div class="mixrow"><span class="ml">Fade out</span><input type="range" data-tk="fadeOut" min="0" max="3" step="0.05" value="${t.fadeOut||0}"><output>${(t.fadeOut||0).toFixed(2)}s</output></div>
      <div class="mixrow"><span class="ml">Trim start</span><input type="range" data-tk="trimIn" min="0" max="${Math.max(0,len-0.2).toFixed(2)}" step="0.01" value="${t.trimIn}"><output>${t.trimIn.toFixed(2)}s</output></div>
      <div class="mixrow"><span class="ml">Trim end</span><input type="range" data-tk="trimOut" min="0" max="${Math.max(0,len-0.2).toFixed(2)}" step="0.01" value="${t.trimOut}"><output>${t.trimOut.toFixed(2)}s</output></div>
      ${t.lock?`<p class="hint" style="margin:6px 2px 4px">The main vocal stays in sync with the video. Duplicate it to move a copy.</p>`:`<div class="nudge"><span class="ml">Position <b>${fmtPos(t.at+t.trimIn)}</b></span><button class="btn sm" data-nudge="-0.1">−100ms</button><button class="btn sm" data-nudge="-0.01">−10</button><button class="btn sm" data-nudge="0.01">+10</button><button class="btn sm" data-nudge="0.1">+100ms</button></div>`}
      <button class="setrow" id="tkFx" style="padding-left:0;padding-right:0"><div class="lbl">Effect<small>${esc(fxName(t.fx))}</small></div>${ic('chevron-right','sm')}</button>
    </div>
    <p class="hint pad" style="margin-top:10px">Tap a lane to select it. Drag a layer to move it. Edits never change your original recording.</p>`;
  drawLanes();
}
const panLbl=v=>Math.abs(v)<0.02?'Centre':(v<0?'L ':'R ')+Math.round(Math.abs(v)*100);
const fmtPos=x=>{ const neg=x<0, a=Math.abs(x), m=Math.floor(a/60), s=a-m*60; return (neg?'−':'')+m+':'+s.toFixed(2).padStart(5,'0'); };
const LANE_H=44;
function drawLanes(){
  const cv=$('#lanesCv'); if(!cv) return; const tr=ST.e.tracks, W=cv.parentElement.clientWidth||360, H=tr.length*LANE_H+(ST.musicBuf?30:0)+8, dpr=devicePixelRatio||1;
  cv.width=W*dpr; cv.height=H*dpr; cv.style.width=W+'px'; cv.style.height=H+'px'; const g=cv.getContext('2d'); g.scale(dpr,dpr); g.clearRect(0,0,W,H);
  const D=Math.max(ST.dur,1), x=tt=>tt/D*W; let y=4;
  tr.forEach((t,i)=>{ const sel=t.id===ST.e.sel, b=ST.bufs.get(t.src), {a,b:e}=regionOf(t), dim=(tr.some(z=>z.solo)&&!t.solo)||t.mute;
    g.fillStyle=sel?'rgba(139,92,246,.10)':'rgba(255,255,255,.03)'; g.fillRect(0,y,W,LANE_H-4);
    const x0=x(Math.max(0,a)), x1=x(Math.min(D,e)); g.globalAlpha=dim?.35:1;
    g.fillStyle=sel?'rgba(167,139,250,.38)':'rgba(255,255,255,.14)'; roundRectPath(g,x0,y+3,Math.max(2,x1-x0),LANE_H-10,6); g.fill();
    if(b&&b.raw){ const pk=peaksOf(b.raw), len=b.raw.duration; g.fillStyle=sel?'#E9D5FF':'#9A9AA2'; const mid=y+(LANE_H-4)/2;
      for(let px=Math.floor(x0);px<x1;px++){ const st=(px/W*D-t.at)/len; if(st<0||st>1) continue; const v=pk[Math.min(pk.length-1,Math.floor(st*pk.length))]; const h=Math.max(1,v*(LANE_H-16)); g.fillRect(px,mid-h/2,1,h); } }
    g.globalAlpha=1; g.fillStyle='#fff'; g.font='600 11px '+getComputedStyle(document.body).fontFamily; g.fillText(t.name+(t.fx!=='none'?' · '+fxName(t.fx):''),Math.max(6,x0+6),y+14);
    y+=LANE_H; });
  if(ST.musicBuf){ const a=musicAt(); g.fillStyle='rgba(251,146,60,.18)'; roundRectPath(g,x(Math.max(0,a)),y+3,W-x(Math.max(0,a)),22,6); g.fill(); g.fillStyle='#FDBA74'; g.font='600 11px '+getComputedStyle(document.body).fontFamily; g.fillText('Music',x(Math.max(0,a))+6,y+18); }
  g.fillStyle='#fff'; g.fillRect(x(stNow()),0,1.5,H);
}
function laneAt(ev){ const cv=$('#lanesCv'), r=cv.getBoundingClientRect(); const i=Math.floor((ev.clientY-r.top-4)/LANE_H); return {t:ST.e.tracks[i]||null,time:(ev.clientX-r.left)/r.width*Math.max(ST.dur,1)}; }
let LDRAG=null;
$('#stPanel').addEventListener('pointerdown',e=>{ if(!e.target.closest('#lanesCv')) return; const {t,time}=laneAt(e); if(!t) return; ST.e.sel=t.id; LDRAG={t,x0:e.clientX,at0:t.at,moved:false,time}; e.target.setPointerCapture(e.pointerId); drawLanes(); });
$('#stPanel').addEventListener('pointermove',e=>{ if(!LDRAG||LDRAG.t.lock) return; const cv=$('#lanesCv'); const dx=(e.clientX-LDRAG.x0)/cv.getBoundingClientRect().width*Math.max(ST.dur,1); if(Math.abs(e.clientX-LDRAG.x0)>4) LDRAG.moved=true; if(LDRAG.moved){ LDRAG.t.at=+(LDRAG.at0+dx).toFixed(3); drawLanes(); } });
$('#stPanel').addEventListener('pointerup',e=>{ if(!LDRAG) return; const d=LDRAG; LDRAG=null; if(d.moved){ restartIfPlaying(); persistEdit(); } else if(!d.t.lock||true){ /* tap selects; tapping empty space seeks */ } renderStPanel(); });

function newTrackId(){ return 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,5); }
function addTrack(t){ ST.e.tracks.push(t); ST.e.sel=t.id; ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); persistEdit(); renderStPanel(); }
function dupTrack(){ const t=selTrack(); const n=JSON.parse(JSON.stringify(t)); n.id=newTrackId(); n.lock=false; n.name=(t.name.replace(/ \(copy\d*\)$/,''))+' copy'; n.at=t.at+0.02; addTrack(n); toast('Duplicated. It’s 20 ms behind for a natural double; move it or change its effect.'); }
function splitTrack(){ const t=selTrack(), p=stNow(), {a,b}=regionOf(t); if(p<=a+0.05||p>=b-0.05){ toast('Move the playhead inside the selected track to split it'); return; }
  const n=JSON.parse(JSON.stringify(t)); n.id=newTrackId(); n.lock=false; n.name=t.name.replace(/ \(part \d+\)$/,'')+' (part 2)'; n.trimIn=+(p-t.at).toFixed(3); n.fadeIn=0;
  t.trimOut=+(t.at+trackLen(t)-p).toFixed(3); t.fadeOut=0; addTrack(n); toast('Split into two parts'); }
async function delTrack(){ const t=selTrack(); if(t.lock) return; ST.e.tracks=ST.e.tracks.filter(x=>x!==t); dropChain(t.id); ST.e.sel=ST.e.tracks[0].id;
  if(t.src.startsWith('ovd:')&&!ST.e.tracks.some(x=>x.src===t.src)&&ST.draftId){ idb.del('draftv:'+ST.draftId+':'+t.src.slice(4),'rec'); ST.bufs.delete(t.src); }
  restartIfPlaying(); persistEdit(); renderStPanel(); }

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
  const inLat=(mic.getAudioTracks()[0].getSettings().latency)||0.03;
  stPause(); ST.pos=startPos;
  const btn=$('#tkRec'); const n=ST.e.tracks.filter(t=>t.src.startsWith('ovd:')).length+1;
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
    addTrack({id:newTrackId(),name:'Layer '+n,src:'ovd:'+key,lock:false,at:+(startPos-lat).toFixed(3),trimIn:0,trimOut:0,gain:0.8,pan:0,mute:false,solo:false,fadeIn:0.02,fadeOut:0.05,fx:'none',fxv:{}});
    toast('Layer added and lined up for '+Math.round(lat*1000)+' ms of delay'); if(ST.e.clean||ST.e.enhance) runClean();
  }catch(e){ toast('Couldn’t add that layer'); }
  renderStPanel();
}

/* ---------- Panel events ---------- */
$('.st-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-p]'); if(!b) return; ST.tab=b.dataset.p; renderStPanel(); });
$('#stPanel').addEventListener('click',e=>{
  const pk=e.target.closest('[data-pick]'); if(pk){ ST.e.sel=pk.dataset.pick; renderStPanel(); return; }
  const f=e.target.closest('[data-f]'); if(f){ ST.e.filter=f.dataset.f; $$('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===f))); drawFrame(); persistEdit(); return; }
  const v=e.target.closest('[data-v]'); if(v){ const t=selTrack(); t.fx=v.dataset.v; t.fxv=fxDefaults(t.fx); dropChain(t.id); if(ST.ctx) ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); if(!ST.playing) stPlay(); persistEdit(); renderStPanel(); return; }
  if(e.target.closest('[data-fxreset]')){ const t=selTrack(); t.fxv=fxDefaults(t.fx); dropChain(t.id); ST.chains.set(t.id,buildTrackChain(t)); restartIfPlaying(); persistEdit(); renderStPanel(); return; }
  const x=e.target.closest('[data-x]'); if(x&&!x.disabled){ const k=x.dataset.x; ST.e[k]=!ST.e[k]; x.setAttribute('aria-checked',String(ST.e[k]));
    if(k==='clean'||k==='enhance'){ rebuildVoiceChain(); if(ST.e[k]) runClean(); renderStPanel(); } else drawFrame();
    persistEdit(); return; }
  const nd=e.target.closest('[data-nudge]'); if(nd){ const t=selTrack(); if(t.lock) return; t.at=+(t.at+(+nd.dataset.nudge)).toFixed(3); restartIfPlaying(); persistEdit(); renderStPanel(); return; }
  const id=e.target.closest('button')&&e.target.closest('button').id;
  if(id==='tkDup') dupTrack(); else if(id==='tkSplit') splitTrack(); else if(id==='tkDel') delTrack(); else if(id==='tkRec') recordLayer();
  else if(id==='tkMute'||id==='tkSolo'){ const t=selTrack(), k=id==='tkMute'?'mute':'solo'; t[k]=!t[k]; restartIfPlaying(); persistEdit(); renderStPanel(); }
  else if(id==='tkFx'){ ST.tab='voice'; renderStPanel(); }
});
$('#stPanel').addEventListener('input',e=>{ const t=e.target, E=ST.e;
  if(t.id==='mxV'){ E.vVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxM'){ E.mVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxN'){ E.musicNudge=+t.value/1000; t.nextElementSibling.textContent=(E.musicNudge>0?'+':'')+t.value+' ms'; restartIfPlaying(); }
  if(t.id==='stCleanAmt'){ E.cleanAmt=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='stEnhAmt'){ E.enhanceAmt=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.dataset.fxp){ const tr=selTrack(), q=(FXMAP[tr.fx].params||[]).find(z=>z.key===t.dataset.fxp); tr.fxv={...(tr.fxv||{}),[q.key]:+t.value}; t.nextElementSibling.textContent=fmtParam(+t.value,q);
    const ch=ST.chains.get(tr.id); const live=ch&&ch.fx&&ch.fx.set&&!(ch.fx.rebuildOn||[]).includes(q.key); if(live) ch.fx.set(q.key,+t.value); }
  if(t.dataset.tk){ const tr=selTrack(), k=t.dataset.tk, ch=ST.chains.get(tr.id); let val=+t.value;
    if(k==='gain'){ tr.gain=val/100; if(ch) ch.vol.gain.setTargetAtTime(tr.gain,ST.ctx.currentTime,0.02); t.nextElementSibling.textContent=t.value+'%'; }
    if(k==='pan'){ tr.pan=val/100; if(ch&&ch.pan.pan) ch.pan.pan.setTargetAtTime(tr.pan,ST.ctx.currentTime,0.02); t.nextElementSibling.textContent=panLbl(tr.pan); }
    if(k==='fadeIn'||k==='fadeOut'){ tr[k]=val; t.nextElementSibling.textContent=val.toFixed(2)+'s'; }
    if(k==='trimIn'||k==='trimOut'){ const len=trackLen(tr), other=k==='trimIn'?tr.trimOut:tr.trimIn; val=Math.min(val,Math.max(0,len-other-0.2)); tr[k]=val; t.value=val; t.nextElementSibling.textContent=val.toFixed(2)+'s'; drawLanes(); } }
  if(t.id==='tkName'){ selTrack().name=t.value.trim()||'Track'; }
  applyMix(); persistEdit(); });
$('#stPanel').addEventListener('change',e=>{ const t=e.target;
  if(t.id==='stCleanAmt'||t.id==='stEnhAmt'){ if(t.id==='stEnhAmt') rebuildVoiceChain(); runClean(); }
  if(t.dataset.fxp){ const tr=selTrack(), ch=ST.chains.get(tr.id); if(ch&&ch.fx&&(ch.fx.rebuildOn||[]).includes(t.dataset.fxp)){ dropChain(tr.id); ST.chains.set(tr.id,buildTrackChain(tr)); restartIfPlaying(); } }
  if(t.dataset.tk&&/fade|trim/.test(t.dataset.tk)) restartIfPlaying();
  if(t.id==='tkName') renderStPanel(); });

const needsRender=()=>{ const E=ST.e; return E.filter!=='none'||E.tracks.length>1||E.tracks.some(t=>t.fx!=='none'||t.gain!==1||t.pan||t.fadeIn||t.fadeOut||t.trimIn||t.trimOut)||E.clean||E.enhance||ST.hasMusic||E.mirror||E.vignette||E.grain||E.watermark||(E.captions&&ST.meta.captions&&ST.meta.captions.length)||E.vVol!==1; };
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
  stPause(); try{ rec.stop(); }catch(e){} await stopped;
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
  if(!quiet) refresh();
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
