import { setTimeout as sleep } from 'node:timers/promises'
import type { JobHandler } from './index'

/** Counts for a few seconds. Used by the System check page to show the job runner works. */
export const demoCount: JobHandler<'demo.count'> = async ({ seconds, failAtPercent }, ctx) => {
  const ticksPerSecond = 4
  const total = seconds * ticksPerSecond
  for (let tick = 1; tick <= total; tick++) {
    await sleep(1000 / ticksPerSecond, undefined, { signal: ctx.signal })
    const fraction = tick / total
    if (failAtPercent && ctx.attempt === 1 && fraction * 100 >= failAtPercent) {
      throw new Error(`Simulated failure at ${failAtPercent}%`)
    }
    ctx.progress(fraction, `Second ${Math.ceil(tick / ticksPerSecond)} of ${seconds}`)
  }
  return { seconds }
}
