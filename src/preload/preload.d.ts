import type { JiraWidgetApi } from './index'

declare global {
  interface Window {
    api: JiraWidgetApi
  }
}

export {}
