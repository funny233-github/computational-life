# 计算生命沙盘（Z80 / BFF）

一个可玩的计算生命沙盘：几千条随机字节组成的"原始汤"，没有适应度函数，
没有外部选择压，只有有限的空间和有限的指令预算。看自我复制子会不会、以及
怎么自己长出来。

论文：*Computational Life: How Well-formed, Self-replicating Programs Emerge
from Simple Interaction*，Agüera y Arcas 等，arXiv:2406.19108。

参考实现（MIT）：
* `znah/zff` — Z80 那组实验（§3.3 / Figure 12），本项目的默认基底
* `paradigms-of-intelligence/cubff` — BFF 与 Forth（§2、§3.1）

`z80worker.wasm` 是从 `znah/zff` 原样取来的二进制（里面是 superzazu/z80 内核），
不是本项目自己编的。第三方材料集中在 `src/engine/vendor/`，许可文本跟着文件走：
[`vendor/z80/`](src/engine/vendor/z80/README.md)（`LICENSE` + `LICENSE-z80` + 来源说明），
总索引见 [THIRD-PARTY.md](THIRD-PARTY.md)。

## 两种基底

| | Z80（默认） | BFF（`index.html?bff`） |
|---|---|---|
| 一格 | **16 字节** | 64 字节 |
| 显示 | 4×4，一个方块一个字节 | 8×8，一个方块一个字节 |
| 执行 | 真的跑 Z80 指令，每交互 128 步 | BFF 指令集，每交互 8192 步 |
| 内存 | 两格拼成 32 字节，地址 `& 31` | 两格拼成 128 字节 |
| 备注 | 跑参考实现的 `z80worker.wasm` | 纯 TypeScript，可并行 |

## 跑起来

```bash
npm install
npm run dev      # 开发服务器 http://localhost:5173
# 或者
npm run play     # 构建 + 起一个带 COOP/COEP 的静态服务器（多线程要它）
```

带头的静态服务器是必须的：`SharedArrayBuffer` 只在**跨源隔离**的页面里可用，
`npm run play` 会发 `COOP: same-origin` + `COEP: require-corp`。
`dist/` 是普通的静态站点（HTML + 主 JS + CSS + worker JS + wasm，五个文件），
扔到任何能自己配这两个头的服务器上都行。

## 界面

左上是汤，右边从上到下三张卡片：**汤**（指标 + 曲线）、**世界**（速度 / 突变率 /
地图 / 线程 / 显示 / 配色）、**显微镜**（格子、读写历史、指令解说、反汇编）。
顶栏是轮数、轮每秒、基质名和暂停键；标题栏右边的 `⟩` 收起侧栏。

| 操作 | 作用 |
|---|---|
| 点格子 | 选中并载入显微镜：该格 ++ 右邻居拼成 32 字节（Z80）/ 128 字节（BFF），可执行 |
| `空格` | 暂停 / 继续 |
| **种下复制子** | 在选中格周围种下 5×5 个手写复制子，几秒就能看到吞并波（BFF 专用） |
| 编辑文本框 + **写入世界** | 把你写的程序写进选中格（BFF 专用，Z80 模式下隐藏） |

**显示**（缩放不在这里，用滚轮；配色是另一个下拉）：

| 选项 | 一格 = | 看什么 |
|---|---|---|
| 字节 · 一格 4×4 / 8×8 | 一格内一个字节一个方块 | 默认；放大后每块里写指令 |
| 整格 · 指令类型 | 1 像素 | 整格主导指令类型 |
| 整格 · 血统 | 1 像素 | 同一个祖先血统同色 |

点击选格，白框是当前选中；方向键平移窗口（按住 shift 一次走 4 格）。

**缩放和移动交给鼠标**：滚轮在光标处放大/缩小（1× … 28×），**缩放是动画过的**
（每帧追一点目标值，不会跳），按住左键拖动平移，方向键也能平移。

