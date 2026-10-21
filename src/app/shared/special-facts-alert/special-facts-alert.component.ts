import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DayResolverService } from '../../services/day-resolver.service';
import { HouseholdService } from '../../services/household.service';

interface FactLine {
  id: string;
  who: string;
  text: string;
}

/** Today's special facts for everyone in the household — the things not to forget, shown above the day's calendar. */
@Component({
  selector: 'app-special-facts-alert',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  templateUrl: './special-facts-alert.component.html',
  styleUrl: './special-facts-alert.component.scss'
})
export class SpecialFactsAlertComponent {
  private readonly household = inject(HouseholdService);
  private readonly resolver = inject(DayResolverService);

  trackById(_: number, line: FactLine): string {
    return line.id;
  }

  /** Read per change-detection pass rather than cached, so it rolls over at midnight without a reload. */
  lines(): FactLine[] {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    return this.household.members().flatMap(m =>
      (this.resolver.resolve(m.id, today)?.specialFacts ?? []).map(f => ({ id: f.id, who: m.name, text: f.text })));
  }
}
