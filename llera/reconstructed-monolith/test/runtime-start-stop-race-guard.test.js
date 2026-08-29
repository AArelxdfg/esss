'use strict';

const assert = require('assert');
const { RuntimeLifecycle } = require('../src/runtime-lifecycle');

(async()=>{
  let resolveStart;
  let startCalls=0;
  let stopCalls=0;
  let healthCalls=0;
  const startGate=new Promise(resolve=>{ resolveStart=resolve; });

  const runtime=new RuntimeLifecycle({
    start:async({model,generation})=>{
      startCalls+=1;
      const pid=await startGate;
      return {pid,model,generation};
    },
    stop:async()=>{ stopCalls+=1; },
    health:async({pid,model})=>{
      healthCalls+=1;
      return pid===4242 && model==='model-a';
    }
  });

  const starting=runtime.ensureRunning('model-a','cold-start');
  assert.strictEqual(runtime.state,'starting');
  assert.strictEqual(startCalls,1);

  let blocked=null;
  try {
    await runtime.stop('concurrent-user-stop');
  } catch(error) {
    blocked=error;
  }
  assert(blocked,'stop during start must fail closed');
  assert.strictEqual(blocked.code,'RUNTIME_START_IN_PROGRESS');
  assert.match(blocked.message,/start in progress/);
  assert.strictEqual(runtime.state,'starting','blocked stop must not falsify runtime state');
  assert.strictEqual(runtime.pid,null);
  assert.strictEqual(stopCalls,0,'backend stop must not race an unresolved start');

  resolveStart(4242);
  const ready=await starting;
  assert.strictEqual(ready.state,'ready');
  assert.strictEqual(ready.pid,4242);
  assert.strictEqual(ready.model,'model-a');
  assert.strictEqual(startCalls,1,'race guard must not spawn a replacement runtime');
  assert.strictEqual(healthCalls,1);
  assert.strictEqual(stopCalls,0);

  const stopped=await runtime.stop('normal-stop-after-start');
  assert.strictEqual(stopped.state,'stopped');
  assert.strictEqual(stopped.pid,null);
  assert.strictEqual(stopCalls,1,'resolved backend is stopped exactly once');

  console.log('MONOLITH runtime start/stop race guard PASS',{
    stopDuringStartFailsClosed:true,
    startStatePreserved:true,
    unresolvedStartNotStopped:true,
    singleRuntimeLaunch:true,
    resolvedRuntimeStopsExactlyOnce:true
  });
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
