import { requireSession } from '../../../lib/auth';
import { listKeywords, listServices } from '../../../lib/dashboard/queries';
import { Badge, btn, btnDanger, btnPrimary, Card, EmptyState, ErrorBanner, input, PageHeader } from '../../../components/ui';
import { addKeyword, deleteKeyword, toggleKeyword } from '../../actions/workspace';

export const dynamic = 'force-dynamic';

type Kw = { id: string; service_id: string | null; term: string; language: string; is_negative: boolean; enabled: boolean };

function KeywordRow({ k }: { k: Kw }) {
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-(--border) py-2 first:border-t-0">
      <span className={k.enabled ? '' : 'text-(--muted) line-through'}>{k.term}</span>
      <Badge>{k.language}</Badge>
      {!k.enabled && <Badge tone="warn">disabled</Badge>}
      <span className="ml-auto flex gap-2">
        <form action={toggleKeyword}>
          <input type="hidden" name="id" value={k.id} />
          <input type="hidden" name="enabled" value={String(!k.enabled)} />
          <button className={btn} type="submit">
            {k.enabled ? 'Disable' : 'Enable'}
          </button>
        </form>
        <form action={deleteKeyword}>
          <input type="hidden" name="id" value={k.id} />
          <button className={btnDanger} type="submit" aria-label={`Delete keyword ${k.term}`}>
            Delete
          </button>
        </form>
      </span>
    </li>
  );
}

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const s = await requireSession();
  const [services, keywords] = await Promise.all([listServices(s), listKeywords(s)]);
  const positive = keywords.filter((k) => !k.is_negative) as Kw[];
  const negative = keywords.filter((k) => k.is_negative) as Kw[];
  const general = positive.filter((k) => !k.service_id);

  return (
    <>
      <PageHeader title="Keywords" subtitle="The phrases we search for on Threads, and the seller phrases we ignore." />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <p className="mb-4 text-sm text-(--muted)">
        These phrases are searched on Threads. Use phrases people really write ("need a website"), in English first. Negative keywords drop a post before the AI sees it, so use only phrases that sellers use.
      </p>

      <Card title="Add a keyword" className="mb-6">
        <form action={addKeyword} className="grid gap-2 md:grid-cols-5">
          <input className={`${input} md:col-span-2`} name="term" placeholder="need a website" required minLength={2} maxLength={120} aria-label="Keyword" />
          <select className={input} name="service_id" aria-label="Service">
            <option value="">General</option>
            {services.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </select>
          <select className={input} name="language" aria-label="Language" defaultValue="en">
            <option value="en">English</option>
            <option value="hinglish">Hinglish</option>
            <option value="hi">Hindi</option>
          </select>
          <select className={input} name="is_negative" aria-label="Type" defaultValue="false">
            <option value="false">Search for it</option>
            <option value="true">Negative (drop posts with it)</option>
          </select>
          <div className="md:col-span-5">
            <button className={btnPrimary} type="submit">
              Add keyword
            </button>
          </div>
        </form>
      </Card>

      {positive.length === 0 && <EmptyState title="No keywords yet">Add a few phrases above. Without keywords nothing is collected.</EmptyState>}

      <div className="grid gap-4">
        {services.map((sv) => {
          const list = positive.filter((k) => k.service_id === sv.id);
          if (list.length === 0) return null;
          return (
            <Card key={sv.id} title={sv.name}>
              <ul>{list.map((k) => <KeywordRow key={k.id} k={k} />)}</ul>
            </Card>
          );
        })}
        {general.length > 0 && (
          <Card title="General">
            <ul>{general.map((k) => <KeywordRow key={k.id} k={k} />)}</ul>
          </Card>
        )}
        <Card title="Negative keywords">
          {negative.length === 0 ? <p className="text-sm text-(--muted)">None.</p> : <ul>{negative.map((k) => <KeywordRow key={k.id} k={k} />)}</ul>}
        </Card>
      </div>
    </>
  );
}
