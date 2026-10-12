import { PROPOSAL_STATUSES, type ProposalStatus } from '@clipstudio/core'

export default defineEventHandler((event) => {
  const status = getQuery(event).status as ProposalStatus | undefined
  return useCore().proposals.list(status && PROPOSAL_STATUSES.includes(status) ? status : undefined)
})
