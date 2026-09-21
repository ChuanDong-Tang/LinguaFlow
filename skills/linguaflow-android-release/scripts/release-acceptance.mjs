#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import {
  ALL_DEVICE_TARGETS,
  RELEASE_CORE_FLOWS,
  releaseTargetsForDistribution,
} from './mobile-release-risk.mjs';

const DISTRIBUTIONS = new Set(['ios', 'google-android', 'china-android']);
const CHECK_RESULTS = new Set(['pending', 'passed', 'not-applicable']);
const VALIDATION_PROFILES = new Set(['focused', 'affected-flow', 'release-core']);
const RELEASE_CORE_REQUIRED_FLOWS = ['coldStart', 'login', 'cardOpen', ...RELEASE_CORE_FLOWS];

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

function splitCsv(value) {
  return (value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function requireText(errors, value, field) {
  if (!hasText(value)) errors.push(`${field} is required`);
}

function requireEvidence(errors, value, field) {
  if (!Array.isArray(value) || value.filter(hasText).length === 0) errors.push(`${field} needs at least one entry`);
}

function validateCheck(errors, check, field, requiredTargets = []) {
  if (!CHECK_RESULTS.has(check?.result)) {
    errors.push(`${field}.result must be pending, passed, or not-applicable`);
    return;
  }
  if (check.result === 'pending') errors.push(`${field} is still pending`);
  if (check.result === 'not-applicable') {
    if (requiredTargets.length > 0) errors.push(`${field} is required and cannot be not-applicable`);
    if (!hasText(check.reason)) errors.push(`${field}.reason is required when not-applicable`);
    return;
  }
  if (!hasText(check.evidence)) errors.push(`${field}.evidence is required when passed`);
  const observedTargets = new Set(Array.isArray(check.targets) ? check.targets : []);
  for (const target of requiredTargets) {
    if (!observedTargets.has(target)) errors.push(`${field}.targets must include ${target}`);
  }
}

function readStartupReceipt(record) {
  if (!hasText(record?.startupGate?.receipt)) return null;
  const receiptPath = path.resolve(record.startupGate.receipt);
  if (!fs.existsSync(receiptPath)) return null;
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

function validateStartupReceipt(errors, record, receipt, requiredTargets) {
  if (!receipt) {
    errors.push('startupGate.receipt must point to an existing smoke receipt');
    return;
  }
  if (receipt.status !== 'passed') errors.push('startup smoke receipt status must be passed');
  if (receipt.schemaVersion !== 2) errors.push('startup smoke receipt must use sequential schemaVersion 2');
  if (receipt.commit !== record?.sourceCommit) errors.push('startup smoke receipt commit must match sourceCommit');
  if (receipt.execution?.strategy !== 'sequential' || receipt.execution?.maxConcurrentDevices !== 1) {
    errors.push('startup smoke receipt must prove sequential execution with one active device');
  }
  for (const target of requiredTargets) {
    if ((receipt.targets?.[target]?.launches || 0) < 2) errors.push(`startup smoke receipt requires two launches for ${target}`);
  }
}

function requiredFlows(record) {
  return record?.validationProfile?.tier === 'release-core'
    ? RELEASE_CORE_REQUIRED_FLOWS
    : record?.validationProfile?.impactedFlows || [];
}

function validate(record, stage, receiptOverride) {
  const errors = [];
  if (record?.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (!DISTRIBUTIONS.has(record?.distribution)) errors.push(`distribution must be one of: ${[...DISTRIBUTIONS].join(', ')}`);
  requireText(errors, record?.version, 'version');
  requireText(errors, record?.build, 'build');
  requireText(errors, record?.runtimeVersion, 'runtimeVersion');
  requireText(errors, record?.baselineCommit, 'baselineCommit');
  requireText(errors, record?.sourceCommit, 'sourceCommit');
  requireText(errors, record?.artifact?.pathOrId, 'artifact.pathOrId');
  requireText(errors, record?.artifact?.sha256, 'artifact.sha256');
  if (hasText(record?.artifact?.sha256) && !/^[a-f0-9]{64}$/iu.test(record.artifact.sha256)) {
    errors.push('artifact.sha256 must be a 64-character hexadecimal SHA-256');
  }
  if (record?.startupGate?.passed !== true) errors.push('startupGate.passed must be true');
  requireText(errors, record?.startupGate?.receipt, 'startupGate.receipt');
  const distributionTargets = releaseTargetsForDistribution(record?.distribution);
  validateStartupReceipt(errors, record, receiptOverride || readStartupReceipt(record), distributionTargets);

  if (!VALIDATION_PROFILES.has(record?.validationProfile?.tier)) {
    errors.push(`validationProfile.tier must be one of: ${[...VALIDATION_PROFILES].join(', ')}`);
  }
  requireText(errors, record?.validationProfile?.reason, 'validationProfile.reason');
  const targets = record?.validationProfile?.tier === 'release-core'
    ? distributionTargets
    : record?.validationProfile?.targets || [];
  if (record?.validationProfile?.tier !== 'release-core') {
    if (requiredFlows(record).filter(hasText).length === 0) errors.push('validationProfile.impactedFlows needs at least one entry');
    if (targets.filter(hasText).length === 0) errors.push('validationProfile.targets needs at least one entry');
  }
  if (record?.candidateVerification?.result !== 'passed') errors.push('candidateVerification.result must be passed');
  if (record?.candidateVerification?.artifactSha256 !== record?.artifact?.sha256) {
    errors.push('candidateVerification.artifactSha256 must match artifact.sha256');
  }
  requireText(errors, record?.candidateVerification?.checkedAt, 'candidateVerification.checkedAt');
  requireEvidence(errors, record?.candidateVerification?.evidence, 'candidateVerification.evidence');
  if (stage === 'candidate' || stage === 'prepublish') return errors;

  if (record?.canary?.state !== 'verified') errors.push('canary.state must be verified before promotion');
  requireText(errors, record?.canary?.installSource, 'canary.installSource');
  requireText(errors, record?.canary?.externalIdOrUrl, 'canary.externalIdOrUrl');
  if (record?.canary?.installedVersion !== record?.version) errors.push('canary.installedVersion must match version');
  if (record?.canary?.installedBuild !== record?.build) errors.push('canary.installedBuild must match build');
  requireText(errors, record?.canary?.checkedAt, 'canary.checkedAt');
  requireEvidence(errors, record?.canary?.evidence, 'canary.evidence');
  for (const name of requiredFlows(record)) {
    validateCheck(errors, record?.canary?.flowEvidence?.[name], `canary.flowEvidence.${name}`, targets);
  }
  if (stage === 'promote') return errors;

  if (record?.delivery?.state !== 'live') errors.push('delivery.state must be live');
  requireText(errors, record?.delivery?.installSource, 'delivery.installSource');
  requireText(errors, record?.delivery?.externalIdOrUrl, 'delivery.externalIdOrUrl');
  if (record?.postRelease?.installedVersion !== record?.version) errors.push('postRelease.installedVersion must match version');
  if (record?.postRelease?.installedBuild !== record?.build) errors.push('postRelease.installedBuild must match build');
  requireText(errors, record?.postRelease?.checkedAt, 'postRelease.checkedAt');
  requireEvidence(errors, record?.postRelease?.evidence, 'postRelease.evidence');
  if (record?.distribution === 'china-android') {
    requireText(errors, record?.chinaPublication?.appVersionEndpoint, 'chinaPublication.appVersionEndpoint');
    requireText(errors, record?.chinaPublication?.publicDownloadUrl, 'chinaPublication.publicDownloadUrl');
    requireText(errors, record?.chinaPublication?.downloadedSha256, 'chinaPublication.downloadedSha256');
    if (hasText(record?.artifact?.sha256) && record.artifact.sha256 !== record?.chinaPublication?.downloadedSha256) {
      errors.push('China public download SHA-256 does not match artifact.sha256');
    }
    if (record?.chinaPublication?.endpointVersion !== record?.version) errors.push('chinaPublication.endpointVersion must match version');
  }
  return errors;
}

function pendingCheck() {
  return { result: 'pending', evidence: '', reason: '', targets: [] };
}

function fileSha256(file) {
  if (!hasText(file) || !fs.existsSync(path.resolve(file))) return '';
  return createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
}

function receiptPassesForCommit(receiptPath, commit, distribution) {
  if (!hasText(receiptPath) || !fs.existsSync(path.resolve(receiptPath))) return false;
  const receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), 'utf8'));
  return receipt.status === 'passed' && receipt.schemaVersion === 2 && receipt.commit === commit
    && receipt.execution?.strategy === 'sequential' && receipt.execution?.maxConcurrentDevices === 1
    && releaseTargetsForDistribution(distribution).every((target) => (receipt.targets?.[target]?.launches || 0) >= 2);
}

function newRecord(options) {
  if (!DISTRIBUTIONS.has(options.distribution)) fail(`Invalid --distribution: ${options.distribution || ''}`);
  const tier = options.profile || 'release-core';
  if (!VALIDATION_PROFILES.has(tier)) fail(`Invalid --profile: ${tier}`);
  if (!hasText(options.baseline)) fail('--baseline is required');
  const impactedFlows = splitCsv(options.flows);
  if (tier !== 'release-core' && impactedFlows.length === 0) fail('--flows is required for focused or affected-flow profiles');
  const targets = tier === 'release-core' ? releaseTargetsForDistribution(options.distribution) : splitCsv(options.targets);
  if (tier !== 'release-core' && targets.length === 0) fail('--targets is required for focused or affected-flow profiles');
  const flows = tier === 'release-core' ? RELEASE_CORE_REQUIRED_FLOWS : impactedFlows;
  const receipt = options.receipt || `.tmp/release-smoke/${options.distribution === 'ios' ? 'ios' : 'android'}.json`;
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    distribution: options.distribution,
    version: options.version || '',
    build: options.build || '',
    runtimeVersion: options.runtime || '',
    baselineCommit: options.baseline,
    sourceCommit: options.commit || '',
    artifact: { pathOrId: options.artifact || '', sha256: options.sha256 || fileSha256(options.artifact) },
    startupGate: { passed: receiptPassesForCommit(receipt, options.commit, options.distribution), receipt },
    validationProfile: {
      tier,
      reason: options.reason || (tier === 'release-core' ? 'Core or broad native release validation' : ''),
      impactedFlows,
      targets,
    },
    coreFlows: Object.fromEntries(flows.map((name) => [name, pendingCheck()])),
    candidateVerification: { result: 'pending', artifactSha256: '', checkedAt: '', evidence: [] },
    canary: {
      state: 'not-uploaded', installSource: '', externalIdOrUrl: '', installedVersion: '', installedBuild: '', checkedAt: '', evidence: [],
      flowEvidence: Object.fromEntries(flows.map((name) => [name, pendingCheck()])),
    },
    delivery: { state: 'local', installSource: '', externalIdOrUrl: '' },
    postRelease: { installedVersion: '', installedBuild: '', checkedAt: '', evidence: [] },
    chinaPublication: { appVersionEndpoint: '', endpointVersion: '', publicDownloadUrl: '', downloadedSha256: '' },
  };
}

