/* =====================================================================
   Creator Studio: beat maker, lyric pad, sound recorder, script writer
   ===================================================================== */
const DEG={I:[0,'maj'],ii:[2,'min'],iii:[4,'min'],IV:[5,'maj'],V:[7,'maj'],vi:[9,'min'],bVII:[10,'maj'],Imaj7:[0,'maj7'],ii7:[2,'m7'],iii7:[4,'m7'],IVmaj7:[5,'maj7'],V7:[7,'7'],vi7:[9,'m7']};
const QUAL={maj:[0,4,7],min:[0,3,7],maj7:[0,4,7,11],m7:[0,3,7,10],'7':[0,4,7,10]};
const QSUF={maj:'',min:'m',maj7:'maj7',m7:'m7','7':'7'};
const KEYS={C:0,D:2,E:4,F:5,G:7,A:9,Bb:10};
const NN=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const chordName=(d,k)=>NN[(KEYS[k]+DEG[d][0])%12]+QSUF[DEG[d][1]];
function chordMidi(d,k){ let r=48+KEYS[k]+DEG[d][0]; while(r>55) r-=12; return {root:r,tones:QUAL[DEG[d][1]].map(i=>r+12+i)}; }
const S16=a=>Array.from({length:16},(_,i)=>a.includes(i));
const STYLES={
  pop:{name:'Pop',bpm:100,prog:['I','V','vi','IV'],kick:[0,8,10],snare:[4,12],hat:[0,2,4,6,8,10,12,14],clap:[],bass:[0,8,10],layers:{keys:1,pad:1,bass:1,arp:0,vinyl:0},swing:0},
  lofi:{name:'Lo-fi',bpm:78,prog:['ii7','V7','Imaj7','vi7'],kick:[0,7,10],snare:[4,12],hat:[0,2,4,6,8,10,12,14],clap:[],bass:[0,7,10],layers:{keys:1,pad:0,bass:1,arp:0,vinyl:1},swing:.22},
  ballad:{name:'Ballad',bpm:68,prog:['I','vi','IV','V'],kick:[0,10],snare:[8],hat:[0,4,8,12],clap:[],bass:[0,8],layers:{keys:1,pad:1,bass:1,arp:1,vinyl:0},swing:0},
  hiphop:{name:'Hip-hop',bpm:90,prog:['vi','IV','I','V'],kick:[0,3,8,11],snare:[4,12],hat:[0,2,4,6,8,10,12,14,15],clap:[12],bass:[0,3,8,11],layers:{keys:1,pad:0,bass:1,arp:0,vinyl:0},swing:.12},
  dance:{name:'Dance',bpm:124,prog:['vi','IV','I','V'],kick:[0,4,8,12],snare:[],hat:[2,6,10,14],clap:[4,12],bass:[2,6,10,14],layers:{keys:0,pad:1,bass:1,arp:1,vinyl:0},swing:0},
  acoustic:{name:'Acoustic',bpm:92,prog:['I','IV','vi','V'],kick:[0,8],snare:[],hat:[],clap:[4,12],bass:[0,8],layers:{keys:1,pad:0,bass:1,arp:1,vinyl:0},swing:.08}
};
function beatFromStyle(id,key){ const s=STYLES[id]; return {style:id,styleName:s.name,bpm:s.bpm,key:key||'C',prog:s.prog.slice(),swing:s.swing,layers:{...s.layers},steps:{kick:S16(s.kick),snare:S16(s.snare),hat:S16(s.hat),clap:S16(s.clap)},bass:s.bass.slice()}; }
let BM=store.get('lectern.beatDraft',null)||beatFromStyle('pop');

