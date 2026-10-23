/* =====================================================================
   Speech-to-lyrics models
   One registry describes every model Lectern can use or is evaluating:
   what it is, who makes it, languages, what it is tuned for, speed, cost,
   strengths and weaknesses, and its status. Only "ready" models run by
   default; "testing" models run when the person opts in from Settings;
   "server" and "planned" entries are listed for transparency and cannot be
   selected. No accuracy numbers are invented: the comparison page shows
   only measurements taken in this app on the person's own songs.
   ===================================================================== */
const B_MODES=[
  {model:'onnx-community/whisper-base_timestamped',device:'webgpu',dtype:{encoder_model:'fp32',decoder_model_merged:'q4'},word:true,gpu:true},
  {model:'onnx-community/whisper-base_timestamped',device:'wasm',dtype:'q8',word:true},
  {model:'Xenova/whisper-tiny',device:'wasm',dtype:'q8',word:false}];
const STT_MODELS=[
  {id:'whisper-base',name:'Whisper Base',provider:'OpenAI (open model) · runs on your device',status:'ready',recommended:true,
   langs:'Multilingual (about 99 languages)',tuned:'General speech. Works on clear vocals; not trained specifically on singing.',
   speed:'Fastest option here',cost:'Free · no internet needed after a one-time download (about 80 MB)',
   strengths:['Fast, private, works offline','Word-level timing for karaoke'],weaknesses:['Smallest model: more mistakes on busy mixes, fast rap and non-English singing'],
   best:'Quick drafts and clear vocals',modes:B_MODES},
  {id:'whisper-small',name:'Whisper Small',provider:'OpenAI (open model) · runs on your device',status:'testing',
   langs:'Multilingual (about 99 languages)',tuned:'General speech, larger than Base.',
   speed:'Slower than Base',cost:'Free · larger one-time download',
   strengths:['Larger model: OpenAI reports lower error rates than Base across languages','Word-level timing'],weaknesses:['Slower, more memory; not yet benchmarked on phones in this app'],
   best:'Non-English songs, including Russian, when Base struggles',
   modes:[{model:'onnx-community/whisper-small_timestamped',device:'webgpu',dtype:{encoder_model:'fp32',decoder_model_merged:'q4'},word:true,gpu:true},
          {model:'onnx-community/whisper-small_timestamped',device:'wasm',dtype:'q8',word:true}]},
  {id:'whisper-turbo',name:'Whisper Large v3 Turbo',provider:'OpenAI (open model) · runs on your device’s GPU',status:'testing',needsGpu:true,
   langs:'Multilingual (about 99 languages)',tuned:'General speech; the largest Whisper here.',
   speed:'Needs a GPU (WebGPU). Computers and some high-end phones.',cost:'Free · very large one-time download',
   strengths:['In a public lyrics benchmark (12 songs, EN/FR/DE/ES, with separated vocals) it nearly matched Whisper Large v3 and was much faster'],weaknesses:['Very large download and memory use; not available without WebGPU'],
   best:'Best accuracy on a capable computer',
   modes:[{model:'onnx-community/whisper-large-v3-turbo_timestamped',device:'webgpu',dtype:{encoder_model:'fp16',decoder_model_merged:'q4'},word:true,gpu:true}]},
  {id:'eleven-scribe',name:'Scribe v2',provider:'ElevenLabs · hosted',status:'server',
   langs:'90+ languages (ElevenLabs lists 99), including Russian',tuned:'General speech-to-text; word-level timestamps',
   speed:'Cloud processing',cost:'Paid API. ElevenLabs lists $0.22 per extra hour of audio on its plans (check current pricing).',
   strengths:['Multilingual, word timestamps'],weaknesses:['Needs a Lectern server and API key; audio leaves the device'],best:'Candidate for multilingual accuracy'},
  {id:'deepgram-nova3',name:'Nova-3',provider:'Deepgram · hosted',status:'server',
   langs:'Many languages, including Russian (improved model announced in 2026)',tuned:'General speech-to-text',
   speed:'Cloud processing',cost:'Paid API (see Deepgram pricing)',
   strengths:['Fast hosted transcription'],weaknesses:['Needs a Lectern server and API key; not designed for singing'],best:'Candidate to benchmark against Whisper'},
  {id:'google-chirp3',name:'Chirp 3',provider:'Google Cloud Speech-to-Text · hosted',status:'server',
   langs:'Over 100 locales; Russian (ru-RU) generally available',tuned:'General speech-to-text',
   speed:'Cloud processing; word timestamps in batch mode for files up to 20 minutes',cost:'Paid API (see Google Cloud pricing)',
   strengths:['Broad language coverage'],weaknesses:['Needs a Lectern server; word-timestamp support is limited by mode'],best:'Candidate for language coverage'},
  {id:'whisperx',name:'WhisperX',provider:'Open source · server',status:'planned',
   langs:'Whisper languages',tuned:'A Whisper workflow with forced alignment for more precise word timing; not a singing model',
   speed:'Server GPU',cost:'Self-hosted compute',strengths:['More precise word timestamps'],weaknesses:['Server only'],best:'Improving timing, not words'},
  {id:'demucs',name:'Demucs vocal separation',provider:'Meta (open source) · server',status:'planned',pre:true,
   langs:'Any (pre-processing)',tuned:'Separates vocals from the music before transcription',
   speed:'Server GPU',cost:'Self-hosted compute',strengths:['Helped in one public lyrics benchmark'],weaknesses:['Hurt Whisper accuracy in another (Jam-ALT); separation artefacts can confuse recognition'],best:'Busy mixes, to be benchmarked'}
];
const STT_STATUS={ready:'Ready',testing:'In testing',server:'Needs server setup',planned:'Planned'};
const sttModel=id=>STT_MODELS.find(m=>m.id===id&&m.modes)||STT_MODELS[0];
const STT_LANGS=[['auto','Detect automatically'],['english','English'],['russian','Russian'],['french','French'],['spanish','Spanish'],['german','German'],['italian','Italian'],['portuguese','Portuguese'],['ukrainian','Ukrainian'],['polish','Polish'],['turkish','Turkish'],['japanese','Japanese'],['korean','Korean'],['chinese','Chinese'],['arabic','Arabic'],['hindi','Hindi'],['yoruba','Yoruba'],['swahili','Swahili']];
const sttLangName=k=>(STT_LANGS.find(l=>l[0]===k)||STT_LANGS[0])[1];
let HAS_GPU=null; (async()=>{ try{ HAS_GPU=!!(navigator.gpu&&await navigator.gpu.requestAdapter()); }catch(e){ HAS_GPU=false; } })();
function sttSelectable(m){ if(!m.modes) return false; if(m.status==='ready') return true; if(m.status==='testing'&&S.settings.sttTesting) return !(m.needsGpu&&HAS_GPU===false); return false; }

