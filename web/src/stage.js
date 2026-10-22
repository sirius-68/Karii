/* ================= Music sources for the stage ================= */
const bed={audio:new Audio(),url:'',id:null};
bed.audio.loop=true;
bed.audio.addEventListener('play',()=>AUDIO.claim('bed',['tts']));
AUDIO.register('bed',{label:()=>{ const x=bed.id&&CAT.get(bed.id); return x?x.title:'Music bed'; },sub:'Music bed',icon:'list-music',playing:()=>!bed.audio.paused,stop:()=>bed.audio.pause(),here:()=>!stage.hidden});
async function loadBed(id){
  if(bed.id===id) return; bed.audio.pause(); if(bed.url){ URL.revokeObjectURL(bed.url); bed.url=''; } bed.audio.removeAttribute('src'); bed.id=null;
  if(!id) return; const x=CAT.get(id); if(!x) return;
  try{ const b=await instBlob(x); bed.url=URL.createObjectURL(b); bed.audio.src=bed.url; bed.id=id; }catch(e){ toast('Couldn’t load that music bed. Are you online?'); S.settings.bed=null; SAVE.settings(); }
  bed.audio.volume=S.settings.bedVol/100;
}
function musicKey(it,guide){ if(it.kind==='line') return 'clip:'+it.id; if(it.cat) return 'cat:'+it.id+(guide?':g':''); const m=it.music||{}; return 'lib:'+it.id+':'+(m.type||'none')+':'+(m.id||m.name||(m.type==='click'?m.bpm+'/'+(m.beats||4)+'/'+Math.ceil(m.dur||0):''))+(m.type==='cat'&&guide?':g':''); }
const guideable=it=>it.kind==='song'&&(it.cat?it.layout.notes.length>0:(it.music&&it.music.type==='cat'&&CAT.get(it.music.id)&&CAT.get(it.music.id).layout.notes.length>0));
const voiceOf=it=>it.kind!=='line'?'me':it.cat?(S.settings.lineVoice&&S.settings.lineVoice[it.id])||'me':(it.voice||'me');
function setVoice(it,v){ if(it.cat){ S.settings.lineVoice=S.settings.lineVoice||{}; S.settings.lineVoice[it.id]=v; SAVE.settings(); } else { it.voice=v; SAVE.items(); } }
const hasClip=it=>!!(it&&it.clip);
const isTimed=it=>it.kind==='song'||(it.kind==='line'&&hasClip(it)&&['original','dub'].includes(voiceOf(it)));
async function loadTimedAudio(it){
  const t=(it.times||[]).filter(v=>v!=null), fb=(t.length?Math.max(...t):lyricLines(it.body).length*4)+8;
  if(it.kind==='line'){ await player.load(musicKey(it),()=>idb.get('clip:'+it.id),it.clip&&it.clip.dur||fb); return; }
  const g=guideable(it)&&S.settings.guide;
  if((it.cat||(it.music&&it.music.type==='cat')) && !BUFS.has(musicKey(it,g)) && !(await idb.has(musicKey(it,g)))) toast('Building the arrangement…');
  await player.load(musicKey(it,g),()=>musicBlobFor(it,g),fb);
}
async function timedBlob(it,forMix){
  if(it.kind==='line') return idb.get('clip:'+it.id);
  return musicBlobFor(it,forMix?false:(guideable(it)&&S.settings.guide));
}

/* ================= Stage ================= */
const stage=$('#stage'), cam=$('#cam'), scroller=$('#scroller'), textEl=$('#text'), promptEl=$('#prompt'), progFill=$('#progFill');
const karaEl=$('#kara'), karaWrap=$('#karaWrap'), karaList=$('#karaList'), karaHint=$('#karaHint'), pip=$('#pip');
[karaEl,karaWrap].forEach(el=>el.addEventListener('scroll',()=>{ el.scrollTop=0; }));
const FOCUS_MIN=0.10, FOCUS_MAX=0.80, FOCUS_DEF=0.30;
let A=null, stream=null, camOK=false, recorder=null, chunks=[], mime='';
let state='idle', rehearsing=false, pos=0, lastT=0, raf=0, tweening=false, songMode=false, narrMode=false;
let elapsed=0, tStart=0, clockT=0, wake=null, stageStart=0, wasPlaying=false, pipUrl='';
const K={lines:[],els:[],words:[],t:[],e:[],wt:[],idx:-2};
const offsetOf=()=>A.cat?(S.settings.offsets[A.id]||0):(+A.offset||0);

function renderText(){
  textEl.innerHTML=''; textEl.classList.toggle('poem',A.kind==='poem');
  const paras=bodyOf(A).replace(/\r/g,'').split(/\n\s*\n/).map(p=>p.replace(/^\n+|\n+$/g,'').replace(/[ \t]+$/gm,'')).filter(p=>p.trim());
  paras.forEach(p=>{
    const el=document.createElement('p'); let say='';
    (A.kind==='poem'?p:p.trim().replace(/\n/g,' ')).split(/(\[[^\]]*\])/).forEach(part=>{ if(!part) return;
      if(/^\[[^\]]*\]$/.test(part)){ const sp=document.createElement('span'); sp.className='cue'; sp.textContent=part; el.appendChild(sp); say+=' '; return; }
      part.split(/(\s+)/).forEach(tok=>{ if(!tok) return; if(/^\s+$/.test(tok)){ el.appendChild(document.createTextNode(tok)); say+=tok.includes('\n')?' ':tok; return; }
        const w=document.createElement('span'); w.className='nw'; w.dataset.c=say.length; w.textContent=tok; el.appendChild(w); say+=tok; }); });
    el.dataset.say=say; textEl.appendChild(el);
  });
  const end=document.createElement('p'); end.className='end'; end.textContent=A.kind==='poem'?'—':A.kind==='line'?'Scene':'End of script'; textEl.appendChild(end);
}
function fillTimes(times,n){
  const t=Array.from({length:n},(_,i)=>(times&&times[i]!=null&&isFinite(times[i]))?+times[i]:null);
  const known=t.map((v,i)=>v!=null?i:-1).filter(i=>i>=0);
  if(!known.length){ const d=player.duration()||n*4; for(let i=0;i<n;i++) t[i]=d*0.04+i*(d*0.9/Math.max(1,n)); return {t,synced:false}; }
  for(let i=0;i<known[0];i++) t[i]=Math.max(0,t[known[0]]-(known[0]-i)*3);
  for(let k=0;k<known.length-1;k++){ const a=known[k],b=known[k+1]; for(let i=a+1;i<b;i++) t[i]=t[a]+(t[b]-t[a])*(i-a)/(b-a); }
  const last=known[known.length-1]; for(let i=last+1;i<n;i++) t[i]=t[last]+(i-last)*3.5;
  for(let i=1;i<n;i++) if(t[i]<=t[i-1]) t[i]=t[i-1]+0.05;
  return {t,synced:true};
}
function buildKara(){
  K.lines=lyricLines(bodyOf(A)); karaList.innerHTML=''; K.els=[]; K.words=[]; K.idx=-2;
  $('#karaEmpty').hidden=!!K.lines.length;
  const ft=fillTimes(A.times,K.lines.length); K.t=ft.t; K.e=(A.ends||[]).slice(0,K.lines.length);
  K.wt=K.lines.map((l,i)=>{ const w=A.wt&&A.wt[i]; return w&&w.length===lineWords(l).length&&A.times&&A.times[i]!=null?cleanWordTimes(lineWords(l),w,K.t[i+1]):null; });
  K.lines.forEach((line,i)=>{
    const el=document.createElement('div'); el.className='kl'; el.dataset.i=i; el.dataset.text=line;
    const words=[]; let acc=0; const L=line.length||1;
    line.split(/(\s+)/).forEach(part=>{ if(!part) return;
      if(/^\s+$/.test(part)){ el.appendChild(document.createTextNode(part)); acc+=part.length; return; }
      const w=document.createElement('span'); w.className='kw'; w.textContent=part; el.appendChild(w);
      words.push({el:w,a:acc/L,b:(acc+part.length)/L}); acc+=part.length; });
    karaList.appendChild(el); K.els.push(el); K.words.push(words);
  });
  return ft.synced;
}
/* Word timestamps from speech recognition can stretch a word across a pause or put two
   words on top of each other, which made the highlight crawl and then jump. Keep them in
   order and give each word a believable length for its syllables. */
