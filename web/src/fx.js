/* =====================================================================
   Voice effects with adjustable parameters
   Every effect is a small Web Audio graph described by a list of parameters
   (each with a range and default). build() returns {input, output, set}
   where set(key, value) changes a parameter live without rebuilding.
   ===================================================================== */
const db2g=d=>Math.pow(10,d/20);
function irBuf(c,sec,decay,bright=1){ const sr=c.sampleRate,len=Math.max(1,sec*sr|0),b=c.createBuffer(2,len,sr); for(let ch=0;ch<2;ch++){ const d=b.getChannelData(ch); let lp=0; for(let i=0;i<len;i++){ const n=Math.random()*2-1; lp+= (n-lp)*bright; d[i]=lp*Math.pow(1-i/len,decay); } } return b; }
function satCurve(drive){ const k=drive*60+0.001,n=2048,cu=new Float32Array(n); for(let i=0;i<n;i++){ const x=i*2/n-1; cu[i]=(1+k)*x/(1+k*Math.abs(x)); } return cu; }

/* Shared helpers that return {input, output, set} */
function wetDry(c,nodes){ const input=c.createGain(), output=c.createGain(), dry=c.createGain(), wet=c.createGain(); input.connect(dry); dry.connect(output); wet.connect(output); nodes.push(input,output,dry,wet); return {input,output,dry,wet,mix(v){ dry.gain.value=Math.cos(v*Math.PI/2); wet.gain.value=Math.sin(v*Math.PI/2)*1.15; }}; }
function reverbSend(c,nodes,sec,decay,bright){ const cv=c.createConvolver(); cv.buffer=irBuf(c,sec,decay,bright); const pre=c.createDelay(0.2); pre.delayTime.value=0.02; const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=200; const g=c.createGain(); pre.connect(hp); hp.connect(cv); cv.connect(g); nodes.push(cv,pre,hp,g); return {input:pre,output:g,gain:g.gain}; }
function delaySend(c,nodes,time,fb,tone){ const d=c.createDelay(2); d.delayTime.value=time; const f=c.createGain(); f.gain.value=fb; const lp=c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=tone; const g=c.createGain(); d.connect(lp); lp.connect(f); f.connect(d); lp.connect(g); nodes.push(d,f,lp,g); return {input:d,output:g,time:d.delayTime,fb:f.gain,gain:g.gain}; }

