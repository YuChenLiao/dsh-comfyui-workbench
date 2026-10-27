import { useEffect, useState } from 'react'

import { API } from '../../../client/api.js'
import { runAction } from '../../../client/actions.js'
import { download } from '../../../client/api.js'
import { useGalleryData } from './hooks/useGalleryData.js'
import type { Translate } from '../../../client/i18n.js'
import { isNsfw } from '../../../shared/gallery/nsfw.js'
import { CSS } from './styles.js'
import type { ActionKind, GalleryItem } from '../../../client/types.js'
import { BulkBar } from './BulkBar.js'
import { Card } from './Card.js'
import { ConfirmBulkRemove, ConfirmRemove } from './Confirm.js'
import { Lightbox } from './Lightbox.js'
import { Toolbar } from './Toolbar.js'

export interface GalleryProps {
  t: Translate
  visible: boolean
  /** 嵌在 better-sidebar 的页签里时为 true：此时不显示"在侧边栏打开"。 */
  embedded?: boolean
  goToConversation: () => void
  openSidebar: () => boolean
}

/**
 * 资产库主视图。
 *
 * 只做编排：筛选状态、多选、动作分发、几个弹层。数据加载在 useGalleryData，
 * 动作实现在 actions.ts，展示细节在各自组件里。
 */
