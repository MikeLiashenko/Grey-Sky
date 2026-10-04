// Связь с Telegram-каналом через Bot API прямо из браузера админа.
// Токен бота хранится ТОЛЬКО в localStorage этого браузера — не в коде и не в базе (репозиторий и база публичные).
window.TG = (function () {
  const KEY = 'gs_tg_token';
  const token = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setToken = t => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // «@name», «name», «https://t.me/name» или числовой id «-100…» → chat_id для Bot API
  const chatId = ch => {
    const s = String(ch || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
    return /^-?\d+$/.test(s) ? s : (s ? '@' + s : '');
  };
  const username = ch => { const id = chatId(ch); return id[0] === '@' ? id.slice(1) : ''; };
  const sameChat = (chat, ch) => {
    const id = chatId(ch);
    return !!chat && (id[0] === '@' ? (chat.username || '').toLowerCase() === id.slice(1).toLowerCase() : String(chat.id) === id);
  };

  // Все запросы — multipart POST: это «простой» запрос, браузеру не нужен CORS-preflight.
  async function call(method, params) {
    if (!token()) throw new Error('Не задан токен бота');
    const form = new FormData();
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (v == null || v === '') return;
      if (v instanceof Blob) form.append(k, v, 'image.jpg'); else form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    // Пустую форму Telegram отвергает (400 без тела), поэтому запросы без параметров идут обычным GET.
    const empty = form.keys().next().done;
    let r, j;
    try { r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, empty ? {} : { method: 'POST', body: form }); }
    catch (e) { throw new Error('Telegram недоступен (сеть или блокировщик рекламы)'); }
    try { j = await r.json(); } catch (e) { throw new Error('Telegram ответил с ошибкой ' + r.status); }
    if (!j.ok && r.status === 401) throw new Error('Telegram не принял токен бота — проверь, что он скопирован целиком');
    if (!j.ok) throw new Error('Telegram: ' + (j.description || 'ошибка ' + j.error_code));
    return j.result;
  }

  // Проверка: бот существует, канал найден, бот в нём админ с правом публикации.
  async function check(ch) {
    const me = await call('getMe');
    const chat = await call('getChat', { chat_id: chatId(ch) });
    const m = await call('getChatMember', { chat_id: chatId(ch), user_id: me.id });
    const canPost = m.status === 'creator' || (m.status === 'administrator' && m.can_post_messages !== false);
    return { bot: me.username, channel: chat.title || chat.username, canPost };
  }

  // Публикация в канал. html — уже экранированный текст с разметкой Telegram; image — data:-URL или пусто.
  async function send(ch, html, image, spoiler) {
    const chat_id = chatId(ch);
    if (image && /^data:image\//.test(image)) {
      const photo = await (await fetch(image)).blob();
      if (html.length <= 1024) return (await call('sendPhoto', { chat_id, photo, caption: html, parse_mode: 'HTML', has_spoiler: spoiler ? 'true' : '' })).message_id;
      await call('sendPhoto', { chat_id, photo, has_spoiler: spoiler ? 'true' : '' });
    }
    return (await call('sendMessage', { chat_id, text: html.slice(0, 4096), parse_mode: 'HTML' })).message_id;
  }

  const updates = offset => call('getUpdates', { offset, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post'] });

  // Фото из поста канала. Telegram может не разрешить браузеру скачать файл — тогда вернётся null.
  async function photoBlob(sizes) {
    try {
      const best = sizes.filter(s => Math.max(s.width, s.height) <= 1280).pop() || sizes[sizes.length - 1];
      const f = await call('getFile', { file_id: best.file_id });
      const r = await fetch(`https://api.telegram.org/file/bot${token()}/${f.file_path}`);
      return r.ok ? await r.blob() : null;
    } catch (e) { return null; }
  }

  return { token, setToken, esc, chatId, username, sameChat, check, send, updates, photoBlob };
})();
