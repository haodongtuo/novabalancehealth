// netlify/functions/reminder.js
// Returns a .ics calendar file so the phone's native calendar picks it up automatically.

exports.handler = async (event) => {
  const product = (event.queryStringParameters && event.queryStringParameters.product)
    ? decodeURIComponent(event.queryStringParameters.product)
    : 'NovaBalance Supplement';

  // Default reminder: tomorrow at 8:00 AM
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(8, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0];

  const uid = `nova-${Date.now()}@novabalancehealth.com`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NovaBalance Health//Reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:Take ${product}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    'RRULE:FREQ=DAILY',
    `DESCRIPTION:Daily reminder to take your ${product}.`,
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:Time to take your ${product}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="nova-reminder.ics"`,
    },
    body: ics,
  };
};
