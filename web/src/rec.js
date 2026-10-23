/* =====================================================================
   Recording audio
   One shared architecture, with a capture strategy chosen per situation so
   the same sound is never recorded twice:

   mode 'mic'      Voice only, or music from another app on the speaker.
                   One natural mic track. No call-style processing, so the
                   room and any music stay intact.
   mode 'acoustic' In-app music on the speaker, recorded through the mic like
                   a real room. One track: the music is NOT also mixed in
                   digitally (that was the source of the doubled, echoey sound).
   mode 'mix'      In-app music with headphones / Bluetooth. Music is mixed
                   digitally (delayed to match what the singer heard), voice
                   from the mic. Nothing leaks, so nothing doubles.
   mode 'mixaec'   Optional: in-app music on the speaker but mixed digitally,
                   with echo cancellation keeping the music out of the mic.

   Noise cancellation (the app's own, music-safe) and echo cancellation (the
   device's, call-style) are separate controls. The browser's voice-call
   noise suppression and auto-gain are never used.
   ===================================================================== */
const REC={g:null,on:false,plan:null,proc:null,ncReady:null};
const recMusicLevel=()=>S.settings.recMusic??0.6;
const recMicDb=()=>S.settings.micGain??0;
const recNC=()=>!!S.settings.noiseCancel;
const recAECSetting=()=>S.settings.echoCancel||'auto';
const speakerMusicPref=()=>S.settings.speakerMusic||'acoustic';
const RECMODE_LABEL={mic:'Natural mic',acoustic:'Music through the mic',mix:'Clean mix',mixaec:'Clean mix (echo cancellation)'};

/* Decide how this take is captured. */
function recPlan(internalMusic){
  const hp=ROUTE.output!=='speaker';
  const mode=!internalMusic?'mic':hp?'mix':(speakerMusicPref()==='mixaec'?'mixaec':'acoustic');
  const a=recAECSetting(); const aec=a==='on'?true:a==='off'?false:mode==='mixaec';
  return {mode,aec,nc:recNC(),digital:mode==='mix'||mode==='mixaec'};
}

/* ---------- Music-safe noise cancellation (AudioWorklet) ----------
   Short-time spectral gating with a noise floor learned by minimum statistics over the
   last ~8 s, so steady noise (fans, hum, hiss, distant chatter) is reduced but sustained
   music and voice are not chased down. Attenuation is capped at 12 dB to stay natural.
   Constant latency (1024 samples) whether on or off, so toggling never shifts timing. */
