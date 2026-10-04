(function () {
  const C = window.GS_CONFIG, S = window.Store;
  const $ = (s, r = document) => r.querySelector(s);
  const view = $('#view');

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(u || '') ? esc(u) : '');
  const rich = s => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  const ytId = u => { const m = String(u || '').match(/(?:youtu\.be\/|v=|shorts\/|live\/|embed\/)([\w-]{11})/); return m ? m[1] : ''; };
  const list = o => Object.entries(o || {}).map(([id, v]) => Object.assign({ id }, v));
  const count = o => Object.keys(o || {}).length;
  const byNew = (a, b) => (b.ts || 0) - (a.ts || 0);
  const fmtDate = ts => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const fmtTime = ts => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const ago = ts => {
    const m = Math.floor((Date.now() - ts) / 60e3);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    if (m < 1440) return Math.floor(m / 60) + ' ч назад';
    if (m < 43200) return Math.floor(m / 1440) + ' дн назад';
    return fmtDate(ts);
  };
  const hue = uid => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const toLocalInput = ms => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16) : '');

  let toastTimer;
  const toast = t => { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200); };
  const ERR = {
    'auth/invalid-credential': 'Неверная почта или пароль', 'auth/wrong-password': 'Неверный пароль', 'auth/user-not-found': 'Такого аккаунта нет',
    'auth/email-already-in-use': 'Эта почта уже зарегистрирована', 'auth/weak-password': 'Пароль слишком простой (минимум 6 символов)',
    'auth/invalid-email': 'Неверный формат почты', 'auth/invalid-login-credentials': 'Неверная почта или пароль',
    'gs/name-taken': 'Этот позывной уже занят', 'gs/bad-name': 'Позывной: 2–24 символа, без пробелов и знаков . # $ [ ] /', 'PERMISSION_DENIED': 'Нет прав на это действие'
  };
  const run = p => Promise.resolve(p).catch(e => { console.warn(e); toast(ERR[e.code] || (/permission/i.test(e.message) ? ERR.PERMISSION_DENIED : 'Ошибка: ' + e.message)); throw e; });

  // ---------- state ----------
  const D = { settings: {}, videos: {}, spoilers: {}, posts: {}, polls: {}, votes: {}, hype: {}, likes: {}, comments: {}, ideas: {}, ideaVotes: {}, bans: {}, chat: {} };
  let user = null, adminFlag = false, adminWhy = '', offChat = null, offAdmin = null;
  const avatars = {}; // позывной → аватар из профиля приложения
  const ui = { revealed: new Set(), openC: new Set(), edit: null, tab: 'settings', authMode: 'login' };
  const isAdmin = () => !!(user && adminFlag);
  const isBanned = () => !!(user && D.bans[user.uid]);
  const needUser = () => { if (user && !user.needName) return true; user ? openProfile() : openAuth(); return false; };

  const STATUS = { planned: 'В планах', filming: 'Съёмка', editing: 'Монтаж', ready: 'Скоро выйдет', released: 'Вышло' };
  const IDEA = { new: 'Новая', planned: 'В планах', done: 'Сделано', rejected: 'Отклонено' };

  // ---------- pieces ----------
  const likeBtn = (path, id, label) => {
    const n = count(D[path][id]), on = user && D[path][id] && D[path][id][user.uid];
    return `<button class="btn ghost small ${on ? 'on' : ''}" data-a="toggle" data-p="${path}" data-id="${esc(id)}">${label} ${n}</button>`;
  };
  const cover = v => {
    const id = ytId(v.url), img = safeUrl(v.cover) || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
    if (!img) return '';
    const href = safeUrl(v.url);
    return href ? `<a class="thumb" href="${href}" target="_blank" rel="noopener" style="background-image:url('${img}')"></a>` : `<div class="thumb" style="background-image:url('${img}')"></div>`;
  };
  const upcoming = () => list(D.videos).filter(v => v.status !== 'released').sort((a, b) => (a.date || 9e15) - (b.date || 9e15));
  // вышедшие: сначала добавленные в админке, затем снимок канала из channel-videos.js (без дублей)
  const released = () => {
    const db = list(D.videos).filter(v => v.status === 'released').sort((a, b) => (b.date || b.ts || 0) - (a.date || a.ts || 0));
    const have = new Set(db.map(v => ytId(v.url)).filter(Boolean));
    const chan = (window.GS_CHANNEL_VIDEOS || []).filter(v => !have.has(v.id))
      .map(v => ({ id: 'yt-' + v.id, title: v.title, status: 'released', day: v.date, url: 'https://www.youtube.com/watch?v=' + v.id }));
    return db.concat(chan);
  };

  const videoCard = v => `
    <div class="card">
      ${cover(v)}
      <div class="row"><span class="badge ${esc(v.status)}">${STATUS[v.status] || ''}</span>
        <span class="muted">${v.date ? fmtDate(v.date) : v.day ? new Date(v.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : v.status === 'released' ? '' : 'дата уточняется'}</span></div>
      <h3 style="margin-top:10px">${esc(v.title)}</h3>
      ${v.desc ? `<p class="muted">${rich(v.desc)}</p>` : ''}
      ${v.status !== 'released' ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, +v.progress || 0))}%"></i></div>
        <div class="row">${likeBtn('hype', v.id, '⚡ Жду')}<span class="muted">готово на ${+v.progress || 0}%</span></div>`
      : (safeUrl(v.url) ? `<a class="btn small" href="${safeUrl(v.url)}" target="_blank" rel="noopener">▶ Смотреть</a>` : '')}
    </div>`;

  const postCard = (p, short) => {
    const cs = list(D.comments[p.id]).sort((a, b) => a.ts - b.ts), open = ui.openC.has(p.id);
    return `<div class="card stack">
      <div class="row">${p.pinned ? '<span class="badge editing">Закреп</span>' : ''}<span class="muted">${ago(p.ts)}</span></div>
      <h3 style="margin-top:8px">${esc(p.title)}</h3>
      <p>${short && (p.text || '').length > 220 ? rich(p.text.slice(0, 220)) + '…' : rich(p.text)}</p>
      ${!short && safeUrl(p.image) ? `<img class="pic" src="${safeUrl(p.image)}" alt="" loading="lazy">` : ''}
      <div class="row">${likeBtn('likes', p.id, '♥')}${safeUrl(p.tgLink) ? `<a class="btn ghost small" href="${safeUrl(p.tgLink)}" target="_blank" rel="noopener">Открыть в Telegram</a>` : ''}
        ${short ? `<a class="btn ghost small" href="#/posts">💬 ${cs.length}</a>` : `<button class="btn ghost small" data-a="comments" data-id="${esc(p.id)}">💬 ${cs.length}</button>`}</div>
      ${!short && open ? `<div class="comments">
        ${cs.map(c => `<div class="comment"><b style="color:hsl(${hue(c.uid)} 80% 72%)">${esc(c.name)}</b><span class="muted">${ago(c.ts)}</span>
          ${user && (isAdmin() || c.uid === user.uid) ? `<button class="link" data-a="rm" data-p="comments/${esc(p.id)}/${esc(c.id)}">удалить</button>` : ''}
          ${isAdmin() && c.uid !== user.uid ? ` <button class="link" data-a="ban" data-id="${esc(c.uid)}" data-name="${esc(c.name)}">бан</button>` : ''}
          <div>${rich(c.text)}</div></div>`).join('') || '<p class="muted">Комментариев пока нет — будь первым.</p>'}
        <form class="inline" data-f="comment" data-id="${esc(p.id)}">
          <input data-k="c-${esc(p.id)}" name="text" maxlength="500" placeholder="${user ? 'Написать комментарий…' : 'Войди, чтобы комментировать'}" autocomplete="off">
          <button class="btn small">Отправить</button></form></div>` : ''}
    </div>`;
  };

  const pollCard = q => {
    const votes = D.votes[q.id] || {}, total = count(votes), mine = user ? votes[user.uid] : undefined;
    const opts = q.options || [];
    return `<div class="card stack"><div class="row"><span class="badge ${q.open ? 'ready' : ''}">${q.open ? 'Идёт' : 'Завершён'}</span><span class="muted">${total} голосов</span></div>
      <h3 style="margin:10px 0">${esc(q.question)}</h3>
      ${opts.map((o, i) => {
        const n = Object.values(votes).filter(x => x === i).length, pc = total ? Math.round(n / total * 100) : 0;
        return `<button class="opt ${mine === i ? 'mine' : ''}" data-a="vote" data-id="${esc(q.id)}" data-i="${i}" ${q.open ? '' : 'disabled'}>
          <i style="width:${pc}%"></i><span>${esc(o)}</span><span>${pc}%</span></button>`;
      }).join('')}</div>`;
  };

  const mediaSrc = (u, kind) => (new RegExp('^data:' + kind + '/', 'i').test(u || '') || /^https:\/\//i.test(u || '') ? esc(u) : '');
  const media = m => {
    const src = mediaSrc(m.media, m.mediaType);
    if (!src) return '';
    if (m.mediaType === 'image') return `<img class="pic" src="${src}" alt="" loading="lazy">`;
    if (m.mediaType === 'video') return `<video class="pic" src="${src}" controls></video>`;
    if (m.mediaType === 'audio') return `<audio src="${src}" controls></audio>`;
    return '';
  };
  function loadAvatar(name) {
    if (!name || name in avatars) return;
    avatars[name] = '';
    S.get('/users/' + name + '/profile/avatar').then(v => { if (mediaSrc(v, 'image')) { avatars[name] = v; schedule(); } }).catch(() => {});
  }

  // ---------- pages ----------
  const PAGES = {
    home() {
      const s = D.settings, next = upcoming().find(v => v.date > Date.now()) || upcoming()[0];
      const posts = list(D.posts).sort((a, b) => (!!b.pinned - !!a.pinned) || byNew(a, b)).slice(0, 2);
      const poll = list(D.polls).filter(q => q.open).sort(byNew)[0];
      const rel = released().slice(0, 3);
      const yt = safeUrl(s.youtube || C.youtube);
      return `<section class="hero"><h1>${esc(C.channelName)}</h1><p>${esc(s.about || C.tagline)}</p>
          <div class="row">${yt ? `<a class="btn" href="${yt}" target="_blank" rel="noopener">▶ Канал на YouTube</a>` : ''}${TG.username(s.tgChannel) ? `<a class="btn ghost" href="https://t.me/${esc(TG.username(s.tgChannel))}" target="_blank" rel="noopener">Telegram-канал</a>` : ''}<a class="btn ghost" href="#/chat">Зайти в чат</a></div></section>
        ${s.live ? `<div class="banner live"><span class="dot"></span><div class="grow"><b>В эфире:</b> ${esc(s.liveTitle || 'идёт стрим')}</div>
          ${safeUrl(s.liveUrl) ? `<a class="btn small" href="${safeUrl(s.liveUrl)}" target="_blank" rel="noopener">Смотреть</a>` : ''}</div>` : ''}
        ${s.announce ? `<div class="banner"><span>📢</span><div class="grow">${rich(s.announce)}</div></div>` : ''}
        ${next ? `<div class="head"><h2>Следующее видео</h2><a href="#/videos">все анонсы →</a></div>
          <div class="card"><div class="row"><span class="badge ${esc(next.status)}">${STATUS[next.status] || ''}</span></div>
            <h3 style="margin-top:10px;font-size:18px">${esc(next.title)}</h3>
            ${next.date > Date.now() ? `<div class="countdown" data-cd="${+next.date}"></div>` : '<p class="muted">Дата выхода уточняется</p>'}
            <div class="bar"><i style="width:${Math.max(0, Math.min(100, +next.progress || 0))}%"></i></div>
            <div class="row">${likeBtn('hype', next.id, '⚡ Жду')}<a class="btn ghost small" href="#/spoilers">Спойлеры</a></div></div>` : ''}
        ${posts.length ? `<div class="head"><h2>Свежие посты</h2><a href="#/posts">все посты →</a></div>${posts.map(p => postCard(p, true)).join('')}` : ''}
        ${poll ? `<div class="head"><h2>Опрос</h2><a href="#/community">сообщество →</a></div>${pollCard(poll)}` : ''}
        ${rel.length ? `<div class="head"><h2>Недавно вышло</h2><a href="#/videos">все видео →</a></div><div class="grid">${rel.map(videoCard).join('')}</div>` : ''}`;
    },

    videos() {
      const up = upcoming(), rel = released();
      return `<h1>Видео</h1><p class="muted">Что снимается, что монтируется и когда выйдет. Жми «Жду», чтобы я видел, какое видео делать первым.</p>
        <h2>Скоро</h2>${up.length ? `<div class="grid">${up.map(videoCard).join('')}</div>` : '<div class="empty">Анонсов пока нет</div>'}
        <h2>Вышло</h2>${rel.length ? `<div class="grid">${rel.map(videoCard).join('')}</div>` : '<div class="empty">Тут появятся вышедшие видео</div>'}`;
    },

    spoilers() {
      const sp = list(D.spoilers).sort(byNew);
      return `<h1>Спойлеры</h1><p class="muted">Осторожно: тут кадры и детали ещё не вышедших видео. Открывай на свой страх и риск.</p>
        ${sp.length ? `<div class="grid">${sp.map(s => `<div class="card spoiler ${ui.revealed.has(s.id) ? 'open' : ''}">
          <h3>${esc(s.title)}</h3><div class="muted">${ago(s.ts)}</div>
          <div class="body">${ui.revealed.has(s.id) ? `<p style="margin-top:8px">${rich(s.text)}</p>${safeUrl(s.image) ? `<img class="pic" src="${safeUrl(s.image)}" alt="" loading="lazy">` : ''}`
            : '<p style="margin-top:8px">Здесь спрятан спойлер. Здесь спрятан спойлер. Здесь спрятан спойлер. Здесь спрятан спойлер.</p>'}</div>
          <div class="veil"><button class="btn small" data-a="reveal" data-id="${esc(s.id)}">👁 Показать спойлер</button></div></div>`).join('')}</div>`
        : '<div class="empty">Спойлеров пока нет</div>'}`;
    },

    posts() {
      const posts = list(D.posts).sort((a, b) => (!!b.pinned - !!a.pinned) || byNew(a, b));
      return `<h1>Посты</h1>${posts.length ? posts.map(p => postCard(p)).join('') : '<div class="empty">Постов пока нет</div>'}`;
    },

    chat() {
      if (!user && !S.demo) return `<h1>Чат</h1><div class="empty">Это общий чат с приложением StormBook — он виден только после входа.<br><br><button class="btn" data-a="account">Войти</button></div>`;
      const msgs = list(D.chat).sort((x, y) => (x.time || 0) - (y.time || 0));
      msgs.forEach(m => loadAvatar(m.author));
      return `<h1>Чат</h1><p class="muted">Общий чат сайта и приложения StormBook.</p><div class="card chat"><div id="chatlog">
        ${msgs.map(m => {
          const mine = user && m.author === user.name, av = avatars[m.author];
          return `<div class="msg">${av ? `<img class="ava" src="${esc(av)}" alt="">` : `<div class="ava" style="background:hsl(${hue(m.author)} 75% 68%)">${esc((m.author || '?')[0].toUpperCase())}</div>`}
          <div><b style="color:hsl(${hue(m.author)} 80% 72%)">${esc((m.author || '').toUpperCase())}</b>
            <span class="muted"> ${m.time ? fmtTime(m.time) : ''}${m.edited ? ' · изменено' : ''}</span>
            <span class="tools">${mine || isAdmin() ? `<button class="link" data-a="rm" data-p="/chats/global/${esc(m.id)}">удалить</button>` : ''}</span>
            <div class="txt">${rich(m.text)}</div>${media(m)}</div></div>`;
        }).join('') || '<p class="muted">В чате пока тихо. Напиши первым!</p>'}
        </div>
        <form class="inline" data-f="chat"><input data-k="chat" name="text" maxlength="500" autocomplete="off" placeholder="${user ? 'Сообщение…' : 'Войди, чтобы писать'}"><button class="btn">Отправить</button></form>
      </div>`;
    },

    community() {
      const polls = list(D.polls).sort((a, b) => (!!b.open - !!a.open) || byNew(a, b));
      const ideas = list(D.ideas).sort((a, b) => count(D.ideaVotes[b.id]) - count(D.ideaVotes[a.id]) || byNew(a, b));
      return `<h1>Сообщество</h1>
        <h2>Опросы</h2>${polls.length ? polls.map(pollCard).join('') : '<div class="empty">Опросов пока нет</div>'}
        <h2>Идеи для видео</h2><p class="muted">Предложи, что снять, и голосуй за чужие идеи — лучшие попадут в план.</p>
        <form class="inline stack" data-f="idea"><input data-k="idea" name="text" maxlength="300" autocomplete="off" placeholder="${user ? 'Твоя идея для видео…' : 'Войди, чтобы предложить идею'}"><button class="btn">Предложить</button></form>
        ${ideas.map(i => `<div class="card stack idea">
          <button class="btn ghost up ${user && D.ideaVotes[i.id] && D.ideaVotes[i.id][user.uid] ? 'on' : ''}" data-a="toggle" data-p="ideaVotes" data-id="${esc(i.id)}"><span>▲</span><span>${count(D.ideaVotes[i.id])}</span></button>
          <div class="grow"><div>${rich(i.text)}</div>
            <div class="row" style="margin-top:6px"><span class="badge ${esc(i.status)}">${IDEA[i.status] || IDEA.new}</span><span class="muted">${esc(i.name)} · ${ago(i.ts)}</span>
            ${isAdmin() ? `<select data-c="ideaStatus" data-id="${esc(i.id)}" style="width:auto;padding:4px 8px">${Object.keys(IDEA).map(k => `<option value="${k}" ${i.status === k ? 'selected' : ''}>${IDEA[k]}</option>`).join('')}</select>` : ''}
            ${user && (isAdmin() || i.uid === user.uid) ? `<button class="link" data-a="rmIdea" data-id="${esc(i.id)}">удалить</button>` : ''}</div></div></div>`).join('') || '<div class="empty">Идей пока нет</div>'}`;
    },

    admin() {
      if (!user) return `<h1>Админка</h1><div class="empty">Войди в аккаунт, чтобы открыть админ-панель.<br><br><button class="btn" data-a="account">Войти</button></div>`;
      if (!isAdmin()) return `<h1>Админка</h1><div class="card"><p>У этого аккаунта нет прав администратора.</p>
        <p class="muted">Админы общие с приложением StormBook: в базе должна быть запись<br><code>admins/${esc(user.uid)}</code> со значением <code>true</code>, а в правилах — разрешение читать свой флаг (см. database.rules.full.json).</p></div>`;
      const tabs = { settings: 'Настройки', videos: 'Видео', spoilers: 'Спойлеры', posts: 'Посты', polls: 'Опросы', tg: 'Telegram', mod: 'Модерация' };
      return `<h1>Админка</h1>
        <div class="stats">${[['videos', 'видео'], ['spoilers', 'спойлеров'], ['posts', 'постов'], ['polls', 'опросов'], ['ideas', 'идей'], ['chat', 'сообщений']]
          .map(([k, t]) => `<div class="card"><b>${count(D[k])}</b><span class="muted">${t}</span></div>`).join('')}</div>
        <div class="tabs">${Object.keys(tabs).map(k => `<button class="btn small ${ui.tab === k ? '' : 'ghost'}" data-a="tab" data-id="${k}">${tabs[k]}</button>`).join('')}</div>
        ${ui.tab === 'settings' ? settingsForm() : ui.tab === 'mod' ? modPanel() : ui.tab === 'tg' ? tgPanel() : crud(ui.tab)}`;
    }
  };

  // ---------- admin ----------
  const SCHEMA = {
    videos: { one: 'видео', label: v => v.title, fields: [
      ['title', 'Название', 'text'], ['desc', 'Описание', 'textarea'], ['date', 'Дата выхода (можно пусто)', 'datetime'],
      ['status', 'Статус', 'select', STATUS], ['progress', 'Готовность, %', 'number'],
      ['url', 'Ссылка на YouTube (когда вышло)', 'text'], ['cover', 'Обложка (необязательно — иначе возьмётся с YouTube)', 'image']] },
    spoilers: { one: 'спойлер', label: v => v.title, fields: [
      ['title', 'Заголовок (виден всем сразу)', 'text'], ['text', 'Текст спойлера (скрыт, пока не откроют)', 'textarea'], ['image', 'Картинка (необязательно)', 'image']] },
    posts: { one: 'пост', label: v => v.title, fields: [
      ['title', 'Заголовок', 'text'], ['text', 'Текст', 'textarea'], ['image', 'Картинка (необязательно)', 'image'], ['pinned', 'Закрепить наверху', 'check']] },
    polls: { one: 'опрос', label: v => v.question, fields: [
      ['question', 'Вопрос', 'text'], ['options', 'Варианты (каждый с новой строки)', 'lines'], ['open', 'Голосование открыто', 'check']] }
  };

  function field(key, [n, label, type, opts], v) {
    const k = `data-k="${key}-${n}" name="${n}"`;
    if (type === 'image') return `<div class="imgf"><label>${label}<input type="file" accept="image/*" data-c="img"></label>
      <input type="hidden" ${k} value="${safeUrl(v)}"><img class="pic" alt="" hidden><button type="button" class="link" data-a="imgClear" hidden>убрать картинку</button></div>`;
    if (type === 'check') return `<label class="check"><input type="checkbox" ${k} ${v ? 'checked' : ''}> ${label}</label>`;
    if (type === 'textarea') return `<label>${label}<textarea ${k}>${esc(v)}</textarea></label>`;
    if (type === 'lines') return `<label>${label}<textarea ${k}>${esc((v || []).join('\n'))}</textarea></label>`;
    if (type === 'select') return `<label>${label}<select ${k}>${Object.keys(opts).map(o => `<option value="${o}" ${v === o ? 'selected' : ''}>${opts[o]}</option>`).join('')}</select></label>`;
    if (type === 'datetime') return `<label>${label}<input type="datetime-local" ${k} value="${toLocalInput(v)}"></label>`;
    return `<label>${label}<input type="${type}" ${k} value="${esc(v)}"></label>`;
  }

  function crud(type) {
    const sc = SCHEMA[type], ed = ui.edit && ui.edit.type === type ? ui.edit.id : null;
    const cur = ed ? D[type][ed] || {} : (type === 'polls' ? { open: true } : {});
    const items = list(D[type]).sort(byNew);
    return `<div class="card stack"><h3>${ed ? 'Редактировать' : 'Добавить'} ${sc.one}</h3>
        <form data-f="crud" data-type="${type}">${sc.fields.map(f => field(`crud-${type}-${ed || 'new'}`, f, cur[f[0]])).join('')}
        ${!ed && TG_TYPES[type] && tgReady() ? `<label class="check"><input type="checkbox" name="_tg" data-k="crud-${type}-tg" checked> Отправить и в Telegram-канал</label>` : ''}
        <div class="row"><button class="btn">${ed ? 'Сохранить' : 'Опубликовать'}</button>${ed ? '<button type="button" class="btn ghost" data-a="cancelEdit">Отмена</button>' : ''}</div></form></div>
      <div class="card"><h3>Опубликовано</h3>${items.map(i => `<div class="item"><span class="grow">${esc(sc.label(i))}</span>
        <button class="btn ghost small" data-a="edit" data-type="${type}" data-id="${esc(i.id)}">Изменить</button>
        <button class="btn danger small" data-a="del" data-type="${type}" data-id="${esc(i.id)}">Удалить</button></div>`).join('') || '<p class="muted">Пока пусто</p>'}</div>`;
  }

  function settingsForm() {
    const s = D.settings;
    return `<div class="card"><h3>Настройки сайта</h3><form data-f="settings">
      ${field('set', ['about', 'Описание канала (на главной)', 'textarea'], s.about)}
      ${field('set', ['youtube', 'Ссылка на YouTube-канал', 'text'], s.youtube || C.youtube)}
      ${field('set', ['announce', 'Объявление на главной (пусто — скрыть)', 'text'], s.announce)}
      ${field('set', ['live', 'Сейчас идёт стрим / выезд (красный баннер)', 'check'], s.live)}
      ${field('set', ['liveTitle', 'Текст баннера стрима', 'text'], s.liveTitle)}
      ${field('set', ['liveUrl', 'Ссылка на стрим', 'text'], s.liveUrl)}
      <button class="btn">Сохранить</button></form></div>`;
  }

  // ---------- Telegram ----------
  const tgReady = () => !!(TG.token() && TG.chatId(D.settings.tgChannel));
  const siteUrl = () => (/^https:/.test(location.protocol) ? location.origin + location.pathname : '');
  const tgFooter = () => (siteUrl() ? '\n\n<a href="' + TG.esc(siteUrl()) + '">' + TG.esc(C.channelName) + ' — сайт канала</a>' : '');
  // как запись с сайта выглядит в канале
  const TG_TYPES = {
    posts: v => ({ html: '<b>' + TG.esc(v.title) + '</b>' + (v.text ? '\n\n' + TG.esc(v.text) : '') + tgFooter(), image: v.image }),
    spoilers: v => ({ html: '🙈 <b>Спойлер: ' + TG.esc(v.title) + '</b>' + (v.text ? '\n\n<tg-spoiler>' + TG.esc(v.text) + '</tg-spoiler>' : '') + tgFooter(), image: v.image, spoiler: true }),
    videos: v => (v.status === 'released'
      ? { html: '▶️ <b>Новое видео: ' + TG.esc(v.title) + '</b>' + (v.desc ? '\n\n' + TG.esc(v.desc) : '') + (v.url ? '\n\n' + TG.esc(v.url) : '') + tgFooter(), image: v.url ? '' : v.cover }
      : { html: '🎬 <b>Скоро на канале: ' + TG.esc(v.title) + '</b>' + (v.desc ? '\n\n' + TG.esc(v.desc) : '') + '\n\n' + TG.esc(STATUS[v.status] || '') + (v.date ? ' · выйдет ' + TG.esc(fmtDate(v.date)) : '') + tgFooter(), image: v.cover })
  };
  const tgPublish = (type, v) => { const m = TG_TYPES[type](v); return TG.send(D.settings.tgChannel, m.html, m.image, m.spoiler); };

  // Канал → сайт: забираем новые посты канала и кладём в «Посты» (ключ tg_<id>, повторный импорт ничего не дублирует).
  let tgBusy = false, tgOffset, tgLast = '';
  const tgSeen = {}; // каналы, которые видит бот: id → { title, username }
  const tgNote = chat => { if (chat && chat.type === 'channel') tgSeen[chat.id] = { title: chat.title || '', username: chat.username || '' }; };
  async function tgSync(manual) {
    if (tgBusy || !isAdmin() || !TG.token()) return;
    tgBusy = true;
    let n = 0;
    try {
      for (;;) {
        const ups = await TG.updates(tgOffset);
        if (!ups.length) break;
        for (const u of ups) {
          tgOffset = u.update_id + 1;
          if (u.my_chat_member) tgNote(u.my_chat_member.chat);
          const m = u.channel_post || u.edited_channel_post;
          if (m) tgNote(m.chat);
          if (!m || !TG.sameChat(m.chat, D.settings.tgChannel)) continue;
          const txt = (m.text || m.caption || '').trim();
          if (!txt && m.media_group_id) continue; // остальные фото альбома без подписи
          const nl = txt.indexOf('\n'), first = (nl < 0 ? txt : txt.slice(0, nl)).trim();
          const short = first && first.length <= 80;
          const v = {
            title: short ? first : m.photo ? 'Фото из Telegram' : m.video ? 'Видео из Telegram' : 'Пост из Telegram',
            text: short ? (nl < 0 ? '' : txt.slice(nl + 1).trim()) : txt,
            ts: m.date * 1000, tg: m.message_id,
            tgLink: m.chat.username ? 'https://t.me/' + m.chat.username + '/' + m.message_id : ''
          };
          if (m.photo) { const b = await TG.photoBlob(m.photo); if (b) { try { v.image = await shrinkImage(b); } catch (e) {} } }
          await S.update('posts/tg_' + m.message_id, v);
          n++;
        }
      }
      tgLast = 'Последняя проверка: ' + new Date().toLocaleTimeString('ru-RU') + (n ? ' — перенесено постов: ' + n : ' — новых постов нет');
      if (manual || n) toast(n ? 'Из Telegram перенесено постов: ' + n : Object.keys(tgSeen).length && !tgReady() ? 'Канал найден — выбери его в списке' : tgReady() ? 'Новых постов в канале нет' : 'Бот пока не видит каналов: сделай его админом и напиши пост в канал');
    } catch (e) {
      tgLast = 'Ошибка: ' + e.message;
      if (manual) toast(e.message);
    }
    tgBusy = false;
    schedule();
  }
  setInterval(tgSync, 60e3);

  function tgPanel() {
    const has = !!TG.token(), ch = D.settings.tgChannel || '';
    return `<div class="card stack"><h3>Telegram-канал</h3>
      <p class="muted">Статус: ${has && ch ? 'подключено' : 'не подключено'}${has ? ' · токен сохранён в этом браузере' : ''}${tgLast ? '<br>' + esc(tgLast) : ''}</p>
      <form data-f="tg">
        <label>Канал (@имя или ссылка t.me/…)<input name="channel" data-k="tg-channel" value="${esc(ch)}" placeholder="@mychannel" autocomplete="off"></label>
        <label>Токен бота от @BotFather${has ? ' (оставь пустым, чтобы не менять)' : ''}<input name="token" type="password" data-k="tg-token" autocomplete="off" placeholder="${has ? '••••••••' : '123456:ABC…'}"></label>
        <div class="row"><button class="btn">Сохранить</button>
          ${has && ch ? '<button type="button" class="btn ghost" data-a="tgCheck">Проверить</button>' : ''}
          ${has ? '<button type="button" class="btn ghost" data-a="tgSync">Найти мой канал</button><button type="button" class="btn danger" data-a="tgForget">Удалить токен</button>' : ''}</div></form>
      ${Object.keys(tgSeen).length ? '<h3 style="margin-top:16px">Каналы, которые видит бот</h3>' + Object.keys(tgSeen).map(id => `<div class="item"><span class="grow">${esc(tgSeen[id].title)} ${tgSeen[id].username ? '@' + esc(tgSeen[id].username) : '(приватный)'}</span>${TG.sameChat({ id, username: tgSeen[id].username }, ch) ? '<span class="badge ready">выбран</span>' : `<button class="btn small" data-a="tgUse" data-id="${esc(tgSeen[id].username ? '@' + tgSeen[id].username : id)}">Использовать</button>`}</div>`).join('') : ''}</div>
      <div class="card"><h3>Как это работает</h3>
        <p class="muted"><b>Сайт → канал.</b> При публикации поста, спойлера или видео в админке стоит галочка «Отправить и в Telegram-канал». Спойлер в Telegram тоже скрыт, пока не нажмут.</p>
        <p class="muted"><b>Канал → сайт.</b> Новые посты канала попадают в «Посты» сайта. Проверка идёт раз в минуту, пока сайт открыт у тебя (админа) в этом браузере. Telegram хранит непрочитанные посты около суток — заходи на сайт хотя бы раз в день.</p>
        <p class="muted"><b>Подключение.</b> 1) Создай бота в @BotFather и скопируй токен. 2) Добавь бота администратором канала с правом публиковать сообщения. 3) Впиши токен и нажми «Сохранить». 4) Впиши @имя канала и нажми «Проверить». Если канал приватный (без @имени): напиши в него любой пост, нажми «Найти мой канал» и выбери его в списке.</p>
        <p class="muted">Токен хранится только в этом браузере — его нет ни в коде сайта, ни в базе. На другом устройстве его нужно ввести заново.</p></div>`;
  }

  function modPanel() {
    const bans = list(D.bans);
    return `<div class="card stack"><h3>Заблокированные на сайте</h3>
        ${bans.map(b => `<div class="item"><span class="grow">${esc(b.name || b.id)}</span><button class="btn ghost small" data-a="rm" data-p="bans/${esc(b.id)}">Разблокировать</button></div>`).join('') || '<p class="muted">Никто не заблокирован. Забанить можно кнопкой «бан» у комментария — человек не сможет комментировать и предлагать идеи.</p>'}</div>
      <div class="card"><h3>Чат</h3><p class="muted">Чат общий с приложением StormBook: удалять сообщения можно прямо в чате, а баны для чата выдаются в приложении.</p></div>`;
  }

  // ---------- render ----------
  const route = () => { const r = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0]; return PAGES[r] ? r : 'home'; };
  let lastRoute = null, pending = false;
  const schedule = () => { if (!pending) { pending = true; setTimeout(() => { pending = false; render(); }, 0); } };

  function render() {
    const r = route(), same = r === lastRoute;
    // сохраняем введённое в поля, фокус и прокрутку чата, чтобы обновление данных не мешало печатать
    const vals = {}; let focus = null;
    const log = $('#chatlog'), atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (same) {
      view.querySelectorAll('[data-k]').forEach(e => (vals[e.dataset.k] = e.type === 'checkbox' ? e.checked : e.value));
      const a = document.activeElement;
      if (a && a.dataset && a.dataset.k && view.contains(a)) focus = { k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd };
    }
    view.innerHTML = PAGES[r]();
    if (same) {
      view.querySelectorAll('[data-k]').forEach(e => { if (e.dataset.k in vals) { if (e.type === 'checkbox') e.checked = vals[e.dataset.k]; else e.value = vals[e.dataset.k]; } });
      if (focus) { const e = view.querySelector(`[data-k="${focus.k}"]`); if (e) { e.focus(); try { e.setSelectionRange(focus.s, focus.e); } catch (_) {} } }
    } else window.scrollTo(0, 0);
    syncPreviews();
    const nl = $('#chatlog'); if (nl && (atBottom || !same)) nl.scrollTop = nl.scrollHeight;
    lastRoute = r;

    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    $('#navAdmin').hidden = !isAdmin();
    $('#userBtn').textContent = user ? (user.name || 'Выбрать позывной') : 'Войти';
    $('#footYt').href = (D.settings.youtube && /^https?:\/\//i.test(D.settings.youtube)) ? D.settings.youtube : C.youtube;
    tick();
  }

  // ---------- загрузка картинок ----------
  // Картинка сжимается в браузере и хранится прямо в базе (как медиа в приложении StormBook).
  function syncPreviews() {
    view.querySelectorAll('.imgf').forEach(w => {
      const v = w.querySelector('input[type=hidden]').value, img = w.querySelector('img');
      if (v) img.src = v; else img.removeAttribute('src');
      img.hidden = w.querySelector('[data-a=imgClear]').hidden = !v;
    });
  }
  function shrinkImage(file, max = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('не удалось прочитать картинку')); };
      img.src = url;
    });
  }

  function tick() {
    document.querySelectorAll('[data-cd]').forEach(el => {
      let d = Math.max(0, +el.dataset.cd - Date.now()) / 1000;
      const parts = [[Math.floor(d / 86400), 'дней'], [Math.floor(d % 86400 / 3600), 'часов'], [Math.floor(d % 3600 / 60), 'минут'], [Math.floor(d % 60), 'секунд']];
      el.innerHTML = parts.map(([n, t]) => `<div><b>${String(n).padStart(2, '0')}</b><span>${t}</span></div>`).join('');
    });
  }
  setInterval(tick, 1000);

  // ---------- auth modal ----------
  const modal = $('#modal');
  const closeModal = () => { modal.hidden = true; modal.innerHTML = ''; };
  function openAuth() {
    const reg = ui.authMode === 'register';
    modal.innerHTML = `<div class="card"><h3>${reg ? 'Регистрация' : 'Вход'}</h3>
      <p class="muted">${S.demo ? 'Демо-режим: введи любую почту и пароль — войдёшь как админ.' : 'Аккаунт общий с приложением StormBook — входи теми же почтой и паролем. Он нужен для чата, комментариев и голосований.'}</p>
      <form data-f="auth">${reg ? '<label>Позывной<input name="name" maxlength="24" required></label>' : ''}
        <label>Почта<input name="email" type="email" required autocomplete="email"></label>
        <label>Пароль<input name="password" type="password" required minlength="6" autocomplete="${reg ? 'new-password' : 'current-password'}"></label>
        <div class="row"><button class="btn">${reg ? 'Создать аккаунт' : 'Войти'}</button></div></form>
      <p class="muted" style="margin-top:12px">${reg ? 'Уже есть аккаунт?' : 'Нет аккаунта?'} <a href="#" data-a="authMode">${reg ? 'Войти' : 'Зарегистрироваться'}</a>
        · <a href="#" data-a="close">Закрыть</a></p></div>`;
    modal.hidden = false;
  }
  function openProfile() {
    modal.innerHTML = `<div class="card"><h3>Профиль</h3>
      ${user.needName ? `<p class="muted">У аккаунта ещё нет позывного. Выбери его — он будет общим для сайта и приложения, поменять потом нельзя.</p>
        <form data-f="claim"><label>Позывной<input name="name" maxlength="24" required></label><button class="btn small">Сохранить</button></form>`
      : `<p>Позывной: <b>${esc(user.name.toUpperCase())}</b></p>`}
      <p class="muted" style="margin-top:12px">${esc(user.email || '')}<br>ID: <code>${esc(user.uid)}</code><br>
        Админ: ${isAdmin() ? 'да' : adminWhy === 'denied' ? 'нет — правила базы не дают прочитать <code>admins/' + esc(user.uid) + '</code> (не опубликован блок admins из database.rules.full.json)' : 'нет — в базе нет записи <code>admins/' + esc(user.uid) + '</code> = true'}</p>
      <div class="row">${isAdmin() ? '<a class="btn small" href="#/admin" data-a="close">Админка</a>' : ''}<button class="btn danger small" data-a="logout">Выйти</button><button class="btn ghost small" data-a="close">Закрыть</button></div></div>`;
    modal.hidden = false;
  }

  // ---------- actions ----------
  const sure = btn => { // удаление в два клика вместо confirm()
    if (btn.dataset.sure) return true;
    btn.dataset.sure = 1; const t = btn.textContent; btn.textContent = 'Точно?';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = t; } }, 3000);
    return false;
  };
  const LINKED = { videos: ['hype'], posts: ['likes', 'comments'], polls: ['votes'] };

  const ACT = {
    account: () => (user ? openProfile() : openAuth()),
    close: (b, e) => { if (b.tagName === 'A' && b.getAttribute('href') === '#') e.preventDefault(); closeModal(); },
    authMode: (b, e) => { e.preventDefault(); ui.authMode = ui.authMode === 'login' ? 'register' : 'login'; openAuth(); },
    logout: () => run(S.logout()).then(closeModal),
    toggle: b => { if (!needUser()) return; const p = `${b.dataset.p}/${b.dataset.id}/${user.uid}`; const on = D[b.dataset.p][b.dataset.id] && D[b.dataset.p][b.dataset.id][user.uid]; run(on ? S.remove(p) : S.set(p, true)); },
    vote: b => { if (needUser()) run(S.set(`votes/${b.dataset.id}/${user.uid}`, +b.dataset.i)); },
    reveal: b => { ui.revealed.add(b.dataset.id); render(); },
    comments: b => { ui.openC.has(b.dataset.id) ? ui.openC.delete(b.dataset.id) : ui.openC.add(b.dataset.id); render(); },
    rm: b => { if (sure(b)) run(S.remove(b.dataset.p)); },
    rmIdea: b => { if (sure(b)) run(S.remove('ideas/' + b.dataset.id)).then(() => { if (isAdmin()) S.remove('ideaVotes/' + b.dataset.id); }); },
    ban: b => { if (sure(b)) run(S.set('bans/' + b.dataset.id, { name: b.dataset.name, ts: S.now() })).then(() => toast('Пользователь заблокирован')); },
    tab: b => { ui.tab = b.dataset.id; ui.edit = null; render(); },
    edit: b => { ui.edit = { type: b.dataset.type, id: b.dataset.id }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    cancelEdit: () => { ui.edit = null; render(); },
    tgCheck: () => run(TG.check(D.settings.tgChannel)).then(r => toast(r.canPost ? 'Бот @' + r.bot + ' подключён к «' + r.channel + '»' : 'Бот @' + r.bot + ' не админ канала или без права публикации')).catch(() => {}),
    tgSync: () => tgSync(true),
    tgUse: b => run(S.update('settings', { tgChannel: b.dataset.id })).then(() => { toast('Канал выбран'); render(); }),
    tgForget: b => { if (sure(b)) { TG.setToken(''); toast('Токен удалён из этого браузера'); render(); } },
    imgClear: b => { const w = b.closest('.imgf'); w.querySelector('input[type=hidden]').value = ''; w.querySelector('input[type=file]').value = ''; syncPreviews(); },
    del: b => {
      if (!sure(b)) return;
      const { type, id } = b.dataset;
      run(S.remove(`${type}/${id}`)).then(() => (LINKED[type] || []).forEach(p => S.remove(`${p}/${id}`)));
    }
  };

  let lastMsg = 0;
  const say = (form, path, extra) => {
    if (!needUser()) return;
    const text = form.text.value.trim();
    if (!text) return;
    if (Date.now() - lastMsg < 1500) return toast('Не так быстро ⚡');
    lastMsg = Date.now();
    form.text.value = '';
    run(S.push(path, Object.assign({ uid: user.uid, name: user.name.slice(0, 40), text, ts: S.now() }, extra))).catch(() => (form.text.value = text));
  };

  const FORMS = {
    chat: f => {
      if (!needUser()) return;
      const text = f.text.value.trim();
      if (!text) return;
      if (Date.now() - lastMsg < 1500) return toast('Не так быстро ⚡');
      lastMsg = Date.now();
      f.text.value = '';
      // формат сообщения — как в приложении StormBook
      run(S.push('/chats/global', { author: user.name, text, media: '', mediaType: '', time: Date.now() })).catch(() => (f.text.value = text));
    },
    comment: f => say(f, 'comments/' + f.dataset.id),
    idea: f => say(f, 'ideas', { status: 'new' }),
    auth: f => {
      const { email, password, name } = f;
      const p = ui.authMode === 'register' ? S.register(email.value.trim(), password.value, name.value.trim()) : S.login(email.value.trim(), password.value);
      run(p).then(closeModal);
    },
    claim: f => run(S.claim(f.name.value)).then(() => { closeModal(); toast('Позывной сохранён'); }),
    settings: f => {
      const v = {};
      ['about', 'youtube', 'announce', 'liveTitle', 'liveUrl'].forEach(k => (v[k] = f[k].value.trim()));
      v.live = f.live.checked;
      run(S.update('settings', v)).then(() => toast('Сохранено'));
    },
    tg: f => {
      const t = f.token.value.trim();
      if (t && !/^\d+:[\w-]{30,}$/.test(t)) return toast('Это не похоже на токен бота');
      if (TG.isInvite(f.channel.value)) return toast('Это ссылка-приглашение. Для приватного канала нажми «Найти мой канал»');
      if (t) TG.setToken(t);
      f.token.value = '';
      run(S.update('settings', { tgChannel: f.channel.value.trim() })).then(() => { toast('Сохранено'); render(); });
    },
    crud: f => {
      const type = f.dataset.type, sc = SCHEMA[type], v = {};
      sc.fields.forEach(([n, , t]) => {
        const el = f[n];
        v[n] = t === 'check' ? el.checked : t === 'number' ? Math.max(0, Math.min(100, +el.value || 0))
          : t === 'datetime' ? (el.value ? new Date(el.value).getTime() : 0)
          : t === 'lines' ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : el.value.trim();
      });
      if (!v[sc.fields[0][0]]) return toast('Заполни первое поле');
      if (type === 'polls' && v.options.length < 2) return toast('Нужно минимум 2 варианта');
      const ed = ui.edit && ui.edit.type === type ? ui.edit.id : null;
      const p = ed ? S.update(`${type}/${ed}`, v) : S.push(type, Object.assign(v, { ts: S.now() }));
      const toTg = !ed && f._tg && f._tg.checked && tgReady();
      run(p).then(() => {
        ui.edit = null; f.reset(); f.querySelectorAll('input[type=hidden]').forEach(e => (e.value = ''));
        toast(ed ? 'Сохранено' : 'Опубликовано'); render();
        if (toTg) tgPublish(type, v).then(() => toast('Опубликовано на сайте и в Telegram'), e => toast('На сайте опубликовано, в Telegram — нет. ' + e.message));
      });
    }
  };

  document.addEventListener('click', e => {
    if (e.target === modal) return closeModal();
    const b = e.target.closest('[data-a]');
    if (b && ACT[b.dataset.a]) ACT[b.dataset.a](b, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-f]');
    if (f && FORMS[f.dataset.f]) { e.preventDefault(); FORMS[f.dataset.f](f); }
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.c === 'img') {
      const file = e.target.files[0], w = e.target.closest('.imgf');
      if (!file) return;
      if (!file.type.startsWith('image/')) return toast('Это не картинка');
      run(shrinkImage(file)).then(d => { w.querySelector('input[type=hidden]').value = d; syncPreviews(); }).catch(() => {});
    }
    if (e.target.dataset.c === 'ideaStatus') run(S.update('ideas/' + e.target.dataset.id, { status: e.target.value }));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  window.addEventListener('hashchange', render);

  // ---------- start ----------
  $('#logoName').textContent = $('#footName').textContent = C.channelName;
  document.title = C.channelName + ' — канал о грозах';
  $('#demoNote').hidden = !S.demo;
  Object.keys(D).filter(k => k !== 'chat').forEach(k => S.on(k, v => { D[k] = v || {}; schedule(); }));
  S.onAuth(u => {
    user = u;
    // общий чат и флаг админа читаются только после входа, поэтому подписываемся заново при смене аккаунта
    if (offChat) offChat();
    if (offAdmin) offAdmin();
    offChat = offAdmin = null; D.chat = {}; adminFlag = false; adminWhy = '';
    if (u || S.demo) offChat = S.on('/chats/global', v => { D.chat = v || {}; schedule(); }, 80);
    if (u) offAdmin = S.on('/admins/' + u.uid, v => { adminFlag = v === true; adminWhy = adminFlag ? '' : 'missing'; schedule(); if (adminFlag) tgSync(); }, 0, () => { adminWhy = 'denied'; schedule(); });
    schedule();
  });
  render();
})();
