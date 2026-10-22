/* =====================================================================
   Lectern Sync Engine
   1. Precision clock  — songs are decoded to AudioBuffers and played with
      AudioBufferSourceNode, so position = AudioContext.currentTime math
      (sample-accurate), minus measured output latency.
   2. Analysis         — STFT spectral flux onsets, vocal-band activity,
      tempo by onset autocorrelation and beat tracking by dynamic
      programming (Ellis 2007).
   3. Alignment        — (a) Whisper word timestamps aligned to the known
      lyrics with Needleman–Wunsch + fuzzy word similarity; (b) offline
      fallback: DP assignment of lines to vocal-onset candidates.
   4. Word timing      — syllable-weighted distribution snapped to onsets;
      built-in songs map syllables to melody notes exactly.
   5. Human factors    — calibrated tap latency, onset snapping, visual
      lead, countdown dots before late entries.
   ===================================================================== */
let AC=null;
function ac(){ if(!AC){ const C=window.AudioContext||window.webkitAudioContext; AC=new C({latencyHint:'interactive'}); } return AC; }
const outLat=()=>AC?Math.min(0.5,(AC.outputLatency||0)+(AC.baseLatency||0)):0;
const VISUAL_LEAD=0.016;
let extraLatency=()=>0; // replaced by the audio route module (Bluetooth etc.)
const BUFS=new Map();
function cacheBuf(k,b){ BUFS.delete(k); BUFS.set(k,b); while(BUFS.size>4) BUFS.delete(BUFS.keys().next().value); }
function decodeBlob(blob){
  return blob.arrayBuffer().then(ab=>new Promise((res,rej)=>{ try{ const p=ac().decodeAudioData(ab,res,rej); if(p&&p.then) p.then(res,rej); }catch(e){ rej(e); } }));
}

/* ---------- Precision player ---------- */
const player={
  key:null, buf:null, src:null, gain:null, hasAudio:false, on:false, off:0, t0:0, rate:1, vol:1,
  vDur:0, vStart:0, vOff:0, vPlaying:false, onend:null, loading:false,
  async load(key,getBlob,fallbackDur){
    if(this.key===key) return;
    this.unload(); this.key=key; this.loading=true;
    let buf=BUFS.get(key)||null;
    if(!buf){ let blob=null; try{ blob=await getBlob(); }catch(e){} if(this.key!==key) return;
      if(blob){ try{ buf=await decodeBlob(blob); cacheBuf(key,buf); }catch(e){ buf=null; } } }
    if(this.key!==key) return;
    this.loading=false;
    if(buf){ this.buf=buf; this.hasAudio=true; } else { this.hasAudio=false; this.vDur=fallbackDur||60; }
  },
  unload(){ this.pause(); this.buf=null; this.hasAudio=false; this.key=null; this.off=0; this.vOff=0; this.vPlaying=false; this.rate=1; },
  duration(){ return this.hasAudio?this.buf.duration:this.vDur; },
  raw(){ if(!this.on) return this.off; return Math.min(this.buf.duration,this.off+Math.max(0,ac().currentTime-this.t0)*this.rate); },
  /* Position the listener is hearing right now. Uses the audio hardware clock
     (getOutputTimestamp maps context time to wall time and already includes the
     device's output delay), adds any per-route delay the OS doesn't report
     (Bluetooth), and never steps backwards by a few ms of jitter. */
  _last:0,
  time(){
    if(!this.hasAudio) return this.vPlaying?Math.min(this.vDur,this.vOff+(performance.now()-this.vStart)/1000*this.rate):this.vOff;
    if(!this.on) return this.off;
    const c=ac(); let now=null, lat=0;
    if(c.getOutputTimestamp){ try{ const ts=c.getOutputTimestamp(); if(ts&&ts.contextTime>0&&ts.performanceTime>0){ const ahead=(performance.now()-ts.performanceTime)/1000; if(ahead>=0&&ahead<0.5) now=ts.contextTime+ahead; } }catch(e){} }
    if(now==null){ now=c.currentTime; lat=outLat(); }
    let t=this.off+(now-this.t0-lat-extraLatency())*this.rate+VISUAL_LEAD;
    t=Math.max(0,Math.min(this.buf.duration,t));
    if(t<this._last&&this._last-t<0.12&&this.on) t=this._last;
    this._last=t; return t;
  },
  playing(){ return this.hasAudio?this.on:this.vPlaying; },
  play(){
    if(!this.hasAudio){ if(this.vOff>=this.vDur) this.vOff=0; this.vStart=performance.now(); this.vPlaying=true; return; }
    if(this.on) return;
    const c=ac(); if(c.state==='suspended') c.resume();
    if(!this.gain){ this.gain=c.createGain(); this.gain.connect(c.destination); }
    this.gain.gain.value=this.vol;
    if(this.off>=this.buf.duration-0.02) this.off=0;
    const s=c.createBufferSource(); s.buffer=this.buf; s.playbackRate.value=this.rate; s.connect(this.gain);
    const at=c.currentTime+0.015; s.start(at,this.off); this.t0=at; this.src=s; this.on=true;
    s.onended=()=>{ if(this.src!==s) return; this.off=this.buf.duration; this.on=false; this.src=null; this.onend&&this.onend(); };
  },
  pause(){
    this._last=0;
    if(!this.hasAudio){ if(this.vPlaying){ this.vOff=this.time(); this.vPlaying=false; } return; }
    if(!this.on) return; this.off=this.raw(); const s=this.src; this.src=null; this.on=false; try{ s.onended=null; s.stop(); }catch(e){}
  },
  seek(t){ t=Math.max(0,Math.min(this.duration()||0,t)); this._last=0;
    if(!this.hasAudio){ this.vOff=t; this.vStart=performance.now(); return; }
    const was=this.on; if(was) this.pause(); this.off=t; if(was) this.play(); },
  setRate(r){ if(!this.hasAudio){ if(this.vPlaying){ this.vOff=this.time(); this.vStart=performance.now(); } this.rate=r; return; } const was=this.on; if(was) this.pause(); this.rate=r; if(was) this.play(); },
  setVolume(v){ this.vol=v; if(this.gain) this.gain.gain.value=v; }
};

