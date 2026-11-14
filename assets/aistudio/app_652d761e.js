const $=id=>document.getElementById(id),B=document.body;
const esc=t=>String(t).replace(/[&<>"'`]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","`":"&#96;"}[c]));
const clean=t=>String(t==null?"":t).replace(/[<>&"'`\u0000-\u001f]/g,"").trim().slice(0,24);
const newRoom=()=>{const a=new Uint8Array(8);crypto.getRandomValues(a);return Array.from(a,x=>"abcdefghijklmnopqrstuvwxyz0123456789"[x%36]).join("")};
let demo=false,rstream=null,autoSpeak=false,premium=true,oo=null,ttl0="",hist=[],inc=null,incT=0,AC=null,acct=null,trLock=false,cm=0,cmT=null,gift=1,rcv=0,gl=[],owner=false,inv=false,preShown=false,net=null,myName="",iceCache=null,PRICES={},MODE="manual",payView=null,camErr="",waitAcc=null;
const RT={},RQ={},REC=new Set();let shareS=null,wl=null,selfV=false,viewMain=false,floatMe=false,joining=false,unread=0,camP=null,knocks=[],noteT=null,mySlot=0;const ADM=new Set(),HELD={},OKS=new Set();
const P={send:'<path d="M4 12 20 4l-4 16-4.5-6.5Z"/><path d="M11.5 13.5 20 4"/>',invite:'<circle cx="10" cy="9" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M18 8v6M15 11h6"/>',belloff:'<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16"/>',float:'<rect x="3" y="5" width="18" height="14" rx="3"/><rect x="12.5" y="11" width="6" height="5" rx="1.4"/>',wave:'<circle cx="6.5" cy="12" r="1.7"/><path d="M10.5 8.6a5 5 0 0 1 0 6.8M14.2 6a9 9 0 0 1 0 12M18 3.6a13 13 0 0 1 0 16.8"/>',bell:'<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',chat:'<path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 15h-5.5L7.5 19v-4H7a2.5 2.5 0 0 1-2.5-2.5Z"/>',send:'<path d="M20 4 4 11l6 2.5L12.5 20Z"/><path d="m10 13.5 5-5"/>',ban:'<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',mic:'<path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21"/>',cam:'<rect x="3" y="7" width="12.5" height="10" rx="3"/><path d="m15.5 11 5-3v8l-5-3"/>',share:'<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M12 14V8.5m-2.6 2.6L12 8.5l2.6 2.6M8 20.5h8"/>',subs:'<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M7.5 11h4M14 11h2.5M7.5 14.5H10M12.5 14.5h4"/>',leave:'<path d="M13.5 4.2A8.5 8.5 0 1 0 13.5 19.8"/><path d="M10 12h10m-3-3 3 3-3 3"/>',go:'<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h6.5m-2.6-3 3 3-3 3"/>',lock:'<rect x="5.5" y="10.5" width="13" height="9" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',unlock:'<rect x="5.5" y="10.5" width="13" height="9" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.4"/>',ppl:'<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><circle cx="17" cy="10" r="2.3"/><path d="M16.5 14.7c2.2.2 3.6 1.6 4.2 4"/>',hand:'<path d="M8.5 12V6.5a1.5 1.5 0 0 1 3 0V11M11.5 10.5V5a1.5 1.5 0 0 1 3 0v6M14.5 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.5 6-6 6-2.5 0-4-1-5.3-3L4.5 13.2a1.5 1.5 0 0 1 2.4-1.8L8.5 13"/>',shield:'<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',layers:'<path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>',rec:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/>',ok:'<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.4 2.7 2.7 4.9-5.3"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',sig:'<path d="M5 18v-3M10 18v-6M15 18V9M20 18V5"/>',mall:'<path d="M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3Z"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21M4 4l16 16"/>',fit:'<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',grid:'<rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/>'};
const svg=(k,s)=>`<svg viewBox="0 0 24 24" aria-hidden="true">${P[k]}${s?'<path class="sl" d="M4 4l16 16"/>':''}</svg>`;
$("tPe").innerHTML=svg("ppl")+'<span id="cnt"></span><span class="lb">Personas</span>';$("tSu").innerHTML=svg("subs")+'<span class="lb">Traducir</span>';$("tFi").innerHTML=svg("fit")+'<span class="lb">Imagen</span>';$("tGa").innerHTML=svg("grid")+'<span class="lb">Todos</span>';$("tPr").innerHTML=svg("layers")+'<span class="lb">Pruebas</span>';$("bX").innerHTML=svg("x");$("pkX").innerHTML=svg("x");$("pkGo").innerHTML=svg("fit");$("pkWv").innerHTML=svg("wave");$("cs").innerHTML=svg("send");$("iOk").innerHTML=svg("ok");$("iNo").innerHTML=svg("x");$("iBk").innerHTML=svg("ban");$("lk").innerHTML=svg("lock");
$("sm").innerHTML=svg("mic",1);$("sc").innerHTML=svg("cam",1);$("pill").innerHTML=svg("sig")+"Conexión inestable";$("hb").innerHTML=svg("hand");
(function(){const S=Math.max(screen.width||0,screen.height||0,innerWidth,innerHeight)*1.15;
const mk=(n,a)=>Array.from({length:n},()=>`${(Math.random()*S)|0}px ${(Math.random()*S)|0}px 0 0 rgba(223,228,247,${(a*(.5+Math.random()*.5)).toFixed(2)})`).join(",");
[["l1",70,.9],["l2",50,.8],["l3",26,1]].forEach(([c,n,a])=>document.querySelector("."+c).style.boxShadow=mk(n,a));})();
const NAMES=["Kenji","Daniel","Mateo","Omar","Lars","Chen","Noah","Ravi","Luca","Tomás","Kofi","Jonas","Iván","Diego","Pablo","Marco","Samir","Hugo","Alex","Bruno","Amir","Andrés","Takumi","Leo","Rafael","Hassan","Felix","Arjun","Mateus","Emil","Carlos","Yusuf","Nikolai","Ethan","Joaquín","Ibrahim","Sebastián","Rohan","Gael","Oliver"],WN=["Selim","Tariq","Orhan"];
const CI=["Lagos","Tokio","Madrid","Berlín","Mumbai","Lima","São Paulo","Osaka","Dubái","Roma"],LG=["English","日本語","Español","Deutsch","हिन्दी","Español","Português","日本語","العربية","Italiano"];
const TN=[["#2a3f86","#0e1636"],["#4a3170","#120c2a"],["#1d4f63","#08182a"],["#6a4f2e","#1a1208"],["#2f5a4a","#0a1c16"],["#5a2f4a","#1a0a14"]];
const TR=["Deberíamos probar primero el audio con latencia alta.","El prototipo no se corta ni en redes 3G.","Propongo mostrar la hora local junto a cada nombre.","Los subtítulos deben seguir siendo legibles con palabras largas."];
/* encuadres distintos de tu cámara para simular a otras personas: [x%, y%, zoom] */
const FR=[[50,50,1],[50,22,1],[50,88,1.5],[18,50,1.25],[82,40,1],[50,66,1.7]];
const PR={},SRC=id=>id===-1?stream:id>=200?(PR[id]&&PR[id].stream):(rstream||stream);
const person=id=>id<0?{n:"Tú",c:"Tu cámara",l:"",g:TN[0]}:id>=200?(PR[id]?PR[id].p:{n:"…",c:"",l:"",g:TN[0]}):id>=100?{n:WN[id-100],c:"Estambul",l:"Türkçe",g:TN[id%6]}:{n:NAMES[id],c:CI[id%10],l:LG[id%10],g:TN[id%6]};
const tint=p=>`radial-gradient(100% 100% at 30% 20%,${p.g[0]}66,${p.g[1]}33)`;
let role="host",n=1,moment="n",list=[],muted=new Set(),raised=new Set(),waiting=[],active=0,pinUntil=0,subs=true,locked=false,rec=false,cur="",lay=0,stream=null,an=null,hideT,toastT,armT,t0=Date.now(),focus=null,pkId=null,fit=false;
const st={mic:true,cam:true,hand:false,share:false};
const reset=()=>{list=Array.from({length:n-1},(_,i)=>i)};
const stageMode=()=>list.length<=5,showStage=()=>stageMode()||focus!=null;
const hasCam=id=>id===-1?(!!stream&&st.cam):id>=200?!!(PR[id]&&PR[id].stream):(!!stream&&id%7!==3);
const PS=()=>matchMedia("(min-width:900px) and (min-height:561px)").matches?12:6;
const selfMain=()=>!list.length||selfV;
const mainId=()=>selfMain()?-1:(focus!=null?focus:(list.length?list[active]:null));
/* video: solo se decodifica lo que está a la vista */
const io=new IntersectionObserver(es=>es.forEach(e=>{const v=e.target;if(e.isIntersecting&&!document.hidden)v.play().catch(()=>{});else v.pause()}),{threshold:.3});
function vid(id,full){if(!stream||!hasCam(id))return null;const v=document.createElement("video");v.muted=true;v.autoplay=true;v.playsInline=true;v.srcObject=SRC(id);
  const f=id>=200?[50,50,1]:FR[id%6];v.style.objectPosition=f[0]+"% "+f[1]+"%";if(!full&&f[2]>1){v.style.transformOrigin=f[0]+"% "+f[1]+"%";v.style.transform=`scale(${f[2]})`}return v}
function attach(root){root.querySelectorAll("[data-v]").forEach(el=>{const v=vid(+el.dataset.v);if(!v)return;const w=document.createElement("div");w.className="vw";w.appendChild(v);el.prepend(w)})}
function watch(){io.disconnect();document.querySelectorAll(".vw video").forEach(v=>io.observe(v))}
function stage(a,id){const L=[$("la"),$("lb")],o=L[lay],m=L[lay^1];lay^=1;
  m.style.background=`radial-gradient(70% 60% at 28% 30%,${a.g[0]}55,transparent 70%),radial-gradient(60% 60% at 76% 72%,${a.g[1]}99,transparent 70%)`;
  const v=m.querySelector("video"),t=m.querySelector(".li"),src=SRC(id);
  if(hasCam(id)&&src){const f=id>=200||id<0?[50,50,1]:FR[id%6];if(v.srcObject!==src)v.srcObject=src;v.style.objectPosition=f[0]+"% "+f[1]+"%";v.style.transform=id===-1?"scaleX(-1)":"";v.style.display="block";t.textContent="";v.play().catch(()=>{})}
  else{v.style.display="none";t.textContent=a.n[0]}
  void m.offsetWidth;m.classList.add("on");o.classList.remove("on");
  setTimeout(()=>{if(!o.classList.contains("on")){const w=o.querySelector("video");w&&w.pause()}},1400)}
function capFor(id){if(id>=200||id<0){$("cap").hidden=true;return}const q=person(id);$("cap").hidden=!subs;$("cap").innerHTML=`<i>${q.n} · ${q.l} → Español</i>${TR[id%4]}`}
function gallery(){const ps=PS(),pages=Math.ceil(list.length/ps);let h="";
  for(let p=0;p<pages;p++)h+=`<div class="pg">`+list.slice(p*ps,p*ps+ps).map(id=>{const q=person(id),cam=hasCam(id);
    return `<button class="tile" data-i="${id}" aria-label="Ver a ${q.n}"><div class="c${cam?" cam":""}"${cam?` data-v="${id}"`:""} style="background:${tint(q)}">${cam?"":q.n[0]}${raised.has(id)?`<em class="hd">${svg("hand")}</em>`:""}${muted.has(id)?`<em class="mt">${svg("mic",1)}</em>`:""}</div><span>${q.n}</span></button>`}).join("")+`</div>`;
  $("gal").innerHTML=h;attach($("gal"));$("dots").innerHTML=pages>1?Array.from({length:pages},(_,p)=>`<i class="${p?"":"a"}"></i>`).join(""):""}
$("gal").addEventListener("scroll",()=>{const w=$("gal").clientWidth,p=Math.round($("gal").scrollLeft/w);[...$("dots").children].forEach((d,k)=>d.classList.toggle("a",k===p))},{passive:true});
function sats(){const mid=mainId();let ids=[];
  if(showStage()||selfMain())ids=list.filter(x=>x!==mid);else if(moment==="p")ids=list.slice(0,4);
  const c=ids.length,size=c<=4?Math.max(56,Math.min(96,Math.floor((innerWidth-28-12*(c-1))/Math.max(c,1)))):80;
  $("sats").style.setProperty("--ss",size+"px");
  $("sats").innerHTML=ids.map(id=>{const q=person(id),cam=hasCam(id);return `<button class="sat${cam?" cam":""}" data-i="${id}"${cam?` data-v="${id}"`:""} style="background:${tint(q)}" aria-label="Mostrar a ${q.n}">${cam?"":`<b>${q.n[0]}</b>`}<small>${q.n}</small></button>`}).join("");attach($("sats"))}
function deck(){const who=st.share?"Tú compartes tu pantalla":(list.length?person(list[0]).n+" comparte su pantalla":"");
  $("deck").innerHTML=`<b>Hoja de ruta 2027</b><i></i><i></i><i></i><small>${who}</small>`}
function render(){
  if(B.classList.contains("chat"))renderTabs();
  if(!list.length){viewMain=false;selfV=false}
  if(focus!=null&&!list.includes(focus))focus=null;
  if(active>=list.length)active=0;
  const gridM=!viewMain&&moment!=="p"&&oo==null&&list.length<=6;
  B.classList.toggle("grid",gridM);B.classList.toggle("floatm",floatMe&&list.length>0);$("tFl").setAttribute("aria-pressed",floatMe);
  const sm=selfMain(),ss=showStage()||sm;
  B.classList.toggle("alone",!list.length);B.classList.toggle("selfm",sm);
  B.classList.toggle("gm",!ss);B.classList.toggle("fo",focus!=null);B.classList.toggle("pres",moment==="p");B.classList.toggle("weak",moment==="w");B.classList.toggle("stage-on",false);
  n=list.length+1;$("cnt").textContent=n;$("online").textContent=n+" en línea";$("tIn").hidden=role!=="host";$("role").textContent=oo!=null?"1:1":(role==="host"?"Anfitrión":"Invitado");$("tGa").hidden=!(viewMain&&list.length);
  const bd=$("badge");if(bd){bd.textContent=waiting.length;bd.hidden=!waiting.length}
  if(gridM){gridRender();$("who").innerHTML="";$("cap").hidden=true;deck();return}
  if(ss&&sm){stage(person(-1),-1);$("who").innerHTML=list.length?`<i>T</i><span><b>Tú</b><br>Tu cámara</span>`:"";$("cap").hidden=true}
  else if(ss&&list.length){const id=mainId(),a=person(id);stage(a,id);$("who").innerHTML=`<i>${a.n[0]}</i><span><b>${a.n}</b><br>${[a.c,a.l].filter(Boolean).join(" · ")}</span><button class="orb sm wv" id="bChat" aria-label="Chat privado" title="Chat privado">${svg("chat")}</button><button class="orb sm wv" id="bWave" aria-label="Enviar una onda" title="Enviar una onda">${svg("wave")}</button>`;capFor(id)}
  if(!ss)gallery();
  sats();deck();watch()}
function dock(){const items=oo!=null?["mic","cam","chat","leave"]:(role==="host"?["mic","cam","chat","vista","mod","leave"]:["mic","cam","chat","vista","hand","leave"]);
  const I={vista:["grid"],mic:["mic",1],cam:["cam",1],share:["share"],hand:["hand"],mod:["shield"],chat:["chat"],leave:["leave"]},L={vista:"Vista",mic:"Micrófono",cam:"Cámara",share:"Compartir pantalla",hand:"Levantar la mano",mod:"Opciones de la sala",chat:"Chat",leave:oo!=null?"Salir del 1:1":"Salir de la llamada"};
  $("dock").innerHTML=items.map(k=>`<button class="orb${k==="mic"||k==="cam"?" tg":""}${k==="leave"?" leave":""}" data-k="${k}" aria-label="${L[k]}" title="${L[k]}"${k in st?` aria-pressed="${st[k]}"`:""}>${svg(...I[k])}<span class="lb">${LB[k]}</span>${k==="mod"?'<em class="bdg" id="badge"></em>':""}${k==="chat"?`<em class="bdg" id="cbd"${unTotal()?"":" hidden"}>${unTotal()}</em>`:""}</button>`).join("")}
function setMoment(m){moment=m;if(m!=="p"&&st.share){st.share=false;dock()}render();if(m==="w")say("Conexión inestable · calidad reducida")}
function show(){B.classList.add("on");$("ui").classList.add("show");clearTimeout(hideT);hideT=setTimeout(()=>{if(B.classList.contains("open")||B.classList.contains("peeking")){show();return}hide()},5000)}
function hide(){$("ui").classList.remove("show");B.classList.remove("on");clearTimeout(hideT);disarm()}
function say(t){const e=$("toast");e.textContent=t;e.classList.add("v");clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove("v"),1900)}
function snd(k){if(document.hidden||!PF.snd)return;try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume();
  const S={tap:[[1250,0,.05,.2]],join:[[660,0,.14,.4],[880,.13,.2,.4],[1320,.28,.3,.4]],leave:[[880,0,.14,.36],[587,.14,.25,.36],[392,.3,.3,.36]],knock:[[784,0,.12,.45],[988,.16,.12,.45],[784,.32,.12,.45],[988,.48,.22,.45]],msg:[[1046,0,.08,.36],[1568,.08,.16,.36]],end:[[523,0,.2,.4],[392,.2,.2,.4],[262,.4,.4,.4]]}[k]||[];
  const t0=AC.currentTime;S.forEach(([f,d,l,v])=>{const o=AC.createOscillator(),g=AC.createGain(),t=t0+d;o.type=k==="tap"?"triangle":"sine";o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+l+.02);o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+l+.05)})}catch(e){}}
