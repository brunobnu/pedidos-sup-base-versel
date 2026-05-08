const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceFiles = [
  "src/months.js",
  "src/auth.js",
  "src/mockData.js",
  "src/storageService.js",
  "src/storage.js",
  "src/calculations.js",
  "src/importService.js",
  "src/exportService.js",
  "src/charts.js",
  "src/app.js",
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function bundle() {
  const jszip = fs.readFileSync(path.join(root, "vendor", "jszip.min.js"), "utf8");
  const version = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);
  let out = "/* Generated bundle for local/static usage. Source files live in /src. */\n";
  out += `window.APP_VERSION = "${version}";\n`;
  out += `\n/* vendor/jszip.min.js */\n${jszip}\n`;
  out += "\nwindow.JSZip = window.JSZip || (typeof JSZip !== \"undefined\" ? JSZip : window.JSZip);\n";

  for (const file of sourceFiles) {
    let code = fs.readFileSync(path.join(root, file), "utf8");
    code = code.replace(/^import[\s\S]*?;\r?\n/gm, "");
    code = code.replace(/export async function /g, "async function ");
    code = code.replace(/export function /g, "function ");
    code = code.replace(/export const /g, "const ");
    out += `\n/* ${file} */\n${code}\n`;
  }

  const targets = [
    path.join(root, "dist", "app.bundle.js"),
    path.join(root, "cloudflare-pages", "dist", "app.bundle.js"),
    path.join(root, "vercel-dist", "dist", "app.bundle.js"),
  ];
  targets.forEach((target) => {
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, out);
  });

  const htmlTargets = [
    path.join(root, "index.html"),
    path.join(root, "cloudflare-pages", "index.html"),
    path.join(root, "vercel-dist", "index.html"),
  ];
  htmlTargets.forEach((target) => {
    const source = target.endsWith(path.join("vercel-dist", "index.html"))
      ? path.join(root, "index.html")
      : target;
    let html = fs.readFileSync(source, "utf8");
    html = html.replace(/\.\/dist\/app\.bundle\.js(?:\?v=\d+)?/, `./dist/app.bundle.js?v=${version}`);
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, html);
  });

  const styleTargets = [
    path.join(root, "cloudflare-pages", "styles.css"),
    path.join(root, "vercel-dist", "styles.css"),
  ];
  styleTargets.forEach((target) => {
    ensureDir(path.dirname(target));
    fs.copyFileSync(path.join(root, "styles.css"), target);
  });

  const vendorTarget = path.join(root, "vercel-dist", "vendor", "jszip.min.js");
  ensureDir(path.dirname(vendorTarget));
  fs.copyFileSync(path.join(root, "vendor", "jszip.min.js"), vendorTarget);

  console.log("APP_VERSION", version);
  console.log("bundle bytes", out.length);
}

bundle();
