// Настройки сайта. Пока apiKey пустой — сайт работает в ДЕМО-режиме (данные лежат в браузере).
// Чтобы подключить Firebase: Firebase Console → Project settings → Your apps → Web app → скопируй apiKey и appId сюда.
window.GS_CONFIG = {
  channelName: 'Grey Sky',
  tagline: 'Грозы, шторма и молнии — вживую и без монтажа неба',
  youtube: 'https://www.youtube.com/@ChaserOfDerecho', // ссылка на канал (можно поменять и в админке)

  // Все данные сайта лежат ТОЛЬКО внутри этого узла базы, остальной проект не трогается.
  root: 'greysky',

  firebase: {
    apiKey: 'AIzaSyAqlfyPr5eryZSHxXvDQcJg-fVkPy47KVU',
    authDomain: 'sqisystem.firebaseapp.com',
    databaseURL: 'https://sqisystem-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'sqisystem',
    storageBucket: 'sqisystem.firebasestorage.app',
    messagingSenderId: '365066015347',
    appId: '1:365066015347:web:c9f496bb4ac9b172441006'
  }
};
