# Sci-Fi Dashboard — дизайн-документация

Внутренний дашборд команды Solbot. Стиль: финансовый sci-fi терминал, вдохновлённый eDEX-UI и трейдинговыми терминалами. Тема — TRON cyan монохром.

## Цветовая система

Один акцентный цвет с разной прозрачностью даёт ощущение "свечения" — нет других ярких цветов.

### Акцент: `rgb(170, 207, 209)` (TRON cyan)

Декларация через RGB-компоненты, чтобы можно было менять прозрачность инлайн через `rgba()`:

```css
:root {
  --ar: 170; --ag: 207; --ab: 209;

  --accent:    rgb(var(--ar), var(--ag), var(--ab));
  --accent-90: rgba(var(--ar), var(--ag), var(--ab), 0.90);  /* активные значения */
  --accent-60: rgba(var(--ar), var(--ag), var(--ab), 0.60);  /* corner brackets, акцентный текст */
  --accent-40: rgba(var(--ar), var(--ag), var(--ab), 0.40);  /* hover */
  --accent-30: rgba(var(--ar), var(--ag), var(--ab), 0.30);  /* бордюры */
  --accent-15: rgba(var(--ar), var(--ag), var(--ab), 0.15);  /* dashed-разделители */
  --accent-08: rgba(var(--ar), var(--ag), var(--ab), 0.08);  /* фон scrollbar track */
}
```

### Производные

| Токен | Значение | Использование |
|---|---|---|
| `--bg` | `#000` | Основной фон страницы |
| `--panel` | `#0a0a0a` | Фон виджетов (чуть светлее чёрного) |
| `--fg` | `#e6e6e6` | Основной текст |
| `--muted` | `rgba(170,207,209, 0.55)` | Заголовки виджетов, подписи |
| `--muted-2` | `rgba(170,207,209, 0.25)` | Вторичные подписи |
| `--border` | `rgba(170,207,209, 0.18)` | Бордюры виджетов |
| `--border-hi` | `rgba(170,207,209, 0.30)` | Подсвеченные бордюры |

### Семантические цвета (сохранены)

| Токен | Значение | Использование |
|---|---|---|
| `--ok` | `#8fb88f` | Положительный PnL, win-rate, uptrend |
| `--bad` | `#b88f8f` | Отрицательный PnL, drawdown, downtrend |

### Цвета фаз рынка (BTC + 22 пары)

| Фаза | Цвет |
|---|---|
| `--phase-uptrend` | `#4e8c5e` (зелёный) |
| `--phase-creep_up` | `#8c7e3e` (жёлто-оранжевый) |
| `--phase-ranging` | `#555` (серый) |
| `--phase-creep_down` | `#6b4e8c` (фиолетовый) |
| `--phase-downtrend` | `#8c4e4e` (тёмно-красный) |
| `--phase-unknown` | `#333` |

## Типографика

- **Основной шрифт**: `Fira Code` (Google Fonts, weights 300/400/500)
- **Fallback**: `ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace`
- **Базовый размер**: 12px
- **Заголовки виджетов**: 10px, `letter-spacing: 2px`, uppercase, цвет `--muted`
- **Цифровые значения**: моноширинные, `font-variant-numeric: tabular-nums` где нужно ровное выравнивание

## Структура виджета (`.widget`)

```
┌── Corner bracket (top-left)
│
│  WIDGET TITLE        SUBTITLE/STATUS
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (dashed)
│
│  [body content]
│
│                       Corner bracket ──┐
└─────────────────────────────────────────┘
```

### Corner brackets (Г-уголки)

```css
.widget::before,
.widget::after {
  content: '';
  position: absolute;
  width: 12px; height: 12px;
}
.widget::before {
  top: -1px; left: -1px;
  border-top: 2px solid var(--accent-60);
  border-left: 2px solid var(--accent-60);
}
.widget::after {
  bottom: -1px; right: -1px;
  border-bottom: 2px solid var(--accent-60);
  border-right: 2px solid var(--accent-60);
}
```

То же на `.ticker-row` (top-left bracket).

### Заголовок виджета

```css
.widget h3 {
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--muted);
  display: flex;
  justify-content: space-between;  /* двухчастный: левая + правая часть */
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--accent-15);
}
```

## Эффекты "живости"

### Glow на ключевых значениях

```css
.glow         { text-shadow: 0 0 8px var(--accent-40); }
.glow-ok      { text-shadow: 0 0 8px rgba(143, 184, 143, 0.5); }
.glow-bad     { text-shadow: 0 0 8px rgba(184, 143, 143, 0.5); }
```

