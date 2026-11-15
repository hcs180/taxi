'use strict';

// Care+ 介面：長者首頁、長期預約、看診當天、推播、家屬時間軸與司機待命區。畫面只讀狀態，操作一律呼叫 cpEvents。

const cpIcon = (name, cls = 'ic') => `<svg class="${cls}" aria-hidden="true" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${name}"/></svg>`;
const CP_TXT = {
  zh:{oneTap:'我好了，一鍵叫車', speak:'用說的叫車', register:'先登記回程', later:'稍後再說',
      opdTitle:n => `快輪到${n}了！`, opdBody:(c,m) => `目前看診 ${c} 號，您的號碼是 ${m} 號。`, treatTitle:'療程快結束了', treatBody:'預估療程剩餘 15 分鐘。', ask:'是否要先登記回程需求？', listen:'請說「我好了」或「我要回家」'},
  id:{oneTap:'Sudah selesai, panggil taksi', speak:'Bicara untuk memanggil taksi', register:'Daftarkan pulang dulu', later:'Nanti saja',
      opdTitle:n => `Sebentar lagi giliran ${n}!`, opdBody:(c,m) => `Sekarang nomor ${c}, nomor Anda ${m}.`, treatTitle:'Terapi hampir selesai', treatBody:'Perkiraan sisa terapi 15 menit.', ask:'Daftarkan kebutuhan pulang dulu?', listen:'Ucapkan “sudah selesai” atau “mau pulang”'}
};
const cpLang = () => (state.preferences && state.preferences.careLang) === 'id' ? 'id' : 'zh';
const cpT = () => CP_TXT[cpLang()];
const cpBi = key => { const zh = CP_TXT.zh[key], other = cpT()[key]; return cpLang() === 'id' && typeof zh === 'string' ? `${esc(zh)}<small class="cp-bi">${esc(other)}</small>` : esc(zh); };
const cpPill = (text, tone = '') => `<span class="cp-pill ${tone}">${esc(text)}</span>`;
let cpVoiceReturn = null;
let cpHeatZone = 0;
let cpEditingBooking = null;
let cpDraftDays = [1,3,5];
let cpConfirmFn = null;

function cpCtx(s = state){
  const cp = s.careplus || cpDefaultState();
  const a = s.appointments.find(x => x.id === cp.focusAppointmentId) || null;
  const q = a ? cp.queues[a.id] || null : null;
  const k = q ? cpCalc(q) : null;
  const ob = a ? cp.outbound[a.id] || null : null;
  const rr = a ? cp.returnRequests.find(r => r.appointmentId === a.id) || null : null;
  const ride = rr && rr.rideId ? s.rides.find(r => r.id === rr.rideId) || null : null;
  const b = a ? cp.bookings.find(x => x.id === a.recurringBookingId) || null : cp.bookings.find(x => x.status === 'active') || null;
  return {cp, a, q, k, ob, rr, ride, b, h:a ? cpHospital(a.hospitalId) : b ? cpHospital(b.hospitalId) : null};
}
const cpModeLabel = m => m === 'treatment' ? '固定時長療程' : '一般門診';
const cpWeekdaysLabel = days => `每週${[...days].sort((x,y) => (x||7)-(y||7)).map(d => CP_DAYS[d]).join('、')}`;
const cpVehicleLabel = w => w ? '無障礙輪椅車輛' : '一般車輛';

// ---------- 長者首頁 ----------
function cpRenderHome(){
  const box = $('cp-home-status'); if(!box) return;
  const {cp, a, q, k, rr, ride, b, h} = cpCtx();
  const active = cpActiveBooking(state);
  $('cp-booking-title').textContent = active ? '我的長期預約' : '設定長期預約';
  $('cp-booking-sub').textContent = active ? `${cpWeekdaysLabel(active.weekdays)}・${cpHospital(active.hospitalId).name}` : '一次排好固定回診的去程';
  $('cp-visit-sub').textContent = a && q ? (q.phase === 'before' ? `${cpShortDate(a.date)} 建議 ${cpFmt(k.departure)} 出門` : q.phase === 'done' ? (rr && !['NO_REQUEST','INTEREST_REGISTERED','CANCELLED'].includes(rr.status) ? `回程：${CP_RETURN_LABEL[rr.status]}` : '看診已完成，可以叫回程') : q.mode === 'opd' ? `目前 ${q.currentQueueNumber} 號，您 ${q.patientQueueNumber} 號` : `療程剩 ${k.remaining} 分鐘`) : '燈號與建議出門時間';
  let html = '';
  if(rr && ride && CP_ACTIVE_RETURN.includes(rr.status)){
    const d = ride.driverId ? cpDriver(ride.driverId) : null;
    html = `<section class="cp-status-card ${d ? 'has-car' : ''}"><div><span class="cp-status-label">回程</span><strong>${esc(CP_RETURN_LABEL[rr.status])}</strong>${d ? `<p class="cp-status-plate">${esc(d.plate)}</p><p>${esc(d.color)}${esc(d.model)}・司機 ${esc(d.name)}${rr.status === 'ACCEPTED' && ride.demoVehicle ? `・約 ${ride.demoVehicle.etaMinutes} 分鐘到達` : ''}</p>` : `<p>${ride.status === 'rematching' ? '正在為您改派其他待命司機' : '系統正在通知附近的待命司機'}</p>`}</div><button type="button" class="btn secondary" data-cpa="open-visit">查看</button></section>`;
  } else if(rr && rr.status === 'MATCH_FAILED'){
    html = `<section class="cp-status-card warn"><div><span class="cp-status-label">回程</span><strong>暫時找不到合適車輛</strong><p>可以重新叫車，或稍後再試。</p></div><button type="button" class="btn primary" data-cpa="retry-ride" data-id="${esc(ride.id)}">重新叫車</button></section>`;
  } else if(q && q.phase === 'done' && rr && ['NO_REQUEST','INTEREST_REGISTERED','CANCELLED'].includes(rr.status)){
    html = `<section class="cp-onetap-wrap"><p class="cp-onetap-hint">${esc(h.name)}${q.mode === 'opd' ? '看診' : '療程'}已完成</p>${cpVoiceConfirmHtml()}<button type="button" class="cp-onetap" data-cpa="one-tap">${cpBi('oneTap')}</button><button type="button" class="btn secondary full cp-speak" data-cpa="voice-return">${cpIcon('mic','ic ic-inline')}${cpBi('speak')}</button></section>`;
  } else if(q && q.phase !== 'done' && a){
    html = `<section class="cp-status-card"><div><span class="cp-status-label">${esc(cpShortDate(a.date))} 看診當天</span><strong>${q.mode === 'opd' ? `目前 ${q.currentQueueNumber} 號・您 ${q.patientQueueNumber} 號` : `療程中・剩 ${k.remaining} 分鐘`}</strong><p>${q.phase === 'before' ? `建議 ${cpFmt(k.departure)} 出門` : `預估 ${cpFmt(k.finish)} 看完`}${q.delay ? '・看診進度延遲' : ''}${rr && rr.status === 'INTEREST_REGISTERED' ? '・已登記回程' : ''}</p></div><button type="button" class="btn secondary" data-cpa="open-visit">查看</button></section>`;
  }
  box.innerHTML = html;
}

