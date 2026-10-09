import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await read(path));
// The downloadable integration bundle contains the plugin's original brand
// assets, but intentionally excludes the private application's assets folder.
const brand = async name => {
  try { return await read(`assets/${name}`); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return read(`plugins/kitsuvo/assets/${name}`);
  }
};

test('marketplace entries resolve to the same package and bundled brand assets exist', async () => {
  const openai = await json('.agents/plugins/marketplace.json');
  const claude = await json('.claude-plugin/marketplace.json');
  const path = openai.plugins[0].source.path.replace(/^\.\//, '');
  assert.equal(claude.plugins[0].source, `./${path}`);
  const portable = await json(`${path}/plugin.json`);
  const native = await json(`${path}/.claude-plugin/plugin.json`);
  assert.equal(portable.name, openai.plugins[0].name);
  assert.equal(native.name, claude.plugins[0].name);
  assert.equal(portable.version, native.version);
  assert.equal(native.license, 'LicenseRef-Kitsuvo-Integration');
  assert.match((await read(`${path}/LICENSE`)).toString(), /personal purposes/);
  assert.equal(native.repository, portable.repository);
  assert.match(native.supportUrl, /kitsuvo-integrations\/issues$/);
  const metadata = portable.extensions['com.openai'];
  assert.ok(metadata.interface.displayName.length <= 30);
  assert.ok(metadata.interface.shortDescription.length <= 30);
  await read(`${path}/${metadata.onboardingSkill}`);
  for (const icon of [metadata.interface.composerIcon, metadata.interface.logo, native.icon]) {
    const name = icon.split('/').at(-1);
    assert.deepEqual(await read(`${path}/${icon}`), await brand(name));
  }
  const skills = await readdir(new URL(`${path}/skills/`, root));
  assert.equal(skills.length, 4);
  for (const skill of skills) {
    assert.match((await read(`${path}/skills/${skill}/SKILL.md`)).toString(), /^---\r?\nname: /);
    assert.deepEqual(await read(`${path}/skills/${skill}/assets/icon-256.png`), await brand('icon-256.png'));
  }
});

test('MCP configurations launch the isolated browser with no sensitive-profile opt-ins', async () => {
  const portable = await json('plugins/kitsuvo/mcp.json');
  const native = await json('plugins/kitsuvo/.mcp.json');
  assert.equal(portable.mcpServers.kitsuvo.type, 'stdio');
  assert.deepEqual(portable.mcpServers.kitsuvo.args, ['mcp']);
  assert.deepEqual(native.mcpServers.kitsuvo.args, ['mcp']);
  assert.equal(portable.mcpServers.kitsuvo.command, native.mcpServers.kitsuvo.command);
});
