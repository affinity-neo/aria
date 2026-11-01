const ALLOWED_ORIGIN = "https://affinity-neo.github.io";

const LOW_MODEL = "google/gemma-4-26b-a4b-it:free";
const LOW_FALLBACK_MODEL = "z-ai/glm-5.3-flash:free";

const HIGH_MODEL = "anthropic/claude-sonnet-5.5";

const UPSTREAM_URL = "https://openrouter.ai/api/v1/chat/completions";

function corsHeaders(origin) {

  return {"Access-Control-Allow-Origin":origin===ALLOWED_ORIGIN?ALLOWED_ORIGIN:"null","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, X-Aria-Calendar-Key","Vary":"Origin"};

}

function json(data,status,origin) {

  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...corsHeaders(origin)}});

}

function extractJson(value) {

  const s=String(value||"").trim(),a=s.indexOf("{"),b=s.lastIndexOf("}");

  if(a<0||b<a)return null;

  try{return JSON.parse(s.slice(a,b+1));}catch(e){return null;}

}

async function callModel(model,messages,key,fallbackModels=[],maxTokens=1200){
  const modelList=[...new Set([model,...fallbackModels].filter(Boolean))];
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000);
    try{
      const response=await fetch(UPSTREAM_URL,{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","HTTP-Referer":"https://affinity-neo.github.io/aria/","X-OpenRouter-Title":"Aria Workspace"},body:JSON.stringify({models:modelList,messages,temperature:0.15,max_tokens:Math.max(1200,Math.min(9000,Number(maxTokens)||1200)),provider:{allow_fallbacks:true}}),signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const error=new Error("OpenRouter "+response.status+": "+String(data.error&&data.error.message||"요청 실패"));error.status=response.status;error.errorType=data.error&&data.error.metadata&&data.error.metadata.error_type||data.error&&data.error.code||"";error.retryAfter=response.headers.get("Retry-After")||"";error.requestId=response.headers.get("x-request-id")||response.headers.get("x-openrouter-generation-id")||"";throw error;}
      const answer=data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content;
      if(!answer){const error=new Error("모델 응답이 비어 있어요.");error.status=502;error.errorType="empty_response";throw error;}
      return {text:String(answer).trim(),model:data.model||model,generationId:data.id||""};
    }catch(error){
      lastError=error;const status=Number(error&&error.status||0);
      const retryable=error&&error.name==="AbortError"||[408,429,500,502,503,504].includes(status)||error&&error.name==="TypeError";
      if(attempt>=1||!retryable)break;
      const retryAfterSeconds=Number(error&&error.retryAfter||0);if(retryAfterSeconds>8)break;
      const delayMs=retryAfterSeconds>0?Math.max(500,retryAfterSeconds*1000):900*(attempt+1);
      await new Promise(resolve=>setTimeout(resolve,delayMs));
    }finally{clearTimeout(timer);}
  }
  throw lastError||new Error("OpenRouter 요청이 실패했어요.");
}

function logOpenRouterFailure(stage,model,error){
  console.warn("Aria OpenRouter request failed",{stage,model,status:error&&error.status||null,errorType:error&&error.errorType||"",requestId:error&&error.requestId||"",name:error&&error.name||"Error",message:String(error&&error.message||"요청 실패").slice(0,180)});
}
function openRouterUserMessage(error){
  if(error&&error.name==="AbortError")return "AI 답변 시간이 초과됐어요. 잠시 후 다시 시도해 주세요."; 
  const status=Number(error&&error.status||0);
  if(status===401||status===403)return "AI 서비스 인증에 문제가 있어요. Cloudflare의 OPENROUTER_API_KEY 설정을 확인해야 해요."; 
  if(status===402)return "AI 서비스 사용 한도 또는 결제 잔액을 확인해야 해요. OpenRouter 계정의 사용량을 확인해 주세요."; 
  if(status===429)return "AI 요청이 한꺼번에 몰렸어요. 잠시 뒤 다시 시도해 주세요."; 
  if([502,503,504].includes(status)||error&&error.errorType==="empty_response")return "AI 모델 서버가 잠시 응답하지 않았어요. 무료 대체 모델로도 다시 요청했지만 연결되지 않았어요. 잠시 후 다시 시도해 주세요."; 
  if(error&&error.name==="TypeError")return "AI 서비스 연결에 실패했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."; 
  return "AI 요청 처리 중 문제가 발생했어요. 잠시 뒤 다시 시도해 주세요."; 
}
/* Google Calendar: read-only OAuth, encrypted refresh tokens, user-selected calendars */

