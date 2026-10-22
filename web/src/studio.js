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

/* ---------------------------------------------------------------------
   Take editor engine
   Audio is the master clock: the voice and the clean music are decoded into
   buffers and scheduled on one AudioContext; the (muted) video follows.
   Everything is non-destructive — the original take is never changed; the
   edit is a small settings object that is saved to the draft as you go.
   --------------------------------------------------------------------- */
const EDIT_DEFAULT={filter:'none',voice:'none',vVol:1,mVol:.8,mirror:false,vignette:false,grain:false,captions:true,watermark:true,clean:true,cleanAmt:.5,musicNudge:0};
const ST={blob:null,meta:null,url:'',draftId:null,tab:'voice',e:{...EDIT_DEFAULT},
  ctx:null,mode:'buffer',voiceRaw:null,voiceClean:null,cleanStats:null,musicBuf:null,
  vIn:null,voiceGain:null,musicGain:null,master:null,recDest:null,chain:null,fx:null,
  srcs:[],playing:false,pos:0,startCtx:0,raf:0,exporting:false,cancel:false,dur:0,hasMusic:false,thumbFrame:null,cleaning:false,elemSrc:null};
AUDIO.register('studio',{label:()=>ST.meta?ST.meta.title:'Take',sub:'Take editor preview',icon:'video',playing:()=>ST.playing,stop:()=>stPause(),here:()=>!$('#studio').hidden});

function ensureStudioGraph(){
  if(ST.ctx) return true; const C=window.AudioContext||window.webkitAudioContext; if(!C) return false;
  try{ const c=new C({latencyHint:'playback'}); ST.ctx=c;
    ST.vIn=c.createGain(); ST.voiceGain=c.createGain(); ST.musicGain=c.createGain(); ST.master=c.createGain(); ST.recDest=c.createMediaStreamDestination();
    ST.voiceGain.connect(ST.master); ST.musicGain.connect(ST.master); ST.master.connect(c.destination); ST.master.connect(ST.recDest);
    rebuildVoiceChain(); return true;
  }catch(e){ ST.ctx=null; return false; }
}
function decodeIn(ctx,blob){ return blob.arrayBuffer().then(ab=>new Promise((res,rej)=>{ try{ const p=ctx.decodeAudioData(ab,res,rej); if(p&&p.then) p.then(res,rej); }catch(e){ rej(e); } })); }

/* Vocal polish: high-pass, gentle de-ess, presence, compression and a peak limiter, after
   the loudness has been evened out. Then the chosen voice effect. */
