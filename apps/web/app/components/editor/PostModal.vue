<script setup lang="ts">
import {
  formatTimecode,
  PLATFORM_LABELS,
  POST_LIMITS,
  suggestPostText,
  TIKTOK_PRIVACY_LABELS,
  type AccountDto,
  type ClipDto,
  type PostDto,
  type RenderDto,
  type TiktokPrivacyLevel,
  type YoutubePrivacy,
} from '@clipstudio/core/shared'

/**
 * Posting an export: pick an account, fill in what the platform needs, review, confirm.
 * For TikTok this follows TikTok's posting rules: the creator's own privacy choices (none preselected),
 * interaction switches, commercial-content disclosure and the music-usage consent line.
 */
const props = defineProps<{ clip: ClipDto; render: RenderDto }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ posted: [post: PostDto] }>()
const toast = useToast()

const { data: accountsData } = await useFetch<{ accounts: AccountDto[] }>('/api/accounts', { server: false })
const accounts = computed(() => (accountsData.value?.accounts ?? []).filter((a) => a.status === 'connected'))

const step = ref<'edit' | 'review'>('edit')
const accountId = ref<string | undefined>()
const account = computed(() => accounts.value.find((a) => a.id === accountId.value) ?? null)
const platform = computed(() => account.value?.platform ?? null)

const title = ref('')
const description = ref('')
const tags = ref('')
const ytPrivacy = ref<YoutubePrivacy | undefined>()
const madeForKids = ref(false)

const ttMode = ref<'direct' | 'draft'>('direct')
const ttPrivacy = ref<TiktokPrivacyLevel | undefined>()
const allowComments = ref(true)
const allowDuet = ref(true)
const allowStitch = ref(true)
const disclose = ref(false)
const brandOrganic = ref(false)
const brandContent = ref(false)
const aiGenerated = ref(false)

