import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { NOTE_KINDS, NoteField, noteKindDef } from '../../services/note-kinds';
import {
  ParsedQuickAddItem,
  QuickAddCard,
  QUICK_ADD_TYPE_ICONS,
  QUICK_ADD_TYPE_LABELS,
  QuickAddCreationService
} from '../../services/quick-add-creation.service';

export interface QuickAddFieldChange {
  field: keyof ParsedQuickAddItem;
  value: any;
}

/** A single parsed event/reminder/todo/shopping-item/fact, reviewable and editable inline. */
@Component({
  selector: 'app-quick-add-card',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, TextFieldModule, RouterLink],
  templateUrl: './quick-add-card.component.html',
  styleUrl: './quick-add-card.component.scss'
})
export class QuickAddCardComponent {
  @Input({ required: true }) card!: QuickAddCard;
  @Output() toggleEdit = new EventEmitter<void>();
  @Output() fieldChange = new EventEmitter<QuickAddFieldChange>();
  @Output() confirm = new EventEmitter<void>();
  @Output() discard = new EventEmitter<void>();

  private readonly creation = inject(QuickAddCreationService);

  /** Kinds a note card can be filed under (facts have their own card type). */
  readonly noteKinds = NOTE_KINDS.filter(k => k.kind !== 'fact');

  readonly typeIcons = QUICK_ADD_TYPE_ICONS;
  readonly typeLabels = QUICK_ADD_TYPE_LABELS;

  /** Where the saved item lives in the app, for the link on a confirmed card. */
  get destination() {
    return this.creation.getDestination(this.card.item, this.card.createdId);
  }

  /** Notes only: the notebook kind's detail fields (a provider's phone, a warranty's expiry, …). */
  get noteFields(): NoteField[] {
    return this.card.item.type === 'note' ? noteKindDef(this.card.item.noteKind).fields : [];
  }

  /** The label on the card: a note shows its notebook kind (Provider, Warranty, …) rather than just "Note". */
  get typeLabel(): string {
    return this.card.item.type === 'note'
      ? noteKindDef(this.card.item.noteKind).label
      : this.typeLabels[this.card.item.type];
  }

  get typeIcon(): string {
    return this.card.item.type === 'note'
      ? noteKindDef(this.card.item.noteKind).icon
      : this.typeIcons[this.card.item.type];
  }

  /** Notes only: the filled-in detail fields as "Label: value" lines for the read-only view. */
  get noteDetails(): { label: string; value: string }[] {
    const data = this.card.item.data || {};
    return this.noteFields
      .filter(f => data[f.key])
      .map(f => ({ label: f.label.replace(/ \(.*\)$/, ''), value: data[f.key] }));
  }

  onDataChange(key: string, value: string): void {
    this.onFieldChange('data', { ...(this.card.item.data || {}), [key]: value });
  }

  onTagsChange(text: string): void {
    this.onFieldChange('tags', text.split(',').map(t => t.trim()).filter(Boolean));
  }

  onFieldChange(field: keyof ParsedQuickAddItem, value: any): void {
    this.fieldChange.emit({ field, value });
  }
}
