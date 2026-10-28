#!/usr/bin/env node
/** Browser emulation evidence only. It never grants a release approval. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROFILES = [
  { name: 'compact-360', viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'phone-390', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'phone-412', viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'landscape-844', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: 'tablet-1024', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const UNVERIFIED = [
  'Physical device hardware, vendor OS differences, thermal throttling and real device performance.',
  'TapTap Android client/WebView, real rewarded ads and server-side leaderboard correctness.',
  'Human review of visual clarity, canvas controls, overlap and whether interactions make sense.',
  'Release package/source identity, latest store artwork, published version and update-post topics.',
];
const HELP = `Browser emulation matrix (no physical-device or release approval)

Usage:
  node browser-matrix.mjs --project /absolute/game-repo --url http://127.0.0.1:5173 --out /absolute/new-output
  node browser-matrix.mjs ... --scenario /absolute/game-repo/scripts/mobile-scenario.mjs
  node browser-matrix.mjs --profiles

Options:
  --project PATH       Resolve an existing playwright or @playwright/test from this project.
  --url URL            HTTP(S) loopback URL; remote URLs/requests require --allow-remote.
  --out PATH           New or empty output directory. Evidence is runtime data, not source.
  --scenario PATH      Absolute local .mjs module exporting a default async function.
                       Receives { page, profile, outputDir }; returns:
                       { checks: [{ name, passed: boolean, detail? }], covered: [string], unverified?: [string] }
                       At least one check and covered item are required. Throwing fails the profile.
  --profiles [NAMES]   Print profiles, or select comma-separated profile names.
  --allow-remote       Explicitly allow external HTTP(S)/WebSocket requests. May contact production.
  --headed             Show a fresh Chromium window (never reuses a logged-in user browser).
  --timeout-ms N       Per-action/navigation timeout (default 20000, max 120000).
                       Also bounds layout diagnostics; cleanup uses 1000–5000ms.
  --scenario-timeout-ms N Total time per scenario (default 120000, max 900000).
  --settle-ms N        Observe after navigation and scenario (default 1500, max 30000).
  --version-label TEXT Optional expected build label; actual served-build match remains unverified.
  --help               Print this help.

Exit: 0 = SMOKE_PASS or SCENARIO_PASS in browser emulation only; 1 = observed failure;
      2 = configuration/dependency error. Every report has releaseGate: NOT_EVALUATED.
Profiles describe viewport/touch/DPR settings, not branded physical devices.
SCENARIO_PASS only covers the project-defined checks actually returned by the scenario.
`;

function parseArgs(args) {
  const options = { timeoutMs: 20000, scenarioTimeoutMs: 120000, settleMs: 1500, allowRemote: false, headed: false };
  const values = new Map([
    ['--project', 'project'], ['--url', 'url'], ['--out', 'out'], ['--scenario', 'scenario'],
    ['--timeout-ms', 'timeoutMs'], ['--scenario-timeout-ms', 'scenarioTimeoutMs'], ['--settle-ms', 'settleMs'], ['--version-label', 'versionLabel'],
  ]);
  for (let i = 0; i < args.length; i++) {
    const [flag, ...rest] = args[i].split('=');
    const inline = rest.length ? rest.join('=') : undefined;
    if (flag === '--help') options.help = true;
    else if (flag === '--allow-remote') options.allowRemote = true;
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--profiles') {
      if (inline !== undefined) options.profileNames = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('--')) options.profileNames = args[++i];
      else options.listProfiles = true;
    } else if (values.has(flag)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      options[values.get(flag)] = value;
    } else throw new Error(`Unknown option: ${flag}. Use --help.`);
  }
  for (const [key, min, max] of [['timeoutMs', 100, 120000], ['scenarioTimeoutMs', 100, 900000], ['settleMs', 0, 30000]]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}.`);
    }
  }
  return options;
}

function loopback(hostname) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return `${url.protocol}[omitted]`;
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[redacted]');
    return url.toString();
  } catch { return '[invalid URL]'; }
}

function cleanText(value) {
  return String(value)
    .replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, (url) => safeUrl(url))
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|secret|cookie|signature|session[_-]?id|token|auth)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]')
    .slice(0, 6000);
}

function cleanValue(value, depth = 0) {
  if (depth > 10) return '[depth omitted]';
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.slice(0, 1000).map((entry) => cleanValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 1000).map(([key, entry]) => [key, cleanValue(entry, depth + 1)]));
  }
  return value;
}

async function json(file, value) {
  await writeFile(file, `${JSON.stringify(cleanValue(value), null, 2)}\n`, { mode: 0o600 });
}

function git(project, args) {
  try { return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); }
  catch { return null; }
}

async function sourceInfo(project) {
  let manifest = null;
  try {
    const parsed = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
    manifest = { name: parsed.name ?? null, version: parsed.version ?? null };
  } catch { /* package metadata is optional; Git still identifies the source checkout. */ }
  const status = git(project, ['status', '--porcelain=v1', '--untracked-files=normal']);
  return {
    project, gitRoot: git(project, ['rev-parse', '--show-toplevel']),
    commit: git(project, ['rev-parse', 'HEAD']), branch: git(project, ['branch', '--show-current']),
    dirty: status === null ? null : status.length > 0,
    changedPathCount: status === null ? null : status.split('\n').filter(Boolean).length,
    package: manifest,
    servedArtifactMatch: 'UNVERIFIED: --project identifies source only; the URL may serve another build.',
  };
}

