const nodemailer = require('nodemailer');
const pool = require('../db');

function buildTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function checkSlaBreaches() {
  const warningDays = Number(process.env.SLA_WARNING_DAYS || 7);
  const transport = buildTransport();
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT * FROM contracts
     WHERE sla_date IS NOT NULL
       AND sla_date <= (CURRENT_DATE + $1::int)
       AND status NOT IN ('closed', 'cancelled')`,
    [warningDays]
  );

  for (const contract of rows) {
    const slaDateStr = contract.sla_date.toISOString ? contract.sla_date.toISOString().slice(0, 10) : contract.sla_date;
    const kind = slaDateStr < today ? 'sla_breach' : 'sla_warning';

    const { rows: already } = await pool.query(
      `SELECT 1 FROM notification_log WHERE contract_id = $1 AND kind = $2 AND notified_at > now() - interval '1 day'`,
      [contract.id, kind]
    );
    if (already.length) continue;

    const recipients = [contract.approver_email, ...(contract.interested_emails || [])].filter(Boolean);
    const subject = kind === 'sla_breach'
      ? `SLA breached: ${contract.title}`
      : `SLA approaching: ${contract.title}`;
    const body = kind === 'sla_breach'
      ? `${contract.title} (${contract.doc_type}) passed its SLA date of ${slaDateStr}.`
      : `${contract.title} (${contract.doc_type}) is due by ${slaDateStr}, within the ${warningDays}-day warning window.`;

    if (recipients.length && transport) {
      try {
        await transport.sendMail({ from: process.env.SMTP_FROM, to: recipients.join(','), subject, text: body });
      } catch (err) {
        console.error('Notification email failed for', contract.id, err.message);
      }
    } else if (recipients.length) {
      console.log(`[${kind}] ${subject} — would notify: ${recipients.join(', ')} (SMTP not configured, logging instead)`);
    }

    await pool.query('INSERT INTO notification_log (contract_id, kind) VALUES ($1, $2)', [contract.id, kind]);
  }
}

module.exports = { checkSlaBreaches };