**放大到每字节 ≥ 13 像素时，每个方块里自动写出这条指令**，记法照参考演示：
装入写成 `源→目的`（`nn→HL`、`A→(nn)`、`n→B`），其余指令一个符号（`+B` 自增、
`↑BC` 入栈、`⇒nz` 条件跳转、`■` 停机…），只带操作数的字节画 `▽`。
字号按方块宽度自动收缩，放不下就不写。符号和含义的对照表就在显微镜那张卡片里
（`GRID_LEGEND`，和生成表在同一个文件里，不会走样）；显微镜下面的反汇编列表
仍然给 `disz80` 的标准写法，两者是同一张表。
**缩放为什么不再卡**：整锅汤先被光栅化到一张"一像素一字节"的小位图（Z80 是 384×216），
然后交给浏览器用 `drawImage` 一次放大到屏幕上。每帧的 CPU 工作量与放大倍数**无关**：

| | 每帧 |
|---|---|
| 旧做法（按视口逐像素光栅化 968×653） | 2.4 ms + `putImageData` ≈ 2.5 ms |
| 现在（384×216 光栅化 + 一次 GPU 放大） | 0.9 ms + 0.3 ms |

注意相机（单位是**格**）和 blit 的 k（单位是**源像素**，字节模式下就是一字节）不是同一个量：
偏移必须乘 `cellPx()`，不是乘 `k`。字节模式下乘错会让画面整体平移，看上去像"缩放中心不跟鼠标"。
这三条公式（`cellAt` / `camFor` / `blitRect`）因此单独放在 `src/ui/geometry.ts`，由 `scripts/zoom.test.ts` 守着。

放大过程中还会跳过助记符文字（几千次 `fillText` 是真正的大头），停下来再补一次带文字的完整绘制。

缩放时每个字节占 `px` 像素；
`px` 可以是小数，方块边界按边取整，所以缩放过程中方块之间不会出现缝。
镜头位置也是小数级的（不按整格对齐），缩放时画面是连续推拉的，不会"啪"地跳一格。

**地图大小**：48×27 / 64×36 / 96×54（默认）/ 128×72 / 192×108 / 240×135（论文规模）。
换大小是重建，计数和曲线一起重来。

**显微镜**：把选中格和右邻拼成 32 字节，从第 0 步重跑到第 N 步——
两个 4×4 字节格子（带 pc 白框和字节值）、128 步的时间轴（横向 = 步、纵向 = 字节，
橙 = 写、灰 = 读）、指令解说，再加一行反汇编列表——自上而下就是
「双单元 → 读写历史 → 指令解读」这个阅读顺序。拖"跑到第 N 步"的滑杆就能回放整次交互。

**指令解说**：时间轴下面那块，看的是 pc 当前指着的那条指令——
左边是那个字节自己的颜色和方块上的符号（`⇒nc`），右边是精确反汇编和指令家族；
下面一排是此刻的寄存器（A F B C D E H L、(HL)、SP、PC），每个有固定颜色，
本条指令读到的会点亮、写到的会描边，再下一行是 S Z H P N C 六个标志位。
最下面两句话说明它**将要做什么**、以及**算完变成什么**，用的是当前的真实数值，
例如「有条件地跳到 0x37eb，条件是 NC，也就是进位 = 0，当前成立」。

生成这些句子的表在 `src/engine/z80desc.ts`，每条指令都有自己的一条，`scripts/insight.test.ts`
用一份手写寄存器把主要家族逐条钉死。

**配色**：`暗色`（默认）是暖灰底 + 低饱和的指令色，长时间看不刺眼；`亮色（原作）` 是 zff 里
`set_color()` 的原值（灰阶 64–96、`LD BC,nn` 纯正红等），用来逐像素对照官方实现。
`暗色` 是把同一批色相压暗降饱和（灰阶 38–72）得到的，色相和原作一一对应。

