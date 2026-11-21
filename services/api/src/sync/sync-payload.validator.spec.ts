import { BadRequestException } from '@nestjs/common';
import { validateSyncPushEnvelope } from './sync-payload.validator';

describe('validateSyncPushEnvelope', () => {
  const validOperation = { operationId: '123e4567-e89b-42d3-a456-426614174000', type: 'post.create', payload: { body: 'hello' } };

  it('accepts a valid envelope', () => {
    expect(() => validateSyncPushEnvelope({ operations: [validOperation] })).not.toThrow();
  });

  it('rejects null, arrays and primitive roots', () => {
    for (const value of [null, [], 'invalid', 1]) {
      expect(() => validateSyncPushEnvelope(value)).toThrow(BadRequestException);
    }
  });

  it('rejects unexpected root fields', () => {
    expect(() => validateSyncPushEnvelope({ operations: [validOperation], userId: 'attacker' })).toThrow(BadRequestException);
  });

  it('rejects empty and oversized operation batches', () => {
    expect(() => validateSyncPushEnvelope({ operations: [] })).toThrow(BadRequestException);
    expect(() => validateSyncPushEnvelope({ operations: Array.from({ length: 51 }, () => validOperation) })).toThrow(BadRequestException);
  });

  it('accepts the maximum batch size', () => {
    expect(() => validateSyncPushEnvelope({ operations: Array.from({ length: 50 }, () => validOperation) })).not.toThrow();
  });

  it('rejects non-finite numbers', () => {
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { value: Number.NaN } }] })).toThrow(BadRequestException);
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { value: Number.POSITIVE_INFINITY } }] })).toThrow(BadRequestException);
  });

  it('rejects values that are not JSON-compatible', () => {
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { value: undefined } }] })).toThrow(BadRequestException);
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { value: () => 'x' } }] })).toThrow(BadRequestException);
  });

  it('rejects strings larger than 64 KB', () => {
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { body: 'x'.repeat(64001) } }] })).toThrow(BadRequestException);
  });

  it('rejects arrays larger than 1000 items', () => {
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { values: Array(1001).fill('x') } }] })).toThrow(BadRequestException);
  });

  it('rejects objects with more than 100 keys', () => {
    const payload = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, index]));
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload }] })).toThrow(BadRequestException);
  });

  it('rejects prototype-pollution keys', () => {
    const payload = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload }] })).toThrow(BadRequestException);
  });

  it('rejects payloads deeper than the configured nesting limit', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { nested } }] })).toThrow(BadRequestException);
  });

  it('rejects a serialized request larger than 128 KB', () => {
    const large = 'x'.repeat(64000);
    expect(() => validateSyncPushEnvelope({ operations: [{ ...validOperation, payload: { first: large, second: large } }] })).toThrow(BadRequestException);
  });
});
