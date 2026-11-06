'use strict';

const opt = {
  bones:true, joints:true, head:true, headbox:false,
  hands:true, box:false, boxStyle:'corners',
  lines:{top:false,mid:false,bot:false,vctr:false,snap:false},
  fps:true, health:true, gesture:true,
};
let healthVal = 100;
let bodyColor = '#b4b4b4';
let handColor = '#787878';

function hslHex(h,s=100,l=62){
  s/=100; l/=100;
  const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l);
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));
  const x=v=>Math.round(255*v).toString(16).padStart(2,'0');
  return '#'+x(f(0))+x(f(8))+x(f(4));
}
const HUE_HEX = Array.from({length:360},(_,h)=>hslHex(h));
let bodyRgb=false, handRgb=false, rgbHue=0;
function updateRgb(){
  rgbHue=(performance.now()/16)%360;
  if(bodyRgb) bodyColor=HUE_HEX[Math.floor(rgbHue)];
  if(handRgb) handColor=HUE_HEX[Math.floor((rgbHue+180)%360)];
}
const hueCol=i=>HUE_HEX[Math.floor((rgbHue+i*16)%360)];

const PALETTE = ['#b4b4b4','#e2e2e2','#50f0a0','#00d0ff','#ff4455','#f0c020'];

const POSE_CONN = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [25,27],[26,28],[27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
];
const HAND_CONN = [
  [0,1],[1,2],[2,3],[3,4],[5,6],[6,7],[7,8],
  [9,10],[10,11],[11,12],[13,14],[14,15],[15,16],
  [17,18],[18,19],[19,20],
  [0,5],[5,9],[9,13],[13,17],[0,17],
];
const FACE_IDX = new Set([0,1,2,3,4,5,6,7,8,9,10]);
const SKIP_JOINT = new Set([23,24]);

class Smoother {
  constructor(){ this.p=null; }
  smooth(lms){
    if(!this.p){ this.p=lms.map(l=>({...l})); return this.p; }
    this.p=lms.map((l,i)=>{
      const q=this.p[i];
      const d=Math.hypot(l.x-q.x,l.y-q.y);
      const a=0.3+0.65*Math.min(1,d/0.03);
      return {
        x:a*l.x+(1-a)*q.x, y:a*l.y+(1-a)*q.y, z:a*l.z+(1-a)*q.z,
        visibility:0.5*(l.visibility??1)+0.5*(q.visibility??1),
      };
    });
    return this.p;
  }
}

function plausible(l, asp){
  const v=i=>l[i].visibility??1;
  const dist=(a,b)=>Math.hypot((a.x-b.x)*asp, a.y-b.y);
  if(v(11)<0.5||v(12)<0.5) return false;
  const sw=dist(l[11],l[12]);
  if(sw<0.02) return false;
  if(v(7)>0.5&&v(8)>0.5 && sw<dist(l[7],l[8])*1.3) return false;
  if(v(23)>0.5&&v(24)>0.5){
    const sm={x:(l[11].x+l[12].x)/2,y:(l[11].y+l[12].y)/2};
    const hm={x:(l[23].x+l[24].x)/2,y:(l[23].y+l[24].y)/2};
    const torso=dist(sm,hm);
    if(torso<sw*0.5||torso>sw*4) return false;
  }
  return true;
}
const CONFIRM = 3, HOLD = 6;
const tracker = {
  tracks: [],
  center(l){ return { x:(l[11].x+l[12].x)/2, y:(l[11].y+l[12].y)/2 }; },
  update(dets, asp){
    const free = this.tracks.slice(), next = [];
    for(const d of dets){
      if(!plausible(d, asp)) continue;
      const c = this.center(d);
      let bi=-1, bd=0.09;
      for(let i=0;i<free.length;i++){
        const dd=(free[i].c.x-c.x)**2+(free[i].c.y-c.y)**2;
        if(dd<bd){ bd=dd; bi=i; }
      }
      let t;
      if(bi>=0){ t=free[bi]; free.splice(bi,1); t.age++; }
      else t={ sm:new Smoother(), age:1 };
      t.miss=0; t.c=c; t.pose=t.sm.smooth(d);
      next.push(t);
    }
    for(const t of free){
      t.miss++;
      if(t.age>=CONFIRM && t.miss<=HOLD) next.push(t);
    }
    this.tracks = next;
    return next.filter(t=>t.age>=CONFIRM).map(t=>t.pose);
  },
  reset(){ this.tracks = []; },
};
const MAX_PEOPLE = 4;
let numPeople = 2;

const video   = document.getElementById('video');
const canvas  = document.getElementById('canvas');
let ctx       = canvas.getContext('2d');
const toast   = document.getElementById('toast');

const notifEl = document.getElementById('notif');
let notifTimer = 0;
const N_ICONS = {
  info:  '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  ok:    '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.5"/>',
  error: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
};
function notify(type, title, text, ms){
  clearTimeout(notifTimer);
  notifEl.className = 'n-'+type;
  notifEl.setAttribute('role', type==='error' ? 'alert' : 'status');
  notifEl.querySelector('.n-ico').innerHTML = N_ICONS[type] || N_ICONS.info;
  notifEl.querySelector('.n-title').textContent = title;
  notifEl.querySelector('.n-text').textContent = text || '';
  void notifEl.offsetWidth;
  notifEl.classList.add('show');
  notifTimer = setTimeout(hideNotif, ms ?? (type==='error' ? 9000 : 5000));
}
function hideNotif(){ notifEl.classList.remove('show'); }
notifEl.querySelector('.n-x').onclick = hideNotif;

function camErrorInfo(e){
  const n = e && e.name;
  const inApp = /Instagram|FBAN|FBAV|Line\/|MicroMessenger|TikTok|Snapchat/i.test(navigator.userAgent);
  if(!window.isSecureContext)
    return ['https lazım','Kamera sadece https:// ile acılan sitelerde calısıyor. Adresin bası https:// olsun.'];
  if(n==='NoMediaDevices')
    return inApp
      ? ['Bu tarayıcıda olmaz','Uygulamanın icindeki tarayıcı kamerayı engelliyor. Sag ustteki menuden "Tarayıcıda ac" de, oyle gir.']
      : ['Tarayıcın kamerayı desteklemiyor','Chrome ya da Safari ile gir, guncel olsun.'];
  if(n==='NotAllowedError'||n==='SecurityError')
    return ['Kamera iznini vermedin','Adres cubugundaki kilit simgesine bas, kamerayı "Izin ver" yap, sonra tekrar dene.'];
  if(n==='NotFoundError'||n==='DevicesNotFoundError'||n==='OverconstrainedError')
    return ['Kamera yok','Bu cihazda kamera bulamadım. Takılı mı, acık mı bir bak.'];
  if(n==='NotReadableError'||n==='AbortError'||n==='TrackStartError')
    return ['Kamera mesgul','Baska bir uygulama ya da sekme kamerayı kullanıyor. Onu kapat, tekrar dene.'];
  return ['Kamera acılmadı','Sayfayı yenile, bir dene. Olmazsa tarayıcıyı kapatıp tekrar ac.'];
}

window.addEventListener('offline',()=>notify('error','Internet gitti','Kamera calısmaya devam eder ama modeller inmediyse yuklenemez.'));
window.addEventListener('online',()=>{
  notify('ok','Internet geldi','');
  if(!models && !modelsLoading && stream){ loadFails=0; loadModels(); }
});

let stream=null, facing='user', detecting=false;
let models=null, lastHand=null, lastPoses=[];
let mlTid=null, renderAf=null;
let rotated=false;
let fpsPrev=performance.now(), panelOpen=window.innerWidth>600;

const mlCanvas = document.createElement('canvas');
mlCanvas.width=640; mlCanvas.height=360;
const mlCtx = mlCanvas.getContext('2d',{willReadFrequently:false});