/* ---------- instruments ---------- */
function mkNoise(c){ const b=c.createBuffer(1,Math.ceil(c.sampleRate*.4),c.sampleRate), d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b; }
function eg(g,t,a,p,d,s,end){ g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(p,t+a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001,p*s),t+a+d); g.gain.setValueAtTime(Math.max(0.0001,p*s),Math.max(t+a+d,end-0.05)); g.gain.exponentialRampToValueAtTime(0.0001,end+0.04); }
const INS={
  kick(c,o,t,v=.9){ const x=c.createOscillator(); x.frequency.setValueAtTime(150,t); x.frequency.exponentialRampToValueAtTime(40,t+.13); const g=c.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.32); x.connect(g); g.connect(o); x.start(t); x.stop(t+.34); },
  snare(c,o,t,nz,v=.35){ const s=c.createBufferSource(); s.buffer=nz; const bp=c.createBiquadFilter(); bp.type='highpass'; bp.frequency.value=1200; const g=c.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.18); s.connect(bp); bp.connect(g); g.connect(o); s.start(t); s.stop(t+.2);
    const x=c.createOscillator(); x.frequency.setValueAtTime(200,t); x.frequency.exponentialRampToValueAtTime(120,t+.08); const g2=c.createGain(); g2.gain.setValueAtTime(v*.6,t); g2.gain.exponentialRampToValueAtTime(0.0001,t+.1); x.connect(g2); g2.connect(o); x.start(t); x.stop(t+.12); },
  hat(c,o,t,nz,v=.12){ const s=c.createBufferSource(); s.buffer=nz; const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=8000; const g=c.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.045); s.connect(hp); hp.connect(g); g.connect(o); s.start(t); s.stop(t+.06); },
  clap(c,o,t,nz,v=.3){ [0,.012,.024].forEach((d,k)=>{ const s=c.createBufferSource(); s.buffer=nz; const bp=c.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1600; bp.Q.value=1.2; const g=c.createGain(); g.gain.setValueAtTime(v*(k===2?1:.6),t+d); g.gain.exponentialRampToValueAtTime(0.0001,t+d+(k===2?.16:.03)); s.connect(bp); bp.connect(g); g.connect(o); s.start(t+d); s.stop(t+d+.18); }); },
  keys(c,o,t,m,d,v=.08,soft){ [['triangle',0,1],['sine',12,.3]].forEach(([ty,tr,mul])=>{ const x=c.createOscillator(); x.type=ty; x.frequency.value=hz(m+tr); const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=soft?1400:2800; const g=c.createGain(); eg(g,t,.006,v*mul,.5,.22,t+d); x.connect(f); f.connect(g); g.connect(o); x.start(t); x.stop(t+d+.1); }); },
  pad(c,o,t,tones,d,v=.035){ const g=c.createGain(); eg(g,t,.35,v,.5,.8,t+d); const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=1100; f.connect(g); g.connect(o); tones.forEach(m=>{ [-6,6].forEach(dt=>{ const x=c.createOscillator(); x.type='sawtooth'; x.frequency.value=hz(m); x.detune.value=dt; x.connect(f); x.start(t); x.stop(t+d+.1); }); }); },
  bass(c,o,t,m,d,v=.4){ const x=c.createOscillator(); x.type='triangle'; x.frequency.value=hz(m); const x2=c.createOscillator(); x2.type='sine'; x2.frequency.value=hz(m-12); const g=c.createGain(); eg(g,t,.008,v,.2,.6,t+d); x.connect(g); x2.connect(g); g.connect(o); x.start(t); x2.start(t); x.stop(t+d+.08); x2.stop(t+d+.08); },
  arp(c,o,t,m,v=.045){ const x=c.createOscillator(); x.type='square'; x.frequency.value=hz(m); const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=2200; const g=c.createGain(); eg(g,t,.004,v,.12,.15,t+.16); x.connect(f); f.connect(g); g.connect(o); x.start(t); x.stop(t+.2); },
  crackle(c,o,t,nz,dur){ for(let k=0;k<Math.round(dur*6);k++){ const tt=t+Math.random()*dur, s=c.createBufferSource(); s.buffer=nz; const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=3000; const g=c.createGain(); g.gain.setValueAtTime(0.05+Math.random()*.08,tt); g.gain.exponentialRampToValueAtTime(0.0001,tt+.006); s.connect(hp); hp.connect(g); g.connect(o); s.start(tt,Math.random()*.3); s.stop(tt+.01); }
    const s=c.createBufferSource(); s.buffer=nz; s.loop=true; const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=1200; const g=c.createGain(); g.gain.value=.012; s.connect(lp); lp.connect(g); g.connect(o); s.start(t); s.stop(t+dur); }
};
function playStep(c,o,B,step,t,nz){
  const sd=60/B.bpm/4, s=step%16, bar=Math.floor(step/16)%4, ch=chordMidi(B.prog[bar],B.key);
  const tt=t+(s%2?B.swing*sd:0);
  if(B.steps.kick[s]) INS.kick(c,o,tt);
  if(B.steps.snare[s]) INS.snare(c,o,tt,nz);
  if(B.steps.hat[s]) INS.hat(c,o,tt,nz,s%4===0?.13:.08);
  if(B.steps.clap[s]) INS.clap(c,o,tt,nz);
  const L=B.layers, lofi=B.style==='lofi';
  if(L.keys&&(s===0||s===8||(B.style==='acoustic'&&s%4===2))) ch.tones.forEach((m,k)=>INS.keys(c,o,tt+k*(B.style==='acoustic'?.03:.008),m,sd*7.6,.07,lofi));
  if(L.pad&&s===0) INS.pad(c,o,tt,ch.tones,sd*16);
  if(L.bass&&B.bass.includes(s)) INS.bass(c,o,tt,ch.root-12+(B.style==='dance'?12:0),sd*(B.style==='dance'?1.6:3.6));
  if(L.arp&&(B.style==='dance'||s%2===0)){ const seq=[...ch.tones,ch.tones[0]+12]; INS.arp(c,o,tt,seq[(B.style==='dance'?s:s/2)%seq.length]+12); }
  if(L.vinyl&&s===0) INS.crackle(c,o,tt,nz,sd*16);
}
const BEAT={on:false,step:0,next:0,timer:0,out:null,nz:null,queue:[],raf:0};
function beatPlay(){
  const c=ac(); c.resume(); stopPreview(); player.pause();
  if(!BEAT.nz) BEAT.nz=mkNoise(c);
  const comp=c.createDynamicsCompressor(); comp.threshold.value=-12; comp.ratio.value=3; comp.connect(c.destination);
  BEAT.out=c.createGain(); BEAT.out.gain.value=.8; BEAT.out.connect(comp); BEAT.comp=comp;
  AUDIO.claim('beat'); BEAT.step=0; BEAT.next=c.currentTime+0.08; BEAT.on=true; BEAT.queue=[];
  const sched=()=>{ const sd=60/BM.bpm/4; while(BEAT.next<c.currentTime+0.12){ playStep(c,BEAT.out,BM,BEAT.step,BEAT.next,BEAT.nz); BEAT.queue.push({s:BEAT.step,t:BEAT.next}); BEAT.next+=sd; BEAT.step++; } };
  sched(); BEAT.timer=setInterval(sched,25);
}
AUDIO.register('beat',{label:'Beat maker',sub:'Loop playing',icon:'drum',playing:()=>BEAT.on,stop:()=>beatStop(),open:()=>openBeatMaker(),here:()=>{ const e=STACK[STACK.length-1]; return !!(e&&e.name==='beat'); }});
function beatStop(){ if(!BEAT.on) return; clearInterval(BEAT.timer); BEAT.on=false; const c=ac(), o=BEAT.out; try{ o.gain.setTargetAtTime(0,c.currentTime,.05); setTimeout(()=>{ try{ o.disconnect(); BEAT.comp.disconnect(); }catch(e){} },400); }catch(e){} BEAT.queue=[]; }
async function renderBeat(B,seconds){
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext, sr=32000, sd=60/B.bpm/4, barDur=sd*16;
  const bars=Math.max(4,Math.ceil(seconds/barDur/4)*4), len=bars*barDur+2.5;
  const c=new OAC(1,Math.ceil(sr*len),sr); const comp=c.createDynamicsCompressor(); comp.threshold.value=-12; comp.ratio.value=3; comp.connect(c.destination); const o=c.createGain(); o.gain.value=.8; o.connect(comp);
  const nz=mkNoise(c);
  for(let st=0;st<bars*16;st++) playStep(c,o,B,st,0.05+st*sd,nz);
  const endT=0.05+bars*barDur, ch=chordMidi(B.prog[0],B.key); ch.tones.forEach(m=>INS.keys(c,o,endT,m,2,.07)); INS.kick(c,o,endT,.6); if(B.layers.pad) INS.pad(c,o,endT,ch.tones,2);
  return {blob:wavFromBuffer(await c.startRendering()),dur:len,bars};
}

