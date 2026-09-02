'use strict';

const $ = id => document.getElementById(id);
const svg = name => { const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); node.append(use); return node; };
const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = String(text); return item; };
const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const formatTime = value => { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); } catch (_) { return ''; } };

let state = null;
let identity = null;
let pendingAttachments = [];
let selectedModel = null;
let sending = false;
let composingIME = false;
let drawerKind = null;
let paletteItems = [];
let paletteIndex = 0;
let focusBeforeModal = null;
let confirmAction = null;
let renameConversationTarget = null;
let dragDepth = 0;
let selectedMissionId = null;

function announce(message) { $('screen-reader-status').textContent = message; }
function toast(message) { const item = node('div', 'toast', message); $('toast-region').append(item); setTimeout(() => item.remove(), 2600); }

function applySettings() {
  const settings = state?.settings || {};
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = settings.theme === 'system' ? (dark ? 'dark' : 'light') : settings.theme;
  root.dataset.theme = theme;
  root.style.setProperty('--text-scale', String(settings.textScale || 1));
  root.classList.toggle('motion-off', settings.motion === false);
  $('app').classList.toggle('sidebar-collapsed', Boolean(settings.sidebarCollapsed) && innerWidth > 780);
  $('app').classList.toggle('summary-visible', Boolean(settings.showSummary));
  $('app').classList.toggle('context-visible', Boolean(settings.showContext));
}

function groupConversations(items) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const week = new Date(today); week.setDate(today.getDate() - 7);
  const groups = { Sabitlenmiş: [], Bugün: [], Dün: [], 'Son 7 gün': [], Önceki: [] };
  for (const item of items) {
    if (item.pinned) { groups.Sabitlenmiş.push(item); continue; }
    const date = new Date(item.updatedAt || item.createdAt);
    if (date >= today) groups.Bugün.push(item);
    else if (date >= yesterday) groups.Dün.push(item);
    else if (date >= week) groups['Son 7 gün'].push(item);
    else groups.Önceki.push(item);
  }
  return groups;
}

function renderSidebar() {
  const root = $('conversation-list'); root.replaceChildren();
  const groups = groupConversations(state.conversations || []);
  for (const [label, conversations] of Object.entries(groups)) {
    if (!conversations.length) continue;
    const section = node('section', 'history-section'); section.append(node('div', 'section-label', label));
    for (const conversation of conversations) {
      const row = node('div', `conversation-row${conversation.id === state.activeConversation?.id ? ' active' : ''}`);
      const button = node('button', 'conversation-button', conversation.title); button.type = 'button'; button.title = conversation.title;
      button.addEventListener('click', async () => { state = await window.llera.selectConversation(conversation.id); pendingAttachments = []; renderAll(); closeMobileSidebar(); });
      const more = node('button', 'conversation-more'); more.type = 'button'; more.setAttribute('aria-label', `Actions for ${conversation.title}`); more.append(svg('more'));
      more.addEventListener('click', event => openConversationMenu(event.currentTarget, conversation));
      row.append(button, more); section.append(row);
    }
    root.append(section);
  }
  if (!state.conversations.length) { const empty = node('p', 'section-label', 'Sohbetleriniz burada görünür.'); empty.style.paddingTop = '18px'; root.append(empty); }
  renderActiveWork();
}

function renderActiveWork() {
  const root = $('active-work'); root.replaceChildren();
  const mission = (state.missions || []).find(item => ['running', 'interrupted', 'pending'].includes(item.status));
  $('mission-chip').classList.toggle('is-hidden', !mission);
  if (!mission) return;
  const card = node('div', 'work-card'); card.tabIndex = 0;
  const title = node('strong', '', mission.title); const meta = node('span'); meta.append(node('i', 'pulse-dot'), document.createTextNode(`${mission.status} · ${mission.steps?.filter(step => step.status === 'completed').length || 0}/${mission.steps?.length || 0} steps`)); card.append(title, meta);
  card.addEventListener('click', () => openDrawer('mission', mission)); root.append(card);
  $('mission-chip').onclick = () => openDrawer('mission', mission);
}

function renderEmpty(root) {
  const empty = node('div', 'empty-state');
  const mark = node('span', 'brand-image empty-mark'); const logo = node('img'); logo.src = 'assets/llera-logo.png'; logo.alt = 'LLera'; mark.append(logo);
  empty.append(mark, node('h2', '', 'Bugün ne üzerinde çalışıyoruz?'));
  const actions = node('div', 'quick-actions');
  [['Dosya ekle', () => $('file-input').click()], ['Görsel analiz et', () => $('file-input').click()], ['Görev başlat', () => setMode('work')], ['Plan oluştur', () => fillComposer('Şunu planlamama yardım et: ')]]
    .forEach(([label, action]) => { const button = node('button', 'quick-action', label); button.onclick = action; actions.append(button); });
  empty.append(actions); root.append(empty);
}

