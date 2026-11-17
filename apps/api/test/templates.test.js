import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTemplateMessage, describeTemplate, placeholders, resolveValue, sanitizeVariables } from '../src/services/templates.js';

const order = {
  parameterFormat: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
    { type: 'BODY', text: 'Hi {{1}}, order {{2}} ships today. Thanks {{1}}!' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track', url: 'https://x.test/t/{{1}}' }, { type: 'QUICK_REPLY', text: 'Stop' }] },
  ],
};

test('placeholders are found once each, in order', () => {
  assert.deepEqual(placeholders('Hi {{1}}, {{ 2 }} and {{1}} again'), ['1', '2']);
  assert.deepEqual(placeholders('Hi {{first_name}}'), ['first_name']);
  assert.deepEqual(placeholders('No variables'), []);
});

test('describeTemplate lists what a template needs', () => {
  const info = describeTemplate(order);
  assert.deepEqual(info.header.params, ['1']);
  assert.deepEqual(info.body.params, ['1', '2']);
  assert.equal(info.buttons[0].needsParam, true);
  assert.equal(info.buttons[1].needsParam, false);
  assert.equal(info.sendable, true);
});

test('unsupported button types are flagged, not sent wrongly', () => {
  const info = describeTemplate({ components: [{ type: 'BODY', text: 'Code {{1}}' }, { type: 'BUTTONS', buttons: [{ type: 'OTP', text: 'Copy' }] }] });
  assert.equal(info.sendable, false);
  assert.throws(() => buildTemplateMessage({ components: [{ type: 'BODY', text: 'x' }, { type: 'BUTTONS', buttons: [{ type: 'OTP' }] }] }, {}, {}));
});

test('merge fields resolve per contact with fallbacks', () => {
  assert.equal(resolveValue('{{name|there}}', { name: 'Asha' }), 'Asha');
  assert.equal(resolveValue('{{name|there}}', { name: '' }), 'there');
  assert.equal(resolveValue('{{ Name }}', {}), '');
  assert.equal(resolveValue('Call {{phone}}', { phone: '9198' }), 'Call 9198');
  assert.equal(resolveValue('plain text', {}), 'plain text');
});

test('buildTemplateMessage produces the send-API components and the rendered text', () => {
  const built = buildTemplateMessage(order, { header: { text: { 1: '#77' } }, body: { 1: '{{name|there}}', 2: '#77' }, buttons: { 0: 'abc' } }, { name: 'Ravi' });
  assert.deepEqual(built.components, [
    { type: 'header', parameters: [{ type: 'text', text: '#77' }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Ravi' }, { type: 'text', text: '#77' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
  ]);
  assert.equal(built.text, 'Order #77\n\nHi Ravi, order #77 ships today. Thanks Ravi!');
});

test('a missing variable is an error, never an empty parameter', () => {
  assert.throws(() => buildTemplateMessage(order, { header: { text: { 1: 'x' } }, body: { 1: '{{name}}', 2: 'x' }, buttons: { 0: 'x' } }, { name: '' }), /No name saved/);
  assert.throws(() => buildTemplateMessage(order, { body: { 1: 'a', 2: 'b' } }, {}), /header/);
});

test('named templates send parameter_name', () => {
  const tpl = { parameterFormat: 'NAMED', components: [{ type: 'BODY', text: 'Hi {{first_name}}' }] };
  const built = buildTemplateMessage(tpl, { body: { first_name: 'Asha' } }, {});
  assert.deepEqual(built.components, [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'first_name', text: 'Asha' }] }]);
});