// ---------- 長期預約表單 ----------
function cpDefaultForm(){
  const today = cpToday(); let start = today;
  for(let i = 0; i < 7 && ![1,3,5].includes(cpWeekday(start)); i++) start = cpAddDays(start, 1);
  return {hospitalId:'ntuh', department:'腎臟內科', clinicRoom:'3 診', pickupAddress:state.preferences.homeAddress || '', weekdays:[1,3,5], startDate:start, duration:30, appointmentTime:'09:00', queueMode:'opd', treatmentMinutes:240, wheelchairRequired:true};
}
function cpOpenBookingForm(bookingId){
  const b = bookingId ? state.careplus.bookings.find(x => x.id === bookingId) : null;
  cpEditingBooking = b ? b.id : null;
  const f = b ? {...b, startDate:b.startDate < cpToday() ? cpToday() : b.startDate} : cpDefaultForm();
  $('cp-longterm-form').reset(); clearError('cp-error');
  $('cp-lt-title').textContent = b ? '修改長期預約' : '設定長期預約';
  $('cp-hospital').innerHTML = CP_HOSPITALS.map(h => `<option value="${h.id}">${esc(h.name)}</option>`).join('');
  $('cp-hospital').value = f.hospitalId; $('cp-dept').value = f.department; $('cp-room').value = f.clinicRoom;
  $('cp-pickup').value = f.pickupAddress; $('cp-mode').value = f.queueMode; $('cp-treat-len').value = String(f.treatmentMinutes || 240);
  $('cp-start').value = f.startDate; $('cp-start').min = cpToday(); $('cp-span').value = String(f.duration); $('cp-time').value = f.appointmentTime;
  $('cp-wheel').checked = Boolean(f.wheelchairRequired); cpDraftDays = [...f.weekdays];
  $('cp-voice-result').hidden = true; $('cp-voice-fallback').hidden = true;
  $('cp-lt-submit').textContent = b ? '儲存修改' : '確認長期預約';
  cpRenderDays(); cpRenderPreview(); openDialog('cp-longterm-dialog');
}
function cpReadForm(){
  return {hospitalId:$('cp-hospital').value, department:$('cp-dept').value, clinicRoom:$('cp-room').value, pickupAddress:$('cp-pickup').value,
    weekdays:[...cpDraftDays], startDate:$('cp-start').value, duration:Number($('cp-span').value) || 30, appointmentTime:$('cp-time').value,
    queueMode:$('cp-mode').value, treatmentMinutes:Number($('cp-treat-len').value) || 240, wheelchairRequired:$('cp-wheel').checked};
}
function cpRenderDays(){
  $('cp-day-row').innerHTML = [1,2,3,4,5,6,0].map(d => `<button type="button" class="cp-day ${cpDraftDays.includes(d) ? 'on' : ''}" data-cpa="toggle-day" data-day="${d}" aria-pressed="${cpDraftDays.includes(d)}">${CP_DAYS[d]}</button>`).join('');
}
function cpRenderPreview(){
  const f = cpReadForm(), box = $('cp-preview');
  $('cp-treat-field').hidden = f.queueMode !== 'treatment';
  $('cp-time-label').textContent = f.queueMode === 'treatment' ? '療程開始時間' : '看診開始時間';
  if(!f.weekdays.length || !/^\d{4}-\d{2}-\d{2}$/.test(f.startDate)){ box.innerHTML = '<p class="preview-empty">請選擇每週回診的日子與首次回診日期。</p>'; return; }
  const {dates, endDate} = cpBookingDates(f), pickup = cpFmt(cpMin(f.appointmentTime || '09:00') - 30);
  box.innerHTML = `<div class="cp-preview-head"><strong>共 ${dates.length} 次回診</strong><span>${esc(cpShortDate(f.startDate))} 到 ${esc(cpShortDate(endDate))}・${esc(cpWeekdaysLabel(f.weekdays))}</span></div>
    <ul class="cp-date-chips">${dates.map(d => `<li>${esc(cpShortDate(d))}</li>`).join('')}</ul>
    <dl class="cp-summary">
      <div><dt>去程</dt><dd>${dates.length} 趟，看診前 30 分鐘（約 ${pickup}）到府；看診當天依進度調整</dd></div>
      <div><dt>回程</dt><dd>看完診按「我好了，一鍵叫車」才會派車，不預先派車</dd></div>
      <div><dt>車輛</dt><dd class="${f.wheelchairRequired ? 'cp-strong' : ''}">${esc(cpVehicleLabel(f.wheelchairRequired))}</dd></div>
    </dl>`;
}
function cpApplyParsed(p){
  if(p.hospitalId) $('cp-hospital').value = p.hospitalId;
  if(p.department) $('cp-dept').value = p.department;
  if(p.clinicRoom) $('cp-room').value = p.clinicRoom;
  if(p.weekdays) cpDraftDays = p.weekdays;
  if(p.appointmentTime) $('cp-time').value = p.appointmentTime;
  if(p.duration) $('cp-span').value = String(p.duration);
  if(p.wheelchairRequired) $('cp-wheel').checked = true;
  if(p.queueMode) $('cp-mode').value = p.queueMode;
  cpRenderDays(); cpRenderPreview();
}
function cpShowVoiceResult(text, simulated){
  const p = cpParseBookingText(text), items = [];
  if(p.weekdays) items.push(cpWeekdaysLabel(p.weekdays)); if(p.hospitalId) items.push(cpHospital(p.hospitalId).name);
  if(p.department) items.push(p.department); if(p.clinicRoom) items.push(p.clinicRoom); if(p.appointmentTime) items.push(p.appointmentTime);
  if(p.duration) items.push(CP_DURATIONS[p.duration]); if(p.wheelchairRequired) items.push('無障礙輪椅車輛：開啟'); if(p.queueMode === 'treatment') items.push('固定時長療程');
  cpApplyParsed(p);
  const box = $('cp-voice-result');
  box.innerHTML = `<p class="cp-voice-heard">${simulated ? '<span class="cp-pill">模擬語音辨識</span>' : ''}辨識結果：「${esc(text)}」</p>${items.length ? `<p>已填入：${items.map(esc).join('、')}</p><p class="help-text">請確認下方欄位，不正確可以直接修改。</p>` : '<p>沒有找到可以填入的內容，請直接修改下方欄位。</p>'}`;
  box.hidden = false; $('cp-voice-fallback').hidden = true;
}
function cpVoiceBookingFail(reason){
  const box = $('cp-voice-fallback');
  $('cp-voice-fallback-msg').textContent = `${cpVoice.failText(reason)}，請改用文字輸入，例如：每週一三五早上九點去台大醫院`;
  box.hidden = false; $('cp-voice-result').hidden = true; $('cp-voice-input').focus();
}

// ---------- 單次叫車的語音輸入 ----------
function cpShowRideVoice(text, simulated){
  const p = cpParseRideText(text), items = [], home = state.preferences.homeAddress || '';
  if(p.direction){ updateDirection(p.direction); items.push(p.direction === 'return' ? '回家' : '去醫院'); }
  const dir = currentDirection;
  if(p.hospitalId){
    const h = cpHospital(p.hospitalId);
    if(dir === 'return'){ $('ride-pickup').value = h.pickupPoint; if(home) $('ride-destination').value = home; }
    else { $('ride-destination').value = `${h.name}（${h.address}）`; if(home && !$('ride-pickup').value) $('ride-pickup').value = home; }
    items.push(h.name);
  }
  if(p.date){ $('ride-date').value = p.date; items.push(cpShortDate(p.date)); }
  if(p.time){ $('ride-time').value = p.time; items.push(p.time); }
  if(p.wheelchair !== undefined){ $('ride-wheel').checked = p.wheelchair; items.push(p.wheelchair ? '無障礙輪椅車輛' : '一般車輛'); }
  const box = $('ride-voice-result');
  box.innerHTML = `<p class="cp-voice-heard">${simulated ? '<span class="cp-pill">模擬語音辨識</span>' : ''}辨識結果：「${esc(text)}」</p>${items.length ? `<p>已填入：${items.map(esc).join('、')}</p><p class="help-text">請確認下方欄位，沒問題再按「送出叫車」。</p>` : '<p>沒有找到可以填入的內容，請直接修改下方欄位。</p>'}`;
  box.hidden = false; $('ride-voice-fallback').hidden = true;
}
function cpRideVoiceFail(reason){
  $('ride-voice-fallback-msg').textContent = `${cpVoice.failText(reason)}，請改用文字輸入，例如：明天早上八點半去台大醫院`;
  $('ride-voice-fallback').hidden = false; $('ride-voice-result').hidden = true; $('ride-voice-input').focus();
}

