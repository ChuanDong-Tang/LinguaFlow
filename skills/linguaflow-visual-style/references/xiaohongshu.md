# Xiaohongshu (小红书) mobile — research notes for OIO

Collected 2026-11-09. Sources are community design-system write-ups, not
official Xiaohongshu documents; treat numbers as approximate:
- https://github.com/nexu-io/open-design/blob/main/design-systems/xiaohongshu/DESIGN.md
- https://oh-my-design.kr/design-systems/xiaohongshu
- https://vp0.com/blogs/cn-app-fully-open-source-xiaohongshu-waterfall-component-react-native-component

## What we borrow

| Xiaohongshu | OIO |
|---|---|
| White note cards on a `#F5F5F5` canvas; cards separated by background color, no border, no shadow | `surface` on `feed` |
| Two-column waterfall, ~48% column width, ~7px row gap, ~6px side margin, rows deliberately unaligned | Home 回忆, 相关回忆, day photos |
| Card: image flush top → 1–2 line title (14/500) → footer (avatar + name left, ♥ count right), footer padding 8–10 | footer = date left, 👁 遇见次数 right |
| Cover image aspect set by the photo (3:4 default) | clamp 0.75–1.25 |
| Text tabs with a short underline in brand color under the active one (600 vs 400, gray) — never pills | 回忆 / 今日 / 盲盒, folder row |
| Brand color reserved for CTA, active tab, likes, badges | OIO green for CTA, active tab, done |
| Pill buttons 36–40 tall; secondary = gray fill, no border | `fill2` secondary buttons |
| Icon actions: 24px icon over/next to a 12px count in 45% black, no plate; active state switches color | reading-page footer |
| Search field: gray fill, no border | search |
| Bottom sheets replace most dialogs; scrim 50%, 16px top radius, drag handle | long-press card sheet, photo source sheet |
| Publish ＋ is a colored rounded rectangle in the bottom bar | dock ＋ |
| Hashtags in a dark navy link color | `# folder` tag |
| Note detail: carousel → title → body → tags → date/location → comments → fixed action bar | reading page |
| Tap card → detail expands from the cover (~400ms); skeleton while loading | existing card → detail transition |
| Text sizes: t1 18/600, t3 14/500, b1 16/400, c2 12/400 | `theme.type` |

## What we don't borrow

- The red brand color and logo — OIO's brand is the green from the mascot.
- Social features (avatars, follow buttons, comments) — OIO is a personal journal; the "reply" from OIO takes the comment slot.
