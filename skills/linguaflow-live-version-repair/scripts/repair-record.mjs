#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCOPES = new Set(['unknown', 'ios', 'google-android', 'china-android', 'backend', 'cross-platform']);
const LANES = new Set(['unknown', 'backend', 'targeted-data', 'ota', 'native-release', 'provider-reconciliation']);
const STAGES = new Set(['intake', 'rollout', 'close']);

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
    if (key === 'self-test') {
      options.selfTest = true;
      continue;
    }
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

function requireEvidence(errors, value, field) {
  if (!Array.isArray(value) || value.filter(hasText).length === 0) {
    errors.push(`${field} needs at least one evidence entry`);
  }
}

function validate(record, stage) {
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  requireText(errors, record?.id, 'id');
  requireText(errors, record?.createdAt, 'createdAt');
  requireText(errors, record?.report?.symptom, 'report.symptom');
  requireText(errors, record?.report?.expectedBehavior, 'report.expectedBehavior');

  const scope = record?.affectedRelease?.scope;
  if (!SCOPES.has(scope)) errors.push(`affectedRelease.scope must be one of: ${[...SCOPES].join(', ')}`);

  if (stage === 'intake') return errors;

  if (scope === 'unknown') errors.push('affectedRelease.scope must be resolved before rollout');
  if (['ios', 'google-android', 'china-android'].includes(scope)) {
    requireText(errors, record?.affectedRelease?.version, 'affectedRelease.version');
    requireText(errors, record?.affectedRelease?.build, 'affectedRelease.build');
    requireText(errors, record?.affectedRelease?.runtimeVersion, 'affectedRelease.runtimeVersion');
    requireText(errors, record?.affectedRelease?.otaChannel, 'affectedRelease.otaChannel');
  }
  if (!['reproduced', 'bounded-not-reproduced'].includes(record?.reproduction?.status)) {
    errors.push('reproduction.status must be reproduced or bounded-not-reproduced before rollout');
  }
  requireEvidence(errors, record?.reproduction?.evidence, 'reproduction.evidence');
  requireText(errors, record?.diagnosis?.rootCause, 'diagnosis.rootCause');
  requireText(errors, record?.diagnosis?.affectedPopulation, 'diagnosis.affectedPopulation');
  if (!LANES.has(record?.diagnosis?.lane) || record?.diagnosis?.lane === 'unknown') {
    errors.push(`diagnosis.lane must be resolved to one of: ${[...LANES].filter((lane) => lane !== 'unknown').join(', ')}`);
  }
  requireText(errors, record?.repair?.sourceCommit, 'repair.sourceCommit');
  requireEvidence(errors, record?.repair?.validationEvidence, 'repair.validationEvidence');
  if (record?.rollout?.authorizedByUser !== true) errors.push('rollout.authorizedByUser must be true');
  requireText(errors, record?.rollout?.target, 'rollout.target');
  requireText(errors, record?.rollout?.stopOrRollback, 'rollout.stopOrRollback');

  if (record?.diagnosis?.lane === 'ota') {
    requireText(errors, record?.repair?.activeBranchCommit, 'repair.activeBranchCommit');
    if (record?.repair?.forwardPortVerified !== true) errors.push('repair.forwardPortVerified must be true for OTA');
  }

  if (stage === 'rollout') return errors;

  if (!['deployed', 'published', 'repaired'].includes(record?.rollout?.state)) {
    errors.push('rollout.state must be deployed, published, or repaired before close');
  }
  requireText(errors, record?.rollout?.completedAt, 'rollout.completedAt');
  requireText(errors, record?.rollout?.externalIdOrCommit, 'rollout.externalIdOrCommit');
  if (record?.verification?.originalFlowPassed !== true) errors.push('verification.originalFlowPassed must be true');
  requireText(errors, record?.verification?.checkedAt, 'verification.checkedAt');
  requireEvidence(errors, record?.verification?.evidence, 'verification.evidence');

  if (scope === 'china-android') {
    requireText(errors, record?.verification?.chinaApk?.publicDownloadUrl, 'verification.chinaApk.publicDownloadUrl');
    requireText(errors, record?.verification?.chinaApk?.expectedSha256, 'verification.chinaApk.expectedSha256');
    requireText(errors, record?.verification?.chinaApk?.downloadedSha256, 'verification.chinaApk.downloadedSha256');
    if (hasText(record?.verification?.chinaApk?.expectedSha256)
      && record.verification.chinaApk.expectedSha256 !== record.verification.chinaApk.downloadedSha256) {
      errors.push('China APK downloaded SHA-256 does not match the validated artifact');
    }
  }

  return errors;
}

