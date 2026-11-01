/* Aria conversational assistant · OpenRouter
   Low-cost model handles normal chat; Worker escalates difficult requests.
   Schedule changes are validated and applied in this browser, then synced to Firebase.
*/
(() => {
  const URL_KEY="affinityneo_gemini_proxy_url",CHAT_KEY="affinityneo_aria_chat_rooms_v2",OLD_CHAT_KEY="affinityneo_aria_chat_v1",ACTIVE_CHAT_KEY="affinityneo_aria_active_chat_v2";
  const $id=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[·•.,!?]/g,"");
  let renamingChatId=null;
  const makeChatId=()=>"chat-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
  const titleFromMessage=s=>{const v=String(s||"").replace(/\s+/g," ").trim(),a=Array.from(v);return a.length>26?a.slice(0,25).join("").trimEnd()+"…":v||"새 채팅"};
  function readRooms(){
    try{const raw=localStorage.getItem(CHAT_KEY);if(raw){const a=JSON.parse(raw);if(Array.isArray(a))return a.map(r=>({id:String(r.id||makeChatId()),title:String(r.title||"새 채팅"),titleLocked:!!r.titleLocked,createdAt:Number(r.createdAt)||Date.now(),updatedAt:Number(r.updatedAt)||Date.now(),messages:(Array.isArray(r.messages)?r.messages:[]).filter(m=>m&&(m.role==="user"||m.role==="assistant")).map(m=>({role:m.role,content:String(m.content||""),time:Number(m.time)||0})).slice(-400)}));}}catch(e){console.warn("Aria 채팅 기록을 읽지 못했어요.",e)}
    try{const old=JSON.parse(localStorage.getItem(OLD_CHAT_KEY)||"[]");if(Array.isArray(old)&&old.length){const first=old.find(m=>m&&m.role==="user"),now=Date.now(),room={id:makeChatId(),title:first?titleFromMessage(first.content):"이전 대화",titleLocked:false,createdAt:now,updatedAt:now,messages:old.slice(-400)};localStorage.setItem(CHAT_KEY,JSON.stringify([room]));localStorage.setItem(ACTIVE_CHAT_KEY,room.id);return [room]}}catch(e){console.warn("이전 Aria 대화를 옮기지 못했어요.",e)}
    return [];
  }
  function writeRooms(a){
    const rooms=a.slice().sort((x,y)=>y.updatedAt-x.updatedAt).slice(0,100);
    try{localStorage.setItem(CHAT_KEY,JSON.stringify(rooms));return true}
    catch(e){try{localStorage.setItem(CHAT_KEY,JSON.stringify(rooms.slice(0,30).map(r=>({...r,messages:r.messages.slice(-120)}))));if(typeof toast==="function")toast("저장 공간이 부족해 오래된 채팅 일부를 정리했어요.");return true}catch(e2){if(typeof toast==="function")toast("채팅 기록을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.");return false}}
  }
  function activeChat(create=true){
    let rooms=readRooms(),id=localStorage.getItem(ACTIVE_CHAT_KEY)||"",room=rooms.find(r=>r.id===id);
    if(!room&&rooms.length){room=rooms.sort((a,b)=>b.updatedAt-a.updatedAt)[0];localStorage.setItem(ACTIVE_CHAT_KEY,room.id)}
    if(!room&&create){const now=Date.now();room={id:makeChatId(),title:"새 채팅",titleLocked:false,createdAt:now,updatedAt:now,messages:[]};rooms.push(room);writeRooms(rooms);localStorage.setItem(ACTIVE_CHAT_KEY,room.id)}
    return room||null;
  }
  const readChat=()=>{const r=activeChat(true);return r?r.messages:[]};
  function saveChat(messages){const r=activeChat(true),a=readRooms(),t=a.find(x=>x.id===r.id);if(t){t.messages=messages.slice(-400);t.updatedAt=Date.now();writeRooms(a)}}
  function snapshot(){
    if(typeof S==="undefined"||!S||!Array.isArray(S.tasks))throw new Error("일정 데이터를 불러오지 못했어요. 새로고침해 주세요.");
    const tasks=S.tasks.map(t=>({
      id:t.id,taskKey:String(t.id)+":0",group:t.company||"",task:t.task||"",status:t.status||"",
      urgency:t.priority||"",assignee:t.person||"",deadline:t.due||"",
      plannedDate:t.planDate||(t.cx&&t.cx.planDate)||"",estimatedMinutes:Number(t.cx&&t.cx.estimateMin)||0,
      focusType:t.cx&&t.cx.focusType||"",workType:t.cx&&t.cx.workType||"",
      executionEligible:!isD(t)&&!isAfterHoursTask(t)&&!isWaitingTask(t)&&!String(t.task||"").includes("📌"),
      memo:t.memo||"",
      subtasks:(t.subs||[]).map(s=>({id:s.id,taskKey:String(t.id)+":"+String(s.id),task:s.task||"",status:s.status||"",deadline:s.due||"",plannedDate:s.planDate||"",assignee:s.person||t.person||"",urgency:s.priority||t.priority||"",executionEligible:!isD(t)&&!isAfterHoursTask(t)&&!isWaitingTask(t)&&!isD(s)}))
    }));
    return {capturedAt:new Date().toISOString(),groups:(S.groups||[]).map(g=>typeof g==="string"?g:g.name).filter(Boolean),tasks};
  }
  function ariaMascot(size){return '<svg viewBox="0 0 64 64" width="'+size+'" height="'+size+'" aria-hidden="true" style="display:block;flex:none"><path d="M32 5 C44 5 54 16 55 29 C56 41 46 51 34 57 C32.5 57.8 31 57.8 29.5 57 C17 51 8 41 9 29 C10 16 20 5 32 5 Z" fill="#3478f6"/><ellipse cx="24" cy="36" rx="3" ry="4.5" fill="#fff"/><ellipse cx="40" cy="36" rx="3" ry="4.5" fill="#fff"/></svg>';}
  function cleanAriaReply(value){return String(value||'').replace(/^\s*#{1,6}\s*/gm,'').replace(/\*{1,3}([^*\n]+)\*{1,3}/g,'$1').replace(/(^|\n)\s*\*\s+/g,'$1• ').replace(/(^|\n)\s*#+\s*/g,'$1').replace(/\n{3,}/g,'\n\n').trim();}
  function setChatStyle(){
    const md=document.querySelector(".md");if(!md)return;
    md.style.width="min(1040px, 100%)";md.style.height="min(790px, 90vh)";md.style.display="flex";md.style.flexDirection="column";md.style.padding="0";md.style.overflow="hidden";
    if(!$id("ariaChatResponsiveStyle")){const st=document.createElement("style");st.id="ariaChatResponsiveStyle";st.textContent=".aria-chat-shell{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--sf)}.aria-chat-head{display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--line);flex:none}.aria-chat-body{display:flex;flex:1;min-height:0}.aria-chat-sidebar{width:255px;min-width:210px;display:flex;flex-direction:column;gap:9px;padding:12px;border-right:1px solid var(--line);background:var(--sf);min-height:0}.aria-chat-search{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--sf2);color:var(--tx);outline:none}.aria-chat-list{overflow:auto;min-height:0;display:flex;flex-direction:column;gap:6px}.aria-chat-room{display:flex;align-items:center;gap:4px;border:1px solid transparent;border-radius:8px;padding:5px;background:transparent}.aria-chat-room.active{background:var(--inp);border-color:#9fc7f2}.aria-chat-pick{flex:1;min-width:0;text-align:left;padding:5px;background:transparent}.aria-chat-pick b,.aria-chat-pick small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aria-chat-pick b{font-size:12px;font-weight:650}.aria-chat-pick small{font-size:10px;color:var(--mu);margin-top:3px}.aria-chat-actions{display:flex;gap:1px;flex:none}.aria-chat-actions button{padding:4px 6px;color:var(--mu);font-size:11px}.aria-chat-workspace{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}#ariaChatLog{flex:1;min-height:0;overflow:auto;padding:16px;background:var(--bg)}.aria-chat-composer{display:flex;gap:8px;align-items:flex-end;padding:12px 14px;background:var(--sf)}.aria-chat-input{flex:1;resize:none;min-height:42px;max-height:120px;border:1px solid var(--line);border-radius:13px;padding:11px 13px;background:var(--sf2);font:inherit;outline:none;color:var(--tx)}.aria-chat-chipbar{padding:7px 14px 0;display:flex;gap:6px;flex-wrap:wrap;background:var(--sf)}.aria-chat-settings{padding:0 14px 10px;background:var(--sf);flex:none}@media(max-width:680px){.aria-chat-body{flex-direction:column}.aria-chat-sidebar{width:auto;min-width:0;max-height:175px;border-right:0;border-bottom:1px solid var(--line)}.aria-chat-list{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(150px,1fr);grid-template-rows:1fr;overflow-x:auto;overflow-y:hidden}.aria-chat-room{min-width:145px}.aria-chat-actions button{padding:3px 5px}.aria-chat-head{padding:10px 12px}#ariaChatLog{padding:12px}}";document.head.appendChild(st)}
  }
  window.openGeminiPanel=function(){
    const backdrop=$id("mb");if(backdrop&&!backdrop.dataset.ariaBackdropClose){backdrop.dataset.ariaBackdropClose="1";backdrop.addEventListener("click",e=>{if(e.target===backdrop&&$id("ariaChatLog"))closeM()})}
    activeChat(true);const savedUrl=localStorage.getItem(URL_KEY)||"";
    modal('<div class="aria-chat-shell"><div class="aria-chat-head">'+ariaMascot(34)+'<div style="flex:1;min-width:0"><b style="font-size:16px">Aria</b><div style="font-size:11px;color:var(--mu)">업무와 일정을 함께 정리하는 AI 비서</div></div><button class="primary" onclick="ariaNewChat()" style="white-space:nowrap">＋ 새 채팅</button><button onclick="closeM()" aria-label="닫기">✕</button></div><div class="aria-chat-body"><aside class="aria-chat-sidebar"><input id="ariaChatSearch" class="aria-chat-search" type="search" placeholder="채팅 검색…" oninput="filterAriaChats(this.value)"><div id="ariaChatList" class="aria-chat-list"></div><div style="font-size:10px;color:var(--mu);line-height:1.45">채팅 기록은 이 브라우저에 저장돼요.</div></aside><section class="aria-chat-workspace"><div id="ariaChatLog"></div><div class="aria-chat-chipbar"><button class="mini" onclick="ariaChatChip(\'오늘 일정 알려줘\')">오늘 일정</button><button class="mini" onclick="ariaChatChip(\'이번 주 업무 실행 순서 정리해줘\')">이번 주 우선순위</button><button class="mini" onclick="ariaChatChip(\'선혜 Task 안에 있는 최아영 그림책 리터칭이라는 항목은 유통 그룹으로 옮겨줘\')">업무 이동 예시</button></div><form id="ariaChatForm" class="aria-chat-composer"><textarea id="ariaChatInput" class="aria-chat-input" rows="1" placeholder="Aria에게 편하게 말해 주세요…"></textarea><button class="primary" type="submit" style="height:42px;padding:0 17px;border-radius:12px">보내기</button></form><details class="aria-chat-settings"><summary style="font-size:11px;color:var(--mu);cursor:pointer">연결 설정</summary><div style="display:flex;gap:6px;padding-top:8px"><input id="ariaWorkerUrl" class="inp" style="font-size:12px" placeholder="Cloudflare Worker 주소 (/api/gemini)" value="'+esc(savedUrl)+'"><button class="mini" type="button" onclick="saveAriaWorkerUrl()">저장</button></div><div style="font-size:10px;color:var(--mu);margin-top:4px">일반 대화는 무료 모델을 우선 사용하고, 복잡하거나 불확실한 요청만 설정된 고성능 모델로 다시 확인해요.</div></details></section></div></div>');
    setChatStyle();renderAriaChat();
    const form=$id("ariaChatForm"),input=$id("ariaChatInput");form.addEventListener("submit",e=>{e.preventDefault();sendAriaMessage()});input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAriaMessage()}});input.focus();
  };
  window.ariaNewChat=function(){
    const a=readRooms(),now=Date.now(),r={id:makeChatId(),title:"새 채팅",titleLocked:false,createdAt:now,updatedAt:now,messages:[]};a.push(r);writeRooms(a);localStorage.setItem(ACTIVE_CHAT_KEY,r.id);
    const q=$id("ariaChatSearch");if(q)q.value="";renamingChatId=null;renderAriaChat();const input=$id("ariaChatInput");if(input){input.value="";input.focus();}
  };
  window.ariaSelectChat=function(id){if(!readRooms().some(r=>r.id===id))return;localStorage.setItem(ACTIVE_CHAT_KEY,id);renamingChatId=null;renderAriaChat();const input=$id("ariaChatInput");if(input){input.value="";input.focus();}};
  window.filterAriaChats=function(q){renderAriaChatList(String(q||""))};
  window.ariaRenameChat=function(id){renamingChatId=id;renderAriaChatList(($id("ariaChatSearch")||{}).value||"");const input=$id("ariaRenameInput");if(input){input.focus();input.select()}};
  window.ariaCommitRename=function(id,value){const v=String(value||"").replace(/\s+/g," ").trim();if(!v){if(typeof toast==="function")toast("채팅방 이름을 입력해 주세요.");return}const a=readRooms(),r=a.find(x=>x.id===id);if(!r)return;r.title=v.slice(0,80);r.titleLocked=true;r.updatedAt=Date.now();writeRooms(a);renamingChatId=null;renderAriaChat()};
  window.ariaCancelRename=function(){renamingChatId=null;renderAriaChatList(($id("ariaChatSearch")||{}).value||"")};
  window.ariaDeleteChat=async function(id){
    const a=readRooms(),r=a.find(x=>x.id===id);if(!r)return;let ok=true;
    if(typeof confirmDialog==="function")ok=await confirmDialog("‘"+r.title+"’ 채팅방을 삭제할까요?");
    else if(typeof window.confirm==="function")ok=window.confirm("‘"+r.title+"’ 채팅방을 삭제할까요?");
    if(!ok){window.openGeminiPanel();return}
    const next=a.filter(x=>x.id!==id);
    if(!next.length){const now=Date.now(),fresh={id:makeChatId(),title:"새 채팅",titleLocked:false,createdAt:now,updatedAt:now,messages:[]};next.push(fresh);localStorage.setItem(ACTIVE_CHAT_KEY,fresh.id)}
    else if(localStorage.getItem(ACTIVE_CHAT_KEY)===id){next.sort((x,y)=>y.updatedAt-x.updatedAt);localStorage.setItem(ACTIVE_CHAT_KEY,next[0].id)}
    writeRooms(next);renamingChatId=null;window.openGeminiPanel();
  };
  window.saveAriaWorkerUrl=function(){
    const v=($id("ariaWorkerUrl").value||"").trim().replace(/\/+$/,"");
    if(!/^https:\/\/[a-z0-9.-]+\.workers\.dev\/api\/gemini$/i.test(v)){if(typeof toast==="function")toast("Worker 주소 형식을 확인해 주세요.");return;}
    localStorage.setItem(URL_KEY,v);if(typeof toast==="function")toast("연결 주소를 저장했어요.");
  };
  window.ariaChatChip=function(text){const i=$id("ariaChatInput");if(i){i.value=text;sendAriaMessage()}};
  function renderAriaChatList(query=""){
    const list=$id("ariaChatList");if(!list)return;const rooms=readRooms().sort((a,b)=>b.updatedAt-a.updatedAt),active=(activeChat(true)||{}).id,q=norm(query),filtered=rooms.filter(r=>!q||norm(r.title).includes(q)||r.messages.some(m=>norm(m.content).includes(q)));
    if(!filtered.length){list.innerHTML='<div style="padding:12px 8px;font-size:11px;color:var(--mu)">'+(q?"검색 결과가 없어요.":"아직 채팅이 없어요.")+'</div>';return}
    list.innerHTML=filtered.map(r=>{
      const last=r.messages[r.messages.length-1],snippet=last?last.content.replace(/\s+/g," ").slice(0,48):"대화를 시작해 보세요",on=r.id===active?" active":"";
      const body=r.id===renamingChatId
        ?'<input id="ariaRenameInput" class="aria-chat-search" value="'+esc(r.title)+'" maxlength="80" onkeydown="if(event.key===\'Enter\'){event.preventDefault();ariaCommitRename(\''+esc(r.id)+'\',this.value)}else if(event.key===\'Escape\'){ariaCancelRename()}"><div class="aria-chat-actions"><button onclick="ariaCommitRename(\''+esc(r.id)+'\',document.getElementById(\'ariaRenameInput\').value)">저장</button><button onclick="ariaCancelRename()">취소</button></div>'
        :'<button class="aria-chat-pick" onclick="ariaSelectChat(\''+esc(r.id)+'\')"><b>'+esc(r.title)+'</b><small>'+esc(snippet)+'</small></button><div class="aria-chat-actions"><button title="이름 변경" aria-label="이름 변경" onclick="ariaRenameChat(\''+esc(r.id)+'\')">✎</button><button title="삭제" aria-label="삭제" onclick="ariaDeleteChat(\''+esc(r.id)+'\')">×</button></div>';
      return '<article class="aria-chat-room'+on+'">'+body+'</article>';
    }).join("");
  }
  function renderAriaChat(){
    const log=$id("ariaChatLog");if(!log)return;const history=readChat();let html="";
    if(!history.length)html='<div style="display:flex;gap:8px;margin-bottom:14px;align-items:flex-end">'+ariaMascot(28)+'<div style="max-width:86%;background:var(--sf);border:1px solid var(--line);border-radius:16px 16px 16px 5px;padding:11px 14px;line-height:1.6;font-size:13px">안녕하세요! 저는 Aria예요. 업무 이동이나 일정 변경도 평소처럼 말해 주세요. 실제 보드에 반영한 뒤 결과를 알려드릴게요.</div></div>';
    history.forEach(m=>{const mine=m.role==="user";html+='<div style="display:flex;justify-content:'+(mine?"flex-end":"flex-start")+';gap:8px;margin:10px 0;align-items:flex-end">'+(mine?"":ariaMascot(28))+'<div style="max-width:86%;white-space:pre-wrap;overflow-wrap:anywhere;background:'+(mine?"#2F5DE8":"var(--sf)")+';color:'+(mine?"#fff":"var(--tx)")+';border:'+(mine?"0":"1px solid var(--line)")+';border-radius:'+(mine?"16px 16px 5px 16px":"16px 16px 16px 5px")+';padding:11px 14px;line-height:1.65;font-size:13px">'+esc(mine?m.content:cleanAriaReply(m.content))+'</div></div>'});
    log.innerHTML=html;log.scrollTop=log.scrollHeight;renderAriaChatList(($id("ariaChatSearch")||{}).value||"");
  }
  function pushChat(role,content){
    const a=readRooms(),r=a.find(x=>x.id===(activeChat(true)||{}).id);if(!r)return;const value=String(content||"");
    r.messages.push({role,content:value,time:Date.now()});r.messages=r.messages.slice(-400);r.updatedAt=Date.now();
    if(role==="user"&&!r.titleLocked&&r.messages.filter(m=>m.role==="user").length===1)r.title=titleFromMessage(value);
    writeRooms(a);renderAriaChat();
  }
  function findTask(action){
    const tasks=S.tasks||[],key=norm(action.taskName||action.task||"");
    if(!key)return {matches:[]};
    let matches=tasks.filter(t=>norm(t.task)===key);
    if(!matches.length)matches=tasks.filter(t=>norm(t.task).includes(key)||key.includes(norm(t.task)));
    const from=norm(action.fromGroup||action.sourceGroup||"");
    if(from)matches=matches.filter(t=>norm(t.company)===from);
    return {matches};
  }
  function applyAriaAction(action){
    if(!action||typeof action!=="object")return null;
    const type=action.type||action.action;
    if(type==="set_execution_order"){
      const valid=dashboardWorkEntries(S.tasks.filter(t=>!isD(t))).map(x=>String(x.id)+":"+String(x.subId||0));
      const allowed=new Set(valid),requested=Array.isArray(action.taskKeys)?action.taskKeys.map(String):[];
      if(!requested.length)return "AI가 실행 순서 결과를 만들지 못했어요. 다시 요청해 주세요.";
      if(new Set(requested).size!==requested.length||requested.some(k=>!allowed.has(k)))return "AI가 반환한 실행 순서에 중복되거나 보드에 없는 업무가 있어 적용하지 않았어요.";
      const remaining=(Array.isArray(S.executionOrder)?S.executionOrder.map(String):[]).filter(k=>allowed.has(k)&&!requested.includes(k));
      const already=new Set([...requested,...remaining]);
      S.executionOrder=requested.concat(remaining,valid.filter(k=>!already.has(k)));
      if(typeof save==="function")save();
      if(typeof syncTouch==="function")syncTouch();
      if(typeof render==="function")render();
      return "AI가 "+requested.length+"개 업무의 실행 순서를 정리했어요. 대시보드와 아침 브리핑에 같은 순서로 반영했어요. 기존 긴급도는 변경하지 않았어요.";
    }
    if(type==="move_task"){
      const found=findTask(action),to=String(action.toGroup||action.targetGroup||"").trim();
      if(found.matches.length!==1)return found.matches.length?"같은 이름의 업무가 여러 개 있어요. 원래 그룹을 포함해 다시 지정해 주세요.":"말씀하신 업무를 현재 보드에서 찾지 못했어요. 업무명과 원래 그룹을 다시 확인해 주세요.";
      if(!to)return "이동할 그룹을 확인하지 못했어요. 어느 그룹으로 옮길지 알려주세요.";
      const task=found.matches[0],group=(S.groups||[]).find(g=>norm(typeof g==="string"?g:g.name)===norm(to));
      if(!group)return "‘"+to+"’ 그룹이 현재 보드에 없어요. 그룹 이름을 확인해 주세요.";
      const before=task.company||"";
      if(norm(before)===norm(to))return "‘"+task.task+"’ 업무는 이미 ‘"+to+"’ 그룹에 있어요.";
      task.company=typeof group==="string"?group:group.name;
      save();if(typeof syncTouch==="function")syncTouch();if(typeof render==="function")render();
      return "옮겼어요! ‘"+task.task+"’ 업무를 ‘"+before+"’에서 ‘"+task.company+"’ 그룹으로 이동했어요.";
    }
    if(type==="set_status"||type==="set_due"||type==="set_assignee"||type==="complete_task"){
      const found=findTask(action);
      if(found.matches.length!==1)return found.matches.length?"같은 이름의 업무가 여러 개 있어요. 원래 그룹을 함께 알려주세요.":"해당 업무를 찾지 못했어요.";
      const t=found.matches[0];
      if(type==="set_status"){
        const v=String(action.status||"").trim();if(!(S.labels.status||[]).some(x=>x.n===v))return "‘"+v+"’ 상태가 보드에 없어요.";t.status=v;if(v==="완료")t.doneAt=new Date().toISOString().slice(0,10);else t.doneAt="";
      }else if(type==="set_due"){
        const v=String(action.deadline||action.due||"");if(!/^20\d{2}-\d{2}-\d{2}$/.test(v))return "마감일 형식을 확인하지 못했어요.";t.due=v;
      }else if(type==="set_assignee"){t.person=String(action.assignee||"").trim();}
      else{const done=(S.labels.status||[]).find(x=>x.n==="완료");if(!done)return "완료 상태를 찾지 못했어요.";t.status=done.n;t.doneAt=new Date().toISOString().slice(0,10);}
      save();if(typeof syncTouch==="function")syncTouch();if(typeof render==="function")render();
      return "반영했어요! ‘"+t.task+"’ 업무를 업데이트했어요.";
    }
    return null;
  }
  window.runAriaExecutionOrder=function(){
    if(typeof window.openGeminiPanel==="function")window.openGeminiPanel();
    const input=$id("ariaChatInput");if(!input)return;
    input.value="현재 업무 관리 보드의 실행 순서를 AI가 정리해 줘. 미완료 일반 업무와 하위 업무 중 executionEligible이 true인 항목을 모두 포함해 1번부터 마지막까지 순위를 매겨. 이번 주 실행 예정일, 실제 마감일, 수익·매출·사업 영향, 선행 관계, 대기 여부, 예상 시간을 함께 판단해. 기존 긴급도는 절대 변경하지 말고, 순위만 set_execution_order action의 taskKeys 배열로 반환해. 각 항목의 taskKey를 그대로 사용하고 누락이나 중복 없이 정렬해.";
    window.sendAriaMessage();
  };
  window.sendAriaMessage=async function(){
    const input=$id("ariaChatInput");if(!input)return;
    const question=input.value.trim();if(!question)return;
    input.value="";pushChat("user",question);
    const url=localStorage.getItem(URL_KEY)||"";
    if(!/^https:\/\/[a-z0-9.-]+\.workers\.dev\/api\/gemini$/i.test(url)){pushChat("assistant","먼저 연결 설정에서 Cloudflare Worker 주소를 저장해 주세요.");return;}
    const log=$id("ariaChatLog"),pending=document.createElement("div");
    pending.id="ariaPending";pending.style.cssText="font-size:12px;color:var(--mu);padding:8px 4px";pending.textContent="Aria가 생각하고 있어요…";log.appendChild(pending);log.scrollTop=log.scrollHeight;
    try{
      const schedule=snapshot(),history=readChat().slice(-12).map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.content}));
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"chat",schedule,question,messages:history})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"AI 요청에 실패했어요.");
      let reply=cleanAriaReply(String(data.reply||data.text||""));
      if(data.action){const result=applyAriaAction(data.action);if(result)reply=result;}
      if(!reply)reply="요청을 처리했어요.";
      if(data.escalated)reply+="\n\n복잡한 요청이라 고성능 모델로 한 번 더 확인했어요.";
      if(pending.parentNode)pending.remove();pushChat("assistant",reply);
    }catch(error){
      if(pending.parentNode)pending.remove();pushChat("assistant","요청을 처리하지 못했어요. "+(error.message||"잠시 후 다시 시도해 주세요."));
    }
  };
  window.runAriaCommand=window.sendAriaMessage;
  window.runGeminiAnalysis=window.sendAriaMessage;
})();