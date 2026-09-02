// Test-infra shim, NOT game logic: registers a Node ESM resolution hook so `node
// --experimental-strip-types --test` can run this project's already-committed source
// files as-is.
//
// Why this exists: node's native ESM loader requires an explicit file extension on every
// relative import specifier, and has no notion of tsconfig's `"paths": { "@/*": [...] }`
// alias. This repo's source files (ported by an earlier wave — state.ts, cast.ts, bite.ts,
// util.ts, progress.ts, ...) all use extensionless relative imports (`from './util'`) and
// the `@/data/...` alias, because Vite's bundler resolver — which is what `npm run dev`/
// `build` actually use — accepts both. `node --test` never goes through Vite, so without
// this hook, running ANY test that transitively imports those (unmodified, out-of-scope)
// files fails with `ERR_MODULE_NOT_FOUND` before a single assertion runs.
//
// This file changes no behavior of the ported game-logic modules; it only teaches node's
// loader the same two resolution rules Vite already applies, so the existing source can be
// exercised by `node --test` unmodified. No new npm dependency — built-ins only.
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register(import.meta.url, import.meta.url);

const SRC_ROOT = pathToFileURL(fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '') + '/').href;
const EXT_CANDIDATES = ['.ts', '.tsx', '.mts', '/index.ts'];

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith('@/')) {
    target = new URL(target.slice(2), SRC_ROOT).href;
  }

  try {
    return await nextResolve(target, context);
  } catch (err) {
    const isNotFound = err && typeof err === 'object' && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND';
    const isRelativeOrAliased = target.startsWith('./') || target.startsWith('../') || target !== specifier;
    if (!isNotFound || !isRelativeOrAliased) throw err;
    for (const ext of EXT_CANDIDATES) {
      try {
        return await nextResolve(target + ext, context);
      } catch {
        // try the next candidate extension
      }
    }
    throw err;
  }
}
