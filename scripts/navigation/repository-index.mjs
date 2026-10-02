import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";

export const INDEX_SCHEMA_VERSION = 1;
const PARSER_VERSION = `declarations-3:typescript-${ts.version}`;
const SOURCE = /\.(?:[cm]?[jt]sx?|sh)$/i;
const BLOCKED_DIR =
  /^(?:\.git|\.cache|\.codex|\.agents|\.aws|node_modules|dist|build|coverage|generated|__snapshots__|\.expo|\.next|archive|archives|private|exports|photos|logs|artifacts|backups)$/i;
const BLOCKED_FILE =
  /(?:^\.env(?:\.|$)|(?:^(?:credentials|secrets|tokens)(?:\.|$)|private[-_]key)|\.(?:pem|key|p12|pfx|keystore|log|sqlite|db|zip|gz|age)$)/i;
const CONFIG =
  /^(?:package\.json|tsconfig(?:\.[\w-]+)?\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|(?:eslint|prettier|vitest|vite|babel|metro|app)\.config\.[cm]?[jt]s|\.gitignore|feature-map\.json)$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const posix = (value) => value.split(path.sep).join("/");
const inside = (root, target) =>
  target === root || target.startsWith(root + path.sep);

function kindFor(relative) {
  if (relative.split("/").some((part) => BLOCKED_DIR.test(part))) return null;
  const name = path.posix.basename(relative);
  if (BLOCKED_FILE.test(name)) return null;
  if (CONFIG.test(name)) return "config";
  if (SOURCE.test(name)) return "source";
  if (/\.md$/i.test(name)) return "doc";
  if (/\.sql$/i.test(name)) return "sql";
  return null;
}

// Reject every symlink component before any content read, including internal links.
function safeExistingPath(root, relative, allowDirectory = false) {
  if (!relative || path.isAbsolute(relative) || relative.includes("\\"))
    return false;
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return false;
  let current = root;
  try {
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    }
    const stat = fs.statSync(current);
    return (
      inside(root, fs.realpathSync(current)) &&
      (stat.isFile() || (allowDirectory && stat.isDirectory()))
    );
  } catch {
    return false;
  }
}

export function isIndexablePath(repoRoot, relative) {
  return Boolean(
    kindFor(relative) && safeExistingPath(fs.realpathSync(repoRoot), relative),
  );
}

