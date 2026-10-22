/* =====================================================================
   Vocal processing (offline, in a worker so the UI stays smooth)
   - Spectral noise reduction: learns the noise from the quietest moments of
     the take, then gates each frequency band in a short-time Fourier
     transform with smoothed gains (no "musical noise" chirps).
   - Analysis: level, noise floor and tonal balance of the sung parts, used
     to set loudness and the adaptive enhancer.
   ===================================================================== */
const VOCAL_WORKER_SRC=`
function fft(re,im,inv){ const n=re.length; for(let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const a=(inv?2:-2)*Math.PI/len, wr=Math.cos(a), wi=Math.sin(a), h=len>>1;
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let k=0;k<h;k++){ const p=i+k,q=p+h, tr=re[q]*cr-im[q]*ci, ti=re[q]*ci+im[q]*cr; re[q]=re[p]-tr; im[q]=im[p]-ti; re[p]+=tr; im[p]+=ti; const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr; } } }
  if(inv){ for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } } }
onmessage=e=>{
  const {x,sr,amount,id}=e.data; const N=2048,H=512,B=N/2+1, len=x.length;
  const win=new Float32Array(N); for(let i=0;i<N;i++) win[i]=Math.sqrt(0.5-0.5*Math.cos(2*Math.PI*i/N));
  const frames=Math.max(1,Math.ceil((len+N)/H));
  // pass 1: frame energy + magnitude for noise profile
  const en=new Float32Array(frames); for(let f=0;f<frames;f++){ const o=f*H-N; let s=0; for(let i=0;i<N;i++){ const j=o+i; const v=j>=0&&j<len?x[j]:0; s+=v*v; } en[f]=s/N; }
  const order=[...en.keys()].filter(f=>en[f]>1e-10).sort((a,b)=>en[a]-en[b]);
  const nq=Math.max(8,Math.floor(order.length*0.12)), quiet=order.slice(0,nq);
  const noise=new Float32Array(B), re=new Float32Array(N), im=new Float32Array(N);
  for(const f of quiet){ const o=f*H-N; for(let i=0;i<N;i++){ const j=o+i; re[i]=(j>=0&&j<len?x[j]:0)*win[i]; im[i]=0; } fft(re,im,false); for(let k=0;k<B;k++) noise[k]+=Math.hypot(re[k],im[k]); }
  for(let k=0;k<B;k++) noise[k]/=Math.max(1,quiet.length);
  const noiseDb=10*Math.log10((quiet.reduce((a,f)=>a+en[f],0)/Math.max(1,quiet.length))+1e-12);
  // pass 2: gate
  const out=new Float32Array(len), beta=1+3.2*amount, gmin=Math.pow(10,-(4+20*amount)/20);
  const g=new Float32Array(B), gs=new Float32Array(B).fill(1), tmp=new Float32Array(B);
  const bands=[[90,300],[300,2000],[2000,5000],[5000,9000],[9000,14000]], bandE=new Float64Array(5); let voiced=0, vSum=0, peak=0;
  const voicedThr=Math.pow(10,(noiseDb+12)/10);
  for(let f=0;f<frames;f++){
    const o=f*H-N; for(let i=0;i<N;i++){ const j=o+i; re[i]=(j>=0&&j<len?x[j]:0)*win[i]; im[i]=0; }
    fft(re,im,false);
    const isVoiced=en[f]>voicedThr;
    for(let k=0;k<B;k++){ const m2=re[k]*re[k]+im[k]*im[k], n2=noise[k]*noise[k]*beta; g[k]=Math.max(gmin,Math.sqrt(Math.max(0,1-n2/(m2+1e-12)))); }
    for(let k=0;k<B;k++){ tmp[k]=(g[Math.max(0,k-1)]+g[k]*2+g[Math.min(B-1,k+1)])/4; }
    for(let k=0;k<B;k++){ gs[k]=tmp[k]>gs[k]?tmp[k]:gs[k]*0.55+tmp[k]*0.45; }
    if(isVoiced){ voiced++; vSum+=en[f]; for(let b=0;b<5;b++){ const k0=Math.floor(bands[b][0]*N/sr), k1=Math.min(B-1,Math.floor(bands[b][1]*N/sr)); let s=0; for(let k=k0;k<=k1;k++){ const m=Math.hypot(re[k],im[k])*gs[k]; s+=m*m; } bandE[b]+=s/(k1-k0+1); } }
    for(let k=0;k<B;k++){ re[k]*=gs[k]; im[k]*=gs[k]; if(k>0&&k<B-1){ re[N-k]=re[k]; im[N-k]=-im[k]; } }
    fft(re,im,true);
    for(let i=0;i<N;i++){ const j=o+i; if(j>=0&&j<len) out[j]+=re[i]*win[i]/2; }
    if(f%200===0) postMessage({id,progress:f/frames});
  }
  for(let i=0;i<len;i++){ const a=Math.abs(out[i]); if(a>peak) peak=a; }
  const rmsDb=voiced?10*Math.log10(vSum/voiced+1e-12):-60;
  const bandDb=[...bandE].map(v=>10*Math.log10(v/Math.max(1,voiced)+1e-12));
  postMessage({id,done:true,out,stats:{noiseDb,rmsDb,peakDb:20*Math.log10(peak+1e-9),voicedPct:voiced/frames,bandDb}},[out.buffer]);
};`;
const VOCAL={w:null,seq:0,cache:new Map()};
function vocalWorker(){ if(!VOCAL.w){ VOCAL.w=new Worker(URL.createObjectURL(new Blob([VOCAL_WORKER_SRC],{type:'text/javascript'}))); } return VOCAL.w; }
/* Clean a mono voice buffer. Returns {buf, stats}. Cached by buffer + amount. */
function vocalClean(ctx,buf,amount,onProgress){
  const key=buf; const c=VOCAL.cache.get(key)||{}; const q=Math.round(amount*20)/20;
  if(c[q]) return Promise.resolve(c[q]);
  const id=++VOCAL.seq, w=vocalWorker();
  const x=new Float32Array(buf.length); for(let ch=0;ch<buf.numberOfChannels;ch++){ const d=buf.getChannelData(ch); for(let i=0;i<d.length;i++) x[i]+=d[i]/buf.numberOfChannels; }
  return new Promise((res,rej)=>{
    const on=e=>{ const m=e.data; if(m.id!==id) return;
      if(m.progress!=null&&onProgress) onProgress(m.progress);
      if(m.done){ w.removeEventListener('message',on); const out=ctx.createBuffer(1,m.out.length,buf.sampleRate); out.copyToChannel(m.out,0); const r={buf:out,stats:m.stats}; c[q]=r; VOCAL.cache.set(key,c); res(r); } };
    w.addEventListener('message',on); w.addEventListener('error',rej,{once:true});
    w.postMessage({x,sr:buf.sampleRate,amount:q,id},[x.buffer]);
  });
}
/* Gain that brings the sung parts to a steady level (about -18 dBFS RMS), within limits. */
const loudnessGain=st=>st?Math.pow(10,Math.max(-6,Math.min(18,-18-st.rmsDb))/20):1;