function renderTextContent(container, content) {
  const text = String(content || '');
  const parts = text.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) { const pre = node('pre'); const code = node('code', '', part.slice(3, -3).replace(/^\w+\n/, '')); pre.append(code); container.append(pre); }
    else container.append(document.createTextNode(part));
  }
}

function renderMessages() {
  const root = $('transcript'); root.replaceChildren();
  const conversation = state.activeConversation;
  if (!conversation || !(conversation.messages || []).length) { renderEmpty(root); return; }
  for (const message of conversation.messages) {
    const article = node('article', `message ${message.role}${message.status ? ` ${message.status}` : ''}`); article.dataset.messageId = message.id;
    if (message.attachments?.length) {
      const attachments = node('div', 'message-attachments');
      for (const attachment of message.attachments) attachments.append(renderFilePill(attachment));
      article.append(attachments);
    }
    const content = node('div', 'message-content'); renderTextContent(content, message.content || message.error || '');
    if (message.status === 'streaming') content.append(node('span', 'streaming-caret'));
    article.append(content);
    if (message.role === 'assistant' || message.status === 'failed' || message.status === 'stopped') {
      const meta = node('div', 'message-meta');
      meta.append(document.createTextNode(message.status === 'streaming' ? 'Yanıt hazırlanıyor' : message.status === 'failed' ? 'İlgi gerekiyor' : message.status === 'stopped' ? 'Durduruldu' : `${message.model || 'Yerel model'} · ${formatTime(message.completedAt || message.createdAt)}`)); article.append(meta);
    }
    root.append(article);
  }
  const recentActivity = state.activity?.filter(item => ['runtime.starting', 'runtime.ready', 'message.completed'].includes(item.type)).slice(0, 5) || [];
  if (sending && recentActivity.length) root.append(renderInlineActivity(recentActivity));
  requestAnimationFrame(() => { root.scrollTop = root.scrollHeight; });
}

function renderInlineActivity(items) {
  const details = node('details', 'agent-activity'); if (state.settings.activityDensity === 'detailed') details.open = true;
  const summary = node('summary', '', sending ? 'LLera is working' : `Completed ${items.length} actions`); details.append(summary);
  const list = node('div', 'agent-activity-list');
  for (const item of items) { const row = node('div', 'agent-activity-item'); row.append(svg('check'), node('span', '', item.summary)); list.append(row); }
  details.append(list); return details;
}

function renderFilePill(attachment) {
  const item = node('div', 'file-pill'); item.append(svg('file'));
  const copy = node('span'); copy.append(node('strong', '', attachment.name), node('small', '', formatBytes(attachment.bytes))); item.append(copy); return item;
}

function renderComposer() {
  const configured = state.runtimeConfigured;
  const modelId = selectedModel || state.settings.defaultModel || state.models?.[0]?.id || null;
  const model = state.models?.find(item => item.id === modelId);
  $('composer-model').textContent = model?.name || 'Model seç';
  document.querySelector('.model-indicator').classList.toggle('ready', Boolean(model));
  $('local-status').textContent = configured ? `${model?.name || state.models[0].name} hazır` : 'Model kurulumu gerekli';
  document.querySelector('.local-glyph i').classList.toggle('ready', configured);
  const status = $('composer-status'); status.replaceChildren();
  if (!configured) {
    const message = node('div', 'runtime-message'); message.append(node('span', 'status-dot'), document.createTextNode('Başlamak için yerel bir model seçin. ')); const action = node('button', '', 'Model seç'); action.onclick = openModelPicker; message.append(action); status.append(message);
  } else if (state.runtime.state === 'starting') status.append(node('div', 'runtime-message', `Loading ${model?.name || modelId}…`));
  else if (state.runtime.state === 'failed') { const message = node('div', 'runtime-message'); message.append(node('span', 'status-dot'), document.createTextNode("Couldn't start the local model. ")); const details = node('button', '', 'Details'); details.onclick = () => openDrawer('models'); message.append(details); status.append(message); }
  $('send-button').classList.toggle('is-hidden', sending); $('stop-button').classList.toggle('is-hidden', !sending);
  $('send-button').disabled = sending || (!$('composer').value.trim() && !pendingAttachments.length);
  renderAttachmentTray();
}

