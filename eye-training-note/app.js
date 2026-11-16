/* 눈 훈련 노트 — 개발 1단계: 이미지 올리기 + 카드 저장 + 기본 정보 + 분석 1단계(첫 반응) */
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
  const mem = { cards: new Map(), images: new Map() };

  function openDB() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' });
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
  const LOCKED_STEPS = ['시선과 프레임', '빛', '색', '질감과 재질', '인물과 소품 연출', '일부러 틀린 것',
    '지우기 테스트', '비교', '디렉터의 눈', '정리'];
  function step1Done(c) {
    const s = c.steps.s1;
    return !!(s.feel.trim() && s.words.every((w) => w.trim()) && s.score != null);
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
  function watchVague(input, holder) {
    const nudge = h('div', { class: 'nudge', hidden: true });
    holder.append(nudge);
    const check = () => {
      const found = vagueIn(input.value);
      nudge.hidden = !found.length;
      nudge.textContent = found.length ? `"${found.join('", "')}" → 구체적으로 뭐가 어떻게?` : '';
    };
    input.addEventListener('input', check);
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
  window.addEventListener('pagehide', () => { if (saveTimer) saveNow(); });

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
    wrap.append(h('div', { class: 'top' },
      h('div', {},
        h('h1', {}, '눈 훈련 노트'),
        h('div', { class: 'sub' }, cards.length ? `분해한 컷 ${cards.length}장` : '내가 먼저 쓰고, 앱은 돕기만 한다')),
      h('button', { class: 'btn solid', id: 'new-card', onclick: () => { location.hash = 'new'; } }, '+ 새 카드')));

    if (!cards.length) {
      wrap.append(h('div', { class: 'empty' },
        h('strong', {}, '아직 카드가 없어요'),
        h('p', {}, '끌리는 이미지 한 장을 올리고, 누구의 해석도 보기 전에 내 첫 반응부터 적어 보세요. 올린 이미지는 여기에 콘택트 시트처럼 쌓여요.'),
        h('button', { class: 'btn solid', onclick: () => { location.hash = 'new'; } }, '첫 카드 만들기')));
    } else {
      const sheet = h('div', { class: 'sheet' });
      for (const c of cards) {
        const done = step1Done(c);
        const src = c.image.kind === 'url' ? c.image.url : c.thumb;
        const pic = src
          ? h('img', { class: 'pic', src, alt: '', loading: 'lazy',
              onerror: (e) => e.target.replaceWith(h('div', { class: 'nopic' }, '링크 이미지를 불러올 수 없어요')) })
          : h('div', { class: 'nopic' }, '이미지 없음');
        const feel = c.steps.s1.feel.trim();
        sheet.append(h('button', { class: 'tile', onclick: () => { location.hash = 'card-' + c.id; } },
          pic,
          h('div', { class: 'meta mono' },
            h('span', {}, `No.${pad(c.no, 3)} · ${c.date}`),
            h('span', {}, c.steps.s1.score != null ? `${c.steps.s1.score}/10` : '')),
          h('div', { class: 'feel' }, feel ? `${feel}한 느낌` : '첫 반응을 아직 안 썼어요'),
          h('div', { class: 'meta' },
            h('span', {}, c.tags.map((t) => '#' + t).join(' ')),
            h('span', { class: 'chip-state' + (done ? ' done' : '') }, done ? '1단계 완료' : '쓰는 중'))));
      }
      wrap.append(sheet);
    }
    app.replaceChildren(wrap);
    window.scrollTo(0, 0);
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
    if (!cur || cur.image.kind !== 'none') return;
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); takeFile(file); }
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
      h('button', { class: 'btn quiet', onclick: () => { location.hash = 'list'; } }, '← 목록'),
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
    if (c.image.kind !== 'none') body.append(buildForm(c));
    wrap.append(body);
    app.replaceChildren(wrap);
  }

  function buildForm(c) {
    const s1 = c.steps.s1;

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
        touch();
      } }, '모름');

    const trustBox = h('div', { class: 'seg', role: 'group', 'aria-label': '출처 신뢰도' });
    const trustNote = h('p', { class: 'note' });
    function drawTrust() {
      trustBox.replaceChildren(...TRUST.map(([key, name]) =>
        h('button', { class: 'btn small' + (c.trust === key ? ' on' : ''), type: 'button', 'aria-pressed': String(c.trust === key),
          onclick: () => { c.trust = c.trust === key ? '' : key; drawTrust(); touch(); } }, name)));
      trustNote.hidden = c.trust !== 'unknown';
      trustNote.textContent = '출처를 모르는 이미지예요. 감독의 의도에 대한 해석은 나중에 "추정"으로 구분해서 적게 돼요.';
    }
    drawTrust();

    const basic = h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '기본 정보')),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-date' }, '날짜'), date),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-tag' }, '태그'), tagBox, tagInput),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'f-source' }, '출처 / 크레딧'), h('div', { class: 'row' }, src, srcUnknown)),
      h('div', { class: 'field' }, h('span', { class: 'label' }, '출처 신뢰도'), trustBox, trustNote));

    /* ── 1단계: 첫 반응 ── */
    const badge = h('span', { class: 'chip-state' });
    const lockNote = h('p', { class: 'note' });
    function drawDone() {
      const done = step1Done(c);
      badge.textContent = done ? '완료' : '쓰는 중';
      badge.classList.toggle('done', done);
      lockNote.textContent = done
        ? '1단계를 끝냈어요. 아래 단계들은 다음 업데이트에서 열려요.'
        : '느낌 한 줄, 단어 3개, 점수를 모두 채우면 1단계가 끝나요. 그래야 다음 단계가 열려요.';
    }

    const feel = h('input', { class: 'text', id: 'f-feel', placeholder: '여기에', value: s1.feel, maxLength: 60,
      oninput: () => { s1.feel = feel.value; drawDone(); touch(); } });
    const feelField = h('div', { class: 'field' },
      h('label', { class: 'label', for: 'f-feel' }, '느낌 한 줄'),
      h('div', { class: 'feelline' }, h('span', {}, '이건'), feel, h('span', {}, '한 느낌')));
    watchVague(feel, feelField);

    const wordsField = h('div', { class: 'field' }, h('span', { class: 'label' }, '떠오른 단어 3개'));
    const wordsRow = h('div', { class: 'words' });
    wordsField.append(wordsRow);
    s1.words.forEach((w, i) => {
      const inp = h('input', { class: 'text', id: `f-word-${i + 1}`, placeholder: `단어 ${i + 1}`, value: w, maxLength: 20,
        'aria-label': `떠오른 단어 ${i + 1}`,
        oninput: () => { s1.words[i] = inp.value; drawDone(); touch(); } });
      wordsRow.append(inp);
      watchVague(inp, wordsField);
    });

    const scoreBox = h('div', { class: 'score', role: 'group', 'aria-label': '좋음 점수' });
    function drawScore() {
      scoreBox.replaceChildren(...Array.from({ length: 10 }, (_, i) => i + 1).map((n) =>
        h('button', { class: 'btn' + (s1.score === n ? ' on' : ''), type: 'button', 'aria-pressed': String(s1.score === n),
          onclick: () => { s1.score = s1.score === n ? null : n; drawScore(); drawDone(); touch(); } }, n)));
    }
    drawScore();
    drawDone();

    const first = h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '1단계 · 첫 반응'), badge),
      feelField, wordsField,
      h('div', { class: 'field' }, h('span', { class: 'label' }, '좋음 점수 (1~10)'), scoreBox));

    const locked = h('section', { class: 'sec' },
      h('header', {}, h('h2', {}, '다음 단계'), h('span', { class: 'chip-state' }, '잠김')),
      lockNote,
      h('ol', { class: 'locked' }, LOCKED_STEPS.map((name, i) =>
        h('li', {}, h('span', { class: 'n' }, pad(i + 2)), h('span', {}, name)))));

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

    return h('div', { class: 'form' }, basic, first, locked, danger);
  }

  async function removeCard() {
    const id = cur.id;
    clearTimeout(saveTimer); saveTimer = null;
    curPersisted = false;
    await store.del('cards', id);
    await store.del('images', id);
    toast('카드를 지웠어요.');
    location.hash = 'list';
  }

  /* ───────── 길 찾기 ───────── */
  function route() {
    const name = location.hash.replace(/^#/, '');
    if (name === 'new') return showCard(null);
    if (name.startsWith('card-')) {
      const id = name.slice(5);
      if (cur && cur.id === id && curPersisted && app.firstChild) return;
      return showCard(id);
    }
    return showList();
  }
  window.addEventListener('hashchange', route);
  openDB().then(route);
})();
