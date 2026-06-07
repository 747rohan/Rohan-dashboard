import Database from 'better-sqlite3';
import fs from 'node:fs';
import { config } from '../config.js';

let _db = null;

export function orchDb() {
  if (_db) return _db;
  if (!fs.existsSync(config.solbot.orchDb)) {
    throw new Error(`orch.db not found at ${config.solbot.orchDb}`);
  }
  _db = new Database(config.solbot.orchDb, { readonly: true, fileMustExist: true });
  _db.pragma('query_only = 1');
  return _db;
}
