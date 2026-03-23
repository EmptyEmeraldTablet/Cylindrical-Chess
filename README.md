# Cylindrical Chess | 圆柱面国际象棋

> 🌐 [English README](./README.en.md)

横向循环棋盘的国际象棋变体演示，使用 Canvas 实时渲染与 Web Worker AI 搜索。支持人机对弈、机器对弈、棋盘视角滚动与翻转、FEN 导入导出。

## 在线示例

- https://cylindrical-chess.pages.dev/

## 功能概览

- 横向循环棋盘（a 与 h 相邻）
- Canvas 棋盘渲染，支持拖动滚动视角与棋盘翻转
- 人机对弈、机器对弈，双方 AI 深度可分别调节
- FEN 导入导出与文件导出
- 三次重复与 50 步规则自动和棋
- AI 使用 Web Worker，避免主线程卡顿

## 开发与构建

```bash
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

## 规则补充

- 棋盘列坐标循环处理（圆柱面规则）
- 吃过路兵、易位、升变与将死判断
- 三次重复或 50 步无兵移动/吃子自动和棋

## 技术栈

- Vite + TypeScript
- Canvas 2D 渲染
- Web Worker AI 搜索
- Font Awesome SVG 图标

## 目录提示

- `src/main.ts`：棋盘渲染、规则与交互
- `src/aiWorker.ts`：AI 搜索与评估