async function loadPlaywright(project) {
  const requireFromProject = createRequire(path.join(project, 'package.json'));
  const errors = [];
  for (const specifier of ['playwright', '@playwright/test']) {
    try {
      const modulePath = requireFromProject.resolve(specifier);
      const imported = await import(pathToFileURL(modulePath).href);
      const api = imported.chromium ? imported : imported.default;
      if (!api?.chromium) throw new Error('The resolved module does not export chromium.');
      let version = null;
      try { version = requireFromProject(`${specifier}/package.json`).version; } catch { /* optional */ }
      return { api, dependency: { specifier, modulePath, version } };
    } catch (error) { errors.push(`${specifier}: ${error.code ?? error.message}`); }
  }
  throw new Error(`No usable Playwright in --project. This runner does not install dependencies. Restore that game's lockfile dependencies, then install its matching Chromium with its local Playwright CLI. Resolution: ${errors.join('; ')}`);
}

async function prepareOutput(outputDir) {
  await mkdir(path.dirname(outputDir), { recursive: true });
  try { await mkdir(outputDir, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await readdir(outputDir)).length) throw new Error('--out must be a new or empty directory; previous evidence will not be overwritten.');
  }
}

function record(events, key, value) {
  events.counts[key] = (events.counts[key] ?? 0) + 1;
  if (events[key].length < 300) events[key].push(cleanValue(value));
  else events.dropped[key] = (events.dropped[key] ?? 0) + 1;
}