/* ---------- Syllables (English heuristic + Cyrillic/vowel fallback) ---------- */
function syllables(word){
  let w=String(word).toLowerCase().replace(/[^a-zа-яёàâäçéèêëîïôöùûüœæñ'-]/g,'');
  if(!w) return 0;
  if(/[а-яё]/.test(w)) return Math.max(1,(w.match(/[аеёиоуыэюя]/g)||[]).length);
  if(/[àâäçéèêëîïôöùûüœæñ]/.test(w)) return Math.max(1,(w.match(/[aeiouyàâäéèêëîïôöùûüœæ]+/g)||[]).length);
  w=w.replace(/'/g,'');
  if(w.length<=3) return 1;
  w=w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/,'').replace(/^y/,'');
  const m=w.match(/[aeiouy]{1,2}/g); return Math.max(1,m?m.length:1);
}
const lineWords=l=>String(l).split(/\s+/).filter(Boolean);

/* ---------- Word timing ---------- */
function distributeWords(line,start,end,peaks){
  const ws=lineWords(line); if(!ws.length) return [];
  const syl=ws.map(w=>Math.max(1,syllables(w))), tot=syl.reduce((a,b)=>a+b,0), span=Math.max(0.3,end-start);
  let acc=0; const out=ws.map((w,i)=>{ const s=start+span*acc/tot; acc+=syl[i]; return {s,e:start+span*acc/tot}; });
  if(peaks&&peaks.length){
    for(let i=1;i<out.length;i++){
      const p=nearestPeak(peaks,out[i].s,0.12);
      if(p!=null && p>out[i-1].s+0.08 && p<end-0.05) out[i].s=p;
    }
    for(let i=0;i<out.length;i++) out[i].e=i<out.length-1?Math.max(out[i].s+0.06,out[i+1].s-0.01):end;
  }
  return out.map(x=>({s:+x.s.toFixed(3),e:+x.e.toFixed(3)}));
}
function nearestPeak(peaks,t,win){
  let lo=0,hi=peaks.length-1; while(lo<hi){ const m=(lo+hi)>>1; if(peaks[m].t<t) lo=m+1; else hi=m; }
  let best=null,bd=win;
  for(let k=Math.max(0,lo-2);k<=Math.min(peaks.length-1,lo+2);k++){ const d=Math.abs(peaks[k].t-t); if(d<bd&&peaks[k].s>0.15){ bd=d; best=peaks[k].t; } }
  return best;
}
function estimateEnds(lines,times,an){
  return lines.map((l,i)=>{
    const st=times[i], nx=times[i+1]!=null?times[i+1]:st+6, syl=lineWords(l).reduce((a,w)=>a+syllables(w),0);
    let e=Math.min(nx-0.08,st+syl*0.38+0.5);
    if(an){ const f0=Math.floor(st*an.fps), f1=Math.min(an.va.length-1,Math.floor((nx-0.05)*an.fps)); let last=f0;
      for(let f=f0;f<=f1;f++) if(an.va[f]>an.vaTh) last=f; const ve=last/an.fps+0.08; if(ve>st+0.4) e=Math.min(nx-0.05,Math.max(e*0.5+ve*0.5,st+0.4)); }
    return +Math.max(st+0.3,e).toFixed(3);
  });
}

/* ---------- Analysis ---------- */
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const ang=-2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let j=0;j<len/2;j++){ const a=i+j,b=a+len/2, xr=re[b]*cr-im[b]*ci, xi=re[b]*ci+im[b]*cr; re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi; const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t; } } }
}
const AN_CACHE=new Map();
async function toMono(buf,sr){
  const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;
  const o=new OAC(1,Math.max(1,Math.ceil(buf.duration*sr)),sr); const s=o.createBufferSource(); s.buffer=buf; s.connect(o.destination); s.start();
  return (await o.startRendering()).getChannelData(0);
}
async function analyze(buf,key,onProgress){
  if(key&&AN_CACHE.has(key)) return AN_CACHE.get(key);
  const sr=11025, N=512, hop=110, fps=sr/hop;
  const x=await toMono(buf,sr);
  const frames=Math.max(1,Math.floor((x.length-N)/hop));
  const win=new Float32Array(N); for(let i=0;i<N;i++) win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const re=new Float32Array(N), im=new Float32Array(N), prev=new Float32Array(N/2);
  const flux=new Float32Array(frames), vocal=new Float32Array(frames), rms=new Float32Array(frames), flat=new Float32Array(frames);
  const b0=Math.round(250*N/sr), b1=Math.round(3500*N/sr), f0=Math.round(80*N/sr), f1=Math.round(4500*N/sr);
  for(let f=0;f<frames;f++){
    const o=f*hop; let e=0;
    for(let i=0;i<N;i++){ const v=x[o+i]||0; re[i]=v*win[i]; im[i]=0; e+=v*v; }
    rms[f]=Math.sqrt(e/N);
    fft(re,im);
    let fl=0, vb=0, tot=1e-9, lg=0, ar=0;
    for(let k=1;k<N/2;k++){ const m=Math.sqrt(re[k]*re[k]+im[k]*im[k]), lm=Math.log(1+100*m);
      if(k>=f0&&k<=f1){ const d=lm-prev[k]; if(d>0) fl+=d; } prev[k]=lm; tot+=m;
      if(k>=b0&&k<=b1){ vb+=m; lg+=Math.log(m+1e-9); ar+=m; } }
    flux[f]=fl; vocal[f]=vb/tot; const nb=b1-b0+1; flat[f]=Math.exp(lg/nb)/((ar/nb)+1e-9);
    if(f%600===0){ onProgress&&onProgress(f/frames); await new Promise(r=>setTimeout(r)); }
  }
  // normalise onset envelope: subtract local median-ish mean, half-wave rectify, scale
  const L=Math.round(fps*0.5), on=new Float32Array(frames); let sum=0; const q=[];
  for(let f=0;f<frames;f++){ q.push(flux[f]); sum+=flux[f]; if(q.length>L) sum-=q.shift(); on[f]=Math.max(0,flux[f]-sum/q.length); }
  let mx=1e-9; for(const v of on) mx=Math.max(mx,v); for(let f=0;f<frames;f++) on[f]/=mx;
  // vocal activity: vocal-band share, tonal (low flatness), energy-gated, smoothed
  let rmx=1e-9; for(const v of rms) rmx=Math.max(rmx,v);
  const va=new Float32Array(frames);
  for(let f=0;f<frames;f++) va[f]=vocal[f]*(1-Math.min(1,flat[f]))*Math.min(1,rms[f]/(rmx*0.15));
  const sm=new Float32Array(frames), W=Math.round(fps*0.15); let s2=0;
  for(let f=0;f<frames;f++){ s2+=va[f]; if(f>=W) s2-=va[f-W]; sm[f]=s2/Math.min(W,f+1); }
  const sorted=Array.from(sm).sort((a,b)=>a-b), vaTh=sorted[Math.floor(sorted.length*0.55)]||0;
  // onset peaks
  const peaks=[], pw=Math.round(fps*0.05);
  for(let f=pw;f<frames-pw;f++){ const v=on[f]; if(v<0.08) continue; let ok=true; for(let k=f-pw;k<=f+pw;k++) if(on[k]>v){ ok=false; break; } if(ok) peaks.push({t:f/fps,s:v}); }
  const beat=trackBeats(on,fps);
  const res={fps,on,va:sm,vaTh,peaks,rms,dur:buf.duration,...beat};
  if(key) AN_CACHE.set(key,res);
  onProgress&&onProgress(1);
  return res;
}
function trackBeats(on,fps){
  const minLag=Math.round(fps*60/180), maxLag=Math.round(fps*60/60), n=on.length;
  let best=0,bestLag=Math.round(fps*0.5);
  for(let lag=minLag;lag<=maxLag;lag++){ let s=0; for(let i=lag;i<n;i++) s+=on[i]*on[i-lag];
    const bpm=60*fps/lag, w=Math.exp(-0.5*Math.pow(Math.log2(bpm/120)/1.0,2)); s*=w; if(s>best){ best=s; bestLag=lag; } }
  const tau=bestLag, alpha=100, score=new Float32Array(n), back=new Int32Array(n).fill(-1);
  for(let t=0;t<n;t++){ let bs=0,bi=-1; const lo=Math.max(0,t-2*tau), hi=t-Math.round(tau/2);
    for(let p=lo;p<=hi;p++){ const d=Math.log((t-p)/tau), v=score[p]-alpha*d*d; if(v>bs||bi<0){ bs=v; bi=p; } }
    score[t]=on[t]+(bi>=0?Math.max(0,bs):0); back[t]=bi; }
  let t=0, m=-1; for(let i=Math.max(0,n-tau);i<n;i++) if(score[i]>m){ m=score[i]; t=i; }
  let beats=[]; while(t>=0){ beats.unshift(t/fps); t=back[t]; if(beats.length>4000) break; }
  if(beats.length>4){ const str=beats.map(b=>on[Math.round(b*fps)]||0), mean=str.reduce((a,b)=>a+b,0)/str.length; let k=0; while(k<beats.length-4&&str[k]<mean*0.25) k++; beats=beats.slice(k); }
  let ph=0,pb=-1; for(let k=0;k<4;k++){ let s=0; for(let i=k;i<beats.length;i+=4) s+=on[Math.round(beats[i]*fps)]||0; if(s>pb){ pb=s; ph=k; } }
  return {bpm:+(60*fps/tau).toFixed(1),beats,downbeats:beats.filter((_,i)=>i%4===ph)};
}

/* ---------- Offline auto-sync (no AI): DP over vocal-onset candidates ---------- */
function autoSyncDP(lines,an){
  const n=lines.length; if(!n) return [];
  const fps=an.fps, va=an.va, th=an.vaTh;
  let first=0,last=va.length-1;
  for(let f=0;f<va.length;f++){ let k=0; while(f+k<va.length&&va[f+k]>th&&k<fps) k++; if(k>=fps*0.6){ first=f; break; } }
  for(let f=va.length-1;f>0;f--){ if(va[f]>th){ last=f; break; } }
  const R0=first/fps, R1=Math.max(R0+n,last/fps), span=R1-R0;
  const w=lines.map(l=>Math.max(1,lineWords(l).reduce((a,x)=>a+syllables(x),0)));
  const tot=w.reduce((a,b)=>a+b,0), exp=[]; let acc=0; w.forEach((x,i)=>{ exp.push(R0+span*acc/tot); acc+=x; });
  const meanV=f=>{ let s=0,c=0; for(let k=Math.max(0,f);k<Math.min(va.length,f+Math.round(fps*0.35));k++){ s+=va[k]; c++; } return c?s/c:0; };
  let cands=an.peaks.filter(p=>p.t>=R0-0.3&&p.t<=R1).map(p=>{ const f=Math.round(p.t*fps), rise=meanV(f)-meanV(f-Math.round(fps*0.35)); return {t:p.t,s:p.s*0.6+Math.max(0,rise/(th+1e-9))*0.4}; });
  if(cands.length>700) cands=cands.sort((a,b)=>b.s-a.s).slice(0,700).sort((a,b)=>a.t-b.t);
  cands.unshift({t:R0,s:1});
  const M=cands.length; if(M<n) return exp.map(v=>+v.toFixed(2));
  const INF=1e18, cost=Array.from({length:n},()=>new Float64Array(M).fill(INF)), bk=Array.from({length:n},()=>new Int32Array(M).fill(-1));
  const pos=(i,j)=>Math.pow((cands[j].t-exp[i])/(span/n+1e-9),2)*0.35-cands[j].s*1.2;
  for(let j=0;j<M;j++) cost[0][j]=pos(0,j)+Math.abs(cands[j].t-R0)*0.2;
  for(let i=1;i<n;i++){ const dExp=(exp[i]-exp[i-1])||1, minD=Math.max(0.35,w[i-1]*0.12);
    for(let j=1;j<M;j++){ const tj=cands[j].t; let bc=INF,bi=-1;
      for(let k=j-1;k>=0;k--){ const d=tj-cands[k].t; if(d<minD) continue; if(d>dExp*3.2+3) break; if(cost[i-1][k]>=INF) continue;
        const c=cost[i-1][k]+Math.pow(Math.log(d/dExp),2)*1.6; if(c<bc){ bc=c; bi=k; } }
      if(bi>=0){ cost[i][j]=bc+pos(i,j); bk[i][j]=bi; } } }
  let bj=-1,bc=INF; for(let j=0;j<M;j++) if(cost[n-1][j]<bc){ bc=cost[n-1][j]; bj=j; }
  if(bj<0) return exp.map(v=>+v.toFixed(2));
  const out=new Array(n); for(let i=n-1;i>=0;i--){ out[i]=+cands[bj].t.toFixed(2); bj=bk[i][bj]; if(bj<0&&i>0){ for(let k=i-1;k>=0;k--) out[k]=+exp[k].toFixed(2); break; } }
  return out;
}