const NC_SRC=`
class NC extends AudioWorkletProcessor{
  constructor(o){ super(); const N=1024,H=256,B=N/2+1, a0=(o&&o.processorOptions&&o.processorOptions.amount)||0; Object.assign(this,{N,H,B,fp:0,amt:a0,target:a0,frames:0});
    this.win=new Float32Array(N); for(let i=0;i<N;i++) this.win[i]=Math.sqrt(0.5-0.5*Math.cos(2*Math.PI*i/N));
    this.fifo=new Float32Array(H); this.ana=new Float32Array(N); this.ola=new Float32Array(N); this.re=new Float32Array(N); this.im=new Float32Array(N);
    this.P=new Float32Array(B); this.cur=new Float32Array(B).fill(1e9); this.mins=[]; this.G=new Float32Array(B).fill(1); this.g=new Float32Array(B);
    this.Q=16384; this.ring=new Float32Array(this.Q); this.w=N; this.r=0;
    this.block=Math.round(sampleRate*0.5/H);
    this.port.onmessage=e=>{ if(e.data&&e.data.amount!=null) this.target=e.data.amount; }; }
  fft(re,im,inv){ const n=re.length; for(let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
    for(let len=2;len<=n;len<<=1){ const a=(inv?2:-2)*Math.PI/len, wr=Math.cos(a), wi=Math.sin(a), h=len>>1;
      for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let k=0;k<h;k++){ const p=i+k,q=p+h, tr=re[q]*cr-im[q]*ci, ti=re[q]*ci+im[q]*cr; re[q]=re[p]-tr; im[q]=im[p]-ti; re[p]+=tr; im[p]+=ti; const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr; } } }
    if(inv) for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
  frame(){ const {N,H,B,re,im,win,P,G,g}=this;
    this.ana.copyWithin(0,H); this.ana.set(this.fifo,N-H);
    for(let i=0;i<N;i++){ re[i]=this.ana[i]*win[i]; im[i]=0; }
    this.fft(re,im,false);
    this.amt+=(this.target-this.amt)*0.08; const floor=Math.pow(10,-12*this.amt/20);
    const first=this.frames<4; for(let k=0;k<B;k++){ const p=re[k]*re[k]+im[k]*im[k]; P[k]=first?p:P[k]*0.75+p*0.25; if(!first&&P[k]<this.cur[k]) this.cur[k]=P[k]; }
    if(++this.frames%this.block===0){ this.mins.push(this.cur.slice()); if(this.mins.length>16) this.mins.shift(); this.cur.fill(1e9); }
    for(let k=0;k<B;k++){ let n=this.cur[k]; for(const m of this.mins) if(m[k]<n) n=m[k]; n*=3;
      const v=this.amt<0.001?1:Math.max(floor,1-n/(P[k]+1e-12)); g[k]=v; }
    for(let k=0;k<B;k++){ const s=(g[Math.max(0,k-1)]+2*g[k]+g[Math.min(B-1,k+1)])/4; G[k]+=(s-G[k])*(s>G[k]?0.6:0.18); }
    for(let k=0;k<B;k++){ re[k]*=G[k]; im[k]*=G[k]; if(k>0&&k<B-1){ re[N-k]=re[k]; im[N-k]=-im[k]; } }
    this.fft(re,im,true);
    for(let i=0;i<N;i++) this.ola[i]+=re[i]*win[i]*0.5;
    for(let i=0;i<H;i++){ this.ring[this.w]=this.ola[i]; this.w=(this.w+1)%this.Q; }
    this.ola.copyWithin(0,H); this.ola.fill(0,N-H); }
  process(inputs,outputs){ const x=inputs[0]&&inputs[0][0], out=outputs[0]; if(!out||!out[0]) return true;
    const y=out[0];
    for(let i=0;i<y.length;i++){ this.fifo[this.fp++]=x?x[i]:0; if(this.fp===this.H){ this.frame(); this.fp=0; } y[i]=this.ring[this.r]; this.ring[this.r]=0; this.r=(this.r+1)%this.Q; }
    for(let c=1;c<out.length;c++) out[c].set(y);
    return true; } }
registerProcessor('lectern-nc',NC);`;
const NC_LATENCY=1024;
function ncLoad(){ if(REC.ncReady) return REC.ncReady; const c=ac();
  // blob: URL first; some origins (file://, strict CSP) only accept a data: URL
  const add=u=>c.audioWorklet.addModule(u).then(()=>true);
  REC.ncReady=!c.audioWorklet?Promise.resolve(false):add(URL.createObjectURL(new Blob([NC_SRC],{type:'text/javascript'})))
    .catch(()=>add('data:text/javascript;charset=utf-8,'+encodeURIComponent(NC_SRC))).catch(()=>false);
  return REC.ncReady; }
function recSetNC(on){ S.settings.noiseCancel=!!on; SAVE.settings(); if(REC.g&&REC.g.nc) REC.g.nc.port.postMessage({amount:on?1:0}); }

/* What the device actually applied to the mic (some phones keep their own processing on). */
function micProcessing(stream){ try{ const s=stream.getAudioTracks()[0].getSettings(); return {aec:!!s.echoCancellation,ns:!!s.noiseSuppression,agc:!!s.autoGainControl,rate:s.sampleRate||0,ch:s.channelCount||0}; }catch(e){ return null; } }

