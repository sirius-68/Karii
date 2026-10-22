'use strict';
/* ================= Utilities ================= */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const ic=(n,c='')=>`<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const clamp01=v=>Math.max(0,Math.min(1,v));
const fmt=s=>{ s=Math.max(0,Math.floor(s||0)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
const fmtK=n=>n>=1000?(n/1000).toFixed(n>=10000?0:1).replace('.0','')+'K':String(n);
const store={
  get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};
function hash(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const today=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const wordCount=t=>((t||'').replace(/\[[^\]]*\]/g,' ').match(/\S+/g)||[]).length;
const cueCount=t=>((t||'').match(/\[[^\]]*\]/g)||[]).length;
const lyricLines=t=>(t||'').split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !/^\[[^\]]*\]$/.test(l));
const readSecs=(t,kind)=>Math.max(5,Math.round(wordCount(t)/(kind==='poem'?120:150)*60));
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; t.style.animation='none'; void t.offsetWidth; t.style.animation=''; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2800); }

/* ================= IndexedDB ================= */
const idb=(()=>{
  let dbp=null; const mem={};
  function open(){
    if(dbp) return dbp;
    dbp=new Promise(res=>{
      try{ const r=indexedDB.open('lectern',2);
        r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains('audio')) db.createObjectStore('audio'); if(!db.objectStoreNames.contains('rec')) db.createObjectStore('rec'); };
        r.onsuccess=()=>res(r.result); r.onerror=()=>res(null); r.onblocked=()=>res(null);
      }catch(e){ res(null); }
    });
    return dbp;
  }
  async function run(st,mode,fn){
    const db=await open(); if(!db) return null;
    return new Promise(res=>{
      try{ const t=db.transaction(st,mode); const req=fn(t.objectStore(st));
        t.oncomplete=()=>res(req && 'result' in req ? req.result : true); t.onerror=()=>res(null); t.onabort=()=>res(null);
      }catch(e){ res(null); }
    });
  }
  return {
    async get(k,st='audio'){ const mk=st+':'+k; if(mem[mk]) return mem[mk]; const v=await run(st,'readonly',s=>s.get(k)); if(v) mem[mk]=v; return v||null; },
    async put(k,v,st='audio'){ mem[st+':'+k]=v; const r=await run(st,'readwrite',s=>s.put(v,k)); return r!==null; },
    async del(k,st='audio'){ delete mem[st+':'+k]; return run(st,'readwrite',s=>s.delete(k)); },
    async has(k,st='audio'){ if(mem[st+':'+k]) return true; const v=await run(st,'readonly',s=>s.getKey(k)); return v!=null; }
  };
})();

/* ================= State ================= */
const DEFAULT_SETTINGS={speed:5,size:40,opac:100,mirrorText:false,mirrorCam:true,backdrop:true,countdown:3,facing:'user',focus:0.30,guide:true,offsets:{},bed:null,bedVol:35,snap:true,tapLat:0.08,ttsRate:1,lineVoice:{},ttsVoice:''};
const S={
  items: store.get('lectern.scripts',null),
  profile: store.get('lectern.profile',null),
  likes: new Set(store.get('lectern.likes',[])),
  colls: store.get('lectern.collections',[]),
  recents: Object.assign({played:[],searches:[]},store.get('lectern.recents',{})),
  plays: store.get('lectern.plays',{}),
  stats: Object.assign({days:[],seconds:0},store.get('lectern.stats',{})),
  recs: store.get('lectern.recs',[]),
  settings: Object.assign({},DEFAULT_SETTINGS,store.get('lectern.settings',{})),
  newsSeen: store.get('lectern.newsSeen',0),
  pdb: store.get('lectern.pdbcache',[]),
  beats: store.get('lectern.beats',[]),
  sounds: store.get('lectern.sounds',[]),
  auth: store.get('lectern.auth',null)
};
if(!Array.isArray(S.items)) S.items=[];
S.items=S.items.filter(s=>!(s.demo && s.title==='Lights Up (demo)'));
S.items.forEach(s=>{ if(!s.kind) s.kind='script'; if(s.kind==='song' && !s.music && s.audioName) s.music={type:'file',name:s.audioName,dur:s.audioDur||0}; });
const SAVE={
  items:()=>store.set('lectern.scripts',S.items), profile:()=>store.set('lectern.profile',S.profile),
  likes:()=>store.set('lectern.likes',[...S.likes]), colls:()=>store.set('lectern.collections',S.colls),
  recents:()=>store.set('lectern.recents',S.recents), plays:()=>store.set('lectern.plays',S.plays),
  stats:()=>store.set('lectern.stats',S.stats), recs:()=>store.set('lectern.recs',S.recs),
  settings:()=>store.set('lectern.settings',S.settings), pdb:()=>store.set('lectern.pdbcache',S.pdb.slice(-80)),
  beats:()=>store.set('lectern.beats',S.beats), sounds:()=>store.set('lectern.sounds',S.sounds),
  auth:()=>store.set('lectern.auth',S.auth)
};
SAVE.items();
const firstName=()=>((S.profile&&S.profile.name)||'friend').trim().split(/\s+/)[0]||'friend';
const personalize=t=>String(t||'').replace(/\{name\}/g,firstName());

/* ================= Music theory + song layout ================= */
const NOTE_IX={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const midi=n=>{ const m=n.match(/^([A-G][#b]?)(-?\d)$/); return 12*(+m[2]+1)+NOTE_IX[m[1]]; };
const hz=m=>440*Math.pow(2,(m-69)/12);
const parseSeq=str=>String(str||'').trim().split(/\s+/).filter(Boolean).map(t=>{ const [n,d]=t.split(':'); return {n,d:+d||1}; });
const CHORD_TONES={C:[60,64,67],F:[60,65,69],G:[59,62,67],Am:[60,64,69],D:[62,66,69],Em:[59,64,67],Dm:[62,65,69],E:[59,64,68],A:[61,64,69],G7:[59,62,65,67]};
const CHORD_ROOT={C:36,F:41,G:43,Am:45,D:38,Em:40,Dm:38,E:40,A:45,G7:43};
SONGS.push({ id:'k-lightsup', title:'Lights Up', artist:'Lectern Originals', credit:'Original song written for Lectern · Free to use', bpm:90, bar:4, introBars:2, genre:'Pop', original:true,
  lines:["The room goes quiet, the red light glows","I've got the words and nobody knows","How many takes it took to get here","But this one's different, this one is clear","So turn the lights up, let the line roll","Every word lands right where it should go","Turn the lights up, I'm reading the room","One more time and I'm singing it through","Eyes on the lens and a breath in between","Saying it softer than I've ever been","Turn the lights up, let the line roll","One more time and the song is my own"].map((t,i)=>({t,n:'R:8',c:['C','G','Am','F'][i%4]+':8'})) });
function layoutSong(s){
  const beat=60/s.bpm, intro=s.bar*beat*(s.introBars||1);
  let b=0; const times=[],ends=[],notes=[],chords=[],wt=[];
  s.lines.forEach(L=>{
    const start=b; let x=0,lastEnd=0; const ln=[];
    parseSeq(L.n).forEach(t=>{ if(t.n!=='R'){ const nt={m:midi(t.n),t:start+x,d:t.d}; notes.push(nt); ln.push(nt); lastEnd=x+t.d; } x+=t.d; });
    if(ln.length){
      const ws=String(L.t).split(/\s+/).filter(Boolean), syl=ws.map(w=>Math.max(1,syllables(w))), S_=syl.reduce((a,c)=>a+c,0);
      let k=0; wt.push(ws.map((w,wi)=>{ const a=Math.min(ln.length-1,Math.floor(k*ln.length/S_)); k+=syl[wi]; const z=Math.min(ln.length-1,Math.max(a,Math.ceil(k*ln.length/S_)-1));
        return {s:+(intro+ln[a].t*beat).toFixed(3),e:+(intro+(ln[z].t+ln[z].d*0.92)*beat).toFixed(3)}; }));
    } else wt.push(null);
    let cx=0; parseSeq(L.c).forEach(c=>{ chords.push({name:c.n,t:start+cx,d:c.d}); cx+=c.d; });
    times.push(+(intro+start*beat).toFixed(3));
    ends.push(+(intro+(start+(lastEnd||Math.max(x,cx)*0.9))*beat).toFixed(3));
    b+=Math.max(x,cx);
  });
  return {beat,intro,times,ends,notes,chords,wt,totalBeats:b,dur:intro+(b+2)*beat};
}

/* ================= Catalog ================= */
const CAT=new Map();
const KIND={
  song:{label:'Karaoke',tag:'Karaoke',icon:'mic-vocal',verb:'Sing',play:'mic-vocal'},
  poem:{label:'Poem',tag:'Poem',icon:'feather',verb:'Read aloud',play:'book-open'},
  line:{label:'Movie line',tag:'Scene',icon:'clapperboard',verb:'Perform',play:'clapperboard'},
  script:{label:'Script',tag:'Script',icon:'scroll-text',verb:'Open prompter',play:'scroll-text'},
  inst:{label:'Instrumental',tag:'Beat',icon:'audio-waveform',verb:'Play',play:'play'}
};
SONGS.forEach(s=>{ const L=layoutSong(s); CAT.set(s.id,{...s,kind:'song',cat:true,sub:s.artist,layout:L,times:L.times,ends:L.ends,wt:L.wt,dur:L.dur,body:s.lines.map(l=>l.t).join('\n')}); });
ORIGINAL_POEMS.forEach(p=>CAT.set(p.id,{...p,kind:'poem',cat:true,sub:'Lectern Originals',original:true}));
MOVIE_LINES.forEach(m=>CAT.set(m.id,{...m,kind:'line',cat:true,sub:m.genre+' · '+m.role,original:true}));
INSTRUMENTALS.forEach(x=>CAT.set(x.id,{...x,kind:'inst',cat:true,sub:'Tanner Helland',body:'',url:x.file?TH_BASE+encodeURIComponent(x.file):null}));
S.pdb.forEach(p=>CAT.set(p.id,p));
function registerUserInst(b,st){ CAT.set(b.id,{id:b.id,kind:'inst',user:true,cat:true,store:st,title:b.name,sub:st==='beat'?'Your beat':'Your sound',mood:st==='beat'?(b.styleName||'Beat')+' · '+b.bpm+' BPM':'Recording',dur:b.dur,bpm:b.bpm||null,body:''}); }
S.beats.forEach(b=>registerUserInst(b,'beat')); S.sounds.forEach(b=>registerUserInst(b,'snd'));
function addPdb(author,title,lines){
  const id='pdb-'+hash(author+'|'+title).toString(36);
  if(CAT.has(id)) return CAT.get(id);
  const o={id,kind:'poem',cat:true,pdb:true,title,sub:author,form:'Classic',body:lines.join('\n').replace(/\n{3,}/g,'\n\n')};
  CAT.set(id,o); S.pdb=S.pdb.filter(p=>p.id!==id); S.pdb.push(o); SAVE.pdb(); return o;
}
const find=id=>S.items.find(s=>s.id===id)||CAT.get(id)||null;
const isLib=it=>!!it && !it.cat;
function durOf(it){
  if(!it) return 0;
  if(it.kind==='song') return it.cat?it.dur:(it.music&&it.music.dur)||(()=>{ const t=(it.times||[]).filter(v=>v!=null); return t.length?Math.max(...t)+4:lyricLines(it.body).length*4; })();
  if(it.kind==='inst') return it.dur||0;
  return readSecs(it.body,it.kind);
}
function bodyOf(it){ return it.kind==='song' ? personalize(it.body) : it.body||''; }
function bump(id){ S.plays[id]=(S.plays[id]||0)+1; SAVE.plays(); S.recents.played=[id,...S.recents.played.filter(x=>x!==id)].slice(0,20); SAVE.recents(); }
const playsOf=id=>{ const base=(hash(id)%90)+12; return base+(S.plays[id]||0); };
function toggleLike(id){ if(S.likes.has(id)) S.likes.delete(id); else S.likes.add(id); SAVE.likes(); return S.likes.has(id); }

/* ================= Generative cover art ================= */
const PALETTES=[
  ['#0B1D3A','#2A6FDB','#9CC9FF','#F4D58D'], ['#2B0F3A','#C2185B','#FF8A65','#FFD180'], ['#06281F','#0F766E','#5EEAD4','#E0F2F1'],
  ['#161616','#F5C518','#FF5F1F','#FFF6D6'], ['#1B0A2A','#7C3AED','#F472B6','#FDE68A'], ['#0A0A0A','#E63946','#F1FAEE','#A8DADC'],
  ['#102A43','#486581','#D9E2EC','#F0B429'], ['#3D0C02','#C1440E','#F2A541','#F5E6CA'], ['#0D1B2A','#1B998B','#ED217C','#FFFD82'],
  ['#0F0E17','#FF8906','#F25F4C','#E53170'], ['#132A13','#4F772D','#90A955','#ECF39E'], ['#1A1033','#3A86FF','#8338EC','#FF006E']
];
const hexA=(h,a)=>{ const n=parseInt(h.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; };
let NOISE=null;
function noiseCanvas(){ if(NOISE) return NOISE; const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d'); const d=g.createImageData(128,128); for(let i=0;i<d.data.length;i+=4){ const v=Math.random()*255|0; d.data[i]=d.data[i+1]=d.data[i+2]=v; d.data[i+3]=255; } g.putImageData(d,0,0); NOISE=c; return c; }
const COVERS=new Map();
function cover(it,size=320){
  const key=(it.id||'x')+':'+size+':'+(it.title||'');
  if(COVERS.has(key)) return COVERS.get(key);
  const c=document.createElement('canvas'); c.width=c.height=size; const g=c.getContext('2d');
  const r=rng(hash(key)); const pal=it.pal!=null?PALETTES[it.pal%PALETTES.length]:PALETTES[Math.floor(r()*PALETTES.length)];
  const lg=g.createLinearGradient(0,0,size,size); lg.addColorStop(0,pal[0]); lg.addColorStop(1,'#050506'); g.fillStyle=lg; g.fillRect(0,0,size,size);
  for(let i=0;i<6;i++){ const x=r()*size,y=r()*size,rad=size*(.28+r()*.5),col=pal[1+Math.floor(r()*3)];
    const rg=g.createRadialGradient(x,y,0,x,y,rad); rg.addColorStop(0,hexA(col,.85)); rg.addColorStop(1,hexA(col,0)); g.fillStyle=rg; g.fillRect(0,0,size,size); }
  const k=it.kind||'av', S_=size;
  g.save();
  if(k==='song'){
    const mx=S_*(.35+r()*.35), my=S_*(.22+r()*.18), mr=S_*(.11+r()*.06);
    const glow=g.createRadialGradient(mx,my,mr*.6,mx,my,mr*3.2); glow.addColorStop(0,hexA(pal[3],.55)); glow.addColorStop(1,hexA(pal[3],0)); g.fillStyle=glow; g.fillRect(0,0,S_,S_);
    g.fillStyle=pal[3]; g.beginPath(); g.arc(mx,my,mr,0,Math.PI*2); g.fill();
    if(r()>.5){ g.globalCompositeOperation='destination-out'; g.beginPath(); g.arc(mx+mr*.45,my-mr*.25,mr*.9,0,Math.PI*2); g.fill(); g.globalCompositeOperation='source-over'; }
    const hy=S_*.66; const sea=g.createLinearGradient(0,hy,0,S_); sea.addColorStop(0,hexA(pal[1],.0)); sea.addColorStop(.05,hexA('#000000',.35)); sea.addColorStop(1,hexA('#000000',.75)); g.fillStyle=sea; g.fillRect(0,hy,S_,S_-hy);
    g.strokeStyle=hexA(pal[3],.55); g.lineCap='round';
    for(let j=0;j<7;j++){ const yy=hy+8+j*(S_-hy)/8, w=mr*(1.4-j*.14)*(.6+r()*.6); g.lineWidth=Math.max(1,S_/160); g.beginPath(); g.moveTo(mx-w,yy); g.lineTo(mx+w,yy); g.stroke(); }
    if(r()>.4){ const fx=S_*(.15+r()*.6), fy=hy-2; g.fillStyle='rgba(0,0,0,.85)'; g.beginPath(); g.ellipse(fx,fy-S_*.055,S_*.012,S_*.014,0,0,Math.PI*2); g.fill(); g.fillRect(fx-S_*.01,fy-S_*.045,S_*.02,S_*.045); }
  } else if(k==='poem'){
    g.strokeStyle='rgba(255,255,255,.10)'; g.lineWidth=1; for(let y=S_*.1;y<S_;y+=S_/14){ g.beginPath(); g.moveTo(0,y); g.lineTo(S_,y); g.stroke(); }
    const ch=(it.title||'P').replace(/^(The|A|An)\s+/i,'').trim()[0]||'P';
    g.fillStyle='rgba(255,255,255,.9)'; g.font=`italic ${S_*.7}px Georgia, "Times New Roman", serif`; g.textBaseline='alphabetic'; g.fillText(ch.toUpperCase(),S_*.08,S_*.84);
    for(let j=0;j<14;j++){ g.fillStyle=`rgba(255,255,255,${.3+r()*.6})`; g.beginPath(); g.arc(r()*S_,r()*S_*.5,r()*S_*.006+.6,0,Math.PI*2); g.fill(); }
  } else if(k==='line'){
    g.globalCompositeOperation='screen';
    const cx=S_*(.3+r()*.4); const cone=g.createLinearGradient(cx,0,cx,S_); cone.addColorStop(0,'rgba(255,255,255,.75)'); cone.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=cone; g.beginPath(); g.moveTo(cx-S_*.04,0); g.lineTo(cx+S_*.04,0); g.lineTo(cx+S_*.34,S_); g.lineTo(cx-S_*.34,S_); g.closePath(); g.fill();
    g.globalCompositeOperation='source-over';
    g.fillStyle='rgba(0,0,0,.88)'; const fy=S_*.82; g.beginPath(); g.ellipse(cx,fy-S_*.2,S_*.035,S_*.04,0,0,Math.PI*2); g.fill();
    g.beginPath(); g.moveTo(cx-S_*.06,fy); g.quadraticCurveTo(cx-S_*.065,fy-S_*.14,cx,fy-S_*.155); g.quadraticCurveTo(cx+S_*.065,fy-S_*.14,cx+S_*.06,fy); g.closePath(); g.fill();
    g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(0,0,S_,S_*.07); g.fillRect(0,S_*.93,S_,S_*.07);
    g.fillStyle='rgba(255,255,255,.55)'; for(let x=S_*.03;x<S_;x+=S_/11){ g.fillRect(x,S_*.02,S_*.045,S_*.03); g.fillRect(x,S_*.95,S_*.045,S_*.03); }
  } else if(k==='inst'){
    const n=30, w=S_/n; g.fillStyle='rgba(255,255,255,.88)';
    for(let j=0;j<n;j++){ const h=S_*(.05+Math.pow(Math.sin(j/n*Math.PI),1.4)*(.15+r()*.35)); const x=j*w+w*.22, y=S_*.62-h/2; g.beginPath(); g.roundRect?g.roundRect(x,y,w*.56,h,w*.28):g.rect(x,y,w*.56,h); g.fill(); }
  } else if(k==='script'){
    g.fillStyle='rgba(255,255,255,.88)'; g.font=`${S_*.8}px Georgia, serif`; g.fillText('“',S_*.06,S_*.78);
    g.fillStyle='rgba(255,255,255,.35)'; for(let j=0;j<4;j++) g.fillRect(S_*.12,S_*(.68+j*.06),S_*(.76-j*.12),S_*.022);
  } else if(k==='av'){
    for(let j=0;j<3;j++){ const x=r()*S_,y=r()*S_,rad=S_*(.2+r()*.3); const rg=g.createRadialGradient(x,y,0,x,y,rad); rg.addColorStop(0,hexA(pal[3],.8)); rg.addColorStop(1,hexA(pal[3],0)); g.fillStyle=rg; g.fillRect(0,0,S_,S_); }
  }
  g.restore();
  g.globalAlpha=.09; g.globalCompositeOperation='overlay'; g.fillStyle=g.createPattern(noiseCanvas(),'repeat'); g.fillRect(0,0,size,size);
  g.globalAlpha=1; g.globalCompositeOperation='source-over';
  const vg=g.createRadialGradient(size/2,size/2,size*.35,size/2,size/2,size*.75); vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,.45)'); g.fillStyle=vg; g.fillRect(0,0,size,size);
  const url=c.toDataURL('image/jpeg',.86); COVERS.set(key,url); return url;
}
const coverCss=(it,size)=>`background-image:url('${cover(it,size)}')`;
function avatarURL(){ const p=S.profile||{}; return p.photo || cover({id:'av:'+(p.pal??4)+':'+(p.name||''),kind:'av',pal:p.pal??4,title:''},240); }

/* ================= Audio synthesis ================= */
function wavFromBuffer(buf){
  const ch=buf.getChannelData(0), n=ch.length, sr=buf.sampleRate, ab=new ArrayBuffer(44+n*2), v=new DataView(ab);
  const w=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
  w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++){ const x=Math.max(-1,Math.min(1,ch[i])); v.setInt16(44+i*2,x<0?x*0x8000:x*0x7FFF,true); }
  return new Blob([ab],{type:'audio/wav'});
}
async function renderSong(song,guide){
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext; if(!OAC) return null;
  const L=song.layout, sr=22050, beat=L.beat, off=L.intro, len=L.dur+1;
  const ctx=new OAC(1,Math.ceil(sr*len),sr);
  const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=3; comp.connect(ctx.destination);
  const master=ctx.createGain(); master.gain.value=.85; master.connect(comp);
  const keysBus=ctx.createBiquadFilter(); keysBus.type='lowpass'; keysBus.frequency.value=2600; keysBus.connect(master);
  const noise=ctx.createBuffer(1,Math.ceil(sr*.2),sr); const nd=noise.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
  const env=(g,t,a,peak,dec,sus,end)=>{ g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(peak,t+a); g.gain.exponentialRampToValueAtTime(Math.max(0.0001,peak*sus),t+a+dec); g.gain.setValueAtTime(Math.max(0.0001,peak*sus),Math.max(t+a+dec,end-0.06)); g.gain.exponentialRampToValueAtTime(0.0001,end+0.05); };
  const hat=(t,v=.08)=>{ const s=ctx.createBufferSource(); s.buffer=noise; const hp=ctx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000; const g=ctx.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.05); s.connect(hp); hp.connect(g); g.connect(master); s.start(t); s.stop(t+.07); };
  const kick=(t,v=.6)=>{ const o=ctx.createOscillator(); o.frequency.setValueAtTime(140,t); o.frequency.exponentialRampToValueAtTime(42,t+.12); const g=ctx.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.24); o.connect(g); g.connect(master); o.start(t); o.stop(t+.26); };
  const snare=(t,v=.18)=>{ const s=ctx.createBufferSource(); s.buffer=noise; const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=1800; bp.Q.value=.7; const g=ctx.createGain(); g.gain.setValueAtTime(v,t); g.gain.exponentialRampToValueAtTime(0.0001,t+.16); s.connect(bp); bp.connect(g); g.connect(master); s.start(t); s.stop(t+.18); };
  const pluck=(m,t,d,v)=>{ [['triangle',0,1],['sine',12,.35]].forEach(([type,tr,mul])=>{ const o=ctx.createOscillator(); o.type=type; o.frequency.value=hz(m+tr); const g=ctx.createGain(); env(g,t,.008,v*mul,.35,.25,t+d); o.connect(g); g.connect(keysBus); o.start(t); o.stop(t+d+.1); }); };
  const introBeats=Math.round(off/beat);
  for(let i=0;i<introBeats;i++){ const t=i*beat; hat(t,i%song.bar===0?.16:.1); if(i>=introBeats-song.bar) kick(t,.35); }
  L.chords.forEach(c=>{
    const tones=CHORD_TONES[c.name]||CHORD_TONES.C, root=CHORD_ROOT[c.name]||36, t0=off+c.t*beat;
    const pad=ctx.createGain(); env(pad,t0,.2,.05,.4,.8,t0+c.d*beat); pad.connect(keysBus);
    tones.forEach(m=>{ const o=ctx.createOscillator(); o.type='sawtooth'; o.frequency.value=hz(m-12); o.detune.value=(Math.random()-.5)*12; const lp=ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900; o.connect(lp); lp.connect(pad); o.start(t0); o.stop(t0+c.d*beat+.1); });
    for(let b=0;b<c.d;b+=1){
      const t=t0+b*beat, abs=Math.round(c.t+b);
      if(b+1<=c.d+.01){ tones.forEach((m,j)=>pluck(m,t+j*0.012,beat*.9,.07)); }
      const bo=ctx.createOscillator(); bo.type='triangle'; bo.frequency.value=hz(root+(abs%2? (song.bar===3?7:0):0)); const bg=ctx.createGain(); env(bg,t,.01,.34,.25,.5,t+beat*.92); bo.connect(bg); bg.connect(master); bo.start(t); bo.stop(t+beat);
      const inBar=abs%song.bar;
      if(inBar===0) kick(t,.55); else if(song.bar===4 && inBar===2) kick(t,.35);
      if(song.bar===4 && (inBar===1||inBar===3)) snare(t);
      hat(t+beat/2,.06);
    }
  });
  if(guide){
    const lead=ctx.createGain(); lead.gain.value=1; lead.connect(master);
    L.notes.forEach(nt=>{
      const t=off+nt.t*beat, d=nt.d*beat*.96, f=hz(nt.m);
      const o=ctx.createOscillator(); o.type='triangle'; o.frequency.value=f;
      const o2=ctx.createOscillator(); o2.type='sine'; o2.frequency.value=f*2;
      if(d>.35){ const lfo=ctx.createOscillator(); lfo.frequency.value=5.2; const lg=ctx.createGain(); lg.gain.setValueAtTime(0,t); lg.gain.linearRampToValueAtTime(f*.006,t+Math.min(.4,d)); lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t+d+.1); }
      const g=ctx.createGain(); env(g,t,.03,.2,.2,.75,t+d); const g2=ctx.createGain(); g2.gain.value=.25;
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(lead); o.start(t); o2.start(t); o.stop(t+d+.12); o2.stop(t+d+.12);
    });
  }
  const last=L.chords[L.chords.length-1]; if(last){ const t=off+L.totalBeats*beat; (CHORD_TONES[last.name]||CHORD_TONES.C).forEach(m=>pluck(m,t,beat*2,.08)); kick(t,.4); }
  return wavFromBuffer(await ctx.startRendering());
}
const pending=new Map();
async function catSongBlob(id,guide){
  const key='cat:'+id+(guide?':g':'');
  let b=await idb.get(key); if(b) return b;
  if(pending.has(key)) return pending.get(key);
  const song=CAT.get(id); if(!song) return null;
  const p=renderSong(song,guide&&song.layout.notes.length>0).then(async blob=>{ if(blob) await idb.put(key,blob); pending.delete(key); return blob; }).catch(()=>{ pending.delete(key); return null; });
  pending.set(key,p); return p;
}
function b64Blob(b64,type){ const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return new Blob([u],{type}); }
const EMBED_BLOBS={};
async function instBlob(inst,{download=true}={}){
  if(inst.user) return idb.get(inst.store+':'+inst.id);
  if(inst.embed){ if(!EMBED_BLOBS[inst.embed] && window.__EMBED && __EMBED[inst.embed]) EMBED_BLOBS[inst.embed]=b64Blob(__EMBED[inst.embed],'audio/mpeg'); return EMBED_BLOBS[inst.embed]||null; }
  let b=await idb.get('inst:'+inst.id); if(b) return b;
  if(!download) return null;
  const r=await fetch(inst.url,{mode:'cors'}); if(!r.ok) throw new Error('HTTP '+r.status);
  b=await r.blob(); await idb.put('inst:'+inst.id,b); return b;
}
async function isOffline(inst){ return !!inst.embed || !!inst.user || await idb.has('inst:'+inst.id); }
async function musicBlobFor(it,guide){
  if(it.kind!=='song') return null;
  if(it.cat) return catSongBlob(it.id,guide);
  const m=it.music; if(!m) return null;
  if(m.type==='file') return idb.get(it.id);
  if(m.type==='inst'){ const inst=CAT.get(m.id); return inst?instBlob(inst):null; }
  if(m.type==='cat') return catSongBlob(m.id,guide);
  return null;
}
function musicName(it){
  if(it.cat) return 'Arrangement by Lectern';
  const m=it.music; if(!m) return '';
  if(m.type==='file') return m.name||'Your audio file';
  if(m.type==='inst'){ const x=CAT.get(m.id); return x?x.title+' · '+x.sub:'Instrumental'; }
  if(m.type==='cat'){ const x=CAT.get(m.id); return x?x.title+' (arrangement)':'Arrangement'; }
  return '';
}
function probeDuration(blob){
  return new Promise(res=>{ const a=new Audio(); const u=URL.createObjectURL(blob); a.preload='metadata';
    let d=false; const done=v=>{ if(d) return; d=true; URL.revokeObjectURL(u); res(v); };
    a.onloadedmetadata=()=>done(isFinite(a.duration)?a.duration:0); a.onerror=()=>done(0); setTimeout(()=>done(0),5000); a.src=u; });
}

/* ================= PoetryDB ================= */
const PDB='https://poetrydb.org';
async function pdbJSON(path){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),9000);
  try{ const r=await fetch(PDB+path,{signal:ctl.signal}); const j=await r.json(); return Array.isArray(j)?j:[]; } finally{ clearTimeout(t); }
}
async function pdbRandom(n=8){
  const j=await pdbJSON('/linecount,random/-30;'+(n+4));
  return j.filter(p=>p.lines && +p.linecount>=4 && !/[\/;]/.test(p.title)).slice(0,n).map(p=>addPdb(p.author,p.title,p.lines));
}
async function pdbSearch(q){
  const j=await pdbJSON('/title,lines/'+encodeURIComponent(q)+'/author,title,linecount');
  return j.filter(p=>+p.linecount<=80 && !/[\/;]/.test(p.title)).slice(0,12);
}
async function pdbAuthor(a){
  const j=await pdbJSON('/author/'+encodeURIComponent(a)+':abs/author,title,linecount');
  return j.filter(p=>+p.linecount<=60 && !/[\/;]/.test(p.title)).slice(0,40);
}
async function pdbPoem(author,title){
  const j=await pdbJSON('/author,title/'+encodeURIComponent(author)+';'+encodeURIComponent(title)+':abs');
  const p=j[0]; if(!p) throw new Error('Not found'); return addPdb(p.author,p.title,p.lines);
}

/* ================= Launch splash ================= */
const SPLASH_MIN=1300; // ms on screen, long enough for the logo animation to land
function hideSplash(){
  const sp=document.getElementById('splash'); if(!sp) return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait=Math.max(0,(reduce?500:SPLASH_MIN)-performance.now());
  setTimeout(()=>{ sp.classList.add('out'); setTimeout(()=>sp.remove(),520); },wait);
}
