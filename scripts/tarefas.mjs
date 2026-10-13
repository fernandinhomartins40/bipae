#!/usr/bin/env node
// Lê docs/TAREFAS.md e mostra progresso, próximas tarefas liberadas e bloqueios externos.
//   pnpm tarefas              resumo
//   pnpm tarefas proxima      só a próxima tarefa liberada (para executar)
//   pnpm tarefas bloqueadas   o que espera o dono do projeto
import { readFileSync } from 'node:fs';

const FILE = new URL('../docs/TAREFAS.md', import.meta.url);
const LINE = /^- \[( |x|~)\] (\S+) · (.+)$/;

export function parseBacklog(text) {
  const tasks = [];
  let section = '';
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.startsWith('## ')) section = raw.slice(3).trim();
    const m = LINE.exec(raw);
    if (m) {
      const [, mark, id, rest] = m;
      const [title, ...meta] = rest.split(/ — | · /);
      const field = (name) =>
        (meta.find((p) => p.startsWith(`${name}:`)) ?? '')
          .slice(name.length + 1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      current = {
        id,
        title: title.trim(),
        status: mark === 'x' ? 'feita' : mark === '~' ? 'andamento' : 'pendente',
        section,
        deps: [...field('depende'), ...field('externo')],
        details: [],
      };
      tasks.push(current);
    } else if (current && /^\s{2,}- /.test(raw)) {
      current.details.push(raw.trim().slice(2));
    } else if (raw.trim() === '') {
      current = null;
    }
  }
  return tasks;
}

export function analyse(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    const missing = t.deps.filter((d) => !byId.has(d));
    if (missing.length) throw new Error(`${t.id} depende de código inexistente: ${missing.join(', ')}`);
    t.waiting = t.deps.filter((d) => byId.get(d).status !== 'feita');
    t.free = t.status !== 'feita' && t.waiting.length === 0;
  }
  return tasks;
}

/**
 * Próxima tarefa a executar: a que está em andamento, senão a primeira liberada. Uma tarefa
 * quebrada em partes (F1-03.a, F1-03.b...) é feita pelas partes, na ordem.
 */
export function pickNext(work) {
  const subsOf = (id) => work.filter((s) => s.id.startsWith(`${id}.`) && s.status !== 'feita');
  const resolve = (t) => {
    const subs = subsOf(t.id);
    if (subs.length === 0) return t;
    return subs.find((s) => s.status === 'andamento') ?? subs.find((s) => s.free) ?? null;
  };
  const top = work.filter((t) => !t.id.includes('.') && t.status !== 'feita');
  for (const t of top.filter((t) => t.status === 'andamento')) {
    const next = resolve(t);
    if (next) return next;
  }
  for (const t of top.filter((t) => t.free)) {
    const next = resolve(t);
    if (next) return next;
  }
  return null;
}

function main() {
  const tasks = analyse(parseBacklog(readFileSync(FILE, 'utf8')));
  const work = tasks.filter((t) => !t.id.startsWith('E'));
  const mode = process.argv[2] ?? 'resumo';
  const show = (t) => `${t.id} · ${t.title}${t.details.length ? `\n    ${t.details.join('\n    ')}` : ''}`;

  if (mode === 'proxima') {
    const next = pickNext(work);
    console.log(next ? show(next) : 'Nenhuma tarefa liberada: veja "pnpm tarefas bloqueadas".');
    return;
  }

  if (mode === 'bloqueadas') {
    const external = tasks.filter((t) => t.id.startsWith('E') && t.status !== 'feita');
    for (const e of external) {
      const blocks = work.filter((t) => t.status !== 'feita' && t.deps.includes(e.id)).map((t) => t.id);
      console.log(`${e.id} · ${e.title}${blocks.length ? `\n    trava: ${blocks.join(', ')}` : ''}`);
    }
    return;
  }

  const sections = [...new Set(work.map((t) => t.section))];
  console.log('Backlog do Bipaê\n');
  for (const s of sections) {
    const list = work.filter((t) => t.section === s);
    const done = list.filter((t) => t.status === 'feita').length;
    const bar = '█'.repeat(Math.round((done / list.length) * 20)).padEnd(20, '░');
    console.log(`${bar} ${String(done).padStart(2)}/${String(list.length).padEnd(2)} ${s}`);
  }
  const done = work.filter((t) => t.status === 'feita').length;
  const free = work.filter((t) => t.free);
  console.log(`\nTotal: ${done} de ${work.length} feitas · ${free.length} liberadas agora\n`);
  console.log('Próximas liberadas:');
  for (const t of free.slice(0, 5)) console.log(`  ${t.id} · ${t.title}`);
  const ext = tasks.filter((t) => t.id.startsWith('E') && t.status !== 'feita').length;
  console.log(`\n${ext} pendências externas (pnpm tarefas bloqueadas).`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main();
