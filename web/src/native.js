/* ================= Native shell (Capacitor, iOS + Android) =================
   Runs only inside the native app. Talks to plugins through the bridge that
   Capacitor injects (Capacitor.nativePromise / addListener), so the web bundle
   needs no build step and still works unchanged in a browser. */
const CAP=window.Capacitor;
const NATIVE=!!(CAP&&typeof CAP.isNativePlatform==='function'&&CAP.isNativePlatform());
const PLATFORM=NATIVE?CAP.getPlatform():'web';
const hasPlugin=n=>!!(CAP&&(Array.isArray(CAP.PluginHeaders)?CAP.PluginHeaders.some(h=>h.name===n):CAP.Plugins&&CAP.Plugins[n]));
const nat=(plugin,method,opts={})=>hasPlugin(plugin)?CAP.nativePromise(plugin,method,opts):Promise.reject(new Error(plugin+' plugin is not installed'));

if(NATIVE){
  document.documentElement.classList.add('native','plat-'+PLATFORM);

  /* ---- Files out: write to the app cache in chunks, then open the system share sheet
         (Save Video / Save to Files / Drive / WhatsApp …). ---- */
  const CHUNK=3*1024*1024; // multiple of 3, so each base64 piece concatenates cleanly
  const b64=async blob=>{ const buf=new Uint8Array(await blob.arrayBuffer()); let s=''; for(let i=0;i<buf.length;i+=0x8000) s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000)); return btoa(s); };
  async function cacheFile(file){
    const name=(file.name||'lectern-file').replace(/[^\w.\- ]+/g,'').replace(/\s+/g,'-')||'lectern-file';
    const path='share/'+Date.now().toString(36)+'-'+name;
    if(file.size<=CHUNK) await nat('Filesystem','writeFile',{path,data:await b64(file),directory:'CACHE',recursive:true});
    else for(let o=0;o<file.size;o+=CHUNK){
      const data=await b64(file.slice(o,o+CHUNK));
      await nat('Filesystem',o?'appendFile':'writeFile',o?{path,data,directory:'CACHE'}:{path,data,directory:'CACHE',recursive:true});
    }
    return (await nat('Filesystem','getUri',{path,directory:'CACHE'})).uri;
  }
  async function nativeShare({title,text,url,files}={}){
    const opts={dialogTitle:title||'Share'};
    if(title) opts.title=title; if(text) opts.text=text; if(url) opts.url=url;
    if(files&&files.length){ toast('Preparing…'); opts.files=[]; for(const f of files) opts.files.push(await cacheFile(f)); }
    try{ await nat('Share','share',opts); }
    catch(e){ const m=String(e&&(e.message||e)); if(/cancel/i.test(m)){ const a=new Error('Share canceled'); a.name='AbortError'; throw a; } throw e; }
  }
  if(hasPlugin('Share')){
    try{
      Object.defineProperty(navigator,'share',{configurable:true,value:nativeShare});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:d=>!d||!d.files||hasPlugin('Filesystem')});
    }catch(e){}
    // "Download" has no meaning inside an app: hand the file to the share sheet instead.
    downloadFile=f=>{ nativeShare({title:f.name,files:[f]}).catch(e=>{ if(e.name!=='AbortError') toast('Couldn’t save this file'); }); };
  }

  /* ---- Keep the screen on while performing or recording ---- */
  if(hasPlugin('KeepAwake')){
    lockScreen=async()=>{ try{ await nat('KeepAwake','keepAwake'); }catch(e){} };
    unlockScreen=()=>{ nat('KeepAwake','allowSleep').catch(()=>{}); };
  }

  /* ---- Android back button / gesture: close the top-most layer ---- */
  const vis=sel=>{ const e=$(sel); return e&&!e.hidden; };
  function goBack(){
    if(vis('#render')||vis('#onb')) return;
    if($('#sheets .sheet')){ closeSheets(); return; }
    if(vis('#studio')){ closeStudio(); return; }
    if(vis('#sync')){ closeSync(); return; }
    if(!stage.hidden){
      if(state==='recording'||state==='paused'||state==='counting'){ toast('Stop the recording first'); return; }
      closeStage(); return; }
    if(STACK.length){ pop(); return; }
    if(TAB!=='explore'){ switchTab('explore'); return; }
    nat('App','minimizeApp').catch(()=>nat('App','exitApp').catch(()=>{}));
  }
  if(hasPlugin('App')){
    CAP.addListener('App','backButton',()=>goBack());
    /* Leaving the app: pause playback and any take in progress so nothing runs unseen. */
    CAP.addListener('App','appStateChange',st=>{
      if(st&&st.isActive) return;
      try{ if(state==='recording') pauseToggle(); }catch(e){}
      try{ if(stage.hidden&&$('#sync').hidden) player.pause(); }catch(e){}
      try{ stopPreview(); }catch(e){}
      try{ beatStop(); }catch(e){}
      try{ if(typeof stPause==='function'&&vis('#studio')) stPause(); }catch(e){}
    });
  }

  /* ---- Ask the OS not to evict saved songs, takes and the speech model ---- */
  try{ navigator.storage&&navigator.storage.persist&&navigator.storage.persist(); }catch(e){}

  /* ---- First frame is ready: fade the launch screen out ---- */
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ nat('SplashScreen','hide',{fadeOutDuration:250}).catch(()=>{}); }));
}