export function Gallery({ t, visible, embedded, goToConversation, openSidebar }: GalleryProps): React.ReactElement {
  const [root, setRoot] = useState('all')
  const [query, setQuery] = useState('')
  const [includeBare, setIncludeBare] = useState(false)
  const [mergeDuplicates, setMergeDuplicates] = useState(true)
  /** 隐藏 NSFW 内容。默认关：藏不藏是用户的选择，不该替人决定。 */
  const [hideNsfw, setHideNsfw] = useState(false)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)

  const gallery = useGalleryData({ visible, root, query, includeBare, mergeDuplicates })
  const { items, itemsRef, total, truncated, loading, loadingMore, hasMore, notice, setNotice } = gallery

  // NSFW 过滤只作用在渲染层：数据仍全量在内存里，切回去立刻可见，不用重新拉。
  const nsfwFlags = items.map(item => isNsfw({
    name: item.name,
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    checkpoint: item.checkpoint,
  }))
  const hiddenNsfwCount = nsfwFlags.filter(Boolean).length
  const visibleItems = hideNsfw ? items.filter((_, i) => nsfwFlags[i] !== true) : items

  // 灯箱按路径寻址：删除或刷新后列表变了，也能重新定位到正确的那张。
  // **寻址与翻页都用 visibleItems**：用全量列表的话，隐藏 NSFW 之后按 → 会翻到看不见的图，
  // 计数也会显示成「第 30 张 / 共 9 张」。
  const activeIndex = activePath === null ? -1 : visibleItems.findIndex(entry => entry.path === activePath)
  const activeItem = activeIndex >= 0 ? (visibleItems[activeIndex] ?? null) : null

  const stepActive = (delta: number): void => {
    if (activeIndex < 0 || visibleItems.length === 0) return
    // 首尾相接：最后一张按 → 回到第一张。
    const next = (activeIndex + delta + visibleItems.length) % visibleItems.length
    const target = visibleItems[next]
    if (target !== undefined) setActivePath(target.path)
  }

  // 打开隐藏开关时，正在看的那张可能被判成 NSFW —— 别停在一个已经不可见的项上。
  useEffect(() => {
    if (hideNsfw && activePath !== null && activeItem === null) setActivePath(null)
  }, [hideNsfw, activePath, activeItem])

  useEffect(() => {
    if (activePath === null) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 确认层开着时，Esc 只关确认层：别把底下的灯箱一起关掉。
        if (pendingDelete !== null) setPendingDelete(null)
        else setActivePath(null)
        return
      }
      if (pendingDelete !== null) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepActive(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepActive(1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [activePath, pendingDelete, items])

  const handlers = { goToConversation }

  const onAction = (kind: ActionKind, item: GalleryItem): void => {
    // 删除先过确认层，不在这里直接发请求。
    if (kind === 'remove') {
      setPendingDelete(item)
      return
    }
    const key = `${kind}:${item.path}`
    if (busy === key) return
    setBusy(key)
    void runAction(kind, item, t, handlers)
      .then(message => { if (message !== '') setNotice({ kind: 'ok', text: message }) })
      .catch(error => setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(''))
  }

  const removeBusyKey = pendingDelete === null ? '' : `remove:${pendingDelete.path}`

  const confirmRemove = async (): Promise<void> => {
    const target = pendingDelete
    if (target === null || busy === `remove:${target.path}`) return
    setBusy(`remove:${target.path}`)
    try {
      // 删除就是彻底删：主项与它的全部副本一起从磁盘移除，不留任何一份。
      const paths = [target.path, ...(target.duplicates ?? [])]
      const res = await fetch(`${API}/delete-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      let payload: unknown = null
      try {
        payload = await res.json()
      } catch {
        // 非 JSON 错误体：用状态码
      }
      const bag = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
      if (!res.ok || bag === null || bag.ok !== true) {
        throw new Error(typeof bag?.message === 'string' ? bag.message : `删除失败：HTTP ${res.status}`)
      }
      const failures = Array.isArray(bag.failed) ? (bag.failed as Array<{ message?: unknown }>) : []
      const failure = failures[0]
      if (failure !== undefined) throw new Error(typeof failure.message === 'string' ? failure.message : '删除失败')

      const removedSet = new Set(Array.isArray(bag.removed) ? (bag.removed as string[]) : [])
      // 合并项在列表里只占一条，所以总数减一。
      gallery.dropItems(removedSet, 1)
      setActivePath(current => (current !== null && removedSet.has(current) ? null : current))
      setNotice({ kind: 'ok', text: t('removed') })
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy('')
      setPendingDelete(null)
    }
  }

  const selectedItems = (): GalleryItem[] => itemsRef.current.filter(entry => selected.has(entry.path))

  const toggleSelect = (item: GalleryItem): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(item.path)) next.delete(item.path)
      else next.add(item.path)
      return next
    })
  }

  const exitSelect = (): void => {
    setSelecting(false)
    setSelected(new Set())
    setBulkConfirmOpen(false)
  }

  // 只选看得见的那些：隐藏状态下全选若带上不可见项，一次删除会把它们一并删掉。
  const selectAllShown = (): void => setSelected(new Set(visibleItems.map(entry => entry.path)))
  const selectNone = (): void => setSelected(new Set())

  const bulkExport = async (): Promise<void> => {
    const chosen = selectedItems()
    if (chosen.length === 0) return
    const paths = chosen.map(entry => entry.path)
    setBusy('bulk:export')
    try {
      const res = await fetch(`${API}/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      if (!res.ok) {
        let message = `导出失败：HTTP ${res.status}`
        try {
          const data: unknown = await res.json()
          const bag = data !== null && typeof data === 'object' ? (data as { message?: unknown }) : null
          if (typeof bag?.message === 'string') message = bag.message
        } catch {
          // 非 JSON 错误体
        }
        throw new Error(message)
      }
      const skipped = Number(res.headers.get('X-Workbench-Skipped') ?? '0')
      const blob = await res.blob()
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      download(blob, `comfyui-workbench-workflows-${stamp}.zip`)
      const exported = Math.max(0, paths.length - skipped)
      setNotice({
        kind: 'ok',
        text: skipped > 0
          ? t('bulkExportedSkipped').replace('{n}', String(exported)).replace('{m}', String(skipped))
          : t('bulkExported').replace('{n}', String(exported)),
      })
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy('')
    }
  }

  const bulkRemove = async (): Promise<void> => {
    const chosen = selectedItems()
    if (chosen.length === 0) return
    const paths: string[] = []
    for (const entry of chosen) {
      paths.push(entry.path)
      for (const extra of entry.duplicates ?? []) paths.push(extra)
    }
    setBusy('bulk:delete')
    try {
      const res = await fetch(`${API}/delete-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      let payload: unknown = null
      try {
        payload = await res.json()
      } catch {
        // 非 JSON 错误体
      }
      const bag = payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
      if (!res.ok || bag === null || bag.ok !== true) {
        throw new Error(typeof bag?.message === 'string' ? bag.message : `删除失败：HTTP ${res.status}`)
      }

      const failures = Array.isArray(bag.failed) ? (bag.failed as Array<{ path?: unknown }>) : []
      const failedSet = new Set(failures.map(entry => String(entry.path ?? '')))
      const chosenPaths = new Set(chosen.map(entry => entry.path))
      // 副本不算条目：总数只按"被删掉的主项"扣。
      const failedPrimary = chosen.filter(entry => failedSet.has(entry.path)).length
      const removedCount = chosen.length - failedPrimary
      const removedPaths = new Set([...chosenPaths].filter(path => !failedSet.has(path)))
      gallery.dropItems(removedPaths, removedCount)

      setActivePath(current => (current !== null && chosenPaths.has(current) ? null : current))
      setNotice({
        kind: failedPrimary > 0 ? 'err' : 'ok',
        text: failedPrimary > 0
          ? t('bulkDeletePartial').replace('{n}', String(removedCount)).replace('{m}', String(failedPrimary))
          : t('bulkDeleted').replace('{n}', String(removedCount)),
      })
      setSelected(new Set())
      setBulkConfirmOpen(false)
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy('')
    }
  }

  const openInSidebar = (): void => {
    if (openSidebar() === false) setNotice({ kind: 'err', text: t('noSidebar') })
  }

  const emptyText = query.trim() !== ''
    ? t('emptyFiltered')
    : (hideNsfw && items.length > 0 ? t('emptyAllHidden') : t('empty'))

  return (
    <div className="cfa-root">
      <style>{CSS}</style>
      <Toolbar
        t={t}
        total={total}
        visibleCount={visibleItems.length}
        loadedCount={items.length}
        roots={gallery.roots}
        root={root}
        query={query}
        includeBare={includeBare}
        mergeDuplicates={mergeDuplicates}
        hideNsfw={hideNsfw}
        hiddenNsfwCount={hiddenNsfwCount}
        onToggleNsfw={() => setHideNsfw(value => !value)}
        selecting={selecting}
        embedded={embedded === true}
        onQuery={setQuery}
        onRoot={setRoot}
        onToggleBare={() => setIncludeBare(value => !value)}
        onToggleDuplicates={() => setMergeDuplicates(value => !value)}
        onToggleSelecting={() => (selecting ? exitSelect() : setSelecting(true))}
        onRefresh={() => gallery.reload(true)}
        onOpenSidebar={openInSidebar}
      />
      <div className="cfa-body" ref={gallery.scrollRef}>
        {loading && visibleItems.length === 0 ? <div className="cfa-hint">{t('loading')}</div> : null}
        {!loading && visibleItems.length === 0 ? <div className="cfa-empty">{emptyText}</div> : null}
        {visibleItems.length > 0 ? (
          <div className="cfa-grid">
            {visibleItems.map(item => (
              <Card
                key={item.path}
                item={item}
                t={t}
                selecting={selecting}
                selected={selected.has(item.path)}
                onToggle={toggleSelect}
                onOpen={entry => setActivePath(entry.path)}
                onAction={onAction}
              />
            ))}
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="cfa-more" ref={gallery.sentinelRef}>
            {loadingMore ? <span className="cfa-hint">{t('loading')}</span> : null}
            {!loadingMore && hasMore ? (
              <button type="button" className="cfa-chip" onClick={() => gallery.reload(false)}>{t('loadMore')}</button>
            ) : null}
          </div>
        ) : null}
        {truncated ? <div className="cfa-hint">{t('truncated')}</div> : null}
      </div>
      {notice !== null ? <div className={`cfa-notice${notice.kind === 'err' ? ' err' : ''}`}>{notice.text}</div> : null}
      {selecting ? (
        <BulkBar
          t={t}
          selectedCount={selected.size}
          busy={busy}
          onSelectAll={selectAllShown}
          onSelectNone={selectNone}
          onExport={() => { void bulkExport() }}
          onRemove={() => setBulkConfirmOpen(true)}
          onExit={exitSelect}
        />
      ) : null}
      {activeItem !== null ? (
        <Lightbox
          item={activeItem}
          index={activeIndex}
          count={visibleItems.length}
          t={t}
          onClose={() => setActivePath(null)}
          onAction={onAction}
          onPrev={() => stepActive(-1)}
          onNext={() => stepActive(1)}
        />
      ) : null}
      {pendingDelete !== null ? (
        <ConfirmRemove
          item={pendingDelete}
          t={t}
          busy={busy === removeBusyKey}
          onCancel={() => { if (busy !== removeBusyKey) setPendingDelete(null) }}
          onConfirm={() => { void confirmRemove() }}
        />
      ) : null}
      {bulkConfirmOpen && selecting ? (
        <ConfirmBulkRemove
          count={selected.size}
          t={t}
          busy={busy === 'bulk:delete'}
          onCancel={() => { if (busy !== 'bulk:delete') setBulkConfirmOpen(false) }}
          onConfirm={() => { void bulkRemove() }}
        />
      ) : null}
    </div>
  )
}
