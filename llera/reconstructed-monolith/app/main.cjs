'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { MonolithService, MAX_ATTACHMENT_BYTES } = require('./services/monolith-service.cjs');
const { WorkModeService } = require('./services/work-mode-service.cjs');

let windowRef = null;
let monolith = null;
let workMode = null;

function productIdentity() {
  return Object.freeze({ product: 'LLera MONOLITH OMEGA', exactHistoricalV54: false, historicalClaimAllowed: false, version: app.getVersion() });
}

function publish(event) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.webContents.send('llera:event', event);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#11141a',
    icon: path.join(__dirname, 'assets', 'llera-logo.png'),
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
  win.on('maximize', () => publish({ type: 'window.changed', detail: { maximized: true } }));
  win.on('unmaximize', () => publish({ type: 'window.changed', detail: { maximized: false } }));
  win.on('closed', () => { if (windowRef === win) windowRef = null; });
  win.loadFile(path.join(__dirname, 'index.html'));
  windowRef = win;
}

function validateId(value, label) { if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{5,80}$/i.test(value)) throw new Error(`${label} id is invalid`); return value; }
function validateText(value, limit, label) { if (typeof value !== 'string') throw new Error(`${label} must be text`); return value.slice(0, limit); }
function validateMessage(value) { if (!value || typeof value !== 'object') throw new Error('message payload is required'); return { content: typeof value.content === 'string' ? value.content.slice(0, 20000) : '', attachmentIds: Array.isArray(value.attachmentIds) ? value.attachmentIds.map(item => validateId(item, 'attachment')).slice(0, 8) : [], model: value.model == null ? null : validateText(value.model, 100, 'model') }; }
function validateAttachment(value) { if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.type !== 'string' || !value.bytes) throw new Error('attachment payload is invalid'); if (value.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('attachment is too large'); return { name: value.name.slice(0, 180), type: value.type.slice(0, 100), bytes: value.bytes }; }
function validateMission(value) { if (!value || typeof value !== 'object') throw new Error('mission payload is invalid'); return { title: typeof value.title === 'string' ? value.title.slice(0, 120) : '', goal: typeof value.goal === 'string' ? value.goal.slice(0, 2000) : '' }; }
function validateWorkTool(value) {
  if (!value || typeof value !== 'object') throw new Error('work tool payload is invalid');
  const tool = validateText(value.tool || '', 80, 'tool');
  if (!/^[a-z][a-z0-9_]{1,79}$/.test(tool)) throw new Error('tool name is invalid');
  const args = value.args && typeof value.args === 'object' && !Array.isArray(value.args) ? value.args : {};
  return {
    missionId: validateId(value.missionId, 'mission'),
    stepId: value.stepId == null ? null : validateId(value.stepId, 'step'),
    tool,
    args,
    materialAuthorization: value.materialAuthorization === true
  };
}
function validateStepCompletion(value) {
  if (!value || typeof value !== 'object') throw new Error('step completion payload is invalid');
  return {
    missionId: validateId(value.missionId, 'mission'),
    stepId: validateId(value.stepId, 'step'),
    result: value.result && typeof value.result === 'object' && !Array.isArray(value.result) ? value.result : {}
  };
}

ipcMain.handle('llera:identity', () => productIdentity());
ipcMain.handle('llera:snapshot', () => monolith.snapshot());
ipcMain.handle('llera:conversation:new', () => monolith.createConversation());
ipcMain.handle('llera:conversation:select', (_event, id) => monolith.selectConversation(validateId(id, 'conversation')));
ipcMain.handle('llera:conversation:rename', (_event, input) => monolith.renameConversation(validateId(input?.id, 'conversation'), validateText(input?.title, 120, 'title')));
ipcMain.handle('llera:conversation:pin', (_event, input) => monolith.pinConversation(validateId(input?.id, 'conversation'), Boolean(input?.pinned)));
ipcMain.handle('llera:conversation:delete', (_event, id) => monolith.deleteConversation(validateId(id, 'conversation')));
ipcMain.handle('llera:search', (_event, query) => monolith.search(validateText(query || '', 300, 'query')));
ipcMain.handle('llera:message:send', (_event, input) => monolith.send(validateMessage(input)));
ipcMain.handle('llera:message:stop', () => monolith.stopGeneration());
ipcMain.handle('llera:attachment:add', (_event, input) => monolith.attach(validateAttachment(input)));
ipcMain.handle('llera:mission:create', (_event, input) => monolith.createMission(validateMission(input)));
ipcMain.handle('llera:mission:start', (_event, id) => workMode.startMission(validateId(id, 'mission')));
ipcMain.handle('llera:mission:next', (_event, id) => workMode.beginNextStep(validateId(id, 'mission')));
ipcMain.handle('llera:mission:status', (_event, id) => workMode.status(validateId(id, 'mission')));
ipcMain.handle('llera:mission:tool', (_event, input) => workMode.invokeTool(validateWorkTool(input)));
ipcMain.handle('llera:mission:complete-step', (_event, input) => { const value = validateStepCompletion(input); return workMode.completeCurrentStep(value.missionId, value.stepId, value.result); });
ipcMain.handle('llera:settings:update', (_event, input) => monolith.updateSettings(input && typeof input === 'object' ? input : {}));
ipcMain.handle('llera:model:import', async event => { const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Yerel modeli seçin', properties:['openFile'], filters:[{ name:'GGUF model', extensions:['gguf'] }] }); if (result.canceled || !result.filePaths[0]) return monolith.snapshot(); return monolith.importModel({ sourcePath: result.filePaths[0] }); });
ipcMain.handle('llera:window', (_event, action) => { const win = BrowserWindow.fromWebContents(_event.sender); if (!win) return false; if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); else throw new Error('window action is invalid'); return true; });

app.whenReady().then(async () => {
  monolith = new MonolithService({ userData: app.getPath('userData'), onEvent: publish });
  await monolith.init();
  workMode = new WorkModeService({ missionEngine: monolith.missions, userData: app.getPath('userData'), onEvent: publish });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });