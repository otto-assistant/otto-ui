import { describe, expect, test } from 'bun:test';
import { extractQueueSuffix } from './queueSuffix';

describe('extractQueueSuffix', () => {
  test('plain message is untouched', () => {
    expect(extractQueueSuffix('fix the tests')).toEqual({
      prompt: 'fix the tests',
      forceQueue: false,
    });
  });

  test('". queue" suffix is stripped and queued', () => {
    expect(extractQueueSuffix('fix the tests. queue')).toEqual({
      prompt: 'fix the tests',
      forceQueue: true,
    });
  });

  test('"! queue" and "? queue" suffixes', () => {
    expect(extractQueueSuffix('run it! queue')).toEqual({ prompt: 'run it', forceQueue: true });
    expect(extractQueueSuffix('can you check? queue')).toEqual({
      prompt: 'can you check',
      forceQueue: true,
    });
  });

  test('trailing period after queue', () => {
    expect(extractQueueSuffix('fix the tests. queue.')).toEqual({
      prompt: 'fix the tests',
      forceQueue: true,
    });
  });

  test('queue on its own final line', () => {
    expect(extractQueueSuffix('fix the tests\nqueue')).toEqual({
      prompt: 'fix the tests',
      forceQueue: true,
    });
  });

  test('case-insensitive', () => {
    expect(extractQueueSuffix('fix the tests. QUEUE')).toEqual({
      prompt: 'fix the tests',
      forceQueue: true,
    });
  });

  test('word "queue" mid-sentence is untouched', () => {
    expect(extractQueueSuffix('add a queue to the worker')).toEqual({
      prompt: 'add a queue to the worker',
      forceQueue: false,
    });
  });

  test('bare "queue" message is untouched', () => {
    expect(extractQueueSuffix('queue')).toEqual({ prompt: 'queue', forceQueue: false });
  });

  test('message about the queue without punctuation marker is untouched', () => {
    expect(extractQueueSuffix('clear the queue')).toEqual({
      prompt: 'clear the queue',
      forceQueue: false,
    });
  });
});
