/**
 * One sentence per instruction: what it is about to do, with the *current*
 * register and memory values filled in. The microscope shows this next to the
 * byte grids so the soup stops being a wall of symbols.
 *
 * Everything here is data — no DOM, no colours. The UI decides how to paint it.
 */
import type { Insight } from "./substrate.ts";
import { BYTE2ASM, ED_NAME } from "./z80disasm.ts";
import type { Registers } from "./z80core.ts";

const hx = (n: number, w = 2) => `0x${n.toString(16).padStart(w, "0")}`;
const s8 = (n: number) => (n > 127 ? n - 256 : n);

/** 8-bit register names, as the Z80 spells them */
const R8 = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];

const FAMILY: Record<string, string> = {
  LD: "数据传输",
  PUSH: "栈",
  POP: "栈",
  EX: "交换",
  EXX: "交换",
  ADD: "算术",
  ADC: "算术",
  SUB: "算术",
  SBC: "算术",
  INC: "算术",
  DEC: "算术",
  AND: "逻辑",
  OR: "逻辑",
  XOR: "逻辑",
  CPL: "逻辑",
  CP: "比较",
  JP: "跳转",
  JR: "跳转",
  DJNZ: "跳转",
  CALL: "调用",
  RET: "调用",
  RST: "调用",
  RLCA: "移位",
  RRCA: "移位",
  RLA: "移位",
  RRA: "移位",
  DAA: "标志",
  SCF: "标志",
  CCF: "标志",
  DI: "中断",
  EI: "中断",
  HALT: "停机",
  IN: "输入输出",
  OUT: "输入输出",
  NOP: "空操作",
  LDI: "块传送",
  LDD: "块传送",
  LDIR: "块传送",
  LDDR: "块传送",
  CPIR: "块传送",
  CPDR: "块传送",
};

/** the flags byte, decoded */
interface Flags {
  s: number;
  z: number;
  h: number;
  p: number;
  n: number;
  c: number;
}
const flagsOf = (f: number): Flags => ({
  s: (f >> 7) & 1,
  z: (f >> 6) & 1,
  h: (f >> 4) & 1,
  p: (f >> 2) & 1,
  n: (f >> 1) & 1,
  c: f & 1,
});

const COND_WORD: Record<string, { need: string; now: (f: Flags) => boolean }> = {
  nz: { need: "零标志 = 0", now: (f) => f.z === 0 },
  z: { need: "零标志 = 1", now: (f) => f.z === 1 },
  nc: { need: "进位 = 0", now: (f) => f.c === 0 },
  c: { need: "进位 = 1", now: (f) => f.c === 1 },
  po: { need: "奇偶溢出 = 0", now: (f) => f.p === 0 },
  pe: { need: "奇偶溢出 = 1", now: (f) => f.p === 1 },
  p: { need: "符号位 = 0", now: (f) => f.s === 0 },
  m: { need: "符号位 = 1", now: (f) => f.s === 1 },
};

