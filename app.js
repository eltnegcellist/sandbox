const DEFAULT_FORTUNES=["吉", "小吉", "中吉", "吉", "末吉", "小吉", "大吉", "吉", "小吉", "中吉", "吉", "末吉", "凶", "大凶"];
const fortuneIcons={"大吉":"🌟","中吉":"✨","小吉":"🍀","吉":"🎈","末吉":"🌸","凶":"☁️","大凶":"⚡"};
const fortuneColors={"大吉":"#b40000","中吉":"#b85d00","小吉":"#28752c","吉":"#754600","末吉":"#8b5f00","凶":"#56616c","大凶":"#4b2b7f"};
const fortuneMessages={
  "大吉":"今日は特別ないい日。笑顔で過ごすとさらに運気アップ！",
  "中吉":"いい流れの日。落ち着いて進めばいいことがありそう。",
  "小吉":"小さな幸せを見つけられる日。やさしい気持ちで。",
  "吉":"安定したいい日。いつも通りがいちばんの近道です。",
  "末吉":"これからじわっと上向き。あせらずゆっくりいこう。",
  "凶":"今日は慎重めで。無理せず、のんびりが吉です。",
  "大凶":"ひと休みの日。深呼吸して、気楽にいきましょう。"
};

const $=id=>document.getElementById(id);
const fileInput=$("fileInput"), extractBtn=$("extractBtn"), frameCountEl=$("frameCount");
const progressWrap=$("progressWrap"), progressBar=$("progressBar"), progressText=$("progressText");
const previewSection=$("previewSection"), grid=$("grid"), titleInput=$("titleInput");
const playBtn=$("playBtn"), saveBtn=$("saveBtn"), library=$("library"), playSection=$("playSection");
const stage=$("stage"), playImage=$("playImage"), fortuneBadge=$("fortuneBadge"), resultCard=$("resultCard");
const resultText=$("resultText"), message=$("message"), rouletteBadge=$("rouletteBadge"), tapHint=$("tapHint");
const video=$("video"), captureCanvas=$("captureCanvas"), smallCanvas=$("smallCanvas");
const ctx=captureCanvas.getContext("2d",{willReadFrequently:true}), sctx=smallCanvas.getContext("2d",{willReadFrequently:true});
const startOverlay=$("startOverlay"), startTitle=$("startTitle"), primeBtn=$("primeBtn"), bigOverlay=$("bigOverlay");

let objectUrl=null, candidates=[], selectedFrames=[], selectedMode="omikuji";
let activeCreation=null, running=false, timer=null, currentIndex=0, primed=false;

document.querySelectorAll(".mode").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".mode").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active"); selectedMode=btn.dataset.mode;
}));

fileInput.addEventListener("change",()=>{extractBtn.disabled=!fileInput.files?.length;previewSection.style.display="none"});

