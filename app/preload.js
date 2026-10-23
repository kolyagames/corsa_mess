const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corsaNative', {
  hostStart: (opts) => ipcRenderer.invoke('host:start', opts),
  hostStop: () => ipcRenderer.invoke('host:stop'),
  makeCode: (ip, port) => ipcRenderer.invoke('host:code', ip, port),
  lanIps: () => ipcRenderer.invoke('net:ips'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  listThemes: () => ipcRenderer.invoke('themes:list'),
  openFolder: (kind) => ipcRenderer.invoke('folder:open', kind),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  screenSelect: (id) => ipcRenderer.invoke('screen:select', id),
  openInternet: () => ipcRenderer.invoke('net:open-internet'),
  closeInternet: () => ipcRenderer.invoke('net:close-internet'),
  tlsPins: () => ipcRenderer.invoke('tls:pins'),
  tlsForget: (host) => ipcRenderer.invoke('tls:forget', host),
  tlsSelf: () => ipcRenderer.invoke('tls:self'),
  onTls: (cb) => {
    const fn = (e, d) => cb(d);
    ipcRenderer.on('tls:event', fn);
    return () => ipcRenderer.removeListener('tls:event', fn);
  },
  lanScan: () => ipcRenderer.invoke('lan:scan'),
  mediaWatch: (on) => ipcRenderer.invoke('media:watch', !!on),
  mediaCommand: (cmd) => ipcRenderer.invoke('media:cmd', cmd),
  onMedia: (cb) => {
    const fn = (e, t) => cb(t);
    ipcRenderer.on('media:change', fn);
    return () => ipcRenderer.removeListener('media:change', fn);
  },
  migrationScan: () => ipcRenderer.invoke('migrate:scan'),
  appPrefs: (p) => ipcRenderer.invoke('app:prefs', p),
  secretSet: (key, value) => ipcRenderer.invoke('secret:set', key, value),
  secretGet: (key) => ipcRenderer.invoke('secret:get', key),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  openReleasePage: (url) => ipcRenderer.invoke('update:page', url),
  onUpdateProgress: (cb) => {
    const fn = (e, p) => cb(p);
    ipcRenderer.on('update:progress', fn);
    return () => ipcRenderer.removeListener('update:progress', fn);
  },
  roomBind: (b) => ipcRenderer.invoke('room:bind', b),
  uploadFile: (f) => ipcRenderer.invoke('room:upload', f),
  saveRoomFile: (f) => ipcRenderer.invoke('room:save', f),
  setTitleBar: (c) => ipcRenderer.invoke('window:titlebar', c),
  notify: (n) => ipcRenderer.invoke('notify:show', n),
  onNotifyClick: (cb) => {
    const fn = (e, tag) => cb(tag);
    ipcRenderer.on('notify:click', fn);
    return () => ipcRenderer.removeListener('notify:click', fn);
  },
  attention: (on) => ipcRenderer.invoke('win:attention', !!on),
  setGlobalHotkeys: (list) => ipcRenderer.invoke('hotkeys:global', list),
  onHotkey: (cb) => {
    const fn = (e, id) => cb(id);
    ipcRenderer.on('hotkey', fn);
    return () => ipcRenderer.removeListener('hotkey', fn);
  },
  soundsList: () => ipcRenderer.invoke('sounds:list'),
  soundsImport: () => ipcRenderer.invoke('sounds:import'),
  soundsRemove: (file) => ipcRenderer.invoke('sounds:remove', file),
  exportFiles: (files) => ipcRenderer.invoke('files:export', files),
  importFiles: () => ipcRenderer.invoke('files:import'),
  presenceNow: () => ipcRenderer.invoke('presence:detect'),
  presenceConfig: (c) => ipcRenderer.invoke('presence:config', c),
  onPresence: (cb) => {
    const fn = (e, a) => cb(a);
    ipcRenderer.on('presence:change', fn);
    return () => ipcRenderer.removeListener('presence:change', fn);
  },
});
