'use strict';

// Care+ 資料模型、估算與狀態機。所有畫面只讀取 state.careplus 與 state.rides，所有變更都經由下方 cpEvents 事件函式。

const CP_VERSION = 2;
const CP_PARAMS = new URLSearchParams(location.search);
const CP_DEMO = CP_PARAMS.has('demo');
const CP_DAYS = ['日','一','二','三','四','五','六'];
const CP_DURATIONS = {14:'2 週', 30:'1 個月', 90:'3 個月'};
const CP_SELF_DRIVER = 'drv-a';
const CP_DEMO_HOME = '台北市大安區和平東路二段 100 號';

const CP_HOSPITALS = [
  {id:'ntuh', name:'台大醫院', address:'台北市中正區常德街 1 號', pickupPoint:'台大醫院常德街大門乘車處', zone:'台大醫院待命區', mapQuery:'台大醫院 常德街'},
  {id:'mackay', name:'台北馬偕醫院', address:'台北市中山區中山北路二段 92 號', pickupPoint:'馬偕醫院中山北路大門乘車處', zone:'馬偕醫院待命區', mapQuery:'台北馬偕醫院'},
  {id:'tcvgh', name:'台中榮總', address:'台中市西屯區台灣大道四段 1650 號', pickupPoint:'台中榮總第一醫療大樓乘車處', zone:'台中榮總待命區', mapQuery:'台中榮民總醫院'},
  {id:'mlh', name:'衛生福利部苗栗醫院', address:'苗栗縣苗栗市為公路 747 號', pickupPoint:'苗栗醫院大門乘車處', zone:'苗栗醫院待命區', mapQuery:'衛生福利部苗栗醫院'}
];

// 範例司機與車輛。司機端操作者為林志明（drv-a）；其餘司機的接單由系統模擬。
const CP_DRIVERS = [
  {id:'drv-a', name:'林志明', plate:'RAB-5821', color:'白色', model:'無障礙廂型車', wheelchair:true},
  {id:'drv-b', name:'陳建華', plate:'RCD-3307', color:'銀色', model:'無障礙廂型車', wheelchair:true},
  {id:'drv-c', name:'張家豪', plate:'ABC-7283', color:'銀白色', model:'四門轎車', wheelchair:false}
];

// 回程請求狀態。ride 建立後，狀態由 ride.status 對應產生，避免兩份資料不一致。
const CP_RETURN_LABEL = {
  NO_REQUEST:'尚未登記', INTEREST_REGISTERED:'已登記回程需求，尚未叫車', REQUESTED:'已送出叫車',
  MATCHING:'正在尋找車輛', MATCH_FAILED:'暫時找不到合適車輛', ACCEPTED:'司機已接單',
  DRIVER_ARRIVING:'司機已到達上車處', ONBOARD:'已上車，回家途中', COMPLETED:'已平安到家', CANCELLED:'已取消叫車'
};
const CP_RIDE_TO_RETURN = {requested:'MATCHING', rematching:'MATCHING', failed:'MATCH_FAILED', assigned:'ACCEPTED', arrived_pickup:'DRIVER_ARRIVING', onboard:'ONBOARD', completed:'COMPLETED', cancelled:'CANCELLED'};
const CP_ACTIVE_RETURN = ['REQUESTED','MATCHING','ACCEPTED','DRIVER_ARRIVING','ONBOARD'];

