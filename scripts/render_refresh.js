import { execSync } from "child_process";

function run(command) {
  console.log("");
  console.log("RUNNING:", command);
  execSync(command, {
    stdio: "inherit",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  });
}

function runSoft(command) {
  try {
    run(command);
  } catch (error) {
    console.log("SOFT FAIL:", command);
  }
}

try {
  console.log("");
  console.log("THE SLIP LAB RENDER REFRESH STARTED");
  console.log("Time:", new Date().toISOString());

  run("git status");

  run("node scripts/run_all.js");

  run('git config user.name "render-refresh-bot"');
  run('git config user.email "render-refresh-bot@users.noreply.github.com"');

  runSoft("git remote set-url origin https://x-access-token:${GITHUB_TOKEN}@github.com/sboddy21/TheSlipLab.git");

  run("git add website/data exports/content data exports || true");

  runSoft('git commit -m "Render auto refresh MLB data"');

  runSoft("git pull --rebase origin main");

  run("git push origin main");

  console.log("");
  console.log("RENDER REFRESH COMPLETE");
  console.log("Time:", new Date().toISOString());
} catch (error) {
  console.error("");
  console.error("RENDER REFRESH FAILED");
  console.error(error);
  process.exit(1);
}