function cleanWordTimes(words,wt,nextLine){
  const out=wt.map(x=>({s:+x.s,e:+x.e})); const n=out.length;
  for(let k=0;k<n;k++){
    if(!isFinite(out[k].s)) out[k].s=k?out[k-1].e:0;
    if(k&&out[k].s<out[k-1].s+0.04) out[k].s=out[k-1].s+0.04;
    if(!isFinite(out[k].e)||out[k].e<out[k].s+0.08) out[k].e=out[k].s+0.08;
  }
  for(let k=0;k<n;k++){
    const syl=Math.max(1,syllables(words[k]||'')), last=k===n-1;
    const cap=last?Math.min(2.6,0.35+syl*0.45):Math.min(1.4,0.2+syl*0.32);
    let e=Math.min(out[k].e,out[k].s+cap);
    if(!last) e=Math.min(e,out[k+1].s); else if(nextLine!=null) e=Math.min(e,nextLine-0.05);
    out[k].e=Math.max(out[k].s+0.06,e);
  }
  return out;
}
function lineEnd(i){
  const st=K.t[i], nx=K.t[i+1];
  if(K.wt[i]&&K.wt[i].length) return Math.max(st+0.2,K.wt[i][K.wt[i].length-1].e);
  if(K.e[i]!=null&&K.e[i]>st) return nx!=null?Math.min(K.e[i],nx-0.02):K.e[i];
  const syl=lineWords(K.lines[i]).reduce((a,w)=>a+syllables(w),0), cap=st+Math.max(1.4,syl*0.38+0.4);
  return Math.max(nx!=null?Math.min(nx-0.05,cap):Math.min(cap,player.duration()||cap),st+0.3);
}
function placeKara(idx){ const el=K.els[Math.max(0,idx)]; if(!el) return; karaEl.scrollTop=0; karaWrap.scrollTop=0; karaList.style.transform='translateY('+(karaEl.clientHeight*0.42-(el.offsetTop+el.offsetHeight/2))+'px)'; }
function updateKara(){
  if(!K.lines.length) return;
  const t=player.time()+offsetOf(), n=K.lines.length;
  let idx=-1; for(let i=0;i<n;i++){ if(K.t[i]<=t) idx=i; else break; }
  const le=idx>=0?lineEnd(idx):0;
  // after a line has finished and the next one is far away, move the highlight to the upcoming line
  let show=idx; if(idx>=0&&idx<n-1&&t>le+0.6&&K.t[idx+1]-t<2.2) show=idx+1;
  if(show!==K.idx){ K.els.forEach((el,i)=>{ el.classList.toggle('now',i===show); el.classList.toggle('past',i<show); if(i!==show) K.words[i].forEach(w=>{ const q=i<idx+(show===idx?0:1)?1:0; if(w.p!==q){ w.p=q; w.el.style.setProperty('--p',q); } }); }); K.idx=show; placeKara(show); }
  if(show>=0&&show===idx){
    const W=K.wt[idx];
    // Only touch words whose fill changed (each style write repaints the line).
    const setP=(w,p)=>{ const q=Math.round(p*50)/50; if(w.p!==q){ w.p=q; w.el.style.setProperty('--p',q); } };
    if(W) K.words[idx].forEach((w,k)=>{ const s=W[k].s, e=Math.max(s+0.05,W[k].e); setP(w,clamp01((t-s)/(e-s))); });
    else { const st=K.t[idx], f=clamp01((t-st)/(le-st)); K.words[idx].forEach(w=>setP(w,clamp01((f-w.a)/Math.max(0.0001,w.b-w.a)))); }
  }
  // countdown dots before a late entry
  const next=idx+1;
  if(next<n){ const gapStart=idx>=0?le:0, rem=K.t[next]-t, gap=K.t[next]-gapStart;
    if(gap>3.6&&rem>0&&rem<3.3&&t>gapStart){ karaHint.hidden=false; const lit=Math.ceil(rem); karaHint.innerHTML='<span class="cd">'+[0,1,2].map(k=>`<i class="${k<lit?'on':''}"></i>`).join('')+'</span>'; return; }
    if(idx===-1&&rem>3.3){ karaHint.hidden=false; karaHint.innerHTML=ic('eighth-notes','xs')+'Intro · first line in '+Math.ceil(rem)+'s'; return; } }
  karaHint.hidden=true;
}
karaList.addEventListener('click',e=>{ const el=e.target.closest('.kl'); if(!el||state!=='idle') return; player.seek(Math.max(0,K.t[+el.dataset.i]-offsetOf()-0.4)); K.idx=-2; updateKara(); syncUI(); });

function applyStyle(){
  stage.style.setProperty('--fs',S.settings.size+'px');
  textEl.style.opacity=karaList.style.opacity=S.settings.opac/100;
  textEl.classList.toggle('mirror',S.settings.mirrorText); karaList.classList.toggle('mirror',S.settings.mirrorText);
  cam.classList.toggle('mirror',S.settings.mirrorCam&&S.settings.facing==='user');
  promptEl.classList.toggle('backdrop',S.settings.backdrop); karaEl.classList.toggle('backdrop',S.settings.backdrop);
  layout(); if(songMode) requestAnimationFrame(()=>placeKara(K.idx));
}
function layout(){ const h=scroller.clientHeight; S.settings.focus=Math.min(FOCUS_MAX,Math.max(FOCUS_MIN,+S.settings.focus||FOCUS_DEF)); promptEl.style.setProperty('--focus',(S.settings.focus*100)+'%'); textEl.style.paddingTop=(h*S.settings.focus)+'px'; textEl.style.paddingBottom=(h*0.9)+'px'; }
function setFocus(f){ f=Math.round(Math.min(FOCUS_MAX,Math.max(FOCUS_MIN,f))*200)/200; const h=scroller.clientHeight,d=(f-S.settings.focus)*h; S.settings.focus=f; promptEl.style.setProperty('--focus',(f*100)+'%'); textEl.style.paddingTop=(h*f)+'px'; if(d){ pos=clampPos(pos+d); scroller.scrollTop=pos; } syncTune(); }
const maxPos=()=>Math.max(0,scroller.scrollHeight-scroller.clientHeight);
const clampPos=v=>Math.min(maxPos(),Math.max(0,v));
const pxPerSec=()=>S.settings.speed*S.settings.size*0.12*(A&&A.kind==='poem'?0.8:1);
const scrolling=()=>songMode?player.playing():narrMode&&TTS.on?true:(rehearsing||state==='recording');
function bedSync(){ if(songMode||!bed.id) return; const want=rehearsing||state==='recording'||TTS.on; if(want&&bed.audio.paused) bed.audio.play().catch(()=>{}); else if(!want&&!bed.audio.paused) bed.audio.pause(); }

/* narrator (text to speech with word highlight) */
function narratorStart(){
  if(!('speechSynthesis' in window)){ toast('Text-to-speech isn’t available in this browser'); return; }
  speechSynthesis.cancel(); AUDIO.claim('tts',['bed']); TTS.on=true; const ps=$$('#text p:not(.end)');
  let i=ps.findIndex(p=>p.offsetTop+p.offsetHeight>pos+scroller.clientHeight*S.settings.focus); if(i<0) i=0;
  speakPara(ps,i); bedSync(); syncUI();
}
function narratorStop(){ TTS.on=false; try{ speechSynthesis.cancel(); }catch(e){} $$('#text .nw.on').forEach(x=>x.classList.remove('on')); bedSync(); syncUI(); }
function speakPara(ps,i){
  if(!TTS.on) return; const p=ps[i]; if(!p){ narratorStop(); return; }
  const say=p.dataset.say||''; if(!say.trim()){ speakPara(ps,i+1); return; }
  tweenTo(p.offsetTop-scroller.clientHeight*S.settings.focus+S.settings.size*0.2);
  const u=new SpeechSynthesisUtterance(say); const v=pickVoice(); if(v){ u.voice=v; u.lang=v.lang; } u.rate=S.settings.ttsRate||1; u.pitch=1;
  const spans=[...p.querySelectorAll('.nw')];
  u.onboundary=e=>{ if(e.name&&e.name!=='word') return; let hit=null; for(const s of spans){ if(+s.dataset.c<=e.charIndex) hit=s; else break; } spans.forEach(s=>s.classList.toggle('on',s===hit)); };
  u.onend=()=>{ spans.forEach(s=>s.classList.remove('on')); if(TTS.on) setTimeout(()=>speakPara(ps,i+1),S.settings.ttsGap??350); };
  u.onerror=()=>{ if(TTS.on) speakPara(ps,i+1); };
  speechSynthesis.speak(u);
}

function syncPip(){
  if(pip.hidden||!pip.src) return;
  const t=player.time(), pl=player.playing();
  if(Math.abs((pip.currentTime||0)-t)>0.25) try{ pip.currentTime=t; }catch(e){}
  if(pl&&pip.paused) pip.play().catch(()=>{}); else if(!pl&&!pip.paused) pip.pause();
}
const FW={n:0,slow:0};
function tick(t){
  if(!lastT) lastT=t;
  const dt=Math.min(0.1,(t-lastT)/1000); lastT=t;
  // If this phone can't keep up (long frames while playing), drop the costly visual effects
  // so the highlight keeps pace with the music instead of stalling.
  if(songMode&&player.playing()&&!stage.classList.contains('lite')){ FW.n++; if(dt>0.034) FW.slow++; if(FW.n>=90){ if(FW.slow>30){ stage.classList.add('lite'); } FW.n=FW.slow=0; } }
  if(songMode){
    if(!player.hasAudio&&player.vPlaying&&player.time()>=player.vDur) player.pause();
    updateKara(); syncPip();
    const d=player.duration(); progFill.style.transform='scaleX('+(d?Math.min(1,player.time()/d):0)+')';
    const pl=player.playing();
    if(pl!==wasPlaying){ if(!pl&&state==='recording'&&player.time()>=d-0.3) toast('That’s the end. Press stop when you’re done.'); syncUI(); }
    wasPlaying=pl;
    if(state==='idle') $('#clock').textContent=fmt(player.time());
  } else {
    if(scrolling()&&!tweening&&!(narrMode&&TTS.on)){ pos=clampPos(pos+pxPerSec()*dt); scroller.scrollTop=pos;
      if(pos>=maxPos()-0.5&&maxPos()>0){ if(rehearsing){ rehearsing=false; bedSync(); } if(state==='recording') toast('That’s the end. Press stop when you’re done.'); syncUI(); } }
    const mp=maxPos(); progFill.style.transform='scaleX('+(mp?pos/mp:0)+')';
  }
  raf=requestAnimationFrame(tick);
}
function tweenTo(target){ target=clampPos(target); const from=pos,t0=performance.now(),dur=320; tweening=true; (function step(now){ const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3); pos=from+(target-from)*e; scroller.scrollTop=pos; if(k<1) requestAnimationFrame(step); else tweening=false; })(t0); }

