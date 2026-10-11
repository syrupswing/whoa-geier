import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** The round sage "+" every page uses to start adding something, centered under the page header. */
@Component({
  selector: 'app-add-button',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <button type="button" class="add-btn" [attr.aria-label]="label" (click)="pressed.emit()">
      <mat-icon>add</mat-icon>
    </button>
  `,
  styles: [`
    :host {
      /* Only as wide as the button, so a menu opened from it anchors to the button. */
      display: block;
      width: fit-content;
      margin: 0 auto 12px;
    }

    .add-btn {
      width: 48px;
      height: 48px;
      padding: 0;
      border-radius: 50%;
      border: 1px solid transparent;
      background: color-mix(in srgb, var(--color-aura-sage) 20%, white);
      color: var(--color-aura-sage);
      display: grid;
      place-items: center;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(26, 10, 46, 0.12);
      transition: background-color 0.32s ease;

      &:hover {
        background: color-mix(in srgb, var(--color-aura-sage) 10%, white);
      }

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }
    }
  `]
})
export class AddButtonComponent {
  @Input() label = 'Add';
  @Output() pressed = new EventEmitter<void>();
}