// ---------- 長期預約頁 ----------
function cpRenderBooking(){
  const box = $('cp-booking'); if(!box) return;
  const b = cpActiveBooking(state) || state.careplus.bookings[state.careplus.bookings.length - 1] || null;
  if(!b){ box.innerHTML = `<div class="empty-state"><h3>還沒有長期預約</h3><p>固定回診只要設定一次，未來的去程都會幫您安排好。</p><button type="button" class="btn primary" data-cpa="open-booking-form">設定長期預約</button></div>`; return; }
  const h = cpHospital(b.hospitalId), list = cpSeriesAppointments(state, b.id), today = cpToday();
  const scheduled = list.filter(a => a.status === 'scheduled' && a.date >= today).length;
  const dispatched = state.rides.filter(r => r.kind === 'return' && list.some(a => a.id === r.appointmentId) && r.status !== 'cancelled').length;
  const st = a => a.status === 'cancelled' ? ['已取消','muted'] : a.status === 'paused' ? ['已暫停接送','warn'] : a.status === 'completed' ? ['已完成','muted'] : a.date < today ? ['已過期','muted'] : a.id === state.careplus.focusAppointmentId ? ['看診當天','key'] : ['已安排去程',''];
  box.innerHTML = `<section class="card cp-booking-card ${b.status === 'cancelled' ? 'is-cancelled' : ''}">
      <div class="section-heading"><h2>${esc(h.name)} ${esc(b.department)} ${esc(b.clinicRoom)}</h2>${b.status === 'cancelled' ? cpPill('已取消','muted') : cpPill('進行中','key')}</div>
      <dl class="cp-summary">
        <div><dt>固定日期</dt><dd>${esc(cpWeekdaysLabel(b.weekdays))}・${esc(b.appointmentTime)}（${esc(cpModeLabel(b.queueMode))}）</dd></div>
        <div><dt>期間</dt><dd>${esc(cpShortDate(b.startDate))} 到 ${esc(cpShortDate(b.endDate))}（${esc(CP_DURATIONS[b.duration] || b.duration + ' 天')}）</dd></div>
        <div><dt>上車地址</dt><dd>${esc(b.pickupAddress)}</dd></div>
        <div><dt>車輛</dt><dd class="${b.wheelchairRequired ? 'cp-strong' : ''}">${esc(cpVehicleLabel(b.wheelchairRequired))}</dd></div>
      </dl>
      <div class="cp-counts"><div><b>${scheduled}</b><span>已安排去程</span></div><div><b>${list.filter(a => a.status === 'scheduled' && a.date >= today).length}</b><span>回程預估需求</span></div><div><b>${dispatched}</b><span>已正式叫車</span></div></div>
      <p class="help-text">回程不會預先派車。看完診按「我好了，一鍵叫車」後才會正式叫車。</p>
      ${b.status === 'active' ? `<div class="record-actions"><button type="button" class="btn primary" data-cpa="open-booking-form" data-id="${esc(b.id)}">修改整個長期預約</button><button type="button" class="btn ghost" data-cpa="cancel-booking" data-id="${esc(b.id)}">取消尚未執行的安排</button></div>` : `<div class="record-actions"><button type="button" class="btn primary" data-cpa="open-booking-form">重新設定長期預約</button></div>`}
    </section>
    <h2 class="cp-list-title">所有回診日期（${list.length}）</h2>
    <div class="records cp-appt-list">${list.map(a => { const [t, tone] = st(a), open = a.date >= today && ['scheduled','paused'].includes(a.status);
      return `<article class="record cp-appt"><div class="record-head"><div><h3 class="record-title">${esc(cpShortDate(a.date))} ${esc(a.time)}</h3><div class="record-meta">去程 ${esc(cpFmt(cpDefaultPickup(a)))} 到府・${esc(cpVehicleLabel(b.wheelchairRequired))}</div></div>${cpPill(t, tone)}</div>
        ${open ? `<div class="record-actions"><button type="button" class="btn secondary" data-action="edit-appointment" data-id="${esc(a.id)}">修改這次</button><button type="button" class="btn secondary" data-cpa="${a.status === 'paused' ? 'resume-appt' : 'pause-appt'}" data-id="${esc(a.id)}">${a.status === 'paused' ? '恢復接送' : '暫停這次接送'}</button><button type="button" class="btn ghost" data-cpa="cancel-appt" data-id="${esc(a.id)}">取消</button></div>` : ''}</article>`; }).join('')}</div>`;
}

