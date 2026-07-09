const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PKG_PATH = path.join(ROOT, 'package.json');

const isPublish = process.argv.includes('--publish');

function findBarrelExports(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) {
        results.push(...findBarrelExports(fullPath, baseDir));
      }
    }
  }

  const hasBarrel =
    fs.existsSync(path.join(dir, 'index.ts')) ||
    fs.existsSync(path.join(dir, 'index.tsx'));

  if (hasBarrel) {
    const rel = path.relative(baseDir, dir);
    results.push(
      rel === '' || rel === '.' ? '.' : './' + rel.split(path.sep).join('/'),
    );
  }

  return results;
}

const barrelPaths = findBarrelExports(SRC);

if (barrelPaths.length === 0) {
  console.warn('⚠️  No barrel files (index.ts/tsx) found in src/. Exports will be empty.');
}

const exportMap = {};

for (const p of barrelPaths) {
  const distRoot = p === '.' ? 'index' : p.slice(2) + '/index';

  const typesPath = isPublish 
    ? `./dist/${distRoot}.d.ts` 
    : `./src/${distRoot}.ts`;

  exportMap[p] = {
    types: typesPath,
    import: `./dist/${distRoot}.js`,
    require: `./dist/${distRoot}.js`,
    default: `./dist/${distRoot}.js`,
  };
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));

pkg.exports = exportMap;

fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

const count = Object.keys(exportMap).length;
console.log(`✅  Generated ${count} export(s) in package.json (${isPublish ? 'PRODUCTION/PUBLISH' : 'DEVELOPMENT'} mode)`);
if (count > 0) {
  for (const [key, value] of Object.entries(exportMap)) {
    console.log(`   ${key} → types: ${value.types} | import: ${value.import}`);
  }
}
