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
