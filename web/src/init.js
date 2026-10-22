/* ================= Boot ================= */
if(!S.profile){ S.profile={name:'Performer',handle:'@performer'+(hash(String(Date.now()))%9000+1000),pal:4,photo:null,bio:'',interests:['song','poem','line'],created:Date.now()}; }
updateTabAvatar();
switchTab('explore');
// People who finished onboarding before accounts existed count as signed in.
if(S.auth==null && store.get('lectern.onboarded2',false)){ S.auth={signedIn:true,name:S.profile.name,email:'',provider:'device',since:Date.now()}; SAVE.auth(); }
updateTabAvatar(); if(TAB==='explore') RENDER.explore();
if(!store.get('lectern.onboarded2',false)) startOnboarding(); else SAVE.profile();
hideSplash();
window.addEventListener('pageshow',()=>updateTabAvatar());
