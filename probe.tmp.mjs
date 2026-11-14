import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto("http://127.0.0.1:5199/?speed=32&step=3&view=test");
await p.waitForFunction(() => "__dryrun" in globalThis);
await p.waitForTimeout(25000);
const dump = await p.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const x = e.getBoundingClientRect(); return [Math.round(x.top), Math.round(x.bottom)]; };
  return {
    head: r(".st-panel-head"), nav: r(".st-results-switch"), body: r(".st-panel-body"), foot: r(".st-panel-foot"),
    pred: r('[data-testid="prediction-range"]'), verdict: r('[data-testid="verdict"]'), bodyScroll: document.querySelector(".st-panel-body")?.scrollTop,
    cardH: document.querySelector(".st-panel-body")?.scrollHeight, bodyH: document.querySelector(".st-panel-body")?.clientHeight,
  };
});
console.log(JSON.stringify(dump));
await b.close();