let _rect=null;
window.addEventListener('resize',()=>{ _rect=null; });

function getRect(){
  if(_rect) return _rect;
  const vW=video.videoWidth||1, vH=video.videoHeight||1;
  const cW=rotated ? canvas.height : canvas.width;
  const cH=rotated ? canvas.width  : canvas.height;
  const scale=Math.min(cW/vW, cH/vH);
  const w=vW*scale, h=vH*scale;
  return (_rect={ x:(cW-w)/2, y:(cH-h)/2, w, h });
}

const pov = document.getElementById('pov');
function hidePov(){
  pov.classList.add('out');
  setTimeout(()=>{ if(pov.classList.contains('out')) pov.style.display='none'; }, 280);
}
function showPov(title, text){
  pov.classList.remove('out');
  pov.style.display='flex';
  const err=document.getElementById('pov-err');
  err.style.display='block';
  err.querySelector('b').textContent=title;
  err.querySelector('span').textContent=text;
  document.getElementById('perm-btn').textContent='TEKRAR DENE';
}

function checkPermission(){
  try{
    if(sessionStorage.getItem('cam_ok')==='1'){ hidePov(); startCam(); }
  }catch(e){}
}

document.getElementById('perm-btn').onclick = async () => {
  document.getElementById('pov-err').style.display='none';
  hidePov(); await startCam();
};

let camToken=0, everStarted=false, reverting=false, tourStarted=false;

function updateCamBtn(){
  document.getElementById('cam-btn').textContent = facing==='user' ? '↺  Kamerayı Cevir' : '↺  On Kamera';
}

async function openStream(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    const e=new Error('no mediaDevices'); e.name='NoMediaDevices'; throw e;
  }
  const tries=[
    { facingMode:facing, width:{ideal:1920}, height:{ideal:1080} },
    { facingMode:facing },
    true,
  ];
  let lastErr;
  for(const v of tries){
    try{ return await navigator.mediaDevices.getUserMedia({ video:v, audio:false }); }
    catch(e){ lastErr=e; if(e.name==='NotAllowedError'||e.name==='SecurityError') break; }
  }
  throw lastErr;
}

async function startCam(){
  const my=++camToken;
  if(stream){ stream.getTracks().forEach(t=>{ t.onended=null; t.stop(); }); stream=null; }
  try{
    const s = await openStream();
    if(my!==camToken){ s.getTracks().forEach(t=>t.stop()); return; }
    stream = s;
    stream.getVideoTracks().forEach(t=>{
      t.onended=()=>{ if(my===camToken) setTimeout(()=>{ if(my===camToken) startCam(); }, 500); };
    });
    video.srcObject = stream;
    video.onloadedmetadata = ()=>{
      _rect=null;
      document.getElementById('res-txt').textContent = video.videoWidth+'×'+video.videoHeight;
    };
    try{ await video.play(); }catch(e){}
    everStarted=true;
    try{ sessionStorage.setItem('cam_ok','1'); }catch(e){}
    let shown=false;
    try{ shown=sessionStorage.getItem('priv_shown')==='1'; sessionStorage.setItem('priv_shown','1'); }catch(e){}
    if(!shown) notify('info','Goruntun sende kalıyor','Merak etme, kamera goruntun cihazından cıkmıyor. Yapay zeka tarayıcının icinde calısıyor, hicbir kare sunucuya gitmiyor.',7000);
    if(!tourStarted){ tourStarted=true; maybeStartTour(shown ? 900 : 7800); }
    if(!models && !modelsLoading) loadModels();
  }catch(e){
    if(my!==camToken) return;
    console.warn('Kamera hatası:', e);
    const [title,text]=camErrorInfo(e);
    if(everStarted && !reverting && e.name!=='NotAllowedError'){
      notify('error', title, text);
      reverting=true;
      facing = facing==='user' ? 'environment' : 'user';
      updateCamBtn();
      try{ await startCam(); } finally { reverting=false; }
      return;
    }
    showPov(title, text);
  }
}

async function requestWakeLock(){
  try{ if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
let wakeLock=null, modelsLoading=false;

document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    cancelCountdown();
    stopRec();
    stopLoops();
  }else{
    if(stream && !stream.getVideoTracks().some(t=>t.readyState==='live')) startCam();
    if(detecting){ stopLoops(); startRender(); startML(); requestWakeLock(); }
  }
});

document.getElementById('cam-btn').onclick = async () => {
  stopRec();
  facing = facing==='user' ? 'environment' : 'user';
  updateCamBtn();
  tracker.reset(); lastHand=null; lastPoses=[];
  await startCam();
};

function setQuality(q){
  if(q===quality) return;
  quality = q;
  updateQualityBtn();
  if(!models && !modelsLoading) return;
  const old = models;
  models = null; lastPoses=[]; lastHand=null;
  if(old){ try{ old.pose.close(); old.hand.close(); }catch(_){} }
  modelsLoading=false;
  loadModels();
}
document.getElementById('q-btn').onclick = () => { setQuality(quality==='full' ? 'lite' : 'full'); scheduleSave(); };

function setPeople(n){
  numPeople = Math.min(MAX_PEOPLE, Math.max(1, parseInt(n)||1));
  document.getElementById('ppl').value = numPeople;
  document.getElementById('ppl-v').textContent = numPeople;
  tracker.reset(); lastPoses=[]; lastHand=null;
  if(models){
    try{
      models.pose.setOptions({ numPoses:numPeople });
      models.hand.setOptions({ numHands:numPeople*2 });
    }catch(err){ console.warn('setOptions hatası:', err); }
  }
}
document.getElementById('ppl').oninput = e => { setPeople(e.target.value); scheduleSave(); };

function setRotated(v){
  rotated = v;
  _rect = null;
  document.getElementById('rot-btn').textContent = rotated ? '⤢  Dikey Gorunum' : '⤢  Yatay Gorunum';
}
document.getElementById('rot-btn').onclick = () => { setRotated(!rotated); scheduleSave(); };

function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=src; s.onload=res;
    s.onerror=()=>rej(new Error('Script yuklenemedi'));
    document.head.appendChild(s);
  });
}

async function loadMPScript(){
  const VER='0.10.14';
  const BASES=[
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`,
    `https://unpkg.com/@mediapipe/tasks-vision@${VER}`,
  ];

  for(const base of BASES){
    for(const ext of ['vision_bundle.mjs','vision_bundle.js']){
      try{
        const mp = await import(base+'/'+ext);
        const FR = mp.FilesetResolver ?? mp.default?.FilesetResolver;
        if(FR) return {
          FilesetResolver: FR,
          PoseLandmarker:  mp.PoseLandmarker  ?? mp.default?.PoseLandmarker,
          HandLandmarker:  mp.HandLandmarker  ?? mp.default?.HandLandmarker,
          wasmBase: base+'/wasm',
        };
      }catch(e){ console.warn('import fail',ext,'@',base,e.message); }
    }
  }

  for(const base of BASES){
    try{
      await loadScript(base+'/vision_bundle.js');
      const g = globalThis;
      const FR = g.FilesetResolver ?? g.mpTasks?.FilesetResolver ?? g.vision?.FilesetResolver;
      if(FR) return {
        FilesetResolver: FR,
        PoseLandmarker:  g.PoseLandmarker  ?? g.mpTasks?.PoseLandmarker  ?? g.vision?.PoseLandmarker,
        HandLandmarker:  g.HandLandmarker  ?? g.mpTasks?.HandLandmarker  ?? g.vision?.HandLandmarker,
        wasmBase: base+'/wasm',
      };
    }catch(e){ console.warn('script tag fail @',e.message); }
  }

  throw new Error('MediaPipe CDN erisilemedi — internet baglantısını kontrol edin');
}

