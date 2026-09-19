#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const DISTRIBUTIONS = new Set(['ios', 'google-android', 'china-android']);
const CHECK_RESULTS = new Set(['pending', 'passed', 'not-applicable']);

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
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireText(errors, value, field) {
  if (!hasText(value)) errors.push(`${field} is required`);
}

function validateCheck(errors, check, field) {
  if (!CHECK_RESULTS.has(check?.result)) {
    errors.push(`${field}.result must be pending, passed, or not-applicable`);
    return;
  }
  if (check.result === 'pending') errors.push(`${field} is still pending`);
  if (check.result === 'not-applicable' && !hasText(check.reason)) {
    errors.push(`${field}.reason is required when not-applicable`);
  }
  if (check.result === 'passed' && !hasText(check.evidence)) {
    errors.push(`${field}.evidence is required when passed`);
  }
}

function readStartupReceipt(record) {
  if (!hasText(record?.startupGate?.receipt)) return null;
  const receiptPath = path.resolve(record.startupGate.receipt);
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

function validateStartupReceipt(errors, record, receipt) {
  if (!receipt) {
    errors.push('startupGate.receipt must point to an existing smoke receipt');
    return;
  }
  if (receipt.status !== 'passed') errors.push('startup smoke receipt status must be passed');
  if (receipt.commit !== record?.sourceCommit) errors.push('startup smoke receipt commit must match sourceCommit');
  for (const target of ['ios26', 'ios27', 'android']) {
    if ((receipt.targets?.[target]?.launches || 0) < 2) {
      errors.push(`startup smoke receipt requires two launches for ${target}`);
    }
  }
}

function validate(record, stage, receiptOverride) {
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!DISTRIBUTIONS.has(record?.distribution)) errors.push(`distribution must be one of: ${[...DISTRIBUTIONS].join(', ')}`);
  requireText(errors, record?.version, 'version');
  requireText(errors, record?.build, 'build');
  requireText(errors, record?.runtimeVersion, 'runtimeVersion');
  requireText(errors, record?.sourceCommit, 'sourceCommit');
  requireText(errors, record?.artifact?.pathOrId, 'artifact.pathOrId');
  requireText(errors, record?.artifact?.sha256, 'artifact.sha256');
  if (hasText(record?.artifact?.sha256) && !/^[a-f0-9]{64}$/i.test(record.artifact.sha256)) {
    errors.push('artifact.sha256 must be a 64-character hexadecimal SHA-256');
  }
  if (record?.startupGate?.passed !== true) errors.push('startupGate.passed must be true');
  requireText(errors, record?.startupGate?.receipt, 'startupGate.receipt');
  validateStartupReceipt(errors, record, receiptOverride || readStartupReceipt(record));

  for (const [name, check] of Object.entries(record?.coreFlows || {})) {
    validateCheck(errors, check, `coreFlows.${name}`);
  }
  const requiredFlows = ['coldStart', 'login', 'cardOpen', 'cardCreation', 'rewrite', 'playback', 'subscriptionManagement', 'updateDelivery'];
  for (const name of requiredFlows) {
    if (!record?.coreFlows?.[name]) errors.push(`coreFlows.${name} is required`);
  }

  if (stage === 'prepublish') return errors;

  if (record?.delivery?.state !== 'live') errors.push('delivery.state must be live');
  requireText(errors, record?.delivery?.installSource, 'delivery.installSource');
  requireText(errors, record?.delivery?.externalIdOrUrl, 'delivery.externalIdOrUrl');
  if (record?.postRelease?.installedVersion !== record?.version) errors.push('postRelease.installedVersion must match version');
  if (record?.postRelease?.installedBuild !== record?.build) errors.push('postRelease.installedBuild must match build');
  requireText(errors, record?.postRelease?.checkedAt, 'postRelease.checkedAt');
  if (!Array.isArray(record?.postRelease?.evidence) || record.postRelease.evidence.filter(hasText).length === 0) {
    errors.push('postRelease.evidence needs at least one entry');
  }

  if (record?.distribution === 'china-android') {
    requireText(errors, record?.chinaPublication?.appVersionEndpoint, 'chinaPublication.appVersionEndpoint');
    requireText(errors, record?.chinaPublication?.publicDownloadUrl, 'chinaPublication.publicDownloadUrl');
    requireText(errors, record?.chinaPublication?.downloadedSha256, 'chinaPublication.downloadedSha256');
    if (hasText(record?.artifact?.sha256) && record.artifact.sha256 !== record?.chinaPublication?.downloadedSha256) {
      errors.push('China public download SHA-256 does not match artifact.sha256');
    }
    if (record?.chinaPublication?.endpointVersion !== record?.version) {
      errors.push('chinaPublication.endpointVersion must match version');
    }
  }

  return errors;
}

