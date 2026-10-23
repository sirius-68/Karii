/* =====================================================================
   Audio services
   1. Now playing  — every sound source registers here, so one indicator can
      say what is playing and stop it, and starting one source stops the others.
   2. Route        — which output (speaker, wired, Bluetooth, USB) and which
      microphones are available, from the native shell when present, else from
      the browser's device list. Each route has its own delay compensation.
   3. Microphone   — capture settings that keep full-band, uncoloured audio and
      keep Bluetooth headphones on their high-quality profile, plus a level meter.
   ===================================================================== */

/* ---------- 1. Now playing ---------- */
const AUDIO={
  sources:new Map(),          // id -> {label, sub, icon, playing(), stop(), open?(), here?()}
  register(id,src){ this.sources.set(id,src); },
  /* Call before a source starts: stops every other source (one sound at a time). */
  claim(id,keep=[]){ this.sources.forEach((s,k)=>{ if(k!==id&&!keep.includes(k)){ try{ if(s.playing()) s.stop(); }catch(e){} } }); setTimeout(npRender,30); },
  active(){ return [...this.sources.entries()].filter(([,s])=>{ try{ return s.playing(); }catch(e){ return false; } }).map(([id,s])=>({id,...s,label:typeof s.label==='function'?s.label():s.label,sub:typeof s.sub==='function'?s.sub():s.sub})); },
  stopAll(){ this.sources.forEach(s=>{ try{ if(s.playing()) s.stop(); }catch(e){} }); npRender(); }
};
/* The precision player is shared by several screens; whoever loads it says what it is. */
const PLAYER_CTX={label:'',sub:'',icon:'eighth-notes',open:null,here:null};
function playerOwner(o){ Object.assign(PLAYER_CTX,{label:'',sub:'',icon:'eighth-notes',open:null,here:null},o||{}); }
AUDIO.register('player',{label:()=>PLAYER_CTX.label||'Music',sub:()=>PLAYER_CTX.sub,icon:'eighth-notes',
  playing:()=>player.playing()&&player.hasAudio, stop:()=>player.pause(),
  open:()=>PLAYER_CTX.open&&PLAYER_CTX.open(), here:()=>PLAYER_CTX.here?PLAYER_CTX.here():false});
AUDIO.register('tts',{label:'Narrator',sub:'Reading aloud',icon:'audio-lines',playing:()=>'speechSynthesis' in window&&speechSynthesis.speaking,stop:()=>{ try{ narratorStop(); }catch(e){ speechSynthesis.cancel(); } },here:()=>!stage.hidden});

/* Every start of the shared player stops other sounds first. */
{ const _play=player.play.bind(player); player.play=function(){ AUDIO.claim('player'); return _play(); }; }

/* Indicator: a small pill above the tab bar while something plays out of view. */
function npRender(){
  const el=$('#np'); if(!el) return;
  const act=AUDIO.active().filter(s=>!(s.here&&s.here()));
  if(!act.length){ el.hidden=true; return; }
  const s=act[0];
  el.hidden=false;
  el.querySelector('.np-ic').innerHTML=ic(s.icon||'volume-2','sm');
  el.querySelector('.np-t b').textContent=act.length>1?act.length+' sounds playing':s.label;
  el.querySelector('.np-t span').textContent=act.length>1?act.map(x=>x.label).join(' · '):(s.sub||'Playing');
}
setInterval(npRender,600);
function npSheet(){
  const act=AUDIO.active(); if(!act.length){ npRender(); return; }
  sheet(`<h3>Now playing</h3><p class="sub" style="margin:0 20px 10px">Only one sound plays at a time. Starting something new stops the rest.</p>
    <div class="list" style="padding:0 8px">${act.map(s=>`<div class="row"><span class="np-row-ic">${ic(s.icon||'volume-2','sm')}</span><span class="tx"><b>${esc(s.label)}</b><span>${esc(s.sub||'Playing')}</span></span>${s.open?`<button class="btn sm" data-np-open="${s.id}">Open</button>`:''}<button class="circ sm" data-np-stop="${s.id}" aria-label="Stop ${esc(s.label)}">${ic('square','fill xs')}</button></div>`).join('')}</div>
    <div class="row-btns"><button class="btn white" id="npAll">${ic('square','fill xs')}Stop all</button></div>`,{onMount(el,close){
      el.addEventListener('click',e=>{ const st=e.target.closest('[data-np-stop]'), op=e.target.closest('[data-np-open]');
        if(st){ const s=AUDIO.sources.get(st.dataset.npStop); if(s) s.stop(); npRender(); if(!AUDIO.active().length) close(); else st.closest('.row').remove(); }
        if(op){ const s=AUDIO.sources.get(op.dataset.npOpen); close(); if(s&&s.open) s.open(); } });
      el.querySelector('#npAll').onclick=()=>{ AUDIO.stopAll(); close(); }; }});
}