function safeRead(root, relative) {
  if (!safeExistingPath(root, relative))
    throw new Error(`Unsafe or unavailable index path: ${relative}`);
  const fd = fs.openSync(
    path.join(root, relative),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new Error(`Index file exceeds bounded size: ${relative}`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function git(root, args) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function capture(root) {
  const headSha = git(root, ["rev-parse", "HEAD"]).trim();
  const inventory = [
    ...new Set(
      git(root, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
      ])
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const contents = new Map();
  const warnings = [];
  for (const relative of inventory) {
    if (!kindFor(relative) || !safeExistingPath(root, relative)) continue;
    try {
      const content = safeRead(root, relative);
      contents.set(relative, {
        content,
        hash: hash(content),
        kind: kindFor(relative),
      });
    } catch (error) {
      warnings.push(error.message);
    }
  }
  const id = hash(
    JSON.stringify([
      root,
      headSha,
      [...contents].map(([name, item]) => [name, item.hash]),
    ]),
  );
  return { headSha, id, contents, warnings };
}

function parseFile(relative, content, kind) {
  const result = { symbols: [], headings: [], imports: [] };
  if (kind === "doc") {
    let fence = null;
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence)
          fence = { character: marker[1][0], length: marker[1].length };
        else if (
          fence.character === marker[1][0] &&
          marker[1].length >= fence.length &&
          /^\s*$/.test(line.slice(marker[0].length))
        )
          fence = null;
        return;
      }
      if (fence) return;
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/);
      if (heading) result.headings.push({ title: heading[1], line: index + 1 });
      else if (
        index > 0 &&
        /^\s{0,3}(?:=+|-+)\s*$/.test(line) &&
        lines[index - 1].trim()
      )
        result.headings.push({ title: lines[index - 1].trim(), line: index });
    });
    return result;
  }
  if (
    (kind !== "source" && !(kind === "config" && SOURCE.test(relative))) ||
    relative.endsWith(".sh")
  )
    return result;
  const source = ts.createSourceFile(
    relative,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const addImport = (
    node,
    literal,
    typeOnly = false,
    dynamic = false,
    mode = "import",
  ) => {
    const specifier =
      literal && ts.isStringLiteralLike(literal)
        ? literal.text
        : "<nonliteral>";
    result.imports.push({
      specifier,
      line: lineOf(node),
      typeOnly,
      mode: typeOnly ? "type" : mode,
      ...(dynamic ? { dynamic: true } : {}),
    });
  };
  const allTypeOnly = (bindings) =>
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((item) => item.isTypeOnly);
  for (const statement of source.statements) {
    const kindName = ts.isFunctionDeclaration(statement)
      ? "function"
      : ts.isClassDeclaration(statement)
        ? "class"
        : ts.isInterfaceDeclaration(statement)
          ? "interface"
          : ts.isTypeAliasDeclaration(statement)
            ? "type"
            : ts.isEnumDeclaration(statement)
              ? "enum"
              : ts.isModuleDeclaration(statement)
                ? "namespace"
                : null;
    if (kindName && statement.name)
      result.symbols.push({
        name: statement.name.text,
        kind: kindName,
        line: lineOf(statement),
      });
    if (ts.isVariableStatement(statement)) {
      const collect = (name, node) => {
        if (ts.isIdentifier(name))
          result.symbols.push({
            name: name.text,
            kind: "variable",
            line: lineOf(node),
          });
        else
          for (const element of name.elements)
            if (ts.isBindingElement(element)) collect(element.name, element);
      };
      for (const declaration of statement.declarationList.declarations)
        collect(declaration.name, declaration);
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node))
      addImport(
        node,
        node.moduleSpecifier,
        Boolean(
          node.importClause?.isTypeOnly ||
          (!node.importClause?.name &&
            allTypeOnly(node.importClause?.namedBindings)),
        ),
      );
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      addImport(
        node,
        node.moduleSpecifier,
        Boolean(
          node.isTypeOnly ||
          (node.exportClause &&
            ts.isNamedExports(node.exportClause) &&
            node.exportClause.elements.length > 0 &&
            node.exportClause.elements.every((item) => item.isTypeOnly)),
        ),
      );
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      addImport(
        node,
        node.moduleReference.expression,
        Boolean(node.isTypeOnly),
        false,
        "require",
      );
    else if (ts.isImportTypeNode(node))
      addImport(
        node,
        ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null,
        true,
      );
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      addImport(
        node,
        node.arguments[0],
        false,
        node.expression.kind === ts.SyntaxKind.ImportKeyword,
        node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? "import"
          : "require",
      );
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function workspacePatterns(content) {
  const patterns = [];
  let inPackages = false;
  let found = false;
  for (const raw of content.split("\n")) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/^packages:\s*(?:#.*)?$/.test(raw)) {
      inPackages = true;
      found = true;
      continue;
    }
    if (/^packages:/.test(raw))
      throw new Error(
        "Unsupported pnpm workspace packages syntax; use a block list of quoted or plain glob strings.",
      );
    if (inPackages && /^\S/.test(raw)) inPackages = false;
    if (!inPackages) continue;
    const match = raw.match(
      /^\s+-\s+(?:'([^']+)'|"([^"]+)"|([^\s#]+))\s*(?:#.*)?$/,
    );
    const pattern = match && (match[1] || match[2] || match[3]);
    if (
      !pattern ||
      /[{}\[\]\\]/.test(pattern) ||
      pattern.includes("..") ||
      pattern.startsWith("/") ||
      /[?+@()]/.test(pattern)
    )
      throw new Error(
        "Unsupported pnpm workspace package glob; supported syntax is paths with * or ** and optional ! exclusion.",
      );
    patterns.push(pattern.replace(/\/$/, ""));
  }
  if (!found)
    throw new Error("pnpm-workspace.yaml has no supported packages block.");
  return patterns;
}

function globMatch(pattern, relative) {
  const parts = pattern.split("/");
  const escaped = parts
    .map((part, index) => {
      if (part === "**")
        return index === parts.length - 1 ? ".*" : "(?:[^/]+/)*";
      const value = part
        .split("*")
        .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*");
      return value + (index < parts.length - 1 ? "/" : "");
    })
    .join("");
  return new RegExp(`^${escaped}$`).test(relative);
}