function renderAttachmentTray() {
  const root = $('attachment-tray'); root.replaceChildren();
  for (const attachment of pendingAttachments) {
    const preview = node('div', 'attachment-preview');
    if (attachment.preview) { const image = node('img', 'attachment-thumb'); image.src = attachment.preview; image.alt = ''; preview.append(image); }
    else { const icon = node('span', 'attachment-file-icon'); icon.append(svg('file')); preview.append(icon); }
    const copy = node('span', 'attachment-copy'); copy.append(node('strong', '', attachment.name), node('small', '', `${formatBytes(attachment.bytes)} · Ready`));
    const remove = node('button', 'attachment-remove'); remove.setAttribute('aria-label', `Remove ${attachment.name}`); remove.append(svg('close')); remove.onclick = () => { pendingAttachments = pendingAttachments.filter(item => item.id !== attachment.id); renderComposer(); };
    preview.append(copy, remove); root.append(preview);
  }
}

function renderHeader() {
  const title = state.activeConversation?.title || 'New conversation'; $('conversation-title').textContent = title; $('window-title').textContent = title; document.title = `${title} · LLera`;
  $('mode-label').textContent = state.settings.mode === 'work' ? 'Work' : 'Chat';
}

function missionProgress(mission) { const steps = mission?.steps || []; return steps.length ? Math.round((steps.filter(step => step.status === 'completed').length / steps.length) * 100) : 0; }
function renderWorkspace() {
  const missions = state.missions || []; const evidence = (state.activity || []).filter(item => /evidence/i.test(item.type)).slice(0, 4);
  const active = missions.filter(item => ['running', 'pending', 'interrupted'].includes(item.status));
  const pending = missions.filter(item => ['pending', 'interrupted'].includes(item.status));
  const summary = $('summary-strip'); summary.replaceChildren();
  const values = [['ACTIVE MISSIONS', active.length || '—', active.length ? `${active.length} in progress` : 'Unavailable'], ['PENDING VERIFICATIONS', pending.length || '—', pending.length ? 'Requires review' : 'Unavailable'], ['EVIDENCE ITEMS', evidence.length || '—', evidence.length ? 'In current activity' : 'Unavailable'], ['OUTCOME MEMORY', '—', 'Unavailable'], ['SYSTEM HEALTH', state.runtime?.state === 'ready' ? 'Ready' : '—', state.runtime?.state === 'ready' ? 'Local runtime ready' : 'Unavailable']];
  for (const [label, value, detail] of values) { const item = node('div', 'summary-item'); item.append(node('small', '', label), node('strong', '', value), node('span', '', detail)); summary.append(item); }
  const list = $('mission-list'); list.replaceChildren();
  if (!missions.length) list.append(node('p', 'context-empty', 'No active missions. Start Work Mode to create one.'));
  missions.slice(0, 6).forEach((mission, index) => { const card = node('button', `mission-card${mission.id === selectedMissionId ? ' selected' : ''}`); card.type = 'button'; const head = node('div', 'mission-card-head'); head.append(node('span', 'mission-number', index + 1), node('strong', '', mission.title), node('span', 'mission-status', String(mission.status || 'pending').toUpperCase())); const progress = missionProgress(mission); const bar = node('div', 'mission-progress'); const fill = node('i'); fill.style.width = `${progress}%`; bar.append(fill); card.append(head, node('p', '', mission.goal || 'No goal recorded.'), bar); card.onclick = () => { selectedMissionId = mission.id; renderWorkspace(); openDrawer('mission', mission); }; list.append(card); });
  const selected = missions.find(item => item.id === selectedMissionId) || active[0] || missions[0]; const context = $('mission-context'); context.replaceChildren();
  if (selected) { const progress = missionProgress(selected); context.append(node('div', 'context-title', selected.title), node('div', 'context-meta', `${String(selected.status || 'pending').toUpperCase()} · ${progress}% complete`)); const bar = node('div', 'mission-progress'); const fill = node('i'); fill.style.width = `${progress}%`; bar.append(fill); context.append(bar); const details = node('button', 'text-action', 'View details →'); details.onclick = () => openDrawer('mission', selected); context.append(details); } else context.append(node('p', 'context-empty', 'No mission selected.'));
  const evidenceRoot = $('key-evidence'); evidenceRoot.replaceChildren(); if (!evidence.length) evidenceRoot.append(node('p', 'context-empty', 'No evidence is available for this workspace.')); else evidence.forEach(item => { const row = node('div', 'evidence-row'); row.append(node('span', '', item.summary || item.type), node('small', '', item.at ? formatTime(item.at) : '')); evidenceRoot.append(row); });
  const health = $('system-health'); health.replaceChildren(); const healthItems = [['Evidence Chain', evidence.length ? 'ACTIVE' : 'Unavailable'], ['Verifier (Strict)', 'Unavailable'], ['Verifier (Adversarial)', 'Unavailable'], ['Failure Doctrine', 'Unavailable'], ['Outcome Memory', 'Unavailable']]; healthItems.forEach(([label, status]) => { const row = node('div', 'health-row'); row.append(node('span', '', label), node('span', status === 'Unavailable' ? '' : 'health-state', status)); health.append(row); });
}

