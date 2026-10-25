/**
 * 兼容层：实现已收敛到 `shared/host/paths.ts`。
 *
 * 这里原先还有一份 `comfyImageOutputDir` 的复制（与 `shared/authz/legacy-paths.ts`
 * 逐字相同，且无人使用），已删除。只留 re-export，避免同类残留再次分叉。
 */
export { canonical, homeDir } from '../../../../shared/host/paths.js'