function writeRecord(file, record) {
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(record, null, 2)}\n`);
}

function selfTest() {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const record = newRecord({
    distribution: 'china-android', version: '1.2.3', build: '123', runtime: '1.2.3',
    baseline: 'fedcba9876543210fedcba9876543210fedcba98', commit,
    artifact: 'OIO-1.2.3-123.apk', sha256: 'a'.repeat(64), profile: 'release-core',
  });
  const receipt = {
    schemaVersion: 2, status: 'passed', commit,
    execution: { strategy: 'sequential', maxConcurrentDevices: 1, shutdownAfterEachTarget: true },
    targets: { ios26: { launches: 2 }, ios27: { launches: 2 }, android: { launches: 2 } },
  };
  if (!validate(record, 'candidate', receipt).some((error) => error.includes('candidateVerification'))) {
    throw new Error('candidate validation accepted an unverified artifact');
  }
  record.startupGate.passed = true;
  record.candidateVerification = {
    result: 'passed', artifactSha256: record.artifact.sha256,
    checkedAt: new Date().toISOString(), evidence: ['artifact-bound candidate checks'],
  };
  const candidateErrors = validate(record, 'candidate', receipt);
  if (candidateErrors.length !== 0) throw new Error(`candidate rejected: ${candidateErrors.join('; ')}`);
  if (!validate(record, 'promote', receipt).some((error) => error.includes('canary'))) throw new Error('promotion accepted an unverified canary');
  record.canary = {
    state: 'verified', installSource: 'private candidate URL', externalIdOrUrl: 'https://example.test/candidate.apk',
    installedVersion: record.version, installedBuild: record.build,
    checkedAt: new Date().toISOString(), evidence: ['fresh candidate install passed'],
    flowEvidence: Object.fromEntries(Object.keys(record.coreFlows).map((name) => [name, pendingCheck()])),
  };
  if (!validate(record, 'promote', receipt).some((error) => error.includes('canary.flowEvidence'))) {
    throw new Error('promotion accepted canary without exact-package flow evidence');
  }
  record.canary.flowEvidence = Object.fromEntries(Object.keys(record.coreFlows).map((name) => [name, ({
    result: 'passed', evidence: `canary observed ${name}`, reason: '',
    targets: releaseTargetsForDistribution(record.distribution),
  })]));
  if (validate(record, 'promote', receipt).length !== 0) throw new Error('promotion rejected verified canary');
  record.delivery = { state: 'live', installSource: 'public URL', externalIdOrUrl: 'https://example.test/app.apk' };
  record.postRelease = {
    installedVersion: record.version, installedBuild: record.build,
    checkedAt: new Date().toISOString(), evidence: ['fresh public install passed'],
  };
  record.chinaPublication = {
    appVersionEndpoint: 'https://example.test/app/version', endpointVersion: record.version,
    publicDownloadUrl: 'https://example.test/app.apk', downloadedSha256: record.artifact.sha256,
  };
  if (validate(record, 'live', receipt).length !== 0) throw new Error('live rejected complete record');
  record.chinaPublication.downloadedSha256 = 'b'.repeat(64);
  if (!validate(record, 'live', receipt).some((error) => error.includes('does not match'))) throw new Error('live accepted mismatched China APK');

  const iosRecord = newRecord({
    distribution: 'ios', version: '1.2.3', build: '124', runtime: '1.2.3',
    baseline: 'fedcba9876543210fedcba9876543210fedcba98', commit,
    artifact: 'OIO-1.2.3-124.ipa', sha256: 'c'.repeat(64), profile: 'release-core',
  });
  if (iosRecord.validationProfile.targets.join(',') !== 'ios26,ios27') {
    throw new Error('iOS acceptance did not scope validation to iOS targets');
  }
  if (record.validationProfile.targets.join(',') !== 'android') {
    throw new Error('Android acceptance did not scope validation to Android');
  }
  console.log('release-acceptance self-test passed');
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test') selfTest();
else if (command === 'init') {
  if (!options.output) fail('--output is required');
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) fail(`Refusing to overwrite existing acceptance record: ${output}`);
  const record = newRecord(options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeRecord(output, record);
  console.log(output);
} else if (command === 'pass-flow') {
  if (!options.file || !options.flow || !options.evidence || !options.targets) fail('pass-flow requires --file, --flow, --targets, and --evidence');
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  if (!record.coreFlows?.[options.flow]) fail(`Unknown required flow: ${options.flow}`);
  record.coreFlows[options.flow] = { result: 'passed', evidence: options.evidence, reason: '', targets: splitCsv(options.targets) };
  writeRecord(options.file, record);
  console.log(`Recorded flow ${options.flow}`);
} else if (command === 'pass-candidate') {
  if (!options.file || !options.evidence) fail('pass-candidate requires --file and --evidence');
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  record.candidateVerification = {
    result: 'passed', artifactSha256: fileSha256(record.artifact.pathOrId),
    checkedAt: new Date().toISOString(), evidence: [options.evidence],
  };
  writeRecord(options.file, record);
  console.log('Recorded candidate verification');
} else if (command === 'verify-canary') {
  if (!options.file || !options.source || !options.external || !options.evidence) fail('verify-canary requires --file, --source, --external, and --evidence');
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  record.canary = {
    state: 'verified', installSource: options.source, externalIdOrUrl: options.external,
    installedVersion: record.version, installedBuild: record.build,
    checkedAt: new Date().toISOString(), evidence: [options.evidence],
    flowEvidence: record.canary?.flowEvidence || {},
  };
  writeRecord(options.file, record);
  console.log('Recorded canary verification');
} else if (command === 'pass-canary-flow') {
  if (!options.file || !options.flow || !options.evidence || !options.targets) {
    fail('pass-canary-flow requires --file, --flow, --targets, and --evidence');
  }
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  if (!record.canary?.flowEvidence || !(options.flow in record.canary.flowEvidence)) fail(`Unknown required canary flow: ${options.flow}`);
  record.canary.flowEvidence[options.flow] = {
    result: 'passed', evidence: options.evidence, reason: '', targets: splitCsv(options.targets),
  };
  writeRecord(options.file, record);
  console.log(`Recorded canary flow ${options.flow}`);
} else if (command === 'check') {
  if (!options.file) fail('--file is required');
  const stage = options.stage || 'candidate';
  if (!['candidate', 'prepublish', 'promote', 'live'].includes(stage)) fail(`Invalid --stage: ${stage}`);
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  const errors = validate(record, stage);
  if (errors.length > 0) fail(errors.join('\n'));
  console.log(`Release acceptance passed stage=${stage}: ${record.distribution} ${record.version} (${record.build})`);
} else fail('Usage: release-acceptance.mjs init|pass-flow|pass-candidate|pass-canary-flow|verify-canary|check|self-test');