function once(target,event,timeout=6000){
  return new Promise((resolve,reject)=>{
    let done=false;
    const fn=()=>{if(done)return;done=true;clearTimeout(to);target.removeEventListener(event,fn);resolve()};
    const to=setTimeout(()=>{if(done)return;done=true;target.removeEventListener(event,fn);reject(new Error(event+" timeout"))},timeout);
    target.addEventListener(event,fn,{once:true});
  });
}
async function loadVideo(file){
  if(objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl=URL.createObjectURL(file); video.src=objectUrl; video.load();
  if(video.readyState<1) await once(video,"loadedmetadata",10000);
  if(!isFinite(video.duration)||video.duration<=0) throw new Error("動画の長さを取得できません");
}
async function seekTo(t){
  const safe=Math.max(0,Math.min(video.duration-.04,t));
  if(Math.abs(video.currentTime-safe)>.02){video.currentTime=safe;try{await once(video,"seeked",6000)}catch(e){}}
  await new Promise(r=>setTimeout(r,35));
}
function setupCanvas(){
  const maxW=420, scale=Math.min(1,maxW/video.videoWidth);
  captureCanvas.width=Math.max(2,Math.round(video.videoWidth*scale));
  captureCanvas.height=Math.max(2,Math.round(video.videoHeight*scale));
}
function descriptorAndQuality(){
  const w=captureCanvas.width,h=captureCanvas.height,cw=Math.round(w*.68),ch=Math.round(h*.68);
  const sx=Math.round((w-cw)/2),sy=Math.round((h-ch)/2);
  sctx.drawImage(captureCanvas,sx,sy,cw,ch,0,0,28,28);
  const d=sctx.getImageData(0,0,28,28).data,gray=new Float32Array(784);
  let mean=0,sharp=0;
  for(let i=0,p=0;i<d.length;i+=4,p++){const g=d[i]*.299+d[i+1]*.587+d[i+2]*.114;gray[p]=g;mean+=g}
  mean/=gray.length;
  for(let y=1;y<27;y++)for(let x=1;x<27;x++){const p=y*28+x,g=gray[p];sharp+=Math.abs(g-gray[p-1])+Math.abs(g-gray[p-28])}
  sharp/=(26*26*2);
  const exposure=1-Math.min(1,Math.abs(mean-128)/128);
  return {desc:Array.from(gray),sharp,quality:sharp*.8+exposure*18};
}
function dist(a,b){let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d}return Math.sqrt(s/a.length)}
async function captureCandidate(time){
  await seekTo(time); ctx.drawImage(video,0,0,captureCanvas.width,captureCanvas.height);
  const q=descriptorAndQuality();
  return {time,dataUrl:captureCanvas.toDataURL("image/jpeg",.84),...q};
}
function chooseDiverse(list,n){
  if(list.length<=n)return list.slice().sort((a,b)=>a.time-b.time);
  const ranked=[...list].sort((a,b)=>b.quality-a.quality),chosen=[ranked[0]],rem=list.filter(x=>x!==ranked[0]);
  while(chosen.length<n&&rem.length){
    let bi=0,bs=-1e9;
    for(let i=0;i<rem.length;i++){
      let md=1e9;for(const s of chosen)md=Math.min(md,dist(rem[i].desc,s.desc));
      const score=md*1.7+rem[i].quality*.28;
      if(score>bs){bs=score;bi=i}
    }
    chosen.push(rem.splice(bi,1)[0]);
  }
  return chosen.sort((a,b)=>a.time-b.time);
}
async function extract(){
  const file=fileInput.files?.[0]; if(!file)return;
  extractBtn.disabled=true; progressWrap.style.display="block"; previewSection.style.display="none";
  try{
    await loadVideo(file); setupCanvas();
    const target=Number(frameCountEl.value), sampleCount=Math.min(72,Math.max(target*4,Math.ceil(video.duration*2.5)));
    const start=Math.min(.15,video.duration*.02),end=Math.max(start,video.duration-.08),times=[];
    for(let i=0;i<sampleCount;i++)times.push(start+(end-start)*(sampleCount===1?0:i/(sampleCount-1)));
    candidates=[];
    for(let i=0;i<times.length;i++){
      progressText.textContent=`候補を確認中... ${i+1}/${times.length}`;
      progressBar.style.width=(5+75*i/times.length)+"%";
      candidates.push(await captureCandidate(times[i]));
    }
    const sorted=[...candidates].sort((a,b)=>a.time-b.time),filtered=[];
    for(const c of sorted){
      if(c.sharp<4)continue;
      const prev=filtered[filtered.length-1];
      if(prev&&dist(c.desc,prev.desc)<4.2){if(c.quality>prev.quality)filtered[filtered.length-1]=c}else filtered.push(c);
    }
    selectedFrames=chooseDiverse(filtered.length>=target?filtered:sorted,target);
    progressBar.style.width="100%";progressText.textContent=`${selectedFrames.length}枚を選びました`;
    renderGrid(); previewSection.style.display="block"; previewSection.scrollIntoView({behavior:"smooth"});
  }catch(e){alert("動画を処理できませんでした: "+e.message)}
  finally{extractBtn.disabled=false}
}
function renderGrid(){
  grid.innerHTML="";
  selectedFrames.forEach((f,i)=>{
    const d=document.createElement("div");d.className="thumb";
    d.innerHTML=`<img src="${f.dataUrl}"><span>${i+1} / ${f.time.toFixed(1)}s</span>`;grid.appendChild(d);
  });
}
extractBtn.addEventListener("click",extract);