function ripple(x,y){const r=document.createElement("div");r.className="ripple";r.style.left=x+"px";r.style.top=y+"px";document.body.appendChild(r);setTimeout(()=>r.remove(),950)}
function pulse(b){b.classList.remove("pulse");void b.offsetWidth;b.classList.add("pulse")}
addEventListener("pointerdown",e=>{ripple(e.clientX,e.clientY);if(e.target.closest("button,.gt,.sat")){snd("tap");vibe(8)}
  if(e.target.closest("#veil")){closeS();return}
  if(e.target.closest("button,.sheet,.pk,.cb,.inc")){show();return}
  $("ui").classList.contains("show")?hide():show()});
function applyTracks(){const c=st.cam,m=st.mic;
  if(stream){stream.getVideoTracks().forEach(t=>t.enabled=c);stream.getAudioTracks().forEach(t=>t.enabled=m)}
  $("me").classList.toggle("live",!!stream&&c);if(stream&&c){const sv=$("vid");sv.play().catch(()=>{});setTimeout(()=>sv.play().catch(()=>{}),300)}$("sm").classList.toggle("v",!m);$("sc").classList.toggle("v",!c);if(B.classList.contains("grid"))gridRender()}
function disarm(){const l=document.querySelector(".leave");l&&l.classList.remove("arm");clearTimeout(armT)}
$("dock").addEventListener("click",e=>{const b=e.target.closest(".orb");if(!b)return;const k=b.dataset.k;pulse(b);
  if(k==="share"){st.share?stopShare():startShare();show();return}
  if(k==="vista"){open("view");return}
  if(k in st){st[k]=!st[k];b.setAttribute("aria-pressed",st[k]);
    if(k==="mic"||k==="cam"){applyTracks();bcast(stateMsg());say(k==="mic"?(st.mic?"Micrófono activo":"Micrófono en silencio"):(st.cam?"Cámara activa":"Cámara apagada"));if(k==="cam"&&(demo||!stream)){if(demo){realCam()}else ensureCam().then(()=>{st.cam=true;applyTracks();dock();render()})}}
    if(k==="hand"){$("me").classList.toggle("hand",st.hand);bcast(stateMsg());say(st.hand?"Mano levantada":"Mano abajo")}
    if(k==="share"){setMoment(st.share?"p":"n");say(st.share?"Compartiendo tu pantalla":"Dejaste de compartir")}
  }else if(k==="mod")open("mod");else if(k==="chat")toggleChat();
  else if(k==="leave"){if(!b.classList.contains("arm")){b.classList.add("arm");say("Toca de nuevo para salir");armT=setTimeout(disarm,3000)}
    else{disarm();if(oo!=null){exitOO();return}endCall("Hasta pronto")}}
  show()});
$("rejoin").onclick=()=>{try{location.reload()}catch(e){location.href=location.pathname+location.hash}};
$("home").onclick=()=>{location.href="app.html"};
$("tSu").onclick=()=>{subs=!subs;$("tSu").setAttribute("aria-pressed",subs);pulse($("tSu"));say(subs?"Traducción en vivo activa":"Traducción apagada");if(!subs)$("cap").hidden=true;else if(mainId()!=null)capFor(mainId());show()};
$("tFi").onclick=()=>{fit=!fit;B.classList.toggle("fit",fit);$("tFi").setAttribute("aria-pressed",fit);pulse($("tFi"));say(fit?"Imagen completa":"Imagen ajustada a la pantalla");show()};
$("tGa").onclick=()=>{pulse($("tGa"));focus=null;selfV=false;viewMain=false;pinUntil=0;render();say("Todos los participantes")};
$("tPe").onclick=()=>{pulse($("tPe"));open("people")};$("tPr").onclick=()=>{pulse($("tPr"));open("proto")};$("bX").onclick=closeS;
$("sats").addEventListener("click",e=>{const b=e.target.closest(".sat");if(!b)return;const id=+b.dataset.i;pulse(b);
  if(moment==="p"){say("Estás viendo una pantalla compartida");return}
  viewMain=true;selfV=false;if(focus==null&&stageMode()){active=list.indexOf(id);pinUntil=Date.now()+25000}else{focus=id}
  setTimeout(render,260)});
/* toque en una cámara de la galería: primero vista rápida con imagen completa, luego pantalla completa */
$("gal").addEventListener("click",e=>{const t=e.target.closest(".tile");if(t)peek(+t.dataset.i)});
function peek(id){const q=person(id),box=$("pv");box.innerHTML="";pkId=id;const v=vid(id,true);
  if(v){v.className="mv";v.style.objectPosition="50% 50%";box.appendChild(v);v.play().catch(()=>{})}else box.innerHTML=`<span class="pi">${q.n[0]}</span>`;
  $("pn").textContent=q.n;$("pc").textContent=q.c+" · "+q.l;B.classList.add("peeking");show()}
$("pkX").onclick=closeS;
$("pkGo").onclick=()=>{pulse($("pkGo"));viewMain=true;focus=pkId;pinUntil=Infinity;closeS();render();say("Viendo a "+person(pkId).n)};
const chips=(g,items,c)=>`<div class="chips" role="radiogroup" data-g="${g}">`+items.map(([v,l])=>`<button class="ch" role="radio" data-v="${v}" aria-checked="${String(v)===String(c)}">${l}</button>`).join("")+`</div>`;
const mrow=(l,s,a,ic,pr)=>`<div class="row"><span>${l}<small>${s}</small></span><button class="orb sm" data-a="${a}"${pr===undefined?"":` aria-pressed="${pr}"`} aria-label="${l}">${ic}</button></div>`;
function open(mode,arg){if(mode==="wave"||mode==="prem"||mode==="chat")return openX(mode,arg);const keep=$("sf").scrollTop;cur=mode;B.classList.remove("peeking");const h=$("sh"),p=$("sp"),f=$("sf");
  if(mode==="people"){const host=role==="host";h.textContent="Participantes · "+n;p.textContent=host?"Silencia con el micrófono o quita con la x (dos toques).":"Quién está en la sala.";
    f.innerHTML=(host?mrow("Invitar","Código, clave o enlace","link",svg("share")):"")+`<div class="list"><div class="row"><i class="av" style="background:${tint({g:TN[0]})}">T</i><span>Tú<small>${host?"Anfitrión":"Invitado"}</small></span></div>`+list.map(id=>{const q=person(id);
      return `<div class="row"><i class="av" style="background:${tint(q)}">${q.n[0]}</i><span>${q.n}<small>${q.c}</small></span>${id>=200?`<button class="orb sm" data-a="pchat" data-i="${id}" aria-label="Chat privado con ${q.n}">${svg("chat")}</button><button class="orb sm" data-a="report" data-i="${id}" aria-label="Reportar a ${q.n}">${svg("ban")}</button>`:""}${raised.has(id)?`<em class="gl">${svg("hand")}</em>`:""}`+(host?`<button class="orb sm tg" data-a="mute" data-i="${id}" aria-pressed="${!muted.has(id)}" aria-label="Silenciar a ${q.n}">${svg("mic",1)}</button><button class="orb sm rm" data-a="rm" data-i="${id}" aria-label="Quitar a ${q.n}">${svg("x")}</button>`:(muted.has(id)?`<em class="gl r">${svg("mic",1)}</em>`:""))+`</div>`}).join("")+`</div>`}
  else if(mode==="invite"){inviteSheet(h,p,f)}else if(mode==="install"){installSheet(h,p,f)}else if(mode==="shareapp"){appShareSheet(h,p,f)}else if(mode==="acct"){acctSheet(h,p,f)}else if(mode==="prefs"){prefSheet(h,p,f)}else if(mode==="admin"){admSheet(h,p,f)}else if(mode==="enter"){entSheet(h,p,f)}else if(mode==="mod"){h.textContent="Sala";p.textContent="Solo el anfitrión ve esto.";
    f.innerHTML=mrow("Silenciar a todos","Los participantes pueden volver a activarse","mall",svg("mall"))+mrow("Bloquear la sala","Nadie más puede entrar","lock",svg(locked?"lock":"unlock"),locked)+mrow("Terminar sala para todos","Saca a todos y cierra la sala","endroom",svg("leave"))}
  else{h.textContent="Vista";p.textContent="Elige cómo ver la sala.";
    f.innerHTML=mrow("Todos juntos","Todas las cámaras a la vez","vgrid",svg("grid"),!viewMain)+mrow("Mi cámara flotante","Sácala de la cuadrícula y arrástrala","vfloat",svg("float"),floatMe)+mrow("Imagen completa","Sin recortar a quien ves en grande","vfit",svg("fit"),fit)+(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia?mrow("Compartir mi pantalla","Pantalla completa, una ventana o una pestaña","vshare",svg("share"),st.share):"")+`<p>Toca a una persona para verla en grande. Desliza el dedo para cambiar de persona.</p>`}
  B.classList.add("open");show();f.scrollTop=keep}
function closeS(){B.classList.remove("open","peeking");$("pv").innerHTML=""}
$("sheet").addEventListener("click",e=>{
  const ch=e.target.closest(".ch");
  if(ch){const g=ch.parentNode.dataset.g,v=ch.dataset.v;
    if(g==="sh")B.classList.toggle("rd",v==="rd");
    if(g==="role"){role=v;if(v==="host"&&!waiting.length)waiting=[100,101,102];dock();render()}
    if(g==="n"){n=+v;reset();active=0;focus=null;render()}
    if(g==="m")setMoment(v);
    if(g==="sp")autoSpeak=v==="on";
    if(g==="pl")premium=v==="prem";
    if(g==="gift"){gift=+v;open("enter");return}
    if(g==="ent"){open("enter");return}
    if(g==="wallet"){const w=wal();if(v==="c")w.c=(w.c||0)+10;else w.ul=!w.ul;say(v==="c"?"+10 Connect de prueba":w.ul?"Acceso ilimitado activo":"Acceso ilimitado apagado");open("proto");return}
    if(g==="tour"){closeS();openTour(0);return}
    if(g==="sim"){closeS();const ids=list.slice(0,5);if(ids.length)setTimeout(()=>incoming(ids[Math.random()*ids.length|0],v==="b"?"bell":"wave"),600);return}
    open("proto");return}
  const b=e.target.closest("[data-a]");if(!b)return;const a=b.dataset.a,id=+b.dataset.i;pulse(b);
  if(a==="plans"){closeS();openTour("plans")}else if(a==="reg"||a==="login"){closeS();openTour(a)}else if(a==="prefs"){open("prefs")}else if(a==="admin"){open("admin")}
  else if(a==="logout"){closeS();logout()}
  else if(a==="vshare"){closeS();st.share?stopShare():startShare()}
  else if(a==="p-snd"){PF.snd=PF.snd?0:1;savePF();open("prefs");if(PF.snd)snd("join")}else if(a==="p-vib"){PF.vib=PF.vib?0:1;savePF();open("prefs");vibe(120)}
  else if(a==="p-ntf"){PF.ntf=PF.ntf?0:1;savePF();if(PF.ntf){try{if("Notification" in window){if(Notification.permission==="default")Notification.requestPermission().then(()=>{if(acct)pushHost()});else if(Notification.permission==="denied")say("Activa las notificaciones en los ajustes del navegador")}else say("Este navegador no permite avisos")}catch(er){}}open("prefs")}
  else if(a==="p-mute"){toggleSilence();open("prefs")}
  else if(a==="p-test"){say("Enviando… cierra la app y espera unos segundos");pushHost().then(async ok=>{if(!ok){say("Primero permite las notificaciones del navegador");return}const r=await api("push",{action:"test"});if(!r.sent)say("No se pudo enviar. Revisa los permisos del navegador")})}
  else if(a==="alias"){const v=clean(prompt("Nombre que verán en las salas:",myName)||"");if(v.length>=2){myName=v;try{localStorage.setItem("suite-name",v);localStorage.setItem("ss-alias",v)}catch(e){}$("ini").textContent=v[0].toUpperCase();say("Listo: ahora eres "+v)}}
  else if(a==="instapp"){closeS();installApp()}else if(a==="shareapp"){appShare()}
  else if(a==="vgrid"){viewMain=false;focus=null;selfV=false;render();closeS()}else if(a==="vfloat"){$("tFl").click();open("view")}else if(a==="vfit"){$("tFi").click();open("view")}
  else if(a==="pchat"){closeS();toggleChat(true,id)}
  else if(a==="endroom"){if(!b.classList.contains("arm")){b.classList.add("arm");say("Toca de nuevo para terminar la sala para todos");setTimeout(()=>b.classList.remove("arm"),3000);return}endRoom()}
  else if(a==="link"){inviteLink()}else if(a==="mute"){if(id>=200){sendTo(id,{t:"mute"});muted.add(id)}else muted.has(id)?muted.delete(id):muted.add(id);say(person(id).n+(muted.has(id)?" en silencio":" puede hablar"));render();open("people")}
  else if(a==="rm"){if(!b.classList.contains("arm")){b.classList.add("arm");say("Toca de nuevo para quitar a "+person(id).n);setTimeout(()=>b.classList.remove("arm"),3000);return}
    if(id>=200){const q=person(id).n;sendTo(id,{t:"kick"});try{PR[id]&&PR[id].call&&PR[id].call.close()}catch(e){}dropPeer(id,null,true);say(q+" fue sacado de la sala")}else{list=list.filter(x=>x!==id);n--;say(person(id).n+" salió de la sala")}active=0;render();open("people")}
  else if(a==="admit"){waiting=waiting.filter(x=>x!==id);list.push(id);n++;say(person(id).n+" entró a la sala");render();open("mod")}
  else if(a==="report"){api("report",{room:roomId()||"",target:person(id).n,uid:(PR[id]&&PR[id].u)||"",reason:"conducta"}).then(r=>say(r.ok?"Reporte enviado":(r.error||"No se pudo enviar")))}else if(a==="mall"){list.forEach(x=>{if(x>=200)sendTo(x,{t:"mute"});muted.add(x)});say("Todos en silencio");render()}
  else if(a==="adm"){admAct(b.dataset.k,id)}else if(a==="goin"){enterConnect()}else if(a==="cmode"){toggleConnect();open("mod")}else if(a==="lock"){locked=!locked;say(locked?"Sala bloqueada":"Sala abierta");open("mod")}
  else if(a==="rec"){rec=!rec;$("rtx").hidden=!rec;$("rc").classList.toggle("v",rec);say(rec?"Grabando":"Grabación detenida");open("mod")}});
