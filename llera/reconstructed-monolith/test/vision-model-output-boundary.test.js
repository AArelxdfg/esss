'use strict';

const assert = require('assert');
const { VisionPipeline, normalizeVisionOutput } = require('../src/vision-pipeline');

(async () => {
  const input = {
    bytes: Buffer.from('MONOLITH VISION OUTPUT TEST 2026'),
    kind: 'image',
    mime: 'image/png',
    source: 'vision-model-output-boundary-test',
  };

  let effects = 0;
  const coercive = {};
  Object.defineProperty(coercive, 'caption', {
    enumerable: true,
    get() {
      effects += 1;
      return 'unsafe';
    },
  });

  const pipeline = new VisionPipeline();
  await assert.rejects(
    () => pipeline.analyze(input, { visionModel: async () => coercive }),
    (error) => error
      && error.code === 'VISION_BACKENDS_FAILED'
      && Array.isArray(error.backendFailures)
      && error.backendFailures.some((failure) => /unsafe accessor/.test(failure.reason)),
  );

  assert.strictEqual(effects, 0, 'vision result getters must never execute');
  assert.strictEqual(pipeline.active, null, 'failed vision backend must release single-flight slot');

  assert.throws(
    () => normalizeVisionOutput('x'.repeat(33), { maxStringBytes: 32, maxTotalStringBytes: 128 }),
    (error) => error && error.code === 'VISION_MODEL_OUTPUT_INVALID' && /string exceeds byte limit/.test(error.message),
  );
  assert.throws(
    () => normalizeVisionOutput(['12345678', 'abcdefgh', 'ABCDEFGH'], { maxStringBytes: 16, maxTotalStringBytes: 20 }),
    (error) => error && error.code === 'VISION_MODEL_OUTPUT_INVALID' && /total string byte limit/.test(error.message),
  );
  assert.throws(
    () => normalizeVisionOutput({ ['k'.repeat(17)]: 'ok' }, { maxKeyBytes: 16 }),
    (error) => error && error.code === 'VISION_MODEL_OUTPUT_INVALID' && /key exceeds byte limit/.test(error.message),
  );

  const backendObject = {
    caption: 'MONOLITH VISION OUTPUT TEST 2026',
    confidence: 0.99,
    labels: ['text', 'workspace'],
    region: { x: 12, y: 24, visible: true },
  };
  const result = await pipeline.analyze(input, { visionModel: async () => backendObject });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.backend, 'vision-4b');
  assert.strictEqual(result.vision.caption, backendObject.caption);
  assert.deepStrictEqual([...result.vision.labels], backendObject.labels);
  assert.strictEqual(result.vision.region.visible, true);
  assert.notStrictEqual(result.vision, backendObject, 'backend output must be snapshotted');
  assert.notStrictEqual(result.vision.region, backendObject.region, 'nested backend output must be snapshotted');

  backendObject.caption = 'mutated-after-return';
  backendObject.labels[0] = 'mutated';
  backendObject.region.visible = false;
  assert.strictEqual(result.vision.caption, 'MONOLITH VISION OUTPUT TEST 2026');
  assert.strictEqual(result.vision.labels[0], 'text');
  assert.strictEqual(result.vision.region.visible, true);
  assert.strictEqual(pipeline.active, null);

  console.log('MONOLITH vision model output boundary PASS', {
    accessorRejectedWithoutExecution: effects === 0,
    structuredOutputAccepted: true,
    outputSnapshotIsolated: true,
    outputStringBudgetEnforced: true,
    outputKeyBudgetEnforced: true,
    singleFlightReleased: true,
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