/* ---------- Vocal focus (basic, on device) ----------
   Keeps what is the same in both stereo channels (lead vocals are usually mixed in the
   centre) and band-limits to the voice range. Much lighter than a separation model; it
   can help on wide stereo mixes and does nothing for mono. Optional, off by default. */
const FOCUS_SRC=`
function fft(re,im,inv){ const n=re.length; for(let i=1,j=0;i<n;i++){ let b=n>>1; for(;j&b;b>>=1) j^=b; j^=b; if(i<j){ let t=re[i]; re[i]=re[j]; re[j]=t; t=im[i]; im[i]=im[j]; im[j]=t; } }
  for(let len=2;len<=n;len<<=1){ const a=(inv?2:-2)*Math.PI/len, wr=Math.cos(a), wi=Math.sin(a), h=len>>1;
    for(let i=0;i<n;i+=len){ let cr=1,ci=0; for(let k=0;k<h;k++){ const p=i+k,q=p+h, tr=re[q]*cr-im[q]*ci, ti=re[q]*ci+im[q]*cr; re[q]=re[p]-tr; im[q]=im[p]-ti; re[p]+=tr; im[p]+=ti; const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr; } } }
  if(inv){ for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } } }
onmessage=e=>{ const {L,R,sr}=e.data, N=1024,H=256,B=N/2+1,len=L.length, out=new Float32Array(len);
  const w=new Float32Array(N); for(let i=0;i<N;i++) w[i]=Math.sqrt(0.5-0.5*Math.cos(2*Math.PI*i/N));
  const lr=new Float32Array(N),li=new Float32Array(N),rr=new Float32Array(N),ri=new Float32Array(N), k0=Math.floor(90*N/sr), k1=Math.ceil(6500*N/sr);
  for(let o=-N;o<len;o+=H){ for(let i=0;i<N;i++){ const j=o+i, ok=j>=0&&j<len; lr[i]=ok?L[j]*w[i]:0; rr[i]=ok?R[j]*w[i]:0; li[i]=ri[i]=0; }
    fft(lr,li,false); fft(rr,ri,false);
    for(let k=0;k<B;k++){ const ml=Math.hypot(lr[k],li[k]), mr=Math.hypot(rr[k],ri[k]); const dr=Math.hypot(lr[k]-rr[k],li[k]-ri[k]);
      let g=1-Math.min(1,dr/(ml+mr+1e-9)); g=g*g; if(k<k0||k>k1) g*=0.15;
      const mrE=(lr[k]+rr[k])/2*g, miE=(li[k]+ri[k])/2*g; lr[k]=mrE; li[k]=miE; if(k>0&&k<B-1){ lr[N-k]=mrE; li[N-k]=-miE; } }
    fft(lr,li,true); for(let i=0;i<N;i++){ const j=o+i; if(j>=0&&j<len) out[j]+=lr[i]*w[i]/2; } }
  postMessage({out},[out.buffer]); };`;