const HAND_URL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
const poseUrl=q=>`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${q}/float16/latest/pose_landmarker_${q}.task`;

let quality = matchMedia('(pointer:coarse)').matches ? 'lite' : 'full';
let mpCache = null, loadFails = 0;

async function createModels(mp, fs, delegate){
  const pose = await mp.PoseLandmarker.createFromOptions(fs,{
    baseOptions:{ modelAssetPath:poseUrl(quality), delegate },
    runningMode:'VIDEO', numPoses:numPeople,
    minPoseDetectionConfidence:0.6, minPosePresenceConfidence:0.6, minTrackingConfidence:0.5,
  });
  const hand = await mp.HandLandmarker.createFromOptions(fs,{
    baseOptions:{ modelAssetPath:HAND_URL, delegate },
    runningMode:'VIDEO', numHands:numPeople*2,
    minHandDetectionConfidence:0.5, minHandPresenceConfidence:0.5, minTrackingConfidence:0.5,
  });
  return { pose, hand };
}

function updateQualityBtn(){
  document.getElementById('q-btn').textContent = quality==='full' ? '◈  Model: Dogru' : '◈  Model: Hızlı';
}

async function loadModels(){
  if(modelsLoading) return;
  modelsLoading=true;
  updateQualityBtn();
  toast.textContent = 'Yapay zeka yukleniyor...';
  try{
    const mp = mpCache || (mpCache = await loadMPScript());
    if(!mp.PoseLandmarker||!mp.HandLandmarker) throw new Error('MediaPipe sınıfları bulunamadı');
    const fs = await mp.FilesetResolver.forVisionTasks(mp.wasmBase);

    toast.textContent = 'Modeller iniyor...';
    try{
      models = await createModels(mp, fs, 'GPU');
    }catch(gpuErr){
      if(gpuErr instanceof TypeError || /fetch|network|load failed/i.test(String(gpuErr&&gpuErr.message))) throw gpuErr;
      console.warn('GPU basarısız, CPU deneniyor:', gpuErr);
      toast.textContent = 'CPU moduna geciyorum...';
      notify('info','CPU ile calısıyor','Cihazın GPU\'su bu modeli acamadı, biraz yavas olabilir. "Model: Hızlı" yapınca duzelir.',7000);
      models = await createModels(mp, fs, 'CPU');
    }
    loadFails=0;
    tracker.reset(); lastPoses=[]; lastHand=null; lastTs=0;
    toast.textContent = 'Hazır, baslat tusuna bas';
  }catch(e){
    console.error('MediaPipe hatası:', e);
    loadFails++;
    if(!navigator.onLine){
      notify('error','Internet yok','Modeller ilk acılısta internetten iniyor. Baglantı gelince ben tekrar deniyorum.');
      toast.textContent = 'Internet bekleniyor...';
      modelsLoading=false;
      return;
    }
    if(loadFails>=3){
      notify('error','Modeller inmedi','Birkac kere denedim ama sunucuya ulasamadım. Sayfayı yenile, olmazsa internetini kontrol et.', 12000);
      toast.textContent = 'Yukleme olmadı';
      modelsLoading=false;
      return;
    }
    notify('error','Modeller inmedi','Sunucuya ulasamadım. 5 saniye sonra tekrar deniyorum ('+loadFails+'/3).', 6000);
    toast.textContent = 'Tekrar denenecek...';
    setTimeout(()=>{ modelsLoading=false; if(!models) loadModels(); }, 5000);
    return;
  }
  modelsLoading=false;
}

document.getElementById('main-btn').onclick = () => {
  detecting = !detecting;
  const btn = document.getElementById('main-btn');
  btn.textContent = detecting ? 'DURDUR' : 'BASLAT';
  btn.className = 'btn-p ' + (detecting ? 'btn-st' : 'btn-go');
  document.getElementById('live').classList.toggle('on', detecting);
  if(detecting){ stopLoops(); lastVideoTime=-1; startRender(); startML(); requestWakeLock(); }
  else { stopLoops(); }
};

function stopLoops(){
  if(renderAf){ cancelAnimationFrame(renderAf); renderAf=null; }
  if(mlTid){ clearTimeout(mlTid); mlTid=null; }
}

function startRender(){ renderAf=requestAnimationFrame(renderTick); }

function renderTick(ts){
  if(!detecting){ renderAf=null; return; }
  renderAf = requestAnimationFrame(renderTick);

  const vw=window.innerWidth, vh=window.innerHeight;
  if(canvas.width!==vw||canvas.height!==vh){ canvas.width=vw; canvas.height=vh; _rect=null; }
  ctx.clearRect(0,0,vw,vh);
  updateRgb();

  if(video.readyState<2||!video.videoWidth){
    ctx.fillStyle='#000'; ctx.fillRect(0,0,vw,vh);
    return;
  }

  const r=getRect(), mir=facing==='user';

  ctx.save();
  try{

  if(rotated){
    ctx.translate(0, vh);
    ctx.rotate(-Math.PI/2);
  }

  if(mir){
    if(rotated){
      ctx.translate(0, vw); ctx.scale(1, -1);
    } else {
      ctx.translate(vw, 0); ctx.scale(-1, 1);
    }
  }

  ctx.drawImage(video, r.x, r.y, r.w, r.h);

  paintOverlay(r, rotated ? vh : vw, rotated ? vw : vh);
  drawPinchRing(r);
  }catch(e){
    console.warn('Cizim hatası:', e);
  }finally{
    ctx.restore();
  }

  const now=performance.now();
  const fps=Math.round(1000/(now-fpsPrev)); fpsPrev=now;
  document.getElementById('fps-txt').textContent = opt.fps ? 'FPS '+fps : '';
}

function startML(){ mlTid=setTimeout(mlTick, 0); }

let lastVideoTime=-1, lastTs=0, mlErrors=0, handMiss=0;

function nextTs(){
  const t=performance.now();
  lastTs = t>lastTs ? t : lastTs+1;
  return lastTs;
}

function mlTick(){
  mlTid=null;
  if(!detecting) return;
  if(!models||video.readyState<2||!video.videoWidth){
    mlTid=setTimeout(mlTick, 50); return;
  }
  if(video.currentTime===lastVideoTime){
    mlTid=setTimeout(mlTick, 4); return;
  }
  lastVideoTime=video.currentTime;

  const t0=performance.now();
  try{
    const vW=video.videoWidth, vH=video.videoHeight;
    const mlW=Math.min(640, vW), mlH=Math.round(mlW*vH/vW);
    if(mlCanvas.width!==mlW||mlCanvas.height!==mlH){
      mlCanvas.width=mlW; mlCanvas.height=mlH;
      tracker.reset(); lastHand=null; lastPoses=[];
    }
    mlCtx.drawImage(video, 0, 0, mlW, mlH);

    const poseRes=models.pose.detectForVideo(mlCanvas, nextTs());
    lastPoses=tracker.update(poseRes.landmarks||[], mlW/mlH);
    document.getElementById('stat-txt').textContent=lastPoses.length?(lastPoses.length+' KISI'):'YOK';

    if(opt.hands||opt.gesture){
      const h=models.hand.detectForVideo(mlCanvas, nextTs());
      if(h.landmarks.length){ lastHand=h; handMiss=0; }
      else if(++handMiss>3) lastHand=null;
      updateGesture(h, mlW/mlH);
    }else{
      lastHand=null; resetGesture();
    }
    mlErrors=0;
  }catch(e){
    console.warn('ML hatası:', e);
    lastPoses=[]; lastHand=null; tracker.reset();
    mlErrors++;
    if(mlErrors>=5){
      toast.textContent='Model yeniden baslıyor...';
      notify('info','Model yeniden baslıyor','Art arda hata aldım, kendim toparlıyorum.',4000);
      try{ models.pose.close(); models.hand.close(); }catch(_){}
      models=null; mlErrors=0; lastTs=0; loadModels();
    }
    mlTid=setTimeout(mlTick, 100); return;
  }

  const elapsed=performance.now()-t0;
  mlTid=setTimeout(mlTick, elapsed>12 ? Math.round(elapsed*0.3) : 0);
}

