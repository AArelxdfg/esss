'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('llera', Object.freeze({
  identity: () => ipcRenderer.invoke('llera:identity'),
  snapshot: () => ipcRenderer.invoke('llera:snapshot'),
  newConversation: () => ipcRenderer.invoke('llera:conversation:new'),
  selectConversation: id => ipcRenderer.invoke('llera:conversation:select', id),
  renameConversation: input => ipcRenderer.invoke('llera:conversation:rename', input),
  pinConversation: input => ipcRenderer.invoke('llera:conversation:pin', input),
  deleteConversation: id => ipcRenderer.invoke('llera:conversation:delete', id),
  search: query => ipcRenderer.invoke('llera:search', query),
  sendMessage: input => ipcRenderer.invoke('llera:message:send', input),
  stopGeneration: () => ipcRenderer.invoke('llera:message:stop'),
  addAttachment: input => ipcRenderer.invoke('llera:attachment:add', input),
  createMission: input => ipcRenderer.invoke('llera:mission:create', input),
  startMission: id => ipcRenderer.invoke('llera:mission:start', id),
  beginNextMissionStep: id => ipcRenderer.invoke('llera:mission:next', id),
  missionStatus: id => ipcRenderer.invoke('llera:mission:status', id),
  invokeMissionTool: input => ipcRenderer.invoke('llera:mission:tool', input),
  completeMissionStep: input => ipcRenderer.invoke('llera:mission:complete-step', input),
  updateSettings: input => ipcRenderer.invoke('llera:settings:update', input),
  importModel: () => ipcRenderer.invoke('llera:model:import'),
  windowAction: action => ipcRenderer.invoke('llera:window', action),
  onEvent: listener => {
    if (typeof listener !== 'function') throw new Error('event listener must be a function');
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('llera:event', handler);
    return () => ipcRenderer.removeListener('llera:event', handler);
  },
}));