function renderAll() { applySettings(); renderSidebar(); renderHeader(); renderWorkspace(); renderMessages(); renderComposer(); if (drawerKind) renderDrawer(drawerKind); }

function fillComposer(value) { $('composer').value = value; resizeComposer(); $('composer').focus(); renderComposer(); }
function resizeComposer() { const input = $('composer'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 190)}px`; }

async function sendMessage() {
  if (sending || composingIME) return;
  const content = $('composer').value; if (!content.trim() && !pendingAttachments.length) return;
  if (state.settings.mode === 'work' && !(state.missions || []).some(item => ['running', 'pending'].includes(item.status))) {
    state = await window.llera.createMission({ title: content, goal: content });
  }
  const attachmentIds = pendingAttachments.map(item => item.id); $('composer').value = ''; pendingAttachments = []; resizeComposer(); sending = true; renderAll(); announce('LLera is working.');
  try { const result = await window.llera.sendMessage({ content, attachmentIds, model: selectedModel }); state = result.snapshot; if (result.blocked) announce('The response needs attention.'); else announce('Response complete.'); }
  catch (error) { toast(error.message || 'Message could not be sent.'); state = await window.llera.snapshot(); }
  finally { sending = false; renderAll(); }
}

async function stopGeneration() { await window.llera.stopGeneration(); toast('Stopping…'); }

async function addFiles(files) {
  for (const file of [...files].slice(0, 8 - pendingAttachments.length)) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); const added = await window.llera.addAttachment({ name: file.name || `Pasted image ${new Date().toLocaleTimeString()}.png`, type: file.type || 'image/png', bytes });
      if (file.type.startsWith('image/')) added.preview = URL.createObjectURL(file); pendingAttachments.push(added);
    } catch (error) { toast(error.message || `Couldn't add ${file.name}.`); }
  }
  renderComposer(); announce(`${pendingAttachments.length} attachment${pendingAttachments.length === 1 ? '' : 's'} ready.`);
}

function positionPopover(popover, anchor, align = 'left') {
  const rect = anchor.getBoundingClientRect(); const height = popover.offsetHeight || 150;
  const below = rect.bottom + height + 10 <= innerHeight;
  popover.style.top = `${Math.max(8, below ? rect.bottom + 8 : rect.top - height - 8)}px`;
  popover.style.left = `${align === 'right' ? Math.max(8, rect.right - popover.offsetWidth) : Math.min(innerWidth - popover.offsetWidth - 8, rect.left)}px`;
}
function closePopovers() { document.querySelectorAll('.popover.open').forEach(item => { item.classList.remove('open'); item.setAttribute('aria-hidden', 'true'); }); }

function openModelPicker() {
  closePopovers(); const menu = $('model-menu'); const list = $('model-list'); list.replaceChildren();
  if (!state.models?.length) { const empty = node('div', 'popover-head'); empty.append(node('strong', '', 'Henüz model eklenmedi'), node('span', '', 'Bilgisayarınızdaki .gguf uzantılı modeli seçin.')); const add = node('button', 'model-import-action', 'GGUF model içe aktar'); add.onclick = async () => { state = await window.llera.importModel(); selectedModel = state.settings.defaultModel; renderAll(); closePopovers(); }; list.append(empty, add); }
  for (const model of state.models || []) {
    const button = node('button', 'model-option'); button.append(node('span', 'status-dot'));
    const copy = node('span', 'model-option-copy'); copy.append(node('strong', '', model.name), node('small', '', `${model.local ? 'Local' : 'Cloud'}${model.vision ? ' · Vision' : ''}${model.context ? ` · ${model.context} context` : ''}`)); button.append(copy);
    button.onclick = async () => { selectedModel = model.id; state = await window.llera.updateSettings({ defaultModel: model.id }); closePopovers(); renderAll(); };
    list.append(button);
  }
  menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); positionPopover(menu, $('model-picker-open'));
}

async function setMode(mode) { state = await window.llera.updateSettings({ mode }); closePopovers(); renderAll(); if (mode === 'work') { fillComposer($('composer').value || ''); toast('Work mode is ready. Describe the outcome.'); } }
function openModeMenu() { closePopovers(); const menu = $('mode-menu'); menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); positionPopover(menu, $('mode-switch')); }