addEventListener("keydown",e=>{if(e.key==="Escape")closeS()});
/* quien habla: rotación simulada */
setInterval(()=>{if(document.hidden||!(stageMode()&&focus==null)||!autoSpeak||Date.now()<pinUntil||list.length<2)return;active=(active+1)%list.length;render()},7000);
setInterval(()=>{if(document.hidden)return;const T=[...document.querySelectorAll(".tile,.sat")];if(!T.length)return;T.forEach(t=>t.classList.remove("sp"));
  const c=T.filter(t=>!muted.has(+t.dataset.i)&&+t.dataset.i<200);for(let k=0;k<3&&c.length;k++){const t=c.splice(Math.random()*c.length|0,1)[0];t.classList.add("sp");if(k===0&&!showStage())capFor(+t.dataset.i)}},2400);
function demoStream(){const c=document.createElement("canvas");c.width=360;c.height=480;const x=c.getContext("2d");let t=0;
  const draw=()=>{t+=.05;const g=x.createLinearGradient(0,0,360,480);g.addColorStop(0,"#1c2552");g.addColorStop(1,"#0a0d24");x.fillStyle=g;x.fillRect(0,0,360,480);
    const l=x.createRadialGradient(90,70,10,90,70,380);l.addColorStop(0,"rgba(217,224,247,.2)");l.addColorStop(1,"rgba(217,224,247,0)");x.fillStyle=l;x.fillRect(0,0,360,480);
    const b=Math.sin(t)*3,s=Math.sin(t*.6)*8;x.fillStyle="#2a3566";x.beginPath();x.ellipse(180+s,500+b,125,140,0,0,7);x.fill();
    x.fillStyle="#3b477f";x.beginPath();x.arc(180+s,215+b,50,0,7);x.fill();x.fillStyle="rgba(217,224,247,.25)";x.beginPath();x.arc(166+s,203+b,18,0,7);x.fill()};
  draw();setInterval(()=>{if(!document.hidden)draw()},80);return c.captureStream(15)}
async function getMedia(){if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){camErr="insecure";return null}
  const HQ={facingMode:"user",width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}};
  for(const c of [{video:HQ,audio:true},{video:{facingMode:"user"},audio:true},{video:{facingMode:"user"},audio:false}]){try{return await navigator.mediaDevices.getUserMedia(c)}catch(e){camErr=(e&&e.name)||"error"}}return null}
async function realCam(){const s=await getMedia();if(!s)return false;
  stream=s;rstream=s.clone();demo=false;$("vid").srcObject=s;
  if(!s.getAudioTracks().length){st.mic=false;say("Sin micrófono: te verán pero no te oirán")}
  applyTracks();dock();render();return true}
/* la cámara se pide solo al entrar a una sala o al encender la cámara, no al abrir la app */
function ensureCam(){if(stream)return Promise.resolve(true);
  return camP=camP||(async()=>{if(await realCam())return true;stream=demoStream();rstream=stream.clone();demo=true;$("vid").srcObject=stream;applyTracks();render();
    say(camErr==="NotAllowedError"?"Permiso de cámara denegado: actívalo en el navegador":camErr==="insecure"?"La cámara requiere HTTPS":"No hay acceso a la cámara");return true})().finally(()=>{camP=null})}
function stopCam(){[stream,rstream,shareS].forEach(x=>{try{x&&x.getTracks().forEach(t=>{t.onended=null;t.stop()})}catch(e){}});stream=null;rstream=null;shareS=null;st.share=false;try{$("vid").srcObject=null}catch(e){}$("me").classList.remove("live")}
function endCall(title,msg,o){o=o||{};const s=Math.floor((Date.now()-t0)/1000);$("end").querySelector("h2").textContent=title||"Hasta pronto";
  $("dur").textContent=msg||("Duración · "+String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"));
  try{bcast({t:"leave"})}catch(e){}setTimeout(leaveNet,300);stopCam();joining=false;clearTimeout(waitT);$("wait").classList.remove("on");$("note").classList.remove("on");B.classList.remove("chat","open");
  $("rejoin").hidden=!!o.ended;$("mine").hidden=!(o.ended&&acct);$("reg2").hidden=!(o.ended&&!acct);snd("end");$("end").hidden=false}
function endRoom(){gcast({t:"end"});closeS();ownKey().then(k=>{if(k)rotatePass(k)});setTimeout(()=>endCall("Sala terminada","Cerraste la sala para todos.",{ended:true}),350)}
$("mine").onclick=()=>{location.href="app.html?go=1"};
$("reg2").onclick=()=>{location.href="app.html?reg=1"};
setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);$("clock").textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},1000);
let land=innerWidth>innerHeight,turnT;
addEventListener("resize",()=>{const l=innerWidth>innerHeight;if(l!==land){land=l;B.classList.add("turn");clearTimeout(turnT);turnT=setTimeout(()=>{B.classList.remove("turn");render()},420)}});
document.addEventListener("visibilitychange",()=>{B.classList.toggle("paused",document.hidden);watch()});
addEventListener("message",e=>{const d=e.data&&e.data.init;if(!d)return;
  if(d.role)role=d.role;
  if(d.title){const h=document.querySelector("h1");h.firstChild.nodeValue=d.title}
  if(d.name)$("ini").textContent=d.name[0].toUpperCase();
  st.mic=d.mic!==false;st.cam=d.cam!==false;
  if(d.fr){const v=$("vid");v.style.objectPosition=d.fr[0]+"% "+d.fr[1]+"%";v.style.transformOrigin=d.fr[0]+"% "+d.fr[1]+"%";v.style.transform="scale("+d.fr[2]+")"}
  dock();applyTracks();render();t0=Date.now();show();say("Entraste a la sala")});
const RP=["Hola, qué gusto verte por aquí.","Claro, hablemos un momento.","Te escucho muy bien desde aquí.","Perfecto, gracias por conectar."];
function chime(kind){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume();
  const bell=kind==="bell",notes=bell?[523,659,784,988,1175]:[523,659,784],n=notes.length,dur=bell?.55:.7;
  notes.forEach((f,i)=>{const t=AC.currentTime+i*dur*.9,o=AC.createOscillator(),g=AC.createGain(),peak=.03+(i/(n-1))*(bell?.22:.12);
    o.type="sine";o.frequency.value=f;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(peak,t+.06);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g);g.connect(AC.destination);o.start(t);o.stop(t+dur+.05)})}catch(e){}}
function buzz(kind){vibe(kind==="bell"?[90,60,90,60,90,60,260]:[70,80,140])}
function glow(n){const g=$("glow");g.style.setProperty("--n",n);g.classList.remove("on");void g.offsetWidth;g.classList.add("on")}
function emitWaves(el){const r=el?el.getBoundingClientRect():{left:0,top:0,width:0,height:0};
  const x=r.width?r.left+r.width/2:innerWidth/2,y=r.width?r.top+r.height/2:innerHeight/2;
  for(let i=0;i<4;i++){const d=document.createElement("div");d.className="sw";d.style.left=x+"px";d.style.top=y+"px";d.style.animationDelay=i*.55+"s";document.body.appendChild(d);setTimeout(()=>d.remove(),3400)}}
function openWave(id){if(id==null||id<0||oo!=null)return;open(canRing()?"wave":"prem",id)}
function sendWave(id,kind){closeS();const q=person(id);say(kind==="bell"?"Timbre enviado a "+q.n:"Onda enviada a "+q.n);
  emitWaves($("bWave")&&$("bWave").offsetWidth?$("bWave"):null);try{navigator.vibrate&&navigator.vibrate(30)}catch(e){}
  if(id>=200){sendTo(id,{t:"wave",k:kind});waitAcc=id;setTimeout(()=>{if(waitAcc===id){waitAcc=null;say(q.n+" no respondió")}},30000)}
  else setTimeout(()=>{if(oo==null){say(q.n+" aceptó tu invitación");spend();startOO(id)}},3200)}
function incoming(id,kind){if(id==null||oo!=null)return;const q=person(id);inc={id,kind};
  $("itn").textContent=q.n;$("its").textContent=kind==="bell"?"tocó el timbre":"te envió una onda";
  const ic=$("ic");ic.innerHTML="";ic.style.background=tint(q);
  if(hasCam(id)){ic.setAttribute("data-v",id);ic.textContent="";attach($("inc"))}else{ic.removeAttribute("data-v");ic.textContent=q.n[0]}
  $("inc").classList.add("on");glow(kind==="bell"?5:3);chime(kind);buzz(kind);
  try{navigator.wakeLock&&navigator.wakeLock.request("screen").then(l=>setTimeout(()=>l.release(),8000)).catch(()=>{})}catch(e){}
  clearTimeout(incT);incT=setTimeout(()=>$("inc").classList.remove("on"),25000)}
$("iOk").onclick=()=>{if(inc){if(inc.id>=200)sendTo(inc.id,{t:"acc"});startOO(inc.id)}};
$("iNo").onclick=()=>{$("inc").classList.remove("on");say("Ignoraste la invitación")};
$("iBk").onclick=()=>{$("inc").classList.remove("on");if(inc)say(person(inc.id).n+" bloqueado")};
$("who").addEventListener("click",e=>{const c=e.target.closest("#bChat");if(c){pulse(c);toggleChat(true,mainId()>=200?mainId():null);return}const b=e.target.closest("#bWave");if(b){pulse(b);openWave(mainId())}});
$("pkWv").onclick=()=>{pulse($("pkWv"));const id=pkId;closeS();openWave(id)};
function openX(mode,id){const h=$("sh"),p=$("sp"),f=$("sf");B.classList.remove("peeking");cur=mode;
  if(mode==="wave"){const q=person(id);h.textContent="Conectar con "+q.n;p.textContent="Elige cómo avisarle. Podrá aceptar o ignorar.";
    f.innerHTML=`<div class="row"><span>Onda<small>Un aviso suave</small></span><button class="orb sm" data-a="wave" data-i="${id}" aria-label="Enviar una onda">${svg("wave")}</button></div><div class="row"><span>Timbre<small>Más insistente, para algo urgente</small></span><button class="orb sm" data-a="bell" data-i="${id}" aria-label="Tocar el timbre">${svg("bell")}</button></div>`}
  else if(mode==="prem"){h.textContent="Ondas y timbre";p.textContent="Cada 1:1 gasta un timbre cuando la otra persona te abre la puerta. Quien recibe puede aceptar o ignorar sin costo.";
    f.innerHTML=`<div class="row"><span>Ver planes<small>Elige una membresía para seguir</small></span><button class="orb sm" data-a="plans" aria-label="Ver planes">${svg("go")}</button></div>`}
  else{const q=person(oo);h.textContent="Chat con "+q.n;p.textContent="Los mensajes se traducen al instante.";
    f.innerHTML=hist.length?`<div class="list">`+hist.map(m=>`<div class="row"><span>${m.me?"Tú":q.n}<small>${esc(m.t)}</small></span></div>`).join("")+`</div>`:`<p>Aún no hay mensajes.</p>`}
  B.classList.add("open");show()}
$("sheet").addEventListener("click",e=>{const b=e.target.closest("[data-a]");if(!b)return;const a=b.dataset.a;
  if(a==="wave"||a==="bell"){pulse(b);sendWave(+b.dataset.i,a)}else if(a==="plans"){pulse(b);closeS();openTour("plans")}});
const unr={};let chatTo=null;
const tkey=t=>t==null?"g":String(t),unTotal=()=>Object.values(unr).reduce((a,b)=>a+b,0);
function msgEl(m){const q=m.me?null:person(m.who),el=document.createElement("div");el.className="msg"+(m.me?" me":"");el.innerHTML=`<small>${m.me?"Tú":esc(q.n)}</small>${esc(m.t)}`;return el}
function addMsg(who,t,to){const me=who==="me",m={me,t,who,to:to==null?null:to};hist.push(m);if(hist.length>200)hist.shift();
  if(B.classList.contains("chat")&&chatTo===m.to){const box=$("msgs");box.appendChild(msgEl(m));box.scrollTop=box.scrollHeight;if(!me)snd("msg");return}
  if(!me){unr[tkey(m.to)]=(unr[tkey(m.to)]||0)+1;chatBadge();say(person(who).n+(m.to!=null?" (privado)":"")+": "+t.slice(0,60));snd("msg");vibe([60,40,60]);notify(person(who).n,t.slice(0,80),"msg")}}
