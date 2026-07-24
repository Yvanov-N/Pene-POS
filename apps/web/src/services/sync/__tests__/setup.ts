import "fake-indexeddb/auto";

// Dexie (lib/db.ts) needs a real IndexedDB implementation to construct its
// schema against -- fake-indexeddb/auto installs one globally before any
// test file (or the modules it imports, including db.ts itself) runs.