function openConversationMenu(anchor, conversation) {
  closePopovers(); const menu = $('conversation-menu'); menu.replaceChildren();
  const actions = [
    [conversation.pinned ? 'Unpin' : 'Pin', async () => { state = await window.llera.pinConversation({ id: conversation.id, pinned: !conversation.pinned }); renderAll(); }],
    ['Rename', async () => { closePopovers(); openRename(conversation); }],
    ['Delete', () => openConfirm(`Delete “${conversation.title}”?`, 'This removes the conversation from this computer.', async () => { state = await window.llera.deleteConversation(conversation.id); renderAll(); toast('Conversation deleted'); }), true],
  ];
  for (const [label, action, danger] of actions) { const button = node('button', danger ? 'danger-menu' : '', label); button.onclick = async () => { closePopovers(); await action(); }; menu.append(button); }
  menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); positionPopover(menu, anchor, 'right');
}

function openRename(conversation) { focusBeforeModal = document.activeElement; renameConversationTarget = conversation; $('rename-input').value = conversation.title; $('rename-dialog').classList.add('open'); $('rename-dialog').setAttribute('aria-hidden', 'false'); setTimeout(() => { $('rename-input').focus(); $('rename-input').select(); }, 0); }
function closeRename() { $('rename-dialog').classList.remove('open'); $('rename-dialog').setAttribute('aria-hidden', 'true'); renameConversationTarget = null; focusBeforeModal?.focus?.(); }

function openConfirm(title, copy, action) { focusBeforeModal = document.activeElement; confirmAction = action; $('confirm-title').textContent = title; $('confirm-copy').textContent = copy; $('confirm-dialog').classList.add('open'); $('confirm-dialog').setAttribute('aria-hidden', 'false'); $('confirm-cancel').focus(); }
function closeConfirm() { $('confirm-dialog').classList.remove('open'); $('confirm-dialog').setAttribute('aria-hidden', 'true'); confirmAction = null; focusBeforeModal?.focus?.(); }

function openDrawer(kind, payload = null) { drawerKind = kind; $('app').classList.add('drawer-open'); $('context-drawer').classList.add('open'); $('context-drawer').setAttribute('aria-hidden', 'false'); if (innerWidth <= 1180) $('drawer-scrim').classList.add('visible'); renderDrawer(kind, payload); setTimeout(() => $('drawer-close').focus(), 0); }
function closeDrawer() { drawerKind = null; $('app').classList.remove('drawer-open'); $('context-drawer').classList.remove('open'); $('context-drawer').setAttribute('aria-hidden', 'true'); $('drawer-scrim').classList.remove('visible'); }

function renderDrawer(kind, payload = null) {
  const root = $('drawer-body'); root.replaceChildren(); $('drawer-eyebrow').textContent = kind === 'settings' ? 'Preferences' : kind === 'mission' ? 'Current task' : kind === 'models' ? 'Runtime' : 'Workspace';
  if (kind === 'settings') { $('drawer-title').textContent = 'Settings'; renderSettings(root); }
  else if (kind === 'mission') { const mission = payload || (state.missions || []).find(item => ['running', 'pending', 'interrupted'].includes(item.status)); $('drawer-title').textContent = mission?.title || 'Task'; renderMission(root, mission); }
  else if (kind === 'models') { $('drawer-title').textContent = 'Models'; renderModels(root); }
  else if (kind === 'evidence') { $('drawer-title').textContent = 'Evidence'; renderEvidence(root); }
  else { $('drawer-title').textContent = 'Activity'; renderActivity(root); }
}

function renderMission(root, mission) {
  if (!mission) { root.append(node('p', '', 'No active task. Switch to Work and describe an outcome to begin.')); return; }
  const summary = node('section', 'drawer-section'); summary.append(node('h3', '', 'Goal'), node('p', '', mission.goal));
  const progress = node('section', 'drawer-section'); progress.append(node('h3', '', 'Plan'));
  for (const step of mission.steps || []) { const row = node('div', 'activity-row'); row.append(node('span', `activity-dot${step.status === 'completed' ? ' success' : step.status === 'failed' ? ' warning' : ''}`)); const copy = node('div', 'activity-copy'); copy.append(node('strong', '', step.name), node('small', '', step.status)); row.append(copy); progress.append(row); }
  root.append(summary, progress);
}

