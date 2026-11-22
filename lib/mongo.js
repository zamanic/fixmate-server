import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is not set. Copy .env.example to .env and fill in the connection string."
  );
}

const client = new MongoClient(uri, { appName: "FixMate" });

export const DB_NAME = process.env.DB_NAME || "fixmate";

let db = null;

export async function connectToMongoDB() {
  await client.connect();
  db = client.db(DB_NAME);
  console.log(`Successfully connected to MongoDB (db: ${DB_NAME})!`);
  return client;
}

export async function disconnectFromMongoDB() {
  await client.close();
}

/** Return a collection handle. Throws if connectToMongoDB() has not run yet. */
export function col(name) {
  if (!db) throw new Error("Database not connected. Call connectToMongoDB() first.");
  return db.collection(name);
}

export { client };
