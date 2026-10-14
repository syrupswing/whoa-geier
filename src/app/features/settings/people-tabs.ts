import { FamilyMember } from '../../services/household.service';

export interface PersonTab {
  /** Stable across the signed-in person naming themselves, so their tab doesn't reset when it gains a member. */
  key: string;
  memberId: string | null;
  isMe: boolean;
  label: string;
}

/**
 * The signed-in person first (labelled with their first name, else their email), then everyone else in
 * the household by name, so one adult can add or edit things for another adult or a child.
 * A link to a member who no longer exists counts as no link.
 */
export function buildPeopleTabs(members: FamilyMember[], myMemberId: string | null, email: string | null | undefined): PersonTab[] {
  const me = members.find(m => m.id === myMemberId) ?? null;
  const mine: PersonTab = { key: 'me', memberId: me?.id ?? null, isMe: true, label: me?.name || email || 'Me' };
  const others = members
    .filter(m => m.id !== me?.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<PersonTab>(m => ({ key: m.id, memberId: m.id, isMe: false, label: m.name }));
  return [mine, ...others];
}