let drag=null;
promptEl.addEventListener('pointerdown',e=>{ drag={y0:e.clientY,p0:pos,moved:false}; promptEl.setPointerCapture(e.pointerId); tweening=false; });
promptEl.addEventListener('pointermove',e=>{ if(!drag) return; const dy=e.clientY-drag.y0; if(Math.abs(dy)>6) drag.moved=true; if(drag.moved){ pos=clampPos(drag.p0-dy); scroller.scrollTop=pos; } });
promptEl.addEventListener('pointerup',e=>{ if(drag&&!drag.moved){ const r=promptEl.getBoundingClientRect(),lh=S.settings.size*1.45; tweenTo(pos+(e.clientY-r.top)-r.height*S.settings.focus-lh/2); } drag=null; });
promptEl.addEventListener('pointercancel',()=>drag=null);
promptEl.addEventListener('wheel',e=>{ e.preventDefault(); pos=clampPos(pos+e.deltaY); scroller.scrollTop=pos; },{passive:false});

async function startCamera(){
  stopCamera(); $('#nocam').hidden=true;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) return noCam(window.isSecureContext===false?'The camera needs a secure page (https or localhost). You can still rehearse.':'This browser can’t access the camera. You can still rehearse.');
  try{
    const v={facingMode:S.settings.facing,width:{ideal:1280},height:{ideal:720}};
    // Video only: opening the mic here would switch the phone into call-audio mode while
    // you sing along (lower quality, Bluetooth drops to call profile, clock hiccups).
    // The mic opens at the countdown instead.
    try{ stream=await navigator.mediaDevices.getUserMedia({video:v,audio:false}); }
    catch(e1){ if(e1&&e1.name==='OverconstrainedError') stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false}); else throw e1; }
    stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{ if(state==='recording'){ pauseToggle(); toast('The camera was interrupted, so recording paused'); } }));
    if(stage.hidden){ stopCamera(); return; }
    cam.srcObject=stream; cam.play().catch(()=>{}); camOK=true; $('#camBtn').hidden=true; applyStyle(); syncUI();
  }catch(err){
    let msg='Camera or microphone access was blocked. Allow it in your browser’s site settings, then tap Turn on camera. You can still rehearse.';
    if(err&&err.name==='NotFoundError') msg='No camera was found on this device. You can still rehearse'+(songMode?' and sing along.':'.');
    else if(err&&err.name==='NotReadableError') msg='The camera is busy in another app. Close it, then tap Turn on camera.';
    if(window.self!==window.top) msg+=' This page is embedded, which many browsers block. Open it in its own tab.';
    noCam(msg);
  }
}
function noCam(msg){ camOK=false; $('#nocamMsg').textContent=msg; $('#nocam').hidden=false; $('#camBtn').hidden=false; syncUI(); }
function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } cam.srcObject=null; camOK=false; }
async function lockScreen(){ try{ if(navigator.wakeLock) wake=await navigator.wakeLock.request('screen'); }catch(e){} }
function unlockScreen(){ try{ if(wake){ wake.release(); wake=null; } }catch(e){} }

/* Raw takes record as WebM where possible: it streams out a chunk every second, so a take
   survives a crash. Finished videos prefer MP4, which every gallery and chat app plays. */
function pickMime(forExport){ if(!window.MediaRecorder) return null;
  const mp4=['video/mp4;codecs=avc1,mp4a.40.2','video/mp4'], webm=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
  return (forExport?[...mp4,...webm]:[...webm,...mp4]).find(t=>MediaRecorder.isTypeSupported(t))||''; }
function countdown(n){ return new Promise(res=>{ const el=$('#count'); if(n<=0){ res(); return; } el.hidden=false; let i=n; el.textContent=i; const iv=setInterval(()=>{ if(state!=='counting'){ clearInterval(iv); el.hidden=true; res(); return; } i--; if(i<=0){ clearInterval(iv); el.hidden=true; res(); } else el.textContent=i; },1000); }); }
let mic=null, meter=null, meterRaf=0, recStartPerf=0, musicOffset=0, musicMarked=false;
async function startRecording(){
  if(!camOK){ toast('The camera isn’t available, so you can only rehearse.'); return; }
  const m=pickMime(); if(m===null){ toast('This device can’t record video.'); return; }
  if(!(await audioCheck())) return;
  if(TTS.on){ narratorStop(); toast('The narrator pauses while you record'); }
  if(songMode){ ac().resume(); player.pause(); player.seek(0); K.idx=-2; updateKara(); }
  else { bed.audio.pause(); try{ bed.audio.currentTime=0; }catch(e){} }
  rehearsing=false; state='counting'; pos=0; scroller.scrollTop=0; syncUI();
  // Open the mic now, so any audio-route switch settles during the countdown, not mid-song.
  try{ mic=await openMic(); }catch(e){ mic=null; }
  if(state!=='counting'){ closeMic(); return; }
  if(!mic) toast('Microphone unavailable, so this take will have no voice');
  else { mic.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{ if(state==='recording'){ pauseToggle(); toast('The microphone was interrupted, so recording paused'); } })); startMeter(); }
  showRouteLine(true);
  await countdown(S.settings.countdown);
  showRouteLine(false);
  if(state!=='counting'){ closeMic(); return; }
  mime=m; chunks=[]; musicOffset=0; musicMarked=false;
  const tracks=[...stream.getVideoTracks(),...(mic?mic.getAudioTracks():[])];
  try{ recorder=new MediaRecorder(new MediaStream(tracks),m?{mimeType:m,videoBitsPerSecond:6000000,audioBitsPerSecond:160000}:undefined); }
  catch(e){ try{ recorder=new MediaRecorder(new MediaStream(tracks)); }catch(e2){ state='idle'; closeMic(); syncUI(); toast('Couldn’t start recording on this device.'); return; } }
  liveBegin({itemId:A.id,title:titleOf(A),kind:A.kind,mime:(m||'video/webm').split(';')[0],musicVol:songMode?1:S.settings.bedVol/100});
  recorder.ondataavailable=e=>{ if(e.data&&e.data.size){ chunks.push(e.data); liveChunk(e.data); } };
  recorder.onstop=onRecorded;
  recorder.onerror=()=>{ toast('Recording hit a problem. Saving what was captured.'); try{ if(recorder.state!=='inactive') recorder.stop(); }catch(e){} };
  recStartPerf=performance.now();
  // The video's timeline starts when start() is called; mark where the music lands on it.
  recorder.onstart=()=>{ if(songMode) markMusicStart(); };
  recorder.start(1000);
  if(songMode) player.play();
  elapsed=0; tStart=performance.now(); state='recording'; lockScreen(); bedSync(); syncUI();
  clockT=setInterval(drawClock,250);
  if(songMode) requestAnimationFrame(markMusicStart);
}
/* Where the music's first beat lands in the video: when playback was scheduled, plus the
   output delay before it reaches the singer's ears. The editor lines the clean music up to it. */
