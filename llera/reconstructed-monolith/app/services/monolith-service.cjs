'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MissionEngine } = require('../../src/mission-engine');
const { EvidenceLedger } = require('../../src/evidence-ledger');
const { RuntimeLifecycle } = require('../../src/runtime-lifecycle');
const { LlamaCppProcessBackend } = require('../../src/llama-cpp-process-backend');

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf']);
const DEFAULT_SETTINGS = Object.freeze({ theme: 'system', activityDensity: 'balanced', sidebarCollapsed: false, mode: 'chat', textScale: 1, motion: true, defaultModel: null });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeRead(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return clone(fallback); } }
function atomicWrite(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
function id(prefix) { return `${prefix}_${crypto.randomBytes(10).toString('hex')}`; }
function titleFrom(text) { return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 58) || 'Untitled conversation'; }

class MonolithService {
  constructor({ userData, runtimeRoot = null, now = () => new Date().toISOString(), onEvent = () => {} } = {}) {
    if (!userData) throw new Error('userData is required');
    this.userData = path.resolve(userData); this.now = now; this.onEvent = onEvent;
    this.stateFile = path.join(this.userData, 'product-state.json');
    this.missionFile = path.join(this.userData, 'missions.json');
    const persisted = safeRead(this.stateFile, {});
    this.state = {
      schema: 2,
      conversations: Array.isArray(persisted.conversations) ? persisted.conversations : [],
      activeConversationId: persisted.activeConversationId || null,
      activity: Array.isArray(persisted.activity) ? persisted.activity : [],
      attachments: Array.isArray(persisted.attachments) ? persisted.attachments : [],
      settings: { ...DEFAULT_SETTINGS, ...(persisted.settings || {}) },
    };
    this.missions = new MissionEngine({ load: async () => safeRead(this.missionFile, null), save: async value => atomicWrite(this.missionFile, value) });
    this.runtimeRoot = runtimeRoot || path.join(this.userData, 'runtime');
    this.catalog = safeRead(path.join(this.runtimeRoot, 'models.json'), {});
    this.backend = new LlamaCppProcessBackend({ runtimeRoot: this.runtimeRoot, modelCatalog: this.catalog });
    this.runtime = new RuntimeLifecycle({ start: args => this.backend.start(args), stop: args => this.backend.stop(args), health: () => this.backend.health(), isAlive: args => this.backend.isAlive(args) });
    this.activeAbort = null;
  }

  async init() { await this.missions.init(); this._recoverInterruptedMessages(); return this.snapshot(); }
  _save() { atomicWrite(this.stateFile, this.state); }
  _emit(type, detail = {}) { const event = { id: id('evt'), type, detail: clone(detail), at: this.now() }; this.onEvent(event); return event; }
  _activity(type, summary, detail = {}) { const item = { id: id('act'), type, summary, detail: clone(detail), at: this.now() }; this.state.activity.unshift(item); this.state.activity.splice(200); this._emit(type, item); return item; }
  _active() { return this.state.conversations.find(item => item.id === this.state.activeConversationId) || null; }
  _recoverInterruptedMessages() { for (const conversation of this.state.conversations) for (const message of conversation.messages || []) if (message.status === 'streaming') { message.status = 'interrupted'; message.error = 'The response was interrupted. Your conversation is safe.'; } this._save(); }
  _ensureConversation(seed = '') { let conversation = this._active(); if (conversation) return conversation; conversation = { id: id('conv'), title: titleFrom(seed), pinned: false, createdAt: this.now(), updatedAt: this.now(), messages: [] }; this.state.conversations.unshift(conversation); this.state.activeConversationId = conversation.id; return conversation; }

  snapshot() {
    const runtime = this.runtime.snapshot();
    const active = this._active();
    return clone({
      conversations: this.state.conversations.map(({ messages = [], ...conversation }) => ({ ...conversation, preview: messages.at(-1)?.content?.slice(0, 90) || 'No messages yet', messageCount: messages.length })),
      activeConversation: active,
      activity: this.state.activity,
      attachments: this.state.attachments,
      missions: this.missions.listMissions(),
      runtime,
      models: Object.entries(this.catalog).map(([modelId, entry]) => ({ id: modelId, name: entry.name || modelId, vision: Boolean(entry.vision), context: entry.context || null, configured: true, local: true })),
      settings: this.state.settings,
      generating: Boolean(this.activeAbort),
      runtimeConfigured: Object.keys(this.catalog).length > 0,
      notice: Object.keys(this.catalog).length ? null : 'Choose a local model to start.',
    });
  }

