/**
 * 兼容层：实现已收敛到 `shared/authz/authorize.ts`。
 *
 * 这里原先是一份复制。修共享版时漏掉了它，而生产路由（`server/routes.ts`、
 * `assets/service.ts`）恰恰用的是这份 —— 结果 POSIX 上越权照旧：
 * `/data/App/x.png` 能通过根 `/data/app` 的校验，之后 `statSync`/`unlinkSync`
 * 用的却是原始路径。
 *
 * 只保留一个实现，避免同类修复再次漂到另一份上。
 */
export * from '../../../../shared/authz/authorize.js'
