import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { trigger, transition, style, animate } from '@angular/animations';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { AiOrchestratorService } from '../../services/ai-orchestrator.service';
import { AiSuggestionService } from '../../services/ai-suggestion.service';
import { TodoService } from '../../services/todo.service';
import { GroceryService } from '../../services/grocery.service';
import { MemoryService, ExplicitFact } from '../../services/memory.service';
import { HouseholdService } from '../../services/household.service';
import { GoogleCalendarService } from '../../services/google-calendar.service';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';

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
  category?: string;
  date?: string;
  time?: string;
  person?: string | null;
  confidence?: QuickAddConfidence;
  inferredNote?: string | null;
}

interface QuickAddCard {
  suggestionId: string | null;
  item: ParsedQuickAddItem;
  original: ParsedQuickAddItem;
  duplicateNote: string | null;
  isLowConfidence: boolean;
  isEditing: boolean;
  status: 'pending' | 'confirmed' | 'discarded';
}

const TYPE_ICONS: Record<QuickAddItemType, string> = {
  event: 'event',
  reminder: 'notifications_active',
  todo: 'task_alt',
  fact: 'psychology',
  shopping_item: 'shopping_cart'
};

const TYPE_LABELS: Record<QuickAddItemType, string> = {
  event: 'Event',
  reminder: 'Reminder',
  todo: 'To-do',
  fact: 'Fact',
  shopping_item: 'Shopping item'
};

@Component({
  selector: 'app-quick-add',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatSnackBarModule,
    LoadingAnimationComponent
  ],
  templateUrl: './quick-add.component.html',
  styleUrl: './quick-add.component.scss',
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('220ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('180ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class QuickAddComponent {
  readonly typeIcons = TYPE_ICONS;
  readonly typeLabels = TYPE_LABELS;

  isOpen = signal(false);
  statement = '';
  isParsing = signal(false);
  cards = signal<QuickAddCard[]>([]);

  pendingCards = computed(() => this.cards().filter(c => c.status === 'pending'));
  hasConfirmableHighConfidence = computed(() =>
    this.pendingCards().some(c => !c.isLowConfidence)
  );
  allResolved = computed(() =>
    this.cards().length > 0 && this.pendingCards().length === 0
  );

  constructor(
    private aiOrchestrator: AiOrchestratorService,
    private aiSuggestionService: AiSuggestionService,
    private todoService: TodoService,
    private groceryService: GroceryService,
    private memoryService: MemoryService,
    public householdService: HouseholdService,
    private googleCalendarService: GoogleCalendarService,
    private appCalendarEventService: AppCalendarEventService,
    private snackBar: MatSnackBar
  ) {}

  togglePanel(): void {
    this.isOpen.update(v => !v);
  }

  startNew(): void {
    this.cards.set([]);
    this.statement = '';
  }

  async submitStatement(): Promise<void> {
    const statement = this.statement.trim();
    if (!statement || this.isParsing()) return;

    this.isParsing.set(true);
    try {
      const knownPeople = this.householdService.members().map(m => m.name);
      const { result, suggestionIds } = await this.aiOrchestrator.generateWithSuggestionIds<ParsedQuickAddItem[]>(
        'quick-add-parse',
        {
          statement,
          referenceDate: this.todayIso(),
          referenceWeekday: this.todayWeekday(),
          knownPeople
        }
      );

      const items = result || [];
      const ids = suggestionIds || [];
      const newCards: QuickAddCard[] = items.map((item, i) => ({
        suggestionId: ids[i] ?? null,
        item,
        original: { ...item },
        duplicateNote: this.computeDuplicateNote(item),
        isLowConfidence: this.hasLowConfidence(item),
        isEditing: false,
        status: 'pending'
      }));

      this.cards.set(newCards);
      this.statement = '';
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to parse — try again', 'Close', { duration: 3000 });
    } finally {
      this.isParsing.set(false);
    }
  }

  toggleEdit(card: QuickAddCard): void {
    this.cards.update(cards => cards.map(c => c === card ? { ...c, isEditing: !c.isEditing } : c));
  }

  updateCardField(card: QuickAddCard, field: keyof ParsedQuickAddItem, value: any): void {
    this.cards.update(cards => cards.map(c => {
      if (c !== card) return c;
      const item = { ...c.item, [field]: value };
      return {
        ...c,
        item,
        isLowConfidence: this.hasLowConfidence(item),
        duplicateNote: this.computeDuplicateNote(item)
      };
    }));
  }

  async confirmCard(card: QuickAddCard): Promise<void> {
    try {
      await this.createRecord(card.item);
      if (card.suggestionId) {
        const wasEdited = JSON.stringify(card.item) !== JSON.stringify(card.original);
        if (wasEdited) {
          await this.aiSuggestionService.markEdited(card.suggestionId, card.item as Record<string, any>);
        } else {
          await this.aiSuggestionService.markAccepted(card.suggestionId);
        }
      }
      this.setStatus(card, 'confirmed');
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to add — try again', 'Close', { duration: 3000 });
    }
  }

  async discardCard(card: QuickAddCard): Promise<void> {
    if (card.suggestionId) {
      await this.aiSuggestionService.markRejected(card.suggestionId);
    }
    this.setStatus(card, 'discarded');
  }

  async confirmAllHighConfidence(): Promise<void> {
    const targets = this.pendingCards().filter(c => !c.isLowConfidence);
    for (const card of targets) {
      await this.confirmCard(card);
    }
  }

  private setStatus(card: QuickAddCard, status: QuickAddCard['status']): void {
    this.cards.update(cards => cards.map(c => c === card ? { ...c, status } : c));
  }

  private hasLowConfidence(item: ParsedQuickAddItem): boolean {
    const values = Object.values(item.confidence || {});
    return values.some(v => v === 'low') || !!item.inferredNote;
  }

  private async createRecord(item: ParsedQuickAddItem): Promise<void> {
    switch (item.type) {
      case 'event': {
        const { start, end } = this.buildEventTimes(item);
        await this.appCalendarEventService.addEvent({
          summary: item.title || 'Untitled event',
          start,
          end
        });
        break;
      }
      case 'reminder':
      case 'todo': {
        const dueDate = item.date
          ? new Date(`${item.date}T${item.time || '00:00'}:00`).toISOString()
          : undefined;
        await this.todoService.addItem({
          title: item.title || 'Untitled',
          completed: false,
          dueDate,
          urgency: item.type === 'reminder' ? 'hard-deadline' : 'soft-deadline'
        });
        break;
      }
      case 'fact': {
        const memberId = this.resolvePersonToMemberId(item.person);
        const fact: Omit<ExplicitFact, 'id' | 'createdAt'> = {
          factText: item.factText || item.title || '',
          category: item.category || 'other'
        };
        if (memberId) fact.memberId = memberId;
        await this.memoryService.addExplicitFact(fact);
        break;
      }
      case 'shopping_item': {
        await this.groceryService.addItem(item.title || 'Untitled item');
        break;
      }
    }
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
    return { start: { date }, end: { date } };
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

  private todayWeekday(): string {
    return new Date().toLocaleDateString('en-US', { weekday: 'long' });
  }
}