function currentCreation(){
  const fortunes=selectedFrames.map((_,i)=>DEFAULT_FORTUNES[i%DEFAULT_FORTUNES.length]);
  return {id:crypto.randomUUID?crypto.randomUUID():"r"+Date.now(),title:titleInput.value.trim()||"赤ちゃんルーレット",
    createdAt:Date.now(),mode:selectedMode,frames:selectedFrames.map(f=>f.dataUrl),fortunes};
}

const DBNAME="babyExpressionRouletteDB",STORE="creations";
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DBNAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:"id"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function dbPut(x){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(x);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function dbAll(){const db=await openDB();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result.sort((a,b)=>b.createdAt-a.createdAt));r.onerror=()=>rej(r.error)})}
async function dbDelete(id){const db=await openDB();return new Promise((res,rej)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)})}
async function refreshLibrary(){
  const all=await dbAll();library.innerHTML="";
  if(!all.length){library.innerHTML='<div class="note">まだ保存されていません。</div>';return}
  all.forEach(x=>{
    const el=document.createElement("div");el.className="saved";
    el.innerHTML=`<img src="${x.frames[0]}"><div class="savedMain"><div class="savedTitle"></div><div class="savedMeta">${x.mode==="omikuji"?"おみくじ":"表情ルーレット"} ・ ${new Date(x.createdAt).toLocaleDateString("ja-JP")}</div><div class="savedBtns"><button class="primary open">遊ぶ</button><button class="danger del">削除</button></div></div>`;
    el.querySelector(".savedTitle").textContent=x.title;
    el.querySelector(".open").onclick=()=>preparePlay(x);
    el.querySelector(".del").onclick=async()=>{if(confirm("削除しますか？")){await dbDelete(x.id);refreshLibrary()}};
    library.appendChild(el);
  });
}
saveBtn.addEventListener("click",async()=>{if(!selectedFrames.length)return;const x=currentCreation();await dbPut(x);await refreshLibrary();alert("この端末に保存しました")});
playBtn.addEventListener("click",()=>{if(selectedFrames.length)preparePlay(currentCreation())});