async function vocalFocus(buf){
  const sr=16000, C=window.OfflineAudioContext||window.webkitOfflineAudioContext, oc=new C(2,Math.ceil(buf.duration*sr),sr);
  const s=oc.createBufferSource(); s.buffer=buf; s.connect(oc.destination); s.start(); const r=await oc.startRendering();
  const L=r.getChannelData(0).slice(), R=r.getChannelData(1).slice();
  const w=new Worker(URL.createObjectURL(new Blob([FOCUS_SRC],{type:'text/javascript'})));
  return new Promise((res,rej)=>{ w.onmessage=e=>{ w.terminate(); res(e.data.out); }; w.onerror=e=>{ w.terminate(); rej(e); }; w.postMessage({L,R,sr},[L.buffer,R.buffer]); });
}

/* ---------- Review flags: lines worth checking by ear ---------- */
function reviewFlags(lines,wt,language){
  const out=[]; const cyr=/[а-яё]/i, lat=/[a-z]/i;
  lines.forEach((l,i)=>{ const ws=lineWords(l), w=wt&&wt[i]||[], why=[];
    if(language==='russian'&&ws.some(x=>lat.test(x)&&!cyr.test(x))) why.push('Latin letters in a Russian song');
    if(['english','french','spanish','german','italian','portuguese'].includes(language)&&ws.some(x=>cyr.test(x))) why.push('Cyrillic letters in a '+sttLangName(language)+' song');
    if(w.some(x=>x.e-x.s>2.2)) why.push('a word is held for a very long time');
    for(let k=0;k+5<ws.length;k++){ const a=ws.slice(k,k+3).join(' ').toLowerCase(), b=ws.slice(k+3,k+6).join(' ').toLowerCase(); if(a===b){ why.push('repeated words (possible mishearing)'); break; } }
    if(i>1&&l.toLowerCase()===lines[i-1].toLowerCase()&&l.toLowerCase()===lines[i-2].toLowerCase()) why.push('the same line three times in a row');
    if(ws.length===1&&ws[0].length<=2) why.push('a very short fragment');
    if(why.length) out.push({i,why:why.join(', ')}); });
  return out;
}

