import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadCollection(filePath) {
  const absolutePath = path.resolve(filePath);
  const collection = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  validateCollection(collection, absolutePath);
  return { collection, absolutePath };
}

export async function listCollectionFiles(directory) {
  const absoluteDirectory = path.resolve(directory);
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(absoluteDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export function validateCollection(collection, source = '<collection>') {
  const failures = [];
  if (!collection || typeof collection !== 'object') failures.push('root must be an object');
  if (!nonEmpty(collection?.id)) failures.push('id is required');
  if (!nonEmpty(collection?.title)) failures.push('title is required');
  if (collection?.guides !== undefined && !Array.isArray(collection.guides)) failures.push('guides must be an array');
  if (Array.isArray(collection?.guides) && collection.guides.some((id) => !nonEmpty(id))) failures.push('guides must contain non-empty guide ids');
  if (collection?.numbering && !['continuous', 'per-guide'].includes(collection.numbering)) failures.push("numbering must be 'continuous' or 'per-guide'");
  if (collection?.profiles !== undefined && (!Array.isArray(collection.profiles) || collection.profiles.some((profile) => !nonEmpty(profile)))) failures.push('profiles must be an array of non-empty strings');

  if (failures.length) {
    throw new Error(`${source} is invalid:\n- ${failures.join('\n- ')}`);
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
