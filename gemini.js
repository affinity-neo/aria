/* Aria conversational assistant · OpenRouter
   Low-cost model handles normal chat; Worker escalates difficult requests.
   Schedule changes are validated and applied in this browser, then synced to Firebase.
*/
(() => {
  const URL_KEY="affinityneo_gemini_proxy_url",CHAT_KEY="affinityneo_aria_chat_v1";
  const $id=id=>document.getElementById(id);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[·•.,!?]/g,"");
  const readChat=()=>{try{return JSON.parse(localStorage.getItem(CHAT_KEY)||"[]")}catch(e){return []}};
  const saveChat=a=>localStorage.setItem(CHAT_KEY,JSON.stringify(a.slice(-60)));
  function snapshot(){
    if(typeof S==="undefined"||!S||!Array.isArray(S.tasks))throw new Error("일정 데이터를 불러오지 못했어요. 새로고침해 주세요.");
    const tasks=S.tasks.map(t=>({
      id:t.id,group:t.company||"",task:t.task||"",status:t.status||"",
      priority:t.priority||"",assignee:t.person||"",deadline:t.due||"",
      plannedDate:t.planDate||(t.cx&&t.cx.planDate)||"",memo:t.memo||"",
      subtasks:(t.subs||[]).map(s=>({task:s.task||"",status:s.status||"",deadline:s.due||""}))
    }));
    return {capturedAt:new Date().toISOString(),groups:(S.groups||[]).map(g=>typeof g==="string"?g:g.name).filter(Boolean),tasks};
  }
  function setChatStyle(){
    const md=document.querySelector(".md");
    if(md){md.style.width="min(760px, 100%)";md.style.height="min(780px, 88vh)";md.style.display="flex";md.style.flexDirection="column";md.style.padding="0";md.style.overflow="hidden";}
  }
  window.openGeminiPanel=function(){
    const savedUrl=localStorage.getItem(URL_KEY)||"";
    modal(
      '<div style="display:flex;flex-direction:column;height:100%;min-height:0;background:var(--sf)">'+
        '<div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line)">'+
          '<div style="width:34px;height:34px;border-radius:12px;background:#2F5DE8;color:white;display:grid;place-items:center;font-weight:800">A</div>'+
          '<div style="flex:1"><b style="font-size:16px">Aria</b><div style="font-size:11px;color:var(--mu)">업무와 일정을 함께 정리하는 AI 비서</div></div>'+
          '<button onclick="closeM()" aria-label="닫기">✕</button></div>'+
        '<div id="ariaChatLog" style="flex:1;min-height:0;overflow:auto;padding:16px;background:var(--bg)"></div>'+
        '<div style="padding:8px 14px 0;display:flex;gap:6px;flex-wrap:wrap;background:var(--sf)">'+
          '<button class="mini" onclick="ariaChatChip(\'오늘 일정 알려줘\')">오늘 일정</button>'+
          '<button class="mini" onclick="ariaChatChip(\'이번 주 업무 우선순위 정리해줘\')">이번 주 우선순위</button>'+
          '<button class="mini" onclick="ariaChatChip(\'선혜 Task 안에 있는 최아영 그림책 리터칭이라는 항목은 유통 그룹으로 옮겨줘\')">업무 이동 예시</button></div>'+
        '<form id="ariaChatForm" style="display:flex;gap:8px;align-items:flex-end;padding:12px 14px;background:var(--sf)">'+
          '<textarea id="ariaChatInput" rows="1" placeholder="Aria에게 편하게 말해 주세요…" style="flex:1;resize:none;min-height:42px;max-height:120px;border:1px solid var(--line);border-radius:13px;padding:11px 13px;background:var(--sf2);font:inherit;outline:none"></textarea>'+
          '<button class="primary" type="submit" style="height:42px;padding:0 17px;border-radius:12px">보내기</button></form>'+
        '<details style="padding:0 14px 10px;background:var(--sf)"><summary style="font-size:11px;color:var(--mu);cursor:pointer">연결 설정</summary>'+
          '<div style="display:flex;gap:6px;padding-top:8px"><input id="ariaWorkerUrl" class="inp" style="font-size:12px" placeholder="Cloudflare Worker 주소 (/api/gemini)" value="'+esc(savedUrl)+'">'+
          '<button class="mini" type="button" onclick="saveAriaWorkerUrl()">저장</button></div>'+
          '<div style="font-size:10px;color:var(--mu);margin-top:4px">일반 대화와 간단한 변경은 저렴한 모델, 복잡하거나 불확실한 요청만 고성능 모델로 처리해요.</div></details></div>'
    );
    setChatStyle();renderAriaChat();
    const form=$id("ariaChatForm"),input=$id("ariaChatInput");
    form.addEventListener("submit",e=>{e.preventDefault();sendAriaMessage()});
    input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAriaMessage()}});
    input.focus();
  };
  window.saveAriaWorkerUrl=function(){
    const v=($id("ariaWorkerUrl").value||"").trim().replace(/\/+$/,"");
    if(!/^https:\/\/[a-z0-9.-]+\.workers\.dev\/api\/gemini$/i.test(v)){if(typeof toast==="function")toast("Worker 주소 형식을 확인해 주세요.");return;}
    localStorage.setItem(URL_KEY,v);if(typeof toast==="function")toast("연결 주소를 저장했어요.");
  };
  window.ariaChatChip=function(text){const i=$id("ariaChatInput");if(i){i.value=text;sendAriaMessage()}};
  function renderAriaChat(){
    const log=$id("ariaChatLog");if(!log)return;
    const history=readChat();
    let html='<div style="display:flex;gap:8px;margin-bottom:14px;align-items:flex-end"><div style="width:28px;height:28px;border-radius:50%;background:#2F5DE8;color:white;display:grid;place-items:center;flex:none;font-weight:700">A</div><div style="max-width:86%;background:var(--sf);border:1px solid var(--line);border-radius:16px 16px 16px 5px;padding:11px 14px;line-height:1.6;font-size:13px">안녕하세요! 저는 Aria예요. 업무 이동이나 일정 변경도 평소처럼 말해 주세요. 실제 보드에 반영한 뒤 결과를 알려드릴게요.</div></div>';
    history.forEach(m=>{
      const mine=m.role==="user";
      html+='<div style="display:flex;justify-content:'+(mine?"flex-end":"flex-start")+';gap:8px;margin:10px 0;align-items:flex-end">'+
        (mine?"":'<div style="width:28px;height:28px;border-radius:50%;background:#2F5DE8;color:white;display:grid;place-items:center;flex:none;font-weight:700">A</div>')+
        '<div style="max-width:86%;white-space:pre-wrap;overflow-wrap:anywhere;background:'+(mine?"#2F5DE8":"var(--sf)")+';color:'+(mine?"#fff":"var(--tx)")+';border:'+(mine?"0":"1px solid var(--line)")+';border-radius:'+(mine?"16px 16px 5px 16px":"16px 16px 16px 5px")+';padding:11px 14px;line-height:1.65;font-size:13px">'+esc(m.content)+'</div></div>';
    });
    log.innerHTML=html;log.scrollTop=log.scrollHeight;
  }
  function pushChat(role,content){const a=readChat();a.push({role,content:String(content||"")});saveChat(a);renderAriaChat();}
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
      let reply=String(data.reply||data.text||"");
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