function markMusicStart(){
  if(musicMarked||!player.on) return;
  const c=ac(); const startPerf=performance.now()+(player.t0-c.currentTime)*1000;
  musicOffset=Math.max(0,Math.min(2,(startPerf-recStartPerf)/1000+outLat()+extraLatency()-player.off));
  musicMarked=true;
  store.set('lectern.live',{...(store.get('lectern.live',{})||{}),musicOffset});
}
function closeMic(){ stopMeter(); if(mic){ mic.getTracks().forEach(t=>t.stop()); mic=null; } releaseMicRoute(); }
function startMeter(){
  stopMeter(); try{ meter=levelMeter(mic); }catch(e){ meter=null; return; }
  const bar=$('#lvl'), fill=$('#lvlFill'); bar.hidden=false; let warned=0;
  const loop=()=>{ if(!meter) return; meter.read(); const v=Math.max(0,Math.min(1,(meter.peak+54)/54)); fill.style.transform='scaleX('+v.toFixed(3)+')';
    const hot=performance.now()-meter.hold<700; bar.classList.toggle('hot',hot);
    if(meter.clips>25&&performance.now()-warned>12000&&state==='recording'){ warned=performance.now(); meter.clips=0; toast('Your voice is clipping. Move the phone a little further away.'); }
    meterRaf=requestAnimationFrame(loop); };
  meterRaf=requestAnimationFrame(loop);
}
function stopMeter(){ cancelAnimationFrame(meterRaf); if(meter){ meter.stop(); meter=null; } const bar=$('#lvl'); if(bar) bar.hidden=true; }
function showRouteLine(on){
  const el=$('#routeLine'); if(!el) return;
  if(!on){ el.hidden=true; return; }
  const micLbl=!mic?'No microphone':micPref()==='headset'&&ROUTE.output!=='speaker'?'Headset mic':'Phone mic';
  el.innerHTML=`${ic(ROUTE_ICON[ROUTE.output]||'volume-2','xs')}${esc(ROUTE.name&&ROUTE.output!=='speaker'?ROUTE.name:ROUTE_LABEL[ROUTE.output])}<span>·</span>${ic('mic','xs')}${micLbl}`;
  el.hidden=false;
}
function stopRecording(){
  if(state==='counting'){ state='idle'; closeMic(); showRouteLine(false); syncUI(); return; }
  if(state==='recording') elapsed+=performance.now()-tStart;
  if(recorder&&recorder.state!=='inactive') recorder.stop();
  if(songMode) player.pause();
  state='idle'; clearInterval(clockT); unlockScreen(); bedSync(); closeMic(); syncUI();
}
function pauseToggle(){
  if(state==='recording'){ try{ recorder.pause(); }catch(e){} elapsed+=performance.now()-tStart; state='paused'; if(songMode) player.pause(); else bed.audio.pause(); }
  else if(state==='paused'){ try{ recorder.resume(); }catch(e){} tStart=performance.now(); state='recording'; if(songMode) player.play(); else bedSync(); }
  else if(state==='counting') return;
  else if(songMode){ ac().resume(); player.playing()?player.pause():player.play(); }
  else if(narrMode){ TTS.on?narratorStop():narratorStart(); }
  else { rehearsing=!rehearsing; bedSync(); }
  syncUI();
}
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&state==='recording'){ pauseToggle(); } });
async function onRecorded(){
  const type=(recorder.mimeType||mime||'video/webm').split(';')[0];
  const blob=new Blob(chunks,{type});
  const captions=songMode?K.lines.map((l,i)=>({t:K.t[i]-offsetOf(),e:lineEnd(i)-offsetOf(),text:l,w:K.wt[i]?K.wt[i].map(x=>({s:x.s-offsetOf(),e:x.e-offsetOf()})):null})):[];
  let music=null, mvol=0.8;
  try{
    if(songMode){ if(A.kind==='line'){ if(voiceOf(A)==='original'){ music=await timedBlob(A,true); mvol=1; } } else music=await timedBlob(A,true); }
    else if(bed.id){ music=await instBlob(CAT.get(bed.id)); mvol=S.settings.bedVol/100; }
  }catch(e){}
  S.stats.days=[...new Set([...S.stats.days,today()])].slice(-120); SAVE.stats();
  const meta={title:titleOf(A),itemId:A.id,kind:A.kind,dur:elapsed/1000,captions,music,musicVol:mvol,musicOffset:songMode?musicOffset:0};
  // Save the take as a draft before anything else, then drop the crash-recovery chunks.
  const d=await createDraft(blob,meta,music); await liveEnd();
  openStudio(blob,meta,{draftId:d.id});
}
function drawClock(){ const ms=elapsed+(state==='recording'?performance.now()-tStart:0); $('#clock').textContent=fmt(ms/1000); }
function syncUI(){
  const recActive=state==='recording'||state==='paused'||state==='counting';
  $('#rec').classList.toggle('on',recActive); $('#recLbl').textContent=recActive?'Stop':'Record';
  $('#rec').setAttribute('aria-label',recActive?'Stop recording':'Record'); $('#rec').disabled=!camOK&&!recActive;
  $('#playIc').innerHTML=scrolling()?ic('pause','fill'):ic(narrMode&&!songMode?'audio-lines':'play',narrMode&&!songMode?'':'fill');
  $('#playLbl').textContent=state==='recording'||state==='paused'?(state==='paused'?'Resume':'Pause'):songMode?(player.playing()?'Pause':'Play'):narrMode?(TTS.on?'Stop':'Narrate'):(rehearsing?'Pause':'Rehearse');
  $('#playBtn').setAttribute('aria-pressed',String(state==='paused'));
  $('#flipBtn').disabled=recActive;
  $('#dot').className='dot'+(state==='recording'?' live':state==='paused'?' paused':'');
  if(state==='idle') $('#clock').textContent=songMode?fmt(player.time()):(elapsed?fmt(elapsed/1000):'0:00');
  $('#backBtn').disabled=recActive; $('#rewLbl').textContent=songMode?'Restart':'Top';
  $('#rewBtn').disabled=recActive; $('#pausedBanner').hidden=state!=='paused';
  $('#playBtn').classList.toggle('recpause',state==='recording'||state==='paused');
}
function syncTune(){
  const st=S.settings;
  $('#speed').value=st.speed; $('#speedO').textContent=st.speed;
  $('#size').value=st.size; $('#sizeO').textContent=st.size;
  $('#opac').value=st.opac; $('#opacO').textContent=st.opac+'%';
  const fp=Math.round(st.focus*100); $('#focusSl').value=fp; $('#focusO').textContent=fp+'%'; $('#handle').setAttribute('aria-valuenow',fp);
  if(A){ const off=offsetOf(); $('#offs').value=off; $('#offsO').textContent=(off>0?'+':'')+off.toFixed(2)+'s';
    const v=voiceOf(A); $$('#voiceSeg button').forEach(b=>{ b.setAttribute('aria-pressed',String(b.dataset.v===v)); b.disabled=(b.dataset.v==='original'||b.dataset.v==='dub')&&!hasClip(A); }); }
  $('#guideTg').setAttribute('aria-checked',String(!!st.guide));
  const b=st.bed&&CAT.get(st.bed); $('#bedName').textContent=b?b.title:'None'; $('#bedVolRow').hidden=!b;
  $('#bedVol').value=st.bedVol; $('#bedVolO').textContent=st.bedVol+'%';
  $('#ttsRate').value=st.ttsRate||1; $('#ttsRateO').textContent=(st.ttsRate||1).toFixed(2)+'×';
  $$('#cdSeg button').forEach(x=>x.setAttribute('aria-pressed',String(+x.dataset.v===st.countdown)));
  $('#mText').setAttribute('aria-pressed',String(st.mirrorText)); $('#mCam').setAttribute('aria-pressed',String(st.mirrorCam)); $('#bdrop').setAttribute('aria-pressed',String(st.backdrop));
}
function bindRange(id,key){ $(id).addEventListener('input',e=>{ const keep=key==='size'&&maxPos()>0?pos/maxPos():null; S.settings[key]=+e.target.value; syncTune(); applyStyle(); SAVE.settings(); if(keep!==null){ pos=clampPos(keep*maxPos()); scroller.scrollTop=pos; } }); }
bindRange('#speed','speed'); bindRange('#size','size'); bindRange('#opac','opac');
$('#focusSl').addEventListener('input',e=>{ setFocus(+e.target.value/100); SAVE.settings(); });
$('#offs').addEventListener('input',e=>{ const v=+e.target.value; if(A.cat){ S.settings.offsets[A.id]=v; SAVE.settings(); } else { A.offset=v; SAVE.items(); } syncTune(); K.idx=-2; updateKara(); });
$('#bedVol').addEventListener('input',e=>{ S.settings.bedVol=+e.target.value; bed.audio.volume=S.settings.bedVol/100; SAVE.settings(); syncTune(); });
$('#ttsRate').addEventListener('input',e=>{ S.settings.ttsRate=+e.target.value; SAVE.settings(); syncTune(); });
$('#guideTg').onclick=async()=>{ if(state!=='idle'){ toast('Stop recording to change this'); return; } S.settings.guide=!S.settings.guide; SAVE.settings(); syncTune(); const t=player.time(), was=player.playing(); await loadTimedAudio(A); player.seek(t); if(was) player.play(); toast(S.settings.guide?'Guide vocal on':'Guide vocal off'); };
$('#voiceSeg').addEventListener('click',async e=>{ const b=e.target.closest('button'); if(!b||b.disabled||state!=='idle') return; setVoice(A,b.dataset.v); narratorStop(); const it=A; closeStage(true); await openStage(it); setTune(true);
  toast({me:'Your voice: the prompter follows your pace',original:'Original audio plays and is mixed into your take',dub:'Dub mode: the clip runs silently so you can voice it',narrator:'Narrator reads the lines aloud for practice'}[b.dataset.v]); });
