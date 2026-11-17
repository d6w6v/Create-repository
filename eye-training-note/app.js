/* DOPEYE (눈 훈련 노트) — 개발 2단계까지: 카드 저장 + 분석 1~11단계 + 잠금 + 모르겠음 + 빠른 버전 + 한 장 보기 */
(() => {
  'use strict';
  document.documentElement.lang = 'ko';
  /* 디자인 시안 고르기 (이 기기에만 기억) */
  const SKINS = [['', '깔끔'], ['editorial', '매거진'], ['studio', '스튜디오'], ['pop', '팝']];
  function setSkin(name) {
    if (name) document.documentElement.dataset.skin = name; else delete document.documentElement.dataset.skin;
    try { localStorage.setItem('eye-skin', name); } catch (e) { /* 기억 못 해도 그냥 진행 */ }
  }
  try { setSkin(new URLSearchParams(location.search).get('skin') ?? localStorage.getItem('eye-skin') ?? ''); } catch (e) { /* 기본 모양 */ }
  const PREVIEW = !!window.EYE_PREVIEW; // 미리보기 주소에서는 파일 저장과 인쇄가 막혀 있다

  /* 화면 조각을 바꿔 끼울 때 빈 것(null)은 건너뛴다 */
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) {
    return nativeReplace.apply(this, kids.flat().filter((k) => k != null && k !== false));
  };

  /* ───────── 작은 도구들 ───────── */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function clock() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  let toastTimer = null;
  function toast(msg) {
    document.querySelector('.toast')?.remove();
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }

  /* ───────── 저장소 (이 기기의 브라우저 안 서랍) ───────── */
  const DB_NAME = 'eye-training-note';
  let db = null;
  let storageOk = true;
  const mem = { cards: new Map(), images: new Map(), diary: new Map(), meta: new Map(), series: new Map(), shotlists: new Map() };

  function openDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 4);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
          for (const name of ['images', 'diary', 'meta', 'series', 'shotlists']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
        };
        req.onsuccess = () => { db = req.result; resolve(); };
        req.onerror = () => { storageOk = false; resolve(); };
      } catch (e) { storageOk = false; resolve(); }
    });
  }
  function run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = tx.onabort = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  }
  const store = {
    all: (s) => db ? run(s, 'readonly', (o) => o.getAll()) : Promise.resolve([...mem[s].values()]),
    get: (s, id) => db ? run(s, 'readonly', (o) => o.get(id)) : Promise.resolve(mem[s].get(id)),
    put: (s, v) => db ? run(s, 'readwrite', (o) => o.put(v)) : Promise.resolve(void mem[s].set(v.id, v)),
    del: (s, id) => db ? run(s, 'readwrite', (o) => o.delete(id)) : Promise.resolve(void mem[s].delete(id)),
    clear: (s) => db ? run(s, 'readwrite', (o) => o.clear()) : Promise.resolve(void mem[s].clear()),
  };

  /* ───────── 카드 모양 ───────── */
  function newCard(no, type) {
    const now = Date.now();
    return {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      no, type: type || 'still', mode: (() => { try { return localStorage.getItem('eye-mode') || 'full'; } catch (e) { return 'full'; } })(),
      createdAt: now, updatedAt: now,
      date: today(), tags: [],
      image: { kind: 'none' }, thumb: '',
      source: { text: '', unknown: false },
      trust: '',
      steps: { s1: { feel: '', words: ['', '', ''], score: null } },
      unknown: [],
    };
  }
  const TRUST = [
    ['confirmed', '확인됨 (크레딧 있음)'],
    ['partial', '일부 확인'],
    ['unknown', '모름'],
  ];
  /* ───────── 분석 단계 설계도 (칸 목록) ───────── */
  const T = (k, label, x) => ({ k, label, type: 'text', ...x });
  const A = (k, label, x) => ({ k, label, type: 'area', ...x });
  const C = (k, label, options, x) => ({ k, label, type: 'choice', options, ...x });
  const WHY = ['밝기', '채도', '크기', '대비', '방향선', '시선', '질감'];
  const ERASE = ['인물', '소품', '배경', '가장 큰 색', '질감', '구도'];
  const STEPS = [
    { id: 's1', title: '첫 반응', quick: true, noUnknown: true, fields: [
      { k: 'feel', label: '느낌 한 줄', type: 'feel' },
      { k: 'words', label: '떠오른 단어 3개', type: 'multi', n: 3, ph: '단어' },
      { k: 'score', label: '좋음 점수 (1~10)', type: 'scale' } ] },
    { id: 's2', title: '시선과 프레임', quick: true, fields: [
      { k: 'gaze', label: '눈이 간 순서와 이유', type: 'rows', quick: true, pins: true, rowLabels: ['①', '②', '③'],
        cols: [{ k: 'where', label: '눈이 간 곳', type: 'text' }, { k: 'why', label: '이유', type: 'choice', options: WHY }] },
      T('longest', '눈이 가장 오래 머문 곳', { quick: true }),
      { k: 'subjectPct', label: '주인공이 차지하는 비율 (약)', type: 'num', unit: '%' },
      { k: 'emptyPct', label: '빈 공간 비율 (약)', type: 'num', unit: '%' },
      C('camHeight', '카메라 높이', ['바닥', '허리', '눈높이', '위']),
      C('angle', '앵글', ['로우', '아이레벨', '하이']),
      C('lens', '화각 인상', ['광각', '중간', '망원']),
      C('comp', '구도', ['중앙', '3분할', '대칭', '대각선', '여백']),
      T('crop', '잘라낸 것(크롭)이 있다면 무엇을 뺐나', { opt: true }),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's3', title: '빛', fields: [
      { k: 'lights', label: '광원 개수', type: 'num', unit: '개' },
      { k: 'dir', label: '방향 (광원이 여러 개면 여러 개 골라요)', type: 'choices', options: ['정면', '앞사선', '측면', '뒤사선', '역광', '위', '아래'] },
      { k: 'side', label: '빛이 오는 쪽', type: 'choices', options: ['왼쪽', '가운데', '오른쪽'] },
      C('quality', '질감', ['부드러움', '딱딱함']),
      C('contrast', '명암 대비', ['큼', '작음']),
      T('shadow', '그림자 위치와 진하기'),
      T('brightest', '가장 밝은 곳'),
      T('darkest', '가장 어두운 곳'),
      T('mood', '빛이 만든 분위기'),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's4', title: '색', fields: [
      { k: 'colors', label: '색 비율', type: 'rows', rowLabels: ['지배색', '보조색', '포인트색'],
        cols: [{ k: 'name', label: '무슨 색', type: 'text' }, { k: 'pct', label: '비율', type: 'num', unit: '%' }] },
      C('temp', '색온도', ['따뜻', '차가움', '섞임']),
      C('sat', '채도', ['높음', '낮음']),
      T('repeat', '색이 반복되는 곳'),
      T('pop', '튀는 색 1개는 어디에 있나'),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's5', title: '질감과 재질', fields: [
      { k: 'materials', label: '화면의 재질 3가지', type: 'multi', n: 3, ph: '재질' },
      T('gloss', '번들거림 vs 무광 대비가 있나'),
      T('grain', '필름 그레인'),
      T('sharp', '선명도'),
      T('grade', '보정 방향'),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's6', title: '인물과 소품 연출', fields: [
      T('eyes', '시선 방향'),
      T('face', '표정'),
      T('pose', '손/자세가 말하는 것'),
      A('props', '소품 목록 (전부)'),
      T('era', '시대감을 만드는 것'),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's7', title: '일부러 틀린 것', interp: true, fields: [
      T('wrong', '"원래라면 안 그럴 텐데" 싶은 것 1개'),
      T('effect', '그게 만드는 효과'),
      C('wrongType', '틀린 것의 종류', ['구도', '빛', '색', '질감', '소품', '연출'], { opt: true }) ] },
    { id: 's8', title: '지우기 테스트', quick: true, noUnknown: true, fields: [
      { k: 'erase', label: '이 요소를 가리면 좋음이 얼마나 줄어드나', type: 'erase' } ] },
    { id: 's9', title: '비교', fields: [
      T('other', '비슷해 보이지만 끌리지 않았던 이미지'),
      T('diff', '둘의 차이 한 줄') ] },
    { id: 's10', title: '디렉터의 눈', interp: true, fields: [
      T('story', '한 줄 서사: 이 장면에서 벌어지는 일'),
      { k: 'decisions', label: '결정 3개', type: 'rows', rowLabels: ['결정 1', '결정 2', '결정 3'],
        cols: [{ k: 'what', label: '결정', type: 'text' }, { k: 'effect', label: '효과', type: 'text' }, { k: 'reject', label: '내가 기각할 대안과 이유', type: 'text' }] },
      { type: 'head', label: '영상 번역: 이 이미지를 샷 1개로 쓴다면' },
      T('shotStart', '시작 상태'),
      T('shotEnd', '끝 상태'),
      C('shotMove', '카메라 움직임', ['고정', '푸시인', '패닝', '핸드헬드']),
      T('shotCuts', '앞뒤 컷'),
      T('shotMusic', '어울리는 음악 (장르, 템포)') ] },
    { id: 's11', title: '정리', quick: true, fields: [
      { k: 'final', label: '최종 문장', type: 'final', quick: true },
      { type: 'head', label: '내 작업 레시피' },
      T('rCam', '카메라 높이'), T('rLight', '조명'), T('rBg', '배경'), T('rColor', '색 비율'),
      T('rProps', '소품 3개'), T('rAct', '인물 연출'), T('rWrong', '일부러 틀리게 할 것'),
      T('steal', '다음 촬영에서 훔칠 것 1가지', { quick: true }),
      { type: 'head', label: '확신도' },
      A('sure', '확실한 것 (눈으로 확인)'),
      A('guess', '추정인 것 (확인 불가)'),
      A('unsure', '모르겠는 것 (다음에 볼 것)') ] },
  ];
  const stepNo = (st) => STEPS.indexOf(st) + 1;
  const visibleSteps = (c) => c.mode === 'quick' ? STEPS.filter((s) => s.quick) : STEPS;
  const needsWhy = (f) => (f.type === 'choice' || f.type === 'choices') && !f.opt;
  const MODE_NAME = { quick: '빠른 버전', full: '전체 버전', deep: '깊게 파기' };
  function visibleFields(c, st) {
    if (c.mode !== 'deep') return visibleFieldsBase(c, st).filter((f) => !f.deep);
    return visibleFieldsBase(c, st);
  }
  function visibleFieldsBase(c, st) {
    if (c.mode === 'quick' && st.fields.some((f) => f.quick)) return st.fields.filter((f) => f.quick);
    return st.fields;
  }
  const fid = (st, f) => st.id + '.' + f.k;
  const isUnknown = (c, st, f) => c.unknown.includes(fid(st, f));
  function val(c, st, f) {
    const d = c.steps[st.id] || (c.steps[st.id] = {});
    if (f.type === 'choices' && !Array.isArray(d[f.k])) d[f.k] = has(d[f.k]) ? [d[f.k]] : [];
    if (d[f.k] === undefined) {
      if (f.type === 'multi') d[f.k] = Array(f.n).fill('');
      else if (f.type === 'rows') d[f.k] = f.rowLabels.map(() => Object.fromEntries(f.cols.map((col) => [col.k, ''])));
      else if (f.type === 'erase') d[f.k] = {};
      else if (f.type === 'scale') d[f.k] = null;
      else d[f.k] = '';
    }
    return d[f.k];
  }
  const has = (x) => x != null && String(x).trim() !== '';
  function filled(c, st, f) {
    const v = val(c, st, f);
    if (f.type === 'choices') return v.length > 0;
    if (f.type === 'multi') return v.every(has);
    if (f.type === 'rows') return v.every((r) => f.cols.every((col) => has(r[col.k]) || (f.pins && col.k === 'where' && r.x != null)));
    if (f.type === 'erase') return ERASE.every((n) => v[n] != null);
    return has(v);
  }
  function hasAny(c, st, f) {
    const v = val(c, st, f);
    if (f.type === 'choices') return v.length > 0;
    if (f.type === 'multi') return v.some(has);
    if (f.type === 'rows') return v.some((r) => r.x != null || f.cols.some((col) => has(r[col.k])));
    if (f.type === 'erase') return ERASE.some((n) => v[n] != null);
    return has(v);
  }
  const realFields = (c, st) => visibleFields(c, st).filter((f) => f.type !== 'head');
  const whyOk = (c, st, f) => c.mode !== 'deep' || st.id === 'video' || !needsWhy(f) || has((c.steps[st.id] || {})[f.k + 'Why']);
  const fieldOk = (c, st, f) => f.opt || isUnknown(c, st, f) || (filled(c, st, f) && whyOk(c, st, f));
  const stepDone = (c, st) => realFields(c, st).every((f) => fieldOk(c, st, f));
  const stepHasData = (c, st) => realFields(c, st).some((f) => hasAny(c, st, f));
  function progress(c) {
    const vs = visibleSteps(c);
    let n = 0;
    for (const st of vs) { if (stepDone(c, st)) n++; else break; }
    return { n, total: vs.length, done: n === vs.length };
  }
  function coreElements(c) {
    const v = (c.steps.s8 || {}).erase || {};
    const min = Math.min(0, ...ERASE.map((n) => v[n] ?? 0));
    return min < 0 ? ERASE.filter((n) => v[n] === min) : [];
  }
  function finalSentence(c) {
    const core = coreElements(c).join('·') || '[핵심 요소]';
    const feel = (c.steps.s1.feel || '').trim() || '[첫 반응 단어]';
    return `이 이미지가 좋은 이유는 ${core} 때문이고, 그게 ${feel}한 느낌을 만든다.`;
  }
  /* 한 장 보기에서 값을 글자로 바꾸기 */
  function fmt(c, st, f) {
    const v = val(c, st, f);
    const why = (c.steps[st.id] || {})[f.k + 'Why'];
    const because = has(why) ? `\n근거: ${String(why).trim()}` : '';
    if (f.type === 'choices') return v.length ? v.join(', ') + because : '';
    if (f.type === 'choice') return has(v) ? String(v).trim() + because : '';
    if (f.type === 'feel') return has(v) ? `이건 ${v}한 느낌` : '';
    if (f.type === 'choices') return v.join(', ');
    if (f.type === 'multi') return v.filter(has).join(' / ');
    if (f.type === 'scale') return v != null ? `${v}/10` : '';
    if (f.type === 'num') return has(v) ? `${v}${f.unit}` : '';
    if (f.type === 'erase') return ERASE.filter((n) => v[n] != null).map((n) => `${n} ${v[n]}`).join(', ');
    if (f.type === 'rows') return v.map((r, i) => {
      const parts = f.cols.filter((col) => has(r[col.k])).map((col) => r[col.k] + (col.unit || ''));
      if (f.pins && r.x != null && !has(r.where)) parts.unshift('이미지에 찍은 곳');
      return parts.length ? `${f.rowLabels[i]} ${parts.join(' — ')}` : '';
    }).filter(Boolean).join('\n');
    return has(v) ? String(v).trim() : '';
  }

  /* 뭉뚱그린 말 잡아내기 */
  const VAGUE = [
    [/예쁘|예쁜|예뻐|예쁨|이쁘|이쁜|이뻐/, '예쁘다'],
    [/멋있|멋지|멋진|멋져/, '멋있다'],
    [/감성/, '감성'],
    [/분위기\s*(가\s*)?있/, '분위기 있다'],
  ];
  function vagueIn(text) {
    return VAGUE.filter(([re]) => re.test(text)).map(([, name]) => name);
  }
  function watchVague(inputs, holder) {
    const nudge = h('div', { class: 'nudge', hidden: true });
    holder.append(nudge);
    const check = () => {
      const found = [...new Set(inputs.flatMap((i) => vagueIn(i.value)))];
      nudge.hidden = !found.length;
      nudge.textContent = found.length ? `"${found.join('", "')}" → 구체적으로 뭐가 어떻게?` : '';
    };
    inputs.forEach((i) => i.addEventListener('input', check));
    check();
  }

  /* ───────── 이미지 다루기 ───────── */
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
  function shrink(img, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  async function fileToImages(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImg(url);
      return { full: shrink(img, 1800, 0.88), thumb: shrink(img, 520, 0.8) };
    } finally { URL.revokeObjectURL(url); }
  }

  /* ───────── 화면 상태 ───────── */
  const app = document.getElementById('app');
  let cur = null;          // 지금 열려 있는 카드
  let curPersisted = false;
  let inEditor = false;    // 지금 화면이 카드 편집 화면인가
  let saveTimer = null;
  let savedLabel = null;

  async function saveNow() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!cur || !curPersisted) return;
    cur.updatedAt = Date.now();
    try {
      await store.put('cards', cur);
      if (savedLabel) savedLabel.textContent = `자동 저장됨 ${clock()}`;
    } catch (e) {
      if (savedLabel) savedLabel.textContent = '저장 실패';
      toast('저장하지 못했어요. 기기 저장 공간이 꽉 찼는지 확인해 주세요.');
    }
  }
  function touch() {
    if (!curPersisted) return;
    if (savedLabel) savedLabel.textContent = '저장 중…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) saveNow(); });
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); if (flushPage) flushPage(); });

  /* ───────── 목록 화면 ───────── */
  async function showList() {
    if (saveTimer) await saveNow();
    cur = null; savedLabel = null;
    const cards = (await store.all('cards')).sort((a, b) => b.createdAt - a.createdAt);
    const wrap = h('div', { class: 'wrap' });
    if (!storageOk) {
      wrap.append(h('div', { class: 'banner' },
        '이 브라우저에서는 기록을 저장할 수 없어요. 창을 닫으면 사라져요. (시크릿 창이면 일반 창에서 열어 주세요.)'));
    }
    wrap.append(topBar('list', cards.length ? `분해한 컷 ${cards.length}장` : '내가 먼저 쓰고, 앱은 돕기만 한다',
      h('button', { class: 'btn solid', id: 'new-card', onclick: () => { location.hash = 'new'; } }, '+ 새 카드')));

    if (new Date().getDay() === 0 && cards.length) {
      const wkNote = await store.get('meta', 'week-' + dstr(weekStart(new Date())));
      if (!wkNote || !has(wkNote.change)) wrap.append(h('div', { class: 'banner row' }, h('span', {}, '일요일이에요. 이번 주 회고를 쓸 때예요.'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = 'look'; } }, '회고 쓰러 가기')));
    }
    if (!cards.length) {
      wrap.append(h('div', { class: 'empty' },
        h('strong', {}, '아직 카드가 없어요'),
        h('p', {}, '끌리는 이미지 한 장을 올리고, 누구의 해석도 보기 전에 내 첫 반응부터 적어 보세요. 올린 이미지는 여기에 콘택트 시트처럼 쌓여요.'),
        h('button', { class: 'btn solid', onclick: () => { location.hash = 'new'; } }, '첫 카드 만들기')));
    } else {
      const sheet = h('div', { class: 'sheet' });
      const count = h('p', { class: 'note', hidden: true });
      const tagCount = new Map();
      for (const c of cards) for (const t of c.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
      const tagBox = h('div', { class: 'tags' });
      const search = h('input', { class: 'text', id: 'search', type: 'search', placeholder: '검색: 태그나 내가 쓴 단어 (예: 역광, #90s)', value: listQuery,
        'aria-label': '카드 검색', oninput: () => { listQuery = search.value; draw(); } });
      const terms = () => listQuery.toLowerCase().split(/\s+/).filter(Boolean);
      const videos = new Map();
      for (const c of cards) { const k = videoKey(c); if (k) { const v = videos.get(k) || { name: videoName(c), n: 0 }; v.n++; videos.set(k, v); } }
      if (listVideo && !videos.has(listVideo)) listVideo = '';
      const vidBox = h('div', { class: 'tags' });
      const vidRow = h('div', { class: 'field', hidden: true }, h('span', { class: 'label' }, '영상별 묶음 (누르면 그 영상의 컷만 타임코드 순으로)'), vidBox);
      function draw() {
        const ts = terms();
        const hit = (listVideo ? cards.filter((c) => videoKey(c) === listVideo).sort((a, b) => tcSec(a) - tcSec(b)) : cards).filter((c) => {
          const text = cardText(c);
          return ts.every((t) => t.startsWith('#') ? c.tags.some((x) => x.toLowerCase() === t.slice(1)) : text.includes(t));
        });
        sheet.replaceChildren(...hit.map(tile));
        count.hidden = !ts.length && !listVideo;
        vidBox.replaceChildren(...[...videos].map(([key, v]) => h('button', { class: 'btn small' + (listVideo === key ? ' on' : ''), type: 'button', 'aria-pressed': String(listVideo === key),
          onclick: () => { listVideo = listVideo === key ? '' : key; draw(); } }, `${v.name} `, h('span', { class: 'mono' }, `${v.n}컷`))));
        vidRow.hidden = !videos.size;
        count.textContent = hit.length ? `${hit.length}장 찾았어요.` : '맞는 카드가 없어요. 다른 단어로 찾아보세요.';
        tagBox.replaceChildren(...[...tagCount].sort((a, b) => b[1] - a[1]).map(([t, n]) => {
          const on = ts.includes('#' + t.toLowerCase());
          return h('button', { class: 'btn small' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on),
            onclick: () => {
              listQuery = on ? listQuery.split(/\s+/).filter((x) => x.toLowerCase() !== '#' + t.toLowerCase()).join(' ') : (listQuery + ' #' + t).trim();
              search.value = listQuery; draw();
            } }, `#${t} `, h('span', { class: 'mono' }, n));
        }));
      }
      draw();
      wrap.append(h('div', { class: 'searchbar' }, search, tagBox, vidRow, count), sheet);
    }
    app.replaceChildren(wrap);
    window.scrollTo(0, 0);
  }
  let listQuery = '';
  let listVideo = '';
  function cardText(c) {
    const out = [c.date, c.source.text, ...c.tags];
    (function walk(v) {
      if (typeof v === 'string') out.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    })(c.steps);
    return out.join(' ').toLowerCase();
  }
  function tile(c) {
    const pr = progress(c);
    const src = c.image.kind === 'url' ? c.image.url : c.thumb;
    const pic = src
      ? h('img', { class: 'pic', src, alt: '', loading: 'lazy',
          onerror: (e) => e.target.replaceWith(h('div', { class: 'nopic' }, '링크 이미지를 불러올 수 없어요')) })
      : h('div', { class: 'nopic' }, '이미지 없음');
    const feel = c.steps.s1.feel.trim();
    return h('button', { class: 'tile', onclick: () => { location.hash = 'card-' + c.id; } },
      pic,
      h('div', { class: 'meta mono' },
        h('span', {}, c.type === 'video' ? `No.${pad(c.no, 3)} · 영상 ${(c.steps.video || {}).tc || ''}` : `No.${pad(c.no, 3)} · ${c.date}`),
        h('span', {}, c.steps.s1.score != null ? `${c.steps.s1.score}/10` : '')),
      h('div', { class: 'feel' }, feel ? `${feel}한 느낌` : '첫 반응을 아직 안 썼어요'),
      dueAgain(c) ? h('div', { class: 'due' }, '다시 볼 때가 됐어요') : null,
      h('div', { class: 'meta' },
        h('span', {}, c.tags.map((t) => '#' + t).join(' ')),
        h('span', { class: 'chip-state' + (pr.done ? ' done' : '') },
          (c.mode === 'quick' ? '5분 · ' : c.mode === 'deep' ? '깊게 · ' : '') + (pr.done ? '완료' : `${pr.n}/${pr.total}단계`))));
  }

  /* ───────── 카드 화면 ───────── */
  async function showCard(id) {
    if (saveTimer) await saveNow();
    if (id) {
      const found = await store.get('cards', id);
      if (!found) { toast('그 카드를 찾을 수 없어요.'); location.hash = 'list'; return; }
      cur = found; curPersisted = true;
    } else {
      const all = await store.all('cards');
      cur = newCard(all.reduce((m, c) => Math.max(m, c.no || 0), 0) + 1, nextCut ? 'video' : 'still');
      if (nextCut) {
        cur.steps.video = { title: nextCut.title, url: nextCut.url };
        cur.tags = [...nextCut.tags]; cur.source = { ...nextCut.source }; cur.trust = nextCut.trust;
        nextCut = null;
      }
      curPersisted = false;
    }
    await renderCard();
    window.scrollTo(0, 0);
  }

  async function setImage(image, thumb, full) {
    const c = cur;
    c.image = image; c.thumb = thumb || '';
    try {
      if (full) await store.put('images', { id: c.id, data: full });
      else await store.del('images', c.id);
      await store.put('cards', c);
    } catch (e) {
      toast('이미지를 저장하지 못했어요. 기기 저장 공간을 확인해 주세요.');
      return;
    }
    const first = !curPersisted;
    curPersisted = true;
    if (first) { try { navigator.storage.persist(); } catch (e) { /* 지원 안 함 */ } }
    if (first) history.replaceState(null, '', '#card-' + c.id);
    await renderCard();
  }
  async function takeFile(file) {
    if (!file || !file.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.'); return; }
    try {
      const { full, thumb } = await fileToImages(file);
      await setImage({ kind: 'file' }, thumb, full);
    } catch (e) {
      toast('이 파일은 사진으로 읽을 수 없어요. 스크린샷(PNG/JPG)으로 다시 시도해 주세요.');
    }
  }
  function takeLink(raw) {
    const url = raw.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { toast('http 로 시작하는 이미지 주소를 넣어 주세요.'); return; }
    setImage({ kind: 'url', url }, '', null);
  }
  document.addEventListener('paste', (e) => {
    const target = cur && cur.image.kind === 'none' ? takeFile : (!cur && diaryPaste) || null;
    if (!target) return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); target(file); }
  });

  function picker(labelText, cls) {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true,
      onchange: () => { takeFile(input.files[0]); input.value = ''; } });
    return h('span', {}, input, h('button', { class: cls, type: 'button', onclick: () => input.click() }, labelText));
  }

  async function renderCard() {
    const c = cur;
    inEditor = true;
    const wrap = h('div', { class: 'wrap' });
    savedLabel = h('span', { class: 'saved mono' }, curPersisted ? '자동 저장됨' : '이미지를 올리면 저장이 시작돼요');
    wrap.append(h('div', { class: 'bar' },
      h('div', { class: 'row' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'list'; } }, '← 목록'),
        curPersisted ? h('button', { class: 'btn quiet', id: 'to-view', onclick: () => { location.hash = 'view-' + c.id; } }, '한 장으로 보기') : null),
      h('div', { class: 'slate mono' }, h('strong', {}, `No.${pad(c.no, 3)}`), h('span', {}, typeName(c)), savedLabel)));

    /* 왼쪽: 이미지 */
    const stage = h('div', { class: 'stage' });
    if (c.image.kind === 'none') {
      const link = h('input', { class: 'text', id: 'img-link', type: 'url', placeholder: '이미지 주소 붙여넣기 (https://…)',
        onkeydown: (e) => { if (e.key === 'Enter') takeLink(link.value); } });
      const drop = h('div', { class: 'drop' },
        h('div', { class: 'seg', role: 'group', 'aria-label': '카드 종류' },
          h('button', { class: 'btn small' + (c.type !== 'video' ? ' on' : ''), type: 'button', id: 'type-still', onclick: () => { c.type = 'still'; renderCard(); } }, '스틸'),
          h('button', { class: 'btn small' + (c.type === 'video' ? ' on' : ''), type: 'button', id: 'type-video', onclick: () => { c.type = 'video'; renderCard(); } }, '영상 (뮤비 한 컷)')),
        h('p', { class: 'big' }, c.type === 'video' ? '분석할 컷의 스크린샷 한 장' : '분석할 이미지 한 장'),
        picker('사진 고르기', 'btn solid'),
        h('p', {}, '여기로 끌어다 놓거나, 스크린샷을 복사한 뒤 붙여넣기(Ctrl+V / ⌘V) 해도 돼요.'),
        h('div', { class: 'linkrow' }, link,
          h('button', { class: 'btn', type: 'button', onclick: () => takeLink(link.value) }, '링크로 추가')),
        h('p', {}, '링크는 원본 사이트가 지우면 같이 사라져요. 오래 둘 이미지는 스크린샷이 안전해요.'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
      stage.append(drop);
    } else {
      const frame = h('div', { class: 'frame' });
      const failBox = () => h('div', { class: 'linkfail' },
        h('p', {}, '이 링크의 이미지를 여기서 보여줄 수 없어요.'),
        c.image.url ? h('p', {}, h('a', { href: c.image.url, target: '_blank', rel: 'noopener' }, '원본 링크 열기')) : null,
        h('p', {}, '스크린샷으로 바꿔 올리면 항상 보여요.'));
      let src = '';
      if (c.image.kind === 'file') src = (await store.get('images', c.id))?.data || c.thumb;
      else src = c.image.url;
      frame.append(src ? h('img', { src, alt: '분석할 이미지', onerror: () => frame.replaceChildren(failBox()) }) : failBox());
      stage.append(frame, h('div', { class: 'under' },
        h('span', { class: 'label mono' }, c.image.kind === 'url' ? '링크 이미지' : '내 기기에 저장된 이미지'),
        picker('이미지 바꾸기', 'btn quiet small')));
    }

    const body = h('div', { class: 'editor' }, stage);
    if (c.image.kind !== 'none') body.append(buildForm(c, {
      mySeries: (await store.all('series')).filter((x) => x.cardIds.includes(c.id)),
      siblings: videoKey(c) ? (await store.all('cards')).filter((x) => x.id !== c.id && videoKey(x) === videoKey(c)).sort((a, b) => tcSec(a) - tcSec(b)) : [],
      hasShots: !!(await store.get('shotlists', c.id)),
      origSrc: await cardImage(c),
      reImg: c.reshoot && c.reshoot.has ? ((await store.get('images', c.id + '-re')) || {}).data || '' : '',
    }));
    wrap.append(body);
    app.replaceChildren(wrap);
  }

  function grow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }

  /* 칸 하나 그리기 */
  function buildField(c, st, f, changed, ctx) {
    ctx = ctx || {};
    if (f.type === 'head') return h('h3', { class: 'subhead' }, f.label);
    const id = fid(st, f);
    const data = c.steps[st.id] || (c.steps[st.id] = {});
    val(c, st, f);
    const texts = [];
    const dom = 'f-' + id.replace('.', '-');
    const textInput = (get, set, extra) => {
      const inp = h('input', { class: 'text', value: get() ?? '', oninput: () => { set(inp.value); changed(); }, ...extra });
      texts.push(inp);
      return inp;
    };
    const numInput = (get, set, unit, extra) => {
      const inp = h('input', { class: 'text mono num', type: 'number', inputMode: 'numeric', min: 0, max: unit === '%' ? 100 : 99,
        value: get() ?? '', oninput: () => { set(inp.value); changed(); }, ...extra });
      return h('span', { class: 'numwrap' }, inp, h('span', { class: 'label' }, unit));
    };
    const choice = (options, get, set, label) => {
      const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const draw = () => box.replaceChildren(...options.map((o) =>
        h('button', { class: 'btn small' + (get() === o ? ' on' : ''), type: 'button', 'aria-pressed': String(get() === o),
          onclick: () => { set(get() === o ? '' : o); draw(); changed(); } }, o)));
      draw();
      return box;
    };

    let control;
    let extra = null;
    if (f.type === 'feel') {
      control = h('div', { class: 'feelline' }, h('span', {}, '이건'),
        textInput(() => data.feel, (v) => { data.feel = v; }, { id: dom, placeholder: '여기에', maxLength: 60 }), h('span', {}, '한 느낌'));
    } else if (f.type === 'text') {
      control = textInput(() => data[f.k], (v) => { data[f.k] = v; }, { id: dom });
    } else if (f.type === 'area' || f.type === 'final') {
      const ta = h('textarea', { class: 'text area', id: dom, rows: 2, value: data[f.k],
        oninput: () => { data[f.k] = ta.value; changed(); } });
      if (f.type === 'final') {
        if (!has(data.final)) { data.final = finalSentence(c); ta.value = data.final; }
        extra = h('div', { class: 'row' },
          h('span', { class: 'note' }, '핵심 요소와 첫 반응 단어를 미리 넣어 뒀어요. 마음대로 고쳐요.'),
          h('button', { class: 'btn small quiet', type: 'button',
            onclick: () => { data.final = finalSentence(c); ta.value = data.final; ta.dispatchEvent(new Event('input')); } }, '자동 문장 다시 넣기'));
      }
      texts.push(ta); grow(ta);
      control = ta;
    } else if (f.type === 'num') {
      control = numInput(() => data[f.k], (v) => { data[f.k] = v; }, f.unit, { id: dom });
    } else if (f.type === 'choices') {
      const box = h('div', { class: 'seg', role: 'group', 'aria-label': f.label });
      const draw = () => box.replaceChildren(...f.options.map((o) => {
        const on = data[f.k].includes(o);
        return h('button', { class: 'btn small' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on),
          onclick: () => { data[f.k] = on ? data[f.k].filter((x) => x !== o) : f.options.filter((x) => x === o || data[f.k].includes(x)); draw(); changed(); } }, o);
      }));
      draw();
      control = box;
    } else if (f.type === 'choice') {
      control = choice(f.options, () => data[f.k], (v) => { data[f.k] = v; }, f.label);
    } else if (f.type === 'multi') {
      control = h('div', { class: 'words' }, data[f.k].map((_, i) =>
        textInput(() => data[f.k][i], (v) => { data[f.k][i] = v; },
          { id: `${dom}-${i + 1}`, placeholder: `${f.ph} ${i + 1}`, 'aria-label': `${f.label} ${i + 1}`, maxLength: 30 })));
    } else if (f.type === 'scale') {
      const box = h('div', { class: 'score', role: 'group', 'aria-label': f.label });
      const draw = () => box.replaceChildren(...Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
        h('button', { class: 'btn' + (data[f.k] === n ? ' on' : ''), type: 'button', 'aria-pressed': String(data[f.k] === n),
          onclick: () => { data[f.k] = data[f.k] === n ? null : n; draw(); changed(); } }, n)));
      draw();
      control = box;
    } else if (f.type === 'rows') {
      const rowsData = data[f.k];
      const usePins = !!(f.pins && ctx.origSrc);
      let active = Math.max(0, rowsData.findIndex((r) => r.x == null));
      let drawPins = () => {};
      const labels = [];
      const rowsEl = h('div', { class: 'rows' }, rowsData.map((row, i) => {
        const lab = usePins
          ? h('button', { class: 'rowlabel pinbtn mono', type: 'button', 'aria-label': `${i + 1}번 핀 찍기`, onclick: () => { active = i; drawPins(); } }, f.rowLabels[i])
          : h('span', { class: 'rowlabel mono' }, f.rowLabels[i]);
        labels.push(lab);
        return h('div', { class: 'rowitem' }, lab,
          h('div', { class: 'rowcells' + (f.cols.some((col) => col.type === 'num') ? ' inline' : '') + (f.cols.some((col) => col.type === 'choice') ? ' joined' : '') }, f.cols.map((col) => {
            const al = `${f.rowLabels[i]} ${col.label}`;
            if (col.type === 'choice') {
              const bar = choice(col.options, () => row[col.k], (v) => { row[col.k] = v; }, al);
              bar.classList.add('segbar');
              bar.style.setProperty('--n', col.options.length);
              return bar;
            }
            if (col.type === 'num') return numInput(() => row[col.k], (v) => { row[col.k] = v; }, col.unit, { 'aria-label': al });
            return textInput(() => row[col.k], (v) => { row[col.k] = v; },
              { placeholder: usePins && col.k === 'where' ? '눈이 간 곳 (핀을 찍었으면 안 써도 돼요)' : col.label, 'aria-label': al, id: `${dom}-${i + 1}-${col.k}` });
          })));
      }));
      if (usePins) {
        const layer = h('div', { class: 'pinlayer' });
        const img = h('img', { src: ctx.origSrc, alt: '시선 지도: 눌러서 핀 찍기', draggable: false });
        const map = h('div', { class: 'gazemap', id: dom + '-map' }, img, layer);
        const hint = h('p', { class: 'note' });
        const clear = h('button', { class: 'btn small quiet', type: 'button', onclick: () => {
          rowsData.forEach((r) => { delete r.x; delete r.y; }); active = 0; drawPins(); changed();
        } }, '핀 모두 지우기');
        img.onerror = () => { map.remove(); hint.remove(); clear.remove(); };
        map.addEventListener('click', (e) => {
          if (set.disabled) return;
          const r = img.getBoundingClientRect();
          const clamp = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
          rowsData[active].x = clamp((e.clientX - r.left) / r.width);
          rowsData[active].y = clamp((e.clientY - r.top) / r.height);
          const next = rowsData.findIndex((q) => q.x == null);
          if (next >= 0) active = next;
          drawPins(); changed();
        });
        drawPins = () => {
          layer.replaceChildren(...pinLayerContent(rowsData, active));
          labels.forEach((l, i) => { l.classList.toggle('on', i === active); l.classList.toggle('pinned', rowsData[i].x != null); });
          const left = rowsData.filter((q) => q.x == null).length;
          hint.textContent = left
            ? `이미지에서 ${f.rowLabels[active]}번째로 눈이 간 곳을 눌러요. 누른 순서대로 핀이 꽂혀요.`
            : `핀을 다 찍었어요. 고치려면 아래 번호(①②③)를 누른 뒤 이미지를 다시 눌러요.`;
          clear.hidden = left === rowsData.length;
        };
        drawPins();
        control = h('div', { class: 'stepbody tight' }, map, h('div', { class: 'fieldtop' }, hint, clear), rowsEl);
      } else {
        control = rowsEl;
      }
    } else if (f.type === 'erase') {
      const core = h('div', { class: 'core', hidden: true });
      const drawCore = () => {
        const els = coreElements(c);
        const all = ERASE.every((n) => data.erase[n] != null);
        core.hidden = !all;
        core.replaceChildren(...(els.length
          ? [h('span', { class: 'label' }, '이 이미지의 핵심 요소'), h('strong', {}, els.join(' · '))]
          : [h('span', {}, '가려도 줄어드는 게 없다고 표시했어요. 정말 그런지 하나씩 손으로 가려 보세요.')]));
      };
      control = h('div', { class: 'rows' }, ERASE.map((name) => {
        const box = h('div', { class: 'seg', role: 'group', 'aria-label': name });
        const draw = () => box.replaceChildren(...[0, -1, -2, -3].map((n) =>
          h('button', { class: 'btn small mono' + (data.erase[name] === n ? ' on' : ''), type: 'button', 'aria-pressed': String(data.erase[name] === n),
            onclick: () => { if (data.erase[name] === n) delete data.erase[name]; else data.erase[name] = n; draw(); drawCore(); changed(); } }, n)));
        draw();
        return h('div', { class: 'eraserow' }, h('span', {}, name), box);
      }));
      extra = core;
      drawCore();
    }

    const deep = c.mode === 'deep' && st.id !== 'video';
    let whyBox = null;
    if (deep && needsWhy(f)) {
      const ta = h('textarea', { class: 'text area why', id: dom + '-why', rows: 1, placeholder: '근거: 화면의 어디를 보고 그렇게 판단했나', value: data[f.k + 'Why'] || '',
        'aria-label': `${f.label} 근거`, oninput: () => { data[f.k + 'Why'] = ta.value; changed(); } });
      grow(ta); texts.push(ta);
      whyBox = ta;
    }
    const set = h('fieldset', { class: 'ctl', disabled: isUnknown(c, st, f) }, control, whyBox);
    const holder = h('div', { class: 'field' + (isUnknown(c, st, f) ? ' unk' : ''), id: 'fld-' + id.replace('.', '-') });
    const top = h('div', { class: 'fieldtop' },
      h('label', { class: 'label', for: dom }, f.label + (f.opt ? ' · 없으면 비워 둬요' : '')));
    if (!st.noUnknown && !f.opt) {
      const btn = h('button', { class: 'btn small quiet unkbtn' + (isUnknown(c, st, f) ? ' on' : ''), type: 'button',
        'aria-pressed': String(isUnknown(c, st, f)),
        onclick: () => {
          const on = !isUnknown(c, st, f);
          c.unknown = c.unknown.filter((x) => x !== id);
          if (on) c.unknown.push(id);
          set.disabled = on;
          holder.classList.toggle('unk', on);
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', String(on));
          changed();
        } }, '모르겠음');
      top.append(btn);
    }
    holder.append(top, set);
    if (f.type === 'feel') {
      const help = h('div', { class: 'stuck', hidden: true },
        h('p', {}, '느낌을 한 번에 꺼내려 하지 말고, 하나만 골라 답해 봐요.'),
        h('ul', {}, ['온도는? 만지면 어떨 것 같나', '무게는? 가라앉나, 떠 있나', '속도는? 멈춰 있나, 움직이나', '소리는? 조용한가, 시끄러운가', '촉감은? 손끝에 뭐가 닿나', '거리는? 가까운가, 먼가',
          '이 이미지에 깔릴 곡은 어떤 소리인가'].map((q) => h('li', {}, q))),
        h('p', {}, '틀려도 돼요. 아무 단어나 먼저 쓰고, 그다음에 고쳐요.'));
      const btn = h('button', { class: 'btn small quiet', type: 'button', id: dom + '-stuck', 'aria-expanded': 'false',
        onclick: () => { help.hidden = !help.hidden; btn.setAttribute('aria-expanded', String(!help.hidden)); } }, '막혔어요');
      top.append(btn);
      holder.append(help);
    }
    if (extra) holder.append(extra);
    if (texts.length) watchVague(texts, holder);
    if (deep && (f.type === 'text' || f.type === 'area') && !f.opt) {
      const more = h('div', { class: 'nudge', hidden: true }, '조금 더: 어디가, 어떻게, 그래서 어떤 효과인지까지 한 문장으로.');
      holder.append(more);
      const check = () => { const n = texts[0].value.trim().length; more.hidden = !(n > 0 && n < 10); };
      texts[0].addEventListener('input', check); check();
    }
    return holder;
  }

  function buildForm(c, ctx) {
    const { mySeries = [], pass2 = null, origSrc = '', reImg = '', siblings = [], hasShots = false } = ctx || {};
    const form = h('div', { class: 'form' });
    let refresh = () => {};
    const changed = () => { refresh(); touch(); };

    /* ── 기본 정보 ── */
    const date = h('input', { class: 'text mono', id: 'f-date', type: 'date', value: c.date,
      onchange: () => { c.date = date.value || today(); touch(); } });

    const tagBox = h('div', { class: 'tags' });
    const tagInput = h('input', { class: 'text', id: 'f-tag', placeholder: '태그 쓰고 Enter (예: 역광, 90s)', enterKeyHint: 'done' });
    function drawTags() {
      tagBox.replaceChildren(...c.tags.map((t, i) => h('span', { class: 'tag' }, '#' + t,
        h('button', { type: 'button', 'aria-label': `${t} 태그 지우기`, onclick: () => { c.tags.splice(i, 1); drawTags(); touch(); } }, '×'))));
    }
    function addTag() {
      const parts = tagInput.value.split(/[,#\s]+/).map((t) => t.trim()).filter(Boolean);
      for (const t of parts) if (!c.tags.includes(t)) c.tags.push(t);
      tagInput.value = '';
      if (parts.length) { drawTags(); touch(); }
    }
    tagInput.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
    });
    tagInput.addEventListener('blur', addTag);
    drawTags();

    const src = h('input', { class: 'text', id: 'f-source', placeholder: '감독, 포토그래퍼, 매체, 캠페인 이름 등',
      value: c.source.text, disabled: c.source.unknown,
      oninput: () => { c.source.text = src.value; touch(); } });
    const srcUnknown = h('button', { class: 'btn small' + (c.source.unknown ? ' on' : ''), type: 'button', 'aria-pressed': String(c.source.unknown),
      onclick: () => {
        c.source.unknown = !c.source.unknown;
        src.disabled = c.source.unknown;
        srcUnknown.classList.toggle('on', c.source.unknown);
        srcUnknown.setAttribute('aria-pressed', String(c.source.unknown));
        if (c.source.unknown) { c.trust = 'unknown'; drawTrust(); }
        changed();
      } }, '모름');

    const trustBox = h('div', { class: 'seg', role: 'group', 'aria-label': '출처 신뢰도' });
    const trustNote = h('p', { class: 'note' }, '출처를 모르는 이미지예요. 해석 단계(7, 10단계)에서는 "추정"으로 구분해서 적어요.');
    function drawTrust() {
      trustBox.replaceChildren(...TRUST.map(([key, name]) =>
        h('button', { class: 'btn small' + (c.trust === key ? ' on' : ''), type: 'button', 'aria-pressed': String(c.trust === key),
          onclick: () => { c.trust = c.trust === key ? '' : key; drawTrust(); changed(); } }, name)));
      trustNote.hidden = c.trust !== 'unknown';
    }
    drawTrust();

    if (!pass2) form.append(h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '기본 정보')),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-date' }, '날짜'), date),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-tag' }, '태그'), tagBox, tagInput),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-source' }, '출처 / 크레딧'), h('div', { class: 'row' }, src, srcUnknown)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '출처 신뢰도'), trustBox, trustNote),
      mySeries.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, '들어 있는 시리즈'),
        h('div', { class: 'seg' }, mySeries.map((x) =>
          h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = 'series-' + x.id; } }, x.name)))) : null));

    /* ── 쓰는 방식: 전체 / 빠른 버전 ── */
    const setMode = async (m) => { if (c.mode === m) return; c.mode = m; try { localStorage.setItem('eye-mode', m); } catch (e) { /* 기억 못 해도 진행 */ } await saveNow(); await renderCard(); };
    /* ── 영상 정보 (영상 카드만) ── */
    if (!pass2 && c.type === 'video') {
      const vd = c.steps.video || (c.steps.video = {});
      const open = h('div', { class: 'seg' });
      const drawOpen = () => open.replaceChildren(
        /^https?:\/\//i.test((vd.url || '').trim()) ? h('a', { class: 'btn small', href: vd.url.trim(), target: '_blank', rel: 'noopener' }, '영상 열기') : null,
        h('button', { class: 'btn small', type: 'button', id: 'next-cut', onclick: async () => {
          await saveNow();
          nextCut = { title: vd.title || '', url: vd.url || '', tags: c.tags, source: c.source, trust: c.trust };
          location.hash = 'new';
        } }, '이 영상에서 다음 컷 분석하기'));
      drawOpen();
      const vChanged = () => { drawOpen(); touch(); };
      form.append(h('section', { class: 'sec', id: 'video-info' },
        h('header', {}, h('h2', {}, '영상 정보')),
        VIDEO_STEP.fields.map((f) => buildField(c, VIDEO_STEP, f, vChanged)),
        open,
        siblings.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, `같은 영상의 다른 컷 ${siblings.length}개 (타임코드 순)`),
          h('div', { class: 'cutstrip' }, siblings.map((x) => h('button', { class: 'cutmini', type: 'button', onclick: () => { location.hash = 'card-' + x.id; } },
            cardSrc(x) ? h('img', { src: cardSrc(x), alt: '', loading: 'lazy' }) : null,
            h('span', { class: 'mono' }, (x.steps.video || {}).tc || `No.${pad(x.no, 3)}`))))) : null));
    }
    if (!pass2) form.append(h('div', { class: 'field' },
      h('span', { class: 'label' }, '쓰는 방식'),
      h('div', { class: 'seg', role: 'group', 'aria-label': '쓰는 방식' },
        h('button', { class: 'btn small' + (c.mode === 'quick' ? ' on' : ''), type: 'button', id: 'mode-quick', onclick: () => setMode('quick') }, '빠른 버전 (5분)'),
        h('button', { class: 'btn small' + (c.mode !== 'quick' && c.mode !== 'deep' ? ' on' : ''), type: 'button', id: 'mode-full', onclick: () => setMode('full') }, '전체 버전 (11단계)'),
        h('button', { class: 'btn small' + (c.mode === 'deep' ? ' on' : ''), type: 'button', id: 'mode-deep', onclick: () => setMode('deep') }, '깊게 파기 (근거까지)')),
      c.mode === 'deep'
        ? h('p', { class: 'note' }, '버튼을 고를 때마다 "왜 그렇게 봤는지" 근거를 한 줄 쓰고, 단계마다 한 줄 결론을 내려요. 오래 걸리지만 눈이 가장 많이 늘어요.')
        : null,
      c.mode === 'quick'
        ? h('p', { class: 'note' }, '첫 반응 → 시선 지도 → 지우기 테스트 → 정리만 써요. 나중에 전체 버전으로 이어 쓸 수 있고, 쓴 내용은 그대로 남아요.')
        : null));

    /* ── 분석 단계들 ── */
    const steps = visibleSteps(c);
    const open = new Set([(steps.find((st) => !stepDone(c, st)) || steps[0]).id]);
    const ui = steps.map((st) => {
      const badge = h('span', { class: 'chip-state' });
      const body = h('div', { class: 'stepbody', hidden: true });
      const lockNote = h('p', { class: 'note', hidden: true });
      const u = { st, badge, body, lockNote, built: false, wasLocked: null, locked: false };
      const toggle = h('button', { class: 'steptoggle', type: 'button', 'aria-expanded': 'false',
        onclick: () => { if (u.locked) return; if (open.has(st.id)) open.delete(st.id); else open.add(st.id); refresh(); } },
        h('h2', {}, h('span', { class: 'mono stepno' }, pad(stepNo(st))), st.title));
      u.toggle = toggle;
      u.sec = h('section', { class: 'sec step', id: 'step-' + st.id }, h('header', {}, toggle, badge), lockNote, body);
      form.append(u.sec);
      return u;
    });
    function buildBody(u) {
      if (u.st.interp) {
        u.estimate = h('div', { class: 'nudge' }, '출처를 모르는 이미지예요. 감독의 의도는 "추정"이라고 구분해서 쓰세요.');
        u.body.append(u.estimate);
      }
      for (const f of visibleFields(c, u.st)) u.body.append(buildField(c, u.st, f, changed, { origSrc }));
      u.built = true;
    }

    /* ── 모르겠음 모음 ── */
    const unkList = h('ul', { class: 'unklist' });
    const unkSec = h('section', { class: 'sec', hidden: true },
      h('header', {}, h('h2', {}, '모르겠음으로 남긴 칸')),
      h('p', { class: 'note' }, '다음에 다시 볼 때 여기부터 채워 보세요. 누르면 그 칸으로 가요.'), unkList);
    const finish = h('div', { class: 'finish', hidden: true });
    /* ── 정답 확인: 11단계를 다 쓴 뒤에만 열린다 ── */
    const rv = c.review || (c.review = { ai: '', missed: '', disagree: '' });
    const rvBadge = h('span', { class: 'chip-state' });
    const rvNote = h('p', { class: 'note' }, '전체 버전 11단계를 다 쓰면 열려요. 내 눈으로 먼저 본 다음에만 남의 분석을 봐요.');
    const rvArea = (k, label, ph) => {
      const ta = h('textarea', { class: 'text area', id: 'rv-' + k, rows: 2, placeholder: ph, value: rv[k] || '', oninput: () => { rv[k] = ta.value; touch(); } });
      grow(ta);
      return h('div', { class: 'field' }, h('label', { class: 'label', for: 'rv-' + k }, label), ta);
    };
    const rvBody = h('div', { class: 'stepbody', hidden: true },
      h('ol', { class: 'howto' },
        h('li', {}, '아래 버튼으로 "내 분석 + 질문"을 복사해요.'),
        h('li', {}, 'Claude 앱에서 새 대화를 열고 붙여 넣어요. 이 이미지도 같이 올려요.'),
        h('li', {}, '돌아와서, AI의 답과 내 생각을 아래에 적어요.')),
      h('div', {}, h('button', { class: 'btn solid', type: 'button', id: 'rv-copy',
        onclick: () => copyText(reviewPrompt(c), '복사했어요. Claude 새 대화에 붙여 넣고, 이미지도 같이 올려 주세요.') }, '내 분석 + 질문 복사하기')),
      rvArea('ai', 'AI의 답 (붙여넣기, 보관용)', 'AI가 한 말을 그대로 붙여 넣어요'),
      rvArea('missed', 'AI는 봤는데 나는 못 본 것', '다음 카드에서 먼저 볼 것'),
      rvArea('disagree', 'AI가 틀렸다고 생각하는 것', 'AI의 말도 정답이 아니라 하나의 의견이에요'));
    const rvSec = h('section', { class: 'sec step', id: 'review' }, h('header', {}, h('h2', {}, '정답 확인'), rvBadge), rvNote, rvBody);
    /* ── 3일 뒤 다시 쓰기 ── */
    const agBadge = h('span', { class: 'chip-state' });
    const agBody = h('div', { class: 'stepbody' });
    const agSec = h('section', { class: 'sec step', id: 'again' }, h('header', {}, h('h2', {}, '3일 뒤 다시 쓰기'), agBadge), agBody);
    function drawAgain(done) {
      agSec.classList.toggle('locked', !done);
      if (!done) { agBadge.textContent = '잠김'; agBody.replaceChildren(h('p', { class: 'note' }, '이 카드를 다 쓰면 열려요. 3일 뒤에 같은 칸을 새 눈으로 다시 채우고, 1차와 나란히 봐요.')); return; }
      if (c.second) {
        agBadge.textContent = '2차 있음';
        agBody.replaceChildren(h('div', { class: 'seg' },
          h('button', { class: 'btn solid', type: 'button', id: 'go-compare', onclick: () => { location.hash = 'compare-' + c.id; } }, '1차와 2차 나란히 보기'),
          h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = 'again-' + c.id; } }, '2차 이어 쓰기')));
        return;
      }
      const left = Math.ceil((doneTime(c) + 3 * DAY - Date.now()) / DAY);
      const ready = left <= 0;
      agBadge.textContent = ready ? '다시 볼 때' : `${left}일 남음`;
      agBody.replaceChildren(
        h('p', { class: 'note' }, ready
          ? '다 쓴 지 3일이 지났어요. 1차 답은 가려 두고, 같은 칸을 처음부터 다시 써요.'
          : `다 쓴 기억이 흐려져야 새로 보여요. ${left}일 뒤에 다시 쓰는 걸 추천해요.`),
        h('div', { class: 'seg' },
          h('button', { class: 'btn' + (ready ? ' solid' : ''), type: 'button', id: 'go-again', onclick: () => { location.hash = 'again-' + c.id; } },
            ready ? '3일 뒤 다시 쓰기 시작' : '기다리지 않고 지금 쓰기')));
    }

    /* ── 재현 촬영 기록 ── */
    const rs = c.reshoot || { has: false, diffs: ['', '', ''], missed: '' };
    if (!pass2 && !c.reshoot) c.reshoot = rs;
    const rsBody = h('div', { class: 'stepbody' });
    const rsBadge = h('span', { class: 'chip-state' });
    function drawReshoot(img) {
      rsBadge.textContent = rs.has ? '기록 있음' : '아직 없음';
      rsBadge.classList.toggle('done', rs.has);
      const input = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'reshoot-file', onchange: async () => {
        const f = input.files[0]; input.value = '';
        if (!f || !f.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.'); return; }
        const url = URL.createObjectURL(f);
        try {
          const data = shrink(await loadImg(url), 1800, 0.88);
          await store.put('images', { id: c.id + '-re', data });
          rs.has = true; touch(); drawReshoot(data);
        } catch (e) { toast('이 파일은 사진으로 읽을 수 없어요.'); }
        finally { URL.revokeObjectURL(url); }
      } });
      if (!rs.has) {
        rsBody.replaceChildren(input,
          h('p', { class: 'note' }, '이 이미지를 내 손으로 다시 찍어 봐요. 찍은 사진을 올리면 원본 옆에 나란히 놓여요. 따라 찍어 봐야 보이는 게 있어요.'),
          h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => input.click() }, '재현 사진 올리기')));
        return;
      }
      const diffs = h('div', { class: 'rows' }, rs.diffs.map((_, i) => {
        const inp = h('input', { class: 'text', id: `rs-diff-${i + 1}`, placeholder: `다른 점 ${i + 1}`, value: rs.diffs[i], 'aria-label': `원본과 다른 점 ${i + 1}`,
          oninput: () => { rs.diffs[i] = inp.value; touch(); } });
        return inp;
      }));
      const missed = h('input', { class: 'text', id: 'rs-missed', value: rs.missed, placeholder: '찍어 보고서야 알게 된 것',
        oninput: () => { rs.missed = missed.value; touch(); } });
      const holder = h('div', { class: 'field' }, h('span', { class: 'label' }, '원본과 다른 점 3개'), diffs);
      watchVague([...diffs.querySelectorAll('input')], holder);
      rsBody.replaceChildren(input,
        h('div', { class: 'pair' },
          h('figure', {}, origSrc ? h('img', { src: origSrc, alt: '원본' }) : null, h('figcaption', { class: 'mono label' }, '원본')),
          h('figure', {}, img ? h('img', { src: img, alt: '재현 사진' }) : null, h('figcaption', { class: 'mono label' }, '재현'))),
        holder,
        h('div', { class: 'field' }, h('label', { class: 'label', for: 'rs-missed' }, '내가 못 봤던 것 1개'), missed),
        h('div', {}, h('button', { class: 'btn small quiet', type: 'button', onclick: () => input.click() }, '재현 사진 바꾸기')));
    }
    const rsSec = h('section', { class: 'sec step', id: 'reshoot' }, h('header', {}, h('h2', {}, '재현 촬영 기록'), rsBadge), rsBody);
    if (!pass2) drawReshoot(reImg);

    form.append(unkSec, finish);
    const shSec = h('section', { class: 'sec step', id: 'shots' },
      h('header', {}, h('h2', {}, '샷리스트'), h('span', { class: 'chip-state' + (hasShots ? ' done' : '') }, hasShots ? '있음' : '아직 없음')),
      h('div', { class: 'stepbody' },
        h('p', { class: 'note' }, '이 카드를 레퍼런스로 5샷짜리 샷리스트를 짜고, PDF 한 장으로 뽑아요.'),
        h('div', {}, h('button', { class: 'btn', type: 'button', id: 'go-shots', onclick: () => { location.hash = 'shots-' + c.id; } }, hasShots ? '샷리스트 열기' : '5샷 샷리스트 만들기'))));
    if (!pass2) form.append(rvSec, agSec, rsSec, shSec);

    refresh = () => {
      let blocked = false;
      for (const u of ui) {
        const done = stepDone(c, u.st);
        u.locked = blocked;
        if (u.wasLocked === true && !u.locked) open.add(u.st.id);
        u.wasLocked = u.locked;
        const rf = realFields(c, u.st);
        u.sec.classList.toggle('locked', u.locked);
        u.badge.classList.toggle('done', done && !u.locked);
        u.badge.textContent = u.locked ? '잠김' : done ? '완료' : `${rf.filter((f) => fieldOk(c, u.st, f)).length}/${rf.length}칸`;
        const show = !u.locked && open.has(u.st.id);
        if (show && !u.built) buildBody(u);
        u.body.hidden = !show;
        u.toggle.setAttribute('aria-expanded', String(show));
        u.lockNote.hidden = !u.locked;
        u.lockNote.textContent = stepHasData(c, u.st)
          ? '이미 쓴 내용이 있어요. 앞 단계를 채우면 다시 열려요.'
          : '앞 단계를 다 채우면 열려요. 못 채우겠는 칸은 "모르겠음"을 눌러요.';
        if (u.estimate) u.estimate.hidden = c.trust !== 'unknown';
        if (!done) blocked = true;
      }
      const unk = [];
      for (const st of steps) for (const f of realFields(c, st)) if (isUnknown(c, st, f)) unk.push([st, f]);
      unkSec.hidden = !unk.length;
      unkList.replaceChildren(...unk.map(([st, f]) => h('li', {},
        h('button', { class: 'linkbtn', type: 'button', onclick: () => {
          open.add(st.id); refresh();
          document.getElementById('fld-' + fid(st, f).replace('.', '-'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } }, h('span', { class: 'mono' }, pad(stepNo(st))), ` ${st.title} · ${f.label}`))));
      const allDone = !blocked;
      if (!pass2) {
        if (allDone && !c.doneAt) { c.doneAt = Date.now(); touch(); }
        drawAgain(allDone);
      }
      const rvOpen = allDone && c.mode !== 'quick';
      rvSec.classList.toggle('locked', !rvOpen);
      rvBadge.textContent = rvOpen ? '열림' : '잠김';
      rvNote.hidden = rvOpen; rvBody.hidden = !rvOpen;
      finish.hidden = !!pass2 || !(allDone || c.mode === 'quick');
      if (pass2) pass2(allDone);
      finish.replaceChildren(
        allDone ? h('p', { class: 'note' }, c.mode === 'quick' ? '빠른 버전을 다 썼어요.' : c.mode === 'deep' ? '11단계를 근거까지 모두 썼어요.' : '11단계를 모두 썼어요.') : null,
        allDone ? h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = 'view-' + c.id; } }, '한 장으로 보기') : null,
        c.mode === 'quick' ? h('button', { class: 'btn solid', type: 'button', id: 'continue-full', onclick: () => setMode('full') }, '전체 버전으로 이어쓰기') : null);
    };
    refresh();

    /* ── 삭제 (두 번 눌러야 지워짐) ── */
    const danger = h('div', { class: 'danger' });
    function drawDanger(asking) {
      danger.replaceChildren(...(asking
        ? [h('span', {}, '이 카드와 이미지를 지울까요? 되돌릴 수 없어요.'),
           h('button', { class: 'btn small solid', type: 'button', onclick: removeCard }, '네, 지워요'),
           h('button', { class: 'btn small', type: 'button', onclick: () => drawDanger(false) }, '아니요')]
        : [h('button', { class: 'btn small quiet', type: 'button', onclick: () => drawDanger(true) }, '이 카드 지우기')]));
    }
    drawDanger(false);
    if (!pass2) form.append(danger);
    return form;
  }

  /* ───────── 한 장으로 보기 ───────── */
  async function showView(id) {
    if (saveTimer) await saveNow();
    const c = await store.get('cards', id);
    if (!c) { toast('그 카드를 찾을 수 없어요.'); location.hash = 'list'; return; }
    cur = null; savedLabel = null;
    const src = c.image.kind === 'file' ? ((await store.get('images', c.id))?.data || c.thumb) : c.image.url;
    const trustName = (TRUST.find(([k]) => k === c.trust) || [])[1];
    const core = coreElements(c);
    const s11 = c.steps.s11 || {};
    const page = h('article', { class: 'onepage' });
    page.append(h('header', { class: 'opHead' },
      h('div', { class: 'mono' }, `No.${pad(c.no, 3)} · ${typeName(c)} · ${c.date}` + (c.mode === 'quick' || c.mode === 'deep' ? ` · ${MODE_NAME[c.mode]}` : '')),
      h('div', {}, [c.source.unknown ? '출처 모름' : c.source.text.trim(), trustName ? `신뢰도: ${trustName}` : '', c.tags.map((t) => '#' + t).join(' ')]
        .filter(Boolean).join('  ·  '))));
    const lead = h('div', { class: 'opLead' });
    const gz = (c.steps.s2 || {}).gaze || [];
    if (src) lead.append(gz.some((r) => r.x != null) ? gazeFigure(src, gz) : h('img', { src, alt: '', onerror: (e) => e.target.remove() }));
    const leadText = h('div', { class: 'opLeadText' });
    if (has(s11.final)) leadText.append(h('p', { class: 'opFinal' }, s11.final.trim()));
    if (core.length) leadText.append(h('p', {}, h('span', { class: 'label' }, '핵심 요소 '), h('strong', {}, core.join(' · '))));
    lead.append(leadText);
    page.append(lead);

    const cols = h('div', { class: 'opCols' });
    const unk = [];
    for (const st of allSteps(c)) {
      const rows = [];
      for (const f of st.fields) {
        if (f.type === 'head') continue;
        if (isUnknown(c, st, f)) { unk.push(`${pad(stepNo(st))} ${f.label}`); continue; }
        const text = fmt(c, st, f);
        if (text) rows.push(h('div', { class: 'opRow' }, h('dt', {}, f.label), h('dd', {}, text)));
      }
      if (rows.length) cols.append(h('section', { class: 'opStep' },
        h('h3', {}, h('span', { class: 'mono' }, pad(stepNo(st))), ' ' + st.title), h('dl', {}, rows)));
    }
    if (unk.length) cols.append(h('section', { class: 'opStep' }, h('h3', {}, '모르겠음으로 남긴 칸'), h('ul', {}, unk.map((t) => h('li', {}, t)))));
    page.append(cols);

    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar noprint' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'card-' + c.id; } }, '← 카드로 돌아가기'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', id: 'copy-md', onclick: () => copyText(cardMarkdown(c), '복사했어요. 노션에 붙여 넣으면 돼요.') }, '노션용으로 복사'),
          PREVIEW ? null : h('button', { class: 'btn', id: 'print', onclick: () => window.print() }, '인쇄 / PDF로 저장'),
          h('button', { class: 'btn quiet', onclick: () => { location.hash = 'list'; } }, '목록'))),
      page));
    window.scrollTo(0, 0);
  }

  async function removeCard() {
    const id = cur.id;
    clearTimeout(saveTimer); saveTimer = null;
    curPersisted = false;
    await store.del('cards', id);
    await store.del('images', id);
    await store.del('images', id + '-re');
    await store.del('shotlists', id);
    for (const x of await store.all('series')) {
      if (x.cardIds.includes(id)) { x.cardIds = x.cardIds.filter((y) => y !== id); delete x.differ[id]; await store.put('series', x); }
    }
    toast('카드를 지웠어요.');
    location.hash = 'list';
  }

  /* ───────── 길 찾기 ───────── */
  /* ───────── 매일 세 줄 일기 ───────── */
  const DECISIONS = ['색', '구도', '빛', '소품', '연출'];
  const LINES = [
    ['good', '좋다', '구체 요소: 무엇이 좋은가'],
    ['why', '왜', '효과: 그게 무엇을 만드나'],
    ['diff', '내가 다르게 한다면', '나라면 무엇을 바꿀까'],
  ];
  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const entryDone = (e) => !!e.img && LINES.every(([k]) => has(e.lines[k]));
  function streakOf(entries) {
    const set = new Set(entries.filter(entryDone).map((e) => e.id));
    const d = new Date();
    if (!set.has(dstr(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (set.has(dstr(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  /* 단어 뽑기: 띄어쓰기로 자르고, 끝에 붙은 조사(은/는/이/가…)를 떼는 단순한 방식 */
  const PARTICLES = ['에서는', '으로는', '에서', '으로', '에게', '까지', '부터', '처럼', '보다', '이라', '라는', '이다', '하고',
    '은', '는', '이', '가', '을', '를', '의', '에', '로', '와', '과', '도', '만'];
  const STOP = new Set(['그리고', '그래서', '하지만', '그게', '이게', '이건', '그건', '너무', '정말', '진짜', '약간', '조금', '있다', '없다',
    '같다', '같은', '있는', '없는', '있어서', '한다', '된다', '하는', '되는', '느낌', '이미지', '사진', '때문', '나는', '내가', '나라면',
    '다르게', '한다면', '좋다', '어떤', '이런', '그런', '저런', '위해', '대한', '통해', '그냥', '아주', '매우', '가장', '모든', '것이', '하게', '해서', '만든다', '만들', '준다']);
  function wordsOf(text) {
    return (text.match(/[가-힣A-Za-z0-9]+/g) || []).map((w) => {
      w = w.toLowerCase();
      for (const p of PARTICLES) if (w.length - p.length >= 2 && w.endsWith(p)) { w = w.slice(0, -p.length); break; }
      return w;
    }).filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
  }
  function repeatedWords(entries) {
    const count = new Map();
    for (const e of entries) for (const [k] of LINES) for (const w of wordsOf(e.lines[k] || '')) count.set(w, (count.get(w) || 0) + 1);
    return [...count].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  }

  /* ───────── 시리즈 묶기 ───────── */
  const cardSrc = (c) => c.thumb || (c.image.kind === 'url' ? c.image.url : '');
  const SERIES_NOTES = [
    ['distance', '컷 간 거리의 변화', '카메라와 인물 사이가 컷마다 어떻게 달라지나'],
    ['gaze', '컷 간 시선의 변화', '인물의 시선, 내 눈이 가는 곳이 어떻게 바뀌나'],
    ['props', '컷 간 소품 위치의 변화', '같은 소품이 어디로 옮겨 가나'],
    ['common', '이 시리즈를 한 줄로 묶는 공통 결정', '모든 컷에서 똑같이 지킨 것'],
  ];
  async function showSeriesList() {
    cur = null; savedLabel = null;
    const list = (await store.all('series')).sort((a, b) => b.createdAt - a.createdAt);
    const cards = new Map((await store.all('cards')).map((c) => [c.id, c]));
    const name = h('input', { class: 'text', id: 'series-name', placeholder: '새 시리즈 이름 (예: 같은 캠페인 컷 4장)', maxLength: 60,
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) create(); } });
    async function create() {
      const n = name.value.trim();
      if (!n) { toast('시리즈 이름을 먼저 써 주세요.'); name.focus(); return; }
      const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, cardIds: [],
        notes: { distance: '', gaze: '', props: '', common: '' }, differ: {}, createdAt: Date.now() };
      await store.put('series', s);
      location.hash = 'series-' + s.id;
    }
    const body = h('div', { class: 'diary' },
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'series-name' }, '시리즈 만들기'),
        h('div', { class: 'row' }, name, h('button', { class: 'btn solid', type: 'button', id: 'series-create', onclick: create }, '만들기'))),
      list.length
        ? h('div', { class: 'rows' }, list.map((s) => {
            const cs = s.cardIds.map((id) => cards.get(id)).filter(Boolean);
            return h('button', { class: 'sRow', type: 'button', onclick: () => { location.hash = 'series-' + s.id; } },
              h('div', {}, h('strong', {}, s.name), h('span', { class: 'label mono' }, `  ${cs.length}컷`)),
              h('div', { class: 'sStrip' }, cs.slice(0, 8).map((c) => cardSrc(c) ? h('img', { src: cardSrc(c), alt: '', loading: 'lazy' }) : null)),
              has(s.notes.common) ? h('div', { class: 'note' }, s.notes.common) : null);
          }))
        : h('div', { class: 'empty' }, h('strong', {}, '아직 시리즈가 없어요'),
            h('p', {}, '같은 캠페인, 같은 뮤비, 같은 작가의 컷을 한 줄로 세워 놓고 컷끼리 무엇이 같고 무엇이 다른지 비교하는 곳이에요.')));
    app.replaceChildren(h('div', { class: 'wrap' }, topBar('series', '컷끼리 나란히 놓고 비교하기'), body));
    window.scrollTo(0, 0);
  }

  async function showSeries(id) {
    cur = null; savedLabel = null;
    const s = await store.get('series', id);
    if (!s) { toast('그 시리즈를 찾을 수 없어요.'); location.hash = 'series'; return; }
    const all = (await store.all('cards')).sort((a, b) => b.createdAt - a.createdAt);
    const byId = new Map(all.map((c) => [c.id, c]));
    s.cardIds = s.cardIds.filter((cid) => byId.has(cid));
    const status = h('span', { class: 'saved mono' }, '자동 저장됨');
    let timer = null;
    const save = async () => { clearTimeout(timer); timer = null; await store.put('series', s); status.textContent = `자동 저장됨 ${clock()}`; };
    const touchS = () => { status.textContent = '저장 중…'; clearTimeout(timer); timer = setTimeout(save, 400); };
    flushPage = async () => { if (timer) await save(); };

    const name = h('input', { class: 'text sName', id: 'series-title', value: s.name, 'aria-label': '시리즈 이름', maxLength: 60,
      oninput: () => { s.name = name.value; touchS(); } });

    const strip = h('div', { class: 'cuts' });
    const picker = h('div', { class: 'pickgrid' });
    function move(i, d) { const j = i + d; if (j < 0 || j >= s.cardIds.length) return; [s.cardIds[i], s.cardIds[j]] = [s.cardIds[j], s.cardIds[i]]; draw(); touchS(); }
    function draw() {
      strip.replaceChildren(...(s.cardIds.length ? s.cardIds.map((cid, i) => {
        const c = byId.get(cid);
        const ta = h('textarea', { class: 'text area', rows: 1, placeholder: '이 컷만 다르게 한 결정', value: s.differ[cid] || '',
          'aria-label': `컷 ${i + 1}만의 결정`, oninput: () => { s.differ[cid] = ta.value; touchS(); } });
        grow(ta);
        const holder = h('div', { class: 'field' }, ta);
        watchVague([ta], holder);
        return h('div', { class: 'cut' },
          h('button', { class: 'cutpic', type: 'button', 'aria-label': `No.${pad(c.no, 3)} 카드 열기`, onclick: () => { location.hash = 'card-' + c.id; } },
            cardSrc(c) ? h('img', { src: cardSrc(c), alt: '' }) : h('div', { class: 'nopic' }, '이미지 없음')),
          h('div', { class: 'meta mono' }, h('span', {}, `컷 ${i + 1} · No.${pad(c.no, 3)}`),
            h('span', {},
              h('button', { class: 'mini', type: 'button', 'aria-label': '앞으로 옮기기', disabled: i === 0, onclick: () => move(i, -1) }, '←'),
              h('button', { class: 'mini', type: 'button', 'aria-label': '뒤로 옮기기', disabled: i === s.cardIds.length - 1, onclick: () => move(i, 1) }, '→'))),
          has(c.steps.s1.feel) ? h('div', { class: 'feel' }, `${c.steps.s1.feel}한 느낌`) : null,
          holder);
      }) : [h('p', { class: 'note' }, '아래 "컷 넣고 빼기"에서 카드를 눌러 이 시리즈에 넣어요.')]));
      picker.replaceChildren(...all.map((c) => {
        const on = s.cardIds.includes(c.id);
        return h('button', { class: 'pick' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on),
          'aria-label': `No.${pad(c.no, 3)} ${on ? '빼기' : '넣기'}`,
          onclick: () => { s.cardIds = on ? s.cardIds.filter((x) => x !== c.id) : [...s.cardIds, c.id]; draw(); touchS(); } },
          cardSrc(c) ? h('img', { src: cardSrc(c), alt: '', loading: 'lazy' }) : h('span', { class: 'mono' }, pad(c.no, 3)),
          on ? h('span', { class: 'pickmark mono' }, s.cardIds.indexOf(c.id) + 1) : null);
      }));
    }
    draw();

    const notes = SERIES_NOTES.map(([k, label, ph]) => {
      const ta = h('textarea', { class: 'text area', id: 'sn-' + k, rows: 1, placeholder: ph, value: s.notes[k] || '',
        oninput: () => { s.notes[k] = ta.value; touchS(); } });
      grow(ta);
      const holder = h('div', { class: 'field' }, h('label', { class: 'label', for: 'sn-' + k }, label), ta);
      watchVague([ta], holder);
      return holder;
    });

    const danger = h('div', { class: 'danger' });
    const drawDanger = (asking) => danger.replaceChildren(...(asking
      ? [h('span', {}, '이 시리즈를 지울까요? 안에 든 카드는 그대로 남아요.'),
         h('button', { class: 'btn small solid', type: 'button', onclick: async () => { clearTimeout(timer); timer = null; await store.del('series', s.id); toast('시리즈를 지웠어요.'); location.hash = 'series'; } }, '네, 지워요'),
         h('button', { class: 'btn small', type: 'button', onclick: () => drawDanger(false) }, '아니요')]
      : [h('button', { class: 'btn small quiet', type: 'button', onclick: () => drawDanger(true) }, '이 시리즈 지우기')]));
    drawDanger(false);

    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'series'; } }, '← 시리즈 목록'), status),
      h('div', { class: 'form' },
        name,
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '컷 나란히 보기'), h('span', { class: 'label mono' }, `${s.cardIds.length}컷`)), strip),
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '컷끼리 비교')), h('div', { class: 'stepbody narrow' }, notes)),
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '컷 넣고 빼기')),
          all.length ? picker : h('p', { class: 'note' }, '아직 카드가 없어요. 카드를 먼저 만들어요.')),
        danger)));
    window.scrollTo(0, 0);
  }

  let flushPage = null;
  let diaryPaste = null;
  async function showDiary() {
    cur = null; savedLabel = null;
    const entries = (await store.all('diary')).sort((a, b) => (a.id < b.id ? 1 : -1));
    const cards = (await store.all('cards')).sort((a, b) => b.createdAt - a.createdAt);
    const wordMap = ((await store.get('meta', 'wordMap')) || { id: 'wordMap', map: {} });
    const tid = today();
    let todayE = entries.find((e) => e.id === tid);
    let persisted = !!todayE;
    if (!todayE) todayE = { id: tid, img: '', cardId: null, lines: { good: '', why: '', diff: '' }, createdAt: Date.now() };

    const status = h('span', { class: 'saved mono' });
    let timer = null;
    const save = async () => {
      clearTimeout(timer); timer = null;
      if (!persisted) return;
      try { await store.put('diary', todayE); status.textContent = `자동 저장됨 ${clock()}`; }
      catch (e) { status.textContent = '저장 실패'; toast('저장하지 못했어요. 기기 저장 공간을 확인해 주세요.'); }
      drawStats();
    };
    flushPage = async () => { if (timer) await save(); };
    const touchDiary = () => { if (!persisted) return; status.textContent = '저장 중…'; clearTimeout(timer); timer = setTimeout(save, 400); };
    const withToday = () => (persisted ? [todayE, ...entries.filter((e) => e.id !== tid)] : entries);

    /* 오늘 칸 */
    const todayBox = h('section', { class: 'sec' });
    async function setDiaryImage(img, cardId) {
      todayE.img = img; todayE.cardId = cardId || null;
      persisted = true;
      await save();
      drawToday();
    }
    async function diaryFile(file) {
      if (!file || !file.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.'); return; }
      const url = URL.createObjectURL(file);
      try { setDiaryImage(shrink(await loadImg(url), 1000, 0.85)); }
      catch (e) { toast('이 파일은 사진으로 읽을 수 없어요.'); }
      finally { URL.revokeObjectURL(url); }
    }
    function drawToday() {
      const head = h('header', {}, h('h2', {}, '오늘의 세 줄'), h('span', { class: 'mono label' }, tid));
      diaryPaste = null;
      if (!todayE.img) {
        const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => diaryFile(input.files[0]) });
        diaryPaste = diaryFile;
        const withPic = cards.filter((c) => c.thumb || c.image.kind === 'url').slice(0, 12);
        todayBox.replaceChildren(head,
          h('div', { class: 'drop' },
            h('p', { class: 'big' }, '오늘의 이미지 한 장'),
            input, h('button', { class: 'btn solid', type: 'button', id: 'diary-pick', onclick: () => input.click() }, '사진 고르기'),
            h('p', {}, '스크린샷을 복사해서 붙여넣기 해도 돼요. 하루에 한 장, 세 줄만 써요.')),
          withPic.length ? h('div', { class: 'field' },
            h('span', { class: 'label' }, '또는 내 카드에서 고르기'),
            h('div', { class: 'pickgrid' }, withPic.map((c) =>
              h('button', { class: 'pick', type: 'button', 'aria-label': `No.${pad(c.no, 3)} 카드 이미지`,
                onclick: () => setDiaryImage(c.thumb || c.image.url, c.id) },
                h('img', { src: c.thumb || c.image.url, alt: '', loading: 'lazy' }))))) : null);
        return;
      }
      const fields = LINES.map(([k, label, ph]) => {
        const inp = h('textarea', { class: 'text area', id: 'd-' + k, rows: 1, placeholder: ph, value: todayE.lines[k],
          oninput: () => { todayE.lines[k] = inp.value; touchDiary(); } });
        grow(inp);
        const holder = h('div', { class: 'field' }, h('label', { class: 'label', for: 'd-' + k }, label), inp);
        watchVague([inp], holder);
        return holder;
      });
      todayBox.replaceChildren(head,
        h('div', { class: 'dToday' },
          h('div', {}, h('img', { class: 'dImg', src: todayE.img, alt: '오늘의 이미지' }),
            h('div', { class: 'under' }, status,
              h('button', { class: 'btn quiet small', type: 'button', onclick: () => { todayE.img = ''; drawToday(); } }, '이미지 바꾸기'))),
          h('div', { class: 'stepbody' }, fields)));
    }

    /* 연속 일수 + 반복어 */
    const stats = h('div', { class: 'dStats' });
    const wordsBox = h('section', { class: 'sec' });
    function drawStats() {
      const all = withToday();
      const done = all.filter(entryDone);
      const todayOk = done.some((e) => e.id === tid);
      stats.replaceChildren(
        h('div', {}, h('strong', { class: 'mono' }, streakOf(all)), h('span', { class: 'label' }, '일 연속')),
        h('div', {}, h('strong', { class: 'mono' }, done.length), h('span', { class: 'label' }, '일 썼음')),
        h('div', {}, h('strong', {}, todayOk ? '오늘 완료' : '오늘 아직'), h('span', { class: 'label' }, todayOk ? '내일 또 만나요' : '세 줄을 다 채우면 하루로 쳐요')));
      const head = h('header', {}, h('h2', {}, '내가 자꾸 쓰는 단어'));
      if (done.length < 7) {
        wordsBox.replaceChildren(head, h('p', { class: 'note' },
          `일기가 7일 쌓이면, 내가 3번 이상 쓴 단어를 뽑아서 보여줘요. 지금 ${done.length}/7일.`));
        return;
      }
      const words = repeatedWords(done);
      wordsBox.replaceChildren(head,
        h('p', { class: 'note' }, words.length
          ? '이 단어는 어떤 결정을 가리키나요? 내가 직접 골라요. 앱은 세기만 했어요.'
          : '아직 3번 이상 쓴 단어가 없어요. 계속 쓰다 보면 나타나요.'),
        h('div', { class: 'rows' }, words.map(([w, n]) => {
          const box = h('div', { class: 'seg', role: 'group', 'aria-label': `${w}가 가리키는 결정` });
          const draw = () => box.replaceChildren(...DECISIONS.map((d) =>
            h('button', { class: 'btn small' + (wordMap.map[w] === d ? ' on' : ''), type: 'button', 'aria-pressed': String(wordMap.map[w] === d),
              onclick: async () => {
                if (wordMap.map[w] === d) delete wordMap.map[w]; else wordMap.map[w] = d;
                draw();
                await store.put('meta', wordMap);
              } }, d)));
          draw();
          return h('div', { class: 'eraserow' }, h('span', {}, h('strong', {}, w), h('span', { class: 'mono label' }, ` ×${n}`)), box);
        })));
    }

    /* 지난 일기 */
    const past = entries.filter((e) => e.id !== tid);
    const pastBox = h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '지난 일기')),
      past.length
        ? h('div', { class: 'rows' }, past.map((e) => h('article', { class: 'dEntry' },
            e.img ? h('img', { src: e.img, alt: '', loading: 'lazy' }) : h('div', {}),
            h('div', {},
              h('div', { class: 'mono label' }, e.id + (entryDone(e) ? '' : ' · 다 못 씀')),
              LINES.map(([k, label]) => has(e.lines[k]) ? h('p', {}, h('span', { class: 'label' }, label + '  '), e.lines[k]) : null)))))
        : h('p', { class: 'note' }, '아직 지난 일기가 없어요. 오늘 것부터 시작해요.'));

    drawToday(); drawStats();
    if (persisted) status.textContent = '자동 저장됨';
    app.replaceChildren(h('div', { class: 'wrap' },
      topBar('diary', '하루 한 장, 세 줄'),
      h('div', { class: 'diary' }, stats, todayBox, wordsBox, pastBox)));
    window.scrollTo(0, 0);
  }

  /* ───────── 영상 카드 ───────── */
  const VIDEO_STEP = { id: 'video', title: '영상 정보', noUnknown: true, fields: [
    T('title', '영상 제목 (아티스트 - 곡)'),
    T('url', '영상 링크'),
    T('tc', '타임코드 (예: 1:23)'),
    C('section', '곡 구간', ['인트로', '벌스', '후렴', '브릿지', '아웃트로']),
    { k: 'len', label: '샷 길이', type: 'num', unit: '초' },
    C('trans', '전환 방식', ['컷', '디졸브', '매치컷', '기타']),
    C('move', '카메라 움직임', ['고정', '푸시인', '패닝', '핸드헬드', '기타']),
    C('kind', '샷 종류', ['퍼포먼스', '내러티브']),
    T('beat', '비트와 컷이 맞는 지점'),
    T('around', '이 컷 앞뒤에 오는 컷') ] };
  const allSteps = (c) => (c.type === 'video' ? [VIDEO_STEP, ...STEPS] : STEPS);
  const typeName = (c) => (c.type === 'video' ? '영상' : '스틸');
  function videoKey(c) {
    if (c.type !== 'video') return '';
    const v = c.steps.video || {};
    const url = (v.url || '').trim();
    const yt = url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([\w-]{6,})/);
    if (yt) return 'yt:' + yt[1];
    if (url) return url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    return has(v.title) ? 'title:' + v.title.trim().toLowerCase() : '';
  }
  const videoName = (c) => { const v = c.steps.video || {}; return has(v.title) ? v.title.trim() : (v.url || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) || '제목 없는 영상'; };
  const tcSec = (c) => String((c.steps.video || {}).tc || '').split(':').reduce((a, x) => a * 60 + (parseFloat(x) || 0), 0);
  let nextCut = null; // "다음 컷 분석하기"를 눌렀을 때 새 카드에 미리 넣을 것

  /* 이미지 위 시선 핀 (읽기 전용 그림) */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function pinLayerContent(gaze, activeIndex) {
    const pts = gaze.map((r, i) => (r.x != null ? { x: r.x, y: r.y, i } : null)).filter(Boolean);
    const out = [];
    if (pts.length > 1) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
      const line = document.createElementNS(SVGNS, 'polyline');
      line.setAttribute('points', pts.map((q) => `${q.x * 100},${q.y * 100}`).join(' '));
      line.setAttribute('fill', 'none'); line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(line); out.push(svg);
    }
    for (const q of pts) out.push(h('span', { class: 'pin mono' + (q.i === activeIndex ? ' on' : ''), style: `left:${q.x * 100}%;top:${q.y * 100}%` }, q.i + 1));
    return out;
  }
  function gazeFigure(src, gaze) {
    const layer = h('div', { class: 'pinlayer' }, pinLayerContent(gaze, -1));
    const fig = h('div', { class: 'gazemap static' }, h('img', { src, alt: '', onerror: () => fig.remove() }), layer);
    return fig;
  }

  /* ───────── 샷리스트 ───────── */
  const SHOT_HEIGHT = ['바닥', '허리', '눈높이', '위'];
  const SHOT_MOVE = ['고정', '푸시인', '패닝', '핸드헬드', '기타'];
  function pickOne(options, get, set, label) {
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const draw = () => box.replaceChildren(...options.map((o) =>
      h('button', { class: 'btn small' + (get() === o ? ' on' : ''), type: 'button', 'aria-pressed': String(get() === o),
        onclick: () => { set(get() === o ? '' : o); draw(); } }, o)));
    draw();
    return box;
  }
  async function showShots(cardId) {
    if (saveTimer) await saveNow();
    const c = await store.get('cards', cardId);
    if (!c) { toast('그 카드를 찾을 수 없어요.'); location.hash = 'list'; return; }
    cur = null; savedLabel = null;
    let sl = await store.get('shotlists', cardId);
    let persisted = !!sl;
    if (!sl) sl = { id: cardId, title: '', shots: Array.from({ length: 5 }, () => ({ sketch: '', note: '', height: '', move: '', len: '' })), createdAt: Date.now() };
    const src = await cardImage(c);
    const status = h('span', { class: 'saved mono' }, persisted ? '자동 저장됨' : '쓰기 시작하면 저장돼요');
    const total = h('strong', { class: 'mono' });
    const sheet = h('div', { class: 'printonly shotsheet' });
    let timer = null;
    const sum = () => sl.shots.reduce((a, s) => a + (parseFloat(s.len) || 0), 0);
    const save = async () => { clearTimeout(timer); timer = null; await store.put('shotlists', sl); status.textContent = `자동 저장됨 ${clock()}`; };
    const changed = () => {
      persisted = true; status.textContent = '저장 중…';
      total.textContent = `${sum()}초`;
      drawSheet();
      clearTimeout(timer); timer = setTimeout(save, 400);
    };
    flushPage = async () => { if (timer) await save(); };
    function drawSheet() {
      sheet.replaceChildren(
        h('header', {},
          h('div', {}, h('h1', {}, sl.title.trim() || '샷리스트'),
            h('p', { class: 'mono' }, `${today()} · 5 SHOTS · 총 ${sum()}초`),
            h('p', {}, `레퍼런스: DOPEYE No.${pad(c.no, 3)}` + (has(c.steps.s1.feel) ? ` · ${c.steps.s1.feel.trim()}한 느낌` : ''))),
          src ? h('img', { src, alt: '' }) : null),
        h('table', {},
          h('thead', {}, h('tr', {}, ['샷', '스케치', '무슨 장면', '카메라 높이', '움직임', '길이'].map((t) => h('th', {}, t)))),
          h('tbody', {}, sl.shots.map((s, i) => h('tr', {},
            h('td', { class: 'mono n' }, i + 1),
            h('td', { class: 'sk' }, s.sketch ? h('img', { src: s.sketch, alt: '' }) : null),
            h('td', {}, s.note), h('td', {}, s.height), h('td', {}, s.move),
            h('td', { class: 'mono' }, has(s.len) ? `${s.len}초` : ''))))));
    }
    const title = h('input', { class: 'text sName', id: 'shots-title', value: sl.title, placeholder: '샷리스트 제목 (곡이나 프로젝트 이름)', maxLength: 60,
      oninput: () => { sl.title = title.value; changed(); } });
    const shots = sl.shots.map((s, i) => {
      const pic = h('div', { class: 'sketch' });
      const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
        const f = input.files[0]; input.value = '';
        if (!f || !f.type.startsWith('image/')) { toast('사진 파일만 올릴 수 있어요.'); return; }
        const url = URL.createObjectURL(f);
        try { s.sketch = shrink(await loadImg(url), 700, 0.85); drawPic(); changed(); }
        catch (e) { toast('이 파일은 사진으로 읽을 수 없어요.'); }
        finally { URL.revokeObjectURL(url); }
      } });
      const drawPic = () => pic.replaceChildren(input,
        s.sketch ? h('img', { src: s.sketch, alt: `샷 ${i + 1} 스케치` }) : null,
        h('button', { class: 'btn small quiet', type: 'button', onclick: () => input.click() }, s.sketch ? '스케치 바꾸기' : '스케치 올리기'));
      drawPic();
      const note = h('input', { class: 'text', id: `shot-${i + 1}-note`, value: s.note, placeholder: '무슨 장면인지 한 줄', 'aria-label': `샷 ${i + 1} 장면`,
        oninput: () => { s.note = note.value; changed(); } });
      const len = h('input', { class: 'text mono num', id: `shot-${i + 1}-len`, type: 'number', inputMode: 'decimal', min: 0, step: 'any', value: s.len, 'aria-label': `샷 ${i + 1} 길이`,
        oninput: () => { s.len = len.value; changed(); } });
      const hBox = pickOne(SHOT_HEIGHT, () => s.height, (v) => { s.height = v; changed(); }, `샷 ${i + 1} 카메라 높이`);
      const mBox = pickOne(SHOT_MOVE, () => s.move, (v) => { s.move = v; changed(); }, `샷 ${i + 1} 움직임`);
      return h('section', { class: 'sec' }, h('header', {}, h('h2', {}, h('span', { class: 'mono stepno' }, pad(i + 1)), `샷 ${i + 1}`)),
        h('div', { class: 'shot' }, pic,
          h('div', { class: 'stepbody' },
            h('div', { class: 'field' }, note),
            h('div', { class: 'field' }, h('span', { class: 'label' }, '카메라 높이'), hBox),
            h('div', { class: 'field' }, h('span', { class: 'label' }, '움직임'), mBox),
            h('div', { class: 'field' }, h('span', { class: 'label' }, '길이'), h('span', { class: 'numwrap' }, len, h('span', { class: 'label' }, '초'))))));
    });
    total.textContent = `${sum()}초`;
    drawSheet();
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar noprint' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'card-' + c.id; } }, '← 카드로 돌아가기'),
        h('div', { class: 'row' }, status,
          PREVIEW ? null : h('button', { class: 'btn solid', id: 'shots-print', onclick: () => window.print() }, 'PDF 한 장으로 뽑기'))),
      h('div', { class: 'editor noprint' },
        h('div', { class: 'stage' }, h('div', { class: 'frame' }, src ? h('img', { src, alt: '레퍼런스 이미지' }) : h('div', { class: 'linkfail' }, '이미지 없음')),
          h('div', { class: 'under' }, h('span', { class: 'label mono' }, `레퍼런스 No.${pad(c.no, 3)}`), h('span', {}, h('span', { class: 'label' }, '총 길이 '), total))),
        h('div', { class: 'form' }, title,
          PREVIEW ? h('div', { class: 'nudge' }, '미리보기 주소에서는 PDF 저장이 막혀 있어요. 정식 주소에서는 위에 버튼이 보여요.') : null,
          shots)),
      sheet));
    window.scrollTo(0, 0);
  }

  /* ───────── 재분석(2차)과 재현 촬영 ───────── */
  const DAY = 86400000;
  const cardDone = (c) => progress(c).done;
  const doneTime = (c) => c.doneAt || c.updatedAt;
  const dueAgain = (c) => cardDone(c) && !c.second && Date.now() - doneTime(c) >= 3 * DAY;
  function secondView(c) {
    const s = c.second;
    const v = Object.create(c);
    Object.defineProperty(v, 'steps', { value: s.steps });
    Object.defineProperty(v, 'unknown', { get: () => s.unknown, set: (x) => { s.unknown = x; } });
    return v;
  }
  async function cardImage(c) {
    return c.image.kind === 'file' ? ((await store.get('images', c.id))?.data || c.thumb) : c.image.url;
  }
  async function showAgain(id) {
    if (saveTimer) await saveNow();
    const c = await store.get('cards', id);
    if (!c) { toast('그 카드를 찾을 수 없어요.'); location.hash = 'list'; return; }
    if (!c.second) {
      c.second = { startedAt: Date.now(), steps: { s1: { feel: '', words: ['', '', ''], score: null } }, unknown: [], newSeen: ['', '', ''], wrongGuess: '' };
      await store.put('cards', c);
    }
    cur = c; curPersisted = true;
    savedLabel = h('span', { class: 'saved mono' }, '자동 저장됨');
    const src = await cardImage(c);
    const end = h('div', { class: 'finish', hidden: true },
      h('p', { class: 'note' }, '2차를 다 썼어요. 이제 1차와 나란히 놓고 봐요.'),
      h('button', { class: 'btn solid', type: 'button', id: 'to-compare', onclick: () => { location.hash = 'compare-' + c.id; } }, '1차와 2차 나란히 보기'));
    const form = buildForm(secondView(c), { origSrc: src, pass2: (allDone) => { end.hidden = !allDone; } });
    form.prepend(h('div', { class: 'nudge' }, '1차에 쓴 답은 가려 뒀어요. 처음 보는 이미지처럼 새 눈으로 다시 써요.'));
    form.append(end);
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'card-' + c.id; } }, '← 카드로 돌아가기'),
        h('div', { class: 'slate mono' }, h('strong', {}, `No.${pad(c.no, 3)}`), h('span', {}, '2차 다시 쓰기'), savedLabel)),
      h('div', { class: 'editor' },
        h('div', { class: 'stage' }, h('div', { class: 'frame' }, src ? h('img', { src, alt: '분석할 이미지' }) : h('div', { class: 'linkfail' }, '이미지 없음'))),
        form)));
    window.scrollTo(0, 0);
  }
  async function showCompare(id) {
    if (saveTimer) await saveNow();
    const c = await store.get('cards', id);
    if (!c || !c.second) { location.hash = c ? 'card-' + id : 'list'; return; }
    cur = c; curPersisted = true;
    savedLabel = h('span', { class: 'saved mono' }, '자동 저장됨');
    const v2 = secondView(c);
    const src = await cardImage(c);
    const rows = [];
    let changed = 0;
    for (const st of visibleSteps(c)) {
      const part = [];
      for (const f of realFields(c, st)) {
        const a = isUnknown(c, st, f) ? '모르겠음' : fmt(c, st, f);
        const b = isUnknown(v2, st, f) ? '모르겠음' : fmt(v2, st, f);
        if (!a && !b) continue;
        const diff = a !== b;
        if (diff) changed++;
        part.push(h('div', { class: 'cmpRow' + (diff ? ' diff' : '') },
          h('div', { class: 'label' }, f.label, diff ? h('span', { class: 'cmpTag' }, '달라짐') : null),
          h('div', { class: 'cmpCell' }, a || '—'), h('div', { class: 'cmpCell' }, b || '—')));
      }
      if (part.length) rows.push(h('h3', { class: 'cmpStep' }, h('span', { class: 'mono' }, pad(stepNo(st))), ' ' + st.title), ...part);
    }
    const s = c.second;
    const seen = h('div', { class: 'rows' }, s.newSeen.map((_, i) => {
      const inp = h('input', { class: 'text', id: `ns-${i + 1}`, placeholder: `새로 보인 것 ${i + 1}`, value: s.newSeen[i], 'aria-label': `2차에서 새로 보인 것 ${i + 1}`,
        oninput: () => { s.newSeen[i] = inp.value; touch(); } });
      return inp;
    }));
    const wrong = h('input', { class: 'text', id: 'wrong-guess', value: s.wrongGuess, placeholder: '1차에는 이렇게 추정했는데, 다시 보니 아니었다',
      oninput: () => { s.wrongGuess = wrong.value; touch(); } });
    app.replaceChildren(h('div', { class: 'wrap' },
      h('div', { class: 'bar' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'card-' + c.id; } }, '← 카드로 돌아가기'),
        h('div', { class: 'slate mono' }, h('strong', {}, `No.${pad(c.no, 3)}`), h('span', {}, '1차 · 2차 비교'), savedLabel)),
      h('div', { class: 'editor' },
        h('div', { class: 'stage' }, h('div', { class: 'frame' }, src ? h('img', { src, alt: '분석한 이미지' }) : h('div', { class: 'linkfail' }, '이미지 없음'))),
        h('div', { class: 'form' },
          h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '내가 표시하기')),
            h('div', { class: 'field' }, h('span', { class: 'label' }, '2차에서 새로 보인 것 3개'), seen),
            h('div', { class: 'field' }, h('label', { class: 'label', for: 'wrong-guess' }, '1차에서 틀렸던 추정 1개'), wrong)),
          h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '1차와 2차 나란히'), h('span', { class: 'label mono' }, `${changed}칸 달라짐`)),
            h('div', { class: 'cmpHead mono' }, h('span', {}, `1차 · ${dstr(new Date(c.createdAt))}`), h('span', {}, `2차 · ${dstr(new Date(s.startedAt))}`)),
            rows.length ? rows : h('p', { class: 'note' }, '아직 비교할 내용이 없어요.'),
            h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = 'again-' + c.id; } }, '2차 이어 쓰기')))))));
    window.scrollTo(0, 0);
  }

  /* ───────── 백업과 내보내기 ───────── */
  const STORES = ['cards', 'images', 'diary', 'meta', 'series', 'shotlists'];
  const trustLabel = (c) => (TRUST.find(([k]) => k === c.trust) || [])[1] || '';
  function cardMarkdown(c, forAi) {
    const L = [];
    L.push(`# DOPEYE No.${pad(c.no, 3)}`, '');
    L.push(`- 날짜: ${c.date}`);
    L.push(`- 종류: ${typeName(c)} · ${MODE_NAME[c.mode] || '전체 버전'}`);
    if (c.tags.length) L.push(`- 태그: ${c.tags.map((t) => '#' + t).join(' ')}`);
    L.push(`- 출처: ${c.source.unknown ? '모름' : (c.source.text.trim() || '(안 씀)')}` + (trustLabel(c) ? ` (신뢰도: ${trustLabel(c)})` : ''));
    if (c.image.kind === 'url') L.push('', `![이미지](${c.image.url})`);
    const fin = (c.steps.s11 || {}).final;
    if (has(fin)) L.push('', `> ${fin.trim()}`);
    const core = coreElements(c);
    if (core.length) L.push('', `**이 이미지의 핵심 요소**: ${core.join(' · ')}`);
    const unk = [];
    for (const st of allSteps(c)) {
      const rows = [];
      for (const f of st.fields) {
        if (f.type === 'head') continue;
        if (isUnknown(c, st, f)) { unk.push(`${pad(stepNo(st))} ${st.title} · ${f.label}`); rows.push(`- **${f.label}**: 모르겠음`); continue; }
        const text = fmt(c, st, f);
        if (!text) continue;
        if (text.includes('\n')) rows.push(`- **${f.label}**:`, ...text.split('\n').map((t) => `  - ${t}`));
        else rows.push(`- **${f.label}**: ${text}`);
      }
      if (rows.length) L.push('', `## ${pad(stepNo(st))} ${st.title}`, ...rows);
    }
    if (unk.length) L.push('', '## 모르겠음으로 남긴 칸', ...unk.map((u) => `- ${u}`));
    if (!forAi && c.second) {
      const ns = c.second.newSeen.filter(has);
      if (ns.length || has(c.second.wrongGuess)) {
        L.push('', '## 3일 뒤 다시 쓰기');
        if (ns.length) L.push('- **2차에서 새로 보인 것**:', ...ns.map((t) => `  - ${t.trim()}`));
        if (has(c.second.wrongGuess)) L.push(`- **1차에서 틀렸던 추정**: ${c.second.wrongGuess.trim()}`);
      }
    }
    if (!forAi && c.reshoot && c.reshoot.has) {
      const ds = c.reshoot.diffs.filter(has);
      L.push('', '## 재현 촬영 기록');
      if (ds.length) L.push('- **원본과 다른 점**:', ...ds.map((t) => `  - ${t.trim()}`));
      if (has(c.reshoot.missed)) L.push(`- **내가 못 봤던 것**: ${c.reshoot.missed.trim()}`);
    }
    const rv = c.review || {};
    if (!forAi && (has(rv.missed) || has(rv.disagree))) {
      L.push('', '## 정답 확인');
      if (has(rv.missed)) L.push(`- **AI는 봤는데 나는 못 본 것**: ${rv.missed.trim()}`);
      if (has(rv.disagree)) L.push(`- **AI가 틀렸다고 생각하는 것**: ${rv.disagree.trim()}`);
    }
    return L.join('\n') + '\n';
  }
  function reviewPrompt(c) {
    return [
      '나는 뮤직비디오 감독을 목표로 이미지 분석 연습을 하고 있어. 첨부한 이미지를 아래처럼 내 눈으로 먼저 분석했어.',
      '내 분석을 끝까지 읽고 나서, 이미지와 비교해서 아래 네 가지를 알려줘.',
      '',
      '1. 내가 놓친 시각적 결정 3가지 (구도, 빛, 색, 질감, 소품, 연출 중에서. 화면의 어디를 보면 되는지 위치로 짚어줘)',
      '2. 내 관찰 중 이미지와 달라 보이는 것 (어느 칸이 왜 다른지)',
      '3. 내가 "모르겠음"으로 남긴 칸: 답을 바로 말하지 말고, 어디를 어떻게 보면 알 수 있는지 힌트만',
      '4. 내 최종 문장을 더 구체적으로 만들려면 어떤 단어를 바꿔야 하는지',
      '',
      '규칙: 칭찬은 빼줘. 감독의 의도는 크레딧이나 인터뷰로 확인된 게 아니면 반드시 "추정"이라고 표시해줘. 쉬운 말로 써줘.',
      '',
      '--- 내 분석 ---',
      '',
      cardMarkdown(c, true),
    ].join('\n');
  }
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) {
      const ta = h('textarea', { class: 'text copyarea', readOnly: true, value: text, 'aria-label': '복사할 글' });
      const box = h('div', { class: 'sheetbox', role: 'dialog', 'aria-label': '직접 복사하기' },
        h('p', {}, '자동 복사가 막혀 있어요. 아래 글을 길게 눌러(또는 Ctrl+C / ⌘C) 직접 복사해 주세요.'), ta,
        h('button', { class: 'btn solid', type: 'button', onclick: () => box.remove() }, '닫기'));
      document.body.append(box);
      ta.focus(); ta.select();
    }
  }
  async function saveFile(name, text) {
    const file = new File([text], name, { type: 'application/json' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; }
      catch (e) { if (e.name === 'AbortError') return false; }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return true;
  }
  const daysAgo = (t) => { const n = Math.floor((Date.now() - t) / 86400000); return n <= 0 ? '오늘' : `${n}일 전`; };

  async function showBackup() {
    cur = null; savedLabel = null;
    const all = {};
    for (const s of STORES) all[s] = await store.all(s);
    const last = all.meta.find((m) => m.id === 'lastBackup');
    let protect = null; let usage = null;
    try { protect = await navigator.storage.persisted(); const est = await navigator.storage.estimate(); usage = est.usage; } catch (e) { /* 알 수 없음 */ }

    const lastLine = h('p', { class: 'note' }, last ? `마지막으로 내보낸 날: ${dstr(new Date(last.at))} (${daysAgo(last.at)})` : '아직 한 번도 내보내지 않았어요.');
    const exportBtn = h('button', { class: 'btn solid', type: 'button', id: 'export', disabled: PREVIEW,
      onclick: async () => {
        const data = { app: 'eye-training-note', version: 1, exportedAt: new Date().toISOString() };
        for (const s of STORES) data[s] = await store.all(s);
        const ok = await saveFile(`eye-note-backup-${today()}.json`, JSON.stringify(data));
        if (!ok) return;
        const at = Date.now();
        await store.put('meta', { id: 'lastBackup', at });
        lastLine.textContent = `마지막으로 내보낸 날: ${dstr(new Date(at))} (오늘)`;
        toast('백업 파일을 만들었어요. 잃어버리지 않을 곳에 보관해 주세요.');
      } }, '전체 기록을 파일 하나로 내보내기');

    const importBox = h('div', { class: 'field' });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'import-file',
      onchange: async () => {
        const f = fileIn.files[0]; fileIn.value = '';
        if (!f) return;
        let data;
        try { data = JSON.parse(await f.text()); } catch (e) { data = null; }
        if (!data || data.app !== 'eye-training-note' || !Array.isArray(data.cards)) {
          toast('DOPEYE의 백업 파일이 아니에요. "eye-note-backup-날짜.json" 파일을 골라 주세요.');
          return;
        }
        drawImport(data);
      } });
    function drawImport(data) {
      if (!data) { importBox.replaceChildren(fileIn, h('div', {}, h('button', { class: 'btn', type: 'button', onclick: () => fileIn.click() }, '백업 파일 고르기'))); return; }
      importBox.replaceChildren(fileIn,
        h('p', {}, h('strong', {}, `이 파일에는 카드 ${data.cards.length}장, 일기 ${(data.diary || []).length}일, 시리즈 ${(data.series || []).length}개가 들어 있어요.`),
          h('span', { class: 'note' }, `  (${String(data.exportedAt || '').slice(0, 10)}에 내보낸 파일)`)),
        h('div', { class: 'seg' },
          h('button', { class: 'btn solid', type: 'button', id: 'import-merge', onclick: () => doImport(data, false) }, '지금 기록에 합치기'),
          h('button', { class: 'btn', type: 'button', id: 'import-replace', onclick: () => doImport(data, true) }, '지금 기록을 지우고 이 파일로 바꾸기'),
          h('button', { class: 'btn quiet', type: 'button', onclick: () => drawImport(null) }, '취소')),
        h('p', { class: 'note' }, '합치기: 같은 카드가 양쪽에 있으면 파일 쪽 내용으로 덮어써요. 바꾸기: 이 기기의 지금 기록은 사라져요.'));
    }
    async function doImport(data, replace) {
      try {
        if (replace) for (const s of STORES) await store.clear(s);
        const existing = replace ? [] : await store.all('cards');
        const haveId = new Set(existing.map((c) => c.id));
        const usedNo = new Set(existing.map((c) => c.no));
        let max = existing.reduce((m, c) => Math.max(m, c.no || 0), 0);
        for (const c of [...data.cards].sort((a, b) => a.createdAt - b.createdAt)) {
          if (!haveId.has(c.id) && usedNo.has(c.no)) c.no = ++max;
          usedNo.add(c.no); max = Math.max(max, c.no || 0);
          await store.put('cards', c);
        }
        for (const s of ['images', 'diary', 'series', 'meta', 'shotlists']) for (const rec of (data[s] || [])) await store.put(s, rec);
        toast('불러왔어요.');
        location.hash = 'list';
      } catch (e) {
        toast('불러오다가 멈췄어요. 기기 저장 공간이 부족한지 확인해 주세요.');
      }
    }
    drawImport(null);

    const mb = usage != null ? `약 ${(usage / 1048576).toFixed(1)}MB 사용 중` : '';
    const protectBtn = h('button', { class: 'btn small', type: 'button', onclick: async () => {
      let ok = false;
      try { ok = await navigator.storage.persist(); } catch (e) { /* 지원 안 함 */ }
      toast(ok ? '이 기기에서 기록 보호를 켰어요.' : '이 브라우저는 지금 보호를 허락하지 않았어요. 홈 화면에 추가한 뒤 다시 눌러 보세요.');
      if (ok) showBackup();
    } }, '기록 보호 켜기');

    app.replaceChildren(h('div', { class: 'wrap' }, topBar('backup', '기록을 파일로 지키기'),
      h('div', { class: 'diary' },
        h('section', { class: 'sec', id: 'skins' }, h('header', {}, h('h2', {}, '디자인')),
          h('div', { class: 'stepbody', style: 'padding-top:18px' },
            h('p', { class: 'note' }, '화면 모양을 골라요. 기록은 그대로고 겉모습만 바뀌어요.'),
            h('div', { class: 'seg', role: 'group', 'aria-label': '디자인 고르기' }, SKINS.map(([key, name]) =>
              h('button', { class: 'btn' + ((document.documentElement.dataset.skin || '') === key ? ' on' : ''), type: 'button', id: 'skin-' + (key || 'clean'),
                onclick: () => { setSkin(key); showBackup(); } }, name))))),
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '내보내기')),
          h('p', { class: 'note' }, '카드, 이미지, 일기, 시리즈를 전부 파일 하나에 담아요. 기록은 이 기기의 브라우저 안에만 있어서, 이 파일이 유일한 보험이에요. 일주일에 한 번을 추천해요.'),
          PREVIEW ? h('div', { class: 'nudge' }, '지금 보고 있는 미리보기 주소에서는 파일 저장이 막혀 있어요. 정식 주소에서는 이 버튼이 눌려요.') : null,
          h('div', {}, exportBtn), lastLine),
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '불러오기')),
          h('p', { class: 'note' }, '내보낸 파일을 다시 넣어요. 컴퓨터에서 쓴 기록을 폰으로 옮길 때도 이걸 써요.'), importBox),
        h('section', { class: 'sec' }, h('header', {}, h('h2', {}, '이 기기의 기록')),
          h('p', {}, `카드 ${all.cards.length}장 · 일기 ${all.diary.length}일 · 시리즈 ${all.series.length}개` + (mb ? ` · ${mb}` : '')),
          h('p', { class: 'note' }, protect === true
            ? '기록 보호: 켜짐. 브라우저가 저장 공간을 정리할 때 이 앱의 기록은 건드리지 않아요.'
            : '기록 보호: 꺼짐. 오래 안 열면 브라우저가 기록을 정리해 버릴 수 있어요. 특히 아이폰은 홈 화면에 추가하지 않으면 7일쯤 안 쓴 사이트의 기록을 지워요.'),
          protect === true ? null : h('div', {}, protectBtn)))));
    window.scrollTo(0, 0);
  }

  /* ───────── 돌아보기: 로드맵 카운터 + 주간 회고 + 취향 지도 ───────── */
  function tally(items) {
    const m = new Map();
    for (const it of items) { const k = String(it == null ? '' : it).trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m].sort((a, b) => b[1] - a[1]);
  }
  function tasteData(cards) {
    const st = (c, id) => c.steps[id] || {};
    return [
      ['지배색', '4단계에서 지배색으로 적은 색', tally(cards.map((c) => ((st(c, 's4').colors || [])[0] || {}).name))],
      ['구도', '2단계에서 고른 구도', tally(cards.map((c) => st(c, 's2').comp))],
      ['광원 방향', '3단계에서 고른 빛의 방향', tally(cards.flatMap((c) => [].concat(st(c, 's3').dir || [])))],
      ['소품', '6단계 소품 목록에 적은 것', tally(cards.flatMap((c) => String(st(c, 's6').props || '').split(/[,\n·/]+/)))],
      ['"틀린 것"의 종류', '7단계에서 고른 종류', tally(cards.map((c) => st(c, 's7').wrongType))],
      ['핵심 요소', '8단계 지우기 테스트에서 가장 많이 줄어든 것', tally(cards.flatMap(coreElements))],
    ];
  }
  function barChart(title, sub, rows, unit) {
    const top = rows.slice(0, 8);
    const max = top.length ? top[0][1] : 1;
    return h('section', { class: 'sec' }, h('header', {}, h('h2', {}, title), h('span', { class: 'label' }, sub)),
      top.length
        ? h('div', { class: 'bars', role: 'list', 'aria-label': `${title} 막대 그래프` }, top.map(([k, n]) =>
            h('div', { class: 'barrow', role: 'listitem', title: `${k}: ${n}${unit}` },
              h('span', { class: 'barname' }, k),
              h('span', { class: 'bartrack' }, h('span', { class: 'barfill', style: `width:${Math.max(4, (n / max) * 100)}%` })),
              h('span', { class: 'barval' }, n))))
        : h('p', { class: 'note barsempty' }, '아직 자료가 없어요. 이 칸을 채운 카드가 생기면 여기에 쌓여요.'),
      rows.length > 8 ? h('p', { class: 'note' }, `외 ${rows.length - 8}가지`) : null);
  }
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 월요일
    return x;
  }
  function weekStats(cards) {
    const from = weekStart(new Date()).getTime();
    const mine = cards.filter((c) => c.createdAt >= from);
    const picks = [];
    const unk = [];
    for (const c of mine) {
      for (const st of STEPS) for (const f of st.fields) {
        if (f.type === 'choice' && has((c.steps[st.id] || {})[f.k])) picks.push(`${f.label.replace(/ \(.*\)$/, '')}: ${c.steps[st.id][f.k]}`);
        if (f.type === 'choices') for (const v of [].concat((c.steps[st.id] || {})[f.k] || [])) picks.push(`${f.label.replace(/ \(.*\)$/, '')}: ${v}`);
        if (f.type !== 'head' && isUnknown(c, st, f)) unk.push(`${pad(stepNo(st))} ${st.title} · ${f.label}`);
      }
      for (const e of coreElements(c)) picks.push(`핵심 요소: ${e}`);
    }
    return { n: mine.length, repeated: tally(picks).filter(([, n]) => n >= 2), unknown: tally(unk) };
  }
  const DEFAULT_GOALS = { cuts: 30, reshoots: 4, shots: 3, streak: 7 };

  async function showLook() {
    cur = null; savedLabel = null;
    const cards = await store.all('cards');
    const diary = await store.all('diary');
    const shotlists = await store.all('shotlists');
    const metas = await store.all('meta');
    const goals = { id: 'goals', ...DEFAULT_GOALS, ...(metas.find((m) => m.id === 'goals') || {}) };
    const wkId = 'week-' + dstr(weekStart(new Date()));
    const wk = metas.find((m) => m.id === wkId) || { id: wkId, change: '' };
    let timer = null;
    const status = h('span', { class: 'saved mono' });
    const save = async () => { clearTimeout(timer); timer = null; await store.put('meta', goals); await store.put('meta', wk); status.textContent = `자동 저장됨 ${clock()}`; };
    const touchL = () => { status.textContent = '저장 중…'; clearTimeout(timer); timer = setTimeout(save, 400); };
    flushPage = async () => { if (timer) await save(); };

    /* 로드맵 카운터 */
    const counts = {
      cuts: cards.filter(cardDone).length,
      reshoots: cards.filter((c) => c.reshoot && c.reshoot.has).length,
      shots: shotlists.length,
      streak: streakOf(diary),
    };
    const ROAD = [['cuts', '분해한 컷', '끝까지 쓴 카드', '장'], ['reshoots', '재현 촬영', '재현 사진을 올린 카드', '번'], ['shots', '샷리스트', '만든 샷리스트', '개'], ['streak', '세 줄 일기', '연속으로 쓴 날', '일']];
    const road = h('div', { class: 'road' }, ROAD.map(([k, name, sub, unit]) => {
      const fill = h('span', { class: 'barfill' });
      const meter = h('span', { class: 'bartrack', role: 'progressbar', 'aria-valuemin': 0, 'aria-label': `${name} 진행도` }, fill);
      const goalIn = h('input', { class: 'text mono num', id: 'goal-' + k, type: 'number', min: 1, inputMode: 'numeric', value: goals[k], 'aria-label': `${name} 목표`,
        oninput: () => { goals[k] = Math.max(1, parseInt(goalIn.value, 10) || 1); draw(); touchL(); } });
      const big = h('strong', { class: 'roadnum' });
      const draw = () => {
        big.replaceChildren(String(counts[k]), h('span', { class: 'label' }, ` / ${goals[k]}${unit}`));
        fill.style.width = Math.min(100, (counts[k] / goals[k]) * 100) + '%';
        meter.setAttribute('aria-valuenow', counts[k]); meter.setAttribute('aria-valuemax', goals[k]);
        tile.classList.toggle('reached', counts[k] >= goals[k]);
      };
      const tile = h('div', { class: 'roadtile' }, h('span', { class: 'label' }, name), big, meter,
        h('span', { class: 'note' }, sub),
        h('label', { class: 'goalrow label', for: 'goal-' + k }, '목표 ', goalIn));
      draw();
      return tile;
    }));

    /* 주간 회고 */
    const ws = weekStats(cards);
    const from = weekStart(new Date()); const to = new Date(from); to.setDate(to.getDate() + 6);
    const change = h('textarea', { class: 'text area', id: 'week-change', rows: 2, placeholder: '다음 주에는 무엇을 다르게 볼까. 딱 하나만.', value: wk.change,
      oninput: () => { wk.change = change.value; touchL(); } });
    grow(change);
    const changeField = h('div', { class: 'field' }, h('label', { class: 'label', for: 'week-change' }, '다음 주에 바꿀 것 1개'), change);
    watchVague([change], changeField);
    const past = metas.filter((m) => m.id.startsWith('week-') && m.id !== wkId && has(m.change)).sort((a, b) => (a.id < b.id ? 1 : -1));
    const week = h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '이번 주 회고'), h('span', { class: 'label mono' }, `${dstr(from).slice(5)} ~ ${dstr(to).slice(5)}`)),
      h('div', { class: 'stepbody' },
        h('p', { class: 'note' }, `이번 주에 만든 카드 ${ws.n}장.` + (new Date().getDay() === 0 ? ' 오늘이 일요일이에요. 한 주를 정리할 때예요.' : ' 일요일에 한 번 정리하면 좋아요.')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '이번 주에 반복된 결정 (2번 이상 고른 것)'),
          ws.repeated.length ? h('ul', { class: 'plain' }, ws.repeated.slice(0, 8).map(([k, n]) => h('li', {}, k, h('span', { class: 'label' }, `  ${n}번`))))
            : h('p', { class: 'note' }, '아직 두 번 이상 겹친 선택이 없어요.')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, '가장 많이 "모르겠음"을 누른 칸'),
          ws.unknown.length ? h('ul', { class: 'plain' }, ws.unknown.slice(0, 5).map(([k, n]) => h('li', {}, k, h('span', { class: 'label' }, `  ${n}번`))))
            : h('p', { class: 'note' }, '이번 주에는 "모르겠음"이 없어요.')),
        changeField,
        past.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, '지난 주들에 적은 것'),
          h('ul', { class: 'plain' }, past.slice(0, 8).map((m) => h('li', {}, h('span', { class: 'label mono' }, m.id.slice(5) + '  '), m.change)))) : null));

    /* 취향 지도 */
    const done1 = cards.filter((c) => stepDone(c, STEPS[0]));
    const charts = tasteData(cards).map(([t, sub, rows]) => barChart(t, sub, rows, '장'));

    app.replaceChildren(h('div', { class: 'wrap' }, topBar('look', '쌓인 기록에서 내 취향 찾기'),
      h('div', { class: 'look' },
        h('div', { class: 'fieldtop' }, h('h2', { class: 'lookh' }, '로드맵'), status), road,
        week,
        h('div', { class: 'fieldtop' }, h('h2', { class: 'lookh' }, '취향 지도'), h('span', { class: 'label' }, `카드 ${cards.length}장 기준`)),
        cards.length < 3 ? h('p', { class: 'note' }, '카드가 몇 장 더 쌓여야 무늬가 보여요. 지금은 있는 만큼만 보여줘요.') : null,
        h('div', { class: 'charts' }, charts))));
    window.scrollTo(0, 0);
    void done1;
  }

  function topBar(active, sub, action) {
    const tab = (key, name, hash) => h('button', { class: 'tab' + (active === key ? ' on' : ''), type: 'button', id: 'tab-' + key,
      'aria-current': active === key ? 'page' : null, onclick: () => { location.hash = hash; } }, name);
    return h('div', { class: 'top' },
      h('div', {},
        h('h1', {}, 'DOPEYE'),
        h('div', { class: 'sub' }, sub)),
      h('div', { class: 'row' },
        h('nav', { class: 'tabs', 'aria-label': '화면 이동' }, tab('list', '카드', 'list'), tab('series', '시리즈', 'series'), tab('diary', '일기', 'diary'), tab('look', '돌아보기', 'look'), tab('backup', '백업', 'backup')),
        action || null));
  }

  async function route() {
    const name = location.hash.replace(/^#/, '');
    const sameCard = inEditor && cur && name === 'card-' + cur.id;
    if (!sameCard) inEditor = false;
    if (flushPage) { await flushPage(); flushPage = null; }
    diaryPaste = null;
    if (name === 'diary') return showDiary();
    if (name === 'backup') return showBackup();
    if (name === 'look') return showLook();
    if (name === 'series') return showSeriesList();
    if (name.startsWith('series-')) return showSeries(name.slice(7));
    if (name === 'new') return showCard(null);
    if (name.startsWith('card-')) {
      const id = name.slice(5);
      if (cur && cur.id === id && curPersisted && inEditor && app.firstChild) return;
      return showCard(id);
    }
    if (name.startsWith('view-')) return showView(name.slice(5));
    if (name.startsWith('shots-')) return showShots(name.slice(6));
    if (name.startsWith('again-')) return showAgain(name.slice(6));
    if (name.startsWith('compare-')) return showCompare(name.slice(8));
    return showList();
  }
  window.addEventListener('hashchange', route);
  openDB().then(route);
  if (!PREVIEW && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