const GOOGLE_SCOPE="https://www.googleapis.com/auth/calendar.events";

const GOOGLE_APP_URL="https://affinity-neo.github.io/aria/";

function gcalReady(env){return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_TOKEN_ENCRYPTION_KEY&&env.GOOGLE_TOKENS);}

function gcalRedirect(request,env){return env.GOOGLE_REDIRECT_URI||new URL("/api/google/callback",request.url).href;}

function gcalB64(bytes){let binary="";for(const b of new Uint8Array(bytes))binary+=String.fromCharCode(b);return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}

function gcalUnB64(value){let s=value.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";let raw=atob(s),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}

function gcalKey(env){return crypto.subtle.digest("SHA-256",new TextEncoder().encode(env.GOOGLE_TOKEN_ENCRYPTION_KEY)).then(raw=>crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]));}

async function gcalSeal(value,env){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await gcalKey(env),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));return {iv:gcalB64(iv),data:gcalB64(cipher)};}

async function gcalOpen(value,env){const key=await gcalKey(env),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:gcalUnB64(value.iv)},key,gcalUnB64(value.data));return new TextDecoder().decode(plain);}

function gcalKeyValid(key){return /^[A-Za-z0-9_-]{40,80}$/.test(String(key||""));}

function gcalAppRedirect(env,status){const u=new URL(env.GOOGLE_APP_URL||GOOGLE_APP_URL);u.searchParams.set("gcal",status);return Response.redirect(u.href,302);}

async function gcalConnect(request,env,origin){

 if(!gcalReady(env))return json({error:"Google Calendar 서버 설정이 아직 필요해요. Cloudflare에 OAuth Secrets와 GOOGLE_TOKENS KV를 등록해 주세요."},503,origin);

 const input=await request.json().catch(()=>({})),clientKey=String(input.clientKey||"");

 if(!gcalKeyValid(clientKey))return json({error:"연결 키가 올바르지 않아요."},400,origin);

 const state=gcalB64(crypto.getRandomValues(new Uint8Array(32)));

 await env.GOOGLE_TOKENS.put("state:"+state,clientKey,{expirationTtl:600});

 const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");

 u.searchParams.set("client_id",env.GOOGLE_CLIENT_ID);u.searchParams.set("redirect_uri",gcalRedirect(request,env));

 u.searchParams.set("response_type","code");u.searchParams.set("scope",GOOGLE_SCOPE);

 u.searchParams.set("access_type","offline");u.searchParams.set("prompt","consent");

 u.searchParams.set("include_granted_scopes","true");u.searchParams.set("state",state);

 return json({authUrl:u.href},200,origin);

}

