/**
 * db.js – IndexedDB wrapper for 用药助手
 * Stores: users, medications, records, settings
 */

const DB_NAME = 'MedicationReminderDB';
const DB_VERSION = 1;

/** Default three-times-a-day medication schedule (morning / noon / evening) */
const DEFAULT_MEDICATION_TIMES = ['09:00', '13:00', '20:00'];

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Users store
      if (!db.objectStoreNames.contains('users')) {
        const us = db.createObjectStore('users', { keyPath: 'id' });
        us.createIndex('role', 'role', { unique: false });
        us.createIndex('familyCode', 'familyCode', { unique: false });
      }

      // Medications store
      if (!db.objectStoreNames.contains('medications')) {
        const ms = db.createObjectStore('medications', { keyPath: 'id' });
        ms.createIndex('userId', 'userId', { unique: false });
        ms.createIndex('active', 'active', { unique: false });
      }

      // Records store
      if (!db.objectStoreNames.contains('records')) {
        const rs = db.createObjectStore('records', { keyPath: 'id' });
        rs.createIndex('userId', 'userId', { unique: false });
        rs.createIndex('date', 'date', { unique: false });
        rs.createIndex('userId_date', ['userId', 'date'], { unique: false });
        rs.createIndex('medicationId', 'medicationId', { unique: false });
      }

      // Settings store (single row with key='settings')
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

function txStore(storeName, mode = 'readonly') {
  return openDB().then((db) => {
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  });
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/* ── Generic CRUD ── */
async function dbGetAll(storeName) {
  const store = await txStore(storeName);
  return promisifyRequest(store.getAll());
}

async function dbGet(storeName, key) {
  const store = await txStore(storeName);
  return promisifyRequest(store.get(key));
}

async function dbPut(storeName, obj) {
  const store = await txStore(storeName, 'readwrite');
  return promisifyRequest(store.put(obj));
}

async function dbDelete(storeName, key) {
  const store = await txStore(storeName, 'readwrite');
  return promisifyRequest(store.delete(key));
}

async function dbGetByIndex(storeName, indexName, value) {
  const store = await txStore(storeName);
  const index = store.index(indexName);
  return promisifyRequest(index.getAll(value));
}

/* ── Users ── */
const DB = {
  async getUsers()              { return dbGetAll('users'); },
  async getUser(id)             { return dbGet('users', id); },
  async saveUser(user)          { return dbPut('users', user); },
  async deleteUser(id)          { return dbDelete('users', id); },
  async getUsersByRole(role)    { return dbGetByIndex('users', 'role', role); },
  async getUsersByFamily(code)  { return dbGetByIndex('users', 'familyCode', code); },

  /* ── Medications ── */
  async getMedications()               { return dbGetAll('medications'); },
  async getMedicationsByUser(userId)   { return dbGetByIndex('medications', 'userId', userId); },
  async getMedication(id)              { return dbGet('medications', id); },
  async saveMedication(med)            { return dbPut('medications', med); },
  async deleteMedication(id)           { return dbDelete('medications', id); },

  /* ── Records ── */
  async getRecords()                        { return dbGetAll('records'); },
  async getRecord(id)                       { return dbGet('records', id); },
  async getRecordsByDate(userId, date)      { return dbGetByIndex('records', 'userId_date', [userId, date]); },
  async getRecordsByUser(userId)            { return dbGetByIndex('records', 'userId', userId); },
  async getRecordsByMedication(medicationId){ return dbGetByIndex('records', 'medicationId', medicationId); },
  async saveRecord(record)                  { return dbPut('records', record); },
  async deleteRecord(id)                    { return dbDelete('records', id); },

  /* Delete all records for a medication (used when medication is deleted) */
  async deleteRecordsByMedication(medicationId) {
    const records = await this.getRecordsByMedication(medicationId);
    await Promise.all(records.map((r) => dbDelete('records', r.id)));
  },

  /* Delete all records for a user */
  async deleteRecordsByUser(userId) {
    const records = await this.getRecordsByUser(userId);
    await Promise.all(records.map((r) => dbDelete('records', r.id)));
  },

  /* Delete all medications for a user */
  async deleteMedicationsByUser(userId) {
    const meds = await this.getMedicationsByUser(userId);
    await Promise.all(meds.map((m) => dbDelete('medications', m.id)));
  },

  /* ── Settings ── */
  async getSettings() {
    const s = await dbGet('settings', 'settings');
    return s ? s.data : getDefaultSettings();
  },
  async saveSettings(data) {
    return dbPut('settings', { key: 'settings', data });
  },

  /* ── Clear everything ── */
  async clearAll() {
    const db = await openDB();
    const stores = ['users', 'medications', 'records', 'settings'];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach((s) => tx.objectStore(s).clear());
      tx.oncomplete = resolve;
      tx.onerror    = (e) => reject(e.target.error);
    });
  }
};

function getDefaultSettings() {
  return {
    notifications:   true,
    reminderAdvance: 10,
    aiEnabled:       false,
    apiProvider:     'github',
    apiBaseUrl:      'https://models.inference.ai.azure.com',
    apiKey:          '',
    apiModel:        'gemini-3-flash',
    syncUrl:         '',
    activeUserId:    null,
    defaultTimes:    DEFAULT_MEDICATION_TIMES.slice()
  };
}