interface CreatorInfo {
  username: string
  nickname: string
  privacyOptions: TiktokPrivacyLevel[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}
const creator = ref<CreatorInfo | null>(null)
const creatorError = ref<string | null>(null)
const loadingCreator = ref(false)

watch(
  [open, accounts],
  ([isOpen], [wasOpen]) => {
    if (!isOpen) return
    if (!wasOpen) step.value = 'edit'
    // One account: no need to ask.
    if (!accountId.value && accounts.value.length === 1) accountId.value = accounts.value[0]!.id
  },
  { immediate: true },
)

// Fresh text for the chosen platform, and TikTok's per-creator options.
watch(
  [accountId, accounts],
  async () => {
    const p = platform.value
    if (!p) return
    const s = suggestPostText(props.clip, p)
    title.value = s.title
    description.value = s.description
    tags.value = s.tags.join(', ')
    ytPrivacy.value = undefined
    ttPrivacy.value = undefined
    creator.value = null
    creatorError.value = null
    if (p === 'tiktok' && account.value) {
      loadingCreator.value = true
      try {
        creator.value = await $fetch<CreatorInfo>(`/api/accounts/${account.value.id}/creator`)
        allowComments.value = !creator.value.commentDisabled
        allowDuet.value = !creator.value.duetDisabled
        allowStitch.value = !creator.value.stitchDisabled
      } catch (e) {
        creatorError.value = (e as { statusMessage?: string }).statusMessage ?? (e as Error).message
      } finally {
        loadingCreator.value = false
      }
    }
  },
  { immediate: true },
)

const durationSec = computed(() => (props.render.durationMs ?? 0) / 1000)
const tagList = computed(() => tags.value.split(',').map((t) => t.trim()).filter(Boolean))

const problems = computed(() => {
  const out: string[] = []
  if (!account.value) out.push('Choose an account')
  if (platform.value === 'youtube') {
    if (!title.value.trim()) out.push('Add a title')
    if (title.value.length > POST_LIMITS.youtubeTitle) out.push(`Title over ${POST_LIMITS.youtubeTitle} characters`)
    if (/[<>]/.test(title.value + description.value)) out.push('Remove < and > (YouTube refuses them)')
    if (!ytPrivacy.value) out.push('Choose who can see it')
  }
  if (platform.value === 'tiktok') {
    if (creatorError.value) out.push('TikTok settings could not be loaded')
    if (title.value.length > POST_LIMITS.tiktokCaption) out.push('Caption too long')
    if (ttMode.value === 'direct' && !ttPrivacy.value) out.push('Choose who can see it')
    if (creator.value && durationSec.value > creator.value.maxDurationSec) out.push(`This account can post up to ${creator.value.maxDurationSec} s`)
    if (disclose.value && !brandOrganic.value && !brandContent.value) out.push('Say what kind of promotion it is')
    if (brandContent.value && ttPrivacy.value === 'SELF_ONLY') out.push('Branded content can’t be private')
  }
  return out
})

const privacyItems = computed(() =>
  (creator.value?.privacyOptions ?? []).map((p) => ({
    label: TIKTOK_PRIVACY_LABELS[p],
    value: p,
    disabled: brandContent.value && p === 'SELF_ONLY',
  })),
)

const summary = computed(() => {
  if (!account.value) return []
  const rows = [
    { label: 'Account', value: `${PLATFORM_LABELS[account.value.platform]} · ${account.value.displayName}` },
    { label: 'Video', value: `${props.clip.title} · ${formatTimecode(durationSec.value)}` },
  ]
  if (platform.value === 'youtube') {
    const labels: Record<YoutubePrivacy, string> = { public: 'Everyone (Public)', unlisted: 'Anyone with the link (Unlisted)', private: 'Only you (Private)' }
    rows.push({ label: 'Title', value: title.value }, { label: 'Visible to', value: ytPrivacy.value ? labels[ytPrivacy.value] : '' })
  } else {
    rows.push(
      { label: 'Caption', value: title.value || '(none)' },
      ttMode.value === 'direct'
        ? { label: 'Visible to', value: ttPrivacy.value ? TIKTOK_PRIVACY_LABELS[ttPrivacy.value] : '' }
        : { label: 'How', value: 'Sent to your TikTok inbox as a draft; you post it from the app' },
    )
    if (disclose.value) rows.push({ label: 'Label', value: brandContent.value ? 'Paid partnership' : 'Promotional content' })
  }
  return rows
})

const posting = ref(false)
async function post() {
  if (!account.value) return
  posting.value = true
  try {
    const created = await $fetch<PostDto>('/api/posts', {
      method: 'POST',
      body: {
        renderId: props.render.id,
        accountId: account.value.id,
        title: title.value,
        description: description.value,
        youtube: platform.value === 'youtube' ? { privacy: ytPrivacy.value, tags: tagList.value, madeForKids: madeForKids.value } : undefined,
        tiktok:
          platform.value === 'tiktok'
            ? {
                mode: ttMode.value,
                privacy: ttMode.value === 'direct' ? (ttPrivacy.value ?? null) : null,
                allowComments: allowComments.value,
                allowDuet: allowDuet.value,
                allowStitch: allowStitch.value,
                brandContent: disclose.value && brandContent.value,
                brandOrganic: disclose.value && brandOrganic.value,
                aiGenerated: aiGenerated.value,
              }
            : undefined,
      },
    })
    toast.add({ title: 'Posting started', description: `To ${account.value.displayName}. Follow it in Exports.`, icon: 'i-lucide-send' })
    emit('posted', created)
    open.value = false
  } catch (e) {
    toast.add({ title: 'Could not post', description: (e as Error).message, color: 'error' })
  } finally {
    posting.value = false
  }
}

const accountItems = computed(() => accounts.value.map((a) => ({ label: `${PLATFORM_LABELS[a.platform]} · ${a.displayName}`, value: a.id, avatar: { src: a.avatarUrl ?? undefined } })))
</script>

<template>
  <UModal v-model:open="open" :title="step === 'edit' ? 'Post this clip' : 'Ready to post?'" :ui="{ content: 'sm:max-w-lg' }">
    <template #body>
      <UEmpty
        v-if="!accounts.length"
        icon="i-lucide-at-sign"
        title="No accounts connected"
        description="Connect a YouTube channel or TikTok account first."
        :actions="[{ label: 'Go to Accounts', to: '/accounts' }]"
        variant="naked"
      />

      <div v-else-if="step === 'edit'" class="space-y-4">
        <UFormField label="Post to">
          <USelect v-model="accountId" :items="accountItems" value-key="value" placeholder="Choose an account" class="w-full" />
        </UFormField>

