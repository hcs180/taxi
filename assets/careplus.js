'use strict';
// Care+ 決賽展示流程：長期預約、語音輸入、無障礙車輛、看診進度、延誤平移、快輪到推播、一鍵叫回程、司機任務池與轉單。
// 全部為展示資料，存在目前瀏覽器；看診燈號為模擬，實際上線預計串接醫院 App／網站公開的看診進度。

const CP_HOSPITALS = [
  {id:'ntuh', name:'台大醫院', dept:'腎臟內科 3 診', address:'台北市中正區常德街 1 號', zone:'台大醫院待命區'},
  {id:'tcvgh', name:'台中榮總', dept:'腎臟內科 5 診', address:'台中市西屯區台灣大道四段 1650 號', zone:'台中榮總待命區'},
  {id:'mlh', name:'衛生福利部苗栗醫院', dept:'復健科 2 診', address:'苗栗縣苗栗市為公路 747 號', zone:'苗栗醫院待命區'}
];
const CP_DAYS = ['日','一','二','三','四','五','六'];
const CP_TEXT = {
  zh:{pushOpd:(c,m)=>`快輪到陳奶奶了：目前 ${c} 號，您是 ${m} 號。要預約回程嗎？`, pushTreat:'透析療程剩 15 分鐘。要預約回程嗎？', reserve:'預約回程', later:'稍後', oneTap:'我好了，一鍵叫車', speak:'用說的叫車', listening:'正在聆聽…請說「好了」', fallback:'好了，我們要回家', lang:'中文'},
  id:{pushOpd:(c,m)=>`Sebentar lagi giliran Nenek Chen (sekarang nomor ${c}, Nenek nomor ${m}). Pesan taksi pulang?`, pushTreat:'Cuci darah tinggal 15 menit lagi. Pesan taksi pulang?', reserve:'Pesan taksi pulang', later:'Nanti', oneTap:'Sudah selesai, panggil taksi', speak:'Bicara untuk memanggil taksi', listening:'Mendengarkan… ucapkan “sudah selesai”', fallback:'Sudah selesai, mau pulang', lang:'Bahasa Indonesia'}
};