async function gcalCallback(request,env){

 const u=new URL(request.url),state=u.searchParams.get("state")||"",code=u.searchParams.get("code")||"";

 if(u.searchParams.get("error")||!gcalReady(env)||!state||!code)return gcalAppRedirect(env,"error");

 const clientKey=await env.GOOGLE_TOKENS.get("state:"+state);await env.GOOGLE_TOKENS.delete("state:"+state);

 if(!clientKey||!gcalKeyValid(clientKey))return gcalAppRedirect(env,"error");

 try{

  const form=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:gcalRedirect(request,env),grant_type:"authorization_code"});

  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});

  const tokens=await response.json().catch(()=>({}));if(!response.ok)throw new Error(tokens.error_description||tokens.error||"token_exchange_failed");

  const old=await env.GOOGLE_TOKENS.get("user:"+clientKey,"json");

  const refresh=tokens.refresh_token|| (old?await gcalOpen(old.refresh,env):"");

  if(!refresh)throw new Error("refresh_token_missing");

  const saved={refresh:await gcalSeal(refresh,env),calendarIds:old&&Array.isArray(old.calendarIds)?old.calendarIds:[],connectedAt:new Date().toISOString()};

  await env.GOOGLE_TOKENS.put("user:"+clientKey,JSON.stringify(saved));

  return gcalAppRedirect(env,"connected");

 }catch(e){return gcalAppRedirect(env,"error");}

}

async function gcalAccessToken(clientKey,env){

 const saved=await env.GOOGLE_TOKENS.get("user:"+clientKey,"json");if(!saved||!saved.refresh)return {error:"Google Calendar가 연결되지 않았어요."};

 const refresh=await gcalOpen(saved.refresh,env);

 const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refresh,grant_type:"refresh_token"})});

 const token=await response.json().catch(()=>({}));if(!response.ok)throw new Error(token.error_description||token.error||"Google 인증을 갱신하지 못했어요.");

 return {saved,accessToken:token.access_token};

}

async function gcalCalendars(request,env,origin){

 if(!gcalReady(env))return json({error:"Google Calendar 설정이 아직 준비되지 않았어요."},503,origin);

 const key=request.headers.get("X-Aria-Calendar-Key")||"";if(!gcalKeyValid(key))return json({error:"연결 키가 없거나 올바르지 않아요."},401,origin);

 try{

  const auth=await gcalAccessToken(key,env);if(auth.error)return json({error:auth.error},404,origin);

  let pageToken="",items=[];

  for(let page=0;page<4;page++){

   const u=new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");u.searchParams.set("maxResults","250");u.searchParams.set("showHidden","true");if(pageToken)u.searchParams.set("pageToken",pageToken);

   const r=await fetch(u.href,{headers:{Authorization:"Bearer "+auth.accessToken}}),d=await r.json().catch(()=>({}));

   if(!r.ok)throw new Error(d.error&&d.error.message||"캘린더 목록을 가져오지 못했어요.");

   items.push(...(d.items||[]).filter(x=>x.deleted!==true).map(x=>({id:x.id,summary:x.summary||x.id,primary:!!x.primary,backgroundColor:x.backgroundColor||"",accessRole:x.accessRole||""})));

   pageToken=d.nextPageToken||"";if(!pageToken)break;

  }

  return json({calendars:items,selectedCalendarIds:auth.saved.calendarIds||[]},200,origin);

 }catch(e){return json({error:String(e.message||"캘린더 목록을 가져오지 못했어요.")},502,origin);}

}

async function gcalSaveCalendars(request,env,origin){

 if(!gcalReady(env))return json({error:"Google Calendar 설정이 아직 준비되지 않았어요."},503,origin);

 const key=request.headers.get("X-Aria-Calendar-Key")||"";if(!gcalKeyValid(key))return json({error:"연결 키가 없거나 올바르지 않아요."},401,origin);

 const input=await request.json().catch(()=>({})),ids=Array.isArray(input.calendarIds)?[...new Set(input.calendarIds.map(String))].slice(0,40):null;

 if(!ids)return json({error:"선택한 캘린더 목록을 확인해 주세요."},400,origin);

 const saved=await env.GOOGLE_TOKENS.get("user:"+key,"json");if(!saved)return json({error:"Google Calendar가 연결되지 않았어요."},404,origin);

 saved.calendarIds=ids;await env.GOOGLE_TOKENS.put("user:"+key,JSON.stringify(saved));

 return json({ok:true,selectedCalendarIds:ids},200,origin);

}

