import { spawnSync } from "child_process";

function run(command, args, timeout) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    timeout,
    env: process.env
  });

  if (result.error || result.status !== 0) {
    console.error(result.error?.message || `${command} ${args.join(" ")} failed`);
    process.exit(result.status || 1);
  }
}

console.warn("scripts/render_refresh.js is deprecated; it no longer commits, rewrites remotes, or pushes.");
run("npm", ["run", "mlb:refresh"], 18 * 60 * 1000);
run("npm", ["run", "mlb:validate"], 2 * 60 * 1000);
run("node", ["scripts/run_nba_refresh.js"], 16 * 60 * 1000);
