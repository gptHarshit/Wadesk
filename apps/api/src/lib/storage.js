import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

/**
 * Local-disk media storage. Keys are generated here and never taken from user
 * input, so they can't escape the storage directory. To move to S3 or similar,
 * reimplement these three functions.
 */
const root = path.resolve(config.storageDir);

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export const baseMime = (mimeType) => String(mimeType || '').split(';')[0].trim().toLowerCase();
export const extensionFor = (mimeType) => EXTENSIONS[baseMime(mimeType)] ?? 'bin';

function resolveKey(key) {
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function saveFile(workspaceId, buffer, mimeType) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `${workspaceId}/${month}/${crypto.randomUUID()}.${extensionFor(mimeType)}`;
  const full = resolveKey(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer);
  return key;
}

export async function statFile(key) {
  try {
    return await fsp.stat(resolveKey(key));
  } catch {
    return null;
  }
}

export const openFile = (key) => fs.createReadStream(resolveKey(key));
