import { contactLine, LegalPage } from '../../components/legal';

export const metadata = { title: 'Terms of Service | Lead Radar' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="2 October 2026">
      <p>These terms apply to your use of Lead Radar.</p>

      <section>
        <h2>The service</h2>
        <p>Lead Radar reads public Threads posts, uses AI to flag people who may want to hire a developer, and shows them as leads with reply drafts. It is a research and drafting tool. A person decides whether to contact anyone.</p>
      </section>

      <section>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Use the leads to make honest, relevant, non-spam contact. Follow the rules of the platform you contact people on.</li>
          <li>Do not use the app to harass anyone or to collect data for purposes the platform does not allow.</li>
          <li>Keep your login details safe. You are responsible for activity in your workspace.</li>
        </ul>
      </section>

      <section>
        <h2>No guarantees</h2>
        <p>AI can be wrong. A lead may not be a real buyer, and a post may be missed. The service is provided as is, without a promise of results, and its availability can change.</p>
      </section>

      <section>
        <h2>Ending use</h2>
        <p>You can stop using the app and ask for your data to be deleted at any time (see the <a className="underline" href="/data-deletion">data deletion page</a>). Access may be removed if these terms are broken.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>{contactLine()}</p>
      </section>
    </LegalPage>
  );
}