function paintOverlay(r, ew, eh){
  if(lastPoses.length){
    if(opt.box) for(const p of lastPoses) drawBox(p, r);
    drawLineOverlay(lastPoses.flat(), r, ew, eh);
    for(const p of lastPoses){
      drawPose(p, r);
      if(opt.health) drawHealth(p, r);
    }
  }
  if(opt.hands && lastHand && lastHand.landmarks.length>0){
    drawHands(lastHand, lastPoses, r);
  }
}

function paintExport(cv, maxW){
  if(video.readyState<2||!video.videoWidth) return false;
  const r=getRect();
  const Wpx=Math.min(maxW, video.videoWidth);
  const k=Wpx/r.w;
  const Hpx=Math.round(r.h*k);
  const outW=rotated?Hpx:Wpx, outH=rotated?Wpx:Hpx;
  if(cv.width!==outW||cv.height!==outH){ cv.width=outW; cv.height=outH; }
  const c=cv.getContext('2d');
  const prev=ctx; ctx=c;
  updateRgb();
  c.save();
  try{
    c.clearRect(0,0,outW,outH);
    if(rotated){ c.translate(0,outH); c.rotate(-Math.PI/2); }
    if(facing==='user'){
      if(rotated){ c.translate(0,outW); c.scale(1,-1); }
      else       { c.translate(outW,0); c.scale(-1,1); }
    }
    c.scale(k,k);
    c.drawImage(video,0,0,r.w,r.h);
    if(detecting) paintOverlay({x:0,y:0,w:r.w,h:r.h}, r.w, r.h);
  }finally{
    c.restore(); ctx=prev;
  }
  return true;
}

const capCanvas=document.createElement('canvas');
const recCanvas=document.createElement('canvas');
const REC_MAX_SEC=120;
let rec=null, recChunks=[], recRaf=0, recLast=0, recTimer=0, recT0=0;
let prevUrl=null, prevBlob=null, prevName='';

function stamp(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function flash(){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const f=document.getElementById('flash');
  f.style.transition='none'; f.style.opacity='0.55';
  requestAnimationFrame(()=>{ f.style.transition='opacity 0.2s ease-out'; f.style.opacity='0'; });
}

function takePhoto(){
  if(!paintExport(capCanvas, 1920)){ notify('error','Kamera daha hazır degil','Goruntu gelsin, bir saniye bekleyip tekrar bas.',4000); return; }
  flash();
  capCanvas.toBlob(b=>{ if(b) showPreview(b,'image'); else notify('error','Fotograf olmadı','Tekrar dene. Olmazsa sayfayı yenile.'); }, 'image/jpeg', 0.92);
}

function pickMime(){
  const list=['video/mp4;codecs=avc1','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  return list.find(t=>MediaRecorder.isTypeSupported(t))||'';
}

function setRecUI(on){
  const b=document.getElementById('rec-btn');
  b.classList.toggle('on',on);
  b.setAttribute('aria-pressed',on?'true':'false');
  b.setAttribute('aria-label',on?'Kaydı durdur':'Video kaydını baslat');
  document.getElementById('rot-btn').disabled=on;
  document.getElementById('rec-time').style.display=on?'block':'none';
}

function startRec(){
  if(!window.MediaRecorder){ notify('error','Video kaydı olmuyor','Bu tarayıcı video kaydedemiyor. Fotograf cekmeyi dene ya da Chrome/Safari\'yi guncelle.'); return; }
  if(!paintExport(recCanvas, 1280)){ notify('error','Kamera daha hazır degil','Goruntu gelsin, bir saniye bekleyip tekrar bas.',4000); return; }
  let s;
  try{ s=recCanvas.captureStream(30); }
  catch(e){ notify('error','Kayıt baslamadı','Tarayıcı goruntuyu kayda alamadı. Sayfayı yenile, tekrar dene.'); return; }
  const mime=pickMime();
  try{ rec=new MediaRecorder(s, mime?{mimeType:mime,videoBitsPerSecond:4000000}:{videoBitsPerSecond:4000000}); }
  catch(e){ notify('error','Kayıt baslamadı','Bu cihaz video bicimini desteklemiyor. Fotograf cekmeyi dene.'); return; }
  recChunks=[];
  const mr=rec;
  mr.ondataavailable=e=>{ if(e.data&&e.data.size) recChunks.push(e.data); };
  mr.onstop=()=>{
    cancelAnimationFrame(recRaf); clearInterval(recTimer);
    s.getTracks().forEach(t=>t.stop());
    const blob=new Blob(recChunks,{type:mr.mimeType||mime||'video/webm'});
    recChunks=[]; rec=null; setRecUI(false);
    if(blob.size) showPreview(blob,'video'); else notify('error','Kayıt bos cıktı','Cok kısa olmus olabilir. En az 1 saniye kaydet.');
  };
  mr.start(1000);
  recT0=performance.now(); recLast=0;
  const loop=ts=>{ recRaf=requestAnimationFrame(loop); if(ts-recLast<30) return; recLast=ts; paintExport(recCanvas,1280); };
  recRaf=requestAnimationFrame(loop);
  const tEl=document.getElementById('rec-time');
  recTimer=setInterval(()=>{
    const sec=Math.floor((performance.now()-recT0)/1000);
    tEl.textContent='KAYIT '+String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
    if(sec>=REC_MAX_SEC) stopRec();
  },250);
  tEl.textContent='KAYIT 00:00';
  setRecUI(true);
}

function stopRec(){
  if(rec&&rec.state!=='inactive'){ try{ rec.stop(); }catch(e){ console.warn(e); } }
}

function showPreview(blob, kind){
  hidePreview();
  prevBlob=blob;
  const ext=kind==='image'?'jpg':(blob.type.includes('mp4')?'mp4':'webm');
  prevName=`esp-pose-${stamp()}.${ext}`;
  prevUrl=URL.createObjectURL(blob);
  const box=document.getElementById('prev-media');
  box.textContent='';
  let el;
  if(kind==='image'){ el=new Image(); el.alt='Cekilen fotograf onizlemesi'; }
  else{ el=document.createElement('video'); el.controls=true; el.playsInline=true; el.muted=true; el.loop=true; el.autoplay=true; }
  el.src=prevUrl;
  box.appendChild(el);
  const file=new File([blob],prevName,{type:blob.type});
  const canShare=!!(navigator.canShare&&navigator.canShare({files:[file]}));
  document.getElementById('prev-save').textContent=canShare?'Galeriye Kaydet':'Indir';
  document.getElementById('prev-hint').textContent=canShare
    ? 'Acılan menuden "Goruntuyu Kaydet" ya da Galeri / Fotograflar secenegine bas.'
    : 'Dosya Indirilenler klasorune iner.';
  document.getElementById('prev').style.display='flex';
  document.getElementById('prev-save').focus();
}

function hidePreview(){
  document.getElementById('prev').style.display='none';
  document.getElementById('prev-media').textContent='';
  if(prevUrl){ URL.revokeObjectURL(prevUrl); prevUrl=null; }
  prevBlob=null;
}

async function saveCapture(){
  if(!prevBlob) return;
  const file=new File([prevBlob],prevName,{type:prevBlob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file]}); notify('ok','Paylasma menusu kapandı','Kaydettiysen Galeri ya da Fotograflar\'da gorunur.',4000); return; }
    catch(e){ if(e.name==='AbortError') return; console.warn('share basarısız, indirmeye dusuluyor:', e); }
  }
  const a=document.createElement('a');
  a.href=prevUrl; a.download=prevName;
  document.body.appendChild(a); a.click(); a.remove();
  notify('ok','Indirme basladı', prevName+' Indirilenler klasorune iniyor.',5000);
}