function polishChain(c,nodes){
  const lg=c.createGain(); lg.gain.value=ST.e.clean?loudnessGain(ST.cleanStats):1;
  const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=85; hp.Q.value=0.7;
  const mud=c.createBiquadFilter(); mud.type='peaking'; mud.frequency.value=280; mud.Q.value=1; mud.gain.value=-2;
  const pres=c.createBiquadFilter(); pres.type='peaking'; pres.frequency.value=3200; pres.Q.value=0.9; pres.gain.value=2.5;
  const ess=c.createBiquadFilter(); ess.type='peaking'; ess.frequency.value=6800; ess.Q.value=2.2; ess.gain.value=-3;
  const air=c.createBiquadFilter(); air.type='highshelf'; air.frequency.value=10000; air.gain.value=1.5;
  const cp=c.createDynamicsCompressor(); cp.threshold.value=-20; cp.knee.value=8; cp.ratio.value=3; cp.attack.value=0.006; cp.release.value=0.14;
  const lim=c.createDynamicsCompressor(); lim.threshold.value=-3; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.001; lim.release.value=0.08;
  [lg,hp,mud,pres,ess,air,cp,lim].reduce((a,b)=>{ a.connect(b); return b; });
  nodes.push(lg,hp,mud,pres,ess,air,cp,lim);
  return {input:lg,output:lim};
}
function rebuildVoiceChain(){
  const c=ST.ctx; if(!c) return;
  try{ ST.vIn.disconnect(); }catch(e){}
  if(ST.chain){ (ST.chain.srcs||[]).forEach(s=>{ try{ s.stop(); }catch(e){} }); (ST.chain.nodes||[]).forEach(n=>{ try{ n.disconnect(); }catch(e){} }); }
  const nodes=[], srcs=[]; let head=ST.vIn;
  if(ST.e.clean){ const p=polishChain(c,nodes); head.connect(p.input); head=p.output; }
  const fx=c.createGain(); nodes.push(fx); head.connect(fx);
  buildVoiceFx(c,fx,ST.voiceGain,ST.e.voice,nodes,srcs);
  ST.chain={nodes,srcs};
}
function buildVoiceFx(c,src,out,v,nodes,srcs){
  const N=n=>{ nodes.push(n); return n; };
  if(v==='none'){ src.connect(out); }
  else if(v==='studio'){ const pk=N(c.createBiquadFilter()); pk.type='peaking'; pk.frequency.value=3200; pk.gain.value=2; pk.Q.value=.8; const cp=N(c.createDynamicsCompressor()); cp.threshold.value=-24; cp.ratio.value=3; const mk=N(c.createGain()); mk.gain.value=1.15;
    const cv=N(c.createConvolver()); cv.buffer=impulse(c,1.2,3.5); const wet=N(c.createGain()); wet.gain.value=.14;
    src.connect(pk); pk.connect(cp); cp.connect(mk); mk.connect(out); mk.connect(cv); cv.connect(wet); wet.connect(out); }
  else if(v==='deep'||v==='chip'){ const ps=pitchShifter(c,v==='deep'?-0.42:0.62); srcs.push(...ps.srcs); nodes.push(ps.input,ps.output); const sh=N(c.createBiquadFilter()); sh.type=v==='deep'?'lowshelf':'highshelf'; sh.frequency.value=v==='deep'?200:3000; sh.gain.value=4; src.connect(ps.input); ps.output.connect(sh); sh.connect(out); }
  else if(v==='robot'){ const am=N(c.createGain()); am.gain.value=0; const osc=c.createOscillator(); osc.frequency.value=48; osc.connect(am.gain); osc.start(); srcs.push(osc);
    const d=N(c.createDelay(.1)); d.delayTime.value=.011; const fb=N(c.createGain()); fb.gain.value=.55; const mix=N(c.createGain()); mix.gain.value=1.6;
    src.connect(am); am.connect(mix); am.connect(d); d.connect(fb); fb.connect(d); d.connect(mix); mix.connect(out); }
  else if(v==='echo'){ const d=N(c.createDelay(2)); d.delayTime.value=.32; const fb=N(c.createGain()); fb.gain.value=.38; const wet=N(c.createGain()); wet.gain.value=.55; const lp=N(c.createBiquadFilter()); lp.type='lowpass'; lp.frequency.value=3500;
    src.connect(out); src.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(out); }
  else if(v==='hall'){ const cv=N(c.createConvolver()); cv.buffer=impulse(c,3,2.2); const wet=N(c.createGain()); wet.gain.value=.5; const dry=N(c.createGain()); dry.gain.value=.9; src.connect(dry); dry.connect(out); src.connect(cv); cv.connect(wet); wet.connect(out); }
  else if(v==='radio'){ const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=450; const lp=N(c.createBiquadFilter()); lp.type='lowpass'; lp.frequency.value=3200; const ws=N(c.createWaveShaper()); const k=40,n=1024,cu=new Float32Array(n); for(let i=0;i<n;i++){ const x=i*2/n-1; cu[i]=(1+k)*x/(1+k*Math.abs(x)); } ws.curve=cu; const g=N(c.createGain()); g.gain.value=.7;
    src.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(g); g.connect(out); }
  else src.connect(out);
}
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

