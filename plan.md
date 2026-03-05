# 圆柱面国际象棋实现文档

## 1. 引言
本文档旨在为开发一款基于国际象棋变体——圆柱面国际象棋的网页应用提供完整的技术实现指南。该变体的核心特点是棋盘左右两侧联通（形成圆柱面），所有具有横向移动分量的棋子均可穿过边界。应用将使用 TypeScript 和 Canvas 构建，支持人人对弈、人机对弈和机器对弈三种模式，并提供落子提示、视角滚动、棋局保存与加载等交互功能。

## 2. 游戏规则（圆柱面变体）

### 2.1 基本定义
- **棋盘**：8×8 方格，列坐标 a～h 循环相连（a 列左侧为 h 列，h 列右侧为 a 列），行坐标 1～8 保持线性（上下不连通）。
- **棋子**：与传统国际象棋相同，每方有王、后、车、象、马、兵各 8 枚。
- **目标**：将死对方王。

### 2.2 移动规则
所有棋子的移动均需考虑列循环。移动时，列坐标通过模 8 运算进行循环。

- **王、后、车、象**：沿方向向量逐步移动，每步列坐标进行模 8 处理，直到遇到棋子或回到原点（避免无限循环）。可吃子。
- **马**：按 L 型（2 行 1 列 或 1 行 2 列）移动，新列 = (原列 + 列偏移 + 8) % 8，若新行在 0～7 内，且目标格为空或有敌方棋子，则为合法。
- **兵**：
  - **向前移动**：不涉及横向移动，不穿过边界。白兵从第 2 行向前一步到第 3 行，两步到第 4 行（需初始位置且中间格为空）。黑兵类似。
  - **斜吃**：可穿过边界。例如，白兵在 a2 可斜吃 h3 的敌子（右前方向经边界），或斜吃 b3（传统方向）。吃过路兵同样适用于边界（如 h5 与 a5 相邻）。
- **王车易位**：
  - 条件：王与车均未移动，王不在将军，王经过的格子（包括目标格）不被攻击，且王与车之间无棋子阻隔。
  - 由于列循环，易位路径可能穿过边界。计算时，王向车方向移动两格（按循环最短路径方向），检查中间格子（循环计算）是否为空且不被攻击。
  - 车移至王经过的那个格子（即王起始格与目标格之间的格子）。若王移动后落在车原位上，则易位非法。
- **吃过路兵**：当对方兵从初始位置向前两格，与本方兵在同一横排且相邻列（包括循环相邻，如 h5 与 a5），本方兵可在下一回合斜吃至该兵后方一格。规则与传统一致。

### 2.3 特殊状态
- **将军**：一方王受到攻击。
- **将死**：一方无合法走法且王被将军。
- **逼和**：一方无合法走法且王未被将军。
- **长将和棋**：重复局面三次。

## 3. 系统架构
应用采用模块化设计，各层职责明确，通过接口通信。

```
┌─────────────────┐
│   UI 层 (Canvas)│  绘制棋盘、棋子、落子提示；监听鼠标事件
└────────┬────────┘
         │ 用户输入/更新视图
┌────────▼────────┐
│   游戏控制器     │  管理游戏状态、回合、模式；调用规则验证
└────────┬────────┘
         │ 查询/修改
┌────────▼────────┐
│   棋盘模型       │  数据结构、移动生成、合法性检查、将死判断
└────────┬────────┘
         │ 请求走法
┌────────▼────────┐
│   AI 引擎        │  搜索最佳走法，返回给控制器
└─────────────────┘
```

- **TypeScript**：提供强类型支持，便于维护。
- **Canvas**：直接绘制棋盘，无需第三方库，灵活可控。
- **事件驱动**：用户操作触发控制器，控制器更新模型并重绘。

## 4. 棋盘表示与数据结构

### 4.1 棋盘核心类型
```typescript
type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
type Color = 'w' | 'b';
type Square = { type: PieceType; color: Color } | null;

class Board {
  squares: Square[][];           // 8x8，索引 [row][col] (row=0 对应第1行，col=0 对应 a列)
  turn: Color;                   // 当前走棋方 'w' 或 'b'
  castling: string;              // 易位权限，如 "KQkq"（K:白方短易位，Q:白方长易位，k:黑方短易位，q:黑方长易位）
  enPassant: number;             // 过路兵目标列索引，-1 表示无（行由对方兵的位置决定）
  halfMove: number;              // 半回合数（用于50步规则）
  fullMove: number;              // 整回合数
}
```

