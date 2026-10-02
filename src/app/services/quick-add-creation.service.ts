import { Injectable, inject } from '@angular/core';
import { TodoService } from './todo.service';
import { GroceryService } from './grocery.service';
import { MemoryService, ExplicitFact } from './memory.service';
import { HouseholdService } from './household.service';
import { GoogleCalendarService } from './google-calendar.service';
import { AppCalendarEventService, nextDayIso } from './app-calendar-event.service';

export type QuickAddItemType = 'event' | 'reminder' | 'todo' | 'fact' | 'shopping_item';

export interface QuickAddConfidence {
  date?: 'high' | 'low';
  time?: 'high' | 'low';
  person?: 'high' | 'low';
}

export interface ParsedQuickAddItem {
  type: QuickAddItemType;
  title?: string;
  factText?: string;
  /** Fact only: id of a saved fact this one supersedes, so confirming updates it rather than adding a duplicate. */
  replacesFactId?: string | null;
  category?: string;
  date?: string;
  time?: string;
  person?: string | null;
  confidence?: QuickAddConfidence;
  inferredNote?: string | null;
}

export interface QuickAddCard {
  suggestionId: string | null;
  item: ParsedQuickAddItem;
  original: ParsedQuickAddItem;
  duplicateNote: string | null;
  isLowConfidence: boolean;
  isEditing: boolean;
  status: 'pending' | 'confirmed' | 'discarded';
  /** Set on a fact proposed from the user correcting an assistant reply, so the chat can label it as a memory to review. */
  fromCorrection?: boolean;
  /** Set once confirmed: the id of the saved record, so the confirmation can link straight to it. */
  createdId?: string;
}

export const QUICK_ADD_TYPE_ICONS: Record<QuickAddItemType, string> = {
  event: 'event',
  reminder: 'notifications_active',
  todo: 'task_alt',
  fact: 'psychology',
  shopping_item: 'shopping_cart'
};

export const QUICK_ADD_TYPE_LABELS: Record<QuickAddItemType, string> = {
  event: 'Event',
  reminder: 'Reminder',
  todo: 'To-do',
  fact: 'Fact',
  shopping_item: 'Shopping item'
};

export interface QuickAddDestination {
  /** Route path, e.g. '/calendar'. */
  path: string;
  queryParams?: Record<string, string>;
  /** Link text, e.g. "View in Calendar". */
  label: string;
}

/**
 * Turns a 'family-chat' response's parsed items into review-able cards, and turns a
 * confirmed card into an actual todo/event/fact/grocery record. Shared by any chat surface
 * that lets the user create data via free text — originally the standalone QuickAddComponent
 * panel, now the inline cards under a chat reply.
 */
@Injectable({
  providedIn: 'root'
})
export class QuickAddCreationService {
  private todoService = inject(TodoService);
  private groceryService = inject(GroceryService);
  private memoryService = inject(MemoryService);
  private householdService = inject(HouseholdService);
  private googleCalendarService = inject(GoogleCalendarService);
  private appCalendarEventService = inject(AppCalendarEventService);

  /** Where a saved item can be found in the app — the page, and the part of it (week, section) when the page can jump there. */
  getDestination(item: ParsedQuickAddItem, createdId?: string): QuickAddDestination {
    const highlight: Record<string, string> = createdId ? { highlight: createdId } : {};
    switch (item.type) {
      case 'event':
        return { path: '/calendar', queryParams: { date: item.date || this.todayIso(), ...highlight }, label: 'View on the calendar' };
      case 'reminder':
      case 'todo':
        return { path: '/todos', queryParams: highlight, label: 'View in the to-do list' };
      case 'shopping_item':
        return { path: '/grocery-list', queryParams: highlight, label: 'View in the shopping list' };
      case 'fact':
        return { path: '/settings', queryParams: { section: 'family-memory', ...highlight }, label: 'View in Family memory' };
    }
  }

  buildCard(item: ParsedQuickAddItem, suggestionId: string | null): QuickAddCard {
    return {
      suggestionId,
      item,
      original: { ...item },
      duplicateNote: this.computeDuplicateNote(item),
      isLowConfidence: this.hasLowConfidence(item),
      isEditing: false,
      status: 'pending'
    };
  }

  updateField(card: QuickAddCard, field: keyof ParsedQuickAddItem, value: any): QuickAddCard {
    const item = { ...card.item, [field]: value };
    return {
      ...card,
      item,
      isLowConfidence: this.hasLowConfidence(item),
      duplicateNote: this.computeDuplicateNote(item)
    };
  }