/* ---------- 2. Output and input route ---------- */
const ROUTE={output:'speaker',name:'',inputs:[],btConnected:false,source:'browser',listeners:new Set()};
const ROUTE_LABEL={speaker:'Phone speaker',wired:'Wired headphones',usb:'USB audio',bluetooth:'Bluetooth',hdmi:'External display'};
const ROUTE_ICON={speaker:'volume-2',wired:'headphones',usb:'headphones',bluetooth:'bluetooth',hdmi:'monitor-speaker'};
// Typical delay the OS doesn't report through the browser, used until the person calibrates.
const ROUTE_DEFAULT_LAT={speaker:0,wired:0,usb:0.01,bluetooth:0.17,hdmi:0.05};
function routeLatency(r=ROUTE.output){ const m=S.settings.routeLat||{}; return m[r]!=null?m[r]:(ROUTE_DEFAULT_LAT[r]||0); }
function setRouteLatency(v,r=ROUTE.output){ S.settings.routeLat={...(S.settings.routeLat||{}),[r]:Math.round(v*1000)/1000}; SAVE.settings(); }
extraLatency=()=>{
  // If the hardware clock already reports a large output delay, don't add the default on top.
  const reported=AC?(AC.outputLatency||0):0, m=S.settings.routeLat||{};
  if(m[ROUTE.output]!=null) return m[ROUTE.output];
  return Math.max(0,(ROUTE_DEFAULT_LAT[ROUTE.output]||0)-reported);
};
const nativeRoute=()=>typeof hasPlugin==='function'&&NATIVE&&hasPlugin('AudioRoute');
function applyRoute(r){
  const before=ROUTE.output;
  Object.assign(ROUTE,r);
  if(before!==ROUTE.output) ROUTE.listeners.forEach(f=>{ try{ f(ROUTE,before); }catch(e){} });
}
async function refreshRoute(){
  if(nativeRoute()){
    try{ const r=await nat('AudioRoute','getRoute'); applyRoute({output:r.output||'speaker',name:r.name||'',inputs:r.inputs||[],btConnected:!!r.bluetooth,source:'native'}); return ROUTE; }catch(e){}
  }
  // Browser fallback: device labels (available after mic permission) hint at headsets.
  try{
    const ds=await navigator.mediaDevices.enumerateDevices();
    const lab=d=>(d.label||'').toLowerCase();
    const bt=ds.find(d=>/bluetooth|airpods|buds|wh-|wf-|jbl|beats|sco|hands-?free/.test(lab(d)));
    const wired=ds.find(d=>/headset|headphone|wired|usb|earpods|lightning/.test(lab(d))&&!/speaker/.test(lab(d)));
    const outs=ds.filter(d=>d.kind==='audiooutput');
    applyRoute({output:bt?'bluetooth':wired?(/usb/.test(lab(wired))?'usb':'wired'):'speaker',name:(bt||wired||{}).label||'',
      inputs:ds.filter(d=>d.kind==='audioinput').map(d=>({id:d.deviceId,label:d.label||'Microphone',type:/bluetooth|sco|hands-?free/.test(lab(d))?'bluetooth':/headset|usb/.test(lab(d))?'headset':'builtin'})),
      btConnected:!!bt,source:outs.length?'browser':'browser'});
  }catch(e){}
  return ROUTE;
}
if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange',()=>refreshRoute());
if(nativeRoute()) try{ CAP.addListener('AudioRoute','routeChange',r=>applyRoute({output:r.output||'speaker',name:r.name||'',inputs:r.inputs||[],btConnected:!!r.bluetooth,source:'native'})); }catch(e){}
ROUTE.listeners.add((r,before)=>{
  if(before&&r.output!==before&&typeof stage!=='undefined'&&!stage.hidden) toast(r.output==='bluetooth'?'Bluetooth connected · timing adjusted':ROUTE_LABEL[r.output]+' · timing adjusted');
  if(typeof stageRouteUI==='function') stageRouteUI();
});
refreshRoute();

