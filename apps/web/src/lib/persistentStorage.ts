// Asks the browser to never evict this site's storage (IndexedDB holds the
// outbox: sales not sent yet). Without it, Safari/iOS may wipe the data of a
// site not used for 7 days, and any browser may evict it under storage
// pressure. Chrome grants it silently for installed / engaged apps; Safari
// for home-screen apps. Safe to call repeatedly.
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isStoragePersistent(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
