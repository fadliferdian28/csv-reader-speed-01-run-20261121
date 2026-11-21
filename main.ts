// Entry point for the csv-reader-speed entry. It answers every case in
// the input file with the fast parser in solve.js and writes the answers
// out, one per case, in the order the cases came in.
//
// Run it with Node 22 or later: `node main.ts`. The harness hands it its
// directories through MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR; without
// those it reads /input/cases.json and writes /output/answers.json.

import { setFlagsFromString } from "node:v8";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Keep V8's incremental marking off for the whole run, parser included,
// so the timed work never pauses for a marking step.
setFlagsFromString("--no-incremental-marking");

type CaseFile = { id: string; input: unknown };
type Runner = (input: unknown) => unknown;

const { run }: { run: Runner } = await import(
  new URL("./solve.js", import.meta.url).href
);

const inDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const cases = JSON.parse(
  readFileSync(join(inDir, "cases.json"), "utf8")
) as CaseFile[];

const answers = cases.map((c) => run(c.input));

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "answers.json"), JSON.stringify(answers));
