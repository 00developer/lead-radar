import { contactLine, LegalPage } from '../../components/legal';

export const metadata = { title: 'Privacy Policy | Lead Radar' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="2 October 2026">
      <p>Lead Radar helps a software company find public posts from people who are looking for a developer, and prepares reply drafts for a human to send. This page explains what data the app handles.</p>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>Public Threads posts (text, public username, post link, time) that match the keywords set up by the account owner.</li>
          <li>If you connect a Threads account: your Threads user id and username, and an access token that lets the app call the official Threads API for you.</li>
          <li>The account owner&apos;s email address and notes they type in (keywords, business profile, lead status).</li>
        </ul>
      </section>

      <section>
        <h2>How we use it</h2>
        <ul>
          <li>An AI model reads the public post text to decide if the writer wants to hire a developer.</li>
          <li>Matching posts are shown to the account owner as leads with a reply draft.</li>
          <li>Email alerts are sent to the account owner about new leads.</li>
        </ul>
        <p className="mt-2">The app never posts, comments, likes, follows or sends messages on any platform. It only reads public data.</p>
      </section>

      <section>
        <h2>Tokens and security</h2>
        <p>Threads access tokens are stored encrypted and are used only to call the official Threads API for the account that connected them. Data is stored in a database with row-level access rules, so each workspace sees only its own data. We do not sell data.</p>
      </section>

      <section>
        <h2>Who sees the data</h2>
        <p>Only the workspace owner and the service providers needed to run the app: hosting, database, the AI model provider (post text is sent for classification) and an email sender.</p>
      </section>

      <section>
        <h2>Deleting your data</h2>
        <p>
          You can disconnect your Threads account at any time in the app settings, which removes the stored token. To have your data deleted, see the <a className="underline" href="/data-deletion">data deletion page</a>.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>{contactLine()}</p>
      </section>
    </LegalPage>
  );
}