function chatBadge(){const n=unTotal(),b=$("cbd");if(b){b.textContent=n;b.hidden=!n}renderTabs()}
function renderTabs(){const t=$("ctabs");if(!t)return;const items=[[null,"Sala"],...list.filter(i=>i>=200).map(i=>[i,person(i).n])];
  t.innerHTML=items.map(([k,l])=>`<button type="button" class="ct${chatTo===k?" a":""}" data-k="${k==null?"":k}">${esc(l)}${unr[tkey(k)]?` <i>${unr[tkey(k)]}</i>`:""}</button>`).join("")}
function renderMsgs(){const box=$("msgs");box.innerHTML="";hist.filter(m=>m.to===chatTo).slice(-40).forEach(m=>box.appendChild(msgEl(m)));box.scrollTop=box.scrollHeight;
  $("ci").placeholder=chatTo==null?"Mensaje para toda la sala":"Mensaje privado a "+person(chatTo).n}
function toggleChat(force,to){const on=force!==undefined?force:!B.classList.contains("chat");B.classList.toggle("chat",on);
  if(on){if(to!==undefined)chatTo=to;if(chatTo!=null&&!list.includes(chatTo))chatTo=null;delete unr[tkey(chatTo)];chatBadge();renderMsgs();setTimeout(()=>{try{$("ci").focus()}catch(e){}},80)}else{try{$("ci").blur()}catch(e){}}show()}
$("ctabs").addEventListener("click",e=>{const b=e.target.closest(".ct");if(!b)return;chatTo=b.dataset.k===""?null:+b.dataset.k;delete unr[tkey(chatTo)];chatBadge();renderMsgs()});
const gcast=m=>list.forEach(id=>sendTo(id,m));
$("cb").addEventListener("submit",e=>{e.preventDefault();const t=$("ci").value.trim();if(!t)return;$("ci").value="";addMsg("me",t,chatTo);
  if(chatTo==null)gcast({t:"chat",x:t,g:1});else sendTo(chatTo,{t:"chat",x:t,p:1})});
function startOO(id){oo=id;viewMain=true;focus=id;pinUntil=Infinity;closeS();$("inc").classList.remove("on");B.classList.add("oo");
  const h=document.querySelector("h1");ttl0=h.firstChild.nodeValue;h.firstChild.nodeValue="Con "+person(id).n;
  hist=[];$("msgs").innerHTML="";B.classList.remove("chat");dock();render();show();if(id<200)setTimeout(()=>{if(oo===id)addMsg(id,RP[0])},1300)}
function exitOO(){const id=oo;if(id>=200)sendTo(id,{t:"bye"});oo=null;viewMain=false;focus=null;pinUntil=0;B.classList.remove("oo");
  const h=document.querySelector("h1");h.firstChild.nodeValue=ttl0||"Tu SUITE";$("msgs").innerHTML="";hist=[];dock();render();say("Saliste del 1:1 con "+person(id).n);show()}
["la","lb"].forEach(i=>$(i).innerHTML='<video class="mv" muted autoplay playsinline style="display:none"></video><span class="li"></span>');
/* vigilante: reactiva cualquier video visible que se quede quieto */
setInterval(()=>{if(document.hidden)return;document.querySelectorAll("video").forEach(v=>{if(!v.srcObject||!v.offsetWidth||v.closest(".lay:not(.on)"))return;
  const r=v.getBoundingClientRect();if(r.right<0||r.left>innerWidth||r.bottom<0||r.top>innerHeight)return;
  if(v.paused){v.play().catch(()=>{});return}
  if(v._t===v.currentTime){if((v._s=(v._s||0)+1)>=2){const x=v.srcObject;v.srcObject=null;v.srcObject=x;v.play().catch(()=>{});v._s=0}}else v._s=0;v._t=v.currentTime})},1500);
/* ===== Salas reales: WebRTC en malla con PeerJS (señalización gratuita) ===== */
const MAXP=6,STUN=[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:global.stun.twilio.com:3478"}];
/* Las credenciales TURN se piden al servidor (/api/turn); nunca se guardan en el cliente. */
async function getIce(){if(iceCache)return iceCache;let extra=[],why="no responde";
  try{const c=new AbortController(),t=setTimeout(()=>c.abort(),4000);const r=await fetch("/api/turn",{cache:"no-store",signal:c.signal});clearTimeout(t);
    if(r.ok){const j=await r.json();why=j.why||"vacío";if(Array.isArray(j.iceServers))extra=j.iceServers}else why="/api/turn "+r.status}catch(e){}
  if(!extra.length){console.warn("Sin servidor TURN");window.noTurn=why}
  iceCache=[...STUN,...extra];return iceCache}
const parseHash=()=>{const m=location.hash.toLowerCase().match(/^#sala-([a-z0-9]{4,12})(?:\.([a-z0-9]{4}))?$/);return m?{id:m[1],pass:(m[2]||"").toUpperCase()}:null};
const roomId=()=>{const h=parseHash();return h?h.id:null};
function nm(){if(myName)return myName;try{myName=clean(localStorage.getItem("suite-name")||"")}catch(e){}
  if(!myName){myName=(typeof acct!=="undefined"&&acct&&acct.n)||"Invitado";try{localStorage.setItem("suite-name",myName)}catch(e){}}return myName}
function addPeer(pid,call,name){if(!/^suite-[a-z0-9]+-\d+$/.test(String(pid)))return;const slot=+pid.split("-").pop(),id=200+slot;if(slot<1||slot>MAXP)return;
  const e=PR[id]=PR[id]||{p:{n:"Invitado "+slot,c:"En línea",l:"",g:TN[slot%6]}};if(name)e.p.n=clean(name)||e.p.n;if(slot===1&&name)setTitle("SUITE de "+e.p.n);
  if(call){e.call=call;const pc=call.peerConnection;if(pc){let dT=null;pc.addEventListener("iceconnectionstatechange",()=>{const s=pc.iceConnectionState;clearTimeout(dT);
    if(s==="connected"||s==="completed"){if(RT[id]){say("Reconectado con "+e.p.n)}else if(!e._c)say("Conectado con "+e.p.n);e._c=1;RT[id]=0;REC.delete(id)}
    else if(s==="failed"){REC.add(id);if((RT[id]||0)===2)say("Sin ruta de red con "+e.p.n+": puede faltar un servidor TURN");recover(id)}
    else if(s==="disconnected"){dT=setTimeout(()=>{if(pc.iceConnectionState==="disconnected"){REC.add(id);recover(id)}},4000)}})}
    call.on("stream",s=>{e.stream=s;
    if(!e.au){e.au=document.createElement("audio");e.au.autoplay=true;document.body.appendChild(e.au)}e.au.srcObject=s;e.au.play().catch(()=>{});
    if(shareS){const t=shareS.getVideoTracks()[0];t&&setTimeout(()=>swapVideo(t),500)}
    if(!list.includes(id)){if(!list.length){selfV=false;viewMain=false;active=0}list.push(id);n=list.length+1;if(!joining)say(e.p.n+" entró a la sala");snd("join")}if(joining&&id===201){joining=false;$("wait").classList.remove("on")}render();tune();setTimeout(tune,1500);if(list.length===1&&!e._hint){e._hint=1;setTimeout(()=>say(floatMe?"Tu cámara flota: arrástrala · tócala para verte grande":"Toca a alguien para verlo grande"),2600)}});
    call.on("close",()=>dropPeer(id,call));call.on("error",()=>dropPeer(id,call))}
  else if(list.includes(id))render()}
function swapVideo(t){Object.values(PR).forEach(e=>{const pc=e.call&&e.call.peerConnection;if(pc)pc.getSenders().forEach(x=>{if(x.track&&x.track.kind==="video")x.replaceTrack(t).catch(()=>{})})})}
function stopShare(){if(!st.share)return;st.share=false;const t=stream&&stream.getVideoTracks()[0];if(t)swapVideo(t);if(shareS){shareS.getTracks().forEach(x=>{x.onended=null;x.stop()});shareS=null}
  const b=document.querySelector('[data-k="share"]');if(b)b.setAttribute("aria-pressed","false");say("Dejaste de compartir")}
async function startShare(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){say("Este dispositivo no permite compartir pantalla");return}
  try{const s=await navigator.mediaDevices.getDisplayMedia({video:true});shareS=s;const t=s.getVideoTracks()[0];t.onended=stopShare;swapVideo(t);st.share=true;
    const b=document.querySelector('[data-k="share"]');if(b)b.setAttribute("aria-pressed","true");say("Compartiendo tu pantalla")}catch(e){say("No se pudo compartir la pantalla")}}
function leaveNet(){try{stopShare()}catch(e){}try{Object.values(PR).forEach(e=>{try{e.call&&e.call.close()}catch(x){}});net&&net.destroy&&net.destroy()}catch(e){}net=null;joining=false}
function dropPeer(id,call,noRec){const e=PR[id];if(!e||(call&&e.call!==call))return;if(chatTo===id)chatTo=null;if(list.includes(id))snd("leave");if(e.au)e.au.remove();delete PR[id];if(!list.includes(id))return;
  list=list.filter(x=>x!==id);n=list.length+1;const ic=e.call&&e.call.peerConnection&&e.call.peerConnection.iceConnectionState,bad=!e._left&&(ic==="failed"||ic==="disconnected"||REC.has(id));
  if(bad&&!noRec){say("Se cortó con "+e.p.n+" · reconectando…")}else if(!noRec){note(e.p.n+" salió de la sala",[["Invitar de nuevo",()=>inviteLink()]],9000)}else say(e.p.n+" salió de la sala");if(!bad||noRec){ADM.delete(id-200);OKS.delete(id-200)}else setTimeout(()=>{if(!list.includes(id)&&!PR[id]){ADM.delete(id-200);OKS.delete(id-200);note(e.p.n+" se desconectó",[["Invitar de nuevo",()=>inviteLink()],["Reintentar",()=>softRefresh()]],12000)}},25000);render();tune();if(e._c&&bad&&!noRec)recover(id)}
function recover(id){const slot=id-200,R=roomId();if(!net||net.destroyed||!net.id||!R||RQ[id]||(RT[id]||0)>=6)return;
  const mine=+net.id.split("-").pop();if(mine===slot)return;RQ[id]=1;RT[id]=(RT[id]||0)+1;
  setTimeout(()=>{RQ[id]=0;if(!net||net.destroyed||!net.id)return;const e=PR[id],pc=e&&e.call&&e.call.peerConnection;
    if(e&&e.stream&&pc&&["connected","completed"].includes(pc.iceConnectionState))return;
    if(e&&e.call){try{e.call.close()}catch(x){}}
    if(net.disconnected){try{net.reconnect()}catch(x){}}
    dial(net,R,slot)},mine>slot?1200:6000)}
const sdpT=sdp=>{try{return sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec[^\r\n]*)/g,(m,p,f)=>"a=fmtp:"+p+" "+f.replace(/;?(stereo|maxaveragebitrate|usedtx|sprop-stereo)=\d+/g,"")+";stereo=0;maxaveragebitrate=40000;usedtx=0")}catch(e){return sdp}};
function tune(){const c=Math.max(1,list.length),br=c>=5?55e4:c>=3?9e5:c===2?16e5:26e5;Object.values(PR).forEach(e=>{const pc=e.call&&e.call.peerConnection;if(!pc)return;pc.getSenders().forEach(x=>{if(!x.track||x.track.kind!=="video"||!x.getParameters)return;try{const q=x.getParameters();if(!q.encodings||!q.encodings.length)q.encodings=[{}];q.encodings[0].maxBitrate=br;q.encodings[0].maxFramerate=30;q.encodings[0].scaleResolutionDownBy=1;x.setParameters(q).catch(()=>{})}catch(z){}})})}
function keepAwake(){try{navigator.wakeLock&&navigator.wakeLock.request("screen").then(l=>{wl=l;l.addEventListener("release",()=>{wl=null})}).catch(()=>{})}catch(e){}}
const CN={};
const sendTo=(id,m)=>{const c=CN[id];if(c&&c.open){try{c.send(m)}catch(e){}}};
const bcast=m=>Object.keys(CN).forEach(k=>sendTo(+k,m));
const stateMsg=()=>({t:"st",m:st.mic,h:st.hand});
function bindConn(pid,c){if(!/^suite-[a-z0-9]+-\d+$/.test(String(pid)))return;const id=200+ +String(pid).split("-").pop();CN[id]=c;
  const hello=()=>{sendTo(id,{t:"hi",n:nm(),u:(acct&&acct.id)||""});sendTo(id,stateMsg())};
  if(c.open)hello();else c.on("open",hello);
  c.on("data",d=>onData(id,d));c.on("close",()=>{if(CN[id]===c)delete CN[id];const sl=id-200;if(HELD[sl]&&!ADM.has(sl)){setTimeout(()=>{if(!CN[id]&&HELD[sl]&&!ADM.has(sl)){delete HELD[sl];knocks=knocks.filter(x=>x.slot!==sl);showKnock()}},2500)}});c.on("error",()=>{})}
function onData(id,d){if(!d||typeof d!=="object")return;
  if(d.t==="hi"){if(typeof d.n==="string")addPeer("suite-"+roomId()+"-"+(id-200),null,d.n);
    if(PR[id]&&typeof d.u==="string"&&/^[a-f0-9]{24}$/.test(d.u))PR[id].u=d.u;return}
  if(d.t==="in"&&id===201&&joining){if(Array.isArray(d.s)){joining=false;clearTimeout(waitT);$("wait").classList.remove("on");say("El anfitrión te dejó entrar");snd("join");vibe(120);const R=roomId();
      d.s.forEach(x=>{x=+x;if(x>1&&x<=MAXP&&x!==mySlot&&net&&net.id){OKS.add(x);dial(net,R,x)}})}return}
  if(d.t==="adm"&&id===201){const x=+d.s;if(x>1&&x<=MAXP){OKS.add(x);const c=HELD[x];if(c){delete HELD[x];try{c.answer(stream,{sdpTransform:sdpT});addPeer(c.peer,c,c.metadata&&c.metadata.n)}catch(e){}}}return}
  if(d.t==="deny"&&id===201&&joining){const M={lock:["Sala bloqueada","El anfitrión bloqueó la sala."],pass:["Clave incorrecta","La clave de esta SUITE no coincide."],full:["Sala llena","Esta SUITE ya tiene el máximo de personas."]}[d.r]||["No entraste","El anfitrión no aceptó tu solicitud."];endCall(M[0],M[1]);return}
  if(!PR[id])return;
  switch(d.t){
    case"end":if(id===201&&role!=="host")endCall("La sala terminó","El anfitrión cerró la sala.",{ended:true});break;
    case"leave":{const e=PR[id];e._left=1;try{e.call&&e.call.close()}catch(x){}dropPeer(id,null,false);break}
    case"st":d.m?muted.delete(id):muted.add(id);d.h?raised.add(id):raised.delete(id);render();break;
    case"chat":if(list.includes(id)&&typeof d.x==="string")addMsg(id,d.x.slice(0,500),d.g?null:id);break;
    case"wave":if(oo==null&&(d.k==="wave"||d.k==="bell"))incoming(id,d.k);break;
    case"acc":if(waitAcc===id){waitAcc=null;say(person(id).n+" aceptó tu invitación");spend();startOO(id)}break;
    case"bye":if(oo===id)exitOO();break;
    case"mute":if(id===201&&role!=="host"){st.mic=false;applyTracks();dock();bcast(stateMsg());say("El anfitrión te silenció")}break;
    case"kick":if(id===201&&role!=="host"){say("El anfitrión te sacó de la sala");setTimeout(()=>endCall("Te sacaron de la sala","El anfitrión te quitó de esta sala."),900)}break}}
