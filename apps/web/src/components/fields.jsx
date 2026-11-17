'use client';

import { LuPlus, LuTrash2 } from 'react-icons/lu';
import { Button, IconButton, cx } from './ui';

export const BUILT_IN_FIELDS = ['name', 'phone', 'email'];

/** "father_name" -> "Father name" for labels. */
export const fieldLabel = (key) => {
  const text = String(key).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Same rules as the API: "Father Name" -> "father_name". */
export function normalizeFieldKey(raw) {
  let key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (key && /^[0-9]/.test(key)) key = `f_${key}`;
  return key;
}

/** { marks: "92" } -> [{ key: "marks", value: "92" }] for editing. */
export const toFieldRows = (attributes) => Object.entries(attributes ?? {}).map(([key, value]) => ({ key, value: String(value) }));

/** Rows back to the object the API expects; blank rows are dropped. */
export function toAttributes(rows) {
  const out = {};
  for (const row of rows) {
    const key = normalizeFieldKey(row.key);
    const value = String(row.value ?? '').trim();
    if (key && value && !BUILT_IN_FIELDS.includes(key)) out[key] = value;
  }
  return out;
}

export const sameAttributes = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

const CELL =
  'h-9 w-full min-w-0 rounded-md border border-mist-300 bg-white px-2.5 text-sm placeholder:text-mist-400 focus:border-leaf-600 focus:outline-none focus:ring-2 focus:ring-leaf-600/20';

/** Editable list of a contact's custom fields (key + value rows). */
export function FieldsEditor({ rows, onChange, suggestions = [] }) {
  const update = (index, patch) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const listId = 'field-key-suggestions';
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-mist-800">Custom fields</p>
      <p className="mb-2 text-sm text-mist-500">Details you can put into campaign messages, like marks, department or due amount.</p>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} className="flex items-center gap-2">
              <input
                className={cx(CELL, 'flex-[2]')}
                placeholder="Field, e.g. marks"
                aria-label={`Field ${index + 1} name`}
                list={listId}
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <input
                className={cx(CELL, 'flex-[3]')}
                placeholder="Value"
                aria-label={`Field ${index + 1} value`}
                value={row.value}
                maxLength={500}
                onChange={(e) => update(index, { value: e.target.value })}
              />
              <IconButton label="Remove field" icon={LuTrash2} onClick={() => onChange(rows.filter((_, i) => i !== index))} />
            </div>
          ))}
        </div>
      ) : null}
      <datalist id={listId}>
        {suggestions.map((key) => (
          <option key={key} value={key} />
        ))}
      </datalist>
      <Button variant="secondary" size="sm" icon={LuPlus} className="mt-2" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        Add field
      </Button>
    </div>
  );
}

/** Read-only list of custom fields. */
export function FieldList({ attributes }) {
  const entries = Object.entries(attributes ?? {});
  if (!entries.length) return <p className="text-sm text-mist-500">No custom fields</p>;
  return (
    <dl className="divide-y divide-mist-100 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-3 py-1.5">
          <dt className="w-2/5 shrink-0 text-mist-500">{fieldLabel(key)}</dt>
          <dd className="min-w-0 break-words text-mist-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Clickable field names that insert "{{key}}" into a variable input. */
export function FieldChips({ fields, onPick }) {
  if (!fields.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-mist-500">Insert:</span>
      {fields.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          className="rounded-full border border-mist-300 bg-white px-2 py-0.5 text-xs font-medium text-mist-700 hover:border-leaf-600 hover:bg-leaf-50"
        >
          {key}
        </button>
      ))}
    </div>
  );
}
