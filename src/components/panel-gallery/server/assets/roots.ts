/**
 * 兼容层：实现已收敛到 `shared/authz/roots.ts`。
 *
 * 这里原先是一份复制，与 `assets/authorize.ts` 同因：修共享版时漏掉了它，
 * 而生产路由用的是这份 —— POSIX 上 `['/data/App','/data/app']` 会被判成同一个根，
 * 第二个被静默丢掉，表现为"配了的目录看不见图"。
 */
export * from '../../../../shared/authz/roots.js'