/* ---------- Studio tab ---------- */
RENDER.studio=function(){
  const el=$('#tab-studio'), mine=userInst(), drafts=S.items.slice().sort((a,b)=>b.updated-a.updated).slice(0,5);
  const t=(id,kind,act,icon,title,sub,wide)=>`<button class="ctile ${wide?'wide':''}" data-act="${act}" style="${coverCss({id:'st-'+id,kind,title},wide?520:300)}"><span class="ic2">${ic(icon)}</span><b>${title}</b><span>${sub}</span></button>`;
  el.innerHTML=`<div class="libhead"><h1 class="bigtitle">Studio</h1><button class="circ" data-act="create" aria-label="New">${ic('plus')}</button></div>
    <p class="pad mute" style="margin:6px 0 20px">Write lyrics, build beats, record sounds and draft scripts.</p>
    <div class="ctiles">
      ${t('beat','inst','beatmaker','drum','Beat maker','Chords, drums and grooves in six styles',true)}
      ${t('lyric','poem','lyricpad','pen-line','Lyric pad','Syllables, rhymes, auto-placed on the beat')}
      ${t('rec','song','recorder','mic','Sound recorder','Hums, vocals, foley, ideas')}
      ${t('script','script','scripts','scroll-text','Script writer','Templates for talks and videos')}
      ${t('clip','line','clip-new','film','Clip to lines','Import a movie clip, get the lines')}
      ${t('song2','song','song-new','wand-sparkles','Song to lyrics','Transcribe a song into karaoke',true)}
    </div>
    <section class="sec">${secHead('Your beats & sounds')}${mine.length?`<div class="list">${mine.map(x=>rowHTML(x)).join('')}</div>`:`<div class="empty">${ic('audio-waveform')}<b>Nothing here yet</b>Beats and sounds you make show up here and in every music picker.</div>`}</section>
    ${drafts.length?`<section class="sec">${secHead('Recent drafts')}<div class="list">${drafts.map(s=>rowHTML(s,{tag:true,sub:esc(previewLine(s))})).join('')}</div></section>`:''}`;
};
Object.assign(ACT,{
  beatmaker:()=>openBeatMaker(), lyricpad:()=>openLyricPad(), recorder:()=>openRecorder(), scripts:()=>openScripts(),
  'clip-new':()=>{ PENDING_CLIP=null; $('#fileClip').click(); }, 'song-new':()=>$('#fileSong').click()
});
const _itemMenu=itemMenu;
itemMenu=function(id){
  const it=find(id); if(!it||!it.user) return _itemMenu(id);
  actionSheet(it.title,[
    {icon:'play',label:'Play',run:()=>togglePreview(it)},
    {icon:'list-music',label:'Use as music bed',sub:'Plays under poems, scripts and lines',run:()=>{ S.settings.bed=it.id; SAVE.settings(); toast('“'+it.title+'” is now your music bed'); }},
    {icon:'pen-line',label:'Write lyrics on it',run:()=>openLyricPad(null,it.id)},
    it.store==='beat'&&{icon:'drum',label:'Open in beat maker',run:()=>{ const b=S.beats.find(x=>x.id===id); if(b){ BM=JSON.parse(JSON.stringify(b.cfg)); openBeatMaker(b.id); } }},
    {icon:'pencil',label:'Rename',run:()=>sheet(`<h3>Rename</h3><label class="field"><input id="rnI" value="${esc(it.title)}" maxlength="40"></label><div class="row-btns"><button class="btn white" id="rnOk">Save</button></div>`,{onMount(el,close){ el.querySelector('#rnOk').onclick=()=>{ const v=el.querySelector('#rnI').value.trim(); if(v){ const arr=it.store==='beat'?S.beats:S.sounds; const b=arr.find(x=>x.id===id); b.name=v; it.title=v; it.store==='beat'?SAVE.beats():SAVE.sounds(); } close(); refresh(); }; }})},
    {icon:'download',label:'Download',run:async()=>{ const b=await instBlob(it); if(b) downloadFile(new File([b],it.title.replace(/[^\w\- ]+/g,'')+(b.type.includes('wav')?'.wav':b.type.includes('mp4')?'.m4a':'.webm'),{type:b.type})); }},
    {icon:'trash',label:'Delete',danger:true,run:()=>confirmSheet('Delete “'+it.title+'”?','Songs using it will lose their music.','Delete',async()=>{ await idb.del(it.store+':'+id); if(it.store==='beat'){ S.beats=S.beats.filter(x=>x.id!==id); SAVE.beats(); } else { S.sounds=S.sounds.filter(x=>x.id!==id); SAVE.sounds(); } CAT.delete(id); if(S.settings.bed===id){ S.settings.bed=null; SAVE.settings(); } if(PREV.id===id) stopPreview(); toast('Deleted'); if(STACK.length&&STACK[STACK.length-1].name==='detail') pop(); refresh(); })}
  ]);
};

