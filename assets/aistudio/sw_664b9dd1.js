// Service worker: permite instalar la app. Nunca guarda respuestas de /api (cuentas, saldo, panel).
const C = "spacesuite-v18";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(r).then((x) => { if (x.ok) { const y = x.clone(); caches.open(C).then((c) => c.put(r, y)); } return x; }).catch(() => caches.match(r)));
});

self.addEventListener("push",e=>{let d={};try{d=e.data.json()}catch(x){}
  e.waitUntil(self.registration.showNotification(d.t||"spaceSUITE",{body:d.b||"",icon:"icon-192.png",badge:"icon-192.png",tag:d.tag||"ss",renotify:true,vibrate:[200,100,200,100,300],data:{u:d.u||"/app.html"}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.u)||"/app.html";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l){if("focus" in c)return c.focus()}return self.clients.openWindow(u)}))});