function dial(p,R,j){const pid="suite-"+R+"-"+j,c=p.connect(pid);bindConn(pid,c);
  addPeer(pid,p.call(pid,stream,{metadata:{n:nm(),p:guestPass},sdpTransform:sdpT}))}
async function startNet(){const R=roomId();if(!R||net)return;
  if(!window.Peer){say("No se pudo cargar PeerJS: revisa tu conexión");return}
  net={};if(!(await ensureCam())){net=null;return}const ICE=await getIce();const mineK=((await ownKey())||"").toLowerCase()===R;
  hostPass=mineK?hostPassFor(R.toUpperCase()):"";guestPass=(parseHash()||{}).pass||"";
  if(mineK){try{history.replaceState(null,"",location.pathname+"#sala-"+R+"."+hostPass.toLowerCase())}catch(e){}}list=[];n=1;focus=null;active=0;waiting=[];muted=new Set();raised=new Set();$("ini").textContent=nm()[0].toUpperCase();render();
  const join=k=>{if(k>MAXP){endCall("Sala llena","Esta SUITE ya tiene el máximo de personas.");net=null;return}
    let op=false;const p=new Peer("suite-"+R+"-"+k,{config:{iceServers:ICE,iceCandidatePoolSize:4}});
    p.on("error",er=>{if(er.type==="unavailable-id"){p.destroy();join(k+1)}
      else if(er.type==="peer-unavailable"){const m=/suite-[a-z0-9]+-(\d+)/.exec(er.message||"");if(m){const id=200+ +m[1];if(!list.includes(id))delete PR[id];if(joining&&+m[1]===1)hostAbsent()}}
      else if(["network","server-error","socket-error","socket-closed"].includes(er.type)){say("Reconectando…");if(!op){try{p.destroy()}catch(x){}net=null;setTimeout(startNet,3000)}else{try{p.disconnected&&p.reconnect()}catch(x){}}}
      else say("Conexión: "+er.type)});
    p.on("disconnected",()=>{try{p.reconnect()}catch(e){}});
    p.on("open",()=>{net=p;mySlot=k;keepAwake();if(op)return;op=true;role=k===1?"host":"guest";dock();render();
      if(k===1){say("Tu SUITE está abierta");freeTimer();if(mineK&&acct)pushHost();if(window.noTurn&&owner)setTimeout(()=>note("Sin TURN ("+window.noTurn+"): con datos el video puede fallar",[],14000),3000);for(let j=2;j<=MAXP;j++)dial(p,R,j)}else{joining=true;waitUI();dial(p,R,1)}});
    p.on("call",c=>{if(!/^suite-[a-z0-9]+-\d+$/.test(String(c.peer)))return;const slot=+c.peer.split("-").pop();
      if(role==="host"){if(locked){try{c.close()}catch(e){}return}
        const gp=String((c.metadata&&c.metadata.p)||"").toUpperCase();
        if(!ADM.has(slot)&&gp!==hostPass){try{c.close()}catch(e){}later(200+slot,{t:"deny",r:"pass"});note("Alguien intentó entrar con una clave incorrecta",[],6000);return}
        if(!ADM.has(slot)&&list.length+1>=maxRoom()){try{c.close()}catch(e){}later(200+slot,{t:"deny",r:"full"});note("Sala llena: tu plan permite "+maxRoom()+" personas",[["Ver planes",()=>openTour("plans")]],8000);return}
        if(ADM.has(slot)){c.answer(stream,{sdpTransform:sdpT});addPeer(c.peer,c,c.metadata&&c.metadata.n);return}
        HELD[slot]=c;c.on("close",()=>{if(HELD[slot]===c){delete HELD[slot];knocks=knocks.filter(x=>x.slot!==slot);showKnock()}});knock(slot,c.metadata&&c.metadata.n);return}
      if(slot===1||OKS.has(slot)){c.answer(stream,{sdpTransform:sdpT});addPeer(c.peer,c,c.metadata&&c.metadata.n)}else HELD[slot]=c});
    p.on("connection",c=>{if(locked&&role==="host"){c.on("open",()=>{try{c.send({t:"deny",r:"lock"})}catch(e){}setTimeout(()=>{try{c.close()}catch(e){}},400)});return}bindConn(c.peer,c)})};
  join(mineK?1:2)}
/* ===== Claves de SUITE: código SS-SALA-XXXXXXXXXX + clave de 4 caracteres ===== */
const KA="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",PA="SUITE0123456789";let OWNK=null,hostPass="",guestPass="";
async function ownKey(){if(!acct)return null;if(!OWNK){const h=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(acct.id+":ss-sala")));OWNK=Array.from(h.slice(0,10),x=>KA[x%32]).join("")}return OWNK}
function genPass(){let p;do{p=Array.from(crypto.getRandomValues(new Uint8Array(4)),x=>PA[x%PA.length]).join("")}while(!/\d/.test(p)||!/[SUITE]/.test(p));return p}
function hostPassFor(k){let p="";try{p=localStorage.getItem("ss-pass-"+k)||""}catch(e){}if(!/^[SUITE0-9]{4}$/.test(p)){p=genPass();try{localStorage.setItem("ss-pass-"+k,p)}catch(e){}}return p}
function rotatePass(k){const p=genPass();try{localStorage.setItem("ss-pass-"+k,p)}catch(e){}return p}
const inviteData=async()=>{const k=await ownKey();if(!k)return null;const pass=hostPassFor(k);return{code:"SS-SALA-"+k,pass,link:location.origin+"/app.html#sala-"+k.toLowerCase()+"."+pass.toLowerCase()}};
const canShare=()=>owner||(acct&&["vip","c14","c30","c90"].includes(acct.plan));
const maxRoom=()=>canShare()?MAXP:3;
async function startOwn(){if(!acct){openTour("welcome",true);return}
  if(!owner&&(acct.expired||acct.plan==="none")){openTour("plans",true);say("Elige un plan para abrir tu SUITE");return}
  const k=await ownKey(),p=hostPassFor(k);preShown=true;
  try{history.replaceState(null,"",location.pathname+"#sala-"+k.toLowerCase()+"."+p.toLowerCase())}catch(e){location.hash="sala-"+k.toLowerCase()+"."+p.toLowerCase()}
  closeTour();askNotif();startNet();setTimeout(()=>{if(!list.length&&!joining)open("invite")},1400)}
async function inviteLink(){if(!acct){openTour("welcome",true);return}if(!net){await startOwn();return}open("invite")}
const tryStart=()=>{};
/* ===== Entrada, cuenta y planes ===== */
const saveA=()=>{};
function canRing(){return acct?acct.t>0:false}
async function api(path,body){try{const r=await fetch("/api/"+path,{method:body?"POST":"GET",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined,credentials:"same-origin"});const j=await r.json().catch(()=>({}));return {...j,ok:r.ok}}catch(e){return{ok:false,error:"Sin conexión con el servidor"}}}
const fmt=id=>PRICES[id]||"";
let WAS={},OFF=0,RATE=0;
async function loadPrices(){const r=await api("products");if(r.ok&&r.prices){PRICES=r.prices;WAS=r.was||{};OFF=r.off||0;RATE=r.rate||0;MODE=r.mode||"manual"}}
async function loadMe(){const r=await api("me");if(r.ok&&r.user){acct=r.user;owner=!!r.user.owner;let al="";try{al=clean(localStorage.getItem("ss-alias")||"")}catch(e){}const n=al||clean(r.user.n);if(n){myName=n;$("ini").textContent=n[0].toUpperCase();$("tMe").textContent=n[0].toUpperCase()}}else{acct=null;owner=false;$("tMe").innerHTML=svg("shield")}ownBtn();badge();return acct}
async function spend(){if(!acct)return;const r=await api("spend",{kind:"timbre"});if(r.ok&&r.user){acct=r.user;say("Te quedan "+acct.t+" timbres")}else say(r.error||"No se pudo descontar el timbre")}
function pollPay(){let k=0;const a0=acct&&JSON.stringify([acct.plan,acct.t,acct.c,acct.until,acct.ul]);const iv=setInterval(async()=>{await loadMe();k++;const a1=acct&&JSON.stringify([acct.plan,acct.t,acct.c,acct.until,acct.ul]);if(a1&&a1!==a0){clearInterval(iv);say("¡Pago confirmado! Tu plan ya está activo")}else if(k>=40)clearInterval(iv)},30000)}
async function buy(id){if(!acct){say("Primero crea tu cuenta");openTour("reg");return}
  if(MODE==="manual"){const r=await api("manual",{product:id});if(r.ok&&r.order){payView=r;openTour("pay",trLock)}else say(r.error||"No se pudo crear el pedido");return}
  const r=await api("checkout",{product:id});if(r.ok&&r.url)location.href=r.url;else say(r.error||"No se pudo iniciar el pago")}
function badge(){const b=$("planb");if(b)b.hidden=true}
const price=id=>`${WAS[id]&&OFF?`<s>${WAS[id]}</s> `:""}<b>${fmt(id)}</b>${OFF?` <i class="off">-${OFF}%</i>`:""}`;
const row=(id,t)=>`<button type="button" class="tr-row" data-buy="${id}"><span>${t}</span><em>${price(id)}</em></button>`;
const shell=(body,bar)=>`<div class="tr-body">${body}</div><div class="tr-bar">${bar}</div>`;
const dob18=()=>{const d=new Date();d.setFullYear(d.getFullYear()-18);return d.toISOString().slice(0,10)};
function openTour(x,lock){const T=$("tour");trLock=!!lock;T.hidden=false;let h="";const LG=`<img class="tr-logo" src="logo-app.svg" alt="" width="132" height="132">`;
  if(x==="welcome"){h=shell(`${LG}<div class="tr-wm">space<b>SUITE</b></div><h2>Videollamadas privadas, cara a cara.</h2><p>Salas con tu gente, cifradas y con acceso solo por invitación.</p><p class="tr-s">Solo para hombres mayores de 18 años.</p><button class="inst" data-n="inst" type="button"><svg viewBox="0 0 24 24"><path d="M12 4v11m-4-4 4 4 4-4M5 19.5h14"/></svg>Instalar la app<small>Un toque</small></button>`,
    `<button class="tr-b" data-n="reg">Crear cuenta</button><button class="tr-g" data-n="login">Ya tengo cuenta</button><button class="tr-k" data-n="code">Entrar con un código de SUITE</button>`)}
  else if(x==="reg"){h=shell(`<h2>Crea tu cuenta</h2><p>Tu prueba gratis dura 3 días: salas de hasta 3 personas y 25 min por sesión.</p><input id="trN" type="text" maxlength="24" placeholder="Nombre o alias" aria-label="Nombre" autocomplete="nickname"><input id="trE" type="email" maxlength="120" placeholder="Correo electrónico" aria-label="Correo" autocomplete="email"><input id="trW" type="password" maxlength="200" placeholder="Contraseña (8+, con letras y números)" aria-label="Contraseña" autocomplete="new-password"><input id="trW2" type="password" maxlength="200" placeholder="Repite la contraseña" aria-label="Repite la contraseña" autocomplete="new-password"><label class="tr-d2">Fecha de nacimiento<input id="trB" type="date" max="${dob18()}" aria-label="Fecha de nacimiento"></label><label class="tr-l"><input id="trT" type="checkbox"> Tengo 18 años o más y acepto los términos y el aviso de privacidad</label>`,
    `<button class="tr-b" data-n="go">Crear mi cuenta</button><button class="tr-g" data-n="welcome">Volver</button>`)}
  else if(x==="login"){h=shell(`<h2>Entrar a tu cuenta</h2><p>Con el correo y la contraseña de tu registro.</p><input id="trE" type="email" maxlength="120" placeholder="Correo electrónico" aria-label="Correo" autocomplete="email"><input id="trW" type="password" maxlength="200" placeholder="Contraseña" aria-label="Contraseña" autocomplete="current-password">`,
    `<button class="tr-b" data-n="key2">Entrar</button><button class="tr-g" data-n="welcome">Volver</button>`)}
  else if(x==="home"){const pl={free:"Prueba gratis",vip:"VIP",c14:"Connect",c30:"Connect",c90:"Connect"}[acct&&acct.plan]||"Sin plan";
    h=shell(`<div class="lb-h"><img class="lb-logo" src="logo-app.svg" alt="" width="64" height="64"><div><b>Hola, ${esc(myName||"")}</b><small>${owner?"Dueño · acceso total":pl+(acct&&acct.until>Date.now()?" · "+Math.ceil((acct.until-Date.now())/864e5)+" días":"")}</small></div></div>
<div class="lb-tiles"><button class="lb-t g" data-n="mine"><svg viewBox="0 0 24 24">${P.cam}</svg><span>Nueva SUITE</span></button><button class="lb-t" data-n="code"><svg viewBox="0 0 24 24">${P.invite}</svg><span>Unirse</span></button><button class="lb-t" data-n="myinv"><svg viewBox="0 0 24 24">${P.send}</svg><span>Invitar</span></button><button class="lb-t" data-n="plans"><svg viewBox="0 0 24 24">${P.shield}</svg><span>Planes</span></button></div>
<div class="lb-card" id="lbk"><span>Mi SUITE</span><b>Cargando…</b></div>
<button class="inst" data-n="inst" type="button"><svg viewBox="0 0 24 24"><path d="M12 4v11m-4-4 4 4 4-4M5 19.5h14"/></svg>Instalar la app<small>Un toque</small></button>`,
    `<div class="tr-row2"><button class="tr-k" data-n="plans">Mi plan y cuenta</button><button class="tr-k dg" data-n="logout">Cerrar sesión</button></div>`)}
  else if(x==="code"){h=shell(`<h2>Entrar a una SUITE</h2><p>Escribe el código y la clave que te compartieron.</p><input id="trC" type="text" maxlength="18" placeholder="SS-SALA-XXXXXXXXXX" aria-label="Código de SUITE" autocapitalize="characters" autocomplete="off"><input id="trP" type="text" maxlength="4" placeholder="Clave (4 caracteres)" aria-label="Clave" autocapitalize="characters" autocomplete="off">`,
    `<button class="tr-b" data-n="codego">Entrar</button><button class="tr-g" data-n="${acct?"home":"welcome"}">Volver</button>`)}
  else if(x==="pre"){const hp=parseHash()||{};h=shell(`<img src="logo-app.svg" alt="" width="112" height="112" style="margin-bottom:18px"><h2>Antes de entrar</h2><p>Te pediremos permiso de cámara y micrófono. Tú te verás primero y el anfitrión debe aceptarte.</p><input id="trN" type="text" maxlength="24" placeholder="Tu nombre en la sala" aria-label="Tu nombre en la sala" value="${esc(myName||(()=>{try{return localStorage.getItem("suite-name")||""}catch(e){return""}})())}">${hp.pass?"":`<input id="trP" type="text" maxlength="4" placeholder="Clave de la SUITE (4)" aria-label="Clave" autocapitalize="characters" autocomplete="off">`}`,
    `<button class="tr-b" data-n="join">Entrar a la sala</button>${acct?"":`<button class="tr-g" data-n="login">Ya tengo cuenta</button>`}`)}
  else if(x==="review"){h=shell(`<img src="logo-app.svg" alt="" width="96" height="96"><h2>Pago en revisión</h2><p>Tu plan todavía <b>no está activo</b>. Se activa cuando confirmemos tu transferencia, normalmente en pocas horas. Te avisamos aquí mismo.</p>`,`<button class="tr-b" data-n="x">Entendido</button>`)}
  else if(x==="out"){h=shell(`<h2>Vuelve pronto</h2>`,"")}
  else if(x==="plans"){const free=`<div class="tr-c"><em>Gratis · 3 días</em><b>Para probar</b><span>Salas de hasta 3 personas · 25 min por sesión · sin compartir pantalla · 3 timbres.</span></div>`;
    h=shell(`<h2>Planes</h2><p>${OFF?`Lanzamiento: ${OFF}% de descuento en todos los planes.`:"Elige el que más te convenga."}</p>${acct?"":free}<div class="tr-c tr-hot" data-buy="vip"><em>${price("vip")} <small>/ semana</small></em><b>VIP</b><span>Salas de hasta 6 personas · sin límite de tiempo · compartir pantalla · 3 timbres y 2 Connect al día.</span></div><details class="tr-more"><summary>Más planes: Connect y accesos</summary>${row("c14","Connect 14 días · 50 timbres y 30 Connect")}${row("c30","Connect 30 días · 150 timbres y 120 Connect")}${row("c90","Connect 3 meses · 400 timbres y 300 Connect")}${row("ul7","Acceso Connect · 1 semana")}${row("ul14","Acceso Connect · 14 días")}${row("ul30","Acceso Connect · 30 días")}</details>`,
    `${acct?"":`<button class="tr-b" data-n="reg">Crear cuenta gratis</button>`}${trLock?"":`<button class="tr-g" data-n="x">Cerrar</button>`}`)}
  else if(x==="pay"&&payView){const o=payView.order,q=payView.pay;h=shell(`<h2>Paga por transferencia</h2><p>Desde la app de tu banco (SPEI) o con depósito. Tu plan se activa cuando confirmamos el pago, normalmente en pocas horas.</p><div class="tr-c"><em>${esc(o.name)}</em><b>${o.usd?"$"+esc(o.usd)+" USD":"$"+esc(o.amount)+" MXN"}</b><span>${o.usd?`Transfiere en pesos: <b>$${esc(o.amount)} MXN</b><br>`:""}Banco: ${esc(q.bank)}<br>Titular: ${esc(q.holder)}<br>CLABE: <b>${esc(q.clabe)}</b><br>Concepto: <b>${esc(o.code)}</b></span><button class="tr-g" data-n="copyc">Copiar CLABE</button></div><p>Escribe exactamente ese concepto para que te identifiquemos.</p><input id="trF" type="text" maxlength="30" placeholder="Clave de rastreo o folio del pago" aria-label="Clave de rastreo">`,
    `<button class="tr-b" data-n="paid">Ya pagué</button><button class="tr-g" data-n="plans">Volver</button>`)}
  else{h=shell(`<h2>Bienvenido</h2>`,`<button class="tr-b" data-n="welcome">Continuar</button>`)}
  T.innerHTML=h;const bd=T.querySelector(".tr-body");if(bd)bd.scrollTop=0;instUI();if(x==="home")fillLobby()}
