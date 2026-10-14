import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * One term/description pair of a settings list: the label on the left, the current value, and an edit
 * button on the right. Editing swaps the value for whatever is projected as `[editor]` plus Save and
 * Cancel. The parent owns the draft: reset it on `editStart`, persist it on `save`, then call `close()`.
 * Goes inside a `<dl class="setting-list">`.
 */
@Component({
  selector: 'app-setting-row',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './setting-row.component.html',
  styleUrl: './setting-row.component.scss'
})
export class SettingRowComponent {
  @Input({ required: true }) label = '';
  /** What to show in view mode; empty shows `emptyText`. */
  @Input() value: string | null | undefined = '';
  @Input() emptyText = 'Not set';
  /** False for read-only facts and for rows whose only control is a projected `[action]`. */
  @Input() editable = true;
  @Input() saving = false;
  @Input() hint = '';
  @Output() editStart = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();

  readonly editing = signal(false);

  start(): void {
    this.editStart.emit();
    this.editing.set(true);
  }

  /**
   * Save from the button or Enter. This is a plain DOM `submit` rather than Angular's `ngSubmit` (which needs
   * FormsModule on this component); without preventing it the browser would submit the form and reload the page.
   */
  submit(event: Event): void {
    event.preventDefault();
    if (!this.saving) this.save.emit();
  }

  close(): void {
    this.editing.set(false);
  }
}
