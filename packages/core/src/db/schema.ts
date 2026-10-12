import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { JOB_STATUSES } from '../shared/jobs'
import { ASSET_KINDS, PROJECT_STATUSES, SOURCE_TYPES, type YoutubeMeta } from '../shared/projects'

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    group: text('concurrency_group').notNull().default('default'),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
    /** 0..1 */
    progress: real('progress').notNull().default(0),
    message: text('message'),
    result: text('result', { mode: 'json' }).$type<unknown>(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: integer('run_at', { mode: 'timestamp_ms' }).notNull(),
    lockedBy: text('locked_by'),
    heartbeatAt: integer('heartbeat_at', { mode: 'timestamp_ms' }),
    cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
    projectId: text('project_id'),
    createdBy: text('created_by'),
    /** Bumped on every write, so listeners can ask for "everything after rev N". */
    rev: integer('rev').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('jobs_status_run_at_idx').on(t.status, t.runAt),
    index('jobs_rev_idx').on(t.rev),
    index('jobs_project_idx').on(t.projectId),
  ],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    sourceType: text('source_type', { enum: SOURCE_TYPES }).notNull(),
    sourceUrl: text('source_url'),
    /** YouTube video id, used to warn about importing the same video twice. */
    sourceId: text('source_id'),
    sourceMeta: text('source_meta', { mode: 'json' }).$type<YoutubeMeta>(),
    status: text('status', { enum: PROJECT_STATUSES }).notNull(),
    error: text('error'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    hasAudio: integer('has_audio', { mode: 'boolean' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    /** Set when moved to Trash. */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('projects_deleted_at_idx').on(t.deletedAt), index('projects_source_id_idx').on(t.sourceId)],
)

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ASSET_KINDS }).notNull(),
    storageKey: text('storage_key').notNull(),
    bytes: integer('bytes').notNull(),
    mimeType: text('mime_type').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('assets_project_kind_idx').on(t.projectId, t.kind)],
)

export type JobRow = typeof jobs.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type AssetRow = typeof assets.$inferSelect
