# Cylindrical Chess | 圆柱面国际象棋

> 🌐 [中文版 README](./README.md)

A chess variant demo played on a horizontally cyclic board, featuring real-time Canvas rendering and a Web Worker AI engine. Supports human-vs-AI, AI-vs-AI, board scrolling, board flipping, and FEN import/export.

## Live Demo

- https://cylindrical-chess.pages.dev/

## Features

- Horizontally cyclic board (column **a** and column **h** are adjacent)
- Canvas board rendering with drag-to-scroll and board-flip support
- Human-vs-AI and AI-vs-AI modes; search depth is independently adjustable for each side
- FEN import/export and file export
- Automatic draw by threefold repetition or the 50-move rule
- AI runs in a Web Worker to keep the main thread responsive

## Development & Build

```bash
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

## Rule Notes

- Column coordinates wrap around cyclically (the cylindrical rule)
- En passant, castling, promotion, and checkmate are all implemented
- Automatic draw on threefold repetition or 50 moves without a pawn move or capture

## Tech Stack

- [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/)
- Canvas 2D rendering
- Web Worker AI search
- [Font Awesome](https://fontawesome.com/) SVG icons

## Source Layout

- [`src/main.ts`](./src/main.ts) — board rendering, rules, and user interaction
- [`src/aiWorker.ts`](./src/aiWorker.ts) — AI search and evaluation