function closeTour(){$("tour").hidden=true;try{localStorage.setItem("ss-tour","1")}catch(e){}badge()}
let freeT=null;
function freeTimer(){clearTimeout(freeT);if(acct&&acct.plan==="free"&&!owner)freeT=setTimeout(()=>{gcast({t:"end"});endCall("Sesión gratis terminada","Tu prueba permite 25 min por sesión. Con VIP no hay límite.",{ended:false})},15e5)}
const u8=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";const b=atob(s);return Uint8Array.from(b,c=>c.charCodeAt(0))};
async function pushSub(room,role){try{if(!(PF.ntf&&"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window&&Notification.permission==="granted"))return false;
  const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
  if(!sub){const k=await api("push");if(!k.key)return false;sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:u8(k.key)})}
  const r=await api("push",{action:"sub",sub:sub.toJSON(),room,role});return !!r.ok}catch(e){return false}}
async function pushHost(){const k=await ownKey();if(!k||!acct)return false;const ok=await pushSub(k.toLowerCase(),"h");if(ok&&roomId()===k.toLowerCase())api("push",{action:"open"});return ok}
const askNotif=async()=>{try{if(PF.ntf&&"Notification" in window&&Notification.permission==="default")await Notification.requestPermission()}catch(e){}if(acct)pushHost()};
$("tour").addEventListener("click",e=>{const bc=e.target.closest("[data-buy]");if(bc){buy(bc.dataset.buy);return}
  const b=e.target.closest("[data-n]");if(!b)return;const k=b.dataset.n;
  if(k==="inst"){installApp();return}
  if(k==="myinv"||k==="cpk"){inviteData().then(async d=>{if(!d)return;const msg=`Te invito a mi SUITE en spaceSUITE 🔒\nCódigo: ${d.code}\nClave: ${d.pass}\nEntra directo: ${d.link}`;
    if(k==="myinv"&&navigator.share){try{await navigator.share({title:"spaceSUITE",text:msg})}catch(er){}}else{try{await navigator.clipboard.writeText(k==="cpk"?`Código: ${d.code}\nClave: ${d.pass}`:msg);say("Copiado")}catch(er){prompt("Copia:",msg)}}});return}
  if(k==="logout"){logout();return}
  if(k==="mine"){startOwn();return}
  if(k==="join"){const R=roomId();if(!R){openTour(acct?"home":"welcome",true);return}
    const nmI=$("trN"),v=clean(nmI?nmI.value:myName);if(v.length<2){say("Escribe tu nombre (mínimo 2 letras)");return}
    const pI=$("trP");if(pI){const pv=pI.value.trim().toLowerCase();if(!/^[suite0-9]{4}$/.test(pv)){say("La clave son 4 caracteres");return}try{history.replaceState(null,"",location.pathname+"#sala-"+R+"."+pv)}catch(e){}}
    myName=v;try{localStorage.setItem("suite-name",v);if(acct)localStorage.setItem("ss-alias",v)}catch(e){}$("ini").textContent=v[0].toUpperCase()
    closeTour();askNotif();startNet();return}
  if(k==="codego"){let c=($("trC").value||"").toUpperCase().replace(/\s/g,"");c=c.replace(/^SS-?SALA-?/,"");const pv=($("trP").value||"").trim().toLowerCase();
    if(!/^[A-Z0-9]{10}$/.test(c)){say("El código es SS-SALA- y 10 caracteres");return}if(!/^[suite0-9]{4}$/.test(pv)){say("La clave son 4 caracteres");return}
    try{history.replaceState(null,"",location.pathname+"#sala-"+c.toLowerCase()+"."+pv)}catch(er){location.hash="sala-"+c.toLowerCase()+"."+pv}
    preShown=true;openTour("pre",true);return}
  if(k==="x"){closeTour();if(!roomId()&&!net)openTour(acct?"home":"welcome",true);return}
  if(k==="copyc"&&payView){try{navigator.clipboard.writeText(payView.pay.clabe);say("CLABE copiada")}catch(er){say("Copia la CLABE manualmente")}return}
  if(k==="paid"&&payView){const rf=($("trF")?$("trF").value:"").trim();if(rf.length<4){say("Escribe la clave de rastreo o folio de tu pago");if($("trF"))$("trF").focus();return}api("manual",{action:"paid",code:payView.order.code,ref:rf}).then(r=>{if(r.ok){openTour("review",true);pollPay()}else say(r.error||"No se pudo avisar")});return}
  if(k==="go"){const v=clean($("trN").value),em=$("trE").value.trim(),pw=$("trW").value,pw2=$("trW2").value,dob=$("trB").value;
    if(v.length<2){say("Escribe tu nombre o alias");return}if(!/^\S+@\S+\.\S+$/.test(em)){say("Escribe un correo válido");return}
    if(pw.length<8||!/[A-Za-z]/.test(pw)||!/\d/.test(pw)){say("La contraseña necesita 8+ caracteres, letras y números");return}if(pw!==pw2){say("Las contraseñas no coinciden");return}
    if(!dob){say("Indica tu fecha de nacimiento");return}if(dob>dob18()){say("Debes ser mayor de 18 años");return}if(!$("trT").checked){say("Acepta los términos para continuar");return}
    api("register",{name:v,email:em,password:pw,dob,terms:true}).then(async r=>{if(!r.ok){say(r.error||"No se pudo crear la cuenta");return}await loadMe();try{localStorage.setItem("suite-name",v)}catch(er){}say("Cuenta creada · prueba gratis de 3 días");if(roomId()){openTour("pre")}else openTour("home",true)});return}
  if(k==="key2"){const em=$("trE").value.trim(),pw=$("trW").value;if(!em||!pw){say("Escribe tu correo y contraseña");return}
    api("login",{email:em,password:pw}).then(async r=>{if(!r.ok){say(r.error||"Correo o contraseña incorrectos");return}await loadMe();say("Bienvenido de nuevo");if(acct&&acct.expired){openTour("plans",true);return}if(roomId())openTour("pre");else openTour("home",true)});return}
  openTour(k,trLock)});
async function tourInit(){await Promise.all([loadMe(),loadPrices()]);
  if(acct)ownKey();
  if(/[?&]pago=ok/.test(location.search)){say("¡Pago recibido! Actualizando tu saldo…");try{history.replaceState(null,"",location.pathname+location.hash)}catch(e){}setTimeout(loadMe,3000);setTimeout(loadMe,9000)}
  if(/[?&]reg=1/.test(location.search)&&!acct){openTour("reg",true);return}
  if(/[?&]out=1/.test(location.search)){try{history.replaceState(null,"","app.html")}catch(e){}setTimeout(()=>say("Sesión cerrada"),400)}
  if(/[?&]go=1/.test(location.search)&&acct&&!roomId()){startOwn();return}
  if(acct&&acct.expired){openTour("plans",true);say("Tu plan terminó");return}
  if(roomId()){preShown=true;openTour("pre",true);return}
  openTour(acct?"home":"welcome",true)}
const LB={vista:"Vista",mic:"Micro",cam:"Cámara",share:"Pantalla",hand:"Mano",mod:"Sala",chat:"Chat",leave:"Salir"};
function cmTick(){let b=$("cmb");if(!b){b=document.createElement("span");b.id="cmb";b.className="role";document.querySelector("h1").appendChild(b)}
  const s=Math.ceil((cm-Date.now())/1e3);if(s<=0){cm=0;clearInterval(cmT);b.hidden=true;say("Modo CONNECT terminado");return}
  b.hidden=false;b.textContent="CONNECT "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function toggleConnect(){if(cm>Date.now()){say("El modo CONNECT dura 15 min completos");return}
  cm=Date.now()+9e5;if(waiting.length){waiting.forEach((id,i)=>giftIn(id,[1,2,5][i%3]));list.push(...waiting);n+=waiting.length;say(waiting.length+" miembros entraron sin permiso");waiting=[];render()}else say("Modo CONNECT activo · 15 min");
  cmTick();clearInterval(cmT);cmT=setInterval(cmTick,1e3)}
/* ===== Entrada con Connect: saldo, regalo al anfitrión y panel del anfitrión ===== */
const demoW={plan:"vip",t:3,c:6,ul:false},wal=()=>demoW;
function giftIn(id,q){rcv+=q;const w=wal();w.c=(w.c||0)+q;gl.unshift({n:person(id).n,q})}
function connRows(){return `<h3>Connect recibidos · ${rcv}</h3>`+(gl.length?gl.slice(0,5).map(x=>`<div class="row"><span>${x.n}<small>Entró con Connect</small></span><b>★ ${x.q}</b></div>`).join(""):`<p>Aún no recibes regalos.</p>`)}
function entSheet(h,p,f){const w=wal(),c=w.c||0,cost=(w.ul?0:1)+gift;
  h.textContent="Entrar con Connect";p.textContent="SUITE de "+NAMES[2]+". Entras directo, sin esperar permiso.";
  f.innerHTML=`<div class="row"><span>Tu saldo<small>${c} Connect · ${w.t||0} timbres${w.ul?" · acceso ilimitado":""}</small></span></div><h3>Regalo para el anfitrión</h3>`+chips("gift",[["1","1"],["2","2"],["3","3"],["5","5"]],String(gift))+`<p>Total: ${cost} Connect (${w.ul?"acceso ilimitado":"1 de entrada"} + ${gift} de regalo)</p>`+(c>=cost?`<button class="tr-b" data-a="goin">Entrar con Connect</button>`:`<p>Te faltan ${cost-c} Connect.</p><button class="tr-b" data-a="plans">Ver planes</button>`)}
function enterConnect(){const w=wal(),cost=(w.ul?0:1)+gift;if((w.c||0)<cost){say("Te faltan "+(cost-(w.c||0))+" Connect");return}
  w.c-=cost;if(acct)saveA();let b=$("gfb");if(!b){b=document.createElement("span");b.id="gfb";b.className="role";document.querySelector("h1").appendChild(b)}b.textContent="★ "+gift;closeS();say("Entraste a la sala de "+NAMES[2]+" · regalaste "+gift+" Connect")}
/* ===== Panel de dueño (llave de demostración; la real vive en el servidor) ===== */

const AL=[],REP=[{n:"Sala de Omar",t:"Lenguaje ofensivo",d:0},{n:"1:1 de Hugo",t:"Cobro duplicado",d:0},{n:"Sala de Leo",t:"Spam de timbres",d:0}];
const admLog=t=>{AL.unshift(new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})+" · "+t);if(AL.length>6)AL.pop()};
const ownBtn=()=>{$("tAd").hidden=!owner;document.body.classList.toggle("own",owner)};
$("tAd").innerHTML=svg("shield");$("tAd").onclick=()=>{pulse($("tAd"));open("admin")};
async function admSheet(h,p,f){h.textContent="Panel de dueño";p.textContent="Datos reales de tu servidor. Solo tú ves esto.";f.innerHTML="<p>Cargando…</p>";
  const r=await api("admin");if(!r.ok){f.innerHTML="<p>No se pudo cargar el panel.</p>";return}
  const k=(a,b)=>`<div class="row"><span>${a}<small>${b}</small></span></div>`;
  f.innerHTML=k("Usuarios",r.users+" · "+r.active7+" activos en 7 días")+k("Ingresos",(Object.entries(r.revenue||{}).map(([c,v])=>c==="usd"?(v/100).toFixed(2)+" USD":v+" MXN").join(" · ")||"$0")+" · "+r.orders+" pagos")+
  `<h3>Pagos por aprobar · ${(r.manual||[]).length}</h3>`+((r.manual||[]).length?r.manual.map(x=>`<div class="row"><span>${esc(x.name)} · ${esc(x.pname)} · $${esc(x.amount)} MXN<small>${esc(x.code)} · ${esc(x.email)} · ${x.paid_at?"avisó que ya pagó":"sin avisar"}${x.ref?" · rastreo "+esc(x.ref):""}</small></span><button class="orb sm" data-m="ok" data-code="${esc(x.code)}" aria-label="Aprobar pago">${svg("ok")}</button><button class="orb sm" data-m="no" data-code="${esc(x.code)}" aria-label="Rechazar pago">${svg("ban")}</button></div>`).join(""):"<p>No hay pagos pendientes.</p>")+
  `<h3>Reportes abiertos · ${r.reports.length}</h3>`+(r.reports.length?r.reports.map(x=>`<div class="row"><span>${esc(x.room||"sala")}<small>${esc(x.reason)} · ${esc(x.target)}</small></span><button class="orb sm" data-a="adm" data-k="rep" data-i="${x.id}" aria-label="Resolver reporte">${svg("ok")}</button></div>`).join(""):"<p>No hay reportes pendientes.</p>")+
""}
$("sf").addEventListener("click",e=>{const b=e.target.closest("[data-m]");if(!b)return;const k=b.dataset.m,code=b.dataset.code;
  if(!b.classList.contains("arm")){b.classList.add("arm");say(k==="ok"?"Toca de nuevo para APROBAR y activar el plan":"Toca de nuevo para rechazar");setTimeout(()=>b.classList.remove("arm"),3000);return}
  api("admin",{action:k==="ok"?"approve":"reject",code}).then(r=>{say(r.ok?(k==="ok"?"Plan activado":"Pedido rechazado"):(r.error||"No se pudo"));open("admin")})});
