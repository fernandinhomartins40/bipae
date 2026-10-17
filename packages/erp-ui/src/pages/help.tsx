import { Alert, EmptyState, PageHeader, TextField } from '@bipae/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp, type HelpArticle } from '../help/articles';

/** Central de ajuda (F7-04): busca e artigos em passos, dentro do próprio aplicativo. */
export function HelpPage() {
  const { slug } = useParams();
  const article = slug ? HELP_ARTICLES.find((a) => a.slug === slug) : undefined;
  if (slug) return article ? <ArticleView article={article} /> : <NotFound />;
  return <HelpIndex />;
}

function HelpIndex() {
  const [query, setQuery] = useState('');
  const found = searchHelp(query);
  return (
    <>
      <PageHeader
        title="Ajuda"
        description="Passo a passo das tarefas do dia a dia. Funciona mesmo sem internet."
      />
      <div className="mb-6 max-w-xl">
        <TextField
          label="O que você quer fazer?"
          placeholder="Ex.: sangria, devolução, crediário"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {found.length === 0 ? (
        <EmptyState title="Nada encontrado">
          Tente outras palavras, como "venda", "nota" ou "estoque".
        </EmptyState>
      ) : (
        HELP_CATEGORIES.filter((c) => found.some((a) => a.category === c)).map((category) => (
          <section key={category} className="mb-6" aria-labelledby={`ajuda-${category}`}>
            <h2 id={`ajuda-${category}`} className="mb-2 text-lg font-bold">
              {category}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {found
                .filter((a) => a.category === category)
                .map((a) => (
                  <li key={a.slug}>
                    <Link
                      to={`/ajuda/${a.slug}`}
                      className="block rounded-ui border border-border p-4 hover:bg-surface-2"
                    >
                      <span className="block font-semibold">{a.title}</span>
                      <span className="block text-sm text-muted">{a.summary}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function ArticleView({ article }: { article: HelpArticle }) {
  return (
    <article className="max-w-3xl">
      <p className="mb-2 text-sm">
        <Link to="/ajuda" className="underline">
          Ajuda
        </Link>{' '}
        › {article.category}
      </p>
      <PageHeader title={article.title} description={article.summary} />
      <div className="flex flex-col gap-4">
        {article.body.map((block, i) => {
          if (block.kind === 'p') return <p key={i}>{block.text}</p>;
          if (block.kind === 'steps') {
            return (
              <ol key={i} className="flex list-decimal flex-col gap-2 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ol>
            );
          }
          return (
            <Alert key={i} tone={block.kind === 'tip' ? 'success' : 'warning'}>
              {block.text}
            </Alert>
          );
        })}
      </div>
      {article.screen && (
        <p className="mt-6">
          <Link to={article.screen.to} className="font-semibold text-primary underline">
            Ir para {article.screen.label}
          </Link>
        </p>
      )}
    </article>
  );
}

function NotFound() {
  return (
    <EmptyState title="Artigo não encontrado">
      <Link to="/ajuda" className="underline">
        Voltar para a Ajuda
      </Link>
    </EmptyState>
  );
}
