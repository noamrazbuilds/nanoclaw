// One-shot: backfill arena_aggregates (last 14 days) and print a report.
// Usage: npx tsx scripts/arena-report-now.ts [days]

import Database from 'better-sqlite3';
import path from 'path';

import { initArenaDb } from '../src/arena/arena-db.js';
import { runDailyAggregation } from '../src/arena/arena-aggregator.js';
import { generateReport } from '../src/arena/arena-report.js';

const STORE_DIR = process.env.STORE_DIR || path.join(process.cwd(), 'store');
const dbPath = path.join(STORE_DIR, 'messages.db');

const days = Number(process.argv[2] ?? 7);

const db = new Database(dbPath);
initArenaDb(db);

console.log(`Backfilling aggregates (last 14 days)...`);
runDailyAggregation({ days: 14 });

const report = await generateReport({ days });
console.log('\n' + report);

db.close();
