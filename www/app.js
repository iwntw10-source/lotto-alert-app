// 복권 알림 - 화면/저장/스캔/알림
(function () {
  'use strict';

  var KEY = 'lotto.v1';
  var NOTI_IDS = { reminder: 1001, result: 1002 };
  var GAME_LABELS = ['A', 'B', 'C', 'D', 'E'];

  var $ = function (s) { return document.querySelector(s); };
  var plugins = function () { return (window.Capacitor && window.Capacitor.Plugins) || {}; };
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // ---------- 저장 ----------
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.tickets)) return { tickets: s.tickets, draws: s.draws || {}, notify: s.notify !== false };
    } catch (e) {}
    return { tickets: [], draws: {}, notify: true };
  }
  var state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---------- 표시 유틸 ----------
  function ballClass(n) { return 'c' + (n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : n <= 40 ? 4 : 5); }
  function ball(n, cls) { return '<span class="ball ' + ballClass(n) + (cls ? ' ' + cls : '') + '">' + n + '</span>'; }

  function won(n) {
    if (n >= 1e8) {
      var eok = Math.floor(n / 1e8), man = Math.floor((n % 1e8) / 1e4);
      return eok + '억' + (man ? ' ' + man.toLocaleString('ko-KR') + '만' : '') + '원';
    }
    if (n >= 1e4 && n % 1e4 === 0) return (n / 1e4).toLocaleString('ko-KR') + '만원';
    return n.toLocaleString('ko-KR') + '원';
  }

  function dateLabel(ms) {
    return new Date(ms).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' });
  }

  function countdown(ms) {
    if (ms <= 0) return '추첨 진행 중 · 곧 결과 확인 가능';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    if (d > 0) return d + '일 ' + h + '시간 후';
    if (h > 0) return h + '시간 ' + (m % 60) + '분 후';
    return (m % 60) + '분 후';
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---------- 판정 ----------
  function gameResult(nums, draw) {
    if (!draw) return null;
    var rank = Lotto.rankOf(nums, draw.numbers, draw.bonus);
    return { rank: rank, prize: Lotto.prizeOf(rank, draw) };
  }

  // 한 회차의 내 복권 결과 요약 (당첨이 없으면 null)
  function winSummary(n) {
    var draw = state.draws[n];
    if (!draw) return null;
    var w = null;
    state.tickets.forEach(function (t) {
      if (t.drawNo !== n) return;
      t.games.forEach(function (g) {
        var r = gameResult(g, draw);
        if (!r.rank) return;
        w = w || { total: 0, best: 9, count: 0 };
        w.total += r.prize; w.best = Math.min(w.best, r.rank); w.count++;
      });
    });
    return w;
  }

  // ---------- 렌더 ----------
  // 메인 화면은 한 회차만 보여준다.
  //  - "다음 회차 페이지"(발표된 최신 회차 + 1)는 복권을 등록하기 전에도 항상 미리 있다. 번호는 ?로 보이고, 여기서 등록한 복권이 쌓인다.
  //    회차가 끝나 결과가 발표되면 그다음 회차 페이지가 자동으로 생긴다(반복).
  //  - 앱을 열면(재접속 포함) 항상 이번 주 회차 페이지로 들어간다. 지난 회차의 결과는 ‹ 로 넘겨서 본다.
  var viewDraw = null;                // 지금 보고 있는 회차. 화살표/선택/등록으로 정해지고, 없으면 이번 주 회차로 고정한다
  var loading = {}, loadFailed = {};  // 지난 회차 조회 상태 (메모리 전용)

  // 이번 주 회차 = 결과가 발표된 최신 회차의 다음 회차 (토 21시쯤 결과가 발표되면 곧바로 그다음 회차로 바뀐다)
  function defaultDraw() { return Lotto.latestDrawNo() + 1; }

  // 이후 회차용 복권을 미리 등록해 둔 경우까지 › 로 넘겨볼 수 있는 가장 먼 회차
  function newestDraw() {
    var max = defaultDraw();
    state.tickets.forEach(function (t) { if (t.drawNo > max) max = t.drawNo; });
    return max;
  }

  // 보는 중에 화면이 저절로 다른 회차로 튀지 않도록, 한 번 정한 회차는 viewDraw 로 고정한다(앱을 다시 열면 이번 주 회차로 재계산).
  function currentDraw() {
    if (viewDraw == null) viewDraw = defaultDraw();
    return Math.min(Math.max(viewDraw, 1), newestDraw());
  }

  var viewSetAt = 0;
  function showDraw(n) { viewDraw = n; viewSetAt = Date.now(); render(); }

  // 지난 회차를 처음 볼 때 당첨번호를 받아 캐시한다. 실패하면 다시 시도 버튼을 누를 때까지 재요청하지 않는다.
  function ensureDraw(n) {
    if (state.draws[n] || n > Lotto.latestDrawNo() || loading[n] || loadFailed[n]) return;
    loading[n] = true;
    Lotto.fetchDraw(n, isNative ? nativeFetch : undefined).then(function (d) {
      if (d) { state.draws[n] = d; save(); } else { loadFailed[n] = true; }
    }).catch(function () {
      loadFailed[n] = true;
    }).then(function () {
      loading[n] = false;
      render();
    });
  }

  function renderNav() {
    var n = currentDraw(), newest = newestDraw(), latest = Lotto.latestDrawNo(), now = Date.now(), d = state.draws[n];
    var sub;
    if (n > latest) {
      var t = Lotto.drawTime(n);
      sub = dateLabel(t) + ' 20:35 추첨 · ' + countdown(t - now);
    } else {
      sub = (d ? d.date : dateLabel(Lotto.drawTime(n))) + ' 추첨';
    }
    $('#nav-t').textContent = '제' + n + '회';
    $('#nav-s').textContent = sub;
    $('#prev').disabled = n <= 1;
    $('#next').disabled = n >= newest;
  }

  // 회차 선택 시트: 최근 60회, 지금 보는 회차는 체크 표시, 내 복권이 있는 회차는 태그 표시
  function openDrawSheet() {
    var n = currentDraw(), newest = newestDraw();
    var mine = {};
    state.tickets.forEach(function (t) { mine[t.drawNo] = true; });
    var html = '';
    for (var i = newest; i > Math.max(newest - 60, 0); i--) {
      html += '<button class="draw-row' + (i === n ? ' sel' : '') + '" type="button" data-n="' + i + '">' +
        '<span>제' + i + '회' + (mine[i] ? '<span class="tag">내 복권</span>' : '') + '</span>' +
        '<span class="check">✓</span></button>';
    }
    $('#draw-list').innerHTML = html;
    $('#draw-sheet').hidden = false;
    var sel = $('#draw-list .sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
  }
  function closeDrawSheet() { $('#draw-sheet').hidden = true; }

  function pendingBalls() {
    var h = '';
    for (var i = 0; i < 6; i++) h += '<span class="ball pend">?</span>';
    return '<div class="balls">' + h + '<span class="plus">+</span><span class="ball pend">?</span></div>';
  }

  function renderDrawCard() {
    var n = currentDraw(), latest = Lotto.latestDrawNo(), d = state.draws[n], el = $('#drawcard');
    if (d) {
      var p1 = d.prizes && d.prizes[1];
      el.innerHTML = '<div class="balls">' + d.numbers.map(function (x) { return ball(x); }).join('') +
        '<span class="plus">+</span>' + ball(d.bonus) + '</div>' +
        (p1 ? '<div class="sub">1등 당첨금 ' + won(p1) + '</div>' : '');
      return;
    }
    if (n > latest) {
      el.innerHTML = pendingBalls() + '<div class="sub">추첨이 끝나면 결과를 알림으로 알려드려요</div>';
      return;
    }
    if (loadFailed[n]) {
      el.innerHTML = pendingBalls() + '<div class="note">당첨번호를 불러오지 못했어요</div>' +
        '<button class="retry" data-retry="1" type="button">다시 시도</button>';
      return;
    }
    el.innerHTML = pendingBalls() + '<div class="note">불러오는 중…</div>';
    ensureDraw(n);
  }

  function ticketCard(t, draw) {
    var games = t.games.map(function (g, i) {
      var r = gameResult(g, draw);
      var balls = g.map(function (num) {
        if (!draw) return ball(num);
        var hit = draw.numbers.indexOf(num) >= 0;
        var bonus = !hit && num === draw.bonus && r.rank === 2;
        return hit || bonus ? ball(num, 'hit') : ball(num, 'dim');
      }).join('');
      var badge = !draw ? '<span class="badge wait">대기</span>'
        : r.rank ? '<span class="badge win">' + r.rank + '등' + (r.prize ? ' ' + won(r.prize) : '') + '</span>'
        : '<span class="badge miss">낙첨</span>';
      return '<div class="game"><div class="balls"><span class="label" style="width:12px">' + GAME_LABELS[i] + '</span>' + balls + '</div>' + badge + '</div>';
    }).join('');
    return '<div class="card ticket"><button class="del" data-del="' + t.id + '" aria-label="삭제">✕</button>' +
      '<div class="meta">' + t.games.length + '게임 · ' + new Date(t.addedAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' 등록</div>' +
      games + '</div>';
  }

  function renderTickets() {
    var n = currentDraw(), draw = state.draws[n], el = $('#tickets');
    var list = state.tickets.filter(function (t) { return t.drawNo === n; })
      .sort(function (a, b) { return b.addedAt - a.addedAt; });
    if (!list.length) {
      el.innerHTML = !state.tickets.length
        ? '<div class="empty"><span class="em">🎫</span>복권 아래쪽 QR코드를 촬영하거나<br>사진을 등록하면 번호를 자동으로 읽어요.<br>추첨일 저녁에 결과를 알려드려요.</div>'
        : n > Lotto.latestDrawNo()
          ? '<div class="empty small">아직 등록한 복권이 없어요<br>복권을 사면 위 버튼으로 바로 등록하세요</div>'
          : '<div class="empty small">이 회차에 등록한 복권이 없어요</div>';
      return;
    }
    var w = winSummary(n), html = '';
    if (w) {
      html += '<div class="banner win"><div class="t">🎉 ' + w.best + '등 당첨!</div><div class="s">' +
        (w.total ? '총 ' + won(w.total) + ' · ' : '') + w.count + '게임 당첨</div></div>';
    }
    html += list.map(function (t) { return ticketCard(t, draw); }).join('');
    el.innerHTML = html;
  }

  function renderBell() {
    var b = $('#bell');
    b.setAttribute('aria-pressed', state.notify ? 'true' : 'false');
    b.textContent = state.notify ? '🔔' : '🔕';
  }

  function render() { renderNav(); renderDrawCard(); renderTickets(); renderBell(); }

  // ---------- 등록 ----------
  function ticketKey(drawNo, games) { return drawNo + ':' + games.map(function (g) { return g.join(','); }).join('|'); }

  // 앱이 꺼져 있어도 토요일 밤 결과 알림을 만들 수 있게, 등록된 복권을 네이티브 워커에 넘긴다 (안드로이드)
  function syncBackground() {
    var LB = plugins().LottoBackground;
    if (!LB) return;
    var payload = state.tickets.map(function (t) { return { drawNo: t.drawNo, games: t.games }; });
    try {
      Promise.resolve(LB.sync({ tickets: JSON.stringify(payload), notify: state.notify })).catch(function () {});
    } catch (e) {}
  }

  // 반환: { status: 'ok' | 'dup' | 'invalid', parsed }
  function addTicket(p) {
    var key = ticketKey(p.drawNo, p.games);
    if (state.tickets.some(function (t) { return ticketKey(t.drawNo, t.games) === key; })) return { status: 'dup', parsed: p };
    state.tickets.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), drawNo: p.drawNo, games: p.games, addedAt: Date.now() });
    save();
    syncBackground();
    return { status: 'ok', parsed: p };
  }

  function addFromText(text) {
    var p = Lotto.parseQr(text);
    return p ? addTicket(p) : { status: 'invalid' };
  }

  // ---------- 번호 직접 입력 ----------
  function manualInputs() { return Array.prototype.slice.call(document.querySelectorAll('#m-games .mnum')); }

  function relabelRows() {
    Array.prototype.forEach.call(document.querySelectorAll('#m-games .mrow'), function (row, i) {
      row.querySelector('.label').textContent = GAME_LABELS[i];
    });
  }

  function addManualRow() {
    var box = $('#m-games');
    if (box.children.length >= 5) { toast('한 장에 최대 5게임이에요'); return; }
    var row = document.createElement('div');
    row.className = 'mrow';
    var html = '<span class="label"></span>';
    for (var i = 0; i < 6; i++) html += '<input class="mnum" type="text" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="' + (i + 1) + '번째 번호">';
    html += '<button class="mdel" type="button" aria-label="게임 삭제">✕</button>';
    row.innerHTML = html;
    box.appendChild(row);
    relabelRows();
  }

  function openManual() {
    var latest = Lotto.latestDrawNo();
    var sel = $('#m-draw');
    sel.innerHTML = '';
    for (var n = latest + 1; n >= latest - 4; n--) {
      var o = document.createElement('option');
      o.value = n;
      o.textContent = '제' + n + '회 · ' + dateLabel(Lotto.drawTime(n)) + (n > latest ? ' 추첨 예정' : ' 추첨');
      sel.appendChild(o);
    }
    $('#m-games').innerHTML = '';
    addManualRow();
    $('#m-err').textContent = '';
    $('#sheet').hidden = false;
    var first = manualInputs()[0];
    if (first) first.focus();
  }

  function closeManual() { $('#sheet').hidden = true; }

  function saveManual() {
    var drawNo = parseInt($('#m-draw').value, 10), games = [], err = '';
    Array.prototype.forEach.call(document.querySelectorAll('#m-games .mrow'), function (row, idx) {
      var vals = Array.prototype.map.call(row.querySelectorAll('.mnum'), function (i) { return i.value.trim(); });
      if (vals.every(function (v) { return v === ''; })) return;
      var nums = vals.map(function (v) { return parseInt(v, 10); });
      var ok = vals.every(function (v) { return /^\d{1,2}$/.test(v); }) &&
        nums.every(function (x) { return x >= 1 && x <= 45; }) && new Set(nums).size === 6;
      if (ok) games.push(nums.sort(function (a, b) { return a - b; }));
      else if (!err) err = GAME_LABELS[idx] + ' 게임: 1~45 사이의 서로 다른 번호 6개를 넣어 주세요';
    });
    if (!err && !games.length) err = '번호를 입력해 주세요';
    $('#m-err').textContent = err;
    if (err) return;
    closeManual();
    report([addTicket({ drawNo: drawNo, games: games })]);
  }

  function report(results) {
    var ok = results.filter(function (r) { return r.status === 'ok'; });
    var dup = results.filter(function (r) { return r.status === 'dup'; }).length;
    var bad = results.filter(function (r) { return r.status === 'invalid'; }).length;
    var parts = [];
    if (ok.length) parts.push('복권 ' + ok.length + '장 등록 (제' + ok[0].parsed.drawNo + '회' + (ok.length > 1 ? ' 외' : '') + ')');
    if (dup) parts.push('이미 등록된 복권 ' + dup + '장');
    if (bad) parts.push('QR을 읽지 못한 사진 ' + bad + '장');
    toast(parts.join(' · ') || '등록할 복권이 없어요');
    var shown = results.filter(function (r) { return r.parsed; })[0];
    if (shown) { viewDraw = shown.parsed.drawNo; viewSetAt = Date.now(); } // 방금 등록한 복권의 회차를 보여준다
    render();
    if (ok.length) checkResults(false);
  }

  async function scanCamera() {
    var BS = plugins().BarcodeScanner;
    if (!BS) { toast('앱에서만 촬영할 수 있어요'); return; }
    try {
      var avail = await BS.isGoogleBarcodeScannerModuleAvailable();
      if (!avail.available) {
        toast('스캐너 준비 중이에요. 잠시 후 다시 눌러 주세요');
        await BS.installGoogleBarcodeScannerModule();
        return;
      }
      var res = await BS.scan({ formats: ['QR_CODE'] });
      var codes = (res.barcodes || []).map(function (b) { return b.rawValue; });
      if (!codes.length) return;
      report(codes.map(addFromText));
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) toast('촬영에 실패했어요: ' + (e && e.message || e));
    }
  }

  async function pickGallery() {
    var BS = plugins().BarcodeScanner, Cam = plugins().Camera;
    if (!BS || !Cam) { toast('앱에서만 등록할 수 있어요'); return; }
    try {
      var picked = await Cam.pickImages({ quality: 90, limit: 0 });
      var results = [];
      for (var i = 0; i < picked.photos.length; i++) {
        var r = { status: 'invalid' };
        try {
          var out = await BS.readBarcodesFromImage({ path: picked.photos[i].path, formats: ['QR_CODE'] });
          for (var j = 0; j < out.barcodes.length; j++) {
            r = addFromText(out.barcodes[j].rawValue);
            if (r.status !== 'invalid') break;
          }
        } catch (e) {}
        results.push(r);
      }
      report(results);
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) toast('사진을 불러오지 못했어요: ' + (e && e.message || e));
    }
  }

  // ---------- 결과 조회 ----------
  var busy = false;
  function nativeFetch(url, opts) {
    // 동행복권은 브라우저 UA가 아니면 차단하는 경우가 있어 네이티브 HTTP에 UA를 지정
    var headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' }, opts && opts.headers);
    return window.fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  async function checkResults(manual) {
    if (busy) return;
    busy = true;
    var btn = $('#refresh');
    btn.disabled = true; btn.classList.add('spin');
    Object.keys(loadFailed).forEach(function (k) { delete loadFailed[k]; }); // 새로고침하면 실패했던 회차도 다시 시도
    try {
      var latest = Lotto.latestDrawNo();
      var need = [latest];
      state.tickets.forEach(function (t) {
        if (t.drawNo <= latest && need.indexOf(t.drawNo) < 0) need.push(t.drawNo);
      });
      var failed = 0, fetched = 0;
      for (var i = 0; i < need.length; i++) {
        var n = need[i];
        if (state.draws[n]) continue;
        try {
          var d = await Lotto.fetchDraw(n, isNative ? nativeFetch : undefined);
          if (d) { state.draws[n] = d; fetched++; }
        } catch (e) { failed++; }
      }
      save();
      render();
      if (manual) {
        if (failed) toast('당첨번호를 불러오지 못했어요. 네트워크를 확인해 주세요');
        else if (!state.tickets.length) toast('제' + latest + '회 당첨번호를 불러왔어요');
        else toast('결과를 확인했어요');
      }
    } finally {
      busy = false;
      btn.disabled = false; btn.classList.remove('spin');
    }
  }

  // ---------- 알림 (매주 토요일) ----------
  async function syncNotifications() {
    var LN = plugins().LocalNotifications;
    if (!LN) return;
    try {
      await LN.cancel({ notifications: [{ id: NOTI_IDS.reminder }, { id: NOTI_IDS.result }] });
      if (!state.notify) return;
      var perm = await LN.checkPermissions();
      if (perm.display !== 'granted') perm = await LN.requestPermissions();
      if (perm.display !== 'granted') { state.notify = false; save(); renderBell(); toast('알림 권한이 꺼져 있어요'); return; }
      // isExactNotification:false — 정확한 알람 권한(시스템 설정 화면 이동)을 요구하지 않고, 몇 분 늦을 수 있음
      var list = [
        { id: NOTI_IDS.reminder, title: '오늘은 로또 추첨일', body: '20:35 추첨! 산 복권을 앱에 등록해 두면 결과를 바로 알려드려요.',
          smallIcon: 'ic_stat_lotto', isExactNotification: false, schedule: { on: { weekday: 7, hour: 19, minute: 0 }, allowWhileIdle: true } }
      ];
      // 안드로이드는 네이티브 워커(LottoWorker)가 당첨 여부가 담긴 결과 알림을 보낸다. 그 외(iOS/웹)만 고정 문구 알림.
      if (!plugins().LottoBackground) {
        list.push({ id: NOTI_IDS.result, title: '추첨 결과가 나왔어요', body: '눌러서 내 복권 당첨 여부를 확인하세요.',
          isExactNotification: false, schedule: { on: { weekday: 7, hour: 21, minute: 5 }, allowWhileIdle: true } });
      }
      await LN.schedule({ notifications: list });
    } catch (e) {}
  }

  // ---------- 이벤트 ----------
  // 복권 등록: 상단 큰 버튼 → 등록 방법(촬영 / 갤러리 / 번호 입력) 선택 → 선택하면 시트를 닫고 바로 실행
  function openReg() { $('#reg-sheet').hidden = false; }
  function closeReg() { $('#reg-sheet').hidden = true; }
  $('#reg-open').addEventListener('click', openReg);
  $('#reg-close').addEventListener('click', closeReg);
  $('#reg-sheet').addEventListener('click', function (e) { if (e.target === this) closeReg(); });
  $('#scan').addEventListener('click', function () { closeReg(); scanCamera(); });
  $('#pick').addEventListener('click', function () { closeReg(); pickGallery(); });
  $('#refresh').addEventListener('click', function () { checkResults(true); });

  // 회차 이동: 화살표 / 회차 이름을 눌러 목록에서 선택 / 좌우로 밀기
  $('#prev').addEventListener('click', function () { showDraw(currentDraw() - 1); });
  $('#next').addEventListener('click', function () { showDraw(currentDraw() + 1); });
  $('#nav-open').addEventListener('click', openDrawSheet);
  $('#draw-sheet-close').addEventListener('click', closeDrawSheet);
  $('#draw-sheet').addEventListener('click', function (e) { if (e.target === this) closeDrawSheet(); });
  $('#draw-list').addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('.draw-row') : null;
    if (!row) return;
    closeDrawSheet();
    showDraw(parseInt(row.getAttribute('data-n'), 10));
  });
  $('#drawcard').addEventListener('click', function (e) {
    if (!e.target.getAttribute('data-retry')) return;
    delete loadFailed[currentDraw()];
    render();
  });
  var swipe = null;
  // 카드 밖 빈 공간에서 밀어도 되도록 문서 전체에서 감지 (번호 입력 시트가 열려 있을 땐 제외)
  document.addEventListener('touchstart', function (e) {
    swipe = e.touches.length === 1 && $('#sheet').hidden && $('#reg-sheet').hidden && $('#draw-sheet').hidden
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!swipe) return;
    var dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return; // 세로 스크롤과 구분
    var n = currentDraw();
    if (dx > 0 && n > 1) showDraw(n - 1);                // 오른쪽으로 밀면 지난 회차
    else if (dx < 0 && n < newestDraw()) showDraw(n + 1); // 왼쪽으로 밀면 다음 회차
  }, { passive: true });
  $('#bell').addEventListener('click', function () {
    state.notify = !state.notify; save(); renderBell();
    syncNotifications();
    syncBackground();
    toast(state.notify ? '토요일 추첨 알림을 켰어요' : '추첨 알림을 껐어요');
  });
  $('#tickets').addEventListener('click', function (e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute('data-del');
    if (!id) return;
    if (!confirm('이 복권을 삭제할까요?')) return;
    state.tickets = state.tickets.filter(function (t) { return t.id !== id; });
    save(); syncBackground(); render();
  });

  $('#manual').addEventListener('click', function () { closeReg(); openManual(); });
  $('#sheet-close').addEventListener('click', closeManual);
  $('#sheet').addEventListener('click', function (e) { if (e.target === this) closeManual(); });
  $('#m-add').addEventListener('click', addManualRow);
  $('#m-save').addEventListener('click', saveManual);
  $('#m-games').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.classList.contains('mnum')) return;
    el.value = el.value.replace(/\D/g, '').slice(0, 2);
    // 두 자리를 채웠거나, 한 자리가 5 이상이면(46 이상은 없으므로) 다음 칸으로
    if (el.value.length === 2 || (el.value.length === 1 && +el.value > 4)) {
      var all = manualInputs(), next = all[all.indexOf(el) + 1];
      if (next) next.focus();
    }
  });
  $('#m-games').addEventListener('keydown', function (e) {
    var el = e.target;
    if (e.key === 'Backspace' && el.classList.contains('mnum') && el.value === '') {
      var all = manualInputs(), prev = all[all.indexOf(el) - 1];
      if (prev) { prev.focus(); e.preventDefault(); }
    }
  });
  $('#m-games').addEventListener('click', function (e) {
    if (!e.target.classList.contains('mdel')) return;
    var box = $('#m-games');
    if (box.children.length <= 1) { Array.prototype.forEach.call(box.querySelectorAll('.mnum'), function (i) { i.value = ''; }); return; }
    e.target.parentNode.remove();
    relabelRows();
  });

  function onForeground() {
    // 다시 열면 최신 회차부터 보여준다. 단, 촬영기/사진 선택기가 닫히며 겹친 이벤트로 방금 등록한 회차가 풀리지 않게 잠깐은 유지
    if (Date.now() - viewSetAt > 3000) viewDraw = null;
    render();
    checkResults(false);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) onForeground(); });
  // ---------- 하단 고정 배너 광고 (AdMob) ----------
  // 네이티브 뷰라서 화면 맨 아래에 겹쳐 뜬다. 배너 높이를 --ad-h 로 받아 본문/시트 여백에 반영한다(숨겨지면 0).
  function initAds() {
    var AdMob = plugins().AdMob, cfg = window.ADMOB_CONFIG;
    if (!AdMob || !cfg || !cfg.bannerAdUnitId) return;
    var setH = function (h) { document.documentElement.style.setProperty('--ad-h', (h || 0) + 'px'); };
    try { AdMob.addListener('bannerAdSizeChanged', function (info) { setH(info && info.height); }); } catch (e) {}
    AdMob.initialize({ initializeForTesting: !!cfg.testing }).then(function () {
      return AdMob.showBanner({ adId: cfg.bannerAdUnitId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!cfg.testing });
    }).catch(function () { setH(0); });
  }

  var P = plugins();
  // 안드로이드 뒤로가기: 열린 시트가 있으면 먼저 닫고, 없으면 앱 종료
  if (P.App && P.App.addListener) {
    P.App.addListener('backButton', function () {
      if (!$('#draw-sheet').hidden) closeDrawSheet();
      else if (!$('#reg-sheet').hidden) closeReg();
      else if (!$('#sheet').hidden) closeManual();
      else P.App.exitApp();
    });
  }
  if (P.LocalNotifications) P.LocalNotifications.addListener('localNotificationActionPerformed', onForeground);

  render();
  checkResults(false);
  syncNotifications();
  syncBackground();
  initAds();
  // 1분마다: 남은 시간 갱신 + 새 회차 결과가 발표됐으면(토 21시 넘어) 바로 조회해서 화면에 반영
  var lastLatest = Lotto.latestDrawNo();
  setInterval(function () {
    var l = Lotto.latestDrawNo();
    if (l !== lastLatest) { lastLatest = l; checkResults(false); }
    renderNav();
  }, 60000);
})();
