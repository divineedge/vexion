import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// pg emits idle-client connection failures on the Pool itself. Without a
// listener Node treats the event as unhandled and terminates the whole API,
// making healthy persistent data briefly appear missing after a reconnect.
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool connection error", error);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