async function withTimeout(operation, milliseconds, stageLabel = 'Scenario') {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${stageLabel} exceeded its ${milliseconds}ms time limit.`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function closeOwnedBrowser(browser, server, milliseconds) {
  const failures = [];
  if (browser) {
    try { await withTimeout(browser.close(), milliseconds, 'Browser connection close'); }
    catch (error) { failures.push(cleanText(error.message)); }
  }
  if (!server) return failures;
  try { await withTimeout(server.close(), milliseconds, 'Owned browser process close'); }
  catch (error) {
    failures.push(cleanText(error.message));
    try { await withTimeout(server.kill(), milliseconds, 'Owned browser process kill'); }
    catch (killError) {
      failures.push(cleanText(killError.message));
      // This ChildProcess came directly from this launchServer call. Never look
      // up or terminate another browser/process, and do not use private APIs.
      const child = server.process();
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL'); }
        catch (fallbackError) { failures.push(`Owned process fallback failed: ${cleanText(fallbackError.message)}`); }
      }
    }
  }
  return failures;
}

async function layoutDiagnostics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return Object.fromEntries(['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'].map((key) => [key, Math.round(rect[key] * 100) / 100]));
    };
    const controls = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],a[href]')]
      .filter(visible).slice(0, 500).map((element) => {
        const rect = rectOf(element);
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const centerInViewport = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
        const top = centerInViewport ? document.elementFromPoint(x, y) : null;
        return {
          tag: element.tagName.toLowerCase(), id: element.id,
          label: (element.getAttribute('aria-label') || element.textContent || element.value || '').trim().slice(0, 100),
          rect, disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
          smallerThan44CssPx: rect.width < 44 || rect.height < 44,
          outsideViewport: rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1,
          centerHitObstructed: centerInViewport && top !== null && top !== element && !element.contains(top),
          obstructedBy: top && top !== element && !element.contains(top) ? `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}` : null,
        };
      });
    const canvases = [...document.querySelectorAll('canvas')].filter(visible).map((element) => {
      const rect = rectOf(element);
      return { rect, backingWidth: element.width, backingHeight: element.height,
        backingScaleX: element.width / rect.width, backingScaleY: element.height / rect.height,
        review: 'Manual review required: canvas controls, clarity, overlap and GPU/performance are not inferred from pixels.' };
    });
    const images = [...document.images].filter(visible).slice(0, 500).map((element) => ({
      source: element.currentSrc, rect: rectOf(element), complete: element.complete,
      naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight,
    }));
    const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0);
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touchPoints: navigator.maxTouchPoints },
      documentWidth, horizontalOverflowPx: Math.max(0, documentWidth - innerWidth),
      controls, canvases, images,
      diagnosticLimits: ['Only visible DOM controls at capture time are inspected; other screens need scenario coverage.',
        'Control size, viewport clipping and center hit tests are review hints; scrolling, overlays or intentional layouts can explain them.',
        'No automatic visual-clearance judgement is made from screenshots or canvas backing size.'],
    };
  });
}

function validateScenarioResult(value) {
  if (!value || !Array.isArray(value.checks) || value.checks.length === 0 ||
      value.checks.some((check) => !check || typeof check.name !== 'string' || !check.name.trim() || typeof check.passed !== 'boolean') ||
      !Array.isArray(value.covered) || value.covered.length === 0 || value.covered.some((entry) => typeof entry !== 'string' || !entry.trim()) ||
      (value.unverified !== undefined && (!Array.isArray(value.unverified) || value.unverified.some((entry) => typeof entry !== 'string')))) {
    throw new Error('Scenario must return { checks: [{ name, passed: boolean, detail? }], covered: [nonempty string], unverified?: [string] }. No functional coverage is inferred from a completed function.');
  }
  return { checks: value.checks, covered: value.covered, unverified: value.unverified ?? [] };
}

async function runProfile(browser, profile, options, scenario) {
  const outputDir = path.join(options.out, profile.name);
  await mkdir(outputDir, { mode: 0o700 });
  const result = { profile, evidenceType: 'BROWSER_EMULATION', status: 'FAIL', failures: [], warnings: [], scenario: null,
    screenshots: [], eventsFile: `${profile.name}/events.json`, diagnosticsFile: `${profile.name}/diagnostics.json` };
  const events = { console: [], pageErrors: [], failedRequests: [], httpErrors: [], blockedRequests: [], counts: {}, dropped: {} };
  const { name: _name, ...contextOptions } = profile;
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block', acceptDownloads: false });
  let page;
  try {
    if (!options.allowRemote) {
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (['http:', 'https:'].includes(url.protocol) && !loopback(url.hostname)) {
          record(events, 'blockedRequests', { url: safeUrl(url.href), reason: 'External request blocked; use --allow-remote only when intended.' });
          await route.abort('blockedbyclient');
        } else await route.continue();
      });
      if (typeof context.routeWebSocket === 'function') {
        await context.routeWebSocket(/.*/, (socket) => {
          if (loopback(new URL(socket.url()).hostname)) socket.connectToServer();
          else {
            record(events, 'blockedRequests', { url: safeUrl(socket.url()), reason: 'External WebSocket blocked.' });
            socket.close();
          }
        });
      } else result.warnings.push('This Playwright version cannot intercept WebSockets; external WebSocket isolation was not verified.');
    }
    page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);
    page.on('console', (message) => {
      if (message.type() === 'error') events.counts.consoleErrors = (events.counts.consoleErrors ?? 0) + 1;
      record(events, 'console', { type: message.type(), text: message.text(), location: { ...message.location(), url: safeUrl(message.location().url) } });
    });
    page.on('pageerror', (error) => record(events, 'pageErrors', { message: error.message, stack: error.stack }));
    page.on('requestfailed', (request) => record(events, 'failedRequests', { url: safeUrl(request.url()), method: request.method(), resourceType: request.resourceType(), error: request.failure()?.errorText }));
    page.on('response', (response) => {
      if (response.status() >= 400) record(events, 'httpErrors', { url: safeUrl(response.url()), status: response.status(), resourceType: response.request().resourceType() });
    });
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(options.settleMs);
    await page.screenshot({ path: path.join(outputDir, 'initial.png'), animations: 'disabled', timeout: options.timeoutMs });
    result.screenshots.push(`${profile.name}/initial.png`);
    if (scenario) {
      result.scenario = validateScenarioResult(await withTimeout(scenario({ page, profile: structuredClone(profile), outputDir }), options.scenarioTimeoutMs));
      for (const check of result.scenario.checks) if (!check.passed) result.failures.push(`Scenario: ${check.name}`);
      await page.waitForTimeout(options.settleMs);
    }
  } catch (error) {
    result.failures.push(cleanText(error.stack ?? error.message));
  } finally {
    if (page && !page.isClosed()) {
      try {
        await page.screenshot({ path: path.join(outputDir, 'final.png'), animations: 'disabled', timeout: options.timeoutMs });
        result.screenshots.push(`${profile.name}/final.png`);
      } catch (error) { result.failures.push(`Final screenshot failed: ${cleanText(error.message)}`); }
      try {
        const diagnostics = await withTimeout(layoutDiagnostics(page), options.timeoutMs, 'Layout diagnostics');
        await json(path.join(outputDir, 'diagnostics.json'), diagnostics);
        if (diagnostics.horizontalOverflowPx > 2) result.failures.push(`Horizontal document overflow: ${diagnostics.horizontalOverflowPx}px.`);
        if (Math.abs(diagnostics.viewport.width - profile.viewport.width) > 2) result.failures.push(`Layout viewport width ${diagnostics.viewport.width}px differs from configured ${profile.viewport.width}px; inspect the viewport meta tag or horizontal layout.`);
        const small = diagnostics.controls.filter((control) => control.smallerThan44CssPx).length;
        const clipped = diagnostics.controls.filter((control) => control.outsideViewport).length;
        const obstructed = diagnostics.controls.filter((control) => control.centerHitObstructed).length;
        if (small || clipped || obstructed) result.warnings.push(`DOM control review: ${small} smaller than 44 CSS px, ${clipped} outside viewport, ${obstructed} obstructed at center. These hints require review.`);
        if (diagnostics.canvases.length) result.warnings.push(`${diagnostics.canvases.length} visible canvas(es): manual interaction/clarity review is required.`);
      } catch (error) {
        await json(path.join(outputDir, 'diagnostics.json'), { error: cleanText(error.message), collected: false });
        result.failures.push(`Layout diagnostics failed: ${cleanText(error.message)}`);
      }
    } else {
      await json(path.join(outputDir, 'diagnostics.json'), { collected: false, reason: 'Page was not available.' });
    }
    try { await withTimeout(context.close(), options.cleanupTimeoutMs, 'Browser context close'); }
    catch (error) { result.failures.push(`Context close failed: ${cleanText(error.message)}`); }
    await json(path.join(outputDir, 'events.json'), events);
  }
  const consoleErrors = events.counts.consoleErrors ?? 0;
  if (consoleErrors) result.failures.push(`${consoleErrors} console error(s).`);
  if (events.counts.pageErrors) result.failures.push(`${events.counts.pageErrors} uncaught page error(s).`);
  if (events.counts.failedRequests) result.failures.push(`${events.counts.failedRequests} failed request(s).`);
  if (events.counts.httpErrors) result.failures.push(`${events.counts.httpErrors} HTTP 4xx/5xx response(s).`);
  if (events.counts.blockedRequests) result.failures.push(`${events.counts.blockedRequests} external request(s) blocked by local-only policy.`);
  if (Object.keys(events.dropped).length) result.warnings.push('Event limit reached; inspect events.json dropped counts.');
  result.status = result.failures.length ? 'FAIL' : scenario ? 'SCENARIO_PASS' : 'SMOKE_PASS';
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  if (options.listProfiles) { process.stdout.write(`${JSON.stringify(PROFILES, null, 2)}\n`); return; }
  for (const name of ['project', 'url', 'out']) if (!options[name]) throw new Error(`--${name} is required. Use --help.`);
  options.project = path.resolve(options.project);
  options.out = path.resolve(options.out);
  options.cleanupTimeoutMs = Math.min(5000, Math.max(1000, options.timeoutMs));
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--url must use HTTP(S).');
  if (url.username || url.password) throw new Error('--url must not contain credentials. Use a fresh local test session.');
  if (!loopback(url.hostname) && !options.allowRemote) throw new Error('Remote URL refused. Use a loopback test server, or explicitly add --allow-remote.');
  const names = options.profileNames?.split(',').map((entry) => entry.trim());
  if (names?.some((name) => !PROFILES.some((profile) => profile.name === name))) throw new Error('Unknown profile name. Use --profiles to list available profiles.');
  const profiles = names ? PROFILES.filter((profile) => names.includes(profile.name)) : PROFILES;
  let scenario = null;
  let scenarioIdentity = null;
  if (options.scenario) {
    if (!path.isAbsolute(options.scenario) || path.extname(options.scenario) !== '.mjs') throw new Error('--scenario must be an absolute local .mjs path.');
    scenarioIdentity = { path: options.scenario, sha256: createHash('sha256').update(await readFile(options.scenario)).digest('hex') };
    scenario = (await import(pathToFileURL(options.scenario).href)).default;
    if (typeof scenario !== 'function') throw new Error('Scenario module must default-export an async function.');
  }
  await prepareOutput(options.out);
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null, status: 'ERROR',
    evidenceType: 'BROWSER_EMULATION', releaseGate: 'NOT_EVALUATED',
    targetUrl: safeUrl(options.url), networkPolicy: options.allowRemote ? 'REMOTE_EXPLICITLY_ALLOWED' : 'LOOPBACK_ONLY_HTTP_AND_SUPPORTED_WEBSOCKETS',
    source: await sourceInfo(options.project), expectedVersionLabel: options.versionLabel ?? null,
    runner: { path: SCRIPT_PATH, sha256: createHash('sha256').update(await readFile(SCRIPT_PATH)).digest('hex'), nodeVersion: process.version },
    scenario: scenarioIdentity, coverageScope: scenario ? 'Only returned project scenario checks plus browser smoke diagnostics.' : 'Navigation, runtime/network errors, DOM diagnostics and screenshots only. No gameplay assertions.',
    unverified: [...UNVERIFIED, ...(!scenario ? ['All functional gameplay paths: no project scenario supplied.'] : [])],
    profiles: [],
  };
  try {
    const { api, dependency } = await loadPlaywright(options.project);
    report.playwright = dependency;
    for (const profile of profiles) {
      let browser;
      let server;
      let result;
      try {
        try { server = await api.chromium.launchServer({ headless: !options.headed, host: '127.0.0.1', timeout: options.timeoutMs }); }
        catch (error) {
          const launchError = new Error(`Chromium launch failed. Install the matching browser using the game's existing local Playwright CLI (for example: node node_modules/playwright/cli.js install chromium, from --project), and verify OS requirements. No browser was installed by this runner. ${cleanText(error.message)}`);
          launchError.configurationFailure = true;
          throw launchError;
        }
        try { browser = await api.chromium.connect(server.wsEndpoint(), { timeout: options.timeoutMs }); }
        catch { throw new Error('Could not connect to this runner\'s new loopback-only browser within the action timeout.'); }
        report.browser = { engine: 'chromium', version: browser.version(), freshBrowserPerProfile: true, freshContextPerProfile: true, emulatedBrand: null };
        result = await runProfile(browser, profile, options, scenario);
      } catch (error) {
        result = { profile, evidenceType: 'BROWSER_EMULATION', status: 'FAIL', configurationFailure: error.configurationFailure === true, failures: [cleanText(error.stack ?? error.message)], warnings: [], scenario: null, screenshots: [] };
      } finally {
        const cleanupFailures = await closeOwnedBrowser(browser, server, options.cleanupTimeoutMs);
        if (cleanupFailures.length) {
          result.failures.push(...cleanupFailures);
          result.status = 'FAIL';
        }
      }
      report.profiles.push(result);
      process.stdout.write(`${profile.name}: ${result.status}\n`);
    }
    report.status = report.profiles.some((result) => result.configurationFailure) ? 'ERROR' : report.profiles.some((result) => result.status === 'FAIL') ? 'FAIL' : scenario ? 'SCENARIO_PASS' : 'SMOKE_PASS';
    process.exitCode = report.status === 'ERROR' ? 2 : report.status === 'FAIL' ? 1 : 0;
  } catch (error) {
    report.error = cleanText(error.stack ?? error.message);
    process.stderr.write(`${cleanText(error.message)}\n`);
    process.exitCode = 2;
  } finally {
    report.finishedAt = new Date().toISOString();
    await json(path.join(options.out, 'report.json'), report);
    process.stdout.write(`Report: ${path.join(options.out, 'report.json')}\n${report.status}; releaseGate=NOT_EVALUATED (browser emulation only).\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${cleanText(error.message)}\n`);
  process.exitCode = 2;
});
