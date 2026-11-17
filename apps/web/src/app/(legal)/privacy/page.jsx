import Link from 'next/link';
import { COMPANY, COMPANY_SITE, UPDATED } from '@/lib/legal';

export const metadata = { title: 'Privacy policy · WaDesk' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="meta">Last updated {UPDATED}</p>

      <p>
        WaDesk is a shared WhatsApp inbox and messaging tool operated by {COMPANY} (&ldquo;we&rdquo;). This policy explains
        what information WaDesk handles, why, and the choices you have. It covers two groups of people: team members
        who sign in to WaDesk, and customers who exchange WhatsApp messages with a business that uses WaDesk.
      </p>

      <h2>Information we handle</h2>
      <h3>Team members</h3>
      <ul>
        <li>Name, email address and role in the workspace.</li>
        <li>A password, stored only as a one-way hash.</li>
        <li>Sign-in sessions and a record of actions such as assigning or closing a chat.</li>
      </ul>
      <h3>Customers who message the business</h3>
      <ul>
        <li>WhatsApp phone number or WhatsApp user ID, and the profile name WhatsApp shares.</li>
        <li>Messages, images and documents exchanged with the business, and their delivery and read status.</li>
        <li>Details the business adds, such as tags, notes and whether the customer opted out of messages.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To deliver and receive WhatsApp messages through the WhatsApp Business Platform (Cloud API) provided by Meta.</li>
        <li>To show conversations to the business&rsquo;s team, assign them, and send replies, approved templates and campaigns.</li>
        <li>To honour opt-outs: a customer who replies STOP is not sent marketing messages again.</li>
        <li>To keep the service secure and fix problems.</li>
      </ul>
      <p>We do not sell personal information and do not use it for advertising.</p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <strong>Meta Platforms</strong>, which carries WhatsApp messages. Meta&rsquo;s handling is described in the{' '}
          <a href="https://www.whatsapp.com/legal/business-policy" target="_blank" rel="noreferrer">
            WhatsApp Business Policy
          </a>
          .
        </li>
        <li>Our hosting provider, which stores the data on our behalf.</li>
        <li>Authorities, only where the law requires it.</li>
      </ul>

      <h2>How we protect it</h2>
      <p>
        All traffic uses HTTPS. WhatsApp access tokens are encrypted at rest. Every incoming WhatsApp webhook is checked
        against Meta&rsquo;s signature before it is processed. Access inside a workspace is limited by role.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Conversations and contacts are kept while the business&rsquo;s workspace is active, or until the business deletes
        them. When we receive a deletion request, we delete the information within 30 days, except where the law requires
        us to keep it.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Customers can reply STOP at any time to stop marketing messages.</li>
        <li>
          Anyone can ask to see, correct or delete their information. See{' '}
          <Link href="/data-deletion">how to request deletion</Link>.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions about this policy go to {COMPANY} through the contact details on{' '}
        <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
          {COMPANY_SITE.replace('https://', '')}
        </a>
        .
      </p>
    </>
  );
}
