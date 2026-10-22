/* ================= Boot ================= */
if(!S.profile){ S.profile={name:'Performer',handle:'@performer'+(hash(String(Date.now()))%9000+1000),pal:4,photo:null,bio:'',interests:['song','poem','line'],created:Date.now()}; }
updateTabAvatar();
switchTab('explore');
if(!store.get('lectern.onboarded2',false)) startOnboarding(); else SAVE.profile();
window.addEventListener('pageshow',()=>updateTabAvatar());
