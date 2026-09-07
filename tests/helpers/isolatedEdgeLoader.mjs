// Executes the real Edge entrypoint and relative dependencies in a test VM.
// Only the Supabase SDK import is mapped to the repository's installed SDK.
// Deno.serve captures the actual handler; no production request is performed.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);

export function declaration(source, name) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(n => n.name?.getText(file) === name
    || n.declarationList?.declarations.some(d => d.name.getText(file) === name));
  if (!node) throw new Error(`Declaration missing: ${name}`);
  return node.getText(file);
}

export function isolatedEdge(entry, env, extra = {}) {
  const cache = new Map();
  let handler;
  const diagnostics = [];
  const globals = { Response, Request, Headers, URL, URLSearchParams, TextEncoder, TextDecoder,
    AbortController, AbortSignal, setTimeout, clearTimeout, Date, crypto: webcrypto, ...extra,
    console: { log() {}, info() {}, warn: (...v) => diagnostics.push(['warn', ...v]), error: (...v) => diagnostics.push(['error', ...v]) },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } } };
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} }; cache.set(path, module);
    const source = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const localRequire = spec => {
      if (spec.startsWith('.')) return load(resolve(dirname(path), spec));
      if (spec === 'https://esm.sh/@supabase/supabase-js@2') return require('@supabase/supabase-js');
      throw new Error(`Unapproved test import: ${spec}`);
    };
    vm.runInNewContext(source, { ...globals, module, exports: module.exports, require: localRequire }, { filename: path });
    return module.exports;
  }
  load(entry);
  if (!handler) throw new Error('Edge handler was not captured');
  return { handler, diagnostics };
}

export function isolatedFunction(source, name, dependencies = {}) {
  const js = ts.transpileModule(declaration(source, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(`${js}\n${name}`, { ...dependencies, Promise });
}
