import { beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../testing'
import { backoffMs, JobQueue } from './queue'

let clock: Date
let queue: JobQueue
const advance = (ms: number) => (clock = new Date(clock.getTime() + ms))

beforeEach(() => {
  clock = new Date('2026-10-12T10:00:00Z')
  queue = new JobQueue(createTestDb(), () => clock)
})

describe('enqueue', () => {
  it('validates the payload and applies defaults', () => {
    const job = queue.enqueue('demo.count', {})
    expect(job.payload).toEqual({ seconds: 15 })
    expect(job.status).toBe('queued')
    expect(job.maxAttempts).toBe(2)
  })

  it('rejects an invalid payload', () => {
    expect(() => queue.enqueue('demo.count', { seconds: -1 })).toThrow()
  })
})

describe('claim', () => {
  it('takes the oldest due job and marks it running', () => {
    const first = queue.enqueue('demo.count', {})
    advance(1)
    queue.enqueue('demo.count', {})
    const claimed = queue.claim('w1', ['default'])
    expect(claimed?.id).toBe(first.id)
    expect(claimed?.status).toBe('running')
    expect(claimed?.attempts).toBe(1)
    expect(claimed?.lockedBy).toBe('w1')
  })

  it('skips jobs that are not due yet', () => {
    queue.enqueue('demo.count', {}, { runAt: new Date(clock.getTime() + 60_000) })
    expect(queue.claim('w1', ['default'])).toBeNull()
    advance(60_000)
    expect(queue.claim('w1', ['default'])).not.toBeNull()
  })

  it('only takes jobs from open groups', () => {
    queue.enqueue('demo.count', {})
    expect(queue.claim('w1', [])).toBeNull()
    expect(queue.claim('w1', ['render'])).toBeNull()
    expect(queue.claim('w1', ['default'])).not.toBeNull()
  })

  it('never hands the same job out twice', () => {
    queue.enqueue('demo.count', {})
    expect(queue.claim('w1', ['default'])).not.toBeNull()
    expect(queue.claim('w2', ['default'])).toBeNull()
  })
})

describe('progress', () => {
  it('clamps the value and reports cancel requests', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    expect(queue.progress(job.id, 'w1', 1.7, 'almost')).toEqual({ cancelRequested: false })
    expect(queue.get(job.id)).toMatchObject({ progress: 1, message: 'almost' })
    queue.requestCancel(job.id)
    expect(queue.progress(job.id, 'w1', 0.5)).toEqual({ cancelRequested: true })
  })

  it('returns null for a worker that does not hold the job', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    expect(queue.progress(job.id, 'w2', 0.5)).toBeNull()
  })
})

describe('fail', () => {
  it('retries with backoff, then fails for good after maxAttempts', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])

    const retried = queue.fail(job.id, 'w1', 'boom')!
    expect(retried.status).toBe('queued')
    expect(retried.error).toBe('boom')
    expect(retried.runAt.getTime()).toBe(clock.getTime() + backoffMs(1))
    expect(queue.claim('w1', ['default'])).toBeNull()

    advance(backoffMs(1))
    expect(queue.claim('w1', ['default'])?.attempts).toBe(2)
    const failed = queue.fail(job.id, 'w1', 'boom again')!
    expect(failed.status).toBe('failed')
    expect(failed.finishedAt).not.toBeNull()
  })

  it('doubles the backoff and caps it', () => {
    expect(backoffMs(1)).toBe(5_000)
    expect(backoffMs(2)).toBe(10_000)
    expect(backoffMs(20)).toBe(5 * 60_000)
  })
})

describe('cancel, retry and release', () => {
  it('cancels a queued job immediately', () => {
    const job = queue.enqueue('demo.count', {})
    expect(queue.requestCancel(job.id)?.status).toBe('cancelled')
    expect(queue.claim('w1', ['default'])).toBeNull()
  })

  it('flags a running job so the worker can stop it', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    expect(queue.requestCancel(job.id)).toMatchObject({ status: 'running', cancelRequested: true })
    expect(queue.cancelled(job.id, 'w1')?.status).toBe('cancelled')
  })

  it('retries only failed or cancelled jobs, from scratch', () => {
    const job = queue.enqueue('demo.count', {})
    expect(queue.retry(job.id)).toBeNull()
    queue.requestCancel(job.id)
    const again = queue.retry(job.id)!
    expect(again).toMatchObject({ status: 'queued', attempts: 0, error: null, cancelRequested: false })
  })

  it('release gives the attempt back', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    expect(queue.release(job.id, 'w1')).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null })
  })

  it('recovers jobs whose worker stopped sending heartbeats', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    advance(10_000)
    expect(queue.recoverStale(30_000)).toHaveLength(0)
    advance(30_000)
    const [recovered] = queue.recoverStale(30_000)
    expect(recovered).toMatchObject({ id: job.id, status: 'queued', lockedBy: null })
    expect(recovered?.error).toMatch(/worker stopped/)
  })
})

describe('change feed', () => {
  it('bumps rev on every write and returns only newer changes', () => {
    const a = queue.enqueue('demo.count', {})
    const b = queue.enqueue('demo.count', {})
    expect(b.rev).toBeGreaterThan(a.rev)

    const cursor = queue.latestRev()
    expect(queue.changesSince(cursor)).toEqual([])

    queue.claim('w1', ['default'])
    const changes = queue.changesSince(cursor)
    expect(changes.map((j) => j.id)).toEqual([a.id])
    expect(changes[0]!.rev).toBeGreaterThan(cursor)
  })

  it('does not bump rev for silent heartbeats', () => {
    const job = queue.enqueue('demo.count', {})
    queue.claim('w1', ['default'])
    const cursor = queue.latestRev()
    queue.heartbeat(job.id, 'w1')
    expect(queue.changesSince(cursor)).toEqual([])
  })
})
