import Link from 'next/link';
import { COMPANY, COMPANY_SITE, UPDATED } from '@/lib/legal';

export const metadata = { title: 'Data deletion · WaDesk' };

export default function DataDeletionPage() {
  return (
    <>
      <h1>Deleting your data</h1>
      <p className="meta">Last updated {UPDATED}</p>

      <p>You can ask {COMPANY} to delete the information WaDesk holds about you at any time.</p>

      <h2>If you messaged a business on WhatsApp</h2>
      <ol>
        <li>
          Contact {COMPANY} through{' '}
          <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
            {COMPANY_SITE.replace('https://', '')}
          </a>{' '}
          and ask for your data to be deleted.
        </li>
        <li>Include the WhatsApp number you messaged from, so we can find your conversations.</li>
        <li>
          We delete your contact record, messages and media within 30 days and confirm when it is done. To stop marketing
          messages straight away, reply STOP in the WhatsApp chat.
        </li>
      </ol>

      <h2>If you are a team member</h2>
      <p>
        Ask a workspace owner to remove you from the team, or contact {COMPANY} as above to delete your account
        completely.
      </p>

      <p>
        More detail is in the <Link href="/privacy">privacy policy</Link>.
      </p>
    </>
  );
}
