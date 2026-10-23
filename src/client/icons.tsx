import { ICON_BODY } from './icons-data.js'
import type { IconName } from './icons-data.js'

/** 图标：24×24 viewBox，stroke 跟随 currentColor。 */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
      dangerouslySetInnerHTML={{ __html: ICON_BODY[name] ?? '' }}
    />
  )
}