/* ---------- Beat maker ---------- */
function openBeatMaker(editId){
  push('beat',el=>{
    const B=BM, sv=()=>store.set('lectern.beatDraft',BM);
    el.innerHTML=pbar('Beat maker',`<button class="circ" data-x="random" aria-label="Surprise me">${ic('dices')}</button>`)+`
    <div class="bm">
      <div class="lbl2" style="margin-top:4px">Style</div>
      <div class="chips">${Object.entries(STYLES).map(([k,s])=>`<button class="chip" data-style="${k}" aria-pressed="${B.style===k}">${s.name}</button>`).join('')}</div>
      <div class="lbl2">Tempo <b id="bmBpm" style="color:#fff;font-weight:500">${B.bpm} BPM</b></div>
      <input type="range" id="bmTempo" min="60" max="160" value="${B.bpm}" style="width:100%;accent-color:#fff" aria-label="Tempo">
      <div class="lbl2">Key</div>
      <div class="chips">${Object.keys(KEYS).map(k=>`<button class="chip" data-key="${k}" aria-pressed="${B.key===k}">${k}</button>`).join('')}</div>
      <div class="lbl2">Chords <span>tap to change</span></div>
      <div class="chords4" id="bmChords">${B.prog.map((d,i)=>`<button data-slot="${i}"><span>${chordName(d,B.key)}</span><small>${d}</small></button>`).join('')}</div>
      <div class="lbl2">Drums <span>16 steps</span></div>
      <div class="grid16" id="bmGrid">${['kick','snare','hat','clap'].map(r=>`<span class="rl">${r[0].toUpperCase()+r.slice(1)}</span>`+B.steps[r].map((on,i)=>`<button class="r-${r}" data-r="${r}" data-s="${i}" aria-pressed="${on}" aria-label="${r} step ${i+1}"></button>`).join('')).join('')}</div>
      <div class="lbl2">Layers</div>
      <div class="chips">${[['keys','piano','Keys'],['pad','waves-horizontal','Pad'],['bass','audio-waveform','Bass'],['arp','sparkles','Arp'],['vinyl','disc-3','Vinyl']].map(([k,i,l])=>`<button class="chip" data-layer="${k}" aria-pressed="${!!B.layers[k]}">${ic(i,'xs')}${l}</button>`).join('')}</div>
      <div class="lbl2">Swing <b style="color:#fff;font-weight:500" id="bmSwV">${Math.round(B.swing*100)}%</b></div>
      <input type="range" id="bmSwing" min="0" max="40" value="${Math.round(B.swing*100)}" style="width:100%;accent-color:#fff" aria-label="Swing">
    </div>
    <div class="transport"><button class="btn white" id="bmPlay">${ic(BEAT.on?'square':'play','fill sm')}${BEAT.on?'Stop':'Play loop'}</button><button class="btn" id="bmSave">${ic('download','sm')}Save beat</button></div>`;
    const upd=()=>{ sv(); };
    el.querySelectorAll('[data-style]').forEach(b=>b.onclick=()=>{ const was=BEAT.on; BM=beatFromStyle(b.dataset.style,BM.key); sv(); rerender(STACK[STACK.length-1]); if(was){} });
    el.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{ BM.key=b.dataset.key; upd(); rerender(STACK[STACK.length-1]); });
    el.querySelector('#bmTempo').oninput=e=>{ BM.bpm=+e.target.value; el.querySelector('#bmBpm').textContent=BM.bpm+' BPM'; upd(); };
    el.querySelector('#bmSwing').oninput=e=>{ BM.swing=+e.target.value/100; el.querySelector('#bmSwV').textContent=e.target.value+'%'; upd(); };
    el.querySelector('#bmGrid').onclick=e=>{ const b=e.target.closest('[data-r]'); if(!b) return; const r=b.dataset.r,i=+b.dataset.s; BM.steps[r][i]=!BM.steps[r][i]; b.setAttribute('aria-pressed',String(BM.steps[r][i])); if(r==='kick'&&BM.style!=='dance'){ BM.bass=BM.steps.kick.map((v,k)=>v?k:-1).filter(k=>k>=0); } upd();
      if(!BEAT.on){ const c=ac(); c.resume(); if(!BEAT.nz) BEAT.nz=mkNoise(c); if(BM.steps[r][i]) INS[r](c,c.destination,c.currentTime+0.01,BEAT.nz); } };
    el.querySelectorAll('[data-layer]').forEach(b=>b.onclick=()=>{ const k=b.dataset.layer; BM.layers[k]=BM.layers[k]?0:1; b.setAttribute('aria-pressed',String(!!BM.layers[k])); upd(); });
    el.querySelector('#bmChords').onclick=e=>{ const b=e.target.closest('[data-slot]'); if(!b) return; const i=+b.dataset.slot;
      actionSheet('Bar '+(i+1)+' chord',Object.keys(DEG).map(d=>({icon:'piano',label:chordName(d,BM.key)+(BM.prog[i]===d?' ✓':''),sub:d,run:()=>{ BM.prog[i]=d; upd(); rerender(STACK[STACK.length-1]); const c=ac(); c.resume(); chordMidi(d,BM.key).tones.forEach(m=>INS.keys(c,c.destination,c.currentTime+0.02,m,1.2,.08)); }}))); };
    el.querySelector('[data-x="random"]').onclick=()=>{ const ks=Object.keys(STYLES), st=ks[Math.random()*ks.length|0]; BM=beatFromStyle(st,Object.keys(KEYS)[Math.random()*7|0]); const pool=['I','ii','iii','IV','V','vi']; BM.prog=[BM.prog[0],...[1,2,3].map(()=>pool[Math.random()*pool.length|0])]; BM.bpm=Math.round(BM.bpm*(0.9+Math.random()*0.2)); ['hat','kick'].forEach(r=>{ for(let k=0;k<16;k++) if(Math.random()<.08) BM.steps[r][k]=!BM.steps[r][k]; }); sv(); rerender(STACK[STACK.length-1]); toast('Fresh '+STYLES[st].name+' idea'); };
    el.querySelector('#bmPlay').onclick=()=>{ if(BEAT.on) beatStop(); else beatPlay(); const b=el.querySelector('#bmPlay'); b.innerHTML=ic(BEAT.on?'square':'play','fill sm')+(BEAT.on?'Stop':'Play loop'); };
    el.querySelector('#bmSave').onclick=()=>saveBeatSheet(editId);
    const cells=$$('#bmGrid button',el), slots=$$('#bmChords button',el);
    const loop=()=>{ if(!el.isConnected){ beatStop(); return; } if(BEAT.on){ const now=ac().currentTime; let cur=null; while(BEAT.queue.length&&BEAT.queue[0].t<=now){ cur=BEAT.queue.shift(); } if(cur){ const s=cur.s%16, bar=Math.floor(cur.s/16)%4; cells.forEach(c=>c.classList.toggle('now',+c.dataset.s===s)); slots.forEach((c,i)=>c.classList.toggle('now',i===bar)); } } else { cells.forEach(c=>c.classList.remove('now')); slots.forEach(c=>c.classList.remove('now')); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
}
function saveBeatSheet(editId){
  const old=editId&&S.beats.find(b=>b.id===editId);
  sheet(`<h3>Save beat</h3><label class="field"><span>Name</span><input id="bsName" maxlength="40" value="${esc(old?old.name:STYLES[BM.style].name+' beat '+(S.beats.length+1))}"></label>
    <div class="field"><span>Length</span><div class="chips" id="bsLen">${[30,60,90,150].map(v=>`<button class="chip" data-v="${v}" aria-pressed="${v===90}">${v<60?v+'s':(v/60)+' min'}</button>`).join('')}</div></div>
    <div class="row-btns">${old?`<button class="btn" id="bsNew">Save as new</button>`:''}<button class="btn white" id="bsOk">${old?'Update':'Render & save'}</button></div>`,{onMount(el,close){
    let len=90; el.querySelector('#bsLen').onclick=e=>{ const b=e.target.closest('[data-v]'); if(!b) return; len=+b.dataset.v; $$('#bsLen .chip',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b))); };
    const go=async asNew=>{ const name=el.querySelector('#bsName').value.trim()||'My beat'; close(); beatStop(); toast('Rendering “'+name+'”…');
      try{ const r=await renderBeat(BM,len); const id=(!asNew&&old)?old.id:'beat-'+uid(); await idb.put('beat:'+id,r.blob);
        const rec={id,name,bpm:BM.bpm,key:BM.key,styleName:STYLES[BM.style].name,dur:r.dur,bars:r.bars,created:Date.now(),cfg:JSON.parse(JSON.stringify(BM))};
        S.beats=S.beats.filter(b=>b.id!==id); S.beats.unshift(rec); SAVE.beats(); registerUserInst(rec,'beat'); BUFS.forEach((v,k)=>{ if(k.includes(id)) BUFS.delete(k); });
        actionSheet('Saved “'+name+'”',[
          {icon:'pen-line',label:'Write lyrics on this beat',sub:'Lines snap to the bars automatically',run:()=>openLyricPad(null,id)},
          {icon:'list-music',label:'Use as music bed',run:()=>{ S.settings.bed=id; SAVE.settings(); toast('Music bed set'); }},
          {icon:'play',label:'Listen',run:()=>togglePreview(CAT.get(id))},
          {icon:'check',label:'Done',run(){}}],fmt(r.dur)+' · '+BM.bpm+' BPM · '+chordName(BM.prog[0],BM.key)+' key');
      }catch(e){ toast('Couldn’t render the beat'); } };
    el.querySelector('#bsOk').onclick=()=>go(false); const n=el.querySelector('#bsNew'); if(n) n.onclick=()=>go(true);
  }});
}

/* ---------- Lyric pad ---------- */
const RHYME_CACHE={};
const LOCAL_WORDS='light night bright tonight right fight sight flight white bite delight might kite quite slight tight write\nday way stay play say away today okay pray gray stray sway display\nheart apart start part art smart chart\nlove above of enough\nfire higher desire wire tired\ndream seem team beam stream scream gleam\nheart start\nsoul whole roll control gold hold cold told old bold\ntime rhyme climb mine line shine sign fine wine design divine\nmore door floor before shore core roar\nyou true through new blue do too knew view\nme free see be sea three key tree believe\nrain again pain chain brain plane remain\nhome alone stone phone own known shown grown\nfall all call wall small tall\ngo know show slow flow glow low snow though below\nsky high fly why try cry goodbye eye lie\nrun sun fun done one someone gun none begun\nside ride wide tide pride hide inside alive\ndown town crown around sound ground found\nme baby maybe crazy lazy'.split(/\s+/);
function localRhymes(w,text){ const n=normWord(w); if(n.length<2) return []; const tail=n.slice(-Math.min(3,n.length)), tail2=n.slice(-2); const pool=[...new Set([...LOCAL_WORDS,...(text.match(/[A-Za-z']+/g)||[]).map(x=>x.toLowerCase())])].filter(x=>x!==n);
  return pool.filter(x=>x.endsWith(tail)).concat(pool.filter(x=>x.endsWith(tail2)&&!x.endsWith(tail))).slice(0,14); }
async function rhymesFor(w,text){
  const n=normWord(w); if(!n) return {list:[],src:''}; if(RHYME_CACHE[n]) return RHYME_CACHE[n];
  try{ const ctl=new AbortController(); setTimeout(()=>ctl.abort(),4000); const r=await fetch('https://api.datamuse.com/words?rel_rhy='+encodeURIComponent(n)+'&max=16',{signal:ctl.signal}); const j=await r.json(); let list=j.map(x=>x.word);
    if(list.length<6){ const r2=await fetch('https://api.datamuse.com/words?rel_nry='+encodeURIComponent(n)+'&max=10'); list=list.concat((await r2.json()).map(x=>x.word)); }
    RHYME_CACHE[n]={list:[...new Set(list)].slice(0,16),src:'Datamuse'}; return RHYME_CACHE[n]; }
  catch(e){ return {list:localRhymes(n,text),src:'offline'}; }
}
function openLyricPad(id,beatId){
  let s=id&&find(id);
  if(!s){ s={id:uid(),kind:'song',title:'',body:'',times:[],offset:0,updated:Date.now()}; if(beatId){ const b=CAT.get(beatId); s.music={type:'inst',id:beatId,dur:b&&b.dur}; } S.items.push(s); SAVE.items(); }
  const LP={per:2,intro:1,taps:[],metro:null};
  push('lyricpad',el=>{
    const nm=musicName(s), b=s.music&&s.music.type==='inst'&&CAT.get(s.music.id);
    el.innerHTML=pbar('Lyric pad',`<button class="btn white sm" data-lp="sing">${ic('mic-vocal','sm')}Sing</button>`)+`
      <div class="ed">
        <textarea class="title-in" id="lpTitle" rows="1" placeholder="Song title" maxlength="80">${esc(s.title)}</textarea>
        <div class="grp" style="margin-top:16px"><div class="grow">${nm?`<button class="circ sm mt" data-act="music-toggle" data-id="${s.id}" aria-label="Play or pause the beat">${ic('eighth-notes','sm')}</button>`:`<span class="circ sm">${ic('drum','sm')}</span>`}<div class="lbl"><b>${esc(nm||'No beat yet')}</b><small>${b&&b.bpm?b.bpm+' BPM · lines snap to bars':nm?'Tempo is detected from the audio':'Pick a beat you made or an instrumental'}</small></div><div class="acts"><button class="btn sm" data-act="music-pick" data-id="${s.id}">Choose</button></div></div></div>
        <div class="h3">Lyrics <small id="lpCount"></small></div>
        <div class="chips" style="margin-bottom:10px">${['Verse','Pre-chorus','Chorus','Bridge','Outro'].map(x=>`<button class="chip" data-sec="${x}">${ic('plus','xs')}${x}</button>`).join('')}</div>
        <textarea class="body-in song" id="lpBody" placeholder="Write one lyric line per row.&#10;Tip: keep lines in a section to similar syllable counts.">${esc(s.body)}</textarea>
        <div class="lp-info" id="lpInfo"></div>
        <div class="rhymes" id="lpRh"></div>
        <div class="h3">Tempo</div>
        <div class="grp tempo">
          <div class="tp-main"><button class="circ sm" data-tp="-1" aria-label="Slower">${ic('minus','sm')}</button><div class="tp-bpm"><b id="lpBpm"></b><small>BPM</small></div><button class="circ sm" data-tp="1" aria-label="Faster">${ic('plus','sm')}</button><button class="tap" id="lpTap" aria-label="Tap tempo">Tap</button></div>
          <input type="range" id="lpBpmR" min="50" max="200" step="1" aria-label="Tempo">
          <p class="tp-src" id="lpTempoSrc"></p>
          <div class="grow"><div class="lbl"><b>Beats per bar</b></div><div class="chips" id="lpBeats">${[3,4,6].map(v=>`<button class="chip" data-v="${v}" aria-pressed="${(s.beats||4)===v}">${v}</button>`).join('')}</div></div>
          <div class="grow"><div class="lbl"><b>Metronome</b><small>Hear the tempo while you write</small></div><button class="toggle" role="switch" id="lpMetro" aria-checked="false" aria-label="Metronome"></button></div>
        </div>
        <div class="h3">Place on the beat</div>
        <div class="grp"><div class="grow"><div class="lbl"><b>Bars per line</b><small>How long each line lasts</small></div><div class="chips" id="lpPer">${[0.5,1,2,4].map(v=>`<button class="chip" data-v="${v}" aria-pressed="${LP.per===v}">${v===0.5?'½':v}</button>`).join('')}</div></div>
          <div class="grow"><div class="lbl"><b>Intro bars</b></div><div class="chips" id="lpIntro">${[0,1,2,4].map(v=>`<button class="chip" data-v="${v}" aria-pressed="${LP.intro===v}">${v}</button>`).join('')}</div></div>
          <div class="grow"><div class="lbl"><b>Auto-place lines</b><small>Each line lands on a bar line, with word timing</small></div><button class="btn white sm" data-lp="place">${ic('magnet','xs')}Place</button></div></div>
        <div class="h3">Structure</div><div class="struct" id="lpStruct"></div>
      </div>`;
    const T=el.querySelector('#lpTitle'), B=el.querySelector('#lpBody'), info=el.querySelector('#lpInfo'), rh=el.querySelector('#lpRh');
    const fit=()=>{ T.style.height='auto'; T.style.height=T.scrollHeight+'px'; }; requestAnimationFrame(fit);
    const save=()=>{ s.title=T.value.replace(/\n/g,' '); s.body=B.value; s.updated=Date.now(); clearTimeout(edSaveT); edSaveT=setTimeout(SAVE.items,350); struct(); };
    const struct=()=>{ const rows=B.value.split('\n'); let n=0; el.querySelector('#lpStruct').innerHTML=rows.map(r=>{ const t=r.trim(); if(!t) return ''; if(/^\[[^\]]*\]$/.test(t)) return `<div class="sec">${esc(t.slice(1,-1))}</div>`; n++; const sy=lineWords(t).reduce((a,w)=>a+syllables(w),0); return `<div><i>${sy}</i><span>${esc(t)}</span></div>`; }).join('')||'<div class="mute">Your sections and syllable counts appear here.</div>'; el.querySelector('#lpCount').textContent=n+' lines'; };
    let rT=0;
    const caret=()=>{ const v=B.value, p=B.selectionStart||0, ls=v.slice(0,p).split('\n'), li=ls.length-1, all=v.split('\n'), cur=(all[li]||'').trim();
      const sy=lineWords(cur).reduce((a,w)=>a+syllables(w),0);
      let target=cur&&!/^\[/.test(cur)?lineWords(cur).pop():''; if(!target){ for(let k=li-1;k>=0;k--){ const t=(all[k]||'').trim(); if(t&&!/^\[/.test(t)){ target=lineWords(t).pop(); break; } } }
      target=(target||'').replace(/[^A-Za-z'\-а-яё]/gi,'');
      info.innerHTML=`<span>Line <b>${li+1}</b></span><i class="dot-sep"></i><span><b>${sy}</b> syllables</span>${target?`<i class="dot-sep"></i><span>Rhymes for <b>${esc(target)}</b></span>`:''}`;
      clearTimeout(rT); if(!target){ rh.innerHTML=''; return; } rT=setTimeout(async()=>{ rh.innerHTML='<span class="mute" style="font-size:.84rem">Finding rhymes…</span>'; const r=await rhymesFor(target,v); rh.innerHTML=r.list.length?r.list.map(w=>`<button class="chip" data-w="${esc(w)}">${esc(w)}</button>`).join('')+`<span class="mute" style="font-size:.74rem;align-self:center">${r.src==='offline'?'offline suggestions':'via Datamuse'}</span>`:'<span class="mute" style="font-size:.84rem">No rhymes found</span>'; },260); };
    T.addEventListener('input',()=>{ fit(); save(); });
    B.addEventListener('input',()=>{ save(); caret(); }); B.addEventListener('click',caret); B.addEventListener('keyup',e=>{ if(e.key.startsWith('Arrow')) caret(); });
    rh.addEventListener('click',e=>{ const c=e.target.closest('[data-w]'); if(!c) return; const p=B.selectionStart??B.value.length, before=B.value.slice(0,p), after=B.value.slice(p); const ins=(before&&!/[\s]$/.test(before)?' ':'')+c.dataset.w; B.value=before+ins+after; B.focus(); B.setSelectionRange(p+ins.length,p+ins.length); save(); caret(); });
    el.querySelectorAll('[data-sec]').forEach(b=>b.onclick=()=>{ const p=B.selectionStart??B.value.length, before=B.value.slice(0,p), after=B.value.slice(p); const ins=(before&&!before.endsWith('\n')?'\n\n':before?'\n':'')+'['+b.dataset.sec+']\n'; B.value=before+ins+after; B.focus(); B.setSelectionRange(p+ins.length,p+ins.length); save(); caret(); });
    const chipSet=(sel,key)=>el.querySelector(sel).onclick=e=>{ const b=e.target.closest('[data-v]'); if(!b) return; LP[key]=+b.dataset.v; $$(sel+' .chip',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b))); };
    chipSet('#lpPer','per'); chipSet('#lpIntro','intro');
    // ---- tempo: manual, tap tempo, beats per bar, metronome
    const inst=s.music&&s.music.type==='inst'&&CAT.get(s.music.id);
    const bpmNow=()=>s.bpm||(s.music&&s.music.type==='click'&&s.music.bpm)||(inst&&inst.bpm)||96;
    const showBpm=()=>{ const v=bpmNow(); el.querySelector('#lpBpm').textContent=v; el.querySelector('#lpBpmR').value=v;
      el.querySelector('#lpTempoSrc').textContent=s.bpm?'Set by you'+(inst?' · overrides the beat’s tempo':''):inst&&inst.bpm?'From your beat':s.music&&s.music.type!=='click'?'Detected from your music when you place lines':'No beat? Lectern adds a click track so you can sing it in time.'; };
    const setBpm=v=>{ s.bpm=Math.max(50,Math.min(200,Math.round(v))); s.updated=Date.now(); clearTimeout(edSaveT); edSaveT=setTimeout(SAVE.items,350); showBpm(); if(LP.metro) metroStart(); };
    el.querySelectorAll('[data-tp]').forEach(b=>b.onclick=()=>setBpm(bpmNow()+(+b.dataset.tp)));
    el.querySelector('#lpBpmR').oninput=e=>setBpm(+e.target.value);
    el.querySelector('#lpTap').onclick=()=>{ const now=performance.now(); if(LP.taps.length&&now-LP.taps[LP.taps.length-1]>2000) LP.taps=[]; LP.taps.push(now); LP.taps=LP.taps.slice(-8);
      tick1(LP.taps.length===1); const btn=el.querySelector('#lpTap'); btn.classList.remove('hit'); void btn.offsetWidth; btn.classList.add('hit');
      if(LP.taps.length>=3){ const iv=LP.taps.slice(1).map((t,i)=>t-LP.taps[i]).sort((a,b)=>a-b); const med=iv[Math.floor(iv.length/2)]; setBpm(60000/med); btn.textContent='Tap · '+LP.taps.length; } else btn.textContent=LP.taps.length===1?'Keep tapping':'Tap'; };
    el.querySelector('#lpBeats').onclick=e=>{ const b=e.target.closest('[data-v]'); if(!b) return; s.beats=+b.dataset.v; SAVE.items(); $$('#lpBeats .chip',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b))); if(LP.metro) metroStart(); };
    const tick1=(down)=>{ const c=ac(); c.resume(); const t=c.currentTime+0.005, o=c.createOscillator(), g=c.createGain(); o.frequency.value=down?1320:880; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.4,t+0.003); g.gain.exponentialRampToValueAtTime(0.0001,t+0.06); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+0.08); };
    const metroStop=()=>{ if(LP.metro){ clearInterval(LP.metro.iv); LP.metro=null; } const t=el.querySelector('#lpMetro'); if(t) t.setAttribute('aria-checked','false'); };
    const metroStart=()=>{ metroStop(); AUDIO.claim('metro'); const c=ac(); c.resume(); const M={next:c.currentTime+0.1,k:0}; LP.metro=M;
      M.iv=setInterval(()=>{ if(!el.isConnected){ metroStop(); return; } const beat=60/bpmNow(), bpb=s.beats||4; while(M.next<c.currentTime+0.15){ const down=M.k%bpb===0, o=c.createOscillator(), g=c.createGain(); o.frequency.value=down?1320:880; g.gain.setValueAtTime(0.0001,M.next); g.gain.exponentialRampToValueAtTime(down?0.45:0.2,M.next+0.003); g.gain.exponentialRampToValueAtTime(0.0001,M.next+0.06); o.connect(g); g.connect(c.destination); o.start(M.next); o.stop(M.next+0.08); M.next+=beat; M.k++; } },25);
      el.querySelector('#lpMetro').setAttribute('aria-checked','true'); };
    el.querySelector('#lpMetro').onclick=()=>{ LP.metro?metroStop():metroStart(); };
    AUDIO.register('metro',{label:'Metronome',sub:()=>bpmNow()+' BPM',icon:'timer',playing:()=>!!LP.metro,stop:metroStop,here:()=>el.isConnected});
    showBpm();
    el.querySelector('[data-lp="sing"]').onclick=()=>{ clearTimeout(edSaveT); SAVE.items(); if(!lyricLines(s.body).length){ toast('Write some lyrics first'); return; } startItem(s); };
    el.querySelector('[data-lp="place"]').onclick=()=>placeOnBeat(s,LP);
    struct(); if(!s.body) setTimeout(()=>B.focus(),420);
  });
}
async function placeOnBeat(s,LP){
  const lines=lyricLines(s.body); if(!lines.length){ toast('Write some lyrics first'); return; }
  const bpb=s.beats||4;
  // No beat: build a click track at the chosen tempo so the song can be sung in time.
  if(!s.music||s.music.type==='click'){
    const bpm=s.bpm||(s.music&&s.music.bpm)||96, bar=60*bpb/bpm, dur=0.05+(LP.intro+lines.length*LP.per+2)*bar;
    s.music={type:'click',bpm,beats:bpb,dur:Math.ceil(dur)};
  }
  const inst=s.music.type==='inst'&&CAT.get(s.music.id);
  toast(s.bpm||s.music.type==='click'||(inst&&inst.bpm)?'Placing lines…':'Detecting the tempo…');
  await loadTimedAudio(s);
  let bar, t0, an=null, downs=null;
  if(player.hasAudio&&s.music.type!=='click'){ try{ an=await analyze(player.buf,player.key); }catch(e){} }
  const tempo=s.music.type==='click'?s.music.bpm:s.bpm;
  if(tempo){ bar=60*bpb/tempo; const first=an&&an.downbeats.length?an.downbeats[0]:0.05; t0=first+LP.intro*bar; }
  else if(inst&&inst.bpm){ bar=60*bpb/inst.bpm; t0=0.05+LP.intro*bar; }
  else if(an&&an.downbeats.length>4){ downs=an.downbeats; bar=60*bpb/an.bpm; }
  else { bar=2.4; t0=LP.intro*bar; }
  s.timedText=lyricLines(bodyOf(s)).join('\n');
  s.times=lines.map((_,i)=>{ if(downs){ const k=LP.intro+i*LP.per, k0=Math.floor(k), fr=k-k0; const base=k0<downs.length?downs[k0]:downs[downs.length-1]+(k0-downs.length+1)*bar; return +(base+fr*bar).toFixed(3); } return +(t0+i*LP.per*bar).toFixed(3); });
  s.ends=s.times.map((t,i)=>+(Math.min((s.times[i+1]??t+LP.per*bar)-0.1,t+LP.per*bar*0.92)).toFixed(3));
  s.wt=lines.map((l,i)=>distributeWords(l,s.times[i],s.ends[i],an&&an.peaks));
  s.updated=Date.now(); SAVE.items();
  actionSheet('Lines placed on the beat',[{icon:'mic-vocal',label:'Sing it now',run:()=>startItem(s)},{icon:'audio-waveform',label:'Fine-tune on the waveform',run:()=>openTimeline(s)},{icon:'check',label:'Keep writing',run(){}}],lines.length+' lines · '+(tempo||(inst&&inst.bpm)||(an?an.bpm:'~100'))+' BPM · '+(LP.per===0.5?'half a':LP.per)+' bar'+(LP.per>1?'s':'')+' per line');
}

/* ---------- Sound recorder ---------- */
function openRecorder(){
  const R={stream:null,rec:null,chunks:[],t0:0,raf:0,blob:null,url:'',an:null,clean:true,backing:null,back:new Audio()};
  const recPlay=()=>document.querySelector('#rcPlay');
  AUDIO.register('recorder',{label:'Sound recorder',sub:()=>R.rec&&R.rec.state==='recording'?'Recording with backing':'Playback',icon:'mic',
    playing:()=>!R.back.paused||!!(recPlay()&&!recPlay().paused), stop:()=>{ R.back.pause(); const p=recPlay(); if(p) p.pause(); },
    here:()=>{ const e=STACK[STACK.length-1]; return !!(e&&e.name==='recorder'); }});
  R.back.addEventListener('play',()=>AUDIO.claim('recorder'));
  const stopAll=()=>{ cancelAnimationFrame(R.raf); if(R.rec&&R.rec.state!=='inactive') R.rec.stop(); if(R.stream) R.stream.getTracks().forEach(t=>t.stop()); R.stream=null; R.back.pause(); };
  push('recorder',el=>{
    el.innerHTML=pbar('Sound recorder')+`
      <p class="pad mute" style="margin:0">Record a melody idea, a vocal, a sound effect or a whole acapella. It’s saved as a sound you can use anywhere.</p>
      <canvas class="wave" id="rcWave" width="880" height="180"></canvas>
      <div class="meter"><i id="rcMeter"></i></div>
      <button class="recbig" id="rcBtn" aria-label="Record"><i></i></button>
      <div style="text-align:center;font-family:var(--mono);font-size:1.3rem" id="rcTime">0:00</div>
      <div class="pad" style="display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        <button class="chip" id="rcClean" aria-pressed="true">${ic('sparkles','xs')}Clean up noise</button>
        <button class="chip" id="rcBack">${ic('headphones','xs')}<span>Backing: none</span></button>
      </div>
      <div id="rcAfter" hidden style="margin-top:22px">
        <div class="pad"><audio id="rcPlay" controls style="width:100%"></audio></div>
        <label class="field" style="margin-top:12px"><span>Name</span><input id="rcName" maxlength="40" value="Sound ${S.sounds.length+1}"></label>
        <div class="row-btns"><button class="btn" id="rcDiscard">Discard</button><button class="btn white" id="rcSave">Save sound</button></div>
      </div>`;
    const cv=el.querySelector('#rcWave'), g=cv.getContext('2d'), meter=el.querySelector('#rcMeter'), btn=el.querySelector('#rcBtn');
    const draw=()=>{ if(!el.isConnected){ stopAll(); return; } if(R.an){ const d=new Uint8Array(R.an.fftSize); R.an.getByteTimeDomainData(d); g.fillStyle='#161619'; g.fillRect(0,0,cv.width,cv.height); g.strokeStyle='#C4B5FD'; g.lineWidth=3; g.beginPath(); let pk=0; for(let i=0;i<d.length;i++){ const v=(d[i]-128)/128; pk=Math.max(pk,Math.abs(v)); const x=i/d.length*cv.width, y=cv.height/2+v*cv.height*.45; i?g.lineTo(x,y):g.moveTo(x,y); } g.stroke(); meter.style.width=Math.min(100,pk*140)+'%'; }
      if(R.rec&&R.rec.state==='recording') el.querySelector('#rcTime').textContent=fmt((performance.now()-R.t0)/1000); R.raf=requestAnimationFrame(draw); };
    const start=async()=>{
      try{ R.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:R.clean,noiseSuppression:R.clean,autoGainControl:R.clean}}); }catch(e){ toast('Microphone access was blocked'); return; }
      const c=ac(); c.resume(); const src=c.createMediaStreamSource(R.stream); R.an=c.createAnalyser(); R.an.fftSize=1024; src.connect(R.an);
      const mt=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>window.MediaRecorder&&MediaRecorder.isTypeSupported(t))||'';
      R.chunks=[]; R.rec=new MediaRecorder(R.stream,mt?{mimeType:mt}:undefined); R.rec.ondataavailable=e=>{ if(e.data.size) R.chunks.push(e.data); };
      R.rec.onstop=()=>{ R.blob=new Blob(R.chunks,{type:(R.rec.mimeType||mt||'audio/webm').split(';')[0]}); if(R.url) URL.revokeObjectURL(R.url); R.url=URL.createObjectURL(R.blob); el.querySelector('#rcPlay').src=R.url; el.querySelector('#rcAfter').hidden=false; btn.classList.remove('on'); if(R.stream) R.stream.getTracks().forEach(t=>t.stop()); R.stream=null; R.an=null; R.back.pause(); };
      R.rec.start(250); R.t0=performance.now(); btn.classList.add('on'); el.querySelector('#rcAfter').hidden=true;
      if(R.backing){ try{ R.back.currentTime=0; R.back.play(); }catch(e){} }
      cancelAnimationFrame(R.raf); R.raf=requestAnimationFrame(draw);
    };
    btn.onclick=()=>{ if(R.rec&&R.rec.state==='recording') R.rec.stop(); else start(); };
    el.querySelector('#rcClean').onclick=e=>{ R.clean=!R.clean; e.currentTarget.setAttribute('aria-pressed',String(R.clean)); };
    el.querySelector('#rcBack').onclick=()=>actionSheet('Play a backing while you record',[{icon:'x',label:'None',run:()=>{ R.backing=null; el.querySelector('#rcBack span').textContent='Backing: none'; }},...allInst().map(x=>({icon:'audio-waveform',label:x.title,sub:x.mood,run:async()=>{ try{ const b=await instBlob(x); R.back.src=URL.createObjectURL(b); R.backing=x; el.querySelector('#rcBack span').textContent='Backing: '+x.title; toast('Use headphones so the backing isn’t recorded'); }catch(e){ toast('Couldn’t load that track'); } }}))]);
    el.querySelector('#rcDiscard').onclick=()=>{ R.blob=null; el.querySelector('#rcAfter').hidden=true; el.querySelector('#rcTime').textContent='0:00'; };
    el.querySelector('#rcSave').onclick=async()=>{ if(!R.blob) return; const id='snd-'+uid(), name=el.querySelector('#rcName').value.trim()||'My sound';
      await idb.put('snd:'+id,R.blob); const dur=await probeDuration(R.blob)||(performance.now()-R.t0)/1000; const rec={id,name,dur,created:Date.now()};
      S.sounds.unshift(rec); SAVE.sounds(); registerUserInst(rec,'snd'); toast('Saved “'+name+'” to your sounds'); stopAll(); pop(); };
  });
}