export function describe(code: number, next: number, r: Registers, mem: Uint8Array): Insight {
  const name = BYTE2ASM[code] ?? "?";
  const head = name.split(/[ ,(]/)[0];
  const fl = flagsOf(r.f);
  const cell = (addr: number) => mem[addr & 31];
  const pair = (p: string): number => {
    switch (p) {
      case "BC":
        return (r.b << 8) | r.c;
      case "DE":
        return (r.d << 8) | r.e;
      case "HL":
        return (r.h << 8) | r.l;
      case "AF":
        return (r.f << 8) | r.a;
      case "SP":
        return r.sp;
      case "IX":
        return r.ix;
      case "IY":
        return r.iy;
      default:
        return 0;
    }
  };
  /**
   * The value an operand holds right now, plus how it should be printed:
   * "BC（0x1234）", "立即数 nn（0x1234）", "(HL) 处的字节（0x3f）"…
   */
  const read = (opText: string): { value: number; width: number; reg?: string; label: string } => {
    const t = opText.trim();
    const hexw = (v: number, w: number) => hx(v, w);
    if (t === "n") {
      const v = cell(r.pc + 1);
      return { value: v, width: 2, label: `立即数 ${hexw(v, 2)}` };
    }
    if (t === "nn") {
      const v = cell(r.pc + 1) | (cell(r.pc + 2) << 8);
      return { value: v, width: 4, label: `立即数 ${hexw(v, 4)}` };
    }
    if (t === "e" || t === "d") {
      const v = cell(r.pc + 1);
      return { value: v, width: 2, label: `偏移 ${s8(v) >= 0 ? "+" : ""}${s8(v)}` };
    }
    const m = t.match(/^\((BC|DE|HL|SP)\)$/);
    if (m) {
      const addr = pair(m[1]);
      const v = cell(addr);
      return { value: v, width: 2, reg: m[1], label: `${m[1]} 指向的字节（地址 ${hexw(addr, 4)}）` };
    }
    if (t === "(nn)") {
      const addr = cell(r.pc + 1) | (cell(r.pc + 2) << 8);
      const v = cell(addr);
      return { value: v, width: 2, reg: "nn", label: `地址 ${hexw(addr, 4)} 处的字节` };
    }
    if (t === "(n)") {
      const port = cell(r.pc + 1);
      return { value: 0, width: 2, label: `端口 ${hexw(port, 2)}` };
    }
    if (/^(BC|DE|HL|SP|AF)$/.test(t)) {
      const v = pair(t);
      return { value: v, width: 4, reg: t, label: `${t}（${hexw(v, 4)}）` };
    }
    if (/^(A|B|C|D|E|H|L)$/.test(t)) {
      const v = r[t.toLowerCase() as "a"];
      return { value: v, width: 2, reg: t, label: `${t}（${hexw(v, 2)}）` };
    }
    return { value: 0, width: 2, label: t };
  };

  /** "A（0x12）" — a register or operand with its current value */
  const withValue = (opText: string) => read(opText).label;

  const cond = (n: string) => {
    const c = COND_WORD[n];
    if (!c) return { text: "", holds: true };
    const holds = c.now(fl);
    return { text: `${n.toUpperCase()}，也就是${c.need}，当前${holds ? "成立" : "不成立"}`, holds };
  };

  const base = (family: string, text: string, effect: string, reads: string[] = [], writes: string[] = []): Insight => ({
    code,
    glyph: "",
    asm: name,
    family,
    reads,
    writes,
    text,
    effect,
  });

  // ---------------- loads ----------------
  if (head === "LD") {
    const m = name.match(/^LD (.+),(.+)$/)!;
    const dst = m[1];
    const src = m[2];
    const sv = read(src);
    const from = read(dst).value;
    const width = /^(BC|DE|HL|SP)$/.test(dst) ? 4 : 2;
    const mask = width === 4 ? 0xffff : 0xff;
    const reads = /^(A|B|C|D|E|H|L|BC|DE|HL|SP)$/.test(src.trim()) ? [src.trim()] : [];
    const writes = /^(A|B|C|D|E|H|L|BC|DE|HL|SP)$/.test(dst.trim()) ? [dst.trim()] : [];
    const isMem = /^\(/.test(dst);
    const text =
      dst === src
        ? `把 ${withValue(src)} 写回自己，实际什么也没变——这类字节只是把同样的值搬来搬去。`
        : `把 ${withValue(src)} 写进 ${isMem ? dst : dst}。`;
    const effect = isMem
      ? `内存 ${dst} 变成 ${hx(sv.value & mask, width)}。`
      : `${dst}：${hx(from & mask, width)} → ${hx(sv.value & mask, width)}。`;
    return base("数据传输", text, effect, reads, writes);
  }

  // ---------------- 8-bit arithmetic ----------------
  if (head === "INC" || head === "DEC") {
    const t = name.slice(4);
    const v = read(t).value;
    const d = head === "INC" ? 1 : -1;
    const nv = (v + d) & (t.length === 2 ? 0xffff : 0xff);
    const wrap = head === "INC" ? "溢出到 0 时置零标志" : "减到 0xff 时置零标志";
    return base(
      "算术",
      `${t} 自${head === "INC" ? "增" : "减"} 1。`,
      `${t}：${hx(v, t.length === 2 ? 4 : 2)} → ${hx(nv, t.length === 2 ? 4 : 2)}，${wrap}。`,
      [t],
      [t],
    );
  }
  if (head === "ADD" || head === "ADC" || head === "SUB" || head === "SBC") {
    const parts = name.split(/[ ,]+/);
    const two = parts.length > 2;
    const srcT = two ? parts[2] : parts[1];
    const src = read(srcT);
    const carry = head === "ADC" || head === "SBC" ? fl.c : 0;
    const a = r.a;
    const sub = head === "SUB" || head === "SBC";
    const raw = sub ? a - src.value - carry : a + src.value + carry;
    const res = raw & 0xff;
    const sign = sub ? "−" : "+";
    const carryText = head === "ADC" || head === "SBC" ? `，再${carry ? "" : "不"}加上进位（当前进位 = ${carry}）` : "";
    return base(
      "算术",
      `把 A（${hx(a)}）${sub ? "减去" : "加上"} ${withValue(srcT)}${carryText}。`,
      `结果 ${hx(a)} ${sign} ${hx((src.value + carry) & 0xff)} = ${hx(res)} 写回 A${raw < 0 || raw > 0xff ? "（越过 8 位，进位标志会变）" : ""}。`,
      ["A", src.reg ?? ""].filter(Boolean),
      ["A"],
    );
  }
  if (head === "AND" || head === "OR" || head === "XOR") {
    const srcT = name.split(" ")[1];
    const src = read(srcT);
    const res = head === "AND" ? r.a & src.value : head === "OR" ? r.a | src.value : r.a ^ src.value;
    const opWord = head === "AND" ? "按位与" : head === "OR" ? "按位或" : "按位异或";
    return base(
      "逻辑",
      `把 A（${hx(r.a)}）和 ${withValue(srcT)} ${opWord}。`,
      `结果 ${hx(res & 0xff)} 写回 A${head === "AND" && src.value === 0 ? "，A 于是变成 0" : ""}。`,
      ["A", src.reg ?? ""].filter(Boolean),
      ["A"],
    );
  }
  if (head === "CP") {
    const srcT = name.split(" ")[1];
    const src = read(srcT);
    const cmp = r.a === src.value ? "两者相等" : r.a > src.value ? "A 更大" : "A 更小";
    return base(
      "比较",
      `拿 A（${hx(r.a)}）和 ${withValue(srcT)} 作比较，只看结果、不改 A。`,
      `${cmp}（${hx(r.a)} vs ${hx(src.value)}），于是零标志 = ${r.a === src.value ? 1 : 0}、进位 = ${r.a < src.value ? 1 : 0}。`,
      ["A", src.reg ?? ""].filter(Boolean),
      ["F"],
    );
  }

  // ---------------- stack ----------------
  if (head === "PUSH" || head === "POP") {
    const rr = name.split(" ")[1];
    const v = pair(rr);
    const sp = r.sp;
    if (head === "PUSH") {
      return base(
        "栈",
        `把 ${rr}（${hx(v, 4)}）压进栈。`,
        `SP：${hx(sp, 4)} → ${hx((sp - 2) & 0xffff, 4)}，内存 ${hx((sp - 2) & 0xffff, 4)} 起两字节写入 ${rr}。`,
        [rr, "SP"],
        ["SP"],
      );
    }
    return base(
      "栈",
      `从栈顶弹出两个字节到 ${rr}。`,
      `${rr}：${hx(v, 4)} → ${hx(cell(sp) | (cell(sp + 1) << 8), 4)}，SP：${hx(sp, 4)} → ${hx((sp + 2) & 0xffff, 4)}。`,
      ["SP"],
      [rr, "SP"],
    );
  }

  // ---------------- branches ----------------
  if (head === "JP" || head === "JR" || head === "DJNZ") {
    const parts = name.split(/[ ,]+/);
    const target = head === "JP" ? read("nn").value : (r.pc + 2 + s8(cell(r.pc + 1))) & 0xffff;
    if (head === "DJNZ") {
      return base(
        "跳转",
        `B 先减 1，若结果不为 0 就跳回去。`,
        `B：${hx(r.b)} → ${hx((r.b - 1) & 0xff)}，${(r.b - 1) & 0xff ? `所以会跳到 ${hx(target, 4)}` : "结果正好是 0，于是继续往下走"}。`,
        ["B"],
        ["B"],
      );
    }
    const cn = parts.length > 2 ? parts[1].toLowerCase() : "";
    const c = cn ? cond(cn) : null;
    const taken = c ? c.holds : true;
    return base(
      "跳转",
      c
        ? `有条件地跳到 ${hx(target, 4)}，条件是 ${c.text}。`
        : `无条件跳到 ${hx(target, 4)}（${head === "JR" ? "相对寻址" : "绝对寻址"}）。`,
      c
        ? taken
          ? `条件成立，pc 直接变成 ${hx(target, 4)}。`
          : `条件不成立，接着执行 ${hx((r.pc + (head === "JR" ? 2 : 3)) & 0xffff, 4)}。`
        : `pc 直接变成 ${hx(target, 4)}。`,
      c ? ["F"] : [],
      ["PC"],
    );
  }
  if (head === "CALL") {
    const parts = name.split(/[ ,]+/);
    const target = read("nn").value;
    const cn = parts.length > 2 ? parts[1].toLowerCase() : "";
    const c = cn ? cond(cn) : null;
    const taken = c ? c.holds : true;
    return base(
      "调用",
      `${c ? `有条件地调用 ${hx(target, 4)}，条件是 ${c.text}` : `调用子程序 ${hx(target, 4)}`}。`,
      taken
        ? `把返回地址 ${hx((r.pc + 3) & 0xffff, 4)} 压栈（SP → ${hx((r.sp - 2) & 0xffff, 4)}），然后跳到 ${hx(target, 4)}。`
        : `条件不成立，什么都不压栈，直接往下执行 ${hx((r.pc + 3) & 0xffff, 4)}。`,
      [...(c ? ["F"] : []), "SP"],
      taken ? ["SP", "PC"] : ["PC"],
    );
  }
  if (head === "RET") {
    const parts = name.split(" ");
    const cn = parts.length > 1 ? parts[1].toLowerCase() : "";
    const c = cn ? cond(cn) : null;
    const taken = c ? c.holds : true;
    const back = cell(r.sp) | (cell(r.sp + 1) << 8);
    return base(
      "调用",
      `${c ? `有条件地从子程序返回，条件是 ${c.text}` : "从子程序返回"}。`,
      taken
        ? `从栈顶取出返回地址 ${hx(back, 4)}，SP：${hx(r.sp, 4)} → ${hx((r.sp + 2) & 0xffff, 4)}，然后跳过去。`
        : `条件不成立，栈不动，继续往下执行 ${hx((r.pc + 1) & 0xffff, 4)}。`,
      [...(c ? ["F"] : []), "SP"],
      taken ? ["SP", "PC"] : [],
    );
  }
  if (head === "RST") {
    const vec = parseInt(name.slice(4, 6), 16);
    return base(
      "调用",
      `重启到固定向量 ${hx(vec, 4)}。`,
      `把返回地址 ${hx((r.pc + 1) & 0xffff, 4)} 压栈后跳到 ${hx(vec, 4)}。`,
      ["SP"],
      ["SP", "PC"],
    );
  }

  // ---------------- rotate / flags ----------------
  if (head === "RLCA" || head === "RRCA" || head === "RLA" || head === "RRA") {
    const left = head[0] === "R" && head[1] === "L";
    const throughCarry = head.length === 3;
    const bit = left ? (r.a >> 7) & 1 : r.a & 1;
    const shifted = left ? ((r.a << 1) | (throughCarry ? fl.c : bit)) & 0xff : ((r.a >> 1) | ((throughCarry ? fl.c : bit) << 7)) & 0xff;
    return base(
      "移位",
      `把 A 连同进位${left ? "左" : "右"}转一位。`,
      `A：${hx(r.a)} → ${hx(shifted)}，移出去的那位 ${bit} 变成进位标志。`,
      ["A", "F"],
      ["A", "F"],
    );
  }
  if (head === "SCF" || head === "CCF" || head === "CPL" || head === "DAA") {
    const word: Record<string, string> = {
      SCF: "把进位标志置 1",
      CCF: "把进位标志取反",
      CPL: "把 A 按位取反",
      DAA: "把 A 的二进制结果调整成十进制（BCD）",
    };
    const effect: Record<string, string> = {
      SCF: `进位：${fl.c} → 1。`,
      CCF: `进位：${fl.c} → ${fl.c ? 0 : 1}。`,
      CPL: `A：${hx(r.a)} → ${hx(~r.a & 0xff)}。`,
      DAA: `A：${hx(r.a)} → 调整后（看低半字节和进位）${hx(r.a)} 附近，纯二进制程序里基本没有意义。`,
    };
    return base("标志", `${word[head]}。`, effect[head], head === "CPL" ? ["A"] : [], head === "CPL" ? ["A", "F"] : ["F"]);
  }
  if (head === "DI" || head === "EI") {
    return base(
      "中断",
      head === "DI" ? "关掉可屏蔽中断。" : "打开可屏蔽中断。",
      head === "DI" ? "之后到下一次 EI 之前，中断请求会被忽略。" : "下一条指令执行完才会真正响应中断。",
      [],
      [],
    );
  }
  if (head === "HALT") {
    return base("停机", "停机，等中断才苏醒。", "这个程序此刻就结束了，剩下的步数不会被执行。", [], []);
  }
  if (head === "NOP") {
    return base("空操作", "什么都不做。", "寄存器和内存都不变，只是花掉 4 个时钟。", [], []);
  }

  // ---------------- io ----------------
  if (head === "IN" || head === "OUT") {
    const port = cell(r.pc + 1);
    return head === "OUT"
      ? base("输入输出", `把 A（${hx(r.a)}）写到端口 ${hx(port)}。`, "这个实现不接外设，端口写入被丢弃，只有 A 参与了这次操作。", ["A"], [])
      : base("输入输出", `从端口 ${hx(port)} 读一个字节到 A。`, "没有外设时读回 0，所以 A 会变成 0x00。", [], ["A"]);
  }

  // ---------------- exchange ----------------
  if (head === "EX" || head === "EXX") {
    return base("交换", "交换两组寄存器的内容。", `${name}：两边的值互换，没有一个字节丢失。`, ["AF", "BC", "DE", "HL"], ["AF", "BC", "DE", "HL"]);
  }

  // ---------------- CB prefix ----------------
  if (code === 0xcb) {
    const op = next;
    const idx = op & 7;
    const r = idx === 6 ? "(HL)" : R8[idx];
    const bit = (op >> 3) & 7;
    const kind = op < 0x40 ? "循环 / 移位" : op < 0x80 ? "测位" : op < 0xc0 ? "清位" : "置位";
    return {
      code,
      glyph: "CB",
      asm: `CB ${hx(op)}`,
      family: "位操作",
      reads: [r],
      writes: op < 0x80 ? [] : [r],
      text:
        kind === "测位"
          ? `测试 ${r} 的第 ${bit} 位。`
          : kind === "清位"
            ? `把 ${r} 的第 ${bit} 位清 0。`
            : kind === "置位"
              ? `把 ${r} 的第 ${bit} 位置 1。`
              : `对 ${r} 做循环 / 移位。`,
      effect: `${withValue(r)} 的第 ${bit} 位 = ${(read(r).value >> bit) & 1}。`,
    };
  }

  // ---------------- ED prefix ----------------
  if (code === 0xed) {
    const ed = ED_NAME[next] ?? `ED ${hx(next)}`;
    const hl = pair("HL");
    const de = pair("DE");
    const bc = pair("BC");
    const block = `把 (HL) 处的字节 ${hx(cell(hl))} 复制到地址 ${hx(de, 4)}`;
    const texts: Record<string, [string, string]> = {
      LDI: ["把 (HL) 复制到 (DE)，两个指针各 +1。", `${block}，HL → ${hx((hl + 1) & 0xffff, 4)}，DE → ${hx((de + 1) & 0xffff, 4)}，BC → ${hx((bc - 1) & 0xffff, 4)}。`],
      LDD: ["把 (HL) 复制到 (DE)，两个指针各 −1。", `${block}，HL → ${hx((hl - 1) & 0xffff, 4)}，DE → ${hx((de - 1) & 0xffff, 4)}，BC → ${hx((bc - 1) & 0xffff, 4)}。`],
      LDIR: ["重复 LDI 直到 BC 归零（一次一步，这一条只做一步）。", `${block}，然后 BC 减 1；${bc > 1 ? "BC 还没到 0，pc 会退回去再执行一次" : "BC 已经在 0，执行完就往下走"}。`],
      LDDR: ["重复 LDD 直到 BC 归零（一次一步，这一条只做一步）。", `${block}，然后 BC 减 1；${bc > 1 ? "BC 还没到 0，pc 会退回去再执行一次" : "BC 已经在 0，执行完就往下走"}。`],
      CPIR: ["边比较边往前找，直到找到相等或 BC 归零。", `比较 A（${hx(r.a)}）和 (HL)（${hx(cell(hl))}），HL +1、BC −1。`],
      CPDR: ["边比较边往后找，直到找到相等或 BC 归零。", `比较 A（${hx(r.a)}）和 (HL)（${hx(cell(hl))}），HL −1、BC −1。`],
    };
    const t = texts[ed] ?? ["块操作。", "按 HL / DE / BC 三个寄存器更新。"];
    return base("块传送", t[0], t[1], ["A", "BC", "DE", "HL"], ["BC", "DE", "HL"]);
  }

  // ---------------- index prefixes ----------------
  if (code === 0xdd || code === 0xfd) {
    return base(
      "前缀",
      `${code === 0xdd ? "DD" : "FD"} 前缀：下一条指令改用 ${code === 0xdd ? "IX" : "IY"}。`,
      `这时 IX=${hx(r.ix, 4)}、IY=${hx(r.iy, 4)}，后面的字节按这个前提去解释。`,
      [],
      [],
    );
  }

  return base(FAMILY[head] ?? "其他", name, "这条指令在这个实现里没有特别处理。");
}