function newRecord(options) {
  const now = new Date().toISOString();
  const scope = options.scope || 'unknown';
  if (!SCOPES.has(scope)) fail(`Invalid --scope: ${scope}`);
  return {
    schemaVersion: 1,
    id: options.id || `repair-${now.replaceAll(/[:.]/g, '-')}`,
    createdAt: now,
    status: 'intake',
    report: {
      symptom: options.symptom || '',
      expectedBehavior: options.expected || '',
      accountOrObjectIds: [],
      occurredAt: '',
      source: '',
    },
    affectedRelease: {
      scope,
      version: options.version || '',
      build: options.build || '',
      runtimeVersion: options.runtime || '',
      otaChannel: options.channel || '',
      backendCommit: '',
    },
    reproduction: {
      status: 'unknown',
      coldStartChecked: false,
      latestOtaChecked: false,
      evidence: [],
    },
    diagnosis: {
      rootCause: '',
      affectedPopulation: '',
      lane: 'unknown',
    },
    repair: {
      sourceCommit: '',
      activeBranchCommit: '',
      forwardPortVerified: false,
      regressionTest: '',
      validationEvidence: [],
    },
    rollout: {
      authorizedByUser: false,
      target: '',
      stopOrRollback: '',
      state: 'not-started',
      completedAt: '',
      externalIdOrCommit: '',
    },
    verification: {
      originalFlowPassed: false,
      checkedAt: '',
      evidence: [],
      chinaApk: {
        publicDownloadUrl: '',
        expectedSha256: '',
        downloadedSha256: '',
      },
    },
  };
}

function selfTest() {
  const record = newRecord({ scope: 'ios', symptom: 'App crashes at startup', expected: 'App opens' });
  const intakeErrors = validate(record, 'intake');
  if (intakeErrors.length !== 0) throw new Error(`intake self-test failed: ${intakeErrors.join('; ')}`);
  const closeErrors = validate(record, 'close');
  if (closeErrors.length < 8) throw new Error('close validation accepted an incomplete repair');
  record.affectedRelease = {
    scope: 'ios',
    version: '1.2.3',
    build: '123',
    runtimeVersion: '1.2.3',
    otaChannel: 'production',
    backendCommit: '0123456789abcdef',
  };
  record.reproduction = {
    status: 'reproduced',
    coldStartChecked: true,
    latestOtaChecked: true,
    evidence: ['video and device log'],
  };
  record.diagnosis = {
    rootCause: 'Incorrect JavaScript state transition',
    affectedPopulation: 'iOS build 123 on production runtime 1.2.3',
    lane: 'ota',
  };
  record.repair = {
    sourceCommit: '1111111111111111111111111111111111111111',
    activeBranchCommit: '1111111111111111111111111111111111111111',
    forwardPortVerified: true,
    regressionTest: 'state transition regression test',
    validationEvidence: ['test passed on affected binary'],
  };
  record.rollout = {
    authorizedByUser: true,
    target: 'production iOS runtime 1.2.3',
    stopOrRollback: 'repoint channel to previous manifest',
    state: 'published',
    completedAt: new Date().toISOString(),
    externalIdOrCommit: 'update-id',
  };
  record.verification = {
    originalFlowPassed: true,
    checkedAt: new Date().toISOString(),
    evidence: ['affected account completed the flow'],
    chinaApk: { publicDownloadUrl: '', expectedSha256: '', downloadedSha256: '' },
  };
  const completeErrors = validate(record, 'close');
  if (completeErrors.length !== 0) throw new Error(`close self-test failed: ${completeErrors.join('; ')}`);
  console.log('repair-record self-test passed');
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test' || options.selfTest) {
  selfTest();
  process.exit(0);
}

if (command === 'init') {
  if (!options.output) fail('--output is required');
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) fail(`Refusing to overwrite existing repair record: ${output}`);
  const record = newRecord(options);
  const errors = validate(record, 'intake');
  if (errors.length > 0) fail(errors.join('\n'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(output);
  process.exit(0);
}

if (command === 'check') {
  if (!options.file) fail('--file is required');
  const stage = options.stage || 'intake';
  if (!STAGES.has(stage)) fail(`Invalid --stage: ${stage}`);
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  const errors = validate(record, stage);
  if (errors.length > 0) fail(errors.join('\n'));
  console.log(`Repair record passed stage=${stage}: ${record.id}`);
  process.exit(0);
}

fail('Usage: repair-record.mjs init --output <file> --scope <scope> --symptom <text> --expected <text> | check --file <file> --stage intake|rollout|close | self-test');
