const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const source = path.join(root, "public");
const destination = path.join(root, "dist");

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });
