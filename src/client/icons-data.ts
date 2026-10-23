/**
 * 图标路径数据（24×24 viewBox，stroke 风格）。
 *
 * 与 dsh-comfyui-album 同源；只保留插件实际用到的那些，加图标时补一个键即可。
 */
export const ICON_BODY = {
      album: '<rect x="2.75" y="4.75" width="18.5" height="14.5" rx="2.6"/>'
        + '<circle cx="8.4" cy="9.7" r="1.55" fill="currentColor" stroke="none"/>'
        + '<path d="M3.9 17.4l4.35-4.2a1.6 1.6 0 0 1 2.2 0l3.55 3.5"/>'
        + '<path d="M12.9 14.2l1.75-1.7a1.6 1.6 0 0 1 2.2 0l2.55 2.5"/>',
      copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2.4"/>'
        + '<path d="M15 5.6A2.1 2.1 0 0 0 12.9 3.5H5.9A2.4 2.4 0 0 0 3.5 5.9v7a2.1 2.1 0 0 0 2.1 2.1"/>',
      text: '<path d="M4 6.5h16"/><path d="M4 12h11"/><path d="M4 17.5h8"/>',
      download: '<path d="M12 3.8v10.4"/><path d="M7.9 10.5l4.1 4.1 4.1-4.1"/>'
        + '<path d="M4.2 18.2v.6A2.2 2.2 0 0 0 6.4 21h11.2a2.2 2.2 0 0 0 2.2-2.2v-.6"/>',
      chat: '<path d="M4.2 5.8A2.3 2.3 0 0 1 6.5 3.5h11A2.3 2.3 0 0 1 19.8 5.8v8.2a2.3 2.3 0 0 1-2.3 2.3H9.6l-5.4 4z"/>'
        + '<path d="M12 7.6v5"/><path d="M9.5 10.1h5"/>',
      close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
      refresh: '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.4 3.8v5h-5"/>',
      search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6l4.4 4.4"/>',
      dock: '<rect x="3" y="4.2" width="18" height="15.6" rx="2.5"/><path d="M14.6 4.2v15.6"/>',
      chevronLeft: '<path d="M14.6 5.6L8 12l6.6 6.4"/>',
      chevronRight: '<path d="M9.4 5.6L16 12l-6.6 6.4"/>',
      minus: '<path d="M5.5 12h13"/>',
      plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
      trash: '<path d="M4.5 6.8h15"/><path d="M9.4 6.8V4.9a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.9"/>'
        + '<path d="M6.6 6.8l.8 12a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.8-12"/>'
        + '<path d="M10.3 10.4v6.2"/><path d="M13.7 10.4v6.2"/>',
    }

export type IconName = keyof typeof ICON_BODY