### 4.2 辅助函数
```typescript
// 列索引与字母转换
function colToFile(col: number): string {
  return String.fromCharCode(97 + col); // 0->a, 1->b, ...
}
function fileToCol(file: string): number {
  return file.charCodeAt(0) - 97;
}

// 行索引与行号转换（内部索引0为第1行）
function rowToRank(row: number): number {
  return row + 1;
}
function rankToRow(rank: number): number {
  return rank - 1;
}

// 循环列计算
function cyclicCol(col: number, delta: number): number {
  return (col + delta + 8) % 8;
}
```

## 5. 移动生成与规则验证

### 5.1 通用移动生成器
为每种棋子生成所有可能的目标格子（不考虑是否导致己方被将）。

**王、后、车、象**：
```typescript
function generateSlidingMoves(board: Board, row: number, col: number, directions: [number, number][]): Move[] {
  const piece = board.squares[row][col]!;
  const moves: Move[] = [];
  for (const [dr, dc] of directions) {
    let r = row + dr;
    let c = cyclicCol(col, dc);
    let steps = 0;
    while (r >= 0 && r < 8 && steps < 8) { // steps 防止无限循环（横向时可能绕圈）
      const target = board.squares[r][c];
      if (target === null) {
        moves.push({ from: [row, col], to: [r, c] });
      } else {
        if (target.color !== piece.color) moves.push({ from: [row, col], to: [r, c] });
        break; // 遇到棋子停止
      }
      r += dr;
      c = cyclicCol(c, dc);
      steps++;
    }
  }
  return moves;
}
```

**马**：
```typescript
const knightOffsets = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1]
];
function generateKnightMoves(board: Board, row: number, col: number): Move[] {
  // 类似，新列用 cyclicCol 计算
}
```

**兵**：
```typescript
function generatePawnMoves(board: Board, row: number, col: number, color: Color): Move[] {
  const moves: Move[] = [];
  const direction = color === 'w' ? 1 : -1;
  const startRow = color === 'w' ? 1 : 6;
  // 向前一步
  let r = row + direction;
  if (r >= 0 && r < 8 && board.squares[r][col] === null) {
    moves.push({ from: [row, col], to: [r, col] });
    // 向前两步
    if (row === startRow && board.squares[r + direction][col] === null) {
      moves.push({ from: [row, col], to: [r + direction, col] });
    }
  }
  // 斜吃（包括边界）
  for (const dc of [-1, 1]) {
    const nc = cyclicCol(col, dc);
    if (r >= 0 && r < 8) {
      const target = board.squares[r][nc];
      if (target && target.color !== color) {
        moves.push({ from: [row, col], to: [r, nc] });
      }
    }
  }
  // 吃过路兵
  if (board.enPassant !== -1) {
    // 检查左右相邻列（包括循环）
    const leftCol = cyclicCol(col, -1);
    const rightCol = cyclicCol(col, 1);
    const epRow = color === 'w' ? row + 1 : row - 1;
    if (epRow >= 0 && epRow < 8) {
      if (leftCol === board.enPassant) {
        moves.push({ from: [row, col], to: [epRow, leftCol] });
      }
      if (rightCol === board.enPassant) {
        moves.push({ from: [row, col], to: [epRow, rightCol] });
      }
    }
  }
  return moves;
}
```

**王**：
```typescript
function generateKingMoves(board: Board, row: number, col: number): Move[] {
  const moves: Move[] = [];
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = row + dr;
    const nc = cyclicCol(col, dc);
    if (nr>=0 && nr<8) {
      const target = board.squares[nr][nc];
      if (!target || target.color !== board.turn) {
        moves.push({ from: [row, col], to: [nr, nc] });
      }
    }
  }
  // 易位（需单独检查条件）
  moves.push(...generateCastlingMoves(board, row, col));
  return moves;
}
```