  async createConversation() { this.state.activeConversationId = null; this._ensureConversation(); this._activity('conversation.created', 'New conversation'); this._save(); return this.snapshot(); }
  async selectConversation(conversationId) { if (!this.state.conversations.some(item => item.id === conversationId)) throw new Error('conversation not found'); this.state.activeConversationId = conversationId; this._save(); return this.snapshot(); }
  async renameConversation(conversationId, title) { const conversation = this.state.conversations.find(item => item.id === conversationId); if (!conversation) throw new Error('conversation not found'); conversation.title = titleFrom(title); conversation.updatedAt = this.now(); this._activity('conversation.renamed', `Renamed to ${conversation.title}`, { conversationId }); this._save(); return this.snapshot(); }
  async pinConversation(conversationId, pinned) { const conversation = this.state.conversations.find(item => item.id === conversationId); if (!conversation) throw new Error('conversation not found'); conversation.pinned = Boolean(pinned); conversation.updatedAt = this.now(); this._save(); return this.snapshot(); }
  async deleteConversation(conversationId) { const index = this.state.conversations.findIndex(item => item.id === conversationId); if (index < 0) throw new Error('conversation not found'); this.state.conversations.splice(index, 1); if (this.state.activeConversationId === conversationId) this.state.activeConversationId = this.state.conversations[0]?.id || null; this._activity('conversation.deleted', 'Conversation deleted'); this._save(); return this.snapshot(); }
  search(query) { const needle = String(query || '').trim().toLowerCase(); if (!needle) return { conversations: [], missions: [] }; const conversations = this.state.conversations.filter(item => `${item.title} ${(item.messages || []).map(message => message.content).join(' ')}`.toLowerCase().includes(needle)).slice(0, 30).map(item => ({ id: item.id, title: item.title, type: 'conversation' })); const missions = this.missions.listMissions().filter(item => `${item.title} ${item.goal}`.toLowerCase().includes(needle)).slice(0, 20).map(item => ({ id: item.id, title: item.title, type: 'mission', status: item.status })); return { conversations, missions }; }

  async updateSettings(input) { const allowed = ['theme', 'activityDensity', 'sidebarCollapsed', 'mode', 'textScale', 'motion', 'defaultModel']; for (const key of allowed) if (Object.hasOwn(input || {}, key)) this.state.settings[key] = input[key]; if (!['dark', 'light', 'system'].includes(this.state.settings.theme)) this.state.settings.theme = 'system'; if (!['compact', 'balanced', 'detailed'].includes(this.state.settings.activityDensity)) this.state.settings.activityDensity = 'balanced'; if (!['chat', 'work'].includes(this.state.settings.mode)) this.state.settings.mode = 'chat'; this.state.settings.textScale = Math.max(.9, Math.min(1.2, Number(this.state.settings.textScale) || 1)); this._save(); this._emit('settings.changed', this.state.settings); return this.snapshot(); }

