// Ordner mit HO-Exporten einmal verbinden, danach immer die neueste .hrf-Datei laden.
// Nutzt die File System Access API (Chrome/Edge). Der Ordner-Zugriff wird in IndexedDB gemerkt.

export interface FileInfo {
  name: string;
  lastModified: number;
}

/** Eigene Exporte der App (…-liga.hrf / …-freundschaft.hrf) werden übersprungen. */
export function isHoExport(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".hrf") && !/-(liga|freundschaft)\.hrf$/.test(n);
}

/** Neueste HO-Exportdatei nach Änderungsdatum, bei Gleichstand nach Name. */
export function pickNewest<T extends FileInfo>(files: T[]): T | null {
  let best: T | null = null;
  for (const f of files) {
    if (!isHoExport(f.name)) continue;
    if (!best || f.lastModified > best.lastModified || (f.lastModified === best.lastModified && f.name > best.name)) best = f;
  }
  return best;
}

// --- Browser-Teil ----------------------------------------------------------------

export type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission(o: { mode: "read" }): Promise<PermissionState>;
};

export const folderApiAvailable = (): boolean => typeof (window as any).showDirectoryPicker === "function";

const DB = "aufstellungs-assistent";
const STORE = "handles";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function storedFolder(): Promise<DirHandle | null> {
  try {
    return ((await idb<DirHandle | undefined>("readonly", (s) => s.get("hrfFolder"))) ?? null);
  } catch {
    return null;
  }
}

export async function chooseFolder(): Promise<DirHandle> {
  const h = (await (window as any).showDirectoryPicker({ id: "hrf", mode: "read" })) as DirHandle;
  try {
    await idb("readwrite", (s) => s.put(h, "hrfFolder"));
  } catch {
    /* Merken klappt nicht (z. B. privates Fenster) – Laden geht trotzdem */
  }
  return h;
}

/** true, wenn ohne Klick gelesen werden darf. */
export async function hasPermission(h: DirHandle): Promise<boolean> {
  return (await h.queryPermission({ mode: "read" })) === "granted";
}

/** Muss aus einem Klick heraus aufgerufen werden. */
export async function askPermission(h: DirHandle): Promise<boolean> {
  return (await h.requestPermission({ mode: "read" })) === "granted";
}

export async function newestFile(h: DirHandle): Promise<File | null> {
  const files: File[] = [];
  for await (const entry of h.values()) {
    if (entry.kind !== "file" || !isHoExport(entry.name)) continue;
    files.push(await (entry as FileSystemFileHandle).getFile());
  }
  return pickNewest(files);
}

/** Alle HO-Exporte im Ordner (für den Finanzverlauf). */
export async function allExports(h: DirHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of h.values()) {
    if (entry.kind !== "file" || !isHoExport(entry.name)) continue;
    files.push(await (entry as FileSystemFileHandle).getFile());
  }
  return files;
}

export const DATA_FILE = "tophatt-data.json";

/** Liest eine bestimmte Datei aus dem Ordner (null, wenn sie fehlt). */
export async function fileByName(h: DirHandle, name: string): Promise<File | null> {
  try {
    const fh = await (h as FileSystemDirectoryHandle).getFileHandle(name);
    return await fh.getFile();
  } catch {
    return null;
  }
}