  hasLowConfidence(item: ParsedQuickAddItem): boolean {
    const values = Object.values(item.confidence || {});
    return values.some(v => v === 'low') || !!item.inferredNote;
  }

  /** Saves the item and returns the id of the record it created (or updated), when there is one. */
  async createRecord(item: ParsedQuickAddItem): Promise<string | null> {
    switch (item.type) {
      case 'event': {
        const { start, end } = this.buildEventTimes(item);
        const memberId = this.resolvePersonToMemberId(item.person);
        const event: Parameters<AppCalendarEventService['addEvent']>[0] = {
          summary: item.title || 'Untitled event',
          start,
          end
        };
        if (memberId) event.memberId = memberId;
        return this.appCalendarEventService.addEvent(event);
      }
      case 'reminder':
      case 'todo': {
        const dueDate = item.date
          ? new Date(`${item.date}T${item.time || '00:00'}:00`).toISOString()
          : undefined;
        const memberId = this.resolvePersonToMemberId(item.person);
        return this.todoService.addItem({
          title: item.title || 'Untitled',
          completed: false,
          dueDate,
          urgency: item.type === 'reminder' ? 'hard-deadline' : 'soft-deadline',
          ...(memberId ? { memberId } : {})
        });
      }
      case 'fact': {
        const memberId = this.resolvePersonToMemberId(item.person);
        const fact: Omit<ExplicitFact, 'id' | 'createdAt'> = {
          factText: item.factText || item.title || '',
          category: item.category || 'other'
        };
        if (memberId) fact.memberId = memberId;
        if (item.replacesFactId) {
          await this.memoryService.updateExplicitFact(item.replacesFactId, fact);
          return item.replacesFactId;
        }
        return this.memoryService.addExplicitFact(fact);
      }
      case 'shopping_item': {
        return this.groceryService.addItem(item.title || 'Untitled item');
      }
    }
    return null;
  }

  private buildEventTimes(item: ParsedQuickAddItem): {
    start: { date?: string; dateTime?: string };
    end: { date?: string; dateTime?: string };
  } {
    const date = item.date || this.todayIso();
    if (item.time) {
      const start = new Date(`${date}T${item.time}:00`);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
    }
    // end.date is exclusive (the day after), like Google Calendar.
    return { start: { date }, end: { date: nextDayIso(date) } };
  }

  private resolvePersonToMemberId(person: string | null | undefined): string | undefined {
    if (!person) return undefined;
    const match = this.householdService.members().find(
      m => m.name.toLowerCase() === person.toLowerCase()
    );
    return match?.id;
  }

  /** Plain-JS similarity check (normalize + substring match) — no AI call needed for this. */
  private isSimilar(a: string, b: string): boolean {
    const normalize = (text: string) =>
      text.toLowerCase().replace(/^(buy|get|add|need|pick up|grab)\s+/i, '').trim();
    const na = normalize(a || '');
    const nb = normalize(b || '');
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  private computeDuplicateNote(item: ParsedQuickAddItem): string | null {
    const title = item.title || item.factText || '';
    if (!title) return null;

    switch (item.type) {
      case 'shopping_item': {
        const match = this.groceryService.getActiveItems().find(g => this.isSimilar(g.name, title));
        return match ? `Looks similar to "${match.name}" already on the shopping list.` : null;
      }
      case 'todo':
      case 'reminder': {
        const match = this.todoService.items()
          .filter(t => !t.completed)
          .find(t => this.isSimilar(t.title, title));
        return match ? `Looks similar to an open to-do: "${match.title}".` : null;
      }
      case 'fact': {
        const match = this.memoryService.explicitFacts().find(f => this.isSimilar(f.factText, title));
        return match ? `A similar fact is already saved: "${match.factText}".` : null;
      }
      case 'event': {
        if (!item.date) return null;
        const allEvents = [...this.googleCalendarService.events(), ...this.appCalendarEventService.events()];
        const match = allEvents.find(e => {
          const eventDate = e.start.dateTime || e.start.date;
          if (!eventDate || eventDate.slice(0, 10) !== item.date) return false;
          return this.isSimilar(e.summary, title);
        });
        return match ? `Looks similar to an existing event: "${match.summary}".` : null;
      }
    }
    return null;
  }

  private todayIso(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
