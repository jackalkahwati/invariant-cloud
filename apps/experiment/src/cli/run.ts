#!/usr/bin/env tsx
/**
 * CLI Entrypoint — Parallel Runtime Benchmark
 *
 * Usage:
 *   tsx src/cli/run.ts [options]
 *
 * Options:
 *   --version 1|2|3                Benchmark version (default: 1)
 *   --mode serial|parallel|both    Execution mode (default: both)
 *   --workers N                    Number of parallel workers (default: 4)
 *   --delay N                      Action delay in ms (default: 20)
 *   --sweep                        V3: run worker count sweep (2,4,8,12)
 *   --fixture original|optimized   V3: fixture to use (default: optimized)
 *   --output PATH                  Write JSON artifact to file
 *   --silent                       Suppress structured logs
 *   --verbose                      Show all log entries in output
 *
 * Examples:
 *   tsx src/cli/run.ts --mode both
 *   tsx src/cli/run.ts --version 2 --mode both --workers 4
 *   tsx src/cli/run.ts --version 3 --mode both --sweep
 *   tsx src/cli/run.ts --version 3 --fixture original --mode both
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { BenchmarkHarness, formatBenchmarkReport } from "../benchmark/harness.js";
import { BenchmarkHarnessV2, formatV2Report } from "../benchmark/harness-v2.js";
import {
  BenchmarkHarnessV3,
  formatV3Report,
  formatV3CompactSweep,
} from "../benchmark/harness-v3.js";
import {
  LLMBenchmarkHarness,
  formatLLMReport,
} from "../benchmark/harness-llm.js";
import { logger } from "../logger/logger.js";

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

function parseArgs(): {
  version: 1 | 2 | 3 | "llm";
  mode: "serial" | "parallel" | "both";
  workers: number;
  delay: number;
  sweep: boolean;
  fixture: "original" | "optimized";
  model?: string;
  output?: string;
  silent: boolean;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const mode_raw = get("--mode", "both");
  const mode =
    mode_raw === "serial" || mode_raw === "parallel" || mode_raw === "both"
      ? mode_raw
      : "both";

  const version_raw = get("--version", "1");
  const version: 1 | 2 | 3 | "llm" =
    version_raw === "llm" ? "llm" :
    version_raw === "3" ? 3 :
    version_raw === "2" ? 2 : 1;

  const fixture_raw = get("--fixture", "optimized");
  const fixture: "original" | "optimized" =
    fixture_raw === "original" ? "original" : "optimized";

  const output_raw = get("--output", "");
  const model_raw = get("--model", "");

  return {
    version,
    mode,
    workers: parseInt(get("--workers", "4"), 10),
    delay: parseInt(get("--delay", "15"), 10),
    sweep: args.includes("--sweep"),
    fixture,
    model: model_raw || undefined,
    output: output_raw || undefined,
    silent: args.includes("--silent"),
    verbose: args.includes("--verbose"),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  const vLabel =
    args.version === "llm" ? "LLM (Real Workers)" :
    args.version === 3 ? "V3 (Optimized)" : args.version === 2 ? "V2 (Repair Loop)" : "V1";
  console.log(`\n🚀 Parallel Coding Runtime — Benchmark ${vLabel}\n`);
  console.log(`  Version: ${args.version}`);
  console.log(`  Mode:    ${args.mode}`);
  console.log(`  Workers: ${args.workers}`);
  if (args.version !== "llm") console.log(`  Delay:   ${args.delay}ms per action`);
  if (args.version === "llm" && args.model) console.log(`  Model:   ${args.model}`);
  if (args.version === 3) {
    console.log(`  Fixture: ${args.fixture}`);
    console.log(`  Sweep:   ${args.sweep ? "yes (2,4,8,12 workers)" : "no"}`);
  }
  console.log(`  Output:  ${args.output ?? "(stdout only)"}\n`);

  if (!args.silent) {
    console.log("─".repeat(57));
    console.log("  Running benchmark...");
    console.log("─".repeat(57) + "\n");
  }

  let report: string;
  let thesis_supported: boolean | undefined;

  if (args.version === "llm") {
    const harness = new LLMBenchmarkHarness({
      mode: args.mode,
      parallel_workers: args.workers,
      model: args.model,
      silent: args.silent,
    });
    const output = await harness.run();
    report = formatLLMReport(output);
    thesis_supported = output.result.comparison?.thesis_supported;

    if (args.output) {
      const dir = dirname(args.output);
      mkdirSync(dir, { recursive: true });
      const artifact = {
        ...output,
        log_entries: args.verbose
          ? output.log_entries
          : `[${output.log_entries.length} entries — use --verbose to include]`,
      };
      writeFileSync(args.output, JSON.stringify(artifact, null, 2));
    }
  } else if (args.version === 3) {
    const harness = new BenchmarkHarnessV3({
      mode: args.mode,
      parallel_workers: args.workers,
      action_delay_ms: args.delay,
      silent: args.silent,
      fixture: args.fixture,
      worker_sweep: args.sweep ? [2, 4, 8, 12] : undefined,
    });
    const output = await harness.run();
    report = formatV3Report(output);
    if (args.sweep && output.sweep) {
      report += formatV3CompactSweep(output);
    }
    thesis_supported = output.primary.comparison.thesis_supported;

    if (args.output) {
      const dir = dirname(args.output);
      mkdirSync(dir, { recursive: true });
      const artifact = {
        ...output,
        log_entries: args.verbose
          ? output.log_entries
          : `[${output.log_entries.length} entries — use --verbose to include]`,
      };
      writeFileSync(args.output, JSON.stringify(artifact, null, 2));
    }
  } else if (args.version === 2) {
    const harness = new BenchmarkHarnessV2({
      mode: args.mode,
      parallel_workers: args.workers,
      action_delay_ms: args.delay,
      silent: args.silent,
    });
    const output = await harness.run();
    report = formatV2Report(output);
    thesis_supported = output.comparison?.thesis_supported;

    if (args.output) {
      const dir = dirname(args.output);
      mkdirSync(dir, { recursive: true });
      const artifact = {
        ...output,
        log_entries: args.verbose
          ? output.log_entries
          : `[${output.log_entries.length} entries — use --verbose to include]`,
      };
      writeFileSync(args.output, JSON.stringify(artifact, null, 2));
    }
  } else {
    const harness = new BenchmarkHarness({
      mode: args.mode,
      parallel_workers: args.workers,
      action_delay_ms: args.delay,
      silent: args.silent,
    });
    const output = await harness.run();
    report = formatBenchmarkReport(output);
    thesis_supported = output.comparison?.thesis_supported;

    if (args.output) {
      const dir = dirname(args.output);
      mkdirSync(dir, { recursive: true });
      const artifact = {
        ...output,
        log_entries: args.verbose
          ? output.log_entries
          : `[${output.log_entries.length} entries — use --verbose to include]`,
      };
      writeFileSync(args.output, JSON.stringify(artifact, null, 2));
    }
  }

  console.log("\n" + report);

  if (args.output) {
    console.log(`\n  Artifact written to: ${args.output}`);
  }

  // Exit with error code if thesis not supported
  if (thesis_supported === false) {
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error("CLI crashed", { error: err instanceof Error ? err.message : String(err) });
  console.error("\nFATAL:", err);
  process.exit(2);
});