const P=(key,label,min,max,step,def,unit='')=>({key,label,min,max,step,def,unit});
const FX=[
  {id:'none',name:'Original',icon:'mic',params:[]},
  /* ---- Vocal presets ---- */
  {id:'studio',name:'Studio',icon:'sparkles',group:'preset',params:[P('reverb','Reverb',0,100,1,22,'%'),P('bright','Brightness',-6,6,0.5,2,' dB'),P('warm','Warmth',-6,6,0.5,1,' dB'),P('comp','Compression',0,100,1,45,'%')],
    build(c,nodes,v){ const input=c.createGain(), output=c.createGain(); const lo=c.createBiquadFilter(); lo.type='lowshelf'; lo.frequency.value=220; const hi=c.createBiquadFilter(); hi.type='highshelf'; hi.frequency.value=6500; const cp=c.createDynamicsCompressor(); cp.attack.value=0.005; cp.release.value=0.16; const mk=c.createGain();
      const rv=reverbSend(c,nodes,1.6,3,0.6); input.connect(lo); lo.connect(hi); hi.connect(cp); cp.connect(mk); mk.connect(output); mk.connect(rv.input); rv.output.connect(output); nodes.push(input,output,lo,hi,cp,mk);
      const set=(k,x)=>{ if(k==='reverb') rv.gain.value=x/100*0.6; if(k==='bright') hi.gain.value=x; if(k==='warm') lo.gain.value=x; if(k==='comp'){ cp.threshold.value=-8-x*0.26; cp.ratio.value=1+x/100*5; mk.gain.value=db2g(x*0.08); } };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input,output,set}; }},
  {id:'pop',name:'Pop shine',icon:'star',group:'preset',params:[P('reverb','Plate reverb',0,100,1,28,'%'),P('delay','Slap delay',0,100,1,20,'%'),P('bright','Air',0,8,0.5,4,' dB'),P('double','Double',0,100,1,25,'%')],
    build(c,nodes,v){ const input=c.createGain(), output=c.createGain(); const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=110; const pk=c.createBiquadFilter(); pk.type='peaking'; pk.frequency.value=3000; pk.gain.value=2.5; pk.Q.value=.9; const air=c.createBiquadFilter(); air.type='highshelf'; air.frequency.value=11000; const cp=c.createDynamicsCompressor(); cp.threshold.value=-24; cp.ratio.value=4; cp.attack.value=.004; cp.release.value=.12; const mk=c.createGain(); mk.gain.value=1.3;
      input.connect(hp); hp.connect(pk); pk.connect(air); air.connect(cp); cp.connect(mk); mk.connect(output);
      const rv=reverbSend(c,nodes,1.3,4,0.9); mk.connect(rv.input); rv.output.connect(output);
      const sl=delaySend(c,nodes,0.11,0.12,4500); mk.connect(sl.input); sl.output.connect(output);
      const pl=c.createStereoPanner(), pr=c.createStereoPanner(); pl.pan.value=-0.7; pr.pan.value=0.7; const dl=c.createDelay(0.1), dr=c.createDelay(0.1); dl.delayTime.value=0.017; dr.delayTime.value=0.023; const dg=c.createGain(); mk.connect(dl); mk.connect(dr); dl.connect(pl); dr.connect(pr); pl.connect(dg); pr.connect(dg); dg.connect(output);
      nodes.push(input,output,hp,pk,air,cp,mk,pl,pr,dl,dr,dg);
      const set=(k,x)=>{ if(k==='reverb') rv.gain.value=x/100*0.55; if(k==='delay') sl.gain.value=x/100*0.5; if(k==='bright') air.gain.value=x; if(k==='double') dg.gain.value=x/100*0.6; };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input,output,set}; }},
  {id:'rnb',name:'Smooth R&B',icon:'moon',group:'preset',params:[P('warm','Warmth',0,8,0.5,3,' dB'),P('reverb','Reverb',0,100,1,35,'%'),P('delay','Echo',0,100,1,25,'%'),P('smooth','Smoothness',0,100,1,50,'%')],
    build(c,nodes,v){ const input=c.createGain(), output=c.createGain(); const lo=c.createBiquadFilter(); lo.type='peaking'; lo.frequency.value=180; lo.Q.value=.8; const harsh=c.createBiquadFilter(); harsh.type='peaking'; harsh.frequency.value=3800; harsh.Q.value=1.2; const cp=c.createDynamicsCompressor(); cp.threshold.value=-26; cp.ratio.value=3.5; cp.attack.value=.01; cp.release.value=.2; const mk=c.createGain(); mk.gain.value=1.3;
      input.connect(lo); lo.connect(harsh); harsh.connect(cp); cp.connect(mk); mk.connect(output);
      const rv=reverbSend(c,nodes,2.4,2.6,0.4); mk.connect(rv.input); rv.output.connect(output);
      const ec=delaySend(c,nodes,0.375,0.32,2600); mk.connect(ec.input); ec.output.connect(output);
      nodes.push(input,output,lo,harsh,cp,mk);
      const set=(k,x)=>{ if(k==='warm') lo.gain.value=x; if(k==='reverb') rv.gain.value=x/100*0.6; if(k==='delay') ec.gain.value=x/100*0.45; if(k==='smooth') harsh.gain.value=-x/100*6; };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input,output,set}; }},
  {id:'hall',name:'Concert hall',icon:'theater',group:'preset',params:[P('mix','Amount',0,100,1,45,'%'),P('size','Size',1,6,0.1,3,' s'),P('bright','Brightness',0,100,1,50,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); let rv=null; const mkRv=()=>{ if(rv){ try{ rv.output.disconnect(); }catch(e){} } rv=reverbSend(c,nodes,v.size||3,2.2,0.15+(v.bright??50)/100*0.8); w.input.connect(rv.input); rv.output.connect(w.wet); };
      mkRv(); const set=(k,x)=>{ v[k]=x; if(k==='mix') w.mix(x/100); if(k==='size'||k==='bright') mkRv(); };
      w.mix((v.mix??45)/100); return {input:w.input,output:w.output,set,rebuildOn:['size','bright']}; }},
  {id:'stadium',name:'Stadium',icon:'megaphone',group:'preset',params:[P('mix','Amount',0,100,1,40,'%'),P('time','Echo time',150,700,10,420,' ms'),P('fb','Echo repeats',0,80,1,35,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const ec=delaySend(c,nodes,0.42,0.35,3000); const rv=reverbSend(c,nodes,4,1.8,0.3); w.input.connect(ec.input); ec.output.connect(w.wet); w.input.connect(rv.input); rv.output.connect(w.wet); ec.gain.value=.7; rv.gain.value=.6;
      const set=(k,x)=>{ if(k==='mix') w.mix(x/100); if(k==='time') ec.time.value=x/1000; if(k==='fb') ec.fb.value=x/100; };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set}; }},
  {id:'double',name:'Doubler',icon:'copy',group:'preset',params:[P('mix','Amount',0,100,1,50,'%'),P('width','Width',0,100,1,80,'%'),P('spread','Spread',5,40,1,18,' ms')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const dl=c.createDelay(0.1), dr=c.createDelay(0.1), pl=c.createStereoPanner(), pr=c.createStereoPanner(); const lfo=c.createOscillator(), lg=c.createGain(); lfo.frequency.value=0.6; lg.gain.value=0.002; lfo.connect(lg); lg.connect(dl.delayTime); lg.connect(dr.delayTime); lfo.start();
      w.input.connect(dl); w.input.connect(dr); dl.connect(pl); dr.connect(pr); pl.connect(w.wet); pr.connect(w.wet); nodes.push(dl,dr,pl,pr,lg);
      const set=(k,x)=>{ if(k==='mix') w.mix(x/100*0.8); if(k==='width'){ pl.pan.value=-x/100; pr.pan.value=x/100; } if(k==='spread'){ dl.delayTime.value=x/1000; dr.delayTime.value=x*1.37/1000; } };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set,srcs:[lfo]}; }},
  /* ---- Character effects ---- */
  {id:'deep',name:'Deep',icon:'chevrons-down',group:'fx',params:[P('pitch','Pitch',-12,-1,1,-5,' st'),P('mix','Amount',0,100,1,100,'%')],
    build(c,nodes,v){ return pitchFx(c,nodes,v,-5); }},
  {id:'chip',name:'Chipmunk',icon:'chevrons-up',group:'fx',params:[P('pitch','Pitch',1,12,1,7,' st'),P('mix','Amount',0,100,1,100,'%')],
    build(c,nodes,v){ return pitchFx(c,nodes,v,7); }},
  {id:'echo',name:'Echo',icon:'repeat',group:'fx',params:[P('time','Delay',60,900,10,320,' ms'),P('fb','Repeats',0,85,1,38,'%'),P('mix','Amount',0,100,1,45,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const ec=delaySend(c,nodes,0.32,0.38,3500); w.input.connect(ec.input); ec.output.connect(w.wet); ec.gain.value=1;
      const set=(k,x)=>{ if(k==='time') ec.time.value=x/1000; if(k==='fb') ec.fb.value=x/100; if(k==='mix') w.mix(x/100); };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set}; }},
  {id:'robot',name:'Robot',icon:'bot',group:'fx',params:[P('tone','Tone',20,200,1,48,' Hz'),P('mix','Amount',0,100,1,100,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const am=c.createGain(); am.gain.value=0; const osc=c.createOscillator(); osc.frequency.value=48; osc.connect(am.gain); osc.start(); const d=c.createDelay(.1); d.delayTime.value=.011; const fb=c.createGain(); fb.gain.value=.55; const mx=c.createGain(); mx.gain.value=1.6;
      w.input.connect(am); am.connect(mx); am.connect(d); d.connect(fb); fb.connect(d); d.connect(mx); mx.connect(w.wet); nodes.push(am,d,fb,mx);
      const set=(k,x)=>{ if(k==='tone') osc.frequency.value=x; if(k==='mix') w.mix(x/100); };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set,srcs:[osc]}; }},
  {id:'radio',name:'Radio',icon:'radio',group:'fx',params:[P('drive','Drive',0,100,1,55,'%'),P('band','Bandwidth',0,100,1,35,'%'),P('mix','Amount',0,100,1,100,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const hp=c.createBiquadFilter(); hp.type='highpass'; const lp=c.createBiquadFilter(); lp.type='lowpass'; const ws=c.createWaveShaper(); const g=c.createGain(); g.gain.value=.7;
      w.input.connect(hp); hp.connect(lp); lp.connect(ws); ws.connect(g); g.connect(w.wet); nodes.push(hp,lp,ws,g);
      const set=(k,x)=>{ if(k==='drive') ws.curve=satCurve(x/100); if(k==='band'){ hp.frequency.value=700-x*4.5; lp.frequency.value=2400+x*40; } if(k==='mix') w.mix(x/100); };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set}; }},
  {id:'lofi',name:'Lo-fi tape',icon:'cassette-tape',group:'fx',params:[P('sat','Saturation',0,100,1,45,'%'),P('tone','Tone',1000,8000,100,3500,' Hz'),P('wobble','Wobble',0,100,1,30,'%'),P('mix','Amount',0,100,1,100,'%')],
    build(c,nodes,v){ const w=wetDry(c,nodes); const ws=c.createWaveShaper(); const lp=c.createBiquadFilter(); lp.type='lowpass'; const d=c.createDelay(0.05); d.delayTime.value=0.01; const lfo=c.createOscillator(), lg=c.createGain(); lfo.frequency.value=0.9; lfo.connect(lg); lg.connect(d.delayTime); lfo.start(); const hp=c.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=160;
      w.input.connect(ws); ws.connect(hp); hp.connect(lp); lp.connect(d); d.connect(w.wet); nodes.push(ws,lp,d,lg,hp);
      const set=(k,x)=>{ if(k==='sat') ws.curve=satCurve(x/100*0.5); if(k==='tone') lp.frequency.value=x; if(k==='wobble') lg.gain.value=x/100*0.0025; if(k==='mix') w.mix(x/100); };
      Object.entries(v).forEach(([k,x])=>set(k,x)); return {input:w.input,output:w.output,set,srcs:[lfo]}; }}
];
const FXMAP=Object.fromEntries(FX.map(f=>[f.id,f]));
const fxDefaults=id=>Object.fromEntries((FXMAP[id]?.params||[]).map(p=>[p.key,p.def]));
/* Granular pitch shifter (two crossfaded delay lines); pitch in semitones. */
function pitchFx(c,nodes,v,defSt){
  const w=wetDry(c,nodes); let ps=null; const srcs=[];
  const mk=st=>{ if(ps){ ps.srcs.forEach(s=>{ try{ s.stop(); }catch(e){} }); try{ ps.output.disconnect(); w.input.disconnect(ps.input); }catch(e){} }
    const ratio=Math.pow(2,st/12); ps=pitchShifter(c,ratio>1?(ratio-1)*1.0:-(1-ratio)*1.65); w.input.connect(ps.input); ps.output.connect(w.wet); nodes.push(ps.input,ps.output); srcs.push(...ps.srcs); };
  mk(v.pitch??defSt);
  const set=(k,x)=>{ if(k==='pitch') mk(x); if(k==='mix') w.mix(x/100); };
  w.mix((v.mix??100)/100); return {input:w.input,output:w.output,set,srcs};
}

