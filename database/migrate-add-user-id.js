#!/usr/bin/env node

// Migration script: Add user_id to all existing Firestore documents.
//
// Existing data was created before per-user isolation was added.
// This script tags every document in every collection with a default user_id
// so the data shows up for the original user after the per-user update.
//
// Usage:
//   node database/migrate-add-user-id.js <DEFAULT_USER_ID>
//
// The DEFAULT_USER_ID should be the UUID from the original iOS device.
// You can find it in the iOS app: Settings > Device ID, or by checking
// UserDefaults for the "userId" key.
//
// This script is idempotent — documents that already have a user_id are skipped.

const { Firestore } = require('@google-cloud/firestore');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DEFAULT_USER_ID = process.argv[2];

if (!DEFAULT_USER_ID) {
  console.error('Usage: node database/migrate-add-user-id.js <DEFAULT_USER_ID>');
  console.error('');
  console.error('The DEFAULT_USER_ID is the UUID from the original iOS device.');
  console.error('Find it in: iOS Settings > Device ID');
  process.exit(1);
}

const firestore = new Firestore({
  projectId: process.env.GCP_PROJECT_ID || 'japanese-tutor-487503',
});

// All collections that need user_id
const COLLECTIONS = [
  'articles',
  'vocabulary',
  'article_vocabulary',
  'quiz_questions',
  'config',
];

async function migrateCollection(collectionName) {
  const collection = firestore.collection(collectionName);
  const snapshot = await collection.get();

  if (snapshot.empty) {
    console.log(`  ${collectionName}: empty — skipping`);
    return { total: 0, migrated: 0, skipped: 0 };
  }

  let migrated = 0;
  let skipped = 0;

  // Firestore batches are limited to 500 operations
  const BATCH_SIZE = 400;
  let batch = firestore.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (data.user_id) {
      skipped++;
      continue;
    }

    batch.update(doc.ref, { user_id: DEFAULT_USER_ID });
    migrated++;
    batchCount++;

    if (batchCount >= BATCH_SIZE) {
      await batch.commit();
      batch = firestore.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`  ${collectionName}: ${snapshot.size} docs — ${migrated} migrated, ${skipped} already had user_id`);
  return { total: snapshot.size, migrated, skipped };
}

async function main() {
  console.log(`\nMigrating Firestore documents to user_id: ${DEFAULT_USER_ID}`);
  console.log('='.repeat(60));

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalDocs = 0;

  for (const collectionName of COLLECTIONS) {
    const result = await migrateCollection(collectionName);
    totalDocs += result.total;
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
  }

  console.log('='.repeat(60));
  console.log(`Done! ${totalDocs} total docs — ${totalMigrated} migrated, ${totalSkipped} already had user_id`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
