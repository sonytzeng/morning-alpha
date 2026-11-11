#!/usr/bin/env node
/** GitHub Actions cache-miss bootstrap. Only reads the pinned complete seed
 * through the existing GitHub OIDC gateway; never reads a service credential. */
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { bootstrapTaiwanMarketSeed } from '../../research/taiwan-market-seed.mjs';
import { createTaiwanMarketOidcRpc } from './taiwan-market-oidc-rpc.mjs';

export async function runTaiwanMarketSeedBootstrapCli(args, { rpc } = {}) {
  const flags = new Map();
  for (let index = 0; index < args.length; index++) {
    if (!['--seed-id', '--cache'].includes(args[index]) || !args[index + 1] || flags.has(args[index])) throw Error('TAIWAN_MARKET_SEED_ARGUMENTS');
    flags.set(args[index], args[++index]);
  }
  if (flags.size !== 2) throw Error('TAIWAN_MARKET_SEED_ARGUMENTS');
  return bootstrapTaiwanMarketSeed({ seedId: flags.get('--seed-id'), cacheDir: flags.get('--cache'), rpc: rpc ?? createTaiwanMarketOidcRpc() });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await runTaiwanMarketSeedBootstrapCli(process.argv.slice(2)))); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