/* Mic preference: 'phone' keeps headphones on high-quality playback and records with the
   phone's own mic (what music apps do); 'headset' uses the headset mic (call quality on Bluetooth). */
const micPref=()=>S.settings.micPref||'phone';
/* Mic settings for a take. Voice-call noise suppression and auto-gain are always off:
   they treat music as noise and pump the level. Echo cancellation is on only when the
   recording plan asks for it (in-app music on the speaker, mixed digitally). */
function micConstraints(plan){
  const aec=plan?!!plan.aec:ROUTE.output==='speaker';
  const pref=micPref();
  const want=pref==='headset'&&ROUTE.inputs.find(i=>i.type==='bluetooth'||i.type==='headset');
  const builtin=ROUTE.inputs.find(i=>i.type==='builtin'&&i.id&&i.id!=='default');
  const a={ channelCount:{ideal:1}, sampleRate:{ideal:48000}, sampleSize:{ideal:16},
    echoCancellation:aec, noiseSuppression:false, autoGainControl:false };
  // Chrome-specific switches some WebViews still honour
  a.googEchoCancellation=aec; a.googNoiseSuppression=false; a.googAutoGainControl=false; a.googHighpassFilter=false;
  if(want&&want.id) a.deviceId={exact:want.id}; else if(pref==='phone'&&ROUTE.output==='bluetooth'&&builtin) a.deviceId={ideal:builtin.id};
  return a;
}
async function prepareMicRoute(){
  if(!nativeRoute()) return;
  try{ await nat('AudioRoute','preferMic',{mic:micPref()==='headset'?'headset':'phone'}); }catch(e){}
}
async function openMic(plan){
  await prepareMicRoute();
  let s;
  try{ s=await navigator.mediaDevices.getUserMedia({audio:micConstraints(plan),video:false}); }
  catch(e){ if(e&&(e.name==='OverconstrainedError'||e.name==='NotFoundError')) s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:plan?!!plan.aec:ROUTE.output==='speaker',noiseSuppression:false,autoGainControl:false},video:false}); else throw e; }
  // Some devices ignore "off" for their own processing; ask once more, then report what stuck.
  try{ const t=s.getAudioTracks()[0], st=t.getSettings(), want=plan?!!plan.aec:ROUTE.output==='speaker';
    if(st.noiseSuppression||st.autoGainControl||(st.echoCancellation&&!want)) await t.applyConstraints({echoCancellation:want,noiseSuppression:false,autoGainControl:false}).catch(()=>{}); }catch(e){}
  return s;
}
/* Is another app playing music right now? (Android only; null when unknown.) */
async function externalMusicActive(){ if(!nativeRoute()) return null; try{ const r=await nat('AudioRoute','isMusicActive'); return !!r.active; }catch(e){ return null; } }
async function releaseMicRoute(){ if(nativeRoute()) try{ await nat('AudioRoute','preferMic',{mic:'release'}); }catch(e){} }

/* Level meter for a live stream: peak in dBFS and a clip counter. */
function levelMeter(streamIn){
  const c=ac(); const src=c.createMediaStreamSource(streamIn); const an=c.createAnalyser(); an.fftSize=1024; src.connect(an);
  const buf=new Float32Array(an.fftSize); const m={peak:-90,rms:-90,clips:0,hold:0,stop(){ try{ src.disconnect(); }catch(e){} }};
  m.read=()=>{ an.getFloatTimeDomainData(buf); let p=0,s=0; for(let i=0;i<buf.length;i++){ const v=Math.abs(buf[i]); if(v>p) p=v; s+=buf[i]*buf[i]; }
    m.peak=p>0?20*Math.log10(p):-90; m.rms=20*Math.log10(Math.sqrt(s/buf.length)+1e-9); if(p>0.985){ m.clips++; m.hold=performance.now(); } return m; };
  return m;
}
$('#np').addEventListener('click',e=>{ if(e.target.closest('.np-x')){ e.stopPropagation(); AUDIO.active().filter(s=>!(s.here&&s.here())).forEach(s=>{ try{ s.stop(); }catch(_){} }); npRender(); return; } npSheet(); });