### 5.2 易位走法生成
```typescript
function generateCastlingMoves(board: Board, row: number, col: number): Move[] {
  if (row !== (board.turn === 'w' ? 0 : 7) || col !== 4) return []; // 王必须在初始位置
  const moves: Move[] = [];
  const color = board.turn;
  const kingRow = row;
  const castlingRights = board.castling;

  // 检查短易位（右侧）
  if ((color === 'w' && castlingRights.includes('K')) || (color === 'b' && castlingRights.includes('k'))) {
    // 确定车的位置（短易位车在 h 列，即 col=7）
    const rookCol = 7;
    // 检查中间格子：从王列+1 到 车列-1（循环方向）
    let pathClear = true;
    let c = cyclicCol(col, 1);
    while (c !== rookCol) {
      if (board.squares[kingRow][c] !== null) { pathClear = false; break; }
      c = cyclicCol(c, 1);
    }
    // 还需检查王经过的格子（包括目标格）是否受攻击
    if (pathClear) {
      const targetCol = cyclicCol(col, 2); // 王移动两格
      // 需要验证王经过的格子（col+1 和 targetCol）不被攻击
      const passThrough = cyclicCol(col, 1);
      if (!isSquareAttacked(board, kingRow, passThrough, color) && !isSquareAttacked(board, kingRow, targetCol, color)) {
        moves.push({ from: [kingRow, col], to: [kingRow, targetCol], castling: 'short' });
      }
    }
  }

  // 类似处理长易位（左侧，车在 a 列 col=0）
  if ((color === 'w' && castlingRights.includes('Q')) || (color === 'b' && castlingRights.includes('q'))) {
    const rookCol = 0;
    let pathClear = true;
    let c = cyclicCol(col, -1);
    while (c !== rookCol) {
      if (board.squares[kingRow][c] !== null) { pathClear = false; break; }
      c = cyclicCol(c, -1);
    }
    if (pathClear) {
      const targetCol = cyclicCol(col, -2);
      const passThrough = cyclicCol(col, -1);
      if (!isSquareAttacked(board, kingRow, passThrough, color) && !isSquareAttacked(board, kingRow, targetCol, color)) {
        moves.push({ from: [kingRow, col], to: [kingRow, targetCol], castling: 'long' });
      }
    }
  }
  return moves;
}
```

### 5.3 合法性检查（是否导致己方被将）
```typescript
function isMoveLegal(board: Board, move: Move): boolean {
  // 深拷贝棋盘并执行移动
  const newBoard = applyMove(cloneBoard(board), move);
  // 检查当前走棋方的王是否被将军
  return !isInCheck(newBoard, board.turn);
}
```

### 5.4 将军与将死判断
```typescript
function isInCheck(board: Board, color: Color): boolean {
  const kingPos = findKing(board, color);
  return isSquareAttacked(board, kingPos.row, kingPos.col, color);
}

function isSquareAttacked(board: Board, row: number, col: number, defendingColor: Color): boolean {
  // 遍历对方所有棋子，看是否有能攻击该格的走法（使用移动生成，但不考虑是否导致己方被将）
  // 注意：需调用不含易位的移动生成，且忽略王自身？
  // 简便方法：模拟对方所有棋子，生成所有攻击格子。
}
```

## 6. 界面设计与交互

### 6.1 Canvas 绘制
- 棋盘尺寸：每个格子 60×60 像素，总宽 480 像素，高 480 像素。
- 绘制背景格子（浅/深色），棋子使用矢量图形或图片。
- 支持通过 `ctx.translate` 实现视图偏移。但为了简化，我们采用整数列滚动方式：显示基准列 `baseCol`（0～7），绘制列从 `baseCol` 到 `baseCol+7`（实际列取模）。
- 绘制函数：
```typescript
function drawBoard(baseCol: number) {
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 8; i++) {
      const col = (baseCol + i) % 8; // 实际列索引
      const x = i * 60; // 屏幕 x 坐标
      const y = r * 60;
      // 绘制格子
      // 绘制棋子（如果有）
    }
  }
}
```

### 6.2 落子提示
- 当玩家点击己方棋子时，高亮该棋子（外框或阴影）。
- 计算该棋子的所有合法目标格子（调用移动生成并过滤非法），用半透明圆点或边框标记。
- 点击目标格子后执行移动，清除高亮，切换回合。
- 若点击非目标格子，取消选中。

### 6.3 鼠标交互
- 监听 `mousedown`、`mousemove`、`mouseup` 事件。
- 坐标转换：根据鼠标位置计算所在格子 (r, c)，c 需考虑 `baseCol` 偏移：实际列 = (baseCol + 屏幕列索引) % 8。
- 拖拽移动棋盘：在 `mousedown` 记录起始点，`mousemove` 时计算位移，更新 `baseCol` 的浮点值实现平滑预览，`mouseup` 时根据位移量调整 `baseCol` 到最近整数，并重绘。

