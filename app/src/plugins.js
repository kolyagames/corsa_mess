// Плагины и темы. Плагин — папка в plugins/ с manifest.json и index.js.
// ВАЖНО: плагин — это код с полным доступом к интерфейсу. Включайте только те, которым доверяете.
(function () {
  const C = window.Corsa;

  const host = {
    plugins: [], // {info, def, enabled, error, cleanups}
    commands: new Map(), // имя -> {plugin, fn, description}
    messageHooks: [],
    appApi: null, // заполняется из app.js
  };
  C.plugins = host;

  C.definePlugin = function definePlugin(def) {
    window.__corsaLastDef = def;
  };

  function pluginApi(entry) {
    const key = (k) => `plugin.${entry.info.id}.${k}`;
    return {
      name: entry.info.name,
      toast: (text) => C.toast(String(text)),
      addCommand(name, fn, description) {
        const n = String(name).replace(/^\//, '').toLowerCase();
        host.commands.set(n, { plugin: entry.info.id, fn, description: String(description || '') });
        entry.cleanups.push(() => host.commands.delete(n));
      },
      onMessage(fn) {
        const hook = { plugin: entry.info.id, fn };
        host.messageHooks.push(hook);
        entry.cleanups.push(() => { host.messageHooks.splice(host.messageHooks.indexOf(hook), 1); });
      },
      addCss(text) {
        const el = C.h('style', { dataset: { plugin: entry.info.id } });
        el.textContent = String(text);
        document.head.append(el);
        entry.cleanups.push(() => el.remove());
      },
      storage: { get: (k, d) => C.store.get(key(k), d), set: (k, v) => C.store.set(key(k), v) },
      app: host.appApi,
    };
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      window.__corsaLastDef = null;
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { const def = window.__corsaLastDef; s.remove(); def ? resolve(def) : reject(new Error('плагин не вызвал Corsa.definePlugin')); };
      s.onerror = () => { s.remove(); reject(new Error('не удалось загрузить файл')); };
      document.head.append(s);
    });
  }

  host.start = async function start(entry) {
    entry.error = null;
    entry.cleanups = [];
    try {
      if (!entry.def) entry.def = await loadScript(entry.info.url);
      if (typeof entry.def.start === 'function') entry.def.start(pluginApi(entry));
      entry.enabled = true;
    } catch (e) {
      entry.error = String(e && e.message || e);
      entry.enabled = false;
      for (const fn of entry.cleanups) { try { fn(); } catch (err) { /* ignore */ } }
      entry.cleanups = [];
    }
  };

  host.stop = function stop(entry) {
    try { if (entry.def && typeof entry.def.stop === 'function') entry.def.stop(); } catch (e) { /* ignore */ }
    for (const fn of entry.cleanups || []) { try { fn(); } catch (e) { /* ignore */ } }
    entry.cleanups = [];
    entry.enabled = false;
  };

  host.toggle = async function toggle(id, on) {
    const entry = host.plugins.find((p) => p.info.id === id);
    if (!entry) return;
    if (on) {
      // Запоминаем хэш файлов, которые пользователь сейчас разрешил запускать.
      const approved = C.store.get('plugins.approved', {});
      approved[id] = entry.info.hash;
      C.store.set('plugins.approved', approved);
      entry.def = null;
      await host.start(entry);
    } else host.stop(entry);
    const enabled = C.store.get('plugins.enabled', {});
    enabled[id] = entry.enabled;
    C.store.set('plugins.enabled', enabled);
  };

  // Плагин запускается только если его файлы совпадают с теми, что вы разрешили. Любое изменение на диске
  // отключает плагин, пока вы не включите его заново: так подмененный файл не запустится втихую.
  host.refresh = async function refresh() {
    const list = await window.corsaNative.listPlugins();
    for (const e of host.plugins) if (!list.find((i) => i.id === e.info.id)) host.stop(e);
    const approved = C.store.get('plugins.approved', {});
    const enabled = C.store.get('plugins.enabled', {});
    const next = [];
    for (const info of list) {
      let entry = host.plugins.find((p) => p.info.id === info.id);
      if (entry && entry.info.hash !== info.hash) { host.stop(entry); entry.def = null; }
      if (!entry) entry = { info, def: null, enabled: false, error: null, cleanups: [] };
      entry.info = info;
      next.push(entry);
      if (enabled[info.id] && !entry.enabled) {
        if (approved[info.id] === info.hash) await host.start(entry);
        else {
          entry.error = 'Файлы плагина изменились после включения. Проверьте его и включите заново';
          enabled[info.id] = false;
          C.store.set('plugins.enabled', enabled);
        }
      }
    }
    host.plugins = next;
  };

  // Хуки сообщений: плагин может изменить текст перед показом.
  host.transformMessage = function transformMessage(msg) {
    let out = msg;
    for (const hook of host.messageHooks) {
      try { const r = hook.fn({ ...out }); if (r && typeof r === 'object') out = { ...out, ...r }; } catch (e) { /* плагин сломан */ }
    }
    return out;
  };

  // Темы
  const themes = { list: [] };
  C.themes = themes;

  themes.apply = function apply() {
    const active = C.store.get('themes.active', []);
    document.querySelectorAll('link[data-theme]').forEach((l) => l.remove());
    for (const t of themes.list) {
      if (!active.includes(t.id)) continue;
      document.head.append(C.h('link', { rel: 'stylesheet', href: t.url, dataset: { theme: t.id } }));
    }
  };

  themes.refresh = async function refresh() {
    themes.list = await window.corsaNative.listThemes();
    themes.apply();
  };

  themes.toggle = function toggle(id, on) {
    const active = new Set(C.store.get('themes.active', []));
    if (on) active.add(id); else active.delete(id);
    C.store.set('themes.active', [...active]);
    themes.apply();
  };
})();
