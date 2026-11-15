// 驗收測試：16 個情境 + 補充情境，手機與桌面各跑一次。用法：node accept.js [mobile|desktop]
const {chromium} = require('playwright');
const BASE = 'http://localhost:8765/';
const KEY = 'yoxi-care-senior-pages-v1';
const mode = process.argv[2] || 'mobile';
const VIEW = mode === 'desktop' ? {width:1280, height:900} : {width:390, height:844};
const results = [];
const errors = [];

function check(id, name, cond, detail = ''){ results.push({id, name, pass:Boolean(cond), detail}); }

async function newPage(browser, url, init){
  const ctx = await browser.newContext({viewport:VIEW, deviceScaleFactor:1, hasTouch:mode !== 'desktop', isMobile:mode !== 'desktop'});
  if(init) await ctx.addInitScript(init);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`[${mode}] PAGEERROR ${e.message}`));
  p.on('console', m => { if(m.type() === 'error' && !/maps|google|ERR_|net::/.test(m.text())) errors.push(`[${mode}] CONSOLE ${m.text()}`); });
  await p.route(/google\.com|googleapis|gstatic/, r => r.fulfill({status:200, contentType:'text/html', body:'<html></html>'}));
  await p.goto(BASE + url); await p.waitForTimeout(400);
  return p;
}
const S = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const txt = (p, sel) => p.locator(sel).first().innerText().catch(() => '');
async function demo(p, act){
  if(!(await p.locator(`[data-cpd="${act}"]`).count())) await p.click('[data-cpd="expand"]');
  await p.click(`[data-cpd="${act}"]`); await p.waitForTimeout(150);
}
async function role(p, r){ await demo(p, 'role-' + r); }

function expectedDates(start, days, len){
  const out = []; const d0 = new Date(start + 'T12:00:00+08:00');
  for(let i = 0; i < len; i++){ const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i); if(days.includes(d.getUTCDay())) out.push(d.toISOString().slice(0,10)); }
  return out;
}

