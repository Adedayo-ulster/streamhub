import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Simple file-based KV store for local development
// In production, you'd want to use a proper database

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'kv-store.json');

// Initialize store
let store = {};
let isInitialized = false;

// Initialize the store
const initializeStore = async () => {
  if (isInitialized) return;
  
  if (process.env.NODE_ENV === 'production') {
    store = {};
    isInitialized = true;
    console.log('KV store initialized in-memory for production');
    return;
  }

  try {
    // Ensure data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Load existing data or initialize empty store
    try {
      const data = await fs.readFile(DATA_FILE, 'utf8');
      store = JSON.parse(data);
      console.log('KV store loaded from file');
    } catch (error) {
      // File doesn't exist or is invalid, start with empty store
      store = {};
      console.log('KV store initialized with empty data');
    }
    
    isInitialized = true;
  } catch (error) {
    console.error('Error initializing KV store:', error);
    store = {};
    isInitialized = true;
  }
};

// Save data to file
const saveStore = async () => {
  if (!isInitialized) await initializeStore();
  
  if (process.env.NODE_ENV === 'production') {
    return; // Don't save to file in production
  }
  
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (error) {
    console.error('Error saving KV store:', error);
  }
};

export const get = async (key) => {
  if (!isInitialized) await initializeStore();
  return store[key] || null;
};

export const set = async (key, value) => {
  if (!isInitialized) await initializeStore();
  store[key] = value;
  await saveStore();
};

export const del = async (key) => {
  if (!isInitialized) await initializeStore();
  delete store[key];
  await saveStore();
};

export const mget = async (keys) => {
  if (!isInitialized) await initializeStore();
  return keys.map(key => store[key] || null);
};

export const mset = async (keyValuePairs) => {
  if (!isInitialized) await initializeStore();
  for (const [key, value] of keyValuePairs) {
    store[key] = value;
  }
  await saveStore();
};

export const mdel = async (keys) => {
  if (!isInitialized) await initializeStore();
  for (const key of keys) {
    delete store[key];
  }
  await saveStore();
};

export const getByPrefix = async (prefix) => {
  if (!isInitialized) await initializeStore();
  const results = [];
  for (const [key, value] of Object.entries(store)) {
    if (key.startsWith(prefix)) {
      results.push({ key, value });
    }
  }
  return results;
};

// Initialize store immediately
initializeStore();

// Auto-save every 30 seconds
setInterval(saveStore, 30000);