function admAct(k,id){if(k==="rep"){api("admin",{action:"resolve",id}).then(()=>open("admin"))}
  else{role=k;n=6;reset();muted=new Set([1,4,7]);raised=new Set([2,5]);if(k==="host"&&!waiting.length)waiting=[100,101,102];admLog("Sala de prueba como "+(k==="host"?"anfitrión":"miembro"));dock();render();closeS();say("Entraste como "+(k==="host"?"anfitrión":"miembro")+" de prueba")}}
ownBtn();
$("tVw").innerHTML=svg("grid")+'<span class="lb">Vista</span>';$("tVw").onclick=()=>{pulse($("tVw"));open("view")};
$("tFl").innerHTML=svg("float")+'<span class="lb">Flotar</span>';try{floatMe=localStorage.getItem("ss-float")==="1"}catch(e){}
$("tFl").onclick=()=>{floatMe=!floatMe;try{localStorage.setItem("ss-float",floatMe?"1":"0")}catch(e){}pulse($("tFl"));render();say(floatMe?"Tu cámara flota: arrástrala donde quieras":"Tu cámara vuelve a la cuadrícula");show()};
$("tIn").innerHTML=svg("invite")+'<span class="lb">Invitar</span>';$("tIn").onclick=()=>{pulse($("tIn"));inviteLink()};
/* ===== Deslizar hacia abajo = actualizar sin cortar las cámaras ===== */
const setTitle=t=>{};
const hasName=()=>{if(myName)return true;try{return !!localStorage.getItem("suite-name")}catch(e){return false}};
const ptr=document.createElement("div");ptr.id="ptr";document.body.appendChild(ptr);
function softRefresh(){say("Actualizando…");
  try{$("vid").srcObject=stream;$("vid").play().catch(()=>{})}catch(e){}
  const tr=stream&&stream.getVideoTracks()[0];
  if(tr&&tr.readyState==="ended"){realCam().then(ok=>{if(ok)Object.values(PR).forEach(e=>{const pc=e.call&&e.call.peerConnection;if(pc)pc.getSenders().forEach(x=>{const t=stream.getTracks().find(y=>x.track&&y.kind===x.track.kind);if(t)x.replaceTrack(t)})})})}
  if(net&&net.id&&!joining){if(net.disconnected){try{net.reconnect()}catch(e){}}
    const k=+net.id.split("-").pop(),R=roomId();
    for(let j=1;j<=MAXP;j++){if(j===k)continue;const e=PR[200+j],pc=e&&e.call&&e.call.peerConnection,cs=pc&&pc.iceConnectionState;
      if(!e||!e.stream||cs==="failed"||cs==="closed"||cs==="disconnected"){if(pc&&cs==="disconnected"){try{pc.restartIce()}catch(x){}}else{if(e&&e.call){try{e.call.close()}catch(x){}}dial(net,R,j)}}}}
  document.querySelectorAll("video").forEach(v=>{if(v.srcObject&&v.id!=="vid"){const x=v.srcObject;v.srcObject=null;v.srcObject=x;v.play().catch(()=>{})}});
  render()}
let py=null,pd=0;
addEventListener("touchstart",e=>{const t=e.touches[0];py=(e.touches.length===1&&t.clientY<innerHeight*.3&&!e.target.closest("#sheet,#tour"))?t.clientY:null;pd=0},{passive:true});
addEventListener("touchmove",e=>{if(py==null)return;pd=e.touches[0].clientY-py;ptr.textContent=pd>110?"Suelta para actualizar":"Desliza para actualizar";ptr.classList.toggle("on",pd>40)},{passive:true});
addEventListener("touchend",()=>{if(py!=null&&pd>110)softRefresh();py=null;pd=0;ptr.classList.remove("on")},{passive:true});
addEventListener("hashchange",()=>{if(roomId()&&!net){role="guest";preShown=false;tryStart()}});
if(roomId())role="guest";

/* ===== Avisos, admisión del anfitrión, espera ===== */
let noteA=[],waitT=null;
function setNote(h,acts,ms){const e=$("note");noteA=acts||[];e.innerHTML=`<span>${h}</span>`+noteA.map((a,i)=>`<button type="button" data-i="${i}"${a[2]?' class="p"':""}>${a[0]}</button>`).join("");e.classList.add("on");clearTimeout(noteT);
  if(ms)noteT=setTimeout(()=>{e.classList.remove("on");if(knocks.length)showKnock()},ms)}
function note(t,acts,ms){if(knocks.length){say(t);return}setNote(esc(t),acts,ms)}
$("note").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const a=noteA[+b.dataset.i];$("note").classList.remove("on");clearTimeout(noteT);a&&a[1]()});
function showKnock(){const k=knocks[0];if(!k){if(noteA.length&&noteA[0]&&noteA[0][0]==="Admitir")$("note").classList.remove("on");return}
  setNote(`<b>${esc(k.name)}</b> quiere entrar${knocks.length>1?" · +"+(knocks.length-1):""}`,[["Admitir",()=>admit(k.slot),1],["Rechazar",()=>deny(k.slot)]],0)}
function knock(slot,name){const nmn=clean(name)||"Alguien";knocks=knocks.filter(x=>x.slot!==slot);knocks.push({slot,name:nmn});showKnock();snd("knock");vibe([200,100,200,100,300]);notify("Alguien quiere entrar",nmn,"knock")}
function later(id,m,k){k=k||14;if(CN[id]&&CN[id].open)sendTo(id,m);else if(k>0)setTimeout(()=>later(id,m,k-1),500)}
function admit(slot){knocks=knocks.filter(x=>x.slot!==slot);ADM.add(slot);const c=HELD[slot];delete HELD[slot];
  if(c){try{c.answer(stream,{sdpTransform:sdpT});addPeer(c.peer,c,c.metadata&&c.metadata.n)}catch(e){}}
  const present=[mySlot,...list.map(x=>x-200)].filter((x,i,a)=>x>0&&a.indexOf(x)===i);
  later(200+slot,{t:"in",s:present});list.forEach(x=>{if(x!==200+slot)later(x,{t:"adm",s:slot})});showKnock()}
function deny(slot){knocks=knocks.filter(x=>x.slot!==slot);const c=HELD[slot];delete HELD[slot];later(200+slot,{t:"deny"});setTimeout(()=>{try{c&&c.close()}catch(e){}},600);showKnock()}
function waitUI(){const w=$("wait");w.innerHTML='<div class="sp"></div><p>Esperando a que el anfitrión te deje entrar…</p><div class="bs"><button type="button" id="wX">Cancelar</button></div>';w.classList.add("on");
  $("wX").onclick=()=>endCall("Saliste","No entraste a la sala.");clearTimeout(waitT);
  waitT=setTimeout(()=>{if(!joining)return;w.innerHTML='<p>El anfitrión no ha respondido.</p><div class="bs"><button type="button" class="p" id="wR">Seguir esperando</button><button type="button" id="wX2">Salir</button></div>';
    $("wR").onclick=waitUI;$("wX2").onclick=()=>endCall("Saliste","No entraste a la sala.")},60000)}
$("eInv").onclick=()=>inviteLink();
addEventListener("pagehide",()=>{try{bcast({t:"leave"})}catch(e){}});
/* ===== Mi imagen (PiP): toque = verme grande, arrastrar = mover, mantener = tamaño ===== */
(function(){const me=$("me");let d=null;
  me.addEventListener("pointerdown",e=>{e.stopPropagation();const r=me.getBoundingClientRect();d={x:e.clientX,y:e.clientY,l:r.left,t:r.top,w:r.width,h:r.height,m:false,T:Date.now()};try{me.setPointerCapture(e.pointerId)}catch(x){}});
  me.addEventListener("pointermove",e=>{if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.m&&Math.hypot(dx,dy)<9)return;d.m=true;me.classList.add("drag");
    const x=Math.max(6,Math.min(innerWidth-d.w-6,d.l+dx)),y=Math.max(6,Math.min(innerHeight-d.h-6,d.t+dy));
    me.style.setProperty("left",x+"px","important");me.style.setProperty("top",y+"px","important");me.style.setProperty("right","auto","important");me.style.setProperty("bottom","auto","important")});
  const end=e=>{if(!d)return;const o=d;d=null;me.classList.remove("drag");
    if(o.m){const r=me.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;["left","top","right","bottom"].forEach(k=>me.style.removeProperty(k));
      me.classList.remove("c-tr","c-tl","c-br","c-bl");me.classList.add("c-"+(cy<innerHeight/2?"t":"b")+(cx<innerWidth/2?"l":"r"));return}
    if(e.type==="pointercancel")return;
    if(Date.now()-o.T>500){const c=me.classList.contains("s2")?"s0":me.classList.contains("s0")?"":"s2";me.classList.remove("s0","s2");if(c)me.classList.add(c);return}
    viewMain=true;selfV=true;render();show();say("Te ves en grande · toca a otra persona o el botón de cuadrícula para volver")};
  me.addEventListener("pointerup",end);me.addEventListener("pointercancel",end)})();
/* ===== Pantalla principal: deslizar para cambiar de persona, doble toque = ajustar imagen ===== */
function cycle(dir){const order=[...list,-1];if(order.length<2||moment==="p")return;const cur=selfMain()?-1:mainId(),i=order.indexOf(cur),nx=order[(i+dir+order.length)%order.length];
  viewMain=true;if(nx===-1)selfV=true;else{selfV=false;if(focus!=null)focus=nx;else{active=list.indexOf(nx);pinUntil=Date.now()+25000}}render();show()}
(function(){const m=$("main");let s=null,last=0,lx=0,ly=0;
  m.addEventListener("pointerdown",e=>{s={x:e.clientX,y:e.clientY,T:Date.now()}});
  m.addEventListener("pointerup",e=>{if(!s)return;const o=s,dx=e.clientX-o.x,dy=e.clientY-o.y;s=null;
    if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){cycle(dx<0?1:-1);return}
    if(Math.hypot(dx,dy)<10&&Date.now()-o.T<300){const now=Date.now();if(now-last<320&&Math.hypot(e.clientX-lx,e.clientY-ly)<40){last=0;$("tFi").click();return}last=now;lx=e.clientX;ly=e.clientY}});
  m.addEventListener("pointercancel",()=>{s=null})})();

/* ===== Cuadrícula: todos visibles a la vez, se acomoda sola (vertical, horizontal, computadora) ===== */
const GT={};
const gcd=(a,b)=>b?gcd(b,a%b):a;
function gridPlan(N,W,H){let best=null;for(let c=1;c<=N;c++){const r=Math.ceil(N/c),a=(W/c)/(H/r),sc=Math.abs(Math.log(a/1.4))+(c*r-N)*.25;if(!best||sc<best.sc)best={r,sc}}
  const r=best.r;return Array.from({length:r},(_,i)=>Math.floor(N/r)+(i<N%r?1:0))}
function gridRender(){const g=$("grid"),ids=list.length?(floatMe?[...list]:[-1,...list]):[-1],N=ids.length;
  const sizes=gridPlan(N,g.clientWidth||innerWidth,g.clientHeight||innerHeight),L=sizes.reduce((a,b)=>a*b/gcd(a,b),1);
  g.style.gridTemplateColumns=`repeat(${L},1fr)`;g.style.gridTemplateRows=`repeat(${sizes.length},1fr)`;
  Object.keys(GT).forEach(k=>{if(!ids.includes(+k)){GT[k].remove();delete GT[k]}});
  let idx=0;sizes.forEach(sz=>{for(let k=0;k<sz;k++,idx++){const id=ids[idx];let t=GT[id];
    if(!t){t=GT[id]=document.createElement("div");t.className="gt"+(id===-1?" self":"");t.dataset.i=id;t.setAttribute("role","button");
      t.innerHTML='<b class="gi"></b><video muted autoplay playsinline></video><span class="gn"></span><em class="gb"></em>'}
    const q=person(id),v=t.querySelector("video"),src=SRC(id),cam=!!src&&(id===-1?st.cam:true);
    t.style.gridColumn="span "+(L/sz);t.classList.toggle("r0",idx<sizes[0]);t.style.background=tint(q);
    t.querySelector(".gi").textContent=q.n[0];t.querySelector(".gn").textContent=id===-1?"Tú":q.n;
    t.classList.toggle("off",!cam);if(cam&&v.srcObject!==src){v.srcObject=src;v.play().catch(()=>{})}else if(!cam&&v.srcObject&&id===-1){v.pause()}else if(cam&&v.paused)v.play().catch(()=>{});
    const off=id===-1?!st.mic:muted.has(id);t.querySelector(".gb").innerHTML=(off?svg("mic",1):"")+(id!==-1&&raised.has(id)||id===-1&&st.hand?svg("hand"):"");
    if(g.children[idx]!==t)g.insertBefore(t,g.children[idx]||null)}})}
