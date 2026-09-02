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

function assertLoopbackEndpoint(endpoint) {
  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    const error = new Error('llama.cpp endpoint must remain loopback-only');
    error.code = 'LLAMA_NON_LOOPBACK_BIND';
    throw error;
  }
  return endpointUrl;
}

function flattenAssistantContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return null;
  const parts = [];
  for (const item of value) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string') parts.push(item.text);
    else if (typeof item.content === 'string') parts.push(item.content);
  }
  return parts.length ? parts.join('') : null;
}

function extractAssistantText(message) {
  if (!message || typeof message !== 'object') return null;
  const content = flattenAssistantContent(message.content);
  if (typeof content === 'string' && content.length > 0) return content;
  const reasoning = flattenAssistantContent(message.reasoning_content);
  if (typeof reasoning === 'string' && reasoning.length > 0) return reasoning;
  if (typeof content === 'string') return content;
  if (typeof reasoning === 'string') return reasoning;
  return null;
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
    healthPollIntervalMs = 250,
    inferenceTimeoutMs = 120000,
    stopGraceTimeoutMs = 5000,
    stopForceTimeoutMs = 2000,
    extraArgs = [],
  } = {}) {
    if (!runtimeRoot) throw new Error('runtimeRoot is required');
    if (typeof spawn !== 'function') throw new Error('spawn must be a function');
    if (typeof fetch !== 'function') throw new Error('fetch must be a function');
    if (!Number.isFinite(healthTimeoutMs) || healthTimeoutMs <= 0) throw new Error('healthTimeoutMs must be positive');
    if (!Number.isFinite(healthPollIntervalMs) || healthPollIntervalMs <= 0) throw new Error('healthPollIntervalMs must be positive');
    if (!Number.isFinite(inferenceTimeoutMs) || inferenceTimeoutMs <= 0) throw new Error('inferenceTimeoutMs must be positive');
    if (!Number.isFinite(stopGraceTimeoutMs) || stopGraceTimeoutMs <= 0) throw new Error('stopGraceTimeoutMs must be positive');
    if (!Number.isFinite(stopForceTimeoutMs) || stopForceTimeoutMs <= 0) throw new Error('stopForceTimeoutMs must be positive');

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
    this.healthPollIntervalMs = healthPollIntervalMs;
    this.inferenceTimeoutMs = inferenceTimeoutMs;
    this.stopGraceTimeoutMs = stopGraceTimeoutMs;
    this.stopForceTimeoutMs = stopForceTimeoutMs;
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

  _liveTrackedChildren() {
    const live = [];
    for (const [pid, child] of this.children.entries()) {
      if (!child || child.exitCode != null || child.signalCode != null) {
        this.children.delete(pid);
        continue;
      }
      live.push({ pid, child });
    }
    return live;
  }

  async start({ model, generation } = {}) {
    const engine = this.resolveEngine();
    const modelPath = this.resolveModel(model);
    const endpointUrl = assertLoopbackEndpoint(this.endpoint);

    const liveChildren = this._liveTrackedChildren();
    if (liveChildren.length) {
      const error = new Error(`llama.cpp single-runtime guard blocked start; active pid ${liveChildren[0].pid}`);
      error.code = 'LLAMA_SINGLE_RUNTIME_VIOLATION';
      error.pid = liveChildren[0].pid;
      error.activePids = liveChildren.map(item => item.pid);
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
    assertLoopbackEndpoint(this.endpoint);
    const controller = new AbortController();
    const deadline = Date.now() + this.healthTimeoutMs;
    const timer = setTimeout(() => controller.abort(), this.healthTimeoutMs);
    try {
      while (!controller.signal.aborted) {
        try {
          const response = await this.fetch(`${this.endpoint}/health`, { signal: controller.signal });
          if (response?.ok) {
            let body = null;
            try { body = await response.json(); } catch (_) { return true; }
            const status = String(body?.status || body?.state || '').toLowerCase();
            if (!status || ['ok', 'ready', 'healthy'].includes(status)) return true;
          }
        } catch (_) {
          if (controller.signal.aborted) break;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(this.healthPollIntervalMs, remaining)));
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async chatCompletion({ messages, maxTokens = 1024, temperature = 0.2, signal = null } = {}) {
    assertLoopbackEndpoint(this.endpoint);
    if (!Array.isArray(messages) || messages.length === 0) {
      const error = new Error('messages are required for llama.cpp inference');
      error.code = 'LLAMA_MESSAGES_REQUIRED';
      throw error;
    }
    const normalizedMessages = messages.map((message) => ({ role: String(message?.role || '').trim(), content: String(message?.content ?? '') }));
    if (normalizedMessages.some((message) => !['system', 'user', 'assistant', 'tool'].includes(message.role))) {
      const error = new Error('unsupported chat message role');
      error.code = 'LLAMA_MESSAGE_ROLE_INVALID';
      throw error;
    }
    const tokenLimit = Math.max(1, Math.min(32768, Number.isFinite(Number(maxTokens)) ? Math.floor(Number(maxTokens)) : 1024));
    const temp = Math.max(0, Math.min(2, Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2));
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('llama.cpp inference timeout')), this.inferenceTimeoutMs);
    try {
      const response = await this.fetch(`${this.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: normalizedMessages, max_tokens: tokenLimit, temperature: temp, stream: false }),
        signal: controller.signal,
      });
      if (!response || !response.ok) {
        const error = new Error(`llama.cpp inference failed${response ? ` (${response.status})` : ''}`);
        error.code = 'LLAMA_INFERENCE_HTTP_ERROR';
        error.status = response?.status ?? null;
        throw error;
      }
      const body = await response.json();
      const choice = body?.choices?.[0] || null;
      const content = extractAssistantText(choice?.message);
      if (typeof content !== 'string') {
        const error = new Error('llama.cpp inference response missing assistant content');
        error.code = 'LLAMA_INFERENCE_INVALID_RESPONSE';
        throw error;
      }
      return { content, finishReason: choice?.finish_reason || null, usage: body?.usage ? { ...body.usage } : null, model: body?.model || null };
    } catch (error) {
      if (controller.signal.aborted && error?.code !== 'LLAMA_INFERENCE_HTTP_ERROR') {
        const aborted = new Error('llama.cpp inference aborted');
        aborted.code = 'LLAMA_INFERENCE_ABORTED';
        aborted.cause = error;
        throw aborted;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortFromCaller);
    }
  }

  async chatCompletionStream({ messages, maxTokens = 1024, temperature = 0.2, signal = null, onDelta = null } = {}) {
    assertLoopbackEndpoint(this.endpoint);
    if (!Array.isArray(messages) || messages.length === 0) {
      const error = new Error('messages are required for llama.cpp inference');
      error.code = 'LLAMA_MESSAGES_REQUIRED';
      throw error;
    }
    if (onDelta !== null && typeof onDelta !== 'function') throw new Error('onDelta must be a function when provided');
    const normalizedMessages = messages.map(message => ({ role: String(message?.role || '').trim(), content: String(message?.content ?? '') }));
    if (normalizedMessages.some(message => !['system', 'user', 'assistant', 'tool'].includes(message.role))) {
      const error = new Error('unsupported chat message role'); error.code = 'LLAMA_MESSAGE_ROLE_INVALID'; throw error;
    }
    const tokenLimit = Math.max(1, Math.min(32768, Number.isFinite(Number(maxTokens)) ? Math.floor(Number(maxTokens)) : 1024));
    const temp = Math.max(0, Math.min(2, Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2));
    const controller = new AbortController(); const abortFromCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller(); else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('llama.cpp inference timeout')), this.inferenceTimeoutMs);
    try {
      const response = await this.fetch(`${this.endpoint}/v1/chat/completions`, { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ messages: normalizedMessages, max_tokens: tokenLimit, temperature: temp, stream: true, stream_options: { include_usage: true } }), signal: controller.signal });
      if (!response?.ok) { const error = new Error(`llama.cpp inference failed${response ? ` (${response.status})` : ''}`); error.code = 'LLAMA_INFERENCE_HTTP_ERROR'; error.status = response?.status ?? null; throw error; }
      if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') { const error = new Error('llama.cpp streaming response body is unavailable'); error.code = 'LLAMA_STREAM_UNAVAILABLE'; throw error; }
      const decoder = new TextDecoder(); let buffer = ''; let content = ''; let finishReason = null; let usage = null; let model = null;
      const consumeLine = async (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        const event = JSON.parse(payload); const choice = event?.choices?.[0]; const delta = extractAssistantText(choice?.delta);
        if (typeof delta === 'string' && delta) { content += delta; await onDelta?.(delta); }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (event?.usage) usage = { ...event.usage };
        if (event?.model) model = event.model;
      };
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) await consumeLine(line);
      }
      buffer += decoder.decode();
      if (buffer) {
        const tailLines = buffer.split(/\r?\n/);
        for (const line of tailLines) await consumeLine(line);
      }
      return { content, finishReason, usage, model };
    } catch (error) {
      if (controller.signal.aborted && error?.code !== 'LLAMA_INFERENCE_HTTP_ERROR') { const aborted = new Error('llama.cpp inference aborted'); aborted.code = 'LLAMA_INFERENCE_ABORTED'; aborted.cause = error; throw aborted; }
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', abortFromCaller); }
  }

  async stop({ pid } = {}) {
    const child = this.children.get(pid);
    if (!child) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      let graceTimer = null;
      let forceTimer = null;
      const cleanup = () => {
        if (graceTimer) clearTimeout(graceTimer);
        if (forceTimer) clearTimeout(forceTimer);
        child.removeListener?.('exit', onExit);
      };
      const finish = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err); else resolve();
      };
      const onExit = () => finish();
      child.once?.('exit', onExit);

      try {
        const signaled = child.kill('SIGTERM');
        if (signaled === false) {
          const error = new Error(`failed to signal llama.cpp pid ${pid}`);
          error.code = 'LLAMA_STOP_SIGNAL_FAILED';
          finish(error);
          return;
        }
      } catch (err) {
        finish(err);
        return;
      }

      graceTimer = setTimeout(() => {
        if (settled) return;
        try {
          const forced = child.kill('SIGKILL');
          if (forced === false) {
            const error = new Error(`failed to force-stop llama.cpp pid ${pid}`);
            error.code = 'LLAMA_STOP_FORCE_SIGNAL_FAILED';
            finish(error);
            return;
          }
        } catch (err) {
          finish(err);
          return;
        }

        forceTimer = setTimeout(() => {
          const error = new Error(`llama.cpp pid ${pid} did not exit after forced termination`);
          error.code = 'LLAMA_STOP_TIMEOUT';
          error.pid = pid;
          finish(error);
        }, this.stopForceTimeoutMs);
      }, this.stopGraceTimeoutMs);
    });
    this.children.delete(pid);
  }

  async isAlive({ pid } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    const child = this.children.get(pid);
    if (child) return child.exitCode == null && child.signalCode == null;
    try { process.kill(pid, 0); return true; } catch (_) { return false; }
  }
}

module.exports = { LlamaCppProcessBackend, assertContained, assertLoopbackEndpoint, flattenAssistantContent, extractAssistantText };
