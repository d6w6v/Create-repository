/* DOPEYE (눈 훈련 노트) — 개발 2단계까지: 카드 저장 + 분석 1~11단계 + 잠금 + 모르겠음 + 빠른 버전 + 한 장 보기 */
(() => {
  'use strict';
  document.documentElement.lang = 'ko';
  /* 디자인 시안 고르기 (이 기기에만 기억) */
  const SKINS = [['school', '교재'], ['', '깔끔'], ['editorial', '매거진'], ['studio', '스튜디오'], ['pop', '팝']];
  function setSkin(name) {
    if (name) document.documentElement.dataset.skin = name; else delete document.documentElement.dataset.skin;
    try { localStorage.setItem('eye-skin', name); } catch (e) { /* 기억 못 해도 그냥 진행 */ }
  }
  const APP_VERSION = '23 · 전문용어판';
  try {
    // 교재 디자인을 기본으로 바꾸면서, 예전에 골라 둔 디자인을 한 번만 교재로 맞춘다
    if (localStorage.getItem('eye-skin-reset') !== '1') { localStorage.setItem('eye-skin', 'school'); localStorage.setItem('eye-skin-reset', '1'); }
    setSkin(new URLSearchParams(location.search).get('skin') ?? localStorage.getItem('eye-skin') ?? 'school');
  } catch (e) { document.documentElement.dataset.skin = 'school'; }
  const PREVIEW = !!window.EYE_PREVIEW; // 미리보기 주소에서는 파일 저장과 인쇄가 막혀 있다

  /* 화면 조각을 바꿔 끼울 때 빈 것(null)은 건너뛴다 */
  const nativeReplace = Element.prototype.replaceChildren;
  Element.prototype.replaceChildren = function (...kids) {
    return nativeReplace.apply(this, kids.flat().filter((k) => k != null && k !== false));
  };
  const nativeAppend = Element.prototype.append;
  Element.prototype.append = function (...kids) {
    return nativeAppend.apply(this, kids.flat().filter((k) => k != null && k !== false));
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
      { ...C('shotSize', '샷 크기 (숏 사이즈)', ['익스트림 롱', '롱', '풀', '미디엄 풀(카우보이)', '미디엄', '바스트', '클로즈업', '익스트림 클로즈업', '인서트']),
        help: '인물이 화면에 얼마나 담겼는지예요. 익스트림 롱(ELS)은 풍경 속 점, 롱(LS)은 전신과 주변, 풀(FS)은 머리부터 발끝, 미디엄 풀(MFS)은 허벅지 위(서부극 총집이 보여서 카우보이 샷), 미디엄(MS)은 허리 위, 바스트(MCU)는 가슴 위, 클로즈업(CU)은 얼굴, 익스트림 클로즈업(ECU)은 눈이나 입만, 인서트는 손이나 물건만 따로 찍은 컷이에요.' },
      C('camHeight', '카메라 높이 (카메라 레벨)', ['바닥', '무릎', '허리', '가슴', '눈높이', '위', '공중']),
      { k: 'angle', label: '앵글 (기울였으면 더치도 함께 골라요)', type: 'choices', options: ['웜즈 아이', '로우', '아이레벨', '하이', '버즈 아이', '더치 틸트', '오버 더 숄더', '시점 샷(POV)'] },
      C('lens', '화각 인상 (렌즈)', ['어안', '초광각', '광각', '중간', '망원', '초망원', '매크로']),
      { ...C('dof', '심도 (피사계 심도)', ['얕음', '중간', '깊음']),
        help: '초점이 맞는 앞뒤 범위예요. 얕음(섈로 포커스)은 배경이 크게 흐려 인물만 또렷하고, 깊음(딥 포커스, 팬 포커스)은 앞에서 뒤까지 다 또렷해요. 흐려진 배경의 빛망울을 보케라고 해요.' },
      { k: 'comp', label: '구도 (겹치면 여러 개 골라요)', type: 'choices', options: ['중앙', '3분할', '황금비', '대칭', '대각선', '삼각형', '리딩 라인', '프레임 속 프레임', '방사형', 'S자 곡선', '패턴·반복', '레이어', '여백'] },
      T('crop', '잘라낸 것(크롭)이 있다면 무엇을 뺐나', { opt: true }),
      A('sum', '이 단계의 한 줄 결론: 가장 큰 결정 하나와 그 효과', { deep: true }) ] },
    { id: 's3', title: '빛', fields: [
      { k: 'lights', label: '광원 개수', type: 'num', unit: '개' },
      { k: 'dir', label: '방향 (광원이 여러 개면 여러 개 골라요)', type: 'choices', options: ['정면', '앞사선', '측면', '뒤사선', '역광', '위', '아래'] },
      { k: 'side', label: '빛이 오는 쪽', type: 'choices', options: ['왼쪽', '가운데', '오른쪽'] },
      { k: 'elev', label: '빛의 높이', type: 'choices', options: ['아래(언더)', '눈높이', '위 45도', '머리 위(탑)'],
        help: '턱 아래와 눈두덩의 그림자로 알 수 있어요. 눈두덩이 검게 꺼지면 머리 위(탑 라이트), 턱 밑이 밝고 이마가 어두우면 아래(언더 라이트, 공포 영화의 빛), 코 그림자가 비스듬히 아래로 떨어지면 위 45도예요.' },
      { k: 'pattern', label: '얼굴 조명 패턴 (인물이 있으면)', type: 'choices', options: ['플랫', '버터플라이', '루프', '렘브란트', '스플릿', '브로드', '쇼트', '림', '실루엣', '키아로스쿠로', '해당 없음'],
        help: '인물 사진에서 쓰는 이름들이에요. 플랫: 그림자가 거의 없음. 버터플라이(파라마운트): 정면 위에서 비춰 코 밑에 나비 모양 그림자. 루프: 코 그림자가 뺨에 작은 고리. 렘브란트: 어두운 쪽 뺨에 역삼각형 빛 한 조각. 스플릿: 얼굴을 반으로 가름. 브로드: 카메라 쪽 넓은 뺨이 밝음. 쇼트: 카메라 반대쪽 좁은 뺨이 밝음(얼굴이 갸름해 보임). 림: 가장자리에만 빛의 선. 실루엣: 인물이 검은 윤곽만. 키아로스쿠로: 어둠 속에서 일부만 강하게 드러남.' },
      { k: 'kind', label: '광원의 종류 (추정)', type: 'choices', options: ['태양', '흐린 하늘', '창문광', '프랙티컬', '플래시', '지속광', '네온·컬러 젤', '불·촛불'],
        help: '프랙티컬은 스탠드나 간판처럼 화면 안에 보이는 실제 등이에요. 플래시(스트로보)는 순간광이라 움직임이 얼어붙고 그림자가 딱딱해요. 지속광은 LED나 텅스텐처럼 계속 켜 두는 조명이에요. 컬러 젤은 조명 앞에 대는 색 필터예요.' },
      { k: 'lightTemp', label: '빛의 색온도', type: 'choices', options: ['텅스텐(주황)', '주광(흰색)', '그늘·흐림(푸름)', '컬러 조명', '혼합'],
        help: '색온도는 켈빈(K)으로 말해요. 촛불과 텅스텐 전구는 2000~3200K로 주황, 한낮 햇빛은 5600K 안팎으로 흰색, 그늘과 흐린 날은 6500K 이상으로 푸르게 보여요. 두 가지가 한 화면에 있으면 혼합(믹스드 라이팅)이에요.' },
      { k: 'modifier', label: '빛을 다듬은 흔적 (추정)', type: 'choices', options: ['디퓨전·소프트박스', '바운스(반사판)', '네거티브 필', '고보(무늬)', '스누트·그리드', '헤이즈(안개)', '없어 보임'],
        help: '디퓨전은 빛 앞에 천을 대 부드럽게 한 것, 바운스는 벽이나 반사판에 튕긴 빛, 네거티브 필은 검은 천으로 빛을 빨아들여 그림자를 더 깊게 한 것, 고보는 블라인드나 나뭇잎 무늬를 드리운 것, 스누트와 그리드는 빛을 좁은 원으로 모은 것, 헤이즈는 공기에 연무를 넣어 빛줄기가 보이게 한 것이에요.' },
      C('quality', '빛의 질 (소프트 / 하드)', ['부드러움', '중간', '딱딱함']),
      C('contrast', '명암 대비 (콘트라스트)', ['작음', '보통', '큼']),
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
  /* ───────── 교재: 용어 설명과, 깊게 파기에서만 열리는 촘촘한 칸들 ───────── */
  const HELP = {
    's1.feel': '첫 반응은 분석이 아니라 기록이에요. 3초 안에 든 느낌을 그대로 적어요. 끝까지 쓴 뒤, 분석이 이 느낌을 설명하는지 돌아와서 확인해요.',
    's1.words': '설명하는 말 말고 떠오른 말이에요. 사물 이름, 온도, 소리, 사람 이름 무엇이든 돼요.',
    's2.gaze': '시선 유도. 눈은 보통 가장 밝은 곳, 대비가 센 곳, 얼굴(특히 눈), 선이 모이는 곳으로 먼저 가요. 이유는 가장 큰 것 하나만 골라요.',
    's2.subjectPct': '눈대중이면 충분해요. 화면을 가로세로 3등분한 9칸 중 몇 칸을 차지하는지 세면 쉬워요. 한 칸이 약 11%예요.',
    's2.emptyPct': '빈 공간(네거티브 스페이스)은 주인공도 소품도 아닌 면적이에요. 하늘, 벽, 어둠, 바닥 같은 곳이에요.',
    's2.camHeight': '지평선, 또는 바닥과 벽이 만나는 선이 인물의 어디를 지나가는지 보면 알 수 있어요. 그 선이 허리를 지나면 카메라가 허리 높이(힙 레벨)예요. 바닥은 그라운드 레벨, 무릎은 니 레벨, 가슴은 숄더 레벨 바로 아래, 눈높이는 아이 레벨, 위는 인물 머리보다 높은 자리(오버헤드), 공중은 크레인이나 드론 높이예요.',
    's2.angle': '카메라가 고개를 든 방향이에요. 웜즈 아이(벌레의 눈)는 바닥에서 거의 수직으로 올려다봄, 로우는 아래에서 위로(인물이 커 보임), 아이레벨은 수평, 하이는 위에서 아래로(작아 보임), 버즈 아이(새의 눈, 부감)는 수직으로 내려다봄이에요. 더치 틸트는 수평선을 일부러 기울인 것(불안), 오버 더 숄더는 한 사람의 어깨 너머로 찍은 것, 시점 샷(POV)은 인물의 눈으로 본 화면이에요.',
    's2.lens': '35mm 필름 기준으로 어안은 8~15mm(선이 둥글게 휨), 초광각은 14~20mm, 광각은 24~35mm, 중간(표준)은 40~60mm로 눈으로 본 것과 비슷, 망원은 85~200mm, 초망원은 300mm 이상, 매크로는 아주 가까이 찍는 접사예요. 광각일수록 가까운 것이 과장되고, 망원일수록 앞뒤가 납작하게 붙어요(압축 효과).',
    's2.comp': '3분할은 화면을 가로세로 3등분한 선 위에 주인공을 놓는 것, 황금비는 약 1:1.6으로 나눈 자리나 나선, 삼각형은 세 덩어리가 삼각형을 이루는 것, 리딩 라인은 길이나 난간 같은 선이 주인공을 가리키는 것, 프레임 속 프레임은 문이나 창으로 인물을 한 번 더 가두는 것, 방사형은 선이 한 점에서 퍼지는 것, 레이어는 전경·중경·후경을 겹겹이 쌓는 것, 여백은 빈 공간(네거티브 스페이스)이 주인공보다 큰 것이에요.',
    's2.crop': '프레임 밖으로 잘려 나간 것이에요. 머리 꼭대기, 손끝, 하늘처럼 "있을 법한데 없는 것"을 찾아요.',
    's3.lights': '눈동자에 비친 반사광(캐치라이트)의 개수와 그림자의 개수를 세면 광원 수를 알 수 있어요. 크게 보기로 눈을 확대해 보세요.',
    's3.dir': '그림자는 늘 빛의 반대편에 생겨요. 코 그림자가 떨어지는 방향이 주광의 반대예요. 앞사선은 얼굴 앞 45도, 뒤사선은 등 뒤 45도에서 윤곽만 밝히는 빛이에요.',
    's3.side': '인물이 아니라 화면 기준이에요. 화면의 왼쪽에서 들어오면 왼쪽이에요.',
    's3.quality': '그림자 가장자리로 판단해요. 또렷하면 딱딱한 빛(하드 라이트, 작고 센 광원), 서서히 번지면 부드러운 빛(소프트 라이트, 크거나 한 번 퍼뜨린 광원)이에요.',
    's3.contrast': '밝은 곳과 어두운 곳의 차이예요. 큼(하이 콘트라스트)은 어두운 쪽 형태가 안 보일 정도, 작음(로우 콘트라스트)은 그림자 속까지 다 보이는 정도예요. 주광과 보조광의 세기 차이(조명비)가 클수록 대비가 커져요.',
    's3.shadow': '그림자가 어디에 떨어지는지, 얼마나 검은지, 가장자리가 어떤지를 적어요. 광원의 위치와 크기를 알려주는 증거예요.',
    's4.colors': '눈을 가늘게 뜨면 세부가 사라지고 색 덩어리만 남아요. 그 상태에서 넓은 순서대로 세 가지를 적어요. 합이 100이 아니어도 돼요.',
    's4.temp': '따뜻함은 빨강·주황·노랑 쪽, 차가움은 파랑·청록 쪽이에요. 밝은 곳과 그림자의 온도가 서로 다르면 섞임이에요.',
    's4.sat': '채도는 색의 진하기예요. 회색을 탄 듯 바랜 색이면 낮음, 원색에 가까우면 높음이에요.',
    's4.pop': '주변과 가장 다른 색 하나예요. 면적은 작아도 눈이 가장 먼저 가는 색인 경우가 많아요.',
    's5.materials': '빛을 되쏘는 방식으로 재질을 읽어요. 금속과 젖은 표면은 날카롭게, 피부와 천은 부드럽게, 벽돌과 콘크리트는 거의 되쏘지 않아요.',
    's5.gloss': '한 화면에 번들거리는 것과 빛을 먹는 것이 같이 있으면 질감 대비가 생겨요. 무엇과 무엇이 맞서는지 적어요.',
    's5.grain': '입자는 어두운 곳과 중간 밝기에서 잘 보여요. 크게 보기로 확대해서 확인해요.',
    's5.grade': '보정(그레이딩)은 찍은 뒤 색과 밝기를 만진 것이에요. 검정이 진짜 검정인지 살짝 떠 있는지, 어떤 색 쪽으로 밀었는지를 봐요.',
    's6.pose': '자세는 대사예요. 어깨가 열렸는지 닫혔는지, 손이 무엇을 쥐었는지, 무게가 어느 발에 있는지를 봐요.',
    's6.props': '화면에 보이는 물건을 빠짐없이 적어요. 쉼표로 나눠 쓰면 취향 지도에서 하나씩 세어 줘요.',
    's7.wrong': '규칙을 일부러 어긴 곳을 찾는 칸이에요. 장르의 관습, 구도의 상식, 자연스러운 빛과 색에서 벗어난 것 하나. 실수가 아니라 선택으로 보이는 것이에요.',
    's8.erase': '손가락이나 종이로 실제로 가려 보세요. 머릿속 상상보다 정확해요. 줄어드는 폭이 큰 것이 이 이미지를 떠받치는 기둥이에요.',
    's9.other': '비교는 차이를 드러내는 가장 빠른 방법이에요. 비슷한데 덜 끌렸던 이미지를 하나 떠올려 무엇이 닮았는지 먼저 적어요.',
    's10.story': '누가, 어디서, 무슨 일이 막 일어났거나 일어나려 하는가. 화면에 보이는 단서만으로 써요.',
    's10.decisions': '결정은 만든 사람이 여러 선택지 중 고른 것, 효과는 그 선택이 보는 사람에게 하는 일, 기각할 대안은 흔히 택했을 다른 방법과 그걸 버릴 이유예요.',
    's11.final': '크리틱의 마지막 한 문장이에요. "무엇 때문에, 어떤 느낌이 난다"의 꼴로, 화면에서 가리킬 수 있는 말로 써요.',
    's11.sure': '화면에서 손가락으로 가리킬 수 있으면 확실, 만든 사람 머릿속 이야기면 추정이에요. 이 구분이 크리틱의 기본이에요.',
  };
  const D = (f, help) => ({ ...f, deep: true, noWhy: true, help });
  const EXTRA = {
    s2: [
      { type: 'head', label: '프레임 더 깊게', deep: true },
      D(C('ratio', '화면 비율', ['세로', '1:1', '4:3', '16:9', '2.39:1']), '가로와 세로의 비예요. 2.39:1은 극장 영화의 아주 넓은 화면, 4:3은 옛날 TV, 세로는 휴대폰 화면이에요.'),
      D(T('focus', '초점이 가장 또렷한 곳'), '크게 보기로 확대해서 가장 날카로운 곳을 찾아요. 눈인지, 손인지, 소품인지에 따라 주인공이 달라져요.'),
      D({ k: 'planes', label: '전경 · 중경 · 후경에 각각 무엇이 있나', type: 'rows', rowLabels: ['전경', '중경', '후경'], cols: [{ k: 'what', label: '무엇', type: 'text' }] }, '화면을 앞·가운데·뒤 세 겹으로 나눠 봐요. 겹이 많을수록 깊이가 생겨요. 한 겹이 비어 있으면 "없음"이라고 써요.'),
      D({ k: 'lines', label: '주요 선의 방향', type: 'choices', options: ['수평', '수직', '대각', '곡선'] }, '벽 모서리, 팔, 시선, 그림자 가장자리처럼 눈이 따라가는 선이에요. 수평은 안정, 수직은 힘, 대각은 움직임, 곡선은 부드러움을 줘요.'),
      D(C('balance', '균형', ['대칭', '비대칭', '방사형']), '화면 좌우의 무게예요. 큰 것, 어두운 것, 진한 색일수록 무거워요. 한쪽에 큰 덩어리와 반대쪽에 작은 것 여럿이 맞서면 비대칭 균형이에요.'),
      D(T('exit', '눈이 화면 밖으로 빠져나가는 곳'), '시선이 한 바퀴 돌고 끝나는 지점이에요. 빠져나갈 곳이 없으면 "갇힌 화면"이라고 써요.'),
    ],
    s3: [
      { type: 'head', label: '빛 더 깊게', deep: true },
      D({ k: 'roles', label: '빛의 역할 나누기', type: 'rows', rowLabels: ['주광', '보조광', '윤곽광'], cols: [{ k: 'what', label: '어디서 오는 무슨 색 빛인지 (없으면 "없음")', type: 'text' }] }, '주광은 형태를 만드는 가장 센 빛, 보조광은 그림자를 살짝 채우는 빛, 윤곽광은 뒤에서 가장자리를 따는 빛이에요. 세 가지가 다 있을 필요는 없어요.'),
      D(C('lightRatio', '밝은 쪽과 어두운 쪽의 차이', ['거의 같음', '두세 배', '여덟 배 이상']), '얼굴의 밝은 쪽과 어두운 쪽을 비교해요. 어두운 쪽 표정이 다 보이면 거의 같음, 형태만 보이면 두세 배, 검게 사라지면 여덟 배 이상이에요.'),
      D(C('motivation', '빛의 출처', ['화면 속에 보임', '화면 밖에 있을 법함', '무대 조명처럼 인위적']), '그 빛이 어디서 오는지 화면이 설명해 주는가예요. 창문이나 등이 보이면 화면 속, 안 보여도 자연스러우면 화면 밖, 설명이 안 되면 인위적이에요.'),
      D(T('lightColor', '빛의 색과 그림자의 색'), '흰 빛은 드물어요. 밝은 곳이 어떤 색을 띠는지, 그림자가 그 반대 색을 띠는지 봐요.'),
      D(T('highlight', '반사광의 모양'), '눈동자, 금속, 젖은 표면에 맺힌 반사광의 모양이에요. 둥글면 둥근 광원, 네모면 창이나 네모난 조명이에요.'),
    ],
    s4: [
      { type: 'head', label: '색 더 깊게', deep: true },
      D(C('harmony', '색 조화', ['단색', '유사색', '보색', '삼색', '무채색에 포인트']), '색상환에서 색들이 놓인 관계예요. 단색은 한 색의 밝기 차이, 유사색은 이웃한 색, 보색은 정반대 색(빨강과 청록 등), 삼색은 세 갈래로 벌어진 색이에요.'),
      D(C('key', '전체 밝기', ['하이키', '중간', '로우키']), '화면 대부분이 밝으면 하이키, 대부분이 어두우면 로우키예요. 분위기의 뼈대를 정해요.'),
      D(T('skin', '피부색은 어떻게 처리됐나'), '피부가 자연스러운 색인지, 조명 색에 덮였는지, 주변 색과 분리되는지 봐요.'),
      D(T('shadowColor', '그림자 속의 색'), '그림자가 그냥 검은지, 파랑이나 초록 같은 색이 들어 있는지 봐요.'),
      D(T('colorJob', '색이 하는 일'), '색이 주인공을 배경에서 떼어 내는지, 화면을 하나로 묶는지, 무언가를 상징하는지 적어요.'),
    ],
    s5: [
      { type: 'head', label: '질감 더 깊게', deep: true },
      D(T('lensMark', '렌즈가 남긴 흔적'), '가장자리가 어두워지는 비네팅, 빛이 번지는 플레어, 선이 휘는 왜곡, 흐린 배경의 빛망울(보케) 모양을 찾아요.'),
      D(T('postMark', '후반 작업의 흔적'), '밝은 곳 주변이 붉게 번지는 할레이션, 뿌옇게 퍼지는 블룸, 가장자리의 색 번짐, 일부러 넣은 먼지나 긁힘을 찾아요.'),
    ],
    s6: [
      { type: 'head', label: '연출 더 깊게', deep: true },
      D(T('blocking', '인물의 배치 (거리, 높낮이, 겹침)'), '블로킹은 인물을 어디에 세웠는가예요. 둘 사이 거리, 누가 더 높은지, 누가 누구를 가리는지가 관계를 말해요.'),
      D(T('costume', '의상의 색과 실루엣'), '옷의 색이 배경과 섞이는지 튀는지, 윤곽이 뾰족한지 둥근지, 큰지 붙는지를 봐요.'),
      D(T('hair', '헤어와 메이크업'), '머리 모양, 광택, 입술과 눈가의 색이에요. 시대와 인물의 성격을 가장 빨리 알려 줘요.'),
      D(T('place', '배경이 말해 주는 것'), '장소가 인물에 대해 무엇을 알려 주는지 적어요. 계층, 시간대, 직업, 방금 일어난 일 같은 것이에요.'),
    ],
    s7: [
      D(T('genre', '이 장르의 흔한 방식과 무엇이 다른가'), '같은 종류의 이미지 열 장을 떠올려 보고, 그 열 장이 공통으로 하는 것 중 이 이미지가 안 하는 것을 찾아요.'),
    ],
    s9: [
      D(T('lineage', '이 이미지가 기대고 있는 선배 이미지 (추정)'), '모든 이미지는 다른 이미지를 닮아요. 떠오르는 영화, 사진가, 시대, 장르를 적어요. 확인되지 않았으면 추정이라고 써요.'),
    ],
    s10: [
      { type: 'head', label: '의미 읽기', deep: true },
      D(T('denote', '보이는 것 그대로 (설명 없이)'), '해석을 빼고 화면에 있는 것만 말해요. "여자 둘, 골목, 붉은 빛"처럼요. 이걸 외연이라고 해요.'),
      D(T('connote', '그것이 암시하는 것'), '위에 적은 것들이 불러오는 뜻이에요. 붉은 빛은 위험일 수도 열기일 수도 있어요. 이걸 내포라고 해요. 한 가지로 정하고 이유를 써요.'),
      D(T('audience', '누구에게 말을 거는 이미지인가'), '이 이미지를 좋아할 사람과 싫어할 사람을 한 명씩 떠올려 적어요.'),
    ],
    s11: [
      { type: 'head', label: '크리틱 마무리', deep: true },
      D(T('weak', '이 이미지의 약한 곳 1개'), '좋아하는 이미지에서도 약점을 찾는 게 크리틱이에요. 덜어내면 더 좋아질 것, 또는 어색한 곳 하나.'),
      D(A('pitch', '30초 발표문 (세 문장)'), '수업에서 이 이미지를 소개한다고 생각하고 써요. 첫 문장은 무엇이 보이는지, 둘째는 핵심 결정, 셋째는 내가 가져갈 것.'),
    ],
  };
  for (const st of STEPS) {
    for (const f of st.fields) if (f.k && HELP[st.id + '.' + f.k]) f.help = HELP[st.id + '.' + f.k];
    const extra = EXTRA[st.id];
    if (!extra) continue;
    const at = st.fields.findIndex((f) => f.k === 'sum');
    st.fields.splice(at < 0 ? st.fields.length : at, 0, ...extra);
  }
  const stepNo = (st) => STEPS.indexOf(st) + 1;
  const visibleSteps = (c) => c.mode === 'quick' ? STEPS.filter((s) => s.quick) : STEPS;
  const needsWhy = (f) => (f.type === 'choice' || f.type === 'choices') && !f.opt && !f.noWhy;
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
  const whyOk = (c, st, f) => c.mode !== 'deep' || st.id === 'video' || st.sheet || !needsWhy(f) || has((c.steps[st.id] || {})[f.k + 'Why']);
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
      return { full: shrink(img, 2400, 0.88), thumb: shrink(img, 520, 0.8) };
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
      frame.append(src ? h('img', { src, alt: '분석할 이미지 (누르면 크게 보기)', class: 'zoomable', onclick: () => openZoom(src), onerror: () => frame.replaceChildren(failBox()) }) : failBox());
      if (src) wrap.append(zoomFab(src));
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

    const deep = c.mode === 'deep' && st.id !== 'video' && !st.sheet;
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
      h('label', { class: 'label', for: dom },
        st.id !== 'video' ? h('span', { class: 'fnum' }, `${st.code || stepNo(st)}.${st.sheet ? st.fields.indexOf(f) + 1 : realFields(c, st).indexOf(f) + 1}`) : null,
        f.label + (f.opt ? ' · 없으면 비워 둬요' : '')));
    let helpBox = null;
    if (f.help) {
      helpBox = h('p', { class: 'help', hidden: true, id: dom + '-help' }, h('span', { class: 'helptag' }, '용어'), f.help);
      const hb = h('button', { class: 'helpbtn', type: 'button', 'aria-expanded': 'false', 'aria-controls': dom + '-help', 'aria-label': `${f.label} 용어 설명`,
        onclick: () => { helpBox.hidden = !helpBox.hidden; hb.setAttribute('aria-expanded', String(!helpBox.hidden)); hb.classList.toggle('on', !helpBox.hidden); } }, '?');
      top.firstChild.append(hb);
    }
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
    holder.append(top, helpBox, set);
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
        ? h('p', { class: 'note' }, '미술대학 크리틱 수업처럼 써요. 버튼을 고를 때마다 근거를 한 줄 쓰고, 단계마다 더 촘촘한 관찰 칸과 한 줄 결론이 열려요. 칸 옆의 ?를 누르면 용어 설명이 나와요.')
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
      u.body.append(h('button', { class: 'booklink', type: 'button', onclick: async () => { await saveNow(); location.hash = 'book-' + stepNo(u.st); } }, `교과서 ${stepNo(u.st)}단원 「${u.st.title}」 읽기 →`));
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

    /* ── 크리틱 워크시트 ── */
    const wsOpen = new Set();
    const wsList = h('div', { class: 'wslist' });
    const wsSec = h('section', { class: 'sec step', id: 'sheets' },
      h('header', {}, h('h2', {}, '크리틱 워크시트'), h('span', { class: 'chip-state', id: 'ws-count' })),
      h('div', { class: 'stepbody' },
        h('p', { class: 'note' }, '미술대학과 영화과 수업에서 널리 쓰이는 분석법 열 가지예요. 같은 이미지를 다른 틀로 다시 써 보는 연습이에요. 필수가 아니니 하나씩 골라서 해요.'),
        wsList));
    const wsBlocks = WORKSHEETS.map((st) => {
      const chip = h('span', { class: 'chip-state' });
      const body = h('div', { class: 'wsbody', hidden: true });
      let built = false;
      const draw = () => { const n = sheetCount(c, st); chip.textContent = `${n}/${st.fields.length}칸`; chip.classList.toggle('done', n === st.fields.length); };
      const toggle = h('button', { class: 'wsrow', type: 'button', 'aria-expanded': 'false', id: 'ws-' + st.id, onclick: () => {
        const open = body.hidden;
        if (open && !built) {
          built = true;
          body.append(h('p', { class: 'help' }, h('span', { class: 'helptag' }, '출처'), st.by), h('p', { class: 'help' }, h('span', { class: 'helptag' }, '하는 법'), st.how));
          if (st.id === 'w_slow') {
            const clock = h('strong', { class: 'mono' }, '00:00');
            let t0 = 0, tick = null;
            const say = h('span', { class: 'note' }, '타이머를 켜고 이미지만 봐요.');
            const btn = h('button', { class: 'btn small', type: 'button', onclick: () => {
              if (tick) { clearInterval(tick); tick = null; btn.textContent = '10분 타이머 시작'; return; }
              t0 = Date.now(); btn.textContent = '타이머 멈추기';
              tick = setInterval(() => {
                if (!document.body.contains(clock)) { clearInterval(tick); tick = null; return; }
                const sec = Math.floor((Date.now() - t0) / 1000);
                clock.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
                say.textContent = sec < 60 ? '보기만 해요. 아직 쓰지 않아요.' : sec < 300 ? '1분째 칸을 쓰고, 다시 봐요.' : sec < 600 ? '5분째 칸을 쓰고, 다시 봐요.' : '10분이 됐어요. 마지막 칸을 써요.';
                if (sec >= 600) { clearInterval(tick); tick = null; btn.textContent = '10분 타이머 시작'; }
              }, 1000);
            } }, '10분 타이머 시작');
            body.append(h('div', { class: 'row' }, btn, clock, say));
          }
          for (const f of st.fields) body.append(buildField(c, st, f, () => { draw(); drawWsCount(); touch(); }, { origSrc }));
        }
        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      } }, h('span', { class: 'wscode' }, st.code), h('span', { class: 'wstitle' }, st.title), chip);
      draw();
      return h('div', { class: 'ws' }, toggle, body);
    });
    wsList.append(...wsBlocks);
    function drawWsCount() {
      const n = WORKSHEETS.filter((st) => sheetCount(c, st) > 0).length;
      const chip = wsSec.querySelector('#ws-count');
      chip.textContent = n ? `${n}개 씀` : '선택';
      chip.classList.toggle('done', n > 0);
    }
    drawWsCount();
    void wsOpen;

    form.append(unkSec, finish);
    if (!pass2) form.append(wsSec);
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
      if (!pass2) { const s1ok = stepDone(c, STEPS[0]); wsSec.classList.toggle('locked', !s1ok); wsSec.querySelector('.stepbody').hidden = !s1ok; }
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
    if (src) lead.append(gz.some((r) => r.x != null) ? gazeFigure(src, gz) : h('img', { src, alt: '', class: 'zoomable', onclick: () => openZoom(src), onerror: (e) => e.target.remove() }));
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
        h('h3', {}, h('span', { class: 'mono' }, stepCode(st)), ' ' + st.title), h('dl', {}, rows)));
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

  /* ───────── 이미지 크게 보기 (확대, 끌어서 이동) ───────── */
  function openZoom(src) {
    if (!src || document.querySelector('.zoom')) return;
    let s = 1, x = 0, y = 0;
    const img = h('img', { src, alt: '크게 보는 이미지', draggable: false });
    const pct = h('span', { class: 'zoompct' });
    const stage = h('div', { class: 'zoomstage' }, img);
    const apply = () => { img.style.transform = `translate(${x}px, ${y}px) scale(${s})`; pct.textContent = Math.round(s * 100) + '%'; };
    const zoomAt = (cx, cy, ns) => {
      ns = Math.min(8, Math.max(1, ns));
      const r = stage.getBoundingClientRect();
      const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
      x = px - (px - x) * (ns / s); y = py - (py - y) * (ns / s); s = ns;
      if (s === 1) { x = 0; y = 0; }
      apply();
    };
    const center = () => { const r = stage.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const close = () => { box.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === '+' || e.key === '=') zoomAt(...center(), s * 1.4);
      if (e.key === '-') zoomAt(...center(), s / 1.4);
    };
    const pts = new Map();
    let lastTap = 0, moved = 0, pinch = 0;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) {
        moved += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
        if (s > 1) { x += e.clientX - prev[0]; y += e.clientY - prev[1]; apply(); }
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, s * (dist / pinch));
        pinch = dist; moved = 99;
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); pinch = 0;
      if (pts.size === 0 && moved < 8) {
        const now = Date.now();
        if (now - lastTap < 320) { zoomAt(e.clientX, e.clientY, s > 1 ? 1 : 2.5); lastTap = 0; } else lastTap = now;
      }
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    const box = h('div', { class: 'zoom', role: 'dialog', 'aria-label': '이미지 크게 보기' }, stage,
      h('div', { class: 'zoombar' },
        h('button', { class: 'btn', type: 'button', 'aria-label': '축소', onclick: () => zoomAt(...center(), s / 1.5) }, '−'),
        pct,
        h('button', { class: 'btn', type: 'button', 'aria-label': '확대', onclick: () => zoomAt(...center(), s * 1.5) }, '+'),
        h('button', { class: 'btn', type: 'button', onclick: () => { s = 1; x = 0; y = 0; apply(); } }, '처음 크기'),
        h('button', { class: 'btn solid', type: 'button', id: 'zoom-close', onclick: close }, '닫기')),
      h('p', { class: 'zoomhint' }, '두 번 누르면 확대 · 두 손가락으로 벌리기 · 끌어서 이동'));
    document.body.append(box);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    apply();
  }
  const zoomFab = (src) => (src ? h('button', { class: 'zoomfab noprint', type: 'button', id: 'zoom-open', onclick: () => openZoom(src) }, '이미지 크게 보기') : null);

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
  const allSteps = (c) => [...(c.type === 'video' ? [VIDEO_STEP] : []), ...STEPS, ...WORKSHEETS];
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
        h('div', { class: 'stage' }, h('div', { class: 'frame' }, src ? h('img', { src, alt: '분석할 이미지 (누르면 크게 보기)', class: 'zoomable', onclick: () => openZoom(src) }) : h('div', { class: 'linkfail' }, '이미지 없음'))),
        form),
      zoomFab(src)));
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
        h('div', { class: 'stage' }, h('div', { class: 'frame' }, src ? h('img', { src, alt: '분석한 이미지 (누르면 크게 보기)', class: 'zoomable', onclick: () => openZoom(src) }) : h('div', { class: 'linkfail' }, '이미지 없음')), zoomFab(src)),
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
      if (rows.length) L.push('', `## ${stepCode(st)} ${st.title}`, ...rows);
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
          h('p', { class: 'note', id: 'app-version' }, `앱 버전 ${APP_VERSION}`),
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
      ['구도', '2단계에서 고른 구도', tally(cards.flatMap((c) => [].concat(st(c, 's2').comp || [])))],
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

  /* ───────── 교과서: 단원별 개념, 그림, 핵심 용어, 확인 문제 ───────── */
  const FIG = {
    comp() {
      const frames = [['중앙', '<circle cx="30" cy="20" r="7"/>'], ['3분할', '<path d="M20 0V40M40 0V40M0 13.3H60M0 26.6H60" class="thin"/><circle cx="40" cy="13.3" r="6"/>'],
        ['대칭', '<path d="M30 0V40" class="thin"/><rect x="10" y="12" width="12" height="16"/><rect x="38" y="12" width="12" height="16"/>'],
        ['대각선', '<path d="M0 40L60 0" class="thin"/><circle cx="14" cy="31" r="5"/><circle cx="44" cy="10" r="5"/>'], ['여백', '<circle cx="50" cy="32" r="4"/>']];
      return `<svg viewBox="0 0 340 62" role="img" aria-label="구도 다섯 가지">${frames.map(([name, inner], i) =>
        `<g transform="translate(${i * 68 + 4},2)"><rect width="60" height="40" class="frame"/><g class="ink">${inner}</g><text x="30" y="56" text-anchor="middle">${name}</text></g>`).join('')}</svg>`;
    },
    light() {
      const pos = [['정면', 90], ['앞사선', 45], ['측면', 0], ['뒤사선', -45], ['역광', -90]];
      const pt = (deg, r) => [130 + r * Math.cos(deg * Math.PI / 180), 95 + r * Math.sin(deg * Math.PI / 180)];
      return `<svg viewBox="0 0 260 200" role="img" aria-label="위에서 내려다본 조명 위치">
        <circle cx="130" cy="95" r="16" class="ink"/><text x="130" y="99" text-anchor="middle" class="inv">인물</text>
        <rect x="118" y="172" width="24" height="14" class="frame"/><text x="130" y="198" text-anchor="middle">카메라</text>
        ${pos.map(([name, deg]) => { const [x, y] = pt(deg, 62); const [ex, ey] = pt(deg, 22); const [tx, ty] = pt(deg, 76);
          const mid = deg === 90 || deg === -90;
          return `<path d="M${x} ${y}L${ex} ${ey}" class="ray"/><circle cx="${x}" cy="${y}" r="6" class="lamp"/><text x="${mid ? x + 12 : tx}" y="${mid ? y + 4 : ty + 4}" text-anchor="start">${name}</text>`; }).join('')}
        <text x="6" y="14">위에서 내려다본 그림</text></svg>`;
    },
    edge() {
      return `<svg viewBox="0 0 300 70" role="img" aria-label="딱딱한 그림자와 부드러운 그림자">
        <defs><linearGradient id="soft"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        <rect x="6" y="6" width="130" height="40" class="frame"/><rect x="6" y="6" width="60" height="40" class="ink"/><text x="71" y="62" text-anchor="middle">딱딱한 빛: 경계가 또렷</text>
        <rect x="164" y="6" width="130" height="40" class="frame"/><rect x="164" y="6" width="34" height="40" class="ink"/><rect x="198" y="6" width="60" height="40" fill="url(#soft)"/><text x="229" y="62" text-anchor="middle">부드러운 빛: 경계가 번짐</text></svg>`;
    },
    wheel() {
      const seg = Array.from({ length: 12 }, (_, i) => { const a0 = (i * 30 - 105) * Math.PI / 180, a1 = (i * 30 - 75) * Math.PI / 180;
        const p = (a, r) => `${90 + r * Math.cos(a)} ${90 + r * Math.sin(a)}`;
        return `<path d="M${p(a0, 78)}A78 78 0 0 1 ${p(a1, 78)}L${p(a1, 44)}A44 44 0 0 0 ${p(a0, 44)}Z" fill="hsl(${i * 30} 78% 52%)"/>`; }).join('');
      return `<svg viewBox="0 0 340 180" role="img" aria-label="색상환과 색 조화">${seg}
        <path d="M90 12V168" class="thin"/><circle cx="90" cy="29" r="5" class="dot"/><circle cx="90" cy="151" r="5" class="dot"/>
        <text x="186" y="40">보색: 정반대 색</text><text x="186" y="66">유사색: 이웃한 두세 색</text><text x="186" y="92">단색: 한 색의 밝기 차이</text><text x="186" y="118">삼색: 세 갈래로 벌어진 색</text>
        <text x="186" y="150">점 두 개가 보색 관계</text></svg>`;
    },
  };
  const BOOK = [
    { n: 1, title: '첫 반응', goal: '분석을 시작하기 전에 내 반응을 먼저 적어야 하는 이유를 설명할 수 있다.',
      body: [['h', '느낌은 문제, 분석은 풀이'], ['p', '이미지를 뜯어보기 시작하면 처음 3초의 느낌은 금방 사라져요. 그래서 먼저 적어 둬요. 뒤의 열 단계는 모두 "왜 그 느낌이 났는가"를 푸는 과정이에요.'],
        ['h', '묘사하는 말과 판정하는 말'], ['p', '"예쁘다", "멋있다", "분위기 있다"는 점수를 매기는 말이라 다음 단계로 이어지지 않아요. 몸의 감각으로 바꿔 쓰면 이어져요.'],
        ['ul', ['온도: 뜨겁다, 서늘하다', '무게: 가라앉는다, 떠 있다', '속도: 멈춰 있다, 쫓긴다', '소리: 조용하다, 웅웅거린다', '촉감: 끈적하다, 까끌하다', '거리: 코앞이다, 엿보는 것 같다']],
        ['h', '점수의 쓸모'], ['p', '좋음 점수는 8단원 지우기 테스트의 기준선이에요. 무언가를 가렸을 때 이 점수에서 얼마나 내려가는지를 재요.']],
      terms: [['첫 반응', '분석하기 전, 3초 안에 든 느낌'], ['감각어', '온도·무게·속도처럼 몸으로 느끼는 것을 가리키는 말'], ['판정어', '좋다·예쁘다처럼 점수만 매기는 말']],
      quiz: [{ q: '첫 반응 문장으로 가장 알맞은 것은?', o: ['분위기 있는 느낌', '축축하고 느리게 가라앉는 느낌', '역광을 쓴 느낌'], a: 1, why: '첫째는 판정하는 말이고, 셋째는 이미 분석이에요. 둘째만 몸의 감각으로 느낌을 적었어요.' },
        { q: '첫 반응을 분석보다 먼저 적는 까닭은?', o: ['분석하다 보면 처음 느낌이 사라지기 때문에', '점수를 높게 주기 위해서', '칸을 빨리 채우기 위해서'], a: 0, why: '처음 느낌은 뒤의 모든 분석이 설명해야 할 대상이에요.' }] },
    { n: 2, title: '시선과 프레임', goal: '눈이 움직인 길과 카메라가 있던 자리를 화면에서 읽어낼 수 있다.',
      body: [['h', '눈은 정해진 순서로 움직인다'], ['p', '눈은 대개 가장 밝은 곳, 대비가 가장 센 곳, 얼굴(특히 눈), 선이 모이는 곳 순으로 가요. 만든 사람은 이 순서를 이용해 볼 차례를 정해요.'],
        ['h', '높이와 앵글은 다르다'], ['p', '카메라 높이는 카메라가 있는 자리이고, 앵글은 카메라가 고개를 든 방향이에요. 바닥에 놓고 수평으로 찍을 수도 있고, 눈높이에서 아래를 내려다볼 수도 있어요.'],
        ['ul', ['높이: 지평선이 인물의 어디를 지나가는지 본다', '앵글: 턱 밑이 보이면 로우, 정수리가 보이면 하이', '화각: 가까운 것이 과장되면 광각, 앞뒤가 납작하면 망원']],
        ['h', '구도'], ['fig', 'comp', '구도 다섯 가지. 검은 덩어리가 주인공이다.'],
        ['h', '프레임은 잘라낸 것이다'], ['p', '화면 안에 무엇이 있는지만큼, 무엇을 뺐는지가 중요해요. 하늘을 자르면 갇힌 느낌이, 발을 자르면 떠 있는 느낌이 나요.']],
      terms: [['시선 유도', '보는 사람의 눈이 가는 순서를 설계하는 것'], ['네거티브 스페이스', '주인공도 소품도 아닌 빈 면적'], ['앵글', '카메라가 기울어진 방향 (로우·아이레벨·하이)'], ['화각', '렌즈가 담는 넓이. 광각은 넓고 망원은 좁다'], ['심도', '초점이 맞는 앞뒤 범위']],
      quiz: [{ q: '인물의 정수리가 보인다. 앵글은?', o: ['로우', '아이레벨', '하이'], a: 2, why: '위에서 내려다봐야 정수리가 보여요.' },
        { q: '배경이 크게 흐리고 인물과 배경이 납작하게 붙어 보인다. 화각 인상은?', o: ['광각', '망원'], a: 1, why: '망원은 앞뒤 거리를 눌러 붙이고 배경을 크게 흐려요.' },
        { q: '지평선이 인물의 허리를 지나간다. 카메라 높이는?', o: ['바닥', '허리', '눈높이'], a: 1, why: '지평선은 늘 카메라 높이에 놓여요.' }] },
    { n: 3, title: '빛', goal: '그림자만 보고 광원의 개수, 방향, 크기를 추리할 수 있다.',
      body: [['h', '빛은 안 보이고 그림자가 보인다'], ['p', '화면에서 조명 자체는 대개 안 보여요. 증거는 그림자와 반사광이에요. 그림자는 늘 빛의 반대편에 생겨요.'],
        ['fig', 'light', '주광이 놓이는 다섯 자리. 인물 뒤로 갈수록 얼굴은 어두워지고 윤곽만 밝아진다.'],
        ['h', '딱딱한 빛과 부드러운 빛'], ['p', '그림자 가장자리가 답이에요. 작고 센 광원은 또렷한 경계를, 크거나 한 번 퍼뜨린 광원은 번지는 경계를 만들어요.'], ['fig', 'edge', '그림자 경계로 광원의 크기를 안다.'],
        ['h', '빛의 세 가지 역할'], ['ul', ['주광: 형태를 만드는 가장 센 빛', '보조광: 그림자를 살짝 채우는 약한 빛', '윤곽광: 뒤에서 가장자리를 따서 배경과 떼어내는 빛']],
        ['h', '빛의 출처'], ['p', '창문이나 등이 화면에 보이면 빛이 "설명된" 것이에요. 설명되지 않는 빛은 무대 같은 인위적인 느낌을 줘요. 어느 쪽이든 선택이에요.']],
      terms: [['주광', '가장 센 빛. 그림자의 방향을 정한다'], ['윤곽광', '인물 뒤쪽에서 가장자리만 밝히는 빛'], ['캐치라이트', '눈동자에 비친 광원의 반사'], ['명암 대비', '밝은 곳과 어두운 곳의 차이'], ['동기가 있는 빛', '화면 속 광원으로 설명되는 빛']],
      quiz: [{ q: '코 그림자가 화면 오른쪽 아래로 떨어진다. 주광은 어디에 있나?', o: ['오른쪽 아래', '왼쪽 위', '정면'], a: 1, why: '그림자는 빛의 반대편에 생겨요.' },
        { q: '그림자 가장자리가 칼로 자른 듯 또렷하다. 광원은?', o: ['작고 센 광원', '크고 퍼진 광원'], a: 0, why: '광원이 작을수록 경계가 또렷해요.' },
        { q: '얼굴은 어둡고 머리카락 가장자리만 밝게 빛난다. 이 빛의 역할은?', o: ['주광', '보조광', '윤곽광'], a: 2, why: '뒤에서 가장자리만 따는 빛이 윤곽광이에요.' }] },
    { n: 4, title: '색', goal: '색을 면적, 온도, 진하기, 관계로 나눠 말할 수 있다.',
      body: [['h', '면적으로 본다'], ['p', '눈을 가늘게 뜨면 세부가 지워지고 색 덩어리만 남아요. 가장 넓은 색이 지배색, 다음이 보조색, 작지만 눈에 띄는 색이 포인트색이에요. 흔히 6:3:1에 가깝게 나뉘어요.'],
        ['h', '온도와 진하기'], ['ul', ['색온도: 빨강·주황 쪽은 따뜻하고 파랑·청록 쪽은 차갑다', '채도: 원색에 가까우면 높고 회색을 탄 듯하면 낮다', '밝기: 대부분 밝으면 하이키, 대부분 어두우면 로우키']],
        ['h', '색끼리의 관계'], ['fig', 'wheel', '색상환. 마주 보는 색이 보색이다.'],
        ['h', '색이 하는 일'], ['p', '색은 주인공을 배경에서 떼어 내거나, 화면을 하나로 묶거나, 무언가를 상징해요. 한 이미지에서 색이 이 셋 중 무엇을 하는지 정해 말해 봐요.']],
      terms: [['지배색', '가장 넓은 면적을 차지하는 색'], ['포인트색', '면적은 작지만 눈을 끄는 색'], ['보색', '색상환에서 정반대에 있는 색'], ['채도', '색의 진하기'], ['로우키', '화면 대부분이 어두운 상태']],
      quiz: [{ q: '빨강의 보색은?', o: ['주황', '청록', '보라'], a: 1, why: '색상환에서 빨강의 맞은편은 청록이에요.' },
        { q: '화면 대부분이 어둡고 얼굴 일부만 밝다. 전체 밝기는?', o: ['하이키', '로우키'], a: 1, why: '대부분이 어두우면 로우키예요.' },
        { q: '색을 볼 때 눈을 가늘게 뜨는 까닭은?', o: ['세부를 지우고 색 덩어리만 보려고', '더 선명하게 보려고'], a: 0, why: '세부가 사라져야 면적 비율이 보여요.' }] },
    { n: 5, title: '질감과 재질', goal: '표면이 빛을 되쏘는 방식으로 재질과 후반 작업을 읽을 수 있다.',
      body: [['h', '재질은 반사로 읽는다'], ['ul', ['날카로운 반사: 금속, 유리, 젖은 표면', '부드러운 반사: 피부, 천, 종이', '거의 없는 반사: 벽돌, 콘크리트, 두꺼운 모직']],
        ['p', '한 화면에 번들거리는 것과 빛을 먹는 것이 같이 있으면 질감 대비가 생겨요. 눈은 그 경계에 머물러요.'],
        ['h', '찍은 뒤의 손길'], ['p', '입자(그레인), 선명도, 색 보정은 화면 전체에 깔리는 질감이에요. 검정이 완전히 검은지 살짝 떠 있는지만 봐도 보정 방향이 보여요.'],
        ['h', '렌즈의 흔적'], ['p', '가장자리가 어두워지는 비네팅, 빛이 번지는 플레어, 흐린 배경의 빛망울도 재질의 일부예요.']],
      terms: [['그레인', '필름 입자. 어두운 곳에서 잘 보인다'], ['그레이딩', '찍은 뒤 색과 밝기를 만지는 작업'], ['비네팅', '화면 가장자리가 어두워지는 현상'], ['할레이션', '밝은 곳 주변이 붉게 번지는 현상']],
      quiz: [{ q: '젖은 아스팔트는 어떤 반사를 하나?', o: ['날카로운 반사', '거의 없는 반사'], a: 0, why: '젖은 표면은 거울처럼 날카롭게 되쏘아요.' },
        { q: '필름 입자가 가장 잘 보이는 곳은?', o: ['가장 밝은 곳', '어두운 곳과 중간 밝기'], a: 1, why: '밝게 날아간 곳에서는 입자가 묻혀요.' }] },
    { n: 6, title: '인물과 소품 연출', goal: '인물, 의상, 소품, 장소가 하는 말을 읽을 수 있다.',
      body: [['h', '화면에 놓인 것은 모두 선택이다'], ['p', '화면 안에 놓인 모든 것을 미장센이라고 해요. 우연히 들어온 것은 없다고 가정하고 읽어요.'],
        ['h', '시선과 자세'], ['ul', ['카메라를 똑바로 보면 보는 사람에게 말을 건다', '화면 밖을 보면 그쪽에 사건이 있다', '어깨가 열렸는지, 무게가 어느 발에 있는지가 태도를 말한다']],
        ['h', '배치'], ['p', '인물을 어디에 세웠는지를 블로킹이라고 해요. 둘 사이의 거리는 관계를, 높낮이는 힘의 차이를 말해요.'],
        ['h', '소품과 시대감'], ['p', '소품은 정보예요. 직업, 시대, 방금 일어난 일을 알려 줘요. 시대감은 머리 모양, 옷의 윤곽, 화면의 질감이 함께 만들어요.']],
      terms: [['미장센', '화면 안에 놓인 모든 것'], ['블로킹', '인물을 세우는 자리와 움직임'], ['실루엣', '옷과 몸이 만드는 바깥 윤곽']],
      quiz: [{ q: '인물이 카메라를 똑바로 본다. 어떤 효과가 나나?', o: ['보는 사람에게 말을 건다', '화면 밖 사건을 암시한다'], a: 0, why: '눈이 마주치면 보는 사람이 장면 안으로 끌려 들어가요.' },
        { q: '두 인물 중 한 명이 훨씬 높은 자리에 있다. 무엇을 말하나?', o: ['친밀함', '힘의 차이'], a: 1, why: '높낮이는 힘의 차이를 가장 빨리 전해요.' }] },
    { n: 7, title: '일부러 틀린 것', goal: '관습을 알고, 그것이 깨진 자리를 찾을 수 있다.',
      body: [['h', '관습'], ['p', '같은 종류의 이미지가 되풀이하는 방식이 관습이에요. 총 든 인물은 아래에서 올려 찍는다, 인물 사진은 눈에 초점을 맞춘다 같은 것들이에요.'],
        ['h', '눈에 걸리는 곳'], ['p', '관습이 깨진 곳은 눈에 걸려요. 기억에 남는 이미지에는 대개 이런 곳이 하나 있어요.'],
        ['h', '실수와 선택 구별하기'], ['p', '다른 요소들이 그 "틀림"을 받쳐 주고 있으면 선택이에요. 혼자 튀고 나머지와 따로 놀면 실수일 가능성이 커요.']],
      terms: [['관습', '한 장르가 되풀이하는 방식'], ['위반', '관습에서 일부러 벗어난 것']],
      quiz: [{ q: '틀린 것이 실수가 아니라 선택이라는 단서는?', o: ['화면 한 곳에만 있다', '다른 요소들이 같은 방향으로 맞춰져 있다'], a: 1, why: '빛, 구도, 연출이 그 틀림을 함께 받쳐 주면 의도예요.' }] },
    { n: 8, title: '지우기 테스트', goal: '이 이미지를 떠받치는 것이 무엇인지 실험으로 확인할 수 있다.',
      body: [['h', '생각하지 말고 가려 본다'], ['p', '손가락이나 종이로 실제로 가려 봐요. 머릿속 상상은 이미 좋아하는 쪽으로 기울어 있어요.'],
        ['h', '읽는 법'], ['ul', ['많이 줄어든다: 이 이미지의 기둥', '조금 줄어든다: 기둥을 돕는 것', '안 줄어든다: 없어도 되는 것']],
        ['p', '기둥이 둘 이상 나오면, 그 둘이 서로를 필요로 하는지 다시 따져 봐요.']],
      terms: [['핵심 요소', '가렸을 때 좋음이 가장 많이 줄어드는 것']],
      quiz: [{ q: '가려도 좋음 점수가 줄지 않는 요소는?', o: ['이 이미지의 기둥', '없어도 되는 것'], a: 1, why: '빼도 달라지지 않으면 장식이에요.' }] },
    { n: 9, title: '비교', goal: '두 이미지의 차이를 한 줄로 말할 수 있다.',
      body: [['h', '거의 같은 두 장'], ['p', '비교는 비슷할수록 쓸모가 있어요. 거의 같은데 한쪽만 끌린다면, 둘의 차이가 곧 끌림의 원인이에요.'],
        ['h', '계보'], ['p', '모든 이미지는 앞선 이미지에 기대고 있어요. 어떤 영화, 사진가, 시대를 닮았는지 떠올려 보면 만든 사람이 무엇을 가져오고 무엇을 바꿨는지 보여요. 확인되지 않았으면 추정이라고 적어요.']],
      terms: [['레퍼런스', '만든 사람이 참고했을 앞선 이미지']],
      quiz: [{ q: '비교 대상으로 가장 쓸모 있는 것은?', o: ['전혀 다른 분위기의 이미지', '거의 같은데 덜 끌리는 이미지'], a: 1, why: '차이가 작을수록 원인을 하나로 좁힐 수 있어요.' }] },
    { n: 10, title: '디렉터의 눈', goal: '관찰한 것을 결정의 말로 바꿀 수 있다.',
      body: [['h', '관찰에서 결정으로'], ['p', '"빛이 오른쪽에서 온다"는 관찰이에요. "빛을 오른쪽에 뒀다"는 결정이에요. 주어를 만든 사람으로 바꾸면, 다른 선택지와 그걸 버린 이유가 따라 나와요.'],
        ['ul', ['결정: 여러 선택지 중 고른 것', '효과: 그 선택이 보는 사람에게 하는 일', '대안: 흔히 택했을 다른 방법과 그것을 버릴 이유']],
        ['h', '보이는 것과 암시하는 것'], ['p', '화면에 있는 그대로를 외연, 그것이 불러오는 뜻을 내포라고 해요. 붉은 빛(외연)은 위험일 수도 열기일 수도 있어요(내포). 하나로 정하고 근거를 대요.'],
        ['h', '추정은 추정이라고 쓴다'], ['p', '만든 사람의 의도는 크레딧이나 인터뷰로 확인되지 않으면 추정이에요.']],
      terms: [['외연', '화면에 보이는 것 그대로'], ['내포', '보이는 것이 불러오는 뜻'], ['추정', '확인되지 않은 의도에 대한 내 생각']],
      quiz: [{ q: '"붉은 빛이 두 사람의 얼굴을 덮고 있다"는?', o: ['외연', '내포'], a: 0, why: '해석 없이 보이는 것만 말했으니 외연이에요.' },
        { q: '인터뷰로 확인되지 않은 감독의 의도는 어떻게 적나?', o: ['사실로 적는다', '추정이라고 표시한다'], a: 1, why: '확인할 수 없는 것과 눈으로 본 것을 섞지 않아요.' }] },
    { n: 11, title: '정리', goal: '분석을 한 문장과 다시 찍을 수 있는 레시피로 줄일 수 있다.',
      body: [['h', '크리틱의 네 걸음'], ['ul', ['묘사: 무엇이 보이는가', '분석: 어떻게 짜여 있는가', '해석: 무엇을 뜻하는가', '판단: 잘 되었는가, 왜']],
        ['p', '앞의 열 단원이 이 순서로 놓여 있어요. 마지막 단원은 판단이에요.'],
        ['h', '최종 문장'], ['p', '"무엇 때문에 어떤 느낌이 난다"의 꼴로 써요. 앞부분은 화면에서 가리킬 수 있는 것이어야 해요.'],
        ['h', '레시피'], ['p', '레시피는 남이 읽고 다시 찍을 수 있을 만큼 구체적이어야 해요. "어둡게"가 아니라 "빨간 필터를 씌운 조명 하나를 오른쪽 앞 45도에".']],
      terms: [['크리틱', '작품을 묘사·분석·해석·판단하는 수업 방식'], ['레시피', '같은 효과를 다시 만들기 위한 조건 목록']],
      quiz: [{ q: '크리틱의 순서로 알맞은 것은?', o: ['판단, 해석, 분석, 묘사', '묘사, 분석, 해석, 판단'], a: 1, why: '본 것에서 시작해 판단으로 끝나요.' },
        { q: '더 좋은 레시피는?', o: ['조명을 분위기 있게', '빨간 필터 조명 하나를 오른쪽 앞 45도에'], a: 1, why: '남이 읽고 그대로 따라 할 수 있어야 레시피예요.' }] },
  ];
  /* ───────── 크리틱 워크시트: 미술·영화 수업에서 널리 쓰이는 공개된 분석법 ───────── */
  const W = (id, code, title, by, how, fields) => ({ id, code, title, by, how, sheet: true, noUnknown: true, fields });
  const WORKSHEETS = [
    W('w_stw', 'A', '보고 · 생각하고 · 궁금해하기',
      '하버드 교육대학원의 연구 모임 "프로젝트 제로"가 만든 생각 루틴(See–Think–Wonder)이에요. 미술관과 교실에서 관찰과 해석을 떼어 놓는 첫 연습으로 널리 써요.',
      '세 칸을 순서대로 써요. 첫 칸에는 해석을 한 마디도 넣지 않는 게 규칙이에요.',
      [A('see', '보이는 것: 해석 없이 열 가지'), A('think', '그래서 드는 생각: 무슨 일이 벌어지고 있나'), A('wonder', '궁금한 것: 화면이 답해 주지 않는 질문 세 가지')]),
    W('w_vts', 'B', '세 가지 질문 (시각적 사고 전략)',
      '인지심리학자 애비게일 하우젠과 뉴욕 현대미술관(MoMA) 교육 책임자였던 필립 예나윈이 만든 방법(VTS)이에요. 질문 세 개만으로 수업 전체를 끌어가요.',
      '둘째 질문이 핵심이에요. 첫 칸에 쓴 문장마다 화면의 근거를 하나씩 대요.',
      [A('going', '이 이미지에서 무슨 일이 일어나고 있나'), A('evidence', '무엇을 보고 그렇게 말하나 (화면의 근거)'), A('more', '더 찾을 수 있는 것은 무엇인가')]),
    W('w_feldman', 'C', '펠드먼의 네 단계',
      '미국 조지아대학교의 미술교육자 에드먼드 펠드먼이 정리한 비평 순서예요. 미술대학 크리틱의 뼈대로 가장 널리 쓰여요.',
      '순서를 건너뛰지 않아요. 묘사가 끝나기 전에는 좋다 나쁘다를 말하지 않는 게 규칙이에요.',
      [A('describe', '묘사: 무엇이 보이는가 (판단하는 말 금지)'), A('analyze', '분석: 요소들이 어떻게 짜여 있는가'), A('interpret', '해석: 그래서 무엇을 뜻하는가'), A('judge', '판단: 잘 되었는가, 근거는 무엇인가')]),
    W('w_barthes', 'D', '스투디움과 푼크툼',
      '프랑스 비평가 롤랑 바르트가 『밝은 방』에서 쓴 구분이에요. 사진 이론 수업에서 빠지지 않아요.',
      '스투디움은 누구나 알아볼 주제이고, 푼크툼은 설명하기 어려운데 나만 찔리는 작은 디테일이에요. 푼크툼은 찾는 게 아니라 걸리는 거라서, 없으면 "없음"이라고 써요.',
      [A('studium', '스투디움: 누구나 알아볼 이 이미지의 주제와 관심사'), T('punctum', '푼크툼: 이유 없이 나를 찌르는 작은 디테일 하나'), A('why', '그 디테일이 왜 나에게 걸리는가')]),
    W('w_panofsky', 'E', '파노프스키의 세 층',
      '미술사학자 에르빈 파노프스키의 도상 해석 방법이에요. 미술사 수업의 기본 틀이에요.',
      '아래층을 다 쓰고 위층으로 올라가요. 3층은 대개 추정이니 추정이라고 적어요.',
      [A('pre', '1층: 눈에 보이는 사물과 동작'), A('icon', '2층: 그것이 관습적으로 뜻하는 것 (상징, 장르, 인용)'), A('logy', '3층: 이 이미지가 드러내는 시대와 문화의 태도')]),
    W('w_gestalt', 'F', '게슈탈트 원리',
      '20세기 초 독일 심리학에서 나온 지각 원리예요. 바우하우스 이후 전 세계 디자인 기초 수업에 자리 잡았어요.',
      '눈이 낱개가 아니라 덩어리로 본다는 원리예요. 화면에서 실제로 작동하는 것만 써요.',
      [A('figure', '전경과 배경: 무엇이 앞으로 나오고 무엇이 물러나나'), A('group', '묶임: 가깝거나 닮아서 한 덩어리로 보이는 것'), A('cont', '연속과 닫힘: 끊겼는데 이어져 보이는 선, 일부만 보이는데 전체로 읽히는 형태')]),
    W('w_barrett', 'G', '바렛의 식',
      '오하이오주립대학교의 테리 바렛이 『사진 비평』에서 제안한 식이에요. 주제 + 매체 + 형식 + 맥락 = 내용.',
      '네 칸을 따로 쓴 다음, 마지막 칸에서 하나로 합쳐요.',
      [T('subject', '주제: 무엇을 찍었나'), T('medium', '매체: 무엇으로 만들었나 (필름, 디지털, 합성 등)'), A('form', '형식: 어떻게 보이게 했나 (구도, 빛, 색)'), A('context', '맥락: 어디에, 누구를 위해, 언제 나왔나'), A('content', '내용: 네 가지를 합치면 이 이미지는 무엇을 말하나')]),
    W('w_film', 'H', '영화 형식 분석',
      '위스콘신대학교의 데이비드 보드웰과 크리스틴 톰슨이 『영화 예술』에서 쓴 틀이에요. 여러 나라 영화과의 입문 교재예요.',
      '스틸 한 장이라도 영상의 한 순간으로 읽어요. 편집과 사운드는 상상해서 쓰고 추정이라고 적어요.',
      [A('mise', '미장센: 카메라 앞에 놓인 것 (장소, 의상, 조명, 연기)'), A('cine', '촬영: 어떻게 찍었나 (거리, 각도, 렌즈, 움직임)'), A('edit', '편집: 앞뒤 컷과 어떻게 이어질까'), A('sound', '사운드: 어떤 소리가 들릴까'), A('func', '기능: 이 네 가지가 함께 하는 일 한 가지')]),
    W('w_slow', 'I', '느리게 보기',
      '하버드대학교의 미술사학자 제니퍼 로버츠는 학생들에게 한 작품을 세 시간 동안 보게 해요. 오래 봐야만 보이는 것이 있다는 훈련이에요. 여기서는 10분으로 줄였어요.',
      '타이머를 켜고 이미지만 봐요. 1분, 5분, 10분이 될 때마다 그때 새로 보인 것을 적어요. 중간에 다른 칸을 쓰지 않아요.',
      [A('m1', '1분째에 본 것'), A('m5', '5분째에 새로 보인 것'), A('m10', '10분째에 새로 보인 것')]),
    W('w_crp', 'J', '비평적 반응 과정',
      '안무가 리즈 러먼이 만든 피드백 방식이에요. 미술·공연 대학의 크리틱에서 널리 써요. 원래는 여럿이 하는데, 여기서는 혼자 하는 판으로 줄였어요.',
      '의견을 바로 말하지 않는 게 핵심이에요. 질문에 내 의견이 숨어 있으면 중립 질문이 아니에요. "왜 이렇게 어둡게 했나"가 아니라 "밝기는 어떻게 정했나"예요.',
      [A('meaning', '의미 진술: 이 이미지에서 나에게 남은 것'), A('neutral', '만든 사람에게 묻고 싶은 중립 질문 두 가지'), A('opinion', '허락을 구하고 말할 의견 한 가지')]),
  ];
  const stepCode = (st) => st.code || pad(stepNo(st));
  const sheetCount = (c, st) => st.fields.filter((f) => hasAny(c, st, f)).length;

  /* 교과서에 더하는 예시 그림 */
  Object.assign(FIG, {
    spheres() {
      const items = [['정면', 50, 45, 0], ['앞사선', 70, 34, 0], ['측면', 92, 44, 0], ['뒤사선', 112, 40, 1], ['역광', 50, 50, 2]];
      return `<svg viewBox="0 0 340 92" role="img" aria-label="빛의 방향에 따라 달라지는 공의 모습">
        <defs>${items.map(([, fx, fy, mode], i) => mode === 2
          ? `<radialGradient id="sp${i}" cx="50%" cy="50%" r="50%"><stop offset="0.82" stop-color="#0a0a0a"/><stop offset="0.93" stop-color="#f2e2c4"/><stop offset="1" stop-color="#fff6e0"/></radialGradient>`
          : `<radialGradient id="sp${i}" cx="${fx}%" cy="${fy}%" r="${mode ? 34 : 62}%"><stop offset="0" stop-color="#fff6e0"/><stop offset="${mode ? 0.5 : 0.45}" stop-color="${mode ? '#3a3026' : '#b08a5e'}"/><stop offset="1" stop-color="#0a0a0a"/></radialGradient>`).join('')}</defs>
        ${items.map(([name], i) => `<g transform="translate(${i * 68},0)"><rect x="2" y="2" width="62" height="62" fill="#161616"/><circle cx="33" cy="33" r="24" fill="url(#sp${i})"/><text x="33" y="80" text-anchor="middle">${name}</text></g>`).join('')}</svg>`;
    },
    hardsoft() {
      return `<svg viewBox="0 0 300 100" role="img" aria-label="딱딱한 빛과 부드러운 빛을 받은 공">
        <defs><radialGradient id="hs1" cx="30%" cy="30%" r="70%"><stop offset="0" stop-color="#fff6e0"/><stop offset="0.52" stop-color="#c79f6b"/><stop offset="0.55" stop-color="#17120c"/><stop offset="1" stop-color="#0a0a0a"/></radialGradient>
        <radialGradient id="hs2" cx="30%" cy="30%" r="85%"><stop offset="0" stop-color="#fff6e0"/><stop offset="0.5" stop-color="#b58d5f"/><stop offset="1" stop-color="#241c13"/></radialGradient></defs>
        <rect x="8" y="4" width="130" height="72" fill="#1c1c1c"/><ellipse cx="96" cy="66" rx="30" ry="6" fill="#000"/><circle cx="66" cy="38" r="26" fill="url(#hs1)"/><text x="73" y="92" text-anchor="middle">딱딱한 빛: 그림자가 칼같이 갈린다</text>
        <rect x="162" y="4" width="130" height="72" fill="#1c1c1c"/><ellipse cx="248" cy="66" rx="34" ry="7" fill="#000" opacity="0.35"/><circle cx="220" cy="38" r="26" fill="url(#hs2)"/><text x="227" y="92" text-anchor="middle">부드러운 빛: 서서히 어두워진다</text></svg>`;
    },
    camera() {
      const cam = (y, tilt, name) => `<g transform="translate(60,${y}) rotate(${tilt})"><rect x="-12" y="-6" width="20" height="12" class="ink"/><path d="M8 -4l8 -4v16l-8 -4z" class="ink"/></g><path d="M78 ${y}L196 ${82 - (82 - y) * 0}" class="ray" stroke-dasharray="3 3"/><text x="6" y="${y + 3}">${name}</text>`;
      return `<svg viewBox="0 0 280 150" role="img" aria-label="카메라 높이와 앵글을 옆에서 본 그림">
        <path d="M0 136H280" class="frame"/>
        <circle cx="210" cy="46" r="11" class="ink"/><path d="M210 57V104M210 70L192 88M210 70L228 88M210 104L198 136M210 104L222 136" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>
        <g transform="translate(60,24) rotate(14)"><rect x="-12" y="-6" width="20" height="12" class="ink"/><path d="M8 -4l8 -4v16l-8 -4z" class="ink"/></g><path d="M78 30L196 54" class="ray" stroke-dasharray="3 3"/><text x="4" y="14">위에서: 하이 앵글</text>
        <g transform="translate(60,62)"><rect x="-12" y="-6" width="20" height="12" class="ink"/><path d="M8 -4l8 -4v16l-8 -4z" class="ink"/></g><path d="M78 62L196 62" class="ray" stroke-dasharray="3 3"/><text x="4" y="82">눈높이: 아이레벨</text>
        <g transform="translate(60,122) rotate(-22)"><rect x="-12" y="-6" width="20" height="12" class="ink"/><path d="M8 -4l8 -4v16l-8 -4z" class="ink"/></g><path d="M78 114L196 70" class="ray" stroke-dasharray="3 3"/><text x="4" y="146">바닥에서: 로우 앵글</text></svg>`;
    },
    shots() {
      const frames = [['롱', 150, 4, 150, 142], ['풀', 176, 16, 98, 124], ['미디엄', 190, 20, 70, 62], ['바스트', 198, 22, 54, 44], ['클로즈업', 208, 24, 34, 28]];
      return `<svg viewBox="0 0 320 150" role="img" aria-label="샷 크기 다섯 가지">
        <circle cx="225" cy="38" r="10" class="ink"/><path d="M225 48V96M225 60L208 80M225 60L242 80M225 96L214 134M225 96L236 134" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>
        ${frames.map(([name, x, y, w, hh], i) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" fill="none" stroke="${i % 2 ? 'currentColor' : 'var(--red, currentColor)'}" stroke-width="1.2"/><path d="M${x} ${y + 6 + i * 2}H${118}" class="thin"/><text x="112" y="${y + 9 + i * 2}" text-anchor="end">${name}</text>`).join('')}</svg>`;
    },
    palettes() {
      const rows = [['따뜻한 유사색', ['#b4341f', '#e08a2c', '#f3d27a']], ['차가운 유사색', ['#12355b', '#2f7a8c', '#a9d6d0']], ['보색 (빨강과 청록)', ['#9c1f2e', '#12202a', '#27b3a8']], ['무채색에 포인트', ['#1b1b1b', '#8d8d8d', '#f2d21b']]];
      return `<svg viewBox="0 0 320 132" role="img" aria-label="지배색 6, 보조색 3, 포인트색 1의 예시 네 가지">${rows.map(([name, cols], i) =>
        `<g transform="translate(0,${i * 32})"><rect x="4" y="4" width="120" height="20" fill="${cols[0]}"/><rect x="124" y="4" width="60" height="20" fill="${cols[1]}"/><rect x="184" y="4" width="20" height="20" fill="${cols[2]}"/><text x="212" y="18">${name}</text></g>`).join('')}</svg>`;
    },
    keys() {
      const bar = (y, stops, name) => `<g transform="translate(0,${y})">${stops.map((v, i) => `<rect x="${4 + i * 20}" y="0" width="20" height="22" fill="hsl(30 8% ${v}%)"/>`).join('')}<text x="212" y="15">${name}</text></g>`;
      return `<svg viewBox="0 0 320 62" role="img" aria-label="하이키와 로우키">
        ${bar(4, [96, 94, 90, 88, 84, 80, 74, 66, 50, 20], '하이키: 대부분 밝다')}${bar(34, [4, 6, 8, 10, 12, 16, 20, 30, 60, 92], '로우키: 대부분 어둡다')}</svg>`;
    },
    reflect() {
      const s = (x, id, name) => `<rect x="${x}" y="4" width="92" height="66" fill="#1c1c1c"/><circle cx="${x + 46}" cy="37" r="25" fill="url(#${id})"/><text x="${x + 46}" y="86" text-anchor="middle">${name}</text>`;
      return `<svg viewBox="0 0 320 94" role="img" aria-label="재질에 따른 반사의 차이">
        <defs><radialGradient id="rf1" cx="32%" cy="28%" r="80%"><stop offset="0" stop-color="#fff"/><stop offset="0.07" stop-color="#fff"/><stop offset="0.1" stop-color="#555"/><stop offset="1" stop-color="#0a0a0a"/></radialGradient>
        <radialGradient id="rf2" cx="32%" cy="28%" r="85%"><stop offset="0" stop-color="#f6dcc0"/><stop offset="0.5" stop-color="#b98863"/><stop offset="1" stop-color="#3a2618"/></radialGradient>
        <radialGradient id="rf3" cx="32%" cy="28%" r="95%"><stop offset="0" stop-color="#7c5a48"/><stop offset="1" stop-color="#4a342a"/></radialGradient></defs>
        ${s(6, 'rf1', '금속·젖은 표면: 날카로운 반사')}${s(114, 'rf2', '피부·천: 부드러운 반사')}${s(222, 'rf3', '벽돌·모직: 거의 없음')}</svg>`;
    },
    blocking() {
      const man = (x, y, sc) => `<g transform="translate(${x},${y}) scale(${sc})"><circle cx="0" cy="-34" r="7" class="ink"/><path d="M0 -27V4M0 -18L-10 -4M0 -18L10 -4M0 4L-7 26M0 4L7 26" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></g>`;
      return `<svg viewBox="0 0 320 96" role="img" aria-label="인물의 배치가 말하는 관계">
        <rect x="4" y="4" width="96" height="64" class="frame"/>${man(42, 44, 0.8)}${man(60, 44, 0.8)}<text x="52" y="84" text-anchor="middle">가까움: 한편</text>
        <rect x="112" y="4" width="96" height="64" class="frame"/>${man(128, 44, 0.8)}${man(192, 44, 0.8)}<text x="160" y="84" text-anchor="middle">멂: 거리감, 대립</text>
        <rect x="220" y="4" width="96" height="64" class="frame"/><path d="M270 46H316" class="frame"/>${man(246, 48, 0.62)}${man(292, 34, 0.95)}<text x="268" y="84" text-anchor="middle">높낮이: 힘의 차이</text></svg>`;
    },
  });
  /* 교과서 본문에 더하는 긴 설명 */
  const BOOK_MORE = {
    1: [['h', '쓰는 순서'], ['ol', ['이미지를 3초만 본다. 더 보지 않는다.', '눈을 떼고, 몸에 남은 느낌을 감각어 한두 개로 적는다.', '떠오른 단어 세 개를 고르지 않고 나오는 대로 적는다.', '좋음 점수를 매긴다. 고민이 길어지면 처음 떠오른 숫자를 쓴다.']],
      ['h', '예시로 읽기'], ['p', '밤 골목에서 붉은 빛을 받은 두 사람이 카메라를 올려다보는 사진이 있다고 해요. "멋있다"는 아무것도 알려 주지 않아요. "뜨겁게 가라앉은 느낌"이라고 쓰면, 뒤에서 풀어야 할 문제가 둘 생겨요. 무엇이 뜨겁게 만들었나(색일 가능성), 무엇이 가라앉게 만들었나(앵글이나 어둠일 가능성).'],
      ['h', '자주 하는 실수'], ['ul', ['첫 반응에 벌써 "역광이라서" 같은 원인을 쓴다. 원인은 뒤 단원의 일이다.', '남의 평을 본 뒤에 쓴다. 그러면 내 반응이 아니라 남의 반응을 옮기게 된다.', '점수를 끝까지 분석한 뒤에 고친다. 처음 점수는 기록이니 그대로 둔다.']],
      ['h', '더 읽을거리'], ['ul', ['존 버거, 『다른 방식으로 보기』: 보는 일이 중립적이지 않다는 것을 가장 쉽게 설명한 책', '하버드 프로젝트 제로의 "보고·생각하고·궁금해하기": 카드의 워크시트 A로 연습할 수 있다']]],
    2: [['h', '카메라가 있던 자리 찾기'], ['fig', 'camera', '같은 인물을 세 높이에서 찍을 때. 높이와 기울기가 함께 바뀐다.'],
      ['p', '카메라 자리를 찾을 때는 수평선부터 봐요. 바다, 바닥과 벽이 만나는 선, 창틀 같은 수평선이 인물의 어느 높이를 지나가는지가 곧 카메라의 높이예요. 그다음 인물의 턱 밑과 정수리 중 어느 쪽이 보이는지로 기울기를 정해요.'],
      ['h', '샷 크기'], ['fig', 'shots', '같은 인물을 얼마나 담느냐에 따라 부르는 이름이 달라진다.'],
      ['p', '샷 크기는 보는 사람과 인물 사이의 거리예요. 클로즈업은 감정을, 풀 샷은 자세와 옷을, 롱 샷은 인물과 장소의 관계를 보여 줘요. 같은 장면이라도 크기를 바꾸면 말하는 내용이 달라져요.'],
      ['h', '쓰는 순서'], ['ol', ['이미지를 열자마자 눈이 간 곳 세 군데에 핀을 찍는다. 생각하지 말고 찍는다.', '핀마다 이유를 고른다. 밝아서인가, 얼굴이라서인가, 선이 가리켜서인가.', '수평선을 찾아 카메라 높이를 정한다.', '턱 밑과 정수리로 앵글을 정한다.', '화면 가장자리를 한 바퀴 돌며 잘려 나간 것을 찾는다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진에서 눈은 왼쪽 인물의 얼굴(가장 밝음), 오른쪽 인물의 얼굴(시선), 오른쪽 위의 흰 등(색 대비) 순으로 가요. 두 사람의 정수리와 어깨 윗면이 보이니 하이 앵글이고, 머리가 크고 발이 작으니 광각이에요. 하늘과 골목 끝이 잘려 있어서 빠져나갈 곳이 없어 보여요.'],
      ['h', '자주 하는 실수'], ['ul', ['높이와 앵글을 같은 것으로 쓴다. 높은 곳에서 수평으로 찍을 수도 있다.', '광각과 "넓게 찍힘"을 혼동한다. 멀리서 망원으로 찍어도 넓게 담긴다. 원근의 과장을 봐야 한다.', '구도 이름만 고르고 주인공이 어느 선 위에 있는지는 안 본다.']],
      ['h', '더 읽을거리'], ['ul', ['브루스 블록, 『비주얼 스토리』: 공간, 선, 형태가 이야기에 하는 일을 다룬 영화과 교재', '카드의 워크시트 F(게슈탈트 원리)로 덩어리와 선을 따로 연습할 수 있다']]],
    3: [['h', '방향에 따라 달라지는 얼굴'], ['fig', 'spheres', '같은 공에 빛의 자리만 바꿨다. 뒤로 갈수록 밝은 면이 줄고 가장자리만 남는다.'],
      ['p', '정면광은 그림자를 지워 납작하고 깨끗하게, 앞사선은 입체감을, 측면광은 얼굴을 반으로 갈라 긴장을, 뒤사선과 역광은 윤곽만 남겨 인물을 배경에서 떼어 내요. 어느 방향을 골랐는지가 곧 인물을 어떻게 보이게 하고 싶은지예요.'],
      ['fig', 'hardsoft', '바닥에 떨어진 그림자까지 같이 본다. 그림자의 경계가 광원의 크기를 말해 준다.'],
      ['h', '쓰는 순서'], ['ol', ['눈동자를 확대해 반사광의 개수를 센다.', '코 그림자와 턱 그림자가 어느 쪽으로 떨어지는지 본다. 빛은 그 반대편에 있다.', '그림자 가장자리가 또렷한지 번지는지 본다.', '얼굴의 밝은 쪽과 어두운 쪽의 차이를 본다.', '머리카락이나 어깨 가장자리에 밝은 선이 있는지 본다. 있으면 뒤에 빛이 하나 더 있다.', '화면 안에 그 빛을 설명해 주는 창이나 등이 있는지 찾는다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진에서 왼쪽 인물의 그림자가 왼쪽 벽에 또렷하게 떨어져 있어요. 그러니 붉은 빛은 인물의 오른쪽 앞에 있는 작고 센 광원이에요. 오른쪽 위에는 흰 등이 화면 안에 보이고, 젖은 바닥에 반짝이는 점을 만들어요. 광원은 둘, 주광은 오른쪽 앞사선의 딱딱한 빛이에요.'],
      ['h', '자주 하는 실수'], ['ul', ['밝은 곳만 보고 방향을 정한다. 증거는 그림자다.', '광원이 화면에 보이면 그것이 주광이라고 단정한다. 보이는 등은 장식이고 실제 주광은 화면 밖에 있는 경우가 많다.', '역광과 윤곽광을 구별하지 않는다. 역광은 인물 전체가 어두워지고, 윤곽광은 가장자리에 선만 생긴다.']],
      ['h', '더 읽을거리'], ['ul', ['존 올튼, 『빛으로 그리기』: 흑백 영화 시절 촬영감독이 쓴 조명의 고전', '블레인 브라운, 『촬영: 이론과 실제』: 주광·보조광·윤곽광을 그림으로 설명한 교재']]],
    4: [['h', '비율로 보기'], ['fig', 'palettes', '넓은 색, 중간 색, 작은 색의 비를 6:3:1로 놓은 예시 네 가지.'],
      ['p', '색을 고르는 일은 색 이름을 고르는 일이 아니라 면적을 나누는 일이에요. 같은 빨강이라도 화면의 6을 차지하면 분위기가 되고 1을 차지하면 신호가 돼요.'],
      ['fig', 'keys', '화면의 밝기 분포. 어느 쪽이 넓은지가 분위기의 뼈대다.'],
      ['h', '색은 옆의 색에 따라 달라 보인다'], ['p', '같은 회색도 빨강 옆에서는 푸르게, 파랑 옆에서는 붉게 보여요. 그래서 색 하나를 떼어 말하지 않고 "무엇 옆의 무슨 색"이라고 말해요. 피부색이 유난히 살아 보이거나 죽어 보인다면 주변 색을 먼저 봐요.'],
      ['h', '쓰는 순서'], ['ol', ['눈을 가늘게 뜨고 가장 넓은 색을 적는다.', '둘째로 넓은 색, 작지만 튀는 색을 적는다.', '밝은 곳과 그림자의 온도가 같은지 다른지 본다.', '같은 색이 화면의 어디어디에 되풀이되는지 찾는다.', '색이 주인공을 떼어 내는지, 화면을 묶는지 정한다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진은 빨강이 6, 검정이 3.5, 오른쪽 위의 흰푸른 등이 0.5쯤이에요. 빨강은 벽, 얼굴, 넥타이, 바닥에 되풀이되어 화면을 하나로 묶고, 차가운 등 하나가 그 통일을 깨뜨리며 눈을 끌어요.'],
      ['h', '자주 하는 실수'], ['ul', ['색 이름만 적고 면적을 안 적는다.', '조명의 색과 물건 자체의 색을 구별하지 않는다. 벽이 붉은 것인지 빛이 붉은 것인지 따져 본다.', '채도와 밝기를 섞어 쓴다. 어두운데 진한 색도 있고 밝은데 바랜 색도 있다.']],
      ['h', '더 읽을거리'], ['ul', ['요제프 알베르스, 『색채의 상호작용』: 예일대 수업에서 나온 책. 색이 옆의 색에 따라 달라 보인다는 것을 실험으로 보여 준다']]],
    5: [['h', '세 가지 반사'], ['fig', 'reflect', '같은 빛을 받아도 표면에 따라 반사광의 크기와 또렷함이 다르다.'],
      ['p', '반사광이 작고 날카로우면 매끈한 표면, 넓고 흐리면 거친 표면이에요. 만든 사람은 이 차이를 써서 화면에 "만져지는 느낌"을 넣어요. 젖은 바닥을 쓰는 것도 어두운 화면에 날카로운 반사점을 만들기 위해서예요.'],
      ['h', '쓰는 순서'], ['ol', ['화면에서 가장 번들거리는 것과 가장 빛을 먹는 것을 하나씩 찾는다.', '둘이 화면에서 맞닿아 있는지 본다.', '어두운 곳을 확대해 입자가 있는지 본다.', '가장 검은 곳이 완전히 검은지, 회색이나 색이 떠 있는지 본다.', '화면 가장자리와 밝은 광원 주변에서 렌즈의 흔적을 찾는다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진에서는 젖은 아스팔트와 권총의 금속이 날카롭게 반사하고, 두꺼운 코트는 빛을 거의 먹어요. 그래서 코트는 검은 덩어리로 뭉개지고 얼굴과 총만 떠올라요. 어두운 곳에는 굵은 입자가 깔려 있고 검정은 뭉개져 있어요.'],
      ['h', '자주 하는 실수'], ['ul', ['"필름 느낌"이라고만 쓴다. 입자인지, 색인지, 번짐인지 나눠 쓴다.', '선명도를 화질로만 본다. 일부러 무르게 한 곳이 어디인지가 중요하다.']],
      ['h', '더 읽을거리'], ['ul', ['블레인 브라운, 『촬영: 이론과 실제』의 노출과 색 보정 부분']]],
    6: [['h', '배치가 말하는 관계'], ['fig', 'blocking', '두 사람을 어디에 세우느냐만으로 관계가 달라진다.'],
      ['p', '대사가 없어도 인물 사이의 거리, 높낮이, 누가 누구를 가리는지가 관계를 말해요. 뮤직비디오에서 가수와 댄서, 가수와 카메라 사이의 거리도 같은 방식으로 읽어요.'],
      ['h', '쓰는 순서'], ['ol', ['인물의 눈이 어디를 향하는지 적는다.', '어깨, 손, 발의 무게를 본다.', '인물이 둘 이상이면 거리와 높낮이를 적는다.', '화면에 보이는 물건을 빠짐없이 적는다.', '그 물건 중 시대나 직업을 알려 주는 것에 표시한다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진의 두 사람은 어깨가 붙어 있어 한편이고, 둘 다 카메라를 올려다봐요. 총구는 바닥을 향해 있어서 쏘려는 순간이 아니라 끝난 뒤이거나 기다리는 중으로 읽혀요. 굵은 웨이브 머리와 어깨 넓은 코트가 시대감을 만들어요.'],
      ['h', '자주 하는 실수'], ['ul', ['표정만 보고 자세를 안 본다.', '소품을 "총"처럼 이름만 적고 어떻게 들고 있는지는 안 적는다.', '배경을 빈 곳으로 본다. 장소도 정보다.']],
      ['h', '더 읽을거리'], ['ul', ['데이비드 보드웰·크리스틴 톰슨, 『영화 예술』의 미장센 장: 카드의 워크시트 H로 연습할 수 있다']]],
    7: [['h', '찾는 순서'], ['ol', ['이 이미지와 같은 종류의 이미지 열 장을 머릿속에 떠올린다.', '그 열 장이 공통으로 하는 것을 세 가지 적는다.', '이 이미지가 그중 무엇을 안 하는지 찾는다.', '그 "안 함"을 다른 요소가 받쳐 주는지 본다.']],
      ['h', '예시로 읽기'], ['p', '총을 든 인물은 대개 아래에서 올려 찍어 크고 세게 보이게 해요. 붉은 골목 사진은 반대로 위에서 내려다봐요. 그런데 인물들이 눈을 치켜떠 카메라를 보고 있어서, 작아지는 대신 보는 사람이 들킨 쪽이 돼요. 앵글의 위반을 시선이 받쳐 주니 선택이에요.'],
      ['h', '자주 하는 실수'], ['ul', ['마음에 안 드는 곳을 "틀린 것"으로 적는다. 이 칸은 취향이 아니라 관습과의 차이를 적는 곳이다.', '위반을 찾고 효과를 안 쓴다. 효과까지 써야 내 작업에 가져갈 수 있다.']]],
    8: [['h', '하는 순서'], ['ol', ['손가락이나 종이로 인물만 가린다. 남은 화면의 좋음을 다시 매긴다.', '같은 식으로 소품, 배경을 차례로 가린다.', '색은 가릴 수 없으니 화면을 흑백으로 상상한다.', '질감은 매끈한 그림으로, 구도는 정면 눈높이로 바꿔 상상한다.', '가장 많이 내려간 것에 표시한다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진에서 인물을 가리면 빈 골목만 남아 3점이 떨어지고, 빨강을 흑백으로 바꿔도 3점이 떨어져요. 총을 가리면 1점만 떨어져요. 이 이미지를 떠받치는 것은 총이 아니라 "위에서 본 두 사람"과 "빨강"이에요.'],
      ['h', '자주 하는 실수'], ['ul', ['전부 -3을 준다. 다 중요하다는 말은 아무것도 모른다는 말이다.', '실제로 가리지 않고 머리로만 한다.']]],
    9: [['h', '하는 순서'], ['ol', ['비슷한데 덜 끌렸던 이미지를 하나 떠올리거나 찾아 놓는다.', '닮은 점을 먼저 세 가지 적는다.', '다른 점을 하나만 고른다. 가장 큰 것 하나.', '그 하나가 끌림의 차이를 설명하는지 따져 본다.']],
      ['h', '예시로 읽기'], ['p', '같은 붉은 조명을 쓴 정면 눈높이 인물 사진이 있다고 해요. 색도 인물도 비슷한데 덜 끌려요. 차이는 카메라의 자리 하나예요. 위에서 내려다보는 자리가 "누가 보고 있나"라는 질문을 만들어요.'],
      ['h', '더 읽을거리'], ['ul', ['에르빈 파노프스키의 도상 해석: 카드의 워크시트 E로 연습할 수 있다']]],
    10: [['h', '쓰는 순서'], ['ol', ['화면에서 벌어지는 일을 한 문장으로 쓴다. 주어와 동사가 있어야 한다.', '앞 단원에서 찾은 것 중 가장 큰 세 가지를 "만든 사람이 ~했다"로 바꿔 쓴다.', '결정마다 효과를 쓴다.', '결정마다 흔히 택했을 다른 방법을 하나 떠올리고, 그것을 버릴 이유를 쓴다.', '이 한 장을 움직이는 샷으로 바꾼다면 어디서 시작해 어디서 끝날지 쓴다.']],
      ['h', '예시로 읽기'], ['p', '붉은 골목 사진의 결정 하나: 카메라를 위에 뒀다. 효과: 목격자의 자리에서 보게 된다. 버린 대안: 아래에서 올려 찍기. 세 보이지만 흔하고, 보는 사람이 안전한 자리에 남는다. 이렇게 쓰면 다음 촬영에서 같은 갈림길에 섰을 때 고를 수 있어요.'],
      ['h', '자주 하는 실수'], ['ul', ['확인되지 않은 의도를 사실처럼 쓴다.', '효과를 "분위기를 만든다"로 뭉갠다. 보는 사람이 무엇을 하게 되는지로 쓴다.', '대안을 안 쓴다. 대안이 없으면 결정이 아니라 묘사다.']],
      ['h', '더 읽을거리'], ['ul', ['롤랑 바르트, 「이미지의 수사학」과 『밝은 방』: 외연과 내포, 스투디움과 푼크툼. 카드의 워크시트 D로 연습할 수 있다']]],
    11: [['h', '쓰는 순서'], ['ol', ['최종 문장을 쓴다. 자동으로 들어간 문장을 내 말로 고친다.', '레시피 일곱 칸을 남이 읽고 찍을 수 있게 숫자와 방향으로 쓴다.', '훔칠 것 하나를 정한다. 여러 개가 아니라 하나.', '쓴 것을 확실, 추정, 모름으로 나눈다.']],
      ['h', '예시로 읽기'], ['p', '최종 문장: "이 이미지가 좋은 이유는 위에서 내려다본 두 인물과 화면을 덮은 빨강 때문이고, 그게 뜨겁게 가라앉은 느낌을 만든다." 레시피: 카메라는 3미터 위, 빨간 필터 조명 하나를 오른쪽 앞에, 바닥에 물을 뿌린다. 훔칠 것: 젖은 바닥으로 차가운 반사점 만들기.'],
      ['h', '자주 하는 실수'], ['ul', ['최종 문장에 새 내용을 넣는다. 앞에서 찾은 것만으로 써야 한다.', '레시피를 느낌으로 쓴다. "어둡게"는 레시피가 아니다.', '약점을 안 찾는다. 좋아하는 이미지에서도 덜어낼 것을 하나 찾는다.']],
      ['h', '더 읽을거리'], ['ul', ['에드먼드 펠드먼의 비평 네 단계: 카드의 워크시트 C로 연습할 수 있다', '테리 바렛, 『사진 비평』: 묘사하고 해석하고 평가하는 법을 다룬 교재']]],
  };
  for (const ch of BOOK) if (BOOK_MORE[ch.n]) ch.body.push(...BOOK_MORE[ch.n]);
  BOOK[1].terms.push(['샷 크기', '인물이 화면에 담긴 정도. 롱, 풀, 미디엄, 클로즈업 등'], ['버즈 아이 / 웜즈 아이', '수직으로 내려다본 화면 / 바닥에서 올려다본 화면'], ['더치 틸트', '수평선을 일부러 기울인 화면'],
    ['시점 샷 (POV)', '인물의 눈으로 본 화면'], ['리딩 라인', '주인공 쪽으로 눈을 끌고 가는 선'], ['프레임 속 프레임', '문이나 창으로 인물을 한 번 더 가두는 구도'], ['압축 효과', '망원 렌즈에서 앞뒤 거리가 붙어 보이는 현상'], ['보케', '초점 밖에서 흐려진 빛망울']);
  BOOK[2].body.splice(BOOK[2].body.findIndex((x) => x[1] === '쓰는 순서'), 0,
    ['h', '얼굴 조명의 이름들'], ['p', '인물을 비추는 방식에는 오래된 이름이 붙어 있어요. 코 그림자와 뺨의 밝은 면을 보면 구별할 수 있어요.'],
    ['ul', ['플랫: 정면에서 비춰 그림자가 거의 없다', '버터플라이(파라마운트): 정면 위에서 비춰 코 밑에 나비 모양 그림자가 생긴다', '루프: 코 그림자가 뺨 쪽으로 작은 고리를 만든다', '렘브란트: 어두운 쪽 뺨에 역삼각형 빛 한 조각이 남는다', '스플릿: 옆에서 비춰 얼굴이 반으로 갈린다', '브로드와 쇼트: 카메라 쪽 뺨이 밝으면 브로드, 반대쪽 뺨이 밝으면 쇼트', '림과 실루엣: 뒤에서 비춰 가장자리만, 또는 윤곽만 남긴다']],
    ['h', '색온도와 다듬는 도구'], ['p', '빛의 색은 켈빈(K)으로 말해요. 텅스텐 전구는 3200K쯤으로 주황, 한낮 햇빛은 5600K쯤으로 흰색, 그늘은 그보다 높아 푸르게 보여요. 현장에서는 디퓨전으로 빛을 퍼뜨리고, 반사판으로 튕기고, 검은 천(네거티브 필)으로 그림자를 깊게 하고, 고보로 무늬를 드리워요. 화면에 남은 흔적으로 어떤 도구를 썼는지 추정할 수 있어요.']);
  BOOK[2].terms.push(['렘브란트 조명', '어두운 쪽 뺨에 역삼각형 빛이 남는 얼굴 조명'], ['프랙티컬', '화면 안에 보이는 실제 등'], ['색온도', '빛의 색을 켈빈(K)으로 나타낸 값'], ['조명비', '주광과 보조광의 세기 차이'],
    ['네거티브 필', '검은 천으로 빛을 막아 그림자를 깊게 하는 것'], ['고보', '빛 앞에 놓아 무늬 그림자를 만드는 가리개'], ['키아로스쿠로', '어둠 속에서 일부만 강하게 드러내는 명암법']);

  async function loadStudy() { return (await store.get('meta', 'study')) || { id: 'study', read: {}, quiz: {} }; }
  const quizDone = (study, ch) => ch.quiz.filter((_, i) => study.quiz[`${ch.n}.${i}`]).length;

  async function showBookList() {
    cur = null; savedLabel = null;
    const study = await loadStudy();
    const total = BOOK.reduce((a, ch) => a + ch.quiz.length, 0);
    const solved = BOOK.reduce((a, ch) => a + quizDone(study, ch), 0);
    app.replaceChildren(h('div', { class: 'wrap' }, topBar('book', '보는 법을 배우는 열한 단원'),
      h('div', { class: 'book' },
        h('p', { class: 'booklead' }, '각 단원은 분석 카드의 한 단계와 짝이에요. 먼저 읽고, 확인 문제를 풀고, 카드에서 직접 써 보는 순서로 공부해요.'),
        h('p', { class: 'note', id: 'study-progress' }, `읽은 단원 ${Object.keys(study.read).length}/${BOOK.length} · 확인 문제 ${solved}/${total}`),
        h('ol', { class: 'toc' }, BOOK.map((ch) => h('li', {},
          h('button', { class: 'tocrow', type: 'button', onclick: () => { location.hash = 'book-' + ch.n; } },
            h('span', { class: 'tocno' }, pad(ch.n)),
            h('span', { class: 'toctext' }, h('strong', {}, ch.title), h('span', { class: 'note' }, ch.goal)),
            h('span', { class: 'chip-state' + (study.read[ch.n] && quizDone(study, ch) === ch.quiz.length ? ' done' : '') },
              study.read[ch.n] ? `문제 ${quizDone(study, ch)}/${ch.quiz.length}` : '안 읽음'))))))));
    window.scrollTo(0, 0);
  }
  async function showBook(n) {
    const ch = BOOK.find((c) => c.n === Number(n));
    if (!ch) { location.hash = 'book'; return; }
    cur = null; savedLabel = null;
    const study = await loadStudy();
    if (!study.read[ch.n]) { study.read[ch.n] = Date.now(); await store.put('meta', study); }
    let figNo = 0;
    const body = ch.body.map(([kind, a, b]) => {
      if (kind === 'h') return h('h3', {}, a);
      if (kind === 'p') return h('p', {}, a);
      if (kind === 'ul') return h('ul', {}, a.map((t) => h('li', {}, t)));
      if (kind === 'ol') return h('ol', {}, a.map((t) => h('li', {}, t)));
      const fig = h('figure', { class: 'fig' });
      fig.innerHTML = FIG[a]();
      fig.append(h('figcaption', {}, h('span', { class: 'figno' }, `그림 ${ch.n}-${++figNo}`), b));
      return fig;
    });
    const score = h('span', { class: 'chip-state' });
    const drawScore = () => { const d = quizDone(study, ch); score.textContent = `${d}/${ch.quiz.length}`; score.classList.toggle('done', d === ch.quiz.length); };
    const quiz = ch.quiz.map((qz, i) => {
      const fb = h('p', { class: 'qfb', hidden: true });
      const opts = h('div', { class: 'qopts', role: 'group', 'aria-label': `확인 문제 ${i + 1}` }, qz.o.map((text, j) =>
        h('button', { class: 'btn qopt', type: 'button', onclick: async (e) => {
          const right = j === qz.a;
          const me = e.currentTarget;
          opts.querySelectorAll('.qopt').forEach((bt) => bt.classList.remove('right', 'wrong'));
          me.classList.add(right ? 'right' : 'wrong');
          fb.hidden = false;
          fb.replaceChildren(h('strong', {}, right ? '맞아요. ' : '다시 생각해 봐요. '), right ? qz.why : '본문에서 이 부분을 다시 읽고 골라 보세요.');
          if (right && !study.quiz[`${ch.n}.${i}`]) { study.quiz[`${ch.n}.${i}`] = Date.now(); await store.put('meta', study); drawScore(); }
        } }, text)));
      return h('div', { class: 'q' }, h('p', { class: 'qtext' }, h('span', { class: 'figno' }, `문제 ${i + 1}`), qz.q), opts, fb);
    });
    drawScore();
    const prev = BOOK.find((c) => c.n === ch.n - 1); const next = BOOK.find((c) => c.n === ch.n + 1);
    app.replaceChildren(h('div', { class: 'wrap' }, topBar('book', '보는 법을 배우는 열한 단원'),
      h('article', { class: 'book chapter' },
        h('div', {}, h('button', { class: 'btn quiet small', type: 'button', onclick: () => { location.hash = 'book'; } }, '← 목차')),
        h('header', { class: 'chhead' }, h('span', { class: 'chno' }, pad(ch.n)), h('div', {}, h('p', { class: 'chkicker' }, `${ch.n}단원`), h('h2', {}, ch.title))),
        h('div', { class: 'goal' }, h('span', { class: 'helptag' }, '학습 목표'), ch.goal),
        body,
        h('h3', {}, '핵심 용어'),
        h('dl', { class: 'terms' }, ch.terms.map(([t, d]) => h('div', {}, h('dt', {}, t), h('dd', {}, d)))),
        h('div', { class: 'fieldtop qhead' }, h('h3', {}, '확인 문제'), score), quiz,
        h('h3', {}, '직접 해 보기'),
        h('p', {}, `분석 카드의 ${ch.n}단계가 이 단원의 연습 문제예요. 이미지 한 장을 골라 방금 읽은 것을 써 보세요.`),
        h('div', { class: 'seg' },
          h('button', { class: 'btn solid', type: 'button', onclick: () => { location.hash = 'new'; } }, '새 카드로 연습하기'),
          prev ? h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = 'book-' + prev.n; } }, `← ${prev.n}단원 ${prev.title}`) : null,
          next ? h('button', { class: 'btn', type: 'button', onclick: () => { location.hash = 'book-' + next.n; } }, `${next.n}단원 ${next.title} →`) : null))));
    window.scrollTo(0, 0);
  }

  function topBar(active, sub, action) {
    const tab = (key, name, hash) => h('button', { class: 'tab' + (active === key ? ' on' : ''), type: 'button', id: 'tab-' + key,
      'aria-current': active === key ? 'page' : null, onclick: () => { location.hash = hash; } }, name);
    return h('div', { class: 'top' },
      h('div', {},
        h('h1', {}, 'DOPEYE'),
        h('div', { class: 'sub' }, sub, h('span', { class: 'ver' }, `  v${APP_VERSION.split(' ')[0]}`))),
      h('div', { class: 'row' },
        h('nav', { class: 'tabs', 'aria-label': '화면 이동' }, tab('book', '교과서', 'book'), tab('list', '카드', 'list'), tab('series', '시리즈', 'series'), tab('diary', '일기', 'diary'), tab('look', '돌아보기', 'look'), tab('backup', '백업', 'backup')),
        action || null));
  }

  async function route() {
    const name = location.hash.replace(/^#/, '');
    const sameCard = inEditor && cur && name === 'card-' + cur.id;
    if (!sameCard) inEditor = false;
    if (flushPage) { await flushPage(); flushPage = null; }
    diaryPaste = null;
    if (name === 'diary') return showDiary();
    if (name === 'book') return showBookList();
    if (name.startsWith('book-')) return showBook(name.slice(5));
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
