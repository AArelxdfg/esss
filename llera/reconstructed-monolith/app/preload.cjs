'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('llera', Object.freeze({
  identity: () => ipcRenderer.invoke('llera:identity'),
  uiState: () => ipcRenderer.invoke('llera:ui-state'),
  setSurface: (surface) => ipcRenderer.invoke('llera:set-surface', surface),
  setViewport: (width) => ipcRenderer.invoke('llera:set-viewport', width),
  shortcut: (input) => ipcRenderer.invoke('llera:shortcut', input),
  paletteQuery: (query) => ipcRenderer.invoke('llera:palette-query', query),
  composer: (value) => ipcRenderer.invoke('llera:composer', value),
  productSnapshot: () => ipcRenderer.invoke('llera:product-snapshot'),
  newConversation: () => ipcRenderer.invoke('llera:new-conversation'),
  selectConversation: (id) => ipcRenderer.invoke('llera:select-conversation', id),
  sendMessage: (input) => ipcRenderer.invoke('llera:send-message', input),
  attach: (input) => ipcRenderer.invoke('llera:attach', input),
  createMission: (input) => ipcRenderer.invoke('llera:create-mission', input),
}));
