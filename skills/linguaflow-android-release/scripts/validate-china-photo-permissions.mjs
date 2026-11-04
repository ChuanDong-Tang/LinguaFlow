import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateChinaPhotoPermissions(version, dump) {
  const parts = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(version);
  if (!parts) throw new Error('Invalid APK version for photo permission validation');
  const photoBrowser = Number(parts[1]) > 1 || (Number(parts[1]) === 1 && Number(parts[2]) >= 2);
  const permissions = new Map([...dump.matchAll(/^uses-permission: name='([^']+)'(.*)$/gm)].map(match => [match[1], match[2]]));
  const forbidden = ['READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE'];
  if (!photoBrowser) forbidden.push('READ_MEDIA_IMAGES', 'READ_MEDIA_VISUAL_USER_SELECTED', 'READ_EXTERNAL_STORAGE');
  for (const name of forbidden) {
    if (permissions.has(`android.permission.${name}`)) throw new Error(`Forbidden media permission: ${name}`);
  }
  if (photoBrowser) {
    for (const name of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VISUAL_USER_SELECTED']) {
      if (!permissions.has(`android.permission.${name}`)) throw new Error(`Missing photo browser permission: ${name}`);
    }
    const legacy = permissions.get('android.permission.READ_EXTERNAL_STORAGE');
    if (legacy === undefined || !/maxSdkVersion='32'/.test(legacy)) throw new Error('Legacy photo reading must be capped at API 32');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateChinaPhotoPermissions(process.argv[2], fs.readFileSync(process.argv[3], 'utf8'));
  console.log('China photo permissions validated');
}
