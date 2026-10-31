import webpush from 'web-push';
import ical from 'node-ical';
webpush.setVapidDetails('mailto:aria-push@users.noreply.github.com',process.env.VAPID_PUBLIC,process.env.VAPID_PRIVATE_KEY);
const WIN=15*60e3,now=Date.now(),TEST=process.env.TEST==='true';
const cfgs=[1,2,3].map(i=>process.env['PUSH_'+i]).filter(Boolean).map(s=>{try{return JSON.parse(s)}catch{console.log('설정값 형식 오류');return null}}).filter(Boolean);
const P=(ms,tz)=>{const o={};new Intl.DateTimeFormat('en-GB',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(ms).forEach(p=>o[p.type]=p.value);return o};
const day=(ms,tz)=>{const p=P(ms,tz);return p.year+'-'+p.month+'-'+p.day};
const hm=(ms,tz)=>{const p=P(ms,tz);return p.hour+':'+p.minute};
async function events(url,tz){
  const txt=await (await fetch(url.replace(/^webcal:/,'https:'))).text(),out=[];
  for(const v of Object.values(ical.sync.parseICS(txt))){
    if(v.type!=='VEVENT'||!v.start)continue;
    const allDay=v.datetype==='date',dur=(v.end?v.end-v.start:0);
    const add=(st)=>out.push({id:v.uid+st.getTime(),t:v.summary||'(제목 없음)',s:st.getTime(),allDay,ds:allDay?st.toISOString().slice(0,10):null});
    if(v.rrule){
      const ex=Object.values(v.exdate||{}).map(d=>d.toISOString().slice(0,10));
      for(const d of v.rrule.between(new Date(now-864e5),new Date(now+2*864e5),true)){if(!ex.includes(d.toISOString().slice(0,10)))add(d)}
    }else add(v.start);
  }
  return out;
}
async function send(c,title,body,tag){
  try{await webpush.sendNotification(c.sub,JSON.stringify({title,body,tag}),{TTL:3600,urgency:'high'});console.log('보냄:',title)}
  catch(e){console.log('실패',e.statusCode||'',e.body||e.message)}
}
for(const c of cfgs){
  if(!c.sub)continue;const tz=c.tz||'Asia/Seoul';
  if(TEST){await send(c,'Aria','테스트 알림이에요. 잘 도착했어요!','test');continue}
  let ev=[];if(c.ical){try{ev=await events(c.ical,tz)}catch(e){console.log('캘린더 읽기 실패',e.message)}}
  const today=day(now,tz),p=P(now,tz),mins=+p.hour*60+ +p.minute,[mh,mm]=(c.mt||'08:00').split(':').map(Number),tg=mh*60+mm;
  if(mins>=tg&&mins<tg+15){
    const L=ev.filter(x=>(x.allDay?x.ds:day(x.s,tz))===today).sort((a,b)=>a.s-b.s);
    const b=L.length?L.slice(0,6).map(x=>(x.allDay?'종일':hm(x.s,tz))+' '+x.t).join('\n')+(L.length>6?'\n외 '+(L.length-6)+'개':''):'오늘은 잡힌 일정이 없어요.';
    await send(c,'Aria · 오늘 일정 '+L.length+'개',b,'morning-'+today);
  }
  if(c.lead>0)for(const x of ev){
    if(x.allDay)continue;const r=x.s-c.lead*60e3;
    if(x.s>now&&r<=now&&r>now-WIN)await send(c,c.lead+'분 뒤 일정',hm(x.s,tz)+' '+x.t,'ev-'+x.id);
  }
}