/* ---------- Transport ---------- */
const musicAt=()=>(ST.meta&&ST.meta.musicOffset||0)+(ST.e.musicNudge||0);
function stNow(){ return ST.playing?Math.min(ST.dur,ST.pos+(ST.ctx.currentTime-ST.startCtx)):ST.pos; }
function voiceBuf(){ return ST.e.clean&&ST.voiceClean?ST.voiceClean:ST.voiceRaw; }
function startSources(at){
  const c=ST.ctx, when=c.currentTime+0.04; ST.startCtx=when; ST.pos=at; ST.srcs=[];
  const vb=voiceBuf();
  if(ST.mode==='buffer'&&vb&&at<vb.duration){ const s=c.createBufferSource(); s.buffer=vb; s.connect(ST.vIn); s.start(when,at); ST.srcs.push(s); }
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
function seekTo(t){ return new Promise(r=>{ let d=false; const fin=()=>{ if(d) return; d=true; stVideo.removeEventListener('seeked',fin); r(); }; stVideo.addEventListener('seeked',fin); ST.pos=t; try{ stVideo.currentTime=t; }catch(e){ fin(); } setTimeout(fin,1500); }); }
function applyMix(){ if(!ST.ctx) return; const t=ST.ctx.currentTime; ST.voiceGain.gain.setTargetAtTime(ST.e.vVol,t,0.02); ST.musicGain.gain.setTargetAtTime(ST.hasMusic?ST.e.mVol:0,t,0.02); }

/* ---------- Open, prepare, persist ---------- */
async function openStudio(blob,meta,opts={}){
  ST.blob=blob; ST.meta={...meta,loop:meta.loop??(meta.kind!=='song')}; ST.draftId=opts.draftId||null;
  ST.e={...EDIT_DEFAULT,mVol:meta.musicVol??.8,captions:!!(meta.captions&&meta.captions.length),...(opts.edit||{})};
  ST.tab=opts.edit?ST.tab:'voice'; ST.cancel=false; ST.thumbFrame=null; ST.pos=0; ST.playing=false;
  ST.voiceRaw=null; ST.voiceClean=null; ST.cleanStats=null; ST.musicBuf=null; ST.mode='buffer';
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
  // Decode the voice and the clean music into buffers (audio becomes the master clock).
  if(ST.ctx){
    try{ ST.voiceRaw=await decodeIn(ST.ctx,blob); if(ST.voiceRaw.duration<0.3) throw new Error('no audio'); if(!ST.dur||!isFinite(ST.dur)) ST.dur=ST.voiceRaw.duration; }
    catch(e){ ST.voiceRaw=null; }
    if(!ST.voiceRaw){ // the browser couldn't decode the take's audio: play it from the video element instead
      ST.mode='element'; try{ ST.elemSrc=ST.elemSrc||ST.ctx.createMediaElementSource(stVideo); ST.elemSrc.connect(ST.vIn); stVideo.muted=false; }catch(e){} }
    if(meta.music){ try{ ST.musicBuf=await decodeIn(ST.ctx,meta.music); }catch(e){ ST.musicBuf=null; ST.hasMusic=false; } }
    applyMix(); if(ST.e.clean) runClean();
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
async function runClean(){
  if(!ST.voiceRaw||ST.cleaning) return;
  ST.cleaning=true; renderCleanStatus(0);
  const amt=ST.e.cleanAmt;
  try{ const r=await vocalClean(ST.ctx,ST.voiceRaw,amt,p=>renderCleanStatus(p)); if(ST.e.cleanAmt===amt){ ST.voiceClean=r.buf; ST.cleanStats=r.stats; } }
  catch(e){ toast('Couldn’t clean up this take'); }
  ST.cleaning=false;
  if(ST.e.cleanAmt!==amt){ runClean(); return; }
  rebuildVoiceChain(); if(ST.playing){ const t=stNow(); stopSources(); startSources(t); }
  renderCleanStatus(1);
}
function renderCleanStatus(p){ const el=$('#stCleanSt'); if(!el) return; el.textContent=ST.cleaning?'Cleaning up… '+Math.round(p*100)+'%':ST.e.clean&&ST.cleanStats?`Noise reduced · level evened out`:ST.e.clean?'':'Off'; }
function persistEdit(){ if(ST.draftId) saveDraftEdit(ST.draftId,{...ST.e}); }
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
      drawFrame();
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

function renderStPanel(){
  $$('.st-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.p===ST.tab)));
  const p=$('#stPanel'), E=ST.e;
  if(ST.tab==='filters'){
    p.innerHTML=`<div class="fthumbs">${FILTERS.map(f=>`<button class="fth" data-f="${f.id}" aria-pressed="${E.filter===f.id}"><canvas width="72" height="96"></canvas>${esc(f.name)}</button>`).join('')}</div>${FILTER_OK?'':'<p class="hint pad">This device can’t apply colour filters to video, so only tints and extras will show.</p>'}`;
    $$('.fth canvas',p).forEach((cv,i)=>{ const g=cv.getContext('2d'), F=FILTERS[i], src=ST.thumbFrame; if(!src){ g.fillStyle='#222'; g.fillRect(0,0,72,96); return; }
      const sw=src.width, sh=src.height, s=Math.max(72/sw,96/sh); if(FILTER_OK) g.filter=F.css; g.drawImage(src,(72-sw*s)/2,(96-sh*s)/2,sw*s,sh*s); g.filter='none'; if(F.tint){ g.globalCompositeOperation='soft-light'; g.fillStyle=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')'); g.fillRect(0,0,72,96); } });
  } else if(ST.tab==='voice'){
    p.innerHTML=`<div class="card polish" style="margin:0 20px 14px">
        <div class="setrow"><div class="lbl">Clean up voice<small id="stCleanSt"></small></div><button class="toggle" role="switch" data-x="clean" aria-checked="${!!E.clean}" aria-label="Clean up voice" ${ST.mode==='element'?'disabled':''}></button></div>
        <div class="mixrow" ${E.clean?'':'style="opacity:.4"'}>${ic('audio-waveform','sm')}<input type="range" id="stCleanAmt" min="0" max="100" step="5" value="${Math.round(E.cleanAmt*100)}" ${E.clean?'':'disabled'} aria-label="Noise reduction"><output>${Math.round(E.cleanAmt*100)}%</output></div>
        <p class="hint" style="margin:0 2px 2px">Removes background hiss and hum, evens out your level and adds clarity. Your original take is kept.</p>
      </div>
      <div class="vgrid">${VOICES.map(v=>`<button class="vfx" data-v="${v.id}" aria-pressed="${E.voice===v.id}"><span class="oi">${ic(v.icon)}</span>${esc(v.name)}</button>`).join('')}</div>
      <p class="hint pad" style="margin-top:12px">${ST.ctx?'Press play to hear it. Effects apply to your voice only'+(ST.hasMusic?', not the music.':'.'):'Voice effects need Web Audio, which this device doesn’t support.'}</p>`;
    renderCleanStatus(ST.cleaning?0:1);
  } else if(ST.tab==='mix'){
    p.innerHTML=`<div class="mixrow">${ic('mic')}<input type="range" id="mxV" min="0" max="150" value="${Math.round(E.vVol*100)}" aria-label="Voice volume"><output>${Math.round(E.vVol*100)}%</output></div>
      <div class="mixrow" ${ST.hasMusic?'':'style="opacity:.4"'}>${ic('eighth-notes')}<input type="range" id="mxM" min="0" max="150" value="${Math.round(E.mVol*100)}" ${ST.hasMusic?'':'disabled'} aria-label="Music volume"><output>${ST.hasMusic?Math.round(E.mVol*100)+'%':'—'}</output></div>
      ${ST.hasMusic?`<div class="mixrow">${ic('timer')}<input type="range" id="mxN" min="-500" max="500" step="10" value="${Math.round((E.musicNudge||0)*1000)}" aria-label="Music timing"><output>${(E.musicNudge>0?'+':'')+Math.round((E.musicNudge||0)*1000)} ms</output></div>
      <p class="hint pad">Music timing: if your voice sounds ahead of or behind the beat, nudge the music until they line up. Already compensated for ${Math.round((ST.meta.musicOffset||0)*1000)} ms of headphone delay.</p>`:''}
      <p class="hint pad">${ST.hasMusic?'Music is mixed in clean from the original track, so it sounds better than what your mic picked up.':'No music in this take. Add a music bed in Tune before recording, or sing a karaoke song.'}</p>`;
  } else {
    const tg=(k,label,sub,dis)=>`<div class="setrow" ${dis?'style="opacity:.4"':''}><div class="lbl">${label}${sub?`<small>${sub}</small>`:''}</div><button class="toggle" role="switch" data-x="${k}" aria-checked="${!!E[k]}" ${dis?'disabled':''} aria-label="${label}"></button></div>`;
    p.innerHTML=`<div class="card" style="margin:0 20px">${tg('captions','Lyric captions','Burns the karaoke line into the video',!(ST.meta.captions&&ST.meta.captions.length))}${tg('mirror','Mirror video','Flip left and right')}${tg('vignette','Vignette','Darkens the edges')}${tg('grain','Film grain')}${tg('watermark','Lectern watermark')}</div>`;
  }
}
$('.st-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-p]'); if(!b) return; ST.tab=b.dataset.p; renderStPanel(); });
$('#stPanel').addEventListener('click',e=>{
  const f=e.target.closest('[data-f]'); if(f){ ST.e.filter=f.dataset.f; $$('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===f))); drawFrame(); persistEdit(); return; }
  const v=e.target.closest('[data-v]'); if(v){ ST.e.voice=v.dataset.v; $$('[data-v]').forEach(x=>x.setAttribute('aria-pressed',String(x===v))); if(ensureStudioGraph()) rebuildVoiceChain(); if(!ST.playing) stPlay(); persistEdit(); return; }
  const x=e.target.closest('[data-x]'); if(x&&!x.disabled){ const k=x.dataset.x; ST.e[k]=!ST.e[k]; x.setAttribute('aria-checked',String(ST.e[k]));
    if(k==='clean'){ rebuildVoiceChain(); if(ST.playing){ const t=stNow(); stopSources(); startSources(t); } if(ST.e.clean&&!ST.voiceClean) runClean(); renderStPanel(); }
    else drawFrame();
    persistEdit(); }
});
$('#stPanel').addEventListener('input',e=>{ const t=e.target, E=ST.e;
  if(t.id==='mxV'){ E.vVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxM'){ E.mVol=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  if(t.id==='mxN'){ E.musicNudge=+t.value/1000; t.nextElementSibling.textContent=(E.musicNudge>0?'+':'')+t.value+' ms'; if(ST.playing){ const n=stNow(); stopSources(); startSources(n); } }
  if(t.id==='stCleanAmt'){ E.cleanAmt=+t.value/100; t.nextElementSibling.textContent=t.value+'%'; }
  applyMix(); persistEdit(); });
$('#stPanel').addEventListener('change',e=>{ if(e.target.id==='stCleanAmt') runClean(); });

const needsRender=()=>{ const E=ST.e; return E.filter!=='none'||E.voice!=='none'||E.clean||ST.hasMusic||E.mirror||E.vignette||E.grain||E.watermark||(E.captions&&ST.meta.captions&&ST.meta.captions.length)||E.vVol!==1; };
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
  const r={id,title:ST.meta.title||'Take',itemId:ST.meta.itemId,kind:ST.meta.kind,dur:ST.dur||ST.meta.dur||0,created:Date.now(),thumb,filter:original?'none':E.filter,voice:original?'none':E.voice,size:blob.size,type:blob.type};
  S.recs.unshift(r); SAVE.recs();
  if(ok&&ST.draftId){ await deleteDraft(ST.draftId); ST.draftId=null; }
  closeStudio(true);
  if(!ok) toast('Saved for this session only. Storage is full or blocked, so download it to keep it.');
  sheet(`<div style="text-align:center;padding:6px 20px 0"><div style="width:120px;margin:4px auto 14px;border-radius:14px;overflow:hidden;aspect-ratio:${stCanvas.width}/${stCanvas.height};background:#000 url('${thumb}') center/cover"></div><h3 style="margin:0">Saved to Recordings</h3><p class="sub" style="margin:6px 0 16px">${fmt(r.dur)} · ${(blob.size/1048576).toFixed(1)} MB${r.filter!=='none'?' · '+FILTERS.find(f=>f.id===r.filter).name:''}${r.voice!=='none'?' · '+VOICES.find(v=>v.id===r.voice).name+' voice':''}</p></div>
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
  ST.voiceRaw=ST.voiceClean=ST.musicBuf=null; VOCAL.cache.clear();
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
