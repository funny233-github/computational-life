# 第三方代码

这个仓库里有三样东西不是本项目写的，来源和许可列在这里。

## 1. `src/engine/z80worker.wasm`（二进制，25,671 字节）

| | |
|---|---|
| 来源 | <https://github.com/znah/zff> → `wasm/z80worker.wasm` |
| SHA-256 | `504e1377e8f78debb997ef63703a9a75121f42ebf7cb92ca49417a843bc94f78` |
| 许可 | MIT，Copyright (c) 2024 Google |
| 说明 | 逐字节原样使用，未改动 |

它是 zff 把 `wasm/z80worker.c`（定义 `context_t` 和 `memoryRead`/`memoryWrite` 两个钩子）
与 `external/z80.c` 一起编译出来的产物。要在本地重编，直接用上游的 `build.sh`。

## 2. Z80 内核源码的出处（上面那个 wasm 里面就是它）

| | |
|---|---|
| 来源 | <https://github.com/superzazu/z80>（经 zff 的 `external/` 目录转手） |
| 许可 | MIT，Copyright (c) 2019 Nicolas Allemand |
| 上游改动 | zff 的 `external/README.md` 记录了他们对原作的本地修改 |

## 3. `src/engine/z80disasm.ts` 里的指令表

| | |
|---|---|
| 来源 | <http://www.z80.info/disz80.txt>，经 zff 的 `js/z80disasm.js` 转写 |
| 许可 | 该表随 zff 一同以 MIT 发布（Copyright (c) 2024 Google） |

## 许可全文

两个上游都是 MIT，条款相同，仅版权人不同：

```
MIT License

Copyright (c) 2024 Google                (znah/zff)
Copyright (c) 2019 Nicolas Allemand      (superzazu/z80)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

论文相关的想法与实验设计属于 <https://arxiv.org/abs/2406.19108> 的作者；
本仓库只做复现和界面，不含论文的任何原始材料。
