import test from 'node:test';
import assert from 'node:assert/strict';
import { stoppedResult } from '../src/stoppedResult.js';

test('stopping chat keeps generated text and thinking', () => {
  assert.deepEqual(stoppedResult('chat', { content: 'Already written', thinking: 'Reasoning so far' }, []), {
    text: 'Already written', thinking: 'Reasoning so far',
  });
});

test('stopping an agent keeps completed steps and closes live sections', () => {
  const result = stoppedResult('agent', null, [{ kind: 'plan', text: 'Plan', live: true }, { kind: 'result', text: 'Exit 0' }]);
  assert.equal(result.steps[0].text, 'Plan');
  assert.equal(result.steps[0].live, false);
  assert.equal(result.steps[1].text, 'Exit 0');
});
