/**
 * The microscope's instruction explainer. Every opcode family gets a sentence
 * built from the *current* register values, so this test pins a few of them
 * down with a hand-made register file (no wasm needed).
 */
import { describe, } from "../src/engine/z80desc.ts";
import type { Registers } from "../src/engine/z80core.ts";

const r: Registers = { a: 0x12, b: 0x34, c: 0x56, d: 0x78, e: 0x9a, h: 0x03, l: 0x40, f: 0x00, pc: 0, sp: 0xfffe, ix: 0, iy: 0 };
const mem = new Uint8Array(32);
let fails = 0;
/** bytes[] is what sits at pc — the opcode plus any immediate that follows it */
const check = (bytes: number[], code: number, next: number, want: string[], not: string[] = []) => {
  mem.fill(0);
  mem.set(bytes, 0);
  const d = describe(code, next, r, mem);
  const blob = `${d.text} ${d.effect}`;
  for (const w of want) if (!blob.includes(w)) {
    console.error(`FAIL 0x${code.toString(16).padStart(2, "0")} (${d.asm}): missing "${w}"\n   got: ${blob}`);
    fails++;
  }
  for (const n of not) if (blob.includes(n)) {
    console.error(`FAIL 0x${code.toString(16).padStart(2, "0")} (${d.asm}): should not say "${n}"\n   got: ${blob}`);
    fails++;
  }
};

// loads
check([0x3e, 0x7f], 0x3e, 0x7f, ["立即数 0x7f", "A：0x12 → 0x7f"]);
check([0x01, 0x34, 0x12], 0x01, 0x34, ["立即数 0x1234", "BC：0x3456 → 0x1234"]);
check([0x4f], 0x4f, 0, ["把 A（0x12） 写进 C", "C：0x56 → 0x12"]);
check([0x40], 0x40, 0, ["写回自己"]);        // LD B,B
check([0x77], 0x77, 0, ["(HL) 变成 0x12"]);  // LD (HL),A

// arithmetic / logic
check([0x80], 0x80, 0, ["A（0x12）加上 B（0x34）", "0x12 + 0x34 = 0x46"]);
check([0x88], 0x88, 0, ["进位"]);
check([0x90], 0x90, 0, ["减去 B（0x34）", "0xde"]);           // SUB B -> 0xde (wrap)
check([0xa0], 0xa0, 0, ["按位与", "0x10"]);                 // AND B -> 0x10
check([0xb8], 0xb8, 0, ["A 更小", "零标志 = 0"]);            // CP B
check([0xb0], 0xb0, 0, ["按位或"]);                          // OR B
check([0xa8], 0xa8, 0, ["按位异或"]);                        // XOR B
check([0x3c], 0x3c, 0, ["A 自增 1", "0x13"]);                // INC A
check([0x05], 0x05, 0, ["B 自减 1", "0x33"]);                // DEC B

// stack / flow
check([0xc5], 0xc5, 0, ["把 BC（0x3456）压进栈", "0xfffc"]);
check([0xc1], 0xc1, 0, ["从栈顶弹出"]);                       // POP BC
check([0x18, 0x02], 0x18, 0x02, ["无条件跳到 0x0004", "相对寻址"]);                      // JR e
check([0x20, 0x02], 0x20, 0x02, ["NZ", "零标志 = 0"]);             // JR NZ,e
check([0xc3, 0x08, 0x00], 0xc3, 0x08, ["跳到 0x0008"]);              // JP nn
check([0xcd, 0x08, 0x00], 0xcd, 0x08, ["调用子程序 0x0008", "0x0003"]);  // CALL nn
check([0xc9], 0xc9, 0, ["从子程序返回", "SP：0xfffe"]); // RET
check([0x10, 0xfe], 0x10, 0xfe, ["B 先减 1", "0x33"]);             // DJNZ e
check([0xff], 0xff, 0, ["固定向量 0x0038"]);                 // RST 38H

// misc
check([0x00], 0x00, 0, ["什么都不做"]);
check([0x76], 0x76, 0, ["停机"]);
check([0x37], 0x37, 0, ["进位"]);                            // SCF
check([0x2f], 0x2f, 0, ["A：0x12 → 0xed"]);                  // CPL
check([0xf3], 0xf3, 0, ["关掉"]);                            // DI
check([0xd3, 0x05], 0xd3, 0x05, ["端口 0x05"]);                    // OUT (n),A
check([0xe3], 0xe3, 0, ["交换"]);                            // EX (SP),HL
check([0xcb, 0x40], 0xcb, 0x40, ["测试 B 的第 0 位", "第 0 位 = 0"]);
check([0xed, 0xb0], 0xed, 0xb0, ["复制到地址", "BC"]);

console.log(fails === 0 ? "instruction insight: ok" : `instruction insight: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