const cpMin = t => { const [h,m] = String(t).split(':').map(Number); return h*60 + m; };
const cpFmt = m => { const v = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`; };
const cpWeekday = date => new Date(`${date}T12:00:00+08:00`).getUTCDay();
const cpAddDays = (date, n) => { const d = new Date(`${date}T12:00:00+08:00`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
const cpShortDate = date => { const [,m,d] = date.split('-'); return `${Number(m)}/${Number(d)}（${CP_DAYS[cpWeekday(date)]}）`; };
const cpToday = () => nowTaipei().date;
const cpHospital = id => CP_HOSPITALS.find(h => h.id === id) || CP_HOSPITALS[0];
const cpDriver = id => CP_DRIVERS.find(d => d.id === id) || null;
const cpNowIso = () => new Date().toISOString();

function cpDefaultState(){
  return {version:CP_VERSION, passengerName:'陳奶奶', bookings:[], queues:{}, outbound:{}, returnRequests:[], focusAppointmentId:null, notice:null, log:[]};
}

// ---------- 資料遷移 ----------
function cpMigrate(s){
  s.preferences = s.preferences || {};
  if(!s.preferences.careLang) s.preferences.careLang = 'zh';
  for(const r of s.rides){
    if(r.status === 'saved') r.status = 'requested';
    if(!r.kind) r.kind = 'single';
    if(!r.vehicleRequirement) r.vehicleRequirement = 'standard';
    if(r.status === 'assigned' && !r.driverId){ r.driverId = 'drv-c'; r.acceptedAt = r.assignedAt || r.createdAt; }
  }
  if(s.careplus && s.careplus.version === CP_VERSION) return false;
  const old = s.careplus;
  s.careplus = cpDefaultState();
  if(old && old.series){
    const o = old.series;
    s.appointments = s.appointments.filter(a => !a.series);
    cpCreateBooking(s, {hospitalId:o.hospital || 'ntuh', department:'腎臟內科', clinicRoom:'3 診', pickupAddress:s.preferences.homeAddress || CP_DEMO_HOME,
      weekdays:o.days || [1,3,5], startDate:o.start, duration:o.span || 30, appointmentTime:o.time || '09:00', queueMode:'opd', treatmentMinutes:240, wheelchairRequired:Boolean(o.wheel)});
  }
  return true;
}

// ---------- 長期預約 ----------
function cpBookingDates(form){
  const end = cpAddDays(form.startDate, Number(form.duration) - 1), dates = [];
  for(let d = form.startDate; d <= end; d = cpAddDays(d, 1)) if(form.weekdays.includes(cpWeekday(d))) dates.push(d);
  return {dates, endDate:end};
}
function cpValidateBooking(form){
  if(!form.weekdays.length) throw Error('請至少選擇一個星期');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) throw Error('請選擇首次回診日期');
  if(form.startDate < cpToday()) throw Error('首次回診日期不能早於今天');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.appointmentTime)) throw Error('請輸入看診時間');
  if(!form.pickupAddress.trim()) throw Error('請填寫上車地址');
  const {dates} = cpBookingDates(form);
  if(!dates.length) throw Error('這段期間沒有符合的回診日期');
  return dates;
}
function cpCreateBooking(s, form, existingId){
  const dates = cpValidateBooking(form), h = cpHospital(form.hospitalId), {endDate} = cpBookingDates(form);
  const id = existingId || uid();
  const booking = {id, passengerId:'passenger-1', hospitalId:h.id, department:form.department.trim(), clinicRoom:form.clinicRoom.trim(), pickupAddress:form.pickupAddress.trim(),
    weekdays:[...form.weekdays].sort(), startDate:form.startDate, endDate, duration:Number(form.duration), appointmentTime:form.appointmentTime,
    queueMode:form.queueMode, treatmentMinutes:Number(form.treatmentMinutes) || 240, wheelchairRequired:Boolean(form.wheelchairRequired), status:'active', createdAt:cpNowIso()};
  const today = cpToday();
  if(existingId){
    const keep = s.appointments.filter(a => a.recurringBookingId !== id || a.date < today || ['completed'].includes(a.status) || a.id === s.careplus.focusAppointmentId);
    s.appointments = keep;
    s.careplus.bookings = s.careplus.bookings.filter(b => b.id !== id);
  }
  const taken = new Set(s.appointments.filter(a => a.recurringBookingId === id).map(a => a.date));
  const fresh = dates.filter(d => !taken.has(d));
  if(s.appointments.length + fresh.length > 120) throw Error('回診紀錄已達上限，請先刪除舊的回診');
  for(const d of fresh) s.appointments.push(cpNewAppointment(booking, d));
  s.careplus.bookings.push(booking);
  return booking;
}
function cpNewAppointment(b, date){
  const h = cpHospital(b.hospitalId);
  return {id:uid(), recurringBookingId:b.id, hospitalId:h.id, department:b.department, clinicRoom:b.clinicRoom, date, time:b.appointmentTime, appointmentTime:b.appointmentTime,
    hospital:`${h.name} ${b.department} ${b.clinicRoom}`.trim(), address:h.address, note:'', patientQueueNumber:null, queueMode:b.queueMode, status:'scheduled', createdAt:cpNowIso()};
}
const cpBookingOf = (s, a) => a && s.careplus.bookings.find(b => b.id === a.recurringBookingId) || null;
const cpActiveBooking = s => s.careplus.bookings.find(b => b.status === 'active') || null;
function cpSeriesAppointments(s, bookingId){ return s.appointments.filter(a => a.recurringBookingId === bookingId).sort((x,y) => x.date.localeCompare(y.date)); }
function cpNextAppointment(s){
  const today = cpToday();
  return s.appointments.filter(a => a.recurringBookingId && a.date >= today && a.status === 'scheduled').sort((x,y) => x.date.localeCompare(y.date) || x.time.localeCompare(y.time))[0] || null;
}
// 一般門診：看診前 30 分鐘到府（車程 20 分＋緩衝 10 分）；看診當天再依進度調整。
function cpDefaultPickup(a){ return cpMin(a.time) - 30; }

// ---------- 看診當天：候診估算 ----------
function cpNewQueue(a, b, mode){
  const m = mode || a.queueMode || 'opd', start = cpMin(a.time);
  const base = {appointmentId:a.id, mode:m, travelMinutes:20, bufferMinutes:10, dataSource:'醫院看診進度（模擬資料）', isSimulation:true, phase:'before', delay:null, finishedAt:null, notified:false, arrivedAt:null};
  if(m === 'treatment') return {...base, treatmentStart:start, treatmentMinutes:b ? b.treatmentMinutes : 240, observationTime:start - 40};
  return {...base, clinicStart:start, currentQueueNumber:18, patientQueueNumber:25, estimatedMinutesPerPatient:5, consultMinutes:30, delayBufferMinutes:5,
    observationTime:start + 85, lastAdvanceTime:start + 85};
}
// 簡化估算公式：等待＝前方號碼×平均每號；輪到＝現在＋等待；建議出門＝輪到−車程−緩衝；結束＝輪到＋看診與領藥（＋延誤緩衝）。
function cpCalc(q){
  if(!q) return null;
  if(q.mode === 'treatment'){
    const finish = q.finishedAt ?? (q.treatmentStart + q.treatmentMinutes);
    return {finish, remaining:Math.max(0, finish - q.observationTime), departure:q.treatmentStart - q.travelMinutes - q.bufferMinutes,
      progress:Math.min(100, Math.max(0, Math.round((q.observationTime - q.treatmentStart) / q.treatmentMinutes * 100)))};
  }
  const ahead = Math.max(0, q.patientQueueNumber - q.currentQueueNumber);
  const wait = ahead * q.estimatedMinutesPerPatient;
  const turn = q.observationTime + wait;
  const finish = q.finishedAt ?? (turn + q.consultMinutes + (q.delay ? q.delayBufferMinutes : 0));
  return {ahead, wait, turn, finish, departure:turn - q.travelMinutes - q.bufferMinutes, stalled:q.observationTime - q.lastAdvanceTime};
}
function cpQueueOf(s, apptId){ return apptId ? s.careplus.queues[apptId] || null : null; }
function cpFocus(s){
  const a = s.appointments.find(x => x.id === s.careplus.focusAppointmentId);
  return a || null;
}
function cpEnsureFocus(s){
  let a = cpFocus(s);
  if(!a || a.status === 'cancelled'){ a = cpNextAppointment(s); s.careplus.focusAppointmentId = a ? a.id : null; }
  if(a && !s.careplus.queues[a.id]){
    s.careplus.queues[a.id] = cpNewQueue(a, cpBookingOf(s, a));
    a.patientQueueNumber = s.careplus.queues[a.id].patientQueueNumber ?? null;
  }
  if(a && !s.careplus.outbound[a.id]) s.careplus.outbound[a.id] = {status:'scheduled', driverId:null, pickupTime:null};
  if(a) cpEnsureReturn(s, a);
  return a;
}
function cpEnsureReturn(s, a){
  let rr = s.careplus.returnRequests.find(r => r.appointmentId === a.id);
  if(!rr){
    const b = cpBookingOf(s, a);
    rr = {id:uid(), appointmentId:a.id, predictedDemandTime:null, interestRegistered:false, requestedAt:null, dispatchedAt:null, assignedDriverId:null,
      wheelchairRequired:Boolean(b && b.wheelchairRequired), status:'NO_REQUEST', rideId:null, history:[]};
    s.careplus.returnRequests.push(rr);
  }
  return rr;
}
const cpReturnOf = (s, apptId) => s.careplus.returnRequests.find(r => r.appointmentId === apptId) || null;
const cpRideOf = (s, id) => s.rides.find(r => r.id === id) || null;

function cpLog(s, type, text, apptId){
  const q = cpQueueOf(s, apptId || s.careplus.focusAppointmentId);
  s.careplus.log.push({type, text, at:cpNowIso(), clock:q ? q.observationTime : null, appointmentId:apptId || s.careplus.focusAppointmentId});
  if(s.careplus.log.length > 80) s.careplus.log.splice(0, s.careplus.log.length - 80);
}

// 延誤偵測：燈號停滯 20 分鐘以上即視為延誤；只更新預估，不建立任何派車。
function cpDetect(s){
  const a = cpFocus(s), q = cpQueueOf(s, a && a.id);
  if(!q || q.phase === 'done') return;
  if(q.mode === 'opd' && !q.delay){
    const k = cpCalc(q);
    if(k.stalled >= 20){
      const fromFinish = q.lastAdvanceTime + k.wait + q.consultMinutes;
      q.delay = {detectedAt:q.observationTime, stalledAt:q.currentQueueNumber, stalledMinutes:k.stalled, fromFinish};
      q.delay.toFinish = cpCalc(q).finish;
      cpLog(s, 'delay', `看診進度延遲，預估結束由 ${cpFmt(fromFinish)} 延後至 ${cpFmt(q.delay.toFinish)}`);
    }
  }
  if(!q.notified){
    const k = cpCalc(q);
    const near = q.mode === 'opd' ? (k.ahead <= 1 && q.currentQueueNumber < q.patientQueueNumber) : k.remaining <= 15;
    if(near){ q.notified = true; s.careplus.notice = {type:q.mode, appointmentId:a.id, current:q.currentQueueNumber ?? null, mine:q.patientQueueNumber ?? null}; }
  }
}

// 回程請求同步：預估需求時間跟著估算更新；正式狀態只由 ride 決定。
function cpSync(s){
  const a = cpFocus(s);
  for(const rr of s.careplus.returnRequests){
    const ride = rr.rideId ? cpRideOf(s, rr.rideId) : null;
    const q = cpQueueOf(s, rr.appointmentId);
    if(q && (!ride || ['cancelled'].includes(ride.status))) rr.predictedDemandTime = cpCalc(q).finish;
    const next = ride ? CP_RIDE_TO_RETURN[ride.status] : (rr.interestRegistered ? 'INTEREST_REGISTERED' : 'NO_REQUEST');
    if(next !== rr.status){ rr.status = next; rr.history.push({status:next, at:cpNowIso()}); }
    rr.assignedDriverId = ride && ride.driverId || null;
    rr.dispatchedAt = ride && ride.acceptedAt || null;
  }
  if(a){
    const ob = s.careplus.outbound[a.id], q = cpQueueOf(s, a.id);
    if(ob && q && ob.status === 'scheduled' && q.phase === 'before') ob.pickupTime = cpCalc(q).departure;
  }
}

// ---------- 派車引擎（一般叫車與 Care+ 回程共用） ----------
const CP_BUSY = ['assigned','arrived_pickup','onboard'];
function cpCompatible(d, ride){ return ride.vehicleRequirement !== 'wheelchair' || d.wheelchair; }
function cpDriverBusy(s, id){ return s.rides.some(r => r.driverId === id && CP_BUSY.includes(r.status)); }
function cpPickDriver(s, ride){
  const ok = CP_DRIVERS.filter(d => cpCompatible(d, ride) && !(ride.excludedDrivers || []).includes(d.id) && !cpDriverBusy(s, d.id));
  return ok.find(d => d.id === CP_SELF_DRIVER) || ok[0] || null;
}
function cpOffer(s, ride){
  const d = cpPickDriver(s, ride);
  if(!d){ ride.status = 'failed'; ride.offeredTo = null; ride.autoAt = null; return; }
  ride.offeredTo = d.id;
  ride.autoAt = d.id === CP_SELF_DRIVER ? null : Date.now() + 3500;
}
function cpNewRide(s, f){
  const ride = {id:uid(), kind:f.kind || 'single', direction:f.direction, appointmentId:f.appointmentId || null, requestId:f.requestId || null,
    date:f.date, time:f.time, pickup:f.pickup, destination:f.destination, vehicleRequirement:f.wheelchair ? 'wheelchair' : 'standard',
    passengerState:f.passengerState || '', status:'requested', offeredTo:null, excludedDrivers:[], driverId:null, autoAt:null,
    createdAt:cpNowIso(), requestedAt:cpNowIso(), estimatedPickupTime:f.time};
  cpOffer(s, ride);
  s.rides.push(ride);
  return ride;
}
function cpAssign(s, ride, driverId){
  const d = cpDriver(driverId);
  ride.status = 'assigned'; ride.driverId = driverId; ride.offeredTo = null; ride.autoAt = null; ride.acceptedAt = cpNowIso(); ride.assignedAt = ride.acceptedAt;
  ride.demoVehicle = {plate:d.plate, color:d.color, model:d.model, etaMinutes:ride.kind === 'return' ? 3 : 8};
}

// ---------- 事件 ----------
function cpApply(fn, message){ update(next => { cpMigrate(next); fn(next); cpDetect(next); cpSync(next); }, message); }

const cpEvents = {
  saveBooking(form, editingId){
    cpApply(s => {
      const b = cpCreateBooking(s, form, editingId);
      const a = cpFocus(s);
      if(!a || a.recurringBookingId !== b.id || a.status !== 'scheduled') { s.careplus.focusAppointmentId = null; }
      cpEnsureFocus(s);
      cpLog(s, 'booking', `長期預約：每週${b.weekdays.map(d => CP_DAYS[d]).join('、')}，共 ${cpSeriesAppointments(s, b.id).filter(x => x.status === 'scheduled').length} 次去程`);
    }, editingId ? '長期預約已更新' : '長期預約已建立，去程已安排');
  },
  cancelBooking(id){
    cpApply(s => {
      const b = s.careplus.bookings.find(x => x.id === id); if(!b) throw Error('找不到這筆長期預約');
      b.status = 'cancelled';
      const today = cpToday();
      for(const a of s.appointments) if(a.recurringBookingId === id && a.date >= today && a.status !== 'completed' && !(cpReturnOf(s, a.id) && CP_ACTIVE_RETURN.includes(cpReturnOf(s, a.id).status))) a.status = 'cancelled';
    }, '已取消尚未執行的安排');
  },
  pauseAppointment(id, paused){
    cpApply(s => {
      const a = s.appointments.find(x => x.id === id); if(!a) throw Error('找不到這次回診');
      if(a.status === 'cancelled' || a.status === 'completed') throw Error('這次回診已結束或取消');
      a.status = paused ? 'paused' : 'scheduled';
      if(paused && s.careplus.focusAppointmentId === id) s.careplus.focusAppointmentId = null;
    }, paused ? '已暫停這次接送' : '已恢復這次接送');
  },
  cancelAppointment(id){
    cpApply(s => {
      const a = s.appointments.find(x => x.id === id); if(!a) throw Error('找不到這次回診');
      const rr = cpReturnOf(s, id);
      if(rr && CP_ACTIVE_RETURN.includes(rr.status)) throw Error('回程叫車進行中，請先取消叫車');
      a.status = 'cancelled';
      if(s.careplus.focusAppointmentId === id) s.careplus.focusAppointmentId = null;
    }, '已取消這次回診接送');
  },
  focus(id){ cpApply(s => { const a = s.appointments.find(x => x.id === id && x.status === 'scheduled'); if(a) s.careplus.focusAppointmentId = a.id; cpEnsureFocus(s); }); },
  outboundAccept(apptId, driverId){
    cpApply(s => {
      const ob = s.careplus.outbound[apptId]; if(!ob) throw Error('找不到去程安排');
      if(ob.status !== 'scheduled') throw Error('這趟去程已有司機');
      ob.status = 'accepted'; ob.driverId = driverId || CP_SELF_DRIVER; ob.acceptedAt = cpNowIso();
      cpLog(s, 'outbound', '去程司機已接單', apptId);
    }, '已接下去程任務');
  },
  arriveHospital(){
    cpApply(s => {
      const a = cpEnsureFocus(s), q = cpQueueOf(s, a && a.id); if(!q) throw Error('目前沒有看診當天的行程');
      const ob = s.careplus.outbound[a.id];
      if(ob.status === 'scheduled') throw Error('去程尚未有司機接單');
      if(ob.status === 'arrived') return;
      const k = cpCalc(q);
      const planned = q.mode === 'opd' ? q.lastAdvanceTime + k.wait - q.bufferMinutes : k.departure + q.travelMinutes;
      const arrival = Math.max(q.observationTime, planned);
      q.observationTime = arrival; ob.status = 'arrived'; q.arrivedAt = arrival; if(q.phase === 'before') q.phase = 'waiting';
      cpLog(s, 'arrived', `已抵達${cpHospital(a.hospitalId).name}`, a.id);
    }, '已抵達醫院');
  },
  advanceQueue(n = 1){
    cpApply(s => {
      const a = cpEnsureFocus(s), q = cpQueueOf(s, a && a.id); if(!q || q.mode !== 'opd') throw Error('目前不是門診叫號模式');
      if(q.phase === 'done') throw Error('看診已完成');
      for(let i = 0; i < n && q.currentQueueNumber < q.patientQueueNumber; i++){
        q.currentQueueNumber++; q.observationTime += q.estimatedMinutesPerPatient; q.lastAdvanceTime = q.observationTime;
        if(q.phase === 'before' && s.careplus.outbound[a.id].status === 'arrived') q.phase = 'waiting';
      }
    });
  },
  jumpTo(num){
    const s = state, a = cpFocus(s), q = cpQueueOf(s, a && a.id);
    if(q) this.advanceQueue(Math.max(0, num - q.currentQueueNumber));
  },
  stall(minutes){
    cpApply(s => {
      const a = cpEnsureFocus(s), q = cpQueueOf(s, a && a.id); if(!q || q.mode !== 'opd') throw Error('目前不是門診叫號模式');
      if(q.phase === 'done') throw Error('看診已完成');
      const target = q.lastAdvanceTime + minutes;
      if(q.observationTime >= target) throw Error(`燈號已停在 ${q.currentQueueNumber} 號超過 ${minutes} 分鐘`);
      q.observationTime = target;
    });
  },
  setMode(mode){
    cpApply(s => {
      const a = cpEnsureFocus(s); if(!a) throw Error('請先建立長期預約');
      const rr = cpEnsureReturn(s, a); if(rr.rideId && CP_ACTIVE_RETURN.includes(rr.status)) throw Error('回程叫車進行中，無法切換');
      const ob = s.careplus.outbound[a.id];
      a.queueMode = mode; s.careplus.queues[a.id] = cpNewQueue(a, cpBookingOf(s, a), mode);
      const q = s.careplus.queues[a.id];
      if(mode === 'treatment'){ q.observationTime = q.treatmentStart + 150; q.phase = 'waiting'; if(ob.status !== 'arrived'){ ob.status = 'arrived'; ob.driverId = ob.driverId || CP_SELF_DRIVER; } q.arrivedAt = q.treatmentStart - 10; }
      else if(ob.status === 'arrived'){ ob.status = 'accepted'; }
      a.patientQueueNumber = q.patientQueueNumber ?? null; rr.interestRegistered = false; rr.rideId = null; s.careplus.notice = null;
    }, mode === 'treatment' ? '已切換為固定時長療程' : '已切換為一般門診');
  },
  treatmentRemaining(min){
    cpApply(s => {
      const a = cpEnsureFocus(s), q = cpQueueOf(s, a && a.id); if(!q || q.mode !== 'treatment') throw Error('目前不是固定療程模式');
      if(q.phase === 'done') throw Error('療程已完成');
      q.observationTime = Math.max(q.observationTime, q.treatmentStart + q.treatmentMinutes - min);
    });
  },
  finishVisit(){
    cpApply(s => {
      const a = cpEnsureFocus(s), q = cpQueueOf(s, a && a.id); if(!q) throw Error('目前沒有看診當天的行程');
      if(q.phase === 'done') return;
      if(s.careplus.outbound[a.id].status !== 'arrived') throw Error('長者尚未抵達醫院');
      const k = cpCalc(q);
      if(q.mode === 'opd') q.currentQueueNumber = q.patientQueueNumber;
      q.observationTime = Math.max(q.observationTime, k.finish); q.finishedAt = q.observationTime; q.phase = 'done';
      s.careplus.notice = null;
      cpLog(s, 'done', q.mode === 'opd' ? '看診與領藥完成' : '療程完成', a.id);
    }, '已標記看診完成');
  },
  dismissNotice(){ cpApply(s => { s.careplus.notice = null; }); },
  registerReturn(){
    cpApply(s => {
      const a = cpEnsureFocus(s); if(!a) throw Error('目前沒有回診行程');
      const rr = cpEnsureReturn(s, a);
      if(rr.rideId && CP_ACTIVE_RETURN.includes(rr.status)) throw Error('已經在叫車中');
      rr.interestRegistered = true; s.careplus.notice = null;
      cpLog(s, 'register', '已登記回程需求（尚未叫車）', a.id);
    }, '已登記回程需求，尚未叫車');
  },
  unregisterReturn(){ cpApply(s => { const a = cpFocus(s), rr = a && cpReturnOf(s, a.id); if(rr && !rr.rideId) rr.interestRegistered = false; }, '已取消回程登記'); },
  requestReturn(source){
    let created = false;
    cpApply(s => {
      const a = cpEnsureFocus(s); if(!a) throw Error('目前沒有回診行程');
      const rr = cpEnsureReturn(s, a), q = cpQueueOf(s, a.id), b = cpBookingOf(s, a);
      cpSync(s);
      if(CP_ACTIVE_RETURN.includes(rr.status)) return;
      if(rr.status === 'MATCH_FAILED') throw Error('請按「重新叫車」');
      if(q.phase === 'before') throw Error('抵達醫院後才能叫回程車');
      if(q.phase !== 'done'){
        if(q.mode === 'opd') q.currentQueueNumber = q.patientQueueNumber;
        q.finishedAt = q.observationTime; q.phase = 'done'; s.careplus.notice = null;
        cpLog(s, 'done', '乘客表示已完成看診', a.id);
      }
      const h = cpHospital(a.hospitalId);
      const ride = cpNewRide(s, {kind:'return', direction:'return', appointmentId:a.id, requestId:rr.id, date:a.date, time:cpFmt(q.observationTime),
        pickup:h.pickupPoint, destination:b ? b.pickupAddress : (s.preferences.homeAddress || '住家'), wheelchair:rr.wheelchairRequired,
        passengerState:q.phase === 'done' ? (q.mode === 'opd' ? '已完成看診' : '已完成療程') : '尚未完成看診'});
      rr.rideId = ride.id; rr.requestedAt = cpNowIso(); rr.history.push({status:'REQUESTED', at:rr.requestedAt}); created = true;
      cpLog(s, 'request', source === 'voice' ? '已用語音發起回程叫車' : '已發起回程叫車', a.id);
    });
    toast(created ? '已送出叫車，家屬端已同步' : '回程叫車已在進行中');
  },
  retryRide(id){
    cpApply(s => {
      const r = cpRideOf(s, id); if(!r || r.status !== 'failed') throw Error('這筆叫車不需要重新媒合');
      r.status = 'requested'; r.excludedDrivers = []; cpOffer(s, r); r.requestedAt = cpNowIso();
    }, '已重新叫車');
  },
  cancelRide(id){
    cpApply(s => {
      const r = cpRideOf(s, id); if(!r) throw Error('找不到這筆叫車');
      if(!['requested','rematching','failed','assigned','arrived_pickup'].includes(r.status)) throw Error('這筆行程目前無法取消');
      r.status = 'cancelled'; r.cancelledAt = cpNowIso(); r.offeredTo = null; r.autoAt = null;
      const rr = r.requestId && s.careplus.returnRequests.find(x => x.id === r.requestId);
      if(rr){ rr.interestRegistered = false; cpLog(s, 'cancel', '已取消回程叫車', rr.appointmentId); }
    }, '已取消叫車');
  },
  driverAccept(id){
    cpApply(s => {
      const r = cpRideOf(s, id); if(!r || r.status !== 'requested' || r.offeredTo !== CP_SELF_DRIVER) throw Error('這筆任務已不在您的待接清單');
      if(cpDriverBusy(s, CP_SELF_DRIVER)) throw Error('請先完成目前的任務');
      cpAssign(s, r, CP_SELF_DRIVER);
      if(r.kind === 'return') cpLog(s, 'accepted', `司機${cpDriver(CP_SELF_DRIVER).name}已接單`, r.appointmentId);
    }, '已接受任務');
  },
  driverTransfer(id){
    cpApply(s => {
      const r = cpRideOf(s, id); if(!r || !['requested','assigned'].includes(r.status) || (r.status === 'requested' ? r.offeredTo : r.driverId) !== CP_SELF_DRIVER) throw Error('這筆任務無法轉單');
      r.excludedDrivers = [...new Set([...(r.excludedDrivers || []), CP_SELF_DRIVER])];
      r.status = 'rematching'; r.driverId = null; r.demoVehicle = null; r.offeredTo = null; r.autoAt = Date.now() + 3500;
      if(r.kind === 'return') cpLog(s, 'transfer', '原司機無法接單，系統重新媒合中', r.appointmentId);
    }, '已轉給其他待命司機，系統重新媒合中');
  },
  failMatch(){
    cpApply(s => {
      const r = s.rides.find(x => x.kind === 'return' && ['requested','rematching'].includes(x.status));
      if(!r) throw Error('目前沒有等待媒合的回程叫車');
      r.status = 'failed'; r.offeredTo = null; r.autoAt = null;
    }, '模擬：媒合失敗');
  },
  driverProgress(id){
    cpApply(s => {
      const r = cpRideOf(s, id); if(!r) throw Error('找不到這筆任務');
      const next = {assigned:'arrived_pickup', arrived_pickup:'onboard', onboard:'completed'}[r.status];
      if(!next) throw Error('目前無法更新此任務階段');
      r.status = next; r.statusUpdatedAt = cpNowIso();
      if(next === 'completed' && r.kind === 'return'){
        const a = s.appointments.find(x => x.id === r.appointmentId); if(a) a.status = 'completed';
        cpLog(s, 'home', '已平安到家', r.appointmentId);
      }
    }, '已更新任務進度');
  },
  requestSingleRide(f){
    let id = null;
    cpApply(s => { id = cpNewRide(s, {kind:'single', direction:f.direction, appointmentId:f.appointmentId, date:f.date, time:f.time, pickup:f.pickup, destination:f.destination, wheelchair:f.wheelchair}).id; }, '已送出叫車，正在尋找車輛');
    return id;
  },
  setLang(lang){ cpApply(s => { s.preferences.careLang = lang === 'id' ? 'id' : 'zh'; }); },
  enterVisitDay(){
    cpApply(s => {
      const a = cpNextAppointment(s); if(!a) throw Error('請先建立長期預約');
      for(const k of Object.keys(s.careplus.queues)) if(k !== a.id) delete s.careplus.queues[k];
      s.rides = s.rides.filter(r => r.appointmentId !== a.id);
      s.careplus.returnRequests = s.careplus.returnRequests.filter(r => r.appointmentId !== a.id);
      s.careplus.focusAppointmentId = a.id; a.queueMode = cpBookingOf(s, a)?.queueMode || 'opd';
      s.careplus.queues[a.id] = cpNewQueue(a, cpBookingOf(s, a)); a.patientQueueNumber = s.careplus.queues[a.id].patientQueueNumber ?? null;
      s.careplus.outbound[a.id] = {status:'accepted', driverId:CP_SELF_DRIVER, acceptedAt:cpNowIso(), pickupTime:cpCalc(s.careplus.queues[a.id]).departure, autoDispatched:true};
      s.careplus.notice = null; s.careplus.log = [];
      cpEnsureReturn(s, a);
    }, '已進入看診當天情境');
  }
};

// 模擬其他司機接單：只處理 autoAt 到期的叫車，時間由真實時鐘驅動以便錄影重現。
function cpTick(){
  const due = state.rides.filter(r => r.autoAt && Date.now() >= r.autoAt && ['requested','rematching'].includes(r.status));
  if(!due.length) return;
  cpApply(s => {
    for(const r of s.rides){
      if(!(r.autoAt && Date.now() >= r.autoAt && ['requested','rematching'].includes(r.status))) continue;
      if(r.status === 'requested' && r.offeredTo && r.offeredTo !== CP_SELF_DRIVER){ cpAssign(s, r, r.offeredTo); continue; }
      const d = cpPickDriver(s, r);
      if(d && d.id !== CP_SELF_DRIVER){ cpAssign(s, r, d.id); if(r.kind === 'return') cpLog(s, 'accepted', `已改由司機${d.name}接單`, r.appointmentId); }
      else if(d){ r.status = 'requested'; r.offeredTo = d.id; r.autoAt = null; }
      else { r.status = 'failed'; r.autoAt = null; }
    }
  }, null);
}
