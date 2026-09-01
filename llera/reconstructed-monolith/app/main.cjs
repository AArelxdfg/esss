'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { AuroraUIContract } = require('../src/aurora-ui-contract');

let windowRef = null;
const ui = new AuroraUIContract();

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