/* ---------- Script writer ---------- */
const TEMPLATES=[
  {k:'script',t:'Video intro',d:'Hook, promise, and a reason to stay',b:"Hey, I'm {name}. [smile]\n\nIn the next few minutes I'm going to show you ____ — and the one mistake almost everyone makes with it.\n\n[beat]\n\nIf you're new here, I make videos about ____ every week.\n\nLet's get into it."},
  {k:'script',t:'Product demo',d:'Problem, solution, proof, call to action',b:"Here's a problem you probably know: ____.\n\n[pause]\n\nThat's why we built ____. Watch this.\n\n[show product]\n\nIn three taps, ____. No setup, no manual.\n\nTry it today at ____."},
  {k:'script',t:'Elevator pitch',d:'Thirty seconds that make them ask for more',b:"I help ____ who struggle with ____.\n\nMost people try ____, and it doesn't work because ____.\n\n[beat]\n\nWe do it differently: ____.\n\nIf that sounds useful, I'd love ten minutes of your time."},
  {k:'script',t:'Wedding toast',d:'Warm, funny, and under two minutes',b:"Good evening, everyone. For those who don't know me, I'm {name}.\n\n[smile]\n\nI've known ____ for ____ years, and I can honestly say ____.\n\nThe first time I met ____, I knew ____ was in trouble — the good kind.\n\n[raise glass]\n\nTo the happy couple."},
  {k:'script',t:'Podcast opener',d:'Welcome, topic, guest',b:"Welcome back to ____. I'm {name}.\n\nToday we're talking about ____ — and I promise you'll never think about it the same way again.\n\n[pause]\n\nMy guest is ____. Welcome to the show."},
  {k:'script',t:'Presentation opener',d:'Start with a story, not a slide',b:"Three years ago, ____.\n\n[pause]\n\nThat moment changed how I think about ____.\n\nToday I want to share three things we learned — and one we're still figuring out."},
  {k:'line',t:'Audition monologue',d:'A one-minute scene with directions',b:"[sit down slowly]\n\nYou want to know why I stayed? ____.\n\n[look away]\n\nEveryone thinks leaving is the brave thing. Sometimes staying is.\n\n[meet their eyes]\n\nSo no. I'm not sorry."},
  {k:'poem',t:'Spoken word',d:'Three stanzas, a turn, a landing',b:"I used to think ____\nwas something you could ____.\n\nThen ____\nand everything I knew\ngot quieter.\n\nNow I ____.\nNow I ____.\nNow I know."},
  {k:'script',t:'Blank script',d:'Start from scratch',b:''}
];
function openScripts(){ push('scripts',el=>{
  el.innerHTML=pbar('Script writer')+`<p class="pad mute" style="margin:0 0 16px">Pick a template. Blanks are marked ____ and directions sit in [brackets].</p><div class="list">${TEMPLATES.map((x,i)=>`<button class="card tpl" data-t="${i}"><b>${esc(x.t)} <span class="tag" style="display:inline;margin-left:6px">${KIND[x.k].tag}</span></b><span>${esc(x.d)}</span></button>`).join('')}</div>`;
  el.querySelector('.list').onclick=e=>{ const b=e.target.closest('[data-t]'); if(!b) return; const x=TEMPLATES[+b.dataset.t]; const s={id:uid(),kind:x.k,title:x.b?x.t:'',body:x.b.replace(/\{name\}/g,firstName()),updated:Date.now()}; S.items.push(s); SAVE.items(); openEditor(s.id,!x.b); };
}); }
