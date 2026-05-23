import fs from "fs";

const file = "website/app.js";
let app = fs.readFileSync(file, "utf8");

const oldBlock = `document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.market = btn.dataset.market;
    render().catch(showAppError);
  });
});`;

const newBlock = `document.addEventListener("click", event => {
  const tabButton = event.target.closest(".tabs button");

  if (!tabButton) return;

  state.market = tabButton.dataset.market;
  render().catch(showAppError);
});`;

if (!app.includes(oldBlock)) {
  console.log("Old tab click block not found. No change made.");
  process.exit(1);
}

app = app.replace(oldBlock, newBlock);

fs.writeFileSync(file, app);

console.log("Stack Lab tab click handler fixed.");