// ---------- 看診當天 ----------
function cpRenderVisit(){
  const box = $('cp-visit'); if(!box) return;
  const {a, q, k, ob, rr, ride, b, h} = cpCtx();
  if(!a || !q){
    box.innerHTML = `<div class="empty-state"><h3>目前沒有看診當天的行程</h3><p>設定長期預約後，這裡會顯示看診進度、建議出門時間與回程叫車。</p><button type="button" class="btn primary" data-cpa="open-booking-form">設定長期預約</button></div>`; return;
  }
  const head = `<section class="card cp-visit-head"><div class="cp-visit-date"><span>${esc(cpShortDate(a.date))}</span>${cpPill(cpModeLabel(q.mode))}</div><h2>${esc(h.name)}</h2><p>${esc(a.department || '')} ${esc(a.clinicRoom || '')}・${q.mode === 'opd' ? '看診' : '療程'} ${esc(a.time)} 開始</p></section>`;
  let core;
  if(q.mode === 'opd'){
    const before = q.phase === 'before';
    core = `<section class="card cp-queue-card">
      <div class="cp-card-top"><h2>看診進度</h2><span class="cp-updated">最近更新 ${cpFmt(q.observationTime)}</span></div>
      <div class="cp-queue"><div><span>目前看診</span><b class="cp-num">${q.currentQueueNumber}</b><small>號</small></div><div class="cp-mine"><span>您的號碼</span><b class="cp-num">${q.patientQueueNumber}</b><small>號</small></div></div>
      ${q.phase === 'done' ? `<p class="cp-done-line">${cpIcon('check','ic ic-inline')}看診與領藥已完成（${cpFmt(q.finishedAt)}）</p>` : `
      <dl class="cp-stats">
        <div><dt>前方等待</dt><dd>${k.ahead} 個號碼</dd></div>
        <div><dt>預估等待</dt><dd>${k.wait} 分鐘</dd></div>
        <div><dt>預估輪到</dt><dd>${cpFmt(k.turn)}</dd></div>
        <div><dt>預估看完</dt><dd>${cpFmt(k.finish)}</dd></div>
        ${before ? `<div class="cp-stat-key"><dt>建議出門</dt><dd>${cpFmt(k.departure)}</dd></div>` : `<div><dt>抵達醫院</dt><dd>${q.arrivedAt != null ? cpFmt(q.arrivedAt) : '—'}</dd></div>`}
      </dl>`}
      <details class="cp-formula"><summary>估算方式</summary>
        <p>等待時間＝前方 ${k.ahead} 個號碼 × 平均每號 ${q.estimatedMinutesPerPatient} 分鐘＝${k.wait} 分鐘</p>
        <p>預計輪到＝現在 ${cpFmt(q.observationTime)}＋${k.wait} 分鐘＝${cpFmt(k.turn)}</p>
        <p>建議出門＝預計輪到 ${cpFmt(k.turn)}－車程 ${q.travelMinutes} 分鐘－緩衝 ${q.bufferMinutes} 分鐘＝${cpFmt(k.departure)}</p>
        <p>預估看完＝預計輪到＋看診與領藥 ${q.consultMinutes} 分鐘${q.delay ? `＋延誤緩衝 ${q.delayBufferMinutes} 分鐘` : ''}＝${cpFmt(k.finish)}</p>
        <p class="help-text">此為簡化估算；實際叫號可能因過號、加號而不連續。平均每號時間與車程為範例參數。</p>
      </details>
      <p class="cp-source">AI 輔助估算（模擬資料）・燈號為模擬醫院看診進度</p></section>`;
  } else {
    core = `<section class="card cp-queue-card">
      <div class="cp-card-top"><h2>療程進度</h2><span class="cp-updated">最近更新 ${cpFmt(q.observationTime)}</span></div>
      <dl class="cp-stats">
        <div><dt>開始時間</dt><dd>${cpFmt(q.treatmentStart)}</dd></div>
        <div><dt>預計長度</dt><dd>${q.treatmentMinutes} 分鐘</dd></div>
        <div><dt>預估完成</dt><dd>${cpFmt(k.finish)}</dd></div>
        ${q.phase === 'before' ? `<div class="cp-stat-key"><dt>建議出門</dt><dd>${cpFmt(k.departure)}</dd></div>` : `<div class="cp-stat-key"><dt>剩餘時間</dt><dd>${q.phase === 'done' ? '已完成' : `${k.remaining} 分鐘`}</dd></div>`}
      </dl>
      <div class="cp-bar" role="img" aria-label="療程進度 ${k.progress}%"><i style="width:${q.phase === 'before' ? 0 : k.progress}%"></i></div>
      <p class="cp-source">療程型回診不看叫號，依開始時間與預計長度估算（模擬資料）</p></section>`;
  }
  const rideActive = rr && rr.rideId && CP_ACTIVE_RETURN.includes(rr.status);
  const delay = q.delay && q.phase !== 'done' ? `<section class="cp-alert" role="status"><strong>偵測到看診進度延遲</strong><p>目前看診進度較預期慢，預估結束時間由 <b>${cpFmt(q.delay.fromFinish)}</b> 延後至 <b>${cpFmt(k.finish)}</b>。</p><p>系統已更新預估回程需求與司機待命參考時間。</p>${rideActive ? '<p class="cp-alert-note">回程車輛已在派遣中，系統不會自動修改已送出的叫車；如需調整，請取消後重新叫車。</p>' : '<p class="cp-alert-note">目前尚未派遣回程車輛。</p>'}</section>` : '';
  const obDriver = ob && ob.driverId ? cpDriver(ob.driverId) : null;
  const outbound = `<section class="card cp-trip"><div class="cp-card-top"><h2>去程</h2>${cpPill(ob.status === 'arrived' ? '已抵達醫院' : ob.status === 'accepted' ? '司機已接單' : '已安排', ob.status === 'scheduled' ? '' : 'key')}</div>
    <p>${ob.status === 'arrived' ? `已於 ${q.arrivedAt != null ? cpFmt(q.arrivedAt) : ''} 抵達${esc(h.name)}。` : `預計 <b>${cpFmt(ob.pickupTime ?? cpDefaultPickup(a))}</b> 到府接送：${esc(b ? b.pickupAddress : '')}`}</p>
    ${obDriver && ob.status !== 'arrived' ? `<p class="cp-car-line">${esc(obDriver.color)}${esc(obDriver.model)}・<b>${esc(obDriver.plate)}</b>・司機 ${esc(obDriver.name)} ${cpPill('範例車輛','muted')}</p>` : ''}
    ${ob.status === 'scheduled' ? '<p class="help-text">接送時間會依看診進度調整；司機接單後會顯示車輛資訊。</p>' : ''}
    ${ob.status === 'accepted' && ob.autoDispatched ? '<p class="help-text">依長期預約與建議出門時間自動派車。</p>' : ''}
    ${ob.status === 'accepted' && q.phase === 'before' && ob.pickupTime != null && k.departure !== ob.pickupTime ? `<p class="cp-note">依最新進度，建議出門時間為 ${cpFmt(k.departure)}。已派遣的去程維持 ${cpFmt(ob.pickupTime)}，不會自動變更。</p>` : ''}</section>`;
  const ret = cpReturnCard({a, q, k, rr, ride, b, h});
  box.innerHTML = q.phase === 'done' ? head + ret + core + outbound : head + delay + core + outbound + ret;
}
function cpReturnCard({a, q, k, rr, ride, b, h}){
  const status = rr ? rr.status : 'NO_REQUEST', d = ride && ride.driverId ? cpDriver(ride.driverId) : null, done = q.phase === 'done';
  const wheel = rr && rr.wheelchairRequired ? cpPill('無障礙輪椅車輛','warm') : '';
  const tone = {INTEREST_REGISTERED:'', MATCHING:'key', ACCEPTED:'key', DRIVER_ARRIVING:'key', ONBOARD:'key', COMPLETED:'muted', CANCELLED:'muted', MATCH_FAILED:'warn'}[status] || '';
  let body = '';
  const oneTap = big => `<button type="button" class="${big ? 'cp-onetap' : 'btn primary full'}" data-cpa="one-tap">${big ? cpBi('oneTap') : esc(done ? CP_TXT.zh.oneTap : '我已看完，一鍵叫車')}</button><button type="button" class="btn secondary full cp-speak" data-cpa="voice-return">${cpIcon('mic','ic ic-inline')}${cpBi('speak')}</button>`;
  if((status === 'NO_REQUEST' || status === 'CANCELLED') && q.phase === 'before'){
    body = `<p>回程不會預先派車。預估 <b>${cpFmt(k.finish)}</b> 前後看完，抵達醫院後可以先登記回程需求。</p>`;
  } else if(status === 'NO_REQUEST' || status === 'CANCELLED'){
    body = `<p>${status === 'CANCELLED' ? '已取消叫車。需要時可以再叫一次。' : done ? '看完了嗎？按下按鈕就開始叫車。' : `預估 <b>${cpFmt(k.finish)}</b> 前後看完。快輪到時會提醒您先登記回程需求。`}</p>
      ${done ? oneTap(true) : `<button type="button" class="btn secondary full" data-cpa="register-return">先登記回程需求</button>${oneTap(false)}`}`;
  } else if(status === 'INTEREST_REGISTERED'){
    body = `<p class="cp-reg">${cpIcon('check','ic ic-inline')}回程需求已登記，尚未叫車。</p><p class="help-text">司機端只會看到預估需求（約 ${cpFmt(k.finish)}），不會派車。看完診再按下方按鈕。</p>${q.phase === 'before' ? '' : oneTap(done)}<button type="button" class="btn ghost full" data-cpa="unregister-return">取消登記</button>`;
  } else if(status === 'MATCHING'){
    body = `<div class="cp-searching"><span class="cp-spinner" aria-hidden="true"></span><div><strong>正在尋找車輛</strong><p>${ride.status === 'rematching' ? '原司機無法接單，正在改派其他待命司機。' : '已通知醫院附近的待命司機，等待司機接單。'}</p></div></div>
      <p class="help-text">上車地點：${esc(ride.pickup)}</p><button type="button" class="btn ghost full" data-cpa="cancel-ride" data-id="${esc(ride.id)}">取消叫車</button>`;
  } else if(status === 'MATCH_FAILED'){
    body = `<p>附近暫時沒有合適的${rr.wheelchairRequired ? '無障礙' : ''}車輛。</p><button type="button" class="btn primary full" data-cpa="retry-ride" data-id="${esc(ride.id)}">重新叫車</button><button type="button" class="btn ghost full" data-cpa="cancel-ride" data-id="${esc(ride.id)}">取消</button>`;
  } else if(['ACCEPTED','DRIVER_ARRIVING','ONBOARD'].includes(status) && d){
    body = `<div class="cp-vehicle"><span class="cp-vehicle-tag">範例車輛</span><p class="cp-vehicle-plate">${esc(d.plate)}</p><p>${esc(d.color)}${esc(d.model)}・司機 ${esc(d.name)}</p>
      <p class="cp-vehicle-eta">${status === 'ACCEPTED' ? `約 ${ride.demoVehicle ? ride.demoVehicle.etaMinutes : 3} 分鐘到${esc(ride.pickup)}` : status === 'DRIVER_ARRIVING' ? `司機已到達${esc(ride.pickup)}，請上車` : '已上車，正在回家'}</p></div>
      ${status !== 'ONBOARD' ? `<button type="button" class="btn ghost full" data-cpa="cancel-ride" data-id="${esc(ride.id)}">取消叫車</button>` : ''}`;
  } else if(status === 'COMPLETED'){
    body = `<p class="cp-reg">${cpIcon('check','ic ic-inline')}已平安到家。</p>`;
  }
  const voice = cpVoiceConfirmHtml();
  return `<section class="card cp-trip cp-return"><div class="cp-card-top"><h2>回程</h2>${cpPill(CP_RETURN_LABEL[status], tone)}</div>${wheel}${voice}${body}</section>`;
}
function cpVoiceConfirmHtml(){
  return cpVoiceReturn ? `<div class="cp-voice-confirm" role="alertdialog" aria-label="確認叫車">${cpVoiceReturn.ok
      ? `<p>${cpVoiceReturn.simulated ? '<span class="cp-pill">模擬語音辨識</span>' : ''}已聽到：「${esc(cpVoiceReturn.text)}」</p><p><b>要現在叫回程車嗎？</b></p><div class="cp-row"><button type="button" class="btn primary" data-cpa="voice-confirm">確認叫車</button><button type="button" class="btn secondary" data-cpa="voice-cancel">先不要</button></div>`
      : `<p>${esc(cpVoiceReturn.text)}</p><p>請直接按「${esc(CP_TXT.zh.oneTap)}」。</p><button type="button" class="btn secondary" data-cpa="voice-cancel">知道了</button>`}</div>` : '';
}

