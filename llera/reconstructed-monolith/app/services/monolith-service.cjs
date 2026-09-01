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
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeRead(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; } }
function atomicWrite(file, value) { const tmp = `${file}.${process.pid}.${Date.now()}.tmp`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
function messageId() { return `msg_${crypto.randomBytes(10).toString('hex')}`; }

class MonolithService {
  constructor({ userData, runtimeRoot = null, now = () => new Date().toISOString() } = {}) {
    if (!userData) throw new Error('userData is required');
    this.userData = path.resolve(userData); this.now = now;
    this.stateFile = path.join(this.userData, 'product-state.json');
    this.missionFile = path.join(this.userData, 'missions.json');
    this.state = safeRead(this.stateFile, { schema: 1, conversations: [], activeConversationId: null, activity: [], attachments: [] });
    this.missions = new MissionEngine({ load: async () => safeRead(this.missionFile, null), save: async value => atomicWrite(this.missionFile, value) });
    this.runtimeRoot = runtimeRoot || path.join(this.userData, 'runtime');
    this.catalog = safeRead(path.join(this.runtimeRoot, 'models.json'), {});
    this.backend = new LlamaCppProcessBackend({ runtimeRoot: this.runtimeRoot, modelCatalog: this.catalog });
    this.runtime = new RuntimeLifecycle({ start: args => this.backend.start(args), stop: args => this.backend.stop(args), health: () => this.backend.health(), isAlive: args => this.backend.isAlive(args) });
  }
  async init() { await this.missions.init(); return this.snapshot(); }
  _save() { atomicWrite(this.stateFile, this.state); }
  _activity(type, summary, detail = {}) { this.state.activity.unshift({ id: `act_${crypto.randomBytes(7).toString('hex')}`, type, summary, detail, at: this.now() }); this.state.activity.splice(80); }
  _active() { return this.state.conversations.find(x => x.id === this.state.activeConversationId) || null; }
  _ensureConversation(title = 'New conversation') { let c = this._active(); if (c) return c; c = { id: `conv_${crypto.randomBytes(9).toString('hex')}`, title, createdAt: this.now(), updatedAt: this.now(), messages: [] }; this.state.conversations.unshift(c); this.state.activeConversationId = c.id; return c; }
  snapshot() { const r = this.runtime.snapshot(); return clone({ conversations: this.state.conversations.map(({ messages, ...c }) => ({ ...c, preview: messages.at(-1)?.content?.slice(0, 72) || 'Empty conversation', messageCount: messages.length })), activeConversation: this._active(), activity: this.state.activity, attachments: this.state.attachments, missions: this.missions.listMissions(), runtime: r, models: Object.keys(this.catalog).map(id => ({ id, configured: true })), runtimeConfigured: Object.keys(this.catalog).length > 0, notice: Object.keys(this.catalog).length ? null : 'No local model is configured. Add a model through the desktop runtime directory before starting inference.' }); }
  async createConversation() { this.state.activeConversationId = null; const c = this._ensureConversation(); this._activity('conversation', 'Created a new conversation'); this._save(); return this.snapshot(); }
  async selectConversation(id) { if (!this.state.conversations.some(c => c.id === id)) throw new Error('conversation not found'); this.state.activeConversationId = id; this._save(); return this.snapshot(); }
  async attach({ name, type, bytes }) { const data = Buffer.from(bytes || []); if (!name || typeof name !== 'string' || name.length > 180) throw new Error('attachment name is invalid'); if (!ALLOWED_MIME.has(type)) throw new Error('attachment type is not supported'); if (!data.length || data.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment size is invalid'); const id = `att_${crypto.randomBytes(9).toString('hex')}`; const dir = path.join(this.userData, 'attachments'); fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, id); fs.writeFileSync(file, data, { mode: 0o600, flag: 'wx' }); const item = { id, name: path.basename(name), type, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), createdAt: this.now() }; this.state.attachments.push(item); this._activity('attachment', `Attached ${item.name}`, { attachmentId: id }); this._save(); return clone(item); }
  async send({ content, attachmentIds = [], model = null }) { const text = String(content || '').trim(); if (!text && !attachmentIds.length) throw new Error('message is empty'); const attached = attachmentIds.map(id => this.state.attachments.find(x => x.id === id)).filter(Boolean); if (attached.length !== attachmentIds.length) throw new Error('attachment not found'); const conversation = this._ensureConversation(text.slice(0, 56) || 'Attachment'); const user = { id: messageId(), role: 'user', content: text, attachments: attached, createdAt: this.now() }; conversation.messages.push(user); conversation.updatedAt = user.createdAt; if (conversation.title === 'New conversation' && text) conversation.title = text.slice(0, 56);
    if (!Object.keys(this.catalog).length) { const blocked = { id: messageId(), role: 'system', status: 'blocked', content: 'Inference is blocked because no local model is configured. This message was saved, but no response was generated.', createdAt: this.now() }; conversation.messages.push(blocked); this._activity('blocked', 'Inference blocked: no local model configured'); this._save(); return { blocked: true, code: 'MODEL_NOT_CONFIGURED', snapshot: this.snapshot() }; }
    const selected = model || Object.keys(this.catalog)[0]; try { if (this.runtime.snapshot().state !== 'ready' || this.runtime.snapshot().model !== selected) await this.runtime.start(selected); } catch (error) { const blocked = { id: messageId(), role: 'system', status: 'blocked', content: `Inference could not start: ${String(error.message || error)}`, createdAt: this.now() }; conversation.messages.push(blocked); this._activity('blocked', 'Runtime start failed', { code: error.code || null }); this._save(); return { blocked: true, code: error.code || 'RUNTIME_START_FAILED', snapshot: this.snapshot() }; }
    try {
      const completion = await this.backend.chatCompletion({
        messages: conversation.messages
          .filter(message => ['system', 'user', 'assistant'].includes(message.role))
          .map(message => ({ role: message.role, content: message.content })),
      });
      const assistant = { id: messageId(), role: 'assistant', content: completion.content, model: completion.model || selected, usage: completion.usage, finishReason: completion.finishReason, createdAt: this.now() };
      conversation.messages.push(assistant); this._activity('inference', 'Local model completed a response', { model: assistant.model, finishReason: assistant.finishReason }); this._save();
      return { blocked: false, snapshot: this.snapshot() };
    } catch (error) {
      const blocked = { id: messageId(), role: 'system', status: 'blocked', content: `Inference failed safely: ${String(error.message || error)}`, createdAt: this.now() };
      conversation.messages.push(blocked); this._activity('blocked', 'Inference request failed', { code: error.code || null }); this._save();
      return { blocked: true, code: error.code || 'INFERENCE_FAILED', snapshot: this.snapshot() };
    }
  }
  async createMission({ title, goal }) { const mission = await this.missions.createMission({ title: String(title || goal || '').slice(0, 120), goal: String(goal || '').slice(0, 2000), steps: ['Define evidence boundary'] }); this._activity('mission', `Created mission: ${mission.title}`, { missionId: mission.id }); this._save(); return this.snapshot(); }
  async recordEvidence({ missionId, stepId, summary }) { const ledger = new EvidenceLedger({ missionId, storagePath: path.join(this.userData, 'evidence', `${missionId}.json`) }); const entry = ledger.add({ stepId, tool: 'desktop-ui', kind: 'observation', target: 'user-action', bytes: summary, summary }); this._activity('evidence', `Recorded evidence for ${missionId}`, { evidenceId: entry.id }); this._save(); return entry; }
}
module.exports = { MonolithService, MAX_ATTACHMENT_BYTES, ALLOWED_MIME };
