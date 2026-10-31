self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json()}catch(x){d={title:'Aria',body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'Aria',{body:d.body||'',tag:d.tag,icon:'icon-192.png',badge:'icon-192.png'}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if('focus' in c)return c.focus()}return clients.openWindow('./')}));
});