  async attach({ name, type, bytes }) { const data = Buffer.from(bytes || []); if (!name || typeof name !== 'string' || name.length > 180) throw new Error('attachment name is invalid'); if (!ALLOWED_MIME.has(type)) throw new Error('attachment type is not supported'); if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment size is invalid'); const attachmentId = id('att'); const dir = path.join(this.userData, 'attachments'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, attachmentId), data, { mode: 0o600, flag: 'wx' }); const item = { id: attachmentId, name: path.basename(name), type, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), status: 'ready', createdAt: this.now() }; this.state.attachments.push(item); this._activity('attachment.ready', `${item.name} is ready`, { attachmentId }); this._save(); return clone(item); }

  async send({ content, attachmentIds = [], model = null }) {
    if (this.activeAbort) throw Object.assign(new Error('LLera is already responding'), { code: 'INFERENCE_ACTIVE' });
    const text = String(content || '').trim(); if (!text && !attachmentIds.length) throw new Error('message is empty');
    const attached = attachmentIds.map(attachmentId => this.state.attachments.find(item => item.id === attachmentId)).filter(Boolean); if (attached.length !== attachmentIds.length) throw new Error('attachment not found');
    const conversation = this._ensureConversation(text); const user = { id: id('msg'), role: 'user', content: text, attachments: attached, createdAt: this.now(), status: 'complete' }; conversation.messages.push(user); conversation.updatedAt = user.createdAt; if (conversation.messages.length === 1) conversation.title = titleFrom(text || attached[0]?.name); this._save(); this._emit('message.started', { conversationId: conversation.id, message: user });
    if (!Object.keys(this.catalog).length) return this._block(conversation, 'MODEL_NOT_CONFIGURED', 'Choose a local model to start.');
    const selected = model || this.state.settings.defaultModel || Object.keys(this.catalog)[0];
    try { if (this.runtime.snapshot().state !== 'ready' || this.runtime.snapshot().model !== selected) { this._emit('runtime.starting', { model: selected }); await this.runtime.start(selected); this._emit('runtime.ready', { model: selected }); } }
    catch (error) { this._emit('runtime.failed', { code: error.code || 'RUNTIME_START_FAILED' }); return this._block(conversation, error.code || 'RUNTIME_START_FAILED', "LLera couldn't start the local model. Open model details and try again."); }
    const assistant = { id: id('msg'), role: 'assistant', content: '', model: selected, createdAt: this.now(), status: 'streaming' }; conversation.messages.push(assistant); this.activeAbort = new AbortController(); this._save(); this._emit('message.started', { conversationId: conversation.id, message: assistant });
    try {
      const inputMessages = conversation.messages.filter(message => ['system', 'user', 'assistant'].includes(message.role) && message.id !== assistant.id).map(message => ({ role: message.role, content: message.content }));
      const completion = typeof this.backend.chatCompletionStream === 'function'
        ? await this.backend.chatCompletionStream({ messages: inputMessages, signal: this.activeAbort.signal, onDelta: delta => { assistant.content += delta; this._emit('message.delta', { conversationId: conversation.id, messageId: assistant.id, delta }); } })
        : await this.backend.chatCompletion({ messages: inputMessages, signal: this.activeAbort.signal });
      assistant.content = completion.content; assistant.model = completion.model || selected; assistant.usage = completion.usage; assistant.finishReason = completion.finishReason; assistant.status = 'complete'; assistant.completedAt = this.now(); conversation.updatedAt = assistant.completedAt; this._activity('message.completed', 'Response complete', { conversationId: conversation.id, messageId: assistant.id, model: assistant.model }); this._save(); this._emit('message.completed', { conversationId: conversation.id, message: assistant }); this.activeAbort = null; return { blocked: false, snapshot: this.snapshot() };
    } catch (error) {
      assistant.status = error.code === 'LLAMA_INFERENCE_ABORTED' ? 'stopped' : 'failed'; assistant.error = assistant.status === 'stopped' ? 'Response stopped.' : 'The local model could not complete this response.'; assistant.completedAt = this.now(); this._activity('message.failed', assistant.error, { code: error.code || 'INFERENCE_FAILED' }); this._save(); this._emit('message.failed', { conversationId: conversation.id, message: assistant, code: error.code || 'INFERENCE_FAILED' }); this.activeAbort = null; return { blocked: true, code: error.code || 'INFERENCE_FAILED', snapshot: this.snapshot() };
    } finally { this.activeAbort = null; }
  }

  async stopGeneration() { if (!this.activeAbort) return this.snapshot(); this.activeAbort.abort(); this._emit('message.stop.requested'); return this.snapshot(); }
  _block(conversation, code, content) { const message = { id: id('msg'), role: 'system', status: 'blocked', code, content, createdAt: this.now() }; conversation.messages.push(message); conversation.updatedAt = message.createdAt; this._activity('message.blocked', content, { code }); this._save(); this._emit('message.blocked', { conversationId: conversation.id, message }); return { blocked: true, code, snapshot: this.snapshot() }; }

  async createMission({ title, goal }) { const mission = await this.missions.createMission({ title: titleFrom(title || goal), goal: String(goal || '').slice(0, 2000), steps: ['Confirm scope', 'Execute work', 'Verify outcome'] }); this._activity('mission.created', `Task created: ${mission.title}`, { missionId: mission.id }); this._save(); this._emit('mission.created', { mission }); return this.snapshot(); }
  async recordEvidence({ missionId, stepId, summary }) { const ledger = new EvidenceLedger({ missionId, storagePath: path.join(this.userData, 'evidence', `${missionId}.json`) }); const entry = ledger.add({ stepId, tool: 'desktop-ui', kind: 'observation', target: 'user-action', bytes: summary, summary }); this._activity('evidence.verified', 'Outcome verified', { evidenceId: entry.id, missionId }); this._save(); return entry; }
}

module.exports = { MonolithService, MAX_ATTACHMENT_BYTES, ALLOWED_MIME, DEFAULT_SETTINGS };
