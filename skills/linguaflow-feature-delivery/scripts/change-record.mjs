#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CHANGE_TYPES = new Set(['feature', 'behavior-change', 'bug-fix', 'refactor']);
const LAYERS = new Set(['Mobile', 'API', 'Server', 'Core', 'Database', 'Worker', 'Native', 'Provider', 'Website', 'Admin']);
const RISK_KEYS = ['database', 'authentication', 'payment', 'asyncJobs', 'native', 'releasedClients', 'performance'];

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

function requireList(errors, value, field) {
  if (!Array.isArray(value) || value.filter(hasText).length === 0) {
    errors.push(`${field} needs at least one entry`);
  }
}

function validateReady(record) {
  const errors = [];
  if (record?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  requireText(errors, record?.id, 'id');
  requireText(errors, record?.createdAt, 'createdAt');
  if (!CHANGE_TYPES.has(record?.changeType)) errors.push(`changeType must be one of: ${[...CHANGE_TYPES].join(', ')}`);

  requireText(errors, record?.request?.problem, 'request.problem');
  requireText(errors, record?.request?.userOutcome, 'request.userOutcome');
  requireList(errors, record?.request?.nonGoals, 'request.nonGoals');
  if (!Array.isArray(record?.request?.acceptanceCriteria) || record.request.acceptanceCriteria.length === 0) {
    errors.push('request.acceptanceCriteria needs at least one entry');
  } else {
    for (const [index, criterion] of record.request.acceptanceCriteria.entries()) {
      requireText(errors, criterion?.id, `request.acceptanceCriteria[${index}].id`);
      requireText(errors, criterion?.criterion, `request.acceptanceCriteria[${index}].criterion`);
    }
  }

  requireText(errors, record?.currentSystem?.currentBehavior, 'currentSystem.currentBehavior');
  requireList(errors, record?.currentSystem?.entrypoints, 'currentSystem.entrypoints');
  requireList(errors, record?.currentSystem?.callChain, 'currentSystem.callChain');
  requireList(errors, record?.currentSystem?.evidence, 'currentSystem.evidence');

  requireList(errors, record?.design?.constraints, 'design.constraints');
  const options = Array.isArray(record?.design?.options) ? record.design.options : [];
  if (options.length === 0) errors.push('design.options needs at least one option');
  for (const [index, option] of options.entries()) {
    requireText(errors, option?.id, `design.options[${index}].id`);
    requireText(errors, option?.summary, `design.options[${index}].summary`);
    requireText(errors, option?.benefits, `design.options[${index}].benefits`);
    requireText(errors, option?.tradeoffs, `design.options[${index}].tradeoffs`);
  }
  if (options.length === 1) requireText(errors, record?.design?.singleOptionReason, 'design.singleOptionReason');
  requireText(errors, record?.design?.chosenOptionId, 'design.chosenOptionId');
  if (hasText(record?.design?.chosenOptionId) && !options.some((option) => option.id === record.design.chosenOptionId)) {
    errors.push('design.chosenOptionId must reference an option');
  }
  requireText(errors, record?.design?.decisionRationale, 'design.decisionRationale');
  requireList(errors, record?.design?.architecture?.affectedLayers, 'design.architecture.affectedLayers');
  for (const layer of record?.design?.architecture?.affectedLayers || []) {
    if (!LAYERS.has(layer)) errors.push(`Unknown architecture layer: ${layer}`);
  }
  requireText(errors, record?.design?.architecture?.responsibilityPlacement, 'design.architecture.responsibilityPlacement');
  if (record?.design?.architecture?.dependencyDirectionChecked !== true) {
    errors.push('design.architecture.dependencyDirectionChecked must be true');
  }
  requireList(errors, record?.design?.failureModes, 'design.failureModes');
  requireText(errors, record?.design?.stopOrRollback, 'design.stopOrRollback');
  requireText(errors, record?.design?.observability, 'design.observability');

  requireText(errors, record?.compatibility?.releasedClients, 'compatibility.releasedClients');
  requireText(errors, record?.compatibility?.apiContract, 'compatibility.apiContract');
  requireText(errors, record?.compatibility?.dataPreservation, 'compatibility.dataPreservation');
  requireText(errors, record?.compatibility?.asyncAndRetries, 'compatibility.asyncAndRetries');

  for (const risk of RISK_KEYS) {
    if (typeof record?.risks?.[risk] !== 'boolean') errors.push(`risks.${risk} must be boolean`);
    if (record?.risks?.[risk] === true) requireText(errors, record?.riskControls?.[risk], `riskControls.${risk}`);
  }

  const automated = record?.validationPlan?.automated || [];
  const manual = record?.validationPlan?.manual || [];
  if (automated.filter(hasText).length === 0 && !hasText(record?.validationPlan?.automatedNotApplicableReason)) {
    errors.push('validationPlan needs an automated check or automatedNotApplicableReason');
  }
  if (manual.filter(hasText).length === 0 && !hasText(record?.validationPlan?.manualNotApplicableReason)) {
    errors.push('validationPlan needs a manual check or manualNotApplicableReason');
  }
  requireText(errors, record?.deliveryPlan?.migration, 'deliveryPlan.migration');
  requireText(errors, record?.deliveryPlan?.backend, 'deliveryPlan.backend');
  requireText(errors, record?.deliveryPlan?.app, 'deliveryPlan.app');

  return errors;
}

function validateComplete(record) {
  const errors = validateReady(record);
  requireText(errors, record?.implementation?.sourceReference, 'implementation.sourceReference');
  if (!['working-tree', 'committed'].includes(record?.implementation?.sourceState)) {
    errors.push('implementation.sourceState must be working-tree or committed');
  }
  requireList(errors, record?.implementation?.changedFiles, 'implementation.changedFiles');
  requireList(errors, record?.implementation?.verificationEvidence, 'implementation.verificationEvidence');

  for (const [index, criterion] of (record?.request?.acceptanceCriteria || []).entries()) {
    if (criterion?.result !== 'passed') errors.push(`request.acceptanceCriteria[${index}].result must be passed`);
    requireText(errors, criterion?.evidence, `request.acceptanceCriteria[${index}].evidence`);
  }

  if (record?.documentation?.architectureChanged === true) {
    requireList(errors, record?.documentation?.updatedFiles, 'documentation.updatedFiles');
  } else {
    requireText(errors, record?.documentation?.noArchitectureUpdateReason, 'documentation.noArchitectureUpdateReason');
  }

  if (record?.risks?.native === true) requireText(errors, record?.completionEvidence?.nativeStartupGate, 'completionEvidence.nativeStartupGate');
  if (record?.risks?.database === true) requireText(errors, record?.completionEvidence?.databaseMigration, 'completionEvidence.databaseMigration');
  if (record?.risks?.payment === true) requireText(errors, record?.completionEvidence?.paymentSafety, 'completionEvidence.paymentSafety');
  if (record?.risks?.asyncJobs === true) requireText(errors, record?.completionEvidence?.asyncSafety, 'completionEvidence.asyncSafety');
  if (record?.risks?.performance === true) requireText(errors, record?.completionEvidence?.performanceResult, 'completionEvidence.performanceResult');
  if (record?.risks?.releasedClients === true) requireText(errors, record?.completionEvidence?.releasedClientCompatibility, 'completionEvidence.releasedClientCompatibility');

  return errors;
}

function newRecord(options) {
  const now = new Date().toISOString();
  const changeType = options.type || 'feature';
  if (!CHANGE_TYPES.has(changeType)) fail(`Invalid --type: ${changeType}`);
  return {
    schemaVersion: 1,
    id: options.id || `change-${now.replaceAll(/[:.]/g, '-')}`,
    createdAt: now,
    changeType,
    request: {
      problem: options.problem || '',
      userOutcome: options.outcome || '',
      nonGoals: [],
      acceptanceCriteria: [],
    },
    currentSystem: {
      currentBehavior: '',
      entrypoints: [],
      callChain: [],
      evidence: [],
    },
    design: {
      constraints: [],
      options: [],
      singleOptionReason: '',
      chosenOptionId: '',
      decisionRationale: '',
      architecture: {
        affectedLayers: [],
        responsibilityPlacement: '',
        dependencyDirectionChecked: false,
      },
      failureModes: [],
      stopOrRollback: '',
      observability: '',
    },
    compatibility: {
      releasedClients: '',
      apiContract: '',
      dataPreservation: '',
      asyncAndRetries: '',
    },
    risks: Object.fromEntries(RISK_KEYS.map((key) => [key, false])),
    riskControls: Object.fromEntries(RISK_KEYS.map((key) => [key, ''])),
    validationPlan: {
      automated: [],
      automatedNotApplicableReason: '',
      manual: [],
      manualNotApplicableReason: '',
    },
    deliveryPlan: {
      migration: '',
      backend: '',
      app: '',
    },
    implementation: {
      sourceState: 'working-tree',
      sourceReference: '',
      changedFiles: [],
      verificationEvidence: [],
    },
    completionEvidence: {
      nativeStartupGate: '',
      databaseMigration: '',
      paymentSafety: '',
      asyncSafety: '',
      performanceResult: '',
      releasedClientCompatibility: '',
    },
    documentation: {
      architectureChanged: false,
      updatedFiles: [],
      noArchitectureUpdateReason: '',
    },
  };
}

function completedFixture() {
  const record = newRecord({ type: 'feature', problem: 'Users cannot save feedback', outcome: 'Feedback is persisted' });
  record.request.nonGoals = ['No public discussion forum'];
  record.request.acceptanceCriteria = [{ id: 'AC1', criterion: 'Valid feedback is saved', result: 'passed', evidence: 'API test' }];
  record.currentSystem = {
    currentBehavior: 'No feedback entry exists',
    entrypoints: ['apps/mobile/src/screens/MeScreen.tsx'],
    callChain: ['Mobile -> API -> Server service -> repository'],
    evidence: ['rg and focused code inspection'],
  };
  record.design.constraints = ['Old clients remain compatible'];
  record.design.options = [
    { id: 'A', summary: 'Dedicated feedback flow', benefits: 'Clear ownership', tradeoffs: 'Adds one endpoint' },
    { id: 'B', summary: 'Reuse support email', benefits: 'Small implementation', tradeoffs: 'No structured state' },
  ];
  record.design.chosenOptionId = 'A';
  record.design.decisionRationale = 'Provides durable structured feedback with limited scope';
  record.design.architecture = {
    affectedLayers: ['Mobile', 'API', 'Server', 'Database'],
    responsibilityPlacement: 'UI collects input; service owns rules; repository persists it',
    dependencyDirectionChecked: true,
  };
  record.design.failureModes = ['Duplicate submission'];
  record.design.stopOrRollback = 'Disable the entry point and preserve submitted rows';
  record.design.observability = 'Log request ID and outcome without feedback body';
  record.compatibility = {
    releasedClients: 'Additive endpoint; old clients are unchanged',
    apiContract: 'New optional API only',
    dataPreservation: 'No existing rows are changed',
    asyncAndRetries: 'Idempotency prevents duplicate retries',
  };
  record.validationPlan.automated = ['route and service tests'];
  record.validationPlan.manual = ['submit and view feedback in admin'];
  record.deliveryPlan = { migration: 'Additive migration', backend: 'Deploy API', app: 'Next native package' };
  record.implementation = {
    sourceState: 'committed',
    sourceReference: '0123456789abcdef',
    changedFiles: ['api/src/feedback/routes.ts'],
    verificationEvidence: ['focused tests and typecheck passed'],
  };
  record.documentation.noArchitectureUpdateReason = 'Uses existing layer boundaries';
  return record;
}

function selfTest() {
  const incomplete = newRecord({ type: 'bug-fix', problem: 'Playback stalls', outcome: 'Playback resumes' });
  if (validateReady(incomplete).length < 10) throw new Error('ready validation accepted an incomplete design');
  const complete = completedFixture();
  const readyErrors = validateReady(complete);
  if (readyErrors.length !== 0) throw new Error(`ready self-test failed: ${readyErrors.join('; ')}`);
  const completeErrors = validateComplete(complete);
  if (completeErrors.length !== 0) throw new Error(`complete self-test failed: ${completeErrors.join('; ')}`);
  complete.risks.payment = true;
  if (!validateComplete(complete).some((error) => error.includes('paymentSafety'))) {
    throw new Error('complete validation accepted payment risk without evidence');
  }
  console.log('change-record self-test passed');
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === 'self-test') {
  selfTest();
  process.exit(0);
}

if (command === 'init') {
  if (!options.output) fail('--output is required');
  const output = path.resolve(options.output);
  if (fs.existsSync(output)) fail(`Refusing to overwrite existing change record: ${output}`);
  const record = newRecord(options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(output);
  process.exit(0);
}

if (command === 'check') {
  if (!options.file) fail('--file is required');
  const stage = options.stage || 'ready';
  if (!['ready', 'complete'].includes(stage)) fail(`Invalid --stage: ${stage}`);
  const record = JSON.parse(fs.readFileSync(path.resolve(options.file), 'utf8'));
  const errors = stage === 'ready' ? validateReady(record) : validateComplete(record);
  if (errors.length > 0) fail(errors.join('\n'));
  console.log(`Change record passed stage=${stage}: ${record.id}`);
  process.exit(0);
}

fail('Usage: change-record.mjs init --output <file> --type feature|behavior-change|bug-fix|refactor --problem <text> --outcome <text> | check --file <file> --stage ready|complete | self-test');