/* ---------- Build the graph for a take ---------- */
async function recBuild(micStream,plan){
  const c=ac(); const g={nodes:[],plan}; const N=n=>{ g.nodes.push(n); return n; };
  const hasNC=await ncLoad();
  g.dest=c.createMediaStreamDestination(); g.dest.channelCount=2; g.stemDest=c.createMediaStreamDestination();
  g.voiceOut=N(c.createGain());
  let lat=0;
  if(micStream&&micStream.getAudioTracks().length){
    g.mic=N(c.createMediaStreamSource(micStream)); let head=g.mic;
    if(hasNC){ g.nc=N(new AudioWorkletNode(c,'lectern-nc',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{amount:plan.nc?1:0}})); g.nc.port.postMessage({amount:plan.nc?1:0}); head.connect(g.nc); head=g.nc; lat+=NC_LATENCY/c.sampleRate; }
    g.micGain=N(c.createGain()); g.micGain.gain.value=db2g(recMicDb()); head.connect(g.micGain); head=g.micGain;
    if(plan.digital){
      // voice in a mix: gentle shaping so it sits clearly over the music
      const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=90; hp.Q.value=0.7;
      const cp=N(c.createDynamicsCompressor()); cp.threshold.value=-26; cp.knee.value=12; cp.ratio.value=2.5; cp.attack.value=0.01; cp.release.value=0.22;
      const ess=N(c.createBiquadFilter()); ess.type='peaking'; ess.frequency.value=6800; ess.Q.value=2; ess.gain.value=-2;
      const pres=N(c.createBiquadFilter()); pres.type='peaking'; pres.frequency.value=3000; pres.Q.value=0.9; pres.gain.value=1.5;
      const mk=N(c.createGain()); mk.gain.value=db2g(3);
      head.connect(hp); hp.connect(cp); cp.connect(ess); ess.connect(pres); pres.connect(mk); head=mk;
    } else {
      // natural capture (room, voice and any music in it): only remove handling rumble
      const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=40; hp.Q.value=0.7; head.connect(hp); head=hp;
    }
    const vlim=N(c.createDynamicsCompressor()); vlim.threshold.value=-3; vlim.knee.value=2; vlim.ratio.value=20; vlim.attack.value=0.001; vlim.release.value=0.08;
    const vsc=N(c.createWaveShaper()); vsc.curve=softClipCurve(); vsc.oversample='2x';
    head.connect(vlim); vlim.connect(vsc); vsc.connect(g.voiceOut);
    g.vAn=N(c.createAnalyser()); g.vAn.fftSize=1024; g.voiceOut.connect(g.vAn);
  }
  g.voiceOut.connect(g.stemDest);
  g.mix=N(c.createGain()); g.mix.gain.value=plan.digital?db2g(-1):1;
  g.voiceOut.connect(g.mix);
  if(plan.digital){
    g.musicIn=N(c.createGain());
    g.delay=N(c.createDelay(1.5)); g.delay.delayTime.value=Math.min(1.4,outLat()+extraLatency()+(micStream?micInLatency(micStream):0)+lat);
    g.duck=N(c.createGain()); g.level=N(c.createGain()); g.level.gain.value=recMusicLevel();
    g.musicIn.connect(g.delay); g.delay.connect(g.duck); g.duck.connect(g.level); g.level.connect(g.mix);
  }
  g.lim=N(c.createDynamicsCompressor()); g.lim.threshold.value=-2; g.lim.knee.value=0; g.lim.ratio.value=20; g.lim.attack.value=0.001; g.lim.release.value=0.1;
  const sc=N(c.createWaveShaper()); sc.curve=softClipCurve(); sc.oversample='2x';
  g.mix.connect(g.lim); g.lim.connect(sc); sc.connect(g.dest);
  g.micLatency=lat;
  return g;
}
function softClipCurve(){ const n=4096, cu=new Float32Array(n), knee=0.7, ceil=0.966; for(let i=0;i<n;i++){ const x=i*2/(n-1)-1, a=Math.abs(x); cu[i]=Math.sign(x)*(a<=knee?a:knee+(ceil-knee)*Math.tanh((a-knee)/(ceil-knee))); } return cu; }
const micInLatency=s=>{ try{ const l=s.getAudioTracks()[0].getSettings().latency; return isFinite(l)&&l>0&&l<0.5?l:0.02; }catch(e){ return 0.02; } };
function recDuckLoop(g){
  if(!g.vAn||!g.duck) return;
  const buf=new Float32Array(g.vAn.fftSize); const c=ac();
  g.duckT=setInterval(()=>{ g.vAn.getFloatTimeDomainData(buf); let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i];
    const db=10*Math.log10(s/buf.length+1e-12); const target=db>-40?db2g(-3):1;
    g.duck.gain.setTargetAtTime(target,c.currentTime,target<g.duck.gain.value?0.08:0.45); },40);
}
/* In digital modes, feed whichever music is playing in the app into the mix. */
let BED_SRC=null;
function bedSource(){ if(!BED_SRC){ try{ BED_SRC=ac().createMediaElementSource(bed.audio); BED_SRC.connect(ac().destination); }catch(e){ BED_SRC=null; } } return BED_SRC; }
function recAttachMusic(g){
  REC.attachPlayer=()=>{};
  if(!g.plan.digital) return;
  if(!REC.mirrorBuf){ if(player.gain) try{ player.gain.connect(g.musicIn); }catch(e){}
    REC.attachPlayer=()=>{ if(player.gain&&REC.g&&REC.g.musicIn) try{ player.gain.connect(REC.g.musicIn); }catch(e){} }; }
  if(bed.id){ const b=bedSource(); if(b) try{ b.connect(g.musicIn); }catch(e){} }
}
async function recStart(micStream,plan){ recStop(); const g=await recBuild(micStream,plan); recAttachMusic(g); recDuckLoop(g); REC.g=g; REC.on=true; REC.plan=plan; return g; }
function recMirrorSync(){
  const g=REC.g; if(!g||!REC.mirrorBuf||!g.musicIn) return;
  if(REC.mirror){ try{ REC.mirror.stop(); }catch(e){} REC.mirror=null; }
  if(player.on){ const s=ac().createBufferSource(); s.buffer=REC.mirrorBuf; s.playbackRate.value=player.rate; s.connect(g.musicIn); s.start(player.t0,Math.min(player.off,REC.mirrorBuf.duration-0.01)); REC.mirror=s; }
}
{ const _p=player.play.bind(player), _q=player.pause.bind(player);
  player.play=function(){ const r=_p(); if(REC.on) recMirrorSync(); return r; };
  player.pause=function(){ const r=_q(); if(REC.on) recMirrorSync(); return r; }; }
