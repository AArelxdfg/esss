'use strict';
const crypto = require('crypto');
class VisionPipeline {
  constructor({ now = () => new Date().toISOString(), maxBytes = 32 * 1024 * 1024 } = {}) { this.now=now; this.maxBytes=maxBytes; this.active=null; this.history=[]; }
  normalizeInput(input) {
    if (!input || !Buffer.isBuffer(input.bytes)) throw new Error('vision input bytes required');
    if (!input.bytes.length) throw new Error('empty vision input');
    if (input.bytes.length > this.maxBytes) throw new Error('vision input exceeds size limit');
    const kind=String(input.kind||'').toLowerCase();
    if (!['image','file','screen'].includes(kind)) throw new Error('unsupported vision input kind');
    const mime=String(input.mime||'application/octet-stream').toLowerCase();
    return {kind,mime,bytes:input.bytes,sha256:crypto.createHash('sha256').update(input.bytes).digest('hex'),source:String(input.source||kind)};
  }
  async analyze(input,{pressure='normal',visionModel,ocr}={}) {
    const n=this.normalizeInput(input);
    if (pressure==='critical') return {ok:false,blocked:true,reason:'host-critical-pressure',sha256:n.sha256};
    if (this.active) throw new Error('vision single-flight violation');
    const task={id:crypto.randomUUID(),startedAt:this.now(),sha256:n.sha256,kind:n.kind}; this.active=task;
    try {
      const canVision=typeof visionModel==='function', canOcr=typeof ocr==='function';
      if (!canVision && !canOcr) throw new Error('no vision or OCR backend');
      let vision=null,text=null,backend=null;
      if (canVision) { vision=await visionModel(n); backend='vision-4b'; }
      const shouldOcr=n.kind==='screen'||/pdf|image|png|jpe?g|webp|bmp/.test(n.mime);
      if (shouldOcr && canOcr) { text=await ocr(n); backend=backend?'vision-4b+windows-ocr':'windows-ocr'; }
      const result={ok:true,taskId:task.id,backend,kind:n.kind,source:n.source,sha256:n.sha256,text:text||'',vision:vision||null,completedAt:this.now()};
      this.history.push({taskId:task.id,backend,sha256:n.sha256,completedAt:result.completedAt}); return result;
    } finally { this.active=null; }
  }
}
module.exports={VisionPipeline};