### 6.4 视角控制按钮
- **左移**：`baseCol = (baseCol - 1 + 8) % 8`，重绘。
- **右移**：`baseCol = (baseCol + 1) % 8`，重绘。
- **回正**：`baseCol = 0`，重绘。

## 7. 视角控制（左右移动、拖动、回正）

### 7.1 整数列滚动
- 使用 `baseCol` 整数变量表示当前显示的最左列。
- 左移/右移按钮直接增减 `baseCol`（取模）。
- 拖动时，根据鼠标位移计算应增减的列数（例如位移/格子宽），更新 `baseCol` 并立即重绘，实现连续滚动效果。拖动结束后，将 `baseCol` 四舍五入为整数（取模），重绘。

### 7.2 实现平滑拖动
```typescript
let dragStartX: number;
let dragStartBaseCol: number;

function onMouseDown(e) {
  dragStartX = e.clientX;
  dragStartBaseCol = baseCol;
}

function onMouseMove(e) {
  if (dragging) {
    const dx = e.clientX - dragStartX;
    const deltaCol = dx / 60; // 格子宽60像素
    baseCol = (dragStartBaseCol - deltaCol + 8) % 8; // 负向偏移右移
    // 注意：减号是因为向右拖动应增加列号（显示右边内容）
    drawBoard(baseCol);
  }
}

function onMouseUp(e) {
  if (dragging) {
    baseCol = Math.round(baseCol) % 8;
    drawBoard(baseCol);
    dragging = false;
  }
}
```

## 8. 棋局保存与加载

### 8.1 FEN 格式
使用标准 FEN 表示局面。例如：
`rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`

- 字段依次为：棋盘布局、当前走棋方、易位权限、过路兵目标格、半回合数、整回合数。
- 过路兵目标格如 `a3` 或 `h6`，即使穿过边界也不影响。
- 加载时需解析并设置棋盘数据。

### 8.2 保存
- 从当前 `Board` 对象生成 FEN 字符串。
- 保存时视角回正（`baseCol=0`）不影响 FEN。

### 8.3 加载
- 解析 FEN，更新 `Board`。
- 重置 `baseCol` 为 0（显示标准视图）。
- 重绘棋盘。

## 9. AI 实现

### 9.1 搜索算法
采用带 Alpha-Beta 剪枝的极小极大搜索，深度可配置（默认 3 层）。
```typescript
class AIEngine {
  search(board: Board, depth: number, alpha: number, beta: number, maximizing: boolean): number {
    if (depth === 0) return this.evaluate(board);
    const moves = generateAllLegalMoves(board, board.turn);
    if (maximizing) {
      let maxEval = -Infinity;
      for (const move of moves) {
        const newBoard = applyMove(cloneBoard(board), move);
        const eval = this.search(newBoard, depth-1, alpha, beta, false);
        maxEval = Math.max(maxEval, eval);
        alpha = Math.max(alpha, eval);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      // 类似，返回最小评估值
    }
  }

  getBestMove(board: Board): Move {
    let bestMove: Move | null = null;
    let bestValue = -Infinity;
    const moves = generateAllLegalMoves(board, board.turn);
    for (const move of moves) {
      const newBoard = applyMove(cloneBoard(board), move);
      const value = this.search(newBoard, depth-1, -Infinity, Infinity, false);
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
    }
    return bestMove!;
  }
}
```

### 9.2 评估函数
基于子力价值、位置价值和机动性。
```typescript
evaluate(board: Board): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board.squares[r][c];
      if (!piece) continue;
      const value = pieceValues[piece.type]; // 后900,车500,象330,马320,兵100
      // 位置价值表（可调整，注意边线不再危险，可适当调高边格价值）
      const positional = positionTables[piece.type][piece.color][r][c];
      score += (piece.color === 'w' ? 1 : -1) * (value + positional);
    }
  }
  // 机动性奖励：简单统计合法移动数
  // ...
  return score;
}
```

### 9.3 优化
- 置换表缓存评估过的局面。
- 走法排序：先吃子（MVV-LVA），后历史启发。
- 开局库（可选）。

## 10. 游戏模式（人人、人机、机器对弈）

### 10.1 玩家类型定义
```typescript
enum PlayerType {
  HUMAN,
  AI
}
```

### 10.2 游戏模式枚举
```typescript
enum GameMode {
  HUMAN_VS_HUMAN,
  HUMAN_VS_AI,   // 白方人类，黑方AI（可配置）
  AI_VS_AI
}
```

