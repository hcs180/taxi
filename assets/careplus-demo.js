'use strict';

// 錄影情境控制器：只在網址含 ?demo 時建立。每個按鈕都呼叫與一般操作相同的 cpEvents，讓三端讀到同一份狀態。

const CPD_KEY = 'cp-demo-ui';
function cpdPrefs(){
  try{ return Object.assign({open:false, hidden:false, autoClose:true}, JSON.parse(sessionStorage.getItem(CPD_KEY) || '{}')); }
  catch{ return {open:false, hidden:false, autoClose:true}; }
}
function cpdSave(p){ try{ sessionStorage.setItem(CPD_KEY, JSON.stringify(p)); }catch{} }
let cpdUi = cpdPrefs();
if(CP_PARAMS.has('panel')){ cpdUi.hidden = false; cpdSave(cpdUi); }
if(CP_DEMO && CP_PARAMS.has('simvoice')){ try{ if(sessionStorage.getItem('cp-simvoice') === null) sessionStorage.setItem('cp-simvoice', '1'); }catch{} }

function cpdCloseOverlays(){
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  if(typeof cpVoice !== 'undefined') cpVoice.close();
  cpVoiceReturn = null;
}
function cpdReset(silent){
  cpdCloseOverlays();
  update(s => {
    s.appointments = []; s.rides = []; s.careplus = cpDefaultState(); s.sharedLocation = null;
    s.preferences.homeAddress = CP_DEMO_HOME; s.preferences.careLang = 'zh';
  }, silent ? null : '情境已重設');
  selectedRideId = '';
  switchRole('senior'); setView('home');
}
function cpdLoad(){
  cpdReset(true);
  cpEvents.saveBooking(cpDefaultForm(), null);
  cpEvents.enterVisitDay();
  switchRole('senior'); setView('visit');
  toast('已載入完整示範資料');
}
function cpdArrive(){
  const {a, ob} = cpCtx();
  if(!a) throw Error('請先載入示範資料或進入看診當天');
  if(ob && ob.status === 'scheduled') cpEvents.outboundAccept(a.id, CP_SELF_DRIVER);
  cpEvents.arriveHospital();
}
function cpdNextReturnStep(){
  const r = state.rides.find(x => x.kind === 'return' && ['assigned','arrived_pickup','onboard'].includes(x.status));
  if(!r) throw Error('目前沒有已接單的回程');
  cpEvents.driverProgress(r.id);
}
function cpdSimVoice(){ try{ return sessionStorage.getItem('cp-simvoice') === '1'; }catch{ return false; } }

const CPD_ACTIONS = {
  reset:() => cpdReset(false),
  load:cpdLoad,
  enter:() => { cpEvents.enterVisitDay(); if(currentRole === 'senior') setView('visit'); },
  arrive:cpdArrive,
  adv:() => cpEvents.advanceQueue(1),
  delay:() => cpEvents.stall(25),
  near:() => cpEvents.jumpTo(24),
  done:() => cpEvents.finishVisit(),
  mode:() => { const {q} = cpCtx(); cpEvents.setMode(q && q.mode === 'treatment' ? 'opd' : 'treatment'); },
  t15:() => cpEvents.treatmentRemaining(15),
  fail:() => cpEvents.failMatch(),
  next:cpdNextReturnStep,
  voice:() => { const on = !cpdSimVoice(); try{ sessionStorage.setItem('cp-simvoice', on ? '1' : '0'); }catch{} toast(on ? '模擬語音：開啟' : '模擬語音：關閉（使用瀏覽器語音辨識）'); },
  'role-senior':() => switchRole('senior'),
  'role-family':() => switchRole('family'),
  'role-driver':() => switchRole('driver'),
  'lang-zh':() => cpEvents.setLang('zh'),
  'lang-id':() => cpEvents.setLang('id'),
  collapse:() => { cpdUi.open = false; },
  expand:() => { cpdUi.open = true; },
  hide:() => { cpdUi.hidden = true; cpdUi.open = false; toast('控制器已隱藏，按 Shift + D 或在網址加上 &panel 可再顯示', 3200); }
};
const CPD_KEEP_OPEN = new Set(['expand','voice','lang-zh','lang-id','collapse','hide']);