function renderActivity(root) {
  const filter = node('div', 'segmented'); ['All', 'Files', 'Runtime', 'Verification'].forEach((label, index) => { const button = node('button', index === 0 ? 'active' : '', label); button.onclick = () => { [...filter.children].forEach(child => child.classList.remove('active')); button.classList.add('active'); renderActivityRows(root, label.toLowerCase(), filter); }; filter.append(button); }); root.append(filter); renderActivityRows(root, 'all', filter);
}
function renderActivityRows(root, filter, anchor) {
  root.querySelector('.activity-list')?.remove(); const list = node('div', 'activity-list drawer-section');
  let items = state.activity || []; if (filter === 'files') items = items.filter(item => item.type.includes('attachment')); if (filter === 'runtime') items = items.filter(item => item.type.includes('runtime') || item.type.includes('message')); if (filter === 'verification') items = items.filter(item => item.type.includes('evidence'));
  for (const item of items.slice(0, state.settings.activityDensity === 'compact' ? 20 : state.settings.activityDensity === 'detailed' ? 150 : 60)) { const row = node('div', 'activity-row'); const dot = node('span', `activity-dot${item.type.includes('completed') || item.type.includes('ready') || item.type.includes('verified') ? ' success' : item.type.includes('failed') || item.type.includes('blocked') ? ' warning' : ''}`); const copy = node('div', 'activity-copy'); copy.append(node('strong', '', item.summary), node('small', '', formatTime(item.at))); row.append(dot, copy); list.append(row); }
  if (!items.length) list.append(node('p', '', 'No activity in this category.')); anchor.after(list);
}

function renderModels(root) {
  if (!state.models.length) { root.append(node('h3', '', 'Choose a local model to start'), node('p', '', 'LLera did not find a configured model. Add a valid model entry and GGUF file to the local runtime, then restart the app.')); return; }
  for (const model of state.models) { const section = node('section', 'drawer-section'); section.append(node('h3', '', model.name)); [['Location', 'This computer'], ['Status', state.runtime.model === model.id && state.runtime.state === 'ready' ? 'Ready' : 'Available'], ['Vision', model.vision ? 'Supported' : 'Not declared'], ['Context', model.context || 'Not declared']].forEach(([label, value]) => { const row = node('div', 'detail-row'); row.append(node('span', '', label), node('strong', '', value)); section.append(row); }); root.append(section); }
}

function renderEvidence(root) {
  const items = (state.activity || []).filter(item => item.type === 'evidence.verified'); if (!items.length) { root.append(node('p', '', 'No verified evidence is attached to this conversation.')); return; }
  for (const item of items) { const section = node('section', 'drawer-section'); section.append(node('h3', '', 'Verified'), node('p', '', item.summary)); const row = node('div', 'detail-row'); row.append(node('span', '', 'Time'), node('strong', '', new Date(item.at).toLocaleString())); section.append(row); root.append(section); }
}

function renderSettings(root) {
  const general = node('section', 'setting-group'); general.append(node('label', '', 'Appearance'));
  const themes = node('div', 'segmented'); ['system', 'dark', 'light'].forEach(value => { const button = node('button', state.settings.theme === value ? 'active' : '', value[0].toUpperCase() + value.slice(1)); button.onclick = async () => { state = await window.llera.updateSettings({ theme: value }); renderAll(); }; themes.append(button); }); general.append(themes);
  const densityGroup = node('section', 'setting-group'); densityGroup.append(node('label', '', 'Activity detail')); const density = node('div', 'segmented'); ['compact', 'balanced', 'detailed'].forEach(value => { const button = node('button', state.settings.activityDensity === value ? 'active' : '', value[0].toUpperCase() + value.slice(1)); button.onclick = async () => { state = await window.llera.updateSettings({ activityDensity: value }); renderAll(); }; density.append(button); }); densityGroup.append(density);
  const layout = node('section', 'setting-group'); layout.append(node('label', '', 'Çalışma alanı')); [['showSummary', 'Üst özet şeridi'], ['showContext', 'Sağ bağlam paneli']].forEach(([key, label]) => { const row = node('button', 'layout-toggle'); row.append(node('span', '', label), node('strong', '', state.settings[key] ? 'Açık' : 'Kapalı')); row.onclick = async () => { state = await window.llera.updateSettings({ [key]: !state.settings[key] }); renderAll(); }; layout.append(row); });
  const advanced = node('section', 'drawer-section'); advanced.append(node('h3', '', 'Advanced')); [['Runtime', state.runtime.state], ['Version', identity?.version || 'Unknown'], ['Processing', 'Local']].forEach(([label, value]) => { const row = node('div', 'detail-row'); row.append(node('span', '', label), node('strong', '', value)); advanced.append(row); });
  root.append(general, densityGroup, layout, advanced);
}