function discoverPackages(contents, warnings) {
  if (!contents.has("pnpm-workspace.yaml")) {
    warnings.push(
      "Workspace package discovery unavailable: pnpm-workspace.yaml is missing.",
    );
    return [];
  }
  const patterns = workspacePatterns(
    contents.get("pnpm-workspace.yaml").content,
  );
  const packages = [];
  for (const [relative, item] of contents) {
    if (
      path.posix.basename(relative) !== "package.json" ||
      relative === "package.json"
    )
      continue;
    const directory = path.posix.dirname(relative);
    if (
      !patterns.some(
        (pattern) => !pattern.startsWith("!") && globMatch(pattern, directory),
      ) ||
      patterns.some(
        (pattern) =>
          pattern.startsWith("!") && globMatch(pattern.slice(1), directory),
      )
    )
      continue;
    try {
      const json = JSON.parse(item.content);
      if (typeof json.name !== "string") {
        warnings.push(`Workspace manifest has no name: ${relative}`);
        continue;
      }
      if (packages.some((pkg) => pkg.name === json.name))
        throw new Error(`Duplicate workspace package name: ${json.name}`);
      packages.push({
        name: json.name,
        path: directory,
        dependencies: [
          ...new Set(
            Object.keys({
              ...json.dependencies,
              ...json.devDependencies,
              ...json.peerDependencies,
              ...json.optionalDependencies,
            }),
          ),
        ].sort(),
        manifest: json,
      });
    } catch (error) {
      if (error.message.startsWith("Duplicate")) throw error;
      warnings.push(`Invalid workspace manifest: ${relative}`);
    }
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

function resolver(root, contents, packages, warnings) {
  const configs = [...contents.keys()].filter(
    (relative) => path.posix.basename(relative) === "tsconfig.json",
  );
  const configOptions = new Map();
  const auxiliary = new Map();
  function configurationRead(absolute) {
    const relative = posix(path.relative(root, absolute));
    if (contents.has(relative)) return contents.get(relative).content;
    // TypeScript reads data only. Installed package config links may resolve inside
    // this worktree; external links and sensitive paths are rejected before reads.
    try {
      const real = fs.realpathSync(absolute);
      const canonical = posix(path.relative(root, real));
      if (
        !inside(root, real) ||
        !/\.json$/i.test(real) ||
        BLOCKED_FILE.test(path.basename(real)) ||
        /(?:credential|secret|token|service[-_]account)/i.test(
          path.basename(real),
        ) ||
        canonical
          .split("/")
          .some((part) => BLOCKED_DIR.test(part) && part !== "node_modules")
      )
        return undefined;
      const content = safeRead(root, canonical);
      auxiliary.set(canonical, hash(content));
      return content;
    } catch {
      return undefined;
    }
  }
  const directories = new Set([root]);
  for (const relative of contents.keys()) {
    let directory = path.dirname(path.join(root, relative));
    while (inside(root, directory)) {
      directories.add(directory);
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const host = {
    useCaseSensitiveFileNames: true,
    getCurrentDirectory: () => root,
    fileExists: (absolute) =>
      contents.has(posix(path.relative(root, absolute))),
    readFile: (absolute) =>
      contents.get(posix(path.relative(root, absolute)))?.content,
    readDirectory: () => [],
    directoryExists: (absolute) => directories.has(path.resolve(absolute)),
    realpath: (absolute) => absolute,
  };
  const configHost = {
    ...host,
    fileExists: (absolute) => configurationRead(absolute) !== undefined,
    readFile: configurationRead,
    directoryExists: (absolute) => {
      try {
        return (
          inside(root, fs.realpathSync(absolute)) &&
          fs.statSync(absolute).isDirectory()
        );
      } catch {
        return false;
      }
    },
  };
  for (const relative of configs) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      path.join(root, relative),
      {},
      {
        ...configHost,
        onUnRecoverableConfigFileDiagnostic: () =>
          warnings.push(`Unable to parse TypeScript config: ${relative}`),
      },
    );
    if (parsed) {
      configOptions.set(path.posix.dirname(relative), parsed.options);
      for (const error of parsed.errors)
        if (error.code !== 18003)
          warnings.push(
            `TypeScript config ${relative}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`,
          );
    }
  }
  function candidatesFor(absolute) {
    if (!inside(root, absolute)) return [];
    const relative = posix(path.relative(root, absolute));
    let choices = [relative];
    if (/\.jsx?$/.test(relative)) {
      const base = relative.replace(/\.jsx?$/, "");
      choices = [base + ".ts", base + ".tsx", base + ".d.ts", relative];
    } else if (/\.[mc]js$/.test(relative)) {
      const base = relative.slice(0, -4);
      const extension = relative.endsWith(".mjs") ? ".mts" : ".cts";
      choices = [base + extension, base + ".d" + extension, relative];
    } else if (!path.extname(relative)) {
      choices = [relative];
      for (const extension of [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".d.ts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
      ])
        choices.push(relative + extension, `${relative}/index${extension}`);
    }
    return choices.filter((choice) => kindFor(choice) === "source");
  }
  function exportTargets(value, conditions, star = "") {
    if (typeof value === "string")
      return value.startsWith("./") ? [value.replaceAll("*", star)] : [];
    if (Array.isArray(value))
      return value.flatMap((child) => exportTargets(child, conditions, star));
    if (!value || typeof value !== "object") return [];
    // Node conditional exports are ordered. Keep every matching alternative as
    // advisory candidates, but select the first indexable one for this mode.
    return Object.entries(value)
      .filter(([condition]) => conditions.has(condition))
      .flatMap(([, child]) => exportTargets(child, conditions, star));
  }
  const resolve = (file, specifier, entry) => {
    const applicable = [...configOptions]
      .filter(
        ([directory]) => directory === "." || file.startsWith(directory + "/"),
      )
      .sort((a, b) => b[0].length - a[0].length)[0];
    const compilerOptions = applicable?.[1] || {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
    };
    const mode = entry.mode || (entry.typeOnly ? "type" : "import");
    const candidates = new Set();
    const add = (absolute) => {
      const paths = candidatesFor(absolute);
      for (const relative of paths) candidates.add(relative);
      return paths.find(
        (relative) => contents.get(relative)?.kind === "source",
      );
    };
    const result = (target, extra = {}) => ({
      target,
      candidates: [...candidates].sort(),
      ...extra,
    });
    const fromTs = () => {
      const resolution = ts.resolveModuleName(
        specifier,
        path.join(root, file),
        compilerOptions,
        host,
        undefined,
        undefined,
        mode === "require" ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
      );
      // Failed lookups are vital after deletion: a later index.ts may now resolve,
      // while the deleted direct file still needs conservative consumer impact.
      for (const location of resolution.failedLookupLocations || [])
        add(location);
      return (
        resolution.resolvedModule &&
        add(resolution.resolvedModule.resolvedFileName)
      );
    };
    if (specifier.startsWith(".")) {
      add(path.resolve(root, path.posix.dirname(file), specifier));
      return result(
        fromTs() ||
          add(path.resolve(root, path.posix.dirname(file), specifier)),
      );
    }
    const pkg = packages.find(
      (item) =>
        specifier === item.name || specifier.startsWith(item.name + "/"),
    );
    if (pkg) {
      const key =
        specifier === pkg.name
          ? "."
          : "./" + specifier.slice(pkg.name.length + 1);
      const exports = pkg.manifest.exports;
      let value;
      let star = "";
      if (
        typeof exports === "string" ||
        Array.isArray(exports) ||
        (exports && !Object.keys(exports).some((key) => key.startsWith(".")))
      ) {
        if (key === ".") value = exports;
      } else if (exports && typeof exports === "object") {
        value = exports[key];
        if (value === undefined) {
          const patterns = Object.keys(exports)
            .filter((pattern) => pattern.includes("*"))
            .sort(
              (a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length,
            );
          for (const pattern of patterns) {
            const split = pattern.split("*");
            if (
              split.length === 2 &&
              key.startsWith(split[0]) &&
              key.endsWith(split[1])
            ) {
              value = exports[pattern];
              star = key.slice(split[0].length, key.length - split[1].length);
              break;
            }
          }
        }
      }
      const conditions = new Set([
        "default",
        "node",
        mode === "require" ? "require" : "import",
        ...(compilerOptions.customConditions || []),
        ...(mode === "type" ? ["types"] : []),
      ]);
      const selected = exportTargets(value, conditions, star);
      if (!exports && key === ".")
        selected.push(
          ...[
            mode === "type" ? pkg.manifest.types : undefined,
            mode === "require" ? pkg.manifest.main : pkg.manifest.module,
            pkg.manifest.main,
          ].filter((target) => typeof target === "string"),
        );
      let target;
      for (const candidate of selected) {
        const resolved = add(path.resolve(root, pkg.path, candidate));
        target ||= resolved;
      }
      if (target) return result(target);
      // Built runtime output is excluded from this source inventory. Retain a
      // separately labelled type dependency, rather than inventing a runtime edge.
      if (mode !== "type") {
        const typeTargets = exportTargets(value, new Set(["types"]), star);
        if (!exports && key === "." && typeof pkg.manifest.types === "string")
          typeTargets.push(pkg.manifest.types);
        let fallback;
        for (const candidate of typeTargets) {
          const resolved = add(path.resolve(root, pkg.path, candidate));
          fallback ||= resolved;
        }
        if (fallback) {
          warnings.push(
            `Runtime target for '${specifier}' in ${file} is unavailable in the source inventory; retaining an advisory type-only fallback to ${fallback}.`,
          );
          return result(fallback, { typeOnly: true, uncertain: true });
        }
      }
      return result(undefined);
    }
    if (!applicable) return result(undefined);
    // Preserve configured alias candidates even if TypeScript found an existing
    // alternate target and stopped before visiting all path substitutions.
    const base =
      compilerOptions.baseUrl ||
      compilerOptions.pathsBasePath ||
      path.join(root, applicable[0]);
    for (const [pattern, replacements] of Object.entries(
      compilerOptions.paths || {},
    )) {
      const split = pattern.split("*");
      const matches =
        split.length === 1
          ? specifier === pattern
          : split.length === 2 &&
            specifier.startsWith(split[0]) &&
            specifier.endsWith(split[1]);
      if (!matches) continue;
      const star =
        split.length === 2
          ? specifier.slice(split[0].length, specifier.length - split[1].length)
          : "";
      for (const replacement of replacements)
        add(path.resolve(base, replacement.replaceAll("*", star)));
    }
    return result(fromTs());
  };
  return { resolve, auxiliary };
}

function cachePath(root) {
  const directory = ".cache/mizyun-navigation";
  let current = root;
  for (const component of directory.split("/")) {
    current = path.join(current, component);
    if (
      fs.existsSync(current) &&
      (fs.lstatSync(current).isSymbolicLink() ||
        !fs.statSync(current).isDirectory())
    )
      throw new Error("Unsafe navigation cache directory");
  }
  return path.join(root, directory, "parse-cache.json");
}

function readCache(root, enabled, warnings) {
  if (!enabled) return {};
  try {
    const absolute = cachePath(root);
    if (!fs.existsSync(absolute)) return {};
    if (fs.lstatSync(absolute).isSymbolicLink())
      throw new Error("Unsafe navigation cache file");
    if (fs.statSync(absolute).size > 64 * MAX_FILE_BYTES)
      throw new Error("Navigation cache exceeds bounded size");
    const cache = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (
      cache.root !== root ||
      cache.parser !== PARSER_VERSION ||
      cache.schemaVersion !== INDEX_SCHEMA_VERSION
    )
      return {};
    if (
      !cache.records ||
      typeof cache.records !== "object" ||
      Array.isArray(cache.records)
    )
      throw new Error("Invalid cache records");
    return cache.records;
  } catch {
    warnings.push(
      "Navigation parse cache unavailable or corrupt; reparsing current files.",
    );
    return {};
  }
}

function reusable(record) {
  return (
    record &&
    Array.isArray(record.symbols) &&
    record.symbols.every(
      (item) =>
        item &&
        typeof item.name === "string" &&
        typeof item.kind === "string" &&
        Number.isInteger(item.line),
    ) &&
    Array.isArray(record.headings) &&
    record.headings.every(
      (item) =>
        item && typeof item.title === "string" && Number.isInteger(item.line),
    ) &&
    Array.isArray(record.imports) &&
    record.imports.every(
      (item) =>
        item &&
        typeof item.specifier === "string" &&
        Number.isInteger(item.line) &&
        typeof item.typeOnly === "boolean" &&
        ["import", "require", "type"].includes(item.mode),
    )
  );
}

function writeCache(root, records, warnings) {
  let temporary;
  try {
    const absolute = cachePath(root);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({
        schemaVersion: INDEX_SCHEMA_VERSION,
        parser: PARSER_VERSION,
        root,
        records,
      }),
      { flag: "wx", mode: 0o600 },
    );
    fs.renameSync(temporary, absolute);
  } catch {
    warnings.push(
      "Navigation parse cache could not be saved; current index remains usable.",
    );
  } finally {
    if (temporary)
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* atomic rename already removed it */
      }
  }
}

/** Local declarations and file edges only; this is not a symbol call graph. */
export function getRepositoryIndex(repoRoot, options = {}) {
  const root = fs.realpathSync(repoRoot);
  if (
    fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root
  )
    throw new Error("Repository index root must be the Git worktree root.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const captured = capture(root);
    const warnings = [...captured.warnings];
    const cached = readCache(root, options.cache !== false, warnings);
    const records = {};
    const stats = { parsed: 0, reused: 0, files: captured.contents.size };
    const files = [...captured.contents].map(([relative, item]) => {
      const key = `${PARSER_VERSION}:${item.kind}:${path.extname(relative)}:${item.hash}`;
      const metadata = reusable(cached[key])
        ? (stats.reused++,
          {
            symbols: cached[key].symbols.map(({ name, kind, line }) => ({
              name,
              kind,
              line,
            })),
            headings: cached[key].headings.map(({ title, line }) => ({
              title,
              line,
            })),
            imports: cached[key].imports.map(
              ({ specifier, line, typeOnly, dynamic, mode }) => ({
                specifier,
                line,
                typeOnly,
                mode,
                ...(dynamic === true ? { dynamic: true } : {}),
              }),
            ),
          })
        : (stats.parsed++, parseFile(relative, item.content, item.kind));
      records[key] = metadata;
      return {
        path: relative,
        hash: item.hash,
        kind: item.kind,
        symbols: metadata.symbols,
        headings: metadata.headings,
        imports: metadata.imports.map((entry) => ({ ...entry })),
      };
    });
    const packages = discoverPackages(captured.contents, warnings);
    const { resolve, auxiliary } = resolver(
      root,
      captured.contents,
      packages,
      warnings,
    );
    const edges = [];
    const unresolved = [];
    for (const file of files)
      for (const entry of file.imports) {
        const resolution =
          entry.specifier === "<nonliteral>"
            ? { candidates: [] }
            : resolve(file.path, entry.specifier, entry);
        const { target } = resolution;
        entry.candidates = resolution.candidates;
        if (resolution.uncertain) entry.uncertain = true;
        if (target) {
          entry.target = target;
          edges.push({
            from: file.path,
            to: target,
            specifier: entry.specifier,
            line: entry.line,
            typeOnly: resolution.typeOnly ?? entry.typeOnly,
            ...(resolution.uncertain ? { uncertain: true } : {}),
          });
        } else
          unresolved.push({
            file: file.path,
            specifier: entry.specifier,
            line: entry.line,
            typeOnly: entry.typeOnly,
            kind:
              entry.specifier === "<nonliteral>"
                ? "nonliteral"
                : entry.specifier.startsWith(".") ||
                    packages.some(
                      (pkg) =>
                        entry.specifier === pkg.name ||
                        entry.specifier.startsWith(pkg.name + "/"),
                    )
                  ? "missing"
                  : "external-or-unresolved",
          });
      }
    if (capture(root).id !== captured.id) continue;
    if (
      [...auxiliary].some(([relative, expected]) => {
        try {
          return hash(safeRead(root, relative)) !== expected;
        } catch {
          return true;
        }
      })
    )
      continue;
    const snapshotId = hash(
      JSON.stringify([
        captured.id,
        [...auxiliary].sort(([a], [b]) => a.localeCompare(b)),
      ]),
    );
    if (options.cache !== false) writeCache(root, records, warnings);
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      snapshot: { id: snapshotId, headSha: captured.headSha, root },
      files,
      edges,
      unresolved,
      packages: packages.map(({ manifest: _manifest, ...pkg }) => pkg),
      stats,
      warnings: [...new Set(warnings)],
    };
  }
  throw new Error(
    "Repository changed during indexing after three attempts; retry when edits settle.",
  );
}
