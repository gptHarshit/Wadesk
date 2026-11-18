import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesRule, pickRule, splitKeywords, tidyKeywords } from '../src/services/keywords.js';
import { DEFAULT_DAYS, isOpenAt, isValidTimezone, localClock, toMinutes } from '../src/services/officeHours.js';
import { csvCell, reportPhone, reportTime } from '../src/services/report.js';

// 18 Nov 2026 is a Wednesday. 04:30 UTC is 10:00 in India.
const at = (iso) => new Date(iso);
const week = (day) => Array.from({ length: 7 }, () => day);

test('toMinutes reads HH:MM and rejects anything else', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('10:30'), 630);
  assert.equal(toMinutes('23:59'), 1439);
  for (const bad of ['24:00', '9:00', '10:60', '', null, '10:00am']) assert.equal(toMinutes(bad), null, bad);
});

test('localClock uses the given time zone', () => {
  assert.deepEqual(localClock(at('2026-11-18T04:30:00Z'), 'Asia/Kolkata'), { day: 3, minutes: 600 });
  assert.deepEqual(localClock(at('2026-11-18T20:00:00Z'), 'Asia/Kolkata'), { day: 4, minutes: 90 }); // 01:30 Thursday
  assert.ok(isValidTimezone('Asia/Kolkata'));
  assert.ok(!isValidTimezone('Mars/Base'));
});

test('isOpenAt: normal day hours, start inclusive and end exclusive', () => {
  const days = week({ open: true, start: '10:00', end: '19:00' });
  assert.equal(isOpenAt(days, at('2026-11-18T04:29:00Z'), 'Asia/Kolkata'), false); // 09:59
  assert.equal(isOpenAt(days, at('2026-11-18T04:30:00Z'), 'Asia/Kolkata'), true); // 10:00
  assert.equal(isOpenAt(days, at('2026-11-18T13:29:00Z'), 'Asia/Kolkata'), true); // 18:59
  assert.equal(isOpenAt(days, at('2026-11-18T13:30:00Z'), 'Asia/Kolkata'), false); // 19:00
});

test('isOpenAt: a closed day is closed all day', () => {
  const days = DEFAULT_DAYS; // Sunday closed
  assert.equal(isOpenAt(days, at('2026-11-22T06:30:00Z'), 'Asia/Kolkata'), false); // Sunday 12:00
  assert.equal(isOpenAt(days, at('2026-11-21T06:30:00Z'), 'Asia/Kolkata'), true); // Saturday 12:00
  assert.equal(isOpenAt(days, at('2026-11-21T09:30:00Z'), 'Asia/Kolkata'), false); // Saturday 15:00, closes 14:00
});

test('isOpenAt: hours that run past midnight', () => {
  const days = week({ open: false, start: '20:00', end: '02:00' });
  days[3] = { open: true, start: '20:00', end: '02:00' }; // Wednesday night only
  assert.equal(isOpenAt(days, at('2026-11-18T15:00:00Z'), 'Asia/Kolkata'), true); // Wed 20:30
  assert.equal(isOpenAt(days, at('2026-11-18T20:00:00Z'), 'Asia/Kolkata'), true); // Thu 01:30, still Wednesday's shift
  assert.equal(isOpenAt(days, at('2026-11-18T20:30:00Z'), 'Asia/Kolkata'), false); // Thu 02:00
  assert.equal(isOpenAt(days, at('2026-11-18T13:30:00Z'), 'Asia/Kolkata'), false); // Wed 19:00
});

test('isOpenAt: missing or broken hours count as open (never sends away by mistake)', () => {
  assert.equal(isOpenAt(null, new Date(), 'Asia/Kolkata'), true);
  assert.equal(isOpenAt([], new Date(), 'Asia/Kolkata'), true);
});

test('auto-reply keywords: several per rule, case and edge punctuation ignored', () => {
  assert.deepEqual(splitKeywords(' Hi, HELLO ,, hey '), ['hi', 'hello', 'hey']);
  assert.equal(tidyKeywords(' Hi, HELLO ,, hi, hey '), 'Hi, HELLO, hey');
  const exact = { keyword: 'hi, hello', matchType: 'exact' };
  assert.ok(matchesRule(exact, 'Hello!'));
  assert.ok(matchesRule(exact, '  HI  '));
  assert.ok(matchesRule(exact, 'hi...'));
  assert.ok(!matchesRule(exact, 'hi there'));
  assert.ok(!matchesRule(exact, 'this'));
  const contains = { keyword: 'price, fees', matchType: 'contains' };
  assert.ok(matchesRule(contains, 'What are the FEES?'));
  assert.ok(!matchesRule(contains, 'hello'));
  const starts = { keyword: 'result', matchType: 'starts_with' };
  assert.ok(matchesRule(starts, '"Result kab aayega"'));
  // A single keyword still works exactly as before.
  assert.ok(matchesRule({ keyword: 'Price', matchType: 'contains' }, 'price list please'));
  assert.equal(pickRule([contains, exact], 'hi')?.matchType, 'exact');
});

test('report CSV helpers', () => {
  assert.equal(csvCell('Anil Kumar'), 'Anil Kumar');
  assert.equal(csvCell('Kumar, Anil'), '"Kumar, Anil"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+91'), "'+91");
  assert.equal(csvCell(null), '');
  assert.equal(reportPhone('919685099211'), '91 96850 99211');
  assert.equal(reportPhone('15551234567'), '1 5551234567');
  assert.equal(reportPhone(null), '');
  assert.equal(reportTime('2026-11-18T10:35:00Z', 'Asia/Kolkata'), '2026-11-18 16:05');
  assert.equal(reportTime(null, 'Asia/Kolkata'), '');
});