/* ---------------------------------------------------------------------
   Enhancer ("AI voice smoother"): reads the take's measured tonal balance
   and dynamics, then sets EQ, a multiband smoother for harsh 2.5–6 kHz
   peaks and sibilance, and compression to suit that voice.
   --------------------------------------------------------------------- */
function enhancePlan(stats,amt){
  // Typical sung-vocal balance relative to the 300 Hz–2 kHz band (per-bin power, dB).
  const target=[4,0,-11,-18,-26];
  const b=stats&&stats.bandDb?stats.bandDb:null;
  const rel=b?b.map(x=>x-b[1]):target;
  const corr=rel.map((r,i)=>Math.max(-6,Math.min(6,(target[i]-r))));
  const crest=stats?Math.max(6,Math.min(30,stats.peakDb-stats.rmsDb)):14;
  return {mud:Math.min(0,corr[0])*0.6*amt-1*amt, presence:Math.max(0,corr[2])*0.5*amt+1.5*amt, harshThr:-30+(rel[2]-target[2])*-0.5,
    deess:Math.min(0,corr[3])*0.7*amt-2*amt, air:Math.max(0,corr[4])*0.4*amt+1*amt, ratio:1.5+amt*2.5*(crest/18), thr:-18-amt*8};
}
function buildEnhancer(c,nodes,stats,amt){
  const p=enhancePlan(stats,amt);
  const input=c.createGain(), output=c.createGain();
  const mud=c.createBiquadFilter(); mud.type='peaking'; mud.frequency.value=260; mud.Q.value=1; mud.gain.value=p.mud;
  const pres=c.createBiquadFilter(); pres.type='peaking'; pres.frequency.value=3000; pres.Q.value=0.8; pres.gain.value=p.presence;
  const air=c.createBiquadFilter(); air.type='highshelf'; air.frequency.value=10500; air.gain.value=p.air;
  // multiband smoother: split at 2.5 kHz and 6 kHz, compress the upper bands only when they get loud
  const lowL=c.createBiquadFilter(); lowL.type='lowpass'; lowL.frequency.value=2500; lowL.Q.value=0.5;
  const midB=c.createBiquadFilter(); midB.type='bandpass'; midB.frequency.value=3900; midB.Q.value=0.8;
  const hiB=c.createBiquadFilter(); hiB.type='highpass'; hiB.frequency.value=6000; hiB.Q.value=0.5;
  const cMid=c.createDynamicsCompressor(); cMid.threshold.value=p.harshThr; cMid.ratio.value=2+amt*4; cMid.attack.value=0.002; cMid.release.value=0.08; cMid.knee.value=6;
  const cHi=c.createDynamicsCompressor(); cHi.threshold.value=-32+p.deess; cHi.ratio.value=3+amt*5; cHi.attack.value=0.001; cHi.release.value=0.05; cHi.knee.value=4;
  const sum=c.createGain();
  const comp=c.createDynamicsCompressor(); comp.threshold.value=p.thr; comp.ratio.value=p.ratio; comp.attack.value=0.008; comp.release.value=0.18; comp.knee.value=10;
  const mk=c.createGain(); mk.gain.value=db2g(Math.max(0,(-p.thr-18)*0.35));
  input.connect(mud); mud.connect(pres); pres.connect(air);
  air.connect(lowL); air.connect(midB); air.connect(hiB);
  lowL.connect(sum); midB.connect(cMid); cMid.connect(sum); hiB.connect(cHi); cHi.connect(sum);
  sum.connect(comp); comp.connect(mk); mk.connect(output);
  nodes.push(input,output,mud,pres,air,lowL,midB,hiB,cMid,cHi,sum,comp,mk);
  return {input,output,plan:p};
}
