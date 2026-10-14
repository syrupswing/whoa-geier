import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { PlaceSuggestService, PlaceSuggestion } from '../../services/place-suggest.service';

/** A text field for an address that suggests places as you type (the same lookup the event Location field uses). Two-way: `[(value)]`. */
@Component({
  selector: 'app-address-field',
  standalone: true,
  imports: [CommonModule, FormsModule, MatAutocompleteModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="address-field">
      <mat-label>{{ label }}</mat-label>
      <mat-icon matPrefix>location_on</mat-icon>
      <input matInput name="address" autocomplete="off" placeholder="Search for a place or address"
        [ngModel]="value" (ngModelChange)="onInput($event)" [matAutocomplete]="auto">
      <mat-autocomplete #auto="matAutocomplete" (optionSelected)="onPicked($event.option.value)">
        <mat-option *ngFor="let s of suggestions" [value]="s.text">
          <span class="place-main">{{ s.main }}</span>
          <span class="place-secondary" *ngIf="s.secondary"> {{ s.secondary }}</span>
        </mat-option>
      </mat-autocomplete>
      <mat-hint *ngIf="lookupFailed">Address suggestions unavailable — you can still type the address.</mat-hint>
    </mat-form-field>`,
  styles: [`
    :host { display: block; }
    .address-field { width: 100%; }
    .place-secondary { opacity: 0.65; font-size: 0.85em; }
  `]
})
export class AddressFieldComponent implements OnDestroy {
  @Input() label = 'Address';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  suggestions: PlaceSuggestion[] = [];
  lookupFailed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private places: PlaceSuggestService) {}

  /** Looks up suggestions once typing pauses, ignoring answers that arrive after the text has moved on. */
  onInput(text: string): void {
    this.value = text ?? '';
    this.valueChange.emit(this.value);
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const { suggestions, failed } = await this.places.suggest(text ?? '');
      if (text !== this.value) return;
      this.suggestions = suggestions;
      this.lookupFailed = failed;
    }, 300);
  }

  onPicked(text: string): void {
    clearTimeout(this.timer);
    this.suggestions = [];
    this.lookupFailed = false;
    this.places.endSession();
    this.value = text;
    this.valueChange.emit(text);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