function fuzzyMatch(value, query) { let cursor = 0; const text = value.toLowerCase(); for (const char of query.toLowerCase()) { cursor = text.indexOf(char, cursor); if (cursor < 0) return false; cursor += 1; } return true; }
function commands() { return [
  { title: 'New chat', detail: 'Start a clean conversation', icon: 'plus', shortcut: 'Ctrl N', action: newChat },
  { title: 'Start Work', detail: 'Create a goal-driven task', icon: 'spark', action: () => setMode('work') },
  { title: 'Attach file', detail: 'Add an image, text file, or PDF', icon: 'attach', action: () => $('file-input').click() },
  { title: 'Select model', detail: 'Choose a local model', icon: 'spark', action: openModelPicker },
  { title: 'Open activity', detail: 'See recent workspace events', icon: 'more', action: () => openDrawer('activity') },
  { title: 'Show evidence', detail: 'Review verified outcomes', icon: 'check', action: () => openDrawer('evidence') },
  { title: 'Open settings', detail: 'Appearance, models, and advanced', icon: 'settings', action: () => openDrawer('settings') },
  { title: 'Toggle sidebar', detail: 'Show or hide conversation history', icon: 'panel', action: toggleSidebar },
]; }

async function openPalette() { focusBeforeModal = document.activeElement; closePopovers(); $('palette').classList.add('open'); $('palette').setAttribute('aria-hidden', 'false'); $('palette-input').value = ''; paletteIndex = 0; await renderPalette(''); $('palette-input').focus(); }
function closePalette() { $('palette').classList.remove('open'); $('palette').setAttribute('aria-hidden', 'true'); focusBeforeModal?.focus?.(); }
async function renderPalette(query) {
  const base = commands().filter(item => fuzzyMatch(`${item.title} ${item.detail}`, query)); const search = query.trim().length > 1 ? await window.llera.search(query) : { conversations: [], missions: [] };
  paletteItems = [...base, ...search.conversations.map(item => ({ title: item.title, detail: 'Conversation', icon: 'search', action: async () => { state = await window.llera.selectConversation(item.id); renderAll(); } })), ...search.missions.map(item => ({ title: item.title, detail: `Task · ${item.status}`, icon: 'spark', action: () => openDrawer('mission', state.missions.find(mission => mission.id === item.id)) }))]; paletteIndex = Math.min(paletteIndex, Math.max(0, paletteItems.length - 1));
  const root = $('palette-results'); root.replaceChildren(); root.append(node('div', 'palette-group-label', query ? 'Results' : 'Commands'));
  paletteItems.forEach((item, index) => { const button = node('button', `palette-result${index === paletteIndex ? ' active' : ''}`); button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(index === paletteIndex)); button.append(svg(item.icon)); const copy = node('span', 'palette-result-copy'); copy.append(node('strong', '', item.title), node('small', '', item.detail)); button.append(copy); if (item.shortcut) button.append(node('kbd', '', item.shortcut)); button.onclick = () => activatePalette(index); root.append(button); });
  if (!paletteItems.length) root.append(node('div', 'palette-group-label', 'No matches'));
}
async function activatePalette(index = paletteIndex) { const item = paletteItems[index]; if (!item) return; closePalette(); await item.action(); }

async function newChat() { state = await window.llera.newConversation(); pendingAttachments = []; renderAll(); $('composer').focus(); }
async function toggleSidebar() { if (innerWidth <= 780) { $('app').classList.toggle('sidebar-mobile-open'); $('drawer-scrim').classList.toggle('visible', $('app').classList.contains('sidebar-mobile-open')); return; } state = await window.llera.updateSettings({ sidebarCollapsed: !state.settings.sidebarCollapsed }); renderAll(); }
function closeMobileSidebar() { $('app').classList.remove('sidebar-mobile-open'); if (!drawerKind) $('drawer-scrim').classList.remove('visible'); }

