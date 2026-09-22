// 복권 알림 - 순수 로직 (브라우저/노드 공용): QR 파싱, 등수 판정, 회차/추첨시각 계산, 당첨번호 조회
(function (root) {
  'use strict';

  var WEEK = 7 * 24 * 3600 * 1000;
  // 1회차: 2002-12-07(토) 20:35 KST = 11:35 UTC
  var FIRST_DRAW_MS = Date.UTC(2002, 11, 7, 11, 35);
  // 추첨 후 결과가 조회 가능해지기까지 여유 (추첨 20:35 → 약 21:00 이후)
  var PUBLISH_DELAY_MS = 30 * 60 * 1000;

  var PRIZE_FIXED = { 4: 50000, 5: 5000 };

  function drawTime(drawNo) {
    return FIRST_DRAW_MS + (drawNo - 1) * WEEK;
  }

  // 결과가 이미 발표됐을 최신 회차
  function latestDrawNo(now) {
    now = now == null ? Date.now() : now;
    return Math.floor((now - FIRST_DRAW_MS - PUBLISH_DELAY_MS) / WEEK) + 1;
  }

  function isValidGame(nums) {
    if (nums.length !== 6) return false;
    var seen = {};
    for (var i = 0; i < 6; i++) {
      var n = nums[i];
      if (!(n >= 1 && n <= 45) || seen[n]) return false;
      seen[n] = true;
    }
    return true;
  }

  // 로또 6/45 용지 QR: ...?v=1242q0102030405 06q...  (v=회차4자리 + 게임당 [영문1자+숫자12자리])
  // 반환: { drawNo, games: [[n1..n6], ...] } 또는 null
  function parseQr(text) {
    if (typeof text !== 'string') return null;
    var m = /[?&]v=(\d{4})((?:[a-z]\d{12})+)/i.exec(text);
    if (!m) return null;
    var drawNo = parseInt(m[1], 10);
    var games = [];
    var re = /[a-z](\d{12})/gi;
    var g;
    while ((g = re.exec(m[2])) && games.length < 5) {
      var nums = [];
      for (var i = 0; i < 12; i += 2) nums.push(parseInt(g[1].substr(i, 2), 10));
      if (!isValidGame(nums)) continue;
      nums.sort(function (a, b) { return a - b; });
      games.push(nums);
    }
    if (!games.length || drawNo < 1) return null;
    return { drawNo: drawNo, games: games };
  }

  // 1~5등, 낙첨은 0
  function rankOf(nums, win, bonus) {
    var hit = 0;
    for (var i = 0; i < nums.length; i++) if (win.indexOf(nums[i]) >= 0) hit++;
    if (hit === 6) return 1;
    if (hit === 5 && nums.indexOf(bonus) >= 0) return 2;
    if (hit === 5) return 3;
    if (hit === 4) return 4;
    if (hit === 3) return 5;
    return 0;
  }

  function prizeOf(rank, draw) {
    if (!rank) return 0;
    if (draw && draw.prizes && draw.prizes[rank]) return draw.prizes[rank];
    return PRIZE_FIXED[rank] || 0;
  }

  // ---- 당첨번호 조회 (동행복권 → 미러 폴백) ----
  var PRIMARY = 'https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=';
  var MIRROR = 'https://smok95.github.io/lotto/results/';

  function ymd(s) { // '20231230' -> '2023-12-30'
    s = String(s || '');
    return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : s;
  }

  function fromPrimary(json, drawNo) {
    var it = json && json.data && json.data.list && json.data.list[0];
    if (!it || it.ltEpsd !== drawNo) return null;
    var nums = [it.tm1WnNo, it.tm2WnNo, it.tm3WnNo, it.tm4WnNo, it.tm5WnNo, it.tm6WnNo];
    if (!isValidGame(nums)) return null;
    return {
      drawNo: drawNo,
      date: ymd(it.ltRflYmd),
      numbers: nums.slice().sort(function (a, b) { return a - b; }),
      bonus: it.bnsWnNo,
      prizes: { 1: it.rnk1WnAmt, 2: it.rnk2WnAmt, 3: it.rnk3WnAmt, 4: it.rnk4WnAmt, 5: it.rnk5WnAmt }
    };
  }

  function fromMirror(json, drawNo) {
    if (!json || json.draw_no !== drawNo || !isValidGame(json.numbers || [])) return null;
    var prizes = {};
    (json.divisions || []).forEach(function (d, i) { prizes[i + 1] = d.prize; });
    return {
      drawNo: drawNo,
      date: String(json.date || '').slice(0, 10),
      numbers: json.numbers.slice().sort(function (a, b) { return a - b; }),
      bonus: json.bonus_no,
      prizes: prizes
    };
  }

  async function getJson(url, fetchFn) {
    var res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // 발표된 회차면 정규화된 결과, 아직이면 null. 두 소스 모두 실패하면 throw
  async function fetchDraw(drawNo, fetchFn) {
    fetchFn = fetchFn || root.fetch.bind(root);
    var lastErr, answered = false;
    try {
      var d = fromPrimary(await getJson(PRIMARY + drawNo, fetchFn), drawNo);
      if (d) return d;
      answered = true;
    } catch (e) { lastErr = e; }
    try {
      var d2 = fromMirror(await getJson(MIRROR + drawNo + '.json', fetchFn), drawNo);
      if (d2) return d2;
      answered = true;
    } catch (e) { lastErr = lastErr || e; }
    if (answered) return null;
    throw lastErr || new Error('조회 실패');
  }

  var api = {
    drawTime: drawTime,
    latestDrawNo: latestDrawNo,
    parseQr: parseQr,
    rankOf: rankOf,
    prizeOf: prizeOf,
    fetchDraw: fetchDraw,
    fromPrimary: fromPrimary,
    fromMirror: fromMirror
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lotto = api;
})(typeof window !== 'undefined' ? window : globalThis);