const TIMER_STEPS=[0,3,5,10];
let timerIdx=0, counting=false, countTid=0, countLeft=0, audioCtx=null;

function beep(freq, ms){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    const t=audioCtx.currentTime, o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type='sine'; o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.18,t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t+ms/1000);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t+ms/1000+0.02);
  }catch(e){}
}
function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

function updateTimerBtn(){
  const s=TIMER_STEPS[timerIdx], b=document.getElementById('timer-btn'), v=document.getElementById('timer-val');
  v.textContent=s; v.style.display=s?'flex':'none';
  b.classList.toggle('active', s>0);
  b.setAttribute('aria-label', s ? `Zamanlayıcı: ${s} saniye` : 'Zamanlayıcı: kapalı');
}
document.getElementById('timer-btn').onclick=()=>{
  if(counting) return;
  timerIdx=(timerIdx+1)%TIMER_STEPS.length;
  updateTimerBtn();
  const s=TIMER_STEPS[timerIdx];
  toast.textContent = s ? `Zamanlayıcı: ${s} sn` : 'Zamanlayıcı kapalı';
  scheduleSave();
};

function showCount(n){
  const c=document.getElementById('count'), num=document.getElementById('count-num');
  c.style.display='flex'; num.textContent=n;
  num.classList.remove('tick'); void num.offsetWidth; num.classList.add('tick');
}
function setShutterUI(on){
  const b=document.getElementById('shot-btn');
  b.classList.toggle('on',on);
  b.setAttribute('aria-label', on ? 'Geri sayımı iptal et' : 'Fotograf cek');
  document.getElementById('timer-btn').disabled=on;
}
function stopCountdown(){
  clearInterval(countTid); counting=false;
  document.getElementById('count').style.display='none';
  setShutterUI(false);
}
function cancelCountdown(){
  if(!counting) return;
  stopCountdown();
  toast.textContent='Geri sayım iptal';
}
function startCountdown(sec){
  if(video.readyState<2||!video.videoWidth){
    notify('error','Kamera daha hazır degil','Goruntu gelsin, bir saniye bekleyip tekrar bas.',4000); return;
  }
  counting=true; countLeft=sec; setShutterUI(true);
  showCount(countLeft); beep(660,90);
  countTid=setInterval(()=>{
    countLeft--;
    if(countLeft>0){ showCount(countLeft); beep(660,90); if(countLeft===1) buzz(40); }
    else{ stopCountdown(); beep(990,220); buzz(120); takePhoto(); }
  },1000);
}
function photoClick(){
  if(counting){ cancelCountdown(); return; }
  const s=TIMER_STEPS[timerIdx];
  if(s>0) startCountdown(s); else takePhoto();
}
document.getElementById('shot-btn').onclick=photoClick;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const narrow=()=>window.innerWidth<=600;
const TOUR=[
  { sel:['#menu-btn'], title:'Menu',
    text:'Butun ayarlar burada: renk, kisi sayısı, cizgiler gibi. Acıp kapatmak icin buna bas.' },
  { sel:['#main-btn'], title:'Baslat',
    text:'Once BASLAT\'a bas, iskelet cizilmeye baslasın.', before:()=>setPanel(true) },
  { sel:['#cam-btn','#rot-btn'], title:'Kamera ve yon',
    text:'On ve arka kamera arasında gecis yap. Telefonu yan cevirmek istemiyorsan "Yatay Gorunum"u kullan.', before:()=>setPanel(true) },
  { sel:['#cap-bar'], title:'Fotograf ve video',
    text:'Solda zamanlayıcı (3, 5, 10 sn), ortada fotograf, sagda video kaydı. Avucun yukarı bakarken basparmagınla isaret parmagını birlestirirsen de fotograf ceker. Cektiklerini paylasma menusunden galerine kaydedebilirsin.',
    before:()=>{ if(narrow()) setPanel(false); } },
];
let tourI=0, tourOn=false;
const tourEl=document.getElementById('tour'), tourSpot=document.getElementById('tour-spot'), tourCard=document.getElementById('tour-card');

function tourRect(sels){
  let l=1e9,t=1e9,r=-1e9,b=-1e9;
  for(const s of sels){
    const e=document.querySelector(s); if(!e) continue;
    const q=e.getBoundingClientRect();
    l=Math.min(l,q.left); t=Math.min(t,q.top); r=Math.max(r,q.right); b=Math.max(b,q.bottom);
  }
  return {l,t,r,b};
}
function placeTour(){
  const q=tourRect(TOUR[tourI].sel), pad=8;
  tourSpot.style.left=(q.l-pad)+'px'; tourSpot.style.top=(q.t-pad)+'px';
  tourSpot.style.width=(q.r-q.l+pad*2)+'px'; tourSpot.style.height=(q.b-q.t+pad*2)+'px';
  const cw=tourCard.offsetWidth, ch=tourCard.offsetHeight, vw=window.innerWidth, vh=window.innerHeight;
  let top;
  if(vh-q.b-pad >= ch+16) top=q.b+pad+14;
  else if(q.t-pad >= ch+16) top=q.t-pad-ch-14;
  else top=Math.max(16,(vh-ch)/2);
  const left=Math.min(Math.max(16,(q.l+q.r)/2-cw/2), vw-cw-16);
  tourCard.style.top=top+'px'; tourCard.style.left=left+'px';
}
async function showStep(i){
  tourI=i; const st=TOUR[i];
  if(st.before) st.before();
  await sleep(i===0?60:380);
  if(!tourOn) return;
  document.getElementById('tour-step').textContent=`${i+1} / ${TOUR.length}`;
  document.getElementById('tour-title').textContent=st.title;
  document.getElementById('tour-text').textContent=st.text;
  document.getElementById('tour-next').textContent=i===TOUR.length-1?'Bitti':'Ileri';
  tourCard.classList.remove('step-in'); void tourCard.offsetWidth; tourCard.classList.add('step-in');
  placeTour();
  document.getElementById('tour-next').focus();
}
function startTour(){
  if(tourOn||counting||rec) return;
  tourOn=true; hideNotif();
  tourEl.style.display='block';
  tourSpot.style.transition='none';
  showStep(0).then(()=>requestAnimationFrame(()=>{ tourSpot.style.transition=''; }));
}
function endTour(){
  if(!tourOn) return;
  tourOn=false; tourEl.style.display='none';
  try{ localStorage.setItem('esp_tour','1'); }catch(e){}
  setPanel(!narrow());
}
document.getElementById('tour-next').onclick=()=>{ tourI<TOUR.length-1 ? showStep(tourI+1) : endTour(); };
document.getElementById('tour-skip').onclick=endTour;
document.getElementById('tour-btn').onclick=startTour;
window.addEventListener('resize',()=>{ if(tourOn) placeTour(); });
document.addEventListener('keydown',e=>{
  if(!tourOn) return;
  if(e.key==='Escape'){ endTour(); return; }
  if(e.key==='Tab'){
    const a=document.getElementById('tour-skip'), b=document.getElementById('tour-next');
    if(!tourCard.contains(document.activeElement)){ e.preventDefault(); b.focus(); }
    else if(e.shiftKey && document.activeElement===a){ e.preventDefault(); b.focus(); }
    else if(!e.shiftKey && document.activeElement===b){ e.preventDefault(); a.focus(); }
  }
});
function tourSeen(){ try{ return localStorage.getItem('esp_tour')==='1'; }catch(e){ return false; } }
function maybeStartTour(delay){ if(!tourSeen()) setTimeout(startTour, delay); }
document.getElementById('rec-btn').onclick=()=>{ rec?stopRec():startRec(); };
document.getElementById('prev-save').onclick=saveCapture;
document.getElementById('prev-close').onclick=hidePreview;
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.getElementById('prev').style.display!=='none') hidePreview();
});

