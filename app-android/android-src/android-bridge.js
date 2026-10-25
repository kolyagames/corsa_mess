// Мостик между интерфейсом corsa-mess (app/src/*.js, общий со столом) и Android-плагином CorsaNative.
// Подключается только в Android-сборке (см. scripts/build-www.js), на Windows/Linux этот файл не грузится
// и window.corsaNative приходит как обычно из preload.js.
//
// Версия 1 для Android — только присоединение к чужой комнате (владелец комнаты по-прежнему запускает
// её на компьютере). Хостинг своей комнаты, показ экрана и глобальные горячие клавиши с телефона пока
// недоступны технически (нужен постоянно работающий процесс и системные API, которых у приложения на
// телефоне нет) — соответствующие вызовы ниже честно отвечают ошибкой или пустым результатом вместо того,
// чтобы притворяться, что это работает.
(function () {
  const Plug = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CorsaNative;
  const uuid = () => (window.Corsa && window.Corsa.uuid ? window.Corsa.uuid() : Math.random().toString(16).slice(2) + Date.now().toString(16));
  const b64ToBytes = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const bytesToB64 = (bytes) => { let bin = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk)); return btoa(bin); };

  // ---------- WebSocket к серверу комнаты через нативный OkHttp-клиент (закреплённый сертификат) ----------
  // client.js делает `new (window.CorsaWebSocket || WebSocket)(url)` — на Android здесь подставляется
  // обёртка с тем же небольшим подмножеством API WebSocket, которым пользуется client.js.
  const wsListeners = new Map(); // id -> wrapper
  let wsBound = false;
  function bindWsEvents() {
    if (wsBound) return;
    wsBound = true;
    Plug().addListener('wsEvent', (ev) => {
      const w = wsListeners.get(ev.id);
      if (!w) return;
      if (ev.type === 'open') { /* client.js ждёт challenge/welcome, onopen не используется */ }
      else if (ev.type === 'message') { if (w.onmessage) w.onmessage({ data: ev.data }); }
      else if (ev.type === 'close') { w.readyState = 3; if (w.onclose) w.onclose({}); wsListeners.delete(ev.id); }
      else if (ev.type === 'error') { if (w.onerror) w.onerror(new Error(ev.data || 'Ошибка соединения')); }
    });
  }

  class CorsaWebSocket {
    constructor(url) {
      this.id = uuid();
      this.readyState = 0; // CONNECTING
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      bindWsEvents();
      let host = '', port = 7777;
      try { const u = new URL(url.replace(/^wss:/, 'https:')); host = u.hostname; port = Number(u.port) || 7777; } catch (e) { /* адрес разберёт сам сервер-обработчик ошибки */ }
      wsListeners.set(this.id, this);
      Plug().wsOpen({ id: this.id, url, host, port }).then(() => { this.readyState = 1; }).catch((e) => { this.readyState = 3; if (this.onerror) this.onerror(e); if (this.onclose) this.onclose({}); });
    }
    send(data) { if (this.readyState === 1) Plug().wsSend({ id: this.id, data: String(data) }).catch(() => {}); }
    close() { this.readyState = 3; Plug().wsClose({ id: this.id }).catch(() => {}); wsListeners.delete(this.id); }
  }
  window.CorsaWebSocket = CorsaWebSocket;

  // ---------- window.corsaNative: тот же набор методов, что в app/preload.js ----------
  let binding = null; // { host, port, token } — к какой комнате подключены (для upload/save)

  const resolved = (v) => Promise.resolve(v);
  const noop = () => () => {};

  window.corsaNative = {
    // Хостинг своей комнаты с телефона недоступен в этой версии.
    hostStart: () => Promise.reject(new Error('Запуск своей комнаты с телефона пока не поддерживается. Запустите сервер на компьютере и подключитесь к нему отсюда по коду.')),
    hostStop: () => resolved(true),
    makeCode: () => resolved(null),
    lanIps: () => resolved([]),
    lanScan: () => resolved([]),
    listPlugins: () => resolved([]),
    listThemes: () => resolved([]),
    openFolder: () => resolved(false),
    screenSources: () => Promise.reject(new Error('Показ экрана с телефона пока не поддерживается')),
    screenSelect: () => resolved(true),
    openInternet: () => Promise.reject(new Error('Недоступно на телефоне')),
    closeInternet: () => resolved(true),

    tlsPins: () => Plug().tlsPins().then((r) => r.pins || []),
    tlsForget: (host) => Plug().tlsForget({ host }).then(() => true),
    tlsSelf: () => Promise.reject(new Error('недоступно')), // нет своего сервера на телефоне
    onTls: (cb) => {
      const handle = Plug().addListener('tlsEvent', (ev) => cb(ev));
      return () => { try { handle.remove(); } catch (e) { /* ignore */ } };
    },
    tlsTarget: () => resolved(true), // на Android порт передаётся прямо в wsOpen/httpUpload/httpFetch

    mediaWatch: () => resolved(false),
    mediaCommand: () => resolved(true),
    onMedia: noop,

    migrationScan: () => Promise.reject(new Error('Перенос настроек доступен только на компьютере')),

    appPrefs: () => resolved({ packaged: true, autostart: false, startedHidden: false, version: (window.CORSA_VERSION || '0.0.0') + ' (Android)' }),

    secretSet: (key, value) => Plug().secretSet({ key, value: value || '' }).then(() => true),
    secretGet: (key) => Plug().secretGet({ key }).then((r) => r.value || ''),

    // Обновления на Android — через страницу релизов (ссылка открывается во внешнем браузере),
    // а не автоматическим скачиванием apk в один клик, как на столе.
    updateCheck: async () => {
      try {
        const r = await fetch('https://api.github.com/repos/kolyagames/corsa_mess/releases/latest');
        if (!r.ok) return { upToDate: true };
        const j = await r.json();
        const latest = String(j.tag_name || '').replace(/^v/, '');
        const current = window.CORSA_VERSION || '0.0.0';
        const asset = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
        return { upToDate: !latest || latest === current, version: latest, page: j.html_url, packaged: false, sha256: null, assetUrl: asset ? asset.browser_download_url : null };
      } catch (e) { return { upToDate: true }; }
    },
    updateDownload: () => Promise.reject(new Error('Скачайте apk со страницы релиза')),
    updateInstall: () => Promise.reject(new Error('Установите скачанный apk вручную')),
    openReleasePage: (url) => { window.open(url || 'https://github.com/kolyagames/corsa_mess/releases/latest', '_blank'); return resolved(true); },
    onUpdateProgress: noop,

    bridgeOpen: () => Promise.reject(new Error('Мост через bore.pub открывает владелец комнаты на столе')),
    bridgeClose: () => resolved(true),
    bridgeInfo: () => resolved(null),
    onBridge: noop,

    fetchImage: async (url) => {
      // Обычные HTTPS-картинки (Imgur и т.п.) — у них настоящий доверенный сертификат,
      // закреплять нечего, обычный fetch в WebView справляется сам.
      const r = await fetch(url);
      if (!r.ok) throw new Error('не удалось загрузить');
      const buf = new Uint8Array(await r.arrayBuffer());
      return { type: r.headers.get('content-type') || 'application/octet-stream', data: buf };
    },

    roomBind: (b) => { binding = b; return resolved(!!b); },
    uploadFile: async (f) => {
      if (!binding) throw new Error('Нет подключения к комнате');
      const bytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      return Plug().httpUpload({ host: binding.host, port: binding.port, token: binding.token, name: f.name, type: f.type, voice: !!f.voice, dur: Number(f.dur) || 0, data: bytesToB64(bytes) });
    },
    saveRoomFile: async (f) => {
      if (!binding) throw new Error('Файл недоступен');
      const res = await Plug().httpFetch({ host: binding.host, port: binding.port, token: binding.token, fileId: f.id });
      const bytes = b64ToBytes(res.data);
      const name = String(f.name || 'файл').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'файл';
      const Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
      if (!Filesystem) throw new Error('Сохранение файлов недоступно');
      const path = `corsa-mess/${name}`;
      await Filesystem.writeFile({ path, data: bytesToB64(bytes), directory: 'DOCUMENTS', recursive: true });
      return `Документы/${path}`;
    },

    setTitleBar: () => resolved(true), // на Android своей рамки окна нет
    notify: (n) => Plug().notifyShow(n).then(() => true),
    onNotifyClick: noop,
    attention: () => resolved(true),
    setGlobalHotkeys: () => resolved([]),
    onHotkey: noop,

    soundsList: () => resolved([]),
    soundsImport: () => Promise.reject(new Error('Недоступно на телефоне')),
    soundsRemove: () => resolved(true),

    exportFiles: async (files) => {
      const P = (window.Capacitor && window.Capacitor.Plugins) || {};
      if (!P.Filesystem) return { ok: false };
      const saved = [];
      for (const f of files || []) {
        const path = `corsa-mess/${f.name}`;
        await P.Filesystem.writeFile({ path, data: bytesToB64(f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data)), directory: 'CACHE', recursive: true });
        const { uri } = await P.Filesystem.getUri({ path, directory: 'CACHE' });
        saved.push(uri);
      }
      if (P.Share && saved.length) await P.Share.share({ files: saved }).catch(() => {});
      return { ok: true };
    },
    importFiles: () => Promise.reject(new Error('Недоступно на телефоне')),

    presenceNow: () => resolved(null), // "играет в…" через Discord/Steam — настольная функция
    presenceConfig: () => resolved(true),
    onPresence: noop,
  };
})();
