#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const TYPES = new Set(['feature', 'behavior-change', 'bug-fix', 'refactor', 'live-incident', 'performance', 'subscription', 'database', 'release', 'maintenance']);
const STATES = ['PLANNED', 'DESIGNED', 'IMPLEMENTED', 'VALIDATED', 'READY_TO_RELEASE', 'RELEASED', 'VERIFIED', 'CLOSED'];
const TERMINAL_STATES = new Set(['local', 'committed', 'pushed', 'deployed', 'published']);
const DISTRIBUTIONS = new Set(['ios', 'google-android', 'china-android']);
const DELIVERY_KINDS = new Set(['none', 'backend', 'database', 'ota', 'native-release', 'china-apk', 'mixed']);
const MOBILE_VALIDATION_PROFILES = new Set(['focused', 'affected-flow', 'release-core']);
const SKILL_ORDER = [
  'linguaflow-production-incident',
  'linguaflow-live-version-repair',
  'linguaflow-feature-delivery',
  'linguaflow-performance-engineering',
  'linguaflow-production-database',
  'linguaflow-subscription-operations',
  'linguaflow-card-ai-pipeline',
  'linguaflow-backend-deploy',
  'linguaflow-app-release',
  'linguaflow-daily-operations',
];

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
    if (key === 'write') {
      options.write = true;
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

function requireList(errors, value, field) {
  if (!Array.isArray(value) || value.filter(hasText).length === 0) errors.push(`${field} needs at least one entry`);
}

function uniqueOrdered(skills) {
  const selected = new Set(skills);
  return SKILL_ORDER.filter((skill) => selected.has(skill));
}

function recommendedSkills(record) {
  const skills = [];
  const type = record?.taskType;
  const scope = record?.scope || {};

  if (['feature', 'behavior-change', 'bug-fix', 'refactor'].includes(type)) skills.push('linguaflow-feature-delivery');
  if (type === 'live-incident') skills.push('linguaflow-production-incident', 'linguaflow-live-version-repair');
  if (type === 'performance') skills.push('linguaflow-performance-engineering');
  if (type === 'subscription') skills.push('linguaflow-subscription-operations');
  if (type === 'database') skills.push('linguaflow-production-database');
  if (type === 'release') skills.push('linguaflow-app-release');
  if (type === 'maintenance') skills.push('linguaflow-daily-operations');

  if (scope.codeChange) skills.push('linguaflow-feature-delivery');
  if (scope.backend || scope.worker) skills.push('linguaflow-backend-deploy');
  if (scope.database) skills.push('linguaflow-production-database');
  if (scope.payment) skills.push('linguaflow-subscription-operations');
  if (scope.cardAi) skills.push('linguaflow-card-ai-pipeline');
  if (scope.performance) skills.push('linguaflow-performance-engineering');
  if (scope.mobile || scope.native || (scope.distributions || []).length > 0) skills.push('linguaflow-app-release');
  return uniqueOrdered(skills);
}

function sameStrings(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function runCheck(script, args) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return (result.stderr || result.stdout || 'linked record check failed').trim();
  return '';
}

function validateLinked(errors, file, script, stage, field, runExternal) {
  requireText(errors, file, field);
  if (!hasText(file) || !runExternal) return;
  const resolved = path.resolve(repoRoot, file);
  if (!fs.existsSync(resolved)) {
    errors.push(`${field} does not exist: ${file}`);
    return;
  }
  const message = runCheck(script, ['check', '--file', resolved, '--stage', stage]);
  if (message) errors.push(`${field} failed ${stage}: ${message}`);
}

function readLinkedRecord(file) {
  if (!hasText(file)) return null;
  const resolved = path.resolve(repoRoot, file);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function validatePlanned(record) {
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  requireText(errors, record?.id, 'id');
  requireText(errors, record?.title, 'title');
  if (!TYPES.has(record?.taskType)) errors.push(`taskType must be one of: ${[...TYPES].join(', ')}`);
  requireText(errors, record?.request?.outcome, 'request.outcome');
  requireList(errors, record?.request?.nonGoals, 'request.nonGoals');
  requireList(errors, record?.request?.acceptanceCriteria, 'request.acceptanceCriteria');
  if (!TERMINAL_STATES.has(record?.request?.requestedTerminalState)) {
    errors.push(`request.requestedTerminalState must be one of: ${[...TERMINAL_STATES].join(', ')}`);
  }
  return errors;
}

function validateDesigned(record, runExternal) {
  const errors = validatePlanned(record);
  requireList(errors, record?.planning?.requirementsEvidence, 'planning.requirementsEvidence');
  requireList(errors, record?.planning?.decisions, 'planning.decisions');
  if (record?.routing?.confirmed !== true) errors.push('routing.confirmed must be true');
  const recommended = recommendedSkills(record);
  if (!sameStrings(record?.routing?.skills, recommended)) {
    errors.push(`routing.skills must match recommended routes: ${recommended.join(', ')}`);
  }
  if (record?.scope?.codeChange) {
    validateLinked(errors, record?.routing?.records?.change, 'skills/linguaflow-feature-delivery/scripts/change-record.mjs', 'ready', 'routing.records.change', runExternal);
  }
  if (record?.taskType === 'live-incident') {
    validateLinked(errors, record?.routing?.records?.repair, 'skills/linguaflow-live-version-repair/scripts/repair-record.mjs', 'diagnosed', 'routing.records.repair', runExternal);
  }
  for (const distribution of record?.scope?.distributions || []) {
    if (!DISTRIBUTIONS.has(distribution)) errors.push(`Unknown distribution: ${distribution}`);
  }
  return errors;
}

function validateImplemented(record, runExternal) {
  const errors = validateDesigned(record, runExternal);
  if (record?.scope?.codeChange) {
    requireText(errors, record?.implementation?.sourceReference, 'implementation.sourceReference');
    if (!['working-tree', 'committed'].includes(record?.implementation?.sourceState)) {
      errors.push('implementation.sourceState must be working-tree or committed');
    }
    requireList(errors, record?.implementation?.changedFiles, 'implementation.changedFiles');
  } else {
    requireList(errors, record?.implementation?.evidence, 'implementation.evidence');
  }
  return errors;
}

function validateSimulatorReceipt(errors, record, runExternal) {
  if (!(record?.scope?.mobile || record?.scope?.native)) return;
  if (!MOBILE_VALIDATION_PROFILES.has(record?.validation?.profile)) {
    errors.push(`validation.profile must be one of: ${[...MOBILE_VALIDATION_PROFILES].join(', ')}`);
    return;
  }
  if (record?.scope?.native && record.validation.profile !== 'release-core') {
    errors.push('native changes require validation.profile=release-core');
  }
  if (record.validation.profile !== 'release-core') return;
  requireText(errors, record?.validation?.simulatorReceipt, 'validation.simulatorReceipt');
  if (hasText(record?.validation?.simulatorReceipt)
    && record.validation.simulatorReceipt !== '.tmp/release-smoke/latest.json') {
    errors.push('validation.simulatorReceipt must use the canonical .tmp/release-smoke/latest.json receipt');
  }
  if (!runExternal || !hasText(record?.validation?.simulatorReceipt)) return;
  const result = spawnSync('bash', ['skills/linguaflow-android-release/scripts/simulator-smoke.sh', '--require'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) errors.push(`three-platform simulator gate failed: ${(result.stderr || result.stdout).trim()}`);
}

function validateValidated(record, runExternal) {
  const errors = validateImplemented(record, runExternal);
  if (record?.validation?.passed !== true) errors.push('validation.passed must be true');
  requireList(errors, record?.validation?.evidence, 'validation.evidence');
  if (record?.scope?.codeChange) {
    validateLinked(errors, record?.routing?.records?.change, 'skills/linguaflow-feature-delivery/scripts/change-record.mjs', 'complete', 'routing.records.change', runExternal);
    if (record?.scope?.mobile || record?.scope?.native) {
      const change = readLinkedRecord(record?.routing?.records?.change);
      if (change && change?.validationPlan?.tier !== record?.validation?.profile) {
        errors.push('validation.profile must match the linked change validationPlan.tier');
      }
    }
  }
  validateSimulatorReceipt(errors, record, runExternal);
  return errors;
}

function validateReadyToRelease(record, runExternal) {
  const errors = validateValidated(record, runExternal);
  if (record?.delivery?.required !== true) errors.push('delivery.required must be true for READY_TO_RELEASE');
  if (!DELIVERY_KINDS.has(record?.delivery?.kind) || record?.delivery?.kind === 'none') {
    errors.push(`delivery.kind must be one of: ${[...DELIVERY_KINDS].filter((kind) => kind !== 'none').join(', ')}`);
  }
  if (record?.delivery?.authorizedByUser !== true) errors.push('delivery.authorizedByUser must be true');
  requireText(errors, record?.delivery?.target, 'delivery.target');
  requireText(errors, record?.delivery?.stopOrRollback, 'delivery.stopOrRollback');

  if (['native-release', 'china-apk'].includes(record?.delivery?.kind)) {
    const acceptanceRecords = record?.routing?.records?.releaseAcceptances || [];
    if (acceptanceRecords.length === 0) errors.push('routing.records.releaseAcceptances needs at least one record');
    for (const [index, file] of acceptanceRecords.entries()) {
      validateLinked(errors, file, 'skills/linguaflow-android-release/scripts/release-acceptance.mjs', 'promote', `routing.records.releaseAcceptances[${index}]`, runExternal);
      const acceptance = readLinkedRecord(file);
      if (acceptance && acceptance?.validationProfile?.tier !== record?.validation?.profile) {
        errors.push(`routing.records.releaseAcceptances[${index}] validation profile must match validation.profile`);
      }
    }
  }
  if (record?.taskType === 'live-incident') {
    validateLinked(errors, record?.routing?.records?.repair, 'skills/linguaflow-live-version-repair/scripts/repair-record.mjs', 'rollout', 'routing.records.repair', runExternal);
  }
  return errors;
}

function validateReleased(record, runExternal) {
  const errors = validateReadyToRelease(record, runExternal);
  if (record?.delivery?.progress !== 'live') errors.push('delivery.progress must be live');
  requireText(errors, record?.delivery?.completedAt, 'delivery.completedAt');
  requireList(errors, record?.delivery?.identifiers, 'delivery.identifiers');
  return errors;
}

function validateVerified(record, runExternal) {
  const errors = record?.delivery?.required ? validateReleased(record, runExternal) : validateValidated(record, runExternal);
  if (record?.verification?.passed !== true) errors.push('verification.passed must be true');
  requireList(errors, record?.verification?.evidence, 'verification.evidence');

  if (record?.taskType === 'live-incident') {
    validateLinked(errors, record?.routing?.records?.repair, 'skills/linguaflow-live-version-repair/scripts/repair-record.mjs', 'close', 'routing.records.repair', runExternal);
  }
  if (record?.delivery?.required && ['native-release', 'china-apk'].includes(record?.delivery?.kind)) {
    for (const [index, file] of (record?.routing?.records?.releaseAcceptances || []).entries()) {
      validateLinked(errors, file, 'skills/linguaflow-android-release/scripts/release-acceptance.mjs', 'live', `routing.records.releaseAcceptances[${index}]`, runExternal);
    }
  }
  return errors;
}

function validateClosed(record, runExternal) {
  const errors = validateVerified(record, runExternal);
  requireText(errors, record?.closure?.summary, 'closure.summary');
  requireList(errors, record?.closure?.remainingRisks, 'closure.remainingRisks');
  if (!TERMINAL_STATES.has(record?.closure?.actualTerminalState)) {
    errors.push(`closure.actualTerminalState must be one of: ${[...TERMINAL_STATES].join(', ')}`);
  }
  if (record?.closure?.actualTerminalState !== record?.request?.requestedTerminalState) {
    requireText(errors, record?.closure?.deferredReason, 'closure.deferredReason');
  }
  return errors;
}

function validateForState(record, state, runExternal = true) {
  switch (state) {
    case 'PLANNED': return validatePlanned(record);
    case 'DESIGNED': return validateDesigned(record, runExternal);
    case 'IMPLEMENTED': return validateImplemented(record, runExternal);
    case 'VALIDATED': return validateValidated(record, runExternal);
    case 'READY_TO_RELEASE': return validateReadyToRelease(record, runExternal);
    case 'RELEASED': return validateReleased(record, runExternal);
    case 'VERIFIED': return validateVerified(record, runExternal);
    case 'CLOSED': return validateClosed(record, runExternal);
    default: return [`Unknown state: ${state}`];
  }
}

function nextStates(record) {
  switch (record.state) {
    case 'PLANNED': return ['DESIGNED'];
    case 'DESIGNED': return ['IMPLEMENTED'];
    case 'IMPLEMENTED': return ['VALIDATED'];
    case 'VALIDATED': return record.delivery.required ? ['READY_TO_RELEASE'] : ['VERIFIED'];
    case 'READY_TO_RELEASE': return ['RELEASED'];
    case 'RELEASED': return ['VERIFIED'];
    case 'VERIFIED': return ['CLOSED'];
    default: return [];
  }
}

function newRecord(options) {
  const now = new Date().toISOString();
  const type = options.type || 'feature';
  if (!TYPES.has(type)) fail(`Invalid --type: ${type}`);
  return {
    schemaVersion: 1,
    id: options.id || `work-${now.replaceAll(/[:.]/g, '-')}`,
    title: options.title || '',
    taskType: type,
    state: 'PLANNED',
    createdAt: now,
    updatedAt: now,
    request: {
      outcome: options.outcome || '',
      nonGoals: [],
      acceptanceCriteria: [],
      requestedTerminalState: 'local',
    },
    scope: {
      codeChange: !['release'].includes(type),
      mobile: false,
      backend: false,
      database: type === 'database',
      worker: false,
      native: false,
      payment: type === 'subscription',
      cardAi: false,
      performance: type === 'performance',
      distributions: [],
    },
    routing: {
      confirmed: false,
      skills: [],
      reason: '',
      records: {
        change: '',
        repair: '',
        releaseAcceptances: [],
      },
    },
    planning: {
      requirementsEvidence: [],
      openQuestions: [],
      decisions: [],
    },
    implementation: {
      sourceState: 'working-tree',
      sourceReference: '',
      changedFiles: [],
      evidence: [],
    },
    validation: {
      profile: '',
      passed: false,
      evidence: [],
      simulatorReceipt: '.tmp/release-smoke/latest.json',
    },
    delivery: {
      required: false,
      kind: 'none',
      authorizedByUser: false,
      target: '',
      stopOrRollback: '',
      progress: 'not-started',
      completedAt: '',
      identifiers: [],
    },
    verification: {
      passed: false,
      evidence: [],
    },
    closure: {
      summary: '',
      actualTerminalState: 'local',
      deferredReason: '',
      remainingRisks: [],
    },
  };
}

function selfTest() {
  const record = newRecord({ type: 'maintenance', title: 'Refresh documentation', outcome: 'Documentation matches runtime' });
  record.scope.codeChange = false;
  record.request.nonGoals = ['No runtime changes'];
  record.request.acceptanceCriteria = ['Relevant documentation is accurate'];
  record.routing.skills = recommendedSkills(record);
  record.routing.confirmed = true;
  record.planning.requirementsEvidence = ['Current docs and runtime inspected'];
  record.planning.decisions = ['Update only stale facts'];
  record.implementation.evidence = ['Documentation updated'];
  record.validation.passed = true;
  record.validation.evidence = ['Links and examples checked'];
  record.verification.passed = true;
  record.verification.evidence = ['Rendered documentation reviewed'];
  record.closure.summary = 'Documentation now matches runtime';
  record.closure.remainingRisks = ['none'];

  for (const state of ['PLANNED', 'DESIGNED', 'IMPLEMENTED', 'VALIDATED', 'VERIFIED', 'CLOSED']) {
    const errors = validateForState(record, state, false);
    if (errors.length !== 0) throw new Error(`${state} self-test failed: ${errors.join('; ')}`);
  }
  record.state = 'VALIDATED';
  if (!sameStrings(nextStates(record), ['VERIFIED'])) throw new Error('non-delivery task did not skip release states');
  record.delivery.required = true;
  if (!sameStrings(nextStates(record), ['READY_TO_RELEASE'])) throw new Error('delivery task skipped release readiness');
  if (!validateForState(record, 'READY_TO_RELEASE', false).some((error) => error.includes('authorizedByUser'))) {
    throw new Error('release readiness accepted missing authorization');
  }

  const mobile = newRecord({ type: 'maintenance', title: 'Mobile check', outcome: 'Validate one interaction' });
  mobile.scope.mobile = true;
  mobile.validation.profile = 'affected-flow';
  mobile.validation.simulatorReceipt = '';
  const affectedErrors = [];
  validateSimulatorReceipt(affectedErrors, mobile, false);
  if (affectedErrors.length !== 0) throw new Error(`affected-flow incorrectly required the full simulator gate: ${affectedErrors.join('; ')}`);
  mobile.scope.native = true;
  const nativeErrors = [];
  validateSimulatorReceipt(nativeErrors, mobile, false);
  if (!nativeErrors.some((error) => error.includes('release-core'))) throw new Error('native work accepted a lower validation profile');
  mobile.validation.profile = 'release-core';
  const coreErrors = [];
  validateSimulatorReceipt(coreErrors, mobile, false);
  if (!coreErrors.some((error) => error.includes('simulatorReceipt'))) throw new Error('release-core accepted missing simulator receipt');
  console.log('work-item self-test passed');
}

function readRecord(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function writeRecord(file, record) {
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(record, null, 2)}\n`);
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test') {
  selfTest();
  process.exit(0);
}

if (command === 'init') {
  if (!options.output) fail('--output is required');
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) fail(`Refusing to overwrite existing work item: ${output}`);
  const record = newRecord(options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(output);
  process.exit(0);
}

if (['route', 'status', 'check', 'advance'].includes(command)) {
  if (!options.file) fail('--file is required');
  const record = readRecord(options.file);

  if (command === 'route') {
    const skills = recommendedSkills(record);
    if (options.write) {
      record.routing.skills = skills;
      record.routing.confirmed = false;
      record.updatedAt = new Date().toISOString();
      writeRecord(options.file, record);
    }
    console.log(JSON.stringify({ skills, written: Boolean(options.write), requiresConfirmation: true }, null, 2));
    process.exit(0);
  }

  if (command === 'status') {
    console.log(JSON.stringify({
      id: record.id,
      title: record.title,
      state: record.state,
      nextStates: nextStates(record),
      requestedTerminalState: record.request?.requestedTerminalState,
      recommendedSkills: recommendedSkills(record),
      recordedSkills: record.routing?.skills || [],
      delivery: record.delivery,
    }, null, 2));
    process.exit(0);
  }

  const targetState = options.state || options.to;
  if (!STATES.includes(targetState)) fail(`Invalid state: ${targetState || ''}`);
  if (command === 'advance' && !nextStates(record).includes(targetState)) {
    fail(`Invalid transition ${record.state} -> ${targetState}; allowed: ${nextStates(record).join(', ') || 'none'}`);
  }
  const errors = validateForState(record, targetState, true);
  if (errors.length > 0) fail(errors.join('\n'));

  if (command === 'advance') {
    record.state = targetState;
    record.updatedAt = new Date().toISOString();
    writeRecord(options.file, record);
    console.log(`Advanced ${record.id} to ${targetState}`);
  } else {
    console.log(`Work item passed state=${targetState}: ${record.id}`);
  }
  process.exit(0);
}

fail('Usage: work-item.mjs init --output <file> --type <type> --title <title> --outcome <outcome> | route --file <file> [--write] | status --file <file> | check --file <file> --state <state> | advance --file <file> --to <state> | self-test');