**世界参数**：速度 / 突变率（两种基质都有），代码密度 / 步数上限 / 邻居半径
（只有 BFF 有，Z80 的这几项在参考实现里是写死的，界面上直接隐藏）。
改突变率即时生效，改其余的重置后生效。

**线程**：一轮里的配对互不重叠，所以可以切片交给多个 worker 并行跑。
计划（选邻居）和突变翻字节留在主线程，因此**并行结果与单线程逐字节相同**（有测试守着）。
调这个下拉即时生效，不用重置。

实测（96×54，Chromium，一轮 ≈ 1300 对、2600 条程序同时被改写）：

| 线程 | 每轮耗时 | 吞吐 |
|---|---|---|
| 1 | 2.17 ms | 354 轮/秒 |
| 3 | 1.12 ms | 658 轮/秒 |
| 7 | 0.76 ms | 913 轮/秒 |

（吞吐还受「速度」——每帧最多跑几轮——和 30fps 的重绘节流限制，
把速度拉高还能更快，7 线程已经接近这张卡片的实际上限。）

要真正并行，页面必须是**跨源隔离**的（`COOP: same-origin` + `COEP: require-corp`），
因为浏览器只在那种页面里允许 `SharedArrayBuffer`：

```bash
npm run play     # 起一个带这两个头的服务器，然后开 http://localhost:5173
```

用 `file://` 直接打开（或服务器没发那两个头）时浏览器禁用 `SharedArrayBuffer`，
下拉会显示"只能用单线程"——这是浏览器的安全限制，不是代码路径。

**显微镜**：`▶ 运行` 连续播放，`单步 ×N` 一次走 N 条指令（N 就是"每帧步数"，
设成 1 就是严格单步），`⇄ 交换` 交换 A/B 两半（`A+B` 和 `B+A` 是两次不同的
反应），`粒度` 切换 8×8 / 4×4 显示。程序跑出纸带会自动从头重放。

看什么：**血统那条绿线** 是"最大家族占多少"。它从 0 冲到 100%，
就是论文说的相变；同时"多样性"会塌下来。

## 基底规格（逐条对齐参考实现）

一格 = 一条 64 字节的 tape；交互时两条拼成 128 字节来执行。
代码和数据是同一批字节，所以任何写操作都是自我修改。

```
< >       head0 -= / += 1
{ }       head1 -= / += 1
- +       tape[head0] -= / += 1
.         tape[head1] = tape[head0]      （一次一个字节）
,         tape[head0] = tape[head1]
[         if tape[head0] == 0: 跳到匹配的 ]
]         if tape[head0] != 0: 跳回匹配的 [
```

* 两个头都从 0 开始，`pc` 从 0 开始，头用 `& 127` 回绕
* `[` 判的是**字节 0x00**，不是字符 `[`；除以上字符外全是 nop
* 括号不匹配、`pc` 越界 → 程序终止；每次交互最多 8192 步
* 每个 epoch：按随机顺序访问每条程序，各挑一个邻居（半径 2，24 个候选），
  拼起来执行再切开；被访问者排在前面，没配对的程序只吃突变
* 默认突变率 1/4096 ≈ 0.0244% / 字节 / epoch

对应参考实现 `--lang bff_noheads`。

### 与参考实现的参数对照

| 参数 | 原版 | 这里 |
|---|---|---|
| 程序数 | 131,072（cubff 的一维汤） | 96×54 = 5,184（2D 格点） |
| 单条 tape | 64 B | 64 B |
| 配对后 tape | 128 B | 128 B |
| 每交互步数上限 | 8,192（`8 * 1024` 写死） | 8,192 |
| 突变率 | `1/(256*16)` | 同 |
| 邻居半径 | 2（切比雪夫） | 同 |
| 初始化 | 均匀随机字节 | 同 |
| 复杂度指标 | brotli -q2, lgwin 24 | 血统占比 + 多样性（不同 token 数） |

只有规模差 25 倍，规则和概率完全一致。