// ---------- 推播（網站內通知） ----------
function cpRenderPush(){
  const box = $('cp-push'); if(!box) return;
  const n = state.careplus && state.careplus.notice;
  if(!n || currentRole !== 'senior'){ box.hidden = true; return; }
  const T = cpT(), Z = CP_TXT.zh, name = state.careplus.passengerName || '您', id = cpLang() === 'id';
  const title = n.type === 'opd' ? Z.opdTitle(name) : Z.treatTitle, body = n.type === 'opd' ? Z.opdBody(n.current, n.mine) : Z.treatBody;
  box.innerHTML = `<div class="cp-push-card"><div class="cp-push-head"><span class="cp-push-icon" aria-hidden="true">${cpIcon('bell')}</span><span>taxi Care+ 提醒</span><small>現在</small></div>
    <p class="cp-push-title">${esc(title)}</p><p class="cp-push-body">${esc(body)}</p><p class="cp-push-ask">${esc(Z.ask)}</p>
    ${id ? `<p class="cp-push-alt">${esc(n.type === 'opd' ? T.opdTitle(name) : T.treatTitle)} ${esc(n.type === 'opd' ? T.opdBody(n.current, n.mine) : T.treatBody)} ${esc(T.ask)}</p>` : ''}
    <div class="cp-push-actions"><button type="button" class="btn secondary" data-cpa="push-later">${cpBi('later')}</button><button type="button" class="btn primary" data-cpa="push-register">${cpBi('register')}</button></div></div>`;
  box.hidden = false;
}

// ---------- 家屬端 ----------
function cpTimeline(){
  const {a, q, k, ob, rr, ride} = cpCtx();
  if(!a || !q) return [];
  const rs = rr ? rr.status : 'NO_REQUEST', d = ride && ride.driverId ? cpDriver(ride.driverId) : null, obD = ob && ob.driverId ? cpDriver(ob.driverId) : null;
  const arrived = ob.status === 'arrived', done = q.phase === 'done';
  const requested = rr && rr.rideId && rs !== 'CANCELLED';
  return [
    {label:'已安排去程', st:'done', note:`預計 ${cpFmt(ob.pickupTime ?? cpDefaultPickup(a))} 到府`},
    {label:'去程司機已接單', st:ob.status === 'scheduled' ? 'pending' : 'done', note:obD ? `${obD.plate}・司機 ${obD.name}` : '等待司機接單'},
    {label:'已抵達醫院', st:arrived ? 'done' : 'predicted', note:arrived ? cpFmt(q.arrivedAt) : `預估 ${cpFmt(q.mode === 'opd' ? q.lastAdvanceTime + k.wait - q.bufferMinutes : (k.departure + q.travelMinutes))}`},
    {label:q.mode === 'opd' ? '等待看診' : '療程進行中', st:done ? 'done' : arrived ? 'current' : 'pending', note:q.mode === 'opd' ? `目前 ${q.currentQueueNumber} 號／您 ${q.patientQueueNumber} 號` : `剩 ${k.remaining} 分鐘`},
    {label:'看診進度延誤', st:q.delay ? 'warn' : done ? 'skip' : 'pending', note:q.delay ? `預估結束 ${cpFmt(q.delay.fromFinish)} → ${cpFmt(k.finish)}` : '目前無延誤'},
    {label:q.mode === 'opd' ? '看診完成' : '療程完成', st:done ? 'done' : 'predicted', note:done ? cpFmt(q.finishedAt) : `預估 ${cpFmt(k.finish)}`},
    {label:'已發起回程叫車', st:requested ? 'done' : rs === 'INTEREST_REGISTERED' ? 'current' : 'predicted', note:requested ? '乘客已按下叫車' : rs === 'INTEREST_REGISTERED' ? '已登記回程需求，尚未叫車' : `預估 ${cpFmt(k.finish)} 前後`},
    {label:'回程司機已接單', st:['ACCEPTED','DRIVER_ARRIVING','ONBOARD','COMPLETED'].includes(rs) ? 'done' : rs === 'MATCHING' ? 'current' : rs === 'MATCH_FAILED' ? 'warn' : 'pending', note:d ? `${d.plate}・司機 ${d.name}` : rs === 'MATCHING' ? '正在尋找車輛' : rs === 'MATCH_FAILED' ? '暫時找不到車輛' : '尚未叫車'},
    {label:'已返家', st:rs === 'COMPLETED' ? 'done' : rs === 'ONBOARD' ? 'current' : 'pending', note:rs === 'COMPLETED' ? '已平安到家' : rs === 'ONBOARD' ? '回家途中' : ''}
  ];
}
function cpRenderFamily(){
  const sum = $('cp-family-summary'), stat = $('family-status'), tl = $('family-timeline'); if(!sum) return;
  const {a, q, k, ob, rr, ride, b, h} = cpCtx(), name = state.careplus.passengerName || '長輩';
  const active = cpActiveBooking(state);
  sum.innerHTML = active ? `<div class="section-heading"><h2>${esc(name)}的預約行程</h2>${cpPill('長期預約','key')}</div>
      <dl class="cp-summary"><div><dt>醫院</dt><dd>${esc(cpHospital(active.hospitalId).name)} ${esc(active.department)} ${esc(active.clinicRoom)}</dd></div><div><dt>固定日期</dt><dd>${esc(cpWeekdaysLabel(active.weekdays))} ${esc(active.appointmentTime)}</dd></div><div><dt>期間</dt><dd>${esc(cpShortDate(active.startDate))} 到 ${esc(cpShortDate(active.endDate))}</dd></div><div><dt>車輛</dt><dd>${esc(cpVehicleLabel(active.wheelchairRequired))}</dd></div></dl>`
    : `<div class="section-heading"><h2>${esc(name)}的預約行程</h2></div><p class="preview-empty">目前沒有長期預約。</p>`;
  const notice = t => { $('family-notice').innerHTML = `<p class="notice-text">${esc(t)}</p>`; };
  if(!a || !q){ stat.innerHTML = `<div class="section-heading"><h2>目前狀態</h2></div><p class="preview-empty">目前沒有看診行程。</p>`; tl.innerHTML = ''; $('family-last-updated').textContent = ''; notice('目前沒有回診行程，可以協助長輩設定長期預約。'); if(currentRole === 'family') setGoogleMap('family-map', 'family-map-link', '台大醫院'); $('family-location-caption').textContent = '長輩尚未分享位置。'; return; }
  const rs = rr ? rr.status : 'NO_REQUEST', d = ride && ride.driverId ? cpDriver(ride.driverId) : null;
  const headline = rs !== 'NO_REQUEST' && rs !== 'INTEREST_REGISTERED' ? `回程：${CP_RETURN_LABEL[rs]}` : q.phase === 'before' ? `準備出門・建議 ${cpFmt(k.departure)} 出門` : q.phase === 'done' ? (q.mode === 'opd' ? '看診已完成' : '療程已完成') : q.mode === 'opd' ? `等待看診・目前 ${q.currentQueueNumber} 號／${name} ${q.patientQueueNumber} 號` : `療程中・剩 ${k.remaining} 分鐘`;
  stat.innerHTML = `<div class="section-heading"><h2>目前狀態</h2>${cpPill(`${cpShortDate(a.date)} ${h.name}`)}</div>
    <p class="family-main-stage">${esc(headline)}</p>
    ${q.delay && q.phase !== 'done' ? `<p class="cp-family-delay">看診進度延遲：預估結束由 ${cpFmt(q.delay.fromFinish)} 延後至 ${cpFmt(k.finish)}。目前尚未派遣回程車輛。</p>` : ''}
    <dl class="cp-summary"><div><dt>預估看完</dt><dd>${q.phase === 'done' ? `已完成（${cpFmt(q.finishedAt)}）` : cpFmt(k.finish)}</dd></div><div><dt>回程</dt><dd>${esc(CP_RETURN_LABEL[rs])}</dd></div>${d ? `<div><dt>車輛</dt><dd>${esc(d.color)}${esc(d.model)} ${esc(d.plate)}・司機 ${esc(d.name)}（範例）</dd></div>` : ''}</dl>`;
  tl.innerHTML = cpTimeline().map((it, i) => `<div class="timeline-item cp-tl-${it.st} ${it.st === 'done' ? 'done' : ''} ${it.st === 'current' ? 'current' : ''}"><span class="timeline-point" aria-hidden="true">${it.st === 'done' ? cpIcon('check') : it.st === 'warn' ? '!' : i + 1}</span><div><strong>${esc(it.label)}</strong><span class="cp-tl-note">${it.st === 'predicted' ? '<em>預估</em>' : it.st === 'current' ? '<em class="now">進行中</em>' : ''}${esc(it.note || '')}</span></div></div>`).join('');
  $('family-last-updated').textContent = `更新 ${cpFmt(q.observationTime)}`;
  notice(rs === 'COMPLETED' ? `${name}已平安到家。` : rs === 'ONBOARD' ? `${name}已上車，正在回家。` : ['ACCEPTED','DRIVER_ARRIVING'].includes(rs) && d ? `回程司機 ${d.name}（${d.plate}）已接單，${rs === 'DRIVER_ARRIVING' ? '已到達上車處' : '正前往醫院乘車處'}。` : rs === 'MATCHING' ? `正在為${name}尋找回程車輛。` : rs === 'MATCH_FAILED' ? '暫時找不到合適車輛，長輩可以重新叫車，也可以打電話關心。' : q.phase === 'done' ? `看診已完成，等待${name}按下叫車。` : q.delay ? '看診進度延遲，預估較晚結束。回程尚未派車，看完診由長輩自己按下叫車。' : q.phase === 'before' ? `建議 ${cpFmt(k.departure)} 出門，可以提醒長輩帶健保卡與回診單。` : `${name}正在醫院等待${q.mode === 'opd' ? '看診' : '療程結束'}。`);
  const loc = state.sharedLocation, usable = loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon));
  if(currentRole === 'family') setGoogleMap('family-map', 'family-map-link', usable ? `${Number(loc.lat).toFixed(5)},${Number(loc.lon).toFixed(5)}` : h.mapQuery);
  $('family-location-caption').textContent = usable ? `長輩同意分享的位置，更新於 ${new Date(loc.at).toLocaleString('zh-TW')}` : `長輩尚未分享位置，地圖顯示看診院所：${h.name}。`;
}

// ---------- 司機端 ----------
const CP_HEAT = [
  {zone:'台大醫院周邊', q:'台大醫院 常德街', bands:[3,2,2,1]},
  {zone:'馬偕醫院周邊', q:'台北馬偕醫院', bands:[2,2,1,1]},
  {zone:'國泰醫院周邊', q:'國泰綜合醫院', bands:[2,1,2,1]},
  {zone:'北醫附醫周邊', q:'臺北醫學大學附設醫院', bands:[1,2,1,1]}
];
const CP_BANDS = ['09–12 點','12–15 點','15–18 點','18–21 點'];
function cpRenderDriver(){
  const me = $('cp-driver-me'); if(!me) return;
  const self = cpDriver(CP_SELF_DRIVER), {a, q, k, ob, rr, ride, b, h} = cpCtx();
  const mine = state.rides.find(r => r.driverId === CP_SELF_DRIVER && CP_BUSY.includes(r.status));
  me.innerHTML = `<div class="cp-me"><span class="person-icon" aria-hidden="true">${cpIcon('user')}</span><div><strong>${esc(self.name)} 師傅</strong><p>${esc(self.color)}${esc(self.model)}・${esc(self.plate)} ${cpPill('範例司機','muted')}</p></div>${cpPill(mine ? '執行任務中' : '待命中', mine ? 'key' : '')}</div>`;
  const zone = h || cpHospital('ntuh');
  const others = CP_DRIVERS.map(d => { const busy = cpDriverBusy(state, d.id); return `<li><span>${esc(d.name)}・${esc(d.plate)}</span><span>${d.wheelchair ? '無障礙' : '一般車'}・${busy ? '任務中' : '待命'}</span></li>`; }).join('');
  let forecast = '<p class="preview-empty">目前沒有預估中的回程需求。</p>';
  if(a && q && rr && ['NO_REQUEST','INTEREST_REGISTERED','CANCELLED'].includes(rr.status) && a.status !== 'completed'){
    forecast = `<article class="cp-fc"><p class="cp-fc-title">預估 <b>${cpFmt(k.finish)}</b> 左右有 1 筆回程需求</p><p>狀態：尚未叫車${rr.status === 'INTEREST_REGISTERED' ? '・乘客已登記回程需求' : ''}</p>
      ${q.delay ? `<p class="cp-fc-delay">依看診延誤更新：原預估 ${cpFmt(q.delay.fromFinish)}</p>` : ''}${rr.wheelchairRequired ? cpPill('需無障礙輪椅車輛','warm') : ''}<p class="help-text">僅供掌握需求，乘客叫車後才會出現在任務池。</p></article>`;
  }
  $('cp-forecast').innerHTML = `<div class="section-heading"><h2>未來需求預估</h2>${cpPill('情境資料','muted')}</div>
    <div class="cp-zone"><div><span>${esc(zone.zone)}</span><b>待命車 ${CP_DRIVERS.length} 台</b></div><ul class="cp-zone-list">${others}</ul></div>${forecast}`;
  const pool = state.rides.filter(r => r.status === 'requested' && r.offeredTo === CP_SELF_DRIVER);
  const moved = state.rides.filter(r => r.status === 'rematching' && (r.excludedDrivers || []).includes(CP_SELF_DRIVER));
  $('cp-pool').classList.toggle('has-task', pool.length > 0);
  $('cp-pool').innerHTML = `<div class="section-heading"><h2>正式叫車任務池</h2>${cpPill(pool.length ? `${pool.length} 筆等待接單` : '目前沒有任務', pool.length ? 'key' : '')}</div>
    ${pool.length ? pool.map(r => `<article class="cp-task cp-task-hot"><p class="cp-task-title">${r.kind === 'return' ? '新回程叫車需求' : '新叫車需求'}</p>
      <dl class="cp-summary"><div><dt>上車地點</dt><dd>${esc(r.pickup)}</dd></div><div><dt>目的地</dt><dd>${esc(r.destination)}</dd></div><div><dt>車輛需求</dt><dd class="${r.vehicleRequirement === 'wheelchair' ? 'cp-strong' : ''}">${esc(cpVehicleLabel(r.vehicleRequirement === 'wheelchair'))}</dd></div>${r.passengerState ? `<div><dt>乘客狀態</dt><dd>${esc(r.passengerState)}</dd></div>` : ''}<div><dt>任務狀態</dt><dd>等待接單</dd></div></dl>
      <div class="record-actions"><button type="button" class="btn primary" data-cpa="drv-accept" data-id="${esc(r.id)}">接受任務</button><button type="button" class="btn secondary" data-cpa="drv-transfer" data-id="${esc(r.id)}">無法接單，轉給其他待命司機</button></div></article>`).join('')
      : '<p class="preview-empty">乘客按下「一鍵叫車」後，任務才會出現在這裡。</p>'}
    ${moved.map(r => `<p class="cp-moved">已轉出：${esc(r.pickup)} → ${esc(r.destination)}，系統重新媒合中。</p>`).join('')}`;
  const act = $('driver-active');
  if(mine){
    const next = mine.status === 'assigned' ? '已抵達上車地點' : mine.status === 'arrived_pickup' ? '乘客已上車' : '抵達目的地';
    act.hidden = false;
    act.innerHTML = `<div class="section-heading"><h2>目前接送任務</h2>${cpPill({assigned:'前往上車點', arrived_pickup:'已到上車點', onboard:'載客中'}[mine.status], 'key')}</div>
      <div class="driver-route"><strong>上車地點</strong><p>${esc(mine.pickup)}</p><strong>目的地</strong><p>${esc(mine.destination)}</p></div>
      ${mine.vehicleRequirement === 'wheelchair' ? '<div class="driver-note"><strong>乘客需求</strong><p>需無障礙輪椅車輛，請協助上下車。</p></div>' : ''}
      <button class="btn primary full" type="button" data-action="driver-progress" data-id="${esc(mine.id)}">${next}</button>
      ${mine.status === 'assigned' ? `<button class="btn ghost full" type="button" data-cpa="drv-transfer" data-id="${esc(mine.id)}">無法前往，轉給其他待命司機</button>` : ''}`;
  } else { act.hidden = true; act.innerHTML = ''; }
  const ab = cpActiveBooking(state);
  let out = '<p class="preview-empty">目前沒有排定的去程任務。</p>';
  if(ab){
    const today = cpToday(), list = cpSeriesAppointments(state, ab.id).filter(x => x.status === 'scheduled' && x.date >= today).slice(0, 4);
    out = list.map(x => { const o = state.careplus.outbound[x.id], focus = x.id === state.careplus.focusAppointmentId;
      const st = o ? (o.status === 'arrived' ? '已送達醫院' : o.status === 'accepted' ? (o.driverId === CP_SELF_DRIVER ? '由您接送' : '已有司機') : '待接單') : '已排定';
      return `<article class="cp-task"><div class="cp-task-row"><div><p class="cp-task-title">${esc(cpShortDate(x.date))} ${esc(cpFmt(o && o.pickupTime != null && o.status !== 'arrived' ? o.pickupTime : cpDefaultPickup(x)))} 到府</p><p>${esc(ab.pickupAddress)} → ${esc(cpHospital(x.hospitalId).name)}</p>${ab.wheelchairRequired ? cpPill('需無障礙輪椅車輛','warm') : ''}</div>${cpPill(st, o && o.status !== 'scheduled' ? 'key' : '')}</div>
        ${focus && o && o.status === 'scheduled' ? `<div class="record-actions"><button type="button" class="btn primary" data-cpa="ob-accept" data-id="${esc(x.id)}">接下這趟去程</button></div>` : ''}
        ${focus && o && o.status === 'accepted' && o.driverId === CP_SELF_DRIVER ? `<div class="record-actions"><button type="button" class="btn primary" data-cpa="arrive">已送達醫院</button></div>` : ''}</article>`; }).join('');
  }
  $('cp-outbound').innerHTML = `<div class="section-heading"><h2>已排定的去程任務</h2></div>${out}`;
  $('heat-list').innerHTML = `<div class="cp-heat-grid" role="table" aria-label="未來 24 小時需求"><div role="row" class="cp-heat-row cp-heat-head"><span role="columnheader">區域</span>${CP_BANDS.map(x => `<span role="columnheader">${x}</span>`).join('')}</div>
    ${CP_HEAT.map((z, i) => `<button type="button" role="row" class="cp-heat-row ${cpHeatZone === i ? 'active' : ''}" data-cpa="heat-zone" data-index="${i}"><span role="cell" class="cp-heat-zone">${esc(z.zone)}</span>${z.bands.map(v => `<span role="cell"><b class="heat-dot heat-${v === 3 ? 'high' : v === 2 ? 'mid' : 'low'}"></b>${v === 3 ? '高' : v === 2 ? '中' : '低'}</span>`).join('')}</button>`).join('')}</div>`;
  $('heat-updated').textContent = '需求分布為情境資料，非實際訂單統計。';
  if(currentRole === 'driver'){ const z = CP_HEAT[cpHeatZone]; $('driver-map-caption').textContent = z.zone; setGoogleMap('driver-map', 'driver-map-link', z.q); }
}

// ---------- 確認視窗 ----------
function cpConfirm(title, message, yes, fn){
  confirming = null; cpConfirmFn = fn;
  $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-yes').textContent = yes;
  openDialog('confirm-dialog');
}
$('confirm-yes').addEventListener('click', () => { if(!cpConfirmFn) return; const fn = cpConfirmFn; cpConfirmFn = null; try{ fn(); closeDialog($('confirm-dialog')); }catch(e){ toast(e.message); } });
$('confirm-dialog').addEventListener('close', () => { cpConfirmFn = null; });

// ---------- 事件 ----------
function cpVisitAction(fn){ try{ fn(); }catch(e){ toast(e.message); } }
document.addEventListener('click', ev => {
  const btn = ev.target.closest('[data-cpa]'); if(!btn) return;
  const a = btn.dataset.cpa, id = btn.dataset.id;
  cpVisitAction(() => {
    switch(a){
      case 'open-visit': if(!state.careplus.focusAppointmentId && cpNextAppointment(state)) cpEvents.focus(cpNextAppointment(state).id); setView('visit'); break;
      case 'open-booking': if(cpActiveBooking(state)) setView('booking'); else cpOpenBookingForm(); break;
      case 'go-home': { const c = cpCtx(); if(c.q && c.q.phase !== 'before' && c.a && c.a.status !== 'completed'){ setView('visit'); requestAnimationFrame(() => { const el = document.querySelector('.cp-return'); if(el) el.scrollIntoView({block:'start'}); }); } else openRide('return'); break; }
      case 'open-booking-form': cpOpenBookingForm(id); break;
      case 'toggle-day': { const d = Number(btn.dataset.day); cpDraftDays = cpDraftDays.includes(d) ? cpDraftDays.filter(x => x !== d) : [...cpDraftDays, d]; cpRenderDays(); cpRenderPreview(); break; }
      case 'voice-booking': cpVoice.listen({lang:'zh', prompt:'請說出回診需求', simulatedText:'每週一三五早上九點去台大醫院腎臟內科三診，預約一個月，要輪椅車', onResult:cpShowVoiceResult, onFail:cpVoiceBookingFail}); break;
      case 'voice-text-apply': { const t = $('cp-voice-input').value.trim(); if(!t) throw Error('請先輸入內容'); cpShowVoiceResult(t, false); break; }
      case 'voice-stop': cpVoice.close(); break;
      case 'voice-ride': cpVoice.listen({lang:'zh', prompt:'請說出要去哪裡、哪一天、幾點', simulatedText:'明天早上八點半從家裡去台大醫院，要輪椅車', onResult:cpShowRideVoice, onFail:cpRideVoiceFail}); break;
      case 'ride-voice-apply': { const t = $('ride-voice-input').value.trim(); if(!t) throw Error('請先輸入內容'); cpShowRideVoice(t, false); break; }
      case 'cancel-booking': cpConfirm('取消長期預約？', '尚未執行的去程安排都會取消，已完成的紀錄會保留。', '確認取消', () => cpEvents.cancelBooking(id)); break;
      case 'pause-appt': cpEvents.pauseAppointment(id, true); break;
      case 'resume-appt': cpEvents.pauseAppointment(id, false); break;
      case 'cancel-appt': cpConfirm('取消這次回診接送？', '只取消這一次，其他日期不受影響。', '確認取消', () => cpEvents.cancelAppointment(id)); break;
      case 'register-return': case 'push-register': cpEvents.registerReturn(); break;
      case 'unregister-return': cpEvents.unregisterReturn(); break;
      case 'push-later': cpEvents.dismissNotice(); break;
      case 'one-tap': cpVoiceReturn = null; cpEvents.requestReturn('tap'); break;
      case 'voice-return': { const T = cpT(); cpVoice.listen({lang:cpLang(), prompt:T.listen, simulatedText:cpLang() === 'id' ? 'Sudah selesai, mau pulang' : '我好了，幫我叫車',
        onResult:(text, sim) => { cpVoiceReturn = cpIsReturnPhrase(text) ? {ok:true, text, simulated:sim} : {ok:false, text:`沒有聽清楚：「${text}」`}; render(); },
        onFail:r => { cpVoiceReturn = {ok:false, text:cpVoice.failText(r)}; render(); }}); break; }
      case 'voice-confirm': cpVoiceReturn = null; cpEvents.requestReturn('voice'); break;
      case 'voice-cancel': cpVoiceReturn = null; render(); break;
      case 'cancel-ride': cpConfirm('取消這次叫車？', '取消後司機將不會前往接送。', '確認取消', () => cpEvents.cancelRide(id)); break;
      case 'retry-ride': cpEvents.retryRide(id); break;
      case 'drv-accept': cpEvents.driverAccept(id); break;
      case 'drv-transfer': cpEvents.driverTransfer(id); break;
      case 'ob-accept': cpEvents.outboundAccept(id, CP_SELF_DRIVER); break;
      case 'arrive': cpEvents.arriveHospital(); break;
      case 'heat-zone': cpHeatZone = Number(btn.dataset.index) || 0; cpRenderDriver(); break;
    }
  });
});
$('cp-longterm-form').addEventListener('submit', e => {
  e.preventDefault(); clearError('cp-error');
  try{ cpEvents.saveBooking(cpReadForm(), cpEditingBooking); closeDialog($('cp-longterm-dialog')); setView('booking'); }
  catch(err){ showError('cp-error', err.message); }
});
for(const id of ['cp-hospital','cp-start','cp-span','cp-time','cp-wheel','cp-mode','cp-treat-len','cp-pickup']) $(id).addEventListener(id === 'cp-pickup' ? 'input' : 'change', cpRenderPreview);
$('care-lang').addEventListener('change', e => cpEvents.setLang(e.target.value));

function cpRenderApptBooking(){
  const box = $('cp-appt-booking'); if(!box) return;
  const b = cpActiveBooking(state);
  if(!b){ box.innerHTML = `<section class="card cp-appt-summary"><div class="section-heading"><h2>長期預約</h2></div><p class="preview-empty">固定回診只要設定一次，未來的去程都會安排好。</p><button type="button" class="btn secondary full" data-cpa="open-booking-form">設定長期預約</button></section>`; return; }
  const today = cpToday(), list = cpSeriesAppointments(state, b.id).filter(a => a.status === 'scheduled' && a.date >= today), next = list[0];
  box.innerHTML = `<section class="card cp-appt-summary"><div class="section-heading"><h2>長期預約</h2>${cpPill('進行中','key')}</div>
    <p class="preview-title">${esc(cpHospital(b.hospitalId).name)} ${esc(b.department)} ${esc(b.clinicRoom)}</p><p class="preview-meta">${esc(cpWeekdaysLabel(b.weekdays))} ${esc(b.appointmentTime)}・尚有 ${list.length} 次去程${next ? `・下次 ${esc(cpShortDate(next.date))}` : ''}</p>
    <button type="button" class="btn secondary full" data-view="booking">查看所有日期</button></section>`;
}

function renderCare(){
  if(!state.careplus) return;
  cpRenderHome(); cpRenderBooking(); cpRenderVisit(); cpRenderPush(); cpRenderApptBooking();
  const sel = $('care-lang'); if(sel) sel.value = cpLang();
  if(typeof cpRenderDemo === 'function') cpRenderDemo();
}

// 啟動：遷移舊資料、確保看診當天狀態，之後每秒檢查模擬司機是否接單。
(function cpInit(){
  try{
    update(s => { cpMigrate(s); cpEnsureFocus(s); cpDetect(s); cpSync(s); });
  }catch(e){ state.careplus = cpDefaultState(); }
  render();
  setInterval(cpTick, 1000);
})();
