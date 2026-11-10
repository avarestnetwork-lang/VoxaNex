type ScriptInjector = (providerId: string, src: string) => Promise<void>;

const pendingScriptLoads = new WeakMap<HTMLScriptElement, Promise<void>>();

/** Shares one in-flight/loaded script promise per provider and rejects URL drift. */
export function createProviderScriptLoader(inject: ScriptInjector) {
  const loads = new Map<string, { src: string; promise: Promise<void> }>();

  return (providerId: string, src: string): Promise<void> => {
    const current = loads.get(providerId);
    if (current) {
      if (current.src !== src) return Promise.reject(new Error(`Provider ${providerId} requested conflicting script URLs.`));
      return current.promise;
    }

    const promise = Promise.resolve()
      .then(() => inject(providerId, src))
      .catch((error) => {
        if (loads.get(providerId)?.promise === promise) loads.delete(providerId);
        throw error;
      });
    loads.set(providerId, { src, promise });
    return promise;
  };
}

function getReadyState(script: HTMLScriptElement): string | undefined {
  return (script as HTMLScriptElement & { readyState?: string }).readyState;
}

function waitForScript(
  script: HTMLScriptElement,
  providerId: string,
  timeoutMs: number,
  managed: boolean,
): Promise<void> {
  const pending = pendingScriptLoads.get(script);
  if (pending) return pending;

  const knownLoaded = script.dataset.adProviderLoaded === 'true'
    || getReadyState(script) === 'complete'
    || getReadyState(script) === 'loaded';
  if (knownLoaded) {
    script.dataset.adProviderLoaded = 'true';
    script.dataset.adProviderState = 'loaded';
    return Promise.resolve();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    const removeListeners = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (timer !== undefined) clearTimeout(timer);
    };
    const onLoad = () => {
      script.dataset.adProviderLoaded = 'true';
      script.dataset.adProviderState = 'loaded';
      removeListeners();
      resolve();
    };
    const onError = () => {
      script.dataset.adProviderState = 'error';
      removeListeners();
      if (managed && script.isConnected) script.remove();
      reject(new Error(`Provider script failed to load (${providerId}).`));
    };

    script.dataset.adProviderState = 'loading';
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timer = setTimeout(() => {
      script.dataset.adProviderState = 'error';
      removeListeners();
      if (managed && script.isConnected) script.remove();
      reject(new Error(`Provider script load timed out (${providerId}).`));
    }, timeoutMs);

    // The loaded marker is authoritative for scripts seen by this loader;
    // readyState is only a compatibility fallback for host-provided markup.
  });

  pendingScriptLoads.set(script, promise);
  void promise.then(
    () => { if (pendingScriptLoads.get(script) === promise) pendingScriptLoads.delete(script); },
    () => { if (pendingScriptLoads.get(script) === promise) pendingScriptLoads.delete(script); },
  );
  return promise;
}

export function createDomScriptInjector(
  getDocument: () => Document = () => document,
  timeoutMs = 15_000,
): ScriptInjector {
  return async (providerId, src) => {
    const documentRef = getDocument();
    const absoluteSrc = new URL(src, documentRef.baseURI).href;
    let existing = Array.from(documentRef.scripts).find(
      (script) => script.dataset.adProviderId === providerId || script.src === absoluteSrc,
    );

    // A failed managed element is safe to replace. An unowned element is left
    // in place; a retry may add a new script rather than deleting host markup.
    if (existing?.dataset.adProviderState === 'error') {
      if (existing.dataset.adProviderManaged === 'true' && existing.isConnected) existing.remove();
      existing = undefined;
    }

    if (existing) {
      existing.dataset.adProviderId ??= providerId;
      await waitForScript(existing, providerId, timeoutMs, existing.dataset.adProviderManaged === 'true');
      return;
    }

    const script = documentRef.createElement('script');
    script.async = true;
    script.src = absoluteSrc;
    script.dataset.adProviderId = providerId;
    script.dataset.adProviderManaged = 'true';
    const loaded = waitForScript(script, providerId, timeoutMs, true);
    try {
      documentRef.head.appendChild(script);
    } catch (error) {
      script.dispatchEvent(new Event('error'));
      await loaded.catch(() => {});
      throw error;
    }
    await loaded;
  };
}

export const loadAdProviderScript = createProviderScriptLoader(createDomScriptInjector());
