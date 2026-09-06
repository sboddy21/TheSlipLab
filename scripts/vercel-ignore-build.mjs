import { execFileSync } from "node:child_process";

const automatedDataCommits = new Set([
  "Automated X posting update",
  "Build Called It X dry-run queue",
  "Build daily edge X post outputs",
  "Build daily slate X thread preview",
  "Refresh MLB data",
  "Refresh NBA data",
  "Refresh NFL data",
  "Refresh WNBA data",
  "Refresh college football board",
  "Refresh sportsbook prices across sports",
  "Update HR results",
]);

let subject = process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n", 1)[0]?.trim();

if (!subject) {
  try {
    subject = execFileSync("git", ["log", "-1", "--pretty=%s"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // If Git metadata is unavailable, fail open so a real release is never skipped.
    process.exit(1);
  }
}

if (automatedDataCommits.has(subject)) {
  console.log(`Skipping Vercel build for automated refresh: ${subject}`);
  process.exit(0);
}

console.log(`Continuing Vercel build for release commit: ${subject || "unknown"}`);
process.exit(1);