function bindEvents() {
  $('command-open').onclick = openPalette;
  $('settings-header-open').onclick = () => openDrawer('settings');
  $('open-evidence').onclick = () => openDrawer('evidence');
  $('all-missions').onclick = () => openDrawer('mission');
  $('new-mission').onclick = async () => { await setMode('work'); fillComposer(''); };
  document.querySelectorAll('.product-nav button').forEach(button => button.onclick = () => { if (button.dataset.section === 'evidence') openDrawer('evidence'); else if (button.dataset.section === 'health') openDrawer('activity'); else if (button.dataset.section === 'missions') openDrawer('mission'); else if (button.dataset.section !== 'workspace') toast(`${button.textContent} is available when local data exists.`); });
  $('new-chat').onclick = newChat; $('search-open').onclick = openPalette; $('settings-open').onclick = () => openDrawer('settings'); $('context-open').onclick = () => openDrawer('activity'); $('drawer-close').onclick = closeDrawer; $('drawer-scrim').onclick = () => { closeDrawer(); closeMobileSidebar(); }; $('sidebar-toggle').onclick = toggleSidebar;
  $('mode-switch').onclick = openModeMenu; document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
  $('model-picker-open').onclick = openModelPicker; $('send-button').onclick = sendMessage; $('stop-button').onclick = stopGeneration;
  $('file-input').onchange = event => { addFiles(event.target.files); event.target.value = ''; };
  $('composer').addEventListener('input', () => { resizeComposer(); renderComposer(); }); $('composer').addEventListener('compositionstart', () => { composingIME = true; }); $('composer').addEventListener('compositionend', () => { composingIME = false; });
  $('composer').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !composingIME) { event.preventDefault(); sendMessage(); } });
  $('composer').addEventListener('paste', event => { const images = [...event.clipboardData.items].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean); if (images.length) { event.preventDefault(); addFiles(images); } });
  window.addEventListener('dragenter', event => { if ([...event.dataTransfer.types].includes('Files')) { dragDepth += 1; $('drop-zone').classList.add('visible'); $('composer-surface').classList.add('drag-target'); } });
  window.addEventListener('dragleave', () => { dragDepth -= 1; if (dragDepth <= 0) { dragDepth = 0; $('drop-zone').classList.remove('visible'); $('composer-surface').classList.remove('drag-target'); } });
  window.addEventListener('dragover', event => event.preventDefault()); window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('drop-zone').classList.remove('visible'); $('composer-surface').classList.remove('drag-target'); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
  $('palette-input').addEventListener('input', event => renderPalette(event.target.value)); $('palette-input').addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); paletteIndex = (paletteIndex + 1) % Math.max(1, paletteItems.length); renderPalette(event.currentTarget.value); } else if (event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = (paletteIndex - 1 + Math.max(1, paletteItems.length)) % Math.max(1, paletteItems.length); renderPalette(event.currentTarget.value); } else if (event.key === 'Enter') { event.preventDefault(); activatePalette(); } });
  $('palette').addEventListener('mousedown', event => { if (event.target === $('palette')) closePalette(); });
  $('confirm-cancel').onclick = closeConfirm; $('confirm-accept').onclick = async () => { const action = confirmAction; closeConfirm(); await action?.(); };
  $('rename-cancel').onclick = closeRename; $('rename-accept').onclick = async () => { const title = $('rename-input').value.trim(); const target = renameConversationTarget; if (!title || !target) return; closeRename(); state = await window.llera.renameConversation({ id: target.id, title }); renderAll(); toast('Conversation renamed'); };
  $('rename-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('rename-accept').click(); } });
  document.querySelectorAll('[data-window]').forEach(button => button.onclick = () => window.llera.windowAction(button.dataset.window));
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.popover') && !event.target.closest('#model-picker-open') && !event.target.closest('#mode-switch') && !event.target.closest('.conversation-more')) closePopovers(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPalette(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && !event.shiftKey) { event.preventDefault(); newChat(); }
    else if (event.key === 'Escape') { if ($('palette').classList.contains('open')) closePalette(); else if ($('confirm-dialog').classList.contains('open')) closeConfirm(); else if ($('rename-dialog').classList.contains('open')) closeRename(); else if (drawerKind) closeDrawer(); else closePopovers(); }
    else if (event.key === 'Tab') trapModalFocus(event);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.settings.theme === 'system') applySettings(); });
  window.llera.onEvent(async event => {
    if (event.type === 'message.delta') {
      const message = state.activeConversation?.messages?.find(item => item.id === event.detail.messageId); if (message) message.content += event.detail.delta;
      const content = document.querySelector(`[data-message-id="${event.detail.messageId}"] .message-content`); if (content) content.insertBefore(document.createTextNode(event.detail.delta), content.querySelector('.streaming-caret'));
      const transcript = $('transcript'); if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120) transcript.scrollTop = transcript.scrollHeight;
      return;
    }
    if (['runtime.starting', 'runtime.ready', 'runtime.failed', 'message.started', 'message.completed', 'message.failed', 'message.blocked', 'mission.created'].includes(event.type)) { state = await window.llera.snapshot(); renderAll(); }
  });
}

function trapModalFocus(event) {
  const layer = [...document.querySelectorAll('.modal-layer.open')].at(-1); if (!layer) return;
  const focusable = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]; if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

async function boot() {
  [identity, state] = await Promise.all([window.llera.identity(), window.llera.snapshot()]);
  selectedModel = state.settings.defaultModel || state.models?.[0]?.id || null;
  bindEvents(); renderAll(); resizeComposer();
}

boot().catch(error => { document.body.replaceChildren(node('div', 'empty-state', `LLera couldn't open: ${error.message || error}`)); });
