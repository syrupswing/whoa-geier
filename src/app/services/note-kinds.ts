/** The kinds of thing the family notebook holds, and the extra fields each kind carries in `data`. */
export type NoteKind = 'fact' | 'note' | 'provider' | 'place' | 'warranty' | 'service' | 'howto';

export interface NoteField {
  key: string;
  label: string;
  type?: 'text' | 'tel' | 'email' | 'url' | 'date';
}

export interface NoteKindDef {
  kind: NoteKind;
  label: string;
  plural: string;
  icon: string;
  /** What `title` is called for this kind (a provider's title is their name). */
  titleLabel: string;
  /** What `body` is called for this kind. */
  bodyLabel: string;
  fields: NoteField[];
  /** Suggested categories; the list is open, anything can be typed. */
  categories: string[];
}

export const NOTE_KINDS: NoteKindDef[] = [
  {
    kind: 'provider', label: 'Provider', plural: 'Providers', icon: 'contact_phone',
    titleLabel: 'Name', bodyLabel: 'Notes',
    fields: [
      { key: 'business', label: 'Business' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Address' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'status', label: 'Status (used / recommended / avoid)' },
      { key: 'recommendedBy', label: 'Recommended by' },
      { key: 'lastUsed', label: 'Last used', type: 'date' }
    ],
    categories: ['house', 'vehicle', 'medical', 'dental', 'pet', 'school', 'legal', 'financial', 'other']
  },
  {
    kind: 'place', label: 'Place', plural: 'Places', icon: 'place',
    titleLabel: 'Name', bodyLabel: 'Notes',
    fields: [
      { key: 'address', label: 'Address' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'website', label: 'Website', type: 'url' },
      { key: 'hours', label: 'Hours' }
    ],
    categories: ['restaurant', 'shop', 'park', 'travel', 'activity', 'other']
  },
  {
    kind: 'warranty', label: 'Warranty', plural: 'Warranties', icon: 'verified_user',
    titleLabel: 'Item', bodyLabel: 'Notes',
    fields: [
      { key: 'purchasedOn', label: 'Purchased', type: 'date' },
      { key: 'expiresOn', label: 'Expires', type: 'date' },
      { key: 'vendor', label: 'Bought from' },
      { key: 'serialNumber', label: 'Serial / model number' },
      { key: 'claimInfo', label: 'How to claim' }
    ],
    categories: ['appliance', 'electronics', 'vehicle', 'home', 'other']
  },
  {
    kind: 'service', label: 'Service', plural: 'Services', icon: 'handyman',
    titleLabel: 'What was done', bodyLabel: 'How it went',
    fields: [
      { key: 'provider', label: 'Provider' },
      { key: 'doneOn', label: 'Date done', type: 'date' },
      { key: 'cost', label: 'Cost' },
      { key: 'coveredUntil', label: 'Guaranteed until', type: 'date' },
      { key: 'nextDue', label: 'Next due', type: 'date' }
    ],
    categories: ['house', 'vehicle', 'appliance', 'yard', 'other']
  },
  {
    kind: 'howto', label: 'How-to', plural: 'How-tos', icon: 'menu_book',
    titleLabel: 'Title', bodyLabel: 'Steps / details',
    fields: [],
    categories: ['house', 'vehicle', 'tech', 'cooking', 'other']
  },
  {
    kind: 'note', label: 'Note', plural: 'Notes', icon: 'sticky_note_2',
    titleLabel: 'Title', bodyLabel: 'Note',
    fields: [],
    categories: ['house', 'vehicle', 'medical', 'family', 'ideas', 'other']
  },
  {
    kind: 'fact', label: 'Fact', plural: 'Facts', icon: 'psychology',
    titleLabel: 'Title', bodyLabel: 'Fact',
    fields: [],
    categories: ['dietary', 'preference', 'maintenance', 'medical', 'schedule', 'other']
  }
];

export function noteKindDef(kind: string | undefined): NoteKindDef {
  return NOTE_KINDS.find(k => k.kind === kind) ?? NOTE_KINDS.find(k => k.kind === 'note')!;
}
