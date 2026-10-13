#!/usr/bin/env node
// Modo "goal": o Claude Code trabalha sozinho no backlog (docs/TAREFAS.md) até atingir um objetivo.
//
//   node scripts/goal.mjs iniciar <alvo> [máximo]   alvo: tudo | F3 | F3-07 | P ...
//   node scripts/goal.mjs status
//   node scripts/goal.mjs parar
//   node scripts/goal.mjs hook                      (chamado pelo Stop hook do Claude Code)
//
// O Stop hook roda sempre que o Claude vai parar. Com um objetivo ativo e tarefa liberada, ele
// devolve {"decision":"block"} com a próxima tarefa e o trabalho continua. Ele libera a parada
// quando o objetivo termina, quando só sobram tarefas travadas, quando o limite é atingido ou
// quando duas paradas seguidas não tiveram progresso (proteção contra laço infinito).
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse, parseBacklog, pickNext } from './tarefas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BACKLOG = join(ROOT, 'docs', 'TAREFAS.md');
export const STATE = join(ROOT, '.claude', 'goal-state.json');
const MAX_IDLE_STOPS = 2;

/** Tarefas do alvo: "tudo", um prefixo de fase ("F3", "P") ou um código ("F3-07", com subtarefas). */
export function inScope(tasks, target) {
  const work = tasks.filter((t) => !t.id.startsWith('E'));
  if (!target || target === 'tudo') return work;
  const t = target.toUpperCase();
  return work.filter((task) => task.id === t || task.id.startsWith(`${t}-`) || task.id.startsWith(`${t}.`));
}

const snapshot = (tasks) => tasks.map((t) => `${t.id}:${t.status}`).join('|');

/** Decide se o Claude continua (e com qual tarefa) ou pode parar. Puro: facilita os testes. */
/** `work` resume o trabalho em andamento (commit e arquivos alterados): também conta como progresso. */
export function decide(state, tasks, work = '') {
  if (!state?.active) return { stop: true, state };
  const scope = inScope(tasks, state.target);
  if (scope.length === 0) {
    return { stop: true, state: { ...state, active: false, endReason: `alvo "${state.target}" não existe no backlog` } };
  }
  const remaining = scope.filter((t) => t.status !== 'feita');
  const doneNow = scope.filter((t) => t.status === 'feita' && !state.initiallyDone.includes(t.id)).map((t) => t.id);
  const finish = (endReason) => ({ stop: true, state: { ...state, active: false, done: doneNow, endReason } });

  if (remaining.length === 0) return finish('objetivo concluído');
  if (state.max && doneNow.length >= state.max) return finish(`limite de ${state.max} tarefa(s) atingido`);

  const next = pickNext(scope);
  if (!next) return finish('só restam tarefas travadas por dependências ou itens externos');

  const snap = `${snapshot(scope)}#${work}`;
  const idle = snap === state.lastSnapshot ? state.idleStops + 1 : 0;
  if (idle >= MAX_IDLE_STOPS) return finish('duas paradas seguidas sem progresso no backlog');

  return {
    stop: false,
    next,
    state: { ...state, done: doneNow, lastSnapshot: snap, idleStops: idle, stops: state.stops + 1 },
  };
}

export function continuation(next, state) {
  const done = state.done.length ? `Já concluídas neste objetivo: ${state.done.join(', ')}. ` : '';
  return [
    `Objetivo ativo (/goal ${state.target}${state.max ? ` ${state.max}` : ''}). ${done}Siga para a próxima tarefa:`,
    `${next.id} · ${next.title}`,
    ...next.details.map((d) => `  ${d}`),
    'Siga o protocolo da seção "Backlog" do CLAUDE.md: marque [~], implemente com testes, rode lint/typecheck/test,',
    'marque [x], registre no CHANGELOG, faça commit e push e confira o CI. Fale com o dono em português.',
    'Se precisar de uma decisão do dono ou de algo externo, explique e pare. Para encerrar o objetivo: node scripts/goal.mjs parar.',
  ].join('\n');
}

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null);
const save = (state) => {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2));
};
const backlog = () => analyse(parseBacklog(readFileSync(BACKLOG, 'utf8')));

/** Commit atual + arquivos alterados: muda sempre que há trabalho de verdade entre duas paradas. */
function workFingerprint() {
  try {
    const git = (args) => execSync('git ' + args, { cwd: ROOT, encoding: 'utf8' });
    return createHash('sha256').update(git('rev-parse HEAD') + git('status --porcelain') + git('diff')).digest('hex').slice(0, 16);
  } catch {
    return '';
  }
}

function start(target = 'tudo', max) {
  const tasks = backlog();
  const scope = inScope(tasks, target);
  if (scope.length === 0) {
    console.error(`Nenhuma tarefa corresponde a "${target}". Use tudo, um prefixo (F3, P) ou um código (F3-07).`);
    process.exit(1);
  }
  const state = {
    active: true,
    target,
    max: max ? Number(max) : null,
    startedAt: new Date().toISOString(),
    initiallyDone: scope.filter((t) => t.status === 'feita').map((t) => t.id),
    done: [],
    lastSnapshot: null,
    idleStops: 0,
    stops: 0,
  };
  save(state);
  const first = decide(state, tasks);
  const pending = scope.filter((t) => t.status !== 'feita').length;
  console.log(`Objetivo iniciado: ${target}${state.max ? ` (no máximo ${state.max} tarefas)` : ''} · ${pending} tarefa(s) pendente(s).`);
  console.log(first.stop ? `Nada a fazer agora: ${first.state.endReason}.` : `Primeira tarefa:\n${continuation(first.next, first.state)}`);
  if (first.stop) save(first.state);
}

function status() {
  const state = load();
  if (!state?.active) {
    console.log(state ? `Nenhum objetivo ativo. O último terminou: ${state.endReason ?? 'parado'}.` : 'Nenhum objetivo ativo.');
    return;
  }
  const scope = inScope(backlog(), state.target);
  const done = scope.filter((t) => t.status === 'feita').length;
  console.log(`Objetivo: ${state.target} · ${done}/${scope.length} feitas · iniciado em ${state.startedAt} · ${state.stops} retomada(s).`);
}

function stop() {
  const state = load();
  if (!state?.active) return console.log('Nenhum objetivo ativo.');
  save({ ...state, active: false, endReason: 'parado pelo dono' });
  console.log(`Objetivo "${state.target}" parado.`);
}

async function hook() {
  // O Claude Code manda o contexto da sessão no stdin; aqui basta o estado do objetivo.
  for await (const _ of process.stdin) void _;
  const state = load();
  if (!state?.active) return;
  let result;
  try {
    result = decide(state, backlog(), workFingerprint());
  } catch (error) {
    save({ ...state, active: false, endReason: `erro no backlog: ${error.message}` });
    return;
  }
  save(result.state);
  if (result.stop) {
    process.stdout.write(JSON.stringify({ systemMessage: `/goal ${state.target} encerrado: ${result.state.endReason}.` }));
    return;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: continuation(result.next, result.state) }));
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url).replace(/\\/g, '/').endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invoked) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'iniciar') start(...args);
  else if (cmd === 'status') status();
  else if (cmd === 'parar') stop();
  else if (cmd === 'hook') await hook();
  else if (cmd === 'limpar' && existsSync(STATE)) unlinkSync(STATE);
  else console.log('Uso: node scripts/goal.mjs iniciar <alvo> [máximo] | status | parar');
}
