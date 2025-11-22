import { openDB, IDBPDatabase } from 'idb';

export interface OfflineImage {
  id: string;
  base64Image: string;
  mimeType: string;
}

const DB_NAME = 'expense-manager-db';
const STORE_NAME = 'offline-images';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;

const getDb = (): Promise<IDBPDatabase<unknown>> => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            },
        });
    }
    return dbPromise;
};

export const addImageToQueue = async (image: OfflineImage): Promise<void> => {
  const db = await getDb();
  await db.add(STORE_NAME, image);
};

export const getQueuedImages = async (): Promise<OfflineImage[]> => {
  const db = await getDb();
  return await db.getAll(STORE_NAME);
};

export const deleteImageFromQueue = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
};
