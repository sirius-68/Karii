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
const stVideo=$('#stVideo'), stCanvas=$('#stCanvas'), stMusic=new Audio();
stVideo.removeAttribute('hidden'); Object.assign(stVideo.style,{position:'fixed',left:'-10000px',top:'0',width:'4px',height:'4px',opacity:'0',pointerEvents:'none'});
stVideo.playsInline=true; stMusic.loop=false;
const ST={blob:null,meta:null,url:'',murl:'',filter:'none',voice:'none',vVol:1,mVol:.8,mirror:false,vignette:false,grain:false,captions:true,watermark:true,tab:'filters',
  ctx:null,vSrc:null,mSrc:null,voiceGain:null,musicGain:null,master:null,recDest:null,fx:null,raf:0,exporting:false,cancel:false,dur:0,hasMusic:false,thumbFrame:null};

function ensureStudioGraph(){
  if(ST.ctx) return true; const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return false;
  try{ const c=new AC(); ST.ctx=c;
    ST.vSrc=c.createMediaElementSource(stVideo); ST.mSrc=c.createMediaElementSource(stMusic);
    ST.voiceGain=c.createGain(); ST.musicGain=c.createGain(); ST.master=c.createGain(); ST.recDest=c.createMediaStreamDestination();
    ST.voiceGain.connect(ST.master); ST.mSrc.connect(ST.musicGain); ST.musicGain.connect(ST.master); ST.master.connect(c.destination); ST.master.connect(ST.recDest);
    buildVoice(); return true;
  }catch(e){ ST.ctx=null; return false; }
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
function buildVoice(){
  const c=ST.ctx; if(!c) return;
  try{ ST.vSrc.disconnect(); }catch(e){}
  if(ST.fx){ (ST.fx.srcs||[]).forEach(s=>{ try{ s.stop(); }catch(e){} }); (ST.fx.nodes||[]).forEach(n=>{ try{ n.disconnect(); }catch(e){} }); }
  const out=ST.voiceGain, nodes=[], srcs=[]; const N=n=>{ nodes.push(n); return n; };
  const v=ST.voice;
  if(v==='none'){ ST.vSrc.connect(out); }
  else if(v==='studio'){ const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=90; const pk=N(c.createBiquadFilter()); pk.type='peaking'; pk.frequency.value=3200; pk.gain.value=3.5; pk.Q.value=.8; const hs=N(c.createBiquadFilter()); hs.type='highshelf'; hs.frequency.value=9000; hs.gain.value=3; const cp=N(c.createDynamicsCompressor()); cp.threshold.value=-22; cp.ratio.value=4; cp.attack.value=.005; cp.release.value=.15; const mk=N(c.createGain()); mk.gain.value=1.35;
    const cv=N(c.createConvolver()); cv.buffer=impulse(c,1.2,3.5); const wet=N(c.createGain()); wet.gain.value=.12;
    ST.vSrc.connect(hp); hp.connect(pk); pk.connect(hs); hs.connect(cp); cp.connect(mk); mk.connect(out); mk.connect(cv); cv.connect(wet); wet.connect(out); }
  else if(v==='deep'||v==='chip'){ const ps=pitchShifter(c,v==='deep'?-0.42:0.62); srcs.push(...ps.srcs); nodes.push(ps.input,ps.output); const sh=N(c.createBiquadFilter()); sh.type=v==='deep'?'lowshelf':'highshelf'; sh.frequency.value=v==='deep'?200:3000; sh.gain.value=4; ST.vSrc.connect(ps.input); ps.output.connect(sh); sh.connect(out); }
  else if(v==='robot'){ const am=N(c.createGain()); am.gain.value=0; const osc=c.createOscillator(); osc.frequency.value=48; osc.connect(am.gain); osc.start(); srcs.push(osc);
    const d=N(c.createDelay(.1)); d.delayTime.value=.011; const fb=N(c.createGain()); fb.gain.value=.55; const mix=N(c.createGain()); mix.gain.value=1.6;
    ST.vSrc.connect(am); am.connect(mix); am.connect(d); d.connect(fb); fb.connect(d); d.connect(mix); mix.connect(out); }
  else if(v==='echo'){ const d=N(c.createDelay(2)); d.delayTime.value=.32; const fb=N(c.createGain()); fb.gain.value=.38; const wet=N(c.createGain()); wet.gain.value=.55; const lp=N(c.createBiquadFilter()); lp.type='lowpass'; lp.frequency.value=3500;
    ST.vSrc.connect(out); ST.vSrc.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(out); }
  else if(v==='hall'){ const cv=N(c.createConvolver()); cv.buffer=impulse(c,3,2.2); const wet=N(c.createGain()); wet.gain.value=.6; const dry=N(c.createGain()); dry.gain.value=.85; ST.vSrc.connect(dry); dry.connect(out); ST.vSrc.connect(cv); cv.connect(wet); wet.connect(out); }
  else if(v==='radio'){ const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=450; const lp=N(c.createBiquadFilter()); lp.type='lowpass'; lp.frequency.value=3200; const ws=N(c.createWaveShaper()); const k=40,n=1024,cu=new Float32Array(n); for(let i=0;i<n;i++){ const x=i*2/n-1; cu[i]=(1+k)*x/(1+k*Math.abs(x)); } ws.curve=cu; const g=N(c.createGain()); g.gain.value=.7;
    ST.vSrc.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(g); g.connect(out); }
  ST.fx={nodes,srcs};
}

async function openStudio(blob,meta){
  ST.blob=blob; ST.meta=meta; ST.filter='none'; ST.voice='none'; ST.vVol=1; ST.mVol=meta.musicVol??.8; ST.mirror=false; ST.vignette=false; ST.grain=false;
  ST.captions=!!(meta.captions&&meta.captions.length); ST.watermark=true; ST.tab='filters'; ST.cancel=false; ST.thumbFrame=null;
  if(ST.url) URL.revokeObjectURL(ST.url); if(ST.murl){ URL.revokeObjectURL(ST.murl); ST.murl=''; }
  ST.url=URL.createObjectURL(blob); stVideo.src=ST.url; stVideo.muted=false;
  ST.hasMusic=!!meta.music; if(ST.hasMusic){ ST.murl=URL.createObjectURL(meta.music); stMusic.src=ST.murl; stMusic.loop=meta.kind!=='song'; } else stMusic.removeAttribute('src');
  $('#studio').hidden=false; document.body.style.overflow='hidden';
  ensureStudioGraph(); if(ST.ctx) buildVoice();
  await new Promise(r=>{ if(stVideo.readyState>=1) r(); else { stVideo.onloadedmetadata=()=>r(); stVideo.onerror=()=>r(); setTimeout(r,5000); } });
  ST.dur=await fixDuration(stVideo);
  const vw=stVideo.videoWidth||720, vh=stVideo.videoHeight||1280, sc=Math.min(1,1280/Math.max(vw,vh));
  stCanvas.width=Math.round(vw*sc/2)*2; stCanvas.height=Math.round(vh*sc/2)*2;
  $('#stPrev').style.aspectRatio=vw+'/'+vh;
  $('#stSeek').max=ST.dur||1; $('#stDur').textContent=fmt(ST.dur);
  await seekTo(Math.min(0.4,(ST.dur||1)/2)); grabThumbFrame(); drawFrame(); await seekTo(0); drawFrame();
  renderStPanel(); applyMix(); stLoop();
}
function fixDuration(v){
  if(isFinite(v.duration)&&v.duration>0) return Promise.resolve(v.duration);
  return new Promise(res=>{ let done=false; const fin=d=>{ if(done) return; done=true; v.removeEventListener('durationchange',on); res(d); };
    const on=()=>{ if(isFinite(v.duration)&&v.duration>0){ fin(v.duration); } };
    v.addEventListener('durationchange',on); try{ v.currentTime=1e101; }catch(e){}
    setTimeout(()=>fin(isFinite(v.duration)&&v.duration>0?v.duration:(ST.meta.dur||0)),3000); });
}
function seekTo(t){ return new Promise(r=>{ let d=false; const fin=()=>{ if(d) return; d=true; stVideo.removeEventListener('seeked',fin); r(); }; stVideo.addEventListener('seeked',fin); try{ stVideo.currentTime=t; }catch(e){ fin(); } setTimeout(fin,1500); if(ST.hasMusic){ try{ stMusic.currentTime=Math.min(t,stMusic.duration||t); }catch(e){} } }); }
function grabThumbFrame(){ try{ const c=document.createElement('canvas'); const w=144,h=Math.round(144*stCanvas.height/stCanvas.width); c.width=w; c.height=h; c.getContext('2d').drawImage(stVideo,0,0,w,h); ST.thumbFrame=c; }catch(e){ ST.thumbFrame=null; } }
let GRAIN=null;
function drawFrame(){
  const g=stCanvas.getContext('2d'), w=stCanvas.width, h=stCanvas.height, F=FILTERS.find(f=>f.id===ST.filter)||FILTERS[0];
  g.save(); g.clearRect(0,0,w,h);
  if(ST.mirror){ g.translate(w,0); g.scale(-1,1); }
  if(FILTER_OK) g.filter=F.css;
  try{ g.drawImage(stVideo,0,0,w,h); }catch(e){}
  g.restore(); g.filter='none';
  if(F.tint){ g.globalCompositeOperation='soft-light'; g.fillStyle=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')'); g.fillRect(0,0,w,h); g.globalCompositeOperation='source-over'; }
  if(F.glow&&FILTER_OK){ g.globalAlpha=.28; g.globalCompositeOperation='screen'; g.filter='blur('+Math.round(w/60)+'px)'; g.drawImage(stCanvas,0,0); g.filter='none'; g.globalAlpha=1; g.globalCompositeOperation='source-over'; }
  if(ST.vignette||F.vig){ const vg=g.createRadialGradient(w/2,h/2,Math.min(w,h)*.35,w/2,h/2,Math.max(w,h)*.72); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.6)'); g.fillStyle=vg; g.fillRect(0,0,w,h); }
  if(ST.grain||F.grain){ if(!GRAIN) GRAIN=g.createPattern(noiseCanvas(),'repeat'); g.save(); g.globalAlpha=.12; g.globalCompositeOperation='overlay'; g.translate(Math.random()*128|0,Math.random()*128|0); g.fillStyle=GRAIN; g.fillRect(-128,-128,w+256,h+256); g.restore(); }
  const caps=ST.meta&&ST.meta.captions;
  if(ST.captions&&caps&&caps.length){
    const t=stVideo.currentTime; let i=-1; for(let k=0;k<caps.length;k++){ if(caps[k].t<=t) i=k; else break; }
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
  if(ST.watermark){ const fs=Math.round(Math.min(w,h)*.028); g.font=`600 ${fs}px ${getComputedStyle(document.body).fontFamily}`; g.textAlign='right'; g.textBaseline='bottom'; g.fillStyle='rgba(255,255,255,.75)'; g.shadowColor='rgba(0,0,0,.5)'; g.shadowBlur=6; g.fillText('● Lectern',w-fs*1.1,h-fs*1.1); g.shadowBlur=0; }
}
function wrapText(g,text,maxW){ const words=text.split(/\s+/), out=[]; let line=''; words.forEach(wd=>{ const t=line?line+' '+wd:wd; if(g.measureText(t).width>maxW&&line){ out.push(line); line=wd; } else line=t; }); if(line) out.push(line); return out.slice(0,3); }
function roundRectPath(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r); g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); }
function stLoop(){
  cancelAnimationFrame(ST.raf);
  const step=()=>{ if($('#studio').hidden&&!ST.exporting) return;
    if(!stVideo.paused||ST.exporting) drawFrame();
    if(ST.hasMusic&&!stVideo.paused&&!stMusic.paused&&Math.abs(stMusic.currentTime-stVideo.currentTime)>0.15&&stVideo.currentTime<(stMusic.duration||1e9)){ try{ stMusic.currentTime=stVideo.currentTime; }catch(e){} }
    const t=stVideo.currentTime; $('#stNow').textContent=fmt(t); if(!ST.seeking) $('#stSeek').value=t;
    if(ST.exporting){ const p=Math.round(clamp01(t/(ST.dur||1))*100); $('#rRing').style.setProperty('--p',p); $('#rPct').textContent=p+'%'; }
    ST.raf=requestAnimationFrame(step); };
  ST.raf=requestAnimationFrame(step);
}
function stPlay(){ ensureStudioGraph(); if(ST.ctx&&ST.ctx.state==='suspended') ST.ctx.resume(); if(ST.hasMusic){ try{ stMusic.currentTime=stVideo.currentTime; }catch(e){} stMusic.play().catch(()=>{}); } stVideo.play().catch(()=>{}); $('#stPrev').classList.add('playing'); }
function stPause(){ stVideo.pause(); stMusic.pause(); $('#stPrev').classList.remove('playing'); drawFrame(); }
stVideo.addEventListener('ended',()=>{ stMusic.pause(); $('#stPrev').classList.remove('playing'); if(!ST.exporting){ seekTo(0).then(drawFrame); } });
stVideo.addEventListener('seeked',()=>{ if(stVideo.paused) drawFrame(); });
$('#stPP').onclick=()=>{ if(ST.exporting) return; stVideo.paused?stPlay():stPause(); };
const stSeek=$('#stSeek');
stSeek.addEventListener('pointerdown',()=>ST.seeking=true); stSeek.addEventListener('pointerup',()=>ST.seeking=false);
stSeek.addEventListener('input',()=>{ stVideo.currentTime=+stSeek.value; if(ST.hasMusic){ try{ stMusic.currentTime=+stSeek.value; }catch(e){} } });
function applyMix(){ if(!ST.ctx) return; ST.voiceGain.gain.value=ST.vVol; ST.musicGain.gain.value=ST.hasMusic?ST.mVol:0; }