/* ---------- Lyrics ↔ transcript alignment (Needleman–Wunsch) ---------- */
const normWord=w=>String(w).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-zа-яё0-9]/g,'');
function lev(a,b){ if(a===b) return 0; const m=a.length,n=b.length; if(!m) return n; if(!n) return m; let p=Array.from({length:n+1},(_,j)=>j); for(let i=1;i<=m;i++){ const c=[i]; for(let j=1;j<=n;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)); p=c; } return p[n]; }
function wsim(a,b){ if(!a||!b) return 0; if(a===b) return 1; const r=1-lev(a,b)/Math.max(a.length,b.length); return r; }
function alignWords(lyr,tr){
  const n=lyr.length,m=tr.length, G=-0.45, S=new Float32Array((n+1)*(m+1)), P=new Uint8Array((n+1)*(m+1)), ix=(i,j)=>i*(m+1)+j;
  for(let i=1;i<=n;i++){ S[ix(i,0)]=i*G; P[ix(i,0)]=1; } for(let j=1;j<=m;j++){ S[ix(0,j)]=j*G; P[ix(0,j)]=2; }
  for(let i=1;i<=n;i++) for(let j=1;j<=m;j++){
    const sim=wsim(lyr[i-1],tr[j-1]), ms=sim>=0.6?sim*1.4:-0.7;
    const d=S[ix(i-1,j-1)]+ms, u=S[ix(i-1,j)]+G, l=S[ix(i,j-1)]+G;
    if(d>=u&&d>=l){ S[ix(i,j)]=d; P[ix(i,j)]=0; } else if(u>=l){ S[ix(i,j)]=u; P[ix(i,j)]=1; } else { S[ix(i,j)]=l; P[ix(i,j)]=2; } }
  const map=new Int32Array(n).fill(-1); let i=n,j=m;
  while(i>0||j>0){ const p=P[ix(i,j)]; if(i>0&&j>0&&p===0){ if(wsim(lyr[i-1],tr[j-1])>=0.6) map[i-1]=j-1; i--; j--; } else if(i>0&&(p===1||j===0)) i--; else j--; }
  return map;
}
function alignLyricsToWords(lines,words){
  const lw=[], owner=[]; lines.forEach((l,li)=>lineWords(l).forEach(w=>{ lw.push(normWord(w)); owner.push(li); }));
  const tw=words.map(w=>normWord(w.text));
  const map=alignWords(lw,tw);
  const st=new Array(lw.length).fill(null), en=new Array(lw.length).fill(null);
  map.forEach((j,i)=>{ if(j>=0){ st[i]=words[j].start; en[i]=words[j].end; } });
  // interpolate gaps by syllables
  const syl=lines.flatMap(l=>lineWords(l).map(w=>Math.max(1,syllables(w))));
  let k=0; while(k<st.length){ if(st[k]!=null){ k++; continue; } let a=k-1,b=k; while(b<st.length&&st[b]==null) b++;
    const t0=a>=0?en[a]:(b<st.length?Math.max(0,st[b]-2):0), t1=b<st.length?st[b]:(a>=0?en[a]+2:t0+2);
    const seg=syl.slice(k,b), tot=seg.reduce((x,y)=>x+y,0); let acc=0;
    for(let q=k;q<b;q++){ st[q]=t0+(t1-t0)*acc/tot; acc+=syl[q]; en[q]=t0+(t1-t0)*acc/tot; } k=b; }
  const times=[], wt=[], ends=[]; let p=0;
  lines.forEach((l,li)=>{ const c=lineWords(l).length; const arr=[]; for(let q=0;q<c;q++,p++) arr.push({s:+st[p].toFixed(3),e:+Math.max(st[p]+0.05,en[p]).toFixed(3)});
    times.push(arr.length?arr[0].s:(times[li-1]||0)+2); ends.push(arr.length?arr[arr.length-1].e:times[li]+1); wt.push(arr); });
  for(let i=1;i<times.length;i++) if(times[i]<=times[i-1]) times[i]=+(times[i-1]+0.05).toFixed(3);
  const matched=map.filter(x=>x>=0).length;
  return {times,ends,wt,confidence:lw.length?matched/lw.length:0};
}
function wordsToLines(words){
  const lines=[], times=[], wt=[], ends=[]; let cur=[];
  const flush=()=>{ if(!cur.length) return; lines.push(cur.map(w=>w.text.trim()).join(' ').replace(/\s+([,.!?;:])/g,'$1')); times.push(+cur[0].start.toFixed(3)); ends.push(+cur[cur.length-1].end.toFixed(3)); wt.push(cur.map(w=>({s:+w.start.toFixed(3),e:+w.end.toFixed(3)}))); cur=[]; };
  words.forEach((w,i)=>{ const prev=words[i-1]; if(cur.length&&(w.start-prev.end>0.7||cur.length>=9||/[.!?]$/.test(prev.text.trim())&&cur.length>=3)) flush(); if(w.text.trim()) cur.push(w); });
  flush(); return {lines,times,ends,wt};
}

