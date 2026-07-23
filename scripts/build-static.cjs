const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(root, "public");
const destination = path.join(root, "dist");

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

const vercelURL = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
if (vercelURL) {
  const configPath = path.join(destination, "firebase-config.js");
  const config = fs.readFileSync(configPath, "utf8");
  const origin = vercelURL.startsWith("http") ? vercelURL : `https://${vercelURL}`;
  fs.writeFileSync(
    configPath,
    config.replace('inviteBaseURL: "",', `inviteBaseURL: "${origin.replace(/\/$/, "")}",`)
  );
}