test('media headers need a public https link', () => {
  const tpl = { components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Offer' }] };
  assert.throws(() => buildTemplateMessage(tpl, {}, {}), /https link/);
  assert.throws(() => buildTemplateMessage(tpl, { header: { link: 'http://insecure.test/a.jpg' } }, {}), /https link/);
  const built = buildTemplateMessage(tpl, { header: { link: 'https://cdn.test/a.jpg' } }, {});
  assert.deepEqual(built.components, [{ type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.test/a.jpg' } }] }]);
});

test('templates without variables send no components', () => {
  assert.deepEqual(buildTemplateMessage({ components: [{ type: 'BODY', text: 'Welcome!' }] }, undefined, {}).components, []);
});

test('sanitizeVariables drops anything that is not a simple value', () => {
  const clean = sanitizeVariables({ body: { 1: 'a', 2: { evil: true }, 3: 5 }, header: { text: { 1: 'h' }, link: ' https://x.test/i.png ' }, buttons: null, extra: 'x' });
  assert.deepEqual(clean, { header: { text: { 1: 'h' }, link: 'https://x.test/i.png' }, body: { 1: 'a', 3: '5' }, buttons: {} });
});

/* ----------------------------- Custom fields ----------------------------- */

import { mergeFieldsUsed, missingFields, normalizeFieldKey, sanitizeAttributes } from '../src/services/templates.js';

const result = {
  parameterFormat: 'POSITIONAL',
  components: [{ type: 'BODY', text: 'Dear {{1}}, {{2}} scored {{3}} marks.' }],
};
const resultVars = { body: { 1: '{{father_name|Parent}}', 2: '{{name}}', 3: '{{marks}}' } };

test('normalizeFieldKey turns headers into safe keys', () => {
  assert.equal(normalizeFieldKey('Father Name'), 'father_name');
  assert.equal(normalizeFieldKey('  Due Amount (Rs) '), 'due_amount_rs');
  assert.equal(normalizeFieldKey('2024 Marks'), 'f_2024_marks');
  assert.equal(normalizeFieldKey('---'), '');
});

test('sanitizeAttributes keeps text values and drops empties and built-ins', () => {
  assert.deepEqual(sanitizeAttributes({ Marks: 92, 'Father Name': ' Suresh ', notes: '', name: 'x', obj: {} }), {
    marks: '92',
    father_name: 'Suresh',
  });
});

test('custom fields are merged into template variables', () => {
  const contact = { name: 'Riya', attributes: { father_name: 'Suresh Sharma', marks: '92' } };
  const built = buildTemplateMessage(result, resultVars, contact);
  assert.equal(built.text, 'Dear Suresh Sharma, Riya scored 92 marks.');
  assert.deepEqual(
    built.components[0].parameters.map((p) => p.text),
    ['Suresh Sharma', 'Riya', '92'],
  );
});

test('a fallback covers a missing custom field', () => {
  const built = buildTemplateMessage(result, resultVars, { name: 'Aman', attributes: { marks: '67' } });
  assert.equal(built.text, 'Dear Parent, Aman scored 67 marks.');
});

test('a missing field without fallback is reported by name', () => {
  assert.throws(() => buildTemplateMessage(result, resultVars, { name: 'Aman', attributes: {} }), /No marks saved/);
  // Even when the rest of the value would still have text in it.
  const partial = { body: { 1: 'Parent', 2: '{{name}}', 3: 'about {{marks}}' } };
  assert.throws(() => buildTemplateMessage(result, partial, { name: 'Aman', attributes: {} }), /No marks saved/);
});

test('the sample stand-in satisfies every field', () => {
  const built = buildTemplateMessage(result, resultVars, { sample: true });
  assert.equal(built.text, 'Dear [father_name], [name] scored [marks] marks.');
});

test('mergeFieldsUsed and missingFields', () => {
  assert.deepEqual(mergeFieldsUsed(resultVars).sort(), ['father_name', 'marks', 'name']);
  assert.deepEqual(missingFields('{{marks}} {{class|NA}} {{name}}', { name: 'A', attributes: {} }), ['marks']);
  // Numbers like {{1}} inside a value are not merge fields.
  assert.equal(resolveValue('Code {{1}}', { name: 'A' }), 'Code {{1}}');
});
