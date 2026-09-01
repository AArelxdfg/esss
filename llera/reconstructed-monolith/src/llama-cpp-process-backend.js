'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn: defaultSpawn } = require('node:child_process');

function realOrResolved(p) {
  const absolute = path.resolve(String(p || ''));
  try { return fs.realpathSync.native(absolute); } catch (_) { return absolute; }
}

function assertContained(root, candidate, label) {
  const base = realOrResolved(root);
  const target = realOrResolved(candidate);
  const rel = path.relative(base, target);
  if (!rel || rel === '.') return target;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const error = new Error(`${label} escapes LLera runtime root`);
    error.code = 'LLERA_RUNTIME_PATH_ESCAPE';
    throw error;
  }
  return target;
}

class LlamaCppProcessBackend {
  constructor({
    runtimeRoot,
    enginePath = null,
    modelCatalog = {},
    endpoint = 'http://127.0.0.1:18191',
    spawn = defaultSpawn,
    fetch = globalThis.fetch,
    fsImpl = fs,
    platform = process.platform,
    healthTimeoutMs = 15000,
    extraArgs = [],
  } = {}) {
    if (!runtimeRoot) throw new Error('runtimeRoot is required');
    if (typeof spawn !== 'function') throw new Error('spawn must be a function');
    if (typeof fetch !== 'function') throw new Error('fetch must be a function');
    if (!Number.isFinite(healthTimeoutMs) || healthTimeoutMs <= 0) throw new Error('healthTimeoutMs must be positive');

    this.runtimeRoot = path.resolve(runtimeRoot);
    this.engineRoot = path.join(this.runtimeRoot, 'engine');
    this.modelsRoot = path.join(this.runtimeRoot, 'models');
    this.enginePath = enginePath || path.join(this.engineRoot, platform === 'win32' ? 'llama-server.exe' : 'llama-server');
    this.modelCatalog = Object.freeze({ ...modelCatalog });
    this.endpoint = String(endpoint).replace(/\/$/, '');
    this.spawn = spawn;
    this.fetch = fetch;
    this.fs = fsImpl;
    this.healthTimeoutMs = healthTimeoutMs;
    this.extraArgs = Array.isArray(extraArgs) ? [...extraArgs] : [];
    this.children = new Map();
  }

  resolveEngine() {
    const engine = assertContained(this.engineRoot, this.enginePath, 'llama.cpp engine');
    if (!this.fs.existsSync(engine)) {
      const error = new Error(`llama.cpp engine not found: ${engine}`);
      error.code = 'LLAMA_ENGINE_MISSING';
      throw error;
    }
    return engine;
  }

  resolveModel(modelId) {
    const entry = this.modelCatalog[modelId];
    if (!entry) {
      const error = new Error(`unknown LLera model: ${modelId}`);
      error.code = 'LLAMA_MODEL_UNKNOWN';
      throw error;
    }
    const candidate = typeof entry === 'string' ? entry : entry.path;
    if (!candidate) throw new Error(`model path missing for ${modelId}`);
    const modelPath = assertContained(this.modelsRoot, path.isAbsolute(candidate) ? candidate : path.join(this.modelsRoot, candidate), 'model');
    if (!this.fs.existsSync(modelPath)) {
      const error = new Error(`model not found: ${modelPath}`);
      error.code = 'LLAMA_MODEL_MISSING';
      throw error;
    }
    return modelPath;
  }

  async start({ model, generation } = {}) {
    const engine = this.resolveEngine();
    const modelPath = this.resolveModel(model);
    const endpointUrl = new URL(this.endpoint);
    const host = endpointUrl.hostname;
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      const error = new Error('llama.cpp endpoint must remain loopback-only');
      error.code = 'LLAMA_NON_LOOPBACK_BIND';
      throw error;
    }
    const port = Number(endpointUrl.port || 18191);
    const args = ['--model', modelPath, '--host', '127.0.0.1', '--port', String(port), ...this.extraArgs];
    const child = this.spawn(engine, args, {
      cwd: this.runtimeRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, LLERA_RUNTIME_GENERATION: String(generation || 0) },
    });
    if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0) {
      const error = new Error('llama.cpp spawn returned no pid');
      error.code = 'LLAMA_SPAWN_NO_PID';
      throw error;
    }
    this.children.set(child.pid, child);
    child.once?.('exit', () => this.children.delete(child.pid));
    child.stderr?.on?.('data', () => {});
    child.stdout?.on?.('data', () => {});
    return { pid: child.pid, model, generation: Number(generation || 0), endpoint: this.endpoint };
  }

  async health() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
    try {
      const response = await this.fetch(`${this.endpoint}/health`, { signal: controller.signal });
      if (!response || !response.ok) return false;
      let body = null;
      try { body = await response.json(); } catch (_) { return true; }
      const status = String(body?.status || body?.state || '').toLowerCase();
      return !status || ['ok', 'ready', 'healthy'].includes(status);
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async stop({ pid } = {}) {
    const child = this.children.get(pid);
    if (!child) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        child.removeListener?.('exit', onExit);
        if (err) reject(err); else resolve();
      };
      const onExit = () => finish();
      child.once?.('exit', onExit);
      try {
        const signaled = child.kill('SIGTERM');
        if (signaled === false) finish(new Error(`failed to signal llama.cpp pid ${pid}`));
      } catch (err) { finish(err); }
    });
    this.children.delete(pid);
  }

  async isAlive({ pid } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    const child = this.children.get(pid);
    if (child) return child.exitCode == null && child.killed !== true;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
  }
}

module.exports = { LlamaCppProcessBackend, assertContained };
