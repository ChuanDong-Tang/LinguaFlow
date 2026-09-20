#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const PROFILE_RANK = Object.freeze({ focused: 0, 'affected-flow': 1, 'release-core': 2 });
export const RELEASE_CORE_FLOWS = Object.freeze([
  'imageAttachment',
  'messageSend',
  'rewriteGeneration',
  'rewriteRendering',
  'clozePractice',
  'memoryGame',
]);
export const ALL_DEVICE_TARGETS = Object.freeze(['ios26', 'ios27', 'android']);

const NATIVE_PATTERNS = [
  /^apps\/mobile\/(?:app\.config\.[^/]+|app\.json|eas\.json|package(?:-lock)?\.json|babel\.config\.[^/]+|metro\.config\.[^/]+)$/u,
  /^apps\/mobile\/(?:plugins|modules|ios|android)\//u,
];
const SHARED_CORE_PATTERNS = [
  /^apps\/mobile\/src\/App\.tsx$/u,
  /^apps\/mobile\/src\/screens\/CardDetail(?:Modal|Navigator)\.tsx$/u,
  /^apps\/mobile\/src\/screens\/chat\/(?:ChatSelectableTextView|SelectableMessageText)\.tsx$/u,
];
const FOCUSED_PATTERNS = [
  /(?:^|\/)__tests__\//u,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/u,
  /^apps\/mobile\/src\/i18n\/messages\.ts$/u,
  /\.(?:md|txt)$/u,
];

function addFlowForFile(flows, file) {
  if (/image|ImagePicker|cardImage/u.test(file)) flows.add('imageAttachment');
  if (/ChatComposer|chatHistory|messageState|ChatScreen/u.test(file)) flows.add('messageSend');
  if (/rewrite|Generation|ChatScreen/u.test(file)) flows.add('rewriteGeneration');
  if (/CardDetail|SelectableMessageText|ChatSelectableTextView|rewrite/u.test(file)) flows.add('rewriteRendering');
  if (/cloze|Cloze|SelectableMessageText|ChatSelectableTextView|CardDetail/u.test(file)) flows.add('clozePractice');
  if (/MemoryRound|memoryRound|cloze|Cloze/u.test(file)) flows.add('memoryGame');
}

export function classifyMobileReleaseRisk(files) {
  const normalized = [...new Set(files.filter(Boolean).map((file) => file.replaceAll('\\', '/')))].sort();
  const mobileFiles = normalized.filter((file) => file.startsWith('apps/mobile/'));
  const nativeFiles = mobileFiles.filter((file) => NATIVE_PATTERNS.some((pattern) => pattern.test(file)));
  const sharedCoreFiles = mobileFiles.filter((file) => SHARED_CORE_PATTERNS.some((pattern) => pattern.test(file)));
  const runtimeFiles = mobileFiles.filter((file) => !FOCUSED_PATTERNS.some((pattern) => pattern.test(file)));
  const requiredFlows = new Set();
  for (const file of mobileFiles) addFlowForFile(requiredFlows, file);

  let minimumProfile = 'focused';
  let reason = 'Only tests, copy, documentation, or non-Mobile release metadata changed.';
  if (nativeFiles.length > 0) {
    minimumProfile = 'release-core';
    reason = `Native/runtime inputs changed: ${nativeFiles.join(', ')}`;
  } else if (sharedCoreFiles.length > 0) {
    minimumProfile = 'release-core';
    reason = `Shared Card/app runtime changed: ${sharedCoreFiles.join(', ')}`;
  } else if (runtimeFiles.length > 0) {
    minimumProfile = 'affected-flow';
    reason = `Mobile runtime behavior changed: ${runtimeFiles.join(', ')}`;
  }

  if (minimumProfile === 'release-core') {
    for (const flow of RELEASE_CORE_FLOWS) requiredFlows.add(flow);
  }
  if (requiredFlows.size === 0 && runtimeFiles.length > 0) requiredFlows.add('changedInteraction');

  return {
    minimumProfile,
    reason,
    changedFiles: normalized,
    mobileFiles,
    nativeFiles,
    sharedCoreFiles,
    requiredFlows: [...requiredFlows].sort(),
    requiredTargets: minimumProfile === 'release-core' ? [...ALL_DEVICE_TARGETS] : [],
  };
}

export function changedFilesBetween(repoRoot, baselineCommit, sourceCommit) {
  const result = spawnSync('git', ['diff', '--name-only', `${baselineCommit}..${sourceCommit}`, '--'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'git diff failed').trim());
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[token.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function selfTest() {
  const native = classifyMobileReleaseRisk(['apps/mobile/package.json']);
  if (native.minimumProfile !== 'release-core' || native.requiredFlows.length !== RELEASE_CORE_FLOWS.length) {
    throw new Error('Native dependency changes must require release-core');
  }
  const shared = classifyMobileReleaseRisk(['apps/mobile/src/screens/chat/SelectableMessageText.tsx']);
  if (shared.minimumProfile !== 'release-core' || !shared.requiredFlows.includes('clozePractice')) {
    throw new Error('Shared selectable text must expand to release-core consumers');
  }
  const image = classifyMobileReleaseRisk(['apps/mobile/src/services/card/cardImageUpload.ts']);
  if (image.minimumProfile !== 'affected-flow' || !image.requiredFlows.includes('imageAttachment')) {
    throw new Error('Image service change must require the image journey');
  }
  const copy = classifyMobileReleaseRisk(['apps/mobile/src/i18n/messages.ts']);
  if (copy.minimumProfile !== 'focused') throw new Error('Copy-only changes should remain focused');
  console.log('mobile-release-risk self-test passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { command, options } = parseArgs(process.argv.slice(2));
    if (command === 'self-test') selfTest();
    else if (command === 'classify') {
      if (!options.repo || !options.baseline || !options.source) {
        throw new Error('Usage: mobile-release-risk.mjs classify --repo <root> --baseline <sha> --source <sha>');
      }
      console.log(JSON.stringify(classifyMobileReleaseRisk(changedFilesBetween(options.repo, options.baseline, options.source)), null, 2));
    } else throw new Error('Usage: mobile-release-risk.mjs classify ... | self-test');
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
