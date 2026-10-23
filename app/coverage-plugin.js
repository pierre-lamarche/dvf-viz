import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const acorn = require("acorn");

export function coveragePlugin() {
  return {
    name: "e2e-coverage",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/src/") || !id.endsWith(".js")) return null;
      const file = path.basename(id);
      let ast;
      try {
        ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true });
      } catch {
        return null;
      }
      const inserts = [];
      walk(ast, (node) => {
        const isFn =
          node.type === "FunctionDeclaration" ||
          node.type === "FunctionExpression" ||
          node.type === "ArrowFunctionExpression";
        if (!isFn || !node.body) return;
        if (node.body.type !== "BlockStatement") return;
        const name = node.id && node.id.name ? node.id.name : "anon";
        const line = node.body.loc ? node.body.loc.start.line : "?";
        inserts.push({
          pos: node.body.start + 1,
          text: `\n  window.__cov__=window.__cov__||{};window.__cov__["${file}:${name}:${line}"]=1;`,
        });
      });
      if (!inserts.length) return null;
      inserts.sort((a, b) => b.pos - a.pos);
      let out = code;
      for (const ins of inserts) {
        out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
      }
      return { code: out, map: null };
    },
  };
}

function walk(node, visit) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "start" || key === "end" || key === "type") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walk(c, visit);
    } else if (child && typeof child === "object" && typeof child.type === "string") {
      walk(child, visit);
    }
  }
}