function preparePlay(x){
  activeCreation=x;primed=false;running=false;clearInterval(timer);
  playSection.style.display="block";
  startTitle.textContent=x.mode==="omikuji"?"赤ちゃんおみくじ":"表情ルーレット";
  startOverlay.classList.add("show");
  fortuneBadge.style.display="none";resultCard.style.display="none";
  rouletteBadge.style.display="block";rouletteBadge.textContent="タップでストップ";
  playImage.src=x.frames[0];playSection.scrollIntoView({behavior:"smooth"});
}
let audioCtx=null;
function ensureAudio(){
  if(!audioCtx){
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(Ctx) audioCtx=new Ctx();
  }
  if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
  return !!audioCtx;
}
function tone(freq,dur,when=0,vol=.09,type='triangle'){
  if(!audioCtx||audioCtx.state!=='running') return;
  const now=audioCtx.currentTime+when, osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
  osc.type=type; osc.frequency.setValueAtTime(freq,now);
  gain.gain.setValueAtTime(.0001,now);
  gain.gain.exponentialRampToValueAtTime(vol,now+.015);
  gain.gain.exponentialRampToValueAtTime(.0001,now+dur);
  osc.connect(gain).connect(audioCtx.destination); osc.start(now); osc.stop(now+dur+.03);
}
function playSound(name){
  if(!primed||!ensureAudio()) return;
  const seq={
    start:[[523,.14,0],[659,.16,.10],[784,.22,.22]],
    '吉':[[523,.20,0],[659,.24,.13],[784,.34,.30],[1047,.48,.48]],
    '小吉':[[587,.20,0],[698,.24,.13],[784,.34,.30],[988,.48,.48]],
    '中吉':[[659,.20,0],[784,.24,.13],[988,.34,.30],[1175,.50,.48]],
    '末吉':[[494,.20,0],[587,.24,.13],[698,.34,.30],[784,.48,.48]],
    '凶':[[466,.28,0],[415,.34,.22],[370,.48,.48]],
    '大凶':[[392,.30,0],[349,.38,.24],[311,.56,.55]],
    '大吉':[[523,.18,0],[659,.20,.10],[784,.22,.22],[1047,.28,.36],[1319,.34,.54],[1568,.48,.78]]
  }[name]||[[660,.2,0]];
  seq.forEach(([f,d,w])=>tone(f,d,w,name==='大吉'?.13:.09,name==='凶'||name==='大凶'?'sawtooth':'triangle'));
  if(name==='大吉'){
    tone(523,.95,1.05,.07,'sine');tone(659,.95,1.05,.07,'sine');tone(784,.95,1.05,.07,'sine');
  }
}
function startRun(withSound=true){
  running=true;stage.classList.add("pulse");rouletteBadge.textContent="タップでストップ";tapHint.textContent="画像をタップすると止まります";
  fortuneBadge.style.display="none";resultCard.style.display="none";
  showRandom();clearInterval(timer);timer=setInterval(showRandom,75);
  if(withSound)playSound("start");
}
function showRandom(){
  const arr=activeCreation.frames;if(!arr?.length)return;
  let n=currentIndex;while(arr.length>1&&n===currentIndex)n=Math.floor(Math.random()*arr.length);
  currentIndex=n;playImage.src=arr[n];
}
function stopRun(){
  running=false;clearInterval(timer);timer=null;stage.classList.remove("pulse");
  if(activeCreation.mode==="omikuji"){
    const f=activeCreation.fortunes[currentIndex]||"吉";
    fortuneBadge.style.display="block";fortuneBadge.textContent=(fortuneIcons[f]||"🎴")+" "+f;fortuneBadge.style.color=fortuneColors[f]||"#700";
    resultCard.style.display="block";resultText.textContent=f;resultText.style.color=fortuneColors[f]||"#700";message.textContent=fortuneMessages[f]||"";
    rouletteBadge.style.display="none";
    if(f==="大吉")celebrate();else playSound(f);
  }else{
    rouletteBadge.style.display="block";rouletteBadge.textContent="この表情！";playSound("吉");
  }
  tapHint.textContent="もう一度タップすると再開します";
}
function celebrate(){
  bigOverlay.classList.remove("show");void bigOverlay.offsetWidth;bigOverlay.classList.add("show");
  const pal=["#ffd700","#fff0a0","#fff","#ff5a61","#ff9d00"];
  for(let i=0;i<90;i++){const e=document.createElement("div");e.className="confetti";e.style.left=Math.random()*100+"vw";e.style.width=7+Math.random()*9+"px";e.style.height=10+Math.random()*18+"px";e.style.background=pal[Math.floor(Math.random()*pal.length)];e.style.animationDuration=1.8+Math.random()*1.6+"s";e.style.animationDelay=Math.random()*.3+"s";document.body.appendChild(e);setTimeout(()=>e.remove(),3800)}
  if(navigator.vibrate)navigator.vibrate([100,60,140,70,260]);playSound("大吉");setTimeout(()=>bigOverlay.classList.remove("show"),2500);
}
primeBtn.addEventListener("click",e=>{
  e.preventDefault();e.stopPropagation();
  ensureAudio(); primed=true; playSound('start');
  startOverlay.classList.remove('show'); startRun(false);
});
stage.addEventListener("pointerdown",e=>{e.preventDefault();if(!primed)return;if(running)stopRun();else startRun()},{passive:false});
$("backBtn").addEventListener("click",()=>{clearInterval(timer);running=false;playSection.style.display="none";window.scrollTo({top:0,behavior:"smooth"})});
$("installHelp").addEventListener("click",()=>alert("iPhoneではSafariでこのサイトを開き、共有ボタン →「ホーム画面に追加」を使うとアプリ感覚で使えます。"));

refreshLibrary();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(()=>{});