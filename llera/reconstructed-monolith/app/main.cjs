'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { AuroraUIContract } = require('../src/aurora-ui-contract');
const { MonolithService } = require('./services/monolith-service.cjs');

let windowRef = null;
const ui = new AuroraUIContract();
let monolith = null;

function productIdentity() {
  return Object.freeze({
    product: 'LLera MONOLITH OMEGA reconstructed',
    exactHistoricalV54: false,
    historicalClaimAllowed: false,
    uiSelfTest: ui.selfTest(),
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#090b10',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => {
    if (windowRef === win) windowRef = null;
  });
  windowRef = win;
}

ipcMain.handle('llera:identity', () => productIdentity());
ipcMain.handle('llera:ui-state', () => ({
  navigation: ui.getNavigationState(),
  layout: ui.getResponsiveLayout(),
  motion: ui.getMotionPolicy(),
  accessibility: ui.getAccessibilityContract(),
  composer: ui.getComposerState(),
  palette: ui.getPaletteState(),
}));
ipcMain.handle('llera:set-surface', (_event, surface) => {
  ui.setSurface(surface);
  return { navigation: ui.getNavigationState(), liveRegion: ui.getLiveRegionState() };
});
ipcMain.handle('llera:set-viewport', (_event, width) => ui.setViewportWidth(Number(width)));
ipcMain.handle('llera:shortcut', (_event, input) => ui.handleShortcut(input || {}));
ipcMain.handle('llera:palette-query', (_event, query) => {
  ui.setPaletteQuery(query);
  return ui.getPaletteState();
});
ipcMain.handle('llera:composer', (_event, value) => ui.updateComposer(value));
ipcMain.handle('llera:product-snapshot', () => monolith.snapshot());
ipcMain.handle('llera:new-conversation', () => monolith.createConversation());
ipcMain.handle('llera:select-conversation', (_event, id) => monolith.selectConversation(validateId(id, 'conversation')));
ipcMain.handle('llera:send-message', (_event, input) => monolith.send(validateMessage(input)));
ipcMain.handle('llera:attach', (_event, input) => monolith.attach(validateAttachment(input)));
ipcMain.handle('llera:create-mission', (_event, input) => monolith.createMission(validateMission(input)));

function validateId(value, label) { if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{5,80}$/i.test(value)) throw new Error(`${label} id is invalid`); return value; }
function validateMessage(value) { if (!value || typeof value !== 'object') throw new Error('message payload is required'); const content = typeof value.content === 'string' ? value.content.slice(0, 20000) : ''; const attachmentIds = Array.isArray(value.attachmentIds) ? value.attachmentIds.map(id => validateId(id, 'attachment')).slice(0, 8) : []; const model = value.model == null ? null : (typeof value.model === 'string' && value.model.length <= 100 ? value.model : null); return { content, attachmentIds, model }; }
function validateAttachment(value) { if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.type !== 'string' || !value.bytes) throw new Error('attachment payload is invalid'); return { name: value.name, type: value.type, bytes: value.bytes }; }
function validateMission(value) { if (!value || typeof value !== 'object') throw new Error('mission payload is invalid'); return { title: typeof value.title === 'string' ? value.title.slice(0, 120) : '', goal: typeof value.goal === 'string' ? value.goal.slice(0, 2000) : '' }; }

app.whenReady().then(() => {
  monolith = new MonolithService({ userData: app.getPath('userData') });
  return monolith.init();
}).then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