$('#bedBtn').onclick=()=>actionSheet('Music bed',[{icon:'x',label:'None',sub:S.settings.bed?'':'Selected',run:()=>{ S.settings.bed=null; SAVE.settings(); loadBed(null); syncTune(); }},...allInst().map(x=>({icon:'audio-waveform',label:x.title+(S.settings.bed===x.id?' ✓':''),sub:x.mood+' · '+fmt(x.dur)+(x.embed||x.user?' · offline':''),run:async()=>{ S.settings.bed=x.id; SAVE.settings(); syncTune(); await loadBed(x.id); bedSync(); toast('“'+x.title+'” will play while you read'); }}))],'Plays under your reading and is mixed into your take in the editor.');
const handle=$('#handle'); let fd=null;
handle.addEventListener('pointerdown',e=>{ e.stopPropagation(); fd={y0:e.clientY,f0:S.settings.focus}; handle.setPointerCapture(e.pointerId); });
handle.addEventListener('pointermove',e=>{ if(!fd) return; setFocus(fd.f0+(e.clientY-fd.y0)/scroller.clientHeight); });
const endFD=()=>{ if(fd){ fd=null; SAVE.settings(); } }; handle.addEventListener('pointerup',endFD); handle.addEventListener('pointercancel',endFD);
handle.addEventListener('dblclick',()=>{ setFocus(FOCUS_DEF); SAVE.settings(); toast('Focus point reset'); });
handle.addEventListener('keydown',e=>{ if(e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); e.stopPropagation(); setFocus(S.settings.focus+(e.key==='ArrowUp'?-0.02:0.02)); SAVE.settings(); } });
$$('#cdSeg button').forEach(b=>b.onclick=()=>{ S.settings.countdown=+b.dataset.v; syncTune(); SAVE.settings(); });
$('#mText').onclick=()=>{ S.settings.mirrorText=!S.settings.mirrorText; syncTune(); applyStyle(); SAVE.settings(); };
$('#mCam').onclick=()=>{ S.settings.mirrorCam=!S.settings.mirrorCam; syncTune(); applyStyle(); SAVE.settings(); };
$('#bdrop').onclick=()=>{ S.settings.backdrop=!S.settings.backdrop; syncTune(); applyStyle(); SAVE.settings(); };
function setTune(open){ $('#tune').hidden=!open; $('#tuneBtn').setAttribute('aria-pressed',String(open)); }
$('#tuneBtn').onclick=()=>setTune($('#tune').hidden); $('#tuneClose').onclick=()=>setTune(false);
$('#rec').onclick=()=>{ state==='idle'?startRecording():stopRecording(); };
$('#playBtn').onclick=pauseToggle;
$('#rewBtn').onclick=()=>{ if(songMode){ if(state==='idle'){ player.seek(0); K.idx=-2; updateKara(); syncUI(); } } else { if(TTS.on) narratorStop(); tweenTo(0); } };
$('#camBtn').onclick=()=>startCamera();
$('#routeBtn').onclick=async()=>{ await refreshRoute(); stageRouteUI(); audioSheet(false); };
$('#flipBtn').onclick=async()=>{ S.settings.facing=S.settings.facing==='user'?'environment':'user'; SAVE.settings(); await startCamera(); };

async function openStage(it){
  A=it;
  if(!bodyOf(A).trim()){ toast(A.kind==='song'?'Add some lyrics first.':'Write something first.'); return; }
  songMode=isTimed(A); narrMode=!songMode&&voiceOf(A)==='narrator';
  stage.classList.toggle('song',songMode); stage.classList.toggle('catsong',songMode&&guideable(A)); stage.classList.toggle('linek',A.kind==='line'); stage.classList.toggle('narr',narrMode);
  stage.hidden=false; document.body.style.overflow='hidden'; stage.classList.remove('lite'); FW.n=FW.slow=0;
  elapsed=0; rehearsing=false; state='idle'; setTune(false); wasPlaying=false; stageStart=performance.now(); TTS.on=false;
  ac().resume().catch(()=>{});
  refreshRoute().then(stageRouteUI);
  syncTune(); syncUI();
  pip.hidden=true; if(pipUrl){ URL.revokeObjectURL(pipUrl); pipUrl=''; } pip.removeAttribute('src');
  if(songMode){
    karaList.innerHTML=''; $('#karaEmpty').hidden=true;
    await loadTimedAudio(A); player.pause(); player.seek(0);
    playerOwner({label:titleOf(A),sub:'Stage',icon:'mic-vocal',here:()=>!stage.hidden});
    player.setVolume(A.kind==='line'&&voiceOf(A)==='dub'?0:1);
    const synced=buildKara();
    if(A.kind==='line'&&A.clip&&A.clip.type==='video'){ const b=await idb.get('clip:'+A.id); if(b){ pipUrl=URL.createObjectURL(b); pip.src=pipUrl; pip.muted=true; pip.hidden=false; } }
    if(typeof JOB!=='undefined'&&JOB.state==='run') toast('AI sync is still working in the background, so playback may stutter until it finishes.');
    else if(!synced&&K.lines.length) toast(player.hasAudio?'Not synced yet, so lines are spread evenly. Try Auto-sync in the editor.':'No music or timing yet. Lines advance every few seconds.');
    else if(!player.hasAudio) toast('No audio attached. Press Play when your track starts.');
  } else {
    player.setVolume(1);
    renderText(); if(S.settings.bed) loadBed(S.settings.bed);
    if(narrMode) setTimeout(()=>toast('Tap Narrate to hear the lines read aloud'),500);
    else if(!store.get('lectern.focusHint',false)){ store.set('lectern.focusHint',true); setTimeout(()=>toast('Drag the white tab to move your focus point'),700); }
  }
  applyStyle(); pos=0; scroller.scrollTop=0; syncUI();
  if(songMode){ K.idx=-2; updateKara(); }
  startCamera();
  lastT=0; cancelAnimationFrame(raf); raf=requestAnimationFrame(tick);
}
function closeStage(quiet){
  if(state==='recording'||state==='paused'||state==='counting') return;
  narratorStop();
  stage.hidden=true; document.body.style.overflow=''; rehearsing=false;
  stopCamera(); cancelAnimationFrame(raf); unlockScreen(); player.pause(); player.setVolume(1); bed.audio.pause(); pip.pause();
  S.stats.seconds+=Math.round((performance.now()-stageStart)/1000); S.stats.days=[...new Set([...S.stats.days,today()])].slice(-120); SAVE.stats();
  if(!quiet) refresh();
}
$('#backBtn').onclick=()=>closeStage();
window.addEventListener('resize',()=>{ if(!stage.hidden){ layout(); pos=clampPos(pos); scroller.scrollTop=pos; if(songMode) placeKara(K.idx); } });
player.onend=()=>syncUI();

/* ================= Tap-sync studio ================= */
const sy={open:false,lines:[],marks:[],raf:0,dragging:false,item:null,an:null};
async function openSync(it){
  sy.item=it; sy.lines=lyricLines(it.body); sy.an=null;
  if(!sy.lines.length){ toast('Add some lines first'); return; }
  await loadTimedAudio(it); ac().resume();
  playerOwner({label:titleOf(it),sub:'Sync lyrics',here:()=>!$('#sync').hidden});
  sy.marks=[]; player.pause(); player.seek(0); player.setRate(1); setSyRate(1);
  $('#syTitle').textContent=titleOf(it);
  $('#syNote').hidden=player.hasAudio; $('#sySpeed').hidden=!player.hasAudio;
  $('#sync').hidden=false; sy.open=true; renderSync(); cancelAnimationFrame(sy.raf); sy.raf=requestAnimationFrame(syLoop);
  $('#sySnap').textContent=player.hasAudio?'Analysing audio…':'Snapping off · no audio';
  if(player.hasAudio){ const key=player.key; analyze(player.buf,key).then(an=>{ if(sy.open&&player.key===key){ sy.an=an; $('#sySnap').innerHTML=(S.settings.snap!==false?ic('magnet','xs')+' Snapping to vocal onsets':'Snapping off')+` · ${an.bpm} BPM`; } }).catch(()=>{ $('#sySnap').textContent='Couldn’t analyse audio'; }); }
}
function closeSync(){ sy.open=false; cancelAnimationFrame(sy.raf); player.pause(); player.setRate(1); $('#sync').hidden=true; lineEditorRefresh(); }
function setSyRate(r){ player.setRate(r); $$('#sySpeed button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.v===r))); }
function renderSync(){
  const n=sy.lines.length, i=sy.marks.length;
  $('#syPrev').textContent=i>0?sy.lines[i-1]:'';
  $('#syLbl').textContent=i>=n?'All lines tapped':(i===0?'Tap when the first line starts':'Tap when this line starts');
  $('#syCur').textContent=i<n?sy.lines[i]:'Press Save to keep your timing';
  $('#syNext').textContent=sy.lines[i+1]||'';
  $('#syCount').textContent=Math.min(i,n)+' of '+n+' lines tapped';
  $('#syTap').disabled=i>=n;
}
function syLoop(){ if(!sy.open) return; const t=player.time(),d=player.duration()||0; $('#syNow').textContent=fmt(t); $('#syDur').textContent=fmt(d); const sk=$('#sySeek'); sk.max=d||1; if(!sy.dragging) sk.value=t; const pl=player.playing(); $('#syPlayIc').innerHTML=pl?ic('pause','fill'):ic('play','fill'); $('#syPlayLbl').textContent=pl?'Pause':'Play'; sy.raf=requestAnimationFrame(syLoop); }
function syTap(){
  if(sy.marks.length>=sy.lines.length) return; if(!player.playing()) player.play();
  let t=player.time()-(S.settings.tapLat??0.08)*Math.min(1,player.rate);
  if(sy.an&&S.settings.snap!==false){ const p=nearestPeak(sy.an.peaks,t,0.15); if(p!=null) t=p; }
  const prev=sy.marks[sy.marks.length-1]; if(prev!=null&&t<=prev) t=prev+0.05;
  sy.marks.push(+Math.max(0,t).toFixed(3)); renderSync(); const c=$('#syCur'); c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash');
}
function syUndo(){ if(!sy.marks.length) return; const t=sy.marks.pop(); player.seek(Math.max(0,t-2)); renderSync(); }
$('#syTap').onclick=syTap; $('#syUndo').onclick=syUndo;
$('#syPlay').onclick=()=>{ ac().resume(); player.playing()?player.pause():player.play(); };
$('#sySpeed').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setSyRate(+b.dataset.v); });
const skEl=$('#sySeek'); skEl.addEventListener('pointerdown',()=>sy.dragging=true); skEl.addEventListener('pointerup',()=>sy.dragging=false);
skEl.addEventListener('input',()=>{ const v=+skEl.value; player.seek(v); sy.marks=sy.marks.filter(m=>m<v); renderSync(); });
$('#syClose').onclick=()=>{ if(sy.marks.length) toast('Sync cancelled. Nothing changed.'); closeSync(); };
$('#sySave').onclick=()=>{
  const s=sy.item, n=sy.lines.length, old=s.times||[], m=sy.marks, last=m.length?m[m.length-1]:-1;
  if(!m.length){ toast('Tap along with at least one line first'); return; }
  s.times=sy.lines.map((_,i)=>i<m.length?m[i]:(old.length===n&&old[i]!=null&&old[i]>last?old[i]:null));
  finishTiming(s,sy.an);
  s.updated=Date.now(); SAVE.items(); closeSync(); toast('Saved timing for '+m.length+' of '+n+' lines · word timing added');
};
function finishTiming(s,an){
  const lines=lyricLines(s.body), T=fillTimes(s.times,lines.length).t;
  s.ends=estimateEnds(lines,T,an);
  s.wt=lines.map((l,i)=>s.times[i]!=null?distributeWords(l,T[i],s.ends[i],an&&an.peaks):null);
}