        <!-- YouTube -->
        <template v-if="platform === 'youtube'">
          <UFormField label="Title" :help="`${title.length}/${POST_LIMITS.youtubeTitle}`">
            <UInput v-model="title" class="w-full" />
          </UFormField>
          <UFormField label="Description">
            <UTextarea v-model="description" :rows="3" autoresize class="w-full" />
          </UFormField>
          <UFormField label="Tags" help="Separated by commas">
            <UInput v-model="tags" class="w-full" />
          </UFormField>
          <UFormField label="Who can see it">
            <URadioGroup
              v-model="ytPrivacy"
              orientation="horizontal"
              :items="[
                { label: 'Public', value: 'public' },
                { label: 'Unlisted', value: 'unlisted' },
                { label: 'Private', value: 'private' },
              ]"
            />
          </UFormField>
          <USwitch v-model="madeForKids" label="Made for kids" description="YouTube asks this of every video." />
        </template>

        <!-- TikTok -->
        <template v-if="platform === 'tiktok'">
          <div v-if="loadingCreator" class="space-y-2">
            <USkeleton class="h-8 w-full" />
            <USkeleton class="h-20 w-full" />
          </div>
          <UAlert v-else-if="creatorError" color="error" variant="subtle" icon="i-lucide-circle-x" :title="creatorError" />
          <template v-else-if="creator">
            <p class="text-sm text-muted">Posting as <span class="font-medium text-default">{{ creator.nickname }}</span> (@{{ creator.username }})</p>
            <URadioGroup
              v-model="ttMode"
              :items="[
                { label: 'Post to my profile', value: 'direct', description: 'Goes live with the settings below.' },
                { label: 'Send to my TikTok drafts', value: 'draft', description: 'Finish and post it in the TikTok app.' },
              ]"
            />
            <UFormField label="Caption" :help="`${title.length}/${POST_LIMITS.tiktokCaption}`">
              <UTextarea v-model="title" :rows="3" autoresize class="w-full" />
            </UFormField>
            <template v-if="ttMode === 'direct'">
              <UFormField label="Who can see it" help="Choose one; TikTok requires you to pick it yourself.">
                <USelect v-model="ttPrivacy" :items="privacyItems" value-key="value" placeholder="Choose…" class="w-full" />
              </UFormField>
              <div class="flex flex-wrap gap-x-6 gap-y-2">
                <USwitch v-model="allowComments" label="Comments" :disabled="creator.commentDisabled" />
                <USwitch v-model="allowDuet" label="Duet" :disabled="creator.duetDisabled" />
                <USwitch v-model="allowStitch" label="Stitch" :disabled="creator.stitchDisabled" />
              </div>
              <div class="space-y-2 rounded-lg border border-default p-3">
                <USwitch v-model="disclose" label="This promotes a brand, product or service" />
                <template v-if="disclose">
                  <UCheckbox v-model="brandOrganic" label="Your brand" description="Labelled “Promotional content”." />
                  <UCheckbox v-model="brandContent" label="Branded content (a paid partnership)" description="Labelled “Paid partnership”. Can't be private." />
                </template>
              </div>
              <USwitch v-model="aiGenerated" label="Label as AI-generated" />
            </template>
            <p class="text-xs text-muted">
              By posting, you agree to TikTok's
              <ULink to="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" class="text-primary">Music Usage Confirmation</ULink>
              <template v-if="brandContent">
                and
                <ULink to="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" class="text-primary">Branded Content Policy</ULink>
              </template>.
            </p>
          </template>
        </template>
      </div>

      <dl v-else class="space-y-2 text-sm">
        <div v-for="row in summary" :key="row.label" class="flex justify-between gap-6">
          <dt class="shrink-0 text-muted">{{ row.label }}</dt>
          <dd class="text-right break-words">{{ row.value }}</dd>
        </div>
      </dl>
    </template>

    <template v-if="accounts.length" #footer>
      <div class="flex w-full items-center gap-2">
        <p v-if="step === 'edit' && problems.length" class="flex-1 truncate text-xs text-muted">{{ problems[0] }}</p>
        <span v-else class="flex-1" />
        <UButton v-if="step === 'review'" label="Back" color="neutral" variant="ghost" @click="step = 'edit'" />
        <UButton v-else label="Cancel" color="neutral" variant="ghost" @click="open = false" />
        <UButton v-if="step === 'edit'" label="Review" :disabled="problems.length > 0" @click="step = 'review'" />
        <UButton v-else :label="`Post to ${account?.displayName}`" icon="i-lucide-send" :loading="posting" @click="post" />
      </div>
    </template>
  </UModal>
</template>
