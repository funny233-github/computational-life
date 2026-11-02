/**
 * A 64-byte self-replicator for the paper's substrate (BFF, heads at 0/0, pc 0).
 *
 *   [{.>]                    loop: h1--, tape[h1] = tape[h0], h0++
 *   #### ... ####            filler of 0x01 — a non-zero no-op, so the loop
 *                            cannot exit early (0x00 would end it)
 *   ]>.{[                    mirror image: makes the whole string a palindrome
 *
 * It copies itself *backwards* into the neighbouring tape; because the program
 * is a palindrome, the reversed copy is the program again — exactly the property
 * Agüera y Arcas et al. report for the replicators that emerge on their own.
 */
export const REPLICATOR = "[{.>]" + "#".repeat(54) + "]>.{[";
