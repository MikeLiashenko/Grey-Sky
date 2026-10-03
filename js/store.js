// Слой данных: Firebase (если в config.js указан apiKey) или демо-режим на localStorage.
window.Store = (function () {
  const cfg = window.GS_CONFIG;
  const ROOT = cfg.root || 'greysky';

  if (cfg.firebase.apiKey) {
    firebase.initializeApp(cfg.firebase);
    const db = firebase.database();
    const auth = firebase.auth();
    // Путь с «/» в начале — общий с приложением StormBook (корень базы), без него — узел сайта.
    const ref = p => (p[0] === '/' ? db.ref(p.slice(1)) : db.ref(ROOT + '/' + p));
    const val = p => db.ref(p).get().then(s => s.val());
    const err = code => Object.assign(new Error(code), { code });
    const cleanName = raw => {
      const n = String(raw || '').trim().toLowerCase();
      if (!/^[^.#$\[\]\/\s]{2,24}$/.test(n)) throw err('gs/bad-name');
      return n;
    };
    let authCb = () => {}, seq = 0;

    // Аккаунты общие с приложением: позывной — ключ данных, usernames/{позывной} = uid, uidToName/{uid} = позывной.
    async function claim(raw) {
      const name = cleanName(raw), u = auth.currentUser;
      const owner = await val('usernames/' + name);
      if (owner && owner !== u.uid) throw err('gs/name-taken');
      await db.ref('usernames/' + name).set(u.uid);
      await db.ref('uidToName/' + u.uid).set(name);
      if (u.displayName !== name) await u.updateProfile({ displayName: name });
      if (!(await val('users/' + name))) {
        await db.ref('users/' + name).set({ email: u.email || '', balance: 250, profile: { avatar: '', desc: 'Штормхантер' }, inventory: {}, equipped: { title: '', frame: '' }, privacy: 'public', onboarded: false });
      }
      return name;
    }
    async function refresh() {
      const my = ++seq, u = auth.currentUser;
      if (!u) return authCb(null);
      let name = null;
      try { name = await val('uidToName/' + u.uid); } catch (e) {}
      if (!name && u.displayName) { try { name = await claim(u.displayName); } catch (e) {} }
      if (my === seq) authCb({ uid: u.uid, name: name || '', email: u.email, needName: !name });
    }

    return {
      demo: false,
      on(p, cb, last, onErr) {
        let r = ref(p);
        if (last) r = r.limitToLast(last);
        const h = r.on('value', s => cb(s.val()), e => { console.warn('[db]', p, e.message); if (onErr) onErr(e); else cb(null); });
        return () => r.off('value', h);
      },
      get: p => ref(p).get().then(s => s.val()),
      set: (p, v) => ref(p).set(v),
      update: (p, v) => ref(p).update(v),
      push: (p, v) => ref(p).push(v).then(() => {}),
      remove: p => ref(p).remove(),
      now: () => firebase.database.ServerValue.TIMESTAMP,
      onAuth(cb) { authCb = cb; auth.onAuthStateChanged(refresh); },
      login: (e, p) => auth.signInWithEmailAndPassword(e, p),
      async register(e, p, rawName) {
        const name = cleanName(rawName);
        if (await val('usernames/' + name)) throw err('gs/name-taken');
        await auth.createUserWithEmailAndPassword(e, p);
        await claim(name);
        await refresh();
      },
      async claim(rawName) { await claim(rawName); await refresh(); },
      logout: () => auth.signOut()
    };
  }

  // ---------- ДЕМО-режим ----------
  const KEY = 'gs_demo_v2', UKEY = 'gs_demo_user';
  const H = 3600e3, DAY = 24 * H, now = Date.now();
  const seed = () => ({
    admins: { 'demo-admin': true },
    settings: {
      announce: 'Сезон гроз открыт! Новые выезды каждую неделю.',
      live: true, liveTitle: 'Стрим: шторм идёт на город', liveUrl: 'https://www.youtube.com/',
      about: 'Канал о грозах: выезды, охота за молниями, таймлапсы шторма и разборы погоды.'
    },
    videos: {
      v1: { title: 'Суперячейка над полем: 40 минут чистой грозы', desc: 'Самый мощный выезд сезона. Шельфовое облако, град и больше сотни молний.', date: now + 2 * DAY + 5 * H, status: 'editing', progress: 70, ts: now - 3 * DAY },
      v2: { title: 'Ночная гроза в 4K — молнии в замедленной съёмке', desc: 'Съёмка на 240 fps: видно, как ветвится каждый разряд.', date: now + 9 * DAY, status: 'filming', progress: 30, ts: now - 2 * DAY },
      v3: { title: 'Как я снимаю молнии: вся техника и настройки', desc: 'Камера, штатив, триггер молний и безопасность.', date: 0, status: 'planned', progress: 5, ts: now - DAY },
      v4: { title: 'Шторм накрыл город за 10 минут', desc: 'Таймлапс приближения грозового фронта.', date: now - 6 * DAY, status: 'released', progress: 100, url: '', ts: now - 12 * DAY }
    },
    spoilers: {
      s1: { title: 'Что будет в видео про суперячейку?', text: 'В конце ролика молния ударит в дерево в 200 метрах от камеры. Звук — без обработки!', ts: now - DAY },
      s2: { title: 'Куда следующий выезд?', text: 'Едем на юг — там по прогнозу линия шквалов. Возьму вторую камеру для таймлапса.', ts: now - 5 * H }
    },
    posts: {
      p1: { title: 'Добро пожаловать на сайт канала!', text: 'Здесь будут анонсы видео, спойлеры, опросы и чат. Заходи почаще — гроза не ждёт ⚡', pinned: true, ts: now - 4 * DAY },
      p2: { title: 'Выезд сорвался, но не совсем', text: 'Фронт развалился прямо на подходе. Зато снял отличный закат с мамматусами — покажу в следующем видео.', ts: now - 20 * H }
    },
    polls: {
      q1: { question: 'Какое видео снять следующим?', options: ['Ночная гроза', 'Таймлапс шторма', 'Разбор техники', 'Стрим с выезда'], open: true, ts: now - 2 * DAY }
    },
    votes: { q1: { u1: 0, u2: 0, u3: 1, u4: 3, u5: 0 } },
    hype: { v1: { u1: true, u2: true, u3: true }, v2: { u1: true } },
    likes: { p1: { u1: true, u2: true }, p2: { u3: true } },
    comments: { p1: { c1: { uid: 'u1', name: 'Шторм_Чейзер', text: 'Наконец-то свой сайт! Жду спойлеры.', ts: now - 3 * DAY } } },
    ideas: {
      i1: { uid: 'u2', name: 'Thunder', text: 'Сними грозу над морем!', status: 'planned', ts: now - 2 * DAY },
      i2: { uid: 'u3', name: 'Молния', text: 'Сделай рубрику «гроза недели» с роликами подписчиков', status: 'new', ts: now - DAY }
    },
    ideaVotes: { i1: { u1: true, u2: true, u4: true }, i2: { u1: true } },
    chats: { global: {
      m1: { author: 'шторм_чейзер', text: 'Всем привет! У кого сегодня гремит?', time: now - 2 * H },
      m2: { author: 'молния', text: 'У нас с утра ливень и гром ⚡', time: now - H },
      m3: { author: 'greysky', text: 'Сегодня вечером выезжаю, следите за стримом!', time: now - 30 * 60e3 }
    } },
    bans: {}
  });

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  let data = load() || seed();
  const subs = [];
  const get = p => p.replace(/^\//, '').split('/').reduce((o, k) => (o == null ? undefined : o[k]), data);
  const emit = () => subs.forEach(s => { const v = get(s.p); s.cb(v == null ? null : JSON.parse(JSON.stringify(v))); });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} emit(); };
  const setAt = (p, v) => {
    const ks = p.replace(/^\//, '').split('/');
    let o = data;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] = (o[ks[i]] && typeof o[ks[i]] === 'object') ? o[ks[i]] : {};
    if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  window.addEventListener('storage', e => { if (e.key === KEY) { data = load() || data; emit(); } });

  let user = null, authCb = () => {};
  try { user = JSON.parse(localStorage.getItem(UKEY)); } catch (e) {}
  const setUser = u => { user = u; try { localStorage.setItem(UKEY, JSON.stringify(u)); } catch (e) {} authCb(u); };
  const ok = fn => (...a) => { fn(...a); return Promise.resolve(); };

  return {
    demo: true,
    on(p, cb) { const s = { p, cb }; subs.push(s); const v = get(p); cb(v == null ? null : JSON.parse(JSON.stringify(v))); return () => subs.splice(subs.indexOf(s), 1); },
    get: p => Promise.resolve(get(p) == null ? null : get(p)),
    set: ok((p, v) => { setAt(p, v); save(); }),
    update: ok((p, v) => { Object.keys(v).forEach(k => setAt(p + '/' + k, v[k])); save(); }),
    push: ok((p, v) => { setAt(p + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), v); save(); }),
    remove: ok(p => { setAt(p, null); save(); }),
    now: () => Date.now(),
    onAuth(cb) { authCb = cb; cb(user); },
    login: ok(e => setUser({ uid: 'demo-admin', name: (e || 'Админ').split('@')[0], email: e })),
    register: ok((e, p, name) => setUser({ uid: 'demo-admin', name: name || 'Админ', email: e })),
    claim: ok(name => setUser(Object.assign({}, user, { name }))),
    logout: ok(() => setUser(null))
  };
})();
