'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { MonolithService } = require('../app/services/monolith-service.cjs');

test('desktop product service persists conversations and fails closed without a model', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-service-'));
  const service = new MonolithService({ userData });
  await service.init();
  const created = await service.createConversation();
  assert.equal(created.conversations.length, 1);

  const result = await service.send({ content: 'Do not fabricate an answer.' });
  assert.equal(result.blocked, true);
  assert.equal(result.code, 'MODEL_NOT_CONFIGURED');
  assert.equal(result.snapshot.activeConversation.messages.length, 2);
  assert.equal(result.snapshot.activeConversation.messages[1].status, 'blocked');

  const restarted = new MonolithService({ userData });
  await restarted.init();
  assert.equal(restarted.snapshot().activeConversation.messages[0].content, 'Do not fabricate an answer.');
});

test('desktop product service binds attachment metadata to local bytes', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-attachment-'));
  const service = new MonolithService({ userData });
  await service.init();
  const attachment = await service.attach({ name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('local evidence') });
  assert.match(attachment.sha256, /^[a-f0-9]{64}$/);
  assert.equal(attachment.bytes, 14);
  await assert.rejects(() => service.attach({ name: 'bad.exe', type: 'application/octet-stream', bytes: Buffer.from('x') }));

  const restarted = new MonolithService({ userData });
  await restarted.init();
  assert.equal(restarted.snapshot().attachments[0].sha256, attachment.sha256);
});

test('desktop product service supports conversation organization and settings persistence', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-organize-'));
  const service = new MonolithService({ userData }); await service.init();
  let snapshot = await service.createConversation(); const id = snapshot.activeConversation.id;
  snapshot = await service.renameConversation(id, 'Precise local work');
  assert.equal(snapshot.activeConversation.title, 'Precise local work');
  snapshot = await service.pinConversation(id, true); assert.equal(snapshot.conversations[0].pinned, true);
  assert.equal(service.search('local').conversations[0].id, id);
  snapshot = await service.updateSettings({ theme: 'dark', activityDensity: 'detailed', sidebarCollapsed: true, mode: 'work' });
  assert.deepEqual({ theme: snapshot.settings.theme, density: snapshot.settings.activityDensity, collapsed: snapshot.settings.sidebarCollapsed, mode: snapshot.settings.mode }, { theme: 'dark', density: 'detailed', collapsed: true, mode: 'work' });
  snapshot = await service.deleteConversation(id); assert.equal(snapshot.conversations.length, 0);
});

test('desktop product service emits structured events for real blocked flow and mission creation', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'llera-product-events-')); const events = [];
  const service = new MonolithService({ userData, onEvent: event => events.push(event) }); await service.init();
  await service.send({ content: 'Hello local model' });
  await service.createMission({ title: 'Harmless task', goal: 'Observe only' });
  assert.ok(events.some(event => event.type === 'message.started'));
  assert.ok(events.some(event => event.type === 'message.blocked' && event.detail.message?.code === 'MODEL_NOT_CONFIGURED'));
  assert.ok(events.some(event => event.type === 'mission.created'));
});