const CP_SIMVOICE = new URLSearchParams(location.search).has('simvoice'); // 錄影時可加 ?simvoice 改用模擬語音
const cpMin = t => { const [h,m] = String(t).split(':').map(Number); return h*60+m; };
const cpFmt = m => { m = ((Math.round(m)%1440)+1440)%1440; return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; };
const cpRound5 = m => Math.round(m/5)*5;
const cpWeekday = date => new Date(`${date}T12:00:00+08:00`).getUTCDay();
const cpAddDays = (date,n) => { const d = new Date(`${date}T12:00:00+08:00`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const cpShort = date => { const [,m,d] = date.split('-'); return `${Number(m)}/${Number(d)}（${CP_DAYS[cpWeekday(date)]}）`; };
const cpHospital = id => CP_HOSPITALS.find(h=>h.id===id) || CP_HOSPITALS[0];

function cpDefaultVisit(){
  return {mode:'opd', lang:'zh', phase:'home', now:cpMin('10:25'), current:18, mine:25, avg:5, delayed:false, prevEnd:null,
          pushed:false, ret:'none', driver:'none', treatStart:cpMin('08:30'), treatLen:240, treatNow:cpMin('11:30'), log:[]};
}
function cp(){ return state.careplus || {series:null, visit:cpDefaultVisit()}; }
function cpSave(fn,message){ update(next=>{ next.careplus = next.careplus || {series:null, visit:cpDefaultVisit()}; fn(next.careplus); }, message); }

// ---------- 計算 ----------
function cpTravel(date){ // 展示用規則：週一早上車多 +10 分；預報下雨的日子 +5 分
  const wd = cpWeekday(date); let t = 20, why = '路況一般';
  if(wd===1){ t += 10; why = '週一早上車多'; }
  if(date.endsWith('9') || date.endsWith('4')){ t += 5; why += '、預報下雨'; }
  return {t, why};
}
function cpSeriesDates(s){
  const out = [];
  for(let i=0;i<s.span;i++){ const d = cpAddDays(s.start,i); if(s.days.includes(cpWeekday(d))) out.push(d); }
  return out;
}
function cpVisitCalc(v){
  if(v.mode==='treat'){
    const end = v.treatStart + v.treatLen;
    return {end, left:Math.max(0,end-v.treatNow), turn:null};
  }
  const ahead = Math.max(0, v.mine - v.current);
  const turn = v.now + ahead*v.avg;
  const end = v.endFixed ?? cpRound5(turn + 30); // 看診約 10 分鐘＋批價領藥約 20 分鐘
  const leave = turn - 10 - 20;     // 提早 10 分鐘到、車程約 20 分鐘
  return {ahead, turn, end, leave, wait:ahead*v.avg};
}

// ---------- 首頁卡片 ----------
function cpRenderHome(){
  const box = $('cp-home'); if(!box) return;
  const s = cp().series;
  if(!s){
    box.innerHTML = `<div class="section-heading"><h2>長期預約</h2><span class="status-pill">Care+</span></div>
      <p class="cp-lead">回診時間固定？一次排好一個月的接送。</p>
      <p class="preview-meta">日期由您決定，每次出門時間由 AI 依路況與天氣推薦。</p>
      <div class="cp-actions"><button type="button" class="btn primary" data-cpa="open-longterm">＋ 設定長期預約</button><button type="button" class="btn secondary" data-cpa="open-visit">看診當天進度</button></div>`;
    return;
  }
  const h = cpHospital(s.hospital), dates = cpSeriesDates(s);
  const today = nowTaipei().date, next = dates.find(d=>d>=today) || dates[0];
  const tr = cpTravel(next), leave = cpMin(s.time) - 15 - tr.t;
  box.innerHTML = `<div class="section-heading"><h2>長期預約</h2><span class="status-pill">已預約 ${dates.length} 次</span></div>
    <p class="cp-lead">每週${s.days.map(d=>CP_DAYS[d]).join('、')}・${esc(h.name)}</p>
    <p class="preview-meta">${esc(h.dept)}・看診 ${esc(s.time)}・${cpShort(s.start)} 起 ${s.span===30?'1 個月':s.span===14?'2 週':'3 個月'}</p>
    ${s.wheel?'<p class="cp-tag">需無障礙輪椅車輛</p>':''}
    <div class="cp-ai"><span class="cp-ai-label">AI 推薦</span><p>下一次 ${cpShort(next)}：建議 <b>${cpFmt(leave)}</b> 出門（${esc(tr.why)}，車程約 ${tr.t} 分鐘）</p></div>
    <div class="cp-actions"><button type="button" class="btn primary" data-cpa="open-visit">看診當天進度</button><button type="button" class="btn secondary" data-cpa="open-longterm">修改長期預約</button></div>`;
}

// ---------- 長期預約 ----------
let cpDaysSel = [1,3,5];
function cpOpenLongterm(){
  const s = cp().series;
  $('cp-longterm-form').reset(); clearError('cp-error'); $('cp-voice-text').hidden = true;
  const sel = $('cp-hospital');
  sel.innerHTML = CP_HOSPITALS.map(h=>`<option value="${h.id}">${esc(h.name)}｜${esc(h.dept)}</option>`).join('');
  sel.value = s?.hospital || 'ntuh';
  cpDaysSel = s?.days ? [...s.days] : [1,3,5];
  const today = nowTaipei().date; let mon = cpAddDays(today,1); while(cpWeekday(mon)!==1) mon = cpAddDays(mon,1);
  $('cp-start').value = s?.start || mon; $('cp-start').min = today;
  $('cp-span').value = String(s?.span || 30);
  $('cp-time').value = s?.time || '09:00';
  $('cp-wheel').checked = Boolean(s?.wheel);
  cpRenderDays(); cpRenderPreview(); openDialog('cp-longterm-dialog');
}
function cpRenderDays(){
  $('cp-day-row').innerHTML = [1,2,3,4,5,6,0].map(d=>`<button type="button" class="cp-day ${cpDaysSel.includes(d)?'on':''}" data-cpa="toggle-day" data-day="${d}" aria-pressed="${cpDaysSel.includes(d)}">${CP_DAYS[d]}</button>`).join('');
}
function cpFormSeries(){
  return {hospital:$('cp-hospital').value, days:[...cpDaysSel].sort(), start:$('cp-start').value, span:Number($('cp-span').value)||30, time:$('cp-time').value||'09:00', wheel:$('cp-wheel').checked};
}
function cpRenderPreview(){
  const s = cpFormSeries(), box = $('cp-preview');
  if(!s.days.length || !/^\d{4}-\d{2}-\d{2}$/.test(s.start)){ box.innerHTML = '<p class="preview-empty">請選擇每週回診的日子。</p>'; return; }
  const dates = cpSeriesDates(s);
  const rows = dates.slice(0,3).map(d=>{ const tr = cpTravel(d); return `<li><span>${cpShort(d)}</span><b>${cpFmt(cpMin(s.time)-15-tr.t)} 出門</b><small>${esc(tr.why)}・車程約 ${tr.t} 分</small></li>`; }).join('');
  box.innerHTML = `<div class="cp-preview-head"><strong>共 ${dates.length} 次回診、${dates.length*2} 趟接送</strong><span>去程自動預約・回程看完一鍵叫車</span></div>
    <ul class="cp-preview-list">${rows}</ul>${dates.length>3?`<p class="help-text">…其餘 ${dates.length-3} 次也會依當天預計路況與天氣推薦出門時間（展示規則）。</p>`:''}`;
}
function cpSaveLongterm(){
  const s = cpFormSeries();
  if(!s.days.length) throw Error('請至少選一天');
  const dates = cpSeriesDates(s);
  if(!dates.length) throw Error('這段期間沒有符合的日子');
  ensureFuture(dates[0], s.time);
  const h = cpHospital(s.hospital);
  update(next=>{
    next.careplus = next.careplus || {series:null, visit:cpDefaultVisit()};
    next.appointments = next.appointments.filter(a=>!a.series || next.rides.some(r=>isRideActive(r)&&r.appointmentId===a.id));
    if(next.appointments.length + dates.length > 50) throw Error('回診紀錄已達上限，請先刪除舊的回診');
    const note = `長期預約（每週${s.days.map(d=>CP_DAYS[d]).join('、')}）${s.wheel?'・需無障礙輪椅車輛':''}`;
    for(const d of dates) next.appointments.push({id:uid(), date:d, time:s.time, hospital:`${h.name} ${h.dept}`, address:h.address, note, series:true, createdAt:new Date().toISOString()});
    next.careplus.series = s;
    next.careplus.visit = {...cpDefaultVisit(), lang:next.careplus.visit?.lang||'zh'};
  }, `已預約 ${dates.length} 次回診，去程車會自動安排`);
  closeDialog($('cp-longterm-dialog'));
}

// ---------- 語音 ----------
let cpRecog = null, cpListenTimer = null;
function cpListen(lang, fallback, onText){
  const box = $('cp-listen'), T = CP_TEXT[lang] || CP_TEXT.zh;
  box.innerHTML = `<div class="cp-listen-card"><div class="cp-mic-ring" aria-hidden="true"></div><p>${esc(lang==='id'?T.listening:'正在聆聽…')}</p><small>${esc(T.lang)}</small><button type="button" class="btn ghost" data-cpa="stop-listen">取消</button></div>`;
  box.hidden = false;
  const done = (text, simulated) => { clearTimeout(cpListenTimer); try{cpRecog?.abort();}catch{} cpRecog = null; box.hidden = true; onText(text, simulated); };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR || CP_SIMVOICE){ cpListenTimer = setTimeout(()=>done(fallback,true), 1600); return; }
  try{
    cpRecog = new SR(); cpRecog.lang = lang==='id'?'id-ID':'zh-TW'; cpRecog.interimResults = false; cpRecog.maxAlternatives = 1;
    cpRecog.onresult = e => done(e.results[0][0].transcript, false);
    cpRecog.onerror = () => done(fallback, true);
    cpRecog.start();
    cpListenTimer = setTimeout(()=>done(fallback,true), 5000);
  }catch{ cpListenTimer = setTimeout(()=>done(fallback,true), 1600); }
}
function cpStopListen(){ clearTimeout(cpListenTimer); try{cpRecog?.abort();}catch{} cpRecog = null; $('cp-listen').hidden = true; }
function cpParseBooking(text){
  const m = text.match(/(?:每週|每周|星期|禮拜|週|周)([一二三四五六日天、,，和及\s]+)/);
  if(m){ const map = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0}; const days = [...new Set([...m[1]].filter(c=>c in map).map(c=>map[c]))]; if(days.length) cpDaysSel = days; }
  const h = CP_HOSPITALS.find(x=>text.includes(x.name) || (x.id==='ntuh'&&text.includes('台大')) || (x.id==='tcvgh'&&/中榮|台中榮/.test(text)) || (x.id==='mlh'&&text.includes('苗栗')));
  if(h) $('cp-hospital').value = h.id;
  const num = {'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12};
  const t = text.match(/(七|八|九|十一|十二|十|\d{1,2})\s*點(半)?/);
  if(t){ let hh = num[t[1]] ?? Number(t[1]); if(/下午/.test(text) && hh<12) hh += 12; $('cp-time').value = `${String(hh).padStart(2,'0')}:${t[2]?'30':'00'}`; }
  if(/輪椅|無障礙/.test(text)) $('cp-wheel').checked = true;
  cpRenderDays(); cpRenderPreview();
}

// ---------- 看診當天 ----------
function cpRenderVisit(){
  const box = $('cp-visit'); if(!box) return;
  const c = cp(), v = c.visit || cpDefaultVisit(), s = c.series, h = cpHospital(s?.hospital), T = CP_TEXT[v.lang] || CP_TEXT.zh;
  const k = cpVisitCalc(v);
  const wheel = s?.wheel ? '<span class="cp-tag">需無障礙輪椅車輛</span>' : '';
  let head;
  if(v.mode==='opd'){
    head = `<section class="card cp-queue-card">
      <div class="cp-hosp"><strong>${esc(h.name)}</strong><span>｜${esc(h.dept)}</span></div>
      <div class="cp-queue"><div><span>目前燈號</span><b class="cp-num">${v.current}</b><small>號</small></div><div class="cp-mine"><span>陳奶奶的號碼</span><b class="cp-num">${v.mine}</b><small>號</small></div></div>
      <div class="cp-ai"><span class="cp-ai-label">AI 計算</span>${v.phase==='done'?'':`<p>今天平均每號 <b>${v.avg} 分鐘</b>，前面還有 ${k.ahead} 位，預估還需 <b>${k.wait} 分鐘</b>（約 ${cpFmt(k.turn)} 輪到）</p>`}
      ${v.phase==='home'?`<p class="cp-ai-main">建議 <b>${cpFmt(k.leave)}</b> 出門・去程車已調整為 ${cpFmt(k.leave)} 到樓下</p>`:v.phase==='done'?`<p class="cp-ai-main">看診與領藥完成（${cpFmt(k.end)}），可以叫回程了</p>`:`<p class="cp-ai-main">預估看完（含批價領藥）：<b>${cpFmt(k.end)}</b></p>`}</div>
      <p class="cp-source">燈號：模擬醫院公開的看診進度（展示資料）</p></section>`;
  }else{
    const pct = Math.min(100, Math.round((v.treatNow - v.treatStart)/v.treatLen*100));
    head = `<section class="card cp-queue-card">
      <div class="cp-hosp"><strong>${esc(h.name)}</strong><span>｜透析室</span></div>
      <div class="cp-treat"><div class="cp-treat-row"><span>療程 ${cpFmt(v.treatStart)} 開始・預計 ${Math.round(v.treatLen/60)} 小時</span><b>剩 ${k.left} 分鐘</b></div><div class="cp-bar"><i style="width:${pct}%"></i></div></div>
      <div class="cp-ai"><span class="cp-ai-label">AI 計算</span><p>透析時間固定，依療程開始時間推算結束：<b>${cpFmt(k.end)}</b>，最後 15 分鐘提醒預約回程。</p></div>
      <p class="cp-source">療程型回診不看燈號，依療程時間觸發（展示資料）</p></section>`;
  }
  const delay = v.delayed && v.mode==='opd' ? `<section class="cp-alert" role="status"><strong>偵測到看診進度延遲</strong><p>燈號停在 ${v.delayAt ?? v.current} 號已 25 分鐘。預估結束時間由 <b>${cpFmt(v.prevEnd)}</b> 延後至 <b>${cpFmt(k.end)}</b>，已自動為您向後平移回程派車與司機任務池。</p></section>` : '';
  const retMap = {
    none:{pill:'尚未預約', text:'快輪到時會提醒您預約回程。'},
    reserved:{pill:'回程已預約', text:`${esc(h.zone)}已為您保留待命車，預計 ${cpFmt(k.end)} 前後出發。看完診按下方按鈕就派車。`},
    dispatched:{pill:'已派車', text:'待命車 RAB-5821（白色）約 3 分鐘到醫院大門口。'},
    accepted:{pill:'司機已接單', text:'司機已接單，約 3 分鐘到醫院大門口。'},
    transferred:{pill:'已改派', text:'原司機無法提早，已轉給待命司機 RCD-3307（銀色），約 2 分鐘到。'}
  };
  const r = retMap[v.ret==='dispatched' && v.driver!=='none' ? v.driver : v.ret] || retMap.none;
  const doneBtns = v.phase==='done' && v.ret!=='dispatched' ? `<button type="button" class="cp-onetap" data-cpa="one-tap">${esc(T.oneTap)}</button><button type="button" class="btn secondary full" data-cpa="voice-return">🎤 ${esc(T.speak)}</button>` : '';
  const ret = `<section class="card"><div class="section-heading"><h2>回程</h2><span class="status-pill">${r.pill}</span></div>${wheel}<p class="cp-ret-text">${r.text}</p>${doneBtns}${v.heard?`<p class="help-text">語音辨識：「${esc(v.heard)}」${v.heardSim?'（展示：模擬辨識）':''}</p>`:''}</section>`;
  box.innerHTML = head + delay + ret;
  cpRenderControls();
}
function cpRenderControls(){
  const box = $('cp-demo-controls'); if(!box) return;
  const v = cp().visit || cpDefaultVisit();
  const opd = [
    ['step-home','① 出門前：看燈號'], ['step-plus','燈號 +1'], ['step-delay','② 延誤：卡 25 分鐘'],
    ['step-24','③ 跳到 24 號（推播）'], ['step-done','④ 看診完成']];
  const treat = [['treat-15','療程剩 15 分（推播）'], ['treat-done','療程結束']];
  box.innerHTML = (v.mode==='opd'?opd:treat).map(([a,l])=>`<button type="button" class="btn secondary" data-cpa="${a}">${l}</button>`).join('') +
    `<button type="button" class="btn ghost" data-cpa="toggle-mode">切換：${v.mode==='opd'?'療程型（透析）':'門診（燈號）'}</button>
     <button type="button" class="btn ghost" data-cpa="toggle-lang">看護語言：${v.lang==='id'?'Bahasa Indonesia':'中文'}</button>
     <button type="button" class="btn ghost" data-cpa="reset-visit">重設展示</button>`;
}
function cpPush(){
  const v = cp().visit, T = CP_TEXT[v.lang] || CP_TEXT.zh, Z = CP_TEXT.zh;
  const body = v.mode==='opd' ? T.pushOpd(v.current, v.mine) : T.pushTreat;
  const zh = v.lang==='id' ? `<p class="cp-push-zh">${esc(v.mode==='opd'?Z.pushOpd(v.current,v.mine):Z.pushTreat)}</p>` : '';
  const box = $('cp-push');
  box.innerHTML = `<div class="cp-push-card"><div class="cp-push-head"><span class="cp-push-icon" aria-hidden="true">t</span><span>taxi Care+</span><small>現在</small></div><p class="cp-push-body">${esc(body)}</p>${zh}
    <div class="cp-push-actions"><button type="button" class="btn ghost" data-cpa="push-later">${esc(T.later)}</button><button type="button" class="btn primary" data-cpa="push-reserve">${esc(T.reserve)}</button></div></div>`;
  box.hidden = false;
}
function cpDispatch(heard, sim){
  cpSave(c=>{ c.visit.ret = 'dispatched'; c.visit.driver = 'none'; if(heard!==undefined){ c.visit.heard = heard; c.visit.heardSim = sim; } }, '已派車：醫院旁的待命車出發');
}

// ---------- 司機任務池 ----------
function cpRenderPool(){
  const box = $('driver-pool'); if(!box) return;
  const c = cp(), s = c.series, v = c.visit || cpDefaultVisit(), h = cpHospital(s?.hospital), k = cpVisitCalc(v);
  const items = [];
  if(s){
    const next = cpSeriesDates(s).find(d=>d>=nowTaipei().date);
    if(next){ const tr = cpTravel(next); items.push(`<div class="cp-task"><div><strong>長期預約・去程</strong><p>${cpShort(next)} ${cpFmt(cpMin(s.time)-15-tr.t)} 住家 → ${esc(h.name)}</p>${s.wheel?'<span class="cp-tag">需無障礙輪椅車輛</span>':''}</div><span class="status-pill">已預約</span></div>`); }
  }
  if(v.ret==='reserved' || (v.delayed && v.ret==='none')){
    items.push(`<div class="cp-task"><div><strong>回程・${esc(h.zone)}</strong><p>預計 ${cpFmt(k.end)} 出發${v.delayed?`（已由 ${cpFmt(v.prevEnd)} 自動平移）`:''}</p>${s?.wheel?'<span class="cp-tag">需無障礙輪椅車輛</span>':''}</div><span class="status-pill">${v.ret==='reserved'?'待命保留':'預估中'}</span></div>`);
  }
  if(v.ret==='dispatched'){
    const st = v.driver==='accepted' ? '<p class="cp-ok">已接單，前往醫院大門口</p>' : v.driver==='transferred' ? '<p class="cp-ok">已轉給待命司機 RCD-3307，您不會被記違規</p>' :
      `<div class="cp-actions"><button type="button" class="btn primary" data-cpa="drv-accept">接單（約 3 分鐘）</button><button type="button" class="btn secondary" data-cpa="drv-transfer">無法接，轉給其他待命司機</button></div>`;
    items.push(`<div class="cp-task cp-task-hot"><div><strong>回程・立即出發</strong><p>${esc(h.name)}大門口 → 住家</p>${s?.wheel?'<span class="cp-tag">需無障礙輪椅車輛</span>':''}${st}</div></div>`);
  }
  box.innerHTML = `<div class="section-heading"><h2>醫院待命區・任務池</h2><span class="status-pill">示範資料</span></div>
    <div class="cp-zone"><div><span>${esc(h.zone)}</span><b>待命車 3 台</b></div><div><span>AI 預測 11–12 點離院</span><b>約 8 趟</b></div></div>
    ${items.length?items.join(''):'<p class="preview-empty">目前沒有預約或回程任務。</p>'}`;
}

function renderCare(){ cpRenderHome(); cpRenderVisit(); cpRenderPool(); }

// ---------- 事件 ----------
document.addEventListener('click', event=>{
  const b = event.target.closest('[data-cpa]'); if(!b) return;
  const a = b.dataset.cpa;
  try{
    if(a==='open-longterm') cpOpenLongterm();
    else if(a==='open-visit') setView('visit');
    else if(a==='toggle-day'){ const d = Number(b.dataset.day); cpDaysSel = cpDaysSel.includes(d)?cpDaysSel.filter(x=>x!==d):[...cpDaysSel,d]; cpRenderDays(); cpRenderPreview(); }
    else if(a==='voice-booking') cpListen('zh','每週一三五早上九點去台大醫院，需要輪椅車', (text,sim)=>{ const p = $('cp-voice-text'); p.textContent = `語音辨識：「${text}」${sim?'（展示：模擬辨識）':''}`; p.hidden = false; cpParseBooking(text); });
    else if(a==='stop-listen') cpStopListen();
    else if(a==='step-home') cpSave(c=>{ c.visit = {...cpDefaultVisit(), lang:c.visit?.lang||'zh'}; });
    else if(a==='step-plus') cpSave(c=>{ const v = c.visit; if(v.current>=v.mine) return; v.current++; v.now += v.avg; v.phase = 'hospital'; });
    else if(a==='step-delay') cpSave(c=>{ const v = c.visit; if(v.delayed) return; v.prevEnd = cpVisitCalc(v).end; v.delayAt = v.current; v.now += 25; v.avg = 6; v.delayed = true; v.phase = 'hospital'; }, '偵測到看診延遲，已自動平移回程');
    else if(a==='step-24'){ cpSave(c=>{ const v = c.visit; v.now += Math.max(0,24-v.current)*v.avg; v.current = 24; v.phase = 'hospital'; v.pushed = true; }); cpPush(); }
    else if(a==='step-done') cpSave(c=>{ const v = c.visit; if(v.phase==='done') return; const e = cpVisitCalc(v).end; v.endFixed = e; v.now = e; v.current = v.mine; v.phase = 'done'; });
    else if(a==='treat-15'){ cpSave(c=>{ const v = c.visit; v.treatNow = v.treatStart + v.treatLen - 15; v.pushed = true; v.phase = 'hospital'; }); cpPush(); }
    else if(a==='treat-done') cpSave(c=>{ const v = c.visit; v.treatNow = v.treatStart + v.treatLen; v.phase = 'done'; });
    else if(a==='toggle-mode') cpSave(c=>{ c.visit = {...cpDefaultVisit(), lang:c.visit.lang, mode:c.visit.mode==='opd'?'treat':'opd', phase:'hospital'}; });
    else if(a==='toggle-lang') cpSave(c=>{ c.visit.lang = c.visit.lang==='id'?'zh':'id'; });
    else if(a==='reset-visit') cpSave(c=>{ c.visit = cpDefaultVisit(); }, '已重設展示');
    else if(a==='push-reserve'){ $('cp-push').hidden = true; cpSave(c=>{ c.visit.ret = 'reserved'; }, '回程已預約，待命車保留中'); }
    else if(a==='push-later') $('cp-push').hidden = true;
    else if(a==='one-tap') cpDispatch();
    else if(a==='voice-return'){ const v = cp().visit, T = CP_TEXT[v.lang]||CP_TEXT.zh; cpListen(v.lang, T.fallback, (text,sim)=>{ if(/好了|回家|叫車|selesai|pulang|taksi/i.test(text)) cpDispatch(text,sim); else { cpSave(c=>{ c.visit.heard = text; c.visit.heardSim = sim; }); toast('沒聽清楚，請再說一次「好了」'); } }); }
    else if(a==='drv-accept') cpSave(c=>{ c.visit.driver = 'accepted'; }, '已接單');
    else if(a==='drv-transfer') cpSave(c=>{ c.visit.driver = 'transferred'; }, '已轉給同一待命區的其他司機');
  }catch(error){ if(b.closest('#cp-longterm-dialog')) showError('cp-error', error.message); else toast(error.message); }
});
$('cp-longterm-form').addEventListener('submit', e=>{ e.preventDefault(); clearError('cp-error'); try{ cpSaveLongterm(); }catch(error){ showError('cp-error', error.message); } });
for(const id of ['cp-hospital','cp-start','cp-span','cp-time','cp-wheel']) $(id).addEventListener('change', cpRenderPreview);
renderCare();
