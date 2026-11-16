import path from 'node:path';
import { listFlowFiles, loadFlow } from '../lib/flow-loader.mjs';
import { listCollectionFiles, loadCollection } from '../lib/collection-loader.mjs';

export async function validateFlows(directory, collectionsDirectory = null) {
  const absoluteDirectory = path.resolve(directory);
  const files = await listFlowFiles(absoluteDirectory);
  if (files.length === 0) {
    throw new Error(`No JSON flows found in ${absoluteDirectory}.`);
  }

  for (const file of files) {
    const { flow } = await loadFlow(file);
    console.log(`Valid flow: ${flow.id} (${file})`);
  }

  const collectionDirectory = path.resolve(collectionsDirectory ?? './collections');
  const collectionFiles = await listCollectionFiles(collectionDirectory);
  for (const file of collectionFiles) {
    const { collection } = await loadCollection(file);
    console.log(`Valid collection: ${collection.id} (${file})`);
  }
}
