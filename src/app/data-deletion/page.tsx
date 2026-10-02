import { contactLine, LegalPage } from '../../components/legal';

export const metadata = { title: 'Data Deletion | Lead Radar' };

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion" updated="2 October 2026">
      <p>You can remove your data from Lead Radar at any time.</p>

      <section>
        <h2>Remove the Threads connection yourself</h2>
        <ul>
          <li>Sign in, open Settings, and choose Disconnect on the Threads account. The stored access token is deleted.</li>
          <li>You can also remove Lead Radar in Threads under Settings, Account, Website permissions.</li>
        </ul>
      </section>

      <section>
        <h2>Ask us to delete everything</h2>
        <p>{contactLine()} Say which Threads username or email address your data belongs to. We delete the account&apos;s stored tokens, posts, leads and notes, and confirm when it is done.</p>
      </section>
    </LegalPage>
  );
}
