import Link from 'next/link';
import { COMPANY, COMPANY_SITE, UPDATED } from '@/lib/legal';

export const metadata = { title: 'Terms of service · WaDesk' };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="meta">Last updated {UPDATED}</p>

      <p>
        These terms apply to everyone who uses WaDesk, a WhatsApp inbox and messaging tool operated by {COMPANY}. By
        signing in, you agree to them.
      </p>

      <h2>Using WaDesk</h2>
      <ul>
        <li>You must follow the WhatsApp Business Policy and WhatsApp Commerce Policy, as well as applicable law.</li>
        <li>
          Message only people who have agreed to hear from your business, and stop when they ask. Customers who reply STOP
          are opted out automatically.
        </li>
        <li>Do not send spam, misleading content, or anything WhatsApp does not allow.</li>
        <li>Keep your sign-in details private. You are responsible for activity under your account.</li>
      </ul>

      <h2>WhatsApp and Meta</h2>
      <p>
        Messages travel through Meta&rsquo;s WhatsApp Business Platform. Meta sets message pricing, template approval and
        sending limits, and may restrict an account. WaDesk cannot override those decisions.
      </p>

      <h2>Your data</h2>
      <p>
        Your contacts and conversations belong to your business. How we handle them is described in the{' '}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep WaDesk running, but it is provided as is. We are not liable for messages delayed or not delivered
        by WhatsApp, or for losses caused by misuse of the service.
      </p>

      <h2>Ending use</h2>
      <p>
        You can stop using WaDesk at any time. We may suspend access that breaks these terms or WhatsApp&rsquo;s policies.
      </p>

      <h2>Contact</h2>
      <p>
        Reach {COMPANY} through{' '}
        <a href={COMPANY_SITE} target="_blank" rel="noreferrer">
          {COMPANY_SITE.replace('https://', '')}
        </a>
        .
      </p>
    </>
  );
}