function cpdStatus(){
  const {a, q, k, rr, ob} = cpCtx();
  if(!a || !q) return '尚未建立長期預約';
  const ret = rr ? CP_RETURN_LABEL[rr.status] : '尚未登記';
  const head = `${cpShortDate(a.date)}・情境時間 ${cpFmt(q.observationTime)}`;
  const mid = q.mode === 'opd' ? `燈號 ${q.currentQueueNumber}／${q.patientQueueNumber}・預估看完 ${cpFmt(k.finish)}${q.delay ? '（延誤）' : ''}` : `療程剩 ${k.remaining} 分・預估完成 ${cpFmt(k.finish)}`;
  const go = ob ? {scheduled:'去程已安排', accepted:'去程已派車', arrived:'已抵達醫院'}[ob.status] : '';
  return `${head}<br>${mid}<br>${go}・回程：${ret}`;
}
function cpRenderDemo(){
  if(!CP_DEMO) return;
  let root = $('cp-demo-root');
  if(!root){ root = document.createElement('div'); root.id = 'cp-demo-root'; root.className = 'cpd'; root.setAttribute('aria-label', '錄影情境控制'); document.body.appendChild(root); }
  root.hidden = cpdUi.hidden;
  root.classList.toggle('open', cpdUi.open);
  if(cpdUi.hidden) return;
  if(!cpdUi.open){ root.innerHTML = `<button type="button" class="cpd-fab" data-cpd="expand">${cpIcon('sliders')}情境控制</button>`; return; }
  const {q} = cpCtx(), lang = cpLang(), sim = cpdSimVoice();
  const b = (act, label, cls = '') => `<button type="button" data-cpd="${act}" class="${cls}">${label}</button>`;
  root.innerHTML = `<div class="cpd-panel" role="region" aria-label="錄影情境控制">
    <div class="cpd-head"><strong>錄影情境控制</strong>${b('collapse','收合')}${b('hide','隱藏')}</div>
    <div class="cpd-status">${cpdStatus()}</div>
    <div class="cpd-sec"><h3>情境</h3><div class="cpd-grid">${b('reset','重設情境')}${b('load','載入完整示範資料','strong')}${b('enter','進入看診當天','wide')}</div></div>
    <div class="cpd-sec"><h3>看診進度</h3><div class="cpd-grid">${b('arrive','抵達醫院')}${b('adv','燈號 +1')}${b('delay','延誤：停滯 25 分')}${b('near','燈號到 24 號')}${b('done','看診完成','wide')}</div></div>
    <div class="cpd-sec"><h3>療程</h3><div class="cpd-grid">${b('mode', q && q.mode === 'treatment' ? '切換為一般門診' : '切換為固定療程')}${b('t15','療程剩 15 分')}</div></div>
    <div class="cpd-sec"><h3>回程派車</h3><div class="cpd-grid">${b('fail','模擬媒合失敗')}${b('next','回程行程下一步')}</div></div>
    <div class="cpd-sec"><h3>身分</h3><div class="cpd-grid" style="grid-template-columns:repeat(3,1fr)">${b('role-senior','長者', currentRole === 'senior' ? 'on' : '')}${b('role-family','家屬', currentRole === 'family' ? 'on' : '')}${b('role-driver','司機', currentRole === 'driver' ? 'on' : '')}</div></div>
    <div class="cpd-sec"><h3>照護語言・語音</h3><div class="cpd-grid">${b('lang-zh','中文', lang === 'zh' ? 'on' : '')}${b('lang-id','中文＋印尼文', lang === 'id' ? 'on' : '')}${b('voice', sim ? '模擬語音：開' : '模擬語音：關', sim ? 'on wide' : 'wide')}</div></div>
    <label class="cpd-check"><input type="checkbox" id="cpd-auto" ${cpdUi.autoClose ? 'checked' : ''}>執行後自動收合</label>
  </div>`;
}
if(CP_DEMO){
  document.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-cpd]'); if(!btn) return;
    const act = btn.dataset.cpd, fn = CPD_ACTIONS[act]; if(!fn) return;
    try{
      fn();
      if(cpdUi.autoClose && !CPD_KEEP_OPEN.has(act)) cpdUi.open = false;
    }catch(e){ toast(e.message); }
    cpdSave(cpdUi); cpRenderDemo();
  });
  document.addEventListener('change', ev => { if(ev.target.id === 'cpd-auto'){ cpdUi.autoClose = ev.target.checked; cpdSave(cpdUi); } });
  document.addEventListener('keydown', ev => {
    if(ev.shiftKey && (ev.key === 'D' || ev.key === 'd') && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)){ cpdUi.hidden = !cpdUi.hidden; cpdSave(cpdUi); cpRenderDemo(); }
  });
  cpRenderDemo();
}
