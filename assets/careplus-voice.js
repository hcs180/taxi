'use strict';

// 語音輸入：優先使用瀏覽器的 Web Speech API。一般模式下辨識失敗一律改用文字輸入，不會套用預設語句；
// 只有 Demo 模式開啟「模擬語音」時才使用預設語句，結果會標示為模擬辨識。

const cpVoice = (() => {
  let recog = null, timer = null, session = 0;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const simEnabled = () => {
    if(!CP_DEMO) return false;
    try{ const v = sessionStorage.getItem('cp-simvoice'); if(v !== null) return v === '1'; }catch{}
    return CP_PARAMS.has('simvoice');
  };
  function overlay(text, sub){
    const box = $('cp-listen');
    box.innerHTML = `<div class="cp-listen-card"><div class="cp-mic-ring" aria-hidden="true">${cpIcon('mic')}</div><p>${esc(text)}</p><small>${esc(sub)}</small><button type="button" class="btn secondary" data-cpa="voice-stop">取消</button></div>`;
    if(!box.open){ try{ box.showModal(); }catch{ box.setAttribute('open', ''); } }
  }
  function stop(){ clearTimeout(timer); try{ recog && recog.abort(); }catch{} recog = null; }
  function close(){ stop(); const box = $('cp-listen'); if(box.open) box.close(); }
  // 使用者按 Esc 或「取消」關閉聆聽視窗時，作廢這一次辨識，不回傳任何結果。
  $('cp-listen').addEventListener('close', () => { session++; stop(); });
  function listen({lang = 'zh', prompt, simulatedText, onResult, onFail}){
    const langLabel = lang === 'id' ? 'Bahasa Indonesia' : '中文', my = ++session;
    if(simEnabled()){
      overlay(prompt, `${langLabel}・模擬語音辨識`);
      timer = setTimeout(() => { if(my !== session) return; close(); onResult(simulatedText, true); }, 1500);
      return;
    }
    if(!SR){ onFail('unsupported'); return; }
    overlay(prompt, langLabel);
    let done = false;
    const finish = fn => { if(done || my !== session) return; done = true; close(); fn(); };
    try{
      recog = new SR(); recog.lang = lang === 'id' ? 'id-ID' : 'zh-TW'; recog.interimResults = false; recog.maxAlternatives = 1;
      recog.onresult = e => { const t = e.results[0] && e.results[0][0] ? e.results[0][0].transcript.trim() : ''; finish(() => t ? onResult(t, false) : onFail('nomatch')); };
      recog.onerror = e => finish(() => onFail(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nomatch' : 'error'));
      recog.onend = () => finish(() => onFail('nomatch'));
      recog.start();
      timer = setTimeout(() => finish(() => onFail('nomatch')), 9000);
    }catch{ finish(() => onFail('error')); }
  }
  const failText = r => ({unsupported:'這個瀏覽器不支援語音輸入', denied:'沒有取得麥克風權限', nomatch:'沒有聽清楚', error:'語音輸入暫時無法使用'}[r] || '語音輸入暫時無法使用');
  return {listen, close, simEnabled, failText, supported:Boolean(SR)};
})();

// 從一句話解析長期預約欄位。只填入有聽到的項目，其餘欄位保持原值。
function cpParseBookingText(text){
  const out = {};
  // 先取出上車地址，並從句子中移除，避免地址裡的字被誤認成醫院或科別。
  const pick = cpFindPickup(text);
  if(pick){ out.pickup = cpPlaceInfo(pick.place); text = text.replace(pick.raw, ' '); }
  const other = cpFindHospitalWord(text);
  if(other && !cpMatchHospital(other)) out.unknownHospital = other;
  const dayMap = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0};
  const m = text.match(/(?:每週|每周|每星期|星期|禮拜|週|周)([一二三四五六日天、,，和及與\s]+)/);
  if(m){ const days = [...new Set([...m[1]].filter(c => c in dayMap).map(c => dayMap[c]))]; if(days.length) out.weekdays = days; }
  const h = cpMatchHospital(text);
  if(h) out.hospitalId = h.id;
  const dept = text.match(/([一-龥]{1,4}(?:內科|外科|科))/); if(dept) out.department = dept[1].replace(/^(醫院|台大|臺大)/,'');
  const room = text.match(/(\d{1,2}|[一二三四五六七八九十]{1,2})\s*診/); if(room) out.clinicRoom = `${cpCnNum(room[1])} 診`;
  const time = cpParseTime(text); if(time) out.appointmentTime = time;
  if(/一個月|1\s*個月/.test(text)) out.duration = 30; else if(/兩週|兩個禮拜|二週|2\s*週|半個月/.test(text)) out.duration = 14; else if(/三個月|3\s*個月/.test(text)) out.duration = 90;
  if(/輪椅|無障礙/.test(text)) out.wheelchairRequired = true;
  if(/透析|洗腎|療程/.test(text)) out.queueMode = 'treatment';
  return out;
}
// 中文數字（0～59）與阿拉伯數字都轉成數字。
function cpCnNum(s){
  if(/^\d+$/.test(s)) return Number(s);
  const d = {'零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
  if(s.includes('十')){ const [a, b] = s.split('十'); return (a ? d[a] : 1) * 10 + (b ? d[b] : 0); }
  return d[s] ?? NaN;
}
// 解析「早上九點」「下午兩點半」「8點15分」「晚上七點四十」等時間。
function cpParseTime(text){
  const t = text.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零〇一二兩三四五六七八九十]{1,3}|\d{1,2})\s*(?:點|:|：)\s*(半|[零〇一二三四五六七八九十]{1,3}|\d{1,2})?\s*分?/);
  if(!t) return null;
  let hh = cpCnNum(t[2]); const mm = t[3] === '半' ? 30 : t[3] ? cpCnNum(t[3]) : 0;
  if(['下午','傍晚','晚上'].includes(t[1]) && hh < 12) hh += 12;
  if(t[1] === '中午' && hh < 6) hh += 12;
  if(!(hh >= 0 && hh < 24 && mm >= 0 && mm < 60)) return null;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}
