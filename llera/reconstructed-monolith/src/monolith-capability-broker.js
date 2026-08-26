'use strict';

class MonolithCapabilityBroker {
  constructor({ vision, evidence, updater, hostguard } = {}) {
    this.vision = vision;
    this.evidence = evidence;
    this.updater = updater;
    this.hostguard = hostguard;
  }

  async invoke(tool, args = {}, context = {}) {
    switch (tool) {
      case 'vision_analyze_image':
        if (!this.vision?.analyze) throw new Error('vision pipeline unavailable');
        return this.vision.analyze({ ...args, kind: args.kind || 'image', context });
      case 'vision_ocr_screen':
        if (!this.vision?.ocrScreen) throw new Error('windows OCR unavailable');
        return this.vision.ocrScreen({ ...args, context });
      case 'evidence_record':
        if (!this.evidence?.record) throw new Error('evidence ledger unavailable');
        return this.evidence.record({ ...args, context });
      case 'evidence_verify':
        if (!this.evidence?.verify) throw new Error('evidence ledger unavailable');
        return this.evidence.verify({ ...args, context });
      case 'update_status':
        if (!this.updater?.status) throw new Error('update lifecycle unavailable');
        return this.updater.status({ ...args, context });
      case 'host_pressure_status':
        if (!this.hostguard?.snapshot) throw new Error('HOSTGUARD unavailable');
        return this.hostguard.snapshot({ ...args, context });
      default:
        throw new Error(`unsupported restored capability tool: ${tool}`);
    }
  }
}

module.exports = { MonolithCapabilityBroker };
