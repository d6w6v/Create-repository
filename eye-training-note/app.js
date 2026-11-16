/* 눈 훈련 노트 — 개발 2단계까지: 카드 저장 + 분석 1~11단계 + 잠금 + 모르겠음 + 빠른 버전 + 한 장 보기 */
(() => {
  'use strict';
  document.documentElement.lang = 'ko';

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
  const mem = { cards: new Map(), images: new Map(), diary: new Map(), meta: new Map(), series: new Map() };

  function openDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 3);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
          for (const name of ['images', 'diary', 'meta', 'series']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
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
  };

  /* ───────── 카드 모양 ───────── */
  function newCard(no) {
    const now = Date.now();
    return {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      no, type: 'still', mode: 'full',
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
      { k: 'gaze', label: '눈이 간 순서와 이유', type: 'rows', quick: true, rowLabels: ['①', '②', '③'],
        cols: [{ k: 'where', label: '눈이 간 곳', type: 'text' }, { k: 'why', label: '이유', type: 'choice', options: WHY }] },
      T('longest', '눈이 가장 오래 머문 곳', { quick: true }),
      { k: 'subjectPct', label: '주인공이 차지하는 비율 (약)', type: 'num', unit: '%' },
      { k: 'emptyPct', label: '빈 공간 비율 (약)', type: 'num', unit: '%' },
      C('camHeight', '카메라 높이', ['바닥', '허리', '눈높이', '위']),
      C('angle', '앵글', ['로우', '아이레벨', '하이']),
      C('lens', '화각 인상', ['광각', '중간', '망원']),
      C('comp', '구도', ['중앙', '3분할', '대칭', '대각선', '여백']),
      T('crop', '잘라낸 것(크롭)이 있다면 무엇을 뺐나', { opt: true }) ] },
    { id: 's3', title: '빛', fields: [
      { k: 'lights', label: '광원 개수', type: 'num', unit: '개' },
      C('dir', '방향', ['정면', '측면', '역광', '위', '아래']),
      C('quality', '질감', ['부드러움', '딱딱함']),
      C('contrast', '명암 대비', ['큼', '작음']),
      T('shadow', '그림자 위치와 진하기'),
      T('brightest', '가장 밝은 곳'),
      T('darkest', '가장 어두운 곳'),
      T('mood', '빛이 만든 분위기') ] },
    { id: 's4', title: '색', fields: [
      { k: 'colors', label: '색 비율', type: 'rows', rowLabels: ['지배색', '보조색', '포인트색'],
        cols: [{ k: 'name', label: '무슨 색', type: 'text' }, { k: 'pct', label: '비율', type: 'num', unit: '%' }] },
      C('temp', '색온도', ['따뜻', '차가움', '섞임']),
      C('sat', '채도', ['높음', '낮음']),
      T('repeat', '색이 반복되는 곳'),
      T('pop', '튀는 색 1개는 어디에 있나') ] },
    { id: 's5', title: '질감과 재질', fields: [
      { k: 'materials', label: '화면의 재질 3가지', type: 'multi', n: 3, ph: '재질' },
      T('gloss', '번들거림 vs 무광 대비가 있나'),
      T('grain', '필름 그레인'),
      T('sharp', '선명도'),
      T('grade', '보정 방향') ] },
    { id: 's6', title: '인물과 소품 연출', fields: [
      T('eyes', '시선 방향'),
      T('face', '표정'),
      T('pose', '손/자세가 말하는 것'),
      A('props', '소품 목록 (전부)'),
      T('era', '시대감을 만드는 것') ] },
    { id: 's7', title: '일부러 틀린 것', interp: true, fields: [
      T('wrong', '"원래라면 안 그럴 텐데" 싶은 것 1개'),
      T('effect', '그게 만드는 효과') ] },
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
  function visibleFields(c, st) {
    if (c.mode === 'quick' && st.fields.some((f) => f.quick)) return st.fields.filter((f) => f.quick);
    return st.fields;
  }
  const fid = (st, f) => st.id + '.' + f.k;
  const isUnknown = (c, st, f) => c.unknown.includes(fid(st, f));
  function val(c, st, f) {
    const d = c.steps[st.id] || (c.steps[st.id] = {});
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
    if (f.type === 'multi') return v.every(has);
    if (f.type === 'rows') return v.every((r) => f.cols.every((col) => has(r[col.k])));
    if (f.type === 'erase') return ERASE.every((n) => v[n] != null);
    return has(v);
  }
  function hasAny(c, st, f) {
    const v = val(c, st, f);
    if (f.type === 'multi') return v.some(has);
    if (f.type === 'rows') return v.some((r) => f.cols.some((col) => has(r[col.k])));
    if (f.type === 'erase') return ERASE.some((n) => v[n] != null);
    return has(v);
  }
  const realFields = (c, st) => visibleFields(c, st).filter((f) => f.type !== 'head');
  const fieldOk = (c, st, f) => f.opt || isUnknown(c, st, f) || filled(c, st, f);
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
    if (f.type === 'feel') return has(v) ? `이건 ${v}한 느낌` : '';
    if (f.type === 'multi') return v.filter(has).join(' / ');
    if (f.type === 'scale') return v != null ? `${v}/10` : '';
    if (f.type === 'num') return has(v) ? `${v}${f.unit}` : '';
    if (f.type === 'erase') return ERASE.filter((n) => v[n] != null).map((n) => `${n} ${v[n]}`).join(', ');
    if (f.type === 'rows') return v.map((r, i) => {
      const parts = f.cols.filter((col) => has(r[col.k])).map((col) => r[col.k] + (col.unit || ''));
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
      function draw() {
        const ts = terms();
        const hit = cards.filter((c) => {
          const text = cardText(c);
          return ts.every((t) => t.startsWith('#') ? c.tags.some((x) => x.toLowerCase() === t.slice(1)) : text.includes(t));
        });
        sheet.replaceChildren(...hit.map(tile));
        count.hidden = !ts.length;
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
      wrap.append(h('div', { class: 'searchbar' }, search, tagBox, count), sheet);
    }
    app.replaceChildren(wrap);
    window.scrollTo(0, 0);
  }
  let listQuery = '';
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
        h('span', {}, `No.${pad(c.no, 3)} · ${c.date}`),
        h('span', {}, c.steps.s1.score != null ? `${c.steps.s1.score}/10` : '')),
      h('div', { class: 'feel' }, feel ? `${feel}한 느낌` : '첫 반응을 아직 안 썼어요'),
      h('div', { class: 'meta' },
        h('span', {}, c.tags.map((t) => '#' + t).join(' ')),
        h('span', { class: 'chip-state' + (pr.done ? ' done' : '') },
          (c.mode === 'quick' ? '5분 · ' : '') + (pr.done ? '완료' : `${pr.n}/${pr.total}단계`))));
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
      cur = newCard(all.reduce((m, c) => Math.max(m, c.no || 0), 0) + 1);
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
    const wrap = h('div', { class: 'wrap' });
    savedLabel = h('span', { class: 'saved mono' }, curPersisted ? '자동 저장됨' : '이미지를 올리면 저장이 시작돼요');
    wrap.append(h('div', { class: 'bar' },
      h('div', { class: 'row' },
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'list'; } }, '← 목록'),
        curPersisted ? h('button', { class: 'btn quiet', id: 'to-view', onclick: () => { location.hash = 'view-' + c.id; } }, '한 장으로 보기') : null),
      h('div', { class: 'slate mono' }, h('strong', {}, `No.${pad(c.no, 3)}`), h('span', {}, '스틸'), savedLabel)));

    /* 왼쪽: 이미지 */
    const stage = h('div', { class: 'stage' });
    if (c.image.kind === 'none') {
      const link = h('input', { class: 'text', id: 'img-link', type: 'url', placeholder: '이미지 주소 붙여넣기 (https://…)',
        onkeydown: (e) => { if (e.key === 'Enter') takeLink(link.value); } });
      const drop = h('div', { class: 'drop' },
        h('p', { class: 'big' }, '분석할 이미지 한 장'),
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
    if (c.image.kind !== 'none') body.append(buildForm(c, (await store.all('series')).filter((x) => x.cardIds.includes(c.id))));
    wrap.append(body);
    app.replaceChildren(wrap);
  }

  function grow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }

  /* 칸 하나 그리기 */
  function buildField(c, st, f, changed) {
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
      control = h('div', { class: 'rows' }, data[f.k].map((row, i) =>
        h('div', { class: 'rowitem' },
          h('span', { class: 'rowlabel mono' }, f.rowLabels[i]),
          h('div', { class: 'rowcells' + (f.cols.some((col) => col.type === 'num') ? ' inline' : '') }, f.cols.map((col) => {
            const al = `${f.rowLabels[i]} ${col.label}`;
            if (col.type === 'choice') return choice(col.options, () => row[col.k], (v) => { row[col.k] = v; }, al);
            if (col.type === 'num') return numInput(() => row[col.k], (v) => { row[col.k] = v; }, col.unit, { 'aria-label': al });
            return textInput(() => row[col.k], (v) => { row[col.k] = v; }, { placeholder: col.label, 'aria-label': al, id: `${dom}-${i + 1}-${col.k}` });
          })))));
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

    const set = h('fieldset', { class: 'ctl', disabled: isUnknown(c, st, f) }, control);
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
    if (extra) holder.append(extra);
    if (texts.length) watchVague(texts, holder);
    return holder;
  }

  function buildForm(c, mySeries) {
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

    form.append(h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '기본 정보')),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-date' }, '날짜'), date),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-tag' }, '태그'), tagBox, tagInput),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-source' }, '출처 / 크레딧'), h('div', { class: 'row' }, src, srcUnknown)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '출처 신뢰도'), trustBox, trustNote),
      mySeries.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, '들어 있는 시리즈'),
        h('div', { class: 'seg' }, mySeries.map((x) =>
          h('button', { class: 'btn small', type: 'button', onclick: () => { location.hash = 'series-' + x.id; } }, x.name)))) : null));

    /* ── 쓰는 방식: 전체 / 빠른 버전 ── */
    const setMode = async (m) => { if (c.mode === m) return; c.mode = m; await saveNow(); await renderCard(); };
    form.append(h('div', { class: 'field' },
      h('span', { class: 'label' }, '쓰는 방식'),
      h('div', { class: 'seg', role: 'group', 'aria-label': '쓰는 방식' },
        h('button', { class: 'btn small' + (c.mode !== 'quick' ? ' on' : ''), type: 'button', id: 'mode-full', onclick: () => setMode('full') }, '전체 버전 (11단계)'),
        h('button', { class: 'btn small' + (c.mode === 'quick' ? ' on' : ''), type: 'button', id: 'mode-quick', onclick: () => setMode('quick') }, '빠른 버전 (5분)')),
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
      for (const f of visibleFields(c, u.st)) u.body.append(buildField(c, u.st, f, changed));
      u.built = true;
    }

    /* ── 모르겠음 모음 ── */
    const unkList = h('ul', { class: 'unklist' });
    const unkSec = h('section', { class: 'sec', hidden: true },
      h('header', {}, h('h2', {}, '모르겠음으로 남긴 칸')),
      h('p', { class: 'note' }, '다음에 다시 볼 때 여기부터 채워 보세요. 누르면 그 칸으로 가요.'), unkList);
    const finish = h('div', { class: 'finish', hidden: true });
    form.append(unkSec, finish);

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
      finish.hidden = !(allDone || c.mode === 'quick');
      finish.replaceChildren(
        allDone ? h('p', { class: 'note' }, c.mode === 'quick' ? '빠른 버전을 다 썼어요.' : '11단계를 모두 썼어요.') : null,
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
    form.append(danger);
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
      h('div', { class: 'mono' }, `No.${pad(c.no, 3)} · 스틸 · ${c.date}` + (c.mode === 'quick' ? ' · 빠른 버전' : '')),
      h('div', {}, [c.source.unknown ? '출처 모름' : c.source.text.trim(), trustName ? `신뢰도: ${trustName}` : '', c.tags.map((t) => '#' + t).join(' ')]
        .filter(Boolean).join('  ·  '))));
    const lead = h('div', { class: 'opLead' });
    if (src) lead.append(h('img', { src, alt: '', onerror: (e) => e.target.remove() }));
    const leadText = h('div', { class: 'opLeadText' });
    if (has(s11.final)) leadText.append(h('p', { class: 'opFinal' }, s11.final.trim()));
    if (core.length) leadText.append(h('p', {}, h('span', { class: 'label' }, '핵심 요소 '), h('strong', {}, core.join(' · '))));
    lead.append(leadText);
    page.append(lead);

    const cols = h('div', { class: 'opCols' });
    const unk = [];
    for (const st of STEPS) {
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
        h('button', { class: 'btn quiet', onclick: () => { location.hash = 'list'; } }, '목록')),
      page));
    window.scrollTo(0, 0);
  }

  async function removeCard() {
    const id = cur.id;
    clearTimeout(saveTimer); saveTimer = null;
    curPersisted = false;
    await store.del('cards', id);
    await store.del('images', id);
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

  function topBar(active, sub, action) {
    const tab = (key, name, hash) => h('button', { class: 'tab' + (active === key ? ' on' : ''), type: 'button', id: 'tab-' + key,
      'aria-current': active === key ? 'page' : null, onclick: () => { location.hash = hash; } }, name);
    return h('div', { class: 'top' },
      h('div', {},
        h('h1', {}, '눈 훈련 노트'),
        h('div', { class: 'sub' }, sub)),
      h('div', { class: 'row' },
        h('nav', { class: 'tabs', 'aria-label': '화면 이동' }, tab('list', '카드', 'list'), tab('series', '시리즈', 'series'), tab('diary', '일기', 'diary')),
        action || null));
  }

  async function route() {
    const name = location.hash.replace(/^#/, '');
    if (flushPage) { await flushPage(); flushPage = null; }
    diaryPaste = null;
    if (name === 'diary') return showDiary();
    if (name === 'series') return showSeriesList();
    if (name.startsWith('series-')) return showSeries(name.slice(7));
    if (name === 'new') return showCard(null);
    if (name.startsWith('card-')) {
      const id = name.slice(5);
      if (cur && cur.id === id && curPersisted && app.firstChild) return;
      return showCard(id);
    }
    if (name.startsWith('view-')) return showView(name.slice(5));
    return showList();
  }
  window.addEventListener('hashchange', route);
  openDB().then(route);
})();