Применяется к:
- BTC live price (постоянно)
- PnL $-сумма (когда не ноль, цвет ok/bad)
- Trading metrics ok/bad значения
- Fear & Greed число (`text-shadow: 0 0 12px currentColor`)

### Pulse-dots (Online indicator, фазы)

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 0.6; box-shadow: 0 0 2px currentColor; }
  50%      { opacity: 1;   box-shadow: 0 0 6px currentColor; }
}
```

Используется в:
- Online-индикатор PnL (зелёный, 1.6s интервал)
- Доминантная фаза в Phase Detector (1.4s strong, 2.2s soft)
- Dot рядом с символом в Phases · 22

### Flash на смену значений

```css
@keyframes valueFlash {
  0%   { color: var(--accent); text-shadow: 0 0 10px var(--accent-60); }
  100% { color: inherit; text-shadow: none; }
}
.flash { animation: valueFlash 0.3s ease-out; }
```

BTC live price: `up`/`down` flash при изменении (0.6s).

## Layout

### Grid 3 × 5

```css
.dashboard {
  display: grid;
  grid-template-columns: 260px 1fr 320px;
  grid-template-rows: 32px 1fr 1fr 1fr 1fr;
  grid-template-areas:
    "ticker   ticker  ticker"
    "pnl      btc     detector"
    "metrics  btc     detector"
    "wm       flow    phases"
    "news     flow    phases";
  min-width: 1280px;
}
```

| Колонка | Виджеты | Логика |
|---|---|---|
| Левая (260px) | TickerBanner (полоса) → PnL → Metrics → WmFeed → News | стек по высоте |
| Центр (1fr) | BTC Chart (2 строки) → ArchitectureGraph (2 строки) | большие визуальные |
| Правая (320px) | Phase Detector (2 строки) → Phases · 22 (2 строки) | детали фаз |

### Ticker Banner

Бегущая строка вверху на всю ширину (3 колонки). 22 символа с ценами и стрелками направления (▲/▼), движется с `animation: scroll 90s linear infinite`. Pause on hover.

## Виджеты

### TickerBanner (top, full-width)
- Источник: `data/book/{SYMBOL}/*.parquet` (tail row)
- 22 пары: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LTC, NEAR, APT, ARB, OP, POL, SUI, INJ, TIA, SEI, HBAR, ENA, TRUMP, WIF
- Символы — accent-60 cyan, цены — белые, стрелки — ok/bad по последнему изменению

### PnL · Equity (left top)
- Источник: `/data/okx/equity_history.jsonl` (USDT eq из OKX `/account/balance`)
- Большой headline: `+$X.XX +X.XX%` (glow на ok/bad)
- Sub: `start → current` USD значения
- SVG-чарт: cumulative equity curve (acent цвет с gradient fill)
- Range switcher: `24h / 7d / 30d / all`
- Online-индикатор (pulse-dot)

### Trading · Metrics (left, 2nd row)
- Источник: `/data/okx/closed_positions.jsonl`
- 6 полей: bots, trades, win-rate, sharpe, max DD, profit factor
- Dashed-разделители между полями
- Glow на ok/bad значениях
- Поля сжимаются на узких экранах (`flex-shrink: 1`)

### BTC / USDT · 1H (center top, 2 rows)
- Источник цены: `data/candles/BTCUSDT/1h/*.parquet` + Binance public klines (auto-fill)
- Источник фаз: `orchestrator.db.phase_history` (1h buckets, smoothing 5h)
- Live tick: `/api/btc/tick` (Binance ticker, 1s polling)
- **Sliding window 10 дней** (с 0.64): `from = Date.now() - 10d`, левый край сдвигается каждый час
- 5 phase lines (uptrend/creep_up/ranging/creep_down/downtrend) поверх линии цены
- Live price в правом верхнем углу с glow + flash на изменение
- UTC clock (`HH:MM:SS UTC`, обновляется ежесекундно)
- Crosshair на hover/touch с tooltip (цена + распределение фаз)
- Wheel-zoom с сохранением радиуса (не сбрасывается на rotation)
- **Mobile fix (0.65)**: `@media (max-aspect-ratio: 3/4)` → `max-height: 400px` на SVG (убирает экстремальный vertical-стрейтч на Fold6 portrait)

### BTC · Phase Detector v2 (right top, 2 rows)
- Источник: `orchestrator.db.decisions` (latest)
- 4 строки: `now`, `prediction +1h`, `prediction +4h`, `prediction +24h`
- Каждая: dominant phase с pulse-dot + 5 phases с процентами + дельтами `(+N) / (-N) / (0)`
- Дельты: для `now` — vs 1h ago, для predictions — vs now
- Цвет дельты: ok/bad/zero
- Анимация `fadeSlideIn` при смене доминантной фазы

### WM · Fear/Greed | ETF | Geo (left, 4th row)
- Источник: Redis worldmonitor (`wm:etf`, `wm:geo`) + `alternative.me/fng/`
- 3 таба: `fear/greed` (default), `etf`, `geo`
- F&G: большая цифра 36px с glow, 10-сегментная шкала, classification
- ETF: INFLOW / OUTFLOW / FLAT крупно цветом, счётчики in/out/total
- Geo: 6 регионов с барами, цвет по threshold

### News · WM (left bottom)
- Источник: Redis `wm:news`
- Карточный стиль с border-left, threat badge (LOW/MEDIUM/HIGH/CRITICAL цветами)
- Headline в русском (Google Translate auto, кэш LRU 500)
- Auto-scroll 0.5px/30ms, pause on hover, soft reset в начало
- Mask-image gradient на верхнем/нижнем краях
- Touch-aware (auto-scroll отключён на touch)

### Architecture · Graph (center bottom, 2 rows)
- Источник: `/root/solbot-architecture.json` (parsed из Obsidian-vault `Rohan trade system`)
- 161 нод / 515 связей
- 3D force-graph (`3d-force-graph` + `d3-force-3d`)
- Sphere layout (`forceRadial(95).strength(0.95)` + charge -40 + link distance 20)
- Цвета: ноды/линки/частицы в TRON cyan (`#aacfd1`)
- Hover: подсветка соседей, остальные → dim, рёбра сжимаются
- Auto-rotation вокруг Y-оси (с сохранением user zoom)
- Streaming log слева: real события из `/var/log/phase-broadcaster.log` + синтетические из `/api/phases/current`, opacity gradient (свежие ярче)
- Right card на hover: title, folder, summary, backlinks
- Particles на edges (2 шт, slow speed)

### Phases · 22 (right bottom, 2 rows)
- Источник: in-memory push от phase-broadcaster (5-й endpoint, ingest каждые 5 мин)
- 22 ячейки в 2 колонки grid
- Каждая ячейка: символ + pulse-dot цветом фазы + confidence% + название фазы + vol_regime sigil
- Border-left ячейки = цвет текущей фазы
- Counts header: `uptrend 5  creep_up 12  ranging 4  ...`
- Auto-scroll (как в News), persist phases между рестартами через `last_phases.json`

## Скроллбары

```css
::-webkit-scrollbar       { width: 4px; }
::-webkit-scrollbar-track { background: var(--accent-08); }
::-webkit-scrollbar-thumb { background: var(--accent-30); }
::-webkit-scrollbar-thumb:hover { background: var(--accent-40); }
```

Тонкие, циановые, ненавязчивые.

## Адаптивность

### Текущая стратегия

`<meta name="viewport" content="width=1300">` — браузер на любом экране рендерит как 1300px CSS-pixels, потом масштабирует под физический экран. "Точная копия десктопа" концепция.

### Mobile (Samsung Z Fold 6, planshet mode)
- Viewport scale автоматический (~64% на 829 CSS-px → 1300 design-px)
- Touch-crosshair на BTC chart (`@touchmove` + `@touchend`)
- Auto-scroll отключён на touch-устройствах (`'ontouchstart' in window`)
- 3D graph: OrbitControls touch нативно
- BTC chart cap height на portrait viewports (`@media (max-aspect-ratio: 3/4)`) — фикс stretching на Fold6 cover screen

### Что сохраняется
- Layout grid не меняется (3 колонки всегда)
- Размеры виджетов масштабируются пропорционально

## Что отвергнуто (из eDEX-UI демо, не подходит для рабочего инструмента)
- Boot sequence (раздражает при частых заходах)
- Scanlines / CRT-overlay (мешает читаемости)
- Glitch-эффекты (не подходят для рабочего терминала)
- Dot-grid фон (слишком навязчив)
- Streaming log overlay поверх всех виджетов
- Звуковые эффекты
- Theme switcher (UI меняется через CSS-переменные, можно подключать темы при необходимости)

## Версия и история

- Текущая prod версия: **dashboard:0.64**
- Staging для Fold6 теста: **dashboard:0.65** (`http://62.60.232.247:8080`)
- Backup исходной серой версии: `dashboard/_backup_v0.58/` (styles.css, App.vue)
- Standalone демо варианта C (полный sci-fi с boot sequence): `demo-sci-fi.html` (не применён)

## Файлы

- `dashboard/web/src/styles.css` — глобальные CSS-переменные, layout grid, corner brackets, утилиты
- `dashboard/web/src/widgets/*.vue` — виджеты (scoped styles внутри)
- `dashboard/web/index.html` — viewport meta, root mount
- `dashboard/web/src/App.vue` — композиция виджетов