function recStop(){ const g=REC.g; if(!g) return; clearInterval(g.duckT); if(REC.mirror){ try{ REC.mirror.stop(); }catch(e){} REC.mirror=null; }
  if(g.musicIn){ try{ if(player.gain) player.gain.disconnect(g.musicIn); }catch(e){} try{ if(BED_SRC) BED_SRC.disconnect(g.musicIn); }catch(e){} }
  g.nodes.forEach(n=>{ try{ n.disconnect(); }catch(e){} }); REC.g=null; REC.on=false; }

/* ---------- Leak detection for the editor ----------
   Finds whether (and where) the music is audible inside the voice recording by
   cross-correlating the two at 8 kHz. If it is, the editor lines the clean music up with
   the leaked copy to the sample, so the two add up instead of sounding like an echo. */
function fftc(re,im,inv){ const n=re.length; for(let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const a=(inv?2:-2)*Math.PI/len, wr=Math.cos(a), wi=Math.sin(a), h=len>>1;
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let k=0;k<h;k++){ const p=i+k,q=p+h, tr=re[q]*cr-im[q]*ci, ti=re[q]*ci+im[q]*cr; re[q]=re[p]-tr; im[q]=im[p]-ti; re[p]+=tr; im[p]+=ti; const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr; } } }
  if(inv) for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
async function to8k(buf,secs){ const sr=8000, n=Math.min(Math.ceil(buf.duration*sr),secs*sr), C=window.OfflineAudioContext||window.webkitOfflineAudioContext; const oc=new C(1,n,sr); const s=oc.createBufferSource(); s.buffer=buf; s.connect(oc.destination); s.start(); return (await oc.startRendering()).getChannelData(0); }
async function findLeak(voiceBuf,musicBuf,maxLag=1.2){
  const sr=8000, v=await to8k(voiceBuf,24), m=await to8k(musicBuf,24);
  const L=1<<Math.ceil(Math.log2(v.length+m.length)); const a=new Float32Array(L),ai=new Float32Array(L),b=new Float32Array(L),bi=new Float32Array(L);
  // pre-whiten lightly (first difference) so tonal music gives a sharp peak
  for(let i=1;i<v.length;i++) a[i]=v[i]-0.95*v[i-1]; for(let i=1;i<m.length;i++) b[i]=m[i]-0.95*m[i-1];
  let ea=0,eb=0; for(let i=0;i<L;i++){ ea+=a[i]*a[i]; eb+=b[i]*b[i]; }
  fftc(a,ai,false); fftc(b,bi,false);
  for(let k=0;k<L;k++){ const r=a[k]*b[k]+ai[k]*bi[k], im=ai[k]*b[k]-a[k]*bi[k]; a[k]=r; ai[k]=im; }
  fftc(a,ai,true);
  let best=0,lag=0; const max=Math.min(L-1,Math.round(maxLag*sr)); for(let k=0;k<=max;k++){ if(a[k]>best){ best=a[k]; lag=k; } }
  // how far the peak stands out from the rest of the correlation (robust to noise and loudness)
  let mu=0,q=0; for(let k=0;k<=max;k++){ mu+=a[k]; q+=a[k]*a[k]; } mu/=max+1; const sd=Math.sqrt(Math.max(1e-30,q/(max+1)-mu*mu));
  return {lag:lag/sr,score:best/Math.sqrt(ea*eb+1e-12),psr:(best-mu)/sd};
}
