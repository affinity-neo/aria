/* AffinityNeo · AI schedule assistant (OpenRouter)
   API keys are NEVER stored in this browser file.
   The key lives only as OPENROUTER_API_KEY in the Cloudflare Worker Secret.
*/
(() => {
  const URL_KEY = "affinityneo_gemini_proxy_url";
  function getScheduleSnapshot() {
    if (typeof S === "undefined" || !S || !Array.isArray(S.tasks)) throw new Error("일정 데이터를 불러오지 못했어요. 페이지를 새로고침해 주세요.");
    const tasks = S.tasks.map(task => ({
      id: task.id, project: task.company || "", task: task.task || "", status: task.status || "",
      priority: task.priority || "", assignee: task.person || "", deadline: task.due || "",
      plannedDate: task.planDate || "", completedDate: task.doneAt || "",
      estimatedMinutes: task.estimateMin ?? "", workType: task.workType || "",
      category: task.focusType || (task.cx && task.cx.focusType) || "", memo: task.memo || "",
      subtasks: (task.subs || []).map(sub => ({ task: sub.task || "", status: sub.status || "", deadline: sub.due || "", memo: sub.memo || "" }))
    }));
    return {
      capturedAt: new Date().toISOString(), tasks,
      fixedEvents: Array.isArray(S.fixedEvents) ? S.fixedEvents : [],
      checklist: S.check && Array.isArray(S.check.items) ? S.check.items.map(item => ({
        cycle: item.cycle || "", item: item.item || "", criteria: item.crit || "", note: item.note || ""
      })) : []
    };
  }
  window.openGeminiPanel = function () {
    const savedUrl = localStorage.getItem(URL_KEY) || "";
    modal(`
      <h2>Aria AI 비서</h2>
      <p style="font-size:13px;line-height:1.6;color:var(--mu);margin:0 0 12px">업무 이동·담당자·상태·마감일 변경과 일정 조회는 앱 안에서 바로 처리해요. 복잡한 일정 분석만 AI 모델을 사용합니다.</p>
      <label for="geminiProxyUrl" style="display:block;font-size:12px;font-weight:600;margin:10px 0 5px">Cloudflare Worker 주소</label>
      <input id="geminiProxyUrl" class="inp" type="url" placeholder="https://내-worker.내계정.workers.dev/api/gemini" value="${savedUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">
      <div style="font-size:11px;color:var(--mu);margin:5px 0 12px">처음 한 번만 입력하면 이 브라우저에 저장돼요.</div>
      <label for="geminiQuestion" style="display:block;font-size:12px;font-weight:600;margin:10px 0 5px">Aria에게 요청하기</label>
      <textarea id="geminiQuestion" class="inp" rows="4" style="resize:vertical;line-height:1.6" placeholder="예: 최아영 그림책 리터칭 업무를 유통 그룹으로 옮겨줘"></textarea>
      <div id="geminiStatus" style="font-size:12px;color:var(--mu);margin:10px 0" aria-live="polite"></div>
      <div id="geminiResult" style="display:none;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;background:var(--sf2);border:1px solid var(--line);border-radius:8px;padding:14px;max-height:42vh;overflow:auto;font-size:13px"></div>
      <div class="ma"><button onclick="closeM()">닫기</button><button onclick="runAriaCommand()">요청 실행</button><button class="primary" id="geminiRunBtn" onclick="runGeminiAnalysis()">AI 분석</button></div>
    `);
  };

  function localToday(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
  function addLocalDays(n){const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
  function taskNameFrom(q){
    const quoted=q.match(/["'“”‘’「」『』]([^"'“”‘’「」『』]+)["'“”‘’「」『』]/);if(quoted)return quoted[1].trim();
    let m=q.match(/(?:안에\s*있는\s*)(.+?)(?:이라는\s*항목|라는\s*항목|\s*항목)/);if(m)return m[1].trim();
    m=q.match(/(.+?)(?:\s*항목을|\s*항목은|\s*업무를|\s*업무는)/);if(m)return m[1].trim();
    m=q.match(/(.+?)\s*(?:을|를)\s*(?:완료|삭제|마감일|담당자|상태)/);if(m)return m[1].trim();
    return "";
  }
  function resolveTask(name){
    if(!name)return {items:[]};
    const key=name.replace(/\s+/g,"").toLowerCase();
    return {items:S.tasks.filter(t=>String(t.task||"").replace(/\s+/g,"").toLowerCase().includes(key))};
  }
  function commandResult(message,ok=true){
    const status=document.getElementById("geminiStatus"),output=document.getElementById("geminiResult");
    if(status)status.textContent=message;
    if(output){output.style.display="block";output.textContent=message;output.style.whiteSpace="pre-wrap"}
    return ok;
  }
  window.runAriaCommand=function(){
    const input=document.getElementById("geminiQuestion");if(!input)return;
    const q=input.value.trim();if(!q){commandResult("요청 내용을 입력해 주세요.",false);input.focus();return}
    if(!Array.isArray(S?.tasks)){commandResult("업무 데이터를 불러오지 못했어요.",false);return}
    const taskName=taskNameFrom(q),matches=resolveTask(taskName).items;
    const groupMatches=[...q.matchAll(/([가-힣A-Za-z0-9_-]+)\s*그룹(?:으로|에)/g)];
    const targetGroup=groupMatches.length?groupMatches[groupMatches.length-1][1]:"";
    if(/그룹(?:으로|에)\s*(?:옮겨|이동)/.test(q)||/(?:옮겨|이동)\s*(?:줘|해)/.test(q)&&targetGroup){
      if(!taskName)return commandResult("옮길 업무 이름을 정확히 적어 주세요. 예: ‘업무명’ 항목을 유통 그룹으로 옮겨줘.",false);
      if(matches.length!==1)return commandResult(matches.length?("같은 이름의 업무가 여러 개 있어요. 정확한 이름을 지정해 주세요.\n"+matches.map(t=>"· "+t.company+" / "+t.task).join("\n")):"해당 업무를 찾지 못했어요: "+taskName,false);
      const t=matches[0];if(!S.groups.some(x=>x.name===targetGroup))S.groups.push({name:targetGroup,color:"#808080"});
      const before=t.company;t.company=targetGroup;save();syncTouch();render();
      return commandResult("업무를 이동했어요.\n"+t.task+"\n"+before+" → "+targetGroup);
    }
    if(/완료(?:로| 처리|해 줘|해줘|시켜)/.test(q)){
      if(matches.length!==1)return commandResult(matches.length?"같은 이름의 업무가 여러 개 있어요.":"완료 처리할 업무를 찾지 못했어요: "+(taskName||"업무명 없음"),false);
      const t=matches[0],done=(S.labels.status||[]).find(x=>x.n==="완료");if(done)t.status=done.n;t.doneAt=localToday();save();syncTouch();render();return commandResult("완료 처리했어요.\n"+t.task);
    }
    if(/삭제(?:해|해줘|해 줘)/.test(q)){
      if(matches.length!==1)return commandResult(matches.length?"같은 이름의 업무가 여러 개 있어요.":"삭제할 업무를 찾지 못했어요.",false);
      const t=matches[0];S.tasks=S.tasks.filter(x=>x.id!==t.id);save();syncTouch();render();return commandResult("업무를 삭제했어요.\n"+t.task);
    }
    const assignee=q.match(/담당자(?:를|는)?\s*([가-힣A-Za-z0-9_-]+)\s*(?:로|으로)?\s*(?:변경|바꿔|지정)/)||q.match(/([가-힣A-Za-z0-9_-]+)에게\s*맡겨/);
    if(assignee){
      if(matches.length!==1)return commandResult(matches.length?"같은 이름의 업무가 여러 개 있어요.":"담당자를 바꿀 업무를 찾지 못했어요.",false);
      const t=matches[0],person=assignee[1];t.person=person;if(!(S.labels.person||[]).some(x=>x.n===person))S.labels.person.push({n:person,c:"#808080"});save();syncTouch();render();return commandResult("담당자를 변경했어요.\n"+t.task+"\n담당자: "+person);
    }
    const date=q.match(/(20\d{2}-\d{2}-\d{2})/)?.[1]||(/모레/.test(q)?addLocalDays(2):/내일/.test(q)?addLocalDays(1):/오늘/.test(q)?localToday():"");
    if(date&&/(마감|기한|날짜)/.test(q)){
      if(matches.length!==1)return commandResult(matches.length?"같은 이름의 업무가 여러 개 있어요.":"날짜를 변경할 업무를 찾지 못했어요.",false);
      matches[0].due=date;save();syncTouch();render();return commandResult("마감일을 변경했어요.\n"+matches[0].task+"\n마감일: "+date);
    }
    if(/오늘\s*(?:일정|업무|할 일)|오늘 뭐/.test(q)){
      const d=localToday(),list=S.tasks.filter(t=>!t.doneAt&&(t.due===d||(t.cx&&t.cx.planDate===d)));
      return commandResult(list.length?"오늘 확인할 업무 "+list.length+"개\n"+list.map(t=>"· "+t.task+" ("+t.company+" · "+(t.due===d?"마감":"예정")+")").join("\n"):"오늘 예정되거나 마감인 미완료 업무가 없어요.");
    }
    if(/찾아|검색|목록|보여줘|보여\s*줘/.test(q)&&matches.length){
      return commandResult("찾은 업무 "+matches.length+"개\n"+matches.map(t=>"· "+t.company+" / "+t.task+" / "+t.status+" / "+(t.due||"마감일 없음")).join("\n"));
    }
    if(taskName&&!matches.length)return commandResult("해당 업무를 찾지 못했어요: "+taskName,false);
    return commandResult("이 요청은 바로 실행할 수 있는 명령으로 해석하지 못했어요. 업무 이동·담당자 변경·마감일 변경·완료 처리·삭제·오늘 일정 조회는 ‘요청 실행’을, 우선순위와 주간 계획 분석은 ‘AI 분석’을 눌러 주세요.",false);
  };

  window.runGeminiAnalysis = async function () {
    const button = document.getElementById("geminiRunBtn"), status = document.getElementById("geminiStatus");
    const output = document.getElementById("geminiResult"), urlInput = document.getElementById("geminiProxyUrl");
    const questionInput = document.getElementById("geminiQuestion");
    if (!button || !status || !output || !urlInput || !questionInput) return;
    const endpoint = urlInput.value.trim().replace(/\/+$/, "");
    if (!/^https:\/\/[a-z0-9.-]+\.workers\.dev\/api\/gemini$/i.test(endpoint)) {
      status.textContent = "Cloudflare Worker 주소를 https://…workers.dev/api/gemini 형식으로 입력해 주세요.";
      urlInput.focus(); return;
    }
    localStorage.setItem(URL_KEY, endpoint);
    button.disabled = true; button.textContent = "분석 중…";
    status.textContent = "일정 데이터를 정리해 Gemma에 전달하고 있어요.";
    output.style.display = "none"; output.textContent = "";
    try {
      const schedule = getScheduleSnapshot();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 65000);
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ schedule, question: questionInput.value.trim() }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI 분석 요청에 실패했어요. Cloudflare 설정을 확인해 주세요.");
      if (!data.text) throw new Error("분석 결과가 비어 있어요.");
      output.textContent = data.text; output.style.display = "block";
      status.textContent = "분석이 완료됐어요. 모델: Gemma 4 26B A4B (무료) · 기준 시각: " + new Date(schedule.capturedAt).toLocaleString("ko-KR");
    } catch (error) {
      status.textContent = error.name === "AbortError" ? "AI 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요." : (error.message || "오류가 발생했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      button.disabled = false; button.textContent = "다시 분석하기";
    }
  };
})();