## 那个手写复制子

```
[{.>]###############...#]>.{[
```

`[{.>]` 是循环体：write head 左移一格、把 read head 那格拷过去、read head 右移。
它把程序**倒着**写进隔壁 tape；因为整个 64 字节是**回文**，倒着写等于原样写。
中间的 `#` 是 0x01——故意用非零的 nop 填满，否则循环会提前读到 0 停下。

论文里自发涌现的复制子也是回文的，这不是巧合，是被结构逼出来的解。

## 两个旋钮（论文没做的）

* **代码密度**：初始每个字节被强制设成指令的概率。论文用均匀随机
  （自然指令密度 3.9%）。调高等于给汤里多放点"像代码"的东西。
* **邻居半径 = 完全混匀**：0 维原始汤，任意两条程序都能相遇（论文 §2.1），
  而不是只有邻居能相遇（§2.2 的 2D 格点）。

## 时间尺度（诚实版）

论文的 40% 相变概率对应约 **10⁹ 次交互**。这个 JS 实现大约 **2×10⁷ 条指令/秒**，
换算下来从纯噪声开始等自发涌现，是**几十分钟**量级，不是几秒。所以：

* 想立刻看机制 → **seed replicator**，看波前怎么扩散；
* 想看自发涌现 → 让它挂着跑（后台标签页用的是定时器，不会被 rAF 掐停），
  或者调高 mutation / code density 加速；
* 想批量跑 → `node scripts/sim.ts 96 54 200000 0.000244 8192 1`
  （参数依次是 w h 轮数 突变率 步数 mixed，最后一个 1 = 0 维汤）。

`npm run build` 产出普通的静态站点：

```
dist/index.html                  6.7 KB
dist/assets/index-*.js          70 KB   （gzip 26 KB）
dist/assets/index-*.css         12 KB
dist/assets/z80worker-*.wasm    26 KB   （单独一份，按内容哈希缓存）
dist/assets/z80worker-*.js       1.7 KB （worker）
```

wasm 是真正的资源文件，不是 base64 字符串：`new URL("./vendor/z80/z80worker.wasm",
import.meta.url)` 让 Vite 把它当 asset 处理，浏览器可以单独缓存它，
devtools 里也能看到一次 200 的请求而不是一坨内联字节。
worker 同样走 `?worker` 导入，是**同源**的真文件——所以不需要再把内联
data: worker 包装成 blob: URL 那套技巧（`workerFactory.ts` 已删除）。

## 目录：引擎与界面是分开的

```
src/engine/         后端：没有 DOM，没有颜色，不认识 canvas
  substrate.ts        Substrate 接口 —— 前后端唯一的契约
  bff.ts soup.ts     BFF 解释器与汤
  programs.ts        手写复制子（BFF 的 64 字节回文程序）
  z80core.ts        Z80 核：fetch 参考实现的 wasm 并实例化
  z80wasm.ts        那个 wasm 的资源 URL（new URL + import.meta.url）
  vendor/z80/       第三方：z80worker.wasm + 两份 LICENSE + 来源说明
  z80soup.ts        Z80 汤
  z80disasm.ts       指令表（转写自 disz80，见 THIRD-PARTY）
  z80sub.ts bffsub.ts 把两种基质适配成 Substrate
  z80desc.ts         每条指令一句人话（带当前寄存器值）
  index.ts           公开面：类型 + 常量表 + decode/encode/opChar
  factory.ts         唯一碰 worker/wasm 的模块
  pool.ts worker.ts    BFF 的并行（worker 入口 + 切片）
  z80pool.ts z80worker.ts  Z80 的并行（同一套 barrier，只是数据是 32 字节配对）

src/ui/             前端：不认识解释器，只知道 Substrate
  app.ts             接线（控件、主循环、显微镜）
  canvas.ts          位图、视野、整数放大、点击命中
  palette.ts         所有颜色；字节 -> 像素只在这里发生
  geometry.ts        相机与贴图的三条公式（纯函数，可单测）
  chart.ts lab.ts    曲线、显微镜画布

src/main.ts         两行：引入样式和 app
```

