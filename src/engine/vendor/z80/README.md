# vendor/z80 — 参考实现的 Z80 wasm

这个目录里**没有本项目写的代码**，全部是从上游原样取来的，只做搬运。

## 文件

| 文件 | 是什么 |
|---|---|
| `z80worker.wasm` | 编译好的 Z80 执行器，25,671 字节 |
| `LICENSE` | 上游项目 znah/zff 的 MIT 许可（© 2024 Google） |
| `LICENSE-z80` | 内嵌内核 superzazu/z80 的 MIT 许可（© 2019 Nicolas Allemand） |

`z80worker.wasm` 的 SHA-256：

```
504e1377e8f78debb997ef63703a9a75121f42ebf7cb92ca49417a843bc94f78
```

## 来源

- 上游：<https://github.com/znah/zff>，路径 `wasm/z80worker.wasm`
- 该 wasm 由 `./build.sh` 用 zig 编译下面两个源文件得到：
  - `wasm/z80worker.c` — zff 自己写的胶水层：`context_t`、`memoryRead`/`memoryWrite`
    钩子（地址 `& 31` 的 32 字节配对内存）、按对批量执行的 `run()`、
    逐指令记录的 `z80_trace()`
  - `external/z80.c` + `external/z80.h` — superzazu/z80 内核，
    上游在 zff 里做过一处本地修改：**第 1388 行，防止重复前缀码无限递归**

## 本项目怎么用它

`src/engine/z80core.ts` 通过 `src/engine/z80wasm.ts` 里的
`new URL("./vendor/z80/z80worker.wasm", import.meta.url)` 拿到它，
`fetch` 之后 `WebAssembly.instantiate`。每调用一次就是一个独立实例
（独立 1.3MB 线性内存）：主线程两个（汤 + 显微镜）、每个 worker 一个。

我们**没有**改这个二进制，也没有它的 C 源码副本。所以它自身的 bug 只能绕：
参考实现里 `write_count` 缓冲区有 `MAX_BATCH_PAIR_N` 项，但 `memoryWrite()`
按 `pair_idx*2` 索引，超过 4096 对就写穿数据段——本项目在
`runPairs()` 里按缓冲区真实容量分块来规避（详见 “块传送” 那段注释与
`scripts/z80par.test.ts`）。

## 想重编的话

按上游来：clone `znah/zff`，装 zig，跑 `./build.sh`，然后
`sha256sum` 对一下上面那个值。对不上说明上游变了，那时需要重新核对
`z80core.ts` 里 `Z80_STATE` 的结构体偏移（`pc` 24、`sp` 26、`a` 34、`flags` 51…）。
