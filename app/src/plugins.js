// Плагины и темы. Плагин — папка в plugins/ с manifest.json и index.js, либо встроенный (src/builtin).
// ВАЖНО: плагин — это код с полным доступом к интерфейсу. Включайте только те, которым доверяете.
(function () {
  const C = window.Corsa;

  const host = {
    plugins: [], // {info, def, enabled, error, cleanups, builtin}
    commands: new Map(), // имя -> {plugin, fn, description}
    messageHooks: [],
    events: new Map(), // событие -> [{plugin, fn}]
    slots: new Map(), // место в интерфейсе -> [{plugin, fn}]
    intercepts: new Map(), // действие -> [{plugin, fn}]
    builtins: [],
    appApi: null, // заполняется из app.js
  };
  C.plugins = host;

  C.definePlugin = function definePlugin(def) {
    window.__corsaLastDef = def;
  };

  // Встроенные плагины: часть приложения, поэтому подтверждать хэш не нужно.
  C.builtinPlugin = function builtinPlugin(def) {
    host.builtins.push(def);
  };

  const addTo = (map, key, item) => { if (!map.has(key)) map.set(key, []); map.get(key).push(item); };
  const removeFrom = (map, key, item) => { const list = map.get(key) || []; const i = list.indexOf(item); if (i >= 0) list.splice(i, 1); };

  function pluginSettings(entry) {
    const key = `plugin.${entry.info.id}.settings`;
    const schema = (entry.def && entry.def.settings) || [];
    const values = { ...Object.fromEntries(schema.map((s) => [s.key, s.default])), ...C.store.get(key, {}) };
    return {
      schema, values,
      set(k, v) { values[k] = v; C.store.set(key, values); if (entry.def && typeof entry.def.onSettings === 'function') { try { entry.def.onSettings(k, v); } catch (e) { /* плагин сломан */ } } },
    };
  }

  function pluginApi(entry) {
    const key = (k) => `plugin.${entry.info.id}.${k}`;
    const id = entry.info.id;
    const track = (map, name, fn) => { const item = { plugin: id, fn }; addTo(map, name, item); entry.cleanups.push(() => removeFrom(map, name, item)); };
    const api = {
      name: entry.info.name,
      h: C.h,
      toast: (text) => C.toast(String(text)),
      addCommand(name, fn, description) {
        const n = String(name).replace(/^\//, '').toLowerCase();
        host.commands.set(n, { plugin: id, fn, description: String(description || '') });
        entry.cleanups.push(() => host.commands.delete(n));
      },
      onMessage(fn) {
        const hook = { plugin: id, fn };
        host.messageHooks.push(hook);
        entry.cleanups.push(() => { host.messageHooks.splice(host.messageHooks.indexOf(hook), 1); });
      },
      // События приложения: message, member, typing, voice, connect, disconnect, media, delete, edit, render.
      on(event, fn) { track(host.events, event, fn); },
      // Свои элементы в интерфейсе: message, member, profile, channel, userbar, memberHeader, railBottom,
      // roomTooltip, voiceTile, msgTools, composer, sideTop.
      decorate(slot, fn) { track(host.slots, slot, fn); api.app && api.app.rerender(); },
      // Перехват действий: typing (false — не отправлять), delete (true — оставить сообщение), activity (изменить).
      intercept(name, fn) { track(host.intercepts, name, fn); },
      addCss(text) {
        const el = C.h('style', { dataset: { plugin: id } });
        el.textContent = String(text);
        document.head.append(el);
        entry.cleanups.push(() => el.remove());
      },
      interval(fn, ms) { const t = setInterval(fn, ms); entry.cleanups.push(() => clearInterval(t)); return t; },
      cleanup(fn) { entry.cleanups.push(fn); },
      storage: { get: (k, d) => C.store.get(key(k), d), set: (k, v) => C.store.set(key(k), v) },
      get settings() { return pluginSettings(entry).values; },
      app: host.appApi,
    };
    return api;
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
      if (!entry.builtin) {
        // Запоминаем хэш файлов, которые пользователь сейчас разрешил запускать.
        const approved = C.store.get('plugins.approved', {});
        approved[id] = entry.info.hash;
        C.store.set('plugins.approved', approved);
        entry.def = null;
      }
      if (!entry.enabled) await host.start(entry);
    } else host.stop(entry);
    const enabled = C.store.get('plugins.enabled', {});
    enabled[id] = entry.enabled;
    C.store.set('plugins.enabled', enabled);
    if (host.appApi) host.appApi.rerender();
  };

  host.settingsOf = (id) => { const e = host.plugins.find((p) => p.info.id === id); return e ? pluginSettings(e) : null; };

  // Плагин запускается только если его файлы совпадают с теми, что вы разрешили. Любое изменение на диске
  // отключает плагин, пока вы не включите его заново: так подменённый файл не запустится втихую.
  host.refresh = async function refresh() {
    const list = await window.corsaNative.listPlugins();
    for (const e of host.plugins) if (!e.builtin && !list.find((i) => i.id === e.info.id)) host.stop(e);
    const approved = C.store.get('plugins.approved', {});
    const enabled = C.store.get('plugins.enabled', {});
    const next = [];
    for (const def of host.builtins) {
      let entry = host.plugins.find((p) => p.builtin && p.info.id === def.id);
      if (!entry) {
        entry = { builtin: true, def, enabled: false, error: null, cleanups: [],
          info: { id: def.id, name: def.name, version: '', description: def.description || '', author: '', origin: def.origin || '', category: def.category || 'Разное' } };
      }
      next.push(entry);
      const want = enabled[def.id] === undefined ? !!def.defaultOn : enabled[def.id];
      if (want && !entry.enabled) await host.start(entry);
    }
    for (const info of list) {
      let entry = host.plugins.find((p) => !p.builtin && p.info.id === info.id);
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

  host.emit = function emit(event, ...args) {
    for (const item of host.events.get(event) || []) { try { item.fn(...args); } catch (e) { console.warn('plugin', item.plugin, e); } }
  };

  // Собирает элементы от плагинов для места в интерфейсе. Возвращает список узлов (пустые пропускаются).
  host.collect = function collect(slot, ctx) {
    const out = [];
    for (const item of host.slots.get(slot) || []) {
      try { const r = item.fn(ctx); if (r == null || r === false) continue; for (const x of [].concat(r)) if (x != null && x !== false) out.push(x); } catch (e) { console.warn('plugin', item.plugin, e); }
    }
    return out;
  };

  // Перехват: каждый плагин получает текущее значение и может вернуть новое.
  host.intercept = function intercept(name, value, ...args) {
    let v = value;
    for (const item of host.intercepts.get(name) || []) { try { const r = item.fn(v, ...args); if (r !== undefined) v = r; } catch (e) { /* плагин сломан */ } }
    return v;
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
