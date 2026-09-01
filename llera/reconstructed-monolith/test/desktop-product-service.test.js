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
});