### 10.3 控制器管理
```typescript
class GameController {
  mode: GameMode;
  players: [PlayerType, PlayerType]; // 索引0白，1黑
  board: Board;
  ai: AIEngine;
  aiDelay: number = 500; // 毫秒
  paused: boolean = false;

  constructor() {
    this.setMode(GameMode.HUMAN_VS_HUMAN);
  }

  setMode(mode: GameMode) {
    this.mode = mode;
    switch (mode) {
      case GameMode.HUMAN_VS_HUMAN:
        this.players = [PlayerType.HUMAN, PlayerType.HUMAN];
        break;
      case GameMode.HUMAN_VS_AI:
        this.players = [PlayerType.HUMAN, PlayerType.AI]; // 默认白人类黑AI
        break;
      case GameMode.AI_VS_AI:
        this.players = [PlayerType.AI, PlayerType.AI];
        break;
    }
    this.resetGame();
  }

  resetGame() {
    this.board = initialBoard(); // 初始局面
    this.paused = false;
    this.nextTurn();
  }

  nextTurn() {
    if (this.board.gameOver) return;
    const currentPlayer = this.players[this.board.turn === 'w' ? 0 : 1];
    if (currentPlayer === PlayerType.HUMAN) {
      // 启用鼠标交互
    } else {
      // 禁用鼠标交互
      if (!this.paused) {
        setTimeout(() => {
          if (this.paused) return; // 暂停时不走棋
          const move = this.ai.getBestMove(this.board);
          this.executeMove(move);
          this.nextTurn();
        }, this.aiDelay);
      }
    }
  }

  executeMove(move: Move) {
    // 更新棋盘
    // 检查游戏结束
    // 切换回合
    // 重绘
  }
}
```

### 10.4 界面控件
- **模式选择**：一组单选按钮，选项：人人对弈、人机对弈（白方人类）、人机对弈（黑方人类）、机器对弈。
- **AI 速度**：滑动条，调节 `aiDelay`。
- **暂停/继续**：仅对 AI_VS_AI 模式有效，切换 `paused`。
- **单步执行**：仅在暂停时有效，强制 AI 走一步。
- **重置**：调用 `resetGame()`。

## 11. 技术要点与实现细节

### 11.1 循环坐标处理
所有涉及列变化的地方都要使用 `cyclicCol` 函数，确保正确取模。特别在生成滑动棋子移动时，要防止无限循环（最多 7 步）。

### 11.2 易位实现
- 易位方向需根据车的位置确定最短路径。可先计算顺时针和逆时针距离，选择距离 ≤ 4 的方向作为易位方向（因为传统易位只涉及一侧）。注意检查中间格子时需按该方向逐步循环。
- 易位后，车的位置：短易位时车移至王经过的紧邻格子（王起始列+1 或 -1）；长易位时车移至王经过的另一侧（王起始列-1 或 +1，取决于方向）。

### 11.3 吃过路兵标记
当兵向前两格时，若经过的格子旁有对方兵（包括边界相邻），则设置 `enPassant` 为目标列。例如，白兵从 a2 到 a4，则 `enPassant = a3` 的列（但注意 a3 是经过格）。对方兵在下一回合可在 a3 斜吃（从 b4 或 h4 来）。实现时，`enPassant` 存储目标列（即被吃兵所在列），行由对方兵的位置决定（白方兵在行4，黑方兵在行3）。

### 11.4 升变
兵到达底线（白兵行7，黑兵行0）时，必须升变为后、车、象、马之一。界面需弹出选择框，AI 默认升后。

### 11.5 游戏结束检测
每走一步后，调用 `isInCheck` 和 `hasLegalMoves` 判断将死或逼和。若将死，宣布胜方；若逼和，和棋。

## 12. 测试与调试
- 单元测试：编写测试用例验证每种棋子的边界移动、易位、吃过路兵。
- 场景测试：加载经典局面，验证将死判断。
- AI 测试：让两个 AI 对弈，观察是否有死循环或非法走法。
- 界面测试：点击、拖动、按钮响应是否正常。

## 13. 未来扩展
- 网络对战（WebSocket）
- 更高级的 AI（如使用神经网络）
- 音效与动画
- 自定义棋盘皮肤
- 棋局复盘与导出 PGN

---

本文档为圆柱面国际象棋的完整实现指南，开发人员可依据此文档逐步实现所有功能。