const _rgb={};
function rgb(h){
  if(_rgb[h]) return _rgb[h];
  return (_rgb[h]=`${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`);
}
function vis(l){ return l.visibility??1; }
function px(l,r){ return r.x + l.x*r.w; }
function py(l,r){ return r.y + l.y*r.h; }

function ln(x1,y1,x2,y2,col,g,lw){
  ctx.lineWidth=lw+2; ctx.strokeStyle=`rgba(${g},0.28)`;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  ctx.lineWidth=lw; ctx.strokeStyle=col;
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
}
function dot(x,y,r2,col){ ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x,y,r2,0,Math.PI*2); ctx.fill(); }

function drawPose(lms,r){
  const c=bodyColor, g=rgb(c);
  const lw=parseInt(document.getElementById('thick').value);
  const VIS=0.35;

  if(opt.bones){
    let ci=0;
    for(const[a,b] of POSE_CONN){
      const idx=ci++;
      if(!opt.head&&(FACE_IDX.has(a)||FACE_IDX.has(b))) continue;
      const la=lms[a],lb=lms[b];
      if(vis(la)<VIS||vis(lb)<VIS) continue;
      const cc=bodyRgb?hueCol(idx):c;
      ln(px(la,r),py(la,r),px(lb,r),py(lb,r),cc,bodyRgb?rgb(cc):g,lw);
    }
    const ls=lms[11],rs=lms[12],lh=lms[23],rh=lms[24],lk=lms[25],rk=lms[26];
    if(vis(ls)>VIS&&vis(rs)>VIS&&vis(lh)>VIS&&vis(rh)>VIS){
      const sx=r.x+(ls.x+rs.x)/2*r.w, sy=r.y+(ls.y+rs.y)/2*r.h;
      const hx=r.x+(lh.x+rh.x)/2*r.w, hy=r.y+(lh.y+rh.y)/2*r.h;
      const c1=bodyRgb?hueCol(ci):c, c2=bodyRgb?hueCol(ci+1):c, c3=bodyRgb?hueCol(ci+2):c;
      ln(sx,sy,hx,hy,c1,rgb(c1),lw);
      if(vis(lk)>VIS) ln(hx,hy,px(lk,r),py(lk,r),c2,rgb(c2),lw);
      if(vis(rk)>VIS) ln(hx,hy,px(rk,r),py(rk,r),c3,rgb(c3),lw);
    }
  }

  if(opt.joints){
    for(let i=0;i<lms.length;i++){
      if(SKIP_JOINT.has(i)) continue;
      if(!opt.head&&FACE_IDX.has(i)) continue;
      const l=lms[i]; if(vis(l)<VIS) continue;
      dot(px(l,r),py(l,r),lw+1,bodyRgb?hueCol(i):c);
    }
  }

  if(opt.head){
    const nose=lms[0];
    if(vis(nose)>VIS){
      ctx.lineWidth=1; ctx.strokeStyle=c;
      ctx.beginPath(); ctx.arc(px(nose,r),py(nose,r),r.h*0.022,0,Math.PI*2); ctx.stroke();
    }
  }

  if(opt.headbox){
    let hx1=Infinity,hy1=Infinity,hx2=-Infinity,hy2=-Infinity;
    for(const i of FACE_IDX){
      const l=lms[i]; if(vis(l)<0.2) continue;
      const x=px(l,r),y=py(l,r);
      if(x<hx1)hx1=x; if(y<hy1)hy1=y; if(x>hx2)hx2=x; if(y>hy2)hy2=y;
    }
    if(hx1!==Infinity) cornerBox(hx1-10,hy1-10,hx2+10,hy2+10,c,14,1);
  }
}

function drawHands(hr,poses,r){
  const c=handColor, g=rgb(c);
  const lw=parseInt(document.getElementById('thick').value);
  for(const lms of hr.landmarks){
    const hw=lms[0];
    let pw=null, bd=0.04;
    for(const p of poses){
      for(const w of [p[15],p[16]]){
        const d=(w.x-hw.x)**2+(w.y-hw.y)**2;
        if(d<bd){ bd=d; pw=w; }
      }
    }
    if(pw && (pw.visibility??1)>0.2) ln(px(pw,r),py(pw,r),px(hw,r),py(hw,r),c,g,lw);
    HAND_CONN.forEach(([a,b],i)=>{
      const cc=handRgb?hueCol(i):c;
      ln(px(lms[a],r),py(lms[a],r),px(lms[b],r),py(lms[b],r),cc,handRgb?rgb(cc):g,lw);
    });
    lms.forEach((l,i)=>dot(px(l,r),py(l,r),lw,handRgb?hueCol(i):c));
  }
}

function drawHealth(lms,r){
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const l of lms){
    if(vis(l)<0.35) continue;
    const x=px(l,r), y=py(l,r);
    if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y;
  }
  if(x1===Infinity) return;
  const p=14, M=ctx.getTransform(), s=Math.hypot(M.a,M.b)||1;
  let sx1=Infinity,sy1=Infinity,sx2=-Infinity,sy2=-Infinity;
  for(const [cx,cy] of [[x1-p,y1-p],[x2+p,y1-p],[x1-p,y2+p],[x2+p,y2+p]]){
    const X=M.a*cx+M.c*cy+M.e, Y=M.b*cx+M.d*cy+M.f;
    if(X<sx1)sx1=X; if(X>sx2)sx2=X; if(Y<sy1)sy1=Y; if(Y>sy2)sy2=Y;
  }
  const H=sy2-sy1, barW=7*s, gap=10*s;
  if(H<24*s) return;
  let bx=sx1-gap-barW;
  if(bx<4*s) bx=sx2+gap;
  const hp=Math.max(0,Math.min(1,healthVal/100));
  const col=hp>0.6?'#46d38a':hp>0.3?'#e8c14a':'#e8544f';

  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle='rgba(0,0,0,0.6)';
  ctx.fillRect(bx-2*s, sy1-2*s, barW+4*s, H+4*s);
  ctx.fillStyle=col;
  ctx.fillRect(bx, sy2-H*hp, barW, H*hp);
  ctx.fillStyle='rgba(0,0,0,0.75)';
  for(let i=1;i<10;i++) ctx.fillRect(bx, sy1+H*i/10-0.5*s, barW, Math.max(1,s));
  ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=Math.max(1,s);
  ctx.strokeRect(bx-2*s, sy1-2*s, barW+4*s, H+4*s);
  ctx.font=`700 ${Math.round(10*s)}px 'JetBrains Mono', monospace`;
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillStyle='#fff'; ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=4*s;
  ctx.fillText(String(Math.round(healthVal)), bx+barW/2, sy1-5*s);
  ctx.restore();
}

const PINCH_ON=0.30, PINCH_KEEP=0.50, PALM_UP_ON=0.60, PALM_UP_KEEP=0.45, PINCH_HOLD_MS=500, PINCH_COOLDOWN_MS=3000;
const gesture={ since:0, armed:true, cool:0, x:0, y:0, prog:0 };

function resetGesture(){ gesture.since=0; gesture.prog=0; gesture.armed=true; }