(async () => {
  const browser = await chromium.launch();
  try{

  // ---------- 1. 長期預約一個月 ----------
  let p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'reset');
  await p.click('#page-home [data-cpa="open-booking"]'); await p.waitForTimeout(200);
  const form = await p.evaluate(() => ({h:$('cp-hospital').value, dept:$('cp-dept').value, room:$('cp-room').value, time:$('cp-time').value, span:$('cp-span').value, wheel:$('cp-wheel').checked, days:[...document.querySelectorAll('.cp-day.on')].map(b => Number(b.dataset.day)), start:$('cp-start').value, pickup:$('cp-pickup').value}));
  check(1, '長期預約預設值', form.h === 'ntuh' && form.dept === '腎臟內科' && form.room === '3 診' && form.time === '09:00' && form.span === '30' && form.wheel && form.days.join() === '1,3,5', JSON.stringify(form));
  const previewCount = Number(((await txt(p, '.cp-preview-head strong')).match(/\d+/) || [])[0]);
  await p.click('#cp-lt-submit'); await p.waitForTimeout(300);
  let s = await S(p);
  const exp = expectedDates(form.start, [1,3,5], 30);
  const got = s.appointments.map(a => a.date).sort();
  check(1, '長期預約一個月：日期由程式計算且符合星期一三五', JSON.stringify(got) === JSON.stringify(exp) && previewCount === exp.length && s.careplus.bookings[0].endDate === expectedDates(form.start,[0,1,2,3,4,5,6],30).pop(), `共 ${got.length} 次：${got.join(', ')}`);
  const bookingText = await txt(p, '#cp-booking');
  check(1, '去程數、回程預估、正式派車分開計算（N 次回診≠2N 趟派車）', /已安排去程/.test(bookingText) && /回程預估需求/.test(bookingText) && s.rides.length === 0 && /\n0\n已正式叫車|0\s*已正式叫車/.test(bookingText.replace(/\r/g,'')), bookingText.split('\n').slice(0,14).join(' / '));
  // 單次暫停／取消
  const firstFuture = s.appointments.find(a => a.id !== s.careplus.focusAppointmentId);
  await p.click(`[data-cpa="pause-appt"][data-id="${firstFuture.id}"]`); await p.waitForTimeout(150);
  s = await S(p);
  check(1, '暫停單次接送', s.appointments.find(a => a.id === firstFuture.id).status === 'paused');
  await p.click(`[data-cpa="resume-appt"][data-id="${firstFuture.id}"]`); await p.waitForTimeout(150);
  s = await S(p);
  check(1, '恢復單次接送', s.appointments.find(a => a.id === firstFuture.id).status === 'scheduled');

  // ---------- 2. 語音輸入一三五（Demo 模擬語音） ----------
  await p.click('[data-cpa="open-booking-form"][data-id]'); await p.waitForTimeout(200);
  for(const d of [1,3,5]) await p.click(`.cp-day[data-day="${d}"]`);
  await p.click('.cp-day[data-day="2"]');
  await p.evaluate(() => { $('cp-wheel').checked = false; $('cp-time').value = '13:00'; $('cp-span').value = '14'; cpRenderPreview(); });
  await p.click('[data-cpa="voice-booking"]');
  const listening = await p.locator('#cp-listen').isVisible();
  await p.waitForTimeout(1800);
  const v = await p.evaluate(() => ({days:[...document.querySelectorAll('.cp-day.on')].map(b => Number(b.dataset.day)), wheel:$('cp-wheel').checked, time:$('cp-time').value, span:$('cp-span').value, h:$('cp-hospital').value, res:$('cp-voice-result').innerText}));
  check(2, '語音輸入一三五：自動填入週一三五、台大、09:00、一個月、輪椅', listening && v.days.join() === '1,3,5' && v.wheel && v.time === '09:00' && v.span === '30' && v.h === 'ntuh', JSON.stringify(v));
  check(2, '語音結果顯示給使用者確認，模擬辨識有標示', /辨識結果/.test(v.res) && /模擬語音辨識/.test(v.res) && /請確認/.test(v.res));
  await p.click('[data-action="close-dialog"]:visible'); await p.waitForTimeout(150);
  await p.close();

  // ---------- 3. 語音辨識失敗（一般模式） ----------
  p = await newPage(browser, '', () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForTimeout(300);
  await p.click('#page-home [data-cpa="open-booking"]'); await p.waitForTimeout(200);
  const before3 = await p.evaluate(() => [...document.querySelectorAll('.cp-day.on')].map(b => b.dataset.day).join());
  await p.click('[data-cpa="voice-booking"]'); await p.waitForTimeout(300);
  const fb = await p.evaluate(() => ({fallback:!$('cp-voice-fallback').hidden, msg:$('cp-voice-fallback-msg').innerText, result:!$('cp-voice-result').hidden, days:[...document.querySelectorAll('.cp-day.on')].map(b => b.dataset.day).join()}));
  check(3, '不支援語音：顯示文字輸入，欄位不被假資料覆寫', fb.fallback && !fb.result && fb.days === before3 && /不支援/.test(fb.msg), JSON.stringify(fb));
  await p.fill('#cp-voice-input', '每週二四下午兩點去馬偕醫院心臟內科，預約兩週');
  await p.click('[data-cpa="voice-text-apply"]'); await p.waitForTimeout(150);
  const tx = await p.evaluate(() => ({days:[...document.querySelectorAll('.cp-day.on')].map(b => Number(b.dataset.day)).join(), h:$('cp-hospital').value, t:$('cp-time').value, span:$('cp-span').value, dept:$('cp-dept').value, res:$('cp-voice-result').innerText}));
  check(3, '文字輸入可解析並讓使用者確認（無模擬標示）', tx.days === '2,4' && tx.h === 'mackay' && tx.t === '14:00' && tx.span === '14' && tx.dept === '心臟內科' && !/模擬/.test(tx.res), JSON.stringify(tx));
  const noDemoPanel = await p.locator('#cp-demo-root').count();
  check(3, '一般模式不出現錄影控制器', noDemoPanel === 0);
  await p.close();
  p = await newPage(browser, '', () => {
    class FakeSR{ start(){ setTimeout(() => this.onerror && this.onerror({error:'not-allowed'}), 50); } abort(){} }
    window.webkitSpeechRecognition = FakeSR; window.SpeechRecognition = FakeSR;
  });
  await p.click('#page-home [data-cpa="open-booking"]'); await p.waitForTimeout(200);
  await p.click('[data-cpa="voice-booking"]'); await p.waitForTimeout(400);
  const denied = await p.evaluate(() => ({fallback:!$('cp-voice-fallback').hidden, msg:$('cp-voice-fallback-msg').innerText}));
  check(3, '麥克風權限被拒：顯示原因並改用文字', denied.fallback && /麥克風權限/.test(denied.msg), denied.msg);
  await p.close();

  // ---------- 4~11, 14, 15：主流程 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await p.waitForTimeout(200);
  s = await S(p);
  const v5 = await txt(p, '.cp-queue-card');
  check(5, '18 號、25 號、5 分鐘：等待 35 分、輪到 11:00、看完 11:30、建議出門 10:30', /最近更新 10:25/.test(v5) && /18/.test(v5) && /25/.test(v5) && /7 個號碼/.test(v5) && /35 分鐘/.test(v5) && /預估輪到\s*11:00/.test(v5) && /預估看完\s*11:30/.test(v5) && /建議出門\s*10:30/.test(v5), v5.replace(/\n+/g,' '));
  await p.click('.cp-formula summary');
  const formula = await txt(p, '.cp-formula');
  check(5, '估算方式公開顯示', /7 個號碼 × 平均每號 5 分鐘＝35 分鐘/.test(formula) && /10:25＋35 分鐘＝11:00/.test(formula) && /11:00－車程 20 分鐘－緩衝 10 分鐘＝10:30/.test(formula), formula.replace(/\n+/g,' '));
  check(1, '長期預約只預先派去程，回程未派車', s.rides.length === 0 && s.careplus.outbound[s.careplus.focusAppointmentId].status === 'accepted');
  // 4 輪椅（長者端）
  const wheelSenior = await txt(p, '.cp-return');
  check(4, '輪椅需求：長者看診頁顯示無障礙輪椅車輛', /無障礙輪椅車輛/.test(wheelSenior));
  await role(p, 'driver');
  const drvOutbound = await txt(p, '#cp-outbound');
  check(4, '輪椅需求：司機端去程任務顯示需無障礙輪椅車輛', /需無障礙輪椅車輛/.test(drvOutbound), drvOutbound.split('\n').slice(0,6).join(' / '));
  const fc0 = await txt(p, '#cp-forecast');
  await role(p, 'senior'); await p.click('[data-cpa="open-visit"] >> nth=0').catch(() => {}); await p.waitForTimeout(100);

  // 6 延誤
  await demo(p, 'arrive'); await p.waitForTimeout(200);
  await demo(p, 'delay'); await p.waitForTimeout(200);
  s = await S(p);
  const alert = await txt(p, '.cp-alert');
  check(6, '看診延誤：顯示規定文字 11:30→12:00', /偵測到看診進度延遲/.test(alert) && /目前看診進度較預期慢，預估結束時間由 11:30 延後至 12:00。/.test(alert.replace(/\s+/g,'').replace('由11:30延後至12:00','由 11:30 延後至 12:00')) && /系統已更新預估回程需求與司機待命參考時間。/.test(alert) && /目前尚未派遣回程車輛。/.test(alert), alert.replace(/\n+/g,' '));
  check(6, '看診延誤：不建立任何派車', s.rides.length === 0 && s.careplus.returnRequests[0].status === 'NO_REQUEST');
  const q6 = s.careplus.queues[s.careplus.focusAppointmentId];
  check(6, '延誤由情境狀態產生（燈號 18 停滯 25 分）', q6.currentQueueNumber === 18 && q6.observationTime - q6.lastAdvanceTime === 25 && q6.delay && q6.delay.fromFinish === 690, JSON.stringify(q6.delay));
  await role(p, 'driver');
  const fc6 = await txt(p, '#cp-forecast'); const pool6 = await txt(p, '#cp-pool');
  check(6, '司機端預估需求同步更新為 12:00，且無接單按鈕', /預估 12:00 左右有 1 筆回程需求/.test(fc6) && /狀態：尚未叫車/.test(fc6) && /11:30/.test(fc6) && !(await p.locator('#cp-forecast button').count()) && /目前沒有任務/.test(pool6), fc6.replace(/\n+/g,' '));
  check(6, '延誤前司機端預估為 11:30', /預估 11:30 左右有 1 筆回程需求/.test(fc0), fc0.replace(/\n+/g, ' ').slice(0,120));
  await role(p, 'family');
  const fam6 = await txt(p, '#family-status');
  check(6, '家屬端顯示延誤', /延後至 12:00/.test(fam6) && /尚未派遣/.test(fam6));
  await role(p, 'senior');

  // 7 燈號 24
  await demo(p, 'near'); await p.waitForTimeout(200);
  const push = await txt(p, '#cp-push');
  s = await S(p);
  check(7, '燈號到 24：出現提醒且文字正確', await p.locator('#cp-push').isVisible() && /快輪到陳奶奶了！/.test(push) && /目前看診 24 號，您的號碼是 25 號。/.test(push) && /是否要先登記回程需求？/.test(push) && /先登記回程/.test(push) && /稍後再說/.test(push), push.replace(/\n+/g,' '));
  check(7, '燈號到 24：不正式派車', s.rides.length === 0 && s.careplus.returnRequests[0].status === 'NO_REQUEST');
  const q7 = s.careplus.queues[s.careplus.focusAppointmentId];
  check(5, '資訊更新時估算同步重算（24 號、11:20 → 看完 12:00）', q7.currentQueueNumber === 24 && q7.observationTime === 680 && /預估看完\s*12:00/.test(await txt(p, '.cp-queue-card')));

  // 8 先登記回程
  await p.click('[data-cpa="push-register"]'); await p.waitForTimeout(200);
  s = await S(p);
  const ret8 = await txt(p, '.cp-return');
  check(8, '先登記回程：只建立預估需求', s.rides.length === 0 && s.careplus.returnRequests[0].status === 'INTEREST_REGISTERED' && /回程需求已登記，尚未叫車。/.test(ret8) && !(await p.locator('#cp-push').isVisible()));
  await role(p, 'driver');
  const fc8 = await txt(p, '#cp-forecast'), pool8 = await txt(p, '#cp-pool');
  check(8, '司機端：預估區顯示已登記，任務池仍為空', /乘客已登記回程需求/.test(fc8) && /目前沒有任務/.test(pool8) && !(await p.locator('[data-cpa="drv-accept"]').count()));
  await role(p, 'senior');

  // 9 一鍵叫車
  await demo(p, 'done'); await p.waitForTimeout(200);
  await p.click('.bottom-nav [data-view="home"]'); await p.waitForTimeout(100);
  const homeTap = await p.locator('#cp-home-status [data-cpa="one-tap"]').isVisible();
  const tapText = await txt(p, '#cp-home-status');
  check(9, '看診完成後首頁最上方出現「我好了，一鍵叫車」與「用說的叫車」', homeTap && /我好了，一鍵叫車/.test(tapText) && /用說的叫車/.test(tapText));
  const bb = await p.locator('#cp-home-status [data-cpa="one-tap"]').boundingBox();
  await p.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(100);
  await p.evaluate(() => { cpEvents.requestReturn('tap'); cpEvents.requestReturn('tap'); });
  await p.waitForTimeout(200);
  s = await S(p);
  const ret = s.rides.filter(r => r.kind === 'return');
  check(10, '重複點一鍵叫車不產生重複訂單', ret.length === 1, `回程訂單數 ${ret.length}`);
  check(9, '一鍵叫車：狀態為等待司機接單、未顯示司機', ret[0] && ret[0].status === 'requested' && !ret[0].driverId && s.careplus.returnRequests[0].status === 'MATCHING' && /正在尋找車輛/.test(await txt(p, '#cp-home-status')) && !/RAB-5821/.test(await txt(p, '#cp-home-status')));
  await role(p, 'driver');
  const pool9 = await txt(p, '#cp-pool');
  check(9, '司機任務池出現可接單的新回程叫車需求', /新回程叫車需求/.test(pool9) && /台大醫院常德街大門乘車處/.test(pool9) && /台北市大安區和平東路二段 100 號/.test(pool9) && /已完成看診/.test(pool9) && /等待接單/.test(pool9) && /接受任務/.test(pool9) && /無法接單，轉給其他待命司機/.test(pool9), pool9.replace(/\n+/g,' '));
  check(4, '輪椅需求：司機回程任務顯示無障礙輪椅車輛', /車輛需求\s*無障礙輪椅車輛/.test(pool9) && ret[0].vehicleRequirement === 'wheelchair');
  const fcAfter = await txt(p, '#cp-forecast');
  check(9, '正式叫車後，預估區不再重複列出同一需求', !/左右有 1 筆回程需求/.test(fcAfter));

  // 11 司機接單
  await p.click('[data-cpa="drv-accept"]'); await p.waitForTimeout(200);
  s = await S(p);
  const act11 = await txt(p, '#driver-active');
  check(11, '司機端：接單後顯示目前接送任務與輪椅提醒', /目前接送任務/.test(act11) && /需無障礙輪椅車輛/.test(act11));
  await role(p, 'senior');
  const home11 = await txt(p, '#cp-home-status');
  check(11, '司機接單：長者端更新司機與車輛資訊', /司機已接單/.test(home11) && /RAB-5821/.test(home11) && /林志明/.test(home11), home11.replace(/\n+/g,' '));
  // 14 三端一致
  await role(p, 'family');
  const tl = await p.evaluate(() => [...document.querySelectorAll('#family-timeline .timeline-item')].map(e => ({t:e.querySelector('strong').innerText, done:e.classList.contains('done'), cls:e.className})));
  const famStat = await txt(p, '#family-status');
  check(14, '家屬時間軸 9 步，已發生的才打勾', tl.length === 9 && tl[0].done && tl[1].done && tl[2].done && tl[3].done && tl[5].done && tl[6].done && tl[7].done && !tl[8].done && /cp-tl-warn/.test(tl[4].cls), tl.map(x => `${x.t}:${x.done ? '✓' : x.cls.replace('timeline-item ','')}`).join(' | '));
  check(14, '切換長者／司機／家屬狀態一致', /司機已接單/.test(famStat) && /RAB-5821/.test(famStat) && s.careplus.returnRequests[0].assignedDriverId === 'drv-a');
  // 15 重新整理
  await p.reload(); await p.waitForTimeout(500);
  const s15 = await S(p);
  await p.evaluate(() => switchRole('senior')); await p.waitForTimeout(100);
  check(15, '重新整理後保留模擬資料', s15.careplus.returnRequests[0].status === 'ACCEPTED' && s15.rides.length === 1 && /RAB-5821/.test(await txt(p, '#cp-home-status')));
  // 行程推進到返家
  await p.evaluate(() => switchRole('driver'));
  for(let i = 0; i < 3; i++){ await p.click('#driver-active [data-action="driver-progress"]'); await p.waitForTimeout(150); }
  s = await S(p);
  check('補充', '回程行程推進：到達→上車→到家，回診標記完成', s.rides[0].status === 'completed' && s.appointments.find(a => a.id === s.careplus.focusAppointmentId).status === 'completed' && s.careplus.returnRequests[0].status === 'COMPLETED');
  await role(p, 'family');
  const tlEnd = await p.evaluate(() => [...document.querySelectorAll('#family-timeline .timeline-item')].map(e => e.classList.contains('done')));
  check('補充', '家屬時間軸「已返家」打勾', tlEnd[8] === true);
  await p.close();

  // ---------- 補充：用說的叫車 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await demo(p, 'arrive'); await demo(p, 'done');
  await p.click('.bottom-nav [data-view="home"]');
  await p.click('#cp-home-status [data-cpa="voice-return"]'); await p.waitForTimeout(300);
  const lis = await p.locator('#cp-listen').isVisible();
  await p.waitForTimeout(1700);
  s = await S(p);
  const vc = await txt(p, '#cp-home-status .cp-voice-confirm');
  check('補充', '用說的叫車：辨識後先顯示確認，尚未建立訂單', lis && /已聽到：「我好了，幫我叫車」/.test(vc) && /模擬語音辨識/.test(vc) && s.rides.length === 0, vc.replace(/\n+/g,' '));
  await p.click('#cp-home-status [data-cpa="voice-confirm"]'); await p.waitForTimeout(200);
  s = await S(p);
  check('補充', '用說的叫車：確認後才建立一筆回程叫車', s.rides.length === 1 && s.rides[0].status === 'requested');
  await p.close();
  p = await newPage(browser, '?demo', () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; try{ sessionStorage.setItem('cp-simvoice','0'); }catch{} });
  await demo(p, 'load'); await demo(p, 'arrive'); await demo(p, 'done');
  await p.click('.cp-return [data-cpa="voice-return"]'); await p.waitForTimeout(300);
  s = await S(p);
  const vf = await txt(p, '.cp-return .cp-voice-confirm');
  check('補充', '語音叫車失敗：提示改按按鈕，不會自動叫車', /不支援語音輸入/.test(vf) && /我好了，一鍵叫車/.test(vf) && s.rides.length === 0, vf.replace(/\n+/g,' '));
  await p.close();

  // ---------- 12 司機轉單 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await demo(p, 'arrive'); await demo(p, 'done');
  await p.click('.cp-return [data-cpa="one-tap"]'); await p.waitForTimeout(150);
  await role(p, 'driver');
  await p.click('[data-cpa="drv-transfer"]'); await p.waitForTimeout(200);
  s = await S(p);
  const pool12 = await txt(p, '#cp-pool');
  check(12, '司機轉單：移出原司機清單並進入重新媒合', s.rides[0].status === 'rematching' && s.rides[0].excludedDrivers.includes('drv-a') && !(await p.locator('[data-cpa="drv-accept"]').count()) && /已轉出/.test(pool12) && !/違規/.test(pool12));
  await role(p, 'senior');
  const wait12 = await txt(p, '#cp-home-status');
  check(12, '重新媒合中長者端不顯示車輛資訊', /正在尋找車輛/.test(wait12) && !/RAB-5821|RCD-3307/.test(wait12), wait12.replace(/\n+/g,' '));
  await p.waitForTimeout(4200);
  s = await S(p);
  const after12 = await txt(p, '#cp-home-status');
  check(12, '另一位模擬司機接單後才顯示新車輛資訊', s.rides[0].status === 'assigned' && s.rides[0].driverId === 'drv-b' && /RCD-3307/.test(after12) && /陳建華/.test(after12));
  await p.close();

  // ---------- 補充：媒合失敗、重新叫車、取消 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await demo(p, 'arrive'); await demo(p, 'done');
  await p.click('.cp-return [data-cpa="one-tap"]'); await p.waitForTimeout(150);
  await demo(p, 'fail');
  s = await S(p);
  const failText = await txt(p, '.cp-return');
  check('補充', '媒合失敗：顯示找不到車輛與重新叫車', s.rides[0].status === 'failed' && /重新叫車/.test(failText));
  await p.click('.cp-return [data-cpa="retry-ride"]'); await p.waitForTimeout(150);
  s = await S(p);
  check('補充', '重新叫車：回到等待接單', s.rides[0].status === 'requested' && s.rides.length === 1);
  await p.click('.cp-return [data-cpa="cancel-ride"]'); await p.click('#confirm-yes'); await p.waitForTimeout(150);
  s = await S(p);
  check('補充', '取消叫車：狀態為已取消，可再叫一次', s.rides[0].status === 'cancelled' && s.careplus.returnRequests[0].status === 'CANCELLED' && await p.locator('.cp-return [data-cpa="one-tap"]').count() > 0);
  await p.close();

  // ---------- 13 療程剩 15 分鐘 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await demo(p, 'mode');
  const tr = await txt(p, '.cp-queue-card');
  check(13, '固定療程模式：顯示開始時間、長度、預估完成', /療程進度/.test(tr) && /09:00/.test(tr) && /240 分鐘/.test(tr) && /13:00/.test(tr), tr.replace(/\n+/g,' '));
  await demo(p, 't15'); await p.waitForTimeout(200);
  const push13 = await txt(p, '#cp-push'); s = await S(p);
  check(13, '療程剩 15 分鐘：出現療程型回程提醒且不派車', /預估療程剩餘 15 分鐘。/.test(push13) && /是否要先登記回程需求？/.test(push13) && s.rides.length === 0, push13.replace(/\n+/g,' '));
  await demo(p, 'lang-id'); await p.waitForTimeout(100);
  const push13b = await txt(p, '#cp-push');
  check('補充', '照護語言：提醒同時顯示印尼文', /Perkiraan sisa terapi 15 menit/.test(push13b));
  await p.close();

  // ---------- 16 重設 ----------
  p = await newPage(browser, '?demo&simvoice');
  await demo(p, 'load'); await demo(p, 'arrive'); await demo(p, 'done');
  await p.click('.cp-return [data-cpa="one-tap"]');
  await demo(p, 'reset'); await p.waitForTimeout(200);
  s = await S(p);
  const view = await p.evaluate(() => document.documentElement.dataset.view);
  check(16, '重設情境：回到初始可錄影狀態', s.appointments.length === 0 && s.rides.length === 0 && s.careplus.bookings.length === 0 && s.preferences.homeAddress && view === 'home' && /設定長期預約/.test(await txt(p, '#cp-booking-title')));
  await p.close();

  // ---------- 舊資料遷移 ----------
  p = await newPage(browser, '', null);
  await p.evaluate(k => localStorage.setItem(k, JSON.stringify({appointments:[{id:'old1', date:'2027-01-05', time:'10:00', hospital:'苗栗醫院', address:'', note:'', createdAt:'2026-01-01'}], rides:[{id:'r1', direction:'outbound', date:'2027-01-05', time:'09:30', pickup:'家', destination:'苗栗醫院', status:'saved', createdAt:'2026-01-01'}, {id:'r2', direction:'outbound', date:'2027-01-06', time:'09:30', pickup:'家', destination:'苗栗醫院', status:'assigned', demoVehicle:{plate:'ABC-7283', color:'銀白色', etaMinutes:8}, createdAt:'2026-01-01'}], preferences:{fontSize:'large', homeAddress:'苗栗市'}, sharedLocation:null})), KEY);
  await p.reload(); await p.waitForTimeout(400);
  s = await S(p);
  check('補充', '舊版 localStorage 可直接遷移，不出錯', s.careplus && s.careplus.version === 2 && s.rides.find(r => r.id === 'r1').status === 'requested' && s.rides.find(r => r.id === 'r2').driverId === 'drv-c' && s.preferences.fontSize === 'large');
  await p.close();

  // ---------- 一般模式：無「Demo」字樣 ----------
  p = await newPage(browser, '');
  await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForTimeout(300);
  let banned = [];
  for(const v of ['home','appointments','rides','help']){ await p.evaluate(x => setView(x), v); const t = await p.evaluate(() => document.body.innerText); const m = t.match(/demo|Demo|DEMO|展示版|測試|示範網站|原型|prototype|此為/g); if(m) banned.push(v + ':' + m.join(',')); }
  for(const r of ['driver','family']){ await p.evaluate(x => switchRole(x), r); const t = await p.evaluate(() => document.body.innerText); const m = t.match(/demo|Demo|DEMO|展示版|測試|示範網站|原型|prototype|此為/g); if(m) banned.push(r + ':' + m.join(',')); }
  check('補充', '一般模式畫面沒有「此為 Demo」類提示', banned.length === 0, banned.join(' '));
  await p.close();

  }catch(e){ errors.push(`[${mode}] TEST ABORT ${e.message.split('\n')[0]}`); }
  await browser.close();
  const pass = results.filter(r => r.pass).length;
  console.log(JSON.stringify({mode, pass, total:results.length, errors, results}, null, 1));
})();
