# dsh-comfyui-workbench

[中文](README.md) · **English**

A ComfyUI workbench for [DSH](https://github.com/deepseek-ai): **hand your local ComfyUI workflows to the model**, and manage which workflows the model is allowed to use.

There are three user-facing panels — Assets, Workflows, and the ComfyUI terminal — all backed by ComfyUI's own capabilities rather than a parallel state layer. **No built-in generation UI**: if you want to generate by hand, just open ComfyUI.

> This plugin is the successor to [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album); asset browsing is inherited from it (shared code lineage). Running both gives you two entry points and two delete buttons — we recommend uninstalling the album plugin. `scripts/migrate-album.mjs` ships only in the repository: if you installed from a package you'll need to clone the repo and run it there.

## Six components

Each is mounted in the profile's `cordis.patch.yml` as its own loader entry — visible in the host's Settings → Plugins, and individually toggleable.

| entry | kind | responsibility |
| --- | --- | --- |
| `comfyui-workbench:core` | server | Initializes the shared runtime (ComfyUI client / process supervision / asset index / output dir) and hosts the browser bundle. **Its `name` must be the package root** — the host only assembles `exports["./client"]` for root specifiers |
| `comfyui-workbench:gallery` | panel | Assets: listing, filtering, thumbnails, deletion, bulk workflow ZIP export |
| `comfyui-workbench:workflow` | panel | Workflow admin: listing, the `enabled` toggle, purpose notes, plus `/run`, `/config` and the service-supervision endpoints |
| `comfyui-workbench:generate` | tools | `comfyui_workflow_list`, `comfyui_workflow_inspect`, `comfyui_run` |
| `comfyui-workbench:edit` | tools | `comfyui_workflow_edit` |
| `comfyui-workbench:danbooru` | tools | `danbooru_lookup`, `danbooru_sync`: character/artist tag library with Chinese names. Does not touch the ComfyUI runtime, so it can be disabled on its own |
| `comfyui-workbench:terminal` | panel | ComfyUI terminal: shows child-process output or `user/comfyui.log` and can start the service from the panel |

Disabling one affects only that one. Turn off `gallery`, for example and its routes 404 while workflow admin and the tools keep working. Two exceptions: bulk workflow ZIP export needs images and sidecars, so it depends on the gallery; and disabling `core` disables the whole plugin — the HTTP API and browser bundle both disappear.

## Install

```sh
# from the repository
dsh plugin --profile desktop add github:YuChenLiao/dsh-comfyui-workbench

# local development
dsh plugin --profile desktop add link:D:/dsh/dsh-comfyui-workbench
```

Restart DSH afterwards. Seven entries get inserted into `cordis.patch.yml` (the root `core` plus six components); their config is shared through a YAML anchor so you write it once:

```yaml
- insert:
    - id: comfyui-workbench:core
      name: dsh-comfyui-workbench
      config: &cwf
        baseUrl: http://127.0.0.1:8188
        autoStart: true
        disabledComponents: []
    - id: comfyui-workbench:gallery
      name: dsh-comfyui-workbench/gallery
      config: *cwf
    # :workflow / :generate / :edit / :danbooru / :terminal follow the same pattern
```

## Configuration

| field | meaning |
| --- | --- |
| `baseUrl` | ComfyUI address, default `http://127.0.0.1:8188` |
| `outputDir` | Where artifacts land. **Leave it empty and they go to `<current workspace>/comfyui-output`**; if no workspace can be resolved it falls back to `<plugin data dir>/outputs` (`GET /config` reports `outputSource: data` in that case, and `workspaceProbe` shows how detection went: whether `cwd` was rejected as a host-internal directory and how many paths `workspaceRegistry` returned). Pin it explicitly if you want a fixed location |
| `workflowsDir` | Workflow repository, default `~/.dsh-comfyui-workbench/workflows` |
| `autoStart` | Whether to launch ComfyUI when a local installation is detected. Only processes we started are ever stopped |
| `disabledComponents` | Components to turn off, e.g. `['panel.gallery']`. An empty array means all are on |
| `timeoutMs` | Per-request HTTP timeout; also the default wait ceiling for `comfyui_run` |
| `pollIntervalMs` | Status polling interval while a run is in flight |
| `roots` | Extra directories to include in the asset library (the current workspace, `dsh-comfyui-image`'s `outputDir` and the output dir are already included) |
| `assetRoots` | Extra **writable** roots. `assertWritable` takes the union of all authorized roots (`roots` / workspaces / cwd / output dir / uploads / `assetRoots`) and rejects writes that land outside it |

## Model tools

| tool | what it does |
| --- | --- |
| `comfyui_workflow_list` | Lists **available** workflows: id, title, purpose note, base model, input kinds, output shape. Disabled ones are omitted (`hiddenCount` says how many). When `/object_info` is unreachable, it does not flag missing models — that would report "offline" as "missing models" |
| `comfyui_workflow_inspect` | Without `nodeId`: the IO surface plus node list. With it: one node's full config. Also reports missing nodes, missing models and available substitutes |
| `comfyui_run` | **Asynchronous by default**: returns a `promptId` immediately, watches in the background and pushes the result into the conversation when the image is done. Supports `wait: true` for synchronous waiting and `promptId` for re-checking. Disabled workflows are rejected outright |
| `comfyui_workflow_edit` | Edits title / description / tags and single-node parameters. Changes apply to the next run only by default; writing back to the template requires `persist` + `expectHash`. Parameters bound to a variable cannot be edited here (`param_bound`) — pass the variable through `comfyui_run`'s `vars` instead |
| `danbooru_lookup` | Looks up characters and artists by Chinese name, Japanese name or Danbooru tag, and **returns tags only**. Aligning names before writing a prompt keeps generations on-model |
| `danbooru_sync` | Pulls character/artist tags (including Chinese names) into the local library. Thousands of requests — call it only when the user asks |

A workflow's "available" flag lives in `<id>.meta.json` under `enabled` (default `true`); the panel and `comfyui_workflow_edit` write the same file.

## Danbooru tag library

When writing prompts, the model often knows the Chinese name for a character but not `ganyu_(genshin_impact)`, or the reverse. `danbooru_lookup` maps between them and **returns tags only**:

```json
{ "ok": true, "tags": ["ganyu_(genshin_impact)"], "source": "local" }
```

Context is scarce, so the result carries no `postCount`, alias list or match kind — the model only needs to know which tag a name maps to.

**Failover to a mirror**: `safebooru.donmai.us` is Danbooru's official SFW mirror — same API, same data (we verified `post_count`, wiki `other_names` and alias reverse-lookups field by field against the main site). On timeout (8 s without a response), `5xx`, `429` or endpoint `404`, the plugin switches over and the result is unchanged. Once a mirror has worked, it is preferred over the main site.

Sites running "the same software, a different database" cannot serve as mirrors. `aibooru.online` reports `hatsune_miku` at 1,821 posts versus 148,311 on the main site — using it would hand back wrong popularity and wrong results.

**Empty local library still works**: if the library is empty or has no match, the lookup goes online (`source` becomes `online`). Chinese and Japanese names go through `search[other_names_match]` (the only field Danbooru exposes for reverse alias lookup); plain ASCII names use `search[name_matches]` with fuzzy matching. So you can use it without ever syncing — just slower, with a network round-trip per query.

**The primary data source** is [`danbooru-tags-data-zh`](https://github.com/amenorira/danbooru-tags-data-zh) (MIT, © 2026 amenorira), and **the data ships inside the plugin** under `data/danbooru/`, so it works out of the box without a sync: a community-maintained Chinese translation library covering Danbooru tags with more than 50 posts, including Chinese names, aliases (community nicknames too — Miku's "葱娘" among them) and a one-line note (notes are stored but never returned; the model only needs the tag). Measured coverage: **35,384 characters** and **24,881 artists**; 99.7% / 95.8% of upstream CSV rows carry a Chinese name or alias and after removing shared aliases (ship names and the like), the bundled copy is at **98.7% / 94.9%**. This beats scraping the wiki — that route gets almost no Chinese names for artists (Danbooru's artist wikis do not populate `other_names`) and takes 100 seconds for 400 rows.

To bring the local library up to date, pick one of these (run them in the directory holding `package.json` — the repo root, or `node_modules/dsh-comfyui-workbench/` in an install):

```sh
npm run danbooru:zh                        # fetch upstream into the plugin data dir (~5 s depending on network; the first run downloads a few MB of CSV, so call it 10 s), replacing the local copy
npm run danbooru:zh -- --kind character    # characters only
npm run danbooru:zh -- --dry               # just report how many rows would be imported
```

Note that it writes to the **plugin data directory** (`~/.dsh-comfyui-workbench/danbooru/`), never to `data/danbooru/` in the repo — that copy is the snapshot shipped with the package. To update the bundled data as well, import first and then copy it over:

```sh
cp ~/.dsh-comfyui-workbench/danbooru/*.jsonl data/danbooru/
```

**Supplementary path**: you can also scrape Danbooru directly (`tags.json` plus per-tag `wiki_pages.json`). Data is fresher and you get the newest wiki aliases, but the request volume is large — good for a hot slice only:

```sh
npm run danbooru:sync                      # post count >= 100, at most 3000 per kind
npm run danbooru:sync -- --min 0 --max 0   # everything (400k+ character tags, around 30 hours at measured speed)
```

`--min` is the popularity threshold (`search[post_count]=>N`) and `--max` caps rows per kind; `0` means unlimited. A full sync is slow — the bottleneck is per-tag wiki lookups, measured at roughly 3–4 tags/second with 8 concurrent requests, so 400k tags take about 30 hours. That is what `--max` is for: pull a hot slice first (e.g. `--min 300 --max 400`, about four minutes for both kinds) and widen later.

**If the local library is empty** (an older install, or a setup where only `lib/` was copied — `github:` installs pack by `files`, `link:` points at the repo and both carry `data/`), lookups fall through to online (`source: online`). Function is unaffected, but it is an order of magnitude slower — **about 30–70 ms** locally (both kinds; the first query in a fresh process is ~0.13 s because it parses 12 MB of JSONL), versus **about 1 s** online for a plain ASCII tag (one fuzzy match per kind), **about 2 s** for a single-candidate Chinese name, and **4–6 s** when a Chinese name has several candidates (wiki reverse lookup, then a `post_count` re-query per candidate); worse on a bad network. Results are also narrower: locally, "圣园未花" yields `mika_(blue_archive)` plus its swimsuit and track variants — three tags; online returns only the main tag.

To add data:

```sh
# as above: cwd must be the directory holding package.json, or npm reports a missing script
cd <install dir>/node_modules/dsh-comfyui-workbench && npm run danbooru:zh

# or from any directory, by script path (cwd-independent)
node <install dir>/node_modules/dsh-comfyui-workbench/scripts/import-danbooru-zh.mjs
```

It writes to the **plugin data directory** (`~/.dsh-comfyui-workbench/danbooru/`), not to `data/` inside the install — the latter is the bundled snapshot and is never written at runtime (the install directory may also be read-only).

Adding a single row by hand is possible, but three things matter:

First, **replacement is per kind, per file**: writing only `characters.jsonl` affects characters; artists are untouched and keep using their own file (falling back to the bundle only when no `artists.jsonl` exists in the plugin data directory). Second, `>>` appends: if you already ran `danbooru:zh` and have a full library, appending just adds a row at the end (it only grows until the next import); only when you rely on the bundled snapshot and have no local copy does creating that file reduce the kind to that single row (shadowing all 35,384 characters / 24,881 artists). Third, **restart the plugin** afterwards: if that kind was already queried, its tags are in the in-memory cache and changes are invisible until a restart.

```sh
mkdir -p ~/.dsh-comfyui-workbench/danbooru
echo '{"tag":"mika_(blue_archive)","kind":"character","postCount":16024,"names":["圣园未花"]}' \
  >> ~/.dsh-comfyui-workbench/danbooru/characters.jsonl
```

The format is JSONL, **not** the upstream CSV (the runtime reads `<kind>s.jsonl` only; CSV files placed there are ignored).

Both `danbooru:zh` and `danbooru:sync` write by **whole-file replacement**: they rewrite `<plugin data dir>/danbooru/<kind>s.jsonl` (temp file, then rename, so an interrupted run never leaves half a file). Any rows you appended by hand are overwritten by the next import or sync.

**Entries with no aliases are not left blank**: those rows (473 characters and 1,258 artists in the bundled data) have an empty `names` array but are still findable by tag — looking up `chainsaw_man_(character)` returns itself, because `danbooru_lookup` always returns the name Danbooru recognizes.

The scrape path (`danbooru:sync`) filters out derivative-event names, year suffixes and plain-ASCII variants; the Chinese library import (`danbooru:zh`) takes everything, since that data is already curated and includes community nicknames and older translations. **Ship names** (one name covering two characters, like `レイマリ`) are detected mainly by whether an alias is shared across multiple tags — more reliable than guessing from the text and this does not misfire on `初音ミク`; when shared, the alias stays only on the hottest record. There is also a conservative character filter (values containing `×` or `&`, literally containing `cp`, or a lone relationship word). The result is that each alias maps to at most one candidate — no more "one name returns two people, both flagged exact".

Rate limits and network errors during a sync are retried with backoff; rows that still fail are reported by count in the log (those rows are missing aliases and a re-run fills them in).

This component can be disabled on its own (host plugin page, or `disabledComponents: ['tool.danbooru']`) without affecting the generation path.

## Hiding NSFW

The asset toolbar has an ellipsis to the right of the refresh button — hover it to reveal "Hide NSFW". Once enabled, assets judged NSFW disappear from the list and the button shows how many were hidden.

The judgment is a **heuristic word list**, not a classifier. It scans the file name, the positive prompt, the base model name and the workflow id:

- Strong signals (`nsfw`, `explicit`, `hentai`, genital terms, and Chinese phrases like `完全裸露` / `完整裸露` / `赤裸` / `全裸`) match on a single hit
- Medium signals (`nude`, `breast`, `lingerie`, plus `裸露` and `乳房`) need **two** to trigger — in anime tags `breasts` + `nipples` are standard for swimsuit and anatomy references, so a single hit would always misfire

**Negative prompts are not considered.** The officially recommended negatives for Danbooru-family checkpoints (AnimagineXL, Pony) literally contain `nsfw` — judging on that would hide every image from a whole workflow setup, even when the user is in fact excluding adult content.

Filtering happens at render time only: the data stays in memory, so toggling back is instant with no refetch. With the filter on, "select all" selects only what you can see — otherwise one delete would take the hidden items with it.

## Terminal panel

The third panel (after Assets and Workflows) shows ComfyUI's **command-line output**. What the service is doing, where it is stuck, how far a model has loaded — that only exists in the terminal, not in the GUI.

- **Externally started instances work too**: a process the plugin launched has its stdout/stderr piped in; an external instance (one Desktop started itself) has no accessible stdout, so the panel reads the `user/comfyui.log` it writes. Only one path is active at a time — ComfyUI's logger attaches both a Stream handler and a File handler, so reading both would duplicate every line.
- When the service isn't running the panel offers a Start button, launching it directly instead of making you go generate an image first.
- Polls for increments once a second (with a cursor, so the full screen is not re-downloaded); auto-follows the tail but never yanks you back if you scroll up.
- Pause, keyword filter and clear are available. The buffer keeps the last 2,000 lines and tells you when earlier output rolled off.
- ANSI escapes (color, progress-bar `\r` redraws) are stripped before storage — otherwise the panel is a wall of garbage.
- The child process is forced to `PYTHONIOENCODING=utf-8`; without it Python on Windows encodes its output with the console code page and Chinese text turns into tofu.

Disabling it affects only this panel (`panel.terminal`); everything else keeps working.

## Artifacts and notifications

- Artifacts go to `<current workspace>/comfyui-output` by default, with a `<file>.json` sidecar next to the main artifact (prompt, seed, workflow, original dimensions, promptId). When one run yields several images, only the first carries a sidecar.
- Images are returned as **paths plus original pixel dimensions**, never inline bytes: the host rebuilds requests per `{type:'image', attachment}` block and a raw base64 block throws and poisons every later request in that session.
- When a run finishes, the plugin pushes the result into the conversation (`Agent.followup`, source `plugin:dsh-comfyui-workbench`); the success, failure and timeout paths each deliver exactly once.

## Layout

```
src/components/panel-gallery/      assets: server/(routes/scan/index/thumbs) + client/
src/components/panel-workflow/     workflow admin: server/(routes/run/config) + client/
src/components/tool-generate/      generation tools
src/components/tool-workflow-edit/ workflow editing tool
src/shared/                        shared logic: host / comfy / workflow / run / tools / http / authz / media
src/http/                          HTTP prefix and dispatch (router)
src/client/                        UI shell: tabs, api, i18n, icons
src/index.ts                       package-root entry (browser bundle + shared runtime init)
src/entries/                       six component entries (core is src/index.ts)
src/runtime.ts                     cross-entry shared runtime (anchored on ctx.root)
```

The first step of `npm test` (`node tests/arch.mjs`) enforces three boundaries: `shared` is one-directional internally (host at the bottom), a component's `server` never imports its `client` and shell modules never import a specific component.

## Development

```sh
npm install
npm run build      # src → lib/index.js (host) + lib/client.js (browser) + lib/entries/*.js + lib/{workflow,store,run,comfy}.js (for tests)
npm test           # architecture + class names + host API + client render + notifications + component isolation
npm run typecheck
npm run accept     # tick items off against a running DSH (real-environment acceptance); -- --run does one full generation
node scripts/compat.mjs   # workflow compatibility scan: missing nodes / missing models / image inputs required
```

`node scripts/smoke-workflows.mjs` runs each workflow for real (parameters squeezed to 512 on the long edge, 1 step) to verify only that it submits, generates and retrieves.

Importing a workflow: `node scripts/import.mjs <workflow.json>` (`--list` shows what's there). API format only — for UI-format files, use Export (API) inside ComfyUI.

## Compatibility

| plugin | relationship |
| --- | --- |
| [`dsh-comfyui-image`](https://github.com/wbb316/dsh-comfyui-image) | **Companion**: reads the images and sidecars it writes, plus its `outputDir` config. Its code is never imported |
| [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) | **Optional**: registers a tab; without it the native sidebar entry still works. The tab must be added once from the sidebar's "+" menu |
| [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) | **Predecessor**: uninstall it. To migrate, run `node scripts/migrate-album.mjs --write` inside this repository (the script is not shipped in the package) |

## Docs

- Design: [docs/design.md](docs/design.md)
- Changelog: [CHANGELOG.md](CHANGELOG.md)

## Credits

Tag data comes from [amenorira/danbooru-tags-data-zh](https://github.com/amenorira/danbooru-tags-data-zh) (MIT, © 2026 amenorira), which covers Danbooru tags with more than 50 posts along with their Chinese names, aliases and notes. The data ships with the plugin under `data/danbooru/`, and the upstream license is included verbatim (see [data/danbooru/LICENSE](data/danbooru/LICENSE) and [NOTICE.md](data/danbooru/NOTICE.md)).

This plugin performs only these transformations: field-name mapping (CSV → JSONL), row filtering by `category`, `names` normalization (Chinese name first, drop entries identical to the tag, drop empty strings, deduplicate within a record) and shared-alias removal (aliases used by several records are kept only on the hottest one). Tag, Chinese name and note text are untouched. Re-import with `danbooru:zh` above when upstream updates.

## License

MIT