/* ---------- Enhanced LRC (word tags <mm:ss.xx>) ---------- */
const tagT=s=>{ const m=s.match(/(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?/); return m?(+m[1])*60+(+m[2])+(m[3]?(+m[3])/Math.pow(10,m[3].length):0):null; };
const fmtTag=x=>{ const m=Math.floor(x/60), s=x-m*60; return String(m).padStart(2,'0')+':'+s.toFixed(2).padStart(5,'0'); };
function parseLrcPro(text){
  const out=[]; let offset=0,title='';
  text.split(/\r?\n/).forEach(raw=>{
    const line=raw.trim(); if(!line) return;
    const meta=line.match(/^\[(ti|ar|al|by|offset|length|re|ve|au):(.*)\]$/i);
    if(meta){ const k=meta[1].toLowerCase(); if(k==='offset') offset=(+meta[2]||0)/1000; if(k==='ti') title=meta[2].trim(); return; }
    const tags=[...line.matchAll(/\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g)].map(m=>tagT(m[1]));
    const rest=line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g,'');
    if(!tags.length) return;
    const words=[]; const re=/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>\s*([^<]*)/g; let m, plain=rest.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    while((m=re.exec(rest))){ const t=tagT(m[1]); m[2].trim().split(/\s+/).filter(Boolean).forEach((w,k,arr)=>words.push({t,k,n:arr.length,w})); }
    if(!plain) return;
    tags.forEach(t=>out.push({t,txt:plain,words}));
  });
  out.sort((a,b)=>a.t-b.t);
  const lines=out.map(o=>o.txt), times=out.map(o=>Math.max(0,+(o.t-offset).toFixed(3)));
  const wt=out.map((o,i)=>{ const n=lineWords(o.txt).length; if(o.words.length!==n) return null; const nx=times[i+1]!=null?times[i+1]:times[i]+4;
    return o.words.map((w,k)=>{ const s=Math.max(0,w.t-offset), e=k<o.words.length-1?Math.max(0,o.words[k+1].t-offset):Math.min(nx-0.05,s+0.6); return {s:+s.toFixed(3),e:+e.toFixed(3)}; }); });
  return {lines,times,wt,title};
}
function exportLrcPro(title,lines,times,wt){
  return ['[ti:'+(title||'Untitled')+']','[by:Lectern]'].concat(lines.map((l,i)=>{ const t=times[i]; if(t==null) return l;
    const w=wt&&wt[i]; const ws=lineWords(l);
    if(w&&w.length===ws.length) return '['+fmtTag(t)+']'+ws.map((x,k)=>'<'+fmtTag(w[k].s)+'>'+x).join(' ');
    return '['+fmtTag(t)+']'+l; })).join('\n');
}

