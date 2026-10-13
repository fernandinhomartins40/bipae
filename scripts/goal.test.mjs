// Testes do modo /goal: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { continuation, decide, inScope } from './goal.mjs';
import { analyse, parseBacklog } from './tarefas.mjs';

const backlog = (lines) => analyse(parseBacklog(['## Externo', '- [ ] E1 · Certificado', '', '## Fase 3', ...lines].join('\n')));
const fresh = (target, extra = {}) => ({
  active: true,
  target,
  max: null,
  initiallyDone: [],
  done: [],
  lastSnapshot: null,
  idleStops: 0,
  stops: 0,
  ...extra,
});

test('continua com a próxima tarefa liberada e explica o protocolo', () => {
  const tasks = backlog(['- [x] F3-01 · Revalidar', '- [ ] F3-02 · Motor — depende: F3-01', '  - Pronto quando: cobertura 90%']);
  const r = decide(fresh('F3'), tasks);
  assert.equal(r.stop, false);
  assert.equal(r.next.id, 'F3-02');
  const text = continuation(r.next, r.state);
  assert.match(text, /F3-02 · Motor/);
  assert.match(text, /Pronto quando: cobertura 90%/);
  assert.match(text, /português/);
});

test('retoma a tarefa em andamento antes de pegar outra', () => {
  const tasks = backlog(['- [ ] F3-01 · A', '- [~] F3-02 · B']);
  assert.equal(decide(fresh('F3'), tasks).next.id, 'F3-02');
});

test('encerra quando o objetivo termina', () => {
  const r = decide(fresh('F3'), backlog(['- [x] F3-01 · A', '- [x] F3-02 · B']));
  assert.equal(r.stop, true);
  assert.equal(r.state.active, false);
  assert.equal(r.state.endReason, 'objetivo concluído');
});

test('encerra quando só restam tarefas travadas por itens externos', () => {
  const r = decide(fresh('F3'), backlog(['- [ ] F3-11 · SEFAZ — externo: E1']));
  assert.equal(r.stop, true);
  assert.match(r.state.endReason, /travadas/);
});

test('respeita o limite de tarefas do objetivo', () => {
  const tasks = backlog(['- [x] F3-01 · A', '- [x] F3-02 · B', '- [ ] F3-03 · C']);
  const r = decide(fresh('F3', { max: 2 }), tasks);
  assert.equal(r.stop, true);
  assert.deepEqual(r.state.done, ['F3-01', 'F3-02']);
  // Tarefas já feitas antes de iniciar não contam.
  assert.equal(decide(fresh('F3', { max: 2, initiallyDone: ['F3-01'] }), tasks).stop, false);
});

test('duas paradas seguidas sem progresso encerram (sem laço infinito)', () => {
  const tasks = backlog(['- [ ] F3-01 · A']);
  let state = fresh('F3');
  const first = decide(state, tasks);
  assert.equal(first.stop, false);
  state = first.state;
  const second = decide(state, tasks);
  assert.equal(second.stop, false);
  const third = decide(second.state, tasks);
  assert.equal(third.stop, true);
  assert.match(third.state.endReason, /sem progresso/);
});

test('progresso zera a contagem de paradas ociosas', () => {
  const before = decide(fresh('F3'), backlog(['- [ ] F3-01 · A', '- [ ] F3-02 · B'])).state;
  const after = decide({ ...before, idleStops: 1 }, backlog(['- [x] F3-01 · A', '- [ ] F3-02 · B']));
  assert.equal(after.stop, false);
  assert.equal(after.state.idleStops, 0);
});

test('alvos: tudo, prefixo de fase, código e subtarefas', () => {
  const tasks = backlog(['- [ ] F3-01 · A', '- [ ] F3-01.a · A1', '- [ ] F3-10 · B', '- [ ] F4-01 · C']);
  assert.equal(inScope(tasks, 'tudo').length, 4);
  assert.deepEqual(inScope(tasks, 'f3').map((t) => t.id), ['F3-01', 'F3-01.a', 'F3-10']);
  assert.deepEqual(inScope(tasks, 'F3-01').map((t) => t.id), ['F3-01', 'F3-01.a']);
  assert.equal(decide(fresh('X9'), tasks).stop, true);
});

test('sem objetivo ativo, deixa parar', () => {
  assert.equal(decide(null, []).stop, true);
  assert.equal(decide({ active: false }, []).stop, true);
});

test('commits e arquivos alterados também contam como progresso', () => {
  const tasks = backlog(['- [~] F3-01 · Tarefa longa']);
  let r = decide(fresh('F3'), tasks, 'commit-a');
  r = decide(r.state, tasks, 'commit-b');
  r = decide(r.state, tasks, 'commit-c');
  assert.equal(r.stop, false);
  assert.equal(r.state.idleStops, 0);
});
