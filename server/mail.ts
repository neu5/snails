export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Dev and tests: no real email. Prints each mail and keeps it for GET /api/dev/outbox. */
export class DevMailer implements Mailer {
  readonly outbox: Mail[] = [];

  constructor(private log = true) {}

  async send(mail: Mail): Promise<void> {
    this.outbox.push(mail);
    if (this.log) console.log(`\n✉ to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
  }
}

/** Real email through Resend's HTTP API (https://resend.com). */
export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text }),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${await res.text()}`);
  }
}
