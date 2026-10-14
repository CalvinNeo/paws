const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pawpal', {
    getState: () => ipcRenderer.invoke('pawpal:get'),
    action: (action) => ipcRenderer.invoke('pawpal:action', action),
    play: (mode) => ipcRenderer.invoke('pawpal:play', mode),
    toyState: () => ipcRenderer.invoke('pawpal:toy-get'),
    toyPointer: (inside) => ipcRenderer.send('pawpal:toy-pointer', inside),
    toyDrag: (phase, point) => ipcRenderer.send('pawpal:toy-drag', phase, point),
    toyMenu: () => ipcRenderer.send('pawpal:toy-menu'),
    onToyState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('pawpal:toy-state', listener);
        return () => ipcRenderer.removeListener('pawpal:toy-state', listener);
    },
    preferences: (patch) => ipcRenderer.invoke('pawpal:preferences', patch),
    rename: (name) => ipcRenderer.invoke('pawpal:rename', name),
    window: (command) => ipcRenderer.invoke('pawpal:window', command),
    pointer: (interactive) => ipcRenderer.send('pawpal:pointer', interactive),
    drag: (phase) => ipcRenderer.send('pawpal:drag', phase),
    menu: () => ipcRenderer.send('pawpal:menu'),
    onState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('pawpal:state', listener);
        return () => ipcRenderer.removeListener('pawpal:state', listener);
    },
});
