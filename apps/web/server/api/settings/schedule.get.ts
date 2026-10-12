import { DEFAULT_SCHEDULE, getSetting, type ScheduleDefaults } from '@clipstudio/core'


export default defineEventHandler(() => ({ ...DEFAULT_SCHEDULE, ...getSetting<Partial<ScheduleDefaults>>(useCore().db, 'schedule.defaults') }))
