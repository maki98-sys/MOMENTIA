import { BadRequestException } from '@nestjs/common';

const MAX_DEPTH = 12;
const MAX_NODES = 5000;
const MAX_STRING_BYTES = 64000;
const MAX_OBJECT_KEYS = 100;

export function validateSyncPushEnvelope(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Sync payload is required.');
  }
  const root = input as Record<string, unknown>;
  if (Object.keys(root).some(key => key !== 'operations')) {
    throw new BadRequestException('Unsupported sync request fields.');
  }
  if (!Array.isArray(root.operations) || root.operations.length < 1 || root.operations.length > 50) {
    throw new BadRequestException('Provide between 1 and 50 operations.');
  }

  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new BadRequestException('Sync payload complexity limit exceeded.');
    }
    if (typeof value === 'string') {
      if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) {
        throw new BadRequestException('Sync string value exceeds 64 KB.');
      }
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new BadRequestException('Sync payload contains an invalid number.');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 1000) throw new BadRequestException('Sync array exceeds 1000 items.');
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') {
      throw new BadRequestException('Sync payload must contain JSON values only.');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_OBJECT_KEYS) throw new BadRequestException('Sync object has too many fields.');
    for (const key of keys) {
      if (key.length > 128 || key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new BadRequestException('Sync payload contains an unsupported object key.');
      }
      visit(record[key], depth + 1);
    }
  };

  visit(root.operations, 0);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_STRING_BYTES * 2) {
    throw new BadRequestException('Sync request exceeds 128 KB.');
  }
}