let uiWas=true;
$("grid").addEventListener("pointerdown",()=>{uiWas=$("ui").classList.contains("show")},true);
$("grid").addEventListener("click",e=>{const t=e.target.closest(".gt");if(!t||!uiWas)return;const id=+t.dataset.i;selfV=id===-1;focus=id===-1?null:id;viewMain=true;pinUntil=Infinity;render();show()});
addEventListener("resize",()=>{if(B.classList.contains("grid"))gridRender()});

/* ===== Compartir, cuenta y ajustes ===== */
let INVD=null;
async function inviteSheet(h,p,f){h.textContent="Invitar a tu SUITE";f.innerHTML="<p>Cargando…</p>";const d=INVD=await inviteData();
  if(!d||role!=="host"){p.textContent="Solo el anfitrión puede invitar.";f.innerHTML="";return}
  p.textContent="Cada persona espera tu aprobación para entrar.";
  f.innerHTML=`<div class="kv"><span>Código de SUITE</span><b>${d.code}</b></div><div class="kv"><span>Clave</span><b>${d.pass}</b></div>${shrHTML()}<div class="row2"><button class="tr-g" data-sh="link">Copiar enlace</button><button class="tr-g" data-sh="code">Copiar código y clave</button></div><p>El enlace entra directo con la clave. Si prefieres, comparte solo el código y la clave por separado.</p><div class="row2"><button class="tr-g" data-a="shareapp">Compartir la app</button>${isApp()?"":`<button class="tr-g" data-a="instapp">Instalar la app</button>`}</div>`}
$("sf").addEventListener("click",async e=>{const b=e.target.closest("[data-sh]");if(!b||!INVD)return;const k=b.dataset.sh,d=INVD;
  const msg=d.app?`Instala spaceSUITE: videollamadas privadas 🔒\n${d.link}`:`Te invito a mi SUITE en spaceSUITE 🔒\nCódigo: ${d.code}\nClave: ${d.pass}\nEntra directo: ${d.link}`,E=encodeURIComponent,go=u=>{const a=document.createElement("a");a.href=u;a.target="_blank";a.rel="noopener noreferrer";document.body.appendChild(a);a.click();a.remove()};
  const cp=async t=>{try{await navigator.clipboard.writeText(t);say("Copiado")}catch(er){prompt("Copia:",t)}};
  if(k==="native"){if(navigator.share){try{await navigator.share({title:"spaceSUITE",text:msg})}catch(er){}}else cp(msg)}
  else if(k==="wa")go("https://wa.me/?text="+E(msg));else if(k==="tg")go("https://t.me/share/url?url="+E(d.link)+"&text="+E(d.app?"Instala spaceSUITE 🔒":`Te invito a mi SUITE en spaceSUITE 🔒\nCódigo: ${d.code}\nClave: ${d.pass}`));
  else if(k==="x")go("https://twitter.com/intent/tweet?text="+E(`${d.app?"Instala spaceSUITE":"Te invito a mi SUITE en spaceSUITE"} 🔒 ${d.link}`));
  else if(k==="gm")go("https://mail.google.com/mail/?view=cm&fs=1&su="+E("Te invito a mi SUITE")+"&body="+E(msg));
  else if(k==="mail")location.href="mailto:?subject="+E("Te invito a mi SUITE")+"&body="+E(msg);
  else if(k==="sms")location.href="sms:?&body="+E(msg);
  else if(k==="link")cp(d.link);else if(k==="code")cp(`Código: ${d.code}\nClave: ${d.pass}`)});
let DIP=null;const isApp=()=>{try{return matchMedia("(display-mode: standalone)").matches||navigator.standalone===true}catch(e){return false}};
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
addEventListener("beforeinstallprompt",e=>{e.preventDefault();DIP=e;instUI()});addEventListener("appinstalled",()=>{DIP=null;say("spaceSUITE instalada");instUI()});
async function installApp(){if(DIP){DIP.prompt();try{await DIP.userChoice}catch(e){}DIP=null;instUI();return}open("install")}
const instUI=()=>{document.querySelectorAll("[data-n=inst],#tIs").forEach(b=>b.hidden=isApp())};
function installSheet(h,p,f){h.textContent="Instalar spaceSUITE";const ios=isIOS();p.textContent="Se instala en un momento y queda como una app más en tu pantalla de inicio.";
  f.innerHTML=ios?'<div class="kv st"><span>1</span><b>Toca Compartir (cuadro con flecha)</b></div><div class="kv st"><span>2</span><b>Añadir a pantalla de inicio</b></div><div class="kv st"><span>3</span><b>Toca Añadir</b></div><p>Usa Safari para que aparezca esa opción.</p>':'<div class="kv st"><span>1</span><b>Menú del navegador (⋮)</b></div><div class="kv st"><span>2</span><b>Instalar app / Añadir a pantalla de inicio</b></div><div class="kv st"><span>3</span><b>Confirmar</b></div><p>Si no ves la opción, abre el enlace en Chrome o Brave.</p>'}
const SHI={
native:['Compartir','<svg viewBox="0 0 24 24" fill="none" stroke="#3ee6b4" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m-4.5 4.5L12 3l4.5 4.5M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>'],
wa:['WhatsApp','<svg viewBox="0 0 24 24"><path fill="#25D366" d="M12 2.5a9.4 9.4 0 0 0-8.1 14.2L2.6 21.5l4.9-1.3A9.4 9.4 0 1 0 12 2.5Z"/><path fill="#fff" d="M8.6 7.6c-.3.3-.9 1-.8 2 .2 1.7 1.7 3.9 3.5 5 1.4.9 2.6 1.1 3.4.9.8-.2 1.3-.9 1.4-1.4 0-.2 0-.4-.2-.5l-1.7-.8c-.2-.1-.4 0-.5.1l-.7.8c-1.1-.5-2-1.4-2.4-2.4l.7-.7c.1-.1.2-.3.1-.5l-.8-1.7c-.1-.2-.3-.3-.5-.3-.4 0-.7 0-.8.1Z"/></svg>'],
tg:['Telegram','<svg viewBox="0 0 24 24"><path fill="#29A9EB" d="M21.6 3.9 2.9 11.1c-.8.3-.8 1.4 0 1.7l4.7 1.5 1.8 5.6c.2.6 1 .8 1.4.3l2.6-2.5 4.7 3.5c.6.4 1.4.1 1.6-.6l3-15.2c.2-.8-.6-1.5-1.4-1.1Z"/><path fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" d="M8 14.4 17.4 8"/></svg>'],
x:['X','<svg viewBox="0 0 24 24"><path fill="#fff" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.2 21H2l7.2-8.2L1.5 3h6.4l4.4 5.8ZM16.7 19.2h1.7L6.9 4.7H5.1Z"/></svg>'],
gm:['Gmail','<svg viewBox="0 0 24 24"><rect x="2" y="4.5" width="20" height="15" rx="2.2" fill="#fff"/><path fill="none" stroke="#EA4335" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M3 6.8 12 13.6l9-6.8"/><path stroke="#EA4335" stroke-width="2.4" stroke-linecap="round" d="M3 7v11M21 7v11"/></svg>'],
mail:['iCloud','<svg viewBox="0 0 24 24"><path fill="#3BA2F5" d="M7.2 19a4.4 4.4 0 0 1-.7-8.7A6 6 0 0 1 18 9.6 4.7 4.7 0 0 1 17.3 19Z"/></svg>'],
sms:['SMS','<svg viewBox="0 0 24 24"><path fill="#34C759" d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v9a2.5 2.5 0 0 1-2.5 2.5h-7.2L7 21.2v-3.7H5A2.5 2.5 0 0 1 2.5 15V6A2.5 2.5 0 0 1 5 3.5Z"/><circle cx="8" cy="10.5" r="1.2" fill="#fff"/><circle cx="12" cy="10.5" r="1.2" fill="#fff"/><circle cx="16" cy="10.5" r="1.2" fill="#fff"/></svg>']};
const shrHTML=()=>'<div class="shr">'+Object.entries(SHI).map(([k,[l,i]])=>`<button type="button" data-sh="${k}" aria-label="${l}">${i}<span>${l}</span></button>`).join("")+'</div>';
function appShare(){open("shareapp")}
function appShareSheet(h,p,f){INVD={app:true,link:location.origin+"/"};h.textContent="Compartir spaceSUITE";p.textContent="Manda el enlace de la app a quien quieras.";
  f.innerHTML=`<div class="kv"><span>Enlace</span><b>${esc(location.host)}</b></div>${shrHTML()}<div class="row2"><button class="tr-g" data-sh="link">Copiar enlace</button></div>`}
function fillLobby(){inviteData().then(d=>{const c=$("lbk");if(!c||!d)return;c.innerHTML=`<span>Mi SUITE · siempre la misma</span><b>${d.code}</b><small>Clave ${d.pass}</small><button data-n="cpk" type="button">Copiar código y clave</button>`})}
function acctSheet(h,p,f){h.textContent=acct?acct.n:"Mi cuenta";const k=(a,b)=>`<div class="row"><span>${a}<small>${b}</small></span></div>`;
  if(!acct){p.textContent="Entra o crea tu cuenta.";f.innerHTML=mrow("Crear cuenta","Prueba gratis de 3 días","reg",svg("ok"))+mrow("Ya tengo cuenta","Entrar con correo y contraseña","login",svg("ok"))+mrow("Sonidos y avisos","Sonido, vibración y notificaciones","prefs",svg("bell"));return}
  const pl={free:"Prueba gratis",vip:"VIP",c14:"Connect 14 días",c30:"Connect 30 días",c90:"Connect 3 meses",none:"Sin plan"}[acct.plan]||"",d=acct.until>Date.now()?Math.ceil((acct.until-Date.now())/864e5)+" días restantes":"Vencido";
  p.textContent=owner?"Dueño · acceso total":pl+" · "+d;
  f.innerHTML=k("Timbres",acct.t)+k("Connect",acct.c)+mrow("Planes","Cambiar o renovar tu plan","plans",svg("ok"))+mrow("Nombre en las salas","Cámbialo si quieres otro nombre","alias",svg("ppl"))+mrow("Sonidos y avisos","Sonido, vibración y notificaciones","prefs",svg("bell"))+mrow("Compartir la app","Envía el enlace para instalarla","shareapp",svg("share"))+(isApp()?"":mrow("Instalar la app","Un toque y queda en tu pantalla","instapp",svg("ok")))+(owner?mrow("Panel de dueño","Usuarios, pagos y reportes","admin",svg("shield")):"")+mrow("Cerrar sesión","Sales de tu cuenta en este teléfono","logout",svg("leave"))}
function prefSheet(h,p,f){h.textContent="Sonidos y avisos";p.textContent="Controla cómo te avisa la app.";const sil=!PF.snd&&!PF.vib&&!PF.ntf;
  f.innerHTML=mrow("Modo silencio","Apaga sonidos, vibración y avisos","p-mute",svg(sil?"belloff":"bell"),sil)+mrow("Sonidos","Al tocar, entrar, salir y mensajes","p-snd",svg("bell"),!!PF.snd)+mrow("Vibración","Al tocar botones y cuando llega alguien","p-vib",svg("bell"),!!PF.vib)+mrow("Avisos del teléfono","Aunque la app esté cerrada","p-ntf",svg("bell"),!!PF.ntf)+(acct&&PF.ntf?mrow("Probar aviso ahora","Te mandamos una notificación de prueba","p-test",svg("bell")):"")}
let PF={snd:1,vib:1,ntf:1};try{Object.assign(PF,JSON.parse(localStorage.getItem("ss-pf")||"{}"))}catch(e){}
const savePF=()=>{try{localStorage.setItem("ss-pf",JSON.stringify(PF))}catch(e){}silIcon()};
const silIcon=()=>{const sil=!PF.snd&&!PF.vib&&!PF.ntf,b=$("tSn");b.innerHTML=svg(sil?"belloff":"bell");b.setAttribute("aria-pressed",sil)};
function toggleSilence(){const sil=!PF.snd&&!PF.vib&&!PF.ntf;if(sil){PF={snd:1,vib:1,ntf:1};say("Sonidos y avisos activados")}else{PF={snd:0,vib:0,ntf:0};say("Modo silencio")}savePF()}
const vibe=pt=>{if(PF.vib&&navigator.vibrate){try{navigator.vibrate(pt)}catch(e){}}};
function notify(t,b,tag){if(!PF.ntf||!document.hidden)return;try{document.title="● "+t;if("Notification" in window&&Notification.permission==="granted"){const o={body:b||"",icon:"icon-192.png",tag:tag||"ss",renotify:true,vibrate:[200,100,200]};
  if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(r=>r.showNotification(t,o)).catch(()=>{try{new Notification(t,o)}catch(e){}});else new Notification(t,o)}}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)document.title="spaceSUITE · Sala"});
async function logout(){await api("logout",{});try{localStorage.removeItem("suite-name");localStorage.removeItem("ss-alias")}catch(e){}try{bcast({t:"leave"})}catch(e){}try{leaveNet()}catch(e){}stopCam();location.replace("app.html?out=1")}
function hostAbsent(){const w=$("wait"),R=roomId();joining=false;clearTimeout(waitT);w.innerHTML='<p id="wT">El anfitrión todavía no abre esta SUITE.</p><div class="bs"><button type="button" class="p" id="wN">Avisarme cuando abra</button><button type="button" id="wR">Reintentar</button><button type="button" id="wX2">Salir</button></div>';w.classList.add("on");
  api("push",{action:"knock",room:R,name:nm()}).then(r=>{if(r&&r.sent&&$("wT"))$("wT").textContent="El anfitrión todavía no abre esta SUITE. Le acabamos de mandar un aviso a su teléfono."});
  $("wN").onclick=async()=>{try{if("Notification" in window&&Notification.permission==="default")await Notification.requestPermission()}catch(e){}const ok=await pushSub(R,"g");say(ok?"Listo: te avisamos aunque cierres la app":"Activa las notificaciones del navegador para este sitio")};
  $("wR").onclick=()=>location.reload();$("wX2").onclick=()=>endCall("Saliste","No entraste a la SUITE.")}
$("tSn").onclick=()=>{pulse($("tSn"));toggleSilence()};
$("tMe").onclick=()=>{pulse($("tMe"));open("acct")};
silIcon();
reset();dock();render();show();(()=>{const done=()=>document.body.classList.remove("boot");setTimeout(done,5000);Promise.resolve().then(tourInit).catch(()=>{}).finally(()=>setTimeout(done,60))})();

setInterval(()=>{if(net&&net.disconnected&&!net.destroyed)try{net.reconnect()}catch(e){}},5000);
addEventListener("online",()=>{if(net&&net.disconnected&&!net.destroyed)try{net.reconnect()}catch(e){}});
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&net&&!wl)keepAwake()});
if(!(navigator.mediaDevices&&navigator.mediaDevices.getDisplayMedia))B.classList.add("nosh");
if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