function renderStPanel(){
  $$('.st-tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.p===ST.tab)));
  const p=$('#stPanel');
  if(ST.tab==='filters'){
    p.innerHTML=`<div class="fthumbs">${FILTERS.map(f=>`<button class="fth" data-f="${f.id}" aria-pressed="${ST.filter===f.id}"><canvas width="72" height="96"></canvas>${esc(f.name)}</button>`).join('')}</div>${FILTER_OK?'':'<p class="hint pad">This browser can’t apply colour filters to video, so only tints and extras will show. Chrome, Edge and Firefox support them all.</p>'}`;
    $$('.fth canvas',p).forEach((cv,i)=>{ const g=cv.getContext('2d'), F=FILTERS[i], src=ST.thumbFrame; if(!src){ g.fillStyle='#222'; g.fillRect(0,0,72,96); return; }
      const sw=src.width, sh=src.height, s=Math.max(72/sw,96/sh); if(FILTER_OK) g.filter=F.css; g.drawImage(src,(72-sw*s)/2,(96-sh*s)/2,sw*s,sh*s); g.filter='none'; if(F.tint){ g.globalCompositeOperation='soft-light'; g.fillStyle=F.tint.replace(/[\d.]+\)$/,m=>Math.min(1,parseFloat(m)*2.2)+')'); g.fillRect(0,0,72,96); } });
  } else if(ST.tab==='voice'){
    p.innerHTML=`<div class="vgrid">${VOICES.map(v=>`<button class="vfx" data-v="${v.id}" aria-pressed="${ST.voice===v.id}"><span class="oi">${ic(v.icon)}</span>${esc(v.name)}</button>`).join('')}</div><p class="hint pad" style="margin-top:12px">${ST.ctx?'Press play to hear it. Effects apply to your voice only'+(ST.hasMusic?', not the music.':'.'):'Voice effects need Web Audio, which this browser doesn’t support.'}</p>`;
  } else if(ST.tab==='mix'){
    p.innerHTML=`<div class="mixrow">${ic('mic')}<input type="range" id="mxV" min="0" max="150" value="${Math.round(ST.vVol*100)}" aria-label="Voice volume"><output>${Math.round(ST.vVol*100)}%</output></div>
      <div class="mixrow" ${ST.hasMusic?'':'style="opacity:.4"'}>${ic('eighth-notes')}<input type="range" id="mxM" min="0" max="150" value="${Math.round(ST.mVol*100)}" ${ST.hasMusic?'':'disabled'} aria-label="Music volume"><output>${ST.hasMusic?Math.round(ST.mVol*100)+'%':'—'}</output></div>
      <p class="hint pad">${ST.hasMusic?'Music is mixed in clean from the original track, so it sounds better than what your mic picked up.':'No music in this take. Add a music bed in Tune before recording, or sing a karaoke song.'}</p>`;
  } else {
    const tg=(k,label,sub,dis)=>`<div class="setrow" ${dis?'style="opacity:.4"':''}><div class="lbl">${label}${sub?`<small>${sub}</small>`:''}</div><button class="toggle" role="switch" data-x="${k}" aria-checked="${!!ST[k]}" ${dis?'disabled':''} aria-label="${label}"></button></div>`;
    p.innerHTML=`<div class="card" style="margin:0 20px">${tg('captions','Lyric captions','Burns the karaoke line into the video',!(ST.meta.captions&&ST.meta.captions.length))}${tg('mirror','Mirror video','Flip left and right')}${tg('vignette','Vignette','Darkens the edges')}${tg('grain','Film grain')}${tg('watermark','Lectern watermark')}</div>`;
  }
}
$('.st-tabs').addEventListener('click',e=>{ const b=e.target.closest('[data-p]'); if(!b) return; ST.tab=b.dataset.p; renderStPanel(); });
$('#stPanel').addEventListener('click',e=>{
  const f=e.target.closest('[data-f]'); if(f){ ST.filter=f.dataset.f; $$('[data-f]').forEach(x=>x.setAttribute('aria-pressed',String(x===f))); drawFrame(); return; }
  const v=e.target.closest('[data-v]'); if(v){ ST.voice=v.dataset.v; $$('[data-v]').forEach(x=>x.setAttribute('aria-pressed',String(x===v))); if(ensureStudioGraph()) buildVoice(); if(stVideo.paused) stPlay(); return; }
  const x=e.target.closest('[data-x]'); if(x&&!x.disabled){ ST[x.dataset.x]=!ST[x.dataset.x]; x.setAttribute('aria-checked',String(ST[x.dataset.x])); drawFrame(); }
});
$('#stPanel').addEventListener('input',e=>{ if(e.target.id==='mxV'){ ST.vVol=+e.target.value/100; e.target.nextElementSibling.textContent=e.target.value+'%'; } if(e.target.id==='mxM'){ ST.mVol=+e.target.value/100; e.target.nextElementSibling.textContent=e.target.value+'%'; } applyMix(); });

const needsRender=()=>ST.filter!=='none'||ST.voice!=='none'||ST.hasMusic||ST.mirror||ST.vignette||ST.grain||ST.watermark||(ST.captions&&ST.meta.captions&&ST.meta.captions.length)||ST.vVol!==1;
async function stRender(){
  if(!window.MediaRecorder||!stCanvas.captureStream){ toast('This browser can’t render video. Saving the original instead.'); return saveRec(ST.blob,true); }
  const okAudio=ensureStudioGraph(); if(ST.ctx) await ST.ctx.resume();
  stPause(); await seekTo(0); drawFrame();
  ST.exporting=true; ST.cancel=false; $('#render').hidden=false; $('#rRing').style.setProperty('--p',0); $('#rPct').textContent='0%';
  const vs=stCanvas.captureStream(30);
  const tracks=[...vs.getVideoTracks(),...(okAudio?ST.recDest.stream.getAudioTracks():[])];
  const m=pickMime(); let rec;
  try{ rec=new MediaRecorder(new MediaStream(tracks),m?{mimeType:m,videoBitsPerSecond:5000000}:undefined); }
  catch(e){ ST.exporting=false; $('#render').hidden=true; toast('Rendering isn’t supported here. Saving the original.'); return saveRec(ST.blob,true); }
  const ch=[]; rec.ondataavailable=e=>{ if(e.data&&e.data.size) ch.push(e.data); };
  const stopped=new Promise(r=>rec.onstop=r);
  rec.start(500); stPlay();
  await new Promise(r=>{ const end=()=>{ stVideo.removeEventListener('ended',end); clearInterval(iv); r(); }; stVideo.addEventListener('ended',end);
    const iv=setInterval(()=>{ if(ST.cancel||(ST.dur&&stVideo.currentTime>=ST.dur-0.05)) end(); },200); setTimeout(end,((ST.dur||ST.meta.dur||60)+5)*1000); });
  await new Promise(r=>setTimeout(r,250));
  stPause(); try{ rec.stop(); }catch(e){} await stopped;
  vs.getTracks().forEach(t=>t.stop());
  ST.exporting=false; $('#render').hidden=true;
  if(ST.cancel){ toast('Render cancelled'); await seekTo(0); drawFrame(); return; }
  saveRec(new Blob(ch,{type:(rec.mimeType||m||'video/webm').split(';')[0]}),false);
}
async function saveRec(blob,original){
  const id='rec-'+uid();
  await seekTo(Math.min(0.5,(ST.dur||1)/2)); drawFrame();
  let thumb=''; try{ const c=document.createElement('canvas'); c.width=240; c.height=Math.round(240*stCanvas.height/stCanvas.width); c.getContext('2d').drawImage(stCanvas,0,0,c.width,c.height); thumb=c.toDataURL('image/jpeg',.72); }catch(e){}
  const ok=await idb.put(id,blob,'rec');
  const r={id,title:ST.meta.title||'Take',itemId:ST.meta.itemId,kind:ST.meta.kind,dur:ST.dur||ST.meta.dur||0,created:Date.now(),thumb,filter:original?'none':ST.filter,voice:original?'none':ST.voice,size:blob.size,type:blob.type};
  S.recs.unshift(r); SAVE.recs();
  closeStudio();
  if(!ok) toast('Saved for this session. Your browser blocked long-term storage, so download it to keep it.');
  sheet(`<div style="text-align:center;padding:6px 20px 0"><div style="width:120px;margin:4px auto 14px;border-radius:14px;overflow:hidden;aspect-ratio:${stCanvas.width}/${stCanvas.height};background:#000 url('${thumb}') center/cover"></div><h3 style="margin:0">Saved to Recordings</h3><p class="sub" style="margin:6px 0 16px">${fmt(r.dur)} · ${(blob.size/1048576).toFixed(1)} MB${r.filter!=='none'?' · '+FILTERS.find(f=>f.id===r.filter).name:''}${r.voice!=='none'?' · '+VOICES.find(v=>v.id===r.voice).name+' voice':''}</p></div>
    <div class="row-btns"><button class="btn white" id="svShare">${ic('share-2','sm')}Share</button><button class="btn" id="svDl">${ic('download','sm')}Download</button></div>
    <div class="row-btns"><button class="btn" id="svView">View in library</button><button class="btn" id="svAgain">${ic('rotate-ccw','sm')}Another take</button></div>`,
    {onMount(el,close){ el.querySelector('#svShare').onclick=()=>shareRec(r); el.querySelector('#svDl').onclick=async()=>{ const f=await recFile(r); if(f) downloadFile(f); };
      el.querySelector('#svView').onclick=()=>{ close(); closeStage(); switchTab('library'); openRecs(); };
      el.querySelector('#svAgain').onclick=()=>{ close(); if(stage.hidden) toast('Open something to perform from Explore'); }; }});
}
function closeStudio(){ stPause(); cancelAnimationFrame(ST.raf); $('#studio').hidden=true; if(stage.hidden) document.body.style.overflow=''; stVideo.removeAttribute('src'); try{ stVideo.load(); }catch(e){} stMusic.removeAttribute('src'); if(ST.url){ URL.revokeObjectURL(ST.url); ST.url=''; } if(ST.murl){ URL.revokeObjectURL(ST.murl); ST.murl=''; } refresh(); }
$('#stSave').onclick=()=>{ if(ST.exporting) return; needsRender()?stRender():saveRec(ST.blob,true); };
$('#stExport').onclick=()=>{ if(!ST.exporting) stRender(); };
$('#stOriginal').onclick=()=>{ if(!ST.exporting) saveRec(ST.blob,true); };
$('#stClose').onclick=()=>{ if(ST.exporting) return; stPause(); confirmSheet(ST.meta.remix?'Leave the studio?':'Discard this take?',ST.meta.remix?'Your original recording stays in your library.':'It hasn’t been saved yet.',ST.meta.remix?'Leave':'Discard',()=>closeStudio()); };
$('#rCancel').onclick=()=>{ ST.cancel=true; };
