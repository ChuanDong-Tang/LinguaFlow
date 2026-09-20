#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { changedFilesBetween, classifyMobileReleaseRisk, PROFILE_RANK } from './mobile-release-risk.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const EXTENSIONS = Object.freeze({ ios: '.ipa', 'google-android': '.aab', 'china-android': '.apk' });

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${token}`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function gitResolves(commit) {
  return spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repoRoot }).status === 0;
}

export function validatePrepublish({ record, acceptanceFile, artifact, distribution, expectedVersion, expectedBuild, changedFiles }) {
  const errors = [];
  const resolvedArtifact = path.resolve(artifact);
  if (record.distribution !== distribution) errors.push(`acceptance distribution is ${record.distribution}, expected ${distribution}`);
  if (record.version !== expectedVersion) errors.push(`acceptance version is ${record.version}, expected ${expectedVersion}`);
  if (String(record.build) !== String(expectedBuild)) errors.push(`acceptance build is ${record.build}, expected ${expectedBuild}`);
  if (path.extname(resolvedArtifact) !== EXTENSIONS[distribution]) errors.push(`artifact must be ${EXTENSIONS[distribution]}`);
  if (path.resolve(record.artifact?.pathOrId || '') !== resolvedArtifact) errors.push('acceptance artifact path does not match upload artifact');
  if (!fs.existsSync(resolvedArtifact)) errors.push(`artifact does not exist: ${resolvedArtifact}`);
  else if (sha256(resolvedArtifact) !== record.artifact?.sha256) errors.push('artifact SHA-256 does not match acceptance record');
  if (!gitResolves(record.baselineCommit)) errors.push(`baselineCommit does not resolve: ${record.baselineCommit}`);
  if (!gitResolves(record.sourceCommit)) errors.push(`sourceCommit does not resolve: ${record.sourceCommit}`);

  const risk = classifyMobileReleaseRisk(changedFiles);
  if ((PROFILE_RANK[record.validationProfile?.tier] ?? -1) < PROFILE_RANK[risk.minimumProfile]) {
    errors.push(`validation profile ${record.validationProfile?.tier || '<unset>'} is below computed minimum ${risk.minimumProfile}: ${risk.reason}`);
  }
  for (const flow of risk.requiredFlows) {
    if (!record.coreFlows?.[flow]) errors.push(`computed risk requires missing flow: ${flow}`);
  }
  return { errors, risk, acceptanceFile };
}

function runAcceptanceCheck(file) {
  return spawnSync(process.execPath, [path.join(scriptDir, 'release-acceptance.mjs'), 'check', '--file', file, '--stage', 'candidate'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function selfTest() {
  const fixture = path.resolve(process.argv[1]);
  const record = {
    distribution: 'google-android', version: '1.2.3', build: '123', baselineCommit: 'HEAD', sourceCommit: 'HEAD',
    artifact: { pathOrId: fixture, sha256: sha256(fixture) },
    validationProfile: { tier: 'focused' }, coreFlows: {},
  };
  const result = validatePrepublish({
    record, acceptanceFile: 'fixture', artifact: fixture, distribution: 'google-android',
    expectedVersion: '1.2.3', expectedBuild: '123', changedFiles: ['apps/mobile/package.json'],
  });
  if (!result.errors.some((error) => error.includes('below computed minimum'))) throw new Error('risk downgrade was not rejected');
  console.log('release-prepublish-gate self-test passed');
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test') selfTest();
else if (command === 'check') {
  if (!options.acceptance || !options.artifact || !options.distribution || !options.version || !options.build) {
    fail('check requires --acceptance, --artifact, --distribution, --version, and --build');
  }
  if (!EXTENSIONS[options.distribution]) fail(`Unknown distribution: ${options.distribution}`);
  const acceptanceFile = path.resolve(options.acceptance);
  if (!fs.existsSync(acceptanceFile)) fail(`Acceptance record not found: ${acceptanceFile}`);
  const artifact = path.resolve(options.artifact);
  const record = JSON.parse(fs.readFileSync(acceptanceFile, 'utf8'));
  const acceptance = runAcceptanceCheck(acceptanceFile);
  if (acceptance.status !== 0) fail((acceptance.stderr || acceptance.stdout || 'candidate acceptance failed').trim());
  let changedFiles;
  try {
    changedFiles = changedFilesBetween(repoRoot, record.baselineCommit, record.sourceCommit);
  } catch (error) {
    fail(error.message);
  }
  const result = validatePrepublish({
    record, acceptanceFile, artifact, distribution: options.distribution,
    expectedVersion: options.version, expectedBuild: options.build, changedFiles,
  });
  if (result.errors.length > 0) fail(result.errors.join('\n'));
  console.log(`Prepublish gate passed: ${options.distribution} ${record.version} (${record.build})`);
  console.log(`Computed risk: ${result.risk.minimumProfile} — ${result.risk.reason}`);
} else fail('Usage: release-prepublish-gate.mjs check --acceptance <record> --artifact <file> --distribution <name> --version <version> --build <build> | self-test');
