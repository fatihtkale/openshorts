import { resolve } from 'node:path'
import { findRepoRoot } from './config'
import { createDb, type Db } from './db/client'

/** A fresh, migrated in-memory database for tests. */
export function createTestDb(): Db {
  return createDb({ path: ':memory:', migrationsDir: resolve(findRepoRoot(), 'packages/core/drizzle') })
}