/* ================= Auto-sync & transcription ================= */
/* ---------- Background job tracker (sheet + floating pill) ---------- */
const JOB={on:false,state:'idle',title:'',msg:'',p:0,note:'',t0:0,sheet:null,itemId:null,creep:null,tick:0,hideT:0};
const pill=$('#bgjob');
function jobRender(){
  const pct=Math.round(clamp01(JOB.p)*100), el=JOB.sheet&&JOB.sheet.el;
  if(el&&el.isConnected){ el.querySelector('#psMsg').textContent=JOB.msg; el.querySelector('#psBar').style.width=pct+'%'; el.querySelector('#psNote').textContent=JOB.note||''; el.querySelector('#psPct').textContent=JOB.state==='run'?pct+'% · '+fmt((performance.now()-JOB.t0)/1000):'';
    el.querySelector('#psClose').textContent=JOB.state==='run'?'Run in background':JOB.state==='done'?'Open':'Close'; }
  const show=JOB.state!=='idle'&&!(el&&el.isConnected);
  pill.hidden=!show; if(!show) return;
  pill.className='bgjob '+JOB.state;
  pill.style.setProperty('--p',JOB.state==='done'?100:pct);
  pill.querySelector('b').textContent=JOB.state==='done'?(JOB.doneTitle||'Done'):JOB.state==='fail'?'Couldn’t finish':JOB.title;
  pill.querySelector('.m').textContent=JOB.state==='run'?JOB.msg.replace(/….*$/,'…'):JOB.state==='done'?JOB.msg:'Tap for details';
  pill.querySelector('.pct').textContent=JOB.state==='run'?pct+'%':JOB.state==='done'?'Open':'';
  pill.querySelector('.ring').innerHTML=JOB.state==='done'?ic('check','sm'):JOB.state==='fail'?ic('x','sm'):'';
}
function jobSheet(){
  const s=sheet(`<h3>${esc(JOB.title)}</h3><p class="sub" id="psMsg"></p><div class="pbar2"><i id="psBar"></i></div><p class="sub" id="psPct" style="margin:8px 20px 0;font-family:var(--mono);font-size:.8rem"></p><p class="hint pad" id="psNote" style="margin-top:12px"></p><div class="row-btns"><button class="btn" id="psClose">Run in background</button></div>`,
    {onMount(el,close){ el.querySelector('#psClose').onclick=()=>{ close(); if(JOB.state==='done') jobOpen(); else if(JOB.state==='fail') jobClear(); }; },onClose(){ JOB.sheet=null; setTimeout(jobRender,380); }});
  JOB.sheet=s; jobRender(); return s;
}
function jobOpen(){ const id=JOB.itemId; jobClear(); if(!id) return; const top=STACK[STACK.length-1]; if(top&&top.name==='edit'&&top.el.querySelector(`[data-id="${id}"]`)){ rerender(top); return; } if(stage.hidden&&$('#studio').hidden) openEditor(id); }
function jobClear(){ JOB.state='idle'; JOB.on=false; clearInterval(JOB.tick); clearTimeout(JOB.hideT); pill.hidden=true; }
pill.onclick=()=>{ if(JOB.state==='done') jobOpen(); else jobSheet(); };
function progressSheet(title,itemId){
  clearInterval(JOB.tick); clearTimeout(JOB.hideT);
  Object.assign(JOB,{on:true,state:'run',title,msg:'Starting…',p:0,note:'',t0:performance.now(),itemId,creep:null});
  jobSheet();
  JOB.tick=setInterval(()=>{ if(JOB.state!=='run') return; if(JOB.creep){ const c=JOB.creep, el=(performance.now()-c.t)/1000; JOB.p=c.from+(c.to-c.from)*(1-Math.exp(-el/c.est)); } jobRender(); },400);
  return {
    set(msg,p,note){ JOB.msg=msg; if(p!=null){ JOB.p=p; JOB.creep=null; } if(note!=null) JOB.note=note; jobRender(); },
    creep(msg,from,to,est,note){ JOB.msg=msg; JOB.p=from; JOB.creep={from,to,est:Math.max(5,est),t:performance.now()}; if(note!=null) JOB.note=note; jobRender(); },
    done(msg,title){ JOB.doneTitle=title; JOB.state='done'; JOB.p=1; JOB.creep=null; JOB.msg=msg; clearInterval(JOB.tick);
      if(JOB.sheet&&JOB.sheet.el.isConnected){ JOB.sheet.close(); JOB.state='idle'; } jobRender(); if(JOB.state==='done') JOB.hideT=setTimeout(jobClear,12000); },
    fail(msg,note){ JOB.state='fail'; JOB.creep=null; JOB.msg=msg; JOB.note=note||''; clearInterval(JOB.tick); jobRender(); },
    close(){ if(JOB.sheet) JOB.sheet.close(); jobClear(); }
  };
}
async function autoSync(it,mode){
  const lines=lyricLines(it.body);
  if(mode!=='generate'&&!lines.length){ toast('Add lines first, or use Generate from audio'); return; }
  if(mode!=='quick'&&ASR.busy){ toast('A transcription is already running — see the progress pill at the top.'); jobRender(); return; }
  const ps=progressSheet(mode==='quick'?'Quick auto-sync':mode==='generate'?(it.kind==='line'?'Generating lines':'Generating lyrics'):'AI auto-sync',it.id);
  try{
    const blob=await timedBlob(it,true);
    if(!blob){ ps.close(); toast(it.kind==='line'?'Import a clip first':'Attach music first'); return; }
    if(mode==='quick'){
      ps.set('Decoding audio…',.1,'Runs on your device. Works best when the vocals are clear.');
      const buf=await decodeBlob(blob);
      const an=await analyze(buf,musicKey(it,false),p=>ps.set('Finding vocal onsets and the beat…',.15+p*.7));
      it.times=autoSyncDP(lines,an); finishTiming(it,an);
      it.updated=Date.now(); SAVE.items(); ps.done('Auto-synced '+lines.length+' lines · '+an.bpm+' BPM','Synced');
      toast('Auto-synced '+lines.length+' lines · '+an.bpm+' BPM. Fine-tune if anything’s early or late.');
    } else {
      let audioDur=0; try{ audioDur=await probeDuration(blob); }catch(e){}
      const res=await transcribeBlob(blob,st=>{
        if(st.stage==='lib') ps.set('Loading the speech engine…',.03,'First run downloads the Whisper model (about 80 MB), then it’s cached.');
        else if(st.stage==='model') ps.set('Downloading Whisper model… '+Math.round(st.p*100)+'%',.05+st.p*.45);
        else if(st.stage==='decode') ps.set('Preparing audio…',.52);
        else if(st.stage==='listen') ps.creep('Listening'+(ASR.device==='webgpu'?' (GPU)':'')+'… this can take a minute',.58,.95,(audioDur||60)*(ASR.device==='webgpu'?0.25:IS_MOBILE?1.6:0.7)+10,'Lectern is transcribing on your device. Nothing is uploaded. You can keep using the app.');
        else if(st.stage==='retry') ps.set('Switching to a safer mode and retrying…',.55,'Your device’s GPU engine had a hiccup, so Lectern is retrying on the CPU. This is slower but more reliable.'); });
      if(!res.words.length) throw new Error('No words were recognised.');
      ps.set('Aligning words…',.92);
      if(mode==='generate'||!lines.length){
        const g=wordsToLines(res.words); it.body=g.lines.join('\n'); it.times=g.times; it.ends=g.ends; it.wt=g.wt;
        if(!it.title||/^Untitled/.test(it.title)) it.title=(g.lines[0]||'Transcribed').replace(/[,.!?]+$/,'').slice(0,40);
        toast('Transcribed '+g.lines.length+' lines with word timing');
      } else {
        const r=alignLyricsToWords(lines,res.words); it.times=r.times; it.ends=r.ends; it.wt=r.wt;
        toast('AI-synced '+lines.length+' lines · '+Math.round(r.confidence*100)+'% of words matched');
      }
      it.updated=Date.now(); SAVE.items(); ps.done(lyricLines(it.body).length+' lines with word timing',mode==='generate'||!lines.length?(it.kind==='line'?'Lines ready':'Lyrics ready'):'Synced');
    }
    lineEditorRefresh();
  }catch(e){
    if(e&&e.busy){ ps.fail('Already transcribing','Another transcription is still running. Wait for it to finish, then try again.'); return; }
    const msg=mode==='quick'?'Quick sync couldn’t analyse this audio. Try a different file format (MP3 or WAV).'
      :isNetErr(e)?'The speech model couldn’t download. Check your internet connection and try again — after the first download it works offline.'
      :'The speech engine couldn’t run on this device, even in safe mode. Try Chrome or Edge on a computer, or use Quick auto-sync.';
    ps.fail('Couldn’t finish',msg+(e&&e.message?' (Details: '+e.message+')':''));
  }
}