/* ---------- Whisper (transformers.js) ---------- */
const ASR={pipe:null,loading:null,word:false,device:'',T:null,busy:null,mode:0,status:null};
const TJS_URL='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.6.1';
const IS_MOBILE=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||(navigator.userAgentData&&navigator.userAgentData.mobile);
// Ladder of configurations, safest last. Mobile skips WebGPU (unstable on phones).
const ASR_MODES=[
  {model:'onnx-community/whisper-base_timestamped',device:'webgpu',dtype:{encoder_model:'fp32',decoder_model_merged:'q4'},word:true,gpu:true},
  {model:'onnx-community/whisper-base_timestamped',device:'wasm',dtype:'q8',word:true},
  {model:'Xenova/whisper-tiny',device:'wasm',dtype:'q8',word:false}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function disposeASR(){ const p=ASR.pipe; ASR.pipe=null; ASR.loading=null; try{ if(p&&p.dispose) await p.dispose(); }catch(e){} await sleep(250); }
async function loadASR(onStatus){
  if(ASR.pipe) return ASR.pipe;
  if(ASR.loading) return ASR.loading;
  ASR.loading=(async()=>{
    onStatus&&onStatus({stage:'lib',p:0});
    const T=ASR.T||(ASR.T=await import(TJS_URL));
    T.env.allowLocalModels=false;
    if(typeof caches==='undefined'||!self.isSecureContext){ T.env.useBrowserCache=false; T.env.useCustomCache=true; T.env.customCache=idbModelCache(); }
    try{ if(T.env.backends&&T.env.backends.onnx&&T.env.backends.onnx.wasm){ T.env.backends.onnx.wasm.proxy=true; } }catch(e){}
    const files={}; const prog=p=>{ if(p&&p.status==='progress'&&p.file){ files[p.file]=[p.loaded||0,p.total||0]; let a=0,b=0; Object.values(files).forEach(([l,t])=>{ a+=l; b+=t; }); onStatus&&onStatus({stage:'model',p:b?a/b:0}); } };
    if(ASR.mode===0){ let gpu=false; if(!IS_MOBILE){ try{ gpu=!!(navigator.gpu&&await navigator.gpu.requestAdapter()); }catch(e){} } if(!gpu) ASR.mode=1; }
    let lastErr=null;
    for(;ASR.mode<ASR_MODES.length;ASR.mode++){
      const m=ASR_MODES[ASR.mode];
      try{ ASR.pipe=await T.pipeline('automatic-speech-recognition',m.model,{device:m.device,dtype:m.dtype,progress_callback:prog}); ASR.word=m.word; ASR.device=m.device; return ASR.pipe; }
      catch(e){ lastErr=e; if(isNetErr(e)) throw e; }
    }
    throw lastErr||new Error('Speech engine unavailable');
  })();
  try{ return await ASR.loading; }catch(e){ ASR.loading=null; throw e; }
}
const isNetErr=e=>/fetch|network|dynamically imported|Failed to load|NetworkError|ERR_|offline|CORS/i.test(String(e&&(e.message||e)));
const isSessionErr=e=>/session already started|session|already|busy|aborted|webgpu|device/i.test(String(e&&(e.message||e)));
/* Whisper runs in a dedicated Web Worker so the UI never freezes. */
/* Persistent model cache: used where the Cache API is missing (e.g. iOS app WebViews),
   so the Whisper model downloads once and then loads from IndexedDB. */
function idbModelCache(){
  const open=()=>new Promise((res,rej)=>{ const r=indexedDB.open('lectern-models',1); r.onupgradeneeded=()=>r.result.createObjectStore('files'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  let dbp=null; const db=()=>dbp||(dbp=open());
  const key=k=>typeof k==='string'?k:(k&&k.url)||String(k);
  const tx=async(mode,fn)=>{ const d=await db(); return new Promise((res,rej)=>{ const t=d.transaction('files',mode); const st=t.objectStore('files'); const r=fn(st); t.oncomplete=()=>res(r&&r.result); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }); };
  return {
    async match(k){ try{ const v=await tx('readonly',st=>st.get(key(k))); if(!v) return undefined; return new Response(v.buf,{status:200,headers:{'content-type':v.type||'application/octet-stream','content-length':String(v.buf.byteLength)}}); }catch(e){ return undefined; } },
    async put(k,resp){ try{ const buf=await resp.arrayBuffer(); await tx('readwrite',st=>st.put({buf,type:resp.headers.get('content-type')||''},key(k))); }catch(e){} }
  };
}
const NEEDS_MODEL_CACHE=`(typeof caches==='undefined'||!self.isSecureContext)`;
const ASR_WORKER_SRC=()=>`
let T=null,pipe=null,mode=-1,word=false,device='';
const MODES=${JSON.stringify(ASR_MODES)};
const isNet=e=>/fetch|network|Failed to load|NetworkError|offline|CORS|dynamically imported/i.test(String(e&&(e.message||e)));
async function load(start){
  if(!T){ T=await import('${TJS_URL}'); T.env.allowLocalModels=false; if(${NEEDS_MODEL_CACHE}){ T.env.useBrowserCache=false; T.env.useCustomCache=true; T.env.customCache=(${idbModelCache.toString()})(); } try{ T.env.backends.onnx.wasm.proxy=false; T.env.backends.onnx.wasm.numThreads=(self.crossOriginIsolated?Math.min(4,navigator.hardwareConcurrency||2):1); }catch(e){} }
  const files={}; const prog=p=>{ if(p&&p.status==='progress'&&p.file){ files[p.file]=[p.loaded||0,p.total||0]; let a=0,b=0; for(const k in files){ a+=files[k][0]; b+=files[k][1]; } postMessage({type:'status',stage:'model',p:b?a/b:0}); } };
  let last=null;
  for(mode=start;mode<MODES.length;mode++){ const m=MODES[mode];
    try{ pipe=await T.pipeline('automatic-speech-recognition',m.model,{device:m.device,dtype:m.dtype,progress_callback:prog}); word=m.word; device=m.device; postMessage({type:'loaded',mode,device,word}); return; }
    catch(e){ last=e; if(isNet(e)) throw e; } }
  throw last||new Error('Speech engine unavailable');
}
self.onmessage=async ev=>{ const {id,audio,start}=ev.data;
  try{
    if(!pipe||mode!==start){ if(pipe&&pipe.dispose){ try{ await pipe.dispose(); }catch(e){} } pipe=null; postMessage({type:'status',stage:'lib'}); await load(start); }
    postMessage({type:'status',stage:'listen',device});
    const out=await pipe(audio,{chunk_length_s:29,stride_length_s:5,return_timestamps:word?'word':true});
    postMessage({type:'result',id,out:{text:out.text,chunks:out.chunks},word,mode,device});
  }catch(e){ try{ if(pipe&&pipe.dispose) await pipe.dispose(); }catch(_){} pipe=null; postMessage({type:'error',id,msg:String(e&&(e.message||e)),net:isNet(e),mode}); }
};`;
let ASRW=null, ASRW_FAILED=false;
function asrWorker(){
  if(ASRW||ASRW_FAILED) return ASRW;
  try{ const u=URL.createObjectURL(new Blob([ASR_WORKER_SRC()],{type:'text/javascript'})); ASRW=new Worker(u,{type:'module'}); ASRW.addEventListener('error',()=>{ ASRW_FAILED=true; try{ ASRW.terminate(); }catch(e){} ASRW=null; }); }
  catch(e){ ASRW_FAILED=true; ASRW=null; }
  return ASRW;
}
function workerRun(w,audio,start,onStatus){
  return new Promise((res,rej)=>{
    const id=Math.random().toString(36).slice(2);
    const onMsg=ev=>{ const d=ev.data||{};
      if(d.type==='status'){ if(d.device) ASR.device=d.device; onStatus&&onStatus({stage:d.stage,p:d.p||0}); return; }
      if(d.type==='loaded'){ ASR.mode=d.mode; ASR.device=d.device; ASR.word=d.word; return; }
      if(d.id!==id) return;
      cleanup();
      if(d.type==='result'){ ASR.mode=d.mode; ASR.word=d.word; ASR.device=d.device; res(d.out); }
      else { const e=new Error(d.msg); e.net=d.net; e.mode=d.mode; rej(e); } };
    const onErr=ev=>{ cleanup(); ASRW_FAILED=true; try{ w.terminate(); }catch(e){} ASRW=null; const e=new Error('WORKER_FAILED'); e.worker=true; rej(e); };
    const cleanup=()=>{ w.removeEventListener('message',onMsg); w.removeEventListener('error',onErr); };
    w.addEventListener('message',onMsg); w.addEventListener('error',onErr);
    const copy=audio.slice(); w.postMessage({id,audio:copy,start},[copy.buffer]);
  });
}
async function pickStartMode(){
  if(ASR.mode>0) return;
  let gpu=false; if(!IS_MOBILE){ try{ gpu=!!(navigator.gpu&&await navigator.gpu.requestAdapter()); }catch(e){} }
  ASR.mode=gpu?0:1;
}
async function runASR(audio,onStatus){
  await pickStartMode();
  let lastErr=null, retriedSame=false;
  for(let attempt=0;attempt<6;attempt++){
    const w=asrWorker();
    if(w){
      try{ return await workerRun(w,audio,ASR.mode,onStatus); }
      catch(e){
        lastErr=e; if(e.worker) continue;           // worker unsupported → fall through to main thread
        if(e.net||isNetErr(e)) throw e;
        if(isSessionErr(e)&&!retriedSame){ retriedSame=true; await sleep(600); onStatus&&onStatus({stage:'retry',p:0}); continue; }
        retriedSame=false; ASR.mode=Math.max(ASR.mode,(e.mode??ASR.mode))+1;
        if(ASR.mode>=ASR_MODES.length) break;
        onStatus&&onStatus({stage:'retry',p:0}); continue;
      }
    }
    // Main-thread fallback: keep ONNX Runtime's own worker proxy on so the UI stays responsive.
    const pipe=await loadASR(onStatus);
    try{ if(ASR.T&&ASR.T.env.backends.onnx.wasm) ASR.T.env.backends.onnx.wasm.proxy=ASR.device!=='webgpu'; }catch(e){}
    onStatus&&onStatus({stage:'listen',p:0});
    try{ return await pipe(audio,{chunk_length_s:29,stride_length_s:5,return_timestamps:ASR.word?'word':true}); }
    catch(e){
      lastErr=e; if(isNetErr(e)) throw e;
      await disposeASR();
      if(isSessionErr(e)&&!retriedSame){ retriedSame=true; await sleep(600); onStatus&&onStatus({stage:'retry',p:0}); continue; }
      retriedSame=false; ASR.mode++;
      if(ASR.mode>=ASR_MODES.length) break;
      onStatus&&onStatus({stage:'retry',p:0});
    }
  }
  throw lastErr||new Error('Transcription failed');
}
async function transcribeBlob(blob,onStatus){
  if(ASR.busy){ const e=new Error('BUSY'); e.busy=true; throw e; }
  let done; ASR.busy=new Promise(r=>done=r);
  try{
    onStatus&&onStatus({stage:'decode',p:0});
    const buf=await decodeBlob(blob);
    const audio=await toMono(buf,16000);
    const fade=16000*0.5; for(let i=0;i<fade&&i<audio.length;i++){ audio[i]*=i/fade; audio[audio.length-1-i]*=i/fade; }
    const out=await runASR(audio,onStatus);
  const chunks=(out&&out.chunks)||[];
  let words=[];
  if(ASR.word){ words=chunks.map(c=>({text:c.text,start:c.timestamp[0]??0,end:c.timestamp[1]??((c.timestamp[0]??0)+0.3)})); }
  else chunks.forEach(c=>{ const ws=lineWords(c.text), s=c.timestamp[0]??0, e=c.timestamp[1]??s+2, syl=ws.map(w=>Math.max(1,syllables(w))), tot=syl.reduce((a,b)=>a+b,0)||1; let acc=0; ws.forEach((w,k)=>{ const a=s+(e-s)*acc/tot; acc+=syl[k]; words.push({text:w,start:a,end:s+(e-s)*acc/tot}); }); });
  words=words.filter(w=>w.text&&w.text.trim()&&!/^\s*[\[(♪].*[\])♪]?\s*$/.test(w.text)).sort((a,b)=>a.start-b.start);
  for(let i=1;i<words.length;i++) if(words[i].start<words[i-1].start) words[i].start=words[i-1].start;
    return {words,text:(out&&out.text)||'',duration:buf.duration,buf};
  } finally { ASR.busy=null; done(); }
}

/* ---------- Text-to-speech narrator ---------- */
const TTS={on:false,queue:[],idx:0,voice:null};
function ttsVoices(){ try{ return speechSynthesis.getVoices(); }catch(e){ return []; } }
function pickVoice(){ const vs=ttsVoices(); const pref=S.settings.ttsVoice; return vs.find(v=>v.name===pref)||vs.find(v=>/en(-|_)/i.test(v.lang)&&/natural|neural|premium|enhanced|google/i.test(v.name))||vs.find(v=>/^en/i.test(v.lang))||vs[0]||null; }
try{ speechSynthesis.onvoiceschanged=()=>{}; }catch(e){}

/* ---------- Tap latency calibration ---------- */
function calibrateTaps(){
  const c=ac(); c.resume(); const bpm=90, beat=60/bpm, n=12, t0=c.currentTime+0.6, clicks=[];
  for(let i=0;i<n;i++){ const t=t0+i*beat; clicks.push(t); const o=c.createOscillator(), g=c.createGain(); o.frequency.value=i%4===0?1500:1000; g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.5,t+0.002); g.gain.exponentialRampToValueAtTime(0.0001,t+0.06); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+0.08); }
  const taps=[];
  return {clicks,beat,tap(){ taps.push(c.currentTime-outLat()); return taps.length; },
    result(){ const d=taps.map(t=>{ let best=1e9; clicks.forEach(k=>{ const x=t-k; if(Math.abs(x)<Math.abs(best)) best=x; }); return best; }).filter(x=>Math.abs(x)<beat*0.45).slice(2);
      if(d.length<4) return null; d.sort((a,b)=>a-b); const med=d[Math.floor(d.length/2)]; const mad=d.map(x=>Math.abs(x-med)).sort((a,b)=>a-b)[Math.floor(d.length/2)];
      return {latency:+med.toFixed(3),jitter:+mad.toFixed(3),n:d.length}; }, end:t0+n*beat};
}
