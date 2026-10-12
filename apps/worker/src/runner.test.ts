import { setTimeout as sleep } from 'node:timers/promises'
import { JobQueue } from '@clipstudio/core'
import { createTestDb } from '@clipstudio/core/testing'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobHandlers } from './handlers'
import { Worker } from './runner'

let worker: Worker | undefined

afterEach(async () => {
  await worker?.stop(100)
  worker = undefined
})

async function waitFor(check: () => boolean, timeoutMs = 2_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition')
    await sleep(5)
  }
}

function setup(handler: JobHandlers['demo.count'], concurrency = { default: 2 }) {
  const queue = new JobQueue(createTestDb())
  worker = new Worker({
    queue,
    handlers: {
      'demo.count': handler,
      'ingest.download': async () => {},
      'media.prepare': async () => {},
      transcribe: async () => {},
      'models.download': async () => {},
    },
    workerId: 'test-worker',
    concurrency,
    pollMs: 10,
    heartbeatMs: 10,
    progressThrottleMs: 0,
    log: () => {},
  })
  return { queue, worker }
}

describe('Worker', () => {
  it('runs a job to completion and stores progress and result', async () => {
    const { queue, worker } = setup(async (payload, ctx) => {
      ctx.progress(0.5, 'halfway')
      return { got: payload.seconds }
    })
    const job = queue.enqueue('demo.count', { seconds: 3 })
    worker.start()
    await waitFor(() => queue.get(job.id)?.status === 'succeeded')
    expect(queue.get(job.id)).toMatchObject({ progress: 1, result: { got: 3 }, lockedBy: null })
  })

  it('requeues a failed job with its error', async () => {
    const { queue, worker } = setup(async () => {
      throw new Error('nope')
    })
    const job = queue.enqueue('demo.count', {})
    worker.start()
    await waitFor(() => queue.get(job.id)?.error === 'nope')
    expect(queue.get(job.id)).toMatchObject({ status: 'queued', attempts: 1 })
  })

  it('stops a running job when a cancel is requested', async () => {
    const { queue, worker } = setup(async (_payload, ctx) => {
      await sleep(5_000, undefined, { signal: ctx.signal })
    })
    const job = queue.enqueue('demo.count', {})
    worker.start()
    await waitFor(() => queue.get(job.id)?.status === 'running')
    queue.requestCancel(job.id)
    await waitFor(() => queue.get(job.id)?.status === 'cancelled')
  })

  it('hands running jobs back to the queue on shutdown', async () => {
    const { queue, worker } = setup(async (_payload, ctx) => {
      await sleep(5_000, undefined, { signal: ctx.signal })
    })
    const job = queue.enqueue('demo.count', {})
    worker.start()
    await waitFor(() => queue.get(job.id)?.status === 'running')
    await worker.stop()
    expect(queue.get(job.id)).toMatchObject({ status: 'queued', attempts: 0, lockedBy: null })
  })

  it('respects the concurrency limit of a group', async () => {
    let running = 0
    let peak = 0
    const { queue, worker } = setup(
      async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(30)
        running--
      },
      { default: 1 },
    )
    const jobs = [queue.enqueue('demo.count', {}), queue.enqueue('demo.count', {}), queue.enqueue('demo.count', {})]
    worker.start()
    await waitFor(() => jobs.every((j) => queue.get(j.id)?.status === 'succeeded'))
    expect(peak).toBe(1)
  })
})