function updateGesture(h, asp){
  const blocked = !opt.gesture || counting || tourOn || rec || document.getElementById('prev').style.display!=='none';
  if(blocked){ resetGesture(); return; }
  const holding = gesture.since>0;
  const ux = rotated ? 1 : 0, uy = rotated ? 0 : -1;
  const labels = h.handedness || h.handednesses || [];
  let hit=null;
  for(let i=0;i<h.landmarks.length;i++){
    const L=h.landmarks[i];
    const P=j=>({ x:L[j].x, y:L[j].y/asp, z:L[j].z||0 });
    const d3=(a,b)=>Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
    const p0=P(0), p4=P(4), p5=P(5), p8=P(8), p9=P(9), p17=P(17);
    const size=Math.max(d3(p0,p9), d3(p5,p17)*1.6);
    if(size<0.02) continue;
    const pinch=d3(p4,p8)/size;
    const a={ x:p5.x-p0.x, y:p5.y-p0.y, z:p5.z-p0.z }, b={ x:p17.x-p0.x, y:p17.y-p0.y, z:p17.z-p0.z };
    const n={ x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x };
    const nl=Math.hypot(n.x,n.y,n.z);
    if(nl<1e-7) continue;
    const upDot=(n.x*ux+n.y*uy)/nl;
    const lab=labels[i]&&labels[i][0]&&labels[i][0].categoryName;
    const palmUp = lab ? (lab==='Left' ? upDot : -upDot) : Math.abs(upDot);
    if(pinch<(holding?PINCH_KEEP:PINCH_ON) && palmUp>(holding?PALM_UP_KEEP:PALM_UP_ON)){ hit=L; break; }
  }
  const now=performance.now();
  if(!hit){ resetGesture(); return; }
  if(!gesture.since) gesture.since=now;
  gesture.x=(hit[4].x+hit[8].x)/2; gesture.y=(hit[4].y+hit[8].y)/2;
  gesture.prog=Math.min(1,(now-gesture.since)/PINCH_HOLD_MS);
  if(gesture.prog>=1 && gesture.armed && now>gesture.cool){
    gesture.armed=false; gesture.cool=now+PINCH_COOLDOWN_MS;
    beep(880,90); buzz(60);
    photoClick();
  }
}

function drawPinchRing(r){
  if(gesture.prog<=0) return;
  const x=px(gesture,r), y=py(gesture,r), rad=22;
  ctx.lineWidth=3; ctx.lineCap='round';
  ctx.strokeStyle='rgba(255,255,255,0.25)';
  ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='#f2f2f4';
  ctx.beginPath(); ctx.arc(x,y,rad,-Math.PI/2,-Math.PI/2+Math.PI*2*gesture.prog); ctx.stroke();
  ctx.lineCap='butt';
}

function drawBox(lms,r){
  const p=14;
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const l of lms){
    if(vis(l)<0.35) continue;
    const x=px(l,r), y=py(l,r);
    if(x<x1) x1=x; if(y<y1) y1=y; if(x>x2) x2=x; if(y>y2) y2=y;
  }
  if(x1===Infinity) return;
  x1-=p; y1-=p; x2+=p; y2+=p;
  if(opt.boxStyle==='full'){
    ctx.lineWidth=1; ctx.strokeStyle=bodyColor; ctx.strokeRect(x1,y1,x2-x1,y2-y1);
  }else{
    cornerBox(x1,y1,x2,y2,bodyColor,22,2);
  }
}

function cornerBox(x1,y1,x2,y2,c,seg,lw){
  ctx.lineWidth=lw; ctx.strokeStyle=c;
  for(const[[cx,cy],[dx,dy]] of [[[x1,y1],[1,1]],[[x2,y1],[-1,1]],[[x1,y2],[1,-1]],[[x2,y2],[-1,-1]]]){
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+dx*seg,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy+dy*seg); ctx.stroke();
  }
}

function drawLineOverlay(lms,r,vw,vh){
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  for(const l of lms){
    if(vis(l)<0.35) continue;
    const x=px(l,r), y=py(l,r);
    if(x<x1)x1=x; if(y<y1)y1=y; if(x>x2)x2=x; if(y>y2)y2=y;
  }
  if(x1===Infinity) return;
  const cx=(x1+x2)/2, cy=(y1+y2)/2;
  const c=bodyColor;
  ctx.strokeStyle=`rgba(${rgb(c)},0.35)`;
  ctx.lineWidth=1; ctx.setLineDash([6,6]);
  if(opt.lines.top)  { ctx.beginPath(); ctx.moveTo(0,y1); ctx.lineTo(vw,y1); ctx.stroke(); }
  if(opt.lines.mid)  { ctx.beginPath(); ctx.moveTo(0,cy); ctx.lineTo(vw,cy); ctx.stroke(); }
  if(opt.lines.bot)  { ctx.beginPath(); ctx.moveTo(0,y2); ctx.lineTo(vw,y2); ctx.stroke(); }
  if(opt.lines.vctr) { ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,vh); ctx.stroke(); }
  ctx.setLineDash([]);
  if(opt.lines.snap){
    ctx.strokeStyle=c; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(vw/2,vh); ctx.lineTo(cx,cy); ctx.stroke();
    dot(cx,cy,5,c);
  }
}

const TOG_MAP = {bones:'t-bones',joints:'t-joints',head:'t-head',headbox:'t-headbox',hands:'t-hands',box:'t-box',fps:'t-fps',health:'t-health',gesture:'t-gesture'};

function setToggle(k,v){
  opt[k]=v;
  const el=document.getElementById(TOG_MAP[k]);
  if(!el) return;
  el.textContent=v?'ON':'OFF'; el.className='tog '+(v?'on':'off');
  if(k==='box') document.getElementById('bs-row').style.display=v?'flex':'none';
}
function tog(k){ setToggle(k,!opt[k]); scheduleSave(); }

function setLine(k,v){
  opt.lines[k]=v;
  const el=document.getElementById('lt-'+k);
  el.textContent=v?'ON':'OFF'; el.className='tog '+(v?'on':'off');
}
function togLine(k){ setLine(k,!opt.lines[k]); scheduleSave(); }

document.getElementById('lines-hdr').onclick=()=>{
  const m=document.getElementById('lines-menu'), a=document.getElementById('lines-arr');
  m.classList.toggle('open'); a.classList.toggle('open',m.classList.contains('open'));
};
document.getElementById('lo-top').onclick  = ()=>togLine('top');
document.getElementById('lo-mid').onclick  = ()=>togLine('mid');
document.getElementById('lo-bot').onclick  = ()=>togLine('bot');
document.getElementById('lo-vctr').onclick = ()=>togLine('vctr');
document.getElementById('lo-snap').onclick = ()=>togLine('snap');

['bones','joints','head','headbox','hands','box','fps','health','gesture'].forEach(k=>{
  document.getElementById('t-'+k).onclick = ()=>tog(k);
});
function setHealth(v){
  healthVal = Math.min(100, Math.max(1, parseInt(v)||100));
  document.getElementById('hp').value = healthVal;
  document.getElementById('hp-v').textContent = healthVal;
}
document.getElementById('hp').oninput = e => { setHealth(e.target.value); scheduleSave(); };

function setThick(v){
  const n = Math.min(6, Math.max(1, parseInt(v)||2));
  document.getElementById('thick').value = n;
  document.getElementById('thick-v').textContent = n;
}
document.getElementById('thick').addEventListener('input', e=>{ setThick(e.target.value); scheduleSave(); });

function setBS(s){
  opt.boxStyle=s;
  document.getElementById('bs-c').style.color=s==='corners'?'var(--text)':'var(--mute)';
  document.getElementById('bs-f').style.color=s==='full'?'var(--text)':'var(--mute)';
  scheduleSave();
}
document.getElementById('bs-c').onclick=()=>setBS('corners');
document.getElementById('bs-f').onclick=()=>setBS('full');

