#!/usr/bin/env tsx
/**
 * CLI Entrypoint — Parallel Runtime Benchmark
 *
 * Usage:
 *   tsx src/cli/run.ts [options]
 *
 * Options:
 *   --version 1|2                  Benchmark version (default: 1)
 *   --mode serial|parallel|both    Execution mode (default: both)
 *   --workers N                    Number of parallel workers (default: 4)
 *   --delay N                      Action delay in ms (default: 20)
 *   --output PATH                  Write JSON artifact to file
 *   --silent                       Suppress structured logs
 *   --verbose                      Show all log entries in output
 *
 * Examples:
 *   tsx src/cli/run.ts --mode both
 *   tsx src/cli/run.ts --version 2 --mode both --workers 4
 *   tsx src/cli/run.ts --mode both --output results/latest.json
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { BenchmarkHarness, formatBenchmarkReport } from "../benchmark/harness.js";
import { BenchmarkHarnessV2, formatV2Report } from "../benchmark/harness-v2.js";
import { logger } from "../logger/logger.js";

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

function parseArgs(): {
  version: 1 | 2;
  mode: "serial" | "parallel" | "both";
  workers: number;
  delay: number;
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

  const version_raw = parseInt(get("--version", "1"), 10);
  const version: 1 | 2 = version_raw === 2 ? 2 : 1;

  const output_raw = get("--output", "");

  return {
    version,
    mode,
    workers: parseInt(get("--workers", "4"), 10),
    delay: parseInt(get("--delay", "20"), 10),
    output: output_raw || undefined,
    silent: args.includes("--silent"),
    verbose: args.includes("--verbose"),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  const vLabel = args.version === 2 ? "V2 (Repair Loop)" : "V1";
  console.log(`\n🚀 Parallel Coding Runtime — Benchmark ${vLabel}\n`);
  console.log(`  Version: ${args.version}`);
  console.log(`  Mode:    ${args.mode}`);
  console.log(`  Workers: ${args.workers}`);
  console.log(`  Delay:   ${args.delay}ms per action`);
  console.log(`  Output:  ${args.output ?? "(stdout only)"}\n`);

  if (!args.silent) {
    console.log("─".repeat(57));
    console.log("  Running benchmark...");
    console.log("─".repeat(57) + "\n");
  }

  let report: string;
  let thesis_supported: boolean | undefined;

  if (args.version === 2) {
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
        log_entries: args.verbose ? output.log_entries : `[${output.log_entries.length} entries — use --verbose to include]`,
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
        log_entries: args.verbose ? output.log_entries : `[${output.log_entries.length} entries — use --verbose to include]`,
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