function pendingCheck() {
  return { result: 'pending', evidence: '', reason: '' };
}

function fileSha256(file) {
  if (!hasText(file) || !fs.existsSync(path.resolve(file))) return '';
  return createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}

function receiptPassesForCommit(receiptPath, commit) {
  if (!hasText(receiptPath) || !fs.existsSync(path.resolve(receiptPath))) return false;
  const receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
  return receipt.status === 'passed'
    && receipt.commit === commit
    && ['ios26', 'ios27', 'android'].every((target) => (receipt.targets?.[target]?.launches || 0) >= 2);
}

function newRecord(options) {
  if (!DISTRIBUTIONS.has(options.distribution)) fail(`Invalid --distribution: ${options.distribution || ''}`);
  const receipt = options.receipt || '.tmp/release-smoke/latest.json';
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    distribution: options.distribution,
    version: options.version || '',
    build: options.build || '',
    runtimeVersion: options.runtime || '',
    sourceCommit: options.commit || '',
    artifact: {
      pathOrId: options.artifact || '',
      sha256: options.sha256 || fileSha256(options.artifact),
    },
    startupGate: {
      passed: receiptPassesForCommit(receipt, options.commit),
      receipt,
    },
    coreFlows: {
      coldStart: pendingCheck(),
      login: pendingCheck(),
      cardOpen: pendingCheck(),
      cardCreation: pendingCheck(),
      rewrite: pendingCheck(),
      playback: pendingCheck(),
      subscriptionManagement: pendingCheck(),
      updateDelivery: pendingCheck(),
    },
    delivery: {
      state: 'local',
      installSource: '',
      externalIdOrUrl: '',
    },
    postRelease: {
      installedVersion: '',
      installedBuild: '',
      checkedAt: '',
      evidence: [],
    },
    chinaPublication: {
      appVersionEndpoint: '',
      endpointVersion: '',
      publicDownloadUrl: '',
      downloadedSha256: '',
    },
  };
}

function selfTest() {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const record = newRecord({
    distribution: 'china-android',
    version: '1.2.3',
    build: '123',
    runtime: '1.2.3',
    commit,
    artifact: 'OIO-1.2.3-123.apk',
    sha256: 'a'.repeat(64),
  });
  const receipt = {
    status: 'passed',
    commit,
    targets: {
      ios26: { launches: 2 },
      ios27: { launches: 2 },
      android: { launches: 2 },
    },
  };
  if (validate(record, 'prepublish', receipt).length < 8) throw new Error('prepublish validation accepted pending checks');
  for (const check of Object.values(record.coreFlows)) {
    check.result = 'passed';
    check.evidence = 'manual test receipt';
  }
  record.startupGate.passed = true;
  if (validate(record, 'prepublish', receipt).length !== 0) throw new Error('prepublish validation rejected a complete record');
  record.delivery = { state: 'live', installSource: 'public URL', externalIdOrUrl: 'https://example.test/app.apk' };
  record.postRelease = {
    installedVersion: record.version,
    installedBuild: record.build,
    checkedAt: new Date().toISOString(),
    evidence: ['installed and opened'],
  };
  record.chinaPublication = {
    appVersionEndpoint: 'https://example.test/app/version',
    endpointVersion: record.version,
    publicDownloadUrl: 'https://example.test/app.apk',
    downloadedSha256: record.artifact.sha256,
  };
  if (validate(record, 'live', receipt).length !== 0) throw new Error('live validation rejected a complete record');
  record.chinaPublication.downloadedSha256 = 'b'.repeat(64);
  if (!validate(record, 'live', receipt).some((error) => error.includes('does not match'))) {
    throw new Error('live validation accepted a mismatched China APK');
  }
  console.log('release-acceptance self-test passed');
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test') {
  selfTest();
  process.exit(0);
}

if (command === 'init') {
  if (!options.output) fail('--output is required');
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) fail(`Refusing to overwrite existing acceptance record: ${output}`);
  const record = newRecord(options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(output);
  process.exit(0);
}

if (command === 'check') {
  if (!options.file) fail('--file is required');
  const stage = options.stage || 'prepublish';
  if (!['prepublish', 'live'].includes(stage)) fail(`Invalid --stage: ${stage}`);
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  const errors = validate(record, stage);
  if (errors.length > 0) fail(errors.join('\n'));
  console.log(`Release acceptance passed stage=${stage}: ${record.distribution} ${record.version} (${record.build})`);
  process.exit(0);
}

fail('Usage: release-acceptance.mjs init --output <file> --distribution ios|google-android|china-android --version <version> --build <build> --runtime <runtime> --commit <sha> --artifact <path-or-id> [--sha256 <sha>] [--receipt <smoke-receipt>] | check --file <file> --stage prepublish|live | self-test');