/* ================= Timeline fine-tune ================= */
async function openTimeline(it){
  const lines=lyricLines(it.body); if(!lines.length){ toast('Add lines first'); return; }
  await loadTimedAudio(it); ac().resume();
  if(!player.hasAudio){ toast('Attach audio to fine-tune against a waveform'); return; }
  playerOwner({label:titleOf(it),sub:'Fine-tune timing',open:()=>openTimeline(it),here:()=>{ const e=STACK[STACK.length-1]; return !!(e&&e.name==='timeline'); }});
  const T=fillTimes(it.times,lines.length).t.slice(), W=lines.map((l,i)=>it.wt&&it.wt[i]?it.wt[i].map(x=>({...x})):null), E=(it.ends||[]).slice();
  const TL={T,W,E,sel:0,pps:70,an:null,raf:0};
  analyze(player.buf,player.key).then(a=>{ TL.an=a; }).catch(()=>{});
  push('timeline',el=>{
    el.innerHTML=pbar('Fine-tune timing',`<button class="btn white sm" id="tlSave">Save</button>`)+`
      <p class="hint pad" style="margin:0 0 10px">Drag a line marker on the waveform, or select a line and nudge it. Tap the waveform to listen from there.</p>
      <div class="tl-wrap" id="tlWrap"><div class="tl-inner" id="tlInner"><canvas id="tlCv" height="140"></canvas><div id="tlMarks"></div><i class="tl-head" id="tlHead"></i></div></div>
      <div class="tl-bar pad"><button class="circ" id="tlPlay" aria-label="Play">${ic('play','fill')}</button><time id="tlNow">0:00</time><span style="flex:1"></span><button class="circ sm" id="tlZo" aria-label="Zoom out">${ic('zoom-out','sm')}</button><button class="circ sm" id="tlZi" aria-label="Zoom in">${ic('zoom-in','sm')}</button></div>
      <div class="card tl-sel" style="margin:12px 20px 0"><div class="mute" style="font-size:.8rem" id="tlIdx"></div><b id="tlTxt"></b>
        <div style="display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn sm" data-n="-0.1">−0.1s</button><button class="btn sm" data-n="-0.02">−20ms</button><time id="tlT" style="font-family:var(--mono);min-width:64px;text-align:center"></time><button class="btn sm" data-n="0.02">+20ms</button><button class="btn sm" data-n="0.1">+0.1s</button></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="btn sm" id="tlSnap">${ic('magnet','xs')}Snap to onset</button><button class="btn sm" id="tlHear">${ic('play','fill xs')}Hear line</button><button class="btn sm" id="tlAll">Shift all ±</button></div></div>
      <div class="list" id="tlList" style="margin-top:14px;padding-bottom:30px"></div>`;
    const wrap=el.querySelector('#tlWrap'), inner=el.querySelector('#tlInner'), cv=el.querySelector('#tlCv'), marks=el.querySelector('#tlMarks'), head=el.querySelector('#tlHead');
    const draw=()=>{
      const dur=player.duration(); let pps=TL.pps; if(dur*pps>30000) pps=TL.pps=30000/dur;
      const w=Math.ceil(dur*pps); inner.style.width=w+'px'; cv.width=w; const g=cv.getContext('2d'), h=cv.height, d=player.buf.getChannelData(0), step=d.length/w;
      g.clearRect(0,0,w,h); g.fillStyle='rgba(255,255,255,.08)'; for(let s=0;s<dur;s+=1){ g.fillRect(Math.round(s*pps),0,1,h); }
      g.fillStyle='#8B8B95';
      for(let x=0;x<w;x++){ let mn=1,mx=-1; const a=Math.floor(x*step), b=Math.min(d.length,Math.floor((x+1)*step)); for(let i=a;i<b;i+=8){ const v=d[i]; if(v<mn) mn=v; if(v>mx) mx=v; } g.fillRect(x,h/2+mn*h*.45,1,Math.max(1,(mx-mn)*h*.45)); }
      marks.innerHTML=lines.map((l,i)=>`<button class="tl-m ${i===TL.sel?'sel':''}" data-i="${i}" style="left:${TL.T[i]*pps}px"><span>${i+1}. ${esc(l.slice(0,18))}</span></button>`).join('');
      renderSel(); };
    const renderSel=()=>{ const i=TL.sel; el.querySelector('#tlIdx').textContent='Line '+(i+1)+' of '+lines.length; el.querySelector('#tlTxt').textContent=lines[i]; el.querySelector('#tlT').textContent=fmtTag(TL.T[i]);
      $$('.tl-m',marks).forEach(m=>{ m.classList.toggle('sel',+m.dataset.i===i); m.style.left=TL.T[+m.dataset.i]*TL.pps+'px'; });
      el.querySelector('#tlList').innerHTML=lines.map((l,k)=>`<button class="row tl-row ${k===i?'on':''}" data-k="${k}"><time>${fmtTag(TL.T[k])}</time><span>${esc(l)}</span></button>`).join(''); };
    const move=(i,t)=>{ const lo=i>0?TL.T[i-1]+0.05:0, hi=i<lines.length-1?TL.T[i+1]-0.05:player.duration(); t=Math.max(lo,Math.min(hi,t)); const d=t-TL.T[i]; TL.T[i]=+t.toFixed(3); if(TL.W[i]) TL.W[i]=TL.W[i].map(x=>({s:+(x.s+d).toFixed(3),e:+(x.e+d).toFixed(3)})); if(TL.E[i]!=null) TL.E[i]=+(TL.E[i]+d).toFixed(3); };
    draw();
    let dm=null;
    marks.addEventListener('pointerdown',e=>{ const m=e.target.closest('.tl-m'); if(!m) return; e.preventDefault(); TL.sel=+m.dataset.i; dm={x0:e.clientX,t0:TL.T[TL.sel],moved:false}; m.setPointerCapture(e.pointerId); renderSel(); });
    marks.addEventListener('pointermove',e=>{ if(!dm) return; const dx=e.clientX-dm.x0; if(Math.abs(dx)>3) dm.moved=true; move(TL.sel,dm.t0+dx/TL.pps); const m=marks.querySelector(`.tl-m[data-i="${TL.sel}"]`); if(m) m.style.left=TL.T[TL.sel]*TL.pps+'px'; el.querySelector('#tlT').textContent=fmtTag(TL.T[TL.sel]); });
    marks.addEventListener('pointerup',()=>{ if(dm&&dm.moved) renderSel(); dm=null; });
    cv.addEventListener('click',e=>{ const r=cv.getBoundingClientRect(); player.seek((e.clientX-r.left)/TL.pps); player.play(); });
    el.querySelector('#tlPlay').onclick=()=>{ player.playing()?player.pause():player.play(); };
    el.querySelector('#tlZi').onclick=()=>{ TL.pps=Math.min(400,TL.pps*1.6); draw(); };
    el.querySelector('#tlZo').onclick=()=>{ TL.pps=Math.max(10,TL.pps/1.6); draw(); };
    el.querySelectorAll('[data-n]').forEach(b=>b.onclick=()=>{ move(TL.sel,TL.T[TL.sel]+(+b.dataset.n)); renderSel(); });
    el.querySelector('#tlSnap').onclick=()=>{ if(!TL.an){ toast('Still analysing…'); return; } const p=nearestPeak(TL.an.peaks,TL.T[TL.sel],0.35); if(p==null){ toast('No clear onset nearby'); return; } move(TL.sel,p); renderSel(); toast('Snapped to onset'); };
    el.querySelector('#tlHear').onclick=()=>{ player.seek(Math.max(0,TL.T[TL.sel]-0.8)); player.play(); clearTimeout(TL.stopT); TL.stopT=setTimeout(()=>player.pause(),3600); };
    el.querySelector('#tlAll').onclick=()=>actionSheet('Shift every line',[-0.5,-0.2,-0.1,0.1,0.2,0.5].map(v=>({icon:v<0?'chevrons-left':'chevrons-right',label:(v>0?'+':'')+v+'s',run:()=>{ for(let i=0;i<lines.length;i++){ const d=v; TL.T[i]=+Math.max(0,TL.T[i]+d).toFixed(3); if(TL.W[i]) TL.W[i]=TL.W[i].map(x=>({s:+(x.s+d).toFixed(3),e:+(x.e+d).toFixed(3)})); if(TL.E[i]!=null) TL.E[i]=+(TL.E[i]+d).toFixed(3); } renderSel(); }})));
    el.querySelector('#tlList').addEventListener('click',e=>{ const r=e.target.closest('[data-k]'); if(!r) return; TL.sel=+r.dataset.k; renderSel(); wrap.scrollLeft=TL.T[TL.sel]*TL.pps-wrap.clientWidth/3; player.seek(Math.max(0,TL.T[TL.sel]-0.8)); });
    el.querySelector('#tlSave').onclick=()=>{ it.times=TL.T.slice(); it.wt=TL.W.map((w,i)=>w||distributeWords(lines[i],TL.T[i],(TL.E[i]!=null?TL.E[i]:estimateEnds(lines,TL.T,TL.an)[i]),TL.an&&TL.an.peaks)); it.ends=TL.E.length?TL.E:estimateEnds(lines,TL.T,TL.an); it.updated=Date.now(); SAVE.items(); player.pause(); pop(); toast('Timing saved'); };
    const loop=()=>{ if(!el.isConnected){ player.pause(); return; } const t=player.time(); head.style.left=t*TL.pps+'px'; el.querySelector('#tlNow').textContent=fmt(t); el.querySelector('#tlPlay').innerHTML=player.playing()?ic('pause','fill'):ic('play','fill'); if(player.playing()){ const x=t*TL.pps; if(x<wrap.scrollLeft||x>wrap.scrollLeft+wrap.clientWidth*0.85) wrap.scrollLeft=x-wrap.clientWidth*0.25; } TL.raf=requestAnimationFrame(loop); };
    cancelAnimationFrame(TL.raf); TL.raf=requestAnimationFrame(loop);
  });
}

/* ================= Keyboard ================= */
document.addEventListener('keydown',e=>{
  if(sy.open){ if(e.target.tagName==='INPUT'&&e.target.type!=='range') return;
    if(e.code==='Space'||e.key==='Enter'){ e.preventDefault(); syTap(); } else if(e.key==='Backspace'){ e.preventDefault(); syUndo(); } else if(e.key==='p'||e.key==='P'){ player.playing()?player.pause():player.play(); } else if(e.key==='Escape') closeSync(); return; }
  if(stage.hidden||$$('#sheets .sheet').length) return;
  const tag=(e.target.tagName||'').toLowerCase(); if(tag==='input'&&e.target.type!=='range') return;
  if(e.code==='Space'&&tag!=='button'){ e.preventDefault(); pauseToggle(); }
  else if(songMode&&(e.key==='ArrowLeft'||e.key==='ArrowRight')&&state==='idle'&&tag!=='input'){ e.preventDefault(); player.seek(player.time()+(e.key==='ArrowLeft'?-5:5)); K.idx=-2; updateKara(); }
  else if(!songMode&&e.key==='ArrowUp'){ e.preventDefault(); S.settings.speed=Math.min(14,S.settings.speed+1); syncTune(); SAVE.settings(); }
  else if(!songMode&&e.key==='ArrowDown'){ e.preventDefault(); S.settings.speed=Math.max(1,S.settings.speed-1); syncTune(); SAVE.settings(); }
  else if(e.key==='r'||e.key==='R') $('#rewBtn').click();
  else if(e.key==='Escape') closeStage();
});

/* ================= Audio setup before recording ================= */
function stageRouteUI(){
  const b=$('#routeBtn'); if(!b) return;
  b.innerHTML=ic(ROUTE_ICON[ROUTE.output]||'volume-2','sm');
  b.setAttribute('aria-label','Audio: '+ROUTE_LABEL[ROUTE.output]);
  b.classList.toggle('bt',ROUTE.output==='bluetooth');
}
function audioSheet(forRecord){
  return new Promise(res=>{
    let started=false;
    const r=ROUTE.output, hp=r!=='speaker', lat=Math.round(extraLatency()*1000+outLat()*1000);
    const hasHeadsetMic=ROUTE.inputs.some(i=>i.type==='bluetooth'||i.type==='headset')||r==='bluetooth'||r==='wired'||r==='usb';
    const opt=(v,t,s)=>`<button class="aopt" data-mic="${v}" aria-pressed="${micPref()===v}"><span class="rd"></span><span><b>${t}</b><small>${s}</small></span></button>`;
    sheet(`<div class="asheet">
      <div class="aroute"><span class="ai">${ic(ROUTE_ICON[r]||'volume-2')}</span><div><small>Playing through</small><b>${esc(hp&&ROUTE.name?ROUTE.name:ROUTE_LABEL[r])}</b></div></div>
      ${hp?`<div class="h3" style="margin:18px 0 8px">Record your voice with</div>
        ${opt('phone','Phone microphone','Best quality. The music stays in your '+(r==='bluetooth'?'Bluetooth ':'')+'headphones and out of your take.')}
        ${hasHeadsetMic?opt('headset','Headset microphone',r==='bluetooth'?'Uses the mic on your headphones. Bluetooth switches to call-quality sound for this.':'Uses the mic on your headphones.'):''}`
      :`<div class="atip">${ic('headphones','sm')}<span><b>Headphones give the cleanest take.</b> On the speaker the music leaks into your mic, so Lectern turns on echo cancellation.</span></div>`}
      <div class="alat"><span>${ic('timer','sm')}Delay compensation <b>${lat} ms</b></span><button class="btn sm" id="aLat">Adjust</button></div>
      ${forRecord?`<button class="btn white block" id="aGo">${ic('circle','fill sm')}Start recording</button>`:`<button class="btn white block" id="aGo">Done</button>`}
    </div>`,{onMount(el,close){
      el.addEventListener('click',e=>{ const o=e.target.closest('[data-mic]'); if(!o) return; S.settings.micPref=o.dataset.mic; SAVE.settings(); $$('[data-mic]',el).forEach(x=>x.setAttribute('aria-pressed',String(x===o))); });
      el.querySelector('#aLat').onclick=()=>{ close(); openLatencyCheck(); };
      el.querySelector('#aGo').onclick=()=>{ started=true; S.settings.routeSeen={...(S.settings.routeSeen||{}),[r]:true}; SAVE.settings(); close(); };
    },onClose(){ setTimeout(()=>res(started),0); }});
  });
}
async function audioCheck(){
  await refreshRoute(); stageRouteUI();
  const seen=S.settings.routeSeen||{};
  if(seen[ROUTE.output]) return true;
  return audioSheet(true);
}

/* Sync check: clicks play on the audio clock while a dot flashes on screen. Slide until
   they line up; the difference is this route's output delay. */
function openLatencyCheck(){
  const c=ac(); c.resume();
  let raf=0, on=true, next=c.currentTime+0.3; const period=0.6, sched=[];
  const r=ROUTE.output; let v=Math.round(routeLatency(r)*1000);
  const click=t=>{ const o=c.createOscillator(), g=c.createGain(); o.frequency.value=1500; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.6,t+0.002); g.gain.exponentialRampToValueAtTime(0.0001,t+0.06); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+0.08); };
  sheet(`<div class="lat">
    <h3>Sync check</h3><p class="sub" style="margin:4px 20px 18px">${esc(ROUTE_LABEL[r])}. Slide until the flash lands exactly on each click.</p>
    <div class="lat-dot" id="latDot"></div>
    <div class="mixrow" style="margin:20px 20px 4px"><span class="mute" style="min-width:56px">Earlier</span><input type="range" id="latR" min="-100" max="450" step="5" value="${v}" aria-label="Delay in milliseconds"><span class="mute">Later</span></div>
    <div style="text-align:center;font-family:var(--mono);margin-bottom:14px" id="latV">${v} ms</div>
    <div class="row-btns"><button class="btn" id="latReset">Reset</button><button class="btn white" id="latSave">Save</button></div></div>`,{onMount(el,close){
      const dot=el.querySelector('#latDot'), rg=el.querySelector('#latR'), lv=el.querySelector('#latV');
      rg.oninput=()=>{ v=+rg.value; lv.textContent=v+' ms'; };
      el.querySelector('#latReset').onclick=()=>{ v=Math.round((ROUTE_DEFAULT_LAT[r]||0)*1000); rg.value=v; lv.textContent=v+' ms'; };
      el.querySelector('#latSave').onclick=()=>{ setRouteLatency(v/1000,r); toast('Timing saved for '+ROUTE_LABEL[r].toLowerCase()); close(); };
      const loop=()=>{ if(!on) return;
        while(next<c.currentTime+0.25){ click(next); sched.push(next); next+=period; }
        // context time -> wall time, then add the chosen delay
        const ts=c.getOutputTimestamp?c.getOutputTimestamp():null;
        const ctxNow=ts&&ts.contextTime>0?ts.contextTime+(performance.now()-ts.performanceTime)/1000:c.currentTime-outLat();
        const heard=ctxNow-v/1000; let lit=false; for(const t of sched){ if(heard>=t&&heard<t+0.09){ lit=true; break; } }
        while(sched.length&&sched[0]<heard-1) sched.shift();
        dot.classList.toggle('on',lit); raf=requestAnimationFrame(loop); };
      raf=requestAnimationFrame(loop);
    },onClose(){ on=false; cancelAnimationFrame(raf); }});
}
