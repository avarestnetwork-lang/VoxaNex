import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdPlacementBox } from '../src/components/ads/AdPlacementBox';
import { AD_PLACEMENT_CONFIG } from '../src/services/ads/adConfig';
import { fitsSidePlacement, fitsVerticalPlacement, hasUsableChatroomSize, MIN_CHATROOM_HEIGHT, MIN_CHATROOM_WIDTH } from '../src/services/ads/adLayout';
import { acquireAdFill, mountAdCreative, rejectAdLayout, requestAdFill, toAdRenderState } from '../src/services/ads/adRuntime';
import { createAdProviderRegistry } from '../src/services/ads/adProviderRegistry';
import { createDomScriptInjector, createProviderScriptLoader } from '../src/services/ads/providerScriptLoader';
import { AD_PLACEMENT_IDS, AdPlacementId, AdProviderAdapter, AdProviderResult } from '../src/services/ads/adTypes';

const assertEqual = (actual: unknown, expected: unknown, message: string) => assert.equal(actual, expected, message);

class FakeScriptElement {
  dataset: Record<string, string | undefined> = {};
  src = '';
  async = false;
  isConnected = false;
  readyState?: string;
  removeCount = 0;
  onRemove?: () => void;
  private listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type));
  }

  remove(): void {
    this.removeCount += 1;
    this.isConnected = false;
    this.onRemove?.();
  }
}

class FakeDocument {
  baseURI = 'https://chatlustora.test/';
  scripts: FakeScriptElement[] = [];
  createdScripts: FakeScriptElement[] = [];
  appendCount = 0;
  head = {
    appendChild: (element: HTMLScriptElement) => {
      const script = element as unknown as FakeScriptElement;
      this.appendCount += 1;
      script.isConnected = true;
      this.scripts.push(script);
      return element;
    },
  };

  createElement(_tagName: string): HTMLScriptElement {
    const script = new FakeScriptElement();
    this.createdScripts.push(script);
    script.onRemove = () => { this.scripts = this.scripts.filter((item) => item !== script); };
    return script as unknown as HTMLScriptElement;
  }

  addExisting(script: FakeScriptElement): void {
    script.isConnected = true;
    script.onRemove = () => { this.scripts = this.scripts.filter((item) => item !== script); };
    this.scripts.push(script);
  }
}

function domLoader(documentRef: FakeDocument, timeoutMs = 100) {
  return createProviderScriptLoader(createDomScriptInjector(() => documentRef as unknown as Document, timeoutMs));
}