// 解析「今天／明天／後天／大後天」「下週三」「星期五」「11月20日」等日期，回傳 YYYY-MM-DD。
function cpParseDate(text){
  const today = cpToday();
  if(/大後天/.test(text)) return cpAddDays(today, 3);
  if(/後天/.test(text)) return cpAddDays(today, 2);
  if(/明天|明早/.test(text)) return cpAddDays(today, 1);
  if(/今天|今日|現在|馬上|等一下/.test(text)) return today;
  const md = text.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日號号]/);
  if(md){
    const m = cpCnNum(md[1]), d = cpCnNum(md[2]);
    if(m >= 1 && m <= 12 && d >= 1 && d <= 31){
      let y = Number(today.slice(0,4)), iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      if(iso < today) iso = `${y + 1}${iso.slice(4)}`;
      return iso;
    }
  }
  const w = text.match(/(下下|下)?\s*(?:週|周|星期|禮拜|礼拜)\s*([一二三四五六日天])/);
  if(w){
    const target = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0}[w[2]], cur = cpWeekday(today);
    let diff = (target - cur + 7) % 7;
    if(w[1]){ const toMonday = ((1 - cur + 7) % 7) || 7; diff = toMonday + ((target + 6) % 7) + (w[1] === '下下' ? 7 : 0); }
    return cpAddDays(today, diff);
  }
  return null;
}
// 地點解析共用：遇到日期、時間、車輛需求或標點就停止，剩下的文字就是地點。
const CP_PLACE_STOP = /(今天|明天|後天|大後天|明早|今早|下下?[週周]|星期|禮拜|[週周][一二三四五六日天]|[0-9一二三四五六七八九十]{1,3}\s*月\s*[0-9一二三四五六七八九十]{1,3}\s*[日號号]|凌晨|早上|上午|中午|下午|傍晚|晚上|[零〇一二兩三四五六七八九十0-9]{1,3}\s*[點:：]|現在|馬上|要輪椅|需要輪椅|不用輪椅|不要輪椅|不需要輪椅|輪椅|無障礙|一般車|普通車|看診|回診|拿藥|看病|復健|洗腎|透析|出發|上車|然後|預約|每[週周]|[，,。.、！!？?；;])/;
function cpCleanPlace(s){
  if(!s) return '';
  const i = s.search(CP_PLACE_STOP);
  let p = (i >= 0 ? s.slice(0, i) : s).trim();
  p = p.replace(/^(我要|我想|想要|要|我|在|的)+/, '').replace(/(這裡|那裡|這邊|那邊|那)$/, '').trim();
  return p.length >= 1 && p.length <= 60 ? p : '';
}
function cpMatchHospital(text){
  return CP_HOSPITALS.find(x => text.includes(x.name)) || (/台大|臺大/.test(text) ? cpHospital('ntuh') : /馬偕/.test(text) ? cpHospital('mackay') : /中榮|台中榮|臺中榮/.test(text) ? cpHospital('tcvgh') : /苗栗醫院/.test(text) ? cpHospital('mlh') : null);
}
// 句子裡看起來像院所名稱的詞（例如「為恭醫院」），用來提示清單中沒有的醫院。
function cpFindHospitalWord(text){
  const suffix = '(?:醫院|醫學中心|診所|醫療中心|榮總)';
  const m = text.match(new RegExp(`(?:去|到|前往|在)\\s*([^，,。去到在\\s]{1,12}?${suffix})`)) || text.match(new RegExp(`([一-龥A-Za-z0-9]{2,4}${suffix})`));
  return m ? m[1] : '';
}
// 取出上車地點：「從 X」「在 X 上車」「上車地址是 X」。
function cpFindPickup(text){
  const pats = [/(?:上車地址|接送地址|上車地點|地址)\s*(?:是|在|為|：|:)?\s*([^，,。]+)/, /在\s*([^，,。]+?)\s*上車/, /從\s*(.+?)(?=去|到|前往|回家|回去|出發|上車|[，,。]|$)/];
  for(const re of pats){ const m = text.match(re); if(m){ const place = cpCleanPlace(m[1]); if(place) return {raw:m[0], place}; } }
  return null;
}
// 把地點分成住家、清單中的醫院、或照原文填入的地址。
function cpPlaceInfo(p){
  if(/^(家|家裡|家里|住家|我家|自己家|自己的家)$/.test(p)) return {kind:'home', text:p};
  const h = cpMatchHospital(p);
  if(h && p.length <= h.name.length + 4) return {kind:'hospital', hospitalId:h.id, text:p};
  return {kind:'text', text:p};
}

// 單次叫車：解析方向、上下車地點、日期、時間與車輛需求。只回傳有聽到的項目。
function cpParseRideText(text){
  const out = {};
  // 地點：「從 A」是上車地點，「去／到／前往 B」是目的地，「回家」的目的地是住家。
  const pick = cpFindPickup(text);
  if(pick) out.pickup = cpPlaceInfo(pick.place);
  const rest = pick ? text.slice(text.indexOf(pick.raw) + pick.raw.length) : text;
  const goHome = /回家|回去|返家|到家/.test(text);
  const dm = rest.match(/(?:^|[^回])(?:去|到|前往)\s*(.+)$/);
  const destPlace = dm ? cpCleanPlace(dm[1]) : '';
  if(destPlace) out.destination = cpPlaceInfo(destPlace);
  else if(goHome) out.destination = {kind:'home'};
  if(out.destination && out.destination.kind === 'home') out.direction = 'return';
  else if(out.destination) out.direction = 'outbound';
  else if(goHome) out.direction = 'return';
  else if(/醫院|看診|回診|診所/.test(text)) out.direction = 'outbound';
  let timeText = text;
  for(const raw of [pick && pick.place, destPlace]) if(raw) timeText = timeText.replace(raw, ' ');
  text = timeText;
  const date = cpParseDate(text); if(date) out.date = date;
  const time = cpParseTime(text);
  if(time) out.time = time;
  else if(/現在|馬上/.test(text)){ const n = nowTaipei(10); out.date = n.date; out.time = n.time; }
  if(/不用輪椅|不需要輪椅|不要輪椅|一般車|普通車/.test(text)) out.wheelchair = false;
  else if(/輪椅|無障礙/.test(text)) out.wheelchair = true;
  return out;
}
const cpIsReturnPhrase = text => /我好了|好了|我要回家|回家|幫我叫車|叫車|selesai|pulang|panggil/i.test(text);
