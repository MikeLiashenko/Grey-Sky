// Переносит новые посты Telegram-канала в data/telegram.json (и фото в data/tg/).
// Запускается по расписанию из .github/workflows/telegram.yml. Токен бота — секрет репозитория TG_BOT_TOKEN.
import fs from 'node:fs';

const TOKEN = process.env.TG_BOT_TOKEN;
const DB = 'https://sqisystem-default-rtdb.europe-west1.firebasedatabase.app/greysky';
const FEED = 'data/telegram.json';

if (!TOKEN) { console.log('Секрет TG_BOT_TOKEN не задан — пропускаю.'); process.exit(0); }

async function api(method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params)
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}

// Канал берём из настроек сайта (админка → Telegram), чтобы не задавать его второй раз.
const channel = String(await (await fetch(`${DB}/settings/tgChannel.json`)).json() || '').trim()
  .replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
if (!channel) { console.log('Канал не выбран в админке сайта — пропускаю.'); process.exit(0); }
const sameChat = chat => (/^-?\d+$/.test(channel) ? String(chat.id) === channel : (chat.username || '').toLowerCase() === channel.toLowerCase());

const feed = fs.existsSync(FEED) ? JSON.parse(fs.readFileSync(FEED, 'utf8')) : { enabled: true, offset: 0, posts: {} };
feed.enabled = true;
feed.posts = feed.posts || {};

// Один запрос за запуск: offset подтверждает Telegram'у только то, что уже закоммичено прошлым запуском.
const updates = await api('getUpdates', { offset: feed.offset || undefined, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post', 'my_chat_member'] });
let imported = 0;
for (const u of updates) {
  feed.offset = u.update_id + 1;
  const m = u.channel_post || u.edited_channel_post;
  if (!m || !sameChat(m.chat)) continue;
  const txt = (m.text || m.caption || '').trim();
  if (!txt && m.media_group_id) continue; // остальные фото альбома без подписи
  const nl = txt.indexOf('\n'), first = (nl < 0 ? txt : txt.slice(0, nl)).trim();
  const short = first && first.length <= 80;
  const key = 'tg_' + m.message_id;
  const post = Object.assign(feed.posts[key] || {}, {
    title: short ? first : m.photo ? 'Фото из Telegram' : m.video ? 'Видео из Telegram' : 'Пост из Telegram',
    text: short ? (nl < 0 ? '' : txt.slice(nl + 1).trim()) : txt,
    ts: m.date * 1000, tg: m.message_id,
    tgLink: m.chat.username ? `https://t.me/${m.chat.username}/${m.message_id}` : ''
  });
  if (m.photo) {
    try {
      const best = m.photo.filter(s => Math.max(s.width, s.height) <= 1280).pop() || m.photo[m.photo.length - 1];
      const f = await api('getFile', { file_id: best.file_id });
      const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
      if (!r.ok) throw new Error('файл не скачался: ' + r.status);
      fs.mkdirSync('data/tg', { recursive: true });
      fs.writeFileSync(`data/tg/${m.message_id}.jpg`, Buffer.from(await r.arrayBuffer()));
      post.image = `data/tg/${m.message_id}.jpg`;
    } catch (e) { console.log(`Пост ${m.message_id}: фото не перенесено (${e.message})`); }
  }
  feed.posts[key] = post;
  imported++;
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(FEED, JSON.stringify(feed, null, 2) + '\n');
console.log(`Обновлений: ${updates.length}, перенесено постов: ${imported}`);