引擎交给界面的只有**数据**：字节、统计、反汇编文本、以及一个语义键（`cellKey`：
指令家族 0–4 / 内容哈希 0–255 / 血统 0–63）。把语义键变成颜色是界面的工作，
所以换配色不需要碰引擎，换引擎也不需要碰颜色。

## 测试

`npm test` = 构建 + 下面全部，任何一条失败都返回非零：

```
scripts/layers.test.ts   分层边界：引擎里不许出现 document/window/canvas，
                         界面只许 import engine 的三个入口
scripts/bff.test.ts      BFF 解释器两种实现互相验算 + 复制子还能复制
scripts/z80.test.ts      Z80 核真的在执行、栈写入落到汤里、熵下降、
                         助记符字形与指令长度
scripts/z80par.test.ts   并行切片 == 串行（逐字节），含大图分块
scripts/par.test.ts      BFF 并行 == 串行
scripts/epoch.test.ts    worker 不 reset 世界；每轮 epoch/参数下发；并行 == 串行（含血统 token）
scripts/race.test.ts     reset/paint 排队到 epoch 边界；线程数可以降下去再升回来
scripts/render.test.ts   渲染：三种视图互不相同、像素级对齐
scripts/zoom.test.ts     相机三条公式：cellAt / camFor / blitRect
scripts/insight.test.ts  指令解说：每条家族一句话，用手写寄存器钉住
scripts/smoke.mjs        假 DOM 跑一遍打包产物：运行时错误、控件没接线
```

`scripts/wasm.ts` 是测试用的加载器（从 `src/engine/vendor/z80/` 读二进制，
不走 fetch）。`scripts/sim.ts` 是无头长跑，不在测试里。

`scripts/layers.test.ts` 会强制这条边界：
引擎里出现 `document`/`window`/`canvas` 就失败；界面里 `import "../engine/..."`
只允许 `index`、`factory`、`substrate` 三个入口；界面里出现 `WebAssembly`/`evalTape` 也算越界。

## 托管到 GitHub Pages

仓库里带了 `.github/workflows/pages.yml`：推到 `master` 就自动构建 `dist/` 并发到 Pages。
第一次要手动去 Settings → Pages → Source 选 **GitHub Actions**，之后每次推都是自动的。

`vite.config.ts` 里的 `base: "./"` 让所有资源走相对路径，
所以 `https://<用户名>.github.io/<仓库名>/` 这种子路径不用改任何东西，
wasm 和 worker 也是同源直取（Pages 对 `.wasm` 给的是 `application/wasm`，不用配）。

唯一的代价：**Pages 不能给静态文件加响应头**。页面因此不是跨源隔离的，
`SharedArrayBuffer` 不可用，线程下拉会写明原因并退回单线程——
功能全都在，只是慢 2–3 倍。想要回多线程只有两条路：

* 换一个能写响应头的托管（Cloudflare Pages / Netlify 的 `_headers` 文件）；
* 或者加一个 coi-serviceworker，用 Service Worker 把两个头"模拟"进页面（多一层间接）。


## 构建环境

项目本身只有两个普通 devDependency（typescript / vite），
没有任何平台特定的包——rollup 的原生二进制由 npm 按平台自动挑（`optionalDependencies`）。

如果你在 **Alpine / musl 容器**里构建（比如本项目的开发沙箱），npm 可能因为某个已知 bug
没装上 musl 版 rollup；补装时**不要写进 package.json**：

```bash
npm i --no-save --no-package-lock @rollup/rollup-linux-x64-musl
```

调试参数：`?zoom=10`（放大倍数）、`?view=code|lineage|bytes`（视图）、`?mapsize=192x108`、`?threads=4`、`?debug`（控制台打吞吐）。