const panelEl = document.getElementById('panel');
[...panelEl.querySelector('.ps').children].forEach((el,i)=>el.style.setProperty('--i', Math.min(i,16)));
let panelAnimT=0;
function animatePanel(){
  panelEl.classList.remove('panel-in');
  void panelEl.offsetWidth;
  panelEl.classList.add('panel-in');
  clearTimeout(panelAnimT);
  panelAnimT=setTimeout(()=>panelEl.classList.remove('panel-in'), 900);
}

if(!panelOpen){
  document.getElementById('panel').classList.add('hidden');
  document.getElementById('menu-btn').classList.add('poff');
  document.getElementById('menu-btn').setAttribute('aria-expanded','false');
}else{
  animatePanel();
}

function setPanel(open){
  if(open===panelOpen) return;
  panelOpen=open;
  panelEl.classList.toggle('hidden',!open);
  document.getElementById('menu-btn').classList.toggle('poff',!open);
  document.getElementById('menu-btn').setAttribute('aria-expanded', open?'true':'false');
  if(open) animatePanel();
}
document.getElementById('menu-btn').onclick=()=>setPanel(!panelOpen);
document.querySelector('.ph-x').onclick=()=>setPanel(false);
updateTimerBtn();

const swEls = { body:[], hand:[] };
let bodyIdx = 0, handIdx = 1;
function buildSwatches(){
  function make(id,key,apply,activeIdx){
    const el=document.getElementById(id);
    const pick=s=>{ el.querySelectorAll('.sw').forEach(x=>x.classList.remove('on')); s.classList.add('on'); };
    PALETTE.forEach((hex,i)=>{
      const s=document.createElement('div');
      s.className='sw'+(i===activeIdx?' on':'');
      s.style.background=hex; s.title=hex;
      s.onclick=()=>{ apply(i); pick(s); scheduleSave(); };
      el.appendChild(s); swEls[key].push(s);
    });
    const r=document.createElement('div');
    r.className='sw sw-rgb'; r.title='RGB (renk dongusu)';
    r.onclick=()=>{ apply(PALETTE.length); pick(r); scheduleSave(); };
    el.appendChild(r); swEls[key].push(r);
  }
  make('body-sw','body', i=>{ bodyIdx=i; bodyRgb=(i===PALETTE.length); if(!bodyRgb) bodyColor=PALETTE[i]; }, 0);
  make('hand-sw','hand', i=>{ handIdx=i; handRgb=(i===PALETTE.length); if(!handRgb) handColor=PALETTE[i]; }, 1);
}
buildSwatches();

const SETTINGS_KEY='esp_settings_v1';
const TOG_KEYS=['bones','joints','head','headbox','hands','box','fps','health','gesture'];
const LINE_KEYS=['top','mid','bot','vctr','snap'];
let saveT=0, applying=false, settingsReady=false;

function collectSettings(forShare){
  const s={
    t:{}, l:{}, bs:opt.boxStyle,
    thick:parseInt(document.getElementById('thick').value),
    ppl:numPeople, hp:healthVal, body:bodyIdx, hand:handIdx, q:quality,
  };
  TOG_KEYS.forEach(k=>s.t[k]=opt[k]);
  LINE_KEYS.forEach(k=>s.l[k]=opt.lines[k]);
  if(!forShare){ s.timer=timerIdx; s.rot=rotated; }
  return s;
}

function sanitizeSettings(r){
  const s={}, num=(v,a,b)=>{ v=parseInt(v); return Number.isFinite(v)&&v>=a&&v<=b ? v : undefined; };
  if(!r||typeof r!=='object') return s;
  if(r.t&&typeof r.t==='object'){ s.t={}; TOG_KEYS.forEach(k=>{ if(typeof r.t[k]==='boolean') s.t[k]=r.t[k]; }); }
  if(r.l&&typeof r.l==='object'){ s.l={}; LINE_KEYS.forEach(k=>{ if(typeof r.l[k]==='boolean') s.l[k]=r.l[k]; }); }
  if(r.bs==='corners'||r.bs==='full') s.bs=r.bs;
  if(r.q==='lite'||r.q==='full') s.q=r.q;
  if(typeof r.rot==='boolean') s.rot=r.rot;
  const set=(key,v)=>{ if(v!==undefined) s[key]=v; };
  set('thick',num(r.thick,1,6));
  set('ppl',num(r.ppl,1,MAX_PEOPLE));
  set('hp',num(r.hp,1,100));
  set('body',num(r.body,0,PALETTE.length));
  set('hand',num(r.hand,0,PALETTE.length));
  set('timer',num(r.timer,0,TIMER_STEPS.length-1));
  return s;
}

function applySettings(s){
  applying=true;
  try{
    if(s.t) TOG_KEYS.forEach(k=>{ if(k in s.t) setToggle(k,s.t[k]); });
    if(s.l) LINE_KEYS.forEach(k=>{ if(k in s.l) setLine(k,s.l[k]); });
    if(s.bs) setBS(s.bs);
    if(s.thick!==undefined) setThick(s.thick);
    if(s.ppl!==undefined) setPeople(s.ppl);
    if(s.hp!==undefined) setHealth(s.hp);
    if(s.body!==undefined) swEls.body[s.body].click();
    if(s.hand!==undefined) swEls.hand[s.hand].click();
    if(s.q) setQuality(s.q);
    if(s.timer!==undefined){ timerIdx=s.timer; updateTimerBtn(); }
    if(s.rot!==undefined) setRotated(s.rot);
  }finally{ applying=false; }
}

function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(collectSettings(false))); }catch(e){}
}
function scheduleSave(){
  if(!settingsReady||applying) return;
  clearTimeout(saveT);
  saveT=setTimeout(saveSettings,250);
}

const b64e=s=>btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64d=s=>atob(s.replace(/-/g,'+').replace(/_/g,'/'));
setBS('corners');
const defaultSettings = collectSettings(false);

function loadSettings(){
  let s=null, shared=false;
  const m=/[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
  if(m){
    try{ s=sanitizeSettings(JSON.parse(b64d(m[1]))); shared=true; }catch(e){ s=null; }
    try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
  }
  if(!s){
    try{ const raw=localStorage.getItem(SETTINGS_KEY); if(raw) s=sanitizeSettings(JSON.parse(raw)); }catch(e){}
  }
  if(s) applySettings(s);
  settingsReady=true;
  if(shared) notify('ok','Ayarlar uygulandı','Paylasılan ayarlar yuklendi. Bir seyi degistirirsen bu cihazda kalır.',5000);
}

async function shareSettings(){
  const url=location.origin+location.pathname+'#s='+b64e(JSON.stringify(collectSettings(true)));
  if(navigator.share && matchMedia('(pointer:coarse)').matches){
    try{ await navigator.share({ title:'ESP Pose ayarlarım', url }); return; }
    catch(e){ if(e.name==='AbortError') return; }
  }
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(url);
      notify('ok','Link kopyalandı','Ayarlar linkin icinde. Kime atarsan aynı ayarlarla acılır.');
      return;
    }
  }catch(e){}
  const ta=document.createElement('textarea');
  ta.value=url; ta.setAttribute('readonly',''); ta.style.cssText='position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok=document.execCommand('copy'); }catch(e){}
  ta.remove();
  if(ok) notify('ok','Link kopyalandı','Ayarlar linkin icinde. Kime atarsan aynı ayarlarla acılır.');
  else notify('error','Link kopyalanamadı','Tarayıcı panoya izin vermedi. Siteyi https:// ile acıp tekrar dene.');
}

function resetSettings(){
  clearTimeout(saveT);
  try{ localStorage.removeItem(SETTINGS_KEY); }catch(e){}
  applySettings(defaultSettings);
  notify('ok','Ayarlar sıfırlandı','Hepsi eski haline dondu.',4000);
}
document.getElementById('share-btn').onclick=shareSettings;
document.getElementById('reset-btn').onclick=resetSettings;

loadSettings();
updateQualityBtn();
checkPermission();
