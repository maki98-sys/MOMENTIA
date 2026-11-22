import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClamAvResponse, runFfmpeg } from '../dist/process-utils.js';

test('ClamAV parser accepts only complete clean verdicts', () => {
  assert.equal(parseClamAvResponse('stream: OK\0'), 'clean');
  assert.equal(parseClamAvResponse('stream: OK'), 'pending');
  assert.throws(() => parseClamAvResponse('stream: OK\0unexpected'), /after its terminal verdict/);
});

test('ClamAV parser identifies infected streams without substring false positives', () => {
  assert.equal(parseClamAvResponse('stream: Eicar-Test-Signature FOUND\0'), 'rejected');
  assert.equal(parseClamAvResponse('not OK; still scanning'), 'pending');
  assert.equal(parseClamAvResponse(''), 'pending');
});

test('ClamAV scanner errors fail closed', () => {
  assert.throws(() => parseClamAvResponse('stream: INSTREAM size limit exceeded ERROR\0'), /ClamAV scan failed/);
});

test('FFmpeg runner resolves successful child processes', async () => {
  await runFfmpeg(process.execPath, ['-e', 'process.exit(0)'], 5_000);
});

test('FFmpeg runner rejects non-zero exits with bounded diagnostics', async () => {
  await assert.rejects(
    runFfmpeg(process.execPath, ['-e', "process.stderr.write('x'.repeat(20000)); process.exit(2)"], 5_000),
    /FFmpeg exited 2:/,
  );
});

test('FFmpeg runner terminates processes that exceed the configured timeout', async () => {
  await assert.rejects(
    runFfmpeg(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 1_000, 100),
    /FFmpeg timed out after 1000 ms/,
  );
});

test('FFmpeg runner rejects unsafe timeout configuration', async () => {
  await assert.rejects(runFfmpeg(process.execPath, [], 999), /between 1000 and 300000/);
});
