// Пример плагина corsa-mess.
// api.addCommand(имя, функция, описание)  — слэш-команда в чате
// api.onMessage(функция)                   — изменить сообщение перед показом (верните объект с изменёнными полями)
// api.addCss(текст)                        — добавить стили
// api.toast(текст)                         — всплывающее уведомление
// api.storage.get/set                      — свои данные плагина
// api.app.getState() / api.app.sendMessage(канал, текст)
Corsa.definePlugin({
  start(api) {
    api.addCommand('dice', ({ send }) => {
      send('🎲 выпало ' + (1 + Math.floor(Math.random() * 6)));
    }, 'бросить кубик');
  },
  stop() {},
});
