'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile: nodeExecFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(nodeExecFile);
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/bmp', 'image/gif', 'image/tiff']);

class WindowsOcrAdapter {
  constructor({
    platform = process.platform,
    execFile = execFileAsync,
    tmpDir = os.tmpdir(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    fsPromises = fs.promises
  } = {}) {
    if (typeof platform !== 'string') throw new TypeError('OCR platform must be a string');
    if (typeof execFile !== 'function') throw new TypeError('OCR execFile must be a function');
    if (typeof tmpDir !== 'string' || !tmpDir.trim()) throw new TypeError('OCR tmpDir must be a non-empty string');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('OCR timeout must be a positive safe integer');
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new RangeError('OCR maxOutputBytes must be a positive safe integer');
    if (!fsPromises || typeof fsPromises.writeFile !== 'function' || typeof fsPromises.unlink !== 'function') throw new TypeError('OCR fsPromises adapter invalid');
    this.platform = platform;
    this.execFile = execFile;
    this.tmpDir = path.resolve(tmpDir);
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.fsPromises = fsPromises;
  }

  async recognize(input) {
    const normalized = normalizeInput(input);
    if (this.platform !== 'win32') {
      const error = new Error('Windows.Media.Ocr is only available on Windows');
      error.code = 'WINDOWS_OCR_PLATFORM_UNAVAILABLE';
      throw error;
    }

    const ext = extensionForMime(normalized.mime);
    const tempPath = path.join(this.tmpDir, `llera-ocr-${crypto.randomUUID()}${ext}`);
    await this.fsPromises.writeFile(tempPath, normalized.bytes, { mode: 0o600, flag: 'wx' });

    try {
      const script = windowsOcrScript(tempPath);
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      let execution;
      try {
        execution = await this.execFile('powershell.exe', [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-EncodedCommand', encoded
        ], {
          windowsHide: true,
          timeout: this.timeoutMs,
          maxBuffer: this.maxOutputBytes,
          encoding: 'utf8',
          shell: false
        });
      } catch (cause) {
        const error = new Error(`Windows OCR execution failed: ${String(cause && cause.message || cause)}`);
        error.code = 'WINDOWS_OCR_EXECUTION_FAILED';
        error.cause = cause;
        throw error;
      }

      const stdout = typeof execution === 'string' ? execution : execution && execution.stdout;
      if (typeof stdout !== 'string' || !stdout.trim()) {
        const error = new Error('Windows OCR produced no output');
        error.code = 'WINDOWS_OCR_OUTPUT_EMPTY';
        throw error;
      }
      if (Buffer.byteLength(stdout, 'utf8') > this.maxOutputBytes) {
        const error = new Error('Windows OCR output exceeds limit');
        error.code = 'WINDOWS_OCR_OUTPUT_LIMIT';
        throw error;
      }

      let parsed;
      try { parsed = JSON.parse(stdout.trim()); }
      catch (cause) {
        const error = new Error('Windows OCR output is not valid JSON');
        error.code = 'WINDOWS_OCR_OUTPUT_INVALID';
        error.cause = cause;
        throw error;
      }
      if (!parsed || parsed.ok !== true || parsed.engine !== 'Windows.Media.Ocr' || typeof parsed.text !== 'string') {
        const error = new Error('Windows OCR result contract invalid');
        error.code = 'WINDOWS_OCR_RESULT_INVALID';
        throw error;
      }
      return parsed.text;
    } finally {
      try { await this.fsPromises.unlink(tempPath); } catch (_) {}
    }
  }
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Buffer.isBuffer(input.bytes)) {
    const error = new TypeError('Windows OCR requires Buffer input bytes');
    error.code = 'WINDOWS_OCR_INPUT_INVALID';
    throw error;
  }
  if (input.bytes.length === 0) {
    const error = new Error('Windows OCR input is empty');
    error.code = 'WINDOWS_OCR_INPUT_EMPTY';
    throw error;
  }
  if (typeof input.mime !== 'string' || !ALLOWED_MIME.has(input.mime.toLowerCase())) {
    const error = new Error('Windows OCR input MIME unsupported');
    error.code = 'WINDOWS_OCR_MIME_UNSUPPORTED';
    throw error;
  }
  return { bytes: Buffer.from(input.bytes), mime: input.mime.toLowerCase() };
}

function extensionForMime(mime) {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/bmp': return '.bmp';
    case 'image/gif': return '.gif';
    case 'image/tiff': return '.tiff';
    default: return '.img';
  }
}

function windowsOcrScript(filePath) {
  const pathB64 = Buffer.from(filePath, 'utf8').toString('base64');
  return [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    "function Await($op,$type){$m=[System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'}|Select-Object -First 1;if($null -eq $m){throw 'WinRT await bridge unavailable'};$t=$m.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait();$t.Result}",
    '[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]|Out-Null',
    '[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]|Out-Null',
    '[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]|Out-Null',
    `[string]$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathB64}'))`,
    '$f=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])',
    '$st=Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])',
    '$d=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($st)) ([Windows.Graphics.Imaging.BitmapDecoder])',
    '$bm=Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])',
    "$eng=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages();if($null -eq $eng){throw 'Windows OCR engine unavailable'}",
    '$r=Await ($eng.RecognizeAsync($bm)) ([Windows.Media.Ocr.OcrResult])',
    "[pscustomobject]@{ok=$true;engine='Windows.Media.Ocr';text=[string]$r.Text;width=[int]$bm.PixelWidth;height=[int]$bm.PixelHeight}|ConvertTo-Json -Compress"
  ].join(';');
}

function createWindowsOcr(options = {}) {
  const adapter = new WindowsOcrAdapter(options);
  return input => adapter.recognize(input);
}

module.exports = {
  WindowsOcrAdapter,
  createWindowsOcr,
  windowsOcrScript,
  normalizeInput,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES
};
