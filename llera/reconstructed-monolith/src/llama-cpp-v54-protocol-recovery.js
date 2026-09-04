'use strict';

const INSTALL_MARK = Symbol.for('llera.v54.protocolRecoveryInstalled');

function isDegenerate(text) {
  if (typeof text !== 'string') return true;
  const value = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim();
  if (!value) return true;
  if (/^(?:\.{2,}|…+|[-_*#`~|:;!?]+)$/u.test(value)) return true;
  const letters = value.match(/[\p{L}\p{N}]/gu) || [];
  return letters.length === 0 || (value.length < 3 && letters.length < 2);
}

function cleanReply(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/^assistant\s*[:：]\s*/i, '')
    .trim();
}

function plainPrompt(messages) {
  const lines = [];
  for (const message of messages || []) {
    const role = message?.role === 'system' ? 'Sistem'
      : message?.role === 'assistant' ? 'LLera'
      : message?.role === 'tool' ? 'Araç'
      : 'Kullanıcı';
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (content) lines.push(`${role}: ${content}`);
  }
  lines.push('LLera:');
  return lines.join('\n\n');
}

function normalizedMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    const error = new Error('messages are required for llama.cpp inference');
    error.code = 'LLAMA_MESSAGES_REQUIRED';
    throw error;
  }
  const out = messages.map(message => ({
    role: typeof message?.role === 'string' ? message.role.trim() : '',
    content: typeof message?.content === 'string' ? message.content : '',
  }));
  if (out.some(message => !['system', 'user', 'assistant', 'tool'].includes(message.role))) {
    const error = new Error('unsupported chat message role');
    error.code = 'LLAMA_MESSAGE_ROLE_INVALID';
    throw error;
  }
  return out;
}

function normalizeMaxTokens(value) {
  return Math.max(1, Math.min(32768, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 1024));
}

function normalizeTemperature(value) {
  return Math.max(0, Math.min(2, Number.isFinite(Number(value)) ? Number(value) : 0.2));
}

async function withAbort(instance, signal, operation) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener?.('abort', abortFromCaller, { once: true });
  const timeoutMs = Number.isFinite(instance?.inferenceTimeoutMs) && instance.inferenceTimeoutMs > 0 ? instance.inferenceTimeoutMs : 120000;
  const timer = setTimeout(() => controller.abort(new Error('llama.cpp inference timeout')), timeoutMs);
  try {
    if (controller.signal.aborted) {
      const aborted = new Error('llama.cpp inference aborted');
      aborted.code = 'LLAMA_INFERENCE_ABORTED';
      throw aborted;
    }
    return await operation(controller.signal);
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

async function recoveryChat(instance, { messages, maxTokens, temperature, signal }) {
  const normalized = normalizedMessages(messages);
  return withAbort(instance, signal, async abortSignal => {
    const response = await instance.fetch(`${String(instance.endpoint).replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: normalized,
        stream: false,
        max_tokens: normalizeMaxTokens(maxTokens),
        temperature: normalizeTemperature(temperature),
        reasoning_effort: 'none',
        reasoning_format: 'none',
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: abortSignal,
    });
    if (!response?.ok) {
      const error = new Error(`llama.cpp recovery chat failed${response ? ` (${response.status})` : ''}`);
      error.code = 'LLAMA_RECOVERY_CHAT_HTTP_ERROR';
      error.status = response?.status ?? null;
      throw error;
    }
    const body = await response.json();
    const message = body?.choices?.[0]?.message || {};
    const direct = typeof message.content === 'string' ? message.content : '';
    const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
    const content = cleanReply(!isDegenerate(direct) ? direct : reasoning);
    if (isDegenerate(content)) {
      const error = new Error('llama.cpp recovery chat returned degenerate output');
      error.code = 'LLAMA_RECOVERY_CHAT_DEGENERATE';
      throw error;
    }
    return { content, finishReason: body?.choices?.[0]?.finish_reason || null, usage: body?.usage ? { ...body.usage } : null, model: body?.model || null, protocol: 'recovery' };
  });
}

async function rawCompletion(instance, { messages, maxTokens, temperature, signal }) {
  const normalized = normalizedMessages(messages);
  return withAbort(instance, signal, async abortSignal => {
    const response = await instance.fetch(`${String(instance.endpoint).replace(/\/$/, '')}/completion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: plainPrompt(normalized),
        n_predict: normalizeMaxTokens(maxTokens),
        temperature: normalizeTemperature(temperature),
        top_p: 0.92,
        stream: false,
        stop: ['\nKullanıcı:', '\nSistem:'],
      }),
      signal: abortSignal,
    });
    if (!response?.ok) {
      const error = new Error(`llama.cpp raw completion failed${response ? ` (${response.status})` : ''}`);
      error.code = 'LLAMA_RAW_COMPLETION_HTTP_ERROR';
      error.status = response?.status ?? null;
      throw error;
    }
    const body = await response.json();
    const content = cleanReply(body?.content ?? body?.response ?? body?.text ?? '');
    if (isDegenerate(content)) {
      const error = new Error('llama.cpp raw completion returned degenerate output');
      error.code = 'LLAMA_RAW_COMPLETION_DEGENERATE';
      throw error;
    }
    return { content, finishReason: body?.stop ? 'stop' : null, usage: body?.usage ? { ...body.usage } : null, model: body?.model || null, protocol: 'raw' };
  });
}

function shouldRecover(error) {
  return error?.code !== 'LLAMA_INFERENCE_ABORTED' && error?.name !== 'AbortError';
}

function installV54ProtocolRecovery(BackendClass) {
  if (typeof BackendClass !== 'function' || !BackendClass.prototype) throw new Error('BackendClass is required');
  const proto = BackendClass.prototype;
  if (proto[INSTALL_MARK]) return false;
  if (typeof proto.chatCompletion !== 'function' || typeof proto.chatCompletionStream !== 'function') throw new Error('llama.cpp backend completion methods are required');

  const originalChat = proto.chatCompletion;
  const originalStream = proto.chatCompletionStream;

  proto.chatCompletion = async function v54CompatibleChat(options = {}) {
    try {
      const result = await originalChat.call(this, options);
      if (!isDegenerate(result?.content)) return { ...result, protocol: result.protocol || 'chat' };
    } catch (error) {
      if (!shouldRecover(error)) throw error;
    }
    try {
      return await recoveryChat(this, options);
    } catch (error) {
      if (!shouldRecover(error)) throw error;
    }
    return rawCompletion(this, options);
  };

  proto.chatCompletionStream = async function v54CompatibleStream(options = {}) {
    try {
      const result = await originalStream.call(this, options);
      if (!isDegenerate(result?.content)) return { ...result, protocol: result.protocol || 'chat-stream' };
    } catch (error) {
      if (!shouldRecover(error)) throw error;
    }
    try {
      return await recoveryChat(this, options);
    } catch (error) {
      if (!shouldRecover(error)) throw error;
    }
    return rawCompletion(this, options);
  };

  Object.defineProperty(proto, INSTALL_MARK, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

module.exports = { installV54ProtocolRecovery, isDegenerate, plainPrompt, recoveryChat, rawCompletion };