async function gcalEvents(request,env,origin){

 if(!gcalReady(env))return json({error:"Google Calendar 설정이 아직 준비되지 않았어요."},503,origin);

 const key=request.headers.get("X-Aria-Calendar-Key")||"";if(!gcalKeyValid(key))return json({error:"연결 키가 없거나 올바르지 않아요."},401,origin);

 const u=new URL(request.url),timeMin=u.searchParams.get("timeMin"),timeMax=u.searchParams.get("timeMax");

 if(!timeMin||!timeMax||!Number.isFinite(Date.parse(timeMin))||!Number.isFinite(Date.parse(timeMax))||Date.parse(timeMax)<=Date.parse(timeMin))return json({error:"일정 조회 기간이 올바르지 않아요."},400,origin);

 try{

  const auth=await gcalAccessToken(key,env);if(auth.error)return json({error:auth.error},404,origin);

  const ids=auth.saved.calendarIds||[];if(!ids.length)return json({events:[],message:"선택한 캘린더가 없어요."},200,origin);

  const events=[];

  for(const calendarId of ids){

   let pageToken="";

   for(let page=0;page<4;page++){

    const api=new URL("https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(calendarId)+"/events");

    api.searchParams.set("timeMin",timeMin);api.searchParams.set("timeMax",timeMax);api.searchParams.set("singleEvents","true");api.searchParams.set("orderBy","startTime");api.searchParams.set("maxResults","2500");api.searchParams.set("showDeleted","false");if(pageToken)api.searchParams.set("pageToken",pageToken);

    const r=await fetch(api.href,{headers:{Authorization:"Bearer "+auth.accessToken}}),d=await r.json().catch(()=>({}));

    if(!r.ok)throw new Error(d.error&&d.error.message||"Google Calendar 일정을 가져오지 못했어요.");

    events.push(...(d.items||[]).filter(e=>e.status!=="cancelled").map(e=>({id:e.id,calendarId,summary:e.summary||"(제목 없음)",description:e.description||"",start:e.start||{},end:e.end||{},transparency:e.transparency||"opaque",status:e.status||"confirmed",extendedProperties:e.extendedProperties||{},htmlLink:e.htmlLink||""})));

    pageToken=d.nextPageToken||"";if(!pageToken)break;

   }

  }

  return json({events,fetchedAt:new Date().toISOString()},200,origin);

 }catch(e){return json({error:String(e.message||"Google Calendar 일정을 가져오지 못했어요.")},502,origin);}

}

async function gcalCreateEvent(request,env,origin){
 if(!gcalReady(env))return json({error:"Google Calendar 설정이 아직 준비되지 않았어요."},503,origin);
 const key=request.headers.get("X-Aria-Calendar-Key")||"";if(!gcalKeyValid(key))return json({error:"연결 키가 없거나 올바르지 않아요."},401,origin);
 const input=await request.json().catch(()=>({})),calendarId=String(input.calendarId||""),summary=String(input.summary||"").trim().slice(0,180),start=input.start,end=input.end;
 if(!calendarId||!summary||!start||!end||!start.dateTime||!end.dateTime||!Number.isFinite(Date.parse(start.dateTime))||!Number.isFinite(Date.parse(end.dateTime))||Date.parse(end.dateTime)<=Date.parse(start.dateTime))return json({error:"일정 이름과 시작·종료 시간을 확인해 주세요."},400,origin);
 try{
  const auth=await gcalAccessToken(key,env);if(auth.error)return json({error:auth.error},404,origin);
  if(!(auth.saved.calendarIds||[]).includes(calendarId))return json({error:"선택한 Google Calendar가 아니에요. 캘린더 선택을 다시 확인해 주세요."},403,origin);
  const body={summary,description:String(input.description||"").slice(0,3000),start,end};
  if(input.taskKey)body.extendedProperties={private:{ariaSource:"Aria Workspace",ariaTaskKey:String(input.taskKey).slice(0,100)}};
  const api="https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(calendarId)+"/events";
  const response=await fetch(api,{method:"POST",headers:{Authorization:"Bearer "+auth.accessToken,"Content-Type":"application/json"},body:JSON.stringify(body)}),event=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(event.error&&event.error.message||"Google Calendar에 일정을 저장하지 못했어요.");
  return json({event:{id:event.id,calendarId,summary:event.summary||summary,description:event.description||"",start:event.start||start,end:event.end||end,transparency:event.transparency||"opaque",status:event.status||"confirmed",extendedProperties:event.extendedProperties||{},htmlLink:event.htmlLink||""}},200,origin);
 }catch(e){return json({error:String(e.message||"Google Calendar 일정을 만들지 못했어요.")},502,origin);}
}

async function gcalUpdateEvent(request,env,origin){
 if(!gcalReady(env))return json({error:"Google Calendar 설정이 아직 준비되지 않았어요."},503,origin);
 const key=request.headers.get("X-Aria-Calendar-Key")||"";if(!gcalKeyValid(key))return json({error:"연결 키가 없거나 올바르지 않아요."},401,origin);
 const input=await request.json().catch(()=>({})),calendarId=String(input.calendarId||""),eventId=String(input.eventId||""),start=input.start,end=input.end;
 if(!calendarId||!eventId||!start||!end||!start.dateTime||!end.dateTime||!Number.isFinite(Date.parse(start.dateTime))||!Number.isFinite(Date.parse(end.dateTime))||Date.parse(end.dateTime)<=Date.parse(start.dateTime))return json({error:"변경할 일정의 시작·종료 시간을 확인해 주세요."},400,origin);
 try{
  const auth=await gcalAccessToken(key,env);if(auth.error)return json({error:auth.error},404,origin);
  if(!(auth.saved.calendarIds||[]).includes(calendarId))return json({error:"선택한 Google Calendar가 아니에요."},403,origin);
  const body={start,end};if(input.summary)body.summary=String(input.summary).trim().slice(0,180);
  const api="https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(calendarId)+"/events/"+encodeURIComponent(eventId);
  const response=await fetch(api,{method:"PATCH",headers:{Authorization:"Bearer "+auth.accessToken,"Content-Type":"application/json"},body:JSON.stringify(body)}),event=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(event.error&&event.error.message||"Google Calendar 일정을 수정하지 못했어요.");
  return json({event:{id:event.id,calendarId,summary:event.summary||input.summary||"",description:event.description||"",start:event.start||start,end:event.end||end,transparency:event.transparency||"opaque",status:event.status||"confirmed",extendedProperties:event.extendedProperties||{},htmlLink:event.htmlLink||""}},200,origin);
 }catch(e){return json({error:String(e.message||"Google Calendar 일정을 수정하지 못했어요.")},502,origin);}
}

function executionKeysFromText(value){
 const parsed=extractJson(value);
 if(!parsed||typeof parsed!=="object")return null;
 const keys=Array.isArray(parsed.taskKeys)?parsed.taskKeys:Array.isArray(parsed.order)?parsed.order:null;
 return keys?keys.map(x=>String(x)):null;
}
function validateExecutionKeys(keys,candidates){
 if(!Array.isArray(keys)||keys.length!==candidates.length)return false;
 const allowed=new Set(candidates.map(x=>String(x.key)));
 if(allowed.size!==candidates.length)return false;
 const seen=new Set();
 for(const key of keys){if(!allowed.has(key)||seen.has(key))return false;seen.add(key)}
 return seen.size===allowed.size;
}
async function rankExecutionCandidates(input,env,origin){
 const candidates=Array.isArray(input.candidates)?input.candidates:[],calendarEvents=Array.isArray(input.calendarEvents)?input.calendarEvents:[];
 if(!candidates.length)return json({error:"실행 순서를 정할 업무가 없어요."},400,origin);
 if(candidates.length>180)return json({error:"한 번에 정렬할 업무가 너무 많아요. 업무 필터를 적용한 뒤 다시 시도해 주세요."},413,origin);
 const keys=new Set();
 for(const item of candidates){if(!item||!/^T\d{3}$/.test(String(item.key||""))||keys.has(String(item.key))||!String(item.task||"").trim())return json({error:"업무 후보 데이터에 중복되거나 잘못된 항목이 있어요. 기존 실행 순서는 유지했어요."},400,origin);keys.add(String(item.key))}
 if(JSON.stringify({candidates,calendarEvents}).length>120000)return json({error:"전달할 업무와 캘린더 데이터가 너무 많아요."},413,origin);
 const system="너는 한국어 업무 실행 순서 전문가다. 업무 후보를 실제로 실행할 순서로 정렬한다. 반드시 JSON 객체 하나만 출력한다. 형식은 {\"taskKeys\":[\"T001\",\"T002\"]}이다. 설명, Markdown, 코드펜스, 숫자 순위, 업무 ID는 출력하지 않는다. 제공된 key를 그대로 사용하고, 모든 후보 key를 정확히 한 번씩 포함한다. 키를 중복하거나 누락하거나 새로 만들지 않는다. 기존 urgency는 중요한 참고 정보지만 실행 순위 번호로 바꾸거나 업무 데이터로 수정하지 않는다. 실행 예정일과 실제 마감일은 다르다. 실행 예정일은 실제 작업 날짜이며, 마감일이 멀다는 이유로 실행을 미루지 않는다. 실제 마감이 가까운 업무, 매출·수익·고객·출간·사업 결과에 직접 영향을 주는 업무, 다른 업무의 선행 조건인 업무, 대기 상태에서 재개 가능한 업무, 예상 시간이 짧아 빠르게 끝낼 수 있는 업무를 함께 고려한다. 캘린더 일정과 겹치는 시간에 업무를 배치하지 않는다.";
 const user="기준 날짜: "+String(input.today||"")+"\n캘린더 일정(읽기 전용, 보드 업무로 만들지 않음):\n"+JSON.stringify(calendarEvents)+"\n업무 후보(key마다 서로 다른 실제 업무):\n"+JSON.stringify(candidates)+"\n모든 key를 중복 없이 정확히 한 번씩만 넣어 가장 먼저 할 업무부터 정렬하세요.";
 const low=env.OPENROUTER_LOW_MODEL||LOW_MODEL,backup=env.OPENROUTER_LOW_FALLBACK_MODEL||LOW_FALLBACK_MODEL;
 const callMessages=[{role:"system",content:system},{role:"user",content:user}];
 const tokens=Math.min(9000,Math.max(1800,candidates.length*95));
 let result;
 try{result=await callModel(low,callMessages,env.OPENROUTER_API_KEY,backup===low?[]:[backup],tokens)}
 catch(error){logOpenRouterFailure("execution_order",low,error);return json({error:openRouterUserMessage(error),code:"execution_order_upstream_error"},502,origin)}
 let taskKeys=executionKeysFromText(result.text);
 if(!validateExecutionKeys(taskKeys,candidates)){
  const repair=[{role:"system",content:system},{role:"user",content:user},{role:"assistant",content:result.text.slice(0,12000)},{role:"user",content:"방금 결과는 사용할 수 없습니다. key 목록은 "+JSON.stringify(candidates.map(x=>x.key))+" 입니다. 모든 key를 중복 없이 정확히 한 번씩 넣어 {\"taskKeys\":[...]} JSON 하나만 다시 출력하세요."}];
  try{const repaired=await callModel(low,repair,env.OPENROUTER_API_KEY,backup===low?[]:[backup],tokens);const next=executionKeysFromText(repaired.text);if(validateExecutionKeys(next,candidates)){taskKeys=next;result=repaired}}
  catch(error){logOpenRouterFailure("execution_order_repair",low,error)}
 }
 if(!validateExecutionKeys(taskKeys,candidates))return json({error:"AI가 모든 업무를 중복 없이 정렬하지 못해 기존 실행 순서를 유지했어요. 다시 실행해 주세요.",code:"invalid_execution_order"},422,origin);
 return json({taskKeys,modelUsed:result.model||low,count:taskKeys.length},200,origin);
}

async function gcalDisconnect(request,env,origin){

 const input=await request.json().catch(()=>({})),key=String(input.clientKey||"");if(!gcalKeyValid(key))return json({error:"연결 키가 올바르지 않아요."},400,origin);

 const saved=await env.GOOGLE_TOKENS.get("user:"+key,"json");

 if(saved&&saved.refresh){try{const token=await gcalOpen(saved.refresh,env);await fetch("https://oauth2.googleapis.com/revoke?token="+encodeURIComponent(token),{method:"POST"})}catch(e){}}

 await env.GOOGLE_TOKENS.delete("user:"+key);return json({ok:true},200,origin);

}



export default {

  async fetch(request,env) {

    const url=new URL(request.url),origin=request.headers.get("Origin")||"";

    if(url.pathname==="/api/google/callback"&&request.method==="GET")return gcalCallback(request,env);

    if(origin!==ALLOWED_ORIGIN)return json({error:"허용되지 않은 사이트에서 요청했어요."},403,origin);

    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:corsHeaders(origin)});

    if(url.pathname==="/api/google/connect"&&request.method==="POST")return gcalConnect(request,env,origin);

    if(url.pathname==="/api/google/calendars"&&request.method==="GET")return gcalCalendars(request,env,origin);

    if(url.pathname==="/api/google/calendars/save"&&request.method==="POST")return gcalSaveCalendars(request,env,origin);

    if(url.pathname==="/api/google/events"&&request.method==="GET")return gcalEvents(request,env,origin);
    if(url.pathname==="/api/google/events/create"&&request.method==="POST")return gcalCreateEvent(request,env,origin);
    if(url.pathname==="/api/google/events/update"&&request.method==="POST")return gcalUpdateEvent(request,env,origin);

    if(url.pathname==="/api/google/disconnect"&&request.method==="POST")return gcalDisconnect(request,env,origin);

    if(url.pathname!=="/api/gemini")return json({error:"요청 주소를 확인해 주세요."},404,origin);

    if(request.method!=="POST")return json({error:"POST 요청만 허용돼요."},405,origin);

    if(!env.OPENROUTER_API_KEY)return json({error:"Cloudflare Worker에 OPENROUTER_API_KEY Secret을 등록해 주세요."},500,origin);

    try {

      const input=await request.json();
      if(input.mode==="execution_order")return rankExecutionCandidates(input,env,origin);
      const schedule=input.schedule,question=String(input.question||"").trim().slice(0,2000);

      if(!schedule||!Array.isArray(schedule.tasks))return json({error:"일정 데이터 형식이 올바르지 않아요."},400,origin);

      if(JSON.stringify(schedule).length>140000)return json({error:"전달할 업무 데이터가 너무 많아요."},413,origin);

      const history=Array.isArray(input.messages)?input.messages.slice(-12).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.content||"").slice(0,3000)})):[];

      const system=[

        "너는 Aria라는 한국어 업무·일정 관리 비서다. 친근하고 자연스럽게 존댓말로 짧게 대화한다.",

        "사용자의 최근 요청과 이전 대화, 아래 실제 보드 데이터를 함께 보고 의도를 파악한다. 별도 서비스의 채팅 기록을 안다고 주장하지 않는다.",

        "반드시 JSON 객체 하나만 반환한다. 형식: {\"reply\":\"자연스러운 답변\",\"action\":null 또는 작업 객체,\"confidence\":0.0~1.0,\"complex\":false}.",

        "업무 이동 action: {\"type\":\"move_task\",\"taskName\":\"실제 업무명\",\"fromGroup\":\"원래 그룹명 또는 빈 문자열\",\"toGroup\":\"대상 그룹명\"}.",

        "상태 변경 action: {\"type\":\"set_status\",\"taskName\":\"업무명\",\"fromGroup\":\"원래 그룹명\",\"status\":\"실제 상태\"}.",

        "마감일 변경 action: {\"type\":\"set_due\",\"taskName\":\"업무명\",\"fromGroup\":\"원래 그룹명\",\"deadline\":\"YYYY-MM-DD\"}.",

        "담당자 변경 action: {\"type\":\"set_assignee\",\"taskName\":\"업무명\",\"fromGroup\":\"원래 그룹명\",\"assignee\":\"담당자\"}. 완료 action: {\"type\":\"complete_task\",\"taskName\":\"업무명\",\"fromGroup\":\"원래 그룹명\"}.",




        "사용자가 'A 그룹 안에 있는 B 업무'라고 하면 fromGroup은 A, taskName은 B다. 업무명과 그룹명은 JSON에 있는 원문을 그대로 사용한다.",

        "업무 변경 요청이면 보고서나 전체 업무 목록을 출력하지 말고 action을 반환한다. 데이터에서 업무를 특정할 수 없으면 action=null로 두고 한 가지 확인 질문만 한다.",

        "조회/분석을 명시적으로 요청하지 않았다면 전체 업무 목록이나 우선순위 보고서를 만들지 않는다. 인사나 일반 질문에는 자연스럽게 답한다.",

        "복잡한 다단계 계획, 모호한 지시, 데이터 충돌, 낮은 확신일 때만 complex=true로 표시한다. 단순 업무 이동/상태/담당자/마감일 변경은 complex=false다.",

        "데이터에 없는 업무를 만들거나 실제 변경을 했다고 말하지 않는다. 브라우저가 action을 검증하고 실행한다."

      ].join("\n");

      const userContext="현재 시각: "+String(schedule.capturedAt||"")+"\n사용 가능한 그룹: "+JSON.stringify(schedule.groups||[])+"\n실제 업무 데이터(JSON):\n"+JSON.stringify(schedule)+"\n이번 요청: "+question;

      const messages=[{role:"system",content:system}].concat(history.filter(m=>m.content!==question),[{role:"user",content:userContext}]);

      const low=env.OPENROUTER_LOW_MODEL||LOW_MODEL;
      const lowFallback=env.OPENROUTER_LOW_FALLBACK_MODEL||LOW_FALLBACK_MODEL;
      let lowResult;
      try{
        lowResult=await callModel(low,messages,env.OPENROUTER_API_KEY,lowFallback===low?[]:[lowFallback]);
      }catch(error){
        logOpenRouterFailure("low_model",low,error);
        throw error;
      }
      let raw=lowResult.text,parsed=extractJson(raw),used=lowResult.model||low,escalated=false;
      if(!parsed||parsed.complex===true||!Number.isFinite(Number(parsed.confidence))||Number(parsed.confidence)<0.78){
        const high=env.OPENROUTER_HIGH_MODEL||HIGH_MODEL;
        try{
          const improved=await callModel(high,messages,env.OPENROUTER_API_KEY),candidate=extractJson(improved.text);
          if(candidate){parsed=candidate;used=improved.model||high;escalated=true;}
        }catch(error){
          logOpenRouterFailure("high_model",high,error);
        }
      }
      if(!parsed)return json({reply:raw,action:null,modelUsed:used,escalated},200,origin);
      return json({reply:String(parsed.reply||"요청 내용을 확인했어요."),action:parsed.action&&typeof parsed.action==="object"?parsed.action:null,modelUsed:used,escalated},200,origin);
    } catch(error) {
      logOpenRouterFailure("request",env.OPENROUTER_LOW_MODEL||LOW_MODEL,error);
      return json({error:openRouterUserMessage(error),code:"ai_upstream_error"},502,origin);
    }

  }

};