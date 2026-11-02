# 第三方代码

这个仓库里有三样东西不是本项目写的。**第三方文件集中在 `src/engine/vendor/`，
许可文本跟着文件走**，不在自己写的代码目录里混放。

## 1. `src/engine/vendor/z80/` — Z80 执行器

| 文件 | 是什么 |
|---|---|
| `z80worker.wasm` | 编译好的 Z80 执行器，25,671 字节 |
| `LICENSE` | znah/zff 的 MIT 许可（© 2024 Google） |
| `LICENSE-z80` | 内嵌内核 superzazu/z80 的 MIT 许可（© 2019 Nicolas Allemand） |
| `README.md` | 来源、SHA-256、上游改动、怎么重编 |

- 上游：<https://github.com/znah/zff> → `wasm/z80worker.wasm`，逐字节原样
- SHA-256：`504e1377e8f78debb997ef63703a9a75121f42ebf7cb92ca49417a843bc94f78`
- 它由 `wasm/z80worker.c`（zff 的胶水层）和 `external/z80.c`（superzazu/z80，
  上游改过第 1388 行）一起编译而成

## 2. `src/engine/z80disasm.ts` — 指令表

| | |
|---|---|
| 来源 | <http://www.z80.info/disz80.txt>，经 zff 的 `js/z80disasm.js` 转写成 TS |
| 许可 | 随 zff 一同以 MIT 发布（© 2024 Google） |

这段是**转写**而不是拷贝，所以留在引擎目录里，文件头注明了出处。

## 3. 论文

想法与实验设计属于 <https://arxiv.org/abs/2406.19108> 的作者。
本仓库只做复现和界面，不含论文的任何原始材料。

## 许可全文

两段 MIT 的原文分别放在：

- `src/engine/vendor/z80/LICENSE`（Google）
- `src/engine/vendor/z80/LICENSE-z80`（Nicolas Allemand）

两者的条款相同，仅版权人不同，这里不再重复一份。
