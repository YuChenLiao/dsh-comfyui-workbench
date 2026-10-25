/**
 * 测试共用的监听助手。
 *
 * `server.listen(0)` 偶尔会分到 undici 的 blocked ports（实测 2049、1720、5060 等），
 * 之后 `fetch` 直接抛 `bad port` —— 表现为"偶发 fetch failed"，一次能连挂好几条用例。
 * 本机采样约 0.04%/次，一轮测试有十几处 listen，累积起来就够让门禁随机变红。
 *
 * 撞上就重绑；20 次都撞上才报错（而不是静默返回一个坏端口）。
 */
// 本机实测：undici 在 1024–15000 之间拒绝这 19 个端口（逐个 fetch 验过 bad port）。
// 前提是系统动态端口段覆盖了它们（本机 netsh: 1024 + 13977）；Windows 默认段
// 49152–65535 里没有坏端口，换机后这个名单只是空转，不会误伤。
const BLOCKED_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])

/**
 * 绑到 127.0.0.1 的随机可用端口。
 *
 * @param server - 还没 listen 的 http.Server。
 * @returns 实际绑定的端口 —— 调用方请用它建 origin，不要再读 `server.address()`。
 */
export async function listenSafe(server) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error)
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        // 成功路径要摘掉监听器：重绑 20 次会累积到 MaxListenersExceededWarning。
        server.off('error', onError)
        resolve()
      })
    })
    const port = server.address().port
    if (!BLOCKED_PORTS.has(port)) return port
    await new Promise(resolve => server.close(resolve))
  }
  throw new Error('拿不到可用的测试端口（连续命中 undici blocked ports）')
}
