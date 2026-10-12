import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { JOB_STATUSES } from '../shared/jobs'
import { ASSET_KINDS, PROJECT_STATUSES, SOURCE_TYPES, type YoutubeMeta } from '../shared/projects'
import { TRANSCRIPT_STATUSES, type Word } from '../shared/transcripts'
import type { ClipEdit } from '@clipstudio/captions'
import { CLIP_ORIGINS, CLIP_STATUSES, PROPOSAL_KINDS, PROPOSAL_STATUSES, RENDER_STATUSES } from '../shared/clips'

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

/** One transcript per project; transcribing again replaces it. */
export const transcripts = sqliteTable('transcripts', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  status: text('status', { enum: TRANSCRIPT_STATUSES }).notNull(),
  error: text('error'),
  requestedLanguage: text('requested_language').notNull().default('auto'),
  language: text('language'),
  engine: text('engine'),
  model: text('model'),
  words: text('words', { mode: 'json' }).$type<Word[]>().notNull(),
  wordCount: integer('word_count').notNull().default(0),
  edited: integer('edited', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Something Claude (or another MCP client) suggested; nothing happens until the user decides in the Inbox. */
export const proposals = sqliteTable(
  'proposals',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
    status: text('status', { enum: PROPOSAL_STATUSES }).notNull(),
    title: text('title').notNull(),
    note: text('note'),
    client: text('client'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Kind-specific details, e.g. the link and quality for an import. */
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    resultProjectId: text('result_project_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('proposals_status_idx').on(t.status)],
)

export const clips = sqliteTable(
  'clips',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    proposalId: text('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    title: text('title').notNull(),
    hook: text('hook'),
    reason: text('reason'),
    score: integer('score'),
    keywords: text('keywords', { mode: 'json' }).$type<string[]>().notNull(),
    origin: text('origin', { enum: CLIP_ORIGINS }).notNull(),
    status: text('status', { enum: CLIP_STATUSES }).notNull(),
    /** Layout, captions, hook and trims. Null until first edited (defaults apply). */
    edit: text('edit', { mode: 'json' }).$type<ClipEdit>(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('clips_project_idx').on(t.projectId), index('clips_proposal_idx').on(t.proposalId)],
)

/** An exported MP4 of a clip at a given version. */
export const renders = sqliteTable(
  'renders',
  {
    id: text('id').primaryKey(),
    clipId: text('clip_id')
      .notNull()
      .references(() => clips.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: text('status', { enum: RENDER_STATUSES }).notNull(),
    clipVersion: integer('clip_version').notNull(),
    storageKey: text('storage_key'),
    bytes: integer('bytes'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('renders_clip_idx').on(t.clipId), index('renders_project_idx').on(t.projectId)],
)

export type JobRow = typeof jobs.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type AssetRow = typeof assets.$inferSelect
export type TranscriptRow = typeof transcripts.$inferSelect
export type ClipRow = typeof clips.$inferSelect
export type ProposalRow = typeof proposals.$inferSelect
export type RenderRow = typeof renders.$inferSelect