/* ---------- Accuracy: word and character error rates against correct lyrics ---------- */
function normLyrics(t){ return String(t||'').toLowerCase().replace(/ё/g,'е').replace(/\[[^\]]*\]/g,' ').replace(/[^\p{L}\p{N}'\s]/gu,' ').replace(/\s+/g,' ').trim(); }
function editDistance(a,b){ const n=a.length,m=b.length; let prev=new Array(m+1); for(let j=0;j<=m;j++) prev[j]=j; for(let i=1;i<=n;i++){ const cur=new Array(m+1); cur[0]=i; for(let j=1;j<=m;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); prev=cur; } return prev[m]; }
function errorRates(hyp,ref){ const h=normLyrics(hyp), r=normLyrics(ref); const hw=h?h.split(' '):[], rw=r?r.split(' '):[];
  return {wer:rw.length?editDistance(hw,rw)/rw.length:0, cer:r.length?editDistance([...h],[...r])/r.length:0, refWords:rw.length}; }

/* ---------- Picker shown before a transcription ---------- */
function guessLanguage(it){ const t=(it.body||'')+' '+(it.title||''); if(/[а-яё]/i.test(t)) return 'russian'; return (it.stt&&it.stt.language)||S.settings.sttLang||'auto'; }
function sttPicker(it,mode){
  return new Promise(res=>{
    let chosen=null;
    const def=(it.stt&&sttSelectable(sttModel(it.stt.model))&&it.stt.model)||(S.settings.sttModel&&sttSelectable(sttModel(S.settings.sttModel))&&S.settings.sttModel)||'whisper-base';
    const lang=guessLanguage(it), focus=it.stt?!!it.stt.focus:!!S.settings.sttFocus;
    const card=m=>{ const ok=sttSelectable(m); return `<button class="mcard" data-model="${m.id}" aria-pressed="${m.id===def}" ${ok?'':'disabled'}>
        <span class="rd"></span><span class="mc-b"><b>${esc(m.name)}${m.recommended?' <i class="mtag rec">Recommended</i>':''}${m.status!=='ready'?` <i class="mtag ${m.status}">${STT_STATUS[m.status]}</i>`:''}</b>
        <small>${esc(m.provider)}</small><small>${esc(m.speed)} · ${esc(m.cost)}</small><small class="best">${esc(m.best)}</small>${!ok&&m.status==='testing'?'<small class="why">'+(m.needsGpu&&HAS_GPU===false?'This device has no WebGPU.':'Turn on “Models in testing” in Settings to try it.')+'</small>':''}</span></button>`; };
    sheet(`<div class="stt">
      <h3>${mode==='generate'?'Generate lyrics':'AI auto-sync'}</h3>
      <p class="sub" style="margin:4px 0 14px">${mode==='generate'?'Choose the song’s language and a model. The language matters most for accuracy.':'Lectern listens to the song and lines up your lyrics word by word.'}</p>
      <label class="field" style="margin:0 0 12px"><span>Language sung</span><select id="sttLang">${STT_LANGS.map(([k,n])=>`<option value="${k}" ${k===lang?'selected':''}>${n}</option>`).join('')}</select></label>
      <div class="h3" style="margin:6px 0 8px">Model</div>
      <div class="mlist">${STT_MODELS.filter(m=>m.modes).map(card).join('')}</div>
      <div class="setrow" style="padding:10px 2px"><div class="lbl">Vocal focus<small>Emphasises centre-mixed vocals before listening. Can help on wide stereo mixes; can also hurt. Off by default.</small></div><button class="toggle" role="switch" id="sttFocus" aria-checked="${focus}" aria-label="Vocal focus"></button></div>
      <button class="link block" id="sttAll" style="margin:0 0 6px">${ic('info','xs')} About these models and others we’re evaluating</button>
      <button class="btn white block" id="sttGo">${ic('wand-sparkles','sm')}Start</button></div>`,{onMount(el,close){
        let sel=def;
        el.querySelector('.mlist').onclick=e=>{ const b=e.target.closest('[data-model]'); if(!b||b.disabled) return; sel=b.dataset.model; $$('[data-model]',el).forEach(x=>x.setAttribute('aria-pressed',String(x===b))); };
        const ft=el.querySelector('#sttFocus'); ft.onclick=()=>ft.setAttribute('aria-checked',String(ft.getAttribute('aria-checked')!=='true'));
        el.querySelector('#sttAll').onclick=()=>{ close(); openModels(); };
        el.querySelector('#sttGo').onclick=()=>{ chosen={model:sel,language:el.querySelector('#sttLang').value,vocalFocus:ft.getAttribute('aria-checked')==='true'}; S.settings.sttModel=sel; S.settings.sttLang=chosen.language; S.settings.sttFocus=chosen.vocalFocus; SAVE.settings(); close(); };
      },onClose(){ setTimeout(()=>res(chosen),0); }});
  });
}

/* ---------- Models page: everything we use or are evaluating, with status ---------- */
function openModels(){ push('models',el=>{
  const st=m=>`<i class="mtag ${m.status}">${STT_STATUS[m.status]}</i>`;
  el.innerHTML=pbar('Lyrics AI models')+`<p class="pad mute" style="margin:0 0 14px">Models that turn a song into lyrics with timing. “Ready” models run on your device now. “In testing” models are wired up but not yet benchmarked; turn them on in Settings to try them. Hosted models need a Lectern server before they can be used.</p>
    ${STT_MODELS.map(m=>`<div class="card mpage" style="margin:0 20px 12px"><div class="mp-h"><b>${esc(m.name)}</b>${st(m)}</div><small class="mute">${esc(m.provider)}</small>
      <dl><dt>Languages</dt><dd>${esc(m.langs)}</dd><dt>Tuned for</dt><dd>${esc(m.tuned)}</dd><dt>Speed</dt><dd>${esc(m.speed)}</dd><dt>Cost</dt><dd>${esc(m.cost)}</dd>
      <dt>Strengths</dt><dd>${m.strengths.map(esc).join('<br>')}</dd><dt>Weaknesses</dt><dd>${m.weaknesses.map(esc).join('<br>')}</dd><dt>Best for</dt><dd>${esc(m.best)}</dd></dl></div>`).join('')}
    <p class="hint pad">Accuracy figures are only shown from tests you run in Lectern (Settings → Accuracy results). Public benchmark context: <a href="https://lyrics-bench.onrender.com/papers/paper.html" target="_blank" rel="noopener">lyrics transcription benchmark</a>, <a href="https://arxiv.org/abs/2311.13987" target="_blank" rel="noopener">Jam-ALT</a>.</p>`;
}); }

/* ---------- Accuracy results measured in this app ---------- */
const BENCH=()=>store.get('lectern.sttBench',[]);
function saveBench(r){ const b=BENCH(); b.unshift(r); store.set('lectern.sttBench',b.slice(0,200)); }
function openBench(){ push('bench',el=>{
  const b=BENCH(); const groups={};
  b.forEach(r=>{ const k=r.model+'|'+r.language; (groups[k]=groups[k]||[]).push(r); });
  const rows=Object.entries(groups).map(([k,a])=>{ const [m,l]=k.split('|'); const avg=f=>a.reduce((x,r)=>x+r[f],0)/a.length;
    return {name:sttModel(m).name+(a[0].focus?' + focus':''),lang:sttLangName(l),n:a.length,wer:avg('wer'),cer:avg('cer'),rt:avg('rt')}; }).sort((x,y)=>x.wer-y.wer);
  el.innerHTML=pbar('Accuracy results')+`<p class="pad mute" style="margin:0 0 12px">Measured on your songs: after generating lyrics, use “Check accuracy” in the song editor and paste the correct lyrics. Lower is better.</p>
    ${rows.length?`<div class="card" style="margin:0 20px"><table class="bench"><thead><tr><th>Model</th><th>Language</th><th>Songs</th><th>WER</th><th>CER</th><th>Speed</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${esc(r.lang)}</td><td>${r.n}</td><td>${(r.wer*100).toFixed(1)}%</td><td>${(r.cer*100).toFixed(1)}%</td><td>${r.rt.toFixed(2)}×</td></tr>`).join('')}</tbody></table></div>
      <p class="hint pad">WER: share of words wrong, missing or extra. CER: the same for characters, useful for Russian word endings. Speed: processing time ÷ song length (below 1× is faster than real time).</p>
      <div class="list" style="margin-top:6px">${b.slice(0,30).map(r=>`<div class="row"><span class="tx" style="padding-left:20px"><b>${esc(r.title||'Song')}</b><span>${esc(sttModel(r.model).name)} · ${esc(sttLangName(r.language))} · WER ${(r.wer*100).toFixed(1)}% · CER ${(r.cer*100).toFixed(1)}%</span></span></div>`).join('')}</div>`
      :`<div class="empty">${ic('gauge')}<b>No measurements yet</b>Generate lyrics for a song you know, then tap “Check accuracy” in its editor and paste the correct lyrics.</div>`}`;
}); }
function checkAccuracy(it){
  if(!it.genText){ toast('Generate lyrics from audio first'); return; }
  sheet(`<h3>Check accuracy</h3><p class="sub" style="margin:4px 20px 12px">Paste the correct lyrics. Lectern compares them with what the model heard (${esc(sttModel(it.stt&&it.stt.model).name)}, ${esc(sttLangName(it.stt&&it.stt.language))}).</p>
    <label class="field"><textarea id="accRef" rows="8" placeholder="Correct lyrics"></textarea></label>
    <div id="accOut" class="pad"></div><div class="row-btns"><button class="btn white" id="accGo">Compare</button></div>`,{onMount(el){
      el.querySelector('#accGo').onclick=()=>{ const ref=el.querySelector('#accRef').value; if(!normLyrics(ref)){ toast('Paste the correct lyrics first'); return; }
        const r=errorRates(it.genText,ref), rt=it.stt&&it.stt.audioDur?it.stt.seconds/it.stt.audioDur:0;
        saveBench({title:titleOf(it),model:it.stt.model,language:it.stt.language,focus:!!it.stt.focus,wer:r.wer,cer:r.cer,rt,words:r.refWords,date:Date.now()});
        el.querySelector('#accOut').innerHTML=`<div class="acc"><div><b>${(r.wer*100).toFixed(1)}%</b><span>word error rate</span></div><div><b>${(r.cer*100).toFixed(1)}%</b><span>character error rate</span></div></div><p class="hint">Saved to Settings → Accuracy results. ${r.wer>0.3?'Try another model or set the language explicitly if you used auto-detect.':''}</p>
          <button class="btn sm" id="accUse">Use the correct lyrics and re-sync</button>`;
        el.querySelector('#accUse').onclick=()=>{ it.body=ref.trim(); it.updated=Date.now(); SAVE.items(); lineEditorRefresh(); toast('Lyrics replaced. Run AI auto-sync to time them.'); };
      }; }});
}
function reviewSheet(it){
  const r=it.review||[]; const lines=lyricLines(it.body);
  sheet(`<h3>Lines to check</h3><p class="sub" style="margin:4px 20px 10px">These lines look unusual, so the model may have misheard them. Listen and fix them in the lyrics.</p>
    <div class="list" style="padding:0 8px">${r.map(x=>`<div class="row"><span class="tx" style="padding-left:12px"><b>${esc(lines[x.i]||'')}</b><span>Line ${x.i+1} · ${esc(x.why)}</span></span></div>`).join('')||'<p class="pad mute">Nothing flagged.</p>'}</div>`);
}
ACT['stt-review']=el=>reviewSheet(find(el.dataset.id));
ACT['stt-accuracy']=el=>checkAccuracy(find(el.dataset.id));
ACT['stt-models']=()=>openModels();
ACT['stt-bench']=()=>openBench();
ACT['stt-testing']=el=>{ S.settings.sttTesting=!S.settings.sttTesting; SAVE.settings(); el.setAttribute('aria-checked',String(!!S.settings.sttTesting)); toast(S.settings.sttTesting?'Models in testing are now selectable':'Only ready models are selectable'); };
