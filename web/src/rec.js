/* =====================================================================
   Recording mixer
   The take's soundtrack is mixed inside the app, not re-recorded through
   the air:
     mic ─ high-pass ─ gentle compressor ─ light de-ess ─┬─ voice stem (for the editor)
                                                         └─┐
     app music (digital) ─ delay to match what the singer heard ─ duck ─ level ─┴─ mix ─ limiter ─ video
   - Music from the app is mixed digitally, so it is clean and steady instead
     of being picked up by the mic from the speaker.
   - The music feed is delayed by the measured output + input delay so the
     voice lands on the beat the singer actually heard (Bluetooth included).
   - While the voice is present the music dips a little (about 3 dB), slowly,
     so the voice stays clear without audible pumping.
   - No browser noise suppression or auto-gain (they chop and pump music);
     echo cancellation only on the speaker, where it stops the music leaking
     back into the voice.
   ===================================================================== */
const REC={g:null,on:false};
function recMusicLevel(){ return S.settings.recMusic??0.6; }
function recBuild(micStream){
  const c=ac(); const g={nodes:[]}; const N=n=>{ g.nodes.push(n); return n; };
  g.dest=c.createMediaStreamDestination(); g.stemDest=c.createMediaStreamDestination(); g.dest.channelCount=2;
  // voice chain
  g.voiceOut=N(c.createGain());
  if(micStream&&micStream.getAudioTracks().length){
    g.mic=N(c.createMediaStreamSource(micStream));
    const hp=N(c.createBiquadFilter()); hp.type='highpass'; hp.frequency.value=90; hp.Q.value=0.7;
    const cp=N(c.createDynamicsCompressor()); cp.threshold.value=-26; cp.knee.value=12; cp.ratio.value=2.5; cp.attack.value=0.01; cp.release.value=0.22;
    const ess=N(c.createBiquadFilter()); ess.type='peaking'; ess.frequency.value=6800; ess.Q.value=2; ess.gain.value=-2;
    const pres=N(c.createBiquadFilter()); pres.type='peaking'; pres.frequency.value=3000; pres.Q.value=0.9; pres.gain.value=1.5;
    const mk=N(c.createGain()); mk.gain.value=db2g(3);
    const vlim=N(c.createDynamicsCompressor()); vlim.threshold.value=-4; vlim.knee.value=2; vlim.ratio.value=20; vlim.attack.value=0.001; vlim.release.value=0.08;
    const vsc=N(c.createWaveShaper()); vsc.curve=softClipCurve(); vsc.oversample='2x';
    g.mic.connect(hp); hp.connect(cp); cp.connect(ess); ess.connect(pres); pres.connect(mk); mk.connect(vlim); vlim.connect(vsc); vsc.connect(g.voiceOut);
    g.vAn=N(c.createAnalyser()); g.vAn.fftSize=1024; g.voiceOut.connect(g.vAn);
  }
  g.voiceOut.connect(g.stemDest);
  // music feed: delayed to line up with the voice, ducked, levelled
  g.musicIn=N(c.createGain());
  g.delay=N(c.createDelay(1.5)); g.delay.delayTime.value=Math.min(1.4,outLat()+extraLatency()+(micStream?micInLatency(micStream):0));
  g.duck=N(c.createGain()); g.level=N(c.createGain()); g.level.gain.value=recMusicLevel();
  g.musicIn.connect(g.delay); g.delay.connect(g.duck); g.duck.connect(g.level);
  // mix with headroom and a transparent peak limiter
  g.mix=N(c.createGain()); g.mix.gain.value=db2g(-1);
  g.voiceOut.connect(g.mix); g.level.connect(g.mix);
  g.lim=N(c.createDynamicsCompressor()); g.lim.threshold.value=-2; g.lim.knee.value=0; g.lim.ratio.value=20; g.lim.attack.value=0.002; g.lim.release.value=0.1;
  g.lim.attack.value=0.001; const sc=N(c.createWaveShaper()); sc.curve=softClipCurve(); sc.oversample='2x';
  g.mix.connect(g.lim); g.lim.connect(sc); sc.connect(g.dest);
  return g;
}
/* Transparent below about -3 dBFS, then rounds peaks off smoothly so nothing hard-clips at 0 dBFS. */
function softClipCurve(){ const n=4096, cu=new Float32Array(n), knee=0.7, ceil=0.966; for(let i=0;i<n;i++){ const x=i*2/(n-1)-1, a=Math.abs(x); cu[i]=Math.sign(x)*(a<=knee?a:knee+(ceil-knee)*Math.tanh((a-knee)/(ceil-knee))); } return cu; }
const micInLatency=s=>{ try{ const l=s.getAudioTracks()[0].getSettings().latency; return isFinite(l)&&l>0&&l<0.5?l:0.02; }catch(e){ return 0.02; } };
/* Ducking: follow the voice level and lower the music by up to ~3 dB while singing. */
function recDuckLoop(g){
  if(!g.vAn) return;
  const buf=new Float32Array(g.vAn.fftSize); const c=ac();
  g.duckT=setInterval(()=>{ g.vAn.getFloatTimeDomainData(buf); let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i];
    const db=10*Math.log10(s/buf.length+1e-12); const target=db>-40?db2g(-3):1;
    g.duck.gain.setTargetAtTime(target,c.currentTime,target<g.duck.gain.value?0.08:0.45); },40);
}
/* Connect whichever music is playing in the app (karaoke track, clip audio or music bed). */
let BED_SRC=null;
function recAttachMusic(g){
  if(REC.mirrorBuf){ REC.attachPlayer=()=>{}; }
  else { if(player.gain) try{ player.gain.connect(g.musicIn); }catch(e){}
    REC.attachPlayer=()=>{ if(player.gain&&REC.g) try{ player.gain.connect(REC.g.musicIn); }catch(e){} }; }
  if(bed.id){ try{ if(!BED_SRC){ BED_SRC=ac().createMediaElementSource(bed.audio); BED_SRC.connect(ac().destination); } BED_SRC.connect(g.musicIn); }catch(e){} }
}
function recStart(micStream){ recStop(); const g=recBuild(micStream); recAttachMusic(g); recDuckLoop(g); REC.g=g; REC.on=true; return g; }
/* Mirror source: plays the clean arrangement into the recording only, in step with the player. */
function recMirrorSync(){
  const g=REC.g; if(!g||!REC.mirrorBuf) return;
  if(REC.mirror){ try{ REC.mirror.stop(); }catch(e){} REC.mirror=null; }
  if(player.on){ const s=ac().createBufferSource(); s.buffer=REC.mirrorBuf; s.playbackRate.value=player.rate; s.connect(g.musicIn); s.start(player.t0,Math.min(player.off,REC.mirrorBuf.duration-0.01)); REC.mirror=s; }
}
{ const _p=player.play.bind(player), _q=player.pause.bind(player);
  player.play=function(){ const r=_p(); if(REC.on) recMirrorSync(); return r; };
  player.pause=function(){ const r=_q(); if(REC.on) recMirrorSync(); return r; }; }
function recStop(){ const g=REC.g; if(!g) return; clearInterval(g.duckT); if(REC.mirror){ try{ REC.mirror.stop(); }catch(e){} REC.mirror=null; }
  try{ if(player.gain) player.gain.disconnect(g.musicIn); }catch(e){} try{ if(BED_SRC) BED_SRC.disconnect(g.musicIn); }catch(e){}
  g.nodes.forEach(n=>{ try{ n.disconnect(); }catch(e){} }); REC.g=null; REC.on=false; }