async function main() {
  assert.deepEqual(AD_PLACEMENT_IDS, [
    'public-chatroom-top', 'public-chatroom-left', 'public-chatroom-right', 'public-chatroom-bottom',
  ], 'the four public chatroom placements are registered');

  for (const slotId of AD_PLACEMENT_IDS) {
    assertEqual(AD_PLACEMENT_CONFIG[slotId].enabled, false, `${slotId} remains disabled without verified account setup`);
    assert.deepEqual(AD_PLACEMENT_CONFIG[slotId].providerPriority, [], `${slotId} has no invented provider selection`);
    assertEqual(
      renderToStaticMarkup(React.createElement(AdPlacementBox, { slotId })),
      '',
      `${slotId} emits no wrapper or reserved space while disabled`,
    );
  }

  assertEqual(
    renderToStaticMarkup(React.createElement(AdPlacementBox, { slotId: 'unsupported-placement' as AdPlacementId })),
    '',
    'unsupported placements emit nothing',
  );

  const page = readFileSync('src/pages/PublicChatPage.tsx', 'utf8');
  assert.match(page, /slotId="public-chatroom-top"/);
  assert.match(page, /slotId="public-chatroom-left"/);
  assert.match(page, /slotId="public-chatroom-right"/);
  assert.match(page, /slotId="public-chatroom-bottom"/);
  assert.match(page, /className="flex-1 flex gap-3 overflow-hidden min-h-0" data-ad-workspace/);
  assert.match(page, /className="flex-1 flex flex-col overflow-hidden border border-slate-800 rounded-2xl bg-\[#090d18\] relative shadow-2xl min-w-0" data-chatroom-core/);
  assert.match(page, /max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4 h-\[calc\(100vh-5\.5rem\)\] min-h-\[580px\] flex flex-col/);
  assert.match(page, /data-ad-page/);
  assert.match(page, /data-chatroom-core/);
  const placementSource = readFileSync('src/components/ads/AdPlacementBox.tsx', 'utf8');
  assert.match(placementSource, /min-\[1440px\]:flex/);
  assert.match(placementSource, /max-w-full overflow-hidden/);
  assert.match(placementSource, /new ResizeObserver\(checkLayout\)/);
  assert.match(placementSource, /window\.addEventListener\('resize', checkLayout\)/);

  const indexHtml = readFileSync('index.html', 'utf8');
  const headHtml = indexHtml.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  assert.match(headHtml, /<meta name="juicyads-site-verification" content="97a6aeec522d11d21efa5f84c86eb958">/);
  assert.match(headHtml, /<meta name="6a97888e-site-verification" content="28befc4532cb8837aa59edffca607a5a">/);
  assert.match(headHtml, /google-adsense-account/);
  assert.match(headHtml, /yandex-verification/);

  const suppliedMonetagWorker = [
    'self.options = {',
    '    "domain": "3nbf4.com",',
    '    "zoneId": 12234857',
    '}',
    'self.lary = ""',
    "importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw')",
  ].join('\n');
  assert.equal(readFileSync('public/sw.js', 'utf8').replace(/\r\n/g, '\n').trimEnd(), suppliedMonetagWorker, 'public root worker matches the publisher-supplied content exactly');
  assert.equal(existsSync('public/28befc4532cb8837aa59edffca607a5.html'), false, 'no ExoClick verification file is fabricated');
  assert.doesNotMatch(readFileSync('src/main.tsx', 'utf8'), /serviceWorker\.register/);
  assert.match(readFileSync('wrangler.toml', 'utf8'), /directory\s*=\s*"\.\/dist"/);
  assert.match(readFileSync('wrangler.toml', 'utf8'), /run_worker_first\s*=\s*true/);
  assert.match(readFileSync('src/worker.ts', 'utf8'), /const assetRes = await env\.ASSETS\.fetch\(request\);[\s\S]*?return assetRes;/);

  assertEqual(MIN_CHATROOM_WIDTH, 720, 'side placements preserve the configured minimum chatroom width');
  assertEqual(MIN_CHATROOM_HEIGHT, 580, 'top/bottom placements preserve the existing page minimum height');
  assert.equal(fitsSidePlacement(1232, 160, false, true), true, 'max-width workspace allows two narrow side fills while retaining center width');
  assert.equal(fitsSidePlacement(1232, 300, false, true), false, 'a large viewport does not make a wide side fill fit the max-width workspace');
  assert.equal(fitsSidePlacement(950, 120, false, false), true, 'laptop geometry uses the measured chatroom width');
  assert.equal(fitsSidePlacement(800, 100, false, false), false, 'tablet geometry hides side ads when the center would be too narrow');
  assert.equal(fitsSidePlacement(390, 100, false, false), false, 'mobile geometry rejects side ads');
  assert.equal(fitsVerticalPlacement(640, 50, false, false), true, 'mobile top/bottom units can fit when actual chat height remains usable');
  assert.equal(fitsVerticalPlacement(800, 90, false, true), true, 'desktop top and bottom fills account for both placements');
  assert.equal(fitsVerticalPlacement(750, 90, false, true), false, 'tablet height rejects two fills that would reduce chat height');
  assert.equal(fitsVerticalPlacement(700, 90, false, false), true, 'single vertical placement is checked against measured chat height');
  assert.equal(fitsVerticalPlacement(700, 90, false, true), false, 'a second configured vertical fill is reserved before either request commits');
  assert.equal(fitsSidePlacement(950, 120, true, false), true, 'an already-filled opposite side is accounted for in the measured chatroom width');
  assert.equal(hasUsableChatroomSize(720, 580), true, 'exact minimum chat dimensions are accepted');
  assert.equal(hasUsableChatroomSize(719, 580), false, 'chatroom width below minimum triggers placement removal');

  const disabledRegistry = createAdProviderRegistry([]);
  const noAdapters = disabledRegistry.select('public-chatroom-top');
  assert.deepEqual(noAdapters, [], 'disabled config does not select a provider');

  let missingProviderCalls = 0;
  const neverCalled: AdProviderAdapter = {
    id: 'disabled-provider',
    supportsPlacement: () => true,
    mount: async () => { missingProviderCalls += 1; return { status: 'no-fill' }; },
  };
  const disabledResult = await requestAdFill('public-chatroom-top', AD_PLACEMENT_CONFIG['public-chatroom-top'], [neverCalled], async () => {});
  assert.equal(disabledResult.status, 'no-fill');
  assertEqual(missingProviderCalls, 0, 'disabled placements do not request provider ads');
  assertEqual(toAdRenderState(disabledResult, false).status, 'disabled', 'disabled results remain invisible');
  assertEqual(toAdRenderState({ status: 'no-fill' }, true).status, 'no-fill', 'no-fill is not treated as a creative');
  assertEqual(toAdRenderState({ status: 'error' }, true).status, 'error', 'provider errors stay distinguishable from fills');

  const priorityCalls: string[] = [];
  let fallbackCleanupCount = 0;
  const noFillAdapter: AdProviderAdapter = {
    id: 'first', supportsPlacement: () => true,
    mount: async () => { priorityCalls.push('first'); return { status: 'no-fill', cleanup: () => { fallbackCleanupCount += 1; } }; },
  };
  const fallbackAdapter: AdProviderAdapter = {
    id: 'second', supportsPlacement: () => true,
    mount: async () => { priorityCalls.push('second'); return { status: 'no-fill' }; },
  };
  const registry = createAdProviderRegistry([fallbackAdapter, noFillAdapter]);
  assert.deepEqual(
    registry.select('public-chatroom-top', { enabled: true, providerPriority: ['first', 'second'] }).map((adapter) => adapter.id),
    ['first', 'second'],
    'provider selection follows placement-specific priority, independent of registration order',
  );
  const fallbackResult = await requestAdFill(
    'public-chatroom-top',
    { enabled: true, providerPriority: ['first', 'second'] },
    registry.select('public-chatroom-top', { enabled: true, providerPriority: ['first', 'second'] }),
    async () => {},
  );
  assert.deepEqual(priorityCalls, ['first', 'second'], 'no-fill falls through in configured priority order');
  assert.equal(fallbackResult.status, 'no-fill');
  assert.equal(fallbackCleanupCount, 1, 'provider resources are cleaned before fallback after no-fill');

  const scriptOnlyAdapter: AdProviderAdapter = {
    id: 'script-only',
    supportsPlacement: () => true,
    mount: async ({ loadScript }) => {
      await loadScript('/provider.js');
      return { status: 'no-fill' };
    },
  };
  const scriptOnlyResult = await requestAdFill(
    'public-chatroom-top', { enabled: true, providerPriority: ['script-only'] }, [scriptOnlyAdapter], async () => {},
  );
  assert.equal(scriptOnlyResult.status, 'no-fill', 'a successful script load is not treated as an ad fill');

  let scriptInjectCount = 0;
  let finishScript!: () => void;
  const scriptLoader = createProviderScriptLoader(async () => {
    scriptInjectCount += 1;
    await new Promise<void>((resolve) => { finishScript = resolve; });
  });
  const script1 = scriptLoader('mock-provider', 'https://example.invalid/provider.js');
  const script2 = scriptLoader('mock-provider', 'https://example.invalid/provider.js');
  assertEqual(script1, script2, 'concurrent loads for the same provider share one promise');
  assert.equal(scriptInjectCount, 0, 'injection begins on the next microtask');
  await Promise.resolve();
  assert.equal(scriptInjectCount, 1, 'only one provider script injection occurs');
  await assert.rejects(scriptLoader('mock-provider', 'https://example.invalid/other.js'), /conflicting script URLs/);
  finishScript();
  await script1;

  const loadedDocument = new FakeDocument();
  const loadedBeforehand = new FakeScriptElement();
  loadedBeforehand.src = 'https://chatlustora.test/provider.js';
  loadedBeforehand.dataset.adProviderId = 'already-loaded';
  loadedBeforehand.dataset.adProviderLoaded = 'true';
  loadedDocument.addExisting(loadedBeforehand);
  await domLoader(loadedDocument)('already-loaded', '/provider.js');
  assert.equal(loadedDocument.appendCount, 0, 'a previously loaded, marked script is reused without injection');

  const completedDocument = new FakeDocument();
  const completedBeforehand = new FakeScriptElement();
  completedBeforehand.src = 'https://chatlustora.test/provider.js';
  completedBeforehand.readyState = 'complete';
  completedDocument.addExisting(completedBeforehand);
  await domLoader(completedDocument)('completed-before-loader', '/provider.js');
  assert.equal(completedDocument.appendCount, 0, 'a pre-existing completed script is detected without relying only on readyState');
  assert.equal(completedBeforehand.dataset.adProviderLoaded, 'true');

  const loadingDocument = new FakeDocument();
  const loadingScript = new FakeScriptElement();
  loadingScript.src = 'https://chatlustora.test/provider.js';
  loadingScript.dataset.adProviderId = 'already-loading';
  loadingScript.dataset.adProviderState = 'loading';
  loadingDocument.addExisting(loadingScript);
  const loadingLoader = domLoader(loadingDocument);
  const loadingPromiseA = loadingLoader('already-loading', '/provider.js');
  const loadingPromiseB = loadingLoader('already-loading', '/provider.js');
  assertEqual(loadingPromiseA, loadingPromiseB, 'concurrent calls while an existing script loads share a promise');
  await Promise.resolve();
  assert.equal(loadingDocument.appendCount, 0, 'an existing loading script is not duplicated');
  assert.equal(loadingScript.listenerCount('load'), 1, 'one load listener is attached');
  assert.equal(loadingScript.listenerCount('error'), 1, 'one error listener is attached');
  loadingScript.dispatch('load');
  await loadingPromiseA;
  assert.equal(loadingScript.dataset.adProviderLoaded, 'true', 'the load event settles and marks the existing script');
  assert.equal(loadingScript.listenerCount('load'), 0, 'load listener is removed after settlement');

  const concurrentDocument = new FakeDocument();
  const concurrentLoader = domLoader(concurrentDocument);
  const concurrentA = concurrentLoader('concurrent', '/provider.js');
  const concurrentB = concurrentLoader('concurrent', '/provider.js');
  assertEqual(concurrentA, concurrentB, 'parallel requests for a new provider share the same DOM load');
  await Promise.resolve();
  assert.equal(concurrentDocument.appendCount, 1, 'parallel requests append only one script element');
  concurrentDocument.scripts[0].dispatch('load');
  await Promise.all([concurrentA, concurrentB]);
  await assert.rejects(concurrentLoader('concurrent', '/different.js'), /conflicting script URLs/);

  const failedDocument = new FakeDocument();
  const failedLoader = domLoader(failedDocument);
  const failedPromise = failedLoader('retry-provider', '/provider.js');
  await Promise.resolve();
  const firstFailedScript = failedDocument.scripts[0];
  firstFailedScript.dispatch('error');
  await assert.rejects(failedPromise, /failed to load/);
  assert.equal(firstFailedScript.removeCount, 1, 'a failed script created by this loader is safely removed');
  const retryPromise = failedLoader('retry-provider', '/provider.js');
  await Promise.resolve();
  assert.equal(failedDocument.appendCount, 2, 'failed provider loads can be retried');
  failedDocument.scripts[0].dispatch('load');
  await retryPromise;

  const unownedDocument = new FakeDocument();
  const unownedFailedScript = new FakeScriptElement();
  unownedFailedScript.src = 'https://chatlustora.test/provider.js';
  unownedDocument.addExisting(unownedFailedScript);
  const unownedFailure = domLoader(unownedDocument)('host-owned', '/provider.js');
  await Promise.resolve();
  unownedFailedScript.dispatch('error');
  await assert.rejects(unownedFailure, /failed to load/);
  assert.equal(unownedFailedScript.removeCount, 0, 'host-owned failed scripts are not removed');

  const timeoutDocument = new FakeDocument();
  const timeoutPromise = domLoader(timeoutDocument, 5)('timeout-provider', '/provider.js');
  await assert.rejects(timeoutPromise, /timed out/);
  assert.equal(timeoutDocument.createdScripts[0].removeCount, 1, 'a timed-out script promise settles and its managed element is removed');

  const FakeHTMLElement = class { nodeType = 1; removed = 0; remove() { this.removed += 1; } };
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeHTMLElement });
  const fakeCreative = new FakeHTMLElement() as unknown as HTMLElement;
  let cleanupCount = 0;
  const confirmedFill: AdProviderResult = {
    status: 'filled', creative: fakeCreative, width: 160, height: 600, cleanup: () => { cleanupCount += 1; },
  };
  const filledAdapter: AdProviderAdapter = {
    id: 'mock-fill', supportsPlacement: () => true, mount: async () => confirmedFill,
  };
  const filledLease = acquireAdFill(
    'public-chatroom-left', { enabled: true, providerPriority: ['mock-fill'] }, [filledAdapter], async () => {},
  );
  const filled = await filledLease.promise;
  assertEqual(filled.status, 'filled', 'a provider-confirmed HTMLElement and dimensions can produce a fill state');
  if (filled.status !== 'filled') throw new Error('Expected provider-confirmed mock fill.');
  assertEqual(toAdRenderState(filled, true).status, 'filled', 'only a confirmed fill is renderable');
  let mountedCreative: HTMLElement | null = null;
  const unmountCreative = mountAdCreative({ replaceChildren: (node) => { mountedCreative = node as HTMLElement; } } as unknown as HTMLElement, filled);
  assertEqual(mountedCreative, fakeCreative, 'the confirmed creative is mounted into its host');
  unmountCreative();
  assertEqual((fakeCreative as unknown as InstanceType<typeof FakeHTMLElement>).removed, 1, 'unmount removes the provider element');
  filledLease.release();
  assertEqual(cleanupCount, 1, 'the provider cleanup hook runs when a filled placement is disposed');

  assert.equal(rejectAdLayout(false), true, 'a filled ad that fails measured layout is rejected');
  assert.equal(rejectAdLayout(true), false, 'a fill meeting measured layout constraints is retained');
  let rejectedCleanupCount = 0;
  const rejectedAdapter: AdProviderAdapter = {
    id: 'rejected-layout', supportsPlacement: () => true,
    mount: async () => ({
      status: 'filled', creative: fakeCreative, width: 900, height: 600,
      cleanup: () => { rejectedCleanupCount += 1; },
    }),
  };
  const rejectedLease = acquireAdFill(
    'public-chatroom-right', { enabled: true, providerPriority: ['rejected-layout'] }, [rejectedAdapter], async () => {},
  );
  const rejectedFill = await rejectedLease.promise;
  assert.equal(rejectedFill.status, 'filled');
  assert.equal(rejectAdLayout(false), true);
  rejectedLease.release();
  assert.equal(rejectedCleanupCount, 1, 'a provider fill rejected for layout is disposed through its lease');

  let singleFlightCount = 0;
  let resolveSingleFlight!: (result: AdProviderResult) => void;
  const singleFlightAdapter: AdProviderAdapter = {
    id: 'single-flight', supportsPlacement: () => true,
    mount: () => {
      singleFlightCount += 1;
      return new Promise((resolve) => { resolveSingleFlight = resolve; });
    },
  };
  const enabledConfig = { enabled: true, providerPriority: ['single-flight'] };
  const requestA = requestAdFill('public-chatroom-bottom', enabledConfig, [singleFlightAdapter], async () => {});
  const requestB = requestAdFill('public-chatroom-bottom', enabledConfig, [singleFlightAdapter], async () => {});
  assertEqual(requestA, requestB, 'rerenders during a pending request share one placement request');
  await Promise.resolve();
  assertEqual(singleFlightCount, 1, 'a pending placement request is issued once');
  resolveSingleFlight({ status: 'no-fill' });
  await Promise.all([requestA, requestB]);

  let timeoutSignal: AbortSignal | undefined;
  let finishLateMount!: (result: AdProviderResult) => void;
  let lateCleanupCount = 0;
  const slowAdapter: AdProviderAdapter = {
    id: 'slow-provider',
    supportsPlacement: () => true,
    mount: ({ signal }) => {
      timeoutSignal = signal;
      return new Promise((resolve) => { finishLateMount = resolve; });
    },
  };
  const timedOut = await requestAdFill(
    'public-chatroom-top', { enabled: true, providerPriority: ['slow-provider'] }, [slowAdapter], async () => {}, 5,
  );
  assert.equal(timedOut.status, 'error', 'provider mount timeout is exposed as an error, not a fill');
  assert.equal(timeoutSignal?.aborted, true, 'provider receives an abort signal on timeout');
  finishLateMount({
    status: 'filled', creative: fakeCreative, width: 160, height: 600, cleanup: () => { lateCleanupCount += 1; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(lateCleanupCount, 1, 'a late fill is cleaned up after its request timed out');

  let finishUnmountedMount!: (result: AdProviderResult) => void;
  let unmountedCleanupCount = 0;
  const unmountedAdapter: AdProviderAdapter = {
    id: 'unmounted-provider',
    supportsPlacement: () => true,
    mount: () => new Promise((resolve) => { finishUnmountedMount = resolve; }),
  };
  const unmountedLease = acquireAdFill(
    'public-chatroom-bottom', { enabled: true, providerPriority: ['unmounted-provider'] }, [unmountedAdapter], async () => {},
  );
  await Promise.resolve();
  unmountedLease.release();
  finishUnmountedMount({
    status: 'filled', creative: fakeCreative, width: 300, height: 90, cleanup: () => { unmountedCleanupCount += 1; },
  });
  await unmountedLease.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(unmountedCleanupCount, 1, 'a fill resolving after unmount is disposed and cannot be mounted');

  console.log('Chatroom ad architecture, fill, script, layout, and no-fill contracts passed.');
}

void main();
