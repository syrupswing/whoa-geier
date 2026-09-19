import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  ParsedQuickAddItem,
  QuickAddCard,
  QUICK_ADD_TYPE_ICONS,
  QUICK_ADD_TYPE_LABELS
} from '../../services/quick-add-creation.service';

export interface QuickAddFieldChange {
  field: keyof ParsedQuickAddItem;
  value: any;
}

/** A single parsed event/reminder/todo/shopping-item/fact, reviewable and editable inline. */
@Component({
  selector: 'app-quick-add-card',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './quick-add-card.component.html',
  styleUrl: './quick-add-card.component.scss'
})
export class QuickAddCardComponent {
  @Input({ required: true }) card!: QuickAddCard;
  @Output() toggleEdit = new EventEmitter<void>();
  @Output() fieldChange = new EventEmitter<QuickAddFieldChange>();
  @Output() confirm = new EventEmitter<void>();
  @Output() discard = new EventEmitter<void>();

  readonly typeIcons = QUICK_ADD_TYPE_ICONS;
  readonly typeLabels = QUICK_ADD_TYPE_LABELS;

  onFieldChange(field: keyof ParsedQuickAddItem, value: any): void {
    this.fieldChange.emit({ field, value });
  }
}
