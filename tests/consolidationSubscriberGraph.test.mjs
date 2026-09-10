import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Symbol-aware source audit, not a browser, entitlement or production proof.
// Reach executable declarations through references/callbacks/JSX, not every
// export in an imported file. Type-only imports never create executable edges.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = ts.readConfigFile(resolve(root, 'tsconfig.app.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const router = program.getSourceFile(resolve(root, 'src/router/config.tsx'));
const rel = node => relative(root, node.getSourceFile().fileName);
const nameOf = node => node.name?.getText() || (ts.isExportAssignment(node) ? 'default' : '(anonymous)');
const keyOf = node => {
  let scope = node.parent;
  while (scope && !ts.isSourceFile(scope) && !ts.isFunctionDeclaration(scope)) scope = scope.parent;
  return `${rel(node)}#${scope && ts.isFunctionDeclaration(scope) ? `${nameOf(scope)}::` : ''}${nameOf(node)}`
    + (scope && ts.isFunctionDeclaration(scope) ? `@${node.getStart()}` : '');
};
const local = node => rel(node).startsWith('src/');
const unwrap = node => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
  ? unwrap(node.expression) : node;
const property = (node, key) => node.properties.find(item => item.name?.getText().replace(/["']/g, '') === key)?.initializer;
function symbolAt(node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}
function declarationAt(node) {
  const symbol = symbolAt(node);
  return symbol?.valueDeclaration || symbol?.declarations?.find(item => ts.isFunctionDeclaration(item) || ts.isVariableDeclaration(item));
}
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}
function defaultExport(file) {
  const symbol = checker.getSymbolAtLocation(file);
  const exported = symbol && checker.getExportsOfModule(symbol).find(item => item.name === 'default');
  const actual = exported?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  return actual?.valueDeclaration || actual?.declarations?.[0];
}
function pageDeclaration(tag) {
  const declaration = declarationAt(tag);
  if (!declaration) return null;
  if (!ts.isVariableDeclaration(declaration)) return declaration;
  let imported;
  walk(declaration, node => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && ts.isStringLiteral(node.arguments[0])) imported = node.arguments[0].text;
  });
  if (!imported) return declaration;
  const path = ts.resolveModuleName(imported, declaration.getSourceFile().fileName, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
  assert.ok(path, `unresolved lazy route ${imported}`);
  return defaultExport(program.getSourceFile(path));
}
function constantValue(node) {
  const value = unwrap(node);
  if (ts.isPropertyAccessExpression(value)) {
    const base = constantValue(value.expression);
    if (ts.isObjectLiteralExpression(base)) {
      const next = property(base, value.name.text);
      if (next) return constantValue(next);
    }
  }
  if (ts.isIdentifier(value)) {
    const declaration = declarationAt(value);
    if (declaration?.initializer) return constantValue(declaration.initializer);
  }
  return value;
}
function constantBoolean(node) {
  const value = constantValue(node);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  const declaration = declarationAt(value);
  if (declaration?.initializer) return constantBoolean(declaration.initializer);
  throw new Error(`Unclassified dynamic route condition: ${value.getText()}`);
}
const routes = [];
function readRoutes(node, parent = '', enabled = true) {
  node = unwrap(node);
  if (ts.isArrayLiteralExpression(node)) return node.elements.forEach(item => readRoutes(item, parent, enabled));
  if (ts.isSpreadElement(node)) return readRoutes(node.expression, parent, enabled);
  if (ts.isConditionalExpression(node)) {
    const condition = constantBoolean(node.condition);
    readRoutes(node.whenTrue, parent, enabled && condition);
    readRoutes(node.whenFalse, parent, enabled && !condition);
    return;
  }
  assert.ok(ts.isObjectLiteralExpression(node), `Unclassified route expression ${node.getText()}`);
  const pathNode = property(node, 'path');
  const path = pathNode ? pathNode.text.startsWith('/') || pathNode.text === '*' ? pathNode.text
    : `${parent}/${pathNode.text}` : parent;
  const element = property(node, 'element');
  let page, redirect;
  if (element) walk(element, child => {
    if (!ts.isJsxSelfClosingElement(child) && !ts.isJsxOpeningElement(child)) return;
    if (child.tagName.getText() === 'Navigate') {
      redirect = child.attributes.properties.find(item => item.name?.getText() === 'to')?.initializer?.text;
    } else if (child.tagName.getText() !== 'DeferredRoute') page = pageDeclaration(child.tagName);
  });
  if (page || redirect) routes.push({ path, enabled, kind: path.startsWith('/admin') ? 'admin' : 'subscriber', page, redirect });
  const children = property(node, 'children');
  if (children) readRoutes(children, path, enabled);
}
const routeDeclaration = router.statements.flatMap(node => node.declarationList?.declarations || [])
  .find(node => node.name.getText() === 'routes');
readRoutes(routeDeclaration.initializer);

const guardedEdge = {
  from: 'src/pages/voice/VoicePage.tsx#VoicePage',
  to: 'src/pages/voice/VoicePage.tsx#InternalVoicePage',
};
const fields = new Set(['confidence_score', 'decision_confidence', 'closing_verification', 'closing_verification_v2',
  'canonical_decision', 'content_publish_gate', 'report_status', 'premium_content_status']);
function graph(seeds, includeInternal = false) {
  const queue = seeds.filter(Boolean), seen = new Set(), declarations = new Map(), edges = new Map(), reads = new Map();
  while (queue.length) {
    const declaration = queue.shift();
    if (!local(declaration) || seen.has(declaration)) continue;
    seen.add(declaration);
    const owner = keyOf(declaration);
    declarations.set(owner, declaration);
    function visit(node) {
      if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
      // An uncalled nested function is not made live simply by declaration.
      if (node !== declaration && ts.isFunctionDeclaration(node)) return;
      if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
        const target = declarationAt(node);
        if (target && node !== target.name && local(target) && (ts.isFunctionDeclaration(target) || ts.isVariableDeclaration(target)
          || ts.isExportAssignment(target) || ts.isMethodDeclaration(target))) {
          const next = keyOf(target);
          if (!edges.has(owner)) edges.set(owner, new Set());
          edges.get(owner).add(next);
          if (includeInternal || owner !== guardedEdge.from || next !== guardedEdge.to) queue.push(target);
        }
      }
      const field = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text
          : ts.isBindingElement(node) ? (node.propertyName || node.name).getText()
            : ts.isCallExpression(node) ? node.arguments.find(argument => ts.isStringLiteral(argument) && fields.has(argument.text))?.text || '' : '';
      if (fields.has(field)) {
        const sf = node.getSourceFile(), line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        let scope = node;
        while (scope.parent && !ts.isFunctionDeclaration(scope)) scope = scope.parent;
        const readOwner = ts.isFunctionDeclaration(scope) ? keyOf(scope) : owner;
        reads.set(`${rel(node)}:${node.getStart()}`, { owner: readOwner, file: rel(node), line, field, expression: node.getText() });
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration);
  }
  return { declarations, edges, reads: [...reads.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) };
}
const subscribers = routes.filter(route => route.enabled && route.kind === 'subscriber' && route.page);
const subscriber = graph(subscribers.map(route => route.page));
const internal = graph(subscribers.map(route => route.page), true);
const admin = graph(routes.filter(route => route.enabled && route.kind === 'admin').map(route => route.page), true);
const authority = 'src/lib/subscriberReportContract.ts#getSubscriberReportProjection';

// Exact executable read-site inventory, not file exemptions. Each entry records
// why a raw read remains; new expressions/owners or duplicate sites require review.
const readerInventory = new Map();
function inventory(owner, expressions, classification) {
  for (const [expression, maxSites = 1] of expressions.map(value => Array.isArray(value) ? value : [value])) {
    readerInventory.set(`${owner}|${expression}`, { classification, maxSites });
  }
}
inventory(authority, ['ai.canonical_decision', 'ai.content_publish_gate', ['ai.report_status', 2],
  'canonical.confidence_score', 'ai.closing_verification_v2', 'ai.closing_verification'], 'central-wire-authority');
inventory('src/lib/canonicalNarrative.ts#buildTodayFocus', ['ai.canonical_decision'], 'published-prose-only');
inventory('src/lib/morningAlphaReportAdapter.ts#normalizeMorningAlphaReport', [
  '(ai as Record<string, unknown>).content_publish_gate', "grabObj(ai, 'content_publish_gate')"], 'internal-diagnostic-copy');
inventory('src/lib/premiumContentAvailability.ts#resolvePremiumContentAvailability',
  ['ai.premium_content_status'], 'independent-premium-qualifier-not-market-publication');
inventory('src/services/reportService.ts#mapRowToReport',
  ['canonical_decision', 'content_publish_gate', 'report_status', 'closing_verification_v2', 'closing_verification']
    .flatMap(field => [`row.${field}`, `ai?.${field}`]), 'transport-copy-not-state-decision');
inventory('src/services/openingRadarService.ts#mapRowToOpeningRadar', ['row.confidence_score', 'radar.confidence_score'],
  'executed-legacy-compatibility-score-not-rendered-subscriber-confidence');
inventory('src/utils/aiStrategyParser.ts#parseV8BeneficiaryChain', ['row.confidence_score'],
  'executed-legacy-v8-score-not-rendered-subscriber-confidence');
inventory('src/utils/aiStrategyParser.ts#parseAIStrategy', ["grabNum(fsRaw, 'confidence_score', 0)",
  "grabObj(ai, 'closing_verification_v2')", "grabObj(ai, 'content_publish_gate')"], 'executed-compatibility-parser-not-state-authority');

test('graph discovers actual enabled routes, redirects and disabled product entrypoints', () => {
  assert.equal(routes.find(route => route.path === '/alpha-coach').enabled, false);
  assert.equal(routes.find(route => route.path === '/learn').enabled, true);
  for (const path of ['/dashboard', '/strategist']) {
    assert.equal(routes.find(route => route.path === path).redirect, '/account');
    assert.equal(routes.find(route => route.path === path).page, undefined);
  }
  assert.ok(routes.some(route => route.path === '/admin/publish' && route.kind === 'admin'));
  assert.ok(routes.some(route => route.path === '/verification' && route.kind === 'subscriber'));
});

test('every active market subscriber route reaches the real central projection through executable symbols', () => {
  for (const path of ['/', '/report/today', '/opportunities', '/member-note', '/war-room', '/verification',
    '/performance', '/reports', '/reports/:reportDate']) {
    const entry = routes.find(route => route.path === path);
    assert.ok(entry?.enabled && entry.page, path);
    assert.ok(graph([entry.page]).declarations.has(authority), `${path} does not reach ${authority}`);
  }
});

test('orphan legacy state interpreters are not executable subscriber paths despite shared utility imports', () => {
  for (const key of [
    'src/services/narrativeBuilder.ts#buildHomeSummary',
    'src/services/narrativeBuilder.ts#buildObservationNarrative',
    'src/services/narrativeBuilder.ts#buildVerificationNarrative',
    'src/services/memberNotebookEngine.ts#generateMemberNotebook',
    'src/services/intradayTrackingResolver.ts#resolveIntradayTrackingState',
    'src/services/safeMarketBias.ts#getSafeMarketBias',
    'src/lib/closingVerificationState.ts#resolveClosingVerificationState',
  ]) assert.equal(subscriber.declarations.has(key), false, `Legacy interpreter became active: ${key}`);
  assert.equal([...subscriber.declarations.keys()].some(key => /\/dashboard\/Dashboard/.test(key)), false);
  assert.ok(subscriber.declarations.has('src/services/narrativeBuilder.ts#getSentimentColor'));
  assert.ok(subscriber.declarations.has('src/services/narrativeBuilder.ts#formatTaipeiDateTime'));
});

test('Voice raw script generation is specifically behind the server-entitlement mount edge, not a file exemption', () => {
  assert.ok(subscriber.declarations.has(guardedEdge.from));
  assert.equal(subscriber.declarations.has(guardedEdge.to), false);
  assert.ok(internal.declarations.has(guardedEdge.to));
  assert.ok(internal.declarations.has('src/services/voiceScriptEngine.ts#generateVoiceScript'));
  assert.equal(subscriber.declarations.has('src/services/voiceScriptEngine.ts#generateVoiceScript'), false);
  const voice = subscriber.declarations.get(guardedEdge.from).getText();
  assert.match(voice, /await getCurrentEntitlement\(\)/);
  assert.match(voice, /setAuthorized\(entitlement\.isLoggedIn && entitlement\.isAdmin\)/);
  assert.match(voice, /if \(checking \|\| !authorized\) return/);
  assert.ok(voice.indexOf('if (checking || !authorized) return') < voice.indexOf('return <InternalVoicePage />'));
  for (const [from, targets] of internal.edges) {
    if (targets.has(guardedEdge.to)) assert.equal(from, guardedEdge.from, 'new unreviewed entry to internal voice');
  }
});

test('active compatibility eligibility and performance entries use the named projection adapters', () => {
  for (const symbol of ['src/lib/premiumContentAvailability.ts#resolvePremiumContentAvailability',
    'src/lib/subscriberOpportunities.ts#getSubscriberOpportunityList',
    'src/lib/performanceJournalProjection.ts#selectPublicPerformanceRows']) {
    assert.ok(subscriber.declarations.has(symbol), symbol);
    assert.ok(graph([subscriber.declarations.get(symbol)]).declarations.has(authority), symbol);
  }
  const performance = readFileSync(resolve(root, 'src/pages/performance/page.tsx'), 'utf8');
  assert.doesNotMatch(performance, /reportSelectionScore|shouldPreferReport|buildReportRecordFromPublicRow/);
  assert.match(performance, /callGetReportHistory\(30\)/);
  assert.doesNotMatch(performance, /get_public_performance_journal/);
  assert.doesNotMatch(performance, /\.from\(['"]reports['"]\)/);
});

test('every active raw-reader candidate has an exact reviewed purpose; no blanket file exclusions', () => {
  const counts = new Map();
  for (const read of subscriber.reads) {
    const key = `${read.owner}|${read.expression}`, known = readerInventory.get(key);
    assert.ok(known, `Unclassified active raw reader ${read.file}:${read.line} ${read.owner}: ${read.expression}`);
    counts.set(key, (counts.get(key) || 0) + 1);
    assert.ok(counts.get(key) <= known.maxSites, `Additional active raw read site needs review: ${key}`);
  }
  // This intentionally does not assert raw reads == 0. Compatibility parsers
  // still execute, and the central resolver necessarily reads wire contracts.
  assert.ok(subscriber.reads.some(read => read.owner === authority));
});

if (process.env.MA_SUBSCRIBER_GRAPH === '1') {
  console.log(JSON.stringify({
    routes: routes.map(({ page, ...route }) => ({ ...route, entry: page ? keyOf(page) : null })),
    subscriberSymbols: subscriber.declarations.size,
    subscriberFiles: [...new Set([...subscriber.declarations.values()].map(rel))].sort(),
    subscriberRawReadCandidates: subscriber.reads.map(read => ({ ...read,
      classification: readerInventory.get(`${read.owner}|${read.expression}`)?.classification || 'UNCLASSIFIED' })),
    internalOnlyRawReadCandidates: internal.reads.filter(read => !subscriber.reads.some(item => item.file === read.file && item.line === read.line && item.field === read.field)),
    adminSymbols: admin.declarations.size,
  }, null, 2